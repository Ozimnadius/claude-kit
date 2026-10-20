<?php
/**
 * Проверка после сверки: что не решено; записанные файлы на месте и не менялись; нет маркеров конфликта и BOM;
 * php -l; изменения доработки и вендора на месте (эвристика по словам — «посмотреть»); файлы с версией вендора
 * равны новому эталону, решения — на месте; --scan — маркеры по всем рабочим папкам; --urls — страницы сайта (коды, ошибки PHP,
 * сравнение со страницами «до» из снимка).
 *
 * «ПОСМОТРЕТЬ» — не ошибка, а место для проверки глазами (код выхода от них не меняется): изменение доработки или
 * вендора не нашлось в итоговом файле (строки — целиком), признаков исправления вендора в итоге меньше, наша версия
 * откатывает исправления вендора, бывшие уже до обновления (копия отстала), файл не равен
 * эталону или решению, файл изменили после записи инструмента (или после завершения сверки), размер
 * страницы изменился больше чем на 20%. Они сохраняются в session.json (verify.notes) и report.md.
 * $readOnly — завершённый сеанс: ничего не записывается (ни pages-after.json, ни что-либо ещё).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Verifier
{
    /** Пометки «ПОСМОТРЕТЬ» */
    public array $notes = [];
    /** Итог проверки страниц: requested, checked, bad, base_url, why (почему не проверены) */
    public array $pagesInfo = ['requested' => false, 'checked' => 0, 'bad' => 0, 'base_url' => null];

    public function __construct(private Config $c, private Tool $tool, private ?Session $s, private bool $readOnly = false)
    {
    }

    public function run(Result $r, bool $urls, bool $scan): void
    {
        $s = $this->s;
        $c = $this->c;
        $r->line("Сеанс {$s->id()} ({$s->d['from']} → {$s->d['to']}), " . ($s->isOpen() ? 'открыт' : 'завершён'));
        $notes = &$this->notes;
        // 1. нерешённое
        foreach ($s->d['entries'] as $e) {
            if (in_array($e['status'], ['conflict', 'review', 'resolved', 'error', 'auto'], true)) {
                $r->problem("не завершено [" . (Tool::STATUS[$e['status']] ?? $e['status']) . "]: {$e['target']} — {$e['about']}");
            }
        }
        // 2. записанные инструментом файлы
        $last = [];
        foreach ($s->d['batches'] as $b) {
            foreach ($b['writes'] as $w) {
                if (!empty($w['done']) && empty($w['reverted'])) {
                    $last[$w['target']] = $w;
                }
            }
        }
        $byTarget = [];
        foreach ($s->d['entries'] as $e) {
            $byTarget[$e['target']] = $e;
        }
        $rows = [];
        $lintN = 0;
        $method = null;
        foreach ($last as $t => $w) {
            $abs = $c->abs($t);
            $cur = Util::read($abs);
            $res = [];
            if ($w['after'] === null) {
                if ($cur !== null) {
                    $r->problem("$t: должен быть удалён, но есть");
                }
                $rows[] = [$t, 'удалён', $cur === null ? 'ок' : 'ОШИБКА'];
                continue;
            }
            if ($cur === null) {
                $r->problem("$t: записанного файла нет");
                continue;
            }
            if (Util::gitHash($cur) !== $w['after']) {
                $notes[] = "$t: изменён после записи инструмента (правили вручную или следующий шаг обновления?)";
                $res[] = 'изменён после записи';
            }
            if (Util::hasMarkers($cur)) {
                $r->problem("$t: маркеры конфликта");
                $res[] = 'МАРКЕРЫ';
            }
            if (str_ends_with($t, '.php') && Util::isText($cur)) {
                $e = $byTarget[$t] ?? null;
                $theirs = $e ? $s->blob($e['h']['theirs']) : null;
                if (Util::hasBom($cur) && !($theirs !== null && Util::hasBom($theirs))) {
                    $r->problem("$t: BOM в начале PHP-файла");
                    $res[] = 'BOM';
                }
                [$err, $method] = Util::lint($cur, $s->dir . '/tmp', $c->phpCli);
                $lintN++;
                if ($err !== null) {
                    $r->problem("$t: $err");
                    $res[] = 'php -l ОШИБКА';
                }
            }
            $rows[] = [$t, $w['why'], $res ? implode('; ', $res) : 'ок'];
        }
        // 3. смысл слияний: изменения обеих сторон на месте (по словам, а не строкам целиком)
        foreach ($s->d['entries'] as $e) {
            $merged = ($e['status'] === 'applied' && $e['action'] === 'merge') || $e['status'] === 'done';
            if (!$merged) {
                continue;
            }
            $b = $s->blob($e['h']['base']);
            $o = $s->blob($e['h']['ours']);
            $th = $s->blob($e['h']['theirs']);
            $cur = Util::read($c->abs($e['target']));
            if ($b === null || $o === null || $th === null || $cur === null || !Util::isText($cur) || !Util::isText($b) || !Util::isText($o) || !Util::isText($th)) {
                continue;
            }
            $lostO = self::lostChanges($b, $o, $cur);
            $lostT = self::lostChanges($b, $th, $cur);
            if ($lostO) {
                $notes[] = self::linesNote("{$e['target']}: изменение нашей доработки не нашлось в итоге (строк: " . count($lostO)
                    . ') — проверить, что смысл сохранён; строки нашей версии целиком', $lostO, $e['target']);
            }
            if ($lostT) {
                $notes[] = self::linesNote("{$e['target']}: изменение вендора не нашлось в итоге (строк: " . count($lostT)
                    . ') — проверить, что исправление вендора не потеряно; строки версии вендора целиком', $lostT, $e['target']);
            }
            // признаки исправлений вендора (экранирование, подпись параметров, sessid…): в итоге их не меньше, чем у вендора
            $noted = [];
            foreach (Planner::fixHints($b, $th) as $hint) {
                if ($hint['added'] <= $hint['removed']) {
                    continue;
                }
                $re = Planner::FIX_MARKERS[$hint['marker']][1];
                $inFinal = preg_match_all($re, Util::stripBom(am_to_lf($cur)));
                $inTheirs = preg_match_all($re, Util::stripBom(am_to_lf($th)));
                if ($inFinal < $inTheirs) {
                    $noted[] = $hint['marker'];
                    $notes[] = "{$e['target']}: {$hint['marker']} в итоге $inFinal, у вендора $inTheirs ({$hint['label']}) — проверить, не потеряно ли "
                        . "исправление вендора (подсказка по словам; сравнить: {$this->tool->cmdName()} diff {$e['target']})";
                }
            }
            // наша версия откатывает то, что у вендора было уже до обновления (копия отстала), — слияние это сохраняет молча
            array_push($notes, ...self::rollbackNotes($e['target'], $b, $o, $th, $cur, $this->tool->cmdName(), $noted));
        }
        // 3б. языковые фразы итога: шаблон вендора мог начать брать фразы, которых нет в нашем языковом файле
        foreach (array_keys($last) as $t) {
            $e = $byTarget[$t] ?? null;
            if ($e && $last[$t]['after'] !== null && str_ends_with($t, '.php') && ($a = $c->area((string)$e['area']))) {
                $miss = $this->missingPhrases($a, (string)$e['rel'], (string)Util::read($c->abs($t)));
                if ($miss) {
                    $notes[] = "$t: фраз нет в языковых файлах на сайте, а у вендора они есть — на странице будут пустые подписи: "
                        . implode(', ', array_map(static fn($k, $f) => "$k (взять из $f)", array_keys($miss), $miss))
                        . ' (фразы с именем из переменной так не находятся — проверьте страницу)';
                }
            }
        }
        if ($rows) {
            $r->line('Записанные инструментом файлы:');
            array_push($r->lines, ...Result::table($rows, ['Файл', 'Как записан', 'Проверка']));
        }
        $r->line(sprintf('Записано файлов: %d; проверено синтаксисом: %d%s', count($last), $lintN, $method ? " ($method)" : ''));
        // 4. файлы с версией вендора равны новому эталону; записанные решения на месте; завершённый сеанс — не менялись ли
        $this->compareFinal($r);
        // 5. маркеры по всем рабочим папкам
        if ($scan) {
            $found = 0;
            $checked = 0;
            foreach ($c->areas() as $a) {
                $files = $a->kind === 'pub'
                    ? FileSet::listed($c->abs($a->work()), Etalon::current($c, $a)->rels())->abs
                    : Util::walk($c->abs($a->work()));
                foreach ($files as $rel => $abs) {
                    if (!preg_match('/\.(php|js|css|html?|less|scss|tpl|json|xml)$/i', $rel)) {
                        continue;
                    }
                    $checked++;
                    $txt = Util::read($abs);
                    if ($txt !== null && Util::hasMarkers($txt)) {
                        $r->problem($a->target($rel) . ': маркеры конфликта');
                        $found++;
                    }
                }
            }
            $r->line("Поиск маркеров конфликта по рабочим папкам: проверено $checked файлов, найдено $found");
        }
        if ($urls) {
            $this->pages($r);
        }
        unset($notes);
        if ($this->notes) {
            $r->line('ПОСМОТРЕТЬ — не ошибки, а места для проверки глазами (изменение доработки или вендора не нашлось в итоге, '
                . 'наша версия откатывает исправления вендора, файл изменили после записи, размер страницы заметно изменился):');
            foreach ($this->notes as $n) {
                $r->line("ПОСМОТРЕТЬ: $n");
            }
        }
        $r->data['notes'] = $this->notes;
        $r->data['pages'] = $this->pagesInfo;
        $pg = $this->pagesInfo['checked'] ? "страниц проверено: {$this->pagesInfo['checked']}"
            : ($this->pagesInfo['requested'] ? 'страницы не проверены' : 'страницы не проверялись (verify --urls)');
        $r->line(($r->problems ? 'Итог: есть проблемы' : ($this->notes ? 'Итог: ошибок нет, есть что посмотреть (' . count($this->notes) . ')' : 'Итог: всё в порядке'))
            . "; $pg");
    }

    /**
     * Фразы, которые итог берёт через GetMessage / Loc::getMessage / BX.message, а на сайте их нет ни в языковом файле
     * рядом (<папка файла>/lang/<язык>/<файл>), ни в общем lang/<язык>/header.php шаблона сайта, — хотя в тех же файлах
     * вендора они есть. [фраза => языковой файл вендора, где она есть]. Только области шаблона и компонентов.
     */
    private function missingPhrases(Area $a, string $rel, string $code): array
    {
        if ($a->kind === 'pub' || $code === '') {
            return [];
        }
        preg_match_all('~(?:GetMessage|Loc::getMessage|BX\.message)\(\s*[\'"]([A-Za-z0-9_]+)[\'"]~', $code, $m);
        $used = array_unique($m[1]);
        if (!$used) {
            return [];
        }
        $lang = $this->c->lang;
        $files = [(dirname($rel) === '.' ? '' : dirname($rel) . '/') . "lang/$lang/" . basename($rel)];
        if ($a->kind === 'tpl') {
            $files[] = "lang/$lang/header.php";
        }
        $keys = static function (?string $php): array {
            preg_match_all('~\$MESS\s*\[\s*[\'"]([^\'"]+)[\'"]\s*\]~', (string)$php, $mm);
            return array_flip($mm[1]);
        };
        $have = [];
        $vendor = [];
        $E1 = Etalon::current($this->c, $a);
        foreach ($files as $f) {
            $have += $keys(Util::read($this->c->abs($a->target($f))));
            // у вендора: установленная папка (режим «копия») или новый эталон
            $vc = $a->mode === Area::COPY ? Util::read($this->c->abs(($a->installed === '' ? '' : $a->installed . '/') . $f)) : $E1->content($f);
            foreach (array_keys($keys($vc)) as $k) {
                $vendor[$k] ??= ($a->mode === Area::COPY ? ($a->installed === '' ? '' : $a->installed . '/') : 'эталон: ') . $f;
            }
        }
        $out = [];
        foreach ($used as $k) {
            if (!isset($have[$k]) && isset($vendor[$k])) {
                $out[$k] = $vendor[$k];
            }
        }
        return $out;
    }

    /**
     * Сверка итога по записям плана:
     *  - файлы, где итог — версия вендора (взята инструментом или записана обновлятором в недоработанный файл), равны
     *    новому эталону вендора в модуле (без учёта переводов строк); не равны — «ПОСМОТРЕТЬ» (точечная правка
     *    обновлятора, подстановки мастера), а у взятых инструментом и не равных «их» версии — проблема;
     *  - записанные решения на месте (файл равен решению);
     *  - завершённый сеанс: файлы с тех пор не менялись (иначе «ПОСМОТРЕТЬ»: правили после сверки).
     * Эталон сверяется, только если модуль той же версии, что в сеансе.
     */
    private function compareFinal(Result $r): void
    {
        $s = $this->s;
        $c = $this->c;
        $sameVer = (string)$c->version() === (string)$s->d['to'];
        $etN = 0;
        $etBad = 0;
        $resN = 0;
        $resBad = 0;
        $drift = 0;
        foreach ($s->d['entries'] as $e) {
            $abs = $c->abs($e['target']);
            $curH = is_file($abs) ? Util::gitHashFile($abs) : null;
            $act = (string)$e['action'];
            $st = (string)$e['status'];
            if (in_array($act, ['take', 'copy'], true) && $st === 'applied' && $curH !== $e['h']['theirs'] && !$this->readOnly) {
                $r->problem("{$e['target']}: не совпадает с версией вендора, которую записал инструмент");
            }
            if ($st === 'done') {
                $resN++;
                $want = ($e['resolution']['h'] ?? '-') === '-' ? null : $e['resolution']['h'];
                if ($curH !== $want) {
                    $resBad++;
                    $this->notes[] = "{$e['target']}: файл не равен записанному решению" . ($this->readOnly ? ' — его изменили после завершения сверки' : '')
                        . " (сравнить: {$this->tool->cmdName()} diff {$e['target']})";
                }
            } elseif ($this->readOnly && $sameVer && $e['cat'] !== 'not-applied' && $curH !== $e['h']['current']) {
                $drift++;
                $this->notes[] = "{$e['target']}: изменён после завершения сверки (было " . ($e['h']['current'] ? substr((string)$e['h']['current'], 0, 10) : 'нет файла')
                    . ', сейчас ' . ($curH ? substr($curH, 0, 10) : 'нет файла') . ')';
            }
            $vendorFinal = (in_array($act, ['take', 'copy'], true) && in_array($st, ['applied', 'ok'], true))
                || ($act === 'none' && $st === 'ok' && ($e['mode'] ?? '') === Area::INPLACE && in_array($e['cat'], ['vendor-only', 'new-file', 'ours-ws'], true));
            if (!$vendorFinal || !$sameVer || $curH === null) {
                continue;
            }
            $a = $c->area((string)$e['area']);
            $et = $a ? Etalon::current($c, $a)->hash((string)$e['rel']) : null;
            if ($et === null) {
                continue;
            }
            $etN++;
            $cur = Util::hashesFile($abs);
            if ($cur === null || $cur['n'] !== $et['n']) {
                $etBad++;
                $this->notes[] = "{$e['target']}: итог — версия вендора, но файл не равен новому эталону в модуле ({$c->etalon[$a->etalonKey]}/{$a->etalonPrefix}{$e['rel']}) — "
                    . 'точечная правка обновлятора или подстановка мастера? Сравнить: ' . $this->tool->cmdName() . " diff {$e['target']}";
            }
        }
        $r->line("Сверка итога: с версией вендора $etN файлов — равны новому эталону " . ($etN - $etBad)
            . ($sameVer ? '' : ' (эталон не сверялся: модуль уже версии ' . $c->version() . ')')
            . "; записанных решений $resN — на месте " . ($resN - $resBad)
            . ($this->readOnly ? ($sameVer ? "; изменено после завершения сверки: $drift" : '') : ''));
    }

    /**
     * Строки стороны $side (наша версия или версия вендора), изменение в которых относительно $base не нашлось в итоге
     * $final. Сравнение — по словам и знакам (лексемам) участка: если в итоге есть и наша вставка, и правка вендора в той
     * же строке (строки объединены), строка не потеряна; пробелы и переводы строк (в том числе висячий CR в конце
     * строки или файла) не важны. Каждый добавленный отрезок ищется в итоге вместе с соседней лексемой слева или справа
     * (длинный — и без соседей). Возвращает строки $side целиком, по порядку.
     */
    public static function lostChanges(string $base, string $side, string $final): array
    {
        $norm = static fn(string $x) => (string)preg_replace("~\r+(?=\n|$)~", '', Util::stripBom(am_to_lf($x)));
        $bl = am_split($norm($base));
        $xl = am_split($norm($side));
        if (!$xl) {
            return [];
        }
        $T = [];
        $L = [];
        $first = [];
        foreach ($xl as $i => $line) {
            $first[$i] = count($T);
            foreach (self::tokens($line) as $t) {
                $T[] = $t;
                $L[] = $i;
            }
        }
        $first[count($xl)] = count($T);
        $bTok = [];
        $bFirst = [];
        foreach ($bl as $i => $line) {
            $bFirst[$i] = count($bTok);
            array_push($bTok, ...self::tokens($line));
        }
        $bFirst[count($bl)] = count($bTok);
        // строки стороны → строки итога (по построчному diff): отрезок ищется только в соответствующем участке итога
        // (между общими строками вокруг изменённого участка, плюс строка с каждой стороны), а не по всему файлу —
        // иначе короткая правка вендора вроде «htmlspecialcharsbx(» «нашлась» бы в другой строке
        $fl = am_split($norm($final));
        $map = [];
        $pi = 0;
        $pj = 0;
        foreach (am_xdiff($xl, $fl) as [$a1, $a2, $n1, $n2]) {
            while ($pi < $a1) {
                $map[$pi++] = $pj++;
            }
            $pi = $a1 + $n1;
            $pj = $a2 + $n2;
        }
        while ($pi < count($xl)) {
            $map[$pi++] = $pj++;
        }
        $lost = [];
        foreach (am_xdiff($bl, $xl) as [$i1, $i2, $c1, $c2]) {
            if ($c2 === 0) {
                continue;
            }
            for ($lo = $i2 - 1; $lo >= 0 && !isset($map[$lo]); $lo--) {
            }
            for ($hi = $i2 + $c2; $hi < count($xl) && !isset($map[$hi]); $hi++) {
            }
            $f0 = max(0, $lo >= 0 ? $map[$lo] : 0);
            $f1 = min(count($fl) - 1, $hi < count($xl) ? $map[$hi] : count($fl) - 1);
            $F = "\x1f" . implode("\x1f", self::tokens(implode('', array_slice($fl, $f0, max(0, $f1 - $f0 + 1))))) . "\x1f";
            $has = static fn(array $toks) => $toks && str_contains($F, "\x1f" . implode("\x1f", $toks) . "\x1f");
            $xs = $first[$i2];
            $xt = array_slice($T, $xs, $first[$i2 + $c2] - $xs);
            $bt = array_slice($bTok, $bFirst[$i1], $bFirst[$i1 + $c1] - $bFirst[$i1]);
            if (!$xt) {
                continue;
            }
            $common = self::lcsIndexes($bt, $xt);
            $segs = [];
            foreach ($xt as $j => $_) {
                if (isset($common[$j])) {
                    continue;
                }
                $g = $xs + $j;
                $k = count($segs) - 1;
                if ($k >= 0 && $segs[$k][1] === $g - 1 && $L[$segs[$k][0]] === $L[$g]) {
                    $segs[$k][1] = $g;
                } else {
                    $segs[] = [$g, $g];
                }
            }
            foreach ($segs as [$from, $to]) {
                $seg = array_slice($T, $from, $to - $from + 1);
                $left = $from > 0 ? [$T[$from - 1]] : [];
                $right = $to + 1 < count($T) ? [$T[$to + 1]] : [];
                $found = ($left && $has(array_merge($left, $seg))) || ($right && $has(array_merge($seg, $right)))
                    || ((count($seg) >= 6 || (!$left && !$right)) && $has($seg));
                if (!$found) {
                    $lost[$L[$from]] = rtrim($xl[$L[$from]], "\n");
                }
            }
        }
        ksort($lost);
        return array_values($lost);
    }

    /** Лексемы строки: слова (с $ у переменных) и отдельные знаки; пробелы не считаются */
    public static function tokens(string $s): array
    {
        if (@preg_match_all('~\$?[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]~u', $s, $m) === false || preg_last_error() !== PREG_NO_ERROR) {
            preg_match_all('~\$?\w+|[^\s\w]~', $s, $m); // не UTF-8
        }
        return $m[0];
    }

    /** Номера лексем $b, входящих в наибольшую общую подпоследовательность с $a (ключи массива) */
    private static function lcsIndexes(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        if ($n === 0 || $m === 0) {
            return [];
        }
        if ($n * $m > 400000) {
            // большой участок — построчный алгоритм xdiff по лексемам (может счесть частые знаки изменёнными)
            $chg = [];
            foreach (am_xdiff($a, $b) as [, $j, , $cj]) {
                for ($k = 0; $k < $cj; $k++) {
                    $chg[$j + $k] = true;
                }
            }
            return array_diff_key(array_fill(0, $m, true), $chg);
        }
        $prev = array_fill(0, $m + 1, 0);
        $dp = [];
        for ($i = 1; $i <= $n; $i++) {
            $cur = [0];
            $ai = $a[$i - 1];
            for ($j = 1; $j <= $m; $j++) {
                $cur[$j] = $ai === $b[$j - 1] ? $prev[$j - 1] + 1 : max($prev[$j], $cur[$j - 1]);
            }
            $dp[$i] = $cur;
            $prev = $cur;
        }
        $out = [];
        for ($i = $n, $j = $m; $i > 0 && $j > 0;) {
            if ($a[$i - 1] === $b[$j - 1]) {
                $out[$j - 1] = true;
                $i--;
                $j--;
            } elseif (($dp[$i - 1][$j] ?? 0) >= $dp[$i][$j - 1]) {
                $i--;
            } else {
                $j--;
            }
        }
        return $out;
    }

    /**
     * Откат исправлений вендора в слиянии (с 1.2.0): признак из Planner::FIX_MARKERS был уже в базе, наша версия его
     * убрала, и в итоге его меньше, чем у вендора (count((array)…) → count(…), убранный блок Secure logout с bitrix_sessid,
     * htmlspecialcharsbx); или наша добавила старый код из Planner::OLD_CODE (.live() на jQuery 2), и в итоге его больше,
     * чем у вендора. Вендор эту строку в обновлении не менял, правкой она числится у нас — автослияние сохраняет её
     * молча. Пометка на файл, признаки — по меткам; $skip — признаки, уже помеченные как «потерянное исправление вендора».
     */
    public static function rollbackNotes(string $target, string $base, string $ours, string $theirs, string $final, string $cmd, array $skip = []): array
    {
        $n = static fn(string $x) => Util::stripBom(am_to_lf($x));
        $txt = ['base' => $n($base), 'ours' => $n($ours), 'theirs' => $n($theirs), 'final' => $n($final)];
        $cnt = static fn(string $re) => array_map(static fn($t) => preg_match_all($re, $t), $txt);
        $by = [];
        foreach (Planner::FIX_MARKERS as $marker => [$label, $re]) {
            $c = $cnt($re);
            if (!in_array($marker, $skip, true) && $c['ours'] < $c['base'] && $c['final'] < $c['theirs']) {
                $by['убрано'][$label][] = "$marker: в базе {$c['base']}, у нас {$c['ours']}, в итоге {$c['final']}, у вендора {$c['theirs']}";
            }
        }
        foreach (Planner::OLD_CODE as $marker => [$label, $re]) {
            $c = $cnt($re);
            if ($c['ours'] > $c['base'] && $c['final'] > $c['theirs']) {
                $by['добавлено'][$label][] = "$marker: в базе {$c['base']}, у нас {$c['ours']}, в итоге {$c['final']}, у вендора {$c['theirs']}";
            }
        }
        if (!$by) {
            return [];
        }
        $parts = [];
        foreach ($by as $verb => $labels) {
            $parts[] = "у нас $verb: " . implode('; ', array_map(static fn($l, $m) => "$l (" . implode(', ', $m) . ')', array_keys($labels), $labels));
        }
        return ["$target: наша версия откатывает исправления вендора, бывшие до обновления — " . implode('; ', $parts)
            . ' — похоже на старый код вендора (копия отстала), а не на доработку: '
            . "слияние оставило его в итоге; сравнить: $cmd diff $target --against=base"];
    }

    /** Пометка со строками целиком: первая строка — что не так, дальше строки файла с отступом 4 пробела (до 40) */
    private static function linesNote(string $head, array $lines, string $target): string
    {
        $max = 40;
        $out = $head . ':';
        foreach (array_slice($lines, 0, $max) as $l) {
            $out .= "\n    " . $l;
        }
        if (count($lines) > $max) {
            $out .= "\n    … ещё " . (count($lines) - $max) . " — полностью: merge.php diff $target";
        }
        return $out;
    }

    /** Страницы сайта: коды, признаки ошибок, сравнение со снимком «до». Не удалось проверить — это проблема (код 2). */
    public function pages(Result $r): void
    {
        $this->pagesInfo['requested'] = true;
        $this->pagesInfo['base_url'] = $this->c->baseUrl;
        $why = $this->tool->pagesUnavailable();
        if ($why !== null) {
            $this->pagesInfo['why'] = $why;
            $r->problem("страницы не проверены: $why");
            return;
        }
        $pages = Verifier::fetch($this->c->urls, (string)$this->c->baseUrl);
        $this->pagesInfo['checked'] = count($pages);
        if (!$pages) {
            return;
        }
        $before = [];
        if ($this->s && !empty($this->s->d['base']['version'])) {
            $before = Snapshot::load($this->c, $this->s->d['base']['version'])?->pages() ?? [];
        }
        $rows = [];
        foreach ($pages as $u => $p) {
            $b = $before[$u] ?? null;
            $delta = $b && $b['size'] > 0 ? sprintf('%+.0f%%', 100 * ($p['size'] - $b['size']) / $b['size']) : '';
            $bad = $p['code'] === 0 || $p['code'] >= 500 || $p['errors'] || ($b && $b['code'] !== $p['code']);
            if ($bad) {
                $this->pagesInfo['bad']++;
                $r->problem("страница $u: код " . ($b['code'] ?? '?') . " → {$p['code']}" . ($p['errors'] ? ', ' . implode(', ', $p['errors']) : '')
                    . self::ajaxHint($u, $b['code'] ?? null, $p['code']));
            } elseif ($b && $b['size'] > 0 && abs($p['size'] - $b['size']) / $b['size'] > 0.2) {
                $this->notes[] = "страница $u — размер изменился на $delta";
            }
            $rows[] = [$u, ($b['code'] ?? '—') . ' → ' . $p['code'], $delta, $p['ms'] . ' мс', $p['errors'] ? implode(', ', $p['errors']) : ''];
        }
        $r->line('Страницы (' . $this->c->baseUrl . ($before ? '; «до» — из снимка ' . $this->s->d['base']['version'] : '; снимка страниц «до» нет') . '):');
        array_push($r->lines, ...Result::table($rows, ['Страница', 'Код до → после', 'Размер', 'Время', 'Ошибки']));
        if ($this->s && !$this->readOnly) {
            Util::jsonWrite($this->s->dir . '/pages-after.json', ['time' => time(), 'pages' => $pages]);
        }
    }

    /**
     * Подсказка к проблеме страницы (с 1.2.0): ajax-адрес стал отвечать 403/405 — вендор мог закрыть его для GET (только
     * POST с проверкой сессии; в 1.7.21 — ajax/basket_fly.php). verify запрашивает адреса GET без сессии и отличить такое
     * от поломки не может: проверьте действием посетителя, а адрес уберите из urls.
     */
    public static function ajaxHint(string $u, ?int $before, int $now): string
    {
        if (!preg_match('~(^|/)ajax/~i', $u) || !in_array($now, [403, 405], true) || $before === $now) {
            return '';
        }
        return " — ajax-адрес: если с этой версии он принимает только POST с проверкой сессии, это не поломка; проверьте его "
            . 'действием посетителя (в браузере) и уберите из urls — verify запрашивает адреса GET без сессии';
    }

    /** Получить страницы: код ответа, размер, признаки ошибок PHP и маркеров конфликта */
    public static function fetch(array $urls, string $base): array
    {
        $res = [];
        foreach ($urls as $u) {
            $u = trim((string)$u);
            if ($u === '' || $u[0] === '#') {
                continue;
            }
            $url = preg_match('~^https?://~', $u) ? $u : rtrim($base, '/') . '/' . ltrim($u, '/');
            $ctx = stream_context_create([
                'http' => ['ignore_errors' => true, 'timeout' => 60, 'follow_location' => 0, 'header' => "User-Agent: aspro-merge-verify\r\n"],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
            ]);
            $t0 = microtime(true);
            $http_response_header = [];
            $body = @file_get_contents($url, false, $ctx);
            $hdrs = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : $http_response_header;
            $code = 0;
            foreach ($hdrs as $h) {
                if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) {
                    $code = (int)$m[1];
                }
            }
            $body = (string)$body;
            $errs = [];
            foreach (['Fatal error', 'Parse error', 'Uncaught', 'Warning: ', 'Notice: ', 'Deprecated: ', 'DB query error', 'TypeError'] as $p) {
                if (stripos($body, $p) !== false) {
                    $errs[] = $p;
                }
            }
            if (Util::hasMarkers($body)) {
                $errs[] = 'маркеры конфликта';
            }
            $res[$u] = ['code' => $code, 'size' => strlen($body), 'errors' => $errs, 'ms' => (int)((microtime(true) - $t0) * 1000)];
        }
        return $res;
    }
}
