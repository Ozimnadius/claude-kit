<?php
/**
 * Быстрая самопроверка без git (merge.php selftest):
 *  - движок слияния против эталонных ответов git merge-file (lib/selftest-cases.json, оба стиля);
 *  - свои тройки с известным ответом (--demo=<папка>: в подпапках base.php, ours.php, theirs.php и
 *    merged-with-markers.php — ответ git merge-file --diff3 с метками «наша доработка», «вендор 1.7.20», «вендор 1.7.21»);
 *  - свойства слияния на случайных правках: merge(x, x, y) = y, merge(y, x, x) = y, одинаковые правки — без конфликта,
 *    в чистом слиянии на месте все строки обеих сторон;
 *  - нормализация переводов строк и BOM, распознавание маркеров;
 *  - архивы (zip и запасной tar), проверка синтаксиса (php -l и token_get_all), поиск PHP CLI для веб-запроса
 *    (php-cgi/php-fpm → php рядом), окружение и настройки сайта;
 *  - итог по файлу для status/report.md, отбор чужих уведомлений об обновлении, имена бэкапов обновлятора.
 */

declare(strict_types=1);

namespace AsproMerge;

final class SelfTest
{
    private int $ok = 0;
    private array $fail = [];

    public static function run(string $root, array $opt): Result
    {
        $t = new self();
        $r = new Result('Самопроверка сверки Аспро (selftest), aspro-merge ' . Tool::VERSION);
        $t0 = microtime(true);
        $t->engineCases($r);
        $t->demoCases($r, $root, is_string($opt['demo'] ?? null) ? $opt['demo'] : null);
        $t->properties($r, (int)($opt['seed'] ?? 1), (int)($opt['n'] ?? 300));
        $t->textChecks();
        $t->archives($r);
        $t->lintChecks($r);
        $t->phpCliChecks($r);
        $t->environment($r, $root, $opt);
        $r->line(sprintf('Проверок: %d, ошибок: %d, время %.1f с', $t->ok + count($t->fail), count($t->fail), microtime(true) - $t0));
        foreach ($t->fail as $f) {
            $r->error($f);
        }
        if (!$t->fail) {
            $r->line('Итог: всё в порядке');
        }
        return $r;
    }

    private function check(bool $cond, string $what): void
    {
        $cond ? $this->ok++ : $this->fail[] = $what;
    }

    private function engineCases(Result $r): void
    {
        $d = json_decode((string)@file_get_contents(__DIR__ . '/selftest-cases.json'), true);
        if (!is_array($d)) {
            $this->fail[] = 'нет lib/selftest-cases.json';
            return;
        }
        $n = 0;
        foreach ($d['cases'] as $c) {
            foreach (['diff3' => AM_STYLE_DIFF3, 'merge' => AM_STYLE_MERGE] as $k => $style) {
                $res = am_merge($c['ours'], $c['base'], $c['theirs'], $style);
                $exp = $c['expect'][$k];
                $this->check($res['text'] === $exp['text'] && $res['conflicts'] === $exp['conflicts'],
                    "движок: «{$c['name']}» ($k) не совпал с git merge-file");
                $n++;
            }
        }
        $r->line("Движок против git merge-file ({$d['source']}): $n слияний");
    }

    /** Свои тройки с известным ответом (--demo=<папка>, относительный путь — от корня сайта); не задана — пропуск */
    private function demoCases(Result $r, string $root, ?string $demo): void
    {
        if ($demo === null || $demo === '') {
            return;
        }
        $dir = Util::norm(Util::isAbs($demo) ? $demo : Util::norm($root) . '/' . $demo);
        if (!is_dir($dir)) {
            $this->fail[] = "тройки --demo: нет папки $dir";
            return;
        }
        $labels = ['наша доработка', 'вендор 1.7.20', 'вендор 1.7.21'];
        $n = 0;
        foreach (glob("$dir/*/merged-with-markers.php") ?: [] as $f) {
            $d = dirname($f);
            $lf = static fn(string $x) => am_to_lf((string)file_get_contents("$d/$x"));
            $res = am_merge($lf('ours.php'), $lf('base.php'), $lf('theirs.php'), AM_STYLE_DIFF3, $labels);
            $this->check($res['text'] === $lf('merged-with-markers.php'), 'тройка ' . basename($d) . ': результат не совпал с merged-with-markers.php');
            $m = Planner::merge3((string)file_get_contents("$d/base.php"), (string)file_get_contents("$d/ours.php"), (string)file_get_contents("$d/theirs.php"), $labels);
            $this->check($m['conflicts'] > 0 && am_is_crlf($m['text']) === am_is_crlf((string)file_get_contents("$d/theirs.php")),
                'тройка ' . basename($d) . ': результат не в стиле файла вендора');
            $n++;
        }
        $r->line("Свои тройки (--demo): $n");
        $this->check($n > 0, "тройки --demo: в $dir нет подпапок с merged-with-markers.php");
    }

