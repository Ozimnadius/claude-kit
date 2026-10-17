<?php
/**
 * Подключение библиотеки сверки Аспро: и из консоли (merge.php), и из ядра (local/php_interface/include/aspro_merge.php).
 * Ядро Битрикса библиотеке не нужно.
 */

declare(strict_types=1);

if (PHP_VERSION_ID < 80100) {
    throw new \RuntimeException('Сверке Аспро нужен PHP 8.1 или новее (сейчас ' . PHP_VERSION . ')');
}

foreach (['xmerge', 'Util', 'Archive', 'FileSet', 'Config', 'Snapshot', 'Updater', 'Session', 'Planner', 'Result',
             'Bitrix', 'Report', 'Verifier', 'Exchange', 'Tool', 'SelfTest'] as $f) {
    require_once __DIR__ . "/$f.php";
}
