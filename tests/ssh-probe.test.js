'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runScript, writeFiles, tmpDir } = require('./helpers');
const { parseArgs, domainsOf, probeScript, parseProbe, format, workCandidates } = require('../plugins/kit/scripts/ssh-probe');

const FAKE = path.join(__dirname, 'fake-ssh.js');

test('ssh-probe: домены — как есть и без www', () => {
  assert.deepEqual(domainsOf('https://www.alpha.example.com/'), ['www.alpha.example.com', 'alpha.example.com']);
  assert.deepEqual(domainsOf('https://alpha.example.com'), ['alpha.example.com']);
  assert.deepEqual(domainsOf('не адрес'), []);
});

test('ssh-probe: вывод — папки без повторов, пометки bitrix и «совпадает»; скрипт уходит на stdin sh -s', () => {
  const out = ['USER user100', 'HOME /var/www/user100/data',
    'DIR /var/www/user100/data/www/alpha.example.com bitrix', 'DIR /var/www/user100/data/www/alpha.example.com bitrix',
    'PHP /opt/php54/bin/php 5.4.45', 'PHP /opt/php74/bin/php 7.4.33', 'PHP /usr/bin/php 5.4.45'].join('\n');
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-probe.js', {
    args: ['ok', '--url', 'https://www.alpha.example.com', '--php', '7.4'],
    env: { KIT_SSH: FAKE, FAKE_SSH_LOG: log, FAKE_SSH_OUT: out },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, [
    'Подключение: ок (user100, /var/www/user100/data)',
    'Папка: /var/www/user100/data/www/alpha.example.com [bitrix]',
    '  где правят — кандидаты в bitrix/: нет',
    'PHP: /opt/php54/bin/php 5.4.45',
    'PHP: /opt/php74/bin/php 7.4.33 [совпадает]',
    'PHP: /usr/bin/php 5.4.45',
  ].join('\n') + '\n');
  const sent = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(sent.host, 'ok');
  assert.match(sent.command, /^sh -s; printf/);
  assert.ok(sent.stdin.includes("\"$HOME\"/www/'www.alpha.example.com'"));
  assert.ok(sent.stdin.includes("\"$HOME\"/www/'alpha.example.com'"));
  assert.ok(sent.stdin.includes('/home/bitrix/www'));
});

test('ssh-probe: ничего не найдено — подсказки вместо пустоты', () => {
  const r = runScript('ssh-probe.js', { args: ['ok'], env: { KIT_SSH: FAKE, FAKE_SSH_OUT: 'USER u\nHOME /home/u' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Папка: не найдена — спросить пользователя$/m);
  assert.match(r.stdout, /^PHP: не найден$/m);
});

test('ssh-probe: не пустил — код 3 с причиной; аргументы и хост — код 4', () => {
  const r = runScript('ssh-probe.js', { args: ['denied'], env: { KIT_SSH: FAKE } });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Permission denied \(publickey\)/);
  for (const args of [[], ['-oProxyCommand=x'], ['ok', '--php'], ['ok', '--nope'], ['ok', 'лишний']]) {
    assert.equal(runScript('ssh-probe.js', { args, env: { KIT_SSH: FAKE } }).code, 4, JSON.stringify(args));
  }
});

test('ssh-probe: скрипт разведки завершился не 0 — код 1, вывод показан, stderr и предупреждение', () => {
  const r = runScript('ssh-probe.js', { args: ['ok'], env: { KIT_SSH: FAKE, FAKE_SSH_OUT: 'USER u\nHOME /home/u', FAKE_SSH_EXIT: '2' } });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stdout, /^Подключение: ок \(u, \/home\/u\)$/m);
  assert.match(r.stderr, /ssh-probe: скрипт разведки завершился с кодом 2 — вывод неполный/);
});

test('ssh-probe: PHP в скрипте разведки не читает stdin sh -s (</dev/null)', () => {
  const line = probeScript(['alpha.example.com']).split('\n').find((l) => l.includes('PHP_VERSION'));
  assert.ok(line, 'нет строки с PHP_VERSION');
  assert.match(line, /-r 'echo PHP_VERSION;' <\/dev\/null 2>\/dev\/null/);
});