    private function properties(Result $r, int $seed, int $n): void
    {
        mt_srand($seed);
        $words = ['<?php', '$a = 1;', 'echo $b;', '}', '{', '', '<div class="x">', '</div>', 'return;', '// c', '<?=$arResult["NAME"]?>', 'foreach ($x as $y) {'];
        $gen = static function (int $len) use ($words): array {
            $o = [];
            for ($i = 0; $i < $len; $i++) {
                $o[] = $words[mt_rand(0, count($words) - 1)] . (mt_rand(0, 3) === 0 ? ' ' . mt_rand(1, 50) : '') . "\n";
            }
            return $o;
        };
        $mutate = static function (array $recs, string $tag) use ($words): array {
            $added = [];
            $k = mt_rand(1, 3);
            for ($e = 0; $e < $k; $e++) {
                $cnt = count($recs);
                $at = mt_rand(0, max(0, $cnt - 1));
                $t = mt_rand(1, 3);
                if ($t === 1 || $cnt === 0) {
                    $l = "/* $tag-$e */\n";
                    array_splice($recs, min($at + 1, $cnt), 0, [$l]);
                    $added[] = $l;
                } elseif ($t === 2) {
                    $l = rtrim($recs[$at], "\n") . " /* $tag-$e */\n";
                    $recs[$at] = $l;
                    $added[] = $l;
                } else {
                    array_splice($recs, $at, 1);
                }
            }
            // строки, которые перекрыла или удалила следующая правка той же стороны, не считаются добавленными
            return [$recs, array_values(array_filter($added, static fn($l) => in_array($l, $recs, true)))];
        };
        $bad = 0;
        for ($i = 0; $i < $n; $i++) {
            $base = $gen(mt_rand(0, 40));
            [$ours, $oa] = $mutate($base, "o$i");
            [$theirs, $ta] = $mutate($base, "t$i");
            $b = implode('', $base);
            $o = implode('', $ours);
            $t = implode('', $theirs);
            $ok = am_merge($b, $b, $t)['text'] === $t && am_merge($o, $b, $b)['text'] === $o;
            $same = am_merge($o, $b, $o);
            $ok = $ok && $same['conflicts'] === 0 && $same['text'] === $o;
            $m = am_merge($o, $b, $t);
            if ($m['conflicts'] === 0) {
                foreach (array_merge($oa, $ta) as $l) {
                    if (!str_contains($m['text'], $l)) {
                        $ok = false;
                    }
                }
            } else {
                $ok = $ok && Util::hasMarkers($m['text']);
            }
            if (!$ok) {
                $bad++;
            }
        }
        $this->check($bad === 0, "свойства слияния нарушены в $bad из $n случайных троек");
        $r->line("Свойства слияния на случайных правках: $n троек");
    }

