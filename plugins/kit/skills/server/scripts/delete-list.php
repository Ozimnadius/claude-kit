// Удаление файлов на сервере строгим списком. МЕНЯЕТ сервер: запуск только с отдельного согласия пользователя.
// Порядок: сначала $dryRun = true (только показывает, что будет удалено и куда лягут копии), вывод — пользователю, потом $dryRun = false.
// Удаляет только файлы из $files внутри $base, имя которых подходит под маску из $allowedMasks; путь проверяется через realpath, симлинки не трогает.
// Перед удалением файл копируется в $backupDir/<ГГГГММДД-ЧЧММСС>/<путь от корня сайта> (вне папки сайта); копия не удалась — файл остаётся.
// $base = '/' (корень сайта) — только имена файлов без папок и без $removeEmptyDirs. Имена из стоп-листа не удаляются никогда.
// Ошибка в настройках — «стоп», не удаляется ничего. Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.

$dryRun = true;
$base = '/local/templates/ШАБЛОН/css';
$allowedMasks = ['*.scss', '*.map'];
$files = [
    'пример.scss',
];
$removeEmptyDirs = false;
$backupDir = '~/kit-backup';

// Маски: '*' — любые символы, '?' — один байт; по имени файла без папки, регистр латиницы не важен. Примеры: '*.scss', '*.php.back*', 'debug.php'.
// $backupDir — абсолютный путь вне папки сайта; '~' — домашняя папка пользователя, от которого работает PHP.
// Стоп-лист — не менять: маски имён, которые скрипт не удаляет в любой папке / в корне сайта.
// Папки скрипт не удаляет вообще (только пустые внутри базы при $removeEmptyDirs); их имена в стоп-листе — чтобы запрос на них сразу давал «стоп».
$protectAnywhere = ['.htaccess', '.htpasswd', '.access.php', '.settings.php', '.settings_extra.php', 'dbconn.php',
    'license_key.php', 'after_connect.php', 'after_connect_d7.php', '.env', '.env.*', 'web.config', '.user.ini',
    'php.ini', 'wp-config.php'];
$protectInRoot = ['index.php', 'urlrewrite.php', '404.php', '.section.php', '.*.menu.php', '.*.menu_ext.php',
    'robots.txt', 'sitemap*.xml', 'favicon.*', 'yandex_*.html', 'google*.html', 'composer.json', 'composer.lock',
    'bitrix', 'upload', 'local', 'vendor', '.git', '.well-known'];

$dryRun = $dryRun !== false;
$removeEmptyDirs = $removeEmptyDirs === true;
$sep = DIRECTORY_SEPARATOR;
$badString = function ($s) {
    return !is_string($s) || preg_match('/[\x00-\x1f]/', $s) === 1;
};
$inside = function ($path, $dir) use ($sep) {
    return strpos($path . $sep, rtrim($dir, '/\\') . $sep) === 0;
};
$matches = function ($name, $masks) {
    foreach ($masks as $mask) {
        if (preg_match('/^' . strtr(preg_quote($mask, '/'), ['\*' => '.*', '\?' => '.']) . '$/isD', $name)) {
            return true;
        }
    }
    return false;
};
$lastPart = function ($path) {
    $path = rtrim(str_replace('\\', '/', $path), '/');
    $pos = strrpos($path, '/');
    return $pos === false ? $path : substr($path, $pos + 1);
};
echo "<pre>";
echo ($dryRun ? "СУХОЙ ПРОГОН — ничего не удаляется" : "УДАЛЕНИЕ") . "\n";
if ($badString($base)) {
    echo '$base — не строка или с управляющими символами — стоп, ничего не удалено.' . "\n</pre>";
    return;
}
echo "База: " . $base . "\n\n";
$docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') : '';
$root = $docRoot === '' ? false : realpath($docRoot);
$baseReal = $root === false ? false : realpath($root . $sep . trim($base, '/\\'));
if ($root === false || $baseReal === false || !is_dir($baseReal) || !$inside($baseReal, $root)) {
    echo "База не найдена или лежит вне корня сайта — стоп, ничего не удалено.\n</pre>";
    return;
}
$inRoot = $baseReal === $root;

