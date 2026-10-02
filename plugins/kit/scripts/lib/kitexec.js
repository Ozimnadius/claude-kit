'use strict';
// Тело kit-exec.php — файл-канал /kit:server для Битрикса без SSH (спек §7.4).
// Файл лежит в корне сайта, код одной задачи вшит в него при сборке; ничего из запроса он не выполняет.
// Порядок: ядро Битрикса (права проверяются по-настоящему) → проверка администратора → номер запуска → код задачи.
// Код выполняется только при ?run=<номер этого файла>: старый файл, который ещё не заменили новым, при открытии
// нового адреса называет свой номер и ничего не делает (иначе проверка «уехал ли файл» повторила бы старый запуск).
// Код задачи стоит в блоке try: объявления функций и классов в нём условные и выполняются уже после проверки прав, поэтому
// их пишут до вызова. Своя shutdown-функция регистрируется до ядра: у настоящего Битрикса ExceptionHandler в своей
// shutdown-функции делает die(), и иначе фатальная ошибка задачи осталась бы неназванной.
const RUN_RE = /^[A-Za-z0-9]{4,32}$/;
const validRun = (run) => typeof run === 'string' && RUN_RE.test(run);

// Приставка. @RUN@ — номер запуска, @SHIFT@ — на сколько номер строки в файле больше номера в файле с кодом.
const HEAD = String.raw`<?php
$kitArmed = false; $kitText = null;
register_shutdown_function(function () use (&$kitArmed, &$kitText) {
    $e = error_get_last();
    if ($kitArmed && $e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        echo $kitText("\nФатальная ошибка: ") . $e['message'] . ' (' . ($e['file'] === __FILE__ ? $kitText('строка ') . ($e['line'] - @SHIFT@) . $kitText(' кода') : basename($e['file']) . ':' . $e['line']) . ")\n";
    }
});
define('NO_KEEP_STATISTIC', true); define('NO_AGENT_CHECK', true); define('NO_AGENT_STATISTIC', true);
define('DisableEventsCheck', true); define('BX_NO_ACCELERATOR_RESET', true); define('STOP_STATISTICS', true);
require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';
global $USER;
if (headers_sent()) {
    echo 'kit: headers already sent - kit-exec.php does not work on this site, use SSH';
    exit;
}
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header('X-Content-Type-Options: nosniff');
if (!is_object($USER) || !$USER->IsAdmin()) {
    http_response_code(403);
    echo 'kit: только для администратора';
    exit;
}
echo 'KIT-RUN @RUN@' . "\n";
if ((isset($_GET['run']) ? (string) $_GET['run'] : '') !== '@RUN@') {
    echo 'kit: код не выполнялся — нужен адрес /kit-exec.php?run=@RUN@' . "\n";
    exit;
}
$kitUtf = defined('BX_UTF') && BX_UTF;
$kitText = function ($s) use ($kitUtf) { return $kitUtf ? $s : mb_convert_encoding($s, 'Windows-1251', 'UTF-8'); };
ob_start(function ($s) use ($kitUtf) {
    $s = preg_replace('~</?pre>~i', '', $s);
    return $kitUtf ? $s : mb_convert_encoding($s, 'UTF-8', 'Windows-1251');
});
$kitArmed = true;
try {
`;

const TAIL = String.raw`
} catch (\Throwable $kitError) {
    echo $kitText("\nОшибка: ") . $kitError->getMessage() . ' (' . ($kitError->getFile() === __FILE__ ? $kitText('строка ') . ($kitError->getLine() - @SHIFT@) . $kitText(' кода') : basename($kitError->getFile()) . ':' . $kitError->getLine()) . ")\n";
}
`;

// Код без BOM, без ведущего <?php и без завершающего ?> (после него хвост приставки стал бы текстом); removed — сколько
// строк съел <?php.
function stripOpenTag(code) {
  let body = String(code).replace(/^﻿/, '');
  let removed = 0;
  const open = /^<\?php(?:[ \t]*\r?\n|[ \t]+|$)/i.exec(body);
  if (open) {
    removed = open[0].includes('\n') ? 1 : 0;
    body = body.slice(open[0].length);
  }
  return { body: body.replace(/\s*\?>\s*$/, ''), removed };
}

// → { php, prefixLines, shift }; shift — на сколько номер строки в php больше номера в файле с кодом.
function buildKitExec(code, { run }) {
  if (!validRun(run)) throw new Error('номер запуска — латиница и цифры, 4–32 знака');
  const { body, removed } = stripOpenTag(code);
  const prefixLines = HEAD.split('\n').length - 1;
  const shift = prefixLines - removed;
  const fill = (s) => s.replace(/@RUN@/g, run).replace(/@SHIFT@/g, String(shift));
  const code2 = body.endsWith('\n') || body === '' ? body : body + '\n';
  return { php: fill(HEAD) + code2 + fill(TAIL).replace(/^\n/, ''), prefixLines, shift };
}

module.exports = { validRun, buildKitExec };
