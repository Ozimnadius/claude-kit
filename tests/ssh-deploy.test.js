'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, runScriptAsync, tmpDir, findSh, shPath } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { parseArgs, safePath, buildScript, parseResult } = require('../plugins/kit/scripts/ssh-deploy');
const { isDocOnServer } = require('../plugins/kit/scripts/lib/project');

const FAKE = path.join(__dirname, 'fake-ssh.js');
// Локальный sh — для заливки через заглушку; нет — эти тесты пропускаются (findSh — tests/helpers.js).
const SH = findSh();

function project(target, extra = {}) {
  return gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'SSH прод': target, ...extra }),
    'a.php': '1', 'b.php': 'old', 'local/keep.php': 'k',
  });
}
const env = (extra = {}) => ({ KIT_SSH: FAKE, FAKE_SH: SH || '', ...extra });

// «Документы на сервере: да» (этап 35): .htaccess и документы — в git, как в kit-проекте.
function docsProject(target, extra = {}) {
  return gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'SSH прод': target, 'Документы на сервере': 'да', ...extra }),
    '.claude/.htaccess': 'Require all denied\n',
    '.claude/docs/progress.md': 'журнал',
    '.claude/docs/work/plan-a.md': 'план',
    'a.php': '1',
  });
}

test('parseArgs и safePath: флаги, --env, --timeout; пути — не абсолютные, без .. и управляющих символов', () => {
  assert.deepEqual(parseArgs([]), { env: null, base: null, timeout: 100, go: false, md5: false, paths: null, docs: false, all: false });
  assert.deepEqual(parseArgs(['--go', '--env', 'дев', '--base', 'abc1234', '--timeout', '5']), { env: 'дев', base: 'abc1234', timeout: 5, go: true, md5: false, paths: null, docs: false, all: false });
  assert.deepEqual(parseArgs(['--go', '--', 'a.php', 'b c/d.php']).paths, ['a.php', 'b c/d.php']);
  assert.deepEqual(parseArgs(['--docs', '--all', '--go']), { env: null, base: null, timeout: 100, go: true, md5: false, paths: null, docs: true, all: true });
  assert.equal(parseArgs(['--md5', '--base', 'abc1234']).md5, true);
  for (const bad of [['--env', 'тест'], ['--timeout', '0'], ['--timeout', '601'], ['--нет'], ['--base'], ['--'], ['--base', 'x', '--', 'a.php'], ['--all'], ['--docs', '--', 'a.php'],
    ['--md5', '--go'], ['--md5', '--docs']]) assert.throws(() => parseArgs(bad), bad.join(' '));
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

test('вложенный git-репозиторий — «Пропущено — не файл» с подсказкой: повтор не поможет, путь — в «Не выкладывать» (К56)', () => {
  const dir = project('ok:/srv/site');
  writeFiles(dir, { 'vendor/lib/x.php': 'x' });
  git(path.join(dir, 'vendor', 'lib'), 'init', '-q');
  const r = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Пропущено — не файл \(1\):\n  vendor\/lib\//);
  assert.match(r.stdout, /повтор не поможет — добавьте путь в «Не выкладывать»/);
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

// Содержимое папки «сервера»: { путь: текст } — чтобы убедиться, что --md5 ничего не записал.
function tree(root) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8');
    }
  })(root);
  return out;
}