    private function textChecks(): void
    {
        // правки не в соседних строках: соседние и у git — конфликт
        $m = Planner::merge3("a\r\nb\r\nc\r\nd\r\ne\r\n", "a\r\nB\r\nc\r\nd\r\ne\r\n", "a\nb\nc\nD\ne\n");
        $this->check($m['conflicts'] === 0 && $m['text'] === "a\nB\nc\nD\ne\n", 'CRLF↔LF: слияние после нормализации');
        $m = Planner::merge3("a\nb\nc\nd\ne\n", "a\nB\nc\nd\ne\n", "a\r\nb\r\nc\r\nD\r\ne\r\n");
        $this->check($m['text'] === "a\r\nB\r\nc\r\nD\r\ne\r\n", 'результат в стиле файла вендора (CRLF)');
        $m = Planner::merge3("\xEF\xBB\xBFa\nb\n", "a\nB\n", "\xEF\xBB\xBFa\nb\n");
        $this->check($m['text'] === "\xEF\xBB\xBFa\nB\n", 'BOM как у файла вендора');
        $this->check(Util::hasMarkers("x\n<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\n"), 'маркеры конфликта находятся');
        $this->check(Util::hasMarkers("x\r\n<<<<<<<\r\na\r\n>>>>>>>\r\n"), 'маркеры с CRLF находятся');
        $this->check(Util::hasMarkers("a\n<<<<<<< ours\nb\n=======\nd\ne\n"), 'маркеры: убран только >>>>>>> — всё равно маркеры');
        $this->check(Util::hasMarkers("a\nb\n||||||| base\nc\n=======\nd\ne\n"), 'маркеры: остались только ||||||| и ======= — всё равно маркеры');
        $this->check(Util::hasMarkers("a\nb\n>>>>>>> theirs\n"), 'маркеры: остался только >>>>>>>');
        $this->check(!Util::hasMarkers("// <<<<<<< не маркер\n\$s = '=======';\n/*\n=======\n*/\n"), 'текст, похожий на маркеры, не считается конфликтом');
        $this->check(!Util::hasMarkers("\x89PNG\r\n\x1a\n\0<<<<<<< \n"), 'в двоичном файле маркеры не ищутся');
        $h1 = Util::hashes("a\r\nb\r\n");
        $h2 = Util::hashes("a\nb\n");
        $this->check($h1['h'] !== $h2['h'] && $h1['n'] === $h2['n'], 'хеш без учёта переводов строк');
        // «только пробелы» — отступы, переводы строк и пробелы у скобок; пробелы в строках и между словами значимы
        $this->check(Util::wsSame("<?require(\$_SERVER[\"DOCUMENT_ROOT\"].'/x.php');?>\n", "<? require(\$_SERVER[\"DOCUMENT_ROOT\"].'/x.php');?>\n"), 'пробелы: «<?require» = «<? require»');
        $this->check(Util::wsSame("<?\nrequire(\$x);\n", "<?require(\$x);\n"), 'пробелы: перенос строки после «<?»');
        $this->check(Util::wsSame("if (\$a) {\n\techo 1;\n}\n", "if(\$a){\n    echo 1;\n}\n"), 'пробелы: отступы табами и пробелами');
        $this->check(!Util::wsSame("x = field + \" \" + BX.message('a');\n", "x = field + \"\" + BX.message('a');\n"), 'пробелы: пробел в строковом литерале значим');
        $this->check(!Util::wsSame(".a .b { color: red; }\n", ".a.b { color: red; }\n"), 'пробелы: «.a .b» и «.a.b» в CSS различаются');
        $this->check(!Util::wsSame("<span>a</span> <span>b</span>\n", "<span>a</span><span>b</span>\n"), 'пробелы: пробел между тегами значим');
        $this->check(!Util::wsSame("echo 'a  b';\n", "echo 'a b';\n"), 'пробелы: два пробела в строке ≠ одному');
        $png = "\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
        $this->check(Util::styleLike($png, "a\nb\n") === $png && Util::styleLike("a\nb\n", $png) === "a\nb\n", 'двоичное содержимое не приводится к стилю переводов строк');
        $this->check(Util::styleLike("a\r\nb\n", "\xEF\xBB\xBFx\r\ny\r\n") === "\xEF\xBB\xBFa\r\nb\r\n", 'текст приводится к стилю образца (CRLF и BOM)');
        $this->check(Util::gitHash("hello\n") === 'ce013625030ba8dba906f756967f9e9ca394464a', 'хеш как у git blob');
        $tf = sys_get_temp_dir() . '/am-hash-' . getmypid();
        file_put_contents($tf, "hello\n");
        $this->check(Util::gitHashFile($tf) === 'ce013625030ba8dba906f756967f9e9ca394464a', 'потоковый хеш файла как у git blob');
        @unlink($tf);
        $this->check(!str_contains(basename(Util::tmpName('/x')), '.php') && str_contains(Util::tmpName('/x'), '.am-tmp-'), 'временный файл записи — без «.php» в имени');
        $this->check(Util::ownerCheck(1000, 1000)[0] === 'ok' && Util::ownerCheck(0, 1000)[0] === 'chown' && Util::ownerCheck(33, 1000)[0] === 'stop'
            && Util::ownerCheck(33, 1000, true)[0] === 'ok', 'запуск не от владельца сайта: от root — передача файлов владельцу, от другого — отказ');
        $this->check(Util::parseBackup('components/x/_template.php.back1.7.20') === ['components/x/template.php', '1.7.20'], 'разбор имени бэкапа');
        $this->check(Updater::parseName('_template.php.back1.7.20') === ['template.php', '1.7.20', false]
            && Updater::parseName('_main_back1.7.8.zip') === ['main', '1.7.8', true] && Updater::parseName('template.php') === null, 'разбор имени бэкапа файла и папки (zip)');
        $this->check(!Util::safeRel('../x') && !Util::safeRel('/etc/passwd') && !Util::safeRel('a/../../b') && Util::safeRel('a/b.php'), 'проверка относительных путей');
        // итог по файлу в status и report.md — что сделано, а не первоначальное действие плана
        $e = ['action' => 'restore', 'status' => 'done', 'h' => ['base' => 'b', 'ours' => 'o', 'theirs' => 't', 'current' => 'r'], 'resolution' => ['source' => 'resolved']];
        $this->check(Planner::outcome($e) === 'записано решение (resolved)', 'итог решённого конфликта — «записано решение», а не «вернуть нашу версию»');
        $e = ['action' => 'merge', 'status' => 'ok', 'h' => ['base' => 'b', 'ours' => 'o', 'theirs' => 't', 'current' => 't']];
        $this->check(str_contains(Planner::outcome($e), 'наша правка уже есть у вендора'), 'итог слияния, совпавшего с версией вендора');
        $e = ['action' => 'take', 'status' => 'applied', 'h' => ['base' => 'b', 'ours' => 'b', 'theirs' => 't', 'current' => 't']];
        $this->check(Planner::outcome($e) === 'записана новая версия вендора', 'итог применённого «взять версию вендора»');
        // чужие уведомления об обновлении — да, своё и посторонние — нет
        $rows = [['id' => 1, 'tag' => 'MYSITE_ASPRO_SYNC', 'module' => 'main', 'message' => 'Обновлено решение Аспро'],
            ['id' => 2, 'tag' => Config::NOTIFY_TAG, 'module' => 'main', 'message' => 'Обновлено решение Аспро'],
            ['id' => 3, 'tag' => 'MAIL', 'module' => 'main', 'message' => 'Проверьте настройки почты']];
        $this->check(array_column(Bitrix::relevantNotices($rows), 'id') === [1], 'уведомления: чужое об обновлении — да, своё и постороннее — нет');
        // агенты: свой — точное имя; посторонние — как LIKE '%AsproMerge%' / '%aspro_merge%' без учёта регистра
        $ag = static fn(int $id, string $name) => ['id' => $id, 'name' => $name, 'module' => 'main', 'active' => 'Y', 'next' => ''];
        // имена — условные примеры для правила похожести (не настоящие имена прежних версий)
        $sp = Bitrix::splitAgents([$ag(1, Bitrix::AGENT), $ag(2, 'Foo\\AsproMerge::a();'), $ag(3, 'bar_aspro_merge_b();'),
            $ag(4, 'ASPRO-MERGE::c();'), $ag(5, 'asproMergeSite::agent();'), $ag(6, 'Foo\\Basket::d();'), $ag(7, 'AsproFoo::e();'),
            $ag(8, 'Aspro__Merge::f();')]);
        $this->check(array_column($sp['own'], 'id') === [1] && array_column($sp['foreign'], 'id') === [2, 3, 4, 5],
            'агенты: свой — только точное имя; посторонние — похожие на AsproMerge/aspro_merge (и другой регистр своего), чужие — нет');
        $this->check(str_contains(Session::HASH_FORMAT, 'git blob sha1'), 'формат хешей описан');
        $this->windowChecks();
        $this->rollbackChecks();
    }

