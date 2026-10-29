'use strict';
// Вход с прода по SSH (шаг 48.3): prod-entry.js — сверка «сервера» (временная папка через заглушку fake-ssh.js, хост sh) с git,
// забор изменённого без нас, коммит входа через kit-commit.js, отметка .claude/kit-prod.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ROOT, writeFiles, tmpDir, runScript, findSh, shPath } = require('./helpers');
const { paramsMd, WORK_GITIGNORE, WORK_RULE } = require('./fixtures');
const pe = require('../plugins/kit/scripts/prod-entry');
const { ENTRY_RE, FILE_LIMIT, readMark, writeMark } = require('../plugins/kit/scripts/lib/prod');

// Локальный sh с GNU find (-printf), xargs, cut и mktemp — «сервер» для сверки; нет — такие тесты пропускаются.
const SH = (() => {
  const sh = findSh();
  const r = sh && spawnSync(sh, ['-c', "find . -maxdepth 0 -printf '' && command -v xargs && command -v cut && command -v mktemp"], { encoding: 'utf8' });
  return r && r.status === 0 ? sh : null;
})();
// Заглушка ssh и автор коммитов kit-commit.js — для entry() в этом процессе и для дочерних; KIT_SESSION_ID разработчика не влияет.
Object.assign(process.env, {
  KIT_SSH: path.join(__dirname, 'fake-ssh.js'), FAKE_SH: SH || '',
  GIT_AUTHOR_NAME: 'kit', GIT_AUTHOR_EMAIL: 'kit@test.local', GIT_COMMITTER_NAME: 'kit', GIT_COMMITTER_EMAIL: 'kit@test.local',
});
for (const k of ['KIT_SESSION_ID', 'FAKE_SSH_OUT', 'FAKE_SSH_LOG', 'FAKE_SSH_COUNT', 'FAKE_SSH_DROP']) delete process.env[k];

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'plugins', 'kit', 'skills', 'project-init', 'templates', 'gitignore-bitrix'), 'utf8');
const GITIGNORE = '/.claude/*\n!/.claude/CLAUDE.md\n!/.claude/docs/\n!/.claude/docs/**\n';
const PARAMS = {
  'Режим': 'общий', 'Окружение': 'прод', 'Выкладка': 'вручную', 'Прод': 'https://alpha.example.com',
  'План выкладки': '.claude/docs/deploy-prod.md', 'Не выкладывать': '.gitignore',
};
// Пароль собран из частей: литерал в файле теста остановил бы проверку секретов при коммите.
const SECRET = ['Qw3', 'rty!x9'].join('');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
// git без подмены core.autocrlf (у репозиториев тестов — input, как у kit-проектов); автор — из окружения.
function g(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}
const commit = (dir, msg) => {
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '--allow-empty', '-m', msg);
  return g(dir, 'rev-parse', 'HEAD').trim();
};
const count = (dir) => Number(g(dir, 'rev-list', '--count', 'HEAD').trim());
const subject = (dir, rev = 'HEAD') => g(dir, 'log', '-1', '--format=%s', rev).trim();
const body = (dir, rev = 'HEAD') => g(dir, 'log', '-1', '--format=%b', rev).trim();
const changed = (dir, rev = 'HEAD') => g(dir, 'diff-tree', '--no-commit-id', '--name-status', '-r', rev).trim().split('\n').filter(Boolean).sort();
const status = (dir) => g(dir, 'status', '--porcelain=v1', '-uall');
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const text = (r) => r.out.join('\n');
const last = (r) => r.out[r.out.length - 1];

// Проект в git и «сервер» — временная папка с файлами сайта (по умолчанию — теми же). host — хост заглушки: sh, shdrop, down, hang,
// fixed (готовый ответ FAKE_SSH_OUT).
function site(files, { params = {}, gitignore = GITIGNORE, host = 'sh', server: serverFiles = files } = {}) {
  const server = writeFiles(tmpDir('kit-prod-srv-'), serverFiles);
  const dir = tmpDir('kit-prod-');
  writeFiles(dir, { '.claude/CLAUDE.md': paramsMd({ ...PARAMS, 'SSH прод': host + ':' + shPath(server), ...params }), '.gitignore': gitignore, ...files });
  g(dir, 'init', '-q');
  g(dir, 'config', 'core.autocrlf', 'input');
  commit(dir, '0.1: исходники');
  return { dir, server };
}
const run = (dir, opts = {}) => pe.entry(dir, { sessionId: 's1', ...opts });

// План выкладки: строки «Залито на прод» — [шаг, хеш]; «Удалить с сервера» — пути.
const planMd = (rows, dels = []) => ['# Выкладка', '', '## Залито на прод', '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map(([step, hash]) => `| ${step} | 2026-10-15 | — | \`${hash}\` | ок |`), '',
  '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', ...dels.map((p) => `| \`${p}\` | старая копия | |`), ''].join('\n');

