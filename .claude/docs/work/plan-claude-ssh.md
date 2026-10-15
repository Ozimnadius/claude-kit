# План этапа 32 — выкладка «Claude по SSH» и один сервер на проект (прод или дев)

## Чек-лист

- [x] 32.1 — сервер по «Окружению»: `serverEnv`, `remote-php.js`, `kit-exec.js`, `/kit:visual`, `/kit:server`; спек и план этапа
- [x] 32.2 — `lib/deploy.js`: база по окружению и по ID шага, список с рабочей папкой; `deploy-list.js` на нём
- [x] 32.3 — скрипт заливки `ssh-deploy.js`, тесты через локальный `sh`, живая проверка в тестовой папке на сервере
- [x] 32.4 — `/kit:project-init` и шаблоны: окружение прод/дев, один сервер, три варианта выкладки
- [ ] 32.5 — `/kit:step-done` в порядке SSH, docs-keeper («Залито на дев», COMMITS по «Шаг»), `/kit:deploy-list`, `/kit:report`
- [ ] 32.6 — хук `session-start.js`: правило SSH, предупреждение об автозаливке, автозаливка на дев
- [ ] 32.7 — выпуск 2.17.0: версии, спек плагина, README, обзор, `MyIdeas.md`

> Каждая задача — шаг kit, закрывается `/kit:step-done`; остановка на проверку пользователя — после каждой. Строки чек-листа отмечает docs-keeper. Исполнение — superpowers:executing-plans или subagent-driven-development; сам superpowers не коммитит.

**Цель:** в проекте с SSH Claude сам заливает правки шага на сервер — после просмотра пользователем, без PhpStorm и без ручной заливки списком; в историю git попадают только шаги, проверенные на сервере. У проекта один сервер — прод или дев.

**Архитектура:** «Окружение» выбирает сервер (`serverEnv` в `lib/project.js`) — его по умолчанию берут все скрипты с `--env`. Общая логика выкладки (что не выкладывать, база «что уже на сервере», список изменений) — в `lib/deploy.js`; на ней `deploy-list.js` (только показывает) и новый `ssh-deploy.js` (заливает одним подключением SSH: сценарий `sh` на stdin через `runSsh` из `lib/ssh.js`). `/kit:step-done` в режиме «Claude по SSH» меняет порядок: просмотр → заливка → проверка на сервере → docs-keeper → коммит.

**Технологии:** Node.js (только встроенные модули), `node:test`, git, OpenSSH (`ssh`), на сервере — `sh`, `base64`, `md5sum`.

**Спек:** `.claude/docs/work/spec-claude-ssh.md`

## Общие ограничения

- Файлы — UTF-8 без BOM, LF; файлы целиком не переформатировать.
- Тексты плагина, вывод скриптов, комментарии — по-русски; имена в коде — латиницей.
- Репозиторий публичный: в файлах, тестах и сообщениях коммитов — только обезличенно (alpha, beta…, `*.example.com`, `user100`, `203.0.113.x`, `C:\Users\user`); живая проверка (32.3) — хост и папку пользователя в журнал и коммит не писать.
- Перед каждым коммитом: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Один проверенный шаг — один коммит `32.N: …` через `/kit:step-done`; исправления после ревью — `32.Nа`, `32.Nб`, без amend.
- Frontmatter скиллов: значение с «: » — только в кавычках (тест К39); в описаниях писать «в режиме «Claude по SSH»», а не «Выкладка: Claude по SSH».
- Старые значения работают как до 2.17.0: `Окружение: дев+прод` — сервер по умолчанию прод; `Выкладка: вручную; дев — PhpStorm Always` — как раньше.
- Коды `ssh-deploy.js`: 0 — залито и сверено (или нечего); 1 — часть не вышла; 2 — SSH не задан или параметр неверный; 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, недопустимый путь (на сервер ничего не ушло).

## На что смотреть при ревью

- Строка «Залито на прод» без хеша при **ручной** выкладке → по-прежнему пропускается, база — строка выше (иначе файлы между заливкой и записью выпали бы из списка); поиск по ID — только при «Claude по SSH» (тест в задаче 32.2).
- ID шага — префикс другого (`32.1` и `32.10`) → коммит ищется по точному `<ID>: ` (тест в задаче 32.2).
- Путь с одинарной кавычкой, пробелом и кириллицей, двоичный файл с `\r\n` → на «сервере» побайтно то же (тест в задаче 32.3).
- Сервер ответил не на все файлы (обрыв посреди вывода, нет строки `KIT_PUT`) → «результат неизвестен», код 1, строки DEPLOY нет (тест в задаче 32.3).
- Зависший сервер → код 3 по `--timeout`, без зависания тестов и инструмента Bash (тест в задаче 32.3).

---

### Задача 32.1: сервер по «Окружению»

**Файлы:**
- Изменить: `plugins/kit/scripts/lib/project.js` — функция `serverEnv`
- Изменить: `plugins/kit/scripts/remote-php.js` — `--env` по умолчанию из «Окружения»
- Изменить: `plugins/kit/scripts/kit-exec.js` — то же
- Изменить: `plugins/kit/scripts/lib/visual/config.js` — `siteBase`
- Изменить: `plugins/kit/scripts/visual.js` — `env` в `meta.json`
- Изменить: `plugins/kit/skills/server/SKILL.md` (раздел 1, п. 1), `plugins/kit/skills/visual/SKILL.md` (строка «Адрес сайта»)
- Тесты: `tests/lib.test.js`, `tests/remote-php.test.js`, `tests/kit-exec.test.js`, `tests/visual-config.test.js`
- Документы шага: `.claude/docs/work/spec-claude-ssh.md`, `.claude/docs/work/plan-claude-ssh.md` (уже записаны — в FILES и DOCS)

**Интерфейсы:**
- Даёт: `serverEnv(params) → 'дев' | 'прод'` из `lib/project.js` — `'дев'` только при значении «Окружение» ровно `дев` (регистр и обратные кавычки не важны), иначе `'прод'`. Берут задачи 32.2, 32.3, 32.6.

**Шаг 1. Тесты (должны упасть).**

`tests/lib.test.js` — в импорт из `lib/project` добавить `serverEnv`, из `lib/params` — `makeParams`, и тест:

```js
test('serverEnv: «дев» — дев; «прод», старое «дев+прод» и нет параметра — прод (с 2.17.0)', () => {
  assert.equal(serverEnv(makeParams({ 'окружение': 'дев' })), 'дев');
  assert.equal(serverEnv(makeParams({ 'окружение': '`Дев`' })), 'дев');
  assert.equal(serverEnv(makeParams({ 'окружение': 'прод' })), 'прод');
  assert.equal(serverEnv(makeParams({ 'окружение': 'дев+прод' })), 'прод');
  assert.equal(serverEnv(makeParams({})), 'прод');
  assert.equal(serverEnv(makeParams(null)), 'прод');
});
```

`tests/remote-php.test.js`:

```js
test('remote-php: «Окружение: дев» — без --env берётся «SSH дев»; --env прод перекрывает; «дев+прод» — прод (с 2.17.0)', () => {
  const dev = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: общий', '- Окружение: дев', '- Прод: —', '- SSH прод: —',
    '- Дев: https://dev.example.com', '- SSH дев: devhost:/var/www/dev']) });
  const r = run(dev, ['a.php'], { FAKE_SSH_OUT: 'ok' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.sent.host, 'devhost');
  const prod = run(dev, ['--env', 'прод', 'a.php'], { FAKE_SSH_OUT: 'ok' });
  assert.equal(prod.code, 2);
  assert.match(prod.stderr, /SSH прод/);
  const old = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: общий', '- Окружение: дев+прод',
    '- SSH прод: prodhost:/var/www/p', '- SSH дев: devhost:/var/www/d']) });
  assert.equal(run(old, ['a.php'], { FAKE_SSH_OUT: 'ok' }).sent.host, 'prodhost');
});
```

`tests/kit-exec.test.js` (без PHP — адрес проверяется до `php -l`):

```js
test('kit-exec.js: «Окружение: дев» — адрес из «Дев» без --env (с 2.17.0)', () => {
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const dev = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Окружение: дев', '- Прод: https://x.ru', '- Дев: —']) });
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: dev });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /нет адреса сервера «дев» \(параметр «Дев»/);
});
```

`tests/visual-config.test.js`:

```js
test('siteBase: «Окружение: дев» — адрес из «Дев» без --env; --env прод перекрывает; «дев+прод» — прод (с 2.17.0)', () => {
  const params = makeParams({ 'окружение': 'дев', 'прод': '—', 'дев': 'https://dev.example.com/' });
  assert.equal(siteBase(params), 'https://dev.example.com');
  assert.throws(() => siteBase(params, { env: 'прод' }), code2(/«Прод»/));
  const old = makeParams({ 'окружение': 'дев+прод', 'прод': 'https://p.example.com', 'дев': 'https://d.example.com' });
  assert.equal(siteBase(old), 'https://p.example.com');
});
```

**Шаг 2. Запуск — тесты падают.**
`node --test tests/lib.test.js tests/remote-php.test.js tests/kit-exec.test.js tests/visual-config.test.js` — новые 4 теста FAIL (`serverEnv is not a function`, хост `undefined`, «Прод» вместо «Дев»).

**Шаг 3. Код.**

`lib/project.js` — перед `module.exports`, и `serverEnv` — в экспорт:

```js
// Сервер проекта (с 2.17.0 проект ведёт один сервер — прод или дев): «Окружение: дев» — дев; «прод», старое «дев+прод»
// и нет параметра — прод, как раньше. По нему скрипты с --env выбирают сервер по умолчанию.
function serverEnv(params) {
  return /^дев$/i.test(String(params.get('Окружение', '')).trim()) ? 'дев' : 'прод';
}
```

