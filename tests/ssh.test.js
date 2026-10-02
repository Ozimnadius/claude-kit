'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers');
const { makeParams, parseParams } = require('../plugins/kit/scripts/lib/params');
const { SSH_OPTS, shq, validHost, parseTarget, serverSsh, runSsh, lastLine } = require('../plugins/kit/scripts/lib/ssh');

const FAKE = path.join(__dirname, 'fake-ssh.js');
const KEYS = ['KIT_SSH', 'FAKE_SSH_LOG', 'FAKE_SSH_OUT', 'FAKE_SSH_EXIT'];

// runSsh берёт KIT_SSH из process.env в момент вызова; тесты в файле идут по очереди.
async function withFake(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  Object.assign(process.env, { KIT_SSH: FAKE, FAKE_SSH_LOG: log }, env);
  try {
    const r = await fn();
    return { r, sent: fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null };
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('validHost и parseTarget: хост:абсолютная папка; опции ssh, пробелы и ~ не проходят', () => {
  assert.deepEqual(parseTarget('alpha:/var/www/user100/data/www/alpha.example.com/'), { host: 'alpha', root: '/var/www/user100/data/www/alpha.example.com' });
  assert.deepEqual(parseTarget(' user100@alpha.example.com:/home/bitrix/www '), { host: 'user100@alpha.example.com', root: '/home/bitrix/www' });
  for (const bad of ['', '—', 'alpha', 'alpha:', 'alpha:~/www/x', ':/x', 'bad host:/x', '-oProxyCommand=calc:/x', 'alpha:/', undefined]) {
    assert.equal(parseTarget(bad), null, String(bad));
  }
  assert.ok(validHost('alpha'));
  assert.ok(validHost('user100@203.0.113.10'));
  assert.ok(!validHost('-oProxyCommand=calc'));
  assert.ok(!validHost('a b'));
  assert.ok(!validHost(''));
});

test('parseTarget: папка без кавычек, `, $, \\ и управляющих символов — её подставляют в ssh <хост> \'… <папка> …\'', () => {
  for (const bad of ["alpha:/var/www/it's", 'alpha:/var/www/a"b', 'alpha:/var/www/`id`', 'alpha:/var/www/$HOME',
    'alpha:/var/www/a\\b', 'alpha:/var/www/a\tb', 'alpha:/var/www/a\nb', 'alpha:/var/www/a\x7fb']) {
    assert.equal(parseTarget(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(parseTarget('alpha:/var/www/сайт.рф/public_html'), { host: 'alpha', root: '/var/www/сайт.рф/public_html' });
  assert.deepEqual(parseTarget('alpha:/var/www/a b'), { host: 'alpha', root: '/var/www/a b' });
});

test('serverSsh: «SSH прод» / «SSH дев» из параметров, обратные кавычки снимаются', () => {
  const params = makeParams(parseParams('## Параметры для агентов\n\n- SSH прод: `alpha:/var/www/s`\n- SSH дев: —\n'));
  assert.deepEqual(serverSsh(params), { host: 'alpha', root: '/var/www/s' });
  assert.deepEqual(serverSsh(params, 'прод'), { host: 'alpha', root: '/var/www/s' });
  assert.equal(serverSsh(params, 'дев'), null);
  assert.equal(serverSsh(params, 'тест'), null);
  assert.equal(serverSsh(makeParams(null)), null);
});

test('shq и lastLine', () => {
  assert.equal(shq("a'b"), "'a'\\''b'");
  assert.equal(shq('/opt/php74/bin/php'), "'/opt/php74/bin/php'");
  assert.equal(lastLine('a\n\n  b  \n\n'), 'b');
  assert.equal(lastLine(''), '');
  assert.equal(lastLine(undefined), '');
});

test('runSsh: опции без пароля, метка — код команды, вывод без метки, stdin передаётся', async () => {
  const { r, sent } = await withFake({ FAKE_SSH_OUT: 'привет', FAKE_SSH_EXIT: '7' }, () => runSsh('ok', "'php'", 'КОД'));
  assert.deepEqual(r, { connected: true, exitCode: 7, stdout: 'привет', stderr: '' });
  assert.deepEqual(sent.opts, ['BatchMode=yes', 'ConnectTimeout=15', 'ServerAliveInterval=15', 'ServerAliveCountMax=4']);
  assert.deepEqual(SSH_OPTS.filter((x) => x !== '-o'), sent.opts);
  assert.equal(sent.host, 'ok');
  assert.equal(sent.command, '\'php\'; printf "\\n__KIT_EXIT=%s\\n" "$?"');
  assert.equal(sent.stdin, 'КОД');
});

test('runSsh: пустой вывод команды — пустой stdout', async () => {
  const { r } = await withFake({}, () => runSsh('empty', 'true', ''));
  assert.deepEqual(r, { connected: true, exitCode: 0, stdout: '', stderr: '' });
});

test('runSsh: не пустил, обрыв, нет ssh — connected: false', async () => {
  const down = (await withFake({}, () => runSsh('down', 'true', ''))).r;
  assert.equal(down.connected, false);
  assert.equal(down.exitCode, null);
  assert.equal(lastLine(down.stderr), 'ssh: connect to host down port 22: Connection timed out');
  const drop = (await withFake({}, () => runSsh('drop', 'true', ''))).r;
  assert.equal(drop.connected, false);
  assert.equal(drop.stdout, 'начало\n');
  const none = (await withFake({ KIT_SSH: path.join(tmpDir(), 'нет-ssh.exe') }, () => runSsh('ok', 'true', ''))).r;
  assert.equal(none.connected, false);
  assert.match(none.stderr, /не удалось запустить ssh/);
});

test('runSsh: общий таймаут — зависший ssh останавливается, connected: false и timedOut; без timeoutMs — как раньше', async () => {
  const t0 = Date.now();
  const { r } = await withFake({}, () => runSsh('hang', 'true', '', { timeoutMs: 300 }));
  assert.equal(r.connected, false);
  assert.equal(r.exitCode, null);
  assert.equal(r.timedOut, true);
  assert.equal(r.stderr, '', 'о таймауте говорит флаг timedOut, а не текст в stderr (иначе вызывающий скажет об этом дважды)');
  assert.ok(Date.now() - t0 < 5000, 'остановился по таймеру, а не ждал вечно');
  const ok = (await withFake({ FAKE_SSH_OUT: 'ок' }, () => runSsh('ok', 'true', '', { timeoutMs: 60000 }))).r;
  assert.deepEqual(ok, { connected: true, exitCode: 0, stdout: 'ок', stderr: '' });
});

test('runSsh: ssh закрылся, не прочитав stdin (2 МБ), — connected: false без исключения', async () => {
  const { r } = await withFake({}, () => runSsh('closed', 'true', Buffer.alloc(2 * 1024 * 1024)));
  assert.equal(r.connected, false);
  assert.equal(r.exitCode, null);
  assert.equal(lastLine(r.stderr), 'Connection closed by 10.0.0.1 port 22');
});