test('--md5 через локальный sh: файлы шага скачаны с сервера — всё совпало, строка точки отсчёта; различия — код 1 со списком; на сервер ничего не пишется (с 3.2.0)', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { 'a.php': '1', 'local/keep.php': 'k', 'bitrix/templates/t/header.php': 'новый вендор', "bitrix/templates/t/it's файл.php": 'ф' });
  const dir = project('sh:' + shPath(server));
  // «скачали» с сервера: новые файлы шаблона, b.php на сервере уже нет — удалили и локально
  writeFiles(dir, { 'bitrix/templates/t/header.php': 'новый вендор', "bitrix/templates/t/it's файл.php": 'ф' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  const before = tree(server);
  const ok = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--md5'], env: env() });
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Сверка md5 с сервером \(ничего не записано\): совпадают 2 из 2/);
  assert.match(ok.stdout, /^DEPLOY Файлы: точка отсчёта заливки — совпадают с сервером по md5 2: bitrix\/templates\/t\/header\.php, bitrix\/templates\/t\/it's файл\.php; нет на сервере, как и локально, 1: b\.php \(ssh-deploy\.js --md5, не заливались\)$/m);
  assert.deepEqual(tree(server), before, 'на сервере ничего не изменилось');
  // сервер изменился после скачивания, файла нет на сервере, удалённое локально там есть
  writeFiles(server, { 'bitrix/templates/t/header.php': 'ещё новее', 'b.php': 'old' });
  fs.unlinkSync(path.join(server, "bitrix/templates/t/it's файл.php"));
  const bad = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--md5'], env: env() });
  assert.equal(bad.code, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /совпадают 0 из 2/);
  assert.match(bad.stdout, /Отличаются \(1\):\n {2}bitrix\/templates\/t\/header\.php/);
  assert.match(bad.stdout, /Нет на сервере \(1\):\n {2}bitrix\/templates\/t\/it's файл\.php/);
  assert.match(bad.stdout, /Удалены локально, а на сервере есть \(1\):\n {2}b\.php/);
  assert.doesNotMatch(bad.stdout, /DEPLOY Файлы:/);
  assert.equal(fs.readFileSync(path.join(server, 'bitrix/templates/t/header.php'), 'utf8'), 'ещё новее');
});

test('--md5: не пустил — код 3; нечего сверять — код 0 без подключения', async () => {
  const dir = project('denied:/srv/site');
  writeFiles(dir, { 'a.php': '2' });
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--md5'], env: env() });
  assert.equal(r.code, 3, r.stdout + r.stderr);
  const clean = project('down:/srv/site');
  const n = await runScriptAsync('ssh-deploy.js', { cwd: clean, args: ['--md5'], env: env() });
  assert.equal(n.code, 0, n.stdout + n.stderr);
  assert.match(n.stdout, /Нечего заливать/);
});

test('нет папки сайта на сервере — код 1, ничего не записано', { skip: !SH }, async () => {
  const dir = project('sh:' + shPath(path.join(tmpDir('kit-server-'), 'нет')));
  writeFiles(dir, { 'a.php': '2' });
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /нет папки сайта/);
});

test('isDocOnServer: .htaccess, CLAUDE.md и docs без visual; регистр не важен; остальное в .claude и вне её — нет (этап 35)', () => {
  const info = { visualRel: '.claude/docs/visual' };
  for (const p of ['.claude/.htaccess', '.claude/CLAUDE.md', '.claude/claude.md', '.claude/docs/progress.md', '.Claude/Docs/work/a.md', '.claude\\docs\\archive\\b.md']) {
    assert.ok(isDocOnServer(p, info), p);
  }
  for (const p of ['.claude/docs/visual/a.png', '.claude/skills/x/SKILL.md', '.claude/scripts/a.php', '.claude/settings.local.json', '.claude/kit-inbox.jsonl', '.claude/docsx/a.md', 'docs/progress.md', 'a.php']) {
    assert.ok(!isDocOnServer(p, info), p);
  }
});