async function withEnv(vars, fn) {
  const old = {};
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

// Готовый ответ сервера на сверку (для FAKE_SSH_OUT и разбора): states — { номер: N | U | O }, hashes — строки md5sum по порядку
// отслеживаемых «есть», list — [[размер, путь]] из find.
const listOut = ({ states = {}, hashes = [], list = [], findCode = 0 }) => [
  ...Object.entries(states).map(([n, s]) => `KIT_S ${n} ${s}`), 'KIT_H', ...hashes, 'KIT_L',
  Buffer.from(list.map(([s, p]) => `${s} ${p}\0`).join('')).toString('base64'), `KIT_LE ${findCode}`, 'KIT_END', ''].join('\n');

// ---- Разбор и правила ---------------------------------------------------------------------------------------------------

test('parseArgs: все флаги этапа, --timeout 1…600 (по умолчанию 100); неизвестное и неверное — исключение', () => {
  const base = { check: false, ftpDone: false, skip: false, hook: false, watchersOk: false, bigOk: false, timeout: 100 };
  assert.deepEqual(pe.parseArgs([]), base);
  assert.deepEqual(pe.parseArgs(['--check', '--ftp-done', '--skip', '--hook', '--watchers-ok', '--big-ok', '--timeout', '7']),
    { check: true, ftpDone: true, skip: true, hook: true, watchersOk: true, bigOk: true, timeout: 7 });
  for (const bad of [['--нет'], ['x'], ['--timeout'], ['--timeout', '0'], ['--timeout', '601'], ['--timeout', '1.5'], ['--timeout', '-3']]) {
    assert.throws(() => pe.parseArgs(bad), bad.join(' '));
  }
});

test('badName: небезопасный путь — везде; на Windows ещё <>:"|?*, CON/NUL/COM1/LPT1 (и с расширением), точка или пробел в конце части', () => {
  for (const p of ['a.php', "it's файл.php", 'a b/c.php', '[1].php', 'console.php', 'nul1.php']) {
    assert.equal(pe.badName(p, true), false, p);
    assert.equal(pe.badName(p, false), false, p);
  }
  for (const p of ['../x', 'a/../../x', '/etc/x', 'a\nb', 'a\\b.php', '']) assert.equal(pe.badName(p, false), true, JSON.stringify(p));
  for (const p of ['ab:c.php', 'a<b', 'a>b', 'a"b', 'a|b', 'a?.php', 'a*.php', 'con', 'CON.php', 'dir/NUL', 'lpt1.txt.bak', 'com9.x',
    'dir./x.php', 'x.php ', 'папка /x.php']) assert.equal(pe.badName(p, true), true, p);
  assert.equal(pe.badName('ab:c.php', false), false, 'на Linux двоеточие допустимо (кроме «буквы диска» в начале — safePath)');
  assert.equal(pe.badName('a:b.php', false), true);
  assert.equal(pe.badName('con.php', false), false);
});

test('pruneRules: шаблон gitignore-bitrix с рабочими папками — дети bitrix/, кроме рабочих, дети upload/, кроме docs; .env.example не отрезается (Р-11)', () => {
  const rules = pe.pruneRules(TEMPLATE + '\n' + WORK_GITIGNORE);
  const by = (p) => rules.filter((r) => r.path === p);
  assert.deepEqual(by('bitrix'), [{ path: 'bitrix', children: true, keep: ['php_interface', 'templates'], names: ['.env.example'] }]);
  assert.deepEqual(by('bitrix/templates'), [{ path: 'bitrix/templates', children: true, keep: ['theme'], names: ['.env.example'] }]);
  assert.deepEqual(by('bitrix/php_interface'), [{ path: 'bitrix/php_interface', children: true, keep: ['init.php'], names: ['.env.example'] }]);
  assert.deepEqual(by('upload'), [{ path: 'upload', children: true, keep: ['docs'], names: ['.env.example'] }]);
  assert.deepEqual(by('kit-exec.php'), [{ path: 'kit-exec.php' }]);
  for (const p of ['.claude', '.superpowers', '.worktrees', 'docs/superpowers']) assert.deepEqual(by(p), [{ path: p }], p);
  assert.deepEqual(rules.filter((r) => r.name).map((r) => r.name), ['.git', '.idea']);
  assert.ok(!rules.some((r) => r.path && (r.path === '.idea' || r.path.startsWith('.claude/'))), '.idea — по имени, .claude — целиком');
  const expr = pe.findPrune(rules);
  assert.ok(expr.includes("\\( -path './bitrix/*' ! -path './bitrix/*/*' ! -path './bitrix/php_interface' ! -path './bitrix/templates' ! -name '.env.example' \\)"), expr);
  assert.ok(expr.includes("-name '.git'") && expr.includes("-path './.claude'"));
  assert.match(expr, /^\\\( .* \\\) -prune$/);
});

test('pruneRules: отрицание со звёздочкой у папки или над ней, «всё внутри», имя папки, [ в непривязанном — не отрезать; не от корня — нет', () => {
  const r1 = pe.pruneRules('/bitrix/*\n!/bitrix/*/components/\n/upload/*\n!*.php\n/cache/\n!/cache/keep/\n');
  assert.ok(!r1.some((r) => r.path === 'bitrix'), 'отрицание со звёздочкой внутри bitrix');
  assert.deepEqual(r1.find((r) => r.path === 'upload'), { path: 'upload', children: true, keep: [], names: ['*.php'] });
  assert.deepEqual(r1.find((r) => r.path === 'cache'), { path: 'cache', dir: true }, 'отрицание внутри исключённой папки git не вернёт');
  const r2 = pe.pruneRules('/a/\n!a\n/b/c/\n!/b/\n/d/*\n!/d/**\n/e\n/f/**\n!/f/g/h.php\n');
  for (const p of ['a', 'b/c', 'd']) assert.ok(!r2.some((r) => r.path === p), p);
  assert.deepEqual(r2.find((r) => r.path === 'e'), { path: 'e' });
  assert.deepEqual(r2.find((r) => r.path === 'f'), { path: 'f', children: true, keep: ['g'], names: ['a'] });
  const r3 = pe.pruneRules('/upload/*\n![ab].txt\n');
  assert.ok(!r3.some((r) => r.path === 'upload'), '[ в непривязанном отрицании — детей не отрезать');
  const r4 = pe.pruneRules('# комментарий\n\n/bitrix\\*/\n/up?/\n bitrix/\nlocal/\nsrc/cache/\n/../x/\n');
  assert.deepEqual(r4.filter((r) => r.path && !['.claude', '.superpowers', '.worktrees', 'docs/superpowers'].includes(r.path)), []);
});

test('pruneRules: свой P/.gitignore в рабочей копии — детей P не отрезать; P целиком — можно (git его не читает) (Р-25)', () => {
  const own = new Set(['upload', 'cache']);
  const r = pe.pruneRules('/upload/*\n/bitrix/*\n/cache/\n', (p) => own.has(p));
  assert.ok(!r.some((x) => x.path === 'upload'), 'upload/.gitignore может вернуть детей upload');
  assert.deepEqual(r.find((x) => x.path === 'bitrix'), { path: 'bitrix', children: true, keep: [], names: [] });
  assert.deepEqual(r.find((x) => x.path === 'cache'), { path: 'cache', dir: true });
  assert.deepEqual(pe.pruneRules('/upload/*\n').find((x) => x.path === 'upload'), { path: 'upload', children: true, keep: [], names: [] });
});

test('listScript: пути — только через shq; md5 пачкой (xargs -0 md5sum), не по процессу на файл; временное — mktemp -d; find с отрезанием', () => {
  const s = pe.listScript('/srv/site', ["a b/it's.php", '-x.php'], pe.pruneRules('/bitrix/*\n'));
  assert.match(s, /^cd '\/srv\/site' \|\|/);
  assert.ok(s.includes("k 1 'a b/it'\\''s.php'"), s);
  assert.ok(s.includes("k 2 '-x.php'"));
  assert.match(s, /xargs -0 md5sum/);
  assert.doesNotMatch(s, /md5sum </);
  assert.doesNotMatch(s, /tr -d/);
  assert.match(s, /mktemp -d/);
  assert.ok(s.includes("-printf '%s %P\\0'"));
  assert.ok(s.includes("-path './bitrix/*'"));
  assert.match(s, /\nexit 0\n$/);
});

test('parseList: состояния, хеши по порядку (и с «\\» в начале), список find с размерами и переводом строки в имени; обрыв, лишний хеш, KIT_ERR', () => {
  const tracked = ['a.php', 'b.php', 'c.php', 'd.php', 'e.php'];
  const out = listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a') + ' ', '\\' + md5('c') + ' '], list: [[1, 'a.php'], [3, "new/it's\nфайл.php"]], findCode: 1 });
  const r = pe.parseList(out, tracked);
  assert.equal(r.err, null);
  assert.equal(r.bad, null);
  assert.deepEqual(Object.fromEntries(r.state), { 'a.php': 'file', 'b.php': 'unreadable', 'c.php': 'file', 'd.php': 'notfile', 'e.php': 'absent' });
  assert.deepEqual(Object.fromEntries(r.md5), { 'a.php': md5('a'), 'c.php': md5('c') });
  assert.deepEqual([...r.files], [['a.php', 1], ["new/it's\nфайл.php", 3]]);
  assert.equal(r.findFailed, true);
  assert.match(pe.parseList(out.replace('KIT_END', ''), tracked).bad, /оборван/);
  assert.match(pe.parseList(listOut({ hashes: [md5('a')] }), tracked).bad, /хеш/);
  assert.match(pe.parseList(listOut({ states: { 9: 'U' } }), tracked).bad, /9/);
  assert.equal(pe.parseList('KIT_ERR на сервере нет md5sum\n', tracked).err, 'на сервере нет md5sum');
});

test('fetchScript и parseFetch: base64 между метками по номерам; не прочитан — в failed; нет метки конца — обрыв', () => {
  const s = pe.fetchScript('/srv/site', ["it's файл.php"]);
  assert.match(s, /^cd '\/srv\/site' \|\|/);
  assert.ok(s.includes("g 1 'it'\\''s файл.php'"), s);
  const b64 = Buffer.from([0, 13, 10, 255]).toString('base64');
  const r = pe.parseFetch(`KIT_F 1\n${b64}\nKIT_FE 1\nKIT_F 2\nKIT_FX 2\nKIT_END\n`, ['a', 'b']);
  assert.equal(r.bad, null);
  assert.deepEqual(r.data.get('a'), Buffer.from([0, 13, 10, 255]));
  assert.deepEqual([...r.failed], ['b']);
  assert.match(pe.parseFetch('KIT_F 1\nYWJj\n', ['a']).bad, /оборван/);
  assert.match(pe.parseFetch('KIT_F 1\nYWJj\nKIT_FE 1\nKIT_END\n', ['a', 'b']).bad, /b/);
  assert.equal(pe.parseFetch('KIT_ERR нет папки сайта\n', ['a']).err, 'нет папки сайта');
});

test('listScript на локальном sh: есть, нет, папка, нет родителя, имя с «-» — состояния и md5 как есть; сценарий ничего не пишет в папку сайта', { skip: !SH }, () => {
  const server = writeFiles(tmpDir('kit-prod-srv-'), { 'a.php': 'a\r\n', '-x.php': 'x', 'd/f.txt': 'f', 'n/it\'s файл.php': 'ф' });
  const tracked = ['-x.php', 'a.php', 'd', 'gone.php', 'n/it\'s файл.php', 'no/dir/x.php'];
  const before = fs.readdirSync(server).sort();
  const r = spawnSync(SH, ['-s'], { input: pe.listScript(shPath(server), tracked, pe.pruneRules('')), encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  const list = pe.parseList(r.stdout, tracked);
  assert.equal(list.bad, null, r.stdout + r.stderr);
  assert.deepEqual(Object.fromEntries(list.state), { '-x.php': 'file', 'a.php': 'file', 'd': 'notfile', 'gone.php': 'absent', "n/it's файл.php": 'file', 'no/dir/x.php': 'absent' });
  assert.equal(list.md5.get('a.php'), md5('a\r\n'));
  assert.equal(list.md5.get("n/it's файл.php"), md5('ф'));
  assert.equal(list.files.get('d/f.txt'), 1);
  assert.equal(list.files.get("n/it's файл.php"), Buffer.byteLength('ф'));
  assert.deepEqual(fs.readdirSync(server).sort(), before);
});

// ---- Вход по SSH --------------------------------------------------------------------------------------------------------

test('изменён, добавлен, удалён без нас → один коммит входа с ENTRY_RE, строка с тремя числами, отметка done', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\n', 'b.php': 'b\n', 'c.php': 'c\n' });
  writeFiles(server, { 'a.php': 'a2\n', 'new/n.php': 'n\n' });
  fs.rmSync(path.join(server, 'c.php'));
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.match(subject(dir), ENTRY_RE);
  assert.match(subject(dir), /^Прод: изменения без kit на \d{4}-\d{2}-\d{2} \(3 файла\)$/);
  assert.equal(body(dir), 'изменён: a.php\nудалён: c.php\nдобавлен: new/n.php');
  assert.deepEqual(changed(dir), ['A\tnew/n.php', 'D\tc.php', 'M\ta.php']);
  assert.equal(read(dir, 'a.php'), 'a2\n');
  assert.equal(read(dir, 'new/n.php'), 'n\n');
  assert.ok(!has(dir, 'c.php'));
  assert.equal(status(dir), '');
  assert.match(last(r), /^\[kit\] Вход с прода: файлов без kit: изменено 1, добавлено 1, удалено 1\.$/);
  const head = g(dir, 'rev-parse', 'HEAD').trim();
  assert.equal(r.commit, head);
  assert.match(text(r), /^Сервер: прод — sh:/m);
  assert.match(text(r), /^База: [0-9a-f]{7,} \(первый коммит репозитория\)$/m);
  assert.match(text(r), new RegExp('^Коммит входа: ' + head.slice(0, 7) + '[0-9a-f]* \\(3 файла\\)$', 'm'));
  const mark = readMark(dir);
  assert.deepEqual(mark.pending, []);
  assert.equal(mark.sessions.s1.result, 'done');
  assert.equal(mark.sessions.s1.commit, head);
});

test('ничего не поменялось → коммита нет, «прод совпадает с git», отметка done', { skip: !SH }, async () => {
  const { dir } = site({ 'a.php': 'a\n', 'папка/b.php': 'b\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(r.commit, undefined);
  assert.equal(readMark(dir).sessions.s1.result, 'done');
  assert.equal(status(dir), '');
});

test('закоммиченный, но не залитый шаг (база — заливка до него) — не откатан, коммита входа нет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': '2\n' });
  const s1 = commit(dir, '1.1: правка');
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.1', s1.slice(0, 9)]]) });
  commit(dir, '1.1а: план выкладки');
  writeFiles(server, { 'a.php': '2\n' }); // залито вручную
  writeFiles(dir, { 'a.php': '3\n' });
  commit(dir, '1.2: ещё правка'); // не залито
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 4);
  assert.equal(read(dir, 'a.php'), '3\n');
  assert.match(text(r), /База: [0-9a-f]+ \(«Залито на прод» в \.claude\/docs\/deploy-prod\.md\)/);
  assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
});

