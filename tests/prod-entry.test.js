'use strict';
// Вход с прода по SSH (шаги 48.3–48.4): prod-entry.js — сверка «сервера» (временная папка через заглушку fake-ssh.js, хост sh) с
// git, забор изменённого без нас, коммит входа через kit-commit.js, отметка .claude/kit-prod.json; наши незакоммиченные правки и
// совмещение, File Watchers PhpStorm и предел 50 МБ за вход.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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
// fixed (готовый ответ FAKE_SSH_OUT); ssh — параметр с адресом («SSH прод» или «SSH дев»).
function site(files, { params = {}, gitignore = GITIGNORE, host = 'sh', ssh = 'SSH прод', server: serverFiles = files } = {}) {
  const server = writeFiles(tmpDir('kit-prod-srv-'), serverFiles);
  const dir = tmpDir('kit-prod-');
  writeFiles(dir, { '.claude/CLAUDE.md': paramsMd({ ...PARAMS, [ssh]: host + ':' + shPath(server), ...params }), '.gitignore': gitignore, ...files });
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
// отслеживаемых «есть», sizes — их размеры (по умолчанию 1), list — [[размер, путь]] из find.
const listOut = ({ states = {}, hashes = [], sizes = hashes.map(() => 1), list = [], findCode = 0 }) => [
  ...Object.entries(states).map(([n, s]) => `KIT_S ${n} ${s}`), 'KIT_H', ...hashes, 'KIT_Z', ...sizes.map(String), 'KIT_L',
  Buffer.from(list.map(([s, p]) => `${s} ${p}\0`).join('')).toString('base64'), `KIT_LE ${findCode}`, 'KIT_END', ''].join('\n');

// .idea PhpStorm: deployment.xml (always — автозаливка Always) и watcherTasks.xml (watchers — [[расширение, включён]]).
function idea(dir, { always = false, watchers = [] } = {}) {
  writeFiles(dir, {
    '.idea/deployment.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="PublishConfigData"' +
      (always ? ' autoUpload="Always"' : '') + ' serverName="alpha">\n    <serverData>\n      <paths name="alpha">\n        <serverdata>\n' +
      '          <mappings>\n            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />\n          </mappings>\n        </serverdata>\n' +
      '      </paths>\n    </serverData>\n  </component>\n</project>\n',
    '.idea/watcherTasks.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="ProjectTasksOptions">\n' +
      watchers.map(([ext, on]) => `    <TaskOptions isEnabled="${on}">\n      <option name="fileExtension" value="${ext}" />\n` +
        '      <option name="name" value="W" />\n      <option name="output" value="$FileNameWithoutExtension$.css" />\n    </TaskOptions>\n').join('') +
      '  </component>\n</project>\n',
  });
}
// Сценарий последнего подключения (FAKE_SSH_LOG): было ли скачивание.
const lastSent = (log) => JSON.parse(fs.readFileSync(log, 'utf8')).stdin;
const fetched = (log) => /KIT_F /.test(lastSent(log));
// Пути временных файлов конфликта из строки вывода: «  путь — причина; наша — …; сервера — …; база — …». Папку kit-prod-* вход
// не убирает (её читает Claude) — тесты убирают её сами при выходе.
const conflictDirs = new Set();
process.on('exit', () => {
  for (const d of conflictDirs) fs.rmSync(d, { recursive: true, force: true });
});
function conflictOf(r, rel) {
  const line = r.out.find((l) => l.startsWith('  ' + rel + ' — '));
  assert.ok(line, 'нет строки конфликта ' + rel + '\n' + text(r));
  const m = /^ {2}(.+?) — (.+?); наша — (.+?); сервера — (.+?); база — (.+)$/.exec(line);
  assert.ok(m, line);
  const file = (v) => (v === 'нет' ? null : v);
  for (const f of [file(m[4]), file(m[5])].filter(Boolean)) {
    let d = f;
    while (path.dirname(d) !== d && !path.basename(d).startsWith('kit-prod-')) d = path.dirname(d);
    if (path.basename(d).startsWith('kit-prod-')) conflictDirs.add(d);
  }
  return { why: m[2], ours: m[3], server: file(m[4]), base: file(m[5]) };
}

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
  // М-5: пробел в начале или в конце любой части — на всех ОС (самопроверка kit-commit.js обрезает пробелы в именах)
  for (const p of [' x.php', 'x.php ', 'a/ b.php', 'папка /x.php', ' папка/x.php']) {
    assert.equal(pe.badName(p, false), true, JSON.stringify(p));
    assert.equal(pe.badName(p, true), true, JSON.stringify(p));
  }
  assert.equal(pe.badName('x.php.', false), false, 'точка в конце — только Windows');
});

