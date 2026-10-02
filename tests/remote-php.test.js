'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, php, hasPhp, runPhp } = require('./helpers');
const { DEFAULT_TIMEOUT, graceFrom } = require('../plugins/kit/scripts/remote-php');

const FAKE = path.join(__dirname, 'fake-ssh.js');
const skip = !hasPhp('7.4');
const params = (lines) => '# Проект\n\n## Параметры для агентов\n\n' + lines.join('\n') + '\n';

function run(project, args, env = {}) {
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('remote-php.js', { args, cwd: project, env: { KIT_SSH: FAKE, FAKE_SSH_LOG: log, ...env } });
  const sent = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null;
  return { ...r, sent };
}

const fakeSite = (prolog) => writeFiles(tmpDir('kit-site-'), { 'bitrix/modules/main/include/prolog_before.php': prolog });

test('remote-php: аргументы, файл и хост — код 4, ssh не запускается', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  for (const args of [[], ['--nope', 'a.php'], ['--env', 'тест', 'a.php'], ['--host', 'ok', 'нет.php'],
    ['--host', '-oProxyCommand=calc', 'a.php'], ['a.php', 'b.php'], ['--host'],
    ['--bitrix', '--host', 'ok', '--root', 'var/www', 'a.php']]) {
    const r = run(p, args);
    assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
    assert.equal(r.sent, null, JSON.stringify(args));
  }
});

test('remote-php: путь сервера, переписанный Git Bash или MSYS2, — код 4 с подсказкой MSYS_NO_PATHCONV=1 / MSYS2_ARG_CONV_EXCL', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  for (const args of [['--host', 'ok', '--php', 'C:/Program Files/Git/opt/php74/bin/php', 'a.php'],
    ['--bitrix', '--host', 'ok', '--root', 'C:/Program Files/Git/var/www/x', 'a.php'],
    ['--host', 'ok', '--php', 'C:/msys64/opt/php74/bin/php', 'a.php'],
    ['--bitrix', '--host', 'ok', '--root', 'C:/msys64/var/www/x', 'a.php']]) {
    const r = run(p, args);
    assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
    assert.match(r.stderr, /MSYS_NO_PATHCONV=1/, JSON.stringify(args));
    assert.match(r.stderr, /MSYS2_ARG_CONV_EXCL/, JSON.stringify(args));
    assert.equal(r.sent, null, JSON.stringify(args));
  }
});

test('remote-php: неверный «SSH прод» (~ или порт) — код 4, а не «не задан»', () => {
  for (const value of ['alpha:~/www/x', 'host:2222:/x']) {
    const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- SSH прод: ' + value]) });
    const r = run(p, ['a.php']);
    assert.equal(r.code, 4, value + ': ' + r.stderr);
    assert.match(r.stderr, /«SSH прод» неверный/, value);
    assert.match(r.stderr, /~\/\.ssh\/config/, value);
    assert.equal(r.sent, null, value);
  }
});

test('remote-php: SSH для сервера не задан — код 2; файл kit-exec.php — только bitrix с адресом, иначе выполнить негде', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- SSH прод: —']) });
  const r = run(p, ['a.php']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SSH прод/);
  assert.match(r.stderr, /kit-exec/);
  assert.equal(r.sent, null);
  for (const lines of [['- Режим: общий', '- Прод: https://x.ru', '- SSH прод: —'], ['- Режим: bitrix', '- Прод: —', '- SSH прод: —']]) {
    const g = run(makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(lines) }), ['a.php']);
    assert.equal(g.code, 2, lines.join(' '));
    assert.match(g.stderr, /негде/, lines.join(' '));
    assert.match(g.stderr, /включить SSH/, lines.join(' '));
    assert.match(g.stderr, /reference\/ssh\.md/, lines.join(' '));
    assert.doesNotMatch(g.stderr, /kit-exec/, lines.join(' '));
  }
});

test('remote-php: --timeout — от 1 до 3600 секунд, иначе код 4', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  for (const value of ['0', '3601', 'abc', '-5', '1.5', '']) {
    const r = run(p, ['--host', 'ok', '--timeout', value, 'a.php']);
    assert.equal(r.code, 4, JSON.stringify(value) + ': ' + r.stderr);
    assert.match(r.stderr, /--timeout/);
    assert.equal(r.sent, null, JSON.stringify(value));
  }
});