test('незалитый шаг не откатывается вторым входом: база — заливка, поверх — пути своих коммитов входа; заливка после входа — база для всех путей (Р-24)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': '2 наш шаг\n' });
  commit(dir, '1.1: правка a.php'); // закоммичено, не залито (выкладка вручную)
  writeFiles(server, { 'b.php': 'b клиент\n' });
  const r1 = await run(dir);
  assert.equal(r1.code, 0, text(r1));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  const r2 = await run(dir, { sessionId: 's2' });
  assert.equal(r2.code, 0, text(r2));
  assert.equal(count(dir), 3, 'второго коммита входа нет');
  assert.equal(read(dir, 'a.php'), '2 наш шаг\n');
  assert.match(text(r2), /^База: [0-9a-f]+ \(первый коммит репозитория; поверх — 1 коммит входа\)$/m);
  assert.equal(last(r2), '[kit] Вход с прода: прод совпадает с git.');

  // шаг 1.2 после коммита входа залит — база для всех путей: заливка, наложения нет
  writeFiles(dir, { 'c.php': 'c\n' });
  const s12 = commit(dir, '1.2: новый c.php');
  writeFiles(server, { 'a.php': '2 наш шаг\n', 'c.php': 'c\n' });
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.2', s12.slice(0, 9)]]) });
  commit(dir, '1.2а: план выкладки');
  const r3 = await run(dir, { sessionId: 's3' });
  assert.equal(r3.code, 0, text(r3));
  assert.match(text(r3), /^База: [0-9a-f]+ \(«Залито на прод» в \.claude\/docs\/deploy-prod\.md\)$/m);
  assert.equal(last(r3), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(count(dir), 5);
});

