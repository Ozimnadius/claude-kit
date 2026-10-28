# План — система Мэтта Покока в kit-проектах (этап 47)

> Задача = шаг kit 47.N; после каждой — `/kit:step-done` (просмотр изменений и один коммит), superpowers сам не коммитит. Строки
> чек-листа отмечает закрытие шага. Задачи идут сверху вниз: 47.3–47.7 опираются на `lib/matt.js` из 47.2.
>
> Исполнение (решение пользователя 2026-10-28): субагентами — на задачу свежий исполнитель, затем свежий проверяющий
> (`superpowers:subagent-driven-development`), исправления — тем же порядком; исполнитель и проверяющий не коммитят, задачу закрывает
> `/kit:step-done` в общей сессии. Уровень рассуждений (`effort`) — `high`, для задач с хуками 47.3–47.5 — `xhigh`. После 47.1 — `/clear`.

**Цель:** вопрос «Вести проект по системе Мэтта Покока?» в `/kit:project-init`; при «да» — плагин Мэтта на проект и superpowers
выключен, а kit задаёт правила работы: места файлов, общая сессия и исполнитель на тикет, приёмка через `/kit:step-done`, режим без
пользователя, подстраховка хуками.

**Устройство:** признаки проекта Мэтта и установленного плагина — новый `lib/matt.js`; правила — строки `session-start.js` и новый
навык `/kit:matt`; подстраховка — `guard-bash.js` (git) и новый `guard-matt.js` (файлы, worktree); настройка — `/kit:project-init` и
шаблон `CLAUDE.md`. `/kit:step-done` не меняется.

**Стек:** Node.js (скрипты хуков, тесты `node --test`), Markdown (навыки), плагин Claude Code.

**Спек:** `.claude/docs/work/spec-matt.md` (Т-1…Т-16).

## Чек-лист

- [x] 47.1 — спек и план этапа 47
- [x] 47.2 — `lib/matt.js` и `matt-skill.js`: проект Мэтта, плагин на проект, путь к файлу навыка (Т-2, Т-7, Т-13)
- [x] 47.3 — `session-start.js`: правила проекта Мэтта и напоминания (Т-2, Т-3, Т-4, Т-7, Т-10, Т-13)
- [x] 47.4 — `guard-bash.js`: коммит в обход `/kit:step-done` и ветки при автозаливке (Т-12а, Т-12б)
- [x] 47.5 — `guard-matt.js`: файлы Мэтта в корне и worktree при автозаливке (Т-12б, Т-12в)
- [x] 47.6 — навык `/kit:matt`: общая сессия, исполнители, приёмка, режим без пользователя (Т-3…Т-6, Т-8…Т-11)
- [x] 47.7 — `/kit:project-init`: вопрос, параметр «Система Мэтта», установка плагина и выключение superpowers (Т-1, Т-2)
- [ ] 47.8 — выпуск kit 3.3.0: версии, README, обзор (Т-14, Т-15)
- [ ] 47.9 — выпуск kit 3.3.0: отправка, установка и живая проверка; этап закрыт (критерии готовности)

## Общие ограничения

- Текст для пользователя и для Claude — по-русски; имена в коде и команды — как есть.
- Репозиторий публичный: только обезличенно (Т-16), опытный проект — alpha; перед закрытием шага — `node tools/kit-denylist.js tree`.
- Файлы — UTF-8 без BOM, LF.
- Хук не ломает сессию: любое исключение — тихо, код 0, без вывода (как в `guard-bash.js`).
- Всё про Мэтта действует только в kit-проекте (`kitInfo(dir).isKit`) с параметром «Система Мэтта: да» (`isMattProject`).
- Плагин — `mattpocock-skills@claude-plugins-official`, правила проверены на 1.3.1 (`MATT_VERIFIED`); superpowers — `superpowers@claude-plugins-official`.
- Папки (Т-4): `<docs>/work/<тема>/` (`map.md`, `issues/NN-<slug>.md`, `spec.md`), `<docs>/work/<тема>-build/` (`issues/NN-<slug>.md`,
  `README.md`), `<docs>/GLOSSARY.md`, `<docs>/adr/NNNN-<slug>.md`.
- `skills/step-done/SKILL.md` не трогать: ядро упирается в предел теста 14 336 байт (сейчас 14 332); режим без пользователя целиком — в
  навыке `/kit:matt`.
- Без `cd` в Bash, команды — из корня проекта.
- Перед закрытием шага: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.

## На что смотреть при ревью