`remote-php.js`:
- импорт: `const { serverEnv } = require('./lib/project');`;
- `parseArgs`: `const o = { env: null, mode: null, file: null };` и проверка `if (o.env !== null && o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');`;
- `main`, сразу после `const params = readParams(…)`: `if (!o.env) o.env = serverEnv(params);`;
- комментарий в шапке: `--env` — сервер, по умолчанию — по «Окружению» (дев — только при «Окружение: дев»).

`kit-exec.js` — так же: импорт `serverEnv`, `const o = { env: null, file: null, bitrix: false };`, проверка `o.env !== null && …`, в `main` после `const params = readParams(…)` — `if (!o.env) o.env = serverEnv(params);`.

`lib/visual/config.js` — импорт `const { serverEnv } = require('../project');`, в `siteBase`:

```js
  const key = (env || serverEnv(params)) === 'дев' ? 'Дев' : 'Прод';
```

и комментарий над функцией: «Адрес сайта: --url, иначе по «Окружению» — «Прод» или «Дев» (--env перекрывает)».

`visual.js` — импорт `const { kitInfo, serverEnv } = require('./lib/project');`, в `cmdShoot` (запись `meta.json`): `env: flags.url ? null : flags.env || serverEnv(p.params),`.

`skills/server/SKILL.md`, раздел «1. Сервер и канал», п. 1 — заменить строку целиком:

```
1. Сервер — по параметру «Окружение»: `дев` — дев, иначе прод (так же выбирают `remote-php.js` и `kit-exec.js` без `--env`). Заданы оба SSH (проект до 2.17.0, «дев+прод»), а пользователь не сказал, где выполнять, — спроси через AskUserQuestion.
```

`skills/visual/SKILL.md`, строка «Адрес сайта…» — заменить:

```
Адрес сайта — параметр «Прод», а при «Окружение: дев» — «Дев»; другой сервер — `--env прод|дев`; вне kit-проекта — `--url https://…`.
```

**Шаг 4. Запуск — проходят.**
`node --test tests/lib.test.js tests/remote-php.test.js tests/kit-exec.test.js tests/visual-config.test.js` — PASS; затем `npm test` — все прежние тесты проходят (в `content.test.js` проверь, что `/kit:server` не ищет старую фразу «Сервер — прод»).

**Шаг 5. Проверки и закрытие.**
`claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`. Остановка на проверку пользователя. `/kit:step-done`: STEP `32.1`, STAGE `32 — выкладка «Claude по SSH» и один сервер на проект (прод или дев)`, DOCS — `work/spec-claude-ssh.md — спек этапа 32: выкладка «Claude по SSH», один сервер на проект — в работе, этап 32` и `work/plan-claude-ssh.md — план этапа 32 (задачи 32.1–32.7) — в работе, этап 32`, DECISIONS — из брейнсторминга:
- `2026-10-15 | Заменяет №34 в части «дев + прод»: проект ведёт один сервер — «Окружение: прод | дев»; при деве перенос на прод — вне kit | одновременной заливки не нужно: с дева на прод заливается всё потом, с миграциями | вилка «дев + прод» с вариантами выкладки для каждого сервера | пользователь`
- `2026-10-15 | Старые проекты с «дев+прод» работают как раньше (сервер по умолчанию — прод); повторный /kit:project-init предлагает выбрать прод или дев | без правок существующих проектов | убрать старое значение из кода | пользователь`
- `2026-10-15 | Заливка «Claude по SSH» — одно подключение SSH со сценарием sh (файлы в base64, удаления, сверка md5) на готовой lib/ssh.js | одно подключение, на Windows ничего, кроме ssh, сверка в том же сеансе, повтор безопасен | sftp -b (кириллица в путях на Windows, md5 — вторым подключением); scp по файлу (медленно, без удалений) | пользователь`
- `2026-10-15 | Этап 32 одним этапом: окружение прод/дев и «Claude по SSH» | вопрос о выкладке в project-init переписывается один раз | два этапа (окружение, затем SSH) | пользователь`

---

### Задача 32.2: `lib/deploy.js` и `deploy-list.js` на нём

**Файлы:**
- Создать: `plugins/kit/scripts/lib/deploy.js`
- Изменить: `plugins/kit/scripts/deploy-list.js` — на `lib/deploy.js`, `--env`, пометка «Claude по SSH»
- Тесты: `tests/deploy-lib.test.js` (новый), `tests/deploy-list.test.js`

**Интерфейсы:**
- Берёт: `serverEnv(params)` (32.1), `kitInfo(dir)` (`info.params`, `info.planRel`, `info.docsRel`), `getSection`, `parseTable` из `lib/md.js`, `parseRules`, `matchRules` из `lib/paths.js`.
- Даёт (для 32.3):
  - `ALWAYS_SKIP` — `['.git', '.idea', '/.claude', '/kit-exec.php']`;
  - `skipRules(info) → rules` — как в `deploy-list.js` сейчас;
  - `git(cwd, args) → { ok, out, err }`;
  - `sectionOf(env) → 'Залито на прод' | 'Залито на дев'`;
  - `isSsh(info) → boolean` — «Выкладка» начинается с `Claude по SSH` (регистр не важен);
  - `commitOfStep(cwd, id) → короткий хеш | null` — последний коммит с заголовком `<id>: …`;
  - `baseFromPlan(planPath, env = 'прод', { cwd, byStep = false } = {}) → хеш | null`;
  - `resolveBase(cwd, info, env, baseArg) → { base, short, source } | { error }`;
  - `changes(cwd, base, rules, { worktree = false } = {}) → { upload: [{ status, path }], del: [{ status, path }] }`.

**Шаг 1. Тесты (должны упасть).**

`tests/deploy-lib.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { skipRules, commitOfStep, baseFromPlan, changes, sectionOf } = require('../plugins/kit/scripts/lib/deploy');

const plan = (title, rows) => ['# Выкладка', '', '## ' + title, '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map(([step, commit]) => '| ' + step + ' | 2026-10-15 | a.php | ' + (commit ? '`' + commit + '`' : '') + ' | ок |'), '',
  '## Удалить с сервера', ''].join('\n');

test('sectionOf: таблица по окружению', () => {
  assert.equal(sectionOf('прод'), 'Залито на прод');
  assert.equal(sectionOf('дев'), 'Залито на дев');
});

test('commitOfStep: точный ID до «: » — 32.1 не находит 32.10', () => {
  const dir = gitRepo({ 'a.php': '1' });
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '32.10: десятый');
  assert.equal(commitOfStep(dir, '32.1'), null);
  assert.ok(git(dir, 'rev-parse', 'HEAD').trim().startsWith(commitOfStep(dir, '32.10')));
  assert.equal(commitOfStep(dir, ''), null);
});

test('baseFromPlan: хеш из «Коммит»; пустой — по ID только с byStep; таблица по окружению', () => {
  const dir = gitRepo({ 'a.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.2: правка');
  const step = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const file = path.join(dir, 'plan.md');
  fs.writeFileSync(file, plan('Залито на прод', [['1.1', first], ['1.2', '']]));
  assert.equal(baseFromPlan(file, 'прод'), first, 'без byStep пустая строка пропускается');
  assert.equal(baseFromPlan(file, 'прод', { cwd: dir, byStep: true }), step);
  assert.equal(baseFromPlan(file, 'дев', { cwd: dir, byStep: true }), null, 'таблицы «Залито на дев» нет');
  fs.writeFileSync(file, plan('Залито на дев', [['1.1', first]]));
  assert.equal(baseFromPlan(file, 'дев'), first);
  assert.equal(baseFromPlan(path.join(dir, 'нет.md'), 'прод'), null);
});

test('changes с worktree: незакоммиченное, удалённое и новые файлы; игнорируемое и исключённое — нет; без worktree — только коммиты', () => {
  const dir = gitRepo({ '.gitignore': 'ign/\n', 'a.php': '1', 'b.php': '1', '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH' }) });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2', 'new/с пробелом.php': 'n', 'ign/x.php': 'i', '.claude/docs/x.md': 'd', '.idea/w.xml': 'x' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  const rules = skipRules(kitInfo(dir));
  const wt = changes(dir, base, rules, { worktree: true });
  assert.deepEqual(wt.upload.map((i) => i.path).sort(), ['a.php', 'new/с пробелом.php']);
  assert.deepEqual(wt.del.map((i) => i.path), ['b.php']);
  const committed = changes(dir, base, rules);
  assert.deepEqual(committed.upload, []);
  assert.deepEqual(committed.del, []);
});
```

`tests/deploy-list.test.js` — добавить:

```js
const planFor = (title, rows) => ['# Выкладка', '', '## Общие правила', '', '- тест', '', '## ' + title, '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map(([step, commit]) => '| ' + step + ' | 2026-10-15 | a.php | ' + (commit ? '`' + commit + '`' : '') + ' | ок |'), ''].join('\n');

test('«Окружение: дев» — база из «Залито на дев»; --env прод — из «Залито на прод» (с 2.17.0)', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Окружение': 'дев' }), 'a.php': '1', 'b.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.1: правка a');
  const devBase = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'b.php': '2', '.claude/docs/deploy-prod.md': planFor('Залито на дев', [['1.1', devBase]]) });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: правка b');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + devBase + ' \\(«Залито на дев» в \\.claude/docs/deploy-prod\\.md\\)'));
  assert.match(r.stdout, /Залить \(1\):\n  M b\.php/);
  const prod = runScript('deploy-list.js', { cwd: dir, args: ['--env', 'прод'] });
  assert.match(prod.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.equal(runScript('deploy-list.js', { cwd: dir, args: ['--env', 'тест'] }).code, 1);
});

