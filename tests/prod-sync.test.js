'use strict';
// Синхронизация с продом по SSH (шаги 48.3–48.4, 48.6–48.7): prod-sync.js — сверка «сервера» (временная папка через заглушку
// fake-ssh.js, хост sh) с git, забор изменённого без нас, коммит синхронизации через kit-commit.js, отметка .claude/kit-prod.json
// (named и pending); наши незакоммиченные правки и совмещение, File Watchers PhpStorm и предел 50 МБ за раз; отмена --abort,
// файлы с секретом. Сценарии сервера и их разбор — lib/prod-ssh.js, правила без SSH — lib/prod.js. Без SSH (48.8, lib/prod-ftp.js)
// — список корней для скачивания по FTP и разбор скачанного (--ftp-done): «скачанное» тест кладёт прямо в рабочую копию.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ROOT, writeFiles, tmpDir, runScript, findSh, shPath } = require('./helpers');
const { paramsMd, WORK_GITIGNORE, WORK_RULE } = require('./fixtures');
const ps = require('../plugins/kit/scripts/prod-sync');
const { pruneRules, findPrune, listScript, parseList, fetchScript, parseFetch } = require('../plugins/kit/scripts/lib/prod-ssh');
const { ENTRY_RE, FILE_LIMIT, readMark, writeMark, badName } = require('../plugins/kit/scripts/lib/prod');