$errors = [];
if (!is_array($allowedMasks) || !$allowedMasks) {
    $errors[] = '$allowedMasks — не список масок или пуст';
}
foreach ((array) $allowedMasks as $mask) {
    if ($badString($mask) || preg_match('/^[*?.]*$/', $mask) || strpbrk($mask, '/\\') !== false) {
        $errors[] = 'маска ' . var_export($mask, true) . ' — нужна маска имени файла без папки, не «*» и не «*.*»';
    }
}
if ($inRoot && $removeEmptyDirs) {
    $errors[] = 'в корне сайта $removeEmptyDirs не допускается';
}
if (!is_array($files) || !$files) {
    $errors[] = '$files — не список или пуст';
}
$list = [];
foreach ((array) $files as $rel) {
    $norm = $badString($rel) ? '' : trim(str_replace('\\', '/', $rel), '/');
    $name = $lastPart($norm);
    if ($norm === '' || $name === '.' || $name === '..') {
        $errors[] = 'путь ' . var_export($rel, true) . ' — не имя файла';
    } elseif ($inRoot && $norm !== $name) {
        $errors[] = 'в корне сайта — только имена файлов без папок: «' . $rel . '»';
    } elseif ($matches($name, $protectAnywhere) || ($inRoot && $matches($name, $protectInRoot))) {
        $errors[] = '«' . $rel . '» в стоп-листе — этим скриптом не удаляется';
    } else {
        $list[] = [$rel, $norm];
    }
}

// Домашняя папка: в CLI (SSH) верен HOME; под веб-сервером HOME бывает чужим — сначала posix.
$pwHome = '';
if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
    $user = posix_getpwuid(posix_geteuid());
    $pwHome = $user && isset($user['dir']) ? (string) $user['dir'] : '';
}
$envHome = (string) getenv('HOME');
$home = PHP_SAPI === 'cli' ? ($envHome !== '' ? $envHome : $pwHome) : ($pwHome !== '' ? $pwHome : $envHome);
$backupRoot = false;
$backupExisting = false;
$bdir = $badString($backupDir) ? '' : $backupDir;
if ($bdir === '~' || strpos($bdir, '~/') === 0) {
    $bdir = $home !== '' ? rtrim($home, '/\\') . substr($bdir, 1) : false;
}
if ($bdir === false) {
    $errors[] = 'домашняя папка не определилась — задайте $backupDir абсолютным путём вне папки сайта';
} elseif (preg_match('#(^|[/\\\\])\.\.?([/\\\\]|$)#', $bdir)) {
    $errors[] = 'в $backupDir не должно быть «.» и «..»';
} elseif (!preg_match('#^(/|[A-Za-z]:[/\\\\])#', $bdir)) {
    $errors[] = '$backupDir — абсолютный путь вне папки сайта или «~/…»';
} else {
    $tail = '';
    $p = $bdir;
    while (($backupExisting = @realpath($p)) === false && dirname($p) !== $p) {
        $tail = $sep . $lastPart($p) . $tail;
        $p = dirname($p);
    }
    if ($backupExisting === false) {
        $errors[] = 'папка копий не найдена (или закрыта open_basedir): ' . $bdir;
    } elseif (!is_dir($backupExisting) || !is_writable($backupExisting)) {
        $errors[] = 'папку копий не создать: ' . $backupExisting . ' — не папка или нет прав на запись';
    } else {
        $backupRoot = rtrim($backupExisting, '/\\') . $tail;
        if ($inside($backupRoot, $root)) {
            $errors[] = 'папка копий ' . $backupRoot . ' внутри сайта — веб-сервер отдал бы копии';
        }
    }
}
if ($errors) {
    echo "Ошибки в настройках — стоп, ничего не удалено:\n- " . implode("\n- ", $errors) . "\n</pre>";
    return;
}