test('--docs: изменённые, новые и удалённые документы; .htaccess первым; служебное в .claude, снимки и сайт — нет; основная заливка — без .claude (этап 35)', () => {
  const dir = docsProject('ok:/srv/site', { 'Не выкладывать': '.idea, .git, .claude, .claude/docs/work/secret.md' });
  writeFiles(dir, {
    '.claude/docs/progress.md': 'журнал 2', '.claude/docs/archive/plan-b.md': 'новый', '.claude/docs/work/secret.md': 'нет',
    '.claude/docs/visual/a.png': 'снимок', '.claude/skills/x/SKILL.md': 's', '.claude/scripts/a.php': 'p',
    '.claude/settings.local.json': '{}', '.claude/kit-inbox.jsonl': '', 'a.php': '2',
  });
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs'], env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Документы — залить \(3\):\n  \.claude\/\.htaccess\n  \.claude\/docs\/progress\.md\n  \.claude\/docs\/archive\/plan-b\.md\n/);
  assert.match(r.stdout, /Документы — удалить \(1\):\n  \.claude\/docs\/work\/plan-a\.md/);
  assert.doesNotMatch(r.stdout, /secret|visual|skills|scripts|settings\.local|kit-inbox|a\.php/);
  assert.ok(!fs.existsSync(log), 'без --go подключения нет');
  const main = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(main.code, 0, main.stderr);
  assert.match(main.stdout, /Залить \(1\):\n  a\.php\n/);
  assert.doesNotMatch(main.stdout, /\.claude/);
});

test('--docs: документы не менялись — «Нечего заливать» без подключения, один .htaccess не едет; --all — все документы набора без удалений (этап 35)', () => {
  const dir = docsProject('ok:/srv/site');
  writeFiles(dir, { 'a.php': '2', '.claude/skills/x/SKILL.md': 's', '.claude/docs/visual/a.png': 'снимок' });
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const none = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(none.code, 0, none.stderr);
  assert.match(none.stdout, /Нечего заливать/);
  assert.ok(!fs.existsSync(log), 'подключения нет');
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const all = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs', '--all'], env: env() });
  assert.equal(all.code, 0, all.stderr);
  assert.match(all.stdout, /База: — \(все документы, --all\)/);
  assert.match(all.stdout, /Документы — залить \(3\):\n  \.claude\/\.htaccess\n  \.claude\/CLAUDE\.md\n  \.claude\/docs\/progress\.md\n/);
  assert.match(all.stdout, /Документы — удалить \(0\):/);
});

test('--docs: «Документы на сервере» не «да» — код 2; нет .claude/.htaccess — код 2; --all без --docs и --docs с путями — код 4 (этап 35)', () => {
  const off = docsProject('ok:/srv/site', { 'Документы на сервере': 'нет' });
  const r = runScript('ssh-deploy.js', { cwd: off, args: ['--docs'], env: env() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /документы на сервер не выкладываются/);
  const noDeny = docsProject('ok:/srv/site');
  fs.unlinkSync(path.join(noDeny, '.claude', '.htaccess'));
  const d = runScript('ssh-deploy.js', { cwd: noDeny, args: ['--docs', '--all'], env: env() });
  assert.equal(d.code, 2);
  assert.match(d.stderr, /нет \.claude\/\.htaccess/);
  assert.equal(runScript('ssh-deploy.js', { cwd: noDeny, args: ['--all'], env: env() }).code, 4);
  assert.equal(runScript('ssh-deploy.js', { cwd: noDeny, args: ['--docs', '--', '.claude/docs/progress.md'], env: env() }).code, 4);
});

test('--docs --go через локальный sh: документы записаны, удалённое удалено, md5 сверен, строки DEPLOY нет; повтор — снова 0 (этап 35)', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { '.claude/docs/work/plan-a.md': 'план' });
  const dir = docsProject('sh:' + shPath(server));
  writeFiles(dir, { '.claude/docs/progress.md': 'журнал шага 35.1\n' });
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Залито и сверено: 2 из 2/);
  assert.match(r.stdout, /Удалено: 1 из 1/);
  assert.doesNotMatch(r.stdout, /DEPLOY Файлы/);
  assert.equal(fs.readFileSync(path.join(server, '.claude', '.htaccess'), 'utf8'), 'Require all denied\n');
  assert.equal(fs.readFileSync(path.join(server, '.claude', 'docs', 'progress.md'), 'utf8'), 'журнал шага 35.1\n');
  assert.ok(!fs.existsSync(path.join(server, '.claude', 'docs', 'work', 'plan-a.md')));
  const again = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env() });
  assert.equal(again.code, 0, again.stdout + again.stderr);
});