// Локальный sh с GNU find (-printf), xargs, cut и mktemp — «сервер» для сверки; нет — такие тесты пропускаются.
const SH = (() => {
  const sh = findSh();
  const r = sh && spawnSync(sh, ['-c', "find . -maxdepth 0 -printf '' && command -v xargs && command -v cut && command -v mktemp"], { encoding: 'utf8' });
  return r && r.status === 0 ? sh : null;
})();
// Заглушка ssh и автор коммитов kit-commit.js — для entry() в этом процессе и для дочерних; переменные заглушки разработчика не
// влияют (KIT_SESSION_ID синхронизация с 48.7 не читает — убирается на всякий случай).
Object.assign(process.env, {
  KIT_SSH: path.join(__dirname, 'fake-ssh.js'), FAKE_SH: SH || '',
  GIT_AUTHOR_NAME: 'kit', GIT_AUTHOR_EMAIL: 'kit@test.local', GIT_COMMITTER_NAME: 'kit', GIT_COMMITTER_EMAIL: 'kit@test.local',
});
for (const k of ['KIT_SESSION_ID', 'FAKE_SSH_OUT', 'FAKE_SSH_LOG', 'FAKE_SSH_COUNT', 'FAKE_SSH_DROP']) delete process.env[k];

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'plugins', 'kit', 'skills', 'project-init', 'templates', 'gitignore-bitrix'), 'utf8');
const GITIGNORE = '/.claude/*\n!/.claude/CLAUDE.md\n!/.claude/docs/\n!/.claude/docs/**\n';
// Р-83 (48.11а): «Не выкладывать» без .gitignore — как у проекта после /kit:project-init с ответом «Больше ничего»: .gitignore
// проекта есть в git, на «сервере» его нет, и синхронизация не должна его трогать. С .gitignore в «Не выкладывать» — тесты, где
// параметр задан явно.
const PARAMS = {
  'Режим': 'общий', 'Окружение': 'прод', 'Выкладка': 'вручную', 'Прод': 'https://alpha.example.com',
  'План выкладки': '.claude/docs/deploy-prod.md',
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
// Текст отметки .claude/kit-prod.json как есть (нет файла — null): --check и worktree её не пишут (Р-52).
const markOf = (dir) => (has(dir, '.claude/kit-prod.json') ? read(dir, '.claude/kit-prod.json') : null);
// Пути pending отметки (элементы — { path, md5 }, Р-57).
const pendingOf = (dir) => readMark(dir).pending.map((e) => e.path);
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
// Р-48: каждый вызов синхронизации — entry() здесь и prod-sync.js процессом — проходит через проверку вывода: ни в одной строке
// нет слова «вход». Кроме причины неотправки от kit-commit.js — KIT_COMMIT_LOGIN: там «вход» — вход в Git Credential Manager.
const KIT_COMMIT_LOGIN = 'нет сети, входа или вышло время';
function noEntryWord(lines) {
  const bad = lines.filter((l) => /вход/i.test(String(l).split(KIT_COMMIT_LOGIN).join('')));
  assert.deepEqual(bad, [], 'слово «вход» в выводе синхронизации');
}
const run = async (dir, opts = {}) => {
  const r = await ps.entry(dir, opts);
  noEntryWord(r.out);
  return r;
};
const cli = (opts = {}) => {
  const r = runScript('prod-sync.js', opts);
  noEntryWord((r.stdout + r.stderr).split('\n'));
  return r;
};

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

// .idea PhpStorm: deployment.xml (always — автозаливка Always, excluded — Excluded Paths сервера alpha, пути от корня проекта) и
// watcherTasks.xml (watchers — [[расширение, включён]]).
function idea(dir, { always = false, watchers = [], excluded = [] } = {}) {
  writeFiles(dir, {
    '.idea/deployment.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="PublishConfigData"' +
      (always ? ' autoUpload="Always"' : '') + ' serverName="alpha">\n    <serverData>\n      <paths name="alpha">\n        <serverdata>\n' +
      '          <mappings>\n            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />\n          </mappings>\n' +
      (excluded.length ? '          <excludedPaths>\n' + excluded.map((p) => `            <excludedPath local="true" path="$PROJECT_DIR$/${p}" />\n`).join('') +
        '          </excludedPaths>\n' : '') + '        </serverdata>\n' +
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
// Пути временных файлов конфликта из строки вывода: «  путь — причина; наша — …; сервера — …; база — …». Папку kit-prod-* синхронизация
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

test('parseArgs: --check, --ftp-done, --abort, --watchers-ok, --big-ok, --dirty-ok, --delete-ok, --timeout 1…600 (по умолчанию 100); неизвестное и неверное — исключение; --abort — только с --timeout (Р-53); --ftp-done — без --check (Р-65)', () => {
  const base = { check: false, ftpDone: false, abort: false, watchersOk: false, bigOk: false, dirtyOk: false, deleteOk: false, timeout: 100 };
  assert.deepEqual(ps.parseArgs([]), base);
  assert.deepEqual(ps.parseArgs(['--check', '--watchers-ok', '--big-ok', '--dirty-ok', '--delete-ok', '--timeout', '7']),
    { ...base, check: true, watchersOk: true, bigOk: true, dirtyOk: true, deleteOk: true, timeout: 7 });
  assert.deepEqual(ps.parseArgs(['--ftp-done', '--watchers-ok', '--big-ok']), { ...base, ftpDone: true, watchersOk: true, bigOk: true });
  assert.deepEqual(ps.parseArgs(['--delete-ok']), { ...base, deleteOk: true });
  assert.deepEqual(ps.parseArgs(['--abort']), { ...base, abort: true });
  assert.deepEqual(ps.parseArgs(['--timeout', '5', '--abort']), { ...base, abort: true, timeout: 5 });
  for (const bad of [['--нет'], ['x'], ['--skip'], ['--hook'], ['--timeout'], ['--timeout', '0'], ['--timeout', '601'], ['--timeout', '1.5'], ['--timeout', '-3'],
    ['--abort', '--check'], ['--ftp-done', '--abort'], ['--abort', '--watchers-ok'], ['--big-ok', '--abort'], ['--dirty-ok', '--abort'], ['--abort', '--delete-ok'],
    ['--ftp-done', '--check'], ['--check', '--ftp-done']]) {
    assert.throws(() => ps.parseArgs(bad), bad.join(' '));
  }
});

test('--skip и --hook — код 4 (неизвестный флаг); --abort с --check и др. — код 4; --ftp-done с --check и при заданном «SSH прод» — код 4 (Р-65)', () => {
  const ftp = site({ 'a.php': '1' }, { params: { 'SSH прод': '—' } });
  for (const args of [['--skip'], ['--hook'], ['--check', '--hook']]) {
    const r = cli({ cwd: ftp.dir, args });
    assert.equal(r.code, 4, args.join(' '));
    assert.ok(r.stdout.startsWith('prod-sync: неизвестный аргумент ' + args[args.length - 1]), r.stdout);
    assert.ok(r.stdout.includes('Использование: node prod-sync.js [--check]'), r.stdout);
  }
  for (const args of [['--abort', '--check'], ['--abort', '--ftp-done'], ['--abort', '--watchers-ok'], ['--abort', '--big-ok'], ['--abort', '--dirty-ok'],
    ['--abort', '--delete-ok']]) {
    const r = cli({ cwd: ftp.dir, args });
    assert.equal(r.code, 4, args.join(' '));
    assert.match(r.stdout, /^prod-sync: --abort — только сам или с --timeout/, r.stdout);
  }
  for (const args of [['--ftp-done', '--check'], ['--check', '--ftp-done']]) {
    const r = cli({ cwd: ftp.dir, args });
    assert.equal(r.code, 4, args.join(' '));
    assert.match(r.stdout, /^prod-sync: --ftp-done — без --check/, r.stdout);
  }
  // «SSH прод» задан — синхронизация по SSH: --ftp-done — код 4, к серверу не подключается, ничего не пишет
  const ssh = site({ 'a.php': '1\n' });
  writeFiles(ssh.dir, { 'a.php': '2\n' });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = cli({ cwd: ssh.dir, args: ['--ftp-done'], env: { FAKE_SSH_LOG: log } });
  assert.equal(r.code, 4, r.stdout);
  assert.equal(r.stdout.trim(), 'есть SSH — синхронизация по SSH, без --ftp-done');
  assert.ok(!fs.existsSync(log), 'к серверу не подключались');
  assert.equal(count(ssh.dir), 1);
  assert.ok(!has(ftp.dir, '.claude/kit-prod.json') && !has(ssh.dir, '.claude/kit-prod.json'));
  // «SSH прод» задан, но неверный — тоже «есть SSH» (М-5 проверки 48.8)
  const bad = site({ 'a.php': '1\n' }, { params: { 'SSH прод': 'alpha:~/www' } });
  const rb = cli({ cwd: bad.dir, args: ['--ftp-done'] });
  assert.equal(rb.code, 4, rb.stdout);
  assert.equal(rb.stdout.trim(), 'есть SSH — синхронизация по SSH, без --ftp-done');
  assert.ok(!has(bad.dir, '.claude/kit-prod.json'));
});

test('badName: небезопасный путь — везде; на Windows ещё <>:"|?*, CON/NUL/COM1/LPT1 (и с расширением), точка или пробел в конце части', () => {
  for (const p of ['a.php', "it's файл.php", 'a b/c.php', '[1].php', 'console.php', 'nul1.php']) {
    assert.equal(badName(p, true), false, p);
    assert.equal(badName(p, false), false, p);
  }
  for (const p of ['../x', 'a/../../x', '/etc/x', 'a\nb', 'a\\b.php', '']) assert.equal(badName(p, false), true, JSON.stringify(p));
  for (const p of ['ab:c.php', 'a<b', 'a>b', 'a"b', 'a|b', 'a?.php', 'a*.php', 'con', 'CON.php', 'dir/NUL', 'lpt1.txt.bak', 'com9.x',
    'dir./x.php', 'x.php ', 'папка /x.php']) assert.equal(badName(p, true), true, p);
  assert.equal(badName('ab:c.php', false), false, 'на Linux двоеточие допустимо (кроме «буквы диска» в начале — safePath)');
  assert.equal(badName('a:b.php', false), true);
  assert.equal(badName('con.php', false), false);
  // М-5: пробел в начале или в конце любой части — на всех ОС (самопроверка kit-commit.js обрезает пробелы в именах)
  for (const p of [' x.php', 'x.php ', 'a/ b.php', 'папка /x.php', ' папка/x.php']) {
    assert.equal(badName(p, false), true, JSON.stringify(p));
    assert.equal(badName(p, true), true, JSON.stringify(p));
  }
  assert.equal(badName('x.php.', false), false, 'точка в конце — только Windows');
});

test('pruneRules: .gitignore в папке над P (М-1) — P и её детей не отрезать; P целиком — смотрим до родителя P', () => {
  const own = new Set(['a', 'c']);
  const r = pruneRules('/a/b/*\n/c/d/\n/e/f/\n/g/h/*\n', (p) => own.has(p) || p === 'e/f' || p === 'g');
  assert.ok(!r.some((x) => x.path === 'a/b'), 'a/.gitignore может вернуть детей a/b');
  assert.ok(!r.some((x) => x.path === 'c/d'), 'c/.gitignore может вернуть c/d');
  assert.deepEqual(r.find((x) => x.path === 'e/f'), { path: 'e/f', dir: true }, 'свой e/f/.gitignore git не читает — e/f целиком можно');
  assert.ok(!r.some((x) => x.path === 'g/h'), 'g/.gitignore над g/h');
  assert.deepEqual(pruneRules('/a/b/*\n/c/d/\n').filter((x) => x.path === 'a/b' || x.path === 'c/d'),
    [{ path: 'a/b', children: true, keep: [], names: [] }, { path: 'c/d', dir: true }]);
});

test('pruneRules: шаблон gitignore-bitrix с рабочими папками — дети bitrix/, кроме рабочих, дети upload/, кроме docs; .env.example не отрезается (Р-11)', () => {
  const rules = pruneRules(TEMPLATE + '\n' + WORK_GITIGNORE);
  const by = (p) => rules.filter((r) => r.path === p);
  assert.deepEqual(by('bitrix'), [{ path: 'bitrix', children: true, keep: ['php_interface', 'templates'], names: ['.env.example'] }]);
  assert.deepEqual(by('bitrix/templates'), [{ path: 'bitrix/templates', children: true, keep: ['theme'], names: ['.env.example'] }]);
  assert.deepEqual(by('bitrix/php_interface'), [{ path: 'bitrix/php_interface', children: true, keep: ['init.php'], names: ['.env.example'] }]);
  assert.deepEqual(by('upload'), [{ path: 'upload', children: true, keep: ['docs'], names: ['.env.example'] }]);
  assert.deepEqual(by('kit-exec.php'), [{ path: 'kit-exec.php' }]);
  for (const p of ['.claude', '.superpowers', '.worktrees', 'docs/superpowers']) assert.deepEqual(by(p), [{ path: p }], p);
  assert.deepEqual(rules.filter((r) => r.name).map((r) => r.name), ['.git', '.idea']);
  assert.ok(!rules.some((r) => r.path && (r.path === '.idea' || r.path.startsWith('.claude/'))), '.idea — по имени, .claude — целиком');
  const expr = findPrune(rules);
  assert.ok(expr.includes("\\( -path './bitrix/*' ! -path './bitrix/*/*' ! -path './bitrix/php_interface' ! -path './bitrix/templates' ! -name '.env.example' \\)"), expr);
  assert.ok(expr.includes("-name '.git'") && expr.includes("-path './.claude'"));
  assert.match(expr, /^\\\( .* \\\) -prune$/);
});

test('pruneRules: отрицание со звёздочкой у папки или над ней, «всё внутри», имя папки, [ в непривязанном — не отрезать; не от корня — нет', () => {
  const r1 = pruneRules('/bitrix/*\n!/bitrix/*/components/\n/upload/*\n!*.php\n/cache/\n!/cache/keep/\n');
  assert.ok(!r1.some((r) => r.path === 'bitrix'), 'отрицание со звёздочкой внутри bitrix');
  assert.deepEqual(r1.find((r) => r.path === 'upload'), { path: 'upload', children: true, keep: [], names: ['*.php'] });
  assert.deepEqual(r1.find((r) => r.path === 'cache'), { path: 'cache', dir: true }, 'отрицание внутри исключённой папки git не вернёт');
  const r2 = pruneRules('/a/\n!a\n/b/c/\n!/b/\n/d/*\n!/d/**\n/e\n/f/**\n!/f/g/h.php\n');
  for (const p of ['a', 'b/c', 'd']) assert.ok(!r2.some((r) => r.path === p), p);
  assert.deepEqual(r2.find((r) => r.path === 'e'), { path: 'e' });
  assert.deepEqual(r2.find((r) => r.path === 'f'), { path: 'f', children: true, keep: ['g'], names: ['a'] });
  const r3 = pruneRules('/upload/*\n![ab].txt\n');
  assert.ok(!r3.some((r) => r.path === 'upload'), '[ в непривязанном отрицании — детей не отрезать');
  const r4 = pruneRules('# комментарий\n\n/bitrix\\*/\n/up?/\n bitrix/\nlocal/\nsrc/cache/\n/../x/\n');
  assert.deepEqual(r4.filter((r) => r.path && !['.claude', '.superpowers', '.worktrees', 'docs/superpowers'].includes(r.path)), []);
});

test('pruneRules: свой P/.gitignore в рабочей копии — детей P не отрезать; P целиком — можно (git его не читает) (Р-25)', () => {
  const own = new Set(['upload', 'cache']);
  const r = pruneRules('/upload/*\n/bitrix/*\n/cache/\n', (p) => own.has(p));
  assert.ok(!r.some((x) => x.path === 'upload'), 'upload/.gitignore может вернуть детей upload');
  assert.deepEqual(r.find((x) => x.path === 'bitrix'), { path: 'bitrix', children: true, keep: [], names: [] });
  assert.deepEqual(r.find((x) => x.path === 'cache'), { path: 'cache', dir: true });
  assert.deepEqual(pruneRules('/upload/*\n').find((x) => x.path === 'upload'), { path: 'upload', children: true, keep: [], names: [] });
});

test('listScript: пути — только через shq; md5 пачкой (xargs -0 md5sum), не по процессу на файл; временное — mktemp -d; find с отрезанием', () => {
  const s = listScript('/srv/site', ["a b/it's.php", '-x.php'], pruneRules('/bitrix/*\n'));
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
  const h = listScript('/srv/site', ['a.php'], null);
  assert.doesNotMatch(h, /-prune/);
  assert.match(h, /xargs -0 md5sum/);
  // Р-86: вызовы k — на верхнем уровне, каждый своей строкой, между exec 3> и exec 3>&-: группа «{ …; } 3>» растила бы глубину
  // стека bash с числом файлов
  const lines = s.split('\n');
  const open = lines.indexOf('exec 3> "$T/z"');
  const close = lines.indexOf('exec 3>&-');
  assert.ok(open > 0 && close === open + 3, s);
  assert.deepEqual(lines.slice(open + 1, close), ["k 1 'a b/it'\\''s.php'", "k 2 '-x.php'"]);
  assert.ok(!lines.some((l) => /^\{|^\} 3>/.test(l)), 'без группы команд');
});

test('parseList: состояния, хеши по порядку (и с «\\» в начале), список find с размерами и переводом строки в имени; обрыв, лишний хеш, KIT_ERR', () => {
  const tracked = ['a.php', 'b.php', 'c.php', 'd.php', 'e.php'];
  const out = listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a') + ' ', '\\' + md5('c') + ' '], sizes: [1, 20971520], list: [[1, 'a.php'], [3, "new/it's\nфайл.php"]], findCode: 1 });
  const r = parseList(out, tracked);
  assert.equal(r.err, null);
  assert.equal(r.bad, null);
  assert.deepEqual(Object.fromEntries(r.state), { 'a.php': 'file', 'b.php': 'unreadable', 'c.php': 'file', 'd.php': 'notfile', 'e.php': 'absent' });
  assert.deepEqual(Object.fromEntries(r.md5), { 'a.php': md5('a'), 'c.php': md5('c') });
  assert.deepEqual(Object.fromEntries(r.sizes), { 'a.php': 1, 'c.php': 20971520 }, 'М-11: размеры отслеживаемых — по порядку, как хеши');
  assert.deepEqual([...r.files], [['a.php', 1], ["new/it's\nфайл.php", 3]]);
  assert.equal(r.findFailed, true);
  assert.match(parseList(out.replace('KIT_END', ''), tracked).bad, /оборван/);
  assert.match(parseList(listOut({ hashes: [md5('a')] }), tracked).bad, /хеш/);
  assert.match(parseList(listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a'), md5('c')], sizes: [1] }), tracked).bad, /размер/);
  assert.match(parseList(listOut({ states: { 2: 'U', 4: 'O', 5: 'N' }, hashes: [md5('a'), md5('c')], sizes: [1, 'x'] }), tracked).bad, /размер/);
  assert.match(parseList(listOut({ states: { 9: 'U' } }), tracked).bad, /9/);
  assert.equal(parseList('KIT_ERR на сервере нет md5sum\n', tracked).err, 'на сервере нет md5sum');
});

test('fetchScript и parseFetch: base64 между метками по номерам; не прочитан — в failed; нет метки конца — обрыв', () => {
  const s = fetchScript('/srv/site', ["it's файл.php"]);
  assert.match(s, /^cd '\/srv\/site' \|\|/);
  assert.ok(s.includes("g 1 'it'\\''s файл.php'"), s);
  const b64 = Buffer.from([0, 13, 10, 255]).toString('base64');
  const r = parseFetch(`KIT_F 1\n${b64}\nKIT_FE 1\nKIT_F 2\nKIT_FX 2\nKIT_END\n`, ['a', 'b']);
  assert.equal(r.bad, null);
  assert.deepEqual(r.data.get('a'), Buffer.from([0, 13, 10, 255]));
  assert.deepEqual([...r.failed], ['b']);
  assert.match(parseFetch('KIT_F 1\nYWJj\n', ['a']).bad, /оборван/);
  assert.match(parseFetch('KIT_F 1\nYWJj\nKIT_FE 1\nKIT_END\n', ['a', 'b']).bad, /b/);
  assert.equal(parseFetch('KIT_ERR нет папки сайта\n', ['a']).err, 'нет папки сайта');
});

test('listScript на локальном sh: есть, нет, папка, нет родителя, имя с «-» — состояния и md5 как есть; сценарий ничего не пишет в папку сайта', { skip: !SH }, () => {
  const server = writeFiles(tmpDir('kit-prod-srv-'), { 'a.php': 'a\r\n', '-x.php': 'x', 'd/f.txt': 'f', 'n/it\'s файл.php': 'ф' });
  const tracked = ['-x.php', 'a.php', 'd', 'gone.php', 'n/it\'s файл.php', 'no/dir/x.php'];
  const before = fs.readdirSync(server).sort();
  const r = spawnSync(SH, ['-s'], { input: listScript(shPath(server), tracked, pruneRules('')), encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  const list = parseList(r.stdout, tracked);
  assert.equal(list.bad, null, r.stdout + r.stderr);
  assert.deepEqual(Object.fromEntries(list.state), { '-x.php': 'file', 'a.php': 'file', 'd': 'notfile', 'gone.php': 'absent', "n/it's файл.php": 'file', 'no/dir/x.php': 'absent' });
  assert.equal(list.md5.get('a.php'), md5('a\r\n'));
  assert.equal(list.md5.get("n/it's файл.php"), md5('ф'));
  assert.deepEqual(Object.fromEntries(list.sizes), { '-x.php': 1, 'a.php': 3, "n/it's файл.php": Buffer.byteLength('ф') });
  assert.equal(list.files.get('d/f.txt'), 1);
  assert.equal(list.files.get("n/it's файл.php"), Buffer.byteLength('ф'));
  assert.deepEqual(fs.readdirSync(server).sort(), before);
});

// Р-86 (В-3): bash выполнял группу «{ …; } 3>» рекурсивно — на Windows (стек 2 МБ) 4000 файлов роняли сценарий сверки. Важно
// число вызовов k, а не содержимое: одно содержимое (один blob) и имена без расширения — иначе на Windows половину времени теста
// съедают первое чтение свежих .php и запись 5000 объектов git (с .php и разным содержимым — около 50 с вместо 10).
test('Р-86: 5000 отслеживаемых файлов — сценарий сверки проходит на локальном sh, «прод совпадает с git»', { skip: !SH }, async () => {
  const files = {};
  for (let i = 0; i < 5000; i++) files[`d${i % 50}/${i}`] = 'x\n';
  const { dir } = site(files);
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(count(dir), 1);
});

// ---- Синхронизация по SSH ----------------------------------------------------------------------------------------------

test('изменён, добавлен, удалён без нас → один коммит синхронизации с ENTRY_RE, строка с тремя числами, отметка — pending пуст', { skip: !SH }, async () => {
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
  assert.match(last(r), /^\[kit\] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 1\.$/);
  const head = g(dir, 'rev-parse', 'HEAD').trim();
  assert.equal(r.commit, head);
  assert.match(text(r), /^Сервер: прод — sh:/m);
  assert.match(text(r), /^База: [0-9a-f]{7,} \(первый коммит репозитория\)$/m);
  assert.match(text(r), new RegExp('^Коммит синхронизации: ' + head.slice(0, 7) + '[0-9a-f]* \\(3 файла\\)$', 'm'));
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
});

test('ничего не поменялось → коммита нет, «прод совпадает с git», отметка — named и pending', { skip: !SH }, async () => {
  const { dir } = site({ 'a.php': 'a\n', 'папка/b.php': 'b\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(r.commit, undefined);
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  assert.equal(status(dir), '');
});

test('отметка: после синхронизации в kit-prod.json только named и pending; старый файл с sessions читается и переписывается без них', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n', 'old.zip': 'PK' });
  // файл первой редакции: записи сессий, названное раньше (с сервера уже исчезло)
  writeFiles(dir, { '.claude/kit-prod.json': JSON.stringify({ sessions: { s1: { at: new Date().toISOString(), result: 'need' } }, named: ['gone.zip'], pending: [] }) });
  assert.deepEqual(readMark(dir), { named: ['gone.zip'], pending: [] });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.match(last(r), /Не забрано, осталось на сервере: old\.zip \(архив\)\.$/);
  assert.doesNotMatch(text(r), /отметка|хук/);
  assert.deepEqual(JSON.parse(markOf(dir)), { named: ['old.zip'], pending: [] });
});

test('закоммиченный, но не залитый шаг (база — заливка до него) — не откатан, коммита синхронизации нет', { skip: !SH }, async () => {
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
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
});

test('незалитый шаг не откатывается второй синхронизацией: база — заливка, поверх — пути своих коммитов синхронизации; заливка после синхронизации — база для всех путей (Р-24)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': '2 наш шаг\n' });
  commit(dir, '1.1: правка a.php'); // закоммичено, не залито (выкладка вручную)
  writeFiles(server, { 'b.php': 'b клиент\n' });
  const r1 = await run(dir);
  assert.equal(r1.code, 0, text(r1));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  const r2 = await run(dir);
  assert.equal(r2.code, 0, text(r2));
  assert.equal(count(dir), 3, 'второго коммита синхронизации нет');
  assert.equal(read(dir, 'a.php'), '2 наш шаг\n');
  assert.match(text(r2), /^База: [0-9a-f]+ \(первый коммит репозитория; поверх — 1 коммит синхронизации\)$/m);
  assert.equal(last(r2), '[kit] Синхронизация с продом: прод совпадает с git.');

  // шаг 1.2 после коммита синхронизации залит — база для всех путей: заливка, наложения нет
  writeFiles(dir, { 'c.php': 'c\n' });
  const s12 = commit(dir, '1.2: новый c.php');
  writeFiles(server, { 'a.php': '2 наш шаг\n', 'c.php': 'c\n' });
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.2', s12.slice(0, 9)]]) });
  commit(dir, '1.2а: план выкладки');
  const r3 = await run(dir);
  assert.equal(r3.code, 0, text(r3));
  assert.match(text(r3), /^База: [0-9a-f]+ \(«Залито на прод» в \.claude\/docs\/deploy-prod\.md\)$/m);
  assert.equal(last(r3), '[kit] Синхронизация с продом: прод совпадает с git.');
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

test('архив и файл больше 10 МБ — не забраны и названы; вторая синхронизация их не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\n' });
  writeFiles(server, { 'backup.zip': 'PK', 'files/big.dat': Buffer.alloc(FILE_LIMIT + 1, 120), 'ok.php': 'ok\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tok.php']);
  assert.ok(!has(dir, 'backup.zip') && !has(dir, 'files/big.dat'));
  assert.match(last(r), /Не забрано, осталось на сервере: backup\.zip \(архив\), files\/big\.dat \(больше 10 МБ\)\./);
  assert.deepEqual(readMark(dir).named, ['backup.zip', 'files/big.dat']);
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.deepEqual(readMark(dir).named, ['backup.zip', 'files/big.dat']);
});

test('CRLF на сервере, LF в git — не изменение; смешанные переводы строк, равные HEAD без \\r, — не изменение (через скачивание)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': 'a\nb\n', 'm.php': 'x\ny\nz\n', 'bin.dat': Buffer.from([0, 10, 1]) });
  writeFiles(server, { 'a.php': 'a\r\nb\r\n', 'm.php': 'x\r\ny\nz\r\n', 'bin.dat': Buffer.from([0, 13, 10, 1]) });
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
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

test('нечитаемый файл на сервере — не удалён, не забран, назван (каждый раз); ссылка вместо файла — «не файл» (готовый ответ сервера)', async () => {
  const { dir } = site({ 'a.php': 'a\n', 'b.php': 'b\n', 'c.php': 'c\n' }, { host: 'fixed' });
  const out = listOut({ states: { 2: 'U', 3: 'O' }, hashes: [md5('a\n') + ' '], list: [[2, 'a.php']] });
  await withEnv({ FAKE_SSH_OUT: out }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 0, text(r));
    assert.equal(count(dir), 1);
    assert.equal(read(dir, 'b.php'), 'b\n');
    assert.equal(read(dir, 'c.php'), 'c\n');
    assert.match(last(r), /Не забрано, осталось на сервере: b\.php \(не читается\), c\.php \(не файл\)\./);
    const again = await run(dir);
    assert.match(last(again), /b\.php \(не читается\), c\.php \(не файл\)/);
  });
});

test('каталог (и ссылка, где её можно создать) вместо файла — не забираются, синхронизация не падает', { skip: !SH }, async () => {
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
  assert.equal(last(r0), 'спроси пользователя: Повторить / Отложить');
  assert.ok(!has(down.dir, '.claude/kit-prod.json'));

  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' }, { host: 'shdrop' });
  writeFiles(server, { 'a.php': '2\n', 'n.php': 'n\n' });
  await withEnv({ FAKE_SSH_COUNT: path.join(tmpDir('kit-prod-cnt-'), 'n'), FAKE_SSH_DROP: '2' }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 3, text(r));
    assert.match(text(r), /closed by remote host/);
    assert.equal(read(dir, 'a.php'), '1\n');
    assert.ok(!has(dir, 'n.php'));
    assert.ok(!has(dir, '.claude/kit-prod.json'), 'отметка не записана');
    assert.equal(count(dir), 1);
    const again = await run(dir);
    assert.equal(again.code, 0, text(again));
    assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php']);
  });
});