Случаи, которые спек подразумевает, а прямые тесты задач легко пропустят; у каждого — тест в своей задаче.
1. `projectPath` в `installed_plugins.json` записан с `\` и в другом регистре, чем папка из хука (`C:\…` против `c:/…`), — плагин всё равно найден (47.2).
2. Сессия в worktree приложения (`<проект>/.claude/worktrees/<имя>`) — плагин на проект ищется по основной папке (47.2).
3. `installed_plugins.json` нет, он битый или без ключа `plugins` — «не установлен», без исключения (47.2).
4. `git` с опциями до подкоманды (`git -C <путь> -c k=v commit`), коммит внутри цепочки (`git add a && git commit`), слово `commit` не
   подкомандой (`git log --grep commit`, `echo "git commit"`) — первые два ловятся, последние нет (47.4).
5. `file_path` абсолютный с `\`, относительный и вне проекта (временная папка) — корень определяется верно, вне проекта — пропуск (47.5).

---

## 47.1 — спек и план этапа 47

**Файлы:** `.claude/docs/work/spec-matt.md` (одобрен 2026-10-28), `.claude/docs/work/plan-matt.md` (этот файл).

Шаг 1. `npm test` — зелёный (кода в шаге нет).

Шаг 2. `node tools/kit-denylist.js tree` — чисто.

Шаг 3. `/kit:step-done 47.1`: `STAGE` — `47 — система Мэтта Покока в kit-проектах`; `DOCS` — `work/spec-matt.md — спек этапа 47: система
Мэтта Покока в kit-проектах — в работе, этап 47` и `work/plan-matt.md — план этапа 47 (задачи 47.1–47.9) — в работе, этап 47`;
`DECISIONS` — по строке на решение из раздела спека «Решения пользователя (2026-10-28)» с отвергнутыми вариантами и решение о подходе
(адаптер; отвергнуты вилка, свои навыки kit, не смешивать); `NEXT` — 47.2.

## 47.2 — `lib/matt.js` и `matt-skill.js`

**Файлы:**
- Создать: `plugins/kit/scripts/lib/matt.js`, `plugins/kit/scripts/matt-skill.js`
- Тест: `tests/matt.test.js`

**Интерфейсы (даёт):**
- `MATT_PLUGIN = 'mattpocock-skills@claude-plugins-official'`, `SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official'`, `MATT_VERIFIED = '1.3.1'`.
- `isMattProject(params) → boolean` — параметр «Система Мэтта» равен «да» (регистр и пробелы по краям не важны).
- `projectRoot(dir: string) → string` — без хвоста `[\\/].claude[\\/]worktrees[\\/]…` (как `phpStormAlways` в `session-start.js`).
- `mattPlugin(projectDir: string) → { installed: boolean, enabled: boolean, version: string, installPath: string }`:
  - записи `MATT_PLUGIN` из `installed_plugins.json` (`json.plugins || json`; значение — массив или один объект): `scope: 'user'` —
    для любого проекта; `scope: 'project'` или `'local'` — если `projectPath` совпадает с `projectRoot(projectDir)` (сравнение:
    `path.resolve`, `\` → `/`, без `/` в конце, без регистра);
  - `enabled` — первое явное `true`/`false` в `enabledPlugins[MATT_PLUGIN]` по порядку: `<корень>/.claude/settings.local.json`,
    `<корень>/.claude/settings.json`, файл настроек пользователя; явного нет — `true`;
  - файлы: `process.env.KIT_PLUGINS_FILE || ~/.claude/plugins/installed_plugins.json`,
    `process.env.KIT_USER_SETTINGS || ~/.claude/settings.json`; нет файла или битый JSON — как пустой.
- `mattSkillFile(installPath: string, name: string) → string | null` — путь из `skills` в `<installPath>/.claude-plugin/plugin.json`,
  последняя часть которого равна `name`, плюс `/SKILL.md`, если файл есть; иначе `null`.
- `bigWorkActive(projectDir: string, docsRel: string) → boolean` — есть хоть одна папка `<docsRel>/work/*/issues/`.
- `node matt-skill.js <имя>` (из корня проекта) — абсолютный путь к `SKILL.md`, код 0; плагин не на проекте — код 2 и строка
  «плагин mattpocock-skills на этот проект не поставлен — /kit:project-init»; навыка нет — код 3 и список имён; без имени — код 4.
- `node matt-skill.js --status` — одна строка: `установлен <версия>, включён` | `установлен <версия>, выключен` | `не установлен`; код 0.

Шаг 1. Тесты `tests/matt.test.js`. Подставной плагин — `<tmp>/plugin/.claude-plugin/plugin.json` со
`skills: ['./skills/engineering/implement', './skills/productivity/grilling']` и их `SKILL.md`; `installed_plugins.json` — во
временной папке через `KIT_PLUGINS_FILE`; `KIT_USER_SETTINGS` — всегда на несуществующий файл (не читать настройки пользователя).

```js
const paramsOf = (v) => kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd(v) })).params;
test('isMattProject: « Да » — да; «нет» и нет строки — нет', () => {
  assert.equal(isMattProject(paramsOf({ 'Система Мэтта': ' Да ' })), true);
  assert.equal(isMattProject(paramsOf({ 'Система Мэтта': 'нет' })), false);
  assert.equal(isMattProject(paramsOf({ 'Режим': 'общий' })), false);
});
test('mattPlugin: запись на проект с другим регистром и слешами — установлен, включён, версия 1.3.1', ...);
test('mattPlugin: запись на другой проект — не установлен; scope user — установлен', ...);
test('mattPlugin: false в .claude/settings.json — выключен; true в settings.local.json сильнее', ...);
test('mattPlugin: нет файла, битый JSON, формат без ключа plugins — не установлен, без исключения', ...);
test('mattPlugin: папка <проект>/.claude/worktrees/<имя> — ищет по основной папке', ...);
test('mattSkillFile: implement и grilling находятся, нет навыка — null', ...);
test('bigWorkActive: <docs>/work/x/issues/ — да; только <docs>/archive/x/issues/ — нет', ...);
test('matt-skill.js: путь к implement/SKILL.md; --status; коды 2, 3, 4', ...); // runScript('matt-skill.js', { args, cwd: dir, env })
```

Шаг 2. `node --test tests/matt.test.js` — FAIL: `Cannot find module '../plugins/kit/scripts/lib/matt'`.

Шаг 3. Написать `lib/matt.js` и `matt-skill.js` по интерфейсам; каждое чтение файла — в `try/catch`.

Шаг 4. `node --test tests/matt.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 47.2`.

## 47.3 — `session-start.js`

**Файлы:** изменить `plugins/kit/scripts/session-start.js` (`buildContext`, `main`); тест — `tests/session-start.test.js`.

**Интерфейсы:** берёт `isMattProject`, `mattPlugin`, `bigWorkActive`, `MATT_VERIFIED` из `lib/matt.js`; даёт
`mattRules(info) → { lines: string[], user: string }` (в `module.exports`). `mattPlugin` вызывается только при `isMattProject` —
остальные проекты не читают `installed_plugins.json`.

Поведение `buildContext`:
- `mattOn = isMattProject(p) && plugin.installed && plugin.enabled` → вместо `superpowersRule` и `RULE_SP_ALWAYS` — строки
  `mattRules`: правило Мэтта, места файлов, а при `bigWorkActive` и `plugin.version` ≠ `MATT_VERIFIED` — строка о версии;
- «да», но не `mattOn` → правила superpowers как сейчас и строка-напоминание; `main` кладёт напоминание и в `systemMessage` (вместе с
  напоминанием о версии kit — через перевод строки);
- «нет» или строки нет — как сейчас.

Тексты строк дословно (`<docs>` — `info.docsRel`; `<скрипт>` — абсолютный путь к `matt-skill.js` с `/`, как у `SPEC_TEMPLATE`):
- `- Система Мэтта (проект Мэтта): навыки mattpocock-skills — всегда с префиксом mattpocock-skills:, superpowers в проекте выключен. Большая работа (не влезет в одну-две сессии) — по навыку /kit:matt: общая сессия, исполнитель на каждый тикет, приёмка через /kit:step-done; без пользователя (он сам разрешил) — коммит без просмотра по /kit:matt, разбор потом. Мелкая задача — сделать и закрыть /kit:step-done. Навыки только по команде (wayfinder, to-spec, to-tickets, implement и др.) читай файлом: node "<скрипт>" <имя>. implement-spec и setup-matt-pocock-skills не используются; вопросы грилинга — через AskUserQuestion.`
- `- Файлы системы Мэтта — в <docs>/: карта, тикеты-решения и спек — work/<тема>/ (map.md, issues/NN-<slug>.md, spec.md), тикеты реализации — work/<тема>-build/ (issues/NN-<slug>.md, README.md), глоссарий — GLOSSARY.md, ADR — adr/NNNN-<slug>.md, исследования и прочие документы навыков — work/, прототипы prototype — HTML в work/<тема>/ (варианты экранов на сайте — только где правки не уходят на прод сами); трекер задач — эти локальные файлы. В корень проекта (GLOSSARY.md, CONTEXT.md, docs/adr/, docs/agents/, .scratch/) не пиши.`
- о версии: `- Плагин Мэтта обновился: правила kit проверены на <MATT_VERIFIED>, стоит <версия> — если навык ведёт себя не так, как в /kit:matt (пути, имена навыков, поля тикетов), сверь и скажи пользователю.`
- напоминание: `- Система Мэтта: да, но плагин mattpocock-skills на этот проект не поставлен или выключен — запустите /kit:project-init (поставит его и выключит superpowers в проекте).`; пользователю — `[kit] Система Мэтта: плагин mattpocock-skills на этот проект не поставлен — запустите /kit:project-init.`

Шаг 1. Тесты (помощник `runEnv(dir, env)` — как `run`, но с `env`; `KIT_PLUGINS_FILE` — временный файл с записью на проект,
`KIT_USER_SETTINGS` — несуществующий файл):

```js
test('проект Мэтта с плагином: правила Мэтта и места файлов, без правил superpowers', () => {
  // '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' }), '.claude/docs/progress.md': progressMd()
  assert.match(ctx, /- Система Мэтта \(проект Мэтта\)/);
  assert.match(ctx, /work\/<тема>-build\//);
  assert.match(ctx, /matt-skill\.js" <имя>/);
  assert.doesNotMatch(ctx, /Superpowers по правилам kit/);
  assert.doesNotMatch(ctx, /Superpowers при автозаливке/);
  assert.equal(user, '');
});
test('проект Мэтта без плагина на проекте: напоминание о /kit:project-init в контексте и пользователю, правила superpowers на месте', ...);
test('обычный kit-проект: строк Мэтта нет, superpowers по правилам kit', ...);
test('плагин Мэтта 9.9.9 при большой работе — строка «проверены на 1.3.1» для Claude, не пользователю; без work/*/issues/ — строки нет', ...);
```

Шаг 2. `node --test tests/session-start.test.js` — новые тесты FAIL, старые PASS.

Шаг 3. Реализовать `mattRules` и ветвление в `buildContext` и `main`.

Шаг 4. `node --test tests/session-start.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 47.3`.

## 47.4 — `guard-bash.js`

**Файлы:** изменить `plugins/kit/scripts/guard-bash.js` (новая `checkGit`, `main`); тест — `tests/guard-bash.test.js`.

**Интерфейсы:** берёт `isMattProject`; даёт `checkGit(cmd: string, shell: 'bash' | 'powershell', ctx: { always: boolean }) → string | null`
(в `module.exports` рядом с `checkCommand`).

Правила `checkGit` — по тем же сегментам, что у `checkCommand` (без heredoc, here-string и комментариев, через `splitCommands`):
- первое слово сегмента — `git` или `git.exe`; глобальные опции до подкоманды пропускаются: `-C <арг>`, `-c <арг>`, `--git-dir=…`,
  `--work-tree=…`, `--no-pager`, `-p`, `--paginate`;
- подкоманда `commit` → `REASON_COMMIT`;
- при `ctx.always` → `REASON_BRANCH`: `checkout` с `-b`/`-B`/`--orphan`; `switch` с `-c`/`-C`/`--create`/`--force-create`/`--orphan`;
  `branch` с именем и без опций просмотра, удаления и переименования (`-a -r -l --list -d -D --delete -m -M --move -v -vv
  --show-current --contains --merged --no-merged`); `worktree add`;
- `REASON_COMMIT = 'Коммит — только через /kit:step-done (kit-commit.js): в проекте Мэтта исполнитель не коммитит, тикет принимает общая сессия.'`
- `REASON_BRANCH = 'При автозаливке PhpStorm ветки и worktree нельзя: файлы с диска уезжают на сервер. Работай в текущей ветке основной папки.'`
- `main`: `info = kitInfo(dir)`; причина — `checkCommand(…) || (isMattProject(info.params) ? checkGit(cmd, shell, { always: /^phpstorm always/i.test(String(info.params.get('Выкладка', '')).trim()) }) : null)`.

Шаг 1. Тесты:

```js
const GIT = [ // [оболочка, команда, автозаливка, ожидание]
  ['bash', 'git commit -m "x"', false, 'commit'],
  ['bash', 'git add a.php && git commit -m x', false, 'commit'],
  ['bash', 'git -C /c/x -c user.name=a commit -q -F -', false, 'commit'],
  ['powershell', 'git commit -m x', false, 'commit'],
  ['bash', "node \"/c/k/scripts/kit-commit.js\" -- \"a.php\" <<'KIT_MSG'\n47.2: x\nKIT_MSG", false, null],
  ['bash', 'git log --grep commit', false, null],
  ['bash', 'echo "git commit"', false, null],
  ['bash', 'git checkout -b feature', true, 'branch'],
  ['bash', 'git switch -c feature', true, 'branch'],
  ['bash', 'git branch feature', true, 'branch'],
  ['bash', 'git worktree add ../w', true, 'branch'],
  ['bash', 'git checkout -b feature', false, null],
  ['bash', 'git branch', true, null],
  ['bash', 'git branch -d old', true, null],
  ['bash', 'git checkout -- a.php', true, null],
];
test('checkGit: коммит и ветки', ...); // 'commit' → /\/kit:step-done/, 'branch' → /ветки и worktree нельзя/
test('guard-bash: в проекте Мэтта git commit — отказ с [kit], в обычном kit-проекте — пропуск', ...);
// runScript('guard-bash.js', { input: { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: dir } })
```

Шаг 2. `node --test tests/guard-bash.test.js` — FAIL (`checkGit` нет).

Шаг 3. Реализовать.

Шаг 4. `node --test tests/guard-bash.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 47.4`.

## 47.5 — `guard-matt.js` и `hooks.json`

**Файлы:** создать `plugins/kit/scripts/guard-matt.js`; изменить `plugins/kit/hooks/hooks.json`; тест — `tests/guard-matt.test.js`.

**Интерфейсы:** берёт `isMattProject`, `kitInfo`; даёт `checkTool(input: object, ctx: { root: string, docsRel: string, always: boolean }) → string | null`.

Правила:
- `Write`, `Edit`, `MultiEdit`, `NotebookEdit`: путь — `tool_input.file_path || tool_input.notebook_path`, относительно `ctx.root`
  (`path.resolve(root, p)`, `\` → `/`, без регистра); вне проекта (`..` или другой диск) — `null`; в корне `glossary.md`,
  `glossary-map.md`, `context.md`, `context-map.md` или начало `docs/adr/`, `docs/agents/`, `.scratch/` → `REASON_FILES`;
- `Agent` и `Task` с `tool_input.isolation === 'worktree'`, `mcp__ccd_session__start_session` с `tool_input.use_worktree === true` —
  при `ctx.always` → `REASON_WORKTREE`;
- `REASON_FILES = 'Файлы системы Мэтта — в <docs>/: глоссарий — GLOSSARY.md, ADR — adr/, карта, спек и тикеты — work/<тема>/ и work/<тема>-build/. В корень проекта (на сайте это корень сайта) их не кладём.'` (`<docs>` — `ctx.docsRel`);
- `REASON_WORKTREE = 'При автозаливке PhpStorm отдельная копия (worktree) не годится: правки из неё не дойдут до сервера и разойдутся с основной папкой. Запускай без worktree.'`;
- `main` — как в `guard-bash.js`: только kit-проект с `isMattProject`; `ctx.root` — `projectRoot(dir)`; отказ —
  `hookSpecificOutput.permissionDecision: 'deny'`, причина с `[kit] `; исключение — тихо;
- `hooks.json`, в `PreToolUse` после записи `Bash|PowerShell`: `{ "matcher": "Write|Edit|MultiEdit|NotebookEdit|Agent|Task|mcp__ccd_session__start_session", "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/guard-matt.js"], "timeout": 10 } ] }`.

Шаг 1. Тесты:

```js
const CASES = [ // корень C:\proj; [инструмент, ввод, автозаливка, ожидание]
  ['Write', { file_path: 'C:\\proj\\GLOSSARY.md' }, false, 'files'],
  ['Write', { file_path: 'c:/PROJ/glossary.md' }, false, 'files'],
  ['Edit', { file_path: 'docs/adr/0001-x.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\.scratch\\x\\issues\\01-a.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\.claude\\docs\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\local\\docs\\adr\\x.md' }, false, null],
  ['Write', { file_path: 'C:\\Temp\\GLOSSARY.md' }, false, null],
  ['Agent', { isolation: 'worktree', prompt: 'x' }, true, 'worktree'],
  ['mcp__ccd_session__start_session', { use_worktree: true }, true, 'worktree'],
  ['mcp__ccd_session__start_session', { use_worktree: true }, false, null],
  ['Agent', { prompt: 'x' }, true, null],
];
test('checkTool: файлы Мэтта в корне и worktree при автозаливке', ...); // 'files' → /\.claude\/docs\/: глоссарий/, 'worktree' → /worktree\) не годится/
test('guard-matt: чужой и обычный kit-проект — пропуск, проект Мэтта — отказ с [kit]', ...);
test('hooks.json: guard-matt.js в PreToolUse на Write|Edit|MultiEdit|NotebookEdit|Agent|Task|mcp__ccd_session__start_session', ...);
```

Шаг 2. `node --test tests/guard-matt.test.js` — FAIL.

Шаг 3. Написать `guard-matt.js`, дописать `hooks.json`.

Шаг 4. `node --test tests/guard-matt.test.js` — PASS; `npm test` — PASS; `claude plugin validate plugins/kit --strict` — без ошибок.

Шаг 5. `/kit:step-done 47.5`.

## 47.6 — навык `/kit:matt`

**Файлы:** создать `plugins/kit/skills/matt/SKILL.md`; тест — новый в `tests/content.test.js`.

**Интерфейсы:** берёт `node "${CLAUDE_PLUGIN_ROOT}/scripts/matt-skill.js" <имя>` (47.2) и `/kit:step-done` как есть.

Frontmatter: `name: matt`; `description` в кавычках (в нём «: »): «Большая работа в проекте Мэтта (kit-проект с «Система Мэтта: да»):
общая сессия-координатор, исполнитель на каждый тикет — подчинённая сессия или субагент, приёмка через /kit:step-done, режим без
пользователя и разбор потом. Вызывай сам, когда в проекте Мэтта начинается работа больше одной-двух сессий.»; без
`disable-model-invocation`. Объём — не больше 12 КБ.

Разделы и что в каждом:
- `## 1. Когда и маршрут` — Т-5: большая работа → общая сессия; маршрут — карта `wayfinder`, или `grill-with-docs` → `to-spec` →
  `to-tickets`, или сразу сделать; предложить через AskUserQuestion; карту общая сессия рисует сама по файлу навыка
  (`matt-skill.js wayfinder`).