test('ssh-deploy.js (список): после синхронизации — файлы шага есть, файлов синхронизации нет; коммит синхронизации другого окружения не в счёт; --docs — как прежде', () => {
  const dir = gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'SSH прод': 'ok:/srv/site', 'SSH дев': 'ok:/srv/dev', 'Документы на сервере': 'да' }),
    '.claude/.htaccess': 'Require all denied\n', '.claude/docs/progress.md': 'журнал', '.claude/docs/work/plan-a.md': 'план',
    'a.php': '1', 'b.php': 'old', 'local/keep.php': 'k',
  });
  const commit = (msg) => {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', msg);
  };
  // закоммиченный, но не залитый шаг
  writeFiles(dir, { 'a.php': 'шаг', '.claude/docs/progress.md': 'журнал шага' });
  commit('1.1: шаг');
  // синхронизация с продом: изменённый, новый и удалённый на сервере файлы (и документ — для --docs)
  writeFiles(dir, { 'b.php': 'сервер', 'n/новый.php': 'сервер', '.claude/docs/work/plan-a.md': 'план с сервера' });
  fs.unlinkSync(path.join(dir, 'local', 'keep.php'));
  commit('Прод: изменения без kit на 2026-10-30 (4 файла)');
  // синхронизация с девом — для заливки на прод не в счёт
  writeFiles(dir, { 'c.php': 'дев' });
  commit('Дев: изменения без kit на 2026-10-30 (1 файл)');
  // незакоммиченная правка поверх файла синхронизации — наша
  writeFiles(dir, { 'n/новый.php': 'сервер и наша правка' });

  const r = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Залить \(3\):\n  a\.php\n  c\.php\n  n\/новый\.php\n\nУдалить \(0\):/);
  assert.match(r.stdout, /Не заливаю — уже на сервере, пришли синхронизацией \(2\):\n  b\.php\n  local\/keep\.php/);

  const dev = runScript('ssh-deploy.js', { cwd: dir, args: ['--env', 'дев'], env: env() });
  assert.equal(dev.code, 0, dev.stderr);
  assert.match(dev.stdout, /Залить \(3\):\n  a\.php\n  b\.php\n  n\/новый\.php\n\nУдалить \(1\):\n  local\/keep\.php/);
  assert.match(dev.stdout, /пришли синхронизацией \(1\):\n  c\.php/);

  const docs = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs'], env: env() });
  assert.equal(docs.code, 0, docs.stderr);
  assert.match(docs.stdout, /Документы — залить \(3\):\n  \.claude\/\.htaccess\n  \.claude\/docs\/progress\.md\n  \.claude\/docs\/work\/plan-a\.md\n/);
  assert.doesNotMatch(docs.stdout, /синхронизацией/);

  const back = runScript('ssh-deploy.js', { cwd: dir, args: ['--', 'b.php'], env: env() });
  assert.equal(back.code, 0, back.stderr);
  assert.match(back.stdout, /Залить \(1\):\n  b\.php/, 'откат по путям — как прежде');
});