test('повтор (ревью 5): pending, часть файлов записана → один коммит со всеми; файл, который сервер вернул к базе, — равен HEAD, не в коммите', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n', 'c.php': 'c\n' });
  writeFiles(server, { 'a.php': '2\n', 'b.php': 'b2\n', 'n.php': 'n\n' }); // c.php на сервере вернули к базе
  // прошлая синхронизация оборвалась после записи: a.php и n.php записаны, c.php — прежней версией сервера
  writeFiles(dir, { 'a.php': '2\n', 'n.php': 'n\n', 'c.php': 'c старая версия сервера\n' });
  writeMark(dir, { named: [], pending: ['a.php', 'b.php', 'c.php', 'n.php'] });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php', 'M\tb.php']);
  assert.equal(read(dir, 'c.php'), 'c\n');
  assert.equal(status(dir), '');
  assert.deepEqual(pendingOf(dir), []);
});

test('--check и worktree: только сверка — есть что забрать — код 1, ничего не записано; забирать нечего — код 0; отметку не пишут (Р-52)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir, { check: true });
  assert.equal(r.code, 1, text(r));
  assert.match(r.out[r.out.length - 2], /изменено 1/);
  // М-5 (48.11а): в основной папке — «запусти синхронизацию», а не «синхронизация в основной папке» (это она и есть)
  assert.equal(last(r), 'есть изменения без kit — запусти синхронизацию: /kit:sync');
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
    assert.match(last(w), /синхронизация в основной папке проекта \(.*kit-prod-[^)]*\)$/);
    assert.ok(last(w).includes(path.basename(dir)), last(w));
    assert.equal(read(wt, 'a.php'), '1\n');
    assert.equal(status(wt), '');
    assert.ok(!has(wt, '.claude/kit-prod.json'));
  }

  writeFiles(server, { 'a.php': '1\r\n' }); // CRLF — не изменение
  const ok = await run(dir, { check: true });
  assert.equal(ok.code, 0, text(ok));
  assert.equal(last(ok), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.ok(!has(dir, '.claude/kit-prod.json'), '--check отметку не пишет');
  const okWt = await run(outside);
  assert.equal(okWt.code, 0, text(okWt));
  assert.ok(!has(outside, '.claude/kit-prod.json') && !has(dir, '.claude/kit-prod.json'), 'worktree отметку не пишет');
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
  const r = await run(outside);
  assert.equal(r.code, 0, text(r));
  assert.ok(r.out.some((l) => l.startsWith('Сверка — по основной папке проекта: ') && l.includes(path.basename(dir))), text(r));
  assert.match(text(r), /База: [0-9a-f]+ \(«Залито на прод» в \.claude\/docs\/deploy-prod\.md\)/);
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.ok(!has(outside, '.claude/kit-prod.json') && !has(dir, '.claude/kit-prod.json'), 'отметку не пишет ни в одной папке (Р-52)');
  assert.equal(read(outside, 'a.php'), '1\n');
  // основная папка — не kit-проект: сверяется своя, как в 48.3 (на старой ветке залитый шаг — «изменение без нас»)
  fs.renameSync(path.join(dir, '.claude', 'CLAUDE.md'), path.join(dir, '.claude', 'CLAUDE.off'));
  const own = await run(outside);
  fs.renameSync(path.join(dir, '.claude', 'CLAUDE.off'), path.join(dir, '.claude', 'CLAUDE.md'));
  assert.equal(own.code, 1, text(own));
  assert.doesNotMatch(text(own), /основной папке проекта:/);
  assert.match(last(own), /^есть изменения без kit — синхронизация в основной папке проекта/);
});

test('«Прод: —» и не kit-проект — код 2, файлов не пишет; «SSH прод» неверный — код 2; без SSH — код 1, список для FTP (48.8); не git — код 4; аргументы — код 4', () => {
  const plain = tmpDir('kit-prod-');
  g(plain, 'init', '-q');
  writeFiles(plain, { 'a.php': '1' });
  commit(plain, 'исходники');
  let r = cli({ cwd: plain });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /синхронизировать не с чем: не kit-проект/);
  assert.ok(!has(plain, '.claude'));

  const none = site({ 'a.php': '1' }, { params: { 'Прод': '—', 'SSH прод': '—' } });
  r = cli({ cwd: path.join(none.dir, '.claude') });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /синхронизировать не с чем: сервер не задан/);
  assert.ok(!has(none.dir, '.claude/kit-prod.json'));

  const bad = site({ 'a.php': '1' }, { params: { 'SSH прод': 'alpha:~/www' } });
  r = cli({ cwd: bad.dir });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /параметр «SSH прод» неверный: alpha:~\/www — нужно хост:\/абсолютная\/папка/);
  assert.match(r.stdout, /\/kit:project-init.*Повторить \/ Отложить/);

  const ftp = site({ 'a.php': '1' }, { params: { 'SSH прод': '—' } });
  r = cli({ cwd: ftp.dir });
  assert.equal(r.code, 1, r.stdout);
  assert.equal(r.stdout.trim().split('\n').pop(), 'спроси пользователя: Скачал (`prod-sync.js --ftp-done`) / Не буду скачивать');
  assert.ok(!has(ftp.dir, '.claude/kit-prod.json'));

  const nogit = writeFiles(tmpDir('kit-prod-'), { '.claude/CLAUDE.md': paramsMd({ ...PARAMS, 'SSH прод': 'sh:/srv/site' }), 'a.php': '1' });
  r = cli({ cwd: nogit });
  assert.equal(r.code, 4, r.stdout);
  assert.ok(!has(nogit, '.claude/kit-prod.json'));
  // М-9: последняя строка — что делать Claude, а не состояние
  assert.match(r.stdout, /синхронизация не сделана: в репозитории нет коммитов или это не git/);
  assert.match(r.stdout.trim().split('\n').pop(), /^скажи пользователю: .*\/kit:project-init.*Отложить$/);

  for (const args of [['--нет'], ['--timeout', '0']]) {
    r = cli({ cwd: ftp.dir, args });
    assert.equal(r.code, 4, args.join(' '));
    assert.ok(r.stdout.startsWith('prod-sync: ') && r.stdout.includes('Использование: node prod-sync.js [--check]'), r.stdout);
  }
});

// ---- Наши правки и совмещение (48.4) -----------------------------------------------------------------------------------
const FIVE = 'l1\nl2\nl3\nl4\nl5\n';
const MERGED = 'Совмещено с нашими незакоммиченными правками — проверьте в панели изменений: ';
const summaryOf = (r) => r.out.find((l) => l.startsWith('[kit] '));

test('незакоммиченная правка уже на сервере — не тронута, в строке и коммите синхронизации её нет', { skip: !SH }, async () => {
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
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  assert.doesNotMatch(lastSent(log), /'a\.php'|'c\.php'/, 'наше на сервере не скачивается');
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(count(dir), 2);
  // --check (Р-28): своё на сервере — не «есть что забрать»
  const m0 = markOf(dir);
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(markOf(dir), m0, '--check отметку не пишет');
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
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 1, удалено 0.');
  assert.doesNotMatch(lastSent(log), /mine|win/, 'своё не скачивается');
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
});

test('незакоммиченная правка и изменение без нас — совмещено в рабочей копии, в коммите синхронизации пути нет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n' });
  // a.php.999.kit-tmp — временный файл записи после обрыва прошлой синхронизации (М-3 проверки 48.4: убирается и у совмещаемых)
  writeFiles(dir, { 'a.php': 'L1 наша\nl2\nl3\nl4\nl5\n', 'a.php.999.kit-tmp': 'остаток' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n', 'b.php': 'b2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'L1 наша\nl2\nl3\nl4\nL5 сервер\n');
  assert.equal(g(dir, 'show', 'HEAD:a.php'), FIVE, 'в git — прежняя версия');
  assert.equal(status(dir), ' M a.php\n');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' + MERGED + 'a.php.');
  const m0 = markOf(dir);
  assert.deepEqual(JSON.parse(m0), { named: [], pending: [] });
  // --check после совмещения (Р-39): синхронизация ничего не запишет — код 0
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(markOf(dir), m0, '--check отметку не пишет');
  assert.equal(status(dir), ' M a.php\n');
});

test('merge закоммиченного незалитого с изменением без нас — совмещено, коммит синхронизации без этого пути; повторная синхронизация ничего не пишет и не называет', { skip: !SH }, async () => {
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
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
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

test('конфликт совмещения — код 1, рабочая копия не тронута, версия сервера — во временном файле; остальное — коммитом синхронизации, pending пуст; повторная синхронизация — одни конфликты (Р-37), прежняя папка конфликтов убрана (Р-38)', { skip: !SH }, async () => {
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
  assert.equal(summaryOf(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 0. ' + MERGED + 'm.php. ' +
    'Не совместилось само — вопрос ниже: a.php.');
  assert.ok(r.out.indexOf(summaryOf(r)) < r.out.findIndex((l) => l.startsWith('  a.php — ')));
  assert.match(last(r), /^синхронизация сделана, кроме этих файлов; спроси пользователя по каждому: Совместить вручную \(.+\) \/ Оставить нашу \(.+\) \/ Взять версию сервера \(.+\)$/);
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  // конфликт называется при каждой синхронизации; совмещённое раньше — нет; одни конфликты — не «совпадает» (Р-37)
  const again = await run(dir);
  assert.equal(again.code, 1, text(again));
  assert.equal(count(dir), 2);
  const k2 = conflictOf(again, 'a.php');
  assert.equal(k2.why, 'правки пересекаются');
  assert.equal(summaryOf(again), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php.');
  assert.doesNotMatch(text(again), /совпадает/);
  assert.equal(read(dir, 'a.php'), 'наша\nl2\nl3\nl4\nl5\n');
  // Р-38: прежняя папка конфликтов этого проекта убрана, осталась одна — новая; пути второй синхронизации ведут на файлы
  const second = path.dirname(path.dirname(k2.server));
  assert.notEqual(second, first);
  assert.ok(!fs.existsSync(first), 'прежняя папка конфликтов убрана: ' + first);
  assert.deepEqual(conflictRoots(dir), [path.basename(second)]);
  assert.equal(fs.readFileSync(k2.server, 'utf8'), 'сервер\nl2\nl3\nl4\nl5\n');
  assert.equal(fs.readFileSync(k2.base, 'utf8'), FIVE);
  // --check при стоящем конфликте (Р-39): код 0, конфликт назван; папок конфликтов --check не создаёт и не убирает
  const m0 = markOf(dir);
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместится само — вопрос задаст синхронизация в основной папке: a.php.');
  assert.equal(markOf(dir), m0, '--check отметку не пишет');
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
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  assert.equal(summaryOf(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: bin.dat, d.php, g.php.');
});

test('совмещение при CRLF в рабочей копии — результат с CRLF (Р-35)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE });
  writeFiles(dir, { 'a.php': 'L1 наша\r\nl2\r\nl3\r\nl4\r\nl5\r\n' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(read(dir, 'a.php'), 'L1 наша\r\nl2\r\nl3\r\nl4\r\nL5 сервер\r\n');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + MERGED + 'a.php.');
});

test('рабочая копия отличается от HEAD только \\r — не правка: обычный забор в коммит синхронизации (Р-27)', { skip: !SH }, async () => {
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
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
});

// ---- File Watchers и предел за раз (48.4) ------------------------------------------------------------------------------

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
  assert.equal(markOf(dir), null, 'отметка не записана');
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 2 файла: css\/n\.SCSS, css\/s\.scss; пересборка перезапишет результат, PhpStorm \(Always\) зальёт его на сервер/);
  assert.doesNotMatch(text(r), /x\.less|МБ/);
  assert.match(last(r), /^спроси пользователя одним AskUserQuestion: по вотчерам — Забирать \(`prod-sync\.js --watchers-ok`; .+\) \/ Отложить$/);
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
  r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(read(dir, 's.scss'), '$a: 3;\n');

  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(dir, { 's.scss': '$a: моя;\n' }); // наша правка, залитая автозаливкой
  writeFiles(server, { 's.scss': '$a: моя;\n', 'a.php': '2\n' });
  r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 's.scss'), '$a: моя;\n');
  assert.equal(count(dir), 4);
});

test('больше 50 МБ за раз — код 1 до скачивания; --big-ok — забрано; вместе с File Watchers — одна остановка, флаги вместе', { skip: !SH }, async () => {
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
  assert.equal(markOf(dir), null, 'отметка не записана');
  assert.ok(text(r).includes('Забрать за одну синхронизацию — 54 МБ (больше 50 МБ); самые тяжёлые папки: media/one/x/ — 27 МБ, 6.bin — 9 МБ, media/two/ — 9 МБ, video/ — 9 МБ, a.php — 1 КБ'), text(r));
  assert.doesNotMatch(text(r), /File Watchers/);
  assert.match(last(r), /^спроси пользователя одним AskUserQuestion: по объёму — Забрать всё \(`prod-sync\.js --big-ok`\) \/ Не забирать папки \(.*\.gitignore.*\) \/ Отложить$/);

  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(server, { 's.scss': '$a: 2;\n' });
  r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 1 файл: s\.scss;/);
  assert.match(text(r), /Забрать за одну синхронизацию — 54 МБ/);
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

test('вотчеры — по тому, что синхронизация запишет (Р-40): совмещаемый исходник — остановка; уже совмещённый и конфликтный — в следующей сессии без остановки', { skip: !SH }, async () => {
  const { dir, server } = site({ 'm.scss': FIVE, 'c.scss': FIVE }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: true, watchers: [['scss', true]] });
  writeFiles(dir, { 'm.scss': 'M1 наша\nl2\nl3\nl4\nl5\n', 'c.scss': 'наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'm.scss': 'l1\nl2\nl3\nl4\nM5 сервер\n', 'c.scss': 'сервер\nl2\nl3\nl4\nl5\n' });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /File Watchers PhpStorm \(scss\) — среди забираемого 1 файл: m\.scss;/, 'конфликтный c.scss синхронизация не запишет — не в счёт');
  assert.equal(read(dir, 'm.scss'), 'M1 наша\nl2\nl3\nl4\nl5\n', 'ничего не записано');
  assert.equal(markOf(dir), null, 'отметка не записана');
  assert.deepEqual(conflictRoots(dir), [], 'до записи — и папки конфликтов нет');
  const ok = await run(dir, { watchersOk: true });
  assert.equal(ok.code, 1, text(ok));
  assert.equal(read(dir, 'm.scss'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n');
  assert.equal(conflictOf(ok, 'c.scss').why, 'правки пересекаются');
  // следующая сессия: m.scss совмещён раньше, c.scss — стоящий конфликт; синхронизация их не пишет — вотчеры не останавливают
  const next = await run(dir);
  assert.equal(next.code, 1, text(next));
  assert.doesNotMatch(text(next), /File Watchers/);
  assert.equal(summaryOf(next), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: c.scss.');
  assert.equal(conflictOf(next, 'c.scss').why, 'правки пересекаются');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
});

test('удалённые на сервере, «не забирать» и М-6 не считаются ни в объёме, ни в вотчерах (Р-41); малый предел (opts.entryLimit) — остановка по объёму', { skip: !SH }, async () => {
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
  const big = await run(dir, { entryLimit: 1000 });
  assert.equal(big.code, 1, text(big));
  assert.match(text(big), /Забрать за одну синхронизацию — 5 КБ \(больше 1 КБ\); самые тяжёлые папки: big\.php — 5 КБ$/m);
  assert.doesNotMatch(text(big), /File Watchers/);
  assert.ok(!has(dir, 'big.php'));
});

// ---- Мелкие замечания проверки 48.3 -------------------------------------------------------------------------------------

test('запись мешает локальное (М-6): на месте пути папка, на месте папки файл — не забрано и не совмещено, названо каждый раз', { skip: !SH }, async () => {
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
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.match(last(again), /Не забрано, осталось на сервере: c\.php .+, new\/n\.php .+, x\.php /);
  assert.deepEqual(readMark(dir).named, []);
  // --check при М-6 (Р-39): синхронизация ничего не запишет — код 0, пути названы
  const m0 = markOf(dir);
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.match(last(checked), /^\[kit\] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0\. Не забрано, осталось на сервере: c\.php \(у нас на этом месте папка\), new\/n\.php .+, x\.php /);
  assert.equal(markOf(dir), m0, '--check отметку не пишет');
  assert.equal(status(dir), before);
});

test('повтор убирает временные файлы <путь>.*.kit-tmp у путей pending (М-7)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n', 'sub/n.php': 'n\n' });
  writeFiles(dir, { 'a.php.4242.kit-tmp': '2\n', 'sub/n.php.77.kit-tmp': 'n' });
  writeMark(dir, { named: [], pending: ['a.php', 'sub/n.php'] });
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
  assert.equal(last(r), 'спроси пользователя: Проверить «SSH прод» (/kit:project-init) / Отложить');
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
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не забрано, осталось на сервере: upload/keep.dat (больше 10 МБ).');
});

test('окружение «дев» (М-10): «SSH дев», заголовок «Дев: …», строка «Синхронизация с девом»; наложение базы — только коммиты «Дев:»', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' }, { ssh: 'SSH дев', params: { 'Окружение': 'дев', 'Дев': 'https://dev.alpha.example.com' } });
  writeFiles(dir, { 'b.php': 'b прод\n' });
  commit(dir, 'Прод: изменения без kit на 2026-10-01 (1 файл)'); // синхронизация с продом — для дева не база
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.match(text(r), /^Сервер: дев — sh:/m);
  assert.match(text(r), /^База: [0-9a-f]+ \(первый коммит репозитория\)$/m);
  assert.match(subject(dir), /^Дев: изменения без kit на \d{4}-\d{2}-\d{2} \(1 файл\)$/);
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'b.php'), 'b прод\n', 'коммит синхронизации с прода не наложен на базу дева: b.php не откатан');
  assert.equal(last(r), '[kit] Синхронизация с девом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.match(text(again), /\(первый коммит репозитория; поверх — 1 коммит синхронизации\)/);
  assert.equal(last(again), '[kit] Синхронизация с девом: дев совпадает с git.');
});

// Хук git в проекте теста: name — pre-commit, post-commit; cmd — команда sh.
const hook = (dir, name, cmd) => fs.writeFileSync(path.join(dir, '.git', 'hooks', name), '#!/bin/sh\n' + cmd + '\n', { mode: 0o755 });
// Остановка после записи (Р-51): последняя строка — вопрос с отменой.
const AGAIN = 'спроси пользователя: Повторить / Отменить (`prod-sync.js --abort`)';

test('kit-commit.js коды 2 и 3 (М-10, Р-51) → код 1, pending остаётся, «Повторить / Отменить»; при коде 3 — историю не чинить; повтор доводит синхронизацию', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n' });
  hook(dir, 'pre-commit', 'exit 1');
  let r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /коммит синхронизации не сделан \(kit-commit\.js, код 2\)/);
  assert.equal(last(r), AGAIN);
  assert.deepEqual(pendingOf(dir), ['a.php']);
  assert.equal(count(dir), 1);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  // код 3: коммит есть, самопроверка не сошлась (хук после коммита правит файл)
  hook(dir, 'post-commit', 'echo x >> a.php');
  r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /коммит синхронизации сделан, но не проверен \(kit-commit\.js, код 3\) — историю не чинить/);
  assert.equal(last(r), AGAIN);
  assert.equal(count(dir), 2);
  assert.deepEqual(pendingOf(dir), ['a.php']);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'post-commit'));
  // хук дописал a.php после записи: на диске не то, что записала синхронизация, и не HEAD — повтор его не трогает (Р-57)
  r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2, 'коммит синхронизации уже есть: забирать нечего');
  assert.equal(read(dir, 'a.php'), '2\nx\n');
  assert.equal(status(dir), ' M a.php\n');
  assert.ok(text(r).includes('a.php (изменён после остановки синхронизации — не тронут)'), text(r));
  assert.deepEqual(pendingOf(dir), []);
  assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
});

