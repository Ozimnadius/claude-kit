'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { cleanMessage, parseArgs, lockRetry, PUSH_TIMEOUT_MS } = require('../plugins/kit/scripts/kit-commit');
const { norm } = require('../plugins/kit/scripts/lib/paths');
const { paramsMd, WORK_GITIGNORE, WORK_RULE, WORK_FILES } = require('./fixtures');

const ENV = {
  GIT_AUTHOR_NAME: 'kit', GIT_AUTHOR_EMAIL: 'kit@test.local',
  GIT_COMMITTER_NAME: 'kit', GIT_COMMITTER_EMAIL: 'kit@test.local',
};
const commit = (dir, paths, msg, cwd = dir) =>
  runScript('kit-commit.js', { args: ['--', ...paths], input: msg, cwd, env: ENV });
const lastMessage = (dir) => {
  const raw = git(dir, 'cat-file', 'commit', 'HEAD');
  return raw.slice(raw.indexOf('\n\n') + 2);
};
const count = (dir) => Number(git(dir, 'rev-list', '--count', 'HEAD').trim());
const staged = (dir) => git(dir, 'diff', '--cached', '--name-only').trim();
const committed = (dir) => git(dir, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', 'HEAD')
  .trim().split('\n').sort();

test('сообщение попадает в коммит побайтно: «спек», обратные кавычки, $arResult, апостроф, / в начале строки (К54)', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'a.php': '<?php\necho 1;\n' });
  const msg = "28.1: спек — вывод $arResult в шаблоне 'Купить'\n\n"
    + '/local/templates/x: `php -l` — ок, частям и спек не исправлены\n\n'
    + 'Co-Authored-By: Claude <noreply@anthropic.com>\n';
  const r = commit(dir, ['a.php'], msg);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(lastMessage(dir), msg);
  assert.equal(count(dir), 2);
  assert.match(r.stdout, /сообщение совпало с поданным/);
});

test('сообщение с \\r\\n — в коммите LF, самопроверка проходит', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt'], '28.1: a\r\n\r\nтело\r\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(lastMessage(dir), '28.1: a\n\nтело\n');
});

test('чужой файл в индексе не попадает в коммит и остаётся в индексе', () => {
  const dir = gitRepo({ 'a.txt': '1\n', 'b.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', 'b.txt': '2\n' });
  git(dir, 'add', 'b.txt');
  const r = commit(dir, ['a.txt'], '28.1: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['M\ta.txt']);
  assert.equal(staged(dir), 'b.txt');
});

test('запрещённый путь — код 1, ничего не добавлено, коммита нет', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { '.idea/workspace.xml': '<x/>\n', 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt', '.idea/workspace.xml'], '28.1: a\n');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), '');
  assert.match(r.stdout, /запрещённые пути/);
});

// Пароль собран из частей: литерал в файле теста остановил бы проверку секретов при коммите.
const SECRET = ['Qw3', 'rty!x9'].join('');

test('путь-папка bitrix: рабочие папки под «кроме» — коммит только их файлов; запрещённый файл внутри — код 1, ничего не добавлено (с 3.2.0)', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Не коммитить': WORK_RULE }), '.gitignore': WORK_GITIGNORE });
  writeFiles(dir, WORK_FILES);
  const r = commit(dir, ['bitrix'], '41.2: рабочие папки\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['A\tbitrix/php_interface/init.php', 'A\tbitrix/templates/theme/a.php']);
  writeFiles(dir, { 'bitrix/templates/theme/a.php': 'b', 'bitrix/templates/theme/_a.php.back1': 'старый' });
  const bad = commit(dir, ['bitrix/'], '41.2: ещё\n');
  assert.equal(bad.code, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /_a\.php\.back1: запрещённый путь/);
  assert.equal(staged(dir), '');
  assert.equal(count(dir), 2);
});

test('секрет в содержимом — код 1, коммита нет, индекс как есть, значение замаскировано', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'cfg.php': `<?php\nreturn ['password' => '${SECRET}'];\n` });
  const r = commit(dir, ['cfg.php'], '28.1: cfg\n');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), 'cfg.php');
  assert.doesNotMatch(r.stdout, new RegExp(SECRET));
  assert.match(r.stdout, /Индекс оставлен как есть/);
});

