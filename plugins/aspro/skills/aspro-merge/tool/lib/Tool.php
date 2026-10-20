<?php
/**
 * Команды сверки Аспро — общие для консоли (merge.php) и сайта (события, агент).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Tool
{
    /**
     * Версия инструмента — единственное место в библиотеке. Файл подключения (local/php_interface/include/aspro_merge.php,
     * в поставке — integration/aspro_merge.php) знает свою версию (AsproMergeSite::VERSION): они выпускаются вместе и
     * должны совпадать — это проверяют version и status.
     */
    public const VERSION = '1.2.0';
    /** Сколько секунд предохранитель ждёт хранилище, занятое агентом или консолью */
    public const GUARD_LOCK_WAIT = 180;

    /** Файл подключения на сайте (от корня) */
    public const INTEGRATION = 'local/php_interface/include/aspro_merge.php';

    public const STATUS = [
        'ok' => 'уже как надо',
        'applied' => 'применено',
        'auto' => 'ждёт apply',
        'conflict' => 'конфликт',
        'review' => 'на разбор',
        'resolved' => 'решено, ждёт apply-resolved',
        'done' => 'решение применено',
        'error' => 'ошибка',
    ];

    public function __construct(public readonly Config $c, public readonly string $via = 'cli')
    {
    }

    private function lock(int $wait = 60)
    {
        return Util::lock($this->c->store(true) . '/.lock', $wait, $this->via);
    }

    private function cmd(): string
    {
        return 'php local/tools/aspro-merge/merge.php';
    }

    // ------------------------------------------------------------------ версия

    /** Версия файла подключения (константа VERSION) без его подключения: null — файла нет, '' — версия в нём не указана */
    public static function integrationVersion(string $file): ?string
    {
        if (!is_file($file)) {
            return null;
        }
        return preg_match("~\\bconst\\s+VERSION\\s*=\\s*'([^']+)'~", (string)@file_get_contents($file), $m) ? $m[1] : '';
    }

    /**
     * Версии инструмента и файлов подключения: на сайте (<корень>/local/php_interface/include/aspro_merge.php) и в
     * поставке рядом с инструментом (integration/aspro_merge.php — есть в поставке плагина). Расхождение — предупреждение
     * в $r (код выхода от него не меняется). ['version' => …, 'site' => ['path', 'version'] | null, 'bundled' => … | null]
     */
    public static function versions(string $root, Result $r): array
    {
        $out = ['version' => self::VERSION, 'site' => null, 'bundled' => null];
        $files = ['site' => Util::norm($root) . '/' . self::INTEGRATION, 'bundled' => Util::norm(dirname(__DIR__)) . '/integration/aspro_merge.php'];
        foreach ($files as $k => $f) {
            $v = self::integrationVersion($f);
            if ($v === null) {
                continue;
            }
            $out[$k] = ['path' => $f, 'version' => $v];
            if ($v === self::VERSION) {
                continue;
            }
            $what = $v === '' ? 'версия в нём не указана (файл старше 1.0.0)' : "версия $v";
            $r->warn($k === 'site'
                ? 'Файл подключения ' . self::INTEGRATION . " — $what, а инструмент — " . self::VERSION
                    . ': их обновляют вместе (файл подключения из поставки — integration/aspro_merge.php)'
                : "Файл подключения в поставке (integration/aspro_merge.php) — $what, а инструмент — " . self::VERSION . ': поставка собрана неверно');
        }
        return $out;
    }

    /** Текст «файл подключения — …» для status и version */
    private static function integrationText(?array $site): string
    {
        return $site === null
            ? 'файл подключения ' . self::INTEGRATION . ' не найден (событие после обновления, предохранитель и агент не работают — см. «Внедрение» в README.md)'
            : 'файл подключения — ' . ($site['version'] === '' ? 'версия не указана' : $site['version']);
    }

    /** Команда version: версия инструмента и файлов подключения (сайт не нужен) */
    public static function versionCmd(string $root): Result
    {
        $r = new Result('Сверка Аспро (aspro-merge) ' . self::VERSION);
        $v = self::versions($root, $r);
        if (is_dir(Util::norm($root) . '/bitrix')) {
            $r->line('Сайт ' . Util::norm($root) . ': ' . self::integrationText($v['site']));
        } else {
            $r->line('Сайт: не найден (нет папки bitrix в ' . Util::norm($root) . ') — файл подключения на сайте не проверялся');
        }
        if ($v['bundled'] !== null) {
            $r->line('Файл подключения в поставке (integration/aspro_merge.php): ' . ($v['bundled']['version'] === '' ? 'версия не указана' : $v['bundled']['version']));
        }
        $r->data = $v;
        if ($r->warnings) {
            $r->attention(); // версии расходятся — код 2
        }
        return $r;
    }

    // ------------------------------------------------------------------ сеанс

    /**
     * Обновление, которое ещё не сверено (сеанса нет): ['from' => версия до обновления, 'base' => версия снимка-базы
     * или null, 'why' => пояснение]; null — сверять нечего. Версия сравнивается не с самым новым снимком, а с той,
     * на которой в последний раз снимали состояние сайта (seen.json): если сайт откатили из резервной копии (хранилище
     * вне корня в неё не попадает), снимки новее к нему не относятся. Повторная установка той же версии после отката
     * видна по журналу обновлятора: последний запуск не тот, что был при снятии состояния.
     */
    public function pendingUpdate(): ?array
    {
        $c = $this->c;
        $cur = (string)$c->version();
        $seen = Snapshot::seen($c);
        if ($seen === null || $cur === '') {
            return null;
        }
        $from = null;
        $why = '';
        if (version_compare($cur, $seen['version'], '>')) {
            $from = $seen['version'];
        } elseif ($cur === $seen['version'] && isset($seen['last_run'])) {
            $runs = Updater::runs($c);
            $last = $runs ? end($runs) : null;
            if ($last && $last['to'] === $cur && $last['line'] !== $seen['last_run'] && version_compare($last['from'], $cur, '<')) {
                $from = $last['from'];
                $why = "после того как состояние сайта на версии $cur было снято, обновлятор снова ставил $cur (с {$last['from']}, "
                    . Util::date($last['t']) . ') — сайт откатывали к прежней версии (восстановление из копии?)';
            }
        }
        if ($from === null) {
            return null;
        }
        $base = Snapshot::load($c, $from) !== null ? $from : Snapshot::latest($c, $cur);
        if ($base !== null && $base !== $from) {
            $why = trim($why . "; снимка версии $from нет — база: снимок $base", '; ');
        }
        return ['from' => $from, 'base' => $base, 'why' => $why];
    }

    /**
     * Открытый сеанс; если его нет и $create — новый, когда есть несверенное обновление (pendingUpdate).
     * Без единого снимка ($noBase) — сеанс по бэкапам обновлятора (аварийный режим).
     */
    private function session(bool $create, Result $r, bool $noBase = false): ?Session
    {
        $cur = $this->c->version() ?? Util::fail("Не прочитана версия модуля из {$this->c->versionFile}");
        $s = Session::current($this->c);
        if ($s) {
            if ($cur !== $s->d['to']) {
                if (version_compare($cur, (string)$s->d['to'], '>')) {
                    $s->step($cur, $this->via);
                    $s->save();
                    $r->line("Новый шаг обновления в открытом сеансе: модуль теперь $cur.");
                } else {
                    $r->warn("Версия модуля ($cur) ниже, чем в сеансе ({$s->d['to']}): модуль откатили? Проверьте, прежде чем применять.");
                }
            }
            return $s;
        }
        if (!$create) {
            return null;
        }
        $p = $this->pendingUpdate();
        if ($p !== null && $p['base'] !== null) {
            $snap = Snapshot::load($this->c, $p['base']);
            $s = Session::create($this->c, $p['base'], $cur, $this->via, $snap);
            $vs = Snapshot::versions($this->c);
            $newer = array_values(array_filter($vs, static fn($v) => version_compare($v, $p['base'], '>')));
            if ($p['why'] !== '' || $newer) {
                $s->d['warnings'][] = 'База сеанса — снимок ' . $p['base'] . ($newer ? ', хотя есть снимки новее (' . implode(', ', $newer) . '): они сняты до отката сайта и к этому обновлению не относятся' : '')
                    . ($p['why'] !== '' ? '. ' . ucfirst($p['why']) : '') . '.';
                $s->save();
            }
            $r->line("Открыт сеанс сверки {$p['base']} → $cur (база — снимок версии {$p['base']}).");
            return $s;
        }
        if (Snapshot::versions($this->c) && $p === null) {
            return null; // обновления после последнего снятия состояния не было
        }
        if (!$noBase) {
            return null;
        }
        $from = $p['from'] ?? null;
        if ($from === null) {
            $start = Updater::sessionStart($this->c);
            foreach (Updater::runs($this->c) as $run) {
                if ($start !== null && $run['t'] >= $start) {
                    $from = $run['from'];
                    break;
                }
            }
        }
        if ($from === null || version_compare($cur, $from, '<=')) {
            return null;
        }
        $s = Session::create($this->c, null, $cur, $this->via, null, $from);
        $s->d['warnings'][] = "Снимка версии $from нет: сверка только по бэкапам обновлятора. Для копии шаблона база — бэкапы, для правок «на месте» и публичных файлов базы нет — всё на разбор.";
        $s->save();
        $r->warn("Открыт сеанс $from → $cur БЕЗ снимка версии до обновления — сверка по бэкапам обновлятора (аварийный режим).");
        return $s;
    }

    private function baseSnapshot(Session $s): ?Snapshot
    {
        $v = $s->d['base']['version'] ?? null;
        if ($v === null) {
            return null;
        }
        return Snapshot::load($this->c, $v) ?? Util::fail("Снимок версии $v (база сеанса) не найден в " . $this->c->store() . ' — его удалили? Без него сверка невозможна.');
    }

    /** Пересчитать план сеанса ($deadline — срок, по нему TimeUpException) */
    private function plan(Session $s, Result $r, ?float $deadline = null): array
    {
        if (!empty($s->d['lint_defer']) && Util::canPhpL($this->c->phpCli)) {
            // слияния PHP, отложенные из-за отсутствия php -l (веб-запрос без PHP CLI), — здесь проверка есть
            $s->d['lint_defer'] = [];
        }
        $p = new Planner($this->c, $s, $this->baseSnapshot($s), $deadline);
        $entries = $p->run();
        $s->d['conflict_keep'] = $this->c->conflictKeep; // что лежит на месте до решения («на месте») — для отчёта
        foreach ($p->warnings() as $w) {
            if (!in_array($w, $s->d['warnings'], true)) {
                $s->d['warnings'][] = $w;
            }
        }
        $s->save();
        return $entries;
    }

    // ------------------------------------------------------------------ status

    public function status(): Result
    {
        $c = $this->c;
        $r = new Result('Сверка Аспро — состояние');
        $ver = $c->version();
        $tv = self::versions($c->root, $r);
        $r->line('Инструмент: aspro-merge ' . self::VERSION . '; ' . self::integrationText($tv['site']));
        $r->line("Сайт: {$c->root}");
        $r->line("Решение: {$c->module} {$ver}, шаблон {$c->template}");
        $r->line('Режимы: ' . $this->modesText());
        $store = $c->store();
        $r->line("Хранилище: $store" . (is_dir($store) ? sprintf(' (%.1f МБ)', Snapshot::dirSize($store) / 1048576) : ' (ещё не создано)'));
        foreach ($c->storeWarnings() as $w) {
            $r->warn($w);
        }
        $this->probeStore($r);
        $vs = Snapshot::versions($c);
        $snaps = [];
        foreach ($vs as $v) {
            $m = Util::jsonRead(Snapshot::dirFor($c, $v) . '/meta.json') ?? [];
            $snaps[] = "$v (эталон " . Util::date((int)($m['created'] ?? 0)) . ', доработки ' . Util::date((int)($m['state_time'] ?? 0)) . ')';
        }
        $r->line('Снимки: ' . ($snaps ? implode('; ', $snaps) : 'нет'));
        $r->data = ['version' => $tv, 'config' => $c->summary(), 'snapshots' => $vs];
        if ($un = Updater::unfinished($c)) {
            $r->problem("Последний запуск обновлятора {$un['from']} → {$un['to']} (" . Util::date($un['t']) . ') не дописал FINISH — шаг мог упасть посередине. Проверьте bitrix/modules/updater_partner.log.');
        }
        $r->line('PHP CLI для php -l в событии после обновления: ' . Util::phpCliInfo($c->phpCli, 'web')['how']
            . ($c->phpCli === null ? ' — в веб-запросе ищется рядом с PHP сайта, в PATH и типичных местах' : ''));
        $s = Session::current($c);
        if ($s) {
            $this->describe($s, $r);
            $r->data['session'] = $this->sessionData($s);
            $this->backupsCheck($r, $s);
            $this->noticesCheck($r, $s);
            $this->agentsCheck($r);
            $this->initCheck($r);
            return $r;
        }
        $last = Session::last($c);
        if ($last) {
            $r->line('Последний сеанс: ' . $last->d['from'] . ' → ' . $last->d['to'] . ', ' . ($last->d['status'] === Session::FINISHED
                    ? 'завершён ' . Util::date((int)($last->d['finished'] ?? 0)) : $last->d['status']) . " ({$last->dir})");
        }
        $p = $vs ? $this->pendingUpdate() : null;
        if (!$vs) {
            $r->attention();
            $r->line('Снимков нет: база для следующего обновления не сохранена.');
            if (is_file($c->store() . '/unsynced.json')) {
                $u = Util::jsonRead($c->store() . '/unsynced.json') ?? [];
                $r->problem('Обновление до ' . ($u['version'] ?? '?') . ' (' . Util::date((int)($u['time'] ?? 0)) . ') НЕ сверено: снимка версии до него не было. '
                    . 'Проверьте доработки (бэкапы обновлятора _*.back*) или выполните аварийную сверку.');
                $r->next("{$this->cmd()} apply --no-snapshot — аварийная сверка по бэкапам обновлятора");
            }
            $r->next("{$this->cmd()} snapshot — снять снимок текущей версии, если всё сверено (дальше это делают агент и предохранитель сами)");
        } elseif ($p !== null) {
            $r->attention();
            $r->line("Модуль обновлён ($ver) после снятия состояния сайта на версии {$p['from']}, сеанса сверки нет — обновление не сверено."
                . ($p['why'] !== '' ? ' ' . ucfirst($p['why']) . '.' : ''));
            $r->next("{$this->cmd()} apply — открыть сеанс и применить очевидное, затем status");
        } elseif (version_compare((string)$ver, end($vs), '<')) {
            $r->attention();
            $r->warn("Версия модуля ($ver) ниже самого нового снимка (" . end($vs) . '): сайт откатывали? Снимки новее текущей версии к сайту не относятся; '
                . "база следующего обновления — снимок $ver" . (in_array($ver, $vs, true) ? '' : ' (его ещё нет: snapshot)') . '.');
            if (!in_array($ver, $vs, true)) {
                $r->next("{$this->cmd()} snapshot");
            }
        } elseif (!in_array($ver, $vs, true)) {
            $r->attention();
            $r->line("Снимка текущей версии $ver нет.");
            $r->next("{$this->cmd()} snapshot");
        } else {
            $snap = Snapshot::load($c, (string)$ver);
            $mods = $this->modifiedSummary($snap);
            $r->line('Доработанных файлов (по снимку ' . Util::date($snap->stateTime()) . '): ' . ($mods ? implode('; ', $mods) : 'нет'));
            foreach ($snap->meta['warnings'] ?? [] as $w) {
                $r->warn($w);
            }
            if (!$snap->pages()) {
                $r->line("В снимке $ver нет страниц «до» (pages.json): verify --urls после следующего обновления сравнит коды и размеры страниц не с чем."
                    . ($this->pagesUnavailable() === null ? '' : ' Сначала задайте base_url и urls в настройках.'));
                if ($this->pagesUnavailable() === null) {
                    $r->next("{$this->cmd()} snapshot --urls — снять страницы «до» в снимок $ver");
                }
            }
            $r->line('Сеанса сверки нет — всё сверено, ждём следующего обновления.');
        }
        $this->backupsCheck($r, null);
        $this->noticesCheck($r, null);
        $this->agentsCheck($r);
        $this->initCheck($r);
        return $r;
    }

    private function modesText(): string
    {
        $tpl = $this->c->area('tpl');
        $cmp = array_filter($this->c->areas(), static fn(Area $a) => $a->kind === 'cmp');
        $copy = array_filter($cmp, static fn(Area $a) => $a->mode === Area::COPY);
        $s = 'шаблон — ' . $tpl->modeTitle();
        $s .= '; компоненты Аспро (' . count($cmp) . ') — ' . (!$copy ? '«на месте»' : 'копия у ' . implode(', ', array_map(static fn(Area $a) => substr($a->id, 4), $copy)) . ', остальные «на месте»');
        return $s . '; публичная часть — «на месте»';
    }

    private function modifiedSummary(Snapshot $snap): array
    {
        $out = [];
        foreach ($this->c->areas() as $a) {
            $ref = $snap->etalonFor($a);
            $side = $a->mode === Area::COPY ? 'L' : 'I';
            $cmpTo = $a->mode === Area::COPY ? $snap->state($a, 'I') : $ref;
            $n = 0;
            $own = 0;
            foreach ($snap->state($a, $side) as $rel => $h) {
                if ($a->isExcluded($rel)) {
                    continue;
                }
                $e = $cmpTo[$rel] ?? null;
                if ($e === null) {
                    $own += $a->kind === 'pub' ? 0 : 1;
                } elseif ($e['n'] !== $h['n']) {
                    $n++;
                }
            }
            if ($n || $own) {
                $out[] = $a->kind === 'pub'
                    ? "{$a->title}: отличаются от эталона мастера $n (в основном подстановки мастера при установке; важны те, что перезаписывает обновлятор)"
                    : "{$a->title}: изменено $n" . ($own ? ", своих $own" : '');
            }
        }
        return $out;
    }

    /** Сводка сеанса для вывода */
    private function describe(Session $s, Result $r, bool $all = false): void
    {
        $d = $s->d;
        $steps = implode(' → ', array_merge([(string)$d['from']], array_map(static fn($x) => $x['to'], $d['steps'])));
        $r->line("Сеанс {$s->id()}: $steps, открыт " . Util::date((int)$d['opened']) . ($d['base'] ? ", база — снимок {$d['base']['version']}" : ', БЕЗ снимка (по бэкапам)'));
        $r->line("Папка сеанса: {$s->dir}" . (isset($d['plan']['time']) ? '; план рассчитан ' . Util::date((int)$d['plan']['time']) . ' (пересчитать — changes)' : ''));
        $counts = $s->counts();
        $parts = [];
        foreach (self::STATUS as $k => $t) {
            if (!empty($counts[$k])) {
                $parts[] = "$t — {$counts[$k]}";
            }
        }
        $r->line('Файлов в плане: ' . count($d['entries']) . ($parts ? ' (' . implode(', ', $parts) . ')' : '') . ', сгенерированных пропущено: ' . (int)($d['plan']['excluded'] ?? 0));
        // по итогу (что сделано или что на месте сейчас), а не по первоначальному действию плана
        $sum = [];
        foreach ($d['entries'] as $e) {
            $k = "{$e['area']}|{$e['cat']}|" . Planner::outcome($e);
            $sum[$k] = ($sum[$k] ?? 0) + 1;
        }
        ksort($sum);
        $rows = [];
        foreach ($sum as $k => $n) {
            [$a, $cat, $out] = explode('|', $k, 3);
            $rows[] = [$a, $n, $out, Planner::CAT[$cat] ?? $cat];
        }
        if ($rows) {
            array_push($r->lines, ...Result::table($rows, ['Область', 'Файлов', 'Итог', 'Категория']));
        }
        $win = Planner::window($d['entries']);
        $r->line('Записано инструментом новых версий вендора и слияний: ' . count($win['written'])
            . ($win['updater'] ? '; версию вендора в недоработанные файлы записал сам обновлятор: ' . count($win['updater']) : '')
            . '; до решения на месте наша прежняя версия: ' . count($win['held_ours'])
            . ($win['held_theirs'] ? '; на месте версия вендора без доработки (conflict_keep = theirs): ' . count($win['held_theirs']) : ''));
        if ($s->isOpen()) {
            foreach (Planner::windowText($win, 8, false) as $w) {
                $r->warn($w);
            }
        }
        $att = $s->attention();
        if ($att) {
            $r->attention();
            $r->line('Требуют решения:');
            foreach ($att as $e) {
                $label = ['conflict' => 'КОНФЛИКТ', 'review' => 'РАЗОБРАТЬ', 'resolved' => 'РЕШЕНО', 'error' => 'ОШИБКА'][$e['status']];
                $r->line(sprintf('  %-9s %s — %s%s', $label, $e['target'], $e['about'], $e['note'] ? " ({$e['note']})" : ''));
                if ($e['files']) {
                    $r->line('            тройка: ' . $s->dir . '/' . $e['files']);
                }
                if (!empty($e['vendor_fix']['text']) && $e['status'] !== 'resolved') {
                    $r->line('            вендор, похоже, исправил безопасность / формат: ' . $e['vendor_fix']['text']
                        . ' — перенесите эти изменения вендора в решение (подсказка по словам в theirs.diff, не вывод)');
                }
                if (!empty($e['related'])) {
                    $r->line('            возможно связано: вендор в этом обновлении менял те же имена в '
                        . implode('; ', array_map(static fn($x) => "{$x['target']} (" . implode(', ', $x['tokens']) . ')', $e['related']))
                        . ' — возможно, общий формат данных между файлами: разберите вместе и найдите потребителей (grep)');
                }
            }
        }
        $open = array_filter($att, static fn($e) => in_array($e['status'], ['conflict', 'review', 'error'], true));
        if ($open && $s->isOpen() && ($win['held_ours'] || $win['other'])) {
            $r->warn('До сверки сайт работает на смеси версий: в файлах на разбор — прежняя (наша) версия или файл не тронут, а остальные '
                . 'файлы вендора уже новые. Если вендор поменял формат данных сразу в нескольких файлах (в 1.7.21 — подпись параметров '
                . 'корзины в шаблоне и в ajax/show_basket_popup.php), связанная функция не работает до решения — решите конфликты сразу, '
                . 'начиная с помеченных «возможно связано».');
        }
        if (!empty($counts['auto'])) {
            $r->attention();
        }
        if ($all) {
            foreach ($d['entries'] as $e) {
                if (in_array($e['status'], ['applied', 'auto'], true)) {
                    $r->line(sprintf('  %-9s %s — %s', $e['status'] === 'applied' ? 'ПРИМЕНЕНО' : 'ЖДЁТ', $e['target'], Planner::outcome($e)));
                }
            }
        }
        foreach ($d['warnings'] as $w) {
            $r->warn($w);
        }
        if ($att || !empty($counts['auto'])) {
            if (!empty($counts['auto'])) {
                $r->next("{$this->cmd()} apply — применить очевидное");
            }
            if (array_filter($att, static fn($e) => in_array($e['status'], ['conflict', 'review'], true))) {
                $r->next('по каждому конфликту/разбору: прочитать merged, ours.diff, theirs.diff в папке тройки, записать итог в файл resolved там же');
                $r->next("{$this->cmd()} resolve <файл> [ours|theirs|keep|<путь к решению>] — принять решение (проверка маркеров и php -l)");
            }
            if (array_filter($att, static fn($e) => $e['status'] === 'resolved')) {
                $r->next("{$this->cmd()} apply-resolved — записать решения на сайт");
            }
            $r->next("{$this->cmd()} verify --urls — проверить; {$this->cmd()} finish — завершить сеанс");
        } else {
            $r->next("{$this->cmd()} verify --urls, затем {$this->cmd()} finish — завершить сеанс и снять снимок новой версии");
        }
    }

    private function sessionData(Session $s): array
    {
        $d = $s->d;
        return ['id' => $s->id(), 'dir' => $s->dir, 'status' => $d['status'], 'from' => $d['from'], 'to' => $d['to'], 'steps' => $d['steps'],
            'counts' => $s->counts(), 'attention' => array_values(array_map(static fn($e) => [
                'key' => $e['key'], 'target' => $e['target'], 'status' => $e['status'], 'cat' => $e['cat'], 'note' => $e['note'],
                'files' => $e['files'] ? $s->dir . '/' . $e['files'] : null, 'related' => $e['related'] ?? [],
                'vendor_fix' => $e['vendor_fix'] ?? null, 'outcome' => Planner::outcome($e)], $s->attention())),
            'entries' => array_values(array_map(static fn($e) => ['key' => $e['key'], 'target' => $e['target'], 'cat' => $e['cat'],
                'action' => $e['action'], 'status' => $e['status'], 'outcome' => Planner::outcome($e), 'related' => $e['related'] ?? [],
                'vendor_fix' => $e['vendor_fix'] ?? null], $d['entries'])),
            'window' => array_map(static fn($l) => array_column($l, 'target'), Planner::window($d['entries'])),
            'conflict_keep' => $d['conflict_keep'] ?? null,
            'warnings' => $d['warnings']];
    }

    // ------------------------------------------------------------------ snapshot

    public function snapshot(bool $force = false, bool $urls = false, bool $rebuild = false): Result
    {
        $c = $this->c;
        $r = new Result('Снимок версии');
        $lock = $this->lock();
        try {
            $s = Session::current($c);
            if ($s) {
                $r->attention();
                $r->line("Открыт сеанс сверки {$s->d['from']} → {$s->d['to']}: пока он открыт, новый снимок не делается (база сеанса — снимок {$s->d['from']}).");
                $r->next("{$this->cmd()} status — что осталось; после сверки {$this->cmd()} finish снимет снимок сам");
                return $r;
            }
            $ver = (string)$c->version();
            $p = $this->pendingUpdate();
            if ($p !== null && !$force) {
                $r->attention();
                $r->line("Модуль обновлён ($ver) после снятия состояния сайта на версии {$p['from']}, а сеанса сверки нет. Снимок сейчас зафиксировал бы несверенное состояние."
                    . ($p['why'] !== '' ? ' ' . ucfirst($p['why']) . '.' : ''));
                $r->next("{$this->cmd()} apply — открыть сеанс сверки; снимок без сверки — snapshot --force (только если обновление уже сверено вручную)");
                return $r;
            }
            $pages = null;
            if ($urls) {
                $pages = $this->fetchPages($r) ?: null; // не сняли — прежний pages.json не затираем
            }
            $res = Snapshot::ensure($c, ['force' => $rebuild] + ($pages !== null ? ['pages' => $pages] : []));
            @unlink($c->store() . '/unsynced.json'); // снимок сняли вручную — значит, состояние сайта принято
            $removed = Snapshot::rotate($c);
            $this->probeStore($r);
            $r->line("Снимок версии {$res['version']}: {$res['dir']}");
            if ($res['etalon_created']) {
                $e = $res['etalon'];
                $r->line(sprintf('Эталон сохранён: W %d, WP %d, C %d файлов (в архиве — %d текстовых, %.1f МБ)',
                    $e['files']['W'] ?? 0, $e['files']['WP'] ?? 0, $e['files']['C'] ?? 0, $e['stored'], $e['bytes'] / 1048576));
            } else {
                $r->line('Эталон этой версии уже был — обновлён только список доработанных файлов.');
            }
            $st = $res['state'];
            $r->line('Рабочие файлы: ' . implode('; ', array_map(static fn($id, $n) => "$id " . $n['I'] . ($n['L'] ? " + копия {$n['L']}" : ''), array_keys($st['counts']), $st['counts']))
                . "; копий доработанных: {$st['stored']}");
            $snap = Snapshot::load($c, $res['version']);
            $mods = $this->modifiedSummary($snap);
            $r->line('Доработанных файлов: ' . ($mods ? implode('; ', $mods) : 'нет'));
            $r->line('Режимы: ' . $this->modesText());
            if ($removed) {
                $r->line('Удалены старые снимки: ' . implode(', ', $removed));
            }
            if ($pages !== null) {
                $r->line('Страниц «до» снято: ' . count($pages));
            }
            $r->line("Время: {$res['seconds']} с");
            foreach ($res['warnings'] as $w) {
                $r->warn($w);
            }
            if ($res['warnings']) {
                $r->attention();
            }
            $r->data = $res;
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    // ------------------------------------------------------------------ changes / apply

    public function changes(bool $noSnapshot = false): Result
    {
        $r = new Result('Изменения вендора и план сверки (сайт не меняется)');
        $lock = $this->lock();
        try {
            $s = $this->session(true, $r, $noSnapshot);
            if (!$s) {
                return $this->nothing($r);
            }
            $this->plan($s, $r);
            Report::write($this->c, $s);
            $this->describe($s, $r);
            $r->data = ['session' => $this->sessionData($s)];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    private function nothing(Result $r): Result
    {
        $ver = $this->c->version();
        $vs = Snapshot::versions($this->c);
        if (!$vs) {
            $r->attention();
            $runs = Updater::runs($this->c);
            $last = $runs ? end($runs) : null;
            $r->line('Снимков нет — базы для слияния нет.'
                . ($last ? " Последнее обновление по журналу обновлятора: {$last['from']} → {$last['to']} (" . Util::date($last['t']) . ').' : ''));
            $r->next("{$this->cmd()} snapshot — если всё сверено: снять снимок текущей версии (база для следующего обновления)");
            if ($last && $last['to'] === $ver) {
                $r->next("{$this->cmd()} apply --no-snapshot — если это обновление НЕ сверено: аварийная сверка по бэкапам обновлятора");
            }
            return $r;
        }
        $r->line("Обновления после снимка " . end($vs) . " не было (модуль $ver) — сверять нечего.");
        return $r;
    }

    public function apply(?float $deadline = null, bool $noSnapshot = false): Result
    {
        $r = new Result('Применение очевидного (apply)');
        $lock = $this->lock();
        try {
            $s = $this->session(true, $r, $noSnapshot);
            if (!$s) {
                return $this->nothing($r);
            }
            $this->applyAuto($s, $r, $deadline);
            $this->describe($s, $r);
            $r->data = ['session' => $this->sessionData($s)];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    /**
     * План (один раз) → запись очевидного (с архивом отката) → статусы по диску. Возвращает число записанных файлов
     * или -1, если план не успели рассчитать до срока ($deadline). $event — вызов из события после обновления: тогда
     * заново записываются и решения, уже применённые раньше, если следующий шаг обновлятора их перезаписал.
     */
    private function applyAuto(Session $s, Result $r, ?float $deadline, bool $event = false): int
    {
        try {
            $this->plan($s, $r, $deadline);
        } catch (TimeUpException) {
            $s->d['plan']['complete'] = false; // недосчитанный план не считается планом этой версии
            $s->event('план не досчитан: не хватило времени, ничего не записано', $this->via);
            $s->save();
            $r->warn("Не хватило времени на расчёт плана — ничего не применено; продолжите в консоли: {$this->cmd()} apply");
            $r->attention();
            Report::write($this->c, $s);
            return -1;
        }
        $w = $this->writeAuto($s, $deadline, $r, $event);
        $total = count($w['written']);
        Planner::refresh($s, $this->c);
        $s->save();
        if ($w['pending']) {
            $r->warn("Не хватило времени: не применено {$w['pending']} — продолжите: {$this->cmd()} apply");
        }
        if ($w['deferred']) {
            $r->warn("Слияния PHP без проверки php -l не записаны ({$w['deferred']}): здесь нет PHP CLI — на месте "
                . ($this->c->conflictKeep === 'theirs' ? 'версия вендора (conflict_keep = theirs)' : 'наша прежняя версия') . "; выполните в консоли {$this->cmd()} apply");
        }
        $r->data['lint_method'] = $w['method'];
        if ($total) {
            $r->line("Записано файлов: $total; кеш: " . Bitrix::clearCache($this->c));
        } else {
            $r->line('Записывать нечего.');
        }
        Report::write($this->c, $s);
        return $total;
    }

    private function writeAuto(Session $s, ?float $deadline, Result $r, bool $event = false): array
    {
        $items = [];
        $lint = [];
        $pending = 0;
        $deferred = 0;
        $method = null;
        foreach ($s->d['entries'] as $key => &$e) {
            $res = $e['resolution'] ?? null;
            if ($res !== null) {
                // принятое и уже применённое решение, которое перезаписал следующий шаг обновлятора, — снова на место
                if (!$event || $e['status'] !== 'resolved' || empty($res['applied'])) {
                    continue;
                }
                $want = $res['h'] === '-' ? null : $res['h'];
            } else {
                if ($e['auto'] === null || in_array($e['status'], ['ok', 'applied', 'done'], true)) {
                    continue;
                }
                $want = $e['auto'] === '-' ? null : $e['auto'];
            }
            if ($e['h']['current'] === $want) {
                continue;
            }
            if ($deadline !== null && microtime(true) > $deadline) {
                $pending++;
                continue;
            }
            $content = $want === null ? null : $s->blob($want);
            if ($want !== null && $content === null) {
                $r->problem("{$e['target']}: в сеансе нет содержимого для записи (повреждена папка сеанса?)");
                continue;
            }
            $mergeLike = $res === null && $e['action'] === 'merge';
            if ($content !== null && ($mergeLike || $res !== null) && Util::hasMarkers($content)) {
                $r->problem("{$e['target']}: в результате слияния маркеры конфликта — не записан");
                continue;
            }
            if ($content !== null && $res !== null && str_ends_with($e['target'], '.php') && Util::hasBom($content) && !Util::hasBom((string)$s->blob($e['h']['theirs']))) {
                $r->problem("{$e['target']}: в решении BOM в начале PHP-файла — не записан");
                continue;
            }
            if ($content !== null && str_ends_with($e['target'], '.php') && Util::isText($content)) {
                [$err, $method] = Util::lint($content, $s->dir . '/tmp', $this->c->phpCli);
                $defer = $err === null && $mergeLike && $method !== 'php -l';
                if ($err !== null || $defer) {
                    if ($mergeLike) {
                        // результат слияния не проверен полностью или не прошёл php -l: на месте — наша версия (или
                        // версия вендора при conflict_keep = theirs, или прежнее решение), запись — на разбор;
                        // следующий расчёт плана даст то же по записи lint/lint_defer
                        $fb = $e['fallback'] ?? $e['h']['ours'];
                        $held = match (true) {
                            $fb !== null && $fb === $e['h']['theirs'] && $fb !== $e['h']['ours']
                                => 'на месте версия вендора' . ($this->c->conflictKeep === 'theirs' ? ' (conflict_keep = theirs)' : ''),
                            $fb !== null && $fb !== $e['h']['ours'] => 'на месте прежнее решение',
                            default => 'на месте наша прежняя версия',
                        };
                        if ($defer) {
                            $s->d['lint_defer'][$key] = $want;
                            $deferred++;
                            $note = "слилось без конфликтов, но проверить php -l здесь нечем (нет PHP CLI): результат не записан, $held; "
                                . 'выполните в консоли merge.php apply';
                        } else {
                            $s->d['lint'][$key] = ['h' => $want, 'error' => $err];
                            $note = "слилось без конфликтов, но php -l: $err; до решения $held";
                        }
                        $e['cat'] = 'lint';
                        $e['about'] = Planner::CAT['lint'];
                        $e['action'] = str_starts_with($held, 'на месте версия вендора') ? 'take' : 'restore';
                        $e['auto'] = $fb;
                        $e['needs'] = 'review';
                        $e['note'] = $note;
                        $fbC = $s->blob($fb);
                        if ($fbC !== null && $e['h']['current'] !== $fb) {
                            $items[$e['target']] = ['content' => $fbC, 'perms' => $e['perms'], 'why' => 'restore (' . ($defer ? 'нет php -l' : 'php -l') . ')',
                                'key' => $key, 'expect' => $e['h']['current'] ?? '-'];
                        }
                        $lint[$key] = $err ?? 'нет php -l';
                        continue;
                    }
                    if ($err !== null) {
                        $r->problem("{$e['target']}: php -l: $err — не записан");
                        $lint[$key] = $err;
                        continue;
                    }
                }
            }
            $items[$e['target']] = ['content' => $content, 'perms' => $e['perms'],
                'why' => $res !== null ? 'решение снова после шага обновления: ' . $res['source'] : "{$e['action']} ({$e['cat']})", 'key' => $key,
                'expect' => $e['h']['current'] ?? '-'];
        }
        unset($e);
        $w = $s->writeBatch($items, 'apply', $this->via);
        foreach ($w['skipped'] as $t => $why) {
            $r->warn("$t: не записан — $why");
        }
        $s->save();
        return $w + ['lint' => $lint, 'pending' => $pending, 'deferred' => $deferred, 'method' => $method];
    }

    // ------------------------------------------------------------------ resolve / apply-resolved

    public function resolve(string $file, ?string $decision): Result
    {
        $r = new Result('Решение по файлу (resolve)');
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки');
            $this->plan($s, $r);
            $e = $this->findEntry($s, $file);
            $dir = $s->filesDir($e['area'], $e['rel']);
            $src = ['ours' => 'наша версия (ours)', 'theirs' => 'версия вендора (theirs)', 'delete' => 'удалить файл'][$decision] ?? 'resolved';
            $theirsC = $s->blob($e['h']['theirs']);
            $oursC = $s->blob($e['h']['ours']);
            if ($decision === 'ours' || $decision === 'theirs') {
                $content = $decision === 'ours' ? $oursC : $theirsC;
                if ($content === null && $e['h'][$decision] !== null) {
                    Util::fail("Нет содержимого версии $decision в сеансе");
                }
                $hash = $content === null ? '-' : null;
            } elseif ($decision === 'keep' || $decision === 'current') {
                $content = Util::read($this->c->abs($e['target']));
                $hash = $content === null ? '-' : null;
                $src = 'оставить как есть на сайте';
            } elseif ($decision === 'delete') {
                $content = null;
                $hash = '-';
            } else {
                $path = $decision === null ? "$dir/resolved" : (is_file($decision) ? $decision : (getcwd() . '/' . $decision));
                if (!is_file($path)) {
                    Util::fail($decision === null ? "Нет файла решения $dir/resolved — запишите туда итог или укажите путь вторым аргументом" : "Нет файла $decision");
                }
                $raw = (string)file_get_contents($path);
                // переводы строк и BOM — как у вендора; двоичное решение (картинка) принимается побайтно
                $content = Util::styleLike($raw, $theirsC ?? $oursC ?? $raw);
                $hash = null;
                $src = $decision === null ? 'resolved' : 'файл ' . $decision;
            }
            if ($content !== null) {
                $this->checkResolution($s, $e, $content);
                $hash = $s->putBlob($content);
                if ($decision !== null && Util::read("$dir/resolved") !== $content && is_dir($dir)) {
                    Util::put("$dir/resolved", $content);
                }
            }
            $s->d['resolutions'][$e['key']] = ['h' => $hash, 'triple' => [$e['h']['base'], $e['h']['ours'], $e['h']['theirs']], 'source' => $src, 'time' => time()];
            $s->acceptOurs($e['key']);
            $s->event("решение по {$e['target']}: $src", $this->via);
            $this->plan($s, $r);
            Report::write($this->c, $s);
            $r->line("Принято решение для {$e['target']} ($src).");
            $left = array_filter($s->attention(), static fn($x) => in_array($x['status'], ['conflict', 'review', 'error'], true));
            $r->line('Осталось без решения: ' . count($left));
            if ($left) {
                $r->attention();
            }
            $r->next("{$this->cmd()} apply-resolved — записать решения на сайт");
            $r->data = ['entry' => $e['key'], 'hash' => $hash];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    private function checkResolution(Session $s, array $e, string $content): void
    {
        if (Util::hasMarkers($content)) {
            Util::fail("В решении для {$e['target']} остались маркеры конфликта (<<<<<<< / >>>>>>>)");
        }
        if (str_ends_with($e['target'], '.php') && Util::isText($content)) {
            if (Util::hasBom($content) && !Util::hasBom((string)$s->blob($e['h']['theirs']))) {
                Util::fail("В решении для {$e['target']} BOM в начале PHP-файла — уберите (иначе «headers already sent»)");
            }
            [$err] = Util::lint($content, $s->dir . '/tmp', $this->c->phpCli);
            if ($err !== null) {
                Util::fail("Решение для {$e['target']} не прошло проверку синтаксиса: $err");
            }
        }
    }

    /** Найти запись плана по пути: целевой файл, путь в области, ключ или папка тройки; допускается однозначный хвост пути */
    private function findEntry(Session $s, string $file): array
    {
        $f = str_replace('\\', '/', $file);
        $root = $this->c->root . '/';
        if (str_starts_with($f, $root)) {
            $f = substr($f, strlen($root));
        }
        if (str_starts_with($f, $s->dir . '/')) {
            $f = substr($f, strlen($s->dir) + 1);
        }
        $f = preg_replace('~/(base|ours|theirs|merged|resolved|info\.json|[a-z-]+\.diff)$~', '', $f);
        $f = trim($f, '/');
        $cands = [];
        foreach ($s->d['entries'] as $e) {
            if ($f === $e['target'] || $f === $e['key'] || $f === $e['files'] || $f === $e['area'] . '/' . $e['rel']) {
                return $e;
            }
            if (str_ends_with('/' . $e['target'], '/' . $f) && ($e['needs'] !== null || isset($e['resolution']))) {
                $cands[] = $e;
            }
        }
        if (count($cands) === 1) {
            return $cands[0];
        }
        if (count($cands) > 1) {
            Util::fail("Путь «{$file}» подходит к нескольким файлам: " . implode(', ', array_map(static fn($e) => $e['target'], $cands)) . ' — укажите полнее');
        }
        Util::fail("В плане сеанса нет файла «{$file}» (status покажет список)");
    }

    public function applyResolved(): Result
    {
        $r = new Result('Запись решений (apply-resolved)');
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки');
            $this->plan($s, $r);
            $items = [];
            foreach ($s->d['entries'] as $key => $e) {
                if (($e['status'] ?? '') !== 'resolved') {
                    continue;
                }
                $res = $e['resolution'];
                $content = $res['h'] === '-' ? null : $s->blob($res['h']);
                if ($res['h'] !== '-' && $content === null) {
                    $r->problem("{$e['target']}: нет содержимого решения в сеансе");
                    continue;
                }
                if ($content !== null) {
                    try {
                        $this->checkResolution($s, $e, $content);
                    } catch (MergeException $ex) {
                        $r->problem($ex->getMessage());
                        continue;
                    }
                }
                $items[$e['target']] = ['content' => $content, 'perms' => $e['perms'], 'why' => 'решение: ' . $res['source'], 'key' => $key,
                    'expect' => $e['h']['current'] ?? '-'];
            }
            $w = $s->writeBatch($items, 'apply-resolved', $this->via);
            foreach ($w['skipped'] as $t => $why) {
                $r->problem("$t: не записан — $why");
            }
            $this->plan($s, $r);
            $n = count($w['written']);
            $r->line($n ? "Записано решений: $n; кеш: " . Bitrix::clearCache($this->c) : 'Решений, ждущих записи, нет.');
            Report::write($this->c, $s);
            $this->describe($s, $r);
            $r->data = ['written' => array_keys($w['written']), 'session' => $this->sessionData($s)];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    // ------------------------------------------------------------------ rollback

    public function rollback(bool $force): Result
    {
        $r = new Result('Откат записей сеанса (rollback)');
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки — откатывать нечего');
            $res = $s->rollback($force, $this->via);
            foreach ($res['restored'] as $t => $how) {
                $r->line("  $how: $t");
            }
            foreach ($res['skipped'] as $t => $why) {
                $r->problem("$t: $why");
            }
            $r->line('Восстановлено файлов: ' . count($res['restored']) . ($res['restored'] ? '; кеш: ' . Bitrix::clearCache($this->c) : ''));
            $this->plan($s, $r);
            Report::write($this->c, $s);
            $r->line('Сеанс остаётся открытым: состояние сайта — как оставил обновлятор. Применить заново — apply.');
            $r->data = $res;
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    // ------------------------------------------------------------------ verify / finish

    /**
     * Проверка открытого сеанса (итог — в session.json и report.md) или последнего завершённого — только для чтения:
     * у завершённого сеанса ничего не пересчитывается и не перезаписывается (session.json, report.md, pages-after.json).
     */
    public function verify(bool $urls, bool $scan): Result
    {
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Session::last($this->c);
            $r = new Result('Проверка (verify)');
            if (!$s) {
                $r->line('Сеансов сверки не было — проверять нечего.');
                if ($urls) {
                    (new Verifier($this->c, $this, null, true))->pages($r);
                }
                return $r;
            }
            $readOnly = !$s->isOpen();
            if ($readOnly) {
                $r->line('Сеанс ' . $s->id() . ' завершён ' . Util::date((int)($s->d['finished'] ?? 0))
                    . ' — проверка только для чтения: session.json, report.md и файлы сеанса не меняются.');
            } else {
                $this->plan($s, $r);
            }
            $v = new Verifier($this->c, $this, $s, $readOnly);
            $v->run($r, $urls, $scan);
            if (!$readOnly) {
                $s->d['verify'] = ['time' => time(), 'code' => $r->code, 'problems' => array_values(array_unique($r->problems)),
                    'warnings' => array_values(array_unique($r->warnings)), 'notes' => $v->notes, 'pages' => $v->pagesInfo];
                $s->save();
                Report::write($this->c, $s);
            }
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    /** Почему страницы для --urls проверить нельзя (null — можно) */
    public function pagesUnavailable(): ?string
    {
        $where = $this->c->configFile !== null ? 'в ' . $this->c->configFile : 'в ' . Config::CONFIG_FILE . ' (файла нет)';
        if (!$this->c->baseUrl) {
            return "не задан адрес сайта — base_url $where или --base-url=";
        }
        if (!$this->c->urls) {
            return "список страниц пуст — urls или urls_file $where, или --urls-file=";
        }
        return null;
    }

    /**
     * Хранилище внутри корня сайта (запасной вариант /bitrix/backup/…): проверить запросом к сайту, что его файлы
     * не отдаются (на nginx .htaccess не действует). Нужен base_url; только из консоли.
     */
    private function probeStore(Result $r): void
    {
        $c = $this->c;
        if (PHP_SAPI !== 'cli' || !$c->baseUrl || !$c->isStoreInsideRoot() || !is_dir($c->store())) {
            return;
        }
        $token = Util::randomName(24);
        $file = $c->store() . '/am-probe-' . Util::randomName(8) . '.txt';
        try {
            Util::put($file, $token);
            $url = rtrim($c->baseUrl, '/') . '/' . str_replace('%2F', '/', rawurlencode(substr($file, strlen($c->root) + 1)));
            $ctx = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10, 'follow_location' => 0],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
            $body = @file_get_contents($url, false, $ctx);
            if (is_string($body) && str_contains($body, $token)) {
                $r->problem("Хранилище снимков отдаётся по HTTP ($url): в нём платный код вендора и наши доработки. Закройте папку в веб-сервере "
                    . '(nginx: location ^~ /bitrix/backup/ { deny all; }) или задайте store вне корня сайта в local/aspro-merge.config.php.');
            }
        } catch (MergeException) {
        } finally {
            @unlink($file);
        }
    }

    /** Страницы для snapshot --urls (страницы «до»); снять нельзя — предупреждение и код 2 */
    public function fetchPages(Result $r): array
    {
        $why = $this->pagesUnavailable();
        if ($why !== null) {
            $r->warn("Страницы «до» не сняты: $why");
            $r->attention();
            return [];
        }
        return Verifier::fetch($this->c->urls, (string)$this->c->baseUrl);
    }

    /**
     * Завершить сеанс: проверка (без страниц), снимок новой версии, бэкапы обновлятора версий сеанса — с сайта в папку
     * сеанса (они отдаются по HTTP; $keepBackups или keep_backups в настройках — оставить), своё уведомление в админке
     * снимается, в журнал событий — «сверка завершена» (из консоли — через ядро в отдельном процессе).
     */
    public function finish(bool $force, bool $keepBackups = false, bool $urls = false): Result
    {
        $r = new Result('Завершение сверки (finish)');
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки');
            $this->plan($s, $r);
            $v = new Result();
            (new Verifier($this->c, $this, $s))->run($v, false, true);
            if ($v->problems && !$force) {
                $r->merge($v);
                $r->attention();
                $r->line('Сеанс не завершён: есть нерешённое или проблемы проверки (принудительно — finish --force).');
                return $r;
            }
            if ($v->problems) {
                $r->warn('Завершено принудительно при проблемах: ' . implode('; ', $v->problems));
            }
            if (empty($s->d['verify']['pages']['checked'])) {
                $r->warn('Страницы сайта в этом сеансе не проверялись (verify --urls) — проверьте их после завершения.');
            }
            $keep = $keepBackups || $this->c->keepBackups;
            $bk = $this->sessionBackups($s);
            if ($bk && !$keep) {
                $r->line($this->moveBackups($bk, "{$s->dir}/backups", $s, $r));
            } elseif ($bk) {
                $r->line('Бэкапы обновлятора версий сеанса оставлены на сайте (' . count($bk) . ($keepBackups ? ', --keep-backups' : ', keep_backups в настройках')
                    . '): они отдаются по HTTP — унести позже, с согласия человека: ' . $this->cmd() . ' archive-backups; закрыть в веб-сервере — '
                    . implode('; ', Updater::denyRules()));
            }
            [$pages, $pagesNote] = $this->pagesForSnapshot($s, $urls, $r);
            $s->d['status'] = Session::FINISHED;
            $s->d['finished'] = time();
            $s->event('сеанс завершён' . ($force ? ' (принудительно)' : ''), $this->via);
            $s->save();
            Report::write($this->c, $s);
            $res = Snapshot::ensure($this->c, $pages !== null ? ['pages' => $pages, 'pages_source' => $pagesNote] : []);
            $r->line($pages !== null ? "Страницы «после» ($pagesNote, " . count($pages) . ") положены в снимок {$res['version']} (pages.json) — база для следующего verify --urls"
                : 'Страниц «после» в снимке нет: ' . $pagesNote);
            @unlink($this->c->store() . '/unsynced.json');
            $removed = Snapshot::rotate($this->c);
            $r->line("Сеанс {$s->id()} завершён ({$s->d['from']} → {$s->d['to']}). Отчёт: {$s->dir}/report.md");
            $r->line("Снимок версии {$res['version']} " . ($res['etalon_created'] ? 'снят' : 'обновлён') . " — база для следующего обновления: {$res['dir']}");
            if ($removed) {
                $r->line('Удалены старые снимки: ' . implode(', ', $removed));
            }
            foreach ($res['warnings'] as $w) {
                $r->warn($w);
            }
            $r->line('Уведомление ' . Config::NOTIFY_TAG . ' в админке: ' . Bitrix::notify($this->c, null));
            $r->line('Журнал событий: ' . Bitrix::log('INFO', 'finish', "Сверка Аспро {$s->d['from']} → {$s->d['to']} завершена"
                . ($force ? ' (принудительно)' : ''), $this->c));
            $this->noticesCheck($r, null);
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    /**
     * Страницы «после» для снимка новой версии (pages.json — база «до» для verify --urls следующего обновления):
     * pages-after.json последнего verify --urls, если он снят после последней записи на сайт; иначе — с $urls снять
     * сейчас; иначе — нет (предупреждение и совет snapshot --urls). [страницы|null, пояснение].
     */
    private function pagesForSnapshot(Session $s, bool $urls, Result $r): array
    {
        $after = Util::jsonRead("{$s->dir}/pages-after.json");
        $lastWrite = 0;
        foreach ($s->d['batches'] as $b) {
            $lastWrite = max($lastWrite, (int)$b['time']);
        }
        $lastWrite = max($lastWrite, ...array_map(static fn($x) => (int)($x['time'] ?? 0), array_values($s->d['resolutions'] ?: [[]])));
        if (is_array($after['pages'] ?? null) && $after['pages'] && (int)($after['time'] ?? 0) >= $lastWrite) {
            return [$after['pages'], 'verify --urls от ' . Util::date((int)$after['time'])];
        }
        $why = $after ? 'verify --urls снят ' . Util::date((int)($after['time'] ?? 0)) . ', до последней записи на сайт (' . Util::date($lastWrite) . ')'
            : 'в сеансе не было verify --urls';
        if ($urls) {
            $p = $this->fetchPages($r);
            if ($p) {
                return [$p, 'сняты при завершении (finish --urls)'];
            }
            return [null, "$why, а снять их сейчас не удалось"];
        }
        $r->warn("Страницы «после» в снимок новой версии не положены ($why): у следующего verify --urls не будет страниц «до» для сравнения — "
            . "снимите их: {$this->cmd()} snapshot --urls (или завершайте с finish --urls).");
        $r->next("{$this->cmd()} snapshot --urls — страницы «после» в снимок новой версии (база для следующего verify --urls)");
        return [null, $why];
    }

    /** Бэкапы обновлятора на сайте с версиями сеанса: от версии до обновления (from) до текущей (to) не включая её */
    private function sessionBackups(Session $s): array
    {
        $from = (string)$s->d['from'];
        $to = (string)$s->d['to'];
        return array_filter(Updater::siteBackups($this->c), static fn($b) => version_compare($b['ver'], $from, '>=') && version_compare($b['ver'], $to, '<'));
    }

    /**
     * Унести бэкапы с сайта в архив ($zipBase без расширения): сначала архив (пути — от корня сайта, плюс manifest.json),
     * затем проверка каждого файла в архиве по хешу и только потом удаление с сайта. Возвращает строку итога.
     */
    private function moveBackups(array $list, string $zipBase, ?Session $s, Result $r): string
    {
        $files = [];
        $man = [];
        foreach ($list as $rel => $b) {
            $h = Util::gitHashFile($b['abs']);
            if ($h === null) {
                continue;
            }
            $files[$rel] = $b['abs'];
            $man[$rel] = ['ver' => $b['ver'], 'mtime' => $b['mtime'], 'size' => $b['size'], 'h' => $h];
        }
        if (!$files) {
            return 'Бэкапов обновлятора для переноса нет.';
        }
        $zip = Archive::writeFiles($zipBase, $files, ['manifest.json' => Util::json(['time' => date('c'), 'site' => $this->c->root,
            'hash' => Session::HASH_FORMAT, 'restore' => 'распаковать в корень сайта (пути — от корня)', 'files' => $man])]);
        $a = Archive::openFile($zip);
        $moved = 0;
        $failed = [];
        foreach ($files as $rel => $abs) {
            $c = $a->get($rel);
            if ($c === null || Util::gitHash($c) !== $man[$rel]['h']) {
                $failed[] = $rel;
                continue;
            }
            if (@unlink($abs)) {
                $moved++;
            } else {
                $failed[] = $rel;
            }
        }
        $a->close();
        $vers = array_values(array_unique(array_map(static fn($m) => $m['ver'], $man)));
        usort($vers, 'version_compare');
        if ($s !== null) {
            $s->d['backups'] = ['moved' => $moved, 'versions' => $vers, 'zip' => $zip, 'time' => time()];
            $s->event("бэкапы обновлятора унесены с сайта в " . basename($zip) . ": $moved", $this->via);
        }
        if ($failed) {
            $r->warn('Не унесены с сайта (не проверились в архиве или не удалились): ' . implode(', ', array_slice($failed, 0, 10)) . (count($failed) > 10 ? ' …' : ''));
        }
        return "Бэкапы обновлятора (версии " . implode(', ', $vers) . ") унесены с сайта: $moved из " . count($files) . " — архив $zip (вернуть — распаковать в корень сайта)";
    }

    /**
     * archive-backups: унести с сайта все бэкапы обновлятора, когда сверка завершена (они отдаются по HTTP, а сверке
     * больше не нужны). Пока сеанс открыт или обновление не сверено, бэкапы — база для сверки: команда отказывается.
     */
    public function archiveBackupsCmd(): Result
    {
        $r = new Result('Бэкапы обновлятора — в хранилище (archive-backups)');
        $lock = $this->lock();
        try {
            if (Session::current($this->c)) {
                Util::fail('Открыт сеанс сверки — бэкапы обновлятора нужны ему как запасная база; finish унесёт бэкапы версий сеанса сам');
            }
            if ($this->pendingUpdate() !== null || !Snapshot::versions($this->c) || is_file($this->c->store() . '/unsynced.json')) {
                Util::fail('Обновление не сверено (или снимков нет) — бэкапы обновлятора сейчас единственная копия прежних версий: сначала сверка (status)');
            }
            $list = Updater::siteBackups($this->c);
            if (!$list) {
                $r->line('Бэкапов обновлятора на сайте нет.');
                return $r;
            }
            $last = Session::last($this->c);
            $base = $last !== null ? "{$last->dir}/backups-" . date('Ymd-His') : $this->c->store(true) . '/backups/' . date('Ymd-His');
            $r->line($this->moveBackups($list, $base, null, $r));
            $r->data = ['zip' => Archive::find($base), 'count' => count($list)];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    /** Бэкапы обновлятора на сайте: сколько, каких версий, отдаются ли по HTTP; что с ними делать */
    private function backupsCheck(Result $r, ?Session $open): void
    {
        $list = Updater::siteBackups($this->c);
        if (!$list) {
            return;
        }
        $byVer = [];
        foreach ($list as $b) {
            $byVer[$b['ver']] = ($byVer[$b['ver']] ?? 0) + 1;
        }
        uksort($byVer, static fn($a, $b) => version_compare((string)$b, (string)$a));
        $probe = Updater::probeBackups($this->c, $list);
        $served = array_values(array_filter($probe, static fn($p) => $p['served']));
        $txt = 'На сайте лежат бэкапы обновлятора (_<файл>.back<версия>): ' . count($list) . ' — '
            . implode(', ', array_map(static fn($v, $n) => "$v: $n", array_keys($byVer), $byVer)) . '; например ' . array_key_first($list) . '. ';
        if ($served) {
            $txt .= 'Они отдаются по HTTP (' . implode(', ', array_map(static fn($p) => "{$p['url']} → {$p['code']}", $served))
                . '): в них исходный код Аспро и наши доработки.';
        } elseif ($probe) {
            $txt .= 'По HTTP не отдаются (проверено: ' . implode(', ', array_map(static fn($p) => "{$p['url']} → {$p['code']}", $probe)) . ').';
        } else {
            $txt .= 'Отдаются ли они по HTTP, не проверено (нет base_url в настройках); обычно отдаются — nginx и Apache такие имена не закрывают.';
        }
        if ($open) {
            $from = (string)$open->d['from'];
            $to = (string)$open->d['to'];
            $mine = count(array_filter($list, static fn($b) => version_compare($b['ver'], $from, '>=') && version_compare($b['ver'], $to, '<')));
            $txt .= " Пока сеанс открыт, бэкапы нужны сверке; finish унесёт бэкапы версий сеанса ($mine) в папку сеанса.";
        } elseif ($this->pendingUpdate() !== null || !Snapshot::versions($this->c) || is_file($this->c->store() . '/unsynced.json')) {
            $txt .= ' Обновление не сверено (или снимков нет) — сейчас бэкапы единственная копия прежних версий: не удаляйте их до сверки.';
        } else {
            $txt .= " Сверке они больше не нужны — с согласия человека унести их в хранилище: {$this->cmd()} archive-backups "
                . '(файлы удаляются с сайта после проверки архива; вернуть — распаковать архив в корень сайта).';
            $r->next("{$this->cmd()} archive-backups — с согласия человека: унести бэкапы обновлятора с сайта (" . count($list) . ') в zip в хранилище');
        }
        $r->warn($txt);
        $r->line('Чтобы бэкапы обновлятора не отдавались по HTTP и в следующий раз (обновлятор кладёт их при каждом обновлении), '
            . 'закройте их имена в веб-сервере — ' . implode('; ', Updater::denyRules()));
        if ($served) {
            $r->attention();
        }
        $r->data['backups'] = ['count' => count($list), 'versions' => $byVer, 'probe' => $probe];
    }

    /**
     * Уведомления в админке: чужие, похожие на сообщения об обновлении или сверке (могли остаться от прежних схем
     * доработок, например MYSITE_ASPRO_SYNC), — перечислить и посоветовать снять; своё после завершения сверки — тоже.
     * Нужно ядро (из консоли — в отдельном процессе); без него — короткая строка.
     */
    private function noticesCheck(Result $r, ?Session $open): void
    {
        if (!$this->c->useCore) {
            return;
        }
        $all = Bitrix::notices($this->c);
        if ($all === null) {
            $r->line('Уведомления в админке: не проверены (ядро Битрикса из консоли не подключается).');
            return;
        }
        $own = array_filter($all, static fn($n) => strcasecmp($n['tag'], Config::NOTIFY_TAG) === 0);
        if ($own && $open === null) {
            $r->warn('В админке осталось уведомление сверки (тег ' . Config::NOTIFY_TAG . '), хотя открытого сеанса нет — снимите: '
                . "{$this->cmd()} notices --drop=" . Config::NOTIFY_TAG);
        }
        $other = Bitrix::relevantNotices($all);
        if (!$other) {
            $r->line('Уведомления в админке: сверки — ' . ($own ? 'есть' : 'нет') . ', чужих об обновлении или сверке — нет (всего уведомлений: ' . count($all) . ').');
        }
        foreach ($other as $n) {
            $r->warn("Уведомление в админке (тег {$n['tag']}, модуль {$n['module']}): «" . mb_substr($n['message'], 0, 200)
                . '» — похоже на сообщение об обновлении или сверке, но оно не от aspro-merge. Если оно устарело (например, осталось от прежней '
                . "схемы доработок), снимите его с согласия человека: {$this->cmd()} notices --drop={$n['tag']} (или крестиком в админке).");
        }
        $r->data['notices'] = ['own' => array_values($own), 'other' => $other];
    }

    /** notices [--drop=<тег>]: уведомления в админке; --drop — снять уведомления с точно таким тегом */
    public function notices(?string $drop): Result
    {
        $r = new Result('Уведомления в админке (notices)');
        if ($drop !== null && $drop !== '') {
            $r->line(Bitrix::dropNotice($this->c, $drop));
        }
        $all = Bitrix::notices($this->c);
        if ($all === null) {
            return $r->error('Ядро Битрикса из консоли не подключается — уведомления не прочитать' . (!$this->c->useCore ? ' (--no-core или use_core => false)' : ''));
        }
        $rel = array_column(Bitrix::relevantNotices($all), 'id');
        $rows = array_map(static fn($n) => [$n['id'], $n['tag'] !== '' ? $n['tag'] : '—', $n['module'],
            strcasecmp($n['tag'], Config::NOTIFY_TAG) === 0 ? 'сверка aspro-merge' : (in_array($n['id'], $rel, true) ? 'похоже на обновление/сверку' : ''),
            mb_substr($n['message'], 0, 90)], $all);
        $r->line('Всего уведомлений: ' . count($all));
        if ($rows) {
            array_push($r->lines, ...Result::table($rows, ['ID', 'Тег', 'Модуль', 'Что это', 'Текст']));
            $r->next("{$this->cmd()} notices --drop=<тег> — снять уведомления с этим тегом (чужие — с согласия человека)");
        }
        $r->data = ['notices' => $all];
        return $r;
    }

    /**
     * init.php, который подключает ядро (от корня сайта): ядро берёт ОДИН файл — local/php_interface/init.php, если он есть,
     * иначе bitrix/php_interface/init.php (getLocalPath). Нет ни одного — local/… (его и создают при внедрении).
     */
    private function activeInit(): string
    {
        foreach (['local/php_interface/init.php', 'bitrix/php_interface/init.php'] as $rel) {
            if (is_file($this->c->abs($rel))) {
                return $rel;
            }
        }
        return 'local/php_interface/init.php';
    }

    /**
     * status: bitrix/php_interface/init.php есть, но не действует — его перекрывает local/php_interface/init.php и не
     * подключает сам. Так бывает, если local/…/init.php создали при внедрении сверки на сайте, где был только bitrix/…
     */
    private function initCheck(Result $r): void
    {
        $local = $this->c->abs('local/php_interface/init.php');
        $bitrix = $this->c->abs('bitrix/php_interface/init.php');
        if (!is_file($local) || !is_file($bitrix) || trim((string)file_get_contents($bitrix)) === '') {
            return;
        }
        $code = preg_replace('~^\s*(//|#).*$~m', '', (string)file_get_contents($local));
        if (!preg_match('~bitrix/php_interface/init\.php~', (string)$code)) {
            $r->warn('Ядро подключает только local/php_interface/init.php, а bitrix/php_interface/init.php тоже есть и из него не подключается — '
                . 'код в bitrix/php_interface/init.php на сайте не работает. Если local/php_interface/init.php создали при внедрении сверки, '
                . 'перенесите строку подключения сверки в bitrix/php_interface/init.php и удалите local/php_interface/init.php (или подключите '
                . 'в нём прежний файл первой строкой: require_once $_SERVER[\'DOCUMENT_ROOT\'] . \'/bitrix/php_interface/init.php\';).');
        }
    }

    /** Строки действующего init.php, которые подключают интеграцию (не закомментированные): [номер строки => текст] */
    private function integrationLines(): array
    {
        $init = $this->c->abs($this->activeInit());
        $out = [];
        foreach (is_file($init) ? (file($init) ?: []) : [] as $i => $l) {
            if (str_contains($l, 'aspro_merge.php') && !preg_match('~^\s*(//|#|\*)~', $l)) {
                $out[$i + 1] = trim($l);
            }
        }
        return $out;
    }

    private static function agentText(array $a): string
    {
        return "ID {$a['id']}, модуль " . ($a['module'] !== '' ? $a['module'] : '—') . ', ' . ($a['active'] === 'N' ? 'выключен' : 'активен')
            . ($a['next'] !== '' ? ", следующий запуск {$a['next']}" : '');
    }

    private function foreignAgentAdvice(): string
    {
        return "снять — с согласия человека: {$this->cmd()} agents --drop-foreign (при удалении сверки — uninstall --remove-foreign-agents; "
            . 'вручную — Настройки → Настройки продукта → Агенты)';
    }

    /** status: свой агент на месте? посторонние агенты сверки (похожие имена прежних версий и самописных схем) */
    private function agentsCheck(Result $r): void
    {
        if (!$this->c->useCore) {
            return;
        }
        $a = Bitrix::agents($this->c);
        if ($a === null || isset($a['error'])) {
            $r->line('Агенты: не проверены (' . ($a === null ? 'ядро Битрикса из консоли не подключается' : 'ошибка ядра: ' . $a['error']) . ').');
            return;
        }
        $connected = (bool)$this->integrationLines();
        $r->line('Агент сверки ' . Bitrix::AGENT . ': ' . ($a['own']
                ? 'зарегистрирован (' . implode('; ', array_map(self::agentText(...), $a['own'])) . ')'
                : 'не зарегистрирован — ' . ($connected
                    ? 'интеграция добавит его сама при заходе в админку (проверяет таблицу агентов не реже раза в час) и после обновления модуля'
                    : 'интеграция не подключена в ' . $this->activeInit() . ' (действующий init.php)')));
        foreach ($a['foreign'] as $f) {
            $r->warn('Посторонний агент сверки «' . $f['name'] . '» (' . self::agentText($f) . '): имя похоже на агент сверки, но это не '
                . Bitrix::AGENT . ' — вероятно, остался от прежней версии сверки или другой схемы обновления Аспро и может вызывать '
                . 'несуществующий код или сверять второй раз; ' . $this->foreignAgentAdvice() . '.');
        }
        $r->data['agents'] = $a;
    }

    /**
     * agents [--drop-foreign]: агент сверки и посторонние агенты сверки (имя похоже на AsproMerge / aspro_merge, но не
     * AsproMergeSite::agent();). --drop-foreign — снять посторонние (свой агент не трогается никогда).
     */
    public function agents(bool $dropForeign): Result
    {
        $r = new Result('Агенты сверки (agents)');
        if ($dropForeign) {
            $d = Bitrix::dropForeignAgents($this->c, false);
            if ($d === null) {
                return $r->error('Ядро Битрикса из консоли не подключается — агенты не снять' . (!$this->c->useCore ? ' (--no-core или use_core => false)' : ''));
            }
            if (isset($d['error'])) {
                $r->error('Посторонние агенты сняты не все: ' . $d['error']);
            }
            $r->line('Снято посторонних агентов сверки: ' . (int)($d['removed'] ?? 0) . ' из ' . count($d['found'] ?? [])
                . (!empty($d['found']) ? ' (' . implode('; ', array_map(static fn($f) => "ID {$f['id']} «{$f['name']}»", $d['found'])) . ')' : ''));
        }
        $a = Bitrix::agents($this->c);
        if ($a === null) {
            return $r->error('Ядро Битрикса из консоли не подключается — агенты не прочитать' . (!$this->c->useCore ? ' (--no-core или use_core => false)' : ''));
        }
        if (isset($a['error'])) {
            return $r->error('Ошибка ядра при чтении агентов: ' . $a['error']);
        }
        $rows = [];
        foreach ($a['own'] as $x) {
            $rows[] = [$x['id'], $x['module'] ?: '—', $x['active'] === 'N' ? 'нет' : 'да', $x['next'] ?: '—', 'сверка aspro-merge', $x['name']];
        }
        foreach ($a['foreign'] as $x) {
            $rows[] = [$x['id'], $x['module'] ?: '—', $x['active'] === 'N' ? 'нет' : 'да', $x['next'] ?: '—', 'посторонний', mb_substr($x['name'], 0, 90)];
        }
        $r->line('Агент сверки ' . Bitrix::AGENT . ': ' . ($a['own'] ? 'зарегистрирован' : 'не зарегистрирован')
            . '; посторонних агентов сверки: ' . count($a['foreign']));
        if ($rows) {
            array_push($r->lines, ...Result::table($rows, ['ID', 'Модуль', 'Активен', 'Следующий запуск', 'Что это', 'Имя']));
        }
        if ($a['foreign']) {
            $r->warn('Посторонние агенты сверки (имя похоже на агент сверки, но не ' . Bitrix::AGENT . ') — вероятно, остались от прежней '
                . 'версии сверки или другой схемы обновления Аспро; ' . $this->foreignAgentAdvice() . '.');
            $r->next("{$this->cmd()} agents --drop-foreign — снять посторонние агенты сверки (с согласия человека; свой агент не трогается)");
        }
        $r->data = ['agents' => $a];
        return $r;
    }

    // ------------------------------------------------------------------ diff / uninstall

    /**
     * diff <файл> [--against=theirs,ours,base,etalon,resolved]: итог (файл на сайте сейчас) против новой версии вендора
     * (theirs — то, что привёз обновлятор; etalon — новый эталон в модуле, если он другой) и против нашей версии до
     * обновления (ours). Сеанс — открытый или последний; только чтение (сеанс не пересчитывается и не сохраняется).
     * Переводы строк и BOM не сравниваются (о том, что отличаются только они, сказано отдельно).
     */
    public function diff(string $file, ?string $against = null): Result
    {
        $r = new Result('Сравнение итога (diff)');
        $s = Session::current($this->c) ?? Session::last($this->c) ?? Util::fail('Сеансов сверки не было — сравнивать не с чем');
        $e = $this->findEntry($s, $file);
        $cur = Util::read($this->c->abs($e['target']));
        $r->line("Файл: {$e['target']} — сеанс {$s->id()} ({$s->d['from']} → {$s->d['to']}, " . ($s->isOpen() ? 'открыт' : 'завершён')
            . '); ' . $e['about'] . '; итог: ' . Planner::outcome($e));
        $a = $this->c->area((string)$e['area']);
        $etalon = null;
        if ($a !== null && (string)$this->c->version() === (string)$s->d['to']) {
            $set = Etalon::current($this->c, $a);
            $etalon = $set->has((string)$e['rel']) ? $set->content((string)$e['rel']) : null;
        }
        $sides = [
            'theirs' => ['новая версия вендора (theirs, ' . $s->d['to'] . ')', $s->blob($e['h']['theirs']), $e['h']['theirs']],
            'ours' => ['наша версия до обновления (ours)', $s->blob($e['h']['ours']), $e['h']['ours']],
            'base' => ['база — версия вендора до обновления (base, ' . $s->d['from'] . ')', $s->blob($e['h']['base']), $e['h']['base']],
            'etalon' => ['новый эталон в модуле (' . ($a ? $this->c->etalon[$a->etalonKey] . '/' . $a->etalonPrefix . $e['rel'] : '?') . ')', $etalon,
                $etalon === null ? null : Util::gitHash($etalon)],
            'resolved' => ['записанное решение', ($e['resolution']['h'] ?? '-') === '-' ? null : $s->blob($e['resolution']['h']), $e['resolution']['h'] ?? null],
        ];
        $want = $against !== null && $against !== '' ? array_map('trim', explode(',', $against)) : ['theirs', 'ours'];
        if ($against === null && $etalon !== null && $sides['theirs'][2] !== null && Util::hashes($etalon)['n'] !== Util::hashes((string)$sides['theirs'][1])['n']) {
            $want[] = 'etalon'; // обновлятор оставил на сайте не то, что в эталоне (точечная правка) — показать и это
        }
        $n = static fn(string $x) => (string)preg_replace("~\r+(?=\n|$)~", '', Util::stripBom(am_to_lf($x)));
        $out = [];
        foreach ($want as $k) {
            if (!isset($sides[$k])) {
                Util::fail("Неизвестная сторона «{$k}» в --against (можно: " . implode(', ', array_keys($sides)) . ')');
            }
            [$label, $content, $hash] = $sides[$k];
            if ($content === null) {
                $r->line("=== итог против: $label — " . ($hash === null || $hash === '-' ? 'такой версии нет (файла не было или решение «удалить»)' : 'содержимого нет в сеансе'));
                continue;
            }
            if ($cur === null) {
                $r->line("=== итог против: $label — файла на сайте нет");
                continue;
            }
            if (!Util::isText($cur) || !Util::isText($content)) {
                $r->line("=== итог против: $label — двоичный файл: " . (Util::gitHash($cur) === Util::gitHash($content) ? 'совпадает побайтно' : 'отличается'));
                continue;
            }
            $d = am_unified($n($content), $n($cur), $k, 'итог');
            if ($d === '') {
                $r->line("=== итог против: $label — совпадает" . ($cur !== $content ? ' (отличаются только переводы строк или BOM)' : ''));
                $out[$k] = ['same' => true];
                continue;
            }
            $plus = preg_match_all('~^\+(?!\+\+ )~m', $d);
            $minus = preg_match_all('~^-(?!-- )~m', $d);
            $r->line("=== итог против: $label — в итоге добавлено строк $plus, нет строк $minus:");
            array_push($r->lines, ...explode("\n", rtrim($d, "\n")));
            $out[$k] = ['same' => false, 'added' => $plus, 'removed' => $minus];
        }
        $r->data = ['entry' => $e['key'], 'target' => $e['target'], 'session' => $s->id(), 'diff' => $out];
        return $r;
    }

    /**
     * uninstall [--dry] [--delete-store --yes] [--force] [--remove-foreign-agents]: снять с сайта то, что сверка
     * регистрирует в базе (своё уведомление ASPRO_MERGE; агент и опцию-кеш main:aspro_merge_agent — когда интеграция уже
     * не подключена в init.php, иначе она добавила бы агент снова) — через ядро в отдельном процессе, и напечатать по
     * шагам, что удалить руками. Посторонние агенты сверки (похожие имена прежних версий) показываются всегда, снимаются —
     * только с --remove-foreign-agents. Хранилище не трогается без --delete-store (и подтверждения --yes). --dry — только
     * показать, ничего не меняя. Пока открыт сеанс сверки — только показ (удалить всё равно — --force).
     */
    public function uninstall(bool $dry, bool $deleteStore, bool $yes, bool $force, bool $removeForeign = false): Result
    {
        $c = $this->c;
        $r = new Result('Удаление сверки Аспро (uninstall)' . ($dry ? ' — только показ: ничего не меняется' : ''));
        $s = Session::current($c);
        if ($s && !$force) {
            $r->problem("Открыт сеанс сверки {$s->d['from']} → {$s->d['to']} ({$s->dir}): до его завершения сайт может работать на смеси версий. "
                . "Сначала завершите сверку ({$this->cmd()} finish) или откатите записи ({$this->cmd()} rollback); удалить всё равно — uninstall --force.");
            $dry = true;
        }
        $init = $c->abs($this->activeInit());
        $initLines = $this->integrationLines();
        $connected = (bool)$initLines;
        // 1. уведомление, агент, опция-кеш, посторонние агенты — через ядро
        $u = $c->useCore ? Bitrix::uninstall($c, $dry, $connected, $removeForeign) : null;
        if ($u === null || isset($u['error'])) {
            $r->attention();
            $r->line('Агент и уведомление: ' . ($u === null ? 'ядро Битрикса из консоли не подключается' . (!$c->useCore ? ' (--no-core или use_core => false)' : '')
                    : 'ошибка ядра: ' . $u['error'])
                . ' — снимите вручную (после шага 1): Настройки → Настройки продукта → Агенты, агент ' . Bitrix::AGENT . ' (модуль main) — удалить, '
                . 'там же — агенты с похожими именами (AsproMerge, aspro_merge) от прежних версий; '
                . 'уведомление сверки в админке — крестиком; опция main:' . Bitrix::AGENT_OPTION . ' остаётся в b_option (не мешает).');
        } else {
            $ag = count($u['agents'] ?? []);
            $nt = count($u['notices'] ?? []);
            $keepWhy = 'интеграция ещё подключена в init.php — она добавила бы агент снова при заходе в админку; после шага 1 запустите uninstall ещё раз';
            $r->line(sprintf('Агент «%s» — %s', Bitrix::AGENT, !$ag ? 'не зарегистрирован'
                : ($connected ? "оставлен ($ag): $keepWhy" : ($dry ? "найден ($ag), будет удалён" : "удалён ({$u['removed']['agents']})"))));
            $r->line('Уведомление ' . Config::NOTIFY_TAG . ' в админке: ' . ($nt ? ($dry ? "есть ($nt) — будет снято" : "снято ({$u['removed']['notices']})") : 'нет'));
            $opt = (string)($u['option'] ?? '');
            $r->line('Опция main:' . Bitrix::AGENT_OPTION . ' (кеш проверки агента): ' . ($opt === '' ? 'нет'
                    : ($connected ? "оставлена ($opt): $keepWhy" : ($dry ? "есть ($opt) — будет удалена" : 'удалена'))));
            $foreign = $u['foreign'] ?? [];
            foreach ($foreign as $f) {
                $what = 'Посторонний агент сверки «' . $f['name'] . '» (' . self::agentText($f) . ')';
                if ($removeForeign) {
                    $r->line("$what — " . ($dry ? 'будет удалён (--remove-foreign-agents)' : 'удалён'));
                } else {
                    $r->warn("$what: имя похоже на агент сверки, но это не " . Bitrix::AGENT . ' — вероятно, остался от прежней версии сверки '
                        . 'или другой схемы обновления Аспро. uninstall его не трогает; снять — с согласия человека: uninstall --remove-foreign-agents '
                        . "(или {$this->cmd()} agents --drop-foreign).");
                }
            }
            if ($removeForeign && !$dry && $foreign && (int)($u['removed']['foreign'] ?? 0) !== count($foreign)) {
                $r->problem('Посторонние агенты сняты не все: ' . (int)($u['removed']['foreign'] ?? 0) . ' из ' . count($foreign) . ' — проверьте в админке (Настройки → Настройки продукта → Агенты)');
            }
            if ($removeForeign && !$foreign) {
                $r->line('Посторонних агентов сверки нет.');
            }
        }
        // 2. что удалить руками — по порядку (сначала строку в init.php: без файла подключения require_once уронит сайт)
        $store = $c->store();
        $pointer = $c->abs(Config::STORE_POINTER);
        $tool = $c->abs('local/tools/aspro-merge');
        $inc = $c->abs('local/php_interface/include/aspro_merge.php');
        $cfg = $c->configFile;
        $urlsFile = isset($c->raw['urls_file']) ? (Util::isAbs((string)$c->raw['urls_file']) ? (string)$c->raw['urls_file'] : $c->abs((string)$c->raw['urls_file'])) : null;
        $ex = static fn(?string $p) => $p !== null && file_exists($p) ? '' : ' (уже нет)';
        $steps = [];
        $steps[] = $connected
            ? "Убрать строку из $init (" . implode('; ', array_map(static fn($n, $l) => "строка $n: $l", array_keys($initLines), $initLines))
                . ') — первой: если удалить файл подключения раньше, require_once остановит весь сайт с фатальной ошибкой'
            : "Строки подключения в $init нет — пропустить";
        if ($connected) {
            $steps[] = "Запустить {$this->cmd()} uninstall ещё раз — снимет агент " . Bitrix::AGENT . ' и опцию main:' . Bitrix::AGENT_OPTION
                . ' (пока строка подключения есть, интеграция добавляет агент снова); до удаления папки инструмента — команда в ней';
        }
        $steps[] = "Удалить файл подключения $inc" . $ex($inc) . ' (события OnModuleUpdate, OnBeforeProlog и агент регистрируются только им — в базе событий нет)';
        $steps[] = "Удалить папку инструмента $tool" . $ex($tool);
        $steps[] = 'Удалить настройки ' . ($cfg ?? $c->abs(Config::CONFIG_FILE)) . $ex($cfg) . ($urlsFile !== null ? " и список страниц $urlsFile" . $ex($urlsFile) : '');
        $steps[] = "Удалить указатель хранилища $pointer" . $ex($pointer);
        $size = is_dir($store) ? sprintf('%.1f МБ', Snapshot::dirSize($store) / 1048576) : 'нет';
        $steps[] = "Хранилище $store ($size): снимки версий (эталоны вендора — платный код), сеансы с тройками и архивами отката, "
            . 'архивы бэкапов обновлятора backups*.zip (прежние версии файлов). Без снимка следующее обновление сверить будет не с чем. '
            . "Удалить — {$this->cmd()} uninstall --delete-store --yes или вручную; оставить — ничего не делать"
            . (basename(dirname($store)) === basename($c->root) && !$c->isStoreInsideRoot() ? '; папка ' . dirname($store) . ' после этого может опустеть — её тоже можно удалить' : '');
        $steps[] = 'По желанию — правила веб-сервера из внедрения (location ^~ /local/tools/ { deny all; } и запрет _*.back*) можно оставить: они не мешают';
        $r->line('Что удалить руками, по порядку:');
        foreach ($steps as $i => $st) {
            $r->line(sprintf('  %d. %s', $i + 1, $st));
        }
        // 3. хранилище — только с --delete-store и подтверждением
        if ($deleteStore) {
            if (!$yes) {
                $r->problem("--delete-store удаляет хранилище $store без возврата (снимки, сеансы, архивы бэкапов) — повторите с --yes, если это точно нужно");
            } elseif ($dry) {
                $r->line("Хранилище $store было бы удалено (--dry: не удаляется)");
            } elseif (!is_dir($store)) {
                $r->line("Хранилища $store нет — удалять нечего");
            } else {
                Util::rrmdir($store);
                $parent = dirname($store);
                $left = is_dir($parent) ? array_diff(scandir($parent) ?: [], ['.', '..', '.htaccess', 'index.php', '.lock', '.lock.who']) : [];
                $r->line(is_dir($store) ? "Хранилище $store удалено не полностью — проверьте права" : "Хранилище $store удалено"
                    . (!$left && is_dir($parent) ? "; папка $parent пуста — её можно удалить вручную" : ''));
                if (!is_dir($store) && is_file($pointer)) {
                    @unlink($pointer);
                    $r->line("Указатель хранилища $pointer удалён");
                }
            }
        } elseif (is_dir($store)) {
            $r->line("Хранилище $store не тронуто (удалить — uninstall --delete-store --yes).");
        }
        if ($dry && !($s && !$force)) {
            $r->next("{$this->cmd()} uninstall — снять уведомление" . ($connected ? '' : ', агент и опцию') . ' (то же без --dry)'
                . ($connected ? '; агент и опцию — после шага 1, вторым запуском' : ''));
        }
        $r->data = ['dry' => $dry, 'core' => $u, 'init_lines' => $initLines, 'store' => $store, 'steps' => $steps];
        return $r;
    }

    // ------------------------------------------------------------------ события сайта

    /** main:OnModuleUpdate — открыть/продолжить сеанс и применить очевидное за ограниченное время */
    public function afterUpdate(array $modules, ?int $timeLimit = null): Result
    {
        $c = $this->c;
        $r = new Result('Обновление решения: автоматическая сверка');
        if (!in_array($c->module, $modules, true)) {
            $r->line('Обновлён не модуль решения — ничего не делаем.');
            return $r;
        }
        // предохранитель и событие обычно работают в одном запросе установки: эталон, прочитанный до установки, устарел
        Etalon::reset();
        $deadline = microtime(true) + ($timeLimit ?? $c->timeLimit);
        $lock = $this->lock(30);
        try {
            $s = $this->session(true, $r, true);
            if (!$s) {
                if (!Snapshot::versions($c)) {
                    // снимать снимок НОВОЙ версии здесь нельзя: он закрепил бы несверенное состояние как базу
                    $ver = (string)$c->version();
                    Util::jsonWrite($c->store(true) . '/unsynced.json', ['version' => $ver, 'time' => time(), 'via' => $this->via]);
                    $msg = sprintf('Обновлено решение Аспро (%s) до %s, но сверить обновление не с чем: снимка версии до него нет, а в журнале '
                        . 'обновлятора нет начала обновления. Обновление НЕ сверено — доработки могли быть перезаписаны (их копии — в бэкапах _*.back*). '
                        . 'Запустите сверку в Claude Code (скил aspro-merge): <code>%s status</code>.', htmlspecialchars($c->module), htmlspecialchars($ver), $this->cmd());
                    $r->line(strip_tags($msg));
                    $r->line('Уведомление: ' . Bitrix::notify($c, $msg));
                    Bitrix::log('WARNING', 'update', strip_tags($msg));
                    $r->attention();
                } else {
                    $r->line('Версия модуля не новее последнего снятого состояния сайта — сверять нечего.');
                }
                return $r;
            }
            $n = $this->applyAuto($s, $r, $deadline, true);
            $counts = $s->counts();
            $att = $s->attention();
            $pending = (int)($counts['auto'] ?? 0);
            $method = $r->data['lint_method'] ?? null;
            $win = Planner::window($s->d['entries']);
            // не «применено N»: отдельно — что записано, что вернули прежним и что из-за этого не действует
            $msg = sprintf('Обновлено решение Аспро (%s) %s → %s. Записано новых версий вендора и слияний: %d%s. Конфликтов: %d; на разбор: %d%s.',
                htmlspecialchars($c->module), htmlspecialchars((string)$s->d['from']), htmlspecialchars((string)$s->d['to']),
                count($win['written']),
                $win['updater'] ? '; версию вендора в недоработанные файлы записал сам обновлятор: ' . count($win['updater']) : '',
                count(array_filter($att, static fn($e) => $e['needs'] === 'conflict')),
                count(array_filter($att, static fn($e) => $e['needs'] !== 'conflict')),
                $pending ? "; не успели применить: $pending" : '');
            foreach (Planner::windowText($win, 4) as $line) {
                $msg .= ' ' . htmlspecialchars($line);
            }
            $msg .= sprintf(' Запустите сверку в Claude Code (скил aspro-merge): <code>%s status</code>.', $this->cmd());
            if ($n < 0) {
                $msg = sprintf('Обновлено решение Аспро (%s) %s → %s, но рассчитать сверку за отведённое время (%d с) не удалось — ничего не применено. '
                    . 'Доработки «на месте» до сверки перезаписаны версией вендора. Запустите сверку в Claude Code (скил aspro-merge): <code>%s apply</code>, затем status.',
                    htmlspecialchars($c->module), htmlspecialchars((string)$s->d['from']), htmlspecialchars((string)$s->d['to']), $timeLimit ?? $c->timeLimit, $this->cmd());
            }
            $openAtt = array_filter($att, static fn($e) => in_array($e['status'], ['conflict', 'review', 'error'], true));
            if ($openAtt && $n >= 0) {
                $msg .= $win['held_ours'] || $win['other']
                    ? ' До сверки сайт работает на смеси версий: в файлах на разбор — прежняя (наша) версия или файл не тронут, а остальные файлы вендора уже новые; '
                        . 'если вендор поменял формат данных сразу в нескольких файлах, связанная функция не работает до решения — решите конфликты сразу.'
                    : ' До сверки в файлах на разбор нет наших доработок (на месте версия вендора) — решите конфликты сразу.';
                $rel = [];
                foreach ($openAtt as $e) {
                    if (!empty($e['related'])) {
                        $rel[] = htmlspecialchars($e['target']) . ' ↔ ' . htmlspecialchars(implode(', ', array_column(array_slice($e['related'], 0, 3), 'target')));
                    }
                }
                if ($rel) {
                    $msg .= ' Возможно связаны (вендор менял те же имена): ' . implode('; ', array_slice($rel, 0, 3)) . '.';
                }
            }
            if ($method !== null) {
                $msg .= $method === 'php -l' ? ' Синтаксис записанных PHP-файлов проверен php -l.'
                    : ' PHP CLI для php -l не найден (' . htmlspecialchars(Util::phpCliInfo($c->phpCli)['how']) . '): синтаксис проверен только разбором '
                    . '(token_get_all), слияния PHP-файлов не записаны — их запишет apply в консоли.';
            }
            if (!$s->d['base']) {
                $msg .= ' Снимка версии до обновления не было — сверка по бэкапам, всё спорное на разбор.';
            }
            foreach ($s->d['warnings'] as $w) {
                if (str_contains($w, 'режим сменился после снимка') || str_contains($w, 'к этому обновлению не относятся')) {
                    $msg .= ' ' . htmlspecialchars($w);
                }
            }
            $r->line(strip_tags($msg));
            $r->line('Уведомление: ' . Bitrix::notify($c, $msg));
            Bitrix::log($att || $n < 0 ? 'WARNING' : 'INFO', 'update', strip_tags($msg));
            if ($att || $pending || $n < 0) {
                $r->attention();
            }
            $r->data = ['written' => $n, 'session' => $this->sessionData($s)];
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    /**
     * Предохранитель на шаге установки: есть ли база для сверки. ['ok' => bool, 'message' => текст].
     * Сеанс открыт — база зафиксирована; перед следующим шагом сохраняются в сеанс файлы «на месте», которые
     * правили на сайте после последнего расчёта (обновлятор может перезаписать их без бэкапа). Модуль обновлён без
     * сеанса (событие не сработало) — открыть сеанс. Иначе — снять/обновить снимок текущей версии.
     */
    public function guard(): array
    {
        $c = $this->c;
        $lock = null;
        try {
            Etalon::reset();
            // дольше, чем длится снимок у агента или в консоли (на большом шаблоне — около минуты): иначе установку
            // остановит обычная занятость хранилища
            $lock = $this->lock(self::GUARD_LOCK_WAIT);
            $s = Session::current($c);
            if ($s) {
                try {
                    $n = $this->capturePreStep($s);
                    $s->save();
                    $note = $n ? "; правок на сайте перед шагом сохранено в сеанс: $n" : '';
                } catch (\Throwable $e) {
                    // база уже зафиксирована — из-за сбоя сохранения правок установку не останавливаем, но говорим об этом
                    $note = '; правки на сайте перед шагом сохранить не удалось: ' . $e->getMessage();
                    Bitrix::log('WARNING', 'guard', 'Сверка Аспро: ' . ltrim($note, '; '));
                }
                return ['ok' => true, 'message' => 'сеанс сверки открыт — база зафиксирована' . $note];
            }
            if ($this->pendingUpdate() !== null) {
                $r = new Result();
                $s = $this->session(true, $r);
                return ['ok' => $s !== null, 'message' => $s ? 'открыт сеанс сверки для прошлого обновления' : 'не удалось открыть сеанс сверки'];
            }
            $ver = (string)$c->version();
            $vs = Snapshot::versions($c);
            $rolled = $vs && version_compare($ver, end($vs), '<');
            $res = Snapshot::ensure($c, []);
            Snapshot::rotate($c);
            if ($rolled) {
                Bitrix::log('WARNING', 'guard', "Сверка Аспро: версия модуля $ver ниже самого нового снимка " . end($vs)
                    . " — сайт откатывали; базой следующего обновления будет снимок $ver, снятый сейчас.");
            }
            return ['ok' => true, 'message' => "снимок версии {$res['version']} " . ($res['etalon_created'] ? 'снят' : 'обновлён') . " за {$res['seconds']} с"
                . ($rolled ? ' (сайт откатывали: есть снимки новее)' : '')];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        } finally {
            Util::unlock($lock);
        }
    }

    /**
     * Перед шагом обновления при открытом сеансе: сохранить в сеанс текущее содержимое файлов «на месте», которые
     * отличаются от всего, что о них известно (их версии вендора, записей инструмента, «нашей» версии; для файлов
     * вне плана — от снимка). Обновлятор перезаписывает папки целиком, а бэкап делает не для всех файлов.
     */
    private function capturePreStep(Session $s): int
    {
        $c = $this->c;
        $ver = (string)$c->version();
        try {
            $base = $this->baseSnapshot($s);
        } catch (MergeException) {
            $base = null; // база пропала — это скажет расчёт плана; сохранить правки можно и без неё
        }
        $n = 0;
        foreach ($c->areas() as $a) {
            if ($a->mode === Area::COPY) {
                continue;
            }
            $E0 = $base?->etalonFor($a) ?? [];
            $I0 = $base?->state($a, 'I') ?? [];
            $rels = array_merge(array_keys($E0), Etalon::current($c, $a)->rels(), array_keys($I0));
            $prefix = $a->id . ':';
            foreach (array_keys($s->d['ours']) as $k) {
                if (str_starts_with($k, $prefix)) {
                    $rels[] = substr($k, strlen($prefix));
                }
            }
            $set = FileSet::listed($c->abs($a->installed), array_unique($rels));
            foreach ($set->rels() as $rel) {
                if ($a->isExcluded($rel)) {
                    continue;
                }
                $h = $set->hash($rel);
                if ($h === null || ($h['big'] ?? 0)) {
                    continue;
                }
                $key = $a->id . ':' . $rel;
                $th = $s->theirs($key);
                $ours = $s->ours($key);
                $expect = [$th['h'] ?? null, $s->lastWrite($a->target($rel))['after'] ?? null, $ours['h'] ?? null];
                if ($th === null && $ours === null) {
                    $expect[] = $I0[$rel]['h'] ?? null;
                }
                if (in_array($h['h'], array_filter($expect), true) || ($s->d['pre'][$key][$ver]['h'] ?? null) === $h['h']) {
                    continue;
                }
                $content = $set->content($rel);
                if ($content !== null) {
                    $s->addPre($key, $ver, $content);
                    $n++;
                }
            }
        }
        if ($n) {
            $s->event("предохранитель перед шагом с $ver: сохранено правок на сайте — $n", $this->via);
        }
        return $n;
    }

    /** Агент раз в сутки: снимок текущей версии, если его нет и нет открытого сеанса; пропущенное обновление — сверка */
    public function agent(): Result
    {
        $c = $this->c;
        $r = new Result('Агент сверки Аспро');
        if (Session::current($c)) {
            $r->line('Открыт сеанс сверки — снимок не делаем.');
            return $r;
        }
        if ($this->pendingUpdate() !== null) {
            $r->line('Модуль обновлён, а сеанса нет (событие OnModuleUpdate не сработало?) — открываем сверку.');
            return $r->merge($this->afterUpdate([$c->module]));
        }
        if (!Snapshot::versions($c) && is_file($c->store() . '/unsynced.json')) {
            // снимков нет, а последнее обновление не сверено: снимок закрепил бы несверенное состояние как базу
            $r->line('Последнее обновление не сверено (снимка до него не было) — снимок не делаем, пока его не сверят или не снимут вручную (snapshot).');
            return $r->attention();
        }
        $lock = $this->lock(30);
        try {
            $res = Snapshot::ensure($c, []);
            Snapshot::rotate($c);
            $r->line("Снимок версии {$res['version']} " . ($res['etalon_created'] ? 'снят' : 'обновлён') . '.');
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    // ------------------------------------------------------------------ обмен без SSH

    public function export(?string $out, bool $all): Result
    {
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки');
            $r = new Result('Выгрузка троек для работы без SSH (export)');
            $this->plan($s, $r);
            Report::write($this->c, $s);
            (new Exchange($this->c, $s))->export($r, $out, $all);
        } finally {
            Util::unlock($lock);
        }
        return $r;
    }

    public function import(string $zip, bool $noApply): Result
    {
        $r = new Result('Загрузка решений (import)');
        $lock = $this->lock();
        try {
            $s = Session::current($this->c) ?? Util::fail('Нет открытого сеанса сверки');
            $this->plan($s, $r);
            $n = (new Exchange($this->c, $s))->import($r, $zip, fn(array $e, string $content) => $this->checkResolution($s, $e, $content));
            $this->plan($s, $r);
            Report::write($this->c, $s);
        } finally {
            Util::unlock($lock);
        }
        if ($n && !$noApply && $r->code !== Result::ERROR) {
            $r->merge($this->applyResolved());
        } elseif ($n) {
            $r->next("{$this->cmd()} apply-resolved — записать принятые решения");
        }
        return $r;
    }

    public function cmdName(): string
    {
        return $this->cmd();
    }
}