test('файл с историей шагов изменён без нас → в строке доработки с путём', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': '2\n' });
  const s1 = commit(dir, '1.1: доработка a.php');
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.1', s1.slice(0, 9)]]) });
  commit(dir, '1.1а: план выкладки');
  writeFiles(server, { 'a.php': 'клиент поправил\n', 'b.php': 'b2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php', 'M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'клиент поправил\n');
  assert.match(last(r), /изменено 2, добавлено 0, удалено 0\. Наши прошлые доработки среди изменённых \(проверьте, не затёрты ли\): a\.php\.$/);
});

test('удалённый нашим шагом файл лежит на сервере → не возвращён, «ждёт удаления с сервера»; папка из плана — одной записью', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\n', 'c.php': 'c\n', 'd.php': 'd\n' }, { server: { 'a.php': 'a\n', 'c.php': 'c\n', 'd.php': 'd\n', 'old/x.php': 'x', 'old/y.php': 'y' } });
  g(dir, 'rm', '-q', 'c.php');
  const s1 = commit(dir, '1.1: убрать c.php');
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.1', s1.slice(0, 9)]], ['old/']) });
  commit(dir, '1.1а: план выкладки');
  g(dir, 'rm', '-q', 'd.php');
  commit(dir, '1.2: убрать d.php'); // не залито: d.php есть в базе
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 4);
  assert.ok(!has(dir, 'c.php') && !has(dir, 'd.php') && !has(dir, 'old'));
  assert.match(last(r), /Ждёт удаления с сервера: c\.php, d\.php, old\/\.$/);
  assert.match(last(r), /изменено 0, добавлено 0, удалено 0/);
});

