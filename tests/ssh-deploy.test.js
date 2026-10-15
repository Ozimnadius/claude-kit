'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { gitRepo, git, writeFiles, runScript, runScriptAsync, tmpDir } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { parseArgs, safePath, buildScript, parseResult } = require('../plugins/kit/scripts/ssh-deploy');

const FAKE = path.join(__dirname, 'fake-ssh.js');
// Локальный sh с base64 и md5sum (Git для Windows или системный) — для заливки через заглушку; нет — эти тесты пропускаются.
function findSh() {
  for (const c of [process.env.FAKE_SH, 'sh', 'C:\\Program Files\\Git\\bin\\sh.exe']) {
    if (!c) continue;
    const r = spawnSync(c, ['-c', 'command -v base64 >/dev/null && command -v md5sum >/dev/null && echo ok'], { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === 'ok') return c;
  }
  return null;
}
const SH = findSh();
// Папка «сервера» в виде, понятном sh: на Windows C:\a\b → /c/a/b.
const shPath = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());

function project(target, extra = {}) {
  return gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'SSH прод': target, ...extra }),
    'a.php': '1', 'b.php': 'old', 'local/keep.php': 'k',
  });
}
const env = (extra = {}) => ({ KIT_SSH: FAKE, FAKE_SH: SH || '', ...extra });

test('parseArgs и safePath: флаги, --env, --timeout; пути — не абсолютные, без .. и управляющих символов', () => {
  assert.deepEqual(parseArgs([]), { env: null, base: null, timeout: 100, go: false, paths: null });
  assert.deepEqual(parseArgs(['--go', '--env', 'дев', '--base', 'abc1234', '--timeout', '5']), { env: 'дев', base: 'abc1234', timeout: 5, go: true, paths: null });
  assert.deepEqual(parseArgs(['--go', '--', 'a.php', 'b c/d.php']).paths, ['a.php', 'b c/d.php']);
  for (const bad of [['--env', 'тест'], ['--timeout', '0'], ['--timeout', '601'], ['--нет'], ['--base'], ['--'], ['--base', 'x', '--', 'a.php']]) assert.throws(() => parseArgs(bad), bad.join(' '));
  for (const ok of ['a.php', "local/it's файл.php", 'a b/c.php']) assert.ok(safePath(ok), ok);
  for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'C:/x', 'a\nb', '']) assert.ok(!safePath(bad), JSON.stringify(bad));
});