    /**
     * Откат исправлений вендора отставшей копией (с 1.2.0; случаи проверки 1.7.20 → 1.7.21): автослияние сохраняет старый
     * код молча — verify помечает; подсказка у ajax-адреса только для POST; связанные изменения в разделе «Окно…».
     */
    private function rollbackChecks(): void
    {
        $cmd = 'merge.php';
        // летающая корзина: у вендора давно count((array)…), копия — без (array) (500 под PHP 8); вендор правил другое место
        $base = "<?\$n = count((array)\$_SESSION['LIST']);\n\$a = 1;\n?>\n<div class=\"fly\"></div>\n";
        $ours = "<?\$n = count(\$_SESSION['LIST']);\n\$a = 1;\n?>\n<div class=\"fly\"></div>\n";
        $theirs = "<?\$n = count((array)\$_SESSION['LIST']);\n\$a = 1;\n?>\n<div class=\"fly basket\"></div>\n";
        $m = Planner::merge3($base, $ours, $theirs);
        $notes = Verifier::rollbackNotes('fly/template.php', $base, $ours, $theirs, $m['text'], $cmd);
        $this->check($m['conflicts'] === 0 && str_contains($m['text'], "count(\$_SESSION['LIST'])") && count($notes) === 1
            && str_contains($notes[0], 'у нас убрано: приведение типов и проверка ввода ((array): в базе 1, у нас 0, в итоге 0, у вендора 1)')
            && str_contains($notes[0], 'merge.php diff fly/template.php --against=base'), 'verify: слияние молча оставило count() без (array) — ПОСМОТРЕТЬ');
        $this->check(Verifier::rollbackNotes('fly/template.php', $base, $ours, $theirs, $theirs, $cmd) === [], 'verify: в итоге вендорская строка — пометки нет');
        $this->check(Verifier::rollbackNotes('fly/template.php', $base, $ours, $theirs, $m['text'], $cmd, ['(array)']) === [], 'verify: уже помеченный признак не повторяется');
        // меню: копия без блока Secure logout (bitrix_sessid) — одна пометка на файл, признаки по меткам
        $blk = "<?if(strpos(\$i['LINK'], 'logout') && \$secure){\$i['LINK'] .= '&sessid='.bitrix_sessid();}?>\n";
        $base = "<ul>\n$blk<li><?=\$i['TEXT']?></li>\n<li>2</li>\n<li>3</li>\n</ul>\n";
        $ours = "<ul>\n<li><?=\$i['TEXT']?></li>\n<li>2</li>\n<li>3</li>\n</ul>\n";
        $theirs = "<ul>\n$blk<li><?=\$i['TEXT']?></li>\n<li>2</li>\n<li>3</li>\n</ul><!-- menu -->\n";
        $m = Planner::merge3($base, $ours, $theirs);
        $notes = Verifier::rollbackNotes('menu/template.php', $base, $ours, $theirs, $m['text'], $cmd);
        $this->check($m['conflicts'] === 0 && count($notes) === 1 && str_contains($notes[0], 'проверка сессии (sessid) (bitrix_sessid: в базе 1, у нас 0')
            && str_contains($notes[0], 'sessid: в базе 1'), 'verify: слияние молча убрало Secure logout — одна пометка');
        // быстрый просмотр: копия держит .live(), у вендора $(document).on()
        $base = "\$(document).on('click', '.tab', f);\nvar a = 1;\n";
        $ours = "\$('.tab').live('click', f);\nvar a = 1;\n";
        $theirs = "\$(document).on('click', '.tab', f);\nvar a = 2;\n";
        $m = Planner::merge3($base, $ours, $theirs);
        $notes = Verifier::rollbackNotes('fast_view/script.js', $base, $ours, $theirs, $m['text'], $cmd);
        $this->check(count($notes) === 1 && str_contains($notes[0], 'у нас добавлено: устаревший jQuery: .live() убран в jQuery 1.9'),
            'verify: слияние молча оставило .live() — ПОСМОТРЕТЬ');
        // настоящая доработка рядом с исправлениями вендора — не откат
        $base = "<a href=\"<?=htmlspecialcharsbx(\$u)?>\">\n";
        $ours = "<a class=\"site\" href=\"<?=htmlspecialcharsbx(\$u)?>\">\n";
        $this->check(Verifier::rollbackNotes('a.php', $base, $ours, $base, $ours, $cmd) === [], 'verify: доработка без отката признаков — пометки нет');
        // ajax-адрес только для POST: подсказка у 403/405, у страниц и без смены кода — нет
        $this->check(str_contains(Verifier::ajaxHint('/ajax/basket_fly.php', 500, 403), 'только POST')
            && Verifier::ajaxHint('/catalog/', 200, 403) === '' && Verifier::ajaxHint('/ajax/x.php', 403, 403) === ''
            && Verifier::ajaxHint('/ajax/x.php', 200, 500) === '', 'verify: подсказка про ajax только для POST — у ajax-адреса с 403/405');
        // раздел «Окно…»: связанные изменения вендора и смесь версий по парам файлов (с 1.2.1)
        $mk = static fn(string $key, string $act, ?string $needs, string $st, array $rel = []) => ['key' => $key, 'target' => $key, 'needs' => $needs,
            'cat' => 'merge', 'action' => $act, 'mode' => Area::COPY, 'status' => $st,
            'related' => array_map(static fn($k) => ['key' => $k, 'target' => $k, 'tokens' => ['unsignParameters']], $rel)];
        $d = ['entries' => [$mk('tpl/stores.php', 'restore', 'conflict', 'conflict', ['ajax/stores.php']), $mk('ajax/stores.php', 'take', null, 'applied'),
            $mk('tpl/a.php', 'restore', 'conflict', 'conflict', ['tpl/b.php']), $mk('tpl/b.php', 'restore', 'conflict', 'conflict', ['tpl/a.php'])],
            'ours' => [], 'opened' => 0, 'batches' => []];
        $lines = implode("\n", Report::windowLines($d, true));
        $this->check(str_contains($lines, 'связанные изменения вендора: `ajax/stores.php`') && str_contains($lines, '**Смесь версий в окне**')
            && str_contains($lines, '- `tpl/stores.php` — прежняя версия ↔ `ajax/stores.php` — новая версия вендора (общие имена: `unsignParameters`)')
            && str_contains($lines, 'Одна версия у обоих файлов (между собой согласованы): `tpl/a.php` ↔ `tpl/b.php`.')
            && substr_count($lines, 'tpl/a.php` ↔') === 1, 'report.md: смесь версий — пары с разными версиями и согласованные, без повторов');
        $d['entries'] = [$mk('tpl/a.php', 'restore', 'conflict', 'conflict')];
        $this->check(!str_contains(implode("\n", Report::windowLines($d, true)), 'Смесь версий'), 'report.md: без связанных изменений смеси версий нет');
        // автослияния со старым кодом: только слияние на месте (или ждёт apply) без решения поверх
        $rb = static fn(string $st, string $act = 'merge') => ['target' => "t-$st", 'status' => $st, 'action' => $act, 'rollback' => 't: старый код'];
        $this->check(array_column(Planner::rollbacks([$rb('applied'), $rb('auto'), $rb('done'), $rb('conflict'), $rb('applied', 'take'),
            ['target' => 'x', 'status' => 'applied', 'action' => 'merge']]), 'target') === ['t-applied', 't-auto'],
            'status: автослияния со старым кодом — применённые и ждущие apply, без решённых и записей без пометки');
    }