test('архив и файл больше 10 МБ — не забраны и названы; второй вход их не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\n' });
  writeFiles(server, { 'backup.zip': 'PK', 'files/big.dat': Buffer.alloc(FILE_LIMIT + 1, 120), 'ok.php': 'ok\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tok.php']);
  assert.ok(!has(dir, 'backup.zip') && !has(dir, 'files/big.dat'));
  assert.match(last(r), /Не забрано, осталось на сервере: backup\.zip \(архив\), files\/big\.dat \(больше 10 МБ\)\./);
  assert.deepEqual(readMark(dir).named, ['backup.zip', 'files/big.dat']);
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
  assert.deepEqual(readMark(dir).named, ['backup.zip', 'files/big.dat']);
});

test('CRLF на сервере, LF в git — не изменение; смешанные переводы строк, равные HEAD без \\r, — не изменение (через скачивание)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\nb\n', 'm.php': 'x\ny\nz\n', 'bin.dat': Buffer.from([0, 10, 1]) });
  writeFiles(server, { 'a.php': 'a\r\nb\r\n', 'm.php': 'x\r\ny\nz\r\n', 'bin.dat': Buffer.from([0, 13, 10, 1]) });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
  const sent = JSON.parse(fs.readFileSync(log, 'utf8')).stdin;
  assert.match(sent, /^g \d+ 'm\.php'$/m, 'неясный файл скачан');
  assert.doesNotMatch(sent, /'a\.php'/, 'CRLF-вариант совпал без скачивания');
});

test("путь с пробелом, кириллицей и ' — забран и закоммичен", { skip: !SH }, async () => {
  const P = "папка с пробелом/it's файл.php";
  const N = "новая папка/x 'y'.php";
  const { dir, server } = site({ [P]: 'старый\n', 'a.php': 'a\n' });
  writeFiles(server, { [P]: 'новый\n', [N]: 'н\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\t' + N, 'M\t' + P]);
  assert.equal(read(dir, P), 'новый\n');
  assert.equal(read(dir, N), 'н\n');
  assert.equal(status(dir), '');
});

test('нечитаемый файл на сервере — не удалён, не забран, назван (каждый вход); ссылка вместо файла — «не файл» (готовый ответ сервера)', async () => {
  const { dir } = site({ 'a.php': 'a\n', 'b.php': 'b\n', 'c.php': 'c\n' }, { host: 'fixed' });
  const out = listOut({ states: { 2: 'U', 3: 'O' }, hashes: [md5('a\n') + ' '], list: [[2, 'a.php']] });
  await withEnv({ FAKE_SSH_OUT: out }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 0, text(r));
    assert.equal(count(dir), 1);
    assert.equal(read(dir, 'b.php'), 'b\n');
    assert.equal(read(dir, 'c.php'), 'c\n');
    assert.match(last(r), /Не забрано, осталось на сервере: b\.php \(не читается\), c\.php \(не файл\)\./);
    const again = await run(dir, { sessionId: 's2' });
    assert.match(last(again), /b\.php \(не читается\), c\.php \(не файл\)/);
  });
});