- `## 2. Папки и документы` — Т-4: папки; спек и план kit (`spec-*.md`, `plan-*.md`) не пишутся; обе папки темы — строкой `DOCS` со
  статусом `в работе, этап <номер этапа реализации>`, тогда закрытие этапа реализации (`reference/stage-close.md` у `/kit:step-done`)
  перенесёт их в `archive/` вместе; глоссарий и ADR — `постоянный`.
- `## 3. Этапы и шаги` — два этапа: подготовка (тикеты карты, номер тикета = номер шага, затем спек и нарезка; без карты — два шага) и
  реализация (номер тикета = номер шага); `STAGE` — `<N> — <тема>: подготовка (система Мэтта, <docs>/work/<тема>/)` и
  `<N+1> — <тема>: реализация (система Мэтта, <docs>/work/<тема>-build/)`; `NEXT` — следующий тикет с путём.
- `## 4. Общая сессия` — Т-5, Т-6: фронт — открытые, незаблокированные, не взятые, первый по номеру; исполнитель с пользователем —
  `mcp__ccd_session__start_session` (`context` — `fresh`, `use_worktree` — `false`), можно несколько сразу; без пользователя —
  фоновый субагент, тикеты реализации — по одному; отчёт исполнителя — коротко.
- `## 5. Задание исполнителю` — шаблон дословно, блоком:

```
Тикет <путь> — «<заголовок>». Только этот тикет.
Навык: прочитай <путь из matt-skill.js> и следуй ему (или пользователь введёт /mattpocock-skills:<имя>).
Сначала прочитай: <правила тикетов README.md, если есть>, тикет, разделы спека по его ссылкам, глоссарий <docs>/GLOSSARY.md и ADR <docs>/adr/ в той части, что он задевает.
Возьми тикет: Status: claimed — до начала работы.
Нельзя: коммитить; ветки и worktree; документы вне <docs>/ (GLOSSARY.md, docs/adr, .scratch в корне — нельзя); трогать .idea; ставить пакеты без согласия пользователя.
Вопросы пользователю — через AskUserQuestion, по-русски. [Субагент: вопрос — в ## Comments тикета, Status: ready-for-human, и закончи.]
Готово: допиши в тикет сводку (что сделано, проверки и их итог, файлы), Status: ready-for-human; отчёт — что сделано, файлы, проверки, вопросы.
```

- `## 6. Приёмка` — Т-8: `/kit:step-done <этап>.<номер тикета>` в общей сессии; пути коммита — файлы тикета из отчёта;
  `Status: resolved` — до коммита, в тех же путях; `DECISIONS` — по строке на решение тикета со ссылкой на тикет или ADR, без пересказа
  ответов; `--inbox N` — до последнего ответа этого тикета включительно (ответы ещё идущих тикетов сохранятся в их тикетах);
  исправления — шагом с буквой.
