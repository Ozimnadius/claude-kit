<?php
/**
 * Сеанс сверки — всё, что относится к одному обновлению (возможно, из нескольких шагов-версий подряд).
 *
 * <хранилище>/<модуль>/sessions/<id>/
 *   session.json — состояние: версии (from — база, to — текущая), шаги, записи плана, решения, журнал записей;
 *   report.md    — краткий отчёт для человека (пересобирается после каждой команды);
 *   files/<область>/<путь>/ — тройки для разбора: base, ours, theirs, merged (с маркерами), ours.diff, theirs.diff,
 *                  info.json; сюда же Claude кладёт resolved;
 *   blobs/       — содержимое «наших», «их» версий, решений и результатов по git-хешу (чтобы применение было
 *                  идемпотентным и не зависело от уже записанных файлов);
 *   rollback/<NNN>.zip — архив отката каждой пачки записей (прежнее содержимое файлов и список).
 *
 * База сеанса — снимок версии ДО обновления; новый снимок, пока сеанс открыт, не делается.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Session
{
    public const OPEN = 'open';
    public const FINISHED = 'finished';

    /** Как считаются хеши в session.json и именах blobs/ (пишется в session.json — hash_format) */
    public const HASH_FORMAT = 'git blob sha1: sha1("blob <длина в байтах>\0<содержимое>") — как git hash-object <файл>; '
        . 'h.base/ours/theirs/current — хеши версий файла (null — файла нет), blobs/<2 символа>/<хеш> — содержимое';

    public array $d = [];

    private function __construct(public readonly Config $c, public readonly string $dir)
    {
    }

    public static function root(Config $c): string
    {
        return $c->store() . '/sessions';
    }

    /** Открытый сеанс (если есть) */
    public static function current(Config $c): ?self
    {
        $open = null;
        foreach (glob(self::root($c) . '/*/session.json') ?: [] as $f) {
            $d = Util::jsonRead($f);
            if (($d['status'] ?? '') === self::OPEN && ($open === null || $d['opened'] > $open->d['opened'])) {
                $s = new self($c, Util::norm(dirname($f)));
                $s->d = $d;
                $open = $s;
            }
        }
        $open?->reconcile();
        return $open;
    }

    /**
     * Сверить журнал записей с диском: запись с done=false (процесс прервался после записи файла, но до итогового
     * сохранения журнала — убили по таймауту, нехватка памяти, сбой записи session.json), у которой файл на сайте
     * уже равен записанному, считается выполненной — и для отката, и для расчёта плана. Только в памяти: на диск
     * попадёт со следующим save().
     */
    public function reconcile(): int
    {
        $n = 0;
        foreach ($this->d['batches'] ?? [] as $bi => $b) {
            if (!empty($b['reverted'])) {
                continue;
            }
            foreach ($b['writes'] as $wi => $w) {
                if (!empty($w['done']) || !empty($w['error']) || !empty($w['reverted'])) {
                    continue;
                }
                $abs = $this->c->abs($w['target']);
                $cur = is_file($abs) ? Util::gitHashFile($abs) : null;
                if ($cur === $w['after'] && $cur !== $w['before']) {
                    $this->d['batches'][$bi]['writes'][$wi]['done'] = true;
                    $this->d['batches'][$bi]['writes'][$wi]['recovered'] = true;
                    $n++;
                }
            }
        }
        if ($n) {
            $this->event("журнал записей сверен с диском после обрыва: отмечено выполненными $n", 'cli');
        }
        return $n;
    }

    /** Последний сеанс (любой) */
    public static function last(Config $c): ?self
    {
        $last = null;
        foreach (glob(self::root($c) . '/*/session.json') ?: [] as $f) {
            $d = Util::jsonRead($f);
            if ($d && ($last === null || $d['opened'] > $last->d['opened'])) {
                $s = new self($c, Util::norm(dirname($f)));
                $s->d = $d;
                $last = $s;
            }
        }
        $last?->reconcile();
        return $last;
    }

    public static function create(Config $c, ?string $base, string $to, string $via, ?Snapshot $snap, ?string $from = null): self
    {
        $id = ($base ?? 'без-снимка') . '-' . date('Ymd-His');
        $dir = self::root($c) . '/' . $id;
        $n = 1;
        while (is_dir($dir)) {
            $dir = self::root($c) . '/' . $id . '-' . (++$n);
        }
        Util::mkdir($dir, 0750);
        $s = new self($c, $dir);
        $since = $snap ? $snap->stateTime() : (Updater::sessionStart($c) ?? time() - 3600);
        $s->d = [
            'id' => basename($dir),
            'status' => self::OPEN,
            'tool' => Config::TOOL_VERSION,
            'hash_format' => self::HASH_FORMAT,
            'module' => $c->module,
            'template' => $c->template,
            'from' => $base ?? $from,
            'to' => $to,
            'opened' => time(),
            'updated' => time(),
            'via' => $via,
            'base' => $base === null ? null : ['version' => $base, 'state_time' => $snap?->stateTime(), 'dir' => $snap?->dir],
            'backups_since' => $since - 5,
            'steps' => [['to' => $to, 'time' => time(), 'via' => $via]],
            'areas' => array_map(static fn(Area $a) => $a->describe(), $c->areas()),
            'entries' => [],
            'ours' => [],
            'theirs' => [],
            'resolutions' => [],
            'lint' => [],
            'pre' => [],
            'batches' => [],
            'warnings' => [],
            'events' => [['time' => time(), 'what' => 'открыт сеанс' . ($base ? " (база — снимок $base)" : ' без снимка версии до обновления'), 'via' => $via]],
        ];
        $s->save();
        return $s;
    }

    public function save(): void
    {
        $this->d['updated'] = time();
        $this->d['hash_format'] ??= self::HASH_FORMAT; // сеансы, открытые прежней версией инструмента
        Util::jsonWrite("{$this->dir}/session.json", $this->d);
    }

    public function id(): string
    {
        return (string)$this->d['id'];
    }

    public function isOpen(): bool
    {
        return ($this->d['status'] ?? '') === self::OPEN;
    }

    public function event(string $what, string $via = 'cli'): void
    {
        $this->d['events'][] = ['time' => time(), 'what' => $what, 'via' => $via];
        if (count($this->d['events']) > 200) {
            $this->d['events'] = array_slice($this->d['events'], -200);
        }
    }

    /** Отметить шаг обновления (новая версия модуля) */
    public function step(string $to, string $via): bool
    {
        $last = end($this->d['steps']);
        if ($last && $last['to'] === $to) {
            return false;
        }
        $this->d['steps'][] = ['to' => $to, 'time' => time(), 'via' => $via];
        $this->d['to'] = $to;
        $this->event("шаг обновления до $to", $via);
        return true;
    }

    // --- содержимое по хешу ---

    public function putBlob(string $content): string
    {
        $h = Util::gitHash($content);
        $f = $this->blobPath($h);
        if (!is_file($f)) {
            Util::put($f, $content);
        }
        return $h;
    }

    public function blob(?string $h): ?string
    {
        if ($h === null || $h === '' || $h === '-') {
            return null;
        }
        $c = Util::read($this->blobPath($h));
        return ($c !== null && Util::gitHash($c) === $h) ? $c : null;
    }

    private function blobPath(string $h): string
    {
        return "{$this->dir}/blobs/" . substr($h, 0, 2) . "/$h";
    }

    // --- «наша» и «их» версии файла ---
    // «наша» фиксируется при первом появлении файла в плане и меняется, только если файл правили на сайте во время
    // сеанса (тогда прежние хеши — в prev, версия правки — в outside); «их» — что оставил на сайте обновлятор,
    // с версией модуля, на которой это видели в последний раз (seen): по ней правка на сайте отличается от шага обновления.

    /** ['h' => хеш|null (файла не было), 'src' => откуда, 'prev' => [...], 'outside' => версия|null] или null */
    public function ours(string $key): ?array
    {
        return $this->d['ours'][$key] ?? null;
    }

    public function setOurs(string $key, ?string $content, string $src, ?string $hashIfNoContent = null, array $extra = []): array
    {
        $old = $this->d['ours'][$key] ?? null;
        $rec = ['h' => $content === null ? $hashIfNoContent : $this->putBlob($content), 'src' => $src, 'time' => time(),
            'content' => $content !== null] + $extra;
        if ($old !== null && $old['h'] !== $rec['h']) {
            $rec['prev'] = array_values(array_unique(array_filter(array_merge($old['prev'] ?? [], [$old['h']]), static fn($h) => $h !== null)));
        } elseif ($old !== null && isset($old['prev'])) {
            $rec['prev'] = $old['prev'];
        }
        return $this->d['ours'][$key] = $rec;
    }

    /** Дополнить «нашу» версию содержимым (её зафиксировали только хешем, а содержимое нашлось в бэкапе) */
    public function fillOurs(string $key, string $content, string $src): void
    {
        if (isset($this->d['ours'][$key]) && $this->d['ours'][$key]['h'] === Util::gitHash($content)) {
            $this->putBlob($content);
            $this->d['ours'][$key]['content'] = true;
            $this->d['ours'][$key]['src'] .= "; содержимое — из $src";
        }
    }

    public function theirs(string $key): ?array
    {
        return $this->d['theirs'][$key] ?? null;
    }

    public function setTheirs(string $key, ?string $content, ?string $hashIfNoContent = null, ?string $version = null): array
    {
        $rec = ['h' => $content === null ? $hashIfNoContent : $this->putBlob($content), 'time' => time(), 'content' => $content !== null,
            'seen' => $version, 'seen_t' => time()];
        return $this->d['theirs'][$key] = $rec;
    }

    /** Отметить, что на версии $version файл на сайте был как ожидалось (записан инструментом или обновлятором) */
    public function seenTheirs(string $key, string $version): void
    {
        if (isset($this->d['theirs'][$key]) && ($this->d['theirs'][$key]['seen'] ?? null) !== $version) {
            $this->d['theirs'][$key]['seen'] = $version;
            $this->d['theirs'][$key]['seen_t'] = time();
        }
    }

    /** Решение по файлу принято: правка на сайте во время сеанса (если была) больше не требует разбора */
    public function acceptOurs(string $key): void
    {
        if (!empty($this->d['ours'][$key]['outside'])) {
            $this->d['ours'][$key]['accepted'] = $this->d['ours'][$key]['h'];
        }
    }

    /** Состояние файла, снятое предохранителем перед шагом обновления с версии $version */
    public function addPre(string $key, string $version, string $content): void
    {
        $this->d['pre'][$key][$version] = ['h' => $this->putBlob($content), 'time' => time()];
    }

    // --- журнал записей ---

    /** Все записи инструмента по файлу (в порядке пачек, без откаченных) */
    public function writesFor(string $target): array
    {
        $out = [];
        foreach ($this->d['batches'] as $b) {
            if (!empty($b['reverted'])) {
                continue;
            }
            foreach ($b['writes'] as $w) {
                if ($w['target'] === $target && !empty($w['done']) && empty($w['reverted'])) {
                    $out[] = $w + ['batch' => $b['n']];
                }
            }
        }
        return $out;
    }

    public function lastWrite(string $target): ?array
    {
        $w = $this->writesFor($target);
        return $w ? end($w) : null;
    }

    /** Хеши, которые инструмент писал в файл (чтобы не принять свою запись за бэкап «нашей» версии) */
    public function writtenHashes(string $target): array
    {
        return array_values(array_filter(array_map(static fn($w) => $w['after'], $this->writesFor($target))));
    }

    /** Состояния файла после записей инструмента: хеш или '-' (инструмент файл удалил) */
    public function writtenStates(string $target): array
    {
        return array_values(array_map(static fn($w) => $w['after'] ?? '-', $this->writesFor($target)));
    }

    /**
     * Записать пачку файлов на сайт. $items: [target => ['content' => string|null (null — удалить), 'perms' => ?int,
     * 'why' => string, 'key' => string, 'expect' => хеш|null|'-' (каким файл должен быть сейчас)]].
     * Сначала архив отката со всем прежним содержимым, потом запись по одному; каждый шаг — в session.json.
     */
    public function writeBatch(array $items, string $label, string $via): array
    {
        $res = ['written' => [], 'skipped' => [], 'batch' => null];
        if (!$items) {
            return $res;
        }
        $n = count($this->d['batches']) + 1;
        $writes = [];
        $zip = [];
        foreach ($items as $target => $it) {
            if (!$this->allowedTarget($target)) {
                $res['skipped'][$target] = 'путь вне рабочих папок — запись запрещена';
                continue;
            }
            $abs = $this->c->abs($target);
            $before = Util::read($abs);
            $beforeH = $before === null ? null : Util::gitHash($before);
            $expect = $it['expect'] ?? null;
            if ($expect !== null && $expect !== ($beforeH ?? '-')) {
                $res['skipped'][$target] = 'файл изменился после расчёта плана — запустите команду ещё раз';
                continue;
            }
            $after = $it['content'] === null ? null : Util::gitHash($it['content']);
            if ($after === $beforeH) {
                continue; // уже как надо
            }
            if ($before !== null) {
                $zip['files/' . $target] = $before;
            }
            $writes[] = ['target' => $target, 'key' => $it['key'] ?? null, 'why' => $it['why'] ?? '', 'before' => $beforeH,
                'after' => $after, 'perms_before' => $before === null ? null : Util::perms($abs), 'done' => false];
            if ($it['content'] !== null) {
                $this->putBlob($it['content']);
            }
        }
        if (!$writes) {
            return $res;
        }
        $zip['manifest.json'] = Util::json(['session' => $this->id(), 'batch' => $n, 'label' => $label, 'time' => date('c'), 'writes' => $writes]);
        $archive = Archive::write("{$this->dir}/rollback/" . sprintf('%03d', $n), $zip);
        $batch = ['n' => $n, 'label' => $label, 'time' => time(), 'via' => $via, 'archive' => basename($archive), 'writes' => $writes, 'reverted' => false];
        $this->d['batches'][] = $batch;
        $bi = count($this->d['batches']) - 1;
        $this->save(); // журнал до записи: если процесс прервётся, откат всё равно знает, что собирались писать
        foreach ($writes as $wi => $w) {
            $abs = $this->c->abs($w['target']);
            try {
                if ($w['after'] === null) {
                    Util::deleteFile($abs);
                    $work = $this->workRootOf($w['target']);
                    if ($work !== null) {
                        Util::pruneEmptyDirs($abs, $this->c->abs($work)); // не оставлять пустые папки шаблона компонента
                    }
                } else {
                    $content = $items[$w['target']]['content'];
                    $perms = $items[$w['target']]['perms'] ?? null;
                    Util::writeFile($abs, $content, $w['perms_before'] === null ? $perms : null);
                }
                $this->d['batches'][$bi]['writes'][$wi]['done'] = true;
                $res['written'][$w['target']] = $w;
            } catch (\Throwable $e) {
                $this->d['batches'][$bi]['writes'][$wi]['error'] = $e->getMessage();
                $res['skipped'][$w['target']] = $e->getMessage();
            }
        }
        $this->event("записано файлов: " . count($res['written']) . " ($label), архив отката " . basename($archive), $via);
        $this->save();
        $res['batch'] = $n;
        return $res;
    }

    /** Рабочая папка области, в которой лежит файл (для публичной части — null: пустые папки там не удаляются) */
    private function workRootOf(string $target): ?string
    {
        foreach ($this->c->areas() as $a) {
            $w = $a->work();
            if ($a->kind !== 'pub' && $w !== '' && str_starts_with($target, "$w/")) {
                return $w;
            }
        }
        return null;
    }

    /** Писать можно только в рабочие папки областей (и только в публичные файлы из эталона) */
    public function allowedTarget(string $target): bool
    {
        if (!Util::safeRel($target) || Util::isServiceFile($target)) {
            return false;
        }
        foreach ($this->c->areas() as $a) {
            $w = $a->work();
            if ($a->kind === 'pub') {
                $rel = $w === '' ? $target : (str_starts_with($target, "$w/") ? substr($target, strlen($w) + 1) : null);
                if ($rel !== null && (Etalon::current($this->c, $a)->has($rel) || isset(($this->d['entries'][$a->id . ':' . $rel] ?? null)['key']))) {
                    return true;
                }
                continue;
            }
            if ($w !== '' && str_starts_with($target, "$w/")) {
                return true;
            }
        }
        return false;
    }

    /**
     * Откат: каждый файл возвращается к состоянию до первой записи инструмента в непрерывной цепочке его записей
     * (если между записями файл менял кто-то другой — например, следующий шаг обновлятора, — цепочка начинается заново).
     * Файл, изменённый после последней записи инструмента, без --force не трогается.
     */
    public function rollback(bool $force, string $via): array
    {
        $chains = [];
        foreach ($this->d['batches'] as $bi => $b) {
            if (!empty($b['reverted'])) {
                continue;
            }
            foreach ($b['writes'] as $w) {
                if (empty($w['done']) || !empty($w['reverted'])) {
                    continue;
                }
                $t = $w['target'];
                if (!isset($chains[$t]) || $w['before'] !== $chains[$t]['last']['after']) {
                    $chains[$t] = ['start' => $w + ['bi' => $bi], 'last' => $w];
                } else {
                    $chains[$t]['last'] = $w;
                }
            }
        }
        $res = ['restored' => [], 'skipped' => []];
        $archives = [];
        foreach ($chains as $t => $ch) {
            $abs = $this->c->abs($t);
            $cur = Util::read($abs);
            $curH = $cur === null ? null : Util::gitHash($cur);
            if ($curH !== $ch['last']['after'] && !$force) {
                $res['skipped'][$t] = 'файл изменён после записи инструмента (откат с --force вернёт его принудительно)';
                continue;
            }
            $start = $ch['start'];
            if ($start['before'] === null) {
                Util::deleteFile($abs);
            } else {
                $b = $this->d['batches'][$start['bi']];
                $archives[$b['n']] ??= Archive::openFile("{$this->dir}/rollback/{$b['archive']}");
                $content = $archives[$b['n']]->get('files/' . $t);
                if ($content === null || Util::gitHash($content) !== $start['before']) {
                    $res['skipped'][$t] = 'в архиве отката нет прежнего содержимого (архив повреждён?)';
                    continue;
                }
                Util::writeFile($abs, $content, $start['perms_before']);
            }
            $res['restored'][$t] = $start['before'] === null ? 'удалён (его не было)' : 'восстановлен';
            foreach ($this->d['batches'] as $bi => $b) {
                foreach ($b['writes'] as $wi => $w) {
                    if ($w['target'] === $t) {
                        $this->d['batches'][$bi]['writes'][$wi]['reverted'] = true;
                        // решение откатили — событие следующего шага не должно записать его заново само
                        if (($w['key'] ?? null) !== null && isset($this->d['resolutions'][$w['key']])) {
                            unset($this->d['resolutions'][$w['key']]['applied']);
                        }
                    }
                }
            }
        }
        foreach ($archives as $a) {
            $a->close();
        }
        foreach ($this->d['batches'] as $bi => $b) {
            $left = array_filter($b['writes'], static fn($w) => !empty($w['done']) && empty($w['reverted']));
            $this->d['batches'][$bi]['reverted'] = !$left;
        }
        $this->event('откат: восстановлено ' . count($res['restored']) . ', пропущено ' . count($res['skipped']), $via);
        $this->save();
        return $res;
    }

    // --- тройки для разбора ---

    public function filesDir(string $areaId, string $rel): string
    {
        return "{$this->dir}/files/$areaId/$rel";
    }

    public function relToSession(string $abs): string
    {
        return substr($abs, strlen($this->dir) + 1);
    }

    /** Все записи, которым нужен разбор (конфликт/ручной разбор/решение не применено) */
    public function attention(): array
    {
        return array_filter($this->d['entries'], static fn($e) => in_array($e['status'], ['conflict', 'review', 'resolved', 'error'], true));
    }

    public function counts(): array
    {
        $n = [];
        foreach ($this->d['entries'] as $e) {
            $n[$e['status']] = ($n[$e['status']] ?? 0) + 1;
        }
        return $n;
    }
}