test('pruneRules: .gitignore в папке над P (М-1) — P и её детей не отрезать; P целиком — смотрим до родителя P', () => {
  const own = new Set(['a', 'c']);
  const r = pe.pruneRules('/a/b/*\n/c/d/\n/e/f/\n/g/h/*\n', (p) => own.has(p) || p === 'e/f' || p === 'g');
  assert.ok(!r.some((x) => x.path === 'a/b'), 'a/.gitignore может вернуть детей a/b');
  assert.ok(!r.some((x) => x.path === 'c/d'), 'c/.gitignore может вернуть c/d');
  assert.deepEqual(r.find((x) => x.path === 'e/f'), { path: 'e/f', dir: true }, 'свой e/f/.gitignore git не читает — e/f целиком можно');
  assert.ok(!r.some((x) => x.path === 'g/h'), 'g/.gitignore над g/h');
  assert.deepEqual(pe.pruneRules('/a/b/*\n/c/d/\n').filter((x) => x.path === 'a/b' || x.path === 'c/d'),
    [{ path: 'a/b', children: true, keep: [], names: [] }, { path: 'c/d', dir: true }]);
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
  // М-11: размеры отслеживаемых — пачкой по тому же списку, одним find на пачку
  assert.ok(s.includes('xargs -0 sh -c \'find "$@" -maxdepth 0 -printf "%s\\n"\' sh'), s);
  // без правил — только состояния, md5 и размеры, без обхода папки сайта
  const h = pe.listScript('/srv/site', ['a.php'], null);
  assert.doesNotMatch(h, /-prune/);
  assert.match(h, /xargs -0 md5sum/);
});