    /**
     * Окно между установкой и решением и проверка итога: что на месте до решения (наша прежняя версия / версия
     * вендора), подсказки «вендор исправил безопасность / формат», пометки verify по словам (объединённая строка,
     * висячий CR), строки целиком в report.md, правила веб-сервера для бэкапов.
     */
    private function windowChecks(): void
    {
        // подсказки об исправлениях вендора
        $h = Planner::fixHints("<input value=\"<?=\$x?>\">\n<a href=\"<?=\$u?>\">\n", "<input value=\"<?=htmlspecialcharsbx(\$x)?>\">\n<a href=\"<?=htmlspecialcharsbx(\$u)?>\">\n");
        $this->check(($h[0]['marker'] ?? '') === 'htmlspecialcharsbx' && $h[0]['added'] === 2 && count($h) === 1
            && str_contains(Planner::fixText($h), 'экранирование (htmlspecialcharsbx +2)'), 'подсказка: вендор добавил экранирование');
        $h = Planner::fixHints("<?\$p = urlencode(serialize(\$arParams));?>\n", "<?\$signer = new \\Bitrix\\Main\\Component\\ParameterSigner();\n\$p = \$signer->signParameters('x', \$arParams);?>\n");
        $this->check(array_column($h, 'marker') === ['ParameterSigner', 'signParameters'], 'подсказка: вендор перешёл на подпись параметров');
        $h = Planner::fixHints("<?=htmlspecialcharsbx(\$a)?>\n", "<?= htmlspecialcharsbx(\$a) ?>\n");
        $this->check($h === [], 'подсказка: перестановка пробелов вокруг уже бывшего экранирования — не исправление');
        $h = Planner::fixHints("a\n<?=\$_REQUEST['backurl']?>\n", "a\n<?=\$backurl?>\n");
        $this->check(array_column($h, 'marker') === ['backurl'], 'подсказка: вендор менял строки с backurl');
        $h = Planner::fixHints("<?=\$a?>\n", "<?=(int)\$a?>\n<?=bitrix_sessid_post()?>\n<?if(check_bitrix_sessid()){}?>\n");
        $this->check(array_column($h, 'marker') === ['check_bitrix_sessid', 'bitrix_sessid', '(int)'], 'подсказка: sessid и приведение типов, без двойного счёта');
        // пометки verify: по словам, строки целиком
        $base = "<a class=\"x\" href=\"<?=\$u?>\">\n<b>\n";
        $ours = "<a class=\"x site\" href=\"<?=\$u?>\">\n<b>\n";
        $theirs = "<a class=\"x\" href=\"<?=htmlspecialcharsbx(\$u)?>\">\n<b>\n";
        $both = "<a class=\"x site\" href=\"<?=htmlspecialcharsbx(\$u)?>\">\n<b>\n";
        $this->check(Verifier::lostChanges($base, $ours, $both) === [] && Verifier::lostChanges($base, $theirs, $both) === [],
            'verify: строка, где правка вендора объединена с нашей вставкой, не помечается');
        $this->check(Verifier::lostChanges($base, $ours, $theirs) === ['<a class="x site" href="<?=$u?>">'], 'verify: потерянная доработка — строка целиком');
        $this->check(Verifier::lostChanges($base, $theirs, $ours) === ['<a class="x" href="<?=htmlspecialcharsbx($u)?>">'], 'verify: потерянное исправление вендора — строка целиком');
        $this->check(Verifier::lostChanges("a\n<?}?>", "a\r\n<?}?>\r", "a\n<?}?>") === [] && Verifier::lostChanges("a\nb\n", "a\r\nb\r\n", "a\nb") === [],
            'verify: висячий CR в конце строки или файла — различие переводов строк, а не потеря строки');
        $long = str_repeat('x', 300);
        $this->check(Verifier::lostChanges("a\n", "a\n\$v = '$long';\n", "a\n") === ["\$v = '$long';"], 'verify: длинная строка не обрезается');
        $md = Report::noteMd("f.php: изменение не нашлось:\n    <a href=\"x\">\n    <b>");
        $this->check($md[0] === '- f.php: изменение не нашлось:' && in_array('  ~~~text', $md, true) && in_array('  <a href="x">', $md, true), 'report.md: строки пометки — блоком кода, целиком');
        // что лежит на месте до решения
        $mk = static fn(string $act, string $st, string $mode, string $cat = 'merge') => ['target' => "t-$act-$mode", 'status' => $st, 'action' => $act,
            'mode' => $mode, 'cat' => $cat, 'h' => ['base' => 'b', 'ours' => 'o', 'theirs' => 't', 'current' => 'c'],
            'vendor_fix' => ['text' => 'экранирование (htmlspecialcharsbx +1)']];
        $w = Planner::window([$mk('restore', 'conflict', Area::INPLACE), $mk('restore', 'conflict', Area::COPY), $mk('take', 'conflict', Area::INPLACE),
            $mk('merge', 'applied', Area::INPLACE), $mk('none', 'ok', Area::INPLACE, 'vendor-only')]);
        $this->check(count($w['held_ours']) === 2 && count($w['held_theirs']) === 1 && count($w['written']) === 1 && count($w['updater']) === 1,
            'окно до решения: раздельный счёт (записано, обновлятор, наша прежняя, версия вендора)');
        $txt = implode("\n", Planner::windowText($w));
        $this->check(str_contains($txt, 'Возвращена наша прежняя версия до решения: 1') && str_contains($txt, 'НЕ действуют')
            && str_contains($txt, 'В копии до решения прежняя версия: 1') && str_contains($txt, 'conflict_keep = theirs')
            && str_contains($txt, 'исправил безопасность'), 'окно до решения: прямо сказано, что изменения вендора не действуют');
        $this->check(str_contains(Planner::outcome($mk('restore', 'conflict', Area::INPLACE)), 'наша прежняя версия (изменения вендора в файле не действуют)')
            && str_contains(Planner::outcome($mk('take', 'conflict', Area::INPLACE)), 'версия вендора (нашей доработки в файле нет)')
            && str_contains(Planner::outcome($mk('restore', 'conflict', Area::COPY)), 'в копии прежняя версия'), 'итог файла на разбор — что на месте и что не действует');
        // правила веб-сервера для бэкапов обновлятора
        $rules = implode("\n", Updater::denyRules());
        $re = '~/_[^/]+(\.back[0-9.]+|_back[0-9.]+\.zip)$~';
        $this->check(str_contains($rules, 'location ~ /_[^/]+(\.back[0-9.]+|_back[0-9.]+\.zip)$ { deny all; }') && str_contains($rules, 'FilesMatch')
            && preg_match($re, '/ajax/_show_basket_popup.php.back1.7.20') && preg_match($re, '/bitrix/templates/a/_js_back1.7.20.zip')
            && !preg_match($re, '/ajax/show_basket_popup.php') && !preg_match($re, '/upload/_photo.jpg'), 'правила nginx/Apache закрывают _*.back* и _*_back*.zip');
    }