test('ssh-probe: parseProbe — версия без пометки, если X.Y не задана', () => {
  const p = parseProbe('PHP /opt/php74/bin/php 7.4.33\nPHP /x/php \nDIR /a b/c', null);
  assert.deepEqual(p.php, [{ path: '/opt/php74/bin/php', version: '7.4.33', match: false }, { path: '/x/php', version: null, match: false }]);
  assert.deepEqual(p.dirs, [{ path: '/a b/c', bitrix: false }]);
});

test('ssh-probe: где правят — шаблон без копии, компоненты и js/css решения, действующий bitrix/…/init.php (с 3.2.0)', () => {
  const site = '/var/www/user100/data/www/alpha.example.com';
  const has = (list) => list.map((p) => `HAS ${site} ${p}`);
  const out = ['USER user100', 'HOME /var/www/user100/data', `DIR ${site} bitrix`, ...has([
    'bitrix/templates/.default/', 'bitrix/templates/theme/', 'bitrix/templates/landing/', 'local/templates/landing/',
    'bitrix/components/bitrix/', 'bitrix/components/vendor/', 'bitrix/js/vendor.theme/', 'bitrix/js/main.core/', 'bitrix/css/vendor.theme/',
    'bitrix/php_interface/init.php',
  ])].join('\n');
  const r = runScript('ssh-probe.js', { args: ['ok'], env: { KIT_SSH: FAKE, FAKE_SSH_OUT: out } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^ {2}где правят — кандидаты в bitrix\/: bitrix\/templates\/theme, bitrix\/components\/vendor, bitrix\/js\/vendor\.theme, bitrix\/css\/vendor\.theme, bitrix\/php_interface\/init\.php$/m);
  assert.match(r.stdout, /^ {2}шаблоны с копией в local\/templates \(правят копию\): landing$/m);
  // есть local/php_interface/init.php — действует он, bitrix/…/init.php не кандидат
  assert.deepEqual(workCandidates(['bitrix/php_interface/init.php', 'local/php_interface/init.php']).work, []);
});

const shOk = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout === 'ok\n';

test('ssh-probe: в настоящем sh — строки HAS папки с Битриксом, пути от её корня', { skip: !shOk }, () => {
  const home = writeFiles(tmpDir('kit-home3-'), {
    'www/alpha.example.com/bitrix/.settings.php': '<?php', 'www/alpha.example.com/bitrix/templates/theme/header.php': '',
    'www/alpha.example.com/bitrix/components/vendor/a/component.php': '', 'www/alpha.example.com/bitrix/js/vendor.theme/a.js': '',
    'www/alpha.example.com/bitrix/php_interface/init.php': '<?php', 'public_html/bitrix/templates/x/a.php': '',
  });
  const r = spawnSync('sh', ['-s'], { input: probeScript(['alpha.example.com']), env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const p = parseProbe(r.stdout, null);
  const site = p.dirs.find((d) => /www\/alpha\.example\.com$/.test(d.path));
  assert.ok(site, r.stdout);
  assert.deepEqual(workCandidates(p.has[site.path]).work,
    ['bitrix/templates/theme', 'bitrix/components/vendor', 'bitrix/js/vendor.theme', 'bitrix/php_interface/init.php'], r.stdout);
  const plain = p.dirs.find((d) => /public_html$/.test(d.path));
  assert.ok(plain && !p.has[plain.path], 'у папки без Битрикса строк HAS нет: ' + r.stdout);
});

test('ssh-probe: скрипт разведки в настоящем sh находит папки и пометку bitrix', { skip: !shOk }, () => {
  const home = writeFiles(tmpDir('kit-home-'), { 'www/alpha.example.com/bitrix/.settings.php': '<?php', 'public_html/index.php': '' });
  const r = spawnSync('sh', ['-s'], { input: probeScript(['alpha.example.com']), env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const p = parseProbe(r.stdout, null);
  assert.ok(p.dirs.some((d) => /www\/alpha\.example\.com$/.test(d.path) && d.bitrix), r.stdout);
  assert.ok(p.dirs.some((d) => /public_html$/.test(d.path) && !d.bitrix), r.stdout);
  assert.match(r.stdout, /^USER \S+/m);
});

test('ssh-probe: папка не по домену — находит перебор ~/www/*; по адресу и по --dir — с пометкой, одна папка — один раз (с 3.2.1)', { skip: !shOk }, () => {
  const home = writeFiles(tmpDir('kit-home4-'), {
    'www/site-folder/bitrix/.settings.php': '<?php', 'www/site-folder/bitrix/templates/landing24/a.php': '',
    'www/site-folder/bitrix/templates/theme/a.php': '', 'www/alpha.example.com/bitrix/.settings.php': '<?php', 'www/plain/index.php': '',
  });
  const run = (domains, dirs) => {
    const r = spawnSync('sh', ['-s'], { input: probeScript(domains, dirs), env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return parseProbe(r.stdout, null);
  };
  const p = run(['alpha.example.com'], []);
  const site = p.dirs.find((d) => /www\/site-folder$/.test(d.path));
  const alpha = p.dirs.filter((d) => /www\/alpha\.example\.com$/.test(d.path));
  assert.ok(site && site.bitrix && !p.via[site.path], 'папка не по домену найдена перебором, без пометки: ' + JSON.stringify(p));
  assert.equal(alpha.length, 1, 'папка по домену — один раз, хотя её находит и перебор');
  assert.equal(p.via[alpha[0].path], 'url');
  assert.ok(p.dirs.some((d) => /www\/plain$/.test(d.path) && !d.bitrix));
  const out = format(p);
  assert.match(out, /^Папка: .*www\/alpha\.example\.com \[bitrix\] \[по адресу\]$/m);
  assert.match(out, /^Папка: .*www\/site-folder \[bitrix\]\n {2}где правят — кандидаты в bitrix\/: bitrix\/templates\/theme\n {2}шаблоны ядра \(не правят, не кандидаты\): landing24$/m);
  const d = run([], ['www/site-folder']);
  assert.equal(d.via[d.dirs.find((x) => /site-folder$/.test(x.path)).path], 'dir');
});

test('ssh-probe: --dir — путь без ведущего «/» или с ним; переписанный Git Bash (C:/…) и «..» — код 4', () => {
  assert.deepEqual(parseArgs(['ok', '--dir', '/www/site/', '--dir', 'www/b']).dirs, ['www/site', 'www/b']);
  assert.ok(probeScript([], ['www/site']).includes("probe \"$HOME\"/'www/site' ' via:dir'"));
  for (const bad of ['C:/Program Files/Git/www/site', 'www/../etc', 'a\\b']) {
    assert.equal(runScript('ssh-probe.js', { args: ['ok', '--dir', bad], env: { KIT_SSH: FAKE } }).code, 4, bad);
  }
  assert.deepEqual(workCandidates(['bitrix/templates/.default/', 'bitrix/templates/learning/', 'bitrix/templates/mail_user/', 'bitrix/templates/shop/']),
    { work: ['bitrix/templates/shop'], copies: [], system: ['learning', 'mail_user'] });
});

test('ssh-probe: нет `readlink -f` — запасной путь через cd && pwd -P; версия PHP через "$b" -r', { skip: !shOk }, () => {
  const bin = tmpDir('kit-bin-');
  writeFiles(bin, {
    readlink: '#!/bin/sh\nexit 1\n',
    php: '#!/bin/sh\necho 9.9.9\n',
  });
  spawnSync('sh', ['-c', 'chmod +x "$1/readlink" "$1/php"', '_', bin]);
  const home = writeFiles(tmpDir('kit-home2-'), { 'www/alpha.example.com/bitrix/.settings.php': '<?php' });
  const r = spawnSync('sh', ['-s'], {
    input: probeScript(['alpha.example.com']),
    env: { ...process.env, HOME: home, PATH: bin + ';' + process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const p = parseProbe(r.stdout, null);
  const dir = p.dirs.find((d) => /www\/alpha\.example\.com$/.test(d.path));
  assert.ok(dir, r.stdout);
  assert.ok(dir.bitrix, r.stdout);
  assert.ok(dir.path && !/ bitrix/.test(dir.path), r.stdout);
  assert.ok(p.php.some((x) => x.version === '9.9.9'), r.stdout);
});