test('уже помеченное удаление, удаление в рабочей папке и изменение — одним коммитом', () => {
  const dir = gitRepo({ 'old.txt': '1\n', 'gone.txt': '1\n', 'a.txt': '1\n' });
  git(dir, 'rm', '-q', 'old.txt');
  fs.unlinkSync(path.join(dir, 'gone.txt'));
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['old.txt', 'gone.txt', 'a.txt'], '28.1: уборка\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['D\tgone.txt', 'D\told.txt', 'M\ta.txt']);
});

test('только уже помеченное удаление — git add не нужен, коммит проходит', () => {
  const dir = gitRepo({ 'old.txt': '1\n', 'a.txt': '1\n' });
  git(dir, 'rm', '-q', 'old.txt');
  const r = commit(dir, ['old.txt'], '28.1: удалить old\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['D\told.txt']);
});

test('пустой список путей, пустое сообщение или «.» — код 2, ничего не добавлено', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  assert.equal(commit(dir, [], '28.1: a\n').code, 2);
  assert.equal(commit(dir, ['a.txt'], '').code, 2);
  assert.equal(commit(dir, ['a.txt'], ' \n\n').code, 2);
  assert.equal(commit(dir, ['.'], '28.1: a\n').code, 2);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), '');
});

test('опечатка в пути — код 2, коммита нет', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt', 'нет-такого.txt'], '28.1: a\n');
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
});

test('хук commit-msg отклонил — код 2, коммита нет, файлы остаются в индексе', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', '.git/hooks/commit-msg': '#!/bin/sh\necho "запрещённое слово" >&2\nexit 1\n' });
  fs.chmodSync(path.join(dir, '.git/hooks/commit-msg'), 0o755);
  const r = commit(dir, ['a.txt'], '28.1: a\n');
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), 'a.txt');
  assert.match(r.stdout, /запрещённое слово/);
});

test('первый коммит репозитория: папка с кириллицей и путь с пробелом', () => {
  const dir = makeProject({ 'Документы/план.md': '# план\n', 'с пробелом.txt': 'x\n', 'чужой.txt': 'y\n' });
  git(dir, 'init', '-q');
  git(dir, 'add', 'чужой.txt');
  const r = commit(dir, ['Документы/', 'с пробелом.txt'], '0.1: исходники\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.deepEqual(committed(dir), ['A\tДокументы/план.md', 'A\tс пробелом.txt']);
  assert.equal(staged(dir), 'чужой.txt');
});

test('не из корня репозитория — код 2', () => {
  const dir = gitRepo({ 'sub/a.txt': '1\n' });
  writeFiles(dir, { 'sub/a.txt': '2\n' });
  const r = commit(dir, ['a.txt'], '28.1: a\n', path.join(dir, 'sub'));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /из корня репозитория/);
  assert.equal(count(dir), 1);
});

test('cleanMessage и parseArgs', () => {
  assert.equal(cleanMessage('\n\nA  \r\n\n\n\nB\t\n\n'), 'A\n\nB\n');
  assert.equal(cleanMessage(' \n\r\n'), '');
  assert.deepEqual(parseArgs(['--', './a.txt', 'Документы/', 'b\\c.txt']), { paths: ['a.txt', 'Документы', 'b/c.txt'], inbox: null, push: null });
  assert.deepEqual(parseArgs(['--inbox', '2', '--push', 'origin', '--', 'a.txt']), { paths: ['a.txt'], inbox: 2, push: 'origin' });
  assert.match(parseArgs(['--inbox', 'x', '--', 'a']).error, /--inbox/);
  assert.match(parseArgs(['--push', '--', 'a']).error, /--push/);
  assert.match(parseArgs([]).error, /нет путей/);
  assert.match(parseArgs(['--x', '--', 'a']).error, /неизвестные аргументы/);
  assert.match(parseArgs(['--']).error, /пуст/);
  assert.match(parseArgs(['--', '.']).error, /«\.»/);
});

const INBOX = '.claude/kit-inbox.jsonl';
const inboxLines = (dir) => (fs.existsSync(path.join(dir, INBOX)) ? fs.readFileSync(path.join(dir, INBOX), 'utf8').split('\n').filter(Boolean) : []);
const commitWith = (dir, opts, paths, msg) => runScript('kit-commit.js', { args: [...opts, '--', ...paths], input: msg, cwd: dir, env: ENV });
const bareRepo = () => {
  const b = makeProject();
  git(b, 'init', '-q', '--bare');
  return b;
};
const branchOf = (dir) => git(dir, 'symbolic-ref', '--short', 'HEAD').trim();