test('«Claude по SSH»: пустой «Коммит» — коммит шага по ID; пометка «заливает /kit:step-done»; при «вручную» строка пропускается', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH' }), 'a.php': '1', 'b.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2', '.claude/docs/deploy-prod.md': planFor('Залито на прод', [['32.1', '']]) });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '32.1: правка a');
  const step = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'b.php': '2' });
  git(dir, 'commit', '-q', '-am', '32.2: правка b');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + step + ' \\(«Залито на прод»'));
  assert.match(r.stdout, /Claude по SSH — заливает \/kit:step-done/);
  assert.match(r.stdout, /Залить \(1\):\n  M b\.php/);
  writeFiles(dir, { '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную' }) });
  const manual = runScript('deploy-list.js', { cwd: dir });
  assert.match(manual.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.doesNotMatch(manual.stdout, /Claude по SSH/);
});
```

**Шаг 2. Запуск — падают.**
`node --test tests/deploy-lib.test.js tests/deploy-list.test.js` — FAIL (`Cannot find module '…/lib/deploy'`, нет «Залито на дев»).

**Шаг 3. Код.**

`plugins/kit/scripts/lib/deploy.js`:

```js
'use strict';
// Выкладка: что не выкладывать, база («что уже на сервере») и список изменений — для deploy-list.js и ssh-deploy.js.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { docsInClaude } = require('./project');
const { getSection, parseTable } = require('./md');
const { parseRules, matchRules } = require('./paths');

// Как у хука исключений PhpStorm (phpstorm-exclude.js): .claude в корне (правила, документы, скрипты)
// и папка журнала вне .claude (старая docs/) на сервер не выкладываются никогда. Файл-канал /kit:server
// (/kit-exec.php, только в корне) — служебный: его кладёт и удаляет Claude, в списки выкладки он не входит.
const ALWAYS_SKIP = ['.git', '.idea', '/.claude', '/kit-exec.php'];

function skipRules(info) {
  const d = info.docsRel;
  const own = d !== '.' && !docsInClaude(d) && !path.isAbsolute(d) && !d.split('/').includes('..') ? ['/' + d] : [];
  return parseRules([...ALWAYS_SKIP, ...own, ...info.params.list('Не выкладывать')]);
}

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim() };
}

// Таблица отметок о заливке в плане выкладки — по окружению (с 2.17.0).
const sectionOf = (env) => 'Залито на ' + (env === 'дев' ? 'дев' : 'прод');

// «Выкладка: Claude по SSH» — шаг заливает /kit:step-done (ssh-deploy.js).
const isSsh = (info) => /^claude по ssh/i.test(info.params.get('Выкладка', '').trim());

// Последний коммит шага: заголовок «<id>: …» (точно до «: » — 32.1 не находит 32.10).
function commitOfStep(cwd, id) {
  if (!id) return null;
  for (const line of git(cwd, ['log', '--format=%h%x09%s']).out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0 && line.slice(tab + 1).startsWith(id + ': ')) return line.slice(0, tab);
  }
  return null;
}

// База из плана: последняя строка таблицы «Залито на …» с хешем в «Коммит». byStep (режим «Claude по SSH») — пустой
// «Коммит» ищется по ID из «Шаг»: строку пишет тот же шаг, что делает коммит, и его дерево — ровно залитое. При ручной
// выкладке строку без хеша могут записать позже самой заливки — там она пропускается, как раньше.
function baseFromPlan(planPath, env = 'прод', { cwd, byStep = false } = {}) {
  if (!fs.existsSync(planPath)) return null;
  const section = getSection(fs.readFileSync(planPath, 'utf8'), sectionOf(env));
  if (!section) return null;
  const rows = parseTable(section);
  for (let i = rows.length - 1; i >= 0; i--) {
    const hashes = (rows[i]['Коммит'] || '').match(/\b[0-9a-f]{7,40}\b/g);
    if (hashes) return hashes[hashes.length - 1];
    if (byStep && cwd) {
      const c = commitOfStep(cwd, (rows[i]['Шаг'] || '').trim());
      if (c) return c;
    }
  }
  return null;
}

// Откуда считать изменения: --base → план (таблица по окружению) → первый коммит репозитория.
function resolveBase(cwd, info, env, baseArg) {
  let base = baseArg || null;
  let source = base ? 'аргумент --base' : '';
  if (!base) {
    base = baseFromPlan(path.resolve(cwd, info.planRel), env, { cwd, byStep: isSsh(info) });
    if (base) source = '«' + sectionOf(env) + '» в ' + info.planRel;
  }
  if (!base) {
    const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).out.trim().split(/\s+/).filter(Boolean);
    base = roots[roots.length - 1];
    source = 'первый коммит репозитория';
  }
  if (!base || !git(cwd, ['rev-parse', '--verify', '--quiet', base + '^{commit}']).ok) return { error: 'коммит ' + base + ' не найден' };
  return { base, short: git(cwd, ['rev-parse', '--short', base]).out.trim(), source };
}

function parseNameStatusZ(out) {
  const parts = out.split('\0').filter((s) => s !== '');
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) items.push({ status: parts[i][0], path: parts[i + 1] });
  return items;
}

// Изменения от базы: без worktree — до HEAD (закоммиченное, как deploy-list); с worktree — до папки проекта:
// и незакоммиченное, и новые неигнорируемые файлы (ssh-deploy.js). Пути под правилами исключений убираются.
function changes(cwd, base, rules, { worktree = false } = {}) {
  let items = parseNameStatusZ(git(cwd, ['diff', '--name-status', '--no-renames', '-z', worktree ? base : base + '..HEAD']).out);
  if (worktree) {
    const extra = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).out.split('\0').filter(Boolean);
    items = items.concat(extra.map((p) => ({ status: 'A', path: p })));
  }
  items = items.filter((it) => !matchRules(it.path, rules));
  return { upload: items.filter((it) => it.status !== 'D'), del: items.filter((it) => it.status === 'D') };
}

module.exports = { ALWAYS_SKIP, skipRules, git, sectionOf, isSsh, commitOfStep, baseFromPlan, resolveBase, changes };
```

`deploy-list.js` — целиком:

```js
#!/usr/bin/env node
'use strict';
// Что залить на сервер и что удалить на нём с последней выкладки.
// Запуск в корне проекта: node deploy-list.js [--base <коммит>] [--env прод|дев]
// Сервер — --env, иначе «Окружение»; база: --base → последний «Коммит» в таблице «Залито на прод» («Залито на дев»)
// плана выкладки → первый коммит репозитория. Общее с ssh-deploy.js — lib/deploy.js.
const { kitInfo, serverEnv } = require('./lib/project');
const { matchRules } = require('./lib/paths');
const { skipRules, git, isSsh, baseFromPlan, resolveBase, changes } = require('./lib/deploy');

