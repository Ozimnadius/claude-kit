<?php
/**
 * Общие функции сверки Аспро: пути, обход папок, хеши, запись файлов (атомарно, с сохранением прав),
 * проверка синтаксиса PHP, маркеры конфликта, BOM и переводы строк, запуск процессов, JSON, блокировки.
 * Ядро Битрикса не нужно.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Util
{
    /** Файлы больше этого размера не читаются в память целиком: хеш считается потоково, содержимое не хранится */
    public const MAX_READ = 4 * 1024 * 1024;

    /** Владелец новых файлов и папок (uid, gid), если консоль запущена от root: им передаются созданные файлы */
    public static ?array $owner = null;

    /** Для проверки: вести себя так, будто PHP CLI для php -l нет (как в веб-запросе без него) */
    public static bool $noPhpL = false;

    /** Временные файлы инструмента, найденные при обходе папок и оставшиеся от прерванных процессов */
    private static array $staleTmp = [];

    /** Ошибка инструмента с текстом для человека (по-русски) */
    public static function fail(string $message): never
    {
        throw new MergeException($message);
    }

    public static function norm(string $path): string
    {
        $p = str_replace('\\', '/', $path);
        return $p === '/' ? $p : rtrim($p, '/');
    }

    public static function isAbs(string $path): bool
    {
        return (bool)preg_match('~^([a-z]:)?/~i', str_replace('\\', '/', $path));
    }

    /** Путь безопасен как относительный: без «..», без абсолютного начала и NUL */
    public static function safeRel(string $rel): bool
    {
        $rel = str_replace('\\', '/', $rel);
        return $rel !== '' && !self::isAbs($rel) && !str_contains($rel, "\0")
            && !preg_match('~(^|/)\.\.(/|$)~', $rel);
    }

    public static function join(string ...$parts): string
    {
        $parts = array_values(array_filter($parts, static fn($p) => $p !== ''));
        if (!$parts) {
            return '';
        }
        $first = self::norm(array_shift($parts));
        foreach ($parts as $p) {
            $first .= '/' . trim(str_replace('\\', '/', $p), '/');
        }
        return $first;
    }

    /** Служебные файлы, которые никогда не сравниваются и не копируются (бэкапы обновлятора, наши временные) */
    public static function isServiceFile(string $rel): bool
    {
        $b = basename($rel);
        return (bool)preg_match('/^_.+\.back\d+(\.\d+)*$/', $b)
            || (bool)preg_match('/^_.+_back\d+(\.\d+)*\.zip$/', $b)
            || str_contains($b, '.am-tmp-')
            || preg_match('~(^|/)\.git(/|$)~', $rel)
            || $b === 'Thumbs.db' || $b === '.DS_Store';
    }

    /**
     * Файлы папки: rel => abs. Ссылки на папки не обходим (защита от циклов), служебные файлы пропускаем.
     */
    public static function walk(string $dir): array
    {
        $out = [];
        if (!is_dir($dir)) {
            return $out;
        }
        $dir = self::norm($dir);
        $len = strlen($dir) + 1;
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::UNIX_PATHS),
            \RecursiveIteratorIterator::LEAVES_ONLY,
            \RecursiveIteratorIterator::CATCH_GET_CHILD
        );
        foreach ($it as $f) {
            /** @var \SplFileInfo $f */
            if (!$f->isFile()) {
                continue;
            }
            $abs = self::norm($f->getPathname());
            $rel = substr($abs, $len);
            if (!self::isServiceFile($rel)) {
                $out[$rel] = $abs;
            } elseif (str_contains($f->getFilename(), '.am-tmp-') && $f->getMTime() < time() - 3600) {
                self::$staleTmp[$abs] = true;
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    /**
     * Удалить временные файлы инструмента, оставшиеся от прерванных процессов (старше часа): найденные при обходе
     * рабочих папок и лежащие в хранилище. Возвращает число удалённых.
     */
    public static function cleanStaleTmp(?string $store = null): int
    {
        $n = 0;
        $list = array_keys(self::$staleTmp);
        if ($store !== null && is_dir($store)) {
            foreach (['/*', '/*/*', '/sessions/*/*', '/sessions/*/rollback/*', '/sessions/*/blobs/*/*'] as $p) {
                foreach (glob($store . $p . '.am-tmp-*') ?: [] as $f) {
                    $list[] = self::norm($f);
                }
            }
        }
        foreach (array_unique($list) as $f) {
            $mt = @filemtime($f);
            if ($mt === false || $mt >= time() - 3600) {
                continue;
            }
            if (is_dir($f)) {
                self::rrmdir($f);
                $n++;
            } elseif (@unlink($f)) {
                $n++;
            }
        }
        self::$staleTmp = [];
        return $n;
    }

    /** Бэкапы обновлятора в папке: rel бэкапа => abs */
    public static function walkBackups(string $dir): array
    {
        $out = [];
        if (!is_dir($dir)) {
            return $out;
        }
        $dir = self::norm($dir);
        $len = strlen($dir) + 1;
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS | \FilesystemIterator::UNIX_PATHS),
            \RecursiveIteratorIterator::LEAVES_ONLY,
            \RecursiveIteratorIterator::CATCH_GET_CHILD
        );
        foreach ($it as $f) {
            if ($f->isFile() && preg_match('/^_.+\.back\d+(\.\d+)*$/', $f->getFilename())) {
                $abs = self::norm($f->getPathname());
                $out[substr($abs, $len)] = $abs;
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    /** Бэкап обновлятора → [путь исходного файла, версия] или null */
    public static function parseBackup(string $rel): ?array
    {
        if (!preg_match('~(^|/)_([^/]+)\.back(\d+(?:\.\d+)*)$~', $rel, $m)) {
            return null;
        }
        $d = dirname($rel);
        return [($d === '.' || $d === '' ? '' : "$d/") . $m[2], $m[3]];
    }

    public static function isText(string $c): bool
    {
        return !str_contains(substr($c, 0, 8000), "\0");
    }

    /** git-хеш содержимого (sha1 от "blob <длина>\0<содержимое>") — совпадает с хешами git */
    public static function gitHash(string $c): string
    {
        return sha1('blob ' . strlen($c) . "\0" . $c);
    }

    /** git-хеш файла без чтения в память целиком (для больших файлов) */
    public static function gitHashFile(string $abs): ?string
    {
        $size = @filesize($abs);
        $fp = $size === false ? false : @fopen($abs, 'rb');
        if (!$fp) {
            return null;
        }
        $ctx = hash_init('sha1');
        hash_update($ctx, 'blob ' . $size . "\0");
        hash_update_stream($ctx, $fp);
        fclose($fp);
        return hash_final($ctx);
    }

    /**
     * Хеши содержимого: h — как git blob (побайтно), n — после CRLF→LF и без BOM, s — размер, t — 1, если текст.
     * «Отличаются только пробелами» проверяет wsSame() по содержимому (только там, где это нужно).
     */
    public static function hashes(string $c): array
    {
        $h = self::gitHash($c);
        if (!self::isText($c)) {
            return ['h' => $h, 'n' => $h, 's' => strlen($c), 't' => 0];
        }
        return ['h' => $h, 'n' => sha1(self::stripBom(am_to_lf($c))), 's' => strlen($c), 't' => 1];
    }

    /**
     * Хеши файла: маленький читается, большой (больше MAX_READ) хешируется потоково и считается двоичным —
     * построчно его не сливают и содержимое не хранят ('big' => 1).
     */
    public static function hashesFile(string $abs): ?array
    {
        $size = @filesize($abs);
        if ($size === false) {
            return null;
        }
        if ($size > self::MAX_READ) {
            $h = self::gitHashFile($abs);
            return $h === null ? null : ['h' => $h, 'n' => $h, 's' => $size, 't' => 0, 'big' => 1];
        }
        $c = self::read($abs);
        return $c === null ? null : self::hashes($c);
    }

    /** Тексты отличаются только незначащими пробелами (отступами, переводами строк — см. wsKey) */
    public static function wsSame(?string $a, ?string $b): bool
    {
        if ($a === null || $b === null || !self::isText($a) || !self::isText($b)) {
            return false;
        }
        $n = static fn(string $x) => self::stripBom(am_to_lf($x));
        return self::wsKey($n($a)) === self::wsKey($n($b));
    }

    /**
     * Ключ текста «без незначащих пробелов»: одинаков у текстов, которые отличаются только отступами, переводами
     * строк и пробелами вокруг скобок, «;», «,», «=», «?», «!» — например, «<?require(…)» и «<? require(…)», которые
     * вставляет мастер. Пробелы внутри кавычек ('…', "…", `…`) сохраняются, а прочие пробелы между словами и знаками
     * сводятся к одному — поэтому «" "» и «""», «.a .b» и «.a.b», «a b» и «ab» различаются.
     */
    public static function wsKey(string $lf): string
    {
        $out = '';
        $q = null;
        $len = strlen($lf);
        $safe = '(){};,=?!';
        for ($i = 0; $i < $len; $i++) {
            $ch = $lf[$i];
            if ($q !== null) {
                if ($ch === "\n") {
                    $q = null; // строка оборвалась на переводе строки — дальше снова вне кавычек
                } else {
                    $out .= $ch;
                    if ($ch === '\\' && $i + 1 < $len && $lf[$i + 1] !== "\n") {
                        $out .= $lf[++$i];
                    } elseif ($ch === $q) {
                        $q = null;
                    }
                    continue;
                }
            }
            if ($ch === ' ' || $ch === "\t" || $ch === "\n" || $ch === "\r" || $ch === "\f" || $ch === "\v") {
                $j = $i;
                while ($j + 1 < $len && strpbrk($lf[$j + 1], " \t\n\r\f\v") !== false) {
                    $j++;
                }
                $prev = $out === '' ? '' : $out[strlen($out) - 1];
                $next = $j + 1 < $len ? $lf[$j + 1] : '';
                if ($prev !== '' && $next !== '' && !str_contains($safe, $prev) && !str_contains($safe, $next)) {
                    $out .= ' ';
                }
                $i = $j;
                continue;
            }
            if ($ch === '"' || $ch === "'" || $ch === '`') {
                $q = $ch;
            }
            $out .= $ch;
        }
        return $out;
    }

    public static function read(string $abs): ?string
    {
        if (!is_file($abs)) {
            return null;
        }
        $c = @file_get_contents($abs);
        return $c === false ? null : $c;
    }

    /** Прочитать файл, только если он не больше MAX_READ (иначе — null) */
    public static function readSmall(string $abs): ?string
    {
        $size = @filesize($abs);
        return ($size === false || $size > self::MAX_READ) ? null : self::read($abs);
    }

    public static function perms(string $abs): ?int
    {
        $p = @fileperms($abs);
        return $p === false ? null : ($p & 0777);
    }

    public static function mkdir(string $dir, int $mode = 0775): void
    {
        if (is_dir($dir)) {
            return;
        }
        // недостающие папки по одной: каждую новую — владельцу сайта (если консоль запущена от root)
        $missing = [];
        for ($d = $dir; $d !== '' && !is_dir($d) && dirname($d) !== $d; $d = dirname($d)) {
            $missing[] = $d;
        }
        if (!@mkdir($dir, $mode, true) && !is_dir($dir)) {
            self::fail("Не удалось создать папку $dir");
        }
        foreach ($missing as $d) {
            self::own($d);
        }
    }

    /** Передать файл или папку владельцу сайта, если консоль запущена от root (Util::$owner задаёт merge.php) */
    public static function own(string $path): void
    {
        if (self::$owner !== null && function_exists('posix_geteuid') && posix_geteuid() === 0) {
            @chown($path, self::$owner[0]);
            @chgrp($path, self::$owner[1]);
        }
    }

    /** Имя временного файла рядом с $abs: без имени и расширения исходного (не исполнится как .php) */
    public static function tmpName(string $dir): string
    {
        return $dir . '/.am-tmp-' . bin2hex(random_bytes(8));
    }

    /**
     * Записать файл атомарно: временный файл в той же папке → права как у прежнего файла (или $perms) →
     * владелец как у прежнего (или владелец сайта, если запущено от root) → переименование поверх.
     * Возвращает git-хеш записанного.
     */
    public static function writeFile(string $abs, string $content, ?int $perms = null): string
    {
        $dir = dirname($abs);
        if (!is_dir($dir)) {
            $parentPerms = self::perms(dirname($dir)) ?? 0775;
            self::mkdir($dir, $parentPerms ?: 0775);
        }
        $old = is_file($abs);
        $oldPerms = $old ? self::perms($abs) : null;
        $tmp = self::tmpName($dir);
        if (@file_put_contents($tmp, $content) !== strlen($content)) {
            @unlink($tmp);
            self::fail("Не удалось записать $abs (нет места или прав)");
        }
        $mode = $perms ?? $oldPerms;
        if ($mode === null && defined('BX_FILE_PERMISSIONS')) {
            $mode = (int)constant('BX_FILE_PERMISSIONS');
        }
        if ($mode !== null) {
            @chmod($tmp, $mode);
        }
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $st = $old ? @stat($abs) : false;
            if ($st) {
                @chown($tmp, $st['uid']);
                @chgrp($tmp, $st['gid']);
            } else {
                self::own($tmp);
            }
        }
        if (!@rename($tmp, $abs)) {
            // на некоторых файловых системах Windows переименование поверх открытого файла не проходит
            if (!@copy($tmp, $abs)) {
                @unlink($tmp);
                self::fail("Не удалось заменить файл $abs");
            }
            @unlink($tmp);
        }
        clearstatcache(true, $abs);
        if (function_exists('opcache_invalidate') && str_ends_with($abs, '.php')) {
            @opcache_invalidate($abs, true);
        }
        $written = self::read($abs);
        if ($written === null || $written !== $content) {
            self::fail("Файл $abs записан с ошибкой (содержимое не совпало после записи)");
        }
        return self::gitHash($content);
    }

    public static function deleteFile(string $abs): void
    {
        if (is_file($abs) && !@unlink($abs)) {
            self::fail("Не удалось удалить $abs");
        }
        clearstatcache(true, $abs);
        if (function_exists('opcache_invalidate') && str_ends_with($abs, '.php')) {
            @opcache_invalidate($abs, true);
        }
    }

    /** Удалить опустевшие папки от папки файла вверх, не выше $stop (без неё самой) */
    public static function pruneEmptyDirs(string $abs, string $stop): void
    {
        $stop = self::norm($stop);
        for ($d = self::norm(dirname($abs)); strlen($d) > strlen($stop) && str_starts_with($d, $stop . '/'); $d = dirname($d)) {
            if (!is_dir($d) || !@rmdir($d)) { // непустую папку rmdir не удалит
                break;
            }
        }
    }

    /** Простая запись служебного файла хранилища (не сайта) */
    public static function put(string $file, string $content): void
    {
        self::mkdir(dirname($file));
        $tmp = $file . '.am-tmp-' . bin2hex(random_bytes(3));
        if (@file_put_contents($tmp, $content) !== strlen($content)) {
            @unlink($tmp);
            self::fail("Не удалось записать $file (нет места или прав)");
        }
        self::own($tmp);
        if (!@rename($tmp, $file)) {
            // Windows: переименование поверх файла, который держит другой процесс, может не пройти
            if (!@copy($tmp, $file)) {
                @unlink($tmp);
                self::fail("Не удалось записать $file");
            }
            @unlink($tmp);
        }
    }

    public static function jsonRead(string $file): ?array
    {
        if (!is_file($file)) {
            return null;
        }
        $d = json_decode((string)file_get_contents($file), true);
        return is_array($d) ? $d : null;
    }

    public static function json(array $data): string
    {
        return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
    }

    public static function jsonWrite(string $file, array $data): void
    {
        self::put($file, self::json($data));
    }

    /** Удалить папку целиком */
    public static function rrmdir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $f) {
            $f->isDir() && !$f->isLink() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($dir);
    }

    // --- текст: BOM, переводы строк, маркеры ---

    public static function hasBom(string $c): bool
    {
        return str_starts_with($c, "\xEF\xBB\xBF");
    }

    public static function stripBom(string $c): string
    {
        return self::hasBom($c) ? substr($c, 3) : $c;
    }

    /**
     * Привести текст к стилю образца: переводы строк и BOM — как у образца. Только для текста: двоичное содержимое
     * (или двоичный образец) возвращается побайтно как есть.
     */
    public static function styleLike(string $text, string $sample): string
    {
        if (!self::isText($text) || !self::isText($sample)) {
            return $text;
        }
        $t = self::stripBom(am_to_lf($text));
        if (am_is_crlf($sample)) {
            $t = str_replace("\n", "\r\n", $t);
        }
        return self::hasBom($sample) ? "\xEF\xBB\xBF" . $t : $t;
    }

    /**
     * Маркеры конфликта: строка, начинающаяся с «<<<<<<<», «|||||||» или «>>>>>>>» (дальше пробел или конец строки).
     * Достаточно любого из них — решение, где убрали только часть маркеров, тоже не проходит. «=======» отдельно
     * не считается (так бывают оформлены комментарии), но рядом с остальными маркерами его ловят они.
     */
    public static function hasMarkers(string $c): bool
    {
        return self::isText($c) && (bool)preg_match('/^(?:<{7}|\|{7}|>{7})(?: |\r?$)/m', $c);
    }

    public static function isMin(string $rel): bool
    {
        return (bool)preg_match('/\.min\.(js|css)$/', $rel);
    }

    // --- процессы и проверка синтаксиса ---

    public static function canRun(): bool
    {
        if (!function_exists('proc_open')) {
            return false;
        }
        $dis = array_map('trim', explode(',', (string)ini_get('disable_functions')));
        return !in_array('proc_open', $dis, true);
    }

    /**
     * Выполнить команду без оболочки: [код, stdout, stderr]; по таймауту процесс завершается.
     * Вывод идёт во временные файлы, а не в каналы: на Windows stream_select с каналами proc_open не работает,
     * а чтение двух каналов по очереди может зависнуть на большом выводе.
     */
    public static function run(array $cmd, ?string $cwd = null, ?string $stdin = null, int $timeout = 120, ?array $env = null): array
    {
        if (!self::canRun()) {
            return [255, '', 'proc_open недоступен'];
        }
        $tmp = sys_get_temp_dir();
        $outF = (string)tempnam($tmp, 'amo');
        $errF = (string)tempnam($tmp, 'ame');
        $p = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $outF, 'w'], 2 => ['file', $errF, 'w']], $pipes, $cwd, $env, ['bypass_shell' => true]);
        if (!is_resource($p)) {
            @unlink($outF);
            @unlink($errF);
            return [255, '', 'не удалось запустить ' . $cmd[0]];
        }
        if ($stdin !== null) {
            fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
        $deadline = microtime(true) + $timeout;
        $code = -1;
        $note = '';
        $sleep = 2000;
        while (true) {
            $st = proc_get_status($p);
            if (!$st['running']) {
                $code = (int)$st['exitcode'];
                break;
            }
            if (microtime(true) > $deadline) {
                proc_terminate($p);
                $code = 255;
                $note = "\nпрервано по таймауту {$timeout} с";
                break;
            }
            usleep($sleep);
            $sleep = min($sleep * 2, 50000);
        }
        $rc = proc_close($p);
        if ($code === -1) {
            $code = $rc;
        }
        $out = (string)@file_get_contents($outF);
        $err = (string)@file_get_contents($errF) . $note;
        @unlink($outF);
        @unlink($errF);
        return [$code, $out, $err];
    }

    /** Найденный в веб-запросе PHP CLI: ключ (PHP сайта и версия) => путь или null; версии кандидатов: путь => версия */
    private static array $phpCliFound = [];
    private static array $phpCliVer = [];

    /** Путь к PHP CLI для php -l (см. phpCliInfo) */
    public static function phpCli(?string $configured = null, ?string $sapi = null, ?string $binary = null): ?string
    {
        return self::phpCliInfo($configured, $sapi, $binary)['bin'];
    }

    /**
     * PHP CLI для php -l: ['bin' => путь|null, 'how' => откуда он (по-русски)].
     * В консоли — текущий PHP. В веб-запросе (событие после обновления; PHP сайта — php-cgi, php-fpm, модуль Apache) —
     * php_cli из настроек, иначе PHP CLI той же версии (major.minor), что PHP сайта: рядом с PHP_BINARY (php.exe рядом
     * с php-cgi.exe; /usr/bin/php8.2 для /usr/sbin/php-fpm8.2), в PHP_BINDIR, в PATH и в типичных местах панелей.
     * PHP_BINDIR — папка, заданная при сборке PHP (у сборок для Windows это C:\php), поэтому одного его мало.
     * Версия кандидата проверяется запуском (php -n -r); результат поиска запоминается на время процесса.
     * $sapi и $binary — для самопроверки (как будто PHP сайта — это $binary).
     */
    public static function phpCliInfo(?string $configured = null, ?string $sapi = null, ?string $binary = null): array
    {
        if (self::$noPhpL) {
            return ['bin' => null, 'how' => 'php -l отключён для проверки (--no-php-l)'];
        }
        if ($configured !== null && $configured !== '') {
            return @is_file($configured) ? ['bin' => $configured, 'how' => "php_cli из настроек ($configured)"]
                : ['bin' => null, 'how' => "php_cli из настроек не найден: $configured"];
        }
        $sapi ??= PHP_SAPI;
        $binary ??= PHP_BINARY;
        if ($sapi === 'cli' && $binary !== '' && @is_file($binary)) {
            return ['bin' => $binary, 'how' => "PHP CLI этого процесса ($binary)"];
        }
        $want = PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;
        $key = $binary . '|' . $want;
        if (!array_key_exists($key, self::$phpCliFound)) {
            $found = null;
            if (self::canRun()) {
                $win = DIRECTORY_SEPARATOR === '\\';
                foreach (self::phpCliCandidates($binary, (string)getenv('PATH'), (string)PHP_BINDIR, $want, $win) as $cand) {
                    if (self::phpCliVersion($cand) === $want) {
                        $found = $cand;
                        break;
                    }
                }
            }
            self::$phpCliFound[$key] = $found;
        }
        $bin = self::$phpCliFound[$key];
        return $bin !== null ? ['bin' => $bin, 'how' => "найден PHP CLI $want ($bin)"]
            : ['bin' => null, 'how' => "PHP CLI $want не найден (искали рядом с " . ($binary !== '' ? $binary : 'PHP сайта')
                . ', в PATH и в типичных местах) — задайте php_cli в local/aspro-merge.config.php'];
    }

    /**
     * Где искать PHP CLI версии $ver (по порядку, только существующие файлы): рядом с PHP сайта ($binary), в папке bin
     * рядом с его папкой (sbin → bin), в $bindir, в PATH, в типичных местах (BitrixVM, ISPmanager, cPanel, Plesk,
     * CloudLinux, Remi; OSPanel, XAMPP). php-cgi, php-fpm, phpdbg и php-win пропускаются.
     */
    public static function phpCliCandidates(string $binary, string $path, string $bindir, string $ver, bool $win): array
    {
        $short = str_replace('.', '', $ver);
        $names = $win ? ['php.exe', "php$ver.exe", "php$short.exe"] : ["php$ver", "php$short", 'php'];
        $dirs = [];
        $first = [];
        if ($binary !== '') {
            $bd = self::norm(dirname($binary));
            // имя CLI по имени PHP сайта: php-fpm8.2 → php8.2, php-cgi.exe → php.exe
            $derived = (string)preg_replace('~-(cgi|fpm)~i', '', basename($binary));
            if ($derived !== basename($binary)) {
                $first[] = "$bd/$derived";
            }
            $dirs[] = $bd;
            $dirs[] = self::norm(dirname($bd)) . '/bin';
        }
        if ($bindir !== '') {
            $dirs[] = self::norm($bindir);
        }
        foreach (explode($win ? ';' : ':', $path) as $p) {
            $p = trim($p, " \t\"");
            if ($p !== '') {
                $dirs[] = self::norm($p);
            }
        }
        if ($win) {
            // типичные места на системном диске (обычно C:): OSPanel 6 и 5, сборки PHP для Windows, XAMPP
            $sd = rtrim(str_replace('\\', '/', (string)(getenv('SystemDrive') ?: 'C:')), '/');
            array_push($dirs, "$sd/OSPanel/modules/PHP-$ver", "$sd/OSPanel/modules/php/PHP_$ver", "$sd/php", "$sd/php$short", "$sd/xampp/php");
        } else {
            array_push($dirs, '/usr/bin', '/usr/local/bin', '/bin', "/opt/php$short/bin", "/opt/php/$ver/bin", "/opt/plesk/php/$ver/bin",
                "/opt/cpanel/ea-php$short/root/usr/bin", "/opt/alt/php$short/usr/bin", "/opt/remi/php$short/root/usr/bin",
                "/usr/local/php$short/bin", "/usr/local/php$ver/bin");
        }
        $out = [];
        foreach (array_merge($first, ...array_map(static fn($d) => array_map(static fn($n) => "$d/$n", $names), array_values(array_unique($dirs)))) as $c) {
            $b = strtolower(basename($c));
            if (isset($out[$c]) || str_contains($b, 'cgi') || str_contains($b, 'fpm') || str_contains($b, 'dbg') || str_contains($b, 'php-win')) {
                continue;
            }
            if (@is_file($c) && ($win || @is_executable($c))) {
                $out[$c] = true;
            }
        }
        return array_keys($out);
    }

    /** Версия PHP CLI (major.minor) по запуску или null (не запустился или это не CLI) */
    public static function phpCliVersion(string $bin): ?string
    {
        if (!array_key_exists($bin, self::$phpCliVer)) {
            // без кавычек и пробелов в коде: на Windows аргументы proc_open экранируются по своим правилам
            [$rc, $out] = self::run([$bin, '-n', '-r', 'echo(PHP_MAJOR_VERSION.chr(46).PHP_MINOR_VERSION);'], null, null, 15);
            self::$phpCliVer[$bin] = ($rc === 0 && preg_match('/^(\d+\.\d+)$/', trim($out), $m)) ? $m[1] : null;
        }
        return self::$phpCliVer[$bin];
    }

    /** Есть ли полная проверка php -l (PHP CLI найден и процессы запускаются) */
    public static function canPhpL(?string $phpCli = null): bool
    {
        return self::phpCli($phpCli) !== null && self::canRun();
    }

    /**
     * Проверка синтаксиса PHP-кода. Сначала php -l (если есть PHP CLI и proc_open) — и в консоли, и в веб-запросе;
     * иначе — разбор token_get_all(TOKEN_PARSE) в этом же процессе. Разбор ловит только синтаксис: ошибки компиляции
     * («Cannot redeclare», break вне цикла и т. п.) видит только php -l — поэтому результат слияния, проверенный
     * разбором, на сайт не пишется (см. Tool::writeAuto). Возвращает [null|текст ошибки, способ: 'php -l' | 'token_get_all'].
     * $internal — только разбор (для самопроверки).
     */
    public static function lint(string $code, string $tmpDir, ?string $phpCli = null, bool $internal = false): array
    {
        $bin = $internal ? null : self::phpCli($phpCli);
        if ($bin !== null && self::canRun()) {
            self::mkdir($tmpDir);
            $f = $tmpDir . '/lint-' . bin2hex(random_bytes(5)) . '.php';
            file_put_contents($f, $code);
            [$rc, $out, $err] = self::run([$bin, '-n', '-l', $f], null, null, 60);
            @unlink($f);
            $all = $out . ' ' . $err;
            if ($rc === 0 && str_contains($all, 'No syntax errors')) {
                return [null, 'php -l'];
            }
            if (preg_match('~(Parse|Fatal|Compile) error|Errors parsing~i', $all)) {
                $msg = trim((string)preg_replace('~\s+~', ' ', str_replace([$f, str_replace('/', '\\', $f)], 'файл', $all)));
                $msg = (string)preg_replace('~\s*Errors parsing файл\s*$~', '', $msg);
                return [$msg, 'php -l'];
            }
            // php -l не запустился — проверяем разбором в этом процессе
        }
        try {
            token_get_all($code, TOKEN_PARSE);
            return [null, 'token_get_all'];
        } catch (\ParseError $e) {
            return ['PHP Parse error: ' . $e->getMessage() . ' (строка ' . $e->getLine() . ')', 'token_get_all'];
        } catch (\Throwable $e) {
            return ['ошибка разбора: ' . $e->getMessage(), 'token_get_all'];
        }
    }

    // --- блокировка хранилища ---

    /**
     * Блокировка хранилища. $who — кто берёт (в <файл>.who пишется он и время: при ожидании ошибка скажет, кто держит).
     * @return resource
     */
    public static function lock(string $file, int $wait = 60, string $who = '')
    {
        self::mkdir(dirname($file));
        $new = !is_file($file);
        $fp = @fopen($file, 'c');
        if (!$fp) {
            $who = function_exists('posix_geteuid') ? ' (процесс работает от uid ' . posix_geteuid() . ', владелец файла — uid ' . (int)@fileowner($file)
                . '; запускайте консоль от владельца файлов сайта: sudo -u <владелец> php …)' : '';
            self::fail("Не удалось открыть файл блокировки $file$who");
        }
        if ($new) {
            self::own($file);
        }
        $until = microtime(true) + $wait;
        while (!flock($fp, LOCK_EX | LOCK_NB)) {
            if (microtime(true) > $until) {
                fclose($fp);
                $h = json_decode((string)@file_get_contents("$file.who"), true);
                $holder = is_array($h) && isset($h['who'], $h['time'])
                    ? sprintf(' — держит «%s» с %s', $h['who'], date('d.m.Y H:i:s', (int)$h['time']))
                    : '';
                self::fail("Хранилище занято другим процессом сверки$holder (ждали $wait с): $file");
            }
            usleep(200000);
        }
        if ($who !== '') {
            // рядом, а не в сам файл блокировки: в Windows заблокированный файл другой процесс не прочитает
            $newWho = !is_file("$file.who");
            @file_put_contents("$file.who", (string)json_encode(['who' => $who, 'time' => time(), 'pid' => getmypid()], JSON_UNESCAPED_UNICODE));
            if ($newWho) {
                self::own("$file.who");
            }
        }
        return $fp;
    }

    public static function unlock($fp): void
    {
        if (is_resource($fp)) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    // --- разное ---

    /**
     * Консоль запущена не от владельца файлов сайта? [действие, сообщение]: 'ok' — всё хорошо; 'chown' — от root:
     * новые файлы и папки передаются владельцу сайта; 'stop' — другой пользователь (без --allow-other-user):
     * хранилище и блокировка стали бы чужими для веб-сервера, и предохранитель остановил бы установку обновлений.
     */
    public static function ownerCheck(?int $euid, ?int $owner, bool $allowOther = false): array
    {
        if ($euid === null || $owner === null || $euid === $owner) {
            return ['ok', null];
        }
        if ($euid === 0) {
            return ['chown', "запущено от root, а файлы сайта принадлежат uid $owner: новые файлы и папки (хранилище, копии) будут переданы ему. "
                . 'Лучше запускать от владельца: sudo -u <владелец> php local/tools/aspro-merge/merge.php …'];
        }
        if ($allowOther) {
            return ['ok', "запущено от uid $euid, а файлы сайта принадлежат uid $owner (--allow-other-user): проверьте права на хранилище и новые файлы"];
        }
        return ['stop', "запущено от uid $euid, а файлы сайта принадлежат uid $owner. Хранилище и новые файлы стали бы чужими для веб-сервера, "
            . 'и предохранитель остановил бы установку обновлений. Запустите от владельца: sudo -u <владелец> php local/tools/aspro-merge/merge.php … '
            . '(или с --allow-other-user, если права настроены иначе)'];
    }

    public static function versionFromFile(string $file): ?string
    {
        // разбор текста, а не include: после обновления OPcache может держать старый version.php
        $c = self::read($file);
        if ($c === null) {
            return null;
        }
        return preg_match('/["\']VERSION["\']\s*=>\s*["\']([^"\']+)/', $c, $m) ? $m[1] : null;
    }

    public static function date(int $t): string
    {
        return date('d.m.Y H:i:s', $t);
    }

    public static function plural(int $n, string $one, string $few, string $many): string
    {
        $m10 = $n % 10;
        $m100 = $n % 100;
        if ($m10 === 1 && $m100 !== 11) {
            return $one;
        }
        if ($m10 >= 2 && $m10 <= 4 && ($m100 < 10 || $m100 >= 20)) {
            return $few;
        }
        return $many;
    }

    public static function randomName(int $len = 16): string
    {
        $abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
        $s = '';
        for ($i = 0; $i < $len; $i++) {
            $s .= $abc[random_int(0, strlen($abc) - 1)];
        }
        return $s;
    }

    /** Строки, добавленные во втором тексте относительно первого (без пустых) */
    public static function addedLines(string $from, string $to): array
    {
        $r1 = am_split($from);
        $r2 = am_split($to);
        $out = [];
        foreach (am_xdiff($r1, $r2) as [, $i2, , $c2]) {
            for ($k = 0; $k < $c2; $k++) {
                $l = rtrim($r2[$i2 + $k], "\n");
                if (trim($l) !== '') {
                    $out[] = $l;
                }
            }
        }
        return $out;
    }

    /** Доля строк базы, которые переписал вендор (для подсказки «проще взять theirs») */
    public static function changedShare(string $base, string $theirs): int
    {
        $b = am_split($base);
        if (!$b) {
            return 0;
        }
        $n = 0;
        foreach (am_xdiff($b, am_split($theirs)) as $x) {
            $n += $x[2];
        }
        return (int)round(100 * $n / count($b));
    }
}

class MergeException extends \RuntimeException
{
}

/** Истёк срок (в событии после обновления время ограничено): остаток доделает консоль */
final class TimeUpException extends MergeException
{
}
