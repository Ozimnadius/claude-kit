# План этапа 28 — коммит шага скриптом `kit-commit.js` вместо агента git-keeper

## Чек-лист

- [x] 28.1 — скрипт `kit-commit.js` и тесты
- [x] 28.2 — `/kit:step-done` и `/kit:project-init` на скрипте, агент git-keeper удалён
- [x] 28.3 — спек плагина, README и обзор
- [ ] 28.4 — выпуск 2.14.0

> Каждая задача — шаг kit, закрывается `/kit:step-done`; остановка на проверку пользователя — после каждой. Строки чек-листа отмечает docs-keeper. Исполнение — superpowers:executing-plans или subagent-driven-development; сам superpowers не коммитит.

**Цель:** сообщение коммита попадает в git ровно таким, каким его составил основной агент (баг К54); коммит шага делает программа, а не модель.

**Архитектура:** node-скрипт `plugins/kit/scripts/kit-commit.js` повторяет порядок агента git-keeper 2.13.0 (проверка путей → `git add` → проверка секретов → один коммит → самопроверка), но сообщение берёт из stdin и передаёт в `git commit -F -` без оболочки. `/kit:step-done` и `/kit:project-init` вызывают его одной командой Bash с heredoc `<<'KIT_MSG'`; агент удаляется.

**Технологии:** Node.js (только встроенные модули), `node:test`, git, `secret-scan.js` плагина.

**Спек:** `.claude/docs/work/spec-commit.md`

## Общие ограничения

- Файлы — UTF-8 без BOM, LF; файлы целиком не переформатировать.
- Тексты плагина, вывод скрипта, комментарии — по-русски; имена в коде — латиницей.
- Репозиторий публичный: в файлах и сообщениях коммитов — только обезличенно (alpha, beta…, `*.example.com`, `user100`, `203.0.113.x`, `C:\Users\user`).
- Перед каждым коммитом: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Один проверенный шаг — один коммит `28.N: …`; исправления после ревью — `28.Nа`, `28.Nб`, без amend.
- Коды скрипта: 0 — коммит сделан и проверен; 1 — остановила проверка путей или секретов, коммита нет; 2 — ошибка запуска, git или хука, коммита нет; 3 — коммит есть, самопроверка нашла расхождение.
- Запреты скрипта: никаких `reset`, `restore`, `rm --cached`, `amend`, `push`, `git add` без путей, `--no-verify`; при остановке индекс остаётся как есть (К53).

## На что смотреть при ревью

- Хук git (`pre-commit`, `commit-msg`, в этом репозитории — kit-denylist) отклонил коммит → код 2, коммита нет, добавленные файлы остаются в индексе (тест в задаче 28.1).
- Сообщение с `\r\n` (пришло из PowerShell, а не из Bash) → в коммите LF, самопроверка проходит (тест в задаче 28.1).
- Сообщение забыли передать (нет heredoc, stdin пуст или это терминал) → код 2 сразу, без зависания и без `git add` (тест в задаче 28.1).
- Опечатка в пути (файла нет и он не в git) → `git add` падает, код 2, коммита нет (тест в задаче 28.1).
- Путь с пробелом и кириллицей, путь-папка `Документы/` → коммит проходит, самопроверка путей считает папку покрывающей файлы внутри (тест в задаче 28.1).

---

### Задача 28.1: скрипт `kit-commit.js` и тесты

**Файлы:**
- Создать: `plugins/kit/scripts/kit-commit.js`
- Создать: `tests/kit-commit.test.js`
- Документы этапа: `.claude/docs/work/spec-commit.md`, `.claude/docs/work/plan-commit.md` (уже написаны — в коммит шага и строками DOCS)