test('повтор после остановки kit-commit.js (М-10): индекс, оставленный kit-commit.js, очищается; новый файл убран; совмещённое не откатывается (Р-34)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'cfg.php': '<?php\n', 'a.php': 'a\n', 'm.php': FIVE });
  writeFiles(dir, { 'm.php': 'M1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'cfg.php': '<?php\nreturn [1];\n', 'new.php': 'n\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN);
  assert.deepEqual(g(dir, 'diff', '--cached', '--name-only').trim().split('\n').sort(), ['cfg.php', 'new.php']);
  assert.deepEqual(pendingOf(dir), ['cfg.php', 'new.php']);
  assert.equal(read(dir, 'm.php'), 'M1 наша\nl2\nl3\nl4\nM5 сервер\n', 'совмещённое записано до коммита и не откатано');
  assert.ok(r.out.includes('совмещённое с нашими правками осталось в рабочей копии: m.php'), text(r));
  // хук убран; на сервере cfg.php поправили ещё раз, лишний файл убрали
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
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
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.', 'совмещённое раньше — не в строке');
});

test('find на сервере прочитал не всё (М-10) — строка об этом, синхронизация сделана', async () => {
  const { dir } = site({ 'a.php': 'a\n' }, { host: 'fixed' });
  const out = listOut({ hashes: [md5('a\n') + ' '], list: [[2, 'a.php']], findCode: 1 });
  await withEnv({ FAKE_SSH_OUT: out }, async () => {
    const r = await run(dir);
    assert.equal(r.code, 0, text(r));
    assert.ok(r.out.includes('find на сервере прочитал не всё — новые файлы в нечитаемых папках не сверены'), text(r));
    assert.equal(last(r), '[kit] Синхронизация с продом: прод совпадает с git.');
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
    assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не забрано, осталось на сервере: ' +
      'A.php (недопустимое имя), N.php (недопустимое имя), U.php (недопустимое имя), n.php (недопустимое имя).');
  });
});

test('много путей: маленький argLimit → несколько коммитов синхронизации подряд, у каждого ENTRY_RE, вместе — все пути', { skip: !SH }, async () => {
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
  assert.equal((text(r).match(/^Коммит синхронизации: /gm) || []).length, 3);
  assert.equal(status(dir), '');
  assert.equal(r.commit, g(dir, 'rev-parse', 'HEAD').trim(), 'r.commit — последний коммит синхронизации');
  assert.deepEqual(pendingOf(dir), []);
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(count(dir), 4, 'у каждого пути версия базы — из своего коммита синхронизации: забирать нечего');
  assert.match(text(again), /поверх — 3 коммита синхронизации/);
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
});

test('запрещённый к коммиту новый файл (local/.settings.php) — не забран, назван; вторая синхронизация его не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'local/.settings.php': '<?php return [];\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.ok(!has(dir, 'local/.settings.php'));
  assert.match(last(r), /local\/\.settings\.php \(запрещён к коммиту\)/);
  const again = await run(dir);
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
});

test('git status --porcelain после синхронизации — как до неё: незакоммиченная правка другого файла цела и не в коммите', { skip: !SH }, async () => {
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

test('«Удалённый репозиторий»: голый репозиторий как origin — после синхронизации коммит там', { skip: !SH }, async () => {
  const bare = tmpDir('kit-prod-bare-');
  g(bare, 'init', '-q', '--bare');
  const { dir, server } = site({ 'a.php': '1\n' }, { params: { 'Удалённый репозиторий': 'origin' } });
  g(dir, 'remote', 'add', 'origin', bare);
  writeFiles(server, { 'a.php': '2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  const branch = g(dir, 'symbolic-ref', '--short', 'HEAD').trim();
  assert.equal(g(bare, 'rev-parse', branch).trim(), g(dir, 'rev-parse', 'HEAD').trim());

  // удалённый недоступен — коммит синхронизации есть, синхронизация сделана, строка «не отправлен» (kit-commit.js, код 4)
  g(dir, 'remote', 'set-url', 'origin', path.join(tmpDir('kit-prod-'), 'нет такого'));
  g(dir, 'update-ref', '-d', 'refs/remotes/origin/' + branch);
  writeFiles(server, { 'a.php': '3\n' });
  const r2 = await run(dir);
  assert.equal(r2.code, 0, text(r2));
  assert.match(text(r2), /^коммит синхронизации не отправлен: .+/m);
  assert.equal(read(dir, 'a.php'), '3\n');
  assert.deepEqual(pendingOf(dir), []);
  assert.match(last(r2), /изменено 1/);
});

test('--timeout 1 и зависший хост — код 3 «вышло время»', async () => {
  const { dir } = site({ 'a.php': '1\n' }, { host: 'hang' });
  const r = await run(dir, { timeoutMs: 1000 });
  assert.equal(r.code, 3, text(r));
  assert.match(text(r), /вышло время \(1 с\)/);
  assert.match(last(r), /Повторить \/ Отложить$/);
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

test('main: вывод в stdout, последняя строка — итог; KIT_SESSION_ID не влияет, строк об отметке сессии нет (48.7)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n' });
  const r = cli({ cwd: dir, env: { KIT_SESSION_ID: 'cli-1' } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout.trim().split('\n').pop(), /изменено 1, добавлено 0, удалено 0\.$/);
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  const quiet = cli({ cwd: dir, env: { KIT_SESSION_ID: '' } });
  assert.equal(quiet.code, 0, quiet.stdout);
  assert.doesNotMatch(quiet.stdout, /отметка|хук/);
  assert.match(quiet.stdout.trim().split('\n').pop(), /совпадает с git/);
  // --abort из командной строки: к серверу не подключается, с --timeout — можно (Р-53)
  const ab = cli({ cwd: dir, args: ['--abort', '--timeout', '5'] });
  assert.equal(ab.code, 0, ab.stdout);
  assert.equal(ab.stdout.trim(), '[kit] Отменять нечего: незаконченной синхронизации нет');
});

// ---- Отмена, файлы с секретом, запись совмещённого (48.7) --------------------------------------------------------------
const NOTHING = '[kit] Отменять нечего: незаконченной синхронизации нет';
const SECRET_WHY = 'секрет — заливка нашей правки этого файла затрёт серверную';
const secretPhp = () => `<?php\nreturn ['password' => '${SECRET}'];\n`;

test('--abort после остановки kit-commit.js: записанное синхронизацией — к HEAD, pending пуст; наша правка и совмещённое целы', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'm.php': FIVE, 'x.php': 'x\n' });
  writeFiles(dir, { 'm.php': 'M1 наша\nl2\nl3\nl4\nl5\n', 'x.php': 'моя\n' });
  writeFiles(server, { 'a.php': '2\n', 'n.php': 'n\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN);
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php', md5: md5('2\n') }, { path: 'n.php', md5: md5('n\n') }], 'md5 записанного (Р-57)');
  assert.equal(read(dir, 'a.php'), '2\n');
  assert.ok(has(dir, 'n.php'));
  const merged = 'M1 наша\nl2\nl3\nl4\nM5 сервер\n';
  assert.equal(read(dir, 'm.php'), merged);
  writeFiles(dir, { 'a.php.4242.kit-tmp': 'остаток' }); // временный файл записи после обрыва (М-7) — отмена убирает и его
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const a = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir, { abort: true }));
  assert.equal(a.code, 0, text(a));
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращено 2 файла']);
  assert.ok(!fs.existsSync(log), 'к серверу не подключались');
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.ok(!has(dir, 'n.php') && !has(dir, 'a.php.4242.kit-tmp'));
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '', 'индекс, оставленный kit-commit.js, очищен');
  assert.equal(status(dir), ' M m.php\n M x.php\n');
  assert.equal(read(dir, 'm.php'), merged, 'совмещённое не тронуто');
  assert.equal(read(dir, 'x.php'), 'моя\n', 'наша правка не тронута');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  assert.equal(count(dir), 1);
  // повторная отмена — отменять нечего; один путь — «возвращён 1 файл»; named отмена не трогает
  assert.deepEqual((await run(dir, { abort: true })).out, [NOTHING]);
  writeMark(dir, { named: ['old.zip'], pending: ['a.php'] });
  writeFiles(dir, { 'a.php': '2\n' });
  const one = await run(dir, { abort: true });
  assert.equal(one.code, 0, text(one));
  assert.deepEqual(one.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл']);
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.deepEqual(readMark(dir), { named: ['old.zip'], pending: [] });
});

test('--abort без pending — «отменять нечего», код 0, рабочая копия и git не меняются; в worktree — тоже, основная папка не тронута (Р-53)', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(dir, { 'a.php': 'моя\n', 'new.php': 'n\n' });
  writeFiles(server, { 'a.php': '2\n' });
  const before = status(dir);
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const r = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir, { abort: true }));
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(r.out, [NOTHING]);
  assert.ok(!fs.existsSync(log), 'к серверу не подключались');
  assert.equal(status(dir), before);
  assert.equal(read(dir, 'a.php'), 'моя\n');
  assert.equal(markOf(dir), null, 'отметка не создана');
  assert.equal(count(dir), 1);
  // pending пуст в файле — то же, файл не переписывается
  writeMark(dir, { named: ['x.zip'], pending: [] });
  const m0 = markOf(dir);
  assert.deepEqual((await run(dir, { abort: true })).out, [NOTHING]);
  assert.equal(markOf(dir), m0);
  // worktree: отменять нечего, хотя у основной папки pending есть; ни основная папка, ни worktree не тронуты
  const wt = path.join(tmpDir('kit-prod-wt-'), 'w');
  g(dir, 'worktree', 'add', '-q', '-b', 'w', wt);
  writeMark(dir, { named: [], pending: ['a.php'] });
  const m1 = markOf(dir);
  const w = await withEnv({ FAKE_SSH_LOG: log }, () => run(wt, { abort: true }));
  assert.equal(w.code, 0, text(w));
  assert.deepEqual(w.out, [NOTHING]);
  assert.ok(!fs.existsSync(log), 'к серверу не подключались');
  assert.equal(read(dir, 'a.php'), 'моя\n');
  assert.equal(markOf(dir), m1);
  assert.equal(status(wt), '');
  assert.equal(markOf(wt), null);
});

