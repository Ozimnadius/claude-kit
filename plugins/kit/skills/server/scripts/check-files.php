// Сверка файлов на сервере с локальными по md5. Только чтение.
// Список файлов вставляет `node md5-check.js <файлы…>` (плагин kit); как есть не запускать — список пуст.
// Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.

$files = []; // KIT:FILES — 'путь от корня сайта' => ['md5 как есть', 'md5 с LF']

$root = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') : '';
if ($root === '') {
    echo "<pre>DOCUMENT_ROOT не задан — стоп.\n</pre>";
    return;
}
$total = ['ок' => 0, 'ОТЛИЧАЕТСЯ' => 0, 'нет' => 0];
echo "<pre>";
echo "Файлов в списке: " . count($files) . "\n\n";
foreach ($files as $rel => $sums) {
    $path = $root . '/' . $rel;
    if (!is_file($path)) {
        $total['нет']++;
        echo "нет | " . $rel . "\n";
        continue;
    }
    $note = '';
    if (md5_file($path) === $sums[0]) {
        $status = 'ок';
    } elseif (md5(str_replace("\r\n", "\n", file_get_contents($path))) === $sums[1]) {
        $status = 'ок';
        $note = ' (переводы строк отличаются)';
    } else {
        $status = 'ОТЛИЧАЕТСЯ';
    }
    $total[$status]++;
    echo $status . ' | ' . $rel . $note . "\n";
}
echo "\nИтого: ок " . $total['ок'] . ", отличается " . $total['ОТЛИЧАЕТСЯ'] . ", нет " . $total['нет'] . "\n";
echo "</pre>";