test('parseList: состояния, хеши по порядку (и с «\\» в начале), список find с размерами и переводом строки в имени; обрыв, лишний хеш, KIT_ERR', () => {
  const tracked = ['a.php', 'b.php', 'c.php', 'd.php', 'e.php'];
  const out = listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a') + ' ', '\\' + md5('c') + ' '], sizes: [1, 20971520], list: [[1, 'a.php'], [3, "new/it's\nфайл.php"]], findCode: 1 });
  const r = pe.parseList(out, tracked);
  assert.equal(r.err, null);
  assert.equal(r.bad, null);
  assert.deepEqual(Object.fromEntries(r.state), { 'a.php': 'file', 'b.php': 'unreadable', 'c.php': 'file', 'd.php': 'notfile', 'e.php': 'absent' });
  assert.deepEqual(Object.fromEntries(r.md5), { 'a.php': md5('a'), 'c.php': md5('c') });
  assert.deepEqual(Object.fromEntries(r.sizes), { 'a.php': 1, 'c.php': 20971520 }, 'М-11: размеры отслеживаемых — по порядку, как хеши');
  assert.deepEqual([...r.files], [['a.php', 1], ["new/it's\nфайл.php", 3]]);
  assert.equal(r.findFailed, true);
  assert.match(pe.parseList(out.replace('KIT_END', ''), tracked).bad, /оборван/);
  assert.match(pe.parseList(listOut({ hashes: [md5('a')] }), tracked).bad, /хеш/);
  assert.match(pe.parseList(listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a'), md5('c')], sizes: [1] }), tracked).bad, /размер/);
  assert.match(pe.parseList(listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a'), md5('c')], sizes: [1, 'x'] }), tracked).bad, /размер/);
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
  assert.deepEqual(Object.fromEntries(list.sizes), { '-x.php': 1, 'a.php': 3, "n/it's файл.php": Buffer.byteLength('ф') });
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

test('worktree на ветке от старого коммита, шаг основной папки залит (сервер = её HEAD) — сверяется основная папка: код 0; основная недоступна — своя (Р-39)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  const outside = path.join(tmpDir('kit-prod-wt-'), 'w');
  g(dir, 'worktree', 'add', '-q', '-b', 'old', outside); // ветка от первого коммита
  writeFiles(dir, { 'a.php': '2 шаг\n' });
  const s1 = commit(dir, '1.1: правка a.php');
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.1', s1.slice(0, 9)]]) });
  commit(dir, '1.1а: план выкладки');
  writeFiles(server, { 'a.php': '2 шаг\n' }); // шаг залит
  const r = await run(outside, { sessionId: 'w' });
  assert.equal(r.code, 0, text(r));
  assert.ok(r.out.some((l) => l.startsWith('Сверка — по основной папке проекта: ') && l.includes(path.basename(dir))), text(r));
  assert.match(text(r), /База: [0-9a-f]+ \(«Залито на прод» в \.claude\/docs\/deploy-prod\.md\)/);
  assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(readMark(outside).sessions.w.result, 'checked');
  assert.ok(!has(dir, '.claude/kit-prod.json'), 'отметка — в папке сессии');
  assert.equal(read(outside, 'a.php'), '1\n');
  // основная папка — не kit-проект: сверяется своя, как в 48.3 (на старой ветке залитый шаг — «изменение без нас»)
  fs.renameSync(path.join(dir, '.claude', 'CLAUDE.md'), path.join(dir, '.claude', 'CLAUDE.off'));
  const own = await run(outside, { sessionId: 'w2' });
  fs.renameSync(path.join(dir, '.claude', 'CLAUDE.off'), path.join(dir, '.claude', 'CLAUDE.md'));
  assert.equal(own.code, 1, text(own));
  assert.doesNotMatch(text(own), /основной папке проекта:/);
  assert.match(last(own), /^есть изменения без kit — вход делает общая сессия в основной папке/);
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
  // М-9: последняя строка — что делать Claude, а не состояние
  assert.match(r.stdout, /вход не сделан: в репозитории нет коммитов или это не git/);
  assert.match(r.stdout.trim().split('\n').pop(), /^скажи пользователю: .*\/kit:project-init.*Работать без входа \(`prod-entry\.js --skip`\)$/);

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

// ---- Наши правки и совмещение (48.4) -----------------------------------------------------------------------------------
const FIVE = 'l1\nl2\nl3\nl4\nl5\n';
const MERGED = 'Совмещено с нашими незакоммиченными правками — проверьте в панели изменений: ';
const summaryOf = (r) => r.out.find((l) => l.startsWith('[kit] '));

test('незакоммиченная правка уже на сервере — не тронута, в строке и коммите входа её нет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n', 'c.php': 'c\n', 'd.php': 'd\n' });
  // наши правки, уже залитые автозаливкой: изменён, изменён (на сервере — с CRLF), удалён
  writeFiles(dir, { 'a.php': 'моя\n', 'c.php': 'c моя\nвторая\n' });
  fs.rmSync(path.join(dir, 'd.php'));
  writeFiles(server, { 'a.php': 'моя\n', 'c.php': 'c моя\r\nвторая\r\n', 'b.php': 'b2\n' });
  fs.rmSync(path.join(server, 'd.php'));
  const before = status(dir);
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(body(dir), 'изменён: b.php');
  assert.equal(status(dir), before);
  assert.equal(read(dir, 'a.php'), 'моя\n');
  assert.equal(read(dir, 'c.php'), 'c моя\nвторая\n');
  assert.ok(!has(dir, 'd.php'));
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  assert.doesNotMatch(lastSent(log), /'a\.php'|'c\.php'/, 'наше на сервере не скачивается');
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(count(dir), 2);
  // --check (Р-28): своё на сервере — не «есть что забрать»
  const checked = await run(dir, { sessionId: 's3', check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(readMark(dir).sessions.s3.result, 'checked');
  assert.equal(status(dir), before);
});

test('новый неотслеживаемый файл, уже залитый на сервер, — не тронут, в строке и коммите его нет (Р-35)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  // mine.zip — своё и под «не забирать» (архив): не называется и там (М-1 проверки 48.4)
  writeFiles(dir, { 'mine.php': 'моё\n', 'win.php': 'x\ny\n', 'mine.zip': 'PK' });
  writeFiles(server, { 'mine.php': 'моё\n', 'win.php': 'x\r\ny\r\n', 'b.php': 'b\n', 'mine.zip': 'PK' });
  const before = status(dir);
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tb.php']);
  assert.equal(status(dir), before);
  assert.equal(read(dir, 'win.php'), 'x\ny\n');
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 1, удалено 0.');
  assert.doesNotMatch(lastSent(log), /mine|win/, 'своё не скачивается');
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
});

test('незакоммиченная правка и изменение без нас — совмещено в рабочей копии, в коммите входа пути нет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n' });
  // a.php.999.kit-tmp — временный файл записи после обрыва прошлого входа (М-3 проверки 48.4: убирается и у совмещаемых)
  writeFiles(dir, { 'a.php': 'L1 наша\nl2\nl3\nl4\nl5\n', 'a.php.999.kit-tmp': 'остаток' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n', 'b.php': 'b2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'L1 наша\nl2\nl3\nl4\nL5 сервер\n');
  assert.equal(g(dir, 'show', 'HEAD:a.php'), FIVE, 'в git — прежняя версия');
  assert.equal(status(dir), ' M a.php\n');
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 1, добавлено 0, удалено 0. ' + MERGED + 'a.php.');
  const mark = readMark(dir);
  assert.deepEqual(mark.pending, []);
  assert.equal(mark.sessions.s1.result, 'done');
  // --check после совмещения (Р-39): вход ничего не запишет — код 0
  const checked = await run(dir, { sessionId: 's2', check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(readMark(dir).sessions.s2.result, 'checked');
  assert.equal(status(dir), ' M a.php\n');
});

test('merge закоммиченного незалитого с изменением без нас — совмещено, коммит входа без этого пути; повторный вход ничего не пишет и не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': 'L1 наш шаг\nl2\nl3\nl4\nl5\n' });
  commit(dir, '1.1: правка a.php'); // не залито
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n', 'b.php': 'b2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 3);
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'L1 наш шаг\nl2\nl3\nl4\nL5 сервер\n');
  assert.equal(status(dir), ' M a.php\n');
  assert.match(last(r), new RegExp(MERGED + 'a\\.php\\.$'));
  // повтор (Р-35 п. 6): совмещённое уже в рабочей копии — ничего не пишется и не называется
  const old = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(path.join(dir, 'a.php'), old, old);
  const mtime = fs.statSync(path.join(dir, 'a.php')).mtimeMs;
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(count(dir), 3);
  assert.equal(fs.statSync(path.join(dir, 'a.php')).mtimeMs, mtime);
  assert.equal(read(dir, 'a.php'), 'L1 наш шаг\nl2\nl3\nl4\nL5 сервер\n');
});