test('--inbox 2 при трёх записях — после проверенного коммита остаётся одна, поздняя (3.0.0)', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', [INBOX]: '{"n":1}\n{"n":2}\n{"n":3}\n' });
  const r = commitWith(dir, ['--inbox', '2'], ['a.txt'], '36.5: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(inboxLines(dir), ['{"n":3}']);
});

test('--inbox: стоп по секрету (код 1) — входящие не тронуты', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'cfg.php': `<?php\nreturn ['password' => '${SECRET}'];\n`, [INBOX]: '{"n":1}\n{"n":2}\n' });
  const r = commitWith(dir, ['--inbox', '2'], ['cfg.php'], '36.5: cfg\n');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(inboxLines(dir).length, 2);
});

test('самопроверка: переданный путь после коммита остался в git status (хук post-commit) — код 3, входящие не тронуты', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', [INBOX]: '{"n":1}\n', '.git/hooks/post-commit': '#!/bin/sh\necho 3 >> a.txt\n' });
  fs.chmodSync(path.join(dir, '.git/hooks/post-commit'), 0o755);
  const r = commitWith(dir, ['--inbox', '1'], ['a.txt'], '36.5: a\n');
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /после коммита в git status остались: a\.txt/);
  assert.equal(inboxLines(dir).length, 1);
});

test('--push origin в пустой репозиторий — первая отправка: история проверена, коммит на удалённом', () => {
  const bare = bareRepo();
  const dir = gitRepo({ 'a.txt': '1\n' });
  git(dir, 'remote', 'add', 'origin', bare);
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commitWith(dir, ['--push', 'origin'], ['a.txt'], '36.5: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /secret-scan: чисто \(коммитов: 2/);
  assert.match(r.stdout, /kit-commit: отправлено в origin\//);
  assert.equal(git(bare, 'rev-parse', branchOf(dir)).trim(), git(dir, 'rev-parse', 'HEAD').trim());
});

test('--push: секрет в истории — код 4 «в истории секреты», коммит на месте, удалённый пуст', () => {
  const bare = bareRepo();
  const dir = gitRepo({ 'cfg.php': `<?php\nreturn ['password' => '${SECRET}'];\n` });
  git(dir, 'remote', 'add', 'origin', bare);
  writeFiles(dir, { 'a.txt': '1\n' });
  const r = commitWith(dir, ['--push', 'origin'], ['a.txt'], '36.5: a\n');
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /kit-commit: не отправлено — в истории секреты/);
  assert.doesNotMatch(r.stdout, new RegExp(SECRET));
  assert.equal(count(dir), 2);
  assert.equal(git(bare, 'for-each-ref').trim(), '');
});

test('--push: на удалённом есть коммит, которого здесь нет — код 4, коммит на месте', () => {
  const bare = bareRepo();
  const other = gitRepo({ 'b.txt': 'чужой\n' });
  git(other, 'push', '-q', bare, 'HEAD:' + branchOf(other));
  const dir = gitRepo({ 'a.txt': '1\n' });
  git(dir, 'remote', 'add', 'origin', bare);
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commitWith(dir, ['--push', 'origin'], ['a.txt'], '36.5: a\n');
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /kit-commit: не отправлено — на удалённом есть коммиты, которых здесь нет/);
  assert.equal(count(dir), 2);
});

test('предел отправки меньше предела команды Bash (120 с): при зависшем входе скрипт сам выходит с кодом 4 (финальная проверка, I4)', () => {
  assert.ok(PUSH_TIMEOUT_MS > 0 && PUSH_TIMEOUT_MS < 120000, String(PUSH_TIMEOUT_MS));
});

test('--push: удалённый отклонил хуком pre-receive — код 4 «удалённый репозиторий отклонил отправку», а не «есть коммиты» (финальная проверка, M1)', () => {
  const bare = bareRepo();
  writeFiles(bare, { 'hooks/pre-receive': '#!/bin/sh\necho "ветка защищена" >&2\nexit 1\n' });
  fs.chmodSync(path.join(bare, 'hooks/pre-receive'), 0o755);
  const dir = gitRepo({ 'a.txt': '1\n' });
  git(dir, 'remote', 'add', 'origin', bare);
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commitWith(dir, ['--push', 'origin'], ['a.txt'], '36.8: a\n');
  assert.equal(r.code, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /kit-commit: не отправлено — удалённый репозиторий отклонил отправку/);
  assert.doesNotMatch(r.stdout, /есть коммиты, которых здесь нет/);
});

// ---------- 47.8в: абсолютные пути, чужой index.lock, git status без замка ----------

// Буква диска в другом регистре (Windows): C:\… → c:\…
const otherDriveCase = (p) => p.replace(/^[A-Za-z]/, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));