test('код 3 — «Повторить / Отложить»; строка с секретом из HEAD повторена на сервере в другом месте — файл не забран, назван, остальное забрано (Р-59: не стоп kit-commit.js)', { skip: !SH }, async () => {
  const down = site({ 'a.php': '1\n' }, { host: 'down' });
  const r0 = await run(down.dir);
  assert.equal(r0.code, 3, text(r0));
  assert.equal(last(r0), 'спроси пользователя: Повторить / Отложить');
  assert.equal(markOf(down.dir), null);

  // строка с паролем уже была в HEAD, на сервере её повторили: дифф (как у kit-commit.js) видит её добавленной — секрет
  const line = `$a = ['password' => '${SECRET}'];`;
  const { dir, server } = site({ 'cfg.php': `<?php\n${line}\n`, 'b.php': 'b\n' });
  writeFiles(server, { 'cfg.php': `<?php\n${line}\n// копия\n${line}\n`, 'b.php': 'b2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'cfg.php'), `<?php\n${line}\n`);
  assert.equal(status(dir), '');
  assert.doesNotMatch(text(r), /kit-commit: стоп/);
  assert.ok(!text(r).includes(SECRET), 'значение секрета не в выводе');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. Не забрано, осталось на сервере: cfg.php (' +
    SECRET_WHY + ').');
  assert.deepEqual(readMark(dir), { named: ['cfg.php'], pending: [] });
});

test('секрет в скачанном: файл не записан и не в коммите, остальное забрано, причина «секрет»; второй запуск его не называет', { skip: !SH }, async () => {
  const { dir, server } = site({ 'cfg.php': '<?php\n', 'a.php': 'a\n' }, { params: { 'Секреты': 'ZZTEST-' } });
  writeFiles(server, { 'cfg.php': secretPhp(), 'new.php': secretPhp(), 'k.php': "<?php $k = 'ZZTEST-777';\n", 'a.php': 'a2\n' });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(body(dir), 'изменён: a.php');
  assert.equal(read(dir, 'cfg.php'), '<?php\n');
  assert.ok(!has(dir, 'new.php') && !has(dir, 'k.php'), 'файлы с секретом не записаны');
  assert.equal(status(dir), '');
  assert.ok(!text(r).includes(SECRET) && !text(r).includes('ZZTEST-777'), 'значений в выводе нет');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. Не забрано, осталось на сервере: ' +
    ['cfg.php', 'k.php', 'new.php'].map((p) => p + ' (' + SECRET_WHY + ')').join(', ') + '.');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: ['cfg.php', 'k.php', 'new.php'], pending: [] });
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.deepEqual(readMark(dir).named, ['cfg.php', 'k.php', 'new.php']);
  // --check: названные файлы с секретом скачиваются и снова не в счёт — «есть что забрать» нет
  const m0 = markOf(dir);
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 0, text(checked));
  assert.equal(last(checked), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(markOf(dir), m0);
  // секрет на сервере убрали — файл забирается, из named уходит
  writeFiles(server, { 'cfg.php': '<?php\nreturn [];\n' });
  const fixed = await run(dir);
  assert.equal(fixed.code, 0, text(fixed));
  assert.deepEqual(changed(dir), ['M\tcfg.php']);
  assert.deepEqual(readMark(dir).named, ['k.php', 'new.php']);
});

test('секрет в версии сервера совмещаемого файла — не совмещён, назван; строка, уже бывшая в HEAD, секретом не считается', { skip: !SH }, async () => {
  const head = `<?php\n$a = ['password' => '${SECRET}'];\nl3\nl4\nl5\nl6\nl7\n`;
  const { dir, server } = site({ 'm.php': head, 's.php': FIVE });
  writeFiles(dir, { 'm.php': head.replace('l7', 'L7 наша'), 's.php': 'L1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'm.php': head.replace('l3', 'L3 сервер'), 's.php': 'l1\nl2\nl3\nl4\n' + "return ['password' => '" + SECRET + "'];\n" });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 1);
  assert.equal(read(dir, 'm.php'), head.replace('l3', 'L3 сервер').replace('l7', 'L7 наша'), 'строка из HEAD — не секрет: совмещено');
  assert.equal(read(dir, 's.php'), 'L1 наша\nl2\nl3\nl4\nl5\n', 'с секретом — не совмещён');
  assert.ok(!text(r).includes(SECRET));
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + MERGED + 'm.php. ' +
    'Не забрано, осталось на сервере: s.php (' + SECRET_WHY + ').');
  assert.deepEqual(conflictRoots(dir), [], 'версия сервера с секретом во временную папку не пишется');
  assert.deepEqual(readMark(dir).named, ['s.php']);
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(read(dir, 's.php'), 'L1 наша\nl2\nl3\nl4\nl5\n');
});

test('файл изменён между чтением и записью совмещённого — не перезаписан, назван', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n' });
  writeFiles(dir, { 'a.php': 'L1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n', 'b.php': 'b2\n' });
  // пользователь сохранил a.php, пока скачивался забор (b.php): совмещено было с прежней «нашей»
  const touch = JSON.stringify({ match: "^g [0-9]+ 'b[.]php'$", file: path.join(dir, 'a.php'), text: 'L1 новее\nl2\nl3\nl4\nl5\n' });
  const r = await withEnv({ FAKE_SSH_TOUCH: touch }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'L1 новее\nl2\nl3\nl4\nl5\n', 'правка пользователя не затёрта');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' +
    'Не забрано, осталось на сервере: a.php (изменён во время синхронизации — повтори).');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] }, 'называется каждый раз — не в named');
  // повтор совмещает с новой «нашей»
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(read(dir, 'a.php'), 'L1 новее\nl2\nl3\nl4\nL5 сервер\n');
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + MERGED + 'a.php.');
});

// ---- Раунд 1 проверки 48.7: правка после остановки, гонка забора, части коммита, сбои записи ---------------------------
const UNTOUCHED = (p) => p + ' (изменён после остановки синхронизации — не тронут)';

test('Р-57: правка файла из pending после остановки — --abort её не трогает и называет; остальное — к HEAD, индекс чист', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' });
  writeFiles(server, { 'a.php': '2\n', 'b.php': 'b2\n', 'n.php': 'n\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(pendingOf(dir), ['a.php', 'b.php', 'n.php']);
  // после остановки доработали забранное: изменённый a.php и новый n.php
  writeFiles(dir, { 'a.php': '2 и моя\n', 'n.php': 'n и моя\n' });
  const a = await run(dir, { abort: true });
  assert.equal(a.code, 0, text(a));
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл; ' + UNTOUCHED('a.php') + ', ' + UNTOUCHED('n.php')]);
  assert.equal(read(dir, 'a.php'), '2 и моя\n');
  assert.equal(read(dir, 'n.php'), 'n и моя\n');
  assert.equal(read(dir, 'b.php'), 'b\n');
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '', 'поставленное kit-commit.js в индекс снято и у нетронутых');
  assert.equal(status(dir), ' M a.php\n?? n.php\n');
  assert.deepEqual(pendingOf(dir), []);
});

test('Р-57: правка файла из pending после остановки — повтор её не трогает, называет и сверяет как нашу правку', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': FIVE, 'b.php': 'b\n' });
  writeFiles(server, { 'a.php': 'l1\nl2\nl3\nl4\nL5 сервер\n', 'b.php': 'b2\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(pendingOf(dir), ['a.php', 'b.php']);
  writeFiles(dir, { 'a.php': 'L1 моя\nl2\nl3\nl4\nL5 сервер\n' }); // доработали забранную версию сервера
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'a.php'), 'L1 моя\nl2\nl3\nl4\nL5 сервер\n', 'правка цела: совмещение с сервером дало её же');
  assert.equal(status(dir), ' M a.php\n');
  assert.ok(text(again).includes(UNTOUCHED('a.php')), text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  assert.deepEqual(pendingOf(dir), []);
});

test('Р-58: файл забора изменён во время скачивания — не записан и не в коммите, назван; остальное забрано', { skip: !SH }, async () => {
  const { dir, server } = site({ 'b.php': 'b\n', 'c.php': 'c\n', 'd.php': 'd\n' });
  writeFiles(server, { 'b.php': 'b2\n', 'c.php': 'c2\n' });
  fs.rmSync(path.join(server, 'd.php'));
  // пока скачивается забор, пользователь сохранил b.php (изменён на сервере) и d.php (удалён на сервере)
  const when = "^g [0-9]+ 'b[.]php'$";
  const touch = JSON.stringify([{ match: when, file: path.join(dir, 'b.php'), text: 'b моя\n' }, { match: when, file: path.join(dir, 'd.php'), text: 'd моя\n' }]);
  const r = await withEnv({ FAKE_SSH_TOUCH: touch }, () => run(dir));
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\tc.php']);
  assert.equal(read(dir, 'b.php'), 'b моя\n', 'правка не затёрта');
  assert.equal(read(dir, 'd.php'), 'd моя\n', 'файл с правкой не удалён');
  assert.equal(status(dir), ' M b.php\n M d.php\n');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' +
    'Не забрано, осталось на сервере: b.php (изменён во время синхронизации — повтори), d.php (изменён во время синхронизации — повтори).');
  assert.deepEqual(readMark(dir), { named: [], pending: [] });
});

test('М-1: упал не первый коммит синхронизации — закоммиченные части уходят из pending, --abort возвращает только остальное', { skip: !SH }, async () => {
  const names = ['f1.php', 'f2.php', 'f3.php'];
  const { dir, server } = site(Object.fromEntries(names.map((n) => [n, '1\n'])));
  writeFiles(server, Object.fromEntries(names.map((n) => [n, '2\n'])));
  hook(dir, 'pre-commit', 'if [ -f .git/kit-once ]; then exit 1; fi; touch .git/kit-once'); // первый коммит проходит, второй — нет
  const r = await run(dir, { argLimit: 20 });
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN);
  assert.equal(count(dir), 2);
  assert.deepEqual(changed(dir), ['M\tf1.php', 'M\tf2.php']);
  assert.deepEqual(pendingOf(dir), ['f3.php']);
  const a = await run(dir, { abort: true });
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл']);
  assert.equal(read(dir, 'f3.php'), '1\n');
  assert.equal(read(dir, 'f1.php'), '2\n');
  assert.equal(status(dir), '');
});

test('М-3: исключение после начала записи — код 1, «Повторить / Отменить», pending остаётся; повтор доводит синхронизацию', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n' });
  writeFiles(server, { 'a.php': '2\n', 'n.php': 'n\n' });
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith(path.sep + 'n.php')) throw Object.assign(new Error('тест: сбой диска'), { code: 'EIO' });
    return rename(from, to);
  };
  let r;
  try {
    r = await run(dir);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /синхронизация остановилась после записи: записано частично: a\.php; не записано: n\.php/);
  assert.equal(last(r), AGAIN);
  assert.deepEqual(pendingOf(dir), ['a.php', 'n.php']);
  assert.equal(read(dir, 'a.php'), '2\n');
  assert.ok(!has(dir, 'n.php'));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.kit-tmp')), []);
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php']);
  assert.doesNotMatch(text(again), /изменён после остановки/, 'не записанный n.php — не «правка после остановки»');
  assert.equal(status(dir), '');
});

test('М-3, М-2: md5 записанного не сошёлся — код 1; у забора — «Повторить / Отменить», у одного совмещённого (pending пуст) — «Повторить / Отложить»', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'm.php': FIVE });
  writeFiles(server, { 'a.php': '2\n' });
  const rename = fs.renameSync;
  // после переименования файл name тут же переписал кто-то другой
  const spoiled = async (name) => {
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (String(to).endsWith(path.sep + name)) fs.writeFileSync(to, 'чужое\n');
    };
    try {
      return await run(dir);
    } finally {
      fs.renameSync = rename;
    }
  };
  const r = await spoiled('a.php');
  assert.equal(r.code, 1, text(r));
  assert.ok(text(r).includes('записано не то, что скачано (md5 не совпал): a.php'), text(r));
  assert.equal(last(r), AGAIN);
  assert.deepEqual(pendingOf(dir), ['a.php']);
  assert.equal(count(dir), 1);
  // отмена: на диске не то, что записала синхронизация, и не HEAD — не тронут (Р-57)
  const a = await run(dir, { abort: true });
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращено 0 файлов; ' + UNTOUCHED('a.php')]);
  assert.equal(read(dir, 'a.php'), 'чужое\n');

  // только совмещённое: pending пуст — отменять нечего
  writeFiles(dir, { 'a.php': '1\n', 'm.php': 'M1 наша\nl2\nl3\nl4\nl5\n' });
  writeFiles(server, { 'a.php': '1\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  const m = await spoiled('m.php');
  assert.equal(m.code, 1, text(m));
  assert.ok(text(m).includes('записано не то, что совмещено (md5 не совпал): m.php'), text(m));
  assert.equal(last(m), 'спроси пользователя: Повторить / Отложить');
  assert.deepEqual(pendingOf(dir), []);
});

// ---- Без SSH: FTP (48.8) -----------------------------------------------------------------------------------------------
// Адрес сервера задан («Прод»), «SSH прод» пуст. Сервер не нужен: «скачанное по FTP» тест кладёт прямо в рабочую копию.
const ftpSite = (files, opts = {}) => site(files, { ...opts, params: { 'SSH прод': '—', ...(opts.params || {}) } }).dir;
const FTP_NOTE = ' Удалённые на сервере файлы и новые вне перечисленных папок по FTP не видны.';
const SAME_FTP = '[kit] Синхронизация с продом: прод совпадает с git.' + FTP_NOTE;
const FTP_SERVER = 'Сервер: прод — https://alpha.example.com (без SSH — по FTP)';
const DOWNLOADED = 'спроси пользователя: Скачал (`prod-sync.js --ftp-done`) / Не буду скачивать';
const DIRTY_ASK = 'спроси пользователя: Скачаю всё равно (`prod-sync.js --dirty-ok`) / Отложить';
const AGAIN_FTP = 'спроси пользователя: Повторить (`prod-sync.js --ftp-done`) / Отменить (`prod-sync.js --abort`)';
const ROOTS_HEAD = (n) => `Скачай с сервера по FTP — в папку проекта, с заменой файлов (${n}):`;
const DIRTY_HEAD = (n) => `В рабочей копии незакоммиченные правки файлов сайта (${n}):`;
const DIRTY_WHY = 'скачивание затрёт незакоммиченные правки, а правки файлов, которые скачивание не перезапишет, уйдут в коммит синхронизации как ' +
  'изменения сервера';
const PHPSTORM = (from) => `В PhpStorm: выдели эти папки и файлы в дереве проекта → Tools → Deployment → ${from}. Удалённые на сервере файлы и новые ` +
  'вне перечисленных папок так не видны.';
const ALWAYS_OFF = 'на время синхронизации выключи автозаливку PhpStorm (Tools → Deployment → Automatic Upload): иначе возврат файлов из HEAD ' +
  'уйдёт на сервер';
const LOCAL = 'Не забрано, лежит в рабочей копии, в git не идёт — удали сам, если не нужен: ';
// Р-85: отмена после разбора скачанного новый файл (его нет в HEAD) не удаляет — его положило скачивание, а не синхронизация.
const LEFT_NEW = (p) => p + ' (новый файл оставлен в рабочей копии — удали сам, если не нужен)';

test('без SSH: код 1, список корней для FTP и подсказка PhpStorm; правки файлов сайта в рабочей копии — сначала предупреждение', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'local/x.php': 'x\n', 'local/sub/y.php': 'y\n', 'bitrix/templates/t.php': 't\n' },
    { gitignore: GITIGNORE + '/.idea/\n/bitrix/*\n!/bitrix/templates/\n' });
  idea(dir);
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  // корни (Р-69): bitrix/ исключён .gitignore, кроме bitrix/templates/, — корень bitrix/templates/; .gitignore (вне синхронизации
  // всегда, Р-83) и .claude — не сайт
  assert.deepEqual(r.out, [FTP_SERVER, ROOTS_HEAD(3), '  a.php', '  bitrix/templates/', '  local/', PHPSTORM('Download from alpha'), DOWNLOADED]);
  assert.equal(markOf(dir), null, 'ничего не пишет');
  assert.equal(status(dir), '');
  // --check без SSH — как обычный запуск (Р-65)
  const checked = await run(dir, { check: true });
  assert.equal(checked.code, 1, text(checked));
  assert.deepEqual(checked.out, r.out);
  // нет .idea/deployment.xml — «с сервера автозаливки»
  fs.rmSync(path.join(dir, '.idea'), { recursive: true });
  assert.ok((await run(dir)).out.includes(PHPSTORM('Download from… — с сервера автозаливки')));

  // правки файлов сайта (Р-60): изменён, удалён, новый; отличие только в \r, игнорируемое и не сайт — не правки
  writeFiles(dir, { 'a.php': '2\n', 'n.php': 'n\n', 'local/sub/y.php': 'y\r\n', '.idea/x.xml': '<x/>', '.claude/docs/n.md': 'n' });
  fs.rmSync(path.join(dir, 'local', 'x.php'));
  const before = status(dir);
  const d = await run(dir);
  assert.equal(d.code, 1, text(d));
  assert.deepEqual(d.out, [FTP_SERVER, DIRTY_HEAD(3), '  a.php', '  local/x.php', '  n.php', DIRTY_WHY, DIRTY_ASK]);
  assert.equal(status(dir), before);
  assert.equal(markOf(dir), null);
  // «Скачаю всё равно» — список корней несмотря на правки; из командной строки — флаг --dirty-ok
  const ok = await run(dir, { dirtyOk: true });
  assert.equal(ok.code, 1, text(ok));
  assert.deepEqual(ok.out, [FTP_SERVER, ROOTS_HEAD(3), '  a.php', '  bitrix/templates/', '  local/', PHPSTORM('Download from… — с сервера автозаливки'), DOWNLOADED]);
  const viaCli = cli({ cwd: dir, args: ['--dirty-ok'] });
  assert.equal(viaCli.code, 1, viaCli.stdout);
  assert.equal(viaCli.stdout.trim().split('\n').pop(), DOWNLOADED);
  assert.equal(status(dir), before);
});