test('каталог (и ссылка, где её можно создать) вместо файла — не забираются, вход не падает', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\n', 'b.php': 'b\n', 'c.php': 'c\n' });
  fs.rmSync(path.join(server, 'b.php'));
  writeFiles(server, { 'b.php/inner.txt': 'i' });
  let link = true;
  try {
    fs.rmSync(path.join(server, 'c.php'));
    fs.symlinkSync('a.php', path.join(server, 'c.php'));
  } catch (e) {
    link = false; // Windows без прав на ссылки — ссылку проверяет тест с готовым ответом сервера
    writeFiles(server, { 'c.php': 'c\n' });
  }
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(read(dir, 'b.php'), 'b\n');
  assert.ok(!has(dir, 'b.php/inner.txt'));
  assert.match(last(r), link ? /b\.php \(не файл\), c\.php \(не файл\)/ : /Не забрано, осталось на сервере: b\.php \(не файл\)\.$/);
  assert.doesNotMatch(text(r), /inner/);
});

test('нет подключения — код 3 с причиной и вопросом; обрыв при скачивании — код 3, ничего не записано; повтор — коммит', { skip: !SH }, async () => {
  const down = site({ 'a.php': '1\n' }, { host: 'down' });
  const r0 = await run(down.dir);
  assert.equal(r0.code, 3);
  assert.match(text(r0), /Connection timed out/);
  assert.equal(last(r0), 'спроси пользователя: Повторить / Работать без входа (`prod-entry.js --skip`)');
  assert.ok(!has(down.dir, '.claude/kit-prod.json'));

  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' }, { host: 'shdrop' });
  writeFiles(server, { 'a.php': '2\n', 'n.php': 'n\n' });
  await withEnv({ FAKE_SSH_COUNT: path.join(tmpDir('kit-prod-cnt-'), 'n'), FAKE_SSH_DROP: '2' }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 3, text(r));
    assert.match(text(r), /closed by remote host/);
    assert.equal(read(dir, 'a.php'), '1\n');
    assert.ok(!has(dir, 'n.php'));
    assert.deepEqual(readMark(dir).pending, []);
    assert.equal(readMark(dir).sessions.s1, undefined);
    assert.equal(count(dir), 1);
    const again = await run(dir);
    assert.equal(again.code, 0, text(again));
    assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php']);
  });
});

test('повтор (ревью 5): pending, часть файлов записана → один коммит со всеми; файл, который сервер вернул к базе, — равен HEAD, не в коммите', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n', 'c.php': 'c\n' });
  writeFiles(server, { 'a.php': '2\n', 'b.php': 'b2\n', 'n.php': 'n\n' }); // c.php на сервере вернули к базе
  // прошлый вход оборвался после записи: a.php и n.php записаны, c.php — прежней версией сервера
  writeFiles(dir, { 'a.php': '2\n', 'n.php': 'n\n', 'c.php': 'c старая версия сервера\n' });
  writeMark(dir, { sessions: {}, named: [], pending: ['a.php', 'b.php', 'c.php', 'n.php'] });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php', 'M\tb.php']);
  assert.equal(read(dir, 'c.php'), 'c\n');
  assert.equal(status(dir), '');
  assert.deepEqual(readMark(dir).pending, []);
});

test('--check и worktree: только сверка — есть что забрать — код 1, ничего не записано; забирать нечего — checked', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir, { check: true });
  assert.equal(r.code, 1, text(r));
  assert.match(r.out[r.out.length - 2], /изменено 1/);
  assert.match(last(r), /^есть изменения без kit — вход делает общая сессия в основной папке \(.+\)$/);
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.ok(!has(dir, '.claude/kit-prod.json'));
  assert.equal(count(dir), 1);

  // worktree по пути <проект>/.claude/worktrees/<имя> и связанный worktree в другом месте
  const inside = path.join(dir, '.claude', 'worktrees', 'w1');
  g(dir, 'worktree', 'add', '-q', '-b', 'w1', inside);
  const outside = path.join(tmpDir('kit-prod-wt-'), 'w2');
  g(dir, 'worktree', 'add', '-q', '-b', 'w2', outside);
  for (const wt of [inside, outside]) {
    const w = await run(wt);
    assert.equal(w.code, 1, wt + '\n' + text(w));
    assert.match(last(w), /вход делает общая сессия в основной папке \(.*kit-prod-[^)]*\)$/);
    assert.ok(last(w).includes(path.basename(dir)), last(w));
    assert.equal(read(wt, 'a.php'), '1\n');
    assert.equal(status(wt), '');
    assert.ok(!has(wt, '.claude/kit-prod.json'));
  }

  writeFiles(server, { 'a.php': '1\r\n' }); // CRLF — не изменение
  const ok = await run(dir, { check: true });
  assert.equal(ok.code, 0, text(ok));
  assert.equal(last(ok), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(readMark(dir).sessions.s1.result, 'checked');
  const okWt = await run(outside, { sessionId: 'w' });
  assert.equal(okWt.code, 0, text(okWt));
  assert.equal(readMark(outside).sessions.w.result, 'checked');
});