function main(argv) {
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('deploy-list: здесь нет git-репозитория');
    return 1;
  }
  const info = kitInfo(cwd);
  const ei = argv.indexOf('--env');
  const env = ei >= 0 ? argv[ei + 1] : serverEnv(info.params);
  if (env !== 'прод' && env !== 'дев') {
    console.error('deploy-list: --env: прод или дев');
    return 1;
  }
  const bi = argv.indexOf('--base');
  const b = resolveBase(cwd, info, env, bi >= 0 && argv[bi + 1] ? argv[bi + 1] : null);
  if (b.error) {
    console.error('deploy-list: ' + b.error);
    return 1;
  }
  const rules = skipRules(info);
  const { upload, del } = changes(cwd, b.base, rules);
  // Только удаления — когда PhpStorm сам заливает: значение начинается с «PhpStorm Always».
  // «вручную; дев — PhpStorm Always» (до 2.17.0) — на прод вручную, нужен полный список.
  const always = /^phpstorm always/i.test(info.params.get('Выкладка', '').trim());
  const lines = ['База: ' + b.short + ' (' + b.source + ')'];
  if (always) {
    lines.push('', 'Выкладка: PhpStorm Always — заливает PhpStorm при сохранении, показаны только удаления.');
  } else {
    if (isSsh(info)) lines.push('', 'Выкладка: Claude по SSH — заливает /kit:step-done (ssh-deploy.js); здесь — чего ещё нет на сервере.');
    lines.push('', 'Залить (' + upload.length + '):');
    upload.forEach((it) => lines.push('  ' + it.status + ' ' + it.path));
  }
  lines.push('', 'Удалить с сервера (' + del.length + '):');
  del.forEach((it) => lines.push('  D ' + it.path));
  const dirty = git(cwd, ['status', '--porcelain']).out.split('\n').filter(Boolean)
    .filter((l) => !matchRules(l.slice(3).replace(/^"|"$/g, ''), rules));
  if (dirty.length) {
    lines.push('', 'Не закоммичено — в список не вошло (' + dirty.length + '):');
    dirty.forEach((l) => lines.push('  ' + l));
  }
  console.log(lines.join('\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { baseFromPlan };
```

**Шаг 4. Запуск — проходят.**
`node --test tests/deploy-lib.test.js tests/deploy-list.test.js` — PASS, прежние тесты `deploy-list` — без правок (строка `| 1.2 | | | | |` при «вручную» по-прежнему пропускается); `npm test`.

**Шаг 5. Проверки и закрытие.**
Две `claude plugin validate … --strict`. Живая проверка: `node plugins/kit/scripts/deploy-list.js` в корне этого репозитория — вывод как до правки (база — первый коммит, параметр «Выкладка: вручную»). Остановка на проверку. `/kit:step-done`: STEP `32.2`.

---

### Задача 32.3: скрипт заливки `ssh-deploy.js`

**Файлы:**
- Создать: `plugins/kit/scripts/ssh-deploy.js`
- Изменить: `tests/fake-ssh.js` — сценарий `sh`
- Тесты: `tests/ssh-deploy.test.js` (новый)

**Интерфейсы:**
- Берёт: `serverEnv`, `kitInfo` (32.1); `skipRules`, `git`, `resolveBase`, `changes` (32.2); `shq`, `serverSsh`, `runSsh`, `lastLine` из `lib/ssh.js`.
- Даёт (для 32.5): вызов `node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] [--go]`, коды 0–4, строки вывода `Сервер: …`, `База: …`, `Залить (N):`, `Удалить (M):`, `Нечего заливать.`, `Залито и сверено: K из N`, `Удалено: K из M`, `DEPLOY Файлы: …` (только когда всё вышло); экспорт `{ parseArgs, safePath, buildScript, parseResult, deployLine }`.

**Шаг 1. Заглушка `fake-ssh.js`.** В шапку — строку `sh — сценарий со stdin выполняется локальной оболочкой (FAKE_SH или sh из PATH), затем метка с её кодом (заливка ssh-deploy.js).`; в `main` — после блока `if (host === 'empty') { … }`, до `FAKE_SSH_OUT`:

```js
  if (host === 'sh') {
    const r = spawnSync(process.env.FAKE_SH || 'sh', ['-s'], { input: stdin, env: { ...process.env, LC_ALL: process.env.LC_ALL || 'C.UTF-8' } });
    process.stdout.write(Buffer.concat([r.stdout || Buffer.alloc(0), Buffer.from(mark(r.status === null ? 255 : r.status))]));
    process.stderr.write(r.stderr || Buffer.alloc(0));
    return 0;
  }
```

**Шаг 2. Тесты (должны упасть).** `tests/ssh-deploy.test.js`:

```js
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
  assert.deepEqual(parseArgs([]), { env: null, base: null, timeout: 100, go: false });
  assert.deepEqual(parseArgs(['--go', '--env', 'дев', '--base', 'abc1234', '--timeout', '5']), { env: 'дев', base: 'abc1234', timeout: 5, go: true });
  for (const bad of [['--env', 'тест'], ['--timeout', '0'], ['--timeout', '601'], ['--нет'], ['--base']]) assert.throws(() => parseArgs(bad), bad.join(' '));
  for (const ok of ['a.php', 'local/it\'s файл.php', 'a b/c.php']) assert.ok(safePath(ok), ok);
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

test('нет папки сайта на сервере — код 1, ничего не записано', { skip: !SH }, async () => {
  const dir = project('sh:' + shPath(path.join(tmpDir('kit-server-'), 'нет')));
  writeFiles(dir, { 'a.php': '2' });
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--go'], env: env() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /нет папки сайта/);
});
```

**Шаг 3. Запуск — падают.**
`node --test tests/ssh-deploy.test.js` — FAIL (`Cannot find module '…/ssh-deploy'`).

**Шаг 4. Код.** `plugins/kit/scripts/ssh-deploy.js`:

```js
#!/usr/bin/env node
'use strict';
// Заливка шага на сервер по SSH (режим «Выкладка: Claude по SSH»): всё, что изменилось с последней заливки, — одним
// подключением, сценарием sh на stdin: файлы в base64, удаления, сверка md5.
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек]         список, без подключения
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --go    залить, удалить, сверить md5
// Сервер — --env, иначе «Окружение»; куда — «SSH прод» / «SSH дев» (хост:/папка). База — как у deploy-list.js
// (lib/deploy.js), но изменения — до папки проекта: и незакоммиченное, и новые файлы. Повтор безопасен.
// Коды: 0 — залито и сверено (или нечего); 1 — часть не вышла; 2 — SSH не задан или параметр неверный;
// 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, недопустимый путь (на сервер ничего не ушло).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kitInfo, serverEnv } = require('./lib/project');
const { shq, serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { skipRules, git, resolveBase, changes } = require('./lib/deploy');

const USAGE = 'Использование: node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] [--go]';
// Меньше предела инструмента Bash (120 с): при зависании — код 3, а не обрыв вызова.
const DEFAULT_TIMEOUT = 100;
const EOF = 'KIT_B64'; // в алфавите base64 нет «_» — строка тела с ней не совпадёт

function parseArgs(argv) {
  const o = { env: null, base: null, timeout: DEFAULT_TIMEOUT, go: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--go') o.go = true;
    else if (a === '--env' || a === '--base' || a === '--timeout') {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[a.slice(2)] = argv[++i];
    } else throw new Error('неизвестный аргумент ' + a);
  }
  if (o.env !== null && o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (typeof o.timeout === 'string') {
    if (!/^\d+$/.test(o.timeout) || Number(o.timeout) < 1 || Number(o.timeout) > 600) throw new Error('--timeout: секунды, от 1 до 600');
    o.timeout = Number(o.timeout);
  }
  return o;
}

// Путь от корня сайта, который можно отдать оболочке сервера: не абсолютный, без «..», без управляющих символов.
function safePath(p) {
  const s = String(p);
  return s !== '' && !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.split('/').includes('..') && !/[\x00-\x1f\x7f]/.test(s);
}

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

// Сценарий для «sh -s»: files — [{ path, data: Buffer }], del — [путь]. Итоги — строками KIT_* по номерам (пути
// в выводе не разбираются). Файл пишется во временный рядом и копируется поверх: у существующего остаются права
// и владелец, а оборванная передача не оставляет его наполовину записанным.
function buildScript(root, files, del) {
  const lines = [
    'cd ' + shq(root) + " || { echo 'KIT_ERR нет папки сайта'; exit 0; }",
    "command -v base64 >/dev/null 2>&1 && command -v md5sum >/dev/null 2>&1 || { echo 'KIT_ERR на сервере нет base64 или md5sum'; exit 0; }",
  ];
  files.forEach((f, i) => {
    const n = i + 1;
    const tmp = shq(f.path + '.kit-tmp');
    lines.push('mkdir -p ' + shq(path.posix.dirname(f.path)) + ' && base64 -d > ' + tmp + " <<'" + EOF + "'");
    const b64 = f.data.toString('base64');
    for (let k = 0; k < b64.length; k += 76) lines.push(b64.slice(k, k + 76));
    lines.push(EOF);
    lines.push('if [ $? -eq 0 ] && cat ' + tmp + ' > ' + shq(f.path) + "; then echo 'KIT_PUT " + n + "'; else echo 'KIT_FAIL " + n + "'; fi");
    lines.push('rm -f ' + tmp);
  });
  del.forEach((p, i) => {
    lines.push('rm -f -- ' + shq(p) + " && echo 'KIT_DEL " + (i + 1) + "' || echo 'KIT_FAILDEL " + (i + 1) + "'");
  });
  files.forEach((f, i) => {
    lines.push("printf 'KIT_MD5 " + (i + 1) + " %s\\n' \"$(md5sum < " + shq(f.path) + ' 2>/dev/null | cut -c1-32)"');
  });
  lines.push('exit 0');
  return lines.join('\n') + '\n';
}

function parseResult(text) {
  const r = { err: null, put: new Set(), fail: new Set(), del: new Set(), failDel: new Set(), md5: new Map() };
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    if ((m = /^KIT_ERR (.+)$/.exec(line))) r.err = m[1];
    else if ((m = /^KIT_PUT (\d+)$/.exec(line))) r.put.add(Number(m[1]));
    else if ((m = /^KIT_FAIL (\d+)$/.exec(line))) r.fail.add(Number(m[1]));
    else if ((m = /^KIT_DEL (\d+)$/.exec(line))) r.del.add(Number(m[1]));
    else if ((m = /^KIT_FAILDEL (\d+)$/.exec(line))) r.failDel.add(Number(m[1]));
    else if ((m = /^KIT_MD5 (\d+) ?([0-9a-f]{32})?\s*$/.exec(line))) r.md5.set(Number(m[1]), m[2] || '');
  }
  return r;
}

const shortList = (list, max = 10) => (list.length <= max ? list.join(', ') : list.slice(0, max).join(', ') + ' и ещё ' + (list.length - max));

// Значение поля «Файлы» блока DEPLOY для /kit:step-done.
function deployLine(files, del) {
  const parts = ['залито ' + files.length + ': ' + shortList(files)];
  if (del.length) parts.push('удалено ' + del.length + ': ' + shortList(del));
  return parts.join('; ') + ' (ssh-deploy.js, md5 сверен)';
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('ssh-deploy: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('ssh-deploy: здесь нет git-репозитория');
    return 4;
  }
  const info = kitInfo(cwd);
  const env = o.env || serverEnv(info.params);
  const key = 'SSH ' + env;
  const target = serverSsh(info.params, env);
  if (!target) {
    const v = info.params.get(key);
    console.error('ssh-deploy: ' + (v
      ? 'параметр «' + key + '» неверный: ' + v + ' — нужно хост:/абсолютная/папка, порт — только через ~/.ssh/config'
      : 'SSH для сервера «' + env + '» не задан (параметр «' + key + '») — заливать некуда: /kit:project-init'));
    return 2;
  }
  const b = resolveBase(cwd, info, env, o.base);
  if (b.error) {
    console.error('ssh-deploy: ' + b.error);
    return 4;
  }
  const { upload, del } = changes(cwd, b.base, skipRules(info), { worktree: true });
  const bad = [...upload, ...del].filter((it) => !safePath(it.path));
  if (bad.length) {
    console.error('ssh-deploy: недопустимые пути — на сервер ничего не ушло: ' + bad.map((it) => JSON.stringify(it.path)).join(', '));
    return 4;
  }
  const files = [];
  const skipped = [];
  for (const it of upload) {
    const abs = path.join(cwd, it.path);
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { /* нет файла */ }
    if (st && st.isFile()) files.push({ path: it.path, data: fs.readFileSync(abs) });
    else skipped.push(it.path);
  }
  const dels = del.map((it) => it.path);
  const head = [
    'Сервер: ' + env + ' — ' + target.host + ':' + target.root,
    'База: ' + b.short + ' (' + b.source + ')',
    '', 'Залить (' + files.length + '):', ...files.map((f) => '  ' + f.path),
    '', 'Удалить (' + dels.length + '):', ...dels.map((p) => '  ' + p),
  ];
  if (skipped.length) head.push('', 'Пропущено — не файл (' + skipped.length + '):', ...skipped.map((p) => '  ' + p));
  console.log(head.join('\n'));
  if (!files.length && !dels.length) {
    console.log('\nНечего заливать.');
    return skipped.length ? 1 : 0;
  }
  if (!o.go) return 0;
  const r = await runSsh(target.host, 'sh -s', buildScript(target.root, files, dels), { timeoutMs: o.timeout * 1000 });
  if (!r.connected) {
    if (r.stderr) process.stderr.write(r.stderr);
    const why = r.timedOut ? 'вышло время (' + o.timeout + ' с)' : lastLine(r.stderr);
    console.error('ssh-deploy: нет подключения или обрыв' + (why ? ': ' + why : '') + ' — результат неизвестен, повтор безопасен');
    return 3;
  }
  const res = parseResult(r.stdout);
  if (res.err) {
    console.error('ssh-deploy: ' + res.err + ' — ничего не записано');
    return 1;
  }
  const problems = [];
  let ok = 0;
  files.forEach((f, i) => {
    const n = i + 1;
    if (!res.put.has(n)) problems.push(f.path + ' — ' + (res.fail.has(n) ? 'не записан' : 'результат неизвестен'));
    else if (res.md5.get(n) !== md5(f.data)) problems.push(f.path + ' — md5 не совпал');
    else ok++;
  });
  let deleted = 0;
  dels.forEach((p, i) => {
    if (res.del.has(i + 1)) deleted++;
    else problems.push(p + ' — ' + (res.failDel.has(i + 1) ? 'не удалён' : 'результат неизвестен'));
  });
  if (r.exitCode !== 0) problems.push('сценарий на сервере завершился с кодом ' + r.exitCode);
  const out = ['', 'Залито и сверено: ' + ok + ' из ' + files.length, 'Удалено: ' + deleted + ' из ' + dels.length];
  if (problems.length) {
    out.push('', 'Не вышло (' + problems.length + ') — повтор безопасен:', ...problems.map((p) => '  ' + p));
    if (r.stderr) process.stderr.write(r.stderr);
  } else if (!skipped.length) {
    out.push('', 'DEPLOY Файлы: ' + deployLine(files.map((f) => f.path), dels));
  }
  console.log(out.join('\n'));
  return problems.length || skipped.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
    console.error('ssh-deploy: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 4;
  });
}
module.exports = { parseArgs, safePath, buildScript, parseResult, deployLine };
```

**Шаг 5. Запуск — проходят.**
`node --test tests/ssh-deploy.test.js` — PASS (тесты с `sh` не пропущены — в выводе нет `# SKIP`); `npm test`.