test('без SSH: корни — все, по одному в строке, без «и ещё N» (Р-73); правок больше 30 — первые 30 и «и ещё N»', async () => {
  const names = Array.from({ length: 36 }, (_, i) => `d${String(i).padStart(2, '0')}`);
  const dir = ftpSite(Object.fromEntries(names.map((d) => [d + '/f.php', 'f\n'])));
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.equal(r.out[1], ROOTS_HEAD(36));
  assert.deepEqual(r.out.slice(2, 38), names.map((d) => '  ' + d + '/'), 'все 36 корней');
  assert.ok(!r.out.some((l) => /и ещё/.test(l)), text(r));
  assert.equal(last(r), DOWNLOADED);
  writeFiles(dir, Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`n${String(i).padStart(2, '0')}.php`, 'n\n'])));
  const d = await run(dir);
  assert.equal(d.code, 1, text(d));
  assert.equal(d.out[1], DIRTY_HEAD(32));
  assert.equal(d.out[31], '  n29.php');
  assert.equal(d.out[32], '  и ещё 2');
  assert.equal(last(d), DIRTY_ASK);
});

test('--ftp-done: изменённое и добавленное без нас — в коммите синхронизации; наше незалитое, вернувшееся к базе, — восстановлено из HEAD', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'b.php': 'b\n', 'c.php': 'c\n', 'd.php': 'd\n' });
  writeFiles(dir, { 'b.php': 'b наш шаг\n', 'd.php': 'd наш шаг\n' });
  commit(dir, '1.1: правка b.php и d.php'); // не залито: база — первый коммит
  // скачано: a.php изменён без нас, new/n.php добавлен, b.php — версия базы поверх нашего незалитого, d.php — наш шаг уже на
  // сервере (скачанное = HEAD); c.php удалён на сервере — по FTP этого не видно (локальный файл остался)
  writeFiles(dir, { 'a.php': '2\n', 'new/n.php': 'n\n', 'b.php': 'b\n', 'd.php': 'd наш шаг\n' });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 3);
  assert.match(subject(dir), ENTRY_RE);
  assert.match(subject(dir), /^Прод: изменения без kit на \d{4}-\d{2}-\d{2} \(2 файла\)$/);
  assert.equal(body(dir), 'изменён: a.php\nдобавлен: new/n.php');
  assert.deepEqual(changed(dir), ['A\tnew/n.php', 'M\ta.php']);
  assert.equal(read(dir, 'b.php'), 'b наш шаг\n', 'наше незалитое — из HEAD');
  assert.equal(read(dir, 'c.php'), 'c\n');
  assert.equal(status(dir), '');
  assert.equal(r.out[0], FTP_SERVER);
  assert.match(r.out[1], /^База: [0-9a-f]{7,} \(первый коммит репозитория\)$/);
  assert.ok(r.out.includes('Восстановлено из HEAD — скачанное вернуло к базе наше незалитое: b.php'), text(r));
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 0.' + FTP_NOTE);
  assert.equal(r.commit, g(dir, 'rev-parse', 'HEAD').trim());
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  // повтор без нового скачивания — забирать нечего; из командной строки — то же
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.equal(count(dir), 3);
  assert.equal(last(again), SAME_FTP);
  const c = cli({ cwd: dir, args: ['--ftp-done'] });
  assert.equal(c.code, 0, c.stdout);
  assert.equal(c.stdout.trim().split('\n').pop(), SAME_FTP);
});

test('--ftp-done: менялось и у нас, и на сервере — совмещено в рабочую копию, в коммите нет; конфликт — рабочая копия = HEAD, версия сервера во временной папке, код 1', async () => {
  const dir = ftpSite({ 'm.php': FIVE, 'k.php': FIVE, 'b.php': 'b\n' });
  const mine = { 'm.php': 'M1 наш шаг\nl2\nl3\nl4\nl5\n', 'k.php': 'наш шаг\nl2\nl3\nl4\nl5\n' };
  writeFiles(dir, mine);
  commit(dir, '1.1: правки m.php и k.php'); // не залито
  writeFiles(dir, { 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n', 'k.php': 'сервер\nl2\nl3\nl4\nl5\n', 'b.php': 'b2\n' });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 1, text(r));
  assert.equal(count(dir), 3);
  assert.deepEqual(changed(dir), ['M\tb.php']);
  assert.equal(read(dir, 'm.php'), 'M1 наш шаг\nl2\nl3\nl4\nM5 сервер\n', 'наша — HEAD, их — скачанное');
  assert.equal(g(dir, 'show', 'HEAD:m.php'), mine['m.php'], 'совмещённое — не в коммите');
  assert.equal(read(dir, 'k.php'), mine['k.php'], 'конфликт — рабочая копия = HEAD');
  assert.equal(status(dir), ' M m.php\n');
  const k = conflictOf(r, 'k.php');
  assert.equal(k.why, 'правки пересекаются');
  assert.equal(k.ours, path.join(dir, 'k.php'));
  assert.equal(fs.readFileSync(k.server, 'utf8'), 'сервер\nl2\nl3\nl4\nl5\n');
  assert.equal(fs.readFileSync(k.base, 'utf8'), FIVE);
  assert.ok(!k.server.startsWith(dir));
  assert.ok(path.basename(path.dirname(path.dirname(k.server))).startsWith(conflictTag(dir)));
  assert.ok(r.out.includes('Не совместилось само — рабочая копия этих файлов — как в HEAD (1):'), text(r));
  assert.equal(summaryOf(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' + MERGED + 'm.php. ' +
    'Не совместилось само — вопрос ниже: k.php.' + FTP_NOTE);
  assert.match(last(r), /^синхронизация сделана, кроме этих файлов; спроси пользователя по каждому: Совместить вручную \(.+\) \/ Оставить нашу \(.+\) \/ Взять версию сервера \(.+\)$/);
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
});

test('--ftp-done: скачанные архив, файл больше 10 МБ и файл с секретом не в коммите — отслеживаемые из HEAD, новые лежат в рабочей копии (Р-68), названы', async () => {
  const dir = ftpSite({ 'a.php': 'a\n', 'cfg.php': '<?php\n', 'files/big.dat': 'small\n', 'old.zip': 'PK0' });
  const big = Buffer.alloc(FILE_LIMIT + 1, 120);
  const downloaded = { 'a.php': 'a2\n', 'cfg.php': secretPhp(), 'files/big.dat': big, 'old.zip': 'PK1', 'backup.zip': 'PK', 'new.php': secretPhp(),
    'media/huge.bin': big, 'ok.php': 'ok\n' };
  writeFiles(dir, downloaded);
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tok.php', 'M\ta.php']);
  assert.equal(read(dir, 'cfg.php'), '<?php\n');
  assert.equal(read(dir, 'files/big.dat'), 'small\n');
  assert.equal(read(dir, 'old.zip'), 'PK0');
  for (const p of ['backup.zip', 'new.php', 'media/huge.bin']) assert.deepEqual(fs.readFileSync(path.join(dir, p)), Buffer.from(downloaded[p]), p + ' — не удалён');
  assert.equal(status(dir), '?? backup.zip\n?? media/huge.bin\n?? new.php\n');
  assert.ok(!text(r).includes(SECRET), 'значение секрета не в выводе');
  const fmt = (list) => list.map(([p, why]) => p + ' (' + why + ')').join(', ');
  const tracked = [['cfg.php', SECRET_WHY], ['files/big.dat', 'больше 10 МБ'], ['old.zip', 'архив']];
  const fresh = [['backup.zip', 'архив'], ['media/huge.bin', 'больше 10 МБ'], ['new.php', 'секрет']];
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 0. Не забрано, осталось на сервере: ' +
    fmt(tracked) + '. ' + LOCAL + fmt(fresh) + '.' + FTP_NOTE);
  assert.deepEqual(readMark(dir), { named: [...fresh, ...tracked].map(([p]) => p).sort(), pending: [] });
  // новые не забираемые — не правки перед скачиванием (Р-68): сразу список корней
  assert.equal(last(await run(dir)), DOWNLOADED);
  // скачали снова — снова не в коммите и уже не названы (named)
  writeFiles(dir, downloaded);
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.equal(count(dir), 2);
  assert.equal(last(again), SAME_FTP);
  assert.equal(status(dir), '?? backup.zip\n?? media/huge.bin\n?? new.php\n');
});

test('--ftp-done: CRLF в скачанном при LF в git — не изменение', async () => {
  const dir = ftpSite({ 'a.php': 'a\nb\n', 'm.php': 'x\ny\nz\n', 'c.php': 'c\n', 'bin.dat': Buffer.from([0, 10, 1]) });
  writeFiles(dir, { 'a.php': 'a\r\nb\r\n', 'm.php': 'x\r\ny\nz\r\n', 'c.php': 'c2\r\n', 'bin.dat': Buffer.from([0, 13, 10, 1]) });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.deepEqual(changed(dir), ['M\tc.php']);
  assert.equal(read(dir, 'a.php'), 'a\nb\n', 'отличие только в \\r — из HEAD, без упоминания');
  assert.equal(read(dir, 'm.php'), 'x\ny\nz\n');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'bin.dat')), Buffer.from([0, 10, 1]));
  assert.equal(status(dir), '');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.' + FTP_NOTE);
  assert.doesNotMatch(text(r), /a\.php|m\.php|bin\.dat/);
  // одни переводы строк — «совпадает с git»
  writeFiles(dir, { 'a.php': 'a\r\nb\r\n' });
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.equal(count(dir), 2);
  assert.equal(last(again), SAME_FTP);
});

test('--ftp-done: скачанное под .gitignore и «Не выкладывать» не тронуто и не в коммите', async () => {
  const dir = ftpSite({ 'a.php': 'a\n', 'bitrix/templates/t/x.php': 't\n', 'dist/keep.js': 'k\n', '.claude/docs/n.md': 'n\n' },
    { gitignore: GITIGNORE + '/upload/\n/bitrix/*\n!/bitrix/templates/\n', params: { 'Не выкладывать': '.gitignore, /dist' } });
  const downloaded = { 'upload/1.jpg': 'jpg', 'upload/arch.zip': 'PK', 'bitrix/modules/main/m.php': 'ядро\n', 'bitrix/templates/t/x.php': 't2\n',
    'dist/keep.js': 'k2\n', 'dist/app.js': 'app\n', 'a.php': 'a2\n', '.claude/docs/n.md': 'наша правка\n' };
  writeFiles(dir, downloaded);
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php', 'M\tbitrix/templates/t/x.php']);
  for (const p of ['upload/1.jpg', 'upload/arch.zip', 'bitrix/modules/main/m.php', 'dist/keep.js', 'dist/app.js', '.claude/docs/n.md']) {
    assert.equal(read(dir, p), downloaded[p], p);
  }
  assert.equal(status(dir), ' M .claude/docs/n.md\n M dist/keep.js\n?? dist/app.js\n', 'под «Не выкладывать» и служебное — не тронуто (Р-72)');
  assert.doesNotMatch(text(r), /upload|modules|dist|\.claude/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 2, добавлено 0, удалено 0.' + FTP_NOTE);
  assert.deepEqual(readMark(dir).named, []);
});

test('Р-72, Р-83: незакоммиченная правка .gitignore (вне синхронизации всегда) — не правка перед скачиванием; после --dirty-ok и --ftp-done цела, в выводе о ней ничего', async () => {
  const dir = ftpSite({ 'a.php': 'a\n', 'b.php': 'b\n' });
  const edited = GITIGNORE + '/tmp-local/\n';
  writeFiles(dir, { '.gitignore': edited, 'b.php': 'b моя\n' }); // b.php — правка файла сайта: нужен --dirty-ok
  const list = await run(dir);
  assert.equal(list.code, 1, text(list));
  assert.deepEqual(list.out.slice(1, 3), [DIRTY_HEAD(1), '  b.php'], '.gitignore — не файл сайта, не правка');
  const ok = await run(dir, { dirtyOk: true });
  assert.equal(last(ok), DOWNLOADED);
  assert.ok(!ok.out.includes('  .gitignore'), '.gitignore не в корнях');
  writeFiles(dir, { 'a.php': 'a2\n', 'b.php': 'b\n' }); // скачано: b.php затёрт версией сервера (= HEAD)
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, '.gitignore'), edited, 'правка .gitignore цела');
  assert.equal(status(dir), ' M .gitignore\n');
  assert.doesNotMatch(text(r), /\.gitignore/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.' + FTP_NOTE);
});

test('Р-61: --ftp-done после остановки kit-commit.js — pending с md5 скачанного; повтор не откатывает к HEAD, изменённое после остановки не трогает и называет', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'b.php': 'b\n', 'c.php': 'c\n' });
  writeFiles(dir, { 'a.php': '2\n', 'b.php': 'b2\n', 'n.php': 'n\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /коммит синхронизации не сделан \(kit-commit\.js, код 2\)/);
  assert.equal(last(r), AGAIN_FTP);
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php', md5: md5('2\n'), ftp: true }, { path: 'b.php', md5: md5('b2\n'), ftp: true },
    { path: 'n.php', md5: md5('n\n'), ftp: true }], 'Р-85: записано разбором скачанного — с пометкой ftp');
  assert.equal(read(dir, 'a.php'), '2\n');
  // обычный запуск при незаконченной синхронизации — сначала ответ на неё; ничего не пишет
  const m0 = markOf(dir);
  const plain = await run(dir);
  assert.equal(plain.code, 1, text(plain));
  assert.equal(last(plain), AGAIN_FTP);
  assert.equal(markOf(dir), m0);
  // после остановки доработали b.php; хук убран — повтор доводит синхронизацию без отката к HEAD
  writeFiles(dir, { 'b.php': 'b2 и моя\n' });
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php']);
  assert.equal(read(dir, 'b.php'), 'b2 и моя\n', 'изменённое после остановки — не тронуто');
  assert.ok(text(again).includes(UNTOUCHED('b.php')), text(again));
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '', 'поставленное kit-commit.js в индекс снято');
  assert.equal(status(dir), ' M b.php\n');
  assert.deepEqual(pendingOf(dir), []);
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 0.' + FTP_NOTE);
});

