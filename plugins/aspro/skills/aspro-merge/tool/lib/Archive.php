<?php
/**
 * Архивы снимков, откатов и выгрузок: ZipArchive (основной путь), PharData (запасной, если нет ext-zip).
 *
 * Запись всегда атомарная: архив собирается во временном файле и переименовывается после закрытия —
 * недописанный архив не считается готовым. Имя передаётся без расширения: получится <имя>.zip
 * (или <имя>.tar у запасного пути); чтение ищет оба.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Archive
{
    private ?\ZipArchive $zip = null;
    private ?\PharData $phar = null;
    private ?array $names = null;

    private function __construct(public readonly string $file)
    {
    }

    public static function canZip(): bool
    {
        return class_exists(\ZipArchive::class);
    }

    public static function canPhar(): bool
    {
        return class_exists(\PharData::class);
    }

    /** Есть ли готовый архив с таким именем (без расширения) */
    public static function exists(string $base): bool
    {
        return self::find($base) !== null;
    }

    public static function find(string $base): ?string
    {
        foreach (['.zip', '.tar'] as $ext) {
            if (is_file($base . $ext)) {
                return $base . $ext;
            }
        }
        return null;
    }

    /**
     * Записать архив. $entries — имя в архиве => содержимое (строка). Возвращает путь к архиву.
     * $forceFormat — 'zip' | 'tar' (для самопроверки запасного пути).
     */
    public static function write(string $base, iterable $entries, ?string $forceFormat = null): string
    {
        Util::mkdir(dirname($base));
        $format = $forceFormat ?? (self::canZip() ? 'zip' : (self::canPhar() ? 'tar' : null));
        if ($format === null) {
            Util::fail('Нет ни ext-zip (ZipArchive), ни ext-phar (PharData) — архив не создать');
        }
        $final = $base . '.' . $format;
        $tmp = $base . '.am-tmp-' . bin2hex(random_bytes(4)) . '.' . $format;
        try {
            if ($format === 'zip') {
                $z = new \ZipArchive();
                if ($z->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
                    Util::fail("Не удалось создать архив $tmp");
                }
                $n = 0;
                foreach ($entries as $name => $content) {
                    $z->addFromString((string)$name, (string)$content);
                    $n++;
                }
                if ($n === 0) {
                    $z->addFromString('.empty', '');
                }
                if (!$z->close()) {
                    Util::fail("Не удалось записать архив $tmp: " . $z->getStatusString());
                }
            } else {
                // PharData: добавлять файлы по одному медленно (tar переписывается каждый раз) —
                // собираем во временной папке и строим архив одним вызовом. Папка — в системной временной,
                // а не рядом с архивом: при обрыве процесса копии PHP-файлов не должны остаться в хранилище
                // (запасное хранилище лежит в /bitrix/backup — там они были бы исполняемыми по URL)
                $dir = Util::norm(sys_get_temp_dir()) . '/am-tar-' . bin2hex(random_bytes(6));
                Util::mkdir($dir);
                $n = 0;
                foreach ($entries as $name => $content) {
                    if (!Util::safeRel((string)$name)) {
                        continue;
                    }
                    Util::mkdir(dirname("$dir/$name"));
                    file_put_contents("$dir/$name", (string)$content);
                    $n++;
                }
                if ($n === 0) {
                    file_put_contents("$dir/.empty", '');
                }
                $p = new \PharData($tmp);
                $p->buildFromDirectory($dir);
                unset($p);
                Util::rrmdir($dir);
            }
            foreach (['.zip', '.tar'] as $ext) {
                if ($base . $ext !== $final && is_file($base . $ext)) {
                    @unlink($base . $ext);
                }
            }
            if (!@rename($tmp, $final)) {
                if (!@copy($tmp, $final)) {
                    Util::fail("Не удалось сохранить архив $final");
                }
                @unlink($tmp);
            }
        } catch (\Throwable $e) {
            @unlink($tmp);
            if (isset($dir)) {
                Util::rrmdir($dir);
            }
            throw $e instanceof MergeException ? $e : new MergeException('Ошибка записи архива ' . $final . ': ' . $e->getMessage(), 0, $e);
        }
        return $final;
    }

    /**
     * Записать архив из файлов на диске, не читая их в память целиком (zip — addFile; запасной tar — копии во временной
     * папке). $files — имя в архиве => путь к файлу; $extra — имя => содержимое (строка). Возвращает путь к архиву.
     */
    public static function writeFiles(string $base, array $files, array $extra = []): string
    {
        if (!self::canZip()) {
            $entries = $extra;
            foreach ($files as $name => $abs) {
                $entries[$name] = (string)file_get_contents($abs);
            }
            return self::write($base, $entries);
        }
        Util::mkdir(dirname($base));
        $final = $base . '.zip';
        $tmp = $base . '.am-tmp-' . bin2hex(random_bytes(4)) . '.zip';
        try {
            $z = new \ZipArchive();
            if ($z->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
                Util::fail("Не удалось создать архив $tmp");
            }
            foreach ($files as $name => $abs) {
                if (!$z->addFile($abs, (string)$name)) {
                    Util::fail("Не удалось добавить в архив $abs");
                }
            }
            foreach ($extra as $name => $content) {
                $z->addFromString((string)$name, (string)$content);
            }
            if (!$files && !$extra) {
                $z->addFromString('.empty', '');
            }
            if (!$z->close()) {
                Util::fail("Не удалось записать архив $tmp: " . $z->getStatusString());
            }
            if (!@rename($tmp, $final)) {
                if (!@copy($tmp, $final)) {
                    Util::fail("Не удалось сохранить архив $final");
                }
                @unlink($tmp);
            }
        } catch (\Throwable $e) {
            @unlink($tmp);
            throw $e instanceof MergeException ? $e : new MergeException('Ошибка записи архива ' . $final . ': ' . $e->getMessage(), 0, $e);
        }
        return $final;
    }

    /** Открыть архив по имени без расширения */
    public static function open(string $base): ?self
    {
        $f = self::find($base);
        return $f === null ? null : self::openFile($f);
    }

    /** Открыть конкретный файл архива (zip или tar) */
    public static function openFile(string $file): self
    {
        if (!is_file($file)) {
            Util::fail("Нет архива $file");
        }
        $a = new self($file);
        $isZip = file_get_contents($file, false, null, 0, 2) === 'PK';
        if ($isZip && self::canZip()) {
            $z = new \ZipArchive();
            $rdonly = defined('ZipArchive::RDONLY') ? \ZipArchive::RDONLY : 0;
            if ($z->open($file, $rdonly) !== true) {
                Util::fail("Не удалось открыть архив $file");
            }
            $a->zip = $z;
            return $a;
        }
        if (!self::canPhar()) {
            Util::fail("Нечем прочитать архив $file: нет ни ext-zip, ни ext-phar");
        }
        try {
            $a->phar = new \PharData($file);
        } catch (\Throwable $e) {
            Util::fail("Не удалось открыть архив $file: " . $e->getMessage());
        }
        return $a;
    }

    /** Список имён внутри архива */
    public function names(): array
    {
        if ($this->names !== null) {
            return $this->names;
        }
        $out = [];
        if ($this->zip) {
            for ($i = 0; $i < $this->zip->numFiles; $i++) {
                $st = $this->zip->statIndex($i);
                if ($st && !str_ends_with($st['name'], '/')) {
                    $out[] = $st['name'];
                }
            }
        } elseif ($this->phar) {
            $root = 'phar://' . str_replace('\\', '/', $this->phar->getPath()) . '/';
            foreach (new \RecursiveIteratorIterator($this->phar) as $f) {
                $p = str_replace('\\', '/', (string)$f->getPathname());
                if (str_starts_with($p, $root)) {
                    $out[] = substr($p, strlen($root));
                }
            }
        }
        return $this->names = $out;
    }

    public function get(string $name): ?string
    {
        if ($this->zip) {
            $c = $this->zip->getFromName($name);
            return $c === false ? null : $c;
        }
        if ($this->phar) {
            if (!isset($this->phar[$name])) {
                return null;
            }
            $c = $this->phar[$name]->getContent();
            return $c === false ? null : (string)$c;
        }
        return null;
    }

    /** Размер распакованного содержимого (для защиты от «бомб» при импорте) */
    public function size(string $name): ?int
    {
        if ($this->zip) {
            $st = $this->zip->statName($name);
            return $st ? (int)$st['size'] : null;
        }
        if ($this->phar && isset($this->phar[$name])) {
            return (int)$this->phar[$name]->getSize();
        }
        return null;
    }

    public function close(): void
    {
        $this->zip?->close();
        $this->zip = null;
        $this->phar = null;
    }
}