    /** PHP CLI для php -l в веб-запросе: рядом с PHP сайта (php-cgi → php), версия — та же */
    private function phpCliChecks(Result $r): void
    {
        $win = DIRECTORY_SEPARATOR === '\\';
        $tmp = Util::norm(sys_get_temp_dir()) . '/am-phpcli-' . getmypid() . '-' . bin2hex(random_bytes(3));
        Util::mkdir("$tmp/sbin");
        Util::mkdir("$tmp/bin");
        $cgi = $win ? "$tmp/sbin/php-cgi.exe" : "$tmp/sbin/php-fpm8.4";
        $cli = $win ? "$tmp/sbin/php.exe" : "$tmp/bin/php8.4";
        file_put_contents($cgi, '');
        file_put_contents($cli, '');
        @chmod($cli, 0755);
        @chmod($cgi, 0755);
        $c = Util::phpCliCandidates($cgi, '', '', '8.4', $win);
        $this->check(($c[0] ?? null) === $cli, 'PHP CLI ищется рядом с PHP сайта (' . basename($cgi) . ' → ' . basename($cli) . ')');
        $this->check(!array_filter($c, static fn($x) => str_contains(strtolower(basename($x)), 'cgi') || str_contains(strtolower(basename($x)), 'fpm')),
            'php-cgi и php-fpm не считаются PHP CLI');
        Util::rrmdir($tmp);
        if (!Util::canRun() || PHP_BINARY === '') {
            return;
        }
        // как в веб-запросе: PHP сайта — php-cgi рядом с этим PHP CLI
        $web = Util::norm(dirname(PHP_BINARY)) . '/php-cgi' . ($win ? '.exe' : '');
        $i = Util::phpCliInfo(null, 'cgi-fcgi', $web);
        $this->check($i['bin'] !== null && Util::phpCliVersion($i['bin']) === PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
            'в веб-запросе (php-cgi) найден PHP CLI той же версии: ' . $i['how']);
        $r->line('PHP CLI для веб-запроса: ' . $i['how']);
    }