// Папки конфликтов этого проекта в os.tmpdir() (Р-38): kit-prod-<8 знаков md5 пути папки проекта>-*.
const conflictTag = (dir) => {
  const key = path.resolve(dir);
  return 'kit-prod-' + md5(process.platform === 'win32' ? key.toLowerCase() : key).slice(0, 8) + '-';
};
const conflictRoots = (dir) => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(conflictTag(dir))).sort();

test('конфликт совмещения — код 1, рабочая копия не тронута, версия сервера — во временном файле; остальное — коммитом входа, отметка done; повторный вход — одни конфликты (Р-37), прежняя папка конфликтов убрана (Р-38)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n', 'm.php': FIVE });
  writeFiles(dir, { 'a.php': 'наша\nl2\nl3\nl4\nl5\n', 'm.php': 'M1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'a.php': 'сервер\nl2\nl3\nl4\nl5\n', 'b.php': 'b2\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n', 'n.php': 'n\n' });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\tb.php']);
  const head = g(dir, 'rev-parse', 'HEAD').trim();
  assert.equal(r.commit, head);
  assert.equal(read(dir, 'a.php'), 'наша\nl2\nl3\nl4\nl5\n');
  assert.equal(read(dir, 'm.php'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n');
  const k = conflictOf(r, 'a.php');
  assert.equal(k.why, 'правки пересекаются');
  assert.equal(k.ours, path.join(dir, 'a.php'));
  assert.equal(fs.readFileSync(k.server, 'utf8'), 'сервер\nl2\nl3\nl4\nl5\n');
  assert.equal(fs.readFileSync(k.base, 'utf8'), FIVE);
  const first = path.dirname(path.dirname(k.server));
  assert.equal(path.dirname(first), os.tmpdir());
  assert.ok(path.basename(first).startsWith(conflictTag(dir)), first);
  assert.ok(!k.server.startsWith(dir));
  assert.equal(summaryOf(r), '[kit] Вход с прода: файлов без kit: изменено 1, добавлено 1, удалено 0. ' + MERGED + 'm.php. ' +
    'Не совместилось само — вопрос ниже: a.php.');
  assert.ok(r.out.indexOf(summaryOf(r)) < r.out.findIndex((l) => l.startsWith('  a.php — ')));
  assert.match(last(r), /^вход сделан, кроме этих файлов; спроси пользователя по каждому: Совместить вручную \(.+\) \/ Оставить нашу \(.+\) \/ Взять версию сервера \(.+\)$/);
  const mark = readMark(dir);
  assert.deepEqual(mark.pending, []);
  assert.equal(mark.sessions.s1.result, 'done');
  assert.equal(mark.sessions.s1.commit, head);
  assert.deepEqual(mark.named, []);
  // конфликт называется на каждом входе; совмещённое раньше — нет; одни конфликты — не «совпадает» (Р-37)
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 1, text(again));
  assert.equal(count(dir), 2);
  const k2 = conflictOf(again, 'a.php');
  assert.equal(k2.why, 'правки пересекаются');
  assert.equal(summaryOf(again), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php.');
  assert.doesNotMatch(text(again), /совпадает/);
  assert.equal(read(dir, 'a.php'), 'наша\nl2\nl3\nl4\nl5\n');
  // Р-38: прежняя папка конфликтов этого проекта убрана, осталась одна — новая; пути второго входа ведут на файлы
  const second = path.dirname(path.dirname(k2.server));
  assert.notEqual(second, first);
  assert.ok(!fs.existsSync(first), 'прежняя папка конфликтов убрана: ' + first);
  assert.deepEqual(conflictRoots(dir), [path.basename(second)]);
  assert.equal(fs.readFileSync(k2.server, 'utf8'), 'сервер\nl2\nl3\nl4\nl5\n');
  assert.equal(fs.readFileSync(k2.base, 'utf8'), FIVE);
  // --check при стоящем конфликте (Р-39): код 0, конфликт назван; папок конфликтов --check не создаёт и не убирает
  const checked = await run(dir, { sessionId: 's3', check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместится само — вопрос задаст вход общей сессии: a.php.');
  assert.equal(readMark(dir).sessions.s3.result, 'checked');
  assert.deepEqual(conflictRoots(dir), [path.basename(second)]);
  assert.equal(read(dir, 'a.php'), 'наша\nl2\nl3\nl4\nl5\n');
});

test('удалён без нас при нашей правке, удалён у нас при изменении без нас, двоичный файл — конфликты, не код 4 (Р-35)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'd.php': FIVE, 'g.php': FIVE, 'bin.dat': Buffer.from([0, 1, 2, 10, 3]) });
  writeFiles(dir, { 'd.php': 'наша\nl2\nl3\nl4\nl5\n', 'bin.dat': Buffer.from([0, 1, 2, 10, 4]) });
  fs.rmSync(path.join(dir, 'g.php'));
  fs.rmSync(path.join(server, 'd.php'));
  writeFiles(server, { 'g.php': 'l1\nl2\nсервер\nl4\nl5\n', 'bin.dat': Buffer.from([0, 9, 2, 10, 3]) });
  const before = status(dir);
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.equal(count(dir), 1);
  assert.equal(status(dir), before);
  const d = conflictOf(r, 'd.php');
  assert.equal(d.why, 'изменён у нас, удалён на сервере');
  assert.equal(d.server, null);
  assert.equal(fs.readFileSync(d.base, 'utf8'), FIVE);
  const gg = conflictOf(r, 'g.php');
  assert.equal(gg.why, 'удалён у нас, изменён на сервере');
  assert.equal(gg.ours, 'нет');
  assert.equal(fs.readFileSync(gg.server, 'utf8'), 'l1\nl2\nсервер\nl4\nl5\n');
  assert.ok(!has(dir, 'g.php'));
  const b = conflictOf(r, 'bin.dat');
  assert.equal(b.why, 'двоичный файл');
  assert.deepEqual(fs.readFileSync(b.server), Buffer.from([0, 9, 2, 10, 3]));
  assert.deepEqual(fs.readFileSync(b.base), Buffer.from([0, 1, 2, 10, 3]));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'bin.dat')), Buffer.from([0, 1, 2, 10, 4]));
  assert.equal(readMark(dir).sessions.s1.result, 'done');
  assert.equal(summaryOf(r), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: bin.dat, d.php, g.php.');
});