**Интерфейсы:**
- Использует: `plugins/kit/scripts/secret-scan.js` (`--paths -- <пути>`, `--cached -- <пути>`; коды 0/1/2), `norm` из `plugins/kit/scripts/lib/paths.js` (`\` → `/`, без `./` и `/` в начале).
- Даёт: CLI `node kit-commit.js -- <пути…>` с сообщением в stdin; `module.exports = { main, parseArgs, cleanMessage }`, где `main(argv: string[], input: string): number` (код), `parseArgs(argv) → { paths: string[] } | { error: string }`, `cleanMessage(text: string): string` (как чистка git `--cleanup=whitespace`: без `\r`, пробелов в концах строк, повторных пустых строк, пустых строк в начале и конце; непустое — с `\n` в конце, пустое — `''`).

Шаг 1. Написать тесты `tests/kit-commit.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { cleanMessage, parseArgs } = require('../plugins/kit/scripts/kit-commit');

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
  assert.deepEqual(parseArgs(['--', './a.txt', 'Документы/', 'b\\c.txt']), { paths: ['a.txt', 'Документы', 'b/c.txt'] });
  assert.match(parseArgs([]).error, /нет путей/);
  assert.match(parseArgs(['--x', '--', 'a']).error, /неизвестные аргументы/);
  assert.match(parseArgs(['--']).error, /пуст/);
  assert.match(parseArgs(['--', '.']).error, /«\.»/);
});
```

Шаг 2. Запустить: `node --test tests/kit-commit.test.js` — падают все: `Cannot find module '../plugins/kit/scripts/kit-commit'`.

Шаг 3. Написать `plugins/kit/scripts/kit-commit.js`:

```js
#!/usr/bin/env node
'use strict';
// Один коммит проверенного шага (с 2.14.0, вместо агента git-keeper; К54 — модель искажала слова в сообщении).
// Запуск в корне проекта, из Bash; сообщение — heredoc с кавычками, он ничего не подставляет:
//   node kit-commit.js -- <путь1> <путь2> … <<'KIT_MSG'
//   28.1: заголовок
//
//   тело
//
//   Co-Authored-By: …
//   KIT_MSG
// Порядок: secret-scan --paths → git add → secret-scan --cached → git commit -F - -- <пути> → самопроверка.
// Код 0 — коммит сделан и проверен; 1 — остановила проверка путей или секретов, коммита нет;
// 2 — ошибка запуска, git или хука, коммита нет; 3 — коммит есть, самопроверка нашла расхождение.
// Индекс при остановке не трогается (К53): reset, restore, rm --cached, amend, push — не выполняются.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { norm } = require('./lib/paths');

const SCAN = path.join(__dirname, 'secret-scan.js');

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: input || '', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 2, stdout: '', out: r.error.message };
  return { code: r.status, stdout: r.stdout || '', out: ((r.stdout || '') + (r.stderr || '')).trimEnd() };
}
const git = (args, input) => run('git', ['-c', 'core.quotepath=false', ...args], input);
const scan = (args) => run(process.execPath, [SCAN, ...args]);
const lines = (s) => s.split('\n').map((l) => norm(l.trim())).filter(Boolean);

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0) return { error: 'нет путей: node kit-commit.js -- <пути…> <<\'KIT_MSG\'' };
  if (sep > 0) return { error: 'неизвестные аргументы: ' + argv.slice(0, sep).join(' ') };
  const paths = argv.slice(sep + 1).map((p) => norm(p).replace(/\/+$/, '')).filter(Boolean);
  if (!paths.length) return { error: 'список файлов пуст — коммитить нечего' };
  if (paths.includes('.')) return { error: 'путь «.» не принимается — перечисли файлы шага' };
  return { paths };
}