**Шаг 6. Живая проверка на сервере пользователя.** Через AskUserQuestion: псевдоним SSH (из `~/.ssh/config`, как в `/kit:project-init`) и **отдельная тестовая папка** (абсолютный путь, не сайт; например `<домашняя папка>/kit-deploy-test`) — создание папки на сервере и запись в неё — изменение, только с согласия. Во временной папке сессии:
1. `git init`, `.claude/CLAUDE.md` с `- Выкладка: Claude по SSH`, `- SSH прод: <псевдоним>:<папка>`; файлы `a.php`, `b.php`; первый коммит (он — «копия сервера»). На сервере (с согласия) — папка и в ней `b.php`, чтобы было что удалять: `ssh <псевдоним> "mkdir -p '<папка>' && echo old > '<папка>/b.php'"`.
2. Правка `a.php`, новый двоичный `папка с пробелом/картинка.png`, удаление `b.php` → `node <плагин>/scripts/ssh-deploy.js` (список: залить 2, удалить 1) → `--go`: код 0, «Залито и сверено: 2 из 2», «Удалено: 1 из 1».
3. `ssh <псевдоним> "cd '<папка>' && md5sum a.php 'папка с пробелом/картинка.png' && ls -laR"` — md5 совпадают с локальными, `b.php` нет, `.kit-tmp` нет.
4. Повтор `--go` — код 0.
5. Удалить тестовую папку на сервере — с согласия.
Хост и папку в журнал и коммит не писать (репозиторий публичный): в CHECK — «живая проверка на сервере пользователя в тестовой папке: …».

**Шаг 7. Проверки и закрытие.** Две `claude plugin validate … --strict`. Остановка на проверку. `/kit:step-done`: STEP `32.3`.

---

### Задача 32.4: `/kit:project-init` и шаблоны

**Файлы:**
- Изменить: `plugins/kit/skills/project-init/SKILL.md`
- Изменить: `plugins/kit/skills/project-init/templates/CLAUDE.md`, `templates/deploy-prod.md`
- Изменить: `plugins/kit/skills/project-init/reference/ssh.md` (строка «Параметры проекта»)
- Тесты: `tests/content.test.js`, `tests/templates.test.js`

**Интерфейсы:** значения параметров `Окружение: прод | дев`, `Выкладка: PhpStorm Always | Claude по SSH | вручную`; таблица плана `Залито на прод | Залито на дев` — их читают 32.2, 32.3, 32.5, 32.6.

**Шаг 1. Тесты (должны упасть).**

`tests/templates.test.js` — тест «у параметра «Выкладка» три варианта» заменить и добавить:

```js
test('CLAUDE.md: «Выкладка» — PhpStorm Always / Claude по SSH / вручную; «Окружение» — прод / дев (с 2.17.0)', () => {
  const md = read('CLAUDE.md');
  const line = /^- Выкладка: \{\{(.*)\}\}$/m.exec(md);
  assert.ok(line, 'нет строки параметра «Выкладка» с плейсхолдером');
  assert.deepEqual(line[1].split(' | '), ['PhpStorm Always', 'Claude по SSH', 'вручную']);
  const env = /^- Окружение: \{\{(.*)\}\}$/m.exec(md);
  assert.deepEqual(env[1].split(' | '), ['прод', 'дев']);
  assert.ok(!md.includes('дев+прод') && !md.includes('вручную; дев'), 'вилки «дев + прод» в шаблоне нет');
  assert.ok(md.includes('ssh-deploy.js'), 'вариант пункта «Выкладка» для SSH');
});
```

тест «deploy-prod.md: разделы и колонки» — заменить:

```js
test('deploy-prod.md: разделы, таблица «Залито на прод | дев» по окружению, вариант для «Claude по SSH»', () => {
  const md = read('deploy-prod.md');
  for (const s of ['Общие правила', 'Залито на {{прод | дев}}', 'Удалить с сервера', 'Чек-лист переключения']) {
    assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  }
  assert.match(md, /^# Выкладка на \{\{прод \| дев\}\} — \{\{ДОМЕН\}\}$/m);
  assert.match(getSection(md, 'Залито на {{прод | дев}}'), /\| Шаг \| Дата \| Файлы \| Коммит \| Проверка \|/);
  assert.match(getSection(md, 'Удалить с сервера'), /\| Путь \| Почему \| Удалён \|/);
  assert.ok(getSection(md, 'Общие правила').includes('ssh-deploy.js'));
});
```

`tests/content.test.js` — тест этапа 31 (`project-init: выкладка — после SSH…`): блок `for (const s of ['«PhpStorm Always на прод» / «вручную списком файлов»', …])` заменить:

```js
  for (const s of ['«PhpStorm Always» / «Claude по SSH» / «вручную списком файлов»', '«Claude по SSH» — только если SSH-разведка']) {
    assert.ok(sect.includes(s), 'варианты выкладки: ' + s);
  }
```

и добавить новый тест:

```js
test('project-init: один сервер на проект — окружение прод/дев, адрес и SSH одного сервера, «Claude по SSH» (этап 32)', () => {
  const { body } = skill('project-init');
  const call1 = body.slice(body.indexOf('Первый вызов'), body.indexOf('Второй вызов'));
  assert.ok(call1.includes('«Прод» / «Дев'), 'окружение — прод или дев');
  for (const old of ['PhpStorm Always только на дев', 'Третий вызов — адрес дева', 'заданы оба (прод и дев)', '«PhpStorm Always на прод»']) {
    assert.ok(!body.includes(old), 'осталась вилка «дев + прод»: ' + old);
  }
  for (const s of ['Адрес сервера (прода или дева — по окружению)', 'Третий вызов — удалённый репозиторий', '`Окружение: дев+прод`',
    '| Claude по SSH | `Claude по SSH` |', 'ssh-deploy.js', '«Claude по SSH» или «вручную», а в `deployment.xml` Always']) {
    assert.ok(body.includes(s), s);
  }
  const s48 = body.indexOf('### 4.8 Закрыть шаг');
  assert.ok(body.slice(s48).includes('Выбрано «вручную» или «Claude по SSH»'), 'п. 4.8: автозаливку не включать');
});
```

**Шаг 2. Запуск — падают.** `node --test tests/content.test.js tests/templates.test.js` — FAIL по новым и изменённым проверкам.

**Шаг 3. Тексты `project-init/SKILL.md`** (заменить указанные места целиком):

- «Первый вызов», п. 2:
  ```
  2. Окружение — один сервер, куда идут шаги и где их проверяют: «Прод» / «Дев — перенос на прод потом, целиком, вне kit». Варианта «дев + прод» нет (с 2.17.0). Существующий раздел с `Окружение: дев+прод` (проект до 2.17.0) — первым «Дев», если «Выкладка» — `вручную; дев — PhpStorm Always`, иначе «Прод»; новые «Окружение», «Выкладка» и `—` у второго сервера — в плане на согласие (п. 4.3: расхождения правятся только с согласия), ответ «оставить как есть» через «Другое» — старые значения работают как раньше.
  ```