test('remote-php: PHP запускается под серверным timeout (по умолчанию 90 с, --timeout меняет), stdin идёт в PHP', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const d = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(d.code, 0, d.stderr);
  assert.equal(d.stdout, '1');
  assert.equal(d.sent.command, 'if command -v timeout >/dev/null 2>&1; then timeout -k 5 90 \'' + php('7.4') + '\'; else \'' + php('7.4') + '\'; fi; printf "\\n__KIT_EXIT=%s\\n" "$?"');
  // 90 + 10 (запас ssh) с — меньше лимита инструмента Bash (120 с): запасной таймер успевает дать код 3.
  assert.ok(DEFAULT_TIMEOUT + graceFrom(undefined) < 120);
  const t = run(p, ['--host', 'ok', '--timeout', '30', '--php', php('7.4'), 'a.php']);
  assert.match(t.sent.command, /timeout -k 5 30 '/);
});

test('remote-php: зависание — ssh останавливается по времени, код 3 «результат неизвестен»', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const r = run(p, ['--host', 'hang', '--timeout', '1', 'a.php'], { KIT_SSH_GRACE: '0' });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /вышло время/);
  assert.match(r.stderr, /результат неизвестен/);
  assert.equal((r.stderr.match(/время вышло|вышло время/g) || []).length, 1, 'о таймауте сказано один раз');
});

// 124 — timeout снял PHP по SIGTERM; 137 — PHP снят SIGKILL: либо не отпустил SIGTERM и через 5 с (-k) получил его
// от timeout (тот шлёт его всей своей группе, в том числе себе, поэтому оболочка видит 128+9, а не 124), либо его
// убила нехватка памяти или лимит хостинга. Результат в обоих случаях неизвестен, причина 137 — не только --timeout.
for (const [exit, message] of [['124', /не уложился в --timeout 5 с/], ['137', /снят сигналом \(код 137, SIGKILL\).*--timeout 5 с.*нехватка памяти/]]) {
  test(`remote-php: PHP остановлен на сервере (код ${exit}) — код 3 «результат неизвестен»`, () => {
    const p = makeProject({ 'a.php': 'echo 1;\n' });
    const r = run(p, ['--host', 'ok', '--timeout', '5', 'a.php'], { FAKE_SSH_OUT: 'начало', FAKE_SSH_EXIT: exit });
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.stdout, 'начало');
    assert.match(r.stderr, message);
    assert.match(r.stderr, /результат неизвестен/);
  });
}

test('remote-php: другой код PHP — код 1, не таймаут', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const r = run(p, ['--host', 'ok', 'a.php'], { FAKE_SSH_OUT: 'x', FAKE_SSH_EXIT: '255' });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /PHP завершился с кодом 255/);
});

test('graceFrom: KIT_SSH_GRACE — целое от 0 до 9999; нечисловое, отрицательное, пустое и огромное — 10, а не отключённый таймер', () => {
  assert.equal(graceFrom(undefined), 10);
  assert.equal(graceFrom('0'), 0);
  assert.equal(graceFrom('3'), 3);
  assert.equal(graceFrom('9999'), 9999);
  // Огромное значение переполнило бы setTimeout (больше 2^31 мс) — таймер сработал бы через 1 мс.
  for (const bad of ['abc', '-5', '', '1.5', ' 3', '3 с', '10000', '99999999999']) assert.equal(graceFrom(bad), 10, JSON.stringify(bad));
});

test('remote-php: общий режим — DOCUMENT_ROOT из «SSH …» или --root; без папки — чистый PHP; неабсолютная --root — код 4', () => {
  const withRoot = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', '--root', '/var/www/it\'s', 'a.php']);
  assert.equal(withRoot.sent.stdin, '<?php\n$_SERVER[\'DOCUMENT_ROOT\'] = \'/var/www/it\\\'s\';\necho 1;\n');
  const noRoot = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', 'a.php']);
  assert.equal(noRoot.sent.stdin, '<?php\necho 1;\n');
  const bad = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', '--root', 'var/www', 'a.php']);
  assert.equal(bad.code, 4);
  assert.match(bad.stderr, /папка сайта/);
  assert.equal(bad.sent, null);
});

test('remote-php: чистый PHP — вывод без <pre>, на stdin — код с приставкой, PHP в кавычках', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo "<pre>привет\\n</pre>";\n' });
  const r = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'привет\n');
  assert.equal(r.sent.host, 'ok');
  assert.ok(r.sent.opts.includes('BatchMode=yes'));
  assert.ok(r.sent.command.includes("'" + php('7.4') + "'"), r.sent.command);
  assert.equal(r.sent.stdin, '<?php\necho "<pre>привет\\n</pre>";\n');
});

test('remote-php: <?php в файле отрезается; ошибка разбора — номер строки файла, код 1', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo 1;\necho 1 +;\n', 'b.php': '<?php\necho 1;\necho 1 +;\n' });
  const a = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(a.code, 1);
  assert.match(a.stdout + a.stderr, /a\.php on line 2/);
  assert.doesNotMatch(a.stdout + a.stderr, /Standard input code/);
  const b = run(p, ['--host', 'ok', '--php', php('7.4'), 'b.php']);
  assert.equal(b.code, 1);
  assert.match(b.stdout + b.stderr, /b\.php on line 3/);
  assert.ok(!b.sent.stdin.includes('<?php\n<?php'));
});