test('совмещение при CRLF в рабочей копии — результат с CRLF (Р-35)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE });
  writeFiles(dir, { 'a.php': 'L1 наша\r\nl2\r\nl3\r\nl4\r\nl5\r\n' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(read(dir, 'a.php'), 'L1 наша\r\nl2\r\nl3\r\nl4\r\nL5 сервер\r\n');
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + MERGED + 'a.php.');
});

test('рабочая копия отличается от HEAD только \\r — не правка: обычный забор в коммит входа (Р-27)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\nb\n' });
  g(dir, 'config', 'core.autocrlf', 'false');
  writeFiles(dir, { 'a.php': 'a\r\nb\r\n' });
  assert.equal(status(dir), ' M a.php\n');
  writeFiles(server, { 'a.php': 'a2\nb\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'a.php'), 'a2\nb\n');
  assert.equal(status(dir), '');
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 1, добавлено 0, удалено 0.');
});

// ---- File Watchers и предел за вход (48.4) -----------------------------------------------------------------------------

test('Always и .scss среди забираемых — код 1 до скачивания; --watchers-ok — забрано', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'css/s.scss': '$a: 1;\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: true, watchers: [['scss', true], ['less', false]] });
  writeFiles(server, { 'a.php': '2\n', 'css/s.scss': '$a: 2;\n', 'css/n.SCSS': '$n: 1;\n', 'css/x.less': '@x: 1;\n' });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 1, text(r));
  assert.ok(!fetched(log), 'ничего не скачано');
  assert.equal(read(dir, 'css/s.scss'), '$a: 1;\n');
  assert.ok(!has(dir, 'css/n.SCSS'));
  assert.equal(count(dir), 1);
  assert.equal(readMark(dir).sessions.s1, undefined);
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 2 файла: css\/n\.SCSS, css\/s\.scss; пересборка перезапишет результат, PhpStorm \(Always\) зальёт его на сервер/);
  assert.doesNotMatch(text(r), /x\.less|МБ/);
  assert.match(last(r), /^спроси пользователя одним AskUserQuestion: по вотчерам — Забирать \(`prod-entry\.js --watchers-ok`; .+\) \/ Работать без входа \(`prod-entry\.js --skip`\)$/);
  const ok = await run(dir, { watchersOk: true });
  assert.equal(ok.code, 0, text(ok));
  assert.deepEqual(changed(dir), ['A\tcss/n.SCSS', 'A\tcss/x.less', 'M\ta.php', 'M\tcss/s.scss']);
  assert.equal(status(dir), '');
});

test('File Watchers без остановки: без Always, вотчер выключен, своё «наше уже на сервере» .scss (Р-35)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 's.scss': '$a: 1;\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: false, watchers: [['scss', true]] });
  writeFiles(server, { 's.scss': '$a: 2;\n' });
  let r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ts.scss']);

  idea(dir, { always: true, watchers: [['scss', false], ['less', true]] });
  writeFiles(server, { 's.scss': '$a: 3;\n' });
  r = await run(dir, { sessionId: 's2' });
  assert.equal(r.code, 0, text(r));
  assert.equal(read(dir, 's.scss'), '$a: 3;\n');

  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(dir, { 's.scss': '$a: моя;\n' }); // наша правка, залитая автозаливкой
  writeFiles(server, { 's.scss': '$a: моя;\n', 'a.php': '2\n' });
  r = await run(dir, { sessionId: 's3' });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 's.scss'), '$a: моя;\n');
  assert.equal(count(dir), 4);
});