// План: что удалять и почему остальное пропущено.
$plan = [];
$total = 0;
foreach ($list as $item) {
    list($rel, $norm) = $item;
    $path = $baseReal . $sep . str_replace('/', $sep, $norm);
    $real = realpath($path);
    $why = '';
    if (is_link($path)) {
        $why = 'симлинк';
    } elseif (!file_exists($path)) {
        $why = 'нет';
    } elseif ($real === false || !$inside($real, $baseReal) || !is_file($real)) {
        $why = 'вне базы или не файл';
    } elseif (!$matches($lastPart($real), $allowedMasks)) {
        $why = 'имя не подходит под маски';
    } elseif ($matches($lastPart($real), $protectAnywhere) || (dirname($real) === $root && $matches($lastPart($real), $protectInRoot))) {
        $why = 'в стоп-листе';
    } else {
        $total += filesize($real);
    }
    $plan[] = [$rel, $real, $why];
}
$free = function_exists('disk_free_space') ? @disk_free_space($backupExisting) : false;
$reserve = 100 * 1024 * 1024;
$noSpace = is_numeric($free) && $total + $reserve > $free;
$spaceMsg = $noSpace ? 'Места для копий не хватит: нужно ' . $total . ' байт и запас 100 МБ, свободно ' . sprintf('%.0f', $free) . ' байт' : '';
$backupTs = $backupRoot . $sep . date('Ymd-His');
$newBackupRoot = !is_dir($backupRoot);
if ($dryRun) {
    echo "Копии лягут в " . $backupRoot . $sep . "<ГГГГММДД-ЧЧММСС>" . $sep . "<путь от корня сайта>\n\n";
} elseif ($noSpace) {
    echo $spaceMsg . " — стоп, ничего не удалено.\n</pre>";
    return;
} elseif ((!is_dir($backupTs) && !@mkdir($backupTs, 0700, true)) || ($r = realpath($backupTs)) === false || $inside($r, $root)) {
    echo "Папку копий не создать или она внутри сайта: " . $backupTs . " — стоп, ничего не удалено.\n</pre>";
    return;
} else {
    echo "Копии — в " . $backupTs . "\n\n";
}

$count = ['есть' => 0, 'удалено' => 0, 'нет' => 0, 'пропущено' => 0, 'не удалено' => 0];
$copied = 0;
$touched = [];
foreach ($plan as $item) {
    list($rel, $real, $why) = $item;
    if ($why === 'нет') {
        echo "нет         " . $rel . "\n";
        $count['нет']++;
        continue;
    }
    if ($why !== '') {
        echo "ПРОПУЩЕН    " . $rel . " — " . $why . "\n";
        $count['пропущено']++;
        continue;
    }
    if ($dryRun) {
        echo "есть        " . $rel . " (" . filesize($real) . " байт)\n";
        $count['есть']++;
        continue;
    }
    $copy = $backupTs . $sep . substr($real, strlen(rtrim($root, '/\\')) + 1);
    if (file_exists($copy)) {
        $why = 'копия уже есть: ' . $copy;
    } else {
        $hash = md5_file($real);
        $ok = $hash !== false && (is_dir(dirname($copy)) || @mkdir(dirname($copy), 0700, true)) && @copy($real, $copy);
        clearstatcache();
        if (!$ok || filesize($copy) !== filesize($real) || md5_file($copy) !== $hash) {
            $why = 'копия не удалась';
            if (is_file($copy)) {
                @unlink($copy);
            }
        } else {
            $copied++;
            @touch($copy, filemtime($real));
            @chmod($copy, fileperms($real) & 0777);
            if (!@unlink($real)) {
                $why = 'не удалить (копия осталась)';
            }
        }
    }
    if ($why !== '') {
        echo "НЕ УДАЛЁН   " . $rel . " — " . $why . "\n";
        $count['не удалено']++;
        continue;
    }
    echo "удалён      " . $rel . "\n";
    $count['удалено']++;
    $touched[dirname($real)] = true;
}
if ($removeEmptyDirs && !$dryRun) {
    $dirs = array_keys($touched);
    usort($dirs, function ($a, $b) {
        return strlen($b) - strlen($a);
    });
    foreach ($dirs as $dir) {
        while ($dir !== $baseReal && $inside($dir, $baseReal) && is_dir($dir)
            && count(array_diff(scandir($dir), ['.', '..'])) === 0) {
            $name = substr($dir, strlen($baseReal) + 1);
            if (!@rmdir($dir)) {
                echo "папку не удалить " . $name . "\n";
                break;
            }
            echo "папка удалена " . $name . "\n";
            $dir = dirname($dir);
        }
    }
}
$summary = [];
foreach ($count as $key => $n) {
    if ($n) {
        $summary[] = $key . ' ' . $n;
    }
}
echo "\nИтого: " . ($summary ? implode(', ', $summary) : 'ничего') . ($dryRun && $total ? ' (' . $total . ' байт)' : '') . "\n";
if ($dryRun && $noSpace) {
    echo $spaceMsg . " — настоящий запуск остановится.\n";
}
if (!$dryRun && !$copied && @rmdir($backupTs) && $newBackupRoot) {
    @rmdir($backupRoot);
}
echo "</pre>";