test('buildScript: пути в кавычках shq, base64 строками до 76 знаков в heredoc KIT_B64, итоги по номерам', () => {
  const s = buildScript('/srv/site', [{ path: "new/it's файл.php", data: Buffer.alloc(100, 'x') }], ['old dir/b.php']);
  assert.match(s, /^cd '\/srv\/site' \|\|/);
  assert.ok(s.includes("mkdir -p 'new' && base64 -d > 'new/it'\\''s файл.php.kit-tmp' <<'KIT_B64'\n"));
  for (const line of s.split('\n')) assert.ok(line.length <= 200, 'нет длинных строк base64');
  assert.ok(s.includes("rm -f -- 'old dir/b.php' && echo 'KIT_DEL 1' || echo 'KIT_FAILDEL 1'"));
  assert.match(s, /printf 'KIT_MD5 1 %s\\n' "\$\(md5sum < 'new\/it'\\''s файл\.php'/);
  assert.match(s, /\nexit 0\n$/);
});

test('parseResult: строки KIT_* по номерам, прочее не мешает', () => {
  const r = parseResult('мусор\nKIT_PUT 1\nKIT_FAIL 2\nKIT_DEL 1\nKIT_FAILDEL 2\nKIT_MD5 1 ' + 'a'.repeat(32) + '\nKIT_MD5 2 \n');
  assert.deepEqual([...r.put], [1]);
  assert.deepEqual([...r.fail], [2]);
  assert.deepEqual([...r.del], [1]);
  assert.deepEqual([...r.failDel], [2]);
  assert.equal(r.md5.get(1), 'a'.repeat(32));
  assert.equal(r.md5.get(2), '');
  assert.equal(parseResult('KIT_ERR нет папки сайта').err, 'нет папки сайта');
});

test('без --go — список: изменённое, незакоммиченное, новое, удалённое; .claude и «Не выкладывать» — нет; ssh не запускается', () => {
  const dir = project('ok:/srv/site', { 'Не выкладывать': '.gitignore' });
  writeFiles(dir, { 'a.php': '2', 'new/файл с пробелом.php': 'n', '.claude/docs/x.md': 'd', '.gitignore': 'tmp/\n' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-deploy.js', { cwd: dir, env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Сервер: прод — ok:\/srv\/site/);
  assert.match(r.stdout, /База: \w+ \(первый коммит репозитория\)/);
  assert.match(r.stdout, /Залить \(2\):\n  a\.php\n  new\/файл с пробелом\.php/);
  assert.match(r.stdout, /Удалить \(1\):\n  b\.php/);
  assert.doesNotMatch(r.stdout, /\.claude|\.gitignore/);
  assert.ok(!fs.existsSync(log), 'без --go подключения нет');
});

test('файл убран из git, но лежит на диске (git rm --cached) — на сервере не удаляется (финальное ревью этапа 32)', () => {
  const dir = project('ok:/srv/site');
  git(dir, 'rm', '-q', '--cached', 'b.php');
  const r = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Удалить \(0\):/);
  assert.match(r.stdout, /Не удаляю — файл есть локально \(1\):\n  b\.php/);
});

test('пути после -- : есть локально — залить, нет — удалить; исключённый или недопустимый путь — код 4 (откат шага)', () => {
  const dir = project('ok:/srv/site');
  const r = runScript('ssh-deploy.js', { cwd: dir, args: ['--', 'a.php', 'gone/x.php'], env: env() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /База: — \(пути из аргументов\)/);
  assert.match(r.stdout, /Залить \(1\):\n  a\.php/);
  assert.match(r.stdout, /Удалить \(1\):\n  gone\/x\.php/);
  for (const bad of [['--', '.claude/CLAUDE.md'], ['--', '../x.php'], ['--', '/etc/x']]) {
    assert.equal(runScript('ssh-deploy.js', { cwd: dir, args: bad, env: env() }).code, 4, bad.join(' '));
  }
});

test('нечего заливать — код 0 без подключения и с --go; после шага со строкой «Залито на прод» без хеша — тоже', () => {
  const dir = project('ok:/srv/site');
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Нечего заливать/);
  assert.ok(!fs.existsSync(log));
  writeFiles(dir, { 'a.php': '2', '.claude/docs/deploy-prod.md': '## Залито на прод\n\n| Шаг | Дата | Файлы | Коммит | Проверка |\n|---|---|---|---|---|\n| 1.1 | 2026-10-15 | a.php | | ок |\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: правка');
  const after = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(after.code, 0, after.stderr);
  assert.match(after.stdout, /«Залито на прод»/);
  assert.match(after.stdout, /Нечего заливать/);
});

test('SSH не задан — код 2; параметр неверный — код 2 со словом «неверный»; не git — код 4', () => {
  const none = project('—');
  writeFiles(none, { 'a.php': '2' });
  const r = runScript('ssh-deploy.js', { cwd: none, args: ['--go'], env: env() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SSH для сервера «прод» не задан/);
  const bad = project('alpha:~/www');
  assert.match(runScript('ssh-deploy.js', { cwd: bad, env: env() }).stderr, /«SSH прод» неверный/);
  assert.equal(runScript('ssh-deploy.js', { cwd: tmpDir(), env: env() }).code, 4);
  assert.equal(runScript('ssh-deploy.js', { cwd: none, args: ['--env', 'тест'], env: env() }).code, 4);
});

test('итоги сервера: md5 не совпал — код 1 без строки DEPLOY; нет строк — «результат неизвестен»; KIT_ERR — код 1; сценарий — на stdin «sh -s»', () => {
  const dir = project('ok:/srv/site');
  writeFiles(dir, { 'a.php': '2' });
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const bad = runScript('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env({ FAKE_SSH_LOG: log, FAKE_SSH_OUT: 'KIT_PUT 1\nKIT_MD5 1 ' + '0'.repeat(32) }) });
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /a\.php — md5 не совпал/);
  assert.doesNotMatch(bad.stdout, /DEPLOY Файлы/);
  const sent = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(sent.host, 'ok');
  assert.match(sent.command, /^sh -s; printf/);
  assert.match(sent.stdin, /^cd '\/srv\/site' \|\|/);
  const empty = project('empty:/srv/site');
  writeFiles(empty, { 'a.php': '2' });
  const none = runScript('ssh-deploy.js', { cwd: empty, args: ['--go'], env: env() });
  assert.equal(none.code, 1);
  assert.match(none.stdout, /a\.php — результат неизвестен/);
  const err = runScript('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env({ FAKE_SSH_OUT: 'KIT_ERR на сервере нет base64 или md5sum' }) });
  assert.equal(err.code, 1);
  assert.match(err.stderr, /нет base64 или md5sum/);
});

test('не пустил — код 3 с причиной; завис — код 3 по --timeout', () => {
  const down = project('down:/srv/site');
  writeFiles(down, { 'a.php': '2' });
  const r = runScript('ssh-deploy.js', { cwd: down, args: ['--go'], env: env() });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Connection timed out/);
  assert.match(r.stderr, /повтор безопасен/);
  const hang = project('hang:/srv/site');
  writeFiles(hang, { 'a.php': '2' });
  const h = runScript('ssh-deploy.js', { cwd: hang, args: ['--go', '--timeout', '1'], env: env() });
  assert.equal(h.code, 3);
  assert.match(h.stderr, /вышло время \(1 с\)/);
});

test('--go через локальный sh: записано побайтно, папки созданы, удалённое удалено, временных нет; повтор — снова 0', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { 'a.php': '1', 'b.php': 'old', 'local/keep.php': 'k' });
  const dir = project('sh:' + shPath(server));
  const bin = Buffer.from([0, 1, 2, 255, 13, 10, 10]);
  writeFiles(dir, { 'a.php': "<?php echo 'два';\n", "new/it's файл.php": 'n', 'img/x.bin': bin, 'empty.txt': '' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Залито и сверено: 4 из 4/);
  assert.match(r.stdout, /Удалено: 1 из 1/);
  assert.match(r.stdout, /DEPLOY Файлы: залито 4: /);
  assert.equal(fs.readFileSync(path.join(server, 'a.php'), 'utf8'), "<?php echo 'два';\n");
  assert.equal(fs.readFileSync(path.join(server, 'new', "it's файл.php"), 'utf8'), 'n');
  assert.deepEqual(fs.readFileSync(path.join(server, 'img', 'x.bin')), bin);
  assert.equal(fs.readFileSync(path.join(server, 'empty.txt'), 'utf8'), '');
  assert.ok(!fs.existsSync(path.join(server, 'b.php')));
  assert.equal(fs.readFileSync(path.join(server, 'local', 'keep.php'), 'utf8'), 'k', 'не изменённое не трогаем');
  const left = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.kit-tmp')) left.push(p);
    }
  })(server);
  assert.deepEqual(left, []);
  const again = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env() });
  assert.equal(again.code, 0, again.stdout + again.stderr);
});

test('откат через пути после -- на локальном sh: правка вернулась, новый файл шага удалён на сервере', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { 'a.php': 'плохая версия', 'new.php': 'файл шага' });
  const dir = project('sh:' + shPath(server));
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go', '--', 'a.php', 'new.php'], env: env() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(server, 'a.php'), 'utf8'), '1');
  assert.ok(!fs.existsSync(path.join(server, 'new.php')));
});

test('нет папки сайта на сервере — код 1, ничего не записано', { skip: !SH }, async () => {
  const dir = project('sh:' + shPath(path.join(tmpDir('kit-server-'), 'нет')));
  writeFiles(dir, { 'a.php': '2' });
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /нет папки сайта/);
});