test('больше 50 МБ за вход — код 1 до скачивания; --big-ok — забрано; вместе с File Watchers — одна остановка, флаги вместе', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 's.scss': '$a: 1;\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  const nine = Buffer.alloc(9 * 1024 * 1024); // нули: git сжимает их быстро, secret-scan пропускает двоичное
  writeFiles(server, { 'media/one/x/deep/1.bin': nine, 'media/one/x/deep/2.bin': nine, 'media/one/x/3.bin': nine, 'media/two/4.bin': nine,
    'video/5.bin': nine, '6.bin': nine, 'a.php': '2\n' });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  let r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 1, text(r));
  assert.ok(!fetched(log), 'ничего не скачано');
  assert.ok(!has(dir, '6.bin') && !has(dir, 'media'));
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.equal(readMark(dir).sessions.s1, undefined);
  assert.ok(text(r).includes('Забрать за вход — 54 МБ (больше 50 МБ); самые тяжёлые папки: media/one/x/ — 27 МБ, 6.bin — 9 МБ, media/two/ — 9 МБ, video/ — 9 МБ, a.php — 1 КБ'), text(r));
  assert.doesNotMatch(text(r), /File Watchers/);
  assert.match(last(r), /^спроси пользователя одним AskUserQuestion: по объёму — Забрать всё \(`prod-entry\.js --big-ok`\) \/ Не забирать папки \(.*\.gitignore.*\) \/ Работать без входа \(`prod-entry\.js --skip`\)$/);

  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(server, { 's.scss': '$a: 2;\n' });
  r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 1 файл: s\.scss;/);
  assert.match(text(r), /Забрать за вход — 54 МБ/);
  assert.match(last(r), /по вотчерам — .+; по объёму — .+; оба ответа «забирать» — флаги вместе$/);
  r = await run(dir, { bigOk: true });
  assert.equal(r.code, 1, 'File Watchers без своего флага — всё ещё остановка');
  assert.doesNotMatch(text(r), /МБ/);
  r = await run(dir, { bigOk: true, watchersOk: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\t6.bin', 'A\tmedia/one/x/3.bin', 'A\tmedia/one/x/deep/1.bin', 'A\tmedia/one/x/deep/2.bin', 'A\tmedia/two/4.bin',
    'A\tvideo/5.bin', 'M\ta.php', 'M\ts.scss']);
  assert.equal(fs.statSync(path.join(dir, 'media/two/4.bin')).size, nine.length);
  assert.equal(status(dir), '');
});

test('вотчеры — по тому, что вход запишет (Р-40): совмещаемый исходник — остановка; уже совмещённый и конфликтный — в следующей сессии без остановки', { skip: !SH }, async () => {
  const { dir, server } = site({ 'm.scss': FIVE, 'c.scss': FIVE }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(dir, { 'm.scss': 'M1 наша\nl2\nl3\nl4\nl5\n', 'c.scss': 'наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'm.scss': 'l1\nl2\nl3\nl4\nM5 сервер\n', 'c.scss': 'сервер\nl2\nl3\nl4\nl5\n' });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 1 файл: m\.scss;/, 'конфликтный c.scss вход не запишет — не в счёт');
  assert.equal(read(dir, 'm.scss'), 'M1 наша\nl2\nl3\nl4\nl5\n', 'ничего не записано');
  assert.equal(readMark(dir).sessions.s1, undefined);
  assert.deepEqual(conflictRoots(dir), [], 'до записи — и папки конфликтов нет');
  const ok = await run(dir, { watchersOk: true });
  assert.equal(ok.code, 1, text(ok));
  assert.equal(read(dir, 'm.scss'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n');
  assert.equal(conflictOf(ok, 'c.scss').why, 'правки пересекаются');
  // следующая сессия: m.scss совмещён раньше, c.scss — стоящий конфликт; вход их не пишет — вотчеры не останавливают
  const next = await run(dir, { sessionId: 's2' });
  assert.equal(next.code, 1, text(next));
  assert.doesNotMatch(text(next), /File Watchers/);
  assert.equal(summaryOf(next), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: c.scss.');
  assert.equal(conflictOf(next, 'c.scss').why, 'правки пересекаются');
  assert.equal(readMark(dir).sessions.s2.result, 'done');
});

test('удалённые на сервере, «не забирать» и М-6 не входят ни в объём, ни в вотчеры (Р-41); малый предел (opts.entryLimit) — остановка по объёму', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'gone.scss': '$g: 1;\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(dir, { 'dir.scss/inner.txt': 'i' }); // М-6: у нас папка на месте нового файла сервера
  fs.rmSync(path.join(server, 'gone.scss'));
  const blob = 'x'.repeat(5000);
  writeFiles(server, { 'a.php': '2\n', 'arch.zip': blob, 'dir.scss': blob });
  const r = await run(dir, { entryLimit: 1000 });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['D\tgone.scss', 'M\ta.php']);
  assert.match(last(r), /Не забрано, осталось на сервере: arch\.zip \(архив\), dir\.scss \(у нас на этом месте папка\)\.$/);
  // забираемое больше малого предела — остановка по объёму; вотчеров среди него нет
  writeFiles(server, { 'big.php': blob });
  const big = await run(dir, { sessionId: 's2', entryLimit: 1000 });
  assert.equal(big.code, 1, text(big));
  assert.match(text(big), /Забрать за вход — 5 КБ \(больше 1 КБ\); самые тяжёлые папки: big\.php — 5 КБ$/m);
  assert.doesNotMatch(text(big), /File Watchers/);
  assert.ok(!has(dir, 'big.php'));
});

// ---- Мелкие замечания проверки 48.3 -------------------------------------------------------------------------------------

test('запись мешает локальное (М-6): на месте пути папка, на месте папки файл — не забрано и не совмещено, названо каждый вход', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'c.php': 'c\n' });
  writeFiles(dir, { 'x.php/inner.txt': 'i', 'new': 'файл' });
  fs.rmSync(path.join(dir, 'c.php'));
  writeFiles(dir, { 'c.php/z.txt': 'z' });
  writeFiles(server, { 'x.php': 'x\n', 'new/n.php': 'n\n', 'c.php': 'c2\n', 'a.php': '2\n' });
  const before = status(dir);
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(status(dir), before);
  assert.equal(read(dir, 'new'), 'файл');
  assert.equal(read(dir, 'x.php/inner.txt'), 'i');
  assert.match(last(r), /Не забрано, осталось на сервере: c\.php \(у нас на этом месте папка\), new\/n\.php \(у нас файл new на месте папки\), x\.php \(у нас на этом месте папка\)\.$/);
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.match(last(again), /Не забрано, осталось на сервере: c\.php .+, new\/n\.php .+, x\.php /);
  assert.deepEqual(readMark(dir).named, []);
  // --check при М-6 (Р-39): вход ничего не запишет — код 0, пути названы
  const checked = await run(dir, { sessionId: 's3', check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.match(last(checked), /^\[kit\] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0\. Не забрано, осталось на сервере: c\.php \(у нас на этом месте папка\), new\/n\.php .+, x\.php /);
  assert.equal(readMark(dir).sessions.s3.result, 'checked');
  assert.equal(status(dir), before);
});

test('повтор убирает временные файлы <путь>.*.kit-tmp у путей pending (М-7)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n', 'sub/n.php': 'n\n' });
  writeFiles(dir, { 'a.php.4242.kit-tmp': '2\n', 'sub/n.php.77.kit-tmp': 'n' });
  writeMark(dir, { sessions: {}, named: [], pending: ['a.php', 'sub/n.php'] });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tsub/n.php', 'M\ta.php']);
  assert.ok(!has(dir, 'a.php.4242.kit-tmp'));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sub')), ['n.php']);
  assert.equal(status(dir), '');
});

