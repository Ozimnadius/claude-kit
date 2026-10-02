#!/usr/bin/env node
'use strict';
// Собрать kit-exec.php — файл-канал /kit:server для Битрикса без SSH (спек §7.4).
// node kit-exec.js <код.php> --run N --out <файл> [--env прод|дев] [--url U] [--php P] [--bitrix]
// Код в файле — UTF-8, без <?php (если есть — отрезается). Собранный файл проверяется `php -l`; без проверки файл не
// собирается: ошибку компиляции на сервере увидел бы любой посетитель раньше, чем PHP дошёл бы до проверки прав.
// Скрипт только собирает файл (во временную папку сессии); в корень сайта его кладёт Claude одной записью.
// Коды: 0 — собрано; 1 — php -l нашёл ошибку в коде; 2 — не режим bitrix или нет адреса сервера; 4 — аргументы, файл
// (не читается или не в UTF-8), --run, php -l не удалось выполнить (нет параметра «PHP», php не запустился), запись --out.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readParams } = require('./lib/params');
const { buildKitExec, validRun } = require('./lib/kitexec');
const { fixLines } = require('./remote-php');

const USAGE = 'Использование: node kit-exec.js <код.php> --run N --out <файл> [--env прод|дев] [--url U] [--php P] [--bitrix]';
const VALUE_FLAGS = { '--run': 'run', '--out': 'out', '--env': 'env', '--url': 'url', '--php': 'php' };

function parseArgs(argv) {
  const o = { env: 'прод', file: null, bitrix: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[VALUE_FLAGS[a]] = argv[++i];
    } else if (a === '--bitrix') {
      o.bitrix = true;
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.file) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.file = a;
    }
  }
  if (!o.file) throw new Error('не указан файл с кодом');
  if (!o.out) throw new Error('не указан --out');
  if (o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (!validRun(o.run)) throw new Error('--run: номер запуска — латиница и цифры, 4–32 знака');
  return o;
}

// Адрес страницы: <адрес сайта>/kit-exec.php?run=<номер запуска> (без номера файл код не выполняет).
function pageUrl(base, run) {
  return String(base).replace(/\/+$/, '') + '/kit-exec.php?run=' + run;
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('kit-exec: ' + e.message + '\n' + USAGE);
    return 4;
  }
  let code;
  try {
    code = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.resolve(o.file)));
  } catch (e) {
    console.error(e.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'
      ? 'kit-exec: ' + o.file + ' не в UTF-8 — сохрани код в UTF-8; строки для сайта в windows-1251 приводи в самом коде (mb_convert_encoding)'
      : 'kit-exec: не удалось прочитать ' + o.file + ': ' + e.message);
    return 4;
  }
  const params = readParams(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const bitrix = o.bitrix || String(params.get('Режим', 'общий')).toLowerCase() === 'bitrix';
  const url = o.url || params.get(o.env === 'дев' ? 'Дев' : 'Прод');
  if (!bitrix) {
    console.error('kit-exec: файл-канал — только для сайтов на 1С-Битрикс (параметр «Режим: bitrix»); выполнить на сервере негде — включить SSH, справка reference/ssh.md');
    return 2;
  }
  if (!url) {
    console.error('kit-exec: нет адреса сервера «' + o.env + '» (параметр «' + (o.env === 'дев' ? 'Дев' : 'Прод') + '» или --url)');
    return 2;
  }
  const { php, prefixLines, shift } = buildKitExec(code, { run: o.run });
  const phpBin = o.php || params.get('PHP');
  if (!phpBin || !fs.existsSync(phpBin)) {
    console.error('kit-exec: не могу проверить php -l — нет параметра «PHP» (или --php) с путём к php.exe; без проверки файл не собираю');
    return 4;
  }
  const r = spawnSync(phpBin, ['-l'], { input: php, encoding: 'utf8', timeout: 60000 });
  const lintOut = (r.stdout || '') + (r.stderr || '');
  // Ошибка в коде — вывод php -l с Parse error / Fatal error; иное (не запустился, упал, вышло время) — не вина кода.
  if (r.error || r.status === null || (r.status !== 0 && !/Parse error|Fatal error|Errors parsing/i.test(lintOut))) {
    console.error('kit-exec: php -l не удалось выполнить (' + (r.error ? r.error.message : r.status === null ? 'остановлен по сигналу или времени' : 'код ' + r.status) + ') — проверь путь в параметре «PHP» и повтори');
    return 4;
  }
  if (r.status !== 0) {
    const text = fixLines(lintOut, o.file, prefixLines, shift, 'приставка kit-exec')
      .replace(/^Errors parsing Standard input code\r?\n?/mg, '');
    console.error('kit-exec: php -l нашёл ошибку:\n' + text.trim());
    return 1;
  }
  try {
    fs.writeFileSync(path.resolve(o.out), php, 'utf8');
  } catch (e) {
    console.error('kit-exec: не удалось записать ' + o.out + ': ' + e.message);
    return 4;
  }
  console.log('Собрано: ' + o.out + ' (номер запуска ' + o.run + ')');
  console.log('Адрес: ' + pageUrl(url, o.run));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error('kit-exec: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 1;
  }
}
module.exports = { parseArgs, pageUrl };
