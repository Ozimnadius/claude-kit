#!/usr/bin/env node
'use strict';
// Выполнить PHP-код на сервере по SSH (канал SSH скилла /kit:server).
// node remote-php.js [--env прод|дев] [--timeout сек] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>
// Код в файле — без <?php (если есть — отрезается). Режим bitrix (параметр «Режим» или --bitrix): перед кодом
// подключается ядро Битрикса. Код уходит на stdin «PHP на сервере», файл на сервер не пишется. PHP запускается под
// `timeout` сервера (если он есть) на --timeout секунд (по умолчанию 90), сам ssh останавливается на 10 секунд позже.
// Коды: 0 — выполнено; 1 — PHP завершился не 0; 2 — SSH для сервера не задан; 3 — нет подключения, оно оборвалось или
// вышло время (в том числе PHP снят сервером: по --timeout — код 124, по SIGKILL — 137); 4 — аргументы, файл, путь, переписанный
// Git Bash или MSYS2, или неверный параметр «SSH прод» / «SSH дев».
const fs = require('fs');
const path = require('path');
const { readParams } = require('./lib/params');
const { shq, validHost, serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { isMsysRewritten } = require('./lib/msys');

const USAGE = 'Использование: node remote-php.js [--env прод|дев] [--timeout сек] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>';
const VALUE_FLAGS = { '--env': 'env', '--host': 'host', '--root': 'root', '--php': 'php', '--url': 'url', '--timeout': 'timeout' };
// Вместе с запасом ssh (10 с) — 100 с: меньше таймаута инструмента Bash (120 с), отсчёт которого начался раньше
// (запуск node, чтение параметров), поэтому при зависании PHP получим код 3, а не обрыв всего вызова.
const DEFAULT_TIMEOUT = 90;
// ssh останавливается позже серверного timeout: сначала PHP снимает сервер, потом — запасной таймер.
// KIT_SSH_GRACE — только для тестов (иначе проверка зависания длилась бы 10 секунд); не целое от 0 до 9999 — берётся
// 10: иначе NaN или минус отключили бы запасной таймер совсем, а огромное число переполнило бы setTimeout.
const graceFrom = (v) => (v !== undefined && /^\d{1,4}$/.test(v) ? Number(v) : 10);
const SSH_GRACE = graceFrom(process.env.KIT_SSH_GRACE);
// Строка PHP в одинарных кавычках.
const pq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

// Папка сайта на сервере — абсолютный путь POSIX; Windows-путь принимается ради тестов с локальным PHP.
const isAbsolute = (p) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);

function parseArgs(argv) {
  const o = { env: 'прод', mode: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[VALUE_FLAGS[a]] = argv[++i];
    } else if (a === '--plain' || a === '--bitrix') {
      o.mode = a.slice(2);
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.file) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.file = a;
    }
  }
  if (!o.file) throw new Error('не указан файл с кодом');
  if (o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (o.host !== undefined && !validHost(o.host)) throw new Error('недопустимый хост ' + o.host);
  if (o.timeout !== undefined && !(/^\d+$/.test(o.timeout) && Number(o.timeout) >= 1 && Number(o.timeout) <= 3600)) {
    throw new Error('--timeout: секунды, от 1 до 3600');
  }
  o.timeoutSec = o.timeout === undefined ? DEFAULT_TIMEOUT : Number(o.timeout);
  for (const k of ['root', 'php']) {
    if (o[k] !== undefined && isMsysRewritten(o[k])) {
      throw new Error('--' + k + ' ' + o[k] + ': Git Bash (MSYS2) переписал путь сервера — запусти с MSYS_NO_PATHCONV=1 (MSYS2 — MSYS2_ARG_CONV_EXCL=\'*\') перед node (путь к файлу тогда — в виде C:/…) или из PowerShell');
    }
  }
  return o;
}

function domainOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch (e) {
    return null;
  }
}

// Приставка режима bitrix: DOCUMENT_ROOT, домен, ядро без агентов, статистики и почтовых событий, вывод в UTF-8.
function bitrixPrefix(root, domain) {
  const lines = ['<?php', "$_SERVER['DOCUMENT_ROOT'] = " + pq(root) + ';'];
  if (domain) lines.push("$_SERVER['HTTP_HOST'] = $_SERVER['SERVER_NAME'] = " + pq(domain) + ';');
  lines.push(
    "define('NO_KEEP_STATISTIC', true); define('NOT_CHECK_PERMISSIONS', true);",
    "define('NO_AGENT_CHECK', true); define('NO_AGENT_STATISTIC', true); define('DisableEventsCheck', true);",
    "define('BX_NO_ACCELERATOR_RESET', true); define('STOP_STATISTICS', true);",
    "chdir($_SERVER['DOCUMENT_ROOT']);",
    "require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';",
    "if (!defined('BX_UTF') || !BX_UTF) { ob_start(function ($s) { return mb_convert_encoding($s, 'UTF-8', 'Windows-1251'); }); }",
  );
  return lines.join('\n') + '\n';
}

// Общий режим: чистый PHP; папка сайта известна — DOCUMENT_ROOT задан (нужен check-files.php и delete-list.php).
function plainPrefix(root) {
  return root ? '<?php\n$_SERVER[\'DOCUMENT_ROOT\'] = ' + pq(root) + ';\n' : '<?php\n';
}