    private function archives(Result $r): void
    {
        $tmp = sys_get_temp_dir() . '/am-selftest-' . getmypid() . '-' . bin2hex(random_bytes(3));
        Util::mkdir($tmp);
        $data = ['W/a.php' => "<?php echo 1;\n", 'WP/ajax/b.php' => str_repeat("строка\n", 500), 'C/x/.description.php' => ''];
        $formats = [];
        foreach (['zip' => Archive::canZip(), 'tar' => Archive::canPhar()] as $fmt => $can) {
            if (!$can) {
                continue;
            }
            $file = Archive::write("$tmp/test-$fmt/1.7.20/etalon", $data, $fmt);
            $a = Archive::open("$tmp/test-$fmt/1.7.20/etalon");
            $okAll = $a !== null;
            foreach ($data as $k => $v) {
                $okAll = $okAll && $a->get($k) === $v;
            }
            $okAll = $okAll && count(array_intersect(array_keys($data), $a->names())) === count($data);
            $a?->close();
            $this->check($okAll && str_ends_with($file, ".$fmt"), "архив $fmt: запись и чтение");
            $formats[] = $fmt;
        }
        $this->check($formats !== [], 'нет ни ext-zip, ни ext-phar — снимки не создать');
        Util::rrmdir($tmp);
        $r->line('Архивы: ' . ($formats ? implode(', ', $formats) : 'НЕТ'));
    }