test('«Прод: —» и не kit-проект — код 2, файлов не пишет; «SSH прод» неверный — код 2; без SSH — код 2 «48.5»; не git — код 4; аргументы — код 4', () => {
  const plain = tmpDir('kit-prod-');
  g(plain, 'init', '-q');
  writeFiles(plain, { 'a.php': '1' });
  commit(plain, 'исходники');
  let r = runScript('prod-entry.js', { cwd: plain });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /вход не нужен: не kit-проект/);
  assert.ok(!has(plain, '.claude'));

  const none = site({ 'a.php': '1' }, { params: { 'Прод': '—', 'SSH прод': '—' } });
  r = runScript('prod-entry.js', { cwd: path.join(none.dir, '.claude') });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /вход не нужен: сервер не задан/);
  assert.ok(!has(none.dir, '.claude/kit-prod.json'));

  const bad = site({ 'a.php': '1' }, { params: { 'SSH прод': 'alpha:~/www' } });
  r = runScript('prod-entry.js', { cwd: bad.dir });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /параметр «SSH прод» неверный: alpha:~\/www — нужно хост:\/абсолютная\/папка/);
  assert.match(r.stdout, /\/kit:project-init.*Повторить \/ Работать без входа \(`prod-entry\.js --skip`\)/);

  const ftp = site({ 'a.php': '1' }, { params: { 'SSH прод': '—' } });
  r = runScript('prod-entry.js', { cwd: ftp.dir });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /без SSH: вход по FTP — шаг 48\.5/);

  const nogit = writeFiles(tmpDir('kit-prod-'), { '.claude/CLAUDE.md': paramsMd({ ...PARAMS, 'SSH прод': 'sh:/srv/site' }), 'a.php': '1' });
  r = runScript('prod-entry.js', { cwd: nogit });
  assert.equal(r.code, 4, r.stdout);
  assert.ok(!has(nogit, '.claude/kit-prod.json'));

  for (const args of [['--нет'], ['--timeout', '0']]) assert.equal(runScript('prod-entry.js', { cwd: ftp.dir, args }).code, 4, args.join(' '));
  for (const flag of ['--skip', '--ftp-done', '--hook']) {
    r = runScript('prod-entry.js', { cwd: ftp.dir, args: [flag] });
    assert.equal(r.code, 4, flag);
    assert.match(r.stdout, new RegExp('режим ' + flag + ' — в шаге 48\\.5'));
  }
});

test('секрет в скачанном файле — код 1, коммита нет, вывод kit-commit.js в out, pending остаётся', { skip: !SH }, async () => {
  const { dir, server } = site({ 'cfg.php': '<?php\n', 'a.php': 'a\n' });
  writeFiles(server, { 'cfg.php': `<?php\nreturn ['password' => '${SECRET}'];\n` });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /kit-commit: стоп — найдены секреты/);
  assert.doesNotMatch(text(r), new RegExp(SECRET.replace(/[!]/g, '\\$&')));
  assert.equal(count(dir), 1);
  assert.deepEqual(readMark(dir).pending, ['cfg.php']);
  assert.equal(readMark(dir).sessions.s1, undefined);
  assert.match(last(r), /секрет/);
});

test('путь к забору с незакоммиченной правкой и merge — код 1 «48.4», ничего не записано', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n', 'x.php': 'x\n' });
  writeFiles(dir, { 'b.php': 'b наш\n' });
  commit(dir, '1.1: правка b.php'); // не залито
  writeFiles(dir, { 'a.php': 'локальная правка\n' });
  writeFiles(server, { 'a.php': 'сервер\n', 'b.php': 'b сервер\n', 'x.php': 'x2\n' });
  const before = status(dir);
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /48\.4/);
  assert.match(text(r), /a\.php/);
  assert.match(text(r), /b\.php/);
  assert.equal(read(dir, 'a.php'), 'локальная правка\n');
  assert.equal(read(dir, 'x.php'), 'x\n');
  assert.equal(status(dir), before);
  assert.equal(count(dir), 2);
  assert.deepEqual(readMark(dir).pending, []);
  assert.equal(readMark(dir).sessions.s1, undefined);
});

test('много путей: маленький argLimit → несколько коммитов входа подряд, у каждого ENTRY_RE, вместе — все пути', { skip: !SH }, async () => {
  const names = ['f1.php', 'f2.php', 'f3.php', 'f4.php', 'f5.php'];
  const { dir, server } = site(Object.fromEntries(names.map((n) => [n, '1\n'])));
  writeFiles(server, Object.fromEntries(names.map((n) => [n, '2\n'])));
  const r = await run(dir, { argLimit: 20 });
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 4);
  const all = [];
  for (const rev of ['HEAD~2', 'HEAD~1', 'HEAD']) {
    assert.match(subject(dir, rev), ENTRY_RE);
    all.push(...changed(dir, rev));
  }
  assert.deepEqual([subject(dir, 'HEAD~2'), subject(dir, 'HEAD~1'), subject(dir, 'HEAD')].map((s) => s.replace(/^.*\(/, '(')), ['(2 файла)', '(2 файла)', '(1 файл)']);
  assert.deepEqual(all.sort(), names.map((n) => 'M\t' + n));
  assert.equal((text(r).match(/^Коммит входа: /gm) || []).length, 3);
  assert.equal(status(dir), '');
  assert.equal(readMark(dir).sessions.s1.commit, g(dir, 'rev-parse', 'HEAD').trim());
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.equal(count(dir), 4, 'у каждого пути версия базы — из своего коммита входа: забирать нечего');
  assert.match(text(again), /поверх — 3 коммита входа/);
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
});