- `## 7. Без пользователя` — Т-9: только по слову пользователя; `/kit:step-done` — разделы 1–3 и 5, раздел 4 (просмотр) пропускается,
  в `SUMMARY` — «принят без просмотра»; перед закрытием — проверки проекта и ревью субагентом по `mattpocock-skills:code-review`;
  вопрос — в `## Comments`, `ready-for-human`, дальше следующий тикет; между тикетами — расход лимитов
  (`mcp__ccd_session_mgmt__get_usage`, если есть), остановка до лимита и к сроку пользователя; не включать при «Выкладка: PhpStorm
  Always» с «Окружение: прод»; при «Claude по SSH» — без заливки, её делает разбор по `reference/ssh.md`.
- `## 8. Разбор, когда пользователь вернулся` — тикеты «принят без просмотра» по одному: сводка и `git show --stat <коммит>`;
  замечания — исправлением по разделу 6; вопросы из `## Comments` — через AskUserQuestion; «Claude по SSH» — одна заливка и проверка
  на сервере по `reference/ssh.md`.
- `## 9. Края` — из спека: файла навыка нет (сказать, предложить команду, сверить правила); исполнитель оборвался — тикет `claimed`,
  вернуть в очередь или спросить; общие файлы (карта, глоссарий) — коммиты по одному; сжатие контекста — «Сейчас», карта, строки
  `Status:`; лимиты.