test('абсолютные пути внутри репозитория («как видят инструменты»): обе формы косых и другой регистр буквы диска — код 0, без «сверх переданных» (47.8в)', () => {
  const dir = gitRepo({ 'local/a.php': '1', 'local/b.php': '1', 'local/c.php': '1', 'x.txt': '1' });
  writeFiles(dir, { 'local/a.php': '2', 'local/b.php': '2', 'local/c.php': '2', 'x.txt': '2' });
  const back = path.join(dir, 'local', 'a.php');
  const fwd = dir.replace(/\\/g, '/') + '/local/b.php';
  const low = process.platform === 'win32' ? otherDriveCase(dir).replace(/\\/g, '/') + '/local/c.php' : path.join(dir, 'local', 'c.php');
  const r = commit(dir, [back, fwd, low], '47.8: абсолютные пути\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /сверх переданных/);
  assert.deepEqual(committed(dir), ['M\tlocal/a.php', 'M\tlocal/b.php', 'M\tlocal/c.php']);
  assert.match(git(dir, 'status', '--short'), /x\.txt/, 'чужой файл не взят');
});

test('абсолютный путь под «Не коммитить» — код 1, как у относительного; путь вне репозитория — код 2, как раньше (47.8в)', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Не коммитить': 'upload/ (кроме upload/docs/)' }), 'a.txt': '1' });
  writeFiles(dir, { 'upload/iblock/x.jpg': 'jpg', 'a.txt': '2' });
  const bad = commit(dir, ['a.txt', path.join(dir, 'upload', 'iblock', 'x.jpg')], '47.8: a\n');
  assert.equal(bad.code, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /upload\/iblock\/x\.jpg: запрещённый путь/);
  assert.equal(staged(dir), '');
  const outside = makeProject({ 'y.txt': 'y' });
  const out = commit(dir, ['a.txt', path.join(outside, 'y.txt')], '47.8: a\n');
  assert.equal(out.code, 2, out.stdout + out.stderr);
  assert.equal(count(dir), 1);
});

test('parseArgs с корнем: абсолютный путь внутри — от корня с «/», сам корень — «.», снаружи и относительные — как раньше (47.8в)', () => {
  const root = path.join(makeProject(), 'repo');
  const fwd = root.replace(/\\/g, '/');
  assert.deepEqual(parseArgs(['--', path.join(root, 'local', 'a.php'), fwd + '/b/', './c.txt'], root).paths, ['local/a.php', 'b', 'c.txt']);
  if (process.platform === 'win32') assert.deepEqual(parseArgs(['--', otherDriveCase(fwd) + '/A.php'], root).paths, ['A.php']);
  assert.match(parseArgs(['--', root], root).error, /«\.»/);
  assert.deepEqual(parseArgs(['--', fwd + '-other/x.php'], root).paths, [norm(fwd + '-other/x.php')], 'соседняя папка с тем же началом имени — не внутри');
});

// Чужой замок индекса (параллельный git status соседней сессии, PhpStorm): отдельный процесс снимает его через ms.
function lockIndex(dir, ms) {
  const lock = path.join(dir, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  if (ms !== undefined) {
    spawn(process.execPath, ['-e', `setTimeout(() => require('fs').rmSync(${JSON.stringify(lock)}, { force: true }), ${ms})`], { stdio: 'ignore' });
  }
  return lock;
}

test('index.lock снимается через ~0,7 с — git add повторяется, код 0 (47.8в)', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  lockIndex(dir, 700);
  const r = commit(dir, ['a.txt'], '47.8: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(count(dir), 2);
  assert.deepEqual(committed(dir), ['M\ta.txt']);
});

test('index.lock снимается через ~0,7 с, а git add не нужен (только помеченное удаление) — повторяется git commit, код 0 (47.8в)', () => {
  const dir = gitRepo({ 'old.txt': '1\n', 'a.txt': '1\n' });
  git(dir, 'rm', '-q', 'old.txt');
  lockIndex(dir, 700);
  const r = commit(dir, ['old.txt'], '47.8: удалить old\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(count(dir), 2);
  assert.deepEqual(committed(dir), ['D\told.txt']);
});

test('index.lock не снимается — код 2 с выводом git, коммита нет (47.8в)', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const lock = lockIndex(dir);
  try {
    const r = commit(dir, ['a.txt'], '47.8: a\n');
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /index\.lock/);
    assert.match(r.stdout, /git add не прошёл, коммита нет/);
    assert.equal(count(dir), 1);
  } finally {
    fs.rmSync(lock, { force: true });
  }
});

