#!/usr/bin/env node
'use strict';
// Версия PHP сайта по заголовку X-Powered-By и путь к такому же php.exe в OSPanel.
// Запуск: node site-probe.js <url>
const fs = require('fs');
const path = require('path');

const MODULES = process.env.KIT_PHP_MODULES || 'C:\\OSPanel\\modules';
const TIMEOUT = Number(process.env.KIT_HTTP_TIMEOUT_MS) || 15000;

function phpExeFor(version) {
  const m = /^(\d+)\.(\d+)/.exec(version || '');
  if (!m) return null;
  const exe = path.join(MODULES, 'PHP-' + m[1] + '.' + m[2], 'php.exe');
  return { exe, exists: fs.existsSync(exe) };
}

async function probe(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'kit-site-probe' }, signal: AbortSignal.timeout(TIMEOUT) });
  try {
    await res.body?.cancel();
  } catch (e) {
    // тело не нужно
  }
  const powered = res.headers.get('x-powered-by') || '';
  const m = /PHP\/(\d+\.\d+(?:\.\d+)?)/i.exec(powered);
  return { status: res.status, finalUrl: res.url, server: res.headers.get('server') || '', powered, php: m ? m[1] : null };
}

async function main(argv) {
  const url = argv[0];
  if (!url) {
    console.error('Использование: node site-probe.js <url>');
    return 1;
  }
  let r;
  try {
    r = await probe(url);
  } catch (e) {
    if (e.name === 'TimeoutError') {
      console.error('site-probe: нет ответа от ' + url + ' за ' + (TIMEOUT / 1000) + ' с');
    } else {
      console.error('site-probe: нет ответа от ' + url + ': ' + e.message);
    }
    return 1;
  }
  const lines = [
    'URL: ' + url + (r.finalUrl && r.finalUrl !== url ? ' → ' + r.finalUrl : '') + ' — ' + r.status,
    'Server: ' + (r.server || '—'),
    'X-Powered-By: ' + (r.powered || '—'),
  ];
  if (r.php) {
    const exe = phpExeFor(r.php);
    lines.push('PHP: ' + r.php + ' → ' + exe.exe + (exe.exists ? ' (есть)' : ' (НЕТ в OSPanel — поставить модуль или взять ближайшую версию)'));
  } else {
    lines.push('PHP: сервер версию не сообщает — узнать по SSH (ssh-probe.js), через /kit:server (echo PHP_VERSION;) или спросить пользователя');
  }
  console.log(lines.join('\n'));
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { phpExeFor, probe };
