<?php
/**
 * Снимок версии — база для слияния после следующего обновления.
 *
 * <хранилище>/<модуль>/<версия>/
 *   etalon.zip   — текстовые файлы эталонов текущей версии: W/…, WP/…, C/… (обновлятор их перезапишет без бэкапа);
 *   etalon.json  — хеши всех файлов эталонов (и двоичных);
 *   state.zip    — копии доработанных файлов рабочих папок («наша» версия): <область>/I/… (установленная папка),
 *                  <область>/L/… (копия) — текстовые файлы, которых нет в эталоне или которые от него отличаются,
 *                  и двоичные файлы эталона, которые от него отличаются (до MAX_STORE; что не влезло — в предупреждениях);
 *   state.json   — хеши (и время изменения) всех файлов рабочих папок по областям (видно, что правили, что удалили);
 *   meta.json    — версия, режимы, время, предупреждения; pages.json — страницы «до» (snapshot --urls; finish кладёт
 *                  сюда страницы «после» из verify --urls сеанса — они станут «до» для следующего обновления).
 * <хранилище>/<модуль>/seen.json — версия и время, на которых в последний раз снимали состояние сайта: по ним
 *   видно, что после этого было обновление (даже если сайт откатывали и снимок новой версии уже есть).
 *
 * Эталон создаётся один раз на версию; повторный вызов только обновляет state (список доработанных файлов).
 * Файлы снимка не называются _*.back* (их удаляет обновлятор).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Snapshot
{
    public const MAX_STORE = Util::MAX_READ;

    public array $meta = [];
    private ?array $etalonIndex = null;
    private ?Archive $etalonZip = null;
    private ?array $stateIndex = null;
    private ?Archive $stateZip = null;
    private bool $stateZipOpened = false;

    private function __construct(public readonly Config $c, public readonly string $version, public readonly string $dir)
    {
    }

    public static function dirFor(Config $c, string $version): string
    {
        return $c->store() . '/' . $version;
    }

    public static function isComplete(string $dir): bool
    {
        return is_file("$dir/meta.json") && is_file("$dir/etalon.json") && Archive::exists("$dir/etalon") && is_file("$dir/state.json");
    }

    /** Версии, для которых есть готовый снимок, по возрастанию */
    public static function versions(Config $c): array
    {
        $out = [];
        foreach (glob($c->store() . '/*', GLOB_ONLYDIR) ?: [] as $d) {
            $v = basename($d);
            if (preg_match('/^\d+(\.\d+)*$/', $v) && self::isComplete($d)) {
                $out[] = $v;
            }
        }
        usort($out, 'version_compare');
        return $out;
    }

    /** Последний снимок версии строго ниже $below (или вообще последний) */
    public static function latest(Config $c, ?string $below = null): ?string
    {
        $vs = self::versions($c);
        if ($below !== null) {
            $vs = array_values(array_filter($vs, static fn($v) => version_compare($v, $below, '<')));
        }
        return $vs ? end($vs) : null;
    }

    public static function load(Config $c, string $version): ?self
    {
        $dir = self::dirFor($c, $version);
        if (!self::isComplete($dir)) {
            return null;
        }
        $s = new self($c, $version, $dir);
        $s->meta = Util::jsonRead("$dir/meta.json") ?? [];
        return $s;
    }

    // --- создание ---

    /**
     * Снять или обновить снимок текущей версии. Опции: state (bool, по умолчанию true) — обновить список доработанных
     * файлов; force — пересоздать эталон; pages — массив результатов страниц «до».
     */
    public static function ensure(Config $c, array $opt = []): array
    {
        $version = $c->version();
        if ($version === null) {
            Util::fail("Не прочитана версия модуля из {$c->versionFile}");
        }
        $t0 = microtime(true);
        Etalon::reset();
        $dir = self::dirFor($c, $version);
        Util::mkdir($dir, 0750);
        $res = ['version' => $version, 'dir' => $dir, 'etalon_created' => false, 'state_updated' => false, 'warnings' => []];
        $meta = Util::jsonRead("$dir/meta.json") ?? [];
        if (!is_file("$dir/etalon.json") || !Archive::exists("$dir/etalon") || !empty($opt['force'])) {
            $res['etalon'] = self::buildEtalon($c, $dir, $version);
            $res['etalon_created'] = true;
            $meta['created'] = time();
        }
        $snap = new self($c, $version, $dir);
        if (($opt['state'] ?? true) || !is_file("$dir/state.json")) {
            $res['state'] = $snap->buildState();
            $res['state_updated'] = true;
            $meta['state_time'] = $res['state']['time'];
            self::markSeen($c, $version, (int)$res['state']['time']);
        }
        Util::cleanStaleTmp($c->store());
        if (isset($opt['pages'])) {
            Util::jsonWrite("$dir/pages.json", ['time' => time(), 'base_url' => $c->baseUrl, 'pages' => $opt['pages']]
                + (isset($opt['pages_source']) ? ['source' => (string)$opt['pages_source']] : []));
        }
        $res['warnings'] = array_merge($snap->warnings(), $res['state']['warnings'] ?? []);
        $meta = array_replace($meta, [
            'tool' => Config::TOOL_VERSION,
            'module' => $c->module,
            'template' => $c->template,
            'version' => $version,
            'created' => $meta['created'] ?? time(),
            'state_time' => $meta['state_time'] ?? time(),
            'areas' => array_map(static fn(Area $a) => $a->describe(), $c->areas()),
            'warnings' => $res['warnings'],
            'php' => PHP_VERSION,
        ]);
        Util::jsonWrite("$dir/meta.json", $meta);
        $snap->meta = $meta;
        $res['seconds'] = round(microtime(true) - $t0, 1);
        $res['time'] = $meta['state_time'];
        return $res;
    }

    private static function buildEtalon(Config $c, string $dir, string $version): array
    {
        $index = ['version' => $version, 'created' => time(), 'roots' => $c->etalon, 'files' => []];
        $entries = [];
        $bytes = 0;
        foreach ($c->etalon as $key => $rel) {
            $index['files'][$key] = [];
            foreach (Util::walk($c->abs($rel)) as $r => $abs) {
                $h = FileSet::hashOf($abs);
                if ($h === null) {
                    continue;
                }
                $index['files'][$key][$r] = $h;
                if ($h['t'] && $h['s'] <= self::MAX_STORE) {
                    $content = Util::read($abs);
                    if ($content !== null && Util::gitHash($content) === $h['h']) {
                        $entries["$key/$r"] = $content;
                        $bytes += strlen($content);
                    }
                }
            }
        }
        if (!$index['files']['W']) {
            Util::fail("Эталон шаблона пуст: {$c->etalon['W']}");
        }
        Archive::write("$dir/etalon", $entries);
        Util::jsonWrite("$dir/etalon.json", $index);
        return ['files' => array_map('count', $index['files']), 'stored' => count($entries), 'bytes' => $bytes];
    }

    /**
     * Список файлов рабочих папок с хешами + копии доработанных. Хеш файла, у которого время изменения и размер
     * те же, что в прошлом списке этой версии (и он не менялся в последние секунды перед прошлым снимком), берётся
     * из прошлого списка — предохранитель перед каждым шагом не перечитывает весь шаблон.
     */
    private function buildState(): array
    {
        $c = $this->c;
        $prev = is_file("{$this->dir}/state.json") ? (Util::jsonRead("{$this->dir}/state.json") ?? []) : [];
        $prevTime = (int)($prev['time'] ?? 0);
        $prevZip = null;
        $state = ['version' => $this->version, 'time' => time(), 'areas' => []];
        $entries = [];
        $counts = [];
        $skipped = [];
        foreach ($c->areas() as $a) {
            $ref = $this->etalonFor($a);
            $sides = ['I' => $this->currentInstalled($a, $ref)];
            if ($a->mode === Area::COPY) {
                $sides['L'] = FileSet::dir($c->abs((string)$a->copy));
            }
            $st = ['mode' => $a->mode, 'work' => $a->work(), 'I' => [], 'L' => []];
            foreach ($sides as $side => $set) {
                $old = $prev['areas'][$a->id][$side] ?? [];
                foreach ($set->rels() as $rel) {
                    $abs = $set->abs[$rel];
                    $mt = (int)@filemtime($abs);
                    $o = $old[$rel] ?? null;
                    if ($o !== null && isset($o['m'], $o['s']) && $o['m'] === $mt && $o['s'] === (int)@filesize($abs) && $mt <= $prevTime - 2) {
                        $h = $o; // не менялся с прошлого снимка
                    } else {
                        $h = $set->hash($rel);
                        if ($h === null) {
                            continue;
                        }
                        unset($h['p']);
                        $h['m'] = $mt;
                    }
                    $st[$side][$rel] = $h;
                    $e = $ref[$rel] ?? null;
                    $modified = $e === null || $e['h'] !== $h['h'];
                    // текст — всегда (и свой, и изменённый); двоичный — только изменённый файл вендора (своих картинок может быть много)
                    if (!$modified || (!$h['t'] && $e === null)) {
                        continue;
                    }
                    if ($h['s'] > self::MAX_STORE) {
                        if ($e !== null) {
                            $skipped[] = $a->target($rel);
                        }
                        continue;
                    }
                    $content = null;
                    if ($h === $o) {
                        $prevZip ??= Archive::open("{$this->dir}/state") ?? false;
                        $content = $prevZip ? $prevZip->get("{$a->id}/$side/$rel") : null;
                    }
                    if ($content === null || Util::gitHash($content) !== $h['h']) {
                        $content = Util::read($abs);
                    }
                    if ($content !== null && Util::gitHash($content) === $h['h']) {
                        $entries["{$a->id}/$side/$rel"] = $content;
                    }
                }
            }
            $counts[$a->id] = ['I' => count($st['I']), 'L' => count($st['L'])];
            $state['areas'][$a->id] = $st;
        }
        if ($prevZip) {
            $prevZip->close();
        }
        Archive::write("{$this->dir}/state", $entries);
        Util::jsonWrite("{$this->dir}/state.json", $state);
        $this->stateIndex = $state;
        $this->stateZip = null;
        $this->stateZipOpened = false;
        $warnings = [];
        if ($skipped) {
            $warnings[] = 'Доработанные файлы больше ' . (self::MAX_STORE >> 20) . ' МБ в снимок не сохранены (' . count($skipped) . ' шт., например '
                . $skipped[0] . '): если обновлятор их перезапишет, «наша» версия останется только в его бэкапе _<файл>.back<версия> — сохраните их отдельно.';
        }
        return ['time' => $state['time'], 'stored' => count($entries), 'counts' => $counts, 'warnings' => $warnings];
    }

    /**
     * Отметить, что состояние сайта на версии $version снято в $time (seen.json). Вместе с ним — последняя строка
     * запуска обновлятора: если потом в журнале появится другой запуск до этой же версии, сайт откатывали и обновили снова.
     */
    public static function markSeen(Config $c, string $version, int $time): void
    {
        $runs = Updater::runs($c);
        $last = $runs ? end($runs) : null;
        Util::jsonWrite($c->store(true) . '/seen.json', ['version' => $version, 'time' => $time, 'last_run' => $last['line'] ?? '',
            'tool' => Config::TOOL_VERSION]);
    }

    /**
     * Когда и на какой версии в последний раз снимали состояние сайта: seen.json, а для хранилищ без него —
     * снимок с самым поздним списком доработанных файлов. ['version', 'time', 'last_run'?] или null (снимков нет).
     */
    public static function seen(Config $c): ?array
    {
        $s = Util::jsonRead($c->store() . '/seen.json');
        if (is_string($s['version'] ?? null) && self::load($c, $s['version']) !== null) {
            return ['version' => $s['version'], 'time' => (int)($s['time'] ?? 0)] + (isset($s['last_run']) ? ['last_run' => (string)$s['last_run']] : []);
        }
        $best = null;
        foreach (self::versions($c) as $v) {
            $t = (int)(Util::jsonRead(self::dirFor($c, $v) . '/meta.json')['state_time'] ?? 0);
            if ($best === null || $t >= $best['time']) {
                $best = ['version' => $v, 'time' => $t];
            }
        }
        return $best;
    }

    /** Установленные файлы области сейчас (для публичной части — только пути из эталона) */
    public function currentInstalled(Area $a, ?array $ref = null): FileSet
    {
        $c = $this->c;
        if ($a->kind === 'pub') {
            $rels = array_keys($ref ?? $this->etalonFor($a));
            $cur = array_keys(Etalon::current($c, $a)->abs);
            return FileSet::listed($c->abs($a->installed), array_unique(array_merge($rels, $cur)));
        }
        return FileSet::dir($c->abs($a->installed));
    }

    // --- чтение ---

    public function etalonIndex(): array
    {
        if ($this->etalonIndex === null) {
            $this->etalonIndex = Util::jsonRead("{$this->dir}/etalon.json") ?? Util::fail("Повреждён снимок {$this->dir}: нет etalon.json");
        }
        return $this->etalonIndex;
    }

    /** Хеши эталона области (пути — относительно области) */
    public function etalonFor(Area $a): array
    {
        $all = $this->etalonIndex()['files'][$a->etalonKey] ?? [];
        if ($a->etalonPrefix === '') {
            return $all;
        }
        $out = [];
        $len = strlen($a->etalonPrefix);
        foreach ($all as $rel => $h) {
            if (strncmp($rel, $a->etalonPrefix, $len) === 0) {
                $out[substr($rel, $len)] = $h;
            }
        }
        return $out;
    }

    public function etalonContent(Area $a, string $rel): ?string
    {
        $h = $this->etalonFor($a)[$rel] ?? null;
        if ($h === null) {
            return null;
        }
        $this->etalonZip ??= Archive::open("{$this->dir}/etalon");
        $c = $this->etalonZip?->get($a->etalonKey . '/' . $a->etalonPrefix . $rel);
        return ($c !== null && Util::gitHash($c) === $h['h']) ? $c : null; // защита от подмены и порчи
    }

    public function stateIndex(): array
    {
        if ($this->stateIndex === null) {
            $this->stateIndex = Util::jsonRead("{$this->dir}/state.json") ?? Util::fail("Повреждён снимок {$this->dir}: нет state.json");
        }
        return $this->stateIndex;
    }

    public function stateTime(): int
    {
        return (int)($this->stateIndex()['time'] ?? 0);
    }

    public function stateMode(Area $a): ?string
    {
        return $this->stateIndex()['areas'][$a->id]['mode'] ?? null;
    }

    /** Хеши рабочих файлов области на момент снимка: $side — I (установленная папка) или L (копия) */
    public function state(Area $a, string $side): array
    {
        return $this->stateIndex()['areas'][$a->id][$side] ?? [];
    }

    public function stateContent(Area $a, string $side, string $rel): ?string
    {
        $h = $this->state($a, $side)[$rel] ?? null;
        if ($h === null) {
            return null;
        }
        $e = $this->etalonFor($a)[$rel] ?? null;
        if ($e !== null && $e['h'] === $h['h']) {
            return $this->etalonContent($a, $rel);
        }
        if (!$this->stateZipOpened) {
            $this->stateZip = Archive::open("{$this->dir}/state");
            $this->stateZipOpened = true;
        }
        $c = $this->stateZip?->get("{$a->id}/$side/$rel");
        return ($c !== null && Util::gitHash($c) === $h['h']) ? $c : null;
    }

    public function pages(): array
    {
        return Util::jsonRead("{$this->dir}/pages.json")['pages'] ?? [];
    }

    /** Предупреждения по состоянию на момент снимка */
    public function warnings(): array
    {
        $c = $this->c;
        $w = [];
        foreach ($c->areas() as $a) {
            $ref = $this->etalonFor($a);
            $inst = $this->state($a, 'I');
            // настоящее отличие: не только переводы строк и не только незначащие пробелы ($sa/$sb — откуда содержимое)
            $real = function (array $h, ?array $e, string $rel, string $sa = 'I', ?string $sb = null) use ($a): bool {
                if ($a->isExcluded($rel)) {
                    return false;
                }
                if ($e === null) {
                    return true;
                }
                if ($e['n'] === $h['n']) {
                    return false;
                }
                $other = $sb === null ? $this->etalonContent($a, $rel) : $this->stateContent($a, $sb, $rel);
                return !Util::wsSame($this->stateContent($a, $sa, $rel), $other);
            };
            if ($a->mode === Area::COPY) {
                $edited = [];
                foreach ($inst as $rel => $h) {
                    $e = $ref[$rel] ?? null;
                    if ($e !== null && $real($h, $e, $rel)) {
                        $edited[] = $rel;
                    }
                }
                if ($edited) {
                    $w[] = "Режим «копия» ({$a->title}), но установленная папка {$a->installed} отличается от эталона в "
                        . count($edited) . ' ' . Util::plural(count($edited), 'файле', 'файлах', 'файлах') . ' (правили её напрямую?): '
                        . implode(', ', array_slice($edited, 0, 8)) . (count($edited) > 8 ? ' …' : '')
                        . '. Бэкапы обновлятора для них будут «нашей» версией, а не базой; перенесите правку в копию.';
                }
                $copy = $this->state($a, 'L');
                $behind = 0;
                $mods = [];
                foreach ($copy as $rel => $h) {
                    if ($real($h, $inst[$rel] ?? null, $rel, 'L', 'I')) {
                        $mods[$rel] = $h;
                        if (isset($inst[$rel])) {
                            $behind++;
                        }
                    }
                }
                if ($behind > 150) {
                    $w[] = "Копия {$a->copy} отличается от {$a->installed} в $behind файлах — похоже, копия снята со старой версии: "
                        . '«доработками» станут отставания от вендора. Сначала обновите копию до текущей версии.';
                }
            } else {
                $mods = array_filter($inst, static fn($h, $rel) => isset($ref[$rel]) && $real($h, $ref[$rel], $rel), ARRAY_FILTER_USE_BOTH);
                if (count($mods) > 150) {
                    $w[] = "{$a->title}: отличается от эталона в " . count($mods) . ' файлах — часть отличий может быть отставанием от эталона, а не доработкой; просмотрите список.';
                }
            }
            $side = $a->mode === Area::COPY ? $this->state($a, 'L') : $inst;
            foreach (array_keys($mods) as $rel) {
                if (preg_match('/^(.+)\.(js|css)$/', $rel, $m) && !str_ends_with($m[1], '.min')) {
                    $min = "$m[1].min.$m[2]";
                    if (isset($side[$min]) && !isset($mods[$min])) {
                        $w[] = "Доработан {$a->work()}/$rel, а $min — вендорский: при включённой минификации Битрикс отдаёт из пары более свежий файл, и после обновления, переписавшего .min, правка перестанет быть видна.";
                    }
                }
            }
        }
        // застарелые бэкапы: обновлятор не перезапишет _X.back<текущая версия>
        $stale = [];
        foreach ($c->areas() as $a) {
            $dir = $c->abs($a->installed);
            $list = $a->kind === 'pub' ? $this->publicBackups($a) : Util::walkBackups($dir);
            foreach ($list as $rel => $abs) {
                if (str_ends_with($rel, '.back' . $this->version)) {
                    $stale[] = $a->installedPath($rel);
                }
            }
        }
        if ($stale) {
            $w[] = 'Есть бэкапы обновлятора с суффиксом .back' . $this->version . ' (' . count($stale) . ' шт., например ' . $stale[0]
                . '): обновлятор их НЕ перезапишет, и после обновления они не будут отражать состояние на момент обновления. '
                . 'Сверка берёт «нашу» версию из снимка, но лучше унести их до установки: php local/tools/aspro-merge/merge.php archive-backups.';
        }
        foreach ($c->storeWarnings() as $sw) {
            $w[] = $sw;
        }
        return $w;
    }

    /** Бэкапы публичных файлов из эталона: rel бэкапа => abs */
    private function publicBackups(Area $a): array
    {
        $out = [];
        $base = $this->c->abs($a->installed);
        $dirs = [];
        foreach (array_keys($this->etalonFor($a)) as $rel) {
            $dirs[dirname($rel)] = true;
        }
        foreach (array_keys($dirs) as $d) {
            $p = $d === '.' ? $base : "$base/$d";
            foreach (glob("$p/_*.back*") ?: [] as $f) {
                $out[($d === '.' ? '' : "$d/") . basename($f)] = Util::norm($f);
            }
        }
        return $out;
    }

    /**
     * Удалить старое: снимки — оставить $keep последних, базу открытого сеанса и снимок последнего состояния
     * сайта (seen.json); завершённые сеансы — оставить $keep последних (открытый не трогается никогда).
     */
    public static function rotate(Config $c, array $protect = []): array
    {
        $vs = self::versions($c);
        $removed = [];
        $keep = array_slice($vs, -$c->keepVersions);
        $open = Session::current($c);
        if ($open && !empty($open->d['base']['version'])) {
            $protect[] = (string)$open->d['base']['version'];
        }
        $seen = self::seen($c);
        if ($seen) {
            $protect[] = $seen['version'];
        }
        foreach ($vs as $v) {
            if (!in_array($v, $keep, true) && !in_array($v, $protect, true)) {
                Util::rrmdir(self::dirFor($c, $v));
                $removed[] = $v;
            }
        }
        $finished = [];
        foreach (glob(Session::root($c) . '/*/session.json') ?: [] as $f) {
            $d = Util::jsonRead($f);
            if ($d !== null && ($d['status'] ?? '') === Session::FINISHED) {
                $finished[dirname($f)] = (int)($d['finished'] ?? $d['opened'] ?? 0);
            }
        }
        arsort($finished);
        foreach (array_slice(array_keys($finished), $c->keepVersions) as $dir) {
            Util::rrmdir($dir);
            $removed[] = 'сеанс ' . basename($dir);
        }
        return $removed;
    }

    /** Размер папки в байтах (для status) */
    public static function dirSize(string $dir): int
    {
        $n = 0;
        if (!is_dir($dir)) {
            return 0;
        }
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::LEAVES_ONLY, \RecursiveIteratorIterator::CATCH_GET_CHILD);
        foreach ($it as $f) {
            $n += $f->isFile() ? (int)$f->getSize() : 0;
        }
        return $n;
    }
}

/** Текущие эталоны в модуле (то, что лежит на диске сейчас) */
final class Etalon
{
    private static array $cache = [];

    public static function current(Config $c, Area $a): FileSet
    {
        $key = $c->root . '|' . $a->etalonKey . '|' . $a->etalonPrefix;
        if (!isset(self::$cache[$key])) {
            $dir = $c->abs($c->etalon[$a->etalonKey]) . ($a->etalonPrefix !== '' ? '/' . rtrim($a->etalonPrefix, '/') : '');
            self::$cache[$key] = FileSet::dir($dir);
        }
        return self::$cache[$key];
    }

    public static function reset(): void
    {
        self::$cache = [];
    }
}
