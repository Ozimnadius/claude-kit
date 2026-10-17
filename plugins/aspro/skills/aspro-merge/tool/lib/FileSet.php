<?php
/**
 * Набор файлов папки на диске с ленивыми хешами: rel => abs, хеши считаются только для тех файлов,
 * которые реально сравниваются.
 *
 * Хеши кешируются на время процесса по пути, времени изменения и размеру: предохранитель, событие и повторные
 * расчёты плана в одном запросе не перечитывают нетронутые файлы. Файл, изменённый меньше чем за 2 секунды до
 * хеширования, в кеш не попадает (иначе запись в ту же секунду с тем же размером осталась бы незамеченной).
 * Большие файлы (больше Util::MAX_READ) хешируются потоково и в память целиком не читаются.
 */

declare(strict_types=1);

namespace AsproMerge;

final class FileSet
{
    /** @var array<string,string> rel => abs */
    public array $abs = [];
    private array $hash = [];
    /** abs => [mtime, size, хеши] */
    private static array $statCache = [];

    public static function dir(string $dir): self
    {
        $s = new self();
        $s->abs = Util::walk($dir);
        return $s;
    }

    /** Только перечисленные файлы папки (для публичной части — пути из эталона WP) */
    public static function listed(string $dir, iterable $rels): self
    {
        $s = new self();
        $dir = Util::norm($dir);
        foreach ($rels as $rel) {
            $abs = ($dir === '' ? '' : "$dir/") . $rel;
            if (is_file($abs)) {
                $s->abs[$rel] = $abs;
            }
        }
        ksort($s->abs, SORT_STRING);
        return $s;
    }

    public function has(string $rel): bool
    {
        return isset($this->abs[$rel]);
    }

    public function rels(): array
    {
        return array_keys($this->abs);
    }

    public function hash(string $rel): ?array
    {
        if (!isset($this->abs[$rel])) {
            return null;
        }
        if (!isset($this->hash[$rel])) {
            $h = self::hashOf($this->abs[$rel]);
            if ($h === null) {
                return null;
            }
            $this->hash[$rel] = $h + ['p' => Util::perms($this->abs[$rel])];
        }
        return $this->hash[$rel];
    }

    /** Хеши файла с кешем процесса (см. описание класса) */
    public static function hashOf(string $abs): ?array
    {
        clearstatcache(true, $abs);
        $mt = @filemtime($abs);
        $sz = @filesize($abs);
        if ($mt === false || $sz === false) {
            return null;
        }
        $c = self::$statCache[$abs] ?? null;
        if ($c !== null && $c[0] === $mt && $c[1] === $sz) {
            return $c[2];
        }
        $h = Util::hashesFile($abs);
        if ($h !== null && $mt <= time() - 2) {
            self::$statCache[$abs] = [$mt, $sz, $h];
        } else {
            unset(self::$statCache[$abs]);
        }
        return $h;
    }

    public static function resetCache(): void
    {
        self::$statCache = [];
    }

    /** Содержимое файла; большие (больше Util::MAX_READ) не читаются — null */
    public function content(string $rel): ?string
    {
        return isset($this->abs[$rel]) ? Util::readSmall($this->abs[$rel]) : null;
    }

    /** Забыть хеш (файл переписан) */
    public function refresh(string $rel, ?string $abs = null): void
    {
        unset($this->hash[$rel]);
        if ($abs !== null) {
            if (is_file($abs)) {
                $this->abs[$rel] = $abs;
            } else {
                unset($this->abs[$rel]);
            }
        }
    }
}