test('Р-61, Р-85: --abort после остановленной --ftp-done — забираемое отслеживаемое к HEAD (скачанное отменяется), новое скачанное оставлено и названо, совмещённое цело', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'm.php': FIVE });
  writeFiles(dir, { 'm.php': 'M1 наш шаг\nl2\nl3\nl4\nl5\n' });
  commit(dir, '1.1: правка m.php'); // не залито
  writeFiles(dir, { 'a.php': '2\n', 'n.php': 'n\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN_FTP);
  const merged = 'M1 наш шаг\nl2\nl3\nl4\nM5 сервер\n';
  assert.equal(read(dir, 'm.php'), merged);
  assert.ok(r.out.includes('совмещённое с нашими правками осталось в рабочей копии: m.php'), text(r));
  assert.deepEqual(pendingOf(dir), ['a.php', 'n.php']);
  const a = await run(dir, { abort: true });
  assert.equal(a.code, 0, text(a));
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл; ' + LEFT_NEW('n.php')]);
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.equal(read(dir, 'n.php'), 'n\n', 'новое скачанное синхронизация не записывала — не удаляет (Р-85)');
  assert.equal(read(dir, 'm.php'), merged, 'совмещённое не тронуто');
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '');
  assert.equal(status(dir), ' M m.php\n?? n.php\n');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  assert.equal(count(dir), 2);
});

test('Р-62: --ftp-done — забираемого больше предела за раз — код 1 до любой записи, ответ --ftp-done --big-ok; File Watchers не проверяются', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'b.php': 'b\n', 's.scss': '$a: 1;\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: false, watchers: [['scss', true]] }); // при Always разбор не идёт вовсе (Р-70)
  writeFiles(dir, { 'b.php': 'b наш шаг\n' });
  commit(dir, '1.1: правка b.php'); // не залито
  writeFiles(dir, { 'a.php': '2\n', 'b.php': 'b\n', 's.scss': '$a: 2;\n', 'big.php': 'x'.repeat(5000) });
  const before = status(dir);
  const r = await run(dir, { ftpDone: true, entryLimit: 1000 });
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /Забрать за одну синхронизацию — 5 КБ \(больше 1 КБ\); самые тяжёлые папки: big\.php — 5 КБ/);
  assert.doesNotMatch(text(r), /File Watchers/);
  assert.equal(last(r), 'спроси пользователя одним AskUserQuestion: по объёму — Забрать всё (`prod-sync.js --ftp-done --big-ok`) / ' +
    'Не забирать папки (допиши их в .gitignore и повтори синхронизацию) / Отложить');
  assert.equal(status(dir), before, 'ничего не записано — и из HEAD не восстановлено');
  assert.equal(read(dir, 'b.php'), 'b\n');
  assert.equal(markOf(dir), null);
  assert.equal(count(dir), 2);
  const ok = await run(dir, { ftpDone: true, entryLimit: 1000, bigOk: true });
  assert.equal(ok.code, 0, text(ok));
  assert.deepEqual(changed(dir), ['A\tbig.php', 'M\ta.php', 'M\ts.scss']);
  assert.equal(read(dir, 'b.php'), 'b наш шаг\n');
  assert.equal(status(dir), '');
  // --watchers-ok при --ftp-done допустим и ничего не меняет
  const w = cli({ cwd: dir, args: ['--ftp-done', '--watchers-ok'] });
  assert.equal(w.code, 0, w.stdout);
  assert.equal(w.stdout.trim().split('\n').pop(), SAME_FTP);
});

test('Р-63, Р-68: --ftp-done — скачанный файл, удалённый нашим шагом, не удаляется, «ждёт удаления с сервера» каждый раз; папка из плана — одной записью', async () => {
  const dir = ftpSite({ 'a.php': 'a\n', 'c.php': 'c\n', 'd.php': 'd\n' });
  g(dir, 'rm', '-q', 'c.php');
  const s1 = commit(dir, '1.1: убрать c.php');
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd([['1.1', s1.slice(0, 9)]], ['old/']) });
  commit(dir, '1.1а: план выкладки');
  g(dir, 'rm', '-q', 'd.php');
  commit(dir, '1.2: убрать d.php'); // не залито: d.php есть в базе
  writeFiles(dir, { 'c.php': 'c\n', 'd.php': 'd\n', 'old/x.php': 'x', 'old/y.php': 'y', 'a.php': 'a2\n' });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.ok(has(dir, 'c.php') && has(dir, 'd.php') && has(dir, 'old/x.php') && has(dir, 'old/y.php'), 'разбор не удаляет (Р-68)');
  assert.equal(status(dir), '?? c.php\n?? d.php\n?? old/x.php\n?? old/y.php\n');
  const waiting = 'Ждёт удаления с сервера: c.php, d.php, old/.';
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' + waiting + FTP_NOTE);
  assert.deepEqual(readMark(dir).named, []);
  // ждущее удаления — не правка перед скачиванием; называется каждый раз
  assert.equal(last(await run(dir)), DOWNLOADED);
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + waiting + FTP_NOTE);
  assert.equal(count(dir), 5);
});

test('Р-64: сессия в worktree без SSH — код 1 «синхронизация без SSH — в основной папке проекта», ничего не пишет и не читает скачанное', async () => {
  const dir = ftpSite({ 'a.php': '1\n' });
  const wt = path.join(tmpDir('kit-prod-wt-'), 'w');
  g(dir, 'worktree', 'add', '-q', '-b', 'w', wt);
  writeFiles(wt, { 'a.php': '2\n', 'n.php': 'n\n' });
  for (const opts of [{}, { ftpDone: true }, { check: true }, { dirtyOk: true }]) {
    const r = await run(wt, opts);
    assert.equal(r.code, 1, JSON.stringify(opts) + '\n' + text(r));
    assert.equal(r.out.length, 1, text(r));
    assert.match(last(r), /^синхронизация без SSH — в основной папке проекта \(.+\)$/);
    assert.ok(last(r).includes(path.basename(dir)), last(r));
  }
  assert.equal(status(wt), ' M a.php\n?? n.php\n');
  assert.equal(count(wt), 1);
  assert.equal(count(dir), 1);
  assert.ok(!has(wt, '.claude/kit-prod.json') && !has(dir, '.claude/kit-prod.json'));
});

// ---- Раунд 1 проверки 48.8: не удалять, автозаливка, ветки без тестов -------------------------------------------------

test('Р-68 (К-1): локальный неотслеживаемый dump.sql и файл, оставленный после git rm --cached, — не правки перед скачиванием; после --ftp-done целы, «осталось на сервере» о них нет', async () => {
  const dir = ftpSite({ 'a.php': 'a\n', 'keep.php': 'k\n' });
  g(dir, 'rm', '-q', '--cached', 'keep.php');
  g(dir, 'commit', '-q', '-m', '1.1: keep.php — вне git'); // файл остался на диске и не игнорируется
  writeFiles(dir, { 'dump.sql': 'INSERT 1;\n' });
  const list = await run(dir);
  assert.equal(list.code, 1, text(list));
  assert.equal(last(list), DOWNLOADED, 'не правки: разбор их не заберёт и не тронет');
  writeFiles(dir, { 'a.php': 'a2\n' }); // скачано
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'dump.sql'), 'INSERT 1;\n');
  assert.equal(read(dir, 'keep.php'), 'k\n');
  assert.equal(status(dir), '?? dump.sql\n?? keep.php\n');
  assert.doesNotMatch(text(r), /осталось на сервере/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0. ' + LOCAL + 'dump.sql (архив). ' +
    'Ждёт удаления с сервера: keep.php.' + FTP_NOTE);
  assert.deepEqual(readMark(dir).named, ['dump.sql']);
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Ждёт удаления с сервера: keep.php.' + FTP_NOTE,
    'не забираемое новое — один раз, ждущее удаления — каждый раз');
  assert.ok(has(dir, 'dump.sql') && has(dir, 'keep.php'));
});

test('Р-70: автозаливка PhpStorm Always — в списке FTP строка «выключи автозаливку»; --ftp-done — код 1 до любой записи, и pending не тронут', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'b.php': 'b\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { always: true });
  writeFiles(dir, { 'b.php': 'b наш шаг\n' });
  commit(dir, '1.1: правка b.php'); // не залито
  const list = await run(dir);
  assert.equal(list.code, 1, text(list));
  assert.deepEqual(list.out.slice(-3), [PHPSTORM('Download from alpha'), ALWAYS_OFF, DOWNLOADED]);
  writeFiles(dir, { 'a.php': '2\n', 'b.php': 'b\n' }); // скачано: b.php — версия базы поверх нашего незалитого
  writeMark(dir, { named: [], pending: [{ path: 'a.php', md5: md5('2\n') }] }); // прошлая остановка
  const before = status(dir);
  const m0 = markOf(dir);
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(r.out.slice(-2), ['автозаливка PhpStorm включена — выключи её (Tools → Deployment → Automatic Upload; PhpStorm записывает ' +
    'настройку не сразу — File → Save All) и повтори', 'спроси пользователя: Выключил — повторить (`prod-sync.js --ftp-done`) / Отложить']);
  assert.equal(status(dir), before, 'ничего не записано: и из HEAD не восстановлено');
  assert.equal(read(dir, 'b.php'), 'b\n');
  assert.equal(markOf(dir), m0, 'pending не тронут');
  assert.equal(count(dir), 2);
  // выключили — разбор идёт
  idea(dir, { always: false });
  const ok = await run(dir, { ftpDone: true });
  assert.equal(ok.code, 0, text(ok));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'b.php'), 'b наш шаг\n');
  assert.deepEqual(pendingOf(dir), []);
});

test('--ftp-done (М-5): исключение после записи pending — код 1, «остановилась после записи» с ответами без SSH; повтор доводит синхронизацию', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'm.php': FIVE });
  writeFiles(dir, { 'm.php': 'M1 наш шаг\nl2\nl3\nl4\nl5\n' });
  commit(dir, '1.1: правка m.php'); // не залито
  writeFiles(dir, { 'a.php': '2\n', 'm.php': 'l1\nl2\nl3\nl4\nM5 сервер\n' });
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith(path.sep + 'm.php')) throw Object.assign(new Error('тест: сбой диска'), { code: 'EIO' });
    return rename(from, to);
  };
  let r;
  try {
    r = await run(dir, { ftpDone: true });
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(r.code, 1, text(r));
  assert.match(text(r), /^синхронизация остановилась после записи: /m);
  assert.ok(r.out[r.out.length - 2].startsWith('забираемое из скачанного — в pending: «Повторить» разберёт скачанное заново'), text(r));
  assert.equal(last(r), AGAIN_FTP);
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php', md5: md5('2\n'), ftp: true }]);
  assert.equal(read(dir, 'a.php'), '2\n');
  const again = await run(dir, { ftpDone: true });
  assert.equal(again.code, 0, text(again));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'm.php'), 'M1 наш шаг\nl2\nl3\nl4\nM5 сервер\n');
  assert.equal(status(dir), ' M m.php\n');
  assert.deepEqual(pendingOf(dir), []);
});

test('--ftp-done (М-5): секрет в скачанной версии совмещаемого файла — не совмещён, из HEAD, назван один раз', async () => {
  const dir = ftpSite({ 's.php': FIVE });
  const mine = 'L1 наш шаг\nl2\nl3\nl4\nl5\n';
  writeFiles(dir, { 's.php': mine });
  commit(dir, '1.1: правка s.php'); // не залито
  writeFiles(dir, { 's.php': "l1\nl2\nl3\nl4\nreturn ['password' => '" + SECRET + "'];\n" });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.equal(read(dir, 's.php'), mine);
  assert.equal(status(dir), '');
  assert.ok(!text(r).includes(SECRET));
  assert.deepEqual(conflictRoots(dir), [], 'версия с секретом во временную папку не пишется');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не забрано, осталось на сервере: s.php (' +
    SECRET_WHY + ').' + FTP_NOTE);
  assert.deepEqual(readMark(dir).named, ['s.php']);
});

test('--ftp-done (М-5): наше уже на сервере (скачанное = HEAD ≠ база), отличие только в \\r — из HEAD молча, ничего не названо', async () => {
  const dir = ftpSite({ 'a.php': 'a\n' });
  writeFiles(dir, { 'a.php': 'a наш шаг\nвторая\n' });
  commit(dir, '1.1: правка a.php'); // залито автозаливкой, на сервере — с CRLF
  writeFiles(dir, { 'a.php': 'a наш шаг\r\nвторая\r\n' });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.equal(count(dir), 2);
  assert.equal(read(dir, 'a.php'), 'a наш шаг\nвторая\n');
  assert.equal(status(dir), '');
  assert.equal(last(r), SAME_FTP);
  assert.doesNotMatch(text(r), /Восстановлено/);
});

// ---- Имя и вывод (48.6) ------------------------------------------------------------------------------------------------

// Р-48: вывод каждого вызова entry() и prod-sync.js проверяет noEntryWord (через run и cli) — сценарии: совпадает («ничего не
// поменялось…»), забор («изменён, добавлен, удалён…»), конфликт («конфликт совмещения…»), --check и worktree, код 2 (««Прод: —» и
// не kit-проект…», «нет папки сайта…»), код 3 («нет подключения…», «--timeout 1…»), вотчеры и объём («больше 50 МБ за раз…»). Здесь —
// ветки, до которых сценарии не доходят (исключение, отметка не записана, md5 записанного не совпал): слова нет во всех исходниках
// синхронизации; и сам помощник.
// ---- Итоговая проверка этапа 48 (48.11а): что вне синхронизации, массовое удаление, автозаливка при откате, отмена без SSH ----