- строку «Как файлы попадают на сервер — не здесь…»: `Как файлы попадают на сервер — не здесь, а после SSH (раздел «Выкладка» ниже): вариант «Claude по SSH» зависит от SSH.`
- «Второй вызов», п. 1:
  ```
  1. Адрес сервера (прода или дева — по окружению): `https://<домен из rootFolder>` (Рекомендую) и `https://www.<домен>`; догадки нет — «Сервера пока нет» / «Введу адрес в «Другое»». Параметр — «Прод» или «Дев» по окружению, второй — `—`.
  ```
- «Третий вызов — адрес дева (при «дев + прод») и удалённый репозиторий:» → `Третий вызов — удалённый репозиторий:` (остальной текст абзаца — как есть).
- «Сразу после вопросов (до плана на согласие), если адрес прода задан» → `если адрес сервера задан`; в команде `<адрес прода>` → `<адрес сервера>`.
- раздел «SSH»: строку «Для каждого сервера с адресом: прод; дев — при «дев + прод». Справка — `reference/ssh.md`.» → `Для сервера окружения, если его адрес задан. Справка — `reference/ssh.md`.`; п. 4 → `4. Параметры: `SSH прод` или `SSH дев` (по окружению) — `<хост>:<папка>`, у второго сервера — `—`; `PHP на сервере: <путь>`; SSH нет — `—`. Уже заданные значения меняй только с согласия.`
- раздел «Выкладка» — два первых абзаца заменить:
  ```
  Окружение и SSH уже известны — вопрос «Как файлы попадают на сервер» (на сервер окружения — прод или дев): «PhpStorm Always» / «Claude по SSH» / «вручную списком файлов». «Claude по SSH» — только если SSH-разведка этого сервера прошла (код 0) и параметр `SSH …` задан; иначе варианта нет. В описании варианта: правки шага заливает `/kit:step-done` после просмотра (скрипт `ssh-deploy.js` — всё, что изменилось с последней заливки, и удаления), затем проверка на сервере и коммит; автозаливка PhpStorm остаётся выключенной.

  Первым с «(Рекомендую)» — значение параметра «Выкладка» из существующего раздела (старое `вручную; дев — PhpStorm Always` — как «PhpStorm Always»); иначе по разведке: `autoUpload="Always"` / `myAutoUpload` = `ALWAYS` в `.idea/deployment.xml` — «PhpStorm Always»; нет, а SSH есть — «Claude по SSH»; иначе «вручную списком файлов». Выбрано «Claude по SSH» или «вручную», а в `deployment.xml` Always — автозаливку выключат в п. 4.0 и в конце не включат (п. 4.8): скажи об этом в плане на согласие.
  ```
  третий абзац: «Следующим вызовом — только при автозаливке (выбран вариант «PhpStorm Always …»)» → `только при «PhpStorm Always»`.
- п. 4.0, абзац «Дальше — только при автозаливке на любой сервер…» — заменить:
  ```
  Дальше — только при автозаливке (в любом режиме): ответ «PhpStorm Always» **или** `autoUpload="Always"` / `myAutoUpload` = `ALWAYS` в `.idea/deployment.xml` по разведке (автозаливка до этого запуска могла увезти на сервер старые копии). Проверка ниже и пофайловая в п. 4.5 — для **сервера автозаливки**: это сервер окружения; сверь с `url` сервера по умолчанию из разведки `.idea` — PhpStorm заливает на другой сервер — скажи пользователю и проверяй тот, куда заливает PhpStorm. Адреса нет (сервера пока нет) — спроси адрес сервера, куда заливает PhpStorm; п. 4.5 использует его же.
  ```
- п. 4.3, таблица «Выкладка» — строки заменить:
  ```
  | PhpStorm Always | `PhpStorm Always` |
  | Claude по SSH | `Claude по SSH` |
  | вручную списком файлов | `вручную` |
  ```
  и под таблицей: `Параметр «Окружение» — `прод` или `дев`; адрес и SSH — только у сервера окружения (`Прод`/`SSH прод` или `Дев`/`SSH дев`), у второго — `—`. Старые `дев+прод` и `вручную; дев — PhpStorm Always` в существующем разделе понимают все скрипты (как до 2.17.0); замена — только с согласия.`
- п. 4.4, пункт «Общие правила» плана выкладки: дописать `; заголовок «Выкладка на прод» / «Выкладка на дев» и таблица «Залито на прод» / «Залито на дев» — по окружению`.
- п. 4.5: «Проверяй каждый известный адрес; заданы оба (прод и дев) — `check-closed.js` по обоим, по очереди.» → `Проверяй адрес сервера окружения (и адрес из п. 4.0, если PhpStorm заливает на другой сервер).`; пункт «Сервер с ручной выкладкой (…)» → `- Сервер без автозаливки («вручную» или «Claude по SSH»): `.claude` в «Не выкладывать» — `/kit:deploy-list` её не предлагает, `ssh-deploy.js` не заливает никогда.`
- п. 4.8: «только если она выбрана («PhpStorm Always …»)» → `только при «PhpStorm Always»`; абзац «Выбрано «вручную», а автозаливку выключили…» → `Выбрано «вручную» или «Claude по SSH», а автозаливку выключили в п. 4.0 — не включай; в итог пользователю: автозаливка выключена, выкладка — вручную (`/kit:deploy-list`) или Claude по SSH (заливает `/kit:step-done` после просмотра).`

**Шаг 4. Шаблон `templates/CLAUDE.md`:**
- раздел «Окружение»: строки `- **Прод:** …` и `- {{**Дев:** …}}` заменить одной: `- **Сервер:** {{прод | дев}} — {{АДРЕС}}, PHP {{ВЕРСИЯ_PHP}}; {{шаги идут на прод и проверяются там | шаги идут на дев и проверяются там; перенос на прод — потом, целиком, вне kit}}.`
- пункт «Выкладка»: `- **Выкладка:** {{PhpStorm, сервер `СЕРВЕР`, автозаливка Always — любое сохранение файла в проекте, в том числе правка Claude, сразу уходит на сервер. | Claude по SSH: правки шага заливает `/kit:step-done` после просмотра (скрипт `ssh-deploy.js` — всё, что изменилось с последней заливки, и удаления), затем проверка на сервере и коммит; автозаливка PhpStorm выключена — иначе файлы уедут дважды. | вручную, списком изменённых файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки.}}`
- подпункт про `.claude/`, первый вариант: «для ручной выкладки — «Не выкладывать»» → `для ручной выкладки и заливки по SSH — «Не выкладывать»`.
- подпункт «Удаление файла локально…» → `- {{Удаление файла локально на сервере его **не удаляет** — список в разделе «Удалить с сервера» плана выкладки. | Удалённый в git файл `ssh-deploy.js` удаляет и на сервере; прочее (старые копии) — раздел «Удалить с сервера» плана выкладки.}}`
- «Как работаем», «Код пишет»: варианты `{{Один шаг за раз: код во временной папке → `php -l` → запись в проект → проверка результата на сервере (десктоп и мобильная ширина) → следующий шаг. | Один шаг за раз: код → `php -l` → запись в проект → `/kit:step-done`: просмотр, заливка по SSH, проверка результата на сервере (десктоп и мобильная ширина), коммит → следующий шаг. | Claude даёт один маленький шаг…}}` (третий — прежний текст для «пользователь» без изменений).
- параметры: `- Окружение: {{прод | дев}}`, `- Выкладка: {{PhpStorm Always | Claude по SSH | вручную}}`, `- Прод: {{ПРОД | —}}`, `- Дев: {{ДЕВ | —}}`, `- SSH дев: {{ХОСТ:ПАПКА_САЙТА | —}}`.

**Шаг 5. Шаблон `templates/deploy-prod.md`:**
- заголовок: `# Выкладка на {{прод | дев}} — {{ДОМЕН}}`;
- первый пункт «Общих правил»: `- {{Заливает PhpStorm автоматически (сервер `СЕРВЕР`, автозаливка Always): любое сохранение файла в проекте сразу уходит на сервер. | Заливает Claude по SSH: `/kit:step-done` после просмотра пользователем — скриптом `ssh-deploy.js` (всё, что изменилось с последней заливки по таблице ниже, и удаления), затем проверка на сервере и коммит; строка в таблицу ниже — на каждом шаге. | Выкладка вручную, списком файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки (по таблице ниже).}}`;
- пункт про `.claude/`: «при ручной выкладке она в «Не выкладывать»» → `при ручной выкладке и заливке по SSH она в «Не выкладывать»`;
- пункт «Удалённые локально файлы…» → `- {{Удалённые локально файлы на сервере удаляются отдельно — раздел «Удалить с сервера». | Удалённые в git файлы удаляет `ssh-deploy.js`; прочее (старые копии) — раздел «Удалить с сервера».}}`;
- `## Залито на прод` → `## Залито на {{прод | дев}}`.

**Шаг 6. Справка `reference/ssh.md`**, строка «Параметры проекта…» → `- Параметры проекта: `SSH прод: <псевдоним>:<папка сайта>` (при «Окружение: дев» — `SSH дев`), `PHP на сервере: <путь>`.`

**Шаг 7. Запуск — проходят.** `node --test tests/content.test.js tests/templates.test.js` — PASS; `npm test`. Grep по `plugins/kit` на `дев + прод|дев+прод|вручную; дев` — остались только места совместимости (`project-init` про старое значение, `session-start.js`, `deploy-list.js`, `lib/project.js`).

**Шаг 8. Проверки и закрытие.** Две `claude plugin validate … --strict`. Остановка на проверку. `/kit:step-done`: STEP `32.4`.

---

### Задача 32.5: `/kit:step-done` в порядке SSH, docs-keeper, `/kit:deploy-list`, `/kit:report`

**Файлы:**
- Изменить: `plugins/kit/skills/step-done/SKILL.md`
- Изменить: `plugins/kit/agents/docs-keeper.md`
- Изменить: `plugins/kit/skills/deploy-list/SKILL.md`, `plugins/kit/skills/report/SKILL.md`
- Тесты: `tests/content.test.js`