// Как git --cleanup=whitespace: без \r и пробелов в концах строк, повторные пустые строки — одной,
// без пустых строк в начале и конце.
function cleanMessage(text) {
  const out = [];
  for (const l of String(text).replace(/\r/g, '').split('\n').map((s) => s.replace(/\s+$/, ''))) {
    if (l === '' && (!out.length || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}

function samePath(a, b) {
  const real = (p) => {
    let r = path.resolve(p);
    try { r = fs.realpathSync.native(r); } catch { /* как есть */ }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return real(a) === real(b);
}

function stop(code, ...msg) {
  console.log(msg.filter(Boolean).join('\n'));
  return code;
}

function main(argv, input) {
  const a = parseArgs(argv);
  if (a.error) return stop(2, 'kit-commit: ' + a.error);
  const message = cleanMessage(input);
  if (!message) return stop(2, "kit-commit: сообщение коммита пустое — передай его в stdin (heredoc <<'KIT_MSG')");

  const top = git(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return stop(2, top.out, 'kit-commit: не репозиторий git');
  if (!samePath(top.stdout.trim(), process.cwd())) {
    return stop(2, `kit-commit: запусти из корня репозитория (${top.stdout.trim()}), а не из ${process.cwd()}`);
  }
  const before = git(['rev-parse', '--verify', '-q', 'HEAD']).stdout.trim(); // '' — первый коммит

  let r = scan(['--paths', '--', ...a.paths]);
  if (r.code === 1) return stop(1, r.out, 'kit-commit: стоп — запрещённые пути, ничего не добавлено');
  if (r.code !== 0) return stop(2, r.out, 'kit-commit: secret-scan.js --paths не отработал');

  const deleted = new Set(lines(git(['diff', '--cached', '--name-only', '--diff-filter=D']).stdout));
  const toAdd = a.paths.filter((p) => !deleted.has(p));
  if (toAdd.length) {
    r = git(['add', '-A', '--', ...toAdd]);
    if (r.code !== 0) return stop(2, r.out, 'kit-commit: git add не прошёл, коммита нет');
  }

  r = scan(['--cached', '--', ...a.paths]);
  if (r.code !== 0) {
    const why = r.code === 1 ? 'стоп — найдены секреты' : 'secret-scan.js --cached не отработал';
    return stop(r.code === 1 ? 1 : 2, r.out,
      `kit-commit: ${why}, коммита нет. Индекс оставлен как есть:`, git(['diff', '--cached', '--name-only']).out);
  }

  r = git(['commit', '-q', '--cleanup=whitespace', '-F', '-', '--', ...a.paths], message);
  if (r.code !== 0) return stop(2, r.out, 'kit-commit: git commit не прошёл, коммита нет');

  const problems = [];
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(/\s+/).slice(1);
  if (parents.join(' ') !== before) problems.push(`новых коммитов не один: родитель ${parents.join(' ') || 'нет'}, был HEAD ${before || 'нет'}`);
  const raw = git(['cat-file', 'commit', 'HEAD']).stdout;
  const stored = raw.slice(raw.indexOf('\n\n') + 2);
  if (stored !== message) problems.push('сообщение в коммите отличается от поданного:\n--- подано\n' + message + '--- в коммите\n' + stored);
  const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']).stdout);
  const extra = files.filter((f) => !a.paths.some((p) => f === p || f.startsWith(p + '/')));
  if (extra.length) problems.push('в коммите файлы сверх переданных: ' + extra.join(', '));

  const stat = git(['show', '--stat', '--format=%h %s', 'HEAD']).out.split('\n');
  const report = [stat[0], ...(stat.length <= 22 ? stat.slice(1) : [stat[stat.length - 1]])];
  const status = git(['status', '--short']).out;
  console.log([...report, 'git status --short:', status || '(чисто)'].join('\n'));
  if (problems.length) return stop(3, 'kit-commit: коммит создан, но самопроверка нашла расхождение:', ...problems);
  return stop(0, 'kit-commit: сообщение совпало с поданным, в коммите только переданные пути');
}

if (require.main === module) {
  let input = '';
  try { if (!process.stdin.isTTY) input = fs.readFileSync(0, 'utf8'); } catch { /* stdin закрыт или пуст */ }
  try {
    process.exitCode = main(process.argv.slice(2), input);
  } catch (e) {
    console.log('kit-commit: ' + e.message);
    process.exitCode = 2;
  }
}

module.exports = { main, parseArgs, cleanMessage };
```

Шаг 4. Запустить: `node --test tests/kit-commit.test.js` — все 13 тестов проходят. Не проходит — чинить скрипт, а не ослаблять тест (тест опирается на проверенное поведение git: `git commit -F - -- <пути>` работает и для первого коммита, и для пути, уже помеченного удалённым; чужой файл в индексе остаётся).

Шаг 5. Полная проверка: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.

Шаг 6. Закрыть шаг `/kit:step-done 28.1` (коммит ещё через установленный 2.13.0 и его git-keeper): STAGE `28 — коммит шага скриптом вместо агента git-keeper (начат 2026-10-05)`; DOCS — `work/spec-commit.md — спек этапа 28: коммит шага скриптом kit-commit.js вместо агента git-keeper (К54) — в работе, этап 28` и `work/plan-commit.md — план этапа 28 (задачи 28.1–28.4) — в работе, этап 28`; DECISIONS — подход «скрипт вместо агента» (отвергнуто: сообщение файлом при агенте; git-keeper на sonnet; агент запасным); FILES — скрипт, тест, спек, план, файлы docs-keeper.

---

### Задача 28.2: `/kit:step-done` и `/kit:project-init` на скрипте, агент git-keeper удалён

**Файлы:**
- Изменить: `plugins/kit/skills/step-done/SKILL.md` (описание в заголовке, п. 1.3, п. 4, п. 5, «Если агенты не подхватились»)
- Изменить: `plugins/kit/skills/project-init/SKILL.md` (п. 3 «Варианта «это не секрет» нет», п. 4 первый коммит, проектные копии агентов)
- Удалить: `plugins/kit/agents/git-keeper.md`
- Изменить: `plugins/kit/scripts/session-start.js` (строки 15–16), `plugins/kit/skills/project-init/templates/CLAUDE.md` (строка 35), `plugins/kit/skills/server/SKILL.md` (строка 97), `plugins/kit/skills/project-init/reference/bitrix.md` (строка 24), `plugins/kit/agents/docs-keeper.md` (строка 97 и описание), `plugins/kit/scripts/secret-scan.js` (комментарий строки 9), `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json` (описание: «агенты docs-keeper и git-keeper» → «агент docs-keeper, коммит скриптом»), `README.md` (строки 34, 41, 136, 149, 171)
- Тесты: `tests/content.test.js` (тест «git-keeper: …» заменить тестом скилла на скрипт; список строк step-done), `tests/session-start.test.js` и `tests/templates.test.js` — если проверяют старые строки

**Интерфейсы:**
- Использует: CLI `node "${CLAUDE_PLUGIN_ROOT}/scripts/kit-commit.js" -- <пути…> <<'KIT_MSG'` и коды 0–3 из задачи 28.1.
- Даёт: новый текст п. 4–5 `/kit:step-done`, на который опираются `/kit:project-init` и правила хука.

Шаг 1. Тесты текстов в `tests/content.test.js`: тест `git-keeper: haiku, …` удалить; в тест `step-done: …` вместо `'kit:git-keeper'`, `'COAUTHOR'`, `'KIT_ROOT'`, `'совпадает с MESSAGE целиком'`, `'git log -1 --format=%s'` проверять строки нового текста: `'scripts/kit-commit.js" --'`, `"<<'KIT_MSG'"`, `'KIT_MSG'` (терминатор), `'Co-Authored-By'`, `'Код 3'`, `'Сам коммит не делай'`, `'rev-list --count'`; добавить проверки: `assert.ok(!fs.existsSync(path.join(PLUGIN, 'agents', 'git-keeper.md')))`; в файлах `plugins/kit` (обход папки) нет `kit:git-keeper`, а слово `git-keeper` встречается только в `skills/project-init/SKILL.md` (старая проектная копия); в `project-init` есть `kit-commit.js` и `.claude/agents/git-keeper.md` (предложение удалить старую копию). Запустить `node --test tests/content.test.js` — новые проверки падают.

Шаг 2. `step-done/SKILL.md`, п. 4 — заменить раздел целиком:

````markdown
## 4. Коммит

Один коммит шага — скриптом, одной командой **Bash** (не PowerShell) из корня проекта. Сообщение — heredoc с кавычками `<<'KIT_MSG'`: Bash вставляет текст как есть, `$`, обратные кавычки и `\` не подставляются, перепечатки нет.
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/kit-commit.js" -- "<путь1>" "<путь2>" … <<'KIT_MSG'
<STEP>: <суть шага одной строкой>

<CHECK дословно>

<строка Co-Authored-By>
KIT_MSG
```
- Пути: файлы шага из п. 1.3, файлы из отчёта docs-keeper, старые и новые пути документов, перенесённых в архив; каждый — отдельным аргументом в двойных кавычках, как их выводит `git -c core.quotepath=false status --porcelain=v1`.
- Строка `Co-Authored-By: …` — из твоих собственных системных инструкций о подписи коммитов, дословно; таких инструкций нет — строки и пустой строки перед ней нет.
- Скрипт сам проверяет запрещённые пути и секреты (`secret-scan.js`), добавляет только эти пути, делает один коммит и сверяет сообщение коммита с поданным побайтно.

Код 0 — коммит сделан. Код 1 — остановила проверка путей или секретов: покажи вывод пользователю (значения замаскированы), индекс скрипт оставил как есть — после исправления запусти ту же команду. Код 2 — ошибка (git, хук, неверный путь): покажи вывод, коммита нет. Код 3 — коммит есть, но самопроверка нашла расхождение: покажи вывод, историю не чини.
````

Шаг 3. `step-done/SKILL.md`, п. 5 — заменить список проверок:

````markdown
## 5. Проверка

```
git rev-list --count <HEAD из п. 1.2>..HEAD
git -c core.quotepath=false status --porcelain=v1
```
- код скрипта 0, новых коммитов ровно **1**;
- файлов шага в статусе больше нет.

Сообщение побайтно сверил скрипт (строка «сообщение совпало с поданным»); заголовок для ответа пользователю — первая строка его отчёта.
````
Абзац «Что-то не так …» — без MESSAGE и git-keeper: «Что-то не так (код скрипта не 0, 0 или 2 коммита, лишние файлы) — входящие не трогай и сообщи пользователю, что именно и какие команды это показали. Историю сам не чини: никаких `reset`, `amend`, `rebase`. Сам коммит в обход скрипта не делай ни при каких обстоятельствах: сообщи о проблеме и остановись.» В п. 1.3 «Пути, которые git-keeper не пропустит» → «Пути, которые скрипт коммита не пропустит». В описании (frontmatter) «ровно один коммит делает агент kit:git-keeper» → «ровно один коммит делает скрипт kit-commit.js». Раздел «Если агенты не подхватились»: «Типа агента `kit:docs-keeper` нет — запусти агента general-purpose: в запрос — полный текст файла `${CLAUDE_PLUGIN_ROOT}/agents/docs-keeper.md` без заголовка `---` и те же блоки; модель — `sonnet`.»

Шаг 4. `project-init/SKILL.md`:
- п. 3: «git-keeper повторит скан по индексу» → «скрипт коммита повторит скан по индексу»;
- п. 4: «Первый коммит — скриптом `kit-commit.js`, как в `/kit:step-done` (п. 4): пути — так, как их выводит `git -c core.quotepath=false status --porcelain` (без `?? ` и без кавычек), кроме `.claude/` (и `docs/` при старой раскладке); первая строка сообщения `0.1: Исходники с прода (копия прода)` (если исходники скачаны с дева — `0.1: Исходники с дева (копия прода)`), подпись — как в `/kit:step-done`. Проверка: код 0, `git rev-list --count HEAD` = 1. Код не 0 — покажи вывод пользователю и остановись: сам не коммить, `git add` не выполняй, индекс не чини.»;
- проектные копии: «Проектные копии `.claude/agents/docs-keeper.md` / `git-keeper.md` — предложи удалить: docs-keeper приходит из плагина (`kit:docs-keeper`), git-keeper больше не нужен — коммит делает скрипт `kit-commit.js` (с 2.14.0) …» (блок DEPLOY — без изменений).

Шаг 5. Удалить `plugins/kit/agents/git-keeper.md`. Остальные упоминания (список файлов выше) — заменить по смыслу: в `session-start.js` — `'- После проверенного шага — /kit:step-done (docs-keeper → kit-commit.js, один коммит на шаг).'` и `'- Git пользователь не трогает, команды git ему не выдаём; коммиты — только через /kit:step-done (скрипт kit-commit.js).'`; в шаблоне `CLAUDE.md` — «`kit:docs-keeper` обновляет журнал и план выкладки, скрипт `kit-commit.js` делает один коммит»; в README — строку таблицы агента `kit:git-keeper` заменить строкой инструмента `kit-commit.js` («из `/kit:step-done` и `/kit:project-init` | один коммит, проверка путей и секретов, сообщение побайтно»), строку 171 — «удалить проектные `.claude/agents/docs-keeper.md` и `git-keeper.md`: docs-keeper приходит из плагина, коммит делает скрипт». Проверка: `grep -rn "git-keeper" plugins README.md` — только упоминание старой проектной копии в `project-init` и строка README про её удаление.

Шаг 6. `npm test`, обе `claude plugin validate … --strict` — без ошибок.

Шаг 7. Закрыть шаг `/kit:step-done 28.2` по **новому** тексту п. 4 из репозитория: коммит — `node plugins/kit/scripts/kit-commit.js -- … <<'KIT_MSG'` (живая проверка; в сообщении — «спек» и обратные кавычки); docs-keeper — установленный.

---

### Задача 28.3: спек плагина, README и обзор

**Файлы:**
- Изменить: `.claude/docs/work/spec-claude-kit.md` — §2 (решение: коммит скриптом с 2.14.0), §4 (структура: без `agents/git-keeper.md`, с `scripts/kit-commit.js`), §6.2 — заменить на «агент удалён в 2.14.0, коммит — `kit-commit.js` (§9)», §7.1 и §7.3 (п. 4 и первый коммит), §9 — раздел инструмента `kit-commit.js` (вызов, порядок, коды 0–3, К54), §11 (проверка); остальные упоминания git-keeper — по смыслу (поиск `git-keeper`).
- Изменить: `.claude/docs/work/overview/build/diagrams.js` — карта: в колонке `/kit:step-done` вместо `['ag', 'git-keeper (haiku)']` — `['m', 'kit-commit.js']`, в колонке `/kit:project-init` — `['s', '+ kit-commit.js: коммит 0.1']`; схема `stepDone()`: участник `kit:git-keeper` заменить на `kit-commit.js` (скрипт), сообщения `FILES · MESSAGE · BODY · COAUTHOR · KIT_ROOT` → `-- <пути> <<'KIT_MSG'`, `хеш · файлы · подпись` → `код 0 · хеш · «сообщение совпало»`, `commit -m '…' -- FILES (из Bash)` → `commit -F - -- <пути>`, `проверка: 1 коммит, заголовок и тело = переданным` → `проверка: 1 коммит, статус`; текст-описание схемы — без git-keeper.
- Изменить: `.claude/docs/work/overview/build/build.js` — упоминания git-keeper в тексте (поиск), шапка: версия 2.14.0, число агентов 1, node-скриптов 18.
- Пересобрать: `node .claude/docs/work/overview/build/build.js` → `overview.md`, `overview.html`, `img/*.svg`.

Шаг 1. Правки спека; проверка — `grep -n "git-keeper" .claude/docs/work/spec-claude-kit.md`: остаются только исторические упоминания (§2 решения прошлых этапов, §6.2 «удалён в 2.14.0»).

Шаг 2. Правки `diagrams.js` и `build.js`, пересборка; открыть `overview.html` во встроенном браузере: подписи схем не вылезают из блоков, карта и схема `/kit:step-done` без git-keeper.

Шаг 3. README — абзац о коммите (раздел «Как это работает» или аналогичный): сообщение коммита передаётся скрипту как есть.

Шаг 4. `npm test`, обе проверки `validate`; `/kit:step-done 28.3` — коммит новым скриптом из репозитория.

---

### Задача 28.4: выпуск 2.14.0

**Файлы:**
- Изменить: `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json` — `version` 2.13.0 → 2.14.0.

Шаг 1. Поднять версию в обоих файлах; `npm test`, обе проверки `validate`; `node tools/kit-denylist.js tree` — код 0.

Шаг 2. `/kit:step-done 28.4` — этап 28 закрывается: сверка с этим спеком и планом (Т-1…Т-9, задачи 28.1–28.4), перенос `spec-commit.md` и `plan-commit.md` в `archive/` (с выбора пользователя), К54 → «✅ исправлен на шаге 28.1–28.2» (BUGS), `journal-split.js --stage 28`; коммит — новым скриптом из репозитория.

Шаг 3. С согласия пользователя (AskUserQuestion): `git push origin master`, затем `claude plugin marketplace update claude-kit` и `claude plugin update kit@claude-kit`; проверить, что в кэше `~/.claude/plugins/cache/claude-kit/kit/2.14.0` есть `scripts/kit-commit.js` и нет `agents/git-keeper.md`. Сказать пользователю, что новая версия заработает после перезапуска сессии.