// PHP на сервере под `timeout`, если он есть (coreutils): по истечении секунд — SIGTERM (код 124), через 5 с (-k) —
// SIGKILL всей группе процессов, в том числе самому timeout, — тогда оболочка видит 137, а не 124.
// Ветки if/else — обе читают stdin, выполняется одна.
function remoteCommand(phpBin, seconds) {
  const p = shq(phpBin);
  return 'if command -v timeout >/dev/null 2>&1; then timeout -k 5 ' + seconds + ' ' + p + '; else ' + p + '; fi';
}

// Скрипт для stdin: приставка + код без <?php. shift — на сколько номер строки в скрипте больше номера в файле.
function buildScript(code, { mode, root, domain }) {
  let body = String(code).replace(/^\uFEFF/, '');
  let removed = 0;
  const open = /^<\?php(?:[ \t]*\r?\n|[ \t]+|$)/i.exec(body);
  if (open) {
    removed = open[0].includes('\n') ? 1 : 0;
    body = body.slice(open[0].length);
  }
  const prefix = mode === 'bitrix' ? bitrixPrefix(root, domain) : plainPrefix(root);
  const prefixLines = prefix.split('\n').length - 1;
  return { script: prefix + body, prefixLines, shift: prefixLines - removed };
}

// «Standard input code» → путь файла; номер строки — строка файла, строки приставки помечаются.
function fixLines(text, file, prefixLines, shift, label = 'приставка remote-php') {
  return String(text).replace(/Standard input code( on line |:|\()(\d+)/g, (m, sep, n) => {
    const line = Number(n);
    return line <= prefixLines ? label + sep + line : file + sep + (line - shift);
  });
}

const stripPre = (text) => String(text).replace(/<\/?pre>/gi, '');

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('remote-php: ' + e.message + '\n' + USAGE);
    return 4;
  }
  let code;
  try {
    code = fs.readFileSync(path.resolve(o.file), 'utf8');
  } catch (e) {
    console.error('remote-php: не удалось прочитать ' + o.file + ': ' + e.message);
    return 4;
  }
  const params = readParams(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const sshKey = 'SSH ' + o.env;
  const parsed = serverSsh(params, o.env);
  // Значение задано, но не разобралось (~, порт, кавычки в папке) — это ошибка, а не «SSH не задан».
  if (!o.host && !parsed && params.get(sshKey)) {
    console.error('remote-php: параметр «' + sshKey + '» неверный: ' + params.get(sshKey) +
      ' — нужно хост:/абсолютная/папка (в папке без кавычек, `, $ и \\), порт — только через ~/.ssh/config');
    return 4;
  }
  const target = parsed || {};
  const host = o.host || target.host;
  const mode = o.mode || (String(params.get('Режим', 'общий')).toLowerCase() === 'bitrix' ? 'bitrix' : 'plain');
  const url = o.url || params.get(o.env === 'дев' ? 'Дев' : 'Прод');
  if (!host) {
    console.error('remote-php: SSH для сервера «' + o.env + '» не задан (параметр «' + sshKey + '») — ' + (mode === 'bitrix' && url
      ? 'выполнить через файл kit-exec.php (/kit:server, файл-канал: node kit-exec.js)'
      : 'выполнить на сервере негде: включить SSH, справка reference/ssh.md'));
    return 2;
  }
  const root = o.root || target.root;
  if ((mode === 'bitrix' && !root) || (root && !isAbsolute(root))) {
    console.error('remote-php: ' + (mode === 'bitrix' ? 'для ядра Битрикса нужна ' : 'нужна ') +
      'папка сайта — абсолютный путь (параметр «' + sshKey + '» или --root)');
    return 4;
  }
  const phpBin = o.php || params.get('PHP на сервере', 'php');
  const { script, prefixLines, shift } = buildScript(code, { mode, root, domain: url ? domainOf(url) : null });
  const r = await runSsh(host, remoteCommand(phpBin, o.timeoutSec), script, { timeoutMs: (o.timeoutSec + SSH_GRACE) * 1000 });
  const fix = (t) => fixLines(t, o.file, prefixLines, shift);
  process.stdout.write(fix(stripPre(r.stdout)));
  if (r.stderr) process.stderr.write(fix(r.stderr));
  const unknown = ' Если код что-то менял — результат неизвестен: не повторять, проверить состояние чтением.';
  if (!r.connected) {
    if (r.timedOut) {
      console.error('remote-php: вышло время (' + o.timeoutSec + ' с + ' + SSH_GRACE + ' с), ssh остановлен; долгому скрипту — больший --timeout.' + unknown);
      return 3;
    }
    const why = lastLine(r.stderr);
    console.error('remote-php: нет подключения к ' + host + ' или оно оборвалось' + (why ? ': ' + why : '') + '.' + unknown);
    return 3;
  }
  if (r.exitCode === 124) {
    console.error('remote-php: PHP не уложился в --timeout ' + o.timeoutSec + ' с и остановлен на сервере (timeout); долгому скрипту — больший --timeout.' + unknown);
    return 3;
  }
  if (r.exitCode === 137) {
    // SIGKILL: либо timeout добил PHP через 5 с после SIGTERM (тогда виден и он сам), либо убила нехватка памяти или лимит хостинга.
    console.error('remote-php: PHP снят сигналом (код 137, SIGKILL): вышло --timeout ' + o.timeoutSec + ' с (timeout -k) или нехватка памяти / лимит хостинга; больший --timeout поможет только в первом случае.' + unknown);
    return 3;
  }
  if (r.exitCode !== 0) {
    console.error('remote-php: PHP завершился с кодом ' + r.exitCode);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
    console.error('remote-php: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 1;
  });
}
module.exports = { parseArgs, buildScript, bitrixPrefix, plainPrefix, remoteCommand, fixLines, stripPre, DEFAULT_TIMEOUT, graceFrom };