Шаг 1. Тест в `tests/content.test.js`:

```js
test('matt: общая сессия, папки, задание исполнителю, приёмка, режим без пользователя; не больше 12 КБ', () => {
  assert.ok(fs.statSync(path.join(PLUGIN, 'skills', 'matt', 'SKILL.md')).size <= 12288);
  const { fm, body } = skill('matt');
  assert.equal(fm.name, 'matt');
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  for (const s of ['scripts/matt-skill.js"', 'work/<тема>-build/', 'в работе, этап', 'mcp__ccd_session__start_session', '`fresh`',
    '`use_worktree`', 'Status: claimed', 'Status: ready-for-human', 'Status: resolved', '## Comments', 'AskUserQuestion',
    '/kit:step-done', '--inbox', 'принят без просмотра', 'mattpocock-skills:code-review', 'PhpStorm Always', 'reference/ssh.md',
    'git show --stat', 'implement-spec']) {
    assert.ok(body.includes(s), s);
  }
});
```

Шаг 2. `node --test tests/content.test.js` — FAIL (навыка нет).

Шаг 3. Написать `SKILL.md` по разделам выше.

Шаг 4. `node --test tests/content.test.js` — PASS, вместе с общими проверками frontmatter и ссылок `${CLAUDE_PLUGIN_ROOT}/…`;
`npm test` — PASS; `claude plugin validate plugins/kit --strict`.

