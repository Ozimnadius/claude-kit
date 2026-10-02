#!/usr/bin/env node
'use strict';
// Хук PostToolUse (Write|Edit|MultiEdit): php -l версией PHP из параметров проекта («PHP»).
// Параметр «PHP» принимается, только если это абсолютный путь к существующему php.exe; иначе хук молчит.
// Скрипты /kit:server лежат без <?php — их проверяем через временный файл в os.tmpdir()
// с приставкой «<?php\n»: файл вне папки проекта, на автозаливку не влияет.
// Ошибка синтаксиса (PHP написал «… error …») → stderr и код 2 (Claude видит сообщение). Иначе — в том числе если PHP
// упал без сообщения — и при любой внутренней ошибке — тихо, код 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const CONSOLE_DIRS = ['/.claude/scripts/', '/skills/server/scripts/'];

function isConsoleScript(file, src) {
  const p = file.replace(/\\/g, '/');
  return CONSOLE_DIRS.some((d) => p.includes(d)) && !/<\?(php|=)/i.test(src);
}

// Только абсолютный путь, оканчивающийся на php.exe (регистр не важен), и файл существует.
function validPhpExe(phpExe) {
  return Boolean(phpExe) && path.isAbsolute(phpExe) && /(^|[\\/])php\.exe$/i.test(phpExe) && fs.existsSync(phpExe);
}

function phpLabel(phpExe) {
  const m = /PHP-?(\d+\.\d+)/i.exec(phpExe);
  return m ? 'PHP ' + m[1] : 'PHP';
}

function lint(phpExe, file) {
  const src = fs.readFileSync(file, 'utf8');
  const consoleMode = isConsoleScript(file, src);
  const opts = { encoding: 'utf8', timeout: 20000 };
  let tmpFile = null;
  let res;
  try {
    if (consoleMode) {
      tmpFile = path.join(os.tmpdir(), 'kit-php-lint-' + process.pid + '-' + Date.now() + '.php');
      fs.writeFileSync(tmpFile, '<?php\n' + src);
      res = spawnSync(phpExe, ['-l', tmpFile], opts);
    } else {
      res = spawnSync(phpExe, ['-l', file], opts);
    }
  } finally {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch (e) { /* временный файл — не критично */ }
    }
  }
  if (res.error || res.status === 0) return { ok: true };
  const seen = new Set();
  const lines = [];
  for (const raw of ((res.stdout || '') + '\n' + (res.stderr || '')).split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^No syntax errors/i.test(l) || /^Errors parsing/i.test(l)) continue;
    l = l.replace(/^PHP\s+/, '');
    if (consoleMode) {
      l = l.split(tmpFile).join(file);
      l = l.replace(/on line (\d+)/g, (m, n) => 'on line ' + Math.max(1, Number(n) - 1));
    }
    if (!seen.has(l)) {
      seen.add(l);
      lines.push(l);
    }
  }
  // Ошибка — только то, о чём написал сам PHP («Parse error», «Fatal error»): код выхода не годится (PHP 7 — -1,
  // PHP 8 — 255), а упавший PHP (0xC0000005 при параллельных запусках) выходит не 0 и молчит (К44).
  if (!lines.some((l) => /error/i.test(l))) return { ok: true };
  return { ok: false, text: lines.join('\n') };
}

function main() {
  try {
    const input = readStdinJson();
    const file = input.tool_input && input.tool_input.file_path;
    if (!file || !/\.php$/i.test(file)) return 0;
    const info = kitInfo(resolveProjectDir(input));
    if (!info.isKit) return 0;
    const phpExe = info.params.get('PHP');
    if (!validPhpExe(phpExe)) return 0;
    const abs = path.resolve(info.dir, file);
    if (!fs.existsSync(abs)) return 0;
    const r = lint(phpExe, abs);
    if (r.ok) return 0;
    process.stderr.write('php -l (' + phpLabel(phpExe) + ') нашёл ошибку в ' + file + ':\n' + r.text + '\n');
    return 2;
  } catch (e) {
    return 0;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { lint, isConsoleScript, validPhpExe };