test('ssh-deploy.js после синхронизации: шаг отверг правку сервера — залить и удалить; больше 10 файлов синхронизации — «и ещё N»', () => {
  const files = {};
  for (let i = 1; i <= 12; i++) files['s/f' + String(i).padStart(2, '0') + '.php'] = 'сервер ' + i;
  const dir = project('ok:/srv/site');
  writeFiles(dir, { ...files, 'a.php': 'v2 с сервера', 'n.php': 'с сервера' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Прод: изменения без kit на 2026-10-30 (14 файлов)');
  writeFiles(dir, { 'a.php': '1' });
  fs.unlinkSync(path.join(dir, 'n.php'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: отвергнуть правку сервера');
  const r = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Залить \(1\):\n  a\.php\n\nУдалить \(1\):\n  n\.php\n/);
  assert.match(r.stdout, /пришли синхронизацией \(12\):\n(  s\/f\d\d\.php\n){10}  и ещё 2\n?$/);
});

test('--go после синхронизации через локальный sh: льются файлы шага и отвергнутая правка сервера, файлы синхронизации — нет', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { 'a.php': '1', 'b.php': 'сервер', 'x.php': 'v2 с сервера', 'n.php': 'с сервера', 'local/keep.php': 'k' });
  const dir = project('sh:' + shPath(server));
  writeFiles(dir, { 'x.php': 'v1' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '0.2: x.php');
  const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  // синхронизация забрала b.php, x.php и n.php; затем шаг: a.php — наша правка, x.php — назад к v1, n.php — удалён
  writeFiles(dir, { 'b.php': 'сервер', 'x.php': 'v2 с сервера', 'n.php': 'с сервера' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Прод: изменения без kit на 2026-10-30 (3 файла)');
  writeFiles(dir, { 'a.php': 'шаг', 'x.php': 'v1' });
  fs.unlinkSync(path.join(dir, 'n.php'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: шаг');
  // b.php на сервере после синхронизации снова поменяли — заливка его не трогает
  writeFiles(server, { 'b.php': 'сервер позже' });
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go', '--base', base], env: env() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Залить \(2\):\n  a\.php\n  x\.php\n\nУдалить \(1\):\n  n\.php\n/);
  assert.match(r.stdout, /пришли синхронизацией \(1\):\n  b\.php/);
  assert.match(r.stdout, /Залито и сверено: 2 из 2/);
  assert.equal(fs.readFileSync(path.join(server, 'a.php'), 'utf8'), 'шаг');
  assert.equal(fs.readFileSync(path.join(server, 'x.php'), 'utf8'), 'v1');
  assert.ok(!fs.existsSync(path.join(server, 'n.php')));
  assert.equal(fs.readFileSync(path.join(server, 'b.php'), 'utf8'), 'сервер позже', 'файл синхронизации не залит');
});

test('после синхронизации: CRLF в blob, закоммиченном до core.autocrlf=input/true, git status чистый — файлы синхронизации «Не заливаю», не «Залить»', () => {
  for (const mode of ['input', 'true']) {
    const dir = project('ok:/srv/site');
    writeFiles(dir, { 'x.php': 'v1\r\n', 'm.php': 'a\r\nb\n' });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', '0.2: файлы с CRLF до autocrlf');
    const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
    // дальше — как у пользователя: core.autocrlf в настройках репозитория, git add без переопределения (как kit-commit.js)
    git(dir, 'config', 'core.autocrlf', mode);
    const userGit = (...args) => {
      const r = require('child_process').spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@test.local', ...args],
        { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    writeFiles(dir, { 'x.php': 'v2\r\n', 'm.php': 'c\r\nd\n', 'n.php': 'n\r\n' });
    userGit('add', '-A');
    userGit('commit', '-q', '-m', 'Прод: изменения без kit на 2026-10-30 (3 файла)');
    assert.equal(userGit('status', '--porcelain'), '', mode + ': git status чистый');
    assert.match(userGit('cat-file', '-p', 'HEAD:x.php'), /\r\n/, mode + ': blob с CR');
    const r = runScript('ssh-deploy.js', { cwd: dir, args: ['--base', base], env: env() });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Залить \(0\):/, mode + ': ' + r.stdout);
    assert.match(r.stdout, /пришли синхронизацией \(3\):\n  m\.php\n  n\.php\n  x\.php/, mode + ': ' + r.stdout);
  }
});
