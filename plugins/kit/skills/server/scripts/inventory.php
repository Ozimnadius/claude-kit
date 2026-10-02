// Инвентаризация сайта на 1С-Битрикс: окружение, сайты и шаблоны, сторонние модули,
// инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы b_file.
// Только чтение, ничего не меняет. Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.

global $DB;
\Bitrix\Main\Loader::includeModule('iblock');

echo "<pre>";

echo "=== ОКРУЖЕНИЕ\n";
echo 'PHP ' . PHP_VERSION . ' | main ' . (defined('SM_VERSION') ? SM_VERSION : '?')
    . ' | ' . (defined('BX_UTF') && BX_UTF ? 'UTF-8' : 'не UTF-8')
    . ' | DOCUMENT_ROOT ' . $_SERVER['DOCUMENT_ROOT'] . "\n";
echo 'Агенты на cron: ' . \COption::GetOptionString('main', 'agents_use_crontab', 'N')
    . ' | check_agents: ' . \COption::GetOptionString('main', 'check_agents', 'Y') . "\n";

echo "\n=== САЙТЫ: ID | активен | по умолчанию | папка | домен | название\n";
$rsSite = \Bitrix\Main\SiteTable::getList(['order' => ['SORT' => 'ASC']]);
while ($site = $rsSite->fetch()) {
    echo $site['LID'] . ' | ' . $site['ACTIVE'] . ' | ' . $site['DEF'] . ' | ' . $site['DIR']
        . ' | ' . $site['SERVER_NAME'] . ' | ' . $site['NAME'] . "\n";
    $rsTpl = \CSite::GetTemplateList($site['LID']);
    while ($tpl = $rsTpl->Fetch()) {
        $cond = trim((string) $tpl['CONDITION']);
        echo '    шаблон ' . $tpl['TEMPLATE'] . ($cond !== '' ? ' — условие: ' . $cond : ' — без условия') . "\n";
    }
}

echo "\n=== ПАПКИ ШАБЛОНОВ\n";
foreach (['/local/templates', '/bitrix/templates'] as $dir) {
    $list = glob($_SERVER['DOCUMENT_ROOT'] . $dir . '/*', GLOB_ONLYDIR);
    echo $dir . ': ' . ($list ? implode(', ', array_map('basename', $list)) : '—') . "\n";
}

echo "\n=== СТОРОННИЕ МОДУЛИ: id | версия\n";
foreach (\Bitrix\Main\ModuleManager::getInstalledModules() as $id => $module) {
    if (strpos($id, '.') !== false) {
        echo $id . ' | ' . \Bitrix\Main\ModuleManager::getVersion($id) . "\n";
    }
}

echo "\n=== ИНФОБЛОКИ: #ID [тип] CODE — название | активен | элементы активные/все | разделы | URL списка\n";
$rsIb = \CIBlock::GetList(['IBLOCK_TYPE' => 'ASC', 'ID' => 'ASC'], ['CHECK_PERMISSIONS' => 'N']);
while ($ib = $rsIb->Fetch()) {
    $all = \CIBlockElement::GetList([], ['IBLOCK_ID' => $ib['ID'], 'CHECK_PERMISSIONS' => 'N'], []);
    $active = \CIBlockElement::GetList([], ['IBLOCK_ID' => $ib['ID'], 'ACTIVE' => 'Y', 'CHECK_PERMISSIONS' => 'N'], []);
    $sections = \CIBlockSection::GetCount(['IBLOCK_ID' => $ib['ID']]);
    echo '#' . $ib['ID'] . ' [' . $ib['IBLOCK_TYPE_ID'] . '] ' . $ib['CODE'] . ' — ' . $ib['NAME']
        . ' | ' . $ib['ACTIVE'] . ' | ' . $active . '/' . $all . ' | ' . $sections . ' | ' . $ib['LIST_PAGE_URL'] . "\n";
    $props = [];
    $rsProp = \CIBlockProperty::GetList(['SORT' => 'ASC'], ['IBLOCK_ID' => $ib['ID']]);
    while ($p = $rsProp->Fetch()) {
        $props[] = $p['CODE'] . ':' . $p['PROPERTY_TYPE'] . ($p['USER_TYPE'] ? '/' . $p['USER_TYPE'] : '')
            . ($p['MULTIPLE'] == 'Y' ? '*' : '') . ' (' . $p['NAME'] . ')';
    }
    if ($props) {
        echo '    свойства: ' . implode('; ', $props) . "\n";
    }
}

echo "\n=== ПОЛЬЗОВАТЕЛЬСКИЕ ПОЛЯ разделов инфоблоков и HL-блоков\n";
$rsUf = \CUserTypeEntity::GetList(['ENTITY_ID' => 'ASC', 'SORT' => 'ASC'], []);
while ($uf = $rsUf->Fetch()) {
    if (strpos($uf['ENTITY_ID'], 'IBLOCK_') === 0 || strpos($uf['ENTITY_ID'], 'HLBLOCK_') === 0) {
        echo $uf['ENTITY_ID'] . ' ' . $uf['FIELD_NAME'] . ':' . $uf['USER_TYPE_ID'] . ($uf['MULTIPLE'] == 'Y' ? '*' : '') . "\n";
    }
}

echo "\n=== HL-БЛОКИ\n";
if (\Bitrix\Main\Loader::includeModule('highloadblock')) {
    $rsHl = \Bitrix\Highloadblock\HighloadBlockTable::getList(['order' => ['ID' => 'ASC']]);
    while ($hl = $rsHl->fetch()) {
        echo 'HL#' . $hl['ID'] . ' ' . $hl['NAME'] . ' (' . $hl['TABLE_NAME'] . ")\n";
    }
} else {
    echo "модуль highloadblock не установлен\n";
}

echo "\n=== ФАЙЛЫ b_file: модуль | тип | файлов | МБ (40 крупнейших групп)\n";
$res = $DB->Query("SELECT MODULE_ID, SUBSTRING_INDEX(CONTENT_TYPE, '/', 1) AS T, COUNT(*) AS CNT, ROUND(SUM(FILE_SIZE) / 1048576) AS MB"
    . " FROM b_file GROUP BY MODULE_ID, T ORDER BY MB DESC LIMIT 40");
while ($row = $res->Fetch()) {
    echo $row['MODULE_ID'] . ' | ' . $row['T'] . ' | ' . $row['CNT'] . ' | ' . $row['MB'] . "\n";
}

echo "</pre>";