**Интерфейсы:** берёт вызов и коды `ssh-deploy.js` (32.3), строку `DEPLOY Файлы: …`; поиск коммита по ID — `baseFromPlan(…, { byStep })` (32.2) — поэтому `Коммит` в DEPLOY не передаётся.

**Шаг 1. Тесты (должны упасть).** `tests/content.test.js`:

```js
test('step-done: порядок SSH — просмотр → заливка ssh-deploy.js → проверка на сервере → docs-keeper → коммит (этап 32)', () => {
  const { fm, body } = skill('step-done');
  assert.ok(fm.description.includes('Claude по SSH'));
  for (const s of ['scripts/ssh-deploy.js"', 'scripts/ssh-deploy.js" --go', 'порядком **SSH**', '«Залить на сервер»', '«Не заливать пока»',
    '## 3б. Заливка по SSH и проверка на сервере', 'повтор безопасен', '«Повторить заливку» / «Остановиться»', '«Работает» / «Не работает — опишу»',
    'снова п. 3а', '`Коммит` — не передавай', 'DEPLOY Файлы:', 'Нечего заливать']) {
    assert.ok(body.includes(s), s);
  }
  const i3a = body.indexOf('## 3а. Просмотр перед коммитом');
  const i3b = body.indexOf('## 3б. Заливка по SSH');
  assert.ok(i3a > 0 && i3b > i3a && i3b < body.indexOf('## 4. Коммит'), '3б — между просмотром и коммитом');
});

test('docs-keeper: «Залито на прод» или «Залито на дев», COMMITS — и пустые «Коммит» плана по «Шаг» (этап 32)', () => {
  const { body } = agent('docs-keeper');
  for (const s of ['«Залито на дев»', 'какая есть в плане', 'по колонке «Шаг»']) assert.ok(body.includes(s), s);
});

test('deploy-list и report: таблица по окружению, режим «Claude по SSH» (этап 32)', () => {
  const dl = skill('deploy-list');
  assert.ok(dl.fm.description.includes('Claude по SSH'));
  for (const s of ['«Залито на дев»', '`--env прод|дев`', 'ssh-deploy.js']) assert.ok(dl.body.includes(s), s);
  assert.ok(skill('report').body.includes('«Залито на дев»'));
});
```

**Шаг 2. Запуск — падают.** `node --test tests/content.test.js` — 3 FAIL.

**Шаг 3. `step-done/SKILL.md`:**
- frontmatter `description` — дописать в конец (без «: »): ` В режиме выкладки «Claude по SSH» после просмотра заливает шаг на сервер (ssh-deploy.js) и проверяет его там до коммита.`
- после абзаца «Закрывай только проверенный шаг…» — абзац: `В режиме «Claude по SSH» (параметр «Выкладка») до команды проверяется только локальное — `php -l`, тесты: на сервер шаг уезжает внутри команды (п. 3б), там же проверка на сервере.`
- раздел «1. Исходное состояние» — пункт 4:
  ````
  4. **Выкладка: Claude по SSH** — что уедет на сервер, сухой прогон из корня проекта:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-deploy.js"
     ```
     В выводе есть файлы в «Залить» или «Удалить» — шаг идёт порядком **SSH**: просмотр (п. 3а) → заливка и проверка на сервере (п. 3б) → docs-keeper (п. 3) → коммит и отправка (п. 4–5а). «Нечего заливать» (шаг меняет только документы) — обычный порядок. Код 2 (SSH не задан) — стоп: предложи `/kit:project-init`; код 4 — покажи вывод и стоп.
  ````
- раздел «3. docs-keeper» — первым абзацем: `Порядок **SSH** (п. 1.4) — этот пункт выполняется после п. 3б: CHECK — с итогом заливки («Залито и сверено…») и проверки на сервере; блок DEPLOY — `Файлы:` — строка «DEPLOY Файлы:» из вывода `ssh-deploy.js --go` без этих слов, `Проверка:` — как проверено на сервере; `Коммит` — не передавай: это коммит шага, ячейка останется пустой, скрипты найдут его по ID шага, а хеш впишет следующий `/kit:step-done` через COMMITS.`
- раздел «3а», первый абзац «Параметр «Коммит: сразу» — пункт пропусти.» → `Параметр «Коммит: сразу» — пункт пропусти (порядок **SSH**: список из п. 1.4 — в чат, затем сразу п. 3б).`
- раздел «3а», п. 3 — дописать: ` Порядок **SSH** — вместо «Коммитить» вариант «Залить на сервер» (коммит и отправка — после заливки и проверки, без нового вопроса), вместо «Не коммитить пока» — «Не заливать пока»; перед вопросом в чате — что уедет (из п. 1.4): сервер, «Залить (N)», «Удалить (M)».`
- раздел «3а», п. 7 — «после «Коммитить» — когда коммит (и отправка) прошли» → `после «Коммитить» (в порядке **SSH** — «Залить на сервер») — когда коммит (и отправка) прошли`.
- новый раздел перед «## 4. Коммит»:
  ````
  ## 3б. Заливка по SSH и проверка на сервере

  Только порядок **SSH** (п. 1.4), после ответа «Залить на сервер» (при «Коммит: сразу» — сразу после п. 2).

  1. **Заливка** — из корня проекта:
     ```
     node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-deploy.js" --go
     ```
     Код 0 — дальше. Код 1 (часть не вышла: не записан, md5 не совпал, на сервере нет `base64` или `md5sum`) или 3 (нет подключения, обрыв, вышло время) — покажи причину пользователю; повтор безопасен (та же заливка даёт тот же результат) — AskUserQuestion «Повторить заливку» / «Остановиться». Остановились — коммита нет, правки остаются. Код 2 или 4 — покажи вывод и стоп.
  2. **Проверка на сервере** — по правилам проекта: «Код пишет: Claude» — проверь сам (страница, десктоп и мобильная ширина — что положено); «пользователь» — AskUserQuestion «Работает» / «Не работает — опишу».
  3. **Не прошла** — правка (это часть шага), локальные проверки, затем снова п. 3а: просмотр → заливка → проверка. Ответ «Не работает» и правки — не решения, в DECISIONS не идут.
  4. **Прошла** — п. 3 (docs-keeper с итогом заливки и проверки), затем п. 4 без нового вопроса: ответ «Залить на сервер» включает коммит и отправку.
  ````

**Шаг 4. `agents/docs-keeper.md`:**
- «Как обновлять план выкладки», строка разделов: «Залито на прод» → `«Залито на прод» (или «Залито на дев» — в плане проекта с «Окружение: дев»)`;
- п. 1 → `1. `Файлы` (с `Коммит` и `Проверка`) — строка в таблицу «Залито на прод» или «Залито на дев» — какая есть в плане: `| шаг | дата | файлы | коммит | проверка |`; `Коммит` не передан — ячейка пустая (её заполнит COMMITS).`
- п. 4 «COMMITS — …» — дописать: ` В плане выкладки COMMITS заполняет и пустые ячейки «Коммит» таблицы «Залито на …» — у строк, где значение по колонке «Шаг» совпадает с ID из COMMITS (последний хеш этого ID); заполненные не трогай.`

**Шаг 5. `deploy-list/SKILL.md`:**
- `description` (в кавычках): `"Показать, что выложить на сервер и что удалить на нём с последней выкладки — по таблице «Залито на прод» («Залито на дев» при окружении «дев») плана выкладки или от указанного коммита. Для ручной выкладки; при «Выкладка: PhpStorm Always» — только удаления; при «Claude по SSH» — чего ещё нет на сервере (заливает /kit:step-done)."`
- п. 2 — дописать: ` Сервер — по «Окружению»: база из «Залито на прод» или «Залито на дев»; другой сервер — `--env прод|дев`.`
- п. 5 — дописать: ` При «Выкладка: Claude по SSH» заливает `/kit:step-done` (`ssh-deploy.js`) и сам пишет строку в «Залито на …»; незалитое из прошлых шагов уйдёт со следующим шагом.`

**Шаг 6. `report/SKILL.md`**, строка «Выложено на сайт»: «строки «Залито на прод» плана выкладки» → `строки «Залито на прод» (при «Окружение: дев» — «Залито на дев») плана выкладки`.

**Шаг 7. Запуск — проходят.** `node --test tests/content.test.js` — PASS (прежний тест `step-done` — тоже: порядок разделов 3 → 3а → 3б → 4 сохранён); `npm test`.

**Шаг 8. Проверки и закрытие.** Две `claude plugin validate … --strict`. Остановка на проверку. `/kit:step-done`: STEP `32.5`.

---

### Задача 32.6: хук `session-start.js`

**Файлы:**
- Изменить: `plugins/kit/scripts/session-start.js`
- Тесты: `tests/session-start.test.js`

**Интерфейсы:** берёт `serverEnv` (32.1), `readDeployment(xml).always` из `lib/deployment.js`.

**Шаг 1. Тесты (должны упасть).**

```js
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="PublishConfigData" autoUpload="Always" serverName="alpha">\n  </component>\n</project>\n';

test('«Claude по SSH»: правило заливки в /kit:step-done, «Код пишет Claude» — проверка после заливки; правил автозаливки нет (с 2.17.0)', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'Claude по SSH', 'Окружение': 'прод' });
  const out = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(out, /- Выкладка: Claude по SSH — правки остаются локально, пока \/kit:step-done не зальёт их после просмотра/);
  assert.match(out, /Вне \/kit:step-done на сервер не заливай/);
  assert.match(out, /- Код пишет Claude: результат на сервере проверяй после заливки в \/kit:step-done/);
  assert.doesNotMatch(out, /после записи проверить результат на сервере/);
  assert.doesNotMatch(out, /PhpStorm Always|Superpowers при автозаливке|уедут на сервер дважды/);
});