    private function lintChecks(Result $r): void
    {
        $tmp = sys_get_temp_dir() . '/am-lint-' . getmypid();
        $methods = [];
        foreach ([false, true] as $internal) {
            [$e1, $m] = Util::lint("<?php\necho 1;\n?><div><?=\$x?></div>\n", $tmp, null, $internal);
            [$e2] = Util::lint("<?php\nif (\$a) {\n echo 1;\n", $tmp, null, $internal);
            $this->check($e1 === null && $e2 !== null, "проверка синтаксиса ($m)");
            $methods[] = $m;
        }
        // ошибку компиляции видит только php -l — поэтому без него результат слияния PHP на сайт не пишется
        $redeclare = "<?php function site_x() { return 1; }\necho 1;\nfunction site_x() { return 2; }\n";
        if (Util::canPhpL()) {
            [$e3, $m3] = Util::lint($redeclare, $tmp);
            $this->check($m3 === 'php -l' && $e3 !== null && str_contains($e3, 'redeclare'), 'php -l ловит «Cannot redeclare» (ошибку компиляции)');
        }
        [$e4] = Util::lint($redeclare, $tmp, null, true);
        $this->check($e4 === null, 'разбор token_get_all ошибок компиляции не видит (ожидаемо — на нём результат слияния не пишется)');
        Util::rrmdir($tmp);
        $r->line('Проверка синтаксиса: ' . implode(', ', array_unique($methods)) . (Util::canPhpL() ? '' : ' (PHP CLI нет — слияния PHP запишет только консоль с php -l)'));
    }

    private function environment(Result $r, string $root, array $opt): void
    {
        $this->check(PHP_VERSION_ID >= 80100, 'нужен PHP 8.1+');
        $r->line('PHP ' . PHP_VERSION . ', proc_open: ' . (Util::canRun() ? 'есть' : 'нет (php -l заменяется token_get_all)')
            . ', zip: ' . (Archive::canZip() ? 'есть' : 'нет') . ', phar: ' . (Archive::canPhar() ? 'есть' : 'нет'));
        if (!is_dir(Util::norm($root) . '/bitrix')) {
            $r->line('Сайт: не проверялся (нет папки bitrix в ' . $root . ')');
            return;
        }
        try {
            $c = Config::load($root, $opt);
            $v = $c->version();
            $this->check($v !== null, 'не прочитана версия модуля');
            $r->line("Сайт: {$c->module} $v, шаблон {$c->template}; эталон W: " . (is_dir($c->abs($c->etalon['W'])) ? 'есть' : 'НЕТ')
                . ', WP: ' . (is_dir($c->abs($c->etalon['WP'])) ? 'есть' : 'нет') . ', C: ' . (is_dir($c->abs($c->etalon['C'])) ? 'есть' : 'нет'));
            $store = $c->store();
            $parent = $store;
            while (!is_dir($parent) && dirname($parent) !== $parent) {
                $parent = dirname($parent);
            }
            $r->line("Хранилище: $store" . (is_dir($store) ? (is_writable($store) ? ' (запись есть)' : ' (НЕТ ЗАПИСИ)') : ' (будет создано' . (is_writable($parent) ? ')' : '; над корнем писать нельзя — будет /bitrix/backup/aspro-merge-…)')));
            if (is_dir($store)) {
                $this->check(is_writable($store), 'в хранилище нельзя писать');
            }
        } catch (MergeException $e) {
            $this->fail[] = 'настройки сайта: ' . $e->getMessage();
        }
    }
}