test('нет папки сайта на сервере — код 2 с подсказкой проверить «SSH прод», без «Повторить» (М-9)', { skip: !SH }, async () => {
  const { dir } = site({ 'a.php': '1\n' }, { params: { 'SSH прод': 'sh:/kit-нет-такой-папки/x' } });
  const r = await run(dir);
  assert.equal(r.code, 2, text(r));
  assert.match(text(r), /на сервере нет папки сайта \/kit-нет-такой-папки\/x/);
  assert.equal(last(r), 'спроси пользователя: Проверить «SSH прод» (/kit:project-init) / Работать без входа (`prod-entry.js --skip`)');
  assert.ok(!has(dir, '.claude/kit-prod.json'));
});

test('отслеживаемый файл в отрезанной папке (М-11): размер из сверки — больше 10 МБ не скачан, назван', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'upload/keep.dat': 'k\n' });
  writeFiles(dir, { '.gitignore': GITIGNORE + '/upload/*\n' });
  commit(dir, '1.1: upload в .gitignore');
  assert.equal(g(dir, 'ls-files', 'upload').trim(), 'upload/keep.dat');
  writeFiles(server, { 'upload/keep.dat': Buffer.alloc(FILE_LIMIT + 1, 120) });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.match(lastSent(log), /-path '\.\/upload\/\*'/, 'папка upload отрезана в find');
  assert.ok(!fetched(log), 'не скачан');
  assert.equal(read(dir, 'upload/keep.dat'), 'k\n');
  assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не забрано, осталось на сервере: upload/keep.dat (больше 10 МБ).');
});

test('окружение «дев» (М-10): «SSH дев», заголовок «Дев: …», строка «Вход с дева»; наложение базы — только коммиты «Дев:»', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' }, { ssh: 'SSH дев', params: { 'Окружение': 'дев', 'Дев': 'https://dev.alpha.example.com' } });
  writeFiles(dir, { 'b.php': 'b прод\n' });
  commit(dir, 'Прод: изменения без kit на 2026-10-01 (1 файл)'); // вход с прода — для дева не база
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.match(text(r), /^Сервер: дев — sh:/m);
  assert.match(text(r), /^База: [0-9a-f]+ \(первый коммит репозитория\)$/m);
  assert.match(subject(dir), /^Дев: изменения без kit на \d{4}-\d{2}-\d{2} \(1 файл\)$/);
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'b.php'), 'b прод\n', 'коммит входа с прода не наложен на базу дева: b.php не откатан');
  assert.equal(last(r), '[kit] Вход с дева: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  const again = await run(dir, { sessionId: 's2' });
  assert.equal(again.code, 0, text(again));
  assert.match(text(again), /\(первый коммит репозитория; поверх — 1 коммит входа\)/);
  assert.equal(last(again), '[kit] Вход с дева: дев совпадает с git.');
});