test('remote-php: фатальная ошибка PHP (255) — код 1, а не «нет подключения»', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo "до";\nthrow new Exception("x");\n' });
  const r = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /до/);
  assert.match(r.stderr, /a\.php(:| on line )2/);
  assert.match(r.stderr, /кодом 255/);
});

test('remote-php: --bitrix — DOCUMENT_ROOT, домен, без агентов, ядро подключено; строки считаются от файла', { skip }, () => {
  const site = fakeSite("<?php\ndefine('BX_UTF', true);\necho '[ядро]';\n");
  const root = site.replace(/\\/g, '/');
  const p = makeProject({
    'a.php': 'echo "|", $_SERVER["DOCUMENT_ROOT"], "|", $_SERVER["HTTP_HOST"], "|", defined("NO_AGENT_CHECK") ? "без агентов" : "с агентами", "|";\n',
    'b.php': 'echo 1;\necho 1 +;\n',
  });
  const args = ['--bitrix', '--host', 'ok', '--root', root, '--php', php('7.4'), '--url', 'https://alpha.example.com/'];
  const r = run(p, [...args, 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '[ядро]|' + root + '|alpha.example.com|без агентов|');
  const b = run(p, [...args, 'b.php']);
  assert.equal(b.code, 1);
  assert.match(b.stdout + b.stderr, /b\.php on line 2/);
});

test('remote-php: сайт не в UTF-8 — вывод перекодируется из windows-1251', { skip }, (t) => {
  if (runPhp('7.4', '<?php echo extension_loaded("mbstring") ? "да" : "нет";').stdout !== 'да') {
    t.skip('в PHP 7.4 нет mbstring');
    return;
  }
  const site = fakeSite('<?php\n');
  const p = makeProject({ 'a.php': 'echo "\\xE0\\xE1";\n' });
  const r = run(p, ['--bitrix', '--host', 'ok', '--root', site.replace(/\\/g, '/'), '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'аб');
});

test('remote-php: --bitrix без папки сайта — код 4', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const r = run(p, ['--bitrix', '--host', 'ok', 'a.php']);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /папка сайта/);
  assert.equal(r.sent, null);
});

test('remote-php: параметры проекта — хост, папка, PHP на сервере, режим bitrix, домен из «Прод»; дев не задан — код 2', { skip }, () => {
  const p = makeProject({
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://alpha.example.com', '- SSH прод: `ok:/var/www/site/`', '- SSH дев: —',
      '- PHP на сервере: ' + php('7.4')]),
    'a.php': 'echo 1;\n',
  });
  const r = run(p, ['a.php']);
  assert.equal(r.sent.host, 'ok');
  assert.ok(r.sent.command.includes("'" + php('7.4') + "'"));
  assert.match(r.sent.stdin, /\$_SERVER\['DOCUMENT_ROOT'\] = '\/var\/www\/site';/);
  assert.match(r.sent.stdin, /\$_SERVER\['HTTP_HOST'\] = \$_SERVER\['SERVER_NAME'\] = 'alpha\.example\.com';/);
  assert.match(r.sent.stdin, /define\('NO_AGENT_CHECK', true\)/);
  assert.match(r.sent.stdin, /prolog_before\.php/);
  assert.equal(run(p, ['--env', 'дев', 'a.php']).code, 2);
  assert.equal(run(p, ['--plain', 'a.php']).sent.stdin, "<?php\n$_SERVER['DOCUMENT_ROOT'] = '/var/www/site';\necho 1;\n");
});

test('remote-php: не пустил — код 3 с причиной; обрыв после начала вывода — код 3, вывод показан', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const down = run(p, ['--host', 'down', 'a.php']);
  assert.equal(down.code, 3);
  assert.match(down.stderr, /Connection timed out/);
  assert.match(down.stderr, /remote-php: нет подключения к down/);
  const drop = run(p, ['--host', 'drop', 'a.php']);
  assert.equal(drop.code, 3);
  assert.equal(drop.stdout, 'начало\n');
  assert.match(drop.stderr, /результат неизвестен/);
});

const { phpLint } = require('./helpers');
const { buildScript } = require('../plugins/kit/scripts/remote-php');

for (const v of ['7.2', '7.4', '8.3']) {
  test(`remote-php: приставка bitrix и библиотечные скрипты проходят php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    const dir = path.join(__dirname, '..', 'plugins', 'kit', 'skills', 'server', 'scripts');
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      const { script } = buildScript(src, { mode: 'bitrix', root: "/var/www/it's", domain: 'alpha.example.com' });
      const r = phpLint(v, script);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
  });
}