test('lockRetry: повтор только при index.lock и пока safe() — не больше 3 раз (47.8в)', () => {
  const LOCK = { code: 128, out: "fatal: Unable to create '/x/.git/index.lock': File exists." };
  const OK = { code: 0, out: '' };
  let calls = 0;
  const seq = (...rs) => {
    calls = 0;
    return () => rs[Math.min(calls++, rs.length - 1)];
  };
  const pauses = [];
  const pause = (ms) => pauses.push(ms);
  assert.equal(lockRetry(seq(LOCK, LOCK, OK), () => true, pause).code, 0);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [500, 500]);
  assert.equal(lockRetry(seq(LOCK), () => true, pause).code, 128);
  assert.equal(calls, 4, 'первая попытка и 3 повтора');
  assert.equal(lockRetry(seq(LOCK, OK), () => false, pause).code, 128, 'safe() — нет: коммит мог случиться, повтора нет');
  assert.equal(calls, 1);
  assert.equal(lockRetry(seq({ code: 1, out: 'хук отклонил' }, OK), () => true, pause).code, 1, 'другая ошибка — без повтора');
  assert.equal(calls, 1);
});

test('самопроверка смотрит git status без замка индекса (--no-optional-locks): индекс после коммита не переписан (47.8в)', () => {
  const dir = gitRepo({ 'a.txt': '1\n', 'b.txt': '1\n' });
  writeFiles(dir, {
    'a.txt': '2\n',
    // После коммита у b.txt другое время изменения (содержимое то же) — обычный git status обновил бы индекс; снимок индекса.
    '.git/hooks/post-commit': "#!/bin/sh\ntouch -d '2001-01-01 00:00:00' b.txt\ncp .git/index .git/index.after\n",
  });
  fs.chmodSync(path.join(dir, '.git/hooks/post-commit'), 0o755);
  const r = commit(dir, ['a.txt'], '47.8: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(fs.readFileSync(path.join(dir, '.git/index')).equals(fs.readFileSync(path.join(dir, '.git/index.after'))), 'индекс переписан после коммита');
});

// Хук pre-commit сам сдвигает HEAD коммитом с сообщением msg (родитель — прежний HEAD), печатает «index.lock» и падает:
// так git commit «упал на замке», а коммит уже есть. Каждый запуск хука — строка в .git/hook-runs.
function movingHook(dir, msg) {
  writeFiles(dir, {
    '.git/hooks/pre-commit': '#!/bin/sh\necho run >> .git/hook-runs\nunset GIT_INDEX_FILE\n'
      + `T=$(git rev-parse HEAD^{tree}); C=$(printf '%s\\n' '${msg}' | git commit-tree $T -p HEAD); git update-ref HEAD $C\n`
      + "echo \"fatal: Unable to create '.git/index.lock': File exists.\" >&2\nexit 1\n",
  });
  fs.chmodSync(path.join(dir, '.git/hooks/pre-commit'), 0o755);
  return () => fs.readFileSync(path.join(dir, '.git/hook-runs'), 'utf8').split('\n').filter(Boolean).length;
}

test('git commit упал на index.lock, а HEAD сдвинул коммит с нашим сообщением и родителем — код 3 со сводкой коммита, без повтора (47.8в, раунд 1)', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const before = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const runs = movingHook(dir, '47.8: a');
  const r = commit(dir, ['a.txt'], '47.8: a\n');
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.equal(runs(), 1, 'git commit не повторялся');
  assert.equal(count(dir), 2, 'второго коммита нет');
  const now = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  assert.match(r.stdout, new RegExp('^' + now + ' 47\\.8: a$', 'm'), 'сводка git show --stat');
  assert.match(r.stdout, /повтор не выполнен/);
  assert.ok(r.stdout.includes(before), 'прежний HEAD назван');
  assert.doesNotMatch(r.stdout, /проверь git log/);
});

test('git commit упал, а HEAD сдвинул чужой коммит (другое сообщение) — код 2 «наш не создан», без повтора (47.8в, раунд 1)', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const runs = movingHook(dir, 'соседняя сессия');
  const r = commit(dir, ['a.txt'], '47.8: a\n');
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(runs(), 1);
  assert.match(r.stdout, /HEAD сдвинул чужой коммит, наш не создан/);
  assert.equal(count(dir), 2);
  assert.equal(lastMessage(dir), 'соседняя сессия\n');
});