test('kit-commit.js коды 2 и 3 (М-10) → вход код 4, pending остаётся; повтор доводит вход', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  const hook = (name, cmd) => fs.writeFileSync(path.join(dir, '.git', 'hooks', name), '#!/bin/sh\n' + cmd + '\n', { mode: 0o755 });
  writeFiles(server, { 'a.php': '2\n' });
  hook('pre-commit', 'exit 1');
  let r = await run(dir);
  assert.equal(r.code, 4, text(r));
  assert.match(text(r), /коммит входа не сделан \(kit-commit\.js, код 2\)/);
  assert.deepEqual(readMark(dir).pending, ['a.php']);
  assert.equal(readMark(dir).sessions.s1, undefined);
  assert.equal(count(dir), 1);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  // код 3: коммит есть, самопроверка не сошлась (хук после коммита правит файл)
  hook('post-commit', 'echo x >> a.php');
  r = await run(dir);
  assert.equal(r.code, 4, text(r));
  assert.match(text(r), /коммит входа сделан, но не проверен \(kit-commit\.js, код 3\)/);
  assert.equal(count(dir), 2);
  assert.deepEqual(readMark(dir).pending, ['a.php']);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'post-commit'));
  r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2, 'коммит входа уже есть: повтор вернул a.php к HEAD, забирать нечего');
  assert.equal(read(dir, 'a.php'), '2\n');
  assert.equal(status(dir), '');
  assert.deepEqual(readMark(dir).pending, []);
  assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
});

test('повтор после остановки по секрету (М-10): индекс, оставленный kit-commit.js, очищается; новый файл с секретом убран; совмещённое не откатывается (Р-34)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'cfg.php': '<?php\n', 'a.php': 'a\n', 'm.php': FIVE });
  const secret = `<?php\nreturn ['password' => '${SECRET}'];\n`;
  writeFiles(dir, { 'm.php': 'M1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'cfg.php': secret, 'new.php': secret, 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(g(dir, 'diff', '--cached', '--name-only').trim().split('\n').sort(), ['cfg.php', 'new.php']);
  assert.deepEqual(readMark(dir).pending, ['cfg.php', 'new.php']);
  assert.equal(read(dir, 'm.php'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n', 'совмещённое записано до коммита и не откатано');
  assert.ok(r.out.includes('совмещённое с нашими правками осталось в рабочей копии: m.php'), text(r));
  // на сервере убрали секрет и лишний файл
  writeFiles(server, { 'cfg.php': '<?php\nreturn [];\n' });
  fs.rmSync(path.join(server, 'new.php'));
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.deepEqual(changed(dir), ['M\tcfg.php']);
  assert.equal(read(dir, 'cfg.php'), '<?php\nreturn [];\n');
  assert.ok(!has(dir, 'new.php'));
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '');
  assert.equal(status(dir), ' M m.php\n');
  assert.equal(read(dir, 'm.php'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n');
  assert.equal(last(again), '[kit] Вход с прода: файлов без kit: изменено 1, добавлено 0, удалено 0.', 'совмещённое раньше — не в строке');
});

test('find на сервере прочитал не всё (М-10) — строка об этом, вход сделан', async () => {
  const { dir } = site({ 'a.php': 'a\n' }, { host: 'fixed' });
  const out = listOut({ hashes: [md5('a\n') + ' '], list: [[2, 'a.php']], findCode: 1 });
  await withEnv({ FAKE_SSH_OUT: out }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 0, text(r));
    assert.ok(r.out.includes('find на сервере прочитал не всё — новые файлы в нечитаемых папках не сверены'), text(r));
    assert.equal(last(r), '[kit] Вход с прода: прод совпадает с git.');
  });
});

test('имена, совпадающие без учёта регистра (М-10, Windows): с путём git, между новыми, с нашим неотслеживаемым — недопустимое имя', { skip: process.platform !== 'win32' }, async () => {
  const { dir } = site({ 'a.php': 'a\n' }, { host: 'fixed' });
  writeFiles(dir, { 'u.php': 'наш\n' });
  const out = listOut({ hashes: [md5('a\n') + ' '], list: [[2, 'a.php'], [1, 'A.php'], [1, 'N.php'], [1, 'n.php'], [1, 'U.php']] });
  await withEnv({ FAKE_SSH_OUT: out }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 0, text(r));
    assert.equal(count(dir), 1);
    assert.equal(read(dir, 'u.php'), 'наш\n');
    assert.equal(last(r), '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не забрано, осталось на сервере: ' +
      'A.php (недопустимое имя), N.php (недопустимое имя), U.php (недопустимое имя), n.php (недопустимое имя).');
  });
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