Шаг 5. `/kit:step-done 47.6`.

## 47.7 — `/kit:project-init`

**Файлы:** изменить `plugins/kit/skills/project-init/SKILL.md` (раздел 1, раздел 2 — третий вызов, п. 4.3, новый п. 4.6а, раздел 5) и
`plugins/kit/skills/project-init/templates/CLAUDE.md`; тесты — `tests/templates.test.js`, `tests/content.test.js`.

**Интерфейсы:** берёт `matt-skill.js --status` (47.2); даёт параметр `- Система Мэтта: да | нет` — его читают `isMattProject` (47.2),
`session-start.js` (47.3) и стражи (47.4, 47.5).

Правки:
- Раздел 1 «Разведка» — пункт: «**Система Мэтта:** параметр «Система Мэтта»; стоит ли плагин на проект —
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/matt-skill.js" --status`.»
- Раздел 2, третий вызов — «удалённый репозиторий, скиллы Битрикса и система Мэтта»; вопрос 3, при каждом запуске, любой режим:
  «Вести проект по системе Мэтта Покока?» — «Да — большой проект» / «Нет»; параметр уже «да» — «Да» первым; без «(Рекомендую)»:
  решает объём работы, который знает пользователь. В тексте вопроса: для больших проектов — грилинг (вопросы до кода) с глоссарием и
  ADR, карта решений, спек, тикеты; каждый тикет — в свежей сессии, общая сессия принимает их через `/kit:step-done`; «Да» — плагин
  mattpocock-skills ставится на этот проект, superpowers в нём выключается, нужен перезапуск сессии; сейчас — строка `--status`.
  Ответ — п. 4.6а.
- П. 4.3 — абзац: «Параметр «Система Мэтта» — ответ на вопрос «Вести проект по системе Мэтта Покока?» (`да` / `нет`); строки нет —
  допиши перед «Версия kit», входит в план на согласие.»
- Новый `### 4.6а Система Мэтта — любой режим` после п. 4.6:
  - «Да»: `--status` уже `установлен …, включён` — установку пропусти; иначе Bash (параметр `timeout` — 300000)
    `claude plugin install mattpocock-skills@claude-plugins-official --scope project`; плагин стоит, но выключен —
    `claude plugin enable mattpocock-skills@claude-plugins-official --scope project`; затем
    `claude plugin disable superpowers@claude-plugins-official --scope project`; сверка — `--status` → `установлен …, включён`. Не
    скачался (сеть) — причину пользователю; параметр всё равно «да» — при старте сессии будет напоминание.
  - «Нет», а параметр был «да»: `claude plugin disable mattpocock-skills@claude-plugins-official --scope project` и
    `claude plugin enable superpowers@claude-plugins-official --scope project`; глоссарий, ADR и папки тем не трогай.
  - Строку итога — в `SUMMARY` шага 4.8.
- Раздел 5 «Итог» — если плагины менялись: «перезапустите сессию — плагины подхватываются при старте».
- Шаблон `CLAUDE.md` — строка `- Система Мэтта: {{да | нет}}` перед `- Версия kit:`.

