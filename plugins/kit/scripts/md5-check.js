#!/usr/bin/env node
'use strict';
// Печатает код сверки md5 файлов на сервере с локальными — для /kit:server (remote-php.js или файл-канал kit-exec.php).
// Запуск в корне проекта: node md5-check.js <файлы…> (пути от корня проекта = от корня сайта).
// Шаблон — skills/server/scripts/check-files.php, список вставляется в строку «$files = []; // KIT:FILES».
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'server', 'scripts', 'check-files.php');
const MARK = /^\$files = \[\];.*KIT:FILES.*$/m;

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function build(files, cwd) {
  const rows = files.map((f) => {
    const rel = f.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    const buf = fs.readFileSync(path.join(cwd, rel));
    const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    return '    ' + q(rel) + ' => [' + q(md5(buf)) + ', ' + q(md5(lf)) + '],';
  });
  const tpl = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
  if (!MARK.test(tpl)) throw new Error('в check-files.php нет строки «$files = []; // KIT:FILES»');
  const g = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' });
  const commit = g.status === 0 ? g.stdout.trim() : '—';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const head = '// Сгенерировано md5-check.js ' + stamp + ' UTC, коммит ' + commit + ', файлов: ' + rows.length + '\n';
  return head + tpl.replace(MARK, () => '$files = [\n' + rows.join('\n') + '\n];');
}

function main(argv) {
  if (!argv.length) {
    console.error('Использование: node md5-check.js <файлы…>');
    return 1;
  }
  try {
    process.stdout.write(build(argv, process.cwd()));
    return 0;
  } catch (e) {
    console.error('md5-check: ' + e.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { build };