test('запрещённый к коммиту новый файл (local/.settings.php) — не забран, назван; второй вход его не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'local/.settings.php': '<?php return [];\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.ok(!has(dir, 'local/.settings.php'));
  assert.match(last(r), /local\/\.settings\.php \(запрещён к коммиту\)/);
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
});

test('git status --porcelain после входа — как до него: незакоммиченная правка другого файла цела и не в коммите', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'x.php': 'x\n' });
  writeFiles(dir, { 'x.php': 'моя правка\n', 'local-new.php': 'n\n' });
  const before = status(dir);
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(status(dir), before);
  assert.equal(read(dir, 'x.php'), 'моя правка\n');
});

test('«Удалённый репозиторий»: голый репозиторий как origin — после входа коммит там', { skip: !SH }, async () => {
  const bare = tmpDir('kit-prod-bare-');
  g(bare, 'init', '-q', '--bare');
  const { dir, server } = site({ 'a.php': '1\n' }, { params: { 'Удалённый репозиторий': 'origin' } });
  g(dir, 'remote', 'add', 'origin', bare);
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  const branch = g(dir, 'symbolic-ref', '--short', 'HEAD').trim();
  assert.equal(g(bare, 'rev-parse', branch).trim(), g(dir, 'rev-parse', 'HEAD').trim());

  // удалённый недоступен — коммит входа есть, вход сделан, строка «не отправлен» (kit-commit.js, код 4)
  g(dir, 'remote', 'set-url', 'origin', path.join(tmpDir('kit-prod-'), 'нет такого'));
  g(dir, 'update-ref', '-d', 'refs/remotes/origin/' + branch);
  writeFiles(server, { 'a.php': '3\n' });
  const r2 = await run(dir, { sessionId: 's2' });
  assert.equal(r2.code, 0, text(r2));
  assert.match(text(r2), /^коммит входа не отправлен: .+/m);
  assert.equal(read(dir, 'a.php'), '3\n');
  assert.equal(readMark(dir).sessions.s2.result, 'done');
  assert.match(last(r2), /изменено 1/);
});

test('--timeout 1 и зависший хост — код 3 «вышло время»', async () => {
  const { dir } = site({ 'a.php': '1\n' }, { host: 'hang' });
  const r = await run(dir, { timeoutMs: 1000 });
  assert.equal(r.code, 3, text(r));
  assert.match(text(r), /вышло время \(1 с\)/);
  assert.match(last(r), /Повторить \/ Работать без входа/);
});

test('сквозное отрезание с рабочими папками (WORK_GITIGNORE): новый файл в bitrix/templates/theme/ забран, в bitrix/modules/ — не забран и не назван', { skip: !SH }, async () => {
  const files = { 'bitrix/templates/theme/a.php': 'a\n', 'bitrix/php_interface/init.php': '<?php\n', 'local/x.php': 'x\n' };
  const { dir, server } = site(files, {
    gitignore: TEMPLATE + '\n' + WORK_GITIGNORE, params: { 'Не коммитить': WORK_RULE },
    server: { ...files, 'bitrix/modules/main/x.php': 'ядро\n', 'bitrix/php_interface/dbconn.php': '<?php\n', 'upload/1.jpg': 'jpg' },
  });
  assert.deepEqual(g(dir, 'ls-files').trim().split('\n').filter((p) => p.startsWith('bitrix/')), ['bitrix/php_interface/init.php', 'bitrix/templates/theme/a.php']);
  writeFiles(server, { 'bitrix/templates/theme/new.php': 'n\n', 'bitrix/modules/main/y.php': 'ядро 2\n', 'upload/docs/d.txt': 'd' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tbitrix/templates/theme/new.php', 'A\tupload/docs/d.txt']);
  assert.doesNotMatch(text(r), /modules|dbconn|1\.jpg/);
});

test('main: KIT_SESSION_ID из окружения — отметка done; вывод в stdout, последняя строка — итог', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n' });
  const r = runScript('prod-entry.js', { cwd: dir, env: { KIT_SESSION_ID: 'cli-1' } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout.trim().split('\n').pop(), /изменено 1, добавлено 0, удалено 0\.$/);
  assert.equal(readMark(dir).sessions['cli-1'].result, 'done');
  const quiet = runScript('prod-entry.js', { cwd: dir, env: { KIT_SESSION_ID: '' } });
  assert.equal(quiet.code, 0, quiet.stdout);
  assert.match(quiet.stdout, /отметка не поставлена: хук не пустит правки — перезапусти сессию/);
  assert.match(quiet.stdout.trim().split('\n').pop(), /совпадает с git/);
});