Шаг 1. Тесты: в `tests/templates.test.js` — ключ `'система мэтта'` в списке теста «раздел параметров со всеми ключами»; в
`tests/content.test.js`:

```js
test('project-init: система Мэтта — вопрос, параметр, плагин на проект и выключение superpowers (п. 4.6а)', () => {
  const read = (...p) => fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', ...p), 'utf8');
  const init = read('SKILL.md');
  for (const s of ['«Вести проект по системе Мэтта Покока?»', '### 4.6а Система Мэтта', 'scripts/matt-skill.js" --status',
    'claude plugin install mattpocock-skills@claude-plugins-official --scope project',
    'claude plugin enable mattpocock-skills@claude-plugins-official --scope project',
    'claude plugin disable superpowers@claude-plugins-official --scope project',
    'claude plugin disable mattpocock-skills@claude-plugins-official --scope project',
    'claude plugin enable superpowers@claude-plugins-official --scope project', 'перезапустите сессию']) {
    assert.ok(init.includes(s), 'project-init: ' + s);
  }
  assert.match(read('templates', 'CLAUDE.md'), /^- Система Мэтта: \{\{да \| нет\}\}$/m);
});
```

Шаг 2. `node --test tests/templates.test.js tests/content.test.js` — новые проверки FAIL.

Шаг 3. `claude plugin enable --help` и `claude plugin disable --help` — у обеих есть `--scope` со значением `project`; внести правки.

Шаг 4. Те же тесты — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 47.7`.

## 47.8 — выпуск kit 3.3.0: версии, README, обзор

**Файлы:** `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`version` → `3.3.0`), `.claude/CLAUDE.md`
(«Версия kit: 3.3.0»), `README.md`, `.claude/docs/work/overview/build/build.js`, `.claude/docs/work/overview/build/diagrams.js` и
собранные файлы обзора.

Шаг 1. Версии → `3.3.0` (тест `manifest.test.js` «marketplace.json и plugin.json согласованы»).

Шаг 2. README: раздел `## Система Мэтта Покока для больших проектов (с 3.3.0)` после `## Superpowers в kit-проекте (с 2.8.0)` — что
это (ссылка на https://github.com/mattpocock/skills, MIT), вопрос в `/kit:project-init`, что ставится и выключается, перезапуск,
общая сессия и исполнители, приёмка, режим без пользователя, где лежат файлы, подстраховка хуками; в `## Что внутри` — навык
`/kit:matt`, хук `guard-matt.js`, скрипт `matt-skill.js`, новые отказы `guard-bash.js`; в `## Параметры для агентов` — строка
«Система Мэтта».

Шаг 3. Обзор: в `build.js` — `guard-matt.js` в списке и таблице хуков, строка «Система Мэтта» в таблице параметров, отказы (коммит,
ветки, файлы в корне, worktree) в таблице стражей, навык `/kit:matt` в списке навыков; в `diagrams.js` — блок `guard-matt.js` рядом с
`guard-bash.js`. Сборка: `node .claude/docs/work/overview/build/build.js`.

Шаг 4. `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`,
`node tools/kit-denylist.js tree` — чисто.

Шаг 5. `/kit:step-done 47.8`.

## 47.9 — выпуск kit 3.3.0: отправка, установка и живая проверка

Шаг 1. С согласия пользователя — `git push origin master`; затем `claude plugin marketplace update claude-kit` и
`claude plugin update kit@claude-kit`; перезапуск сессии; `claude plugin list` — kit 3.3.0.

Шаг 2. Проект для проверки выбирает пользователь (AskUserQuestion). Сценарий — «Критерии готовности» спека:
- `/kit:project-init` → «Да» → параметр записан, плагин на проекте, superpowers выключен; после перезапуска навыки
  `mattpocock-skills:` видны, superpowers — нет;
- мелкая задача — без карты, `/kit:step-done`;
- большая (учебная, 2–3 тикета) — маршрут, общая сессия, тикет с пользователем в подчинённой сессии, тикет без пользователя у
  субагента, приёмка одним коммитом с файлами тикета, `Status: resolved`, в «Сейчас» — следующий тикет; файлы — только в `<docs>/`;
- без пользователя — два тикета подряд, пометка «принят без просмотра», разбор;
- стражи: `git commit` руками, `GLOSSARY.md` в корень, ветка при автозаливке (если у проекта она есть) — отказ с подсказкой;
- «Нет» при повторном `/kit:project-init` — superpowers вернулся.

Шаг 3. Найденное — исправления шагами `47.9а`, `47.9б` и выпуск 3.3.1, если понадобится.

Шаг 4. `/kit:step-done 47.9` — этап закрыт (`NEXT` — `—`), спек и план уходят в `archive/`.