test('«Claude по SSH», а в deployment.xml автозаливка — предупреждение; без Always и при «PhpStorm Always» — нет', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'Claude по SSH' });
  const base = { '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() };
  const on = run(makeProject({ ...base, '.idea/deployment.xml': XML })).stdout;
  assert.match(on, /в PhpStorm включена автозаливка .*уедут на сервер дважды/);
  assert.match(on, /Tools → Deployment → Automatic Upload/);
  const off = run(makeProject({ ...base, '.idea/deployment.xml': XML.replace(' autoUpload="Always"', '') })).stdout;
  assert.doesNotMatch(off, /уедут на сервер дважды/);
  const always = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always' }), '.claude/docs/progress.md': progressMd(),
    '.idea/deployment.xml': XML })).stdout;
  assert.doesNotMatch(always, /уедут на сервер дважды/, 'при PhpStorm Always автозаливка — норма');
});

test('PhpStorm Always при «Окружение: дев» — сохранение уходит на дев-сервер; при «прод» — на сервер', () => {
  const dev = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always', 'Окружение': 'дев' }), '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(dev, /- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на дев-сервер\./);
  const prod = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always', 'Окружение': 'прод' }), '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(prod, /- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на сервер\./);
});
```

**Шаг 2. Запуск — падают.** `node --test tests/session-start.test.js` — 3 FAIL.

**Шаг 3. Код `session-start.js`:**
- импорты: `const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude, serverEnv } = require('./lib/project');` и `const { readDeployment } = require('./lib/deployment');`;
- `RULE_ALWAYS` — через функцию (текст для прода прежний, байт в байт):
  ```js
  const ruleAlways = (where) => '- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на ' + where + '. Черновики — только во временной папке сессии; PHP собрать и проверить php -l там, в проект — одной правкой. Удаление локально сервер не трогает.';
  const RULE_ALWAYS = ruleAlways('сервер');
  const RULE_ALWAYS_ON_DEV = ruleAlways('дев-сервер');
  ```
- новые строки:
  ```js
  const RULE_SSH = '- Выкладка: Claude по SSH — правки остаются локально, пока /kit:step-done не зальёт их после просмотра '
    + '(ssh-deploy.js: всё, что изменилось с последней заливки, удаления — тоже); проверка на сервере — после заливки, потом коммит; '
    + 'не прошла — правка и снова просмотр. Вне /kit:step-done на сервер не заливай.';
  const RULE_CLAUDE_SSH = '- Код пишет Claude: результат на сервере проверяй после заливки в /kit:step-done (страница, десктоп и мобильная ширина); '
    + 'до неё — php -l и локальные проверки.';
  const WARN_SSH_ALWAYS = '- Внимание: выкладка — Claude по SSH, а в PhpStorm включена автозаливка (.idea/deployment.xml: Always) — '
    + 'файлы уедут на сервер дважды и до просмотра. В первом ответе скажи пользователю выключить: PhpStorm → Tools → Deployment → Automatic Upload.';

  // Автозаливка PhpStorm включена — .idea основной папки (из git worktree — папка выше .claude/worktrees). Нет файла — нет.
  function phpStormAlways(dir) {
    const root = String(dir).replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '');
    try {
      return readDeployment(fs.readFileSync(path.join(root, '.idea', 'deployment.xml'), 'utf8')).always;
    } catch (e) {
      return false;
    }
  }
  ```
- в `buildContext` блок выкладки и «Код пишет» заменить:
  ```js
  const deploy = p.get('Выкладка', '').trim();
  const always = /always/i.test(deploy);
  const ssh = /^claude по ssh/i.test(deploy);
  if (always) out.push(/^phpstorm always/i.test(deploy) ? (serverEnv(p) === 'дев' ? RULE_ALWAYS_ON_DEV : RULE_ALWAYS) : RULE_ALWAYS_DEV);
  if (ssh) {
    out.push(RULE_SSH);
    if (phpStormAlways(info.dir)) out.push(WARN_SSH_ALWAYS);
  }
  const who = p.get('Код пишет', '').toLowerCase();
  if (who.startsWith('пользов')) out.push(RULE_USER);
  else if (who.startsWith('claude')) out.push(ssh ? RULE_CLAUDE_SSH : RULE_CLAUDE);
  ```

**Шаг 4. Запуск — проходят.** `node --test tests/session-start.test.js` — PASS (прежние, в том числе `«вручную; дев — PhpStorm Always»` и worktree, — без правок); `npm test`.

**Шаг 5. Проверки и закрытие.** Две `claude plugin validate … --strict`; ручной прогон хука в этом репозитории: `echo '{}' | node plugins/kit/scripts/session-start.js` — вывод как раньше (выкладка вручную — строк SSH нет). Остановка на проверку. `/kit:step-done`: STEP `32.6`.

---

### Задача 32.7: выпуск 2.17.0

**Файлы:**
- Изменить: `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — `"version": "2.17.0"`
- Изменить: `.claude/docs/work/spec-claude-kit.md`, `README.md`, `.claude/docs/work/overview/build/build.js` (и пересборка), `.claude/docs/work/MyIdeas.md`

**Шаг 1. Версия** — `2.16.0` → `2.17.0` в обоих файлах; `npm test` (`manifest.test.js` сверяет их).

**Шаг 2. Спек плагина `spec-claude-kit.md`:**
- строка после «Дополнен 2026-10-15: этап 31 …»: `> Дополнен <дата>: этап 32 — один сервер на проект («Окружение: прод | дев», вилки «дев + прод» нет; скрипты с `--env` берут сервер по «Окружению»), выкладка «Claude по SSH»: скрипт `ssh-deploy.js` (одно подключение SSH, сценарий sh — файлы в base64, удаления, сверка md5), общий `lib/deploy.js` с `deploy-list.js`, порядок шага в `/kit:step-done` — просмотр → заливка → проверка на сервере → журнал → коммит; правило хука и предупреждение об автозаливке PhpStorm; версия 2.17.0 (§2, 5, 6.1, 7.1, 7.2, 7.3, 7.4, 8, 9, 10, 11). Спек и план — `.claude/docs/work/spec-claude-ssh.md`, `plan-claude-ssh.md`.`
- §2 — решения этапа 32 (как DECISIONS шага 32.1); §5 — параметры «Окружение» (`прод` | `дев`, старое `дев+прод` — прод), «Выкладка» (`Claude по SSH`); §6.1 — DEPLOY в «Залито на прод | дев», COMMITS — пустые «Коммит» плана; §7.1 — порядок SSH и п. 3б; §7.2 — `--env`, таблица по окружению, пометка SSH; §7.3 — окружение прод/дев, адрес одного сервера, три варианта выкладки; §7.4 — сервер по «Окружению»; §8 — правило SSH и предупреждение `session-start.js`; §9 — подраздел «Заливка: `ssh-deploy.js`» (вызов, база, список, сценарий, коды 0–4 — из спека этапа, Т-9…Т-17) и `lib/deploy.js`; §10 — шаблоны (заголовок и таблица плана по окружению); §11 — тесты `ssh-deploy.test.js`, `deploy-lib.test.js`.

**Шаг 3. README:** строка `/kit:project-init` — дописать `; с 2.17.0 — один сервер на проект (прод или дев) и выкладка «Claude по SSH»`; строка `/kit:step-done` — дописать `; при «Claude по SSH» — после просмотра заливка на сервер (ssh-deploy.js) и проверка там до коммита`; строка `/kit:deploy-list` — `что залить и что удалить на сервере с последней выкладки (при «Claude по SSH» — чего ещё нет на сервере)`; параметры: `- Окружение: прод` — без изменений, описание «Выкладка» (строка 112) → `- **Выкладка** — `PhpStorm Always` (автозаливка на сервер окружения), `Claude по SSH` (заливает `/kit:step-done` после просмотра, с 2.17.0) или `вручную`; старое `вручную; дев — PhpStorm Always` работает как раньше.`; описание «Окружение» (если есть) — `прод` или `дев` — один сервер на проект.

**Шаг 4. Обзор** `.claude/docs/work/overview/build/build.js`: футер и шапка — `2.17.0` и дата; «node-скриптов» — `19` (два места: блок цифр и строка Markdown); таблица правил хука (строки «Выкладка: …») — добавить `<tr><td>Выкладка: Claude по SSH</td><td>правки локально до /kit:step-done; заливка после просмотра, проверка на сервере, коммит</td></tr>`, строку `вручную; дев — PhpStorm Always` подписать «до 2.17.0»; раздел `deploy-list` — строка таблицы для «Claude по SSH»; пункт «Выкладка» подготовки проекта (с 2.16.0) — `(с 2.17.0) — окружение прод или дев, варианты «PhpStorm Always» / «Claude по SSH» (если есть SSH) / «вручную»; при автозаливке — вопрос «Документы на сервере».`; таблицу «Параметр × скрипт» не перестраивать (столбца `ssh-deploy` в ней нет — скрипт описан в разделе `deploy-list`). Затем `node .claude/docs/work/overview/build/build.js` из корня — собрано без ошибок.

**Шаг 5. `MyIdeas.md`:** идеи 1 и 2 раздела «Новые идеи и замечания» — `[x]` и строки `— сделано в 2.17.0 (этап 32): …` (идея 1 — вариант «Claude по SSH» при SSH, окружение — один сервер (прод или дев); идея 2 — порядок шага: просмотр, заливка, проверка, коммит и пуш).

**Шаг 6. Проверки и закрытие.** `npm test`, обе `claude plugin validate … --strict`, `node tools/kit-denylist.js tree` — код 0. Остановка на проверку. `/kit:step-done`: STEP `32.7`, закрытие этапа 32 (NEXT `—`): сверка по спеку (Т-1…Т-24) и плану, спек и план — в архив по выбору пользователя. После коммита — с согласия пользователя: `git push origin master`, `claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit`.