test('Р-83 (К-1): .gitignore не в «Не выкладывать» и нет на сервере — не удалён, не в коммите, о нём ничего; .gitattributes и .gitignore с сервера не забираются; изменённый у нас — не конфликт', { skip: !SH }, async () => {
  const { dir } = site({ 'a.php': '1\n', 'sub/.gitattributes': '* text\n', 'sub/b.php': 'b\n' },
    { server: { 'a.php': '2\n', 'sub/b.php': 'b\n', 'new/.gitignore': 'x\n', '.gitattributes': '* -text\n' } });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(body(dir), 'изменён: a.php');
  assert.equal(read(dir, '.gitignore'), GITIGNORE);
  assert.equal(read(dir, 'sub/.gitattributes'), '* text\n');
  assert.ok(!has(dir, 'new/.gitignore') && !has(dir, '.gitattributes'), 'служебные файлы git с сервера не забираются');
  assert.equal(status(dir), '');
  assert.doesNotMatch(text(r), /gitignore|gitattributes/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
  // .gitignore изменён нашим шагом после базы и ещё правка в рабочей копии — не «изменён у нас, удалён на сервере»
  writeFiles(dir, { '.gitignore': GITIGNORE + '/tmp/\n' });
  commit(dir, '1.1: .gitignore');
  writeFiles(dir, { '.gitignore': GITIGNORE + '/tmp/\n/cache/\n' });
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(status(dir), ' M .gitignore\n');
  const chk = await run(dir, { check: true });
  assert.equal(chk.code, 0, text(chk));
  assert.doesNotMatch(text(chk), /gitignore|gitattributes/);
});

test('Р-83 (К-1): путь, исключённый у сервера автозаливки PhpStorm (Excluded Paths), нет на сервере — не тронут и не в коммите; новое под ним на сервере — не забрано', { skip: !SH }, async () => {
  const { dir } = site({ 'a.php': '1\n', 'gulpfile.js': 'g\n', 'src/scss/s.scss': '$a: 1;\n', 'src/js/app.js': 'app\n' },
    { gitignore: GITIGNORE + '/.idea/\n', server: { 'a.php': '2\n', 'src/js/app.js': 'app\n', 'src/scss/new.scss': '$n: 1;\n' } });
  idea(dir, { excluded: ['gulpfile.js', 'src/scss'] });
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(read(dir, 'gulpfile.js'), 'g\n');
  assert.equal(read(dir, 'src/scss/s.scss'), '$a: 1;\n');
  assert.ok(!has(dir, 'src/scss/new.scss'));
  assert.equal(status(dir), '');
  assert.doesNotMatch(text(r), /gulpfile|scss/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.');
});

// Р-88 (Н-1, опыт rr1 повторной проверки): при «Claude по SSH» ssh-deploy.js заливает и пути из Excluded Paths — их база верна,
// и вне сверки правка сервера под ними пропала бы при следующей заливке. Удалить такой путь у нас синхронизация не может.
const IDEA_KEPT = 'нет на сервере — не удалён: исключён в PhpStorm';

test('Р-88 (Н-1): «Claude по SSH», Excluded Paths PhpStorm над рабочей папкой — изменённое и новое на сервере забраны; удалённое на сервере у нас не удалено, названо один раз', { skip: !SH }, async () => {
  const files = { 'index.php': 'i\n', 'bitrix/templates/sol/t.php': FIVE, 'bitrix/templates/sol/u.php': 'u1\n', 'bitrix/templates/sol/w.php': 'w1\n' };
  const { dir, server } = site(files, { params: { 'Выкладка': 'Claude по SSH' }, gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { excluded: ['bitrix'] });
  writeFiles(dir, { 'bitrix/templates/sol/w.php': 'w наш шаг\n' });
  commit(dir, '1.1: правка w.php'); // не залито: база — первый коммит
  writeFiles(server, { 'bitrix/templates/sol/t.php': 'l1\nl2\nl3\nl4\nl5 обновление\n', 'bitrix/templates/sol/v.php': 'v\n' });
  for (const p of ['bitrix/templates/sol/u.php', 'bitrix/templates/sol/w.php']) fs.rmSync(path.join(server, p));
  const chk = await run(dir, { check: true });
  assert.equal(chk.code, 1, text(chk));
  assert.match(chk.out[chk.out.length - 2], /изменено 1, добавлено 1, удалено 0\./);
  const r = await run(dir);
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['A\tbitrix/templates/sol/v.php', 'M\tbitrix/templates/sol/t.php']);
  assert.equal(read(dir, 'bitrix/templates/sol/t.php'), 'l1\nl2\nl3\nl4\nl5 обновление\n');
  assert.equal(read(dir, 'bitrix/templates/sol/u.php'), 'u1\n', 'нет на сервере — не удаление');
  assert.equal(read(dir, 'bitrix/templates/sol/w.php'), 'w наш шаг\n', 'изменён у нас, нет на сервере — не конфликт и не удаление');
  assert.equal(status(dir), '');
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 1, удалено 0. Оставлено у нас: ' +
    `bitrix/templates/sol/u.php (${IDEA_KEPT}), bitrix/templates/sol/w.php (${IDEA_KEPT}).`);
  assert.deepEqual(readMark(dir).named, ['bitrix/templates/sol/u.php', 'bitrix/templates/sol/w.php']);
  const again = await run(dir);
  assert.equal(again.code, 0, text(again));
  assert.equal(last(again), '[kit] Синхронизация с продом: прод совпадает с git.', 'названное — один раз');
  assert.ok(has(dir, 'bitrix/templates/sol/u.php'));
  assert.equal(count(dir), 3);
});

// Р-89 (Н-2, опыт n1-mass): оставленные пути (Р-88) у нас не удаляются — доля массового удаления считается без них, иначе сотни
// путей под исключённой bitrix раздували бы знаменатель и неверный «SSH прод» удалял бы у нас всё остальное без вопроса.
test('Р-89 (Н-2): «Claude по SSH», под исключённой bitrix 300 файлов, вне её 25, на сервере пусто — стоп «на сервере нет 25 из 25», ничего не записано', { skip: !SH }, async () => {
  const inside = Array.from({ length: 300 }, (_, i) => `bitrix/templates/sol/f${i}.php`);
  const outside = Array.from({ length: 25 }, (_, i) => `local/x${i}.php`);
  const { dir, server } = site(Object.fromEntries([...inside, ...outside].map((p) => [p, p + '\n'])),
    { params: { 'Выкладка': 'Claude по SSH' }, gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { excluded: ['bitrix'] });
  for (const e of fs.readdirSync(server)) fs.rmSync(path.join(server, e), { recursive: true, force: true });
  writeFiles(server, { 'other.txt': 'x\n' }); // не тот сайт
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(r.out.slice(-3), [
    'на сервере нет 25 из 25 файлов сайта — проверь «SSH прод» (/kit:project-init)',
    '  например: ' + [...outside].sort().slice(0, 10).join(', ') + ' и ещё 15',
    'спроси пользователя: Удалить у нас (`prod-sync.js --delete-ok`) / Проверить «SSH прод» / Отложить',
  ]);
  assert.equal(count(dir), 1);
  assert.equal(status(dir), '');
  assert.ok(outside.every((p) => has(dir, p)), 'ничего не удалено');
  assert.equal(markOf(dir), null, 'и отметка не тронута');
});

test('Р-83 (К-1), без SSH: .gitignore и исключённое в PhpStorm — не корни для скачивания; скачанное поверх них не забирается и не возвращается из HEAD', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'gulpfile.js': 'g\n', 'src/scss/s.scss': '$a: 1;\n', 'src/i.php': 'i\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  idea(dir, { excluded: ['gulpfile.js', 'src/scss'] });
  const list = await run(dir);
  assert.equal(list.code, 1, text(list));
  assert.deepEqual(list.out.slice(1, 4), [ROOTS_HEAD(2), '  a.php', '  src/i.php']);
  // скачано: a.php изменён без нас; серверные .gitignore и gulpfile.js легли поверх наших, под src/scss — новый файл
  writeFiles(dir, { 'a.php': '2\n', '.gitignore': GITIGNORE + '/.idea/\n# сервер\n', 'gulpfile.js': 'g сервер\n', 'src/scss/n.scss': 'n\n' });
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 0, text(r));
  assert.deepEqual(changed(dir), ['M\ta.php']);
  assert.equal(status(dir), ' M .gitignore\n M gulpfile.js\n?? src/scss/n.scss\n', 'как «Не выкладывать» (Р-72): не забрано и не возвращено');
  assert.doesNotMatch(text(r), /gitignore|gulpfile|scss/);
  assert.equal(last(r), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 0.' + FTP_NOTE);
});

test('Р-83 (М-1): на сервере нет больше 20 файлов и больше 10 % файлов сайта — код 1 до записи, примеры путей и вопрос; --delete-ok — удалены и закоммичены; 20 файлов или не больше 10 % — без вопроса', { skip: !SH }, async () => {
  const names = Array.from({ length: 100 }, (_, i) => `f/${String(i).padStart(3, '0')}.php`);
  const { dir, server } = site(Object.fromEntries(names.map((p) => [p, p + '\n'])));
  for (const p of names.slice(0, 25)) fs.rmSync(path.join(server, p));
  writeFiles(server, { 'f/050.php': 'клиент\n' });
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.deepEqual(r.out.slice(-3), [
    'на сервере нет 25 из 100 файлов сайта — проверь «SSH прод» (/kit:project-init)',
    '  например: ' + names.slice(0, 10).join(', ') + ' и ещё 15',
    'спроси пользователя: Удалить у нас (`prod-sync.js --delete-ok`) / Проверить «SSH прод» / Отложить',
  ]);
  assert.equal(count(dir), 1);
  assert.equal(status(dir), '');
  assert.equal(read(dir, 'f/050.php'), 'f/050.php\n', 'ничего не записано');
  assert.equal(markOf(dir), null, 'и отметка не тронута');
  // ответ «Удалить у нас» — из командной строки
  const ok = cli({ cwd: dir, args: ['--delete-ok'] });
  assert.equal(ok.code, 0, ok.stdout);
  assert.equal(ok.stdout.trim().split('\n').pop(), '[kit] Синхронизация с продом: файлов без kit: изменено 1, добавлено 0, удалено 25.');
  assert.deepEqual(changed(dir), [...names.slice(0, 25).map((p) => 'D\t' + p), 'M\tf/050.php'].sort());
  assert.equal(status(dir), '');
  // 20 из 75 — не больше 20: без вопроса
  for (const p of names.slice(25, 45)) fs.rmSync(path.join(server, p));
  const twenty = await run(dir);
  assert.equal(twenty.code, 0, text(twenty));
  assert.match(last(twenty), /удалено 20\.$/);
  // 25 из 250 — не больше 10 %: без вопроса
  const many = Array.from({ length: 250 }, (_, i) => `g/${String(i).padStart(3, '0')}.php`);
  const big = site(Object.fromEntries(many.map((p) => [p, p + '\n'])));
  for (const p of many.slice(0, 25)) fs.rmSync(path.join(big.server, p));
  const tenth = await run(big.dir);
  assert.equal(tenth.code, 0, text(tenth));
  assert.match(last(tenth), /удалено 25\.$/);
});

const ALWAYS_ROLLBACK = 'автозаливка PhpStorm включена — откат к git уйдёт на сервер; выключи её (Tools → Deployment → Automatic Upload; ' +
  'PhpStorm записывает настройку не сразу — File → Save All) и повтори';

test('Р-84 (В-1): автозаливка PhpStorm Always и незаконченная синхронизация — повтор и --abort: код 1 до любой записи, файлы не тронуты; выключили — как прежде', { skip: !SH }, async () => {
  const { dir, server } = site({ 'a.php': '1\n', 'b.php': 'b\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  writeFiles(server, { 'a.php': '2 клиент\n', 'n.php': 'n клиент\n' });
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir);
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN);
  assert.deepEqual(pendingOf(dir), ['a.php', 'n.php']);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  idea(dir, { always: true });
  const before = status(dir);
  const m0 = markOf(dir);
  const log = path.join(tmpDir('kit-prod-log-'), 'log.json');
  const unchanged = (what) => {
    assert.equal(read(dir, 'a.php'), '2 клиент\n', what);
    assert.equal(read(dir, 'n.php'), 'n клиент\n', what);
    assert.equal(status(dir), before, what);
    assert.equal(markOf(dir), m0, what);
    assert.ok(!fs.existsSync(log), what + ': к серверу не подключались');
    assert.equal(count(dir), 1);
  };
  // повтор — с теми же флагами в ответе
  const again = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir, { bigOk: true, watchersOk: true }));
  assert.equal(again.code, 1, text(again));
  assert.deepEqual(again.out.slice(-2), [ALWAYS_ROLLBACK, 'спроси пользователя: Выключил — повторить (`prod-sync.js --watchers-ok --big-ok`) / Отложить']);
  unchanged('повтор');
  const plain = await withEnv({ FAKE_SSH_LOG: log }, () => run(dir));
  assert.equal(last(plain), 'спроси пользователя: Выключил — повторить (`prod-sync.js`) / Отложить');
  unchanged('повтор без флагов');
  const ab = await run(dir, { abort: true });
  assert.equal(ab.code, 1, text(ab));
  assert.deepEqual(ab.out, [ALWAYS_ROLLBACK, 'спроси пользователя: Выключил — повторить (`prod-sync.js --abort`) / Отложить']);
  unchanged('отмена');
  // --check при Always — сверка без записи, как прежде
  const chk = await run(dir, { check: true });
  assert.notEqual(last(chk), ALWAYS_ROLLBACK);
  unchanged('--check');
  // выключили — повтор доводит синхронизацию
  idea(dir, { always: false });
  const ok = await run(dir);
  assert.equal(ok.code, 0, text(ok));
  assert.deepEqual(changed(dir), ['A\tn.php', 'M\ta.php']);
  assert.deepEqual(pendingOf(dir), []);
});

test('Р-85 (В-2): без SSH — --dirty-ok, наш незакоммиченный новый файл, --ftp-done, остановка коммита, --abort: файл цел и назван, отслеживаемое — к HEAD; при Always отмена — код 1', async () => {
  const dir = ftpSite({ 'a.php': '1\n', 'b.php': 'b\n' }, { gitignore: GITIGNORE + '/.idea/\n' });
  writeFiles(dir, { 'n.php': 'наш новый\n' }); // не закоммичен, на сервере его нет
  assert.equal(last(await run(dir)), DIRTY_ASK);
  assert.equal(last(await run(dir, { dirtyOk: true })), DOWNLOADED);
  writeFiles(dir, { 'a.php': '2\n' }); // скачано
  hook(dir, 'pre-commit', 'exit 1');
  const r = await run(dir, { ftpDone: true });
  assert.equal(r.code, 1, text(r));
  assert.equal(last(r), AGAIN_FTP);
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php', md5: md5('2\n'), ftp: true }, { path: 'n.php', md5: md5('наш новый\n'), ftp: true }]);
  fs.rmSync(path.join(dir, '.git', 'hooks', 'pre-commit'));
  // автозаливка Always — и отмена без SSH: код 1, ничего не тронуто
  idea(dir, { always: true });
  const m0 = markOf(dir);
  const st0 = status(dir);
  const stopped = await run(dir, { abort: true });
  assert.equal(stopped.code, 1, text(stopped));
  assert.deepEqual(stopped.out, [ALWAYS_ROLLBACK, 'спроси пользователя: Выключил — повторить (`prod-sync.js --abort`) / Отложить']);
  assert.equal(read(dir, 'a.php'), '2\n');
  assert.equal(markOf(dir), m0);
  assert.equal(status(dir), st0);
  idea(dir, { always: false });
  const a = await run(dir, { abort: true });
  assert.equal(a.code, 0, text(a));
  assert.deepEqual(a.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл; ' + LEFT_NEW('n.php')]);
  assert.equal(read(dir, 'n.php'), 'наш новый\n', 'наш новый файл цел');
  assert.equal(read(dir, 'a.php'), '1\n');
  assert.equal(g(dir, 'diff', '--cached', '--name-only'), '', 'снят с индекса');
  assert.equal(status(dir), '?? n.php\n');
  assert.deepEqual(JSON.parse(markOf(dir)), { named: [], pending: [] });
  // элемент без пометки (до 48.11а) — как прежде: нет в HEAD — к HEAD, то есть удаляется
  writeFiles(dir, { 'x.php': 'x\n' });
  writeMark(dir, { named: [], pending: [{ path: 'x.php', md5: md5('x\n') }] });
  const old = await run(dir, { abort: true });
  assert.deepEqual(old.out, ['[kit] Синхронизация отменена: к HEAD возвращён 1 файл']);
  assert.ok(!has(dir, 'x.php'));
  assert.equal(read(dir, 'n.php'), 'наш новый\n');
});

test('вывод синхронизации: ни в одной строке out нет слова «вход»', () => {
  for (const rel of ['prod-sync.js', 'lib/prod-ssh.js', 'lib/prod.js', 'lib/prod-ftp.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'plugins', 'kit', 'scripts', rel), 'utf8').split('\n');
    assert.deepEqual(src.map((l, i) => i + 1 + ': ' + l).filter((l) => /вход/i.test(l)), [], rel);
  }
  assert.throws(() => noEntryWord(['[kit] Вход с прода: прод совпадает с git.']), 'любой регистр');
  assert.throws(() => noEntryWord(['коммит входа не сделан']));
  assert.doesNotThrow(() => noEntryWord(['коммит синхронизации не отправлен: ' + KIT_COMMIT_LOGIN]), 'причина kit-commit.js — не в счёт');
});

// Р-49: старое имя собрано склейкой — иначе тест нашёл бы сам себя.
const OLD = 'prod-' + 'entry';
test('старого имени нет: файла ' + OLD + '.js нет, упоминаний ' + OLD + ' в plugins/, tests/ и README.md нет', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'plugins', 'kit', 'scripts', OLD + '.js')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'tests', OLD + '.test.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins', 'kit', 'scripts', 'prod-sync.js')));
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(p);
      } else if (e.name.includes(OLD) || fs.readFileSync(p).includes(OLD)) hits.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'plugins'));
  walk(path.join(ROOT, 'tests'));
  if (fs.readFileSync(path.join(ROOT, 'README.md')).includes(OLD)) hits.push('README.md');
  assert.deepEqual(hits, []);
});
