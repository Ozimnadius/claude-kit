# План реализации: этап 11 — папка документов `.claude/docs` и исключения PhpStorm

> **Для исполнителя:** обязательный навык — superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans; задачи выполняются по порядку, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** документы kit-проекта — в `.claude/docs` (журнал и план выкладки в корне, `work/`, `archive/`, снимки `visual/`), реестр «Документы» в журнале и перенос в архив при закрытии этапа; исключения PhpStorm (Excluded Paths) дописывает хук SessionStart `phpstorm-exclude.js`; существующие проекты переезжают через `/kit:project-init`, пилот — сам claude-kit; версия 2.3.0.

**Архитектура:** папка документов — папка журнала (`lib/project.js`: `docsRel`, `planRel`, `visualRel`; умолчание `.claude/docs/progress.md`, запасной путь `docs/progress.md`), новых параметров нет. `lib/deployment.js` читает `.idea/deployment.xml` и дописывает `excludedPath` вставкой строк в текст (остальное — байт в байт); `phpstorm-exclude.js` — хук (`--hook`) и CLI (`--check`, `--also`) поверх неё. Потребители папки документов (`visual.js`, `guard.js`, `check-closed.js`, `secret-scan.js`, `session-start.js`) берут пути из `kitInfo`. Реестр ведёт docs-keeper (блок DOCS), перенос в архив — основной агент в `/kit:step-done` (Move-Item, оба пути в FILES — git видит переименование). Переезд — новый п. 4.7 `/kit:project-init`.

**Стек:** Node.js ≥ 18 (установлен v24.15.0), `node:test`, git 2.48, Claude Code 2.1.278+, PhpStorm (живая проверка), без новых npm-зависимостей.

**Спек:** `docs/spec-claude-kit.md` — дополнение 2026-09-28: §2 (решения), §3 (защищённые пути), §4 (структура и папка документов), §5, §6.1–6.2, §7.1 (п. 2а — архив), §7.3 (п. 4.0, 4.4, 4.5, 4.7 — переезд), §7.5, §8 (`phpstorm-exclude.js`, правило 10 `session-start`), §9 (`check-closed`, `visual.js`, `guard.js`), §10, §11, §13 — читать вместе с планом.

**Как проверен код плана:** весь код и тексты ниже собраны и прогнаны 2026-09-28 в копии репозитория (база — `f364307`, после 11.1а): `npm test` — 280 тестов, 277 ✔, 3 пропущены (симлинки из 9.3, как в `master`); задачи по отдельности, по порядку, на чистой копии базы — после каждой 0 ✖ (11.3 — 256 тестов, 11.4 — 267, 11.5 — 276, 11.6 — 279, 11.7 — 279, 11.8 — 280, 11.9 — 280), итог совпадает с проверенной копией байт в байт; `claude plugin validate --strict` (плагин и маркетплейс) чистый; на временных проектах `make-it-project.js` (новая раскладка с `--deployment` и старая `--old`) хук дописал `.idea, .git, .claude`, `session-start` показал журнал `.claude/docs/progress.md` и правило про документы; перенос в архив одним коммитом (`git add -A -- старый новый` + `git commit -- …`) даёт `{work => archive}/…`, чужой файл из индекса в коммит не попадает. По ходу проверки найдено и учтено в спеке: `check-closed` пропускал бы исключённую `.claude` целиком (теперь проверяет её — на сервере могли остаться старые копии), шаблоны `.gitignore` игнорировали бы `.claude/docs`.

## Общие ограничения

- Node.js ≥ 18, CommonJS, `'use strict'`; исполняемые скрипты — `#!/usr/bin/env node`. Новых npm-зависимостей нет.
- Windows 11: PowerShell 5.1 и Git Bash. Файлы — UTF-8 без BOM, переводы строк LF. Тексты для пользователя, комментарии и сообщения — по-русски.
- Тесты: `node --test tests/*.test.js` (или `npm test`) из корня рабочей копии этапа 11; `node_modules` с devDependencies (`pngjs`, `pixelmatch`) должен быть в корне — без него падают тесты снимков (`npm ci` — только контроллер и только с согласия пользователя; можно скопировать `node_modules` из другой рабочей копии).
- Bash: без `cd` в основной оболочке (страж kit блокирует) — абсолютные пути, `git -C <путь>`, подоболочка `( cd … && … )`. В heredoc Git Bash обратные слеши портятся — правки с `\` делать через Edit/Write, не через heredoc.
- **`.idea` Claude не правит.** Единственное исключение — `phpstorm-exclude.js` (он сам — внешний процесс). В тестах — только временные папки; на проектах пользователя скрипт запускает контроллер с согласия пользователя (11.11).
- **Защищённые пути Claude Code:** `.claude` (кроме `.claude/worktrees`) и `.idea` — запись инструментами Edit/Write в режимах Manual/acceptEdits просит подтверждения; исполнители плана пишут только в `plugins/`, `tests/`, `README.md`, `.claude-plugin/` — туда подтверждения не нужны.
- Версия плагина меняется только в задаче 11.9: `2.3.0` одинаково в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json`.
- **Git и журнал:** исполнитель не коммитит и не правит журнал; из git ему можно только читать (`status`, `diff`, `log`, `show`). Шаг закрывает контроллер после ревью через `/kit:step-done` (docs-keeper → git-keeper, один коммит `11.N: …`); исправления по ревью — отдельными коммитами с тем же ID и буквой (`11.5а`), без amend.
- Код ниже — готовый: новые файлы — целиком, изменения существующих — диффами (`git diff`) от базы `f364307`. Применять буквально; если контекст диффа не совпадает (файл ушёл вперёд) — стоп и вопрос контроллеру.

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `plugins/kit/scripts/lib/project.js` | папка документов: журнал по умолчанию и запасной, `docsRel`, `planRel`, `visualRel`, `docsInClaude` | 11.3 |
| `tests/lib.test.js`, `tests/deploy-list.test.js` | тесты `kitInfo`; план выкладки в `.claude/docs` | 11.3 |
| `plugins/kit/scripts/lib/deployment.js` | чтение `deployment.xml`, `isExcluded`, `addExclusions` (вставка строк) | 11.4 |
| `tests/deployment-fixtures.js`, `tests/deployment.test.js` | фикстуры формы настоящих файлов пользователя и тесты | 11.4 |
| `plugins/kit/scripts/phpstorm-exclude.js`, `plugins/kit/hooks/hooks.json` | хук и CLI исключений; второй хук SessionStart | 11.5 |
| `tests/phpstorm-exclude.test.js` | тесты хука и CLI | 11.5 |
| `plugins/kit/scripts/lib/visual/guard.js`, `visual.js`, `lib/visual/report.js` | снимки в `<папка документов>/visual`, исключение предка | 11.6 |
| `plugins/kit/scripts/check-closed.js` | исключённая `.claude` проверяется, снимки не обходятся | 11.6 |
| `plugins/kit/scripts/secret-scan.js`, `plugins/kit/scripts/session-start.js` | `.claude/docs/visual` в запретах; правило 10 про документы | 11.6 |
| `tests/visual-guard.test.js`, `tests/visual-cli.test.js`, `tests/net.test.js`, `tests/secret-scan.test.js`, `tests/session-start.test.js` | тесты потребителей | 11.6 |
| `plugins/kit/agents/docs-keeper.md`, `git-keeper.md`, `plugins/kit/skills/step-done/SKILL.md` | DOCS, реестр, архив; запрет снимков | 11.7 |
| `plugins/kit/skills/project-init/templates/*`, `reference/phpstorm.md`, `reference/bitrix.md`, `tests/templates.test.js` | шаблоны и справки | 11.8 |
| `plugins/kit/skills/project-init/SKILL.md`, `plugins/kit/skills/visual/SKILL.md`, `reference/pages.md` | исключения скриптом, переезд (п. 4.7); пути снимков | 11.8 |
| `tests/content.test.js` | тексты агентов и скиллов (ханки 1–3 — 11.7, 4–6 — 11.8) | 11.7, 11.8 |
| `README.md`, `plugin.json`, `marketplace.json`, `tests/integration/make-it-project.js` | описание, версия 2.3.0, интеграционный проект | 11.9 |

## Шаги журнала и остановки

| Часть | Шаги | Кто | Остановка на проверку пользователя |
|---|---|---|---|
| A — код без живых проверок | 11.3 `lib/project.js`, 11.4 `lib/deployment.js`, 11.5 `phpstorm-exclude.js` и хук, 11.6 потребители папки документов | исполнители (sonnet), ревью по каждой задаче | после 11.6 |
| B — тексты, версия, интеграция | 11.7 агенты и step-done, 11.8 шаблоны, справки, project-init и visual, 11.9 README, 2.3.0, интеграция `claude -p` (контроллер) | исполнители (sonnet), ревью | после 11.9 |
| C — живые проверки | 11.10 хук на проекте пользователя с открытым PhpStorm, 11.11 пилот переезда — сам claude-kit | контроллер с пользователем | после 11.11 |
| D — выпуск | 11.12 финальное ревью (opus), исправления, слияние в `master`, обновление установленного плагина, push с согласия | контроллер | в конце |

---

## Часть A — код без живых проверок

### Задача 11.3: `lib/project.js` — папка документов

**Files:**
- Modify: `plugins/kit/scripts/lib/project.js`
- Test: `tests/lib.test.js`, `tests/deploy-list.test.js`

**Interfaces:**
- Consumes: `readParams(dir)` из `lib/params.js` (`params.get(ключ, умолчание)`, `params.found`, `params.list`).
- Produces (для 11.5, 11.6): `JOURNAL_DEFAULTS = ['.claude/docs/progress.md', 'docs/progress.md']`; `kitInfo(dir) → { dir, params, journalRel, journalPath, hasJournal, docsRel, planRel, visualRel, isKit }` — пути от корня проекта через `/`; журнал в корне — `docsRel` `'.'`, `planRel` `'deploy-prod.md'`, `visualRel` `'visual'`; `docsInClaude(docsRel) → boolean` (`/^\.claude(\/|$)/i`). `readStdinJson`, `resolveProjectDir` — без изменений.

- [ ] **Шаг 1: тесты.** В `tests/lib.test.js` — импорт `docsInClaude` и новый тест `kitInfo: папка документов…`; в `tests/deploy-list.test.js` — журнал `docs/progress.md` в данных старого проекта (как в настоящих проектах: план без журнала не бывает) и тест новой раскладки:

````diff
diff --git a/tests/lib.test.js b/tests/lib.test.js
index 06a75bd..e8067dc 100644
--- a/tests/lib.test.js
+++ b/tests/lib.test.js
@@ -5,7 +5,7 @@ const path = require('path');
 const { parseParams, splitList, readParams } = require('../plugins/kit/scripts/lib/params');
 const { getSection, parseTable } = require('../plugins/kit/scripts/lib/md');
 const { parseRules, matchRules, norm } = require('../plugins/kit/scripts/lib/paths');
-const { kitInfo, resolveProjectDir } = require('../plugins/kit/scripts/lib/project');
+const { kitInfo, resolveProjectDir, docsInClaude } = require('../plugins/kit/scripts/lib/project');
 const { makeProject } = require('./helpers');
 const { ALPHA_CLAUDE_MD, paramsMd, progressMd } = require('./fixtures');
 
@@ -126,6 +126,35 @@ test('kitInfo: журнал, параметры, чужой проект', () =>
   assert.equal(kitInfo(makeProject({ 'index.php': '' })).isKit, false);
 });
 
+test('kitInfo: папка документов — .claude/docs по умолчанию, старая docs/ — запасной путь, параметр важнее', () => {
+  const fresh = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }) }));
+  assert.equal(fresh.journalRel, '.claude/docs/progress.md');
+  assert.equal(fresh.docsRel, '.claude/docs');
+  assert.equal(fresh.planRel, '.claude/docs/deploy-prod.md');
+  assert.equal(fresh.visualRel, '.claude/docs/visual');
+  assert.equal(fresh.hasJournal, false);
+  const moved = kitInfo(makeProject({ '.claude/docs/progress.md': progressMd(), 'docs/progress.md': progressMd() }));
+  assert.equal(moved.journalRel, '.claude/docs/progress.md', 'новая раскладка важнее старой');
+  assert.equal(moved.isKit, true);
+  const old = kitInfo(makeProject({ 'docs/progress.md': progressMd() }));
+  assert.equal(old.journalRel, 'docs/progress.md');
+  assert.equal(old.docsRel, 'docs');
+  assert.equal(old.planRel, 'docs/deploy-prod.md');
+  assert.equal(old.visualRel, 'docs/visual');
+  const param = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'docs\\progress.md', 'План выкладки': 'deploy.md' }), '.claude/docs/progress.md': progressMd() }));
+  assert.equal(param.journalRel, 'docs/progress.md', 'параметр важнее найденного файла; \\ → /');
+  assert.equal(param.hasJournal, false);
+  assert.equal(param.planRel, 'deploy.md');
+  assert.equal(param.visualRel, 'docs/visual');
+  const root = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'progress.md' }) }));
+  assert.equal(root.docsRel, '.');
+  assert.equal(root.planRel, 'deploy-prod.md');
+  assert.equal(root.visualRel, 'visual');
+  assert.equal(docsInClaude('.claude/docs'), true);
+  assert.equal(docsInClaude('docs'), false);
+  assert.equal(docsInClaude('.claudex/docs'), false);
+});
+
 test('resolveProjectDir: CLAUDE_PROJECT_DIR важнее cwd из stdin', () => {
   const saved = process.env.CLAUDE_PROJECT_DIR;
   process.env.CLAUDE_PROJECT_DIR = 'C:\\proj';
````

````diff
diff --git a/tests/deploy-list.test.js b/tests/deploy-list.test.js
index 3603e81..b2c4f9e 100644
--- a/tests/deploy-list.test.js
+++ b/tests/deploy-list.test.js
@@ -18,7 +18,7 @@ const planMd = (commit) => [
 function setup(mode) {
   const dir = gitRepo({
     '.claude/CLAUDE.md': paramsMd({ 'Выкладка': mode, 'Не выкладывать': '.claude, .gitignore' }),
-    'a.php': '1', 'b.php': '1', 'docs/deploy-prod.md': '# пусто\n',
+    'a.php': '1', 'b.php': '1', 'docs/progress.md': '# журнал\n', 'docs/deploy-prod.md': '# пусто\n',
   });
   const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
   writeFiles(dir, { 'docs/deploy-prod.md': planMd(base), 'a.php': '2', 'c.php': 'new', '.claude/scripts/x.php': 'x' });
@@ -62,6 +62,21 @@ test('«вручную; дев — PhpStorm Always»: прод вручную 
   assert.doesNotMatch(runScript('deploy-list.js', { cwd: lower.dir }).stdout, /Залить \(/, 'регистр и пробелы не важны');
 });
 
+test('новая раскладка: план выкладки — .claude/docs/deploy-prod.md без параметра', () => {
+  const dir = gitRepo({
+    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Не выкладывать': '.claude' }),
+    'a.php': '1', '.claude/docs/progress.md': '# журнал\n', '.claude/docs/deploy-prod.md': '# пусто\n',
+  });
+  const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
+  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd(base), 'a.php': '2' });
+  git(dir, 'add', '-A');
+  git(dir, 'commit', '-q', '-m', '1.2: правка');
+  const r = runScript('deploy-list.js', { cwd: dir });
+  assert.equal(r.code, 0, r.stderr);
+  assert.match(r.stdout, new RegExp('База: ' + base + ' \\(«Залито на прод» в \\.claude/docs/deploy-prod\\.md\\)'));
+  assert.match(r.stdout, /Залить \(1\):\n  M a\.php/, '.claude — в «Не выкладывать», план не предлагается');
+});
+
 test('без плана — от первого коммита; --base', () => {
   const dir = gitRepo({ 'a.php': '1' });
   const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
````

- [ ] **Шаг 2: убедиться, что тесты падают.** `node --test tests/lib.test.js tests/deploy-list.test.js` — ожидается FAIL: `docsInClaude is not a function`, у `fresh.journalRel` — `docs/progress.md`, план в `.claude/docs` не находится.

- [ ] **Шаг 3: реализация** — `plugins/kit/scripts/lib/project.js` целиком:

````js
'use strict';
// Общее для хуков и инструментов: вход хука, папка проекта, признаки kit-проекта, папка документов.
const fs = require('fs');
const path = require('path');
const { readParams } = require('./params');

// Журнал по умолчанию: новая раскладка (с 2.3.0), затем старая — проекты, которые ещё не переехали.
const JOURNAL_DEFAULTS = ['.claude/docs/progress.md', 'docs/progress.md'];

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function resolveProjectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}

const slash = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// Параметр «Журнал»; не задан — первый существующий из JOURNAL_DEFAULTS, иначе новая раскладка.
function journalOf(dir, params) {
  const fromParam = params.get('Журнал', '');
  if (fromParam) return slash(fromParam);
  return JOURNAL_DEFAULTS.find((rel) => fs.existsSync(path.resolve(dir, rel))) || JOURNAL_DEFAULTS[0];
}

// Kit-проект — есть раздел «Параметры для агентов» или файл журнала.
// Папка документов — папка журнала: там план выкладки по умолчанию, work/, archive/ и снимки visual/.
function kitInfo(dir) {
  const params = readParams(dir);
  const journalRel = journalOf(dir, params);
  const journalPath = path.resolve(dir, journalRel);
  const hasJournal = fs.existsSync(journalPath);
  const docsRel = path.posix.dirname(journalRel);
  const inDocs = (name) => (docsRel === '.' ? name : docsRel + '/' + name);
  return {
    dir,
    params,
    journalRel,
    journalPath,
    hasJournal,
    docsRel,
    planRel: slash(params.get('План выкладки', '') || inDocs('deploy-prod.md')),
    visualRel: inDocs('visual'),
    isKit: params.found || hasJournal,
  };
}

// Папка документов лежит внутри .claude (новая раскладка) — её закрывает исключение .claude.
function docsInClaude(docsRel) {
  return /^\.claude(\/|$)/i.test(docsRel);
}

module.exports = { JOURNAL_DEFAULTS, readStdinJson, resolveProjectDir, kitInfo, docsInClaude };
````

- [ ] **Шаг 4: тесты проходят.** `node --test tests/lib.test.js tests/deploy-list.test.js tests/session-start.test.js` — всё ✔ (session-start не менялся — проверка, что умолчание не сломало вывод «Сейчас»).

- [ ] **Шаг 5: сдать контроллеру** — без коммита: список файлов и вывод тестов.

### Задача 11.4: `lib/deployment.js` — чтение и дописывание исключений

**Files:**
- Create: `plugins/kit/scripts/lib/deployment.js`
- Create: `tests/deployment-fixtures.js` (фикстуры, не тест)
- Test: `tests/deployment.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces (для 11.5, 11.6): `class DeploymentError extends Error`; `readDeployment(xml) → { always, server, excluded: string[], servers: [{ name, root, excluded }] }` (`excluded` — у сервера по умолчанию, блок не найден — по всему файлу; `root` — есть `<mapping … local="$PROJECT_DIR$" …/>`; чтение терпит обрезанный файл); `isExcluded(list, путь) → boolean` (сам или предок, регистр не важен); `collapse(paths) → string[]`; `addExclusions(xml, paths) → { xml, added: { сервер: [пути] } }` — только серверам с корнем проекта, только недостающее, вставкой строк (перед `</excludedPaths>` с отступом соседних строк; `<excludedPaths />` раскрывается; блока нет — после `</mappings>`), перевод строки — как в файле, XML-экранирование; нет `</paths>` или `</mappings>` — `DeploymentError` с именем сервера; после вставки — самопроверка чтением; `normPath(p)`.
- `tests/deployment-fixtures.js` экспортирует `BETA`, `GAMMA`, `DIST`, `NO_BLOCK`, `TWO`, `BROKEN`, `crlf(s)` — нужны 11.5 и 11.9.

- [ ] **Шаг 1: фикстуры** — `tests/deployment-fixtures.js` целиком (формы настоящих файлов beta, gamma, Theta; `BETA`, `GAMMA`, `DIST` — без перевода строки в конце, как у PhpStorm):

````js
'use strict';
// Фикстуры .idea/deployment.xml — формы настоящих файлов проектов пользователя (2026-09-28).

// beta: автозаливка, локальные и удалённые исключения, docs/visual; в конце файла перевода строки нет.
const BETA = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" autoUploadExternalChanges="true">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
            <excludedPath path="/bitrix" />
            <excludedPath path="/upload" />
            <excludedPath local="true" path="$PROJECT_DIR$/.git" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/scripts" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/settings.local.json" />
            <excludedPath local="true" path="$PROJECT_DIR$/.claude/worktrees" />
            <excludedPath local="true" path="$PROJECT_DIR$/docs/visual" />
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>`;

// gamma: .claude исключена целиком — добавлять нечего.
const GAMMA = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" confirmBeforeUploading="false" autoUploadExternalChanges="true">
    <option name="confirmBeforeUploading" value="false" />
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
            <excludedPath local="true" path="$PROJECT_DIR$/.git" />
            <excludedPath local="true" path="$PROJECT_DIR$/.gitignore" />
            <excludedPath local="true" path="$PROJECT_DIR$/local/modules" />
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>`;

// Theta: сервер сопоставлен с подпапкой dist — его не трогаем.
const DIST = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" confirmBeforeUploading="false" autoUploadExternalChanges="true">
    <option name="confirmBeforeUploading" value="false" />
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$/dist" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
  </component>
</project>`;

// alpha и многие другие: сервер без блока excludedPaths; «On explicit save action».
const NO_BLOCK = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="On explicit save action" serverName="ftp" remoteFilesAllowedToDisappearOnAutoupload="false" autoUploadExternalChanges="true">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
  </component>
</project>
`;

// Два сервера с корнем проекта (прод и дев), у дева пустой <excludedPaths />; третий — подпапка.
const TWO = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="Always" serverName="dev" autoUploadExternalChanges="true">
    <serverData>
      <paths name="prod">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
          <excludedPaths>
            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />
          </excludedPaths>
        </serverdata>
      </paths>
      <paths name="dev">
        <serverdata>
          <mappings>
            <mapping deploy="/www" local="$PROJECT_DIR$/" web="/" />
          </mappings>
          <excludedPaths />
        </serverdata>
      </paths>
      <paths name="static">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$/dist" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
    <option name="myAutoUpload" value="ALWAYS" />
  </component>
</project>
`;

// Обрезанный файл: у сервера нет </paths>.
const BROKEN = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" serverName="ftp">
    <serverData>
      <paths name="ftp">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="$PROJECT_DIR$" web="/" />
          </mappings>
`;

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

module.exports = { BETA, GAMMA, DIST, NO_BLOCK, TWO, BROKEN, crlf };
````

- [ ] **Шаг 2: тесты** — `tests/deployment.test.js` целиком:

````js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DeploymentError, readDeployment, isExcluded, addExclusions, collapse } = require('../plugins/kit/scripts/lib/deployment');
const { BETA, GAMMA, DIST, NO_BLOCK, TWO, BROKEN, crlf } = require('./deployment-fixtures');

const MUST = ['.idea', '.git', '.claude'];

test('readDeployment: автозаливка, сервер по умолчанию, локальные исключения, серверы с корнем проекта', () => {
  const d = readDeployment(BETA);
  assert.equal(d.always, true);
  assert.equal(d.server, 'ftp');
  assert.deepEqual(d.excluded, ['.idea', '.git', '.claude/scripts', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual']);
  assert.deepEqual(d.servers, [{ name: 'ftp', root: true, excluded: d.excluded }]);
  assert.equal(readDeployment(NO_BLOCK).always, false);
  assert.deepEqual(readDeployment(DIST).servers, [{ name: 'ftp', root: false, excluded: [] }]);
  const two = readDeployment(TWO);
  assert.equal(two.server, 'dev');
  assert.deepEqual(two.excluded, [], 'по умолчанию — dev, у него пусто');
  assert.deepEqual(two.servers.map((s) => [s.name, s.root]), [['prod', true], ['dev', true], ['static', false]]);
  assert.equal(readDeployment('<component name="PublishConfigData" serverName="x"><option name="myAutoUpload" value="ALWAYS" /></component>').always, true);
  assert.deepEqual(readDeployment(BROKEN).servers.map((s) => s.name), ['ftp'], 'чтение терпит обрезанный файл');
});

test('isExcluded: сам путь или предок, регистр не важен, не по началу имени', () => {
  const list = ['.claude', 'local/modules/'];
  assert.equal(isExcluded(list, '.claude'), true);
  assert.equal(isExcluded(list, '.claude/docs/visual'), true);
  assert.equal(isExcluded(list, '.Claude\\docs'), true);
  assert.equal(isExcluded(list, 'local/modules/x'), true);
  assert.equal(isExcluded(list, '.claudex'), false);
  assert.equal(isExcluded(list, 'local'), false);
  assert.equal(isExcluded([''], 'a'), false);
});

test('collapse: без повторов и без путей внутри других', () => {
  assert.deepEqual(collapse(['.idea', '.claude', '.claude/scripts', '/docs/', 'docs', '']), ['.idea', '.claude', 'docs']);
});

test('addExclusions: beta — строки дописаны перед </excludedPaths>, остальной текст байт в байт', () => {
  const r = addExclusions(BETA, [...MUST, 'docs']);
  assert.deepEqual(r.added, { ftp: ['.claude', 'docs'] });
  const lines = [
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/docs" />',
  ];
  assert.equal(r.xml, BETA.replace('          </excludedPaths>', lines.join('\n') + '\n          </excludedPaths>'));
  const again = addExclusions(r.xml, [...MUST, 'docs']);
  assert.deepEqual(again.added, {});
  assert.equal(again.xml, r.xml, 'повторный запуск ничего не меняет');
});

test('addExclusions: gamma — всё уже исключено, файл не меняется', () => {
  const r = addExclusions(GAMMA, [...MUST, '.gitignore', 'local/modules', '.claude/docs']);
  assert.deepEqual(r.added, {});
  assert.equal(r.xml, GAMMA);
});

test('addExclusions: сервер с подпапкой (dist) не трогается', () => {
  const r = addExclusions(DIST, MUST);
  assert.deepEqual(r.added, {});
  assert.equal(r.xml, DIST);
});

test('addExclusions: нет блока excludedPaths — создаётся после </mappings> с отступом соседних строк', () => {
  const r = addExclusions(NO_BLOCK, MUST);
  assert.deepEqual(r.added, { ftp: MUST });
  assert.equal(r.xml, NO_BLOCK.replace('          </mappings>\n', [
    '          </mappings>',
    '          <excludedPaths>',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.git" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '          </excludedPaths>',
  ].join('\n') + '\n'));
});

test('addExclusions: два сервера с корнем — оба; <excludedPaths /> раскрывается; подпапка — нет', () => {
  const r = addExclusions(TWO, MUST);
  assert.deepEqual(r.added, { prod: ['.git', '.claude'], dev: MUST });
  assert.ok(r.xml.includes([
    '          <excludedPaths>',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.git" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '          </excludedPaths>',
  ].join('\n')), 'dev: из <excludedPaths /> — блок');
  assert.ok(!r.xml.includes('<excludedPaths />'));
  const d = readDeployment(r.xml);
  assert.deepEqual(d.servers.map((s) => [s.name, s.excluded]), [
    ['prod', ['.idea', '.git', '.claude']], ['dev', MUST], ['static', []],
  ]);
});

test('addExclusions: CRLF сохраняется, одиночных \\n нет', () => {
  for (const src of [crlf(BETA), crlf(NO_BLOCK), crlf(TWO)]) {
    const r = addExclusions(src, MUST);
    assert.ok(Object.keys(r.added).length > 0);
    assert.doesNotMatch(r.xml, /[^\r]\n/);
  }
});

test('addExclusions: блок в одну строку и XML-экранирование пути', () => {
  const inline = NO_BLOCK.replace('          </mappings>\n', '          </mappings>\n          <excludedPaths><excludedPath local="true" path="$PROJECT_DIR$/.idea" /></excludedPaths>\n');
  const r = addExclusions(inline, ['.idea', 'a&b', 'x"y']);
  assert.deepEqual(r.added, { ftp: ['a&b', 'x"y'] });
  assert.ok(r.xml.includes('path="$PROJECT_DIR$/a&amp;b"'));
  assert.ok(r.xml.includes('path="$PROJECT_DIR$/x&quot;y"'));
  assert.deepEqual(readDeployment(r.xml).servers[0].excluded, ['.idea', 'a&b', 'x"y']);
});

test('addExclusions: обрезанный файл или сервер без </mappings> — DeploymentError, ничего не пишется', () => {
  assert.throws(() => addExclusions(BROKEN, MUST), (e) => e instanceof DeploymentError && /«ftp»/.test(e.message) && /<\/paths>/.test(e.message));
  const noMappings = NO_BLOCK.replace(/<mappings>[\s\S]*<\/mappings>/, '<mapping deploy="/" local="$PROJECT_DIR$" web="/" />');
  assert.throws(() => addExclusions(noMappings, MUST), (e) => e instanceof DeploymentError && /<\/mappings>/.test(e.message));
});
````

- [ ] **Шаг 3: убедиться, что тесты падают.** `node --test tests/deployment.test.js` — FAIL: `Cannot find module '../plugins/kit/scripts/lib/deployment'`.

- [ ] **Шаг 4: реализация** — `plugins/kit/scripts/lib/deployment.js` целиком:

````js
'use strict';
// .idea/deployment.xml PhpStorm: чтение настроек выкладки и дописывание исключений (Excluded Paths).
// Файл не пересобирается как XML: новые строки вставляются в текст, всё остальное остаётся байт в байт.

class DeploymentError extends Error {}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

// Блоки серверов <paths name="…">…</paths> по порядку. strict — нет </paths> → DeploymentError (для записи).
function serverBlocks(xml, strict) {
  const out = [];
  const re = /<paths\s+name="([^"]*)"[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = unescapeXml(m[1]);
    if (m[2] === '/') continue;
    const bodyStart = re.lastIndex;
    let bodyEnd = xml.indexOf('</paths>', bodyStart);
    if (bodyEnd < 0) {
      if (strict) throw new DeploymentError(`нет </paths> у сервера «${name}»`);
      bodyEnd = xml.length;
    }
    out.push({ name, bodyStart, bodyEnd, body: xml.slice(bodyStart, bodyEnd) });
    re.lastIndex = bodyEnd;
  }
  return out;
}

// Локальные исключения (local="true") — пути от корня проекта.
function excludedIn(text) {
  const out = [];
  for (const m of text.matchAll(/<excludedPath\b([^>]*?)\/?>/g)) {
    if (!/\blocal="true"/.test(m[1])) continue;
    const p = /\bpath="([^"]*)"/.exec(m[1]);
    if (p) out.push(normPath(unescapeXml(p[1]).replace(/^\$PROJECT_DIR\$/, '')));
  }
  return out;
}

// Сервер сопоставлен с корнем проекта: <mapping … local="$PROJECT_DIR$" …/>.
const rootMapped = (body) => /<mapping\b[^>]*\blocal="\$PROJECT_DIR\$\/?"/.test(body);

// .idea/deployment.xml → { always, server, excluded, servers }. excluded — у сервера по умолчанию
// (serverName → блок <paths name="…">; блок не найден — по всему файлу); servers — [{ name, root, excluded }].
function readDeployment(xml) {
  const comp = /<component\s+name="PublishConfigData"([^>]*)>/.exec(xml);
  const attrs = comp ? comp[1] : '';
  const always = /\bautoUpload="Always"/i.test(attrs) || /<option\s+name="myAutoUpload"\s+value="ALWAYS"/i.test(xml);
  const sm = /\bserverName="([^"]*)"/.exec(attrs);
  const server = sm ? unescapeXml(sm[1]) : null;
  const blocks = serverBlocks(xml, false);
  const def = server === null ? null : blocks.find((b) => b.name === server);
  return {
    always,
    server,
    excluded: excludedIn(def ? def.body : xml),
    servers: blocks.map((b) => ({ name: b.name, root: rootMapped(b.body), excluded: excludedIn(b.body) })),
  };
}

// Путь исключён сам или через папку-предка (регистр не важен: Windows).
function isExcluded(list, p) {
  const q = normPath(p).toLowerCase();
  return list.some((e) => {
    const x = normPath(e).toLowerCase();
    return x !== '' && (q === x || q.startsWith(x + '/'));
  });
}

// Пути без повторов и без тех, что лежат внутри другого пути из списка.
function collapse(paths) {
  const list = [...new Set(paths.map(normPath).filter(Boolean))];
  return list.filter((p) => !list.some((o) => o !== p && isExcluded([o], p)));
}

const lineStartOf = (xml, pos) => xml.lastIndexOf('\n', pos - 1) + 1;
const indentOf = (xml, pos) => /^[ \t]*/.exec(xml.slice(lineStartOf(xml, pos)))[0];
const entry = (p) => `<excludedPath local="true" path="$PROJECT_DIR$/${escapeXml(p)}" />`;

// Правка одного блока сервера: { at, remove, text } — вставить text на место [at, at + remove).
function blockEdit(xml, b, add, eol) {
  const close = b.body.search(/<\/excludedPaths\s*>/);
  if (close >= 0) {
    const pos = b.bodyStart + close;
    const start = lineStartOf(xml, pos);
    const closeIndent = indentOf(xml, pos);
    const sample = /\n([ \t]*)<excludedPath\b/.exec(b.body);
    const ind = sample ? sample[1] : closeIndent + '  ';
    if (/^[ \t]*$/.test(xml.slice(start, pos))) {
      return { at: start, remove: 0, text: add.map((p) => ind + entry(p) + eol).join('') };
    }
    return { at: pos, remove: 0, text: add.map((p) => eol + ind + entry(p)).join('') + eol + closeIndent };
  }
  const selfClosed = /<excludedPaths\s*\/>/.exec(b.body);
  if (selfClosed) {
    const pos = b.bodyStart + selfClosed.index;
    const ind = indentOf(xml, pos);
    return {
      at: pos,
      remove: selfClosed[0].length,
      text: '<excludedPaths>' + add.map((p) => eol + ind + '  ' + entry(p)).join('') + eol + ind + '</excludedPaths>',
    };
  }
  const mappings = b.body.search(/<\/mappings\s*>/);
  if (mappings < 0) throw new DeploymentError(`у сервера «${b.name}» нет </mappings>`);
  const pos = b.bodyStart + mappings;
  const after = pos + /<\/mappings\s*>/.exec(b.body.slice(mappings))[0].length;
  const ind = indentOf(xml, pos);
  return {
    at: after,
    remove: 0,
    text: eol + ind + '<excludedPaths>' + add.map((p) => eol + ind + '  ' + entry(p)).join('') + eol + ind + '</excludedPaths>',
  };
}

// Дописать исключения paths каждому серверу, сопоставленному с корнем проекта.
// → { xml, added: { сервер: [пути] } }; added пуст — xml тот же. Неразобранный файл — DeploymentError.
function addExclusions(xml, paths) {
  const want = collapse(paths);
  const eol = xml.includes('\r\n') ? '\r\n' : '\n';
  const added = {};
  const edits = [];
  for (const b of serverBlocks(xml, true)) {
    if (!rootMapped(b.body)) continue;
    const have = excludedIn(b.body);
    const add = want.filter((p) => !isExcluded(have, p));
    if (!add.length) continue;
    added[b.name] = add;
    edits.push(blockEdit(xml, b, add, eol));
  }
  let out = xml;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.remove);
  // Самопроверка: всё добавленное читается обратно.
  const back = readDeployment(out).servers;
  for (const [name, list] of Object.entries(added)) {
    const s = back.find((x) => x.name === name);
    if (!s || !list.every((p) => isExcluded(s.excluded, p))) throw new DeploymentError(`не удалось дописать исключения серверу «${name}»`);
  }
  return { xml: out, added };
}

module.exports = { DeploymentError, readDeployment, isExcluded, addExclusions, collapse, normPath };
````

- [ ] **Шаг 5: тесты проходят.** `node --test tests/deployment.test.js` — 11 ✔.

- [ ] **Шаг 6: сдать контроллеру** — без коммита.

### Задача 11.5: `phpstorm-exclude.js` — хук и CLI

**Files:**
- Create: `plugins/kit/scripts/phpstorm-exclude.js`
- Modify: `plugins/kit/hooks/hooks.json`
- Test: `tests/phpstorm-exclude.test.js`

**Interfaces:**
- Consumes: `kitInfo`, `docsInClaude`, `readStdinJson`, `resolveProjectDir` (11.3); `DeploymentError`, `readDeployment`, `isExcluded`, `addExclusions` (11.4); `splitList` из `lib/params.js`; фикстуры `tests/deployment-fixtures.js`.
- Produces: CLI `node phpstorm-exclude.js [--hook] [--check] [--also a,b]` — коды и тексты по спеку §8; `module.exports = { run, required, plainPath, MUST }` (`run(dir, { hook, check, also }) → { code, lines }`; `MUST = ['.idea', '.git', '.claude']`; `plainPath(item) → путь | null`). Для 11.8: вызовы из `project-init` — `phpstorm-exclude.js --also …` и `--check --also …`; для 11.6 (`guard.js`) — подсказка запустить этот скрипт.

- [ ] **Шаг 1: тесты** — `tests/phpstorm-exclude.test.js` целиком:

````js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN, makeProject, runScript } = require('./helpers');
const { paramsMd, progressMd } = require('./fixtures');
const { BETA, GAMMA, NO_BLOCK, BROKEN } = require('./deployment-fixtures');
const { readDeployment } = require('../plugins/kit/scripts/lib/deployment');
const { plainPath } = require('../plugins/kit/scripts/phpstorm-exclude');

const XML = '.idea/deployment.xml';
const hook = (dir) => runScript('phpstorm-exclude.js', { args: ['--hook'], input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir } });
const cli = (dir, ...args) => runScript('phpstorm-exclude.js', { args, cwd: dir });
const xmlOf = (dir) => fs.readFileSync(path.join(dir, XML), 'utf8');
const excluded = (dir) => readDeployment(xmlOf(dir)).servers[0].excluded;

test('hooks.json: SessionStart запускает phpstorm-exclude.js --hook рядом с session-start.js', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0];
  assert.equal(hooks.matcher, 'startup|resume|clear|compact');
  const args = hooks.hooks.map((h) => h.args.join(' '));
  assert.deepEqual(args, ['${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js --hook', '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js']);
});

test('--hook: вне kit-проекта и без настроек выкладки — тишина, файл не тронут', () => {
  const foreign = makeProject({ [XML]: NO_BLOCK, 'index.php': '' });
  const r = hook(foreign);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(xmlOf(foreign), NO_BLOCK);
  const noIdea = hook(makeProject({ '.claude/docs/progress.md': progressMd() }));
  assert.equal(noIdea.stdout, '');
  const noComponent = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: '<project version="4" />\n' });
  assert.equal(hook(noComponent).stdout, '');
});

test('--hook: старая раскладка (beta) — дописаны .claude и docs, строка с сервером и подсказкой; повтор — тишина', () => {
  const dir = makeProject({ 'docs/progress.md': progressMd(), [XML]: BETA });
  const r = hook(dir);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '[kit] Исключения PhpStorm: добавлено «ftp» — .claude, docs. Если PhpStorm открыт и не подхватил — File → Reload All from Disk.\n');
  assert.deepEqual(excluded(dir).slice(-2), ['.claude', 'docs']);
  assert.equal(hook(dir).stdout, '', 'второй запуск — добавлять нечего');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.idea')), ['deployment.xml'], 'временный файл не остался');
});

test('--hook: новая раскладка — папка документов внутри .claude не добавляется; «Не выкладывать» — только простые пути', () => {
  const md = paramsMd({ 'Не выкладывать': '.idea, .git, .claude, local/modules, /bitrix/, *.back*, upload/ (кроме upload/docs/), C:\\x, ../y' });
  const dir = makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd(), [XML]: NO_BLOCK });
  const r = hook(dir);
  assert.match(r.stdout, /добавлено «ftp» — \.idea, \.git, \.claude, local\/modules, bitrix\./);
  assert.deepEqual(excluded(dir), ['.idea', '.git', '.claude', 'local/modules', 'bitrix']);
});

test('--hook: журнал в корне проекта — «.» в исключения не попадает', () => {
  const dir = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'progress.md' }), [XML]: NO_BLOCK });
  hook(dir);
  assert.deepEqual(excluded(dir), ['.idea', '.git', '.claude']);
});

test('--hook: неразобранный файл — строка-предупреждение, файл не тронут, код 0', () => {
  const dir = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: BROKEN });
  const r = hook(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^\[kit\] Исключения PhpStorm: \.idea\/deployment\.xml не разобран \(нет <\/paths> у сервера «ftp»\)/);
  assert.match(r.stdout, /добавьте \.idea, \.git, \.claude в Excluded Paths руками/);
  assert.equal(xmlOf(dir), BROKEN);
});

test('--check: 1 — не хватает (файл не меняется), 0 — после записи; 2 — не разобран', () => {
  const dir = makeProject({ [XML]: NO_BLOCK });
  const miss = cli(dir, '--check', '--also', '.gitignore, local/modules');
  assert.equal(miss.code, 1);
  assert.equal(miss.stdout, 'Исключения PhpStorm: не хватает — «ftp» — .idea, .git, .claude, .gitignore, local/modules.\n');
  assert.equal(xmlOf(dir), NO_BLOCK);
  const write = cli(dir, '--also', '.gitignore, local/modules');
  assert.equal(write.code, 0);
  assert.match(write.stdout, /добавлено «ftp» — \.idea, \.git, \.claude, \.gitignore, local\/modules/);
  const ok = cli(dir, '--check', '--also', '.gitignore, local/modules');
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /Исключения PhpStorm на месте: ftp\./);
  const broken = cli(makeProject({ [XML]: BROKEN }), '--check');
  assert.equal(broken.code, 2);
});

test('без --hook: работает и вне kit-проекта; нет настроек выкладки — код 0 с пояснением', () => {
  const dir = makeProject({ [XML]: GAMMA });
  const r = cli(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /на месте: ftp/);
  assert.equal(xmlOf(dir), GAMMA);
  const none = cli(makeProject({ 'index.php': '' }), '--check');
  assert.equal(none.code, 0);
  assert.match(none.stdout, /Настроек выкладки PhpStorm нет/);
});

test('plainPath: маски, «кроме», абсолютные и наружу — не пути', () => {
  assert.equal(plainPath('/bitrix/'), 'bitrix');
  assert.equal(plainPath('local\\modules'), 'local/modules');
  for (const bad of ['*.back*', 'upload/ (кроме upload/docs/)', 'a?b', '[ab]', 'C:\\x', '../y', 'a/../b', '.', '', '  ']) {
    assert.equal(plainPath(bad), null, bad);
  }
});
````

- [ ] **Шаг 2: убедиться, что тесты падают.** `node --test tests/phpstorm-exclude.test.js` — FAIL: нет модуля `phpstorm-exclude`, в `hooks.json` один хук SessionStart.

- [ ] **Шаг 3: реализация** — `plugins/kit/scripts/phpstorm-exclude.js` целиком:

````js
#!/usr/bin/env node
'use strict';
// Исключения PhpStorm (Settings → Deployment → сервер → Excluded Paths) в .idea/deployment.xml:
// .idea, .git, .claude, папка документов вне .claude и простые пути из «Не выкладывать» — у каждого сервера,
// сопоставленного с корнем проекта. Только добавляет. Внешний процесс: защита путей Claude Code его не касается.
//   node phpstorm-exclude.js --hook                   хук SessionStart: только в kit-проекте, строка — если что-то добавлено
//   node phpstorm-exclude.js [--also a,b]             из корня проекта (project-init): дописать; код 0 / 2
//   node phpstorm-exclude.js --check [--also a,b]     только сверка: 0 — всё на месте, 1 — не хватает, 2 — файл не разобран
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude } = require('./lib/project');
const { splitList } = require('./lib/params');
const { DeploymentError, readDeployment, isExcluded, addExclusions } = require('./lib/deployment');

const MUST = ['.idea', '.git', '.claude'];
const RELOAD = 'Если PhpStorm открыт и не подхватил — File → Reload All from Disk.';

// Простой путь от корня проекта: без масок, без «(кроме …)», не абсолютный и не наружу — иначе null.
function plainPath(item) {
  if (/[*?[]|\(\s*кроме/i.test(item)) return null;
  const p = String(item).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!p || p === '.' || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  return p;
}

function required(info, also) {
  const list = [...MUST];
  if (!docsInClaude(info.docsRel)) list.push(info.docsRel);
  for (const item of [...info.params.list('Не выкладывать'), ...also]) list.push(item);
  return list.map(plainPath).filter(Boolean);
}

const listOf = (added) => Object.entries(added).map(([s, list]) => `«${s}» — ${list.join(', ')}`).join('; ');

// → { code, lines }; файл меняется только без --check.
function run(dir, { hook = false, check = false, also = [] } = {}) {
  const info = kitInfo(dir);
  if (hook && !info.isKit) return { code: 0, lines: [] };
  const file = path.join(dir, '.idea', 'deployment.xml');
  const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!/<component\s+name="PublishConfigData"/.test(xml)) {
    return { code: 0, lines: hook ? [] : ['Настроек выкладки PhpStorm нет (.idea/deployment.xml) — исключать нечего.'] };
  }
  let res;
  try {
    res = addExclusions(xml, required(info, also));
  } catch (e) {
    if (!(e instanceof DeploymentError)) throw e;
    return { code: 2, lines: [`[kit] Исключения PhpStorm: .idea/deployment.xml не разобран (${e.message}) — исключения не проверены, добавьте ${MUST.join(', ')} в Excluded Paths руками.`] };
  }
  if (!Object.keys(res.added).length) {
    const roots = readDeployment(xml).servers.filter((s) => s.root).map((s) => s.name);
    return { code: 0, lines: hook ? [] : [roots.length ? `Исключения PhpStorm на месте: ${roots.join(', ')}.` : 'Серверов, сопоставленных с корнем проекта, нет — исключать нечего.'] };
  }
  if (check) return { code: 1, lines: [`Исключения PhpStorm: не хватает — ${listOf(res.added)}.`] };
  const tmp = `${file}.${process.pid}.kit-tmp`;
  fs.writeFileSync(tmp, res.xml);
  fs.renameSync(tmp, file);
  const back = readDeployment(fs.readFileSync(file, 'utf8')).servers;
  const ok = Object.entries(res.added).every(([name, list]) => {
    const s = back.find((x) => x.name === name);
    return s && list.every((p) => isExcluded(s.excluded, p));
  });
  if (!ok) {
    fs.writeFileSync(file, xml);
    return { code: 2, lines: ['[kit] Исключения PhpStorm: запись не прошла проверку — .idea/deployment.xml возвращён как был; добавьте исключения руками.'] };
  }
  return { code: 0, lines: [`[kit] Исключения PhpStorm: добавлено ${listOf(res.added)}. ${RELOAD}`] };
}

function main(argv) {
  const hook = argv.includes('--hook');
  const ai = argv.indexOf('--also');
  const opts = { hook, check: argv.includes('--check'), also: ai >= 0 ? splitList(argv[ai + 1] || '') : [] };
  if (hook) {
    try {
      const r = run(resolveProjectDir(readStdinJson()), opts);
      if (r.lines.length) process.stdout.write(r.lines.join('\n') + '\n');
    } catch (e) {
      // хук не должен ломать сессию
    }
    return 0;
  }
  const r = run(process.cwd(), opts);
  if (r.lines.length) console.log(r.lines.join('\n'));
  return r.code;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { run, required, plainPath, MUST };
````

- [ ] **Шаг 4: `hooks.json`** — второй хук SessionStart перед `session-start.js`:

````diff
diff --git a/plugins/kit/hooks/hooks.json b/plugins/kit/hooks/hooks.json
index d3a85ac..23748f5 100644
--- a/plugins/kit/hooks/hooks.json
+++ b/plugins/kit/hooks/hooks.json
@@ -4,6 +4,7 @@
       {
         "matcher": "startup|resume|clear|compact",
         "hooks": [
+          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js", "--hook"], "timeout": 10 },
           { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"], "timeout": 10 }
         ]
       }
````

- [ ] **Шаг 5: тесты проходят.** `node --test tests/phpstorm-exclude.test.js tests/deployment.test.js` — 20 ✔. Файлы `.idea` в тестах — только во временных папках; на проектах пользователя скрипт не запускать.

- [ ] **Шаг 6: сдать контроллеру** — без коммита.

### Задача 11.6: потребители папки документов — снимки, `check-closed`, `secret-scan`, `session-start`

**Files:**
- Modify: `plugins/kit/scripts/lib/visual/guard.js`, `plugins/kit/scripts/visual.js`, `plugins/kit/scripts/lib/visual/report.js` (комментарий)
- Modify: `plugins/kit/scripts/check-closed.js`, `plugins/kit/scripts/secret-scan.js`, `plugins/kit/scripts/session-start.js`
- Test: `tests/visual-guard.test.js`, `tests/visual-cli.test.js`, `tests/net.test.js`, `tests/secret-scan.test.js`, `tests/session-start.test.js`

**Interfaces:**
- Consumes: `kitInfo` (`visualRel`, `docsRel`, `params`), `docsInClaude` (11.3); `readDeployment`, `isExcluded` (11.4).
- Produces: `checkDeploy(root, params, visualRel) → string[]` (третий аргумент — новый; код 4 — если папка снимков не исключена ни сама, ни через предка, текст называет `phpstorm-exclude.js`); `guard.js` по-прежнему экспортирует `readDeployment` (из `lib/deployment.js`). `session-start.js` экспортирует `docsRule(docsRel)`. `check-closed.js`: папки по умолчанию `docs`, `.claude` и папка журнала вне обеих; правила «Не выкладывать», закрывающие саму папку или её предка, для неё не действуют; снимки `visual` не обходятся. `secret-scan.js`: `.claude/docs/visual` в базовых запретах.

- [ ] **Шаг 1: тесты.** `tests/visual-guard.test.js` — проверки `readDeployment` переехали в `deployment.test.js` (11.4), `checkDeploy` — с третьим аргументом:

````diff
diff --git a/tests/visual-guard.test.js b/tests/visual-guard.test.js
index e2a3549..488a34a 100644
--- a/tests/visual-guard.test.js
+++ b/tests/visual-guard.test.js
@@ -6,7 +6,7 @@ const path = require('path');
 const { spawnSync } = require('child_process');
 const { makeProject, writeFiles, git } = require('./helpers');
 const { makeParams } = require('../plugins/kit/scripts/lib/params');
-const { GITIGNORE, readDeployment, checkDeploy, ensureGitignore } = require('../plugins/kit/scripts/lib/visual/guard');
+const { GITIGNORE, checkDeploy, ensureGitignore } = require('../plugins/kit/scripts/lib/visual/guard');
 
 // Как .idea/deployment.xml beta: автозаливка на «ftp», исключения локальные и удалённые.
 function deployment({ always = true, server = 'ftp', excluded = ['.idea', '.git', '.claude/scripts', 'docs/visual'], other = [] } = {}) {
@@ -37,33 +37,35 @@ ${always ? '    <option name="myAutoUpload" value="ALWAYS" />\n' : ''}  </compon
 `;
 }
 const project = (xml) => makeProject(xml === undefined ? {} : { '.idea/deployment.xml': xml });
-const NO_WARN = makeParams({ 'не выкладывать': '.idea, .git, docs/visual' });
+const NO_WARN = makeParams({ 'не выкладывать': '.idea, .git, .claude, docs' });
 
-test('readDeployment: автозаливка, сервер по умолчанию, локальные исключения только его блока', () => {
-  assert.deepEqual(readDeployment(deployment({ other: ['docs'] })),
-    { always: true, server: 'ftp', excluded: ['.idea', '.git', '.claude/scripts', 'docs/visual'] });
-  assert.equal(readDeployment(deployment({ always: false })).always, false);
-  assert.equal(readDeployment('<component name="PublishConfigData" serverName="x"><option name="myAutoUpload" value="ALWAYS" /></component>').always, true);
-});
+const VIS = '.claude/docs/visual';
 
-test('checkDeploy: Always без исключения docs/visual — код 4 с подсказкой', () => {
-  const dir = project(deployment({ excluded: ['.idea', '.git'], other: ['docs/visual'] }));
-  assert.throws(() => checkDeploy(dir, NO_WARN), (e) => e.code === 4 && /«ftp»/.test(e.message) && /Excluded Paths/.test(e.message) && /docs\/visual/.test(e.message));
+test('checkDeploy: Always, а папка снимков не исключена ни сама, ни через предка — код 4 с путём и подсказкой', () => {
+  const dir = project(deployment({ excluded: ['.idea', '.git', '.claude/scripts', 'docs/visual'], other: ['.claude'] }));
+  assert.throws(() => checkDeploy(dir, NO_WARN, VIS), (e) => e.code === 4 && /«ftp»/.test(e.message) && /Excluded Paths/.test(e.message)
+    && e.message.includes('.claude/docs/visual не исключён') && e.message.includes('phpstorm-exclude.js'));
 });
 
-test('checkDeploy: исключён docs/visual или docs целиком; On explicit save; нет .idea — можно', () => {
-  for (const dir of [project(deployment()), project(deployment({ excluded: ['docs'] })), project(deployment({ always: false, excluded: [] })), project()]) {
-    assert.deepEqual(checkDeploy(dir, NO_WARN), []);
+test('checkDeploy: исключены .claude, .claude/docs или сама папка; старая раскладка — docs; On explicit save; нет .idea — можно', () => {
+  for (const excluded of [['.claude'], ['.claude/docs'], ['.claude/docs/visual']]) {
+    assert.deepEqual(checkDeploy(project(deployment({ excluded })), NO_WARN, VIS), [], excluded[0]);
   }
+  assert.deepEqual(checkDeploy(project(deployment({ excluded: ['docs'] })), NO_WARN, 'docs/visual'), []);
+  assert.deepEqual(checkDeploy(project(deployment({ always: false, excluded: [] })), NO_WARN, VIS), []);
+  assert.deepEqual(checkDeploy(project(), NO_WARN, VIS), []);
+  assert.throws(() => checkDeploy(project(deployment({ excluded: ['docs'] })), NO_WARN, VIS), (e) => e.code === 4, 'docs не закрывает .claude/docs/visual');
 });
 
-test('checkDeploy: docs/visual нет в «Не выкладывать» — предупреждение; вне kit-проекта — тихо', () => {
+test('checkDeploy: папки снимков нет в «Не выкладывать» — предупреждение; вне kit-проекта — тихо', () => {
   const dir = project();
-  const w = checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .git, .claude/scripts' }));
+  const w = checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .git, .claude/scripts' }), VIS);
   assert.equal(w.length, 1);
   assert.match(w[0], /Не выкладывать/);
-  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, docs' })), []);
-  assert.deepEqual(checkDeploy(dir, makeParams(null)), []);
+  assert.ok(w[0].includes('.claude/docs/visual'));
+  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .claude' }), VIS), []);
+  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, docs' }), 'docs/visual'), []);
+  assert.deepEqual(checkDeploy(dir, makeParams(null), VIS), []);
 });
 
 test('ensureGitignore: создаёт один раз; снимки игнорируются git, сам .gitignore — нет', () => {
````

`tests/visual-cli.test.js` — проекты новой раскладки (снимки в `.claude/docs/visual`), тест исключения предка и старой раскладки:

````diff
diff --git a/tests/visual-cli.test.js b/tests/visual-cli.test.js
index b3bad1e..4e50369 100644
--- a/tests/visual-cli.test.js
+++ b/tests/visual-cli.test.js
@@ -78,7 +78,9 @@ function fakeDeps(pwSource = FAKE_PW) {
 }
 const fakeEnv = (pwSource) => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-'), KIT_VISUAL_DEPS: fakeDeps(pwSource) });
 
-const PARAMS = { 'Режим': 'bitrix', 'Прод': 'https://beta.example.com', 'Не выкладывать': '.idea, .git, .claude/scripts, docs/visual' };
+// Новая раскладка (с 2.3.0): снимки — в .claude/docs/visual; .claude — в «Не выкладывать».
+const VIS = ['.claude', 'docs', 'visual'];
+const PARAMS = { 'Режим': 'bitrix', 'Прод': 'https://beta.example.com', 'Не выкладывать': '.idea, .git, .claude' };
 const PAGES = { contexts: { guest: { pages: [{ name: 'home', url: '/' }] }, admin: { auth: true, pages: [{ name: 'order', url: '/order/' }] } } };
 
 function png(w, h, dots = []) {
@@ -96,12 +98,12 @@ function project({ labels = {}, pages = PAGES, params = PARAMS, extra = {} } = {
   const dir = makeProject(files);
   for (const [label, l] of Object.entries(labels)) {
     for (const [key, f] of Object.entries(l.files || {})) {
-      const base = path.join(dir, 'docs', 'visual', label, key);
+      const base = path.join(dir, ...VIS, label, key);
       fs.mkdirSync(path.dirname(base), { recursive: true });
       if (f.png) fs.writeFileSync(base + '.png', f.png);
       if (f.txt !== undefined) fs.writeFileSync(base + '.txt', f.txt);
     }
-    if (l.meta) fs.writeFileSync(path.join(dir, 'docs', 'visual', label, 'meta.json'), JSON.stringify(l.meta));
+    if (l.meta) fs.writeFileSync(path.join(dir, ...VIS, label, 'meta.json'), JSON.stringify(l.meta));
   }
   return dir;
 }
@@ -121,7 +123,7 @@ test('compare: одинаковые метки — код 0, «совпадае
   assert.equal(r.code, 0, r.stdout + r.stderr);
   assert.match(r.stdout, /Итого: совпадает 2, в пределах шума 0, отличается 0, не снято 0 \(из 2\)/);
   assert.match(r.stdout, /Шум не измерен: node visual\.js check before/);
-  const out = path.join(dir, 'docs', 'visual', 'compare-before-vs-after');
+  const out = path.join(dir, ...VIS, 'compare-before-vs-after');
   assert.ok(fs.existsSync(path.join(out, 'report.html')));
   assert.ok(fs.existsSync(path.join(out, 'guest', 'desktop', 'home.png')), 'дифф-картинка');
   assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).counts.same, 2);
@@ -139,14 +141,14 @@ test('compare: пиксели, текст, статус 500 и новый отв
   assert.ok(r.stdout.indexOf('Статусы и ошибки:') < r.stdout.indexOf('Отличается:'));
   assert.match(r.stdout, /admin\/desktop\/order {2}статус 200 → 500; ответ: \+ 500 \/order\/ajax\.php/);
   assert.match(r.stdout, /0\.5% {2}guest\/desktop\/home {2}текст −1\/\+1/);
-  const html = fs.readFileSync(path.join(dir, 'docs', 'visual', 'compare-before-vs-after', 'report.html'), 'utf8');
+  const html = fs.readFileSync(path.join(dir, ...VIS, 'compare-before-vs-after', 'report.html'), 'utf8');
   assert.ok(html.includes('Корзина (3)') && html.includes('Корзина (0)'));
 });
 
 test('compare: шум из noise.json — «в пределах шума», код 0', () => {
   const after = { meta: BEFORE.meta, files: { ...BEFORE.files, 'guest/desktop/home': { png: png(20, 20, [[1, 1]]), txt: 'Главная\nКорзина (4)' } } };
   const dir = project({ labels: { before: BEFORE, after } });
-  fs.writeFileSync(path.join(dir, 'docs', 'visual', 'before', 'noise.json'), JSON.stringify({ runs: 1, snapshots: {
+  fs.writeFileSync(path.join(dir, ...VIS, 'before', 'noise.json'), JSON.stringify({ runs: 1, snapshots: {
     'guest/desktop/home': { pct: 0.5, removed: ['Корзина (3)'], added: ['Корзина (4)'], errors: [], net: [] } } }));
   const r = visual(dir, ['compare', 'before', 'after']);
   assert.equal(r.code, 0, r.stdout);
@@ -213,23 +215,38 @@ test('shoot: опасный адрес, опечатка, неверная ил
   assert.equal(visual(project(), ['frobnicate']).code, 2);
 });
 
-test('shoot: автозаливка PhpStorm без исключения docs/visual — код 4, docs/visual не создан', () => {
+test('shoot: автозаливка PhpStorm без исключения .claude — код 4, папка снимков не создана', () => {
   const xml = '<project><component name="PublishConfigData" autoUpload="Always" serverName="ftp"><serverData><paths name="ftp"><serverdata><excludedPaths>'
     + '<excludedPath local="true" path="$PROJECT_DIR$/.idea" /></excludedPaths></serverdata></paths></serverData></component></project>';
   const dir = project({ extra: { '.idea/deployment.xml': xml } });
   const r = visual(dir, ['shoot', 'before']);
   assert.equal(r.code, 4);
   assert.match(r.stderr, /Excluded Paths/);
-  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'visual')));
+  assert.ok(!fs.existsSync(path.join(dir, ...VIS)));
 });
 
-test('shoot без зависимостей — код 5 с командой установки; docs/visual/.gitignore уже создан', () => {
+test('shoot: исключена .claude (предок папки снимков) — не код 4; старая раскладка — снимки в docs/visual', () => {
+  const xml = '<project><component name="PublishConfigData" autoUpload="Always" serverName="ftp"><serverData><paths name="ftp"><serverdata><excludedPaths>'
+    + '<excludedPath local="true" path="$PROJECT_DIR$/.claude" /></excludedPaths></serverdata></paths></serverData></component></project>';
+  const home = () => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-') });
+  const r = visual(project({ extra: { '.idea/deployment.xml': xml } }), ['shoot', 'before'], home());
+  assert.equal(r.code, 5, r.stdout + r.stderr);
+  const old = project({ extra: { 'docs/progress.md': '# журнал\n' } });
+  const r2 = visual(old, ['shoot', 'before'], home());
+  assert.equal(r2.code, 5, r2.stdout + r2.stderr);
+  assert.match(r2.stdout, /Создан docs\/visual\/\.gitignore/);
+  assert.match(r2.stdout, /нет docs\/visual/, '«Не выкладывать» без docs — предупреждение');
+  assert.ok(fs.existsSync(path.join(old, 'docs', 'visual', '.gitignore')));
+  assert.ok(!fs.existsSync(path.join(old, ...VIS)));
+});
+
+test('shoot без зависимостей — код 5 с командой установки; .gitignore в папке снимков уже создан', () => {
   const dir = project();
   const r = visual(dir, ['shoot', 'before'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-') });
   assert.equal(r.code, 5);
   assert.match(r.stderr, /playwright-core 1\.63\.0/);
   assert.match(r.stderr, /node visual\.js install/);
-  assert.ok(fs.existsSync(path.join(dir, 'docs', 'visual', '.gitignore')));
+  assert.ok(fs.existsSync(path.join(dir, ...VIS, '.gitignore')));
 });
 
 test('shoot без сессии для контекста с auth — код 3 (зависимости есть)', () => {
@@ -247,17 +264,17 @@ test('shoot: ошибка группы (не в цикле страниц) не
   const r = visual(dir, ['shoot', 'before'], fakeEnv(broken));
   assert.equal(r.code, 1, r.stdout + r.stderr);
   assert.match(r.stdout, /ERR guest\/desktop {2}группа guest\/desktop: битая сессия/);
-  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'visual', 'before', 'meta.json'), 'utf8'));
+  const meta = JSON.parse(fs.readFileSync(path.join(dir, ...VIS, 'before', 'meta.json'), 'utf8'));
   const byKey = Object.fromEntries(meta.pages.map((p) => [`${p.ctx}/${p.vp}/${p.name}`, p]));
   assert.match(byKey['guest/desktop/home'].fail, /битая сессия/);
   assert.match(byKey['guest/mobile/home'].fail, /битая сессия/);
-  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'visual', 'before', 'guest', 'desktop', 'home.png')));
-  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'visual', 'before', 'guest', 'desktop', 'home.txt')));
+  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before', 'guest', 'desktop', 'home.png')));
+  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before', 'guest', 'desktop', 'home.txt')));
 });
 
-test('shoot: метка снята с другого адреса — код 2 до защиты выкладки, docs/visual не тронут', () => {
+test('shoot: метка снята с другого адреса — код 2 до защиты выкладки, папка снимков не тронута', () => {
   const dir = project({ labels: { before: BEFORE } });
-  const vis = path.join(dir, 'docs', 'visual');
+  const vis = path.join(dir, ...VIS);
   const r = visual(dir, ['shoot', 'before', '--url', 'https://other.example']);
   assert.equal(r.code, 2, r.stdout + r.stderr);
   assert.match(r.stderr, /метка before снята с https:\/\/beta\.example\.com; для другого адреса — другая метка/);
@@ -270,13 +287,13 @@ test('check: --url не тот, с которого снята метка, — 
   const r = visual(dir, ['check', 'before', '--url', 'https://other.example']);
   assert.equal(r.code, 2, r.stdout + r.stderr);
   assert.match(r.stderr, /метка before снята с https:\/\/beta\.example\.com, а адрес сейчас https:\/\/other\.example — контрольный прогон должен быть с того же адреса/);
-  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'visual', 'before-check')));
+  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before-check')));
   assert.equal(visual(dir, ['check', 'before', '--url', 'https://beta.example.com/']).code, 5);
 });
 
 test('check: сквозной прогон с поддельным браузером — адрес метки, <метка>-check с нуля, noise.json', () => {
   const dir = project({ pages: { contexts: { guest: { pages: [{ name: 'home', url: '/' }] } } } });
-  const vis = path.join(dir, 'docs', 'visual');
+  const vis = path.join(dir, ...VIS);
   const readMeta = (label, file = 'meta.json') => JSON.parse(fs.readFileSync(path.join(vis, label, file), 'utf8'));
   const env = fakeEnv();
   let r = visual(dir, ['shoot', 'before', '--url', 'https://dev.beta.test'], env);
````

`tests/net.test.js`, `tests/secret-scan.test.js`, `tests/session-start.test.js`:

````diff
diff --git a/tests/net.test.js b/tests/net.test.js
index b70edd8..406b61b 100644
--- a/tests/net.test.js
+++ b/tests/net.test.js
@@ -88,6 +88,30 @@ test('check-closed: всё закрыто — код 0', async () => {
   }
 });
 
+test('check-closed: новая раскладка — .claude в «Не выкладывать» всё равно проверяется, снимки visual не обходятся', async () => {
+  const { server, url, seen } = await serve((req, res) => {
+    res.statusCode = 404;
+    res.end();
+  });
+  const dir = makeProject({
+    '.claude/CLAUDE.md': paramsMd({ 'Не выкладывать': '.idea, .git, .claude, .claude/scripts' }),
+    '.claude/docs/progress.md': '# журнал',
+    '.claude/docs/work/plan.md': 'план',
+    '.claude/docs/visual/before/guest/desktop/home.png': 'x',
+    '.claude/scripts/01-x.php': 'x',
+  });
+  try {
+    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
+    assert.equal(r.code, 0, r.stdout);
+    for (const p of ['/.claude/', '/.claude/docs/progress.md', '/.claude/docs/work/plan.md']) assert.ok(seen.includes(p), p + ' ∉ ' + seen.join(', '));
+    assert.ok(!seen.some((p) => p.includes('visual')), seen.join(', '));
+    assert.ok(!seen.some((p) => p.includes('scripts')), 'подпапка из «Не выкладывать» — пропускается: ' + seen.join(', '));
+    assert.ok(!seen.some((p) => p.startsWith('/docs')), 'docs/ нет на диске — не запрашивается');
+  } finally {
+    server.close();
+  }
+});
+
 test('check-closed: .claude/worktrees не обходится и не запрашивается', async () => {
   const { server, url, seen } = await serve((req, res) => {
     res.statusCode = 403;
````

````diff
diff --git a/tests/secret-scan.test.js b/tests/secret-scan.test.js
index 36d05b7..0d07d79 100644
--- a/tests/secret-scan.test.js
+++ b/tests/secret-scan.test.js
@@ -199,6 +199,15 @@ test('снимки docs/visual — базовый запрет (от корня
   assert.doesNotMatch(r.stdout, /visualize|local\/docs/);
 });
 
+test('снимки .claude/docs/visual — базовый запрет; остальная .claude/docs — нет', () => {
+  const dir = gitRepo({ 'x.txt': '' });
+  writeFiles(dir, { '.claude/docs/visual/before/admin/desktop/home.txt': 'x', '.claude/docs/progress.md': '# журнал', '.claude/docs/work/plan.md': 'план' });
+  const r = scan(dir, '--files', '.claude/docs/visual/before/admin/desktop/home.txt', '.claude/docs/progress.md', '.claude/docs/work/plan.md');
+  assert.equal(r.code, 1);
+  assert.match(r.stdout, /\.claude\/docs\/visual\/before\/admin\/desktop\/home\.txt: запрещённый путь \(\.claude\/docs\/visual\)/);
+  assert.doesNotMatch(r.stdout, /progress\.md|plan\.md/);
+});
+
 test('.env.example — не запрещённый путь, .env и .env.local — запрещённые', () => {
   const dir = gitRepo({ 'x.txt': '' });
   writeFiles(dir, { '.env.example': 'DB_PASSWORD=\n', '.env.local': 'X=1\n', '.env': 'X=1\n' });
````

````diff
diff --git a/tests/session-start.test.js b/tests/session-start.test.js
index ca3e1c2..6fc8654 100644
--- a/tests/session-start.test.js
+++ b/tests/session-start.test.js
@@ -25,7 +25,7 @@ test('alpha: «Сейчас», общие правила, Always и «код
   assert.match(r.stdout, /PhpStorm Always/);
   assert.match(r.stdout, /Код пишет Claude/);
   assert.doesNotMatch(r.stdout, /Код пишет пользователь/);
-  assert.doesNotMatch(r.stdout, /kit:project-init/);
+  assert.doesNotMatch(r.stdout, /нет раздела «Параметры для агентов»/);
 });
 
 test('git worktree в .claude/worktrees/ при PhpStorm Always — предупреждение про автозаливку', () => {
@@ -67,7 +67,7 @@ test('gamma: код пишет пользователь, выкладк
 test('только журнал — подсказка про /kit:project-init', () => {
   const r = run(makeProject({ 'docs/progress.md': progressMd() }));
   assert.match(r.stdout, /## Сейчас/);
-  assert.match(r.stdout, /\/kit:project-init/);
+  assert.match(r.stdout, /нет раздела «Параметры для агентов» — предложи пользователю \/kit:project-init/);
 });
 
 test('только параметры, журнала нет', () => {
@@ -88,3 +88,15 @@ test('CLAUDE_PROJECT_DIR важнее cwd; мусор на stdin не ломае
   assert.equal(r.code, 0);
   assert.match(r.stdout, /## Сейчас/);
 });
+
+test('документы: новая раскладка — правило про .claude/docs без подсказки о переезде; старая — с подсказкой', () => {
+  const md = paramsMd({ 'Режим': 'bitrix', 'Код пишет': 'Claude', 'Выкладка': 'вручную' });
+  const fresh = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() }));
+  assert.match(fresh.stdout, /## Сейчас \(из \.claude\/docs\/progress\.md\)/);
+  assert.ok(fresh.stdout.includes('- Документы проекта — в .claude/docs/: планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
+    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.\n'), fresh.stdout);
+  assert.doesNotMatch(fresh.stdout, /Переезд в \.claude\/docs/);
+  const old = run(makeProject({ 'docs/progress.md': progressMd() }));
+  assert.match(old.stdout, /- Документы проекта — в docs\/: .* Переезд в \.claude\/docs — через \/kit:project-init\./);
+  assert.equal(run(makeProject({ 'index.php': '' })).stdout, '', 'вне kit-проекта — тишина');
+});
````

- [ ] **Шаг 2: убедиться, что тесты падают.** `node --test tests/visual-guard.test.js tests/visual-cli.test.js tests/net.test.js tests/secret-scan.test.js tests/session-start.test.js` — FAIL: снимки пишутся в `docs/visual`, `checkDeploy` не знает предка, `.claude` в «Не выкладывать» не проверяется, нет запрета `.claude/docs/visual`, нет правила про документы.

- [ ] **Шаг 3: реализация.** `plugins/kit/scripts/lib/visual/guard.js` целиком:

````js
'use strict';
// Защита выкладки: снимки из-под админа не должны уехать на сервер (nginx отдаёт картинки мимо .htaccess) и в git.
const fs = require('fs');
const path = require('path');
const { VisualError } = require('./args');
const { parseRules, matchRules } = require('../paths');
const { readDeployment, isExcluded } = require('../deployment');

const EXCLUDE_JS = path.resolve(__dirname, '..', '..', 'phpstorm-exclude.js');
const GITIGNORE = '# Снимки /kit:visual — только локально: в git и на сервер не кладём (снимки из-под админа)\n*\n!.gitignore\n';

// Код 4, если PhpStorm заливает каждое сохранение, а папка снимков (visualRel — от корня проекта) не исключена
// ни сама, ни через предка (.claude, папка документов); иначе — список предупреждений.
function checkDeploy(root, params, visualRel) {
  const warnings = [];
  const file = path.join(root, '.idea', 'deployment.xml');
  if (fs.existsSync(file)) {
    const d = readDeployment(fs.readFileSync(file, 'utf8'));
    if (d.always && !isExcluded(d.excluded, visualRel)) {
      const srv = d.server ? `«${d.server}»` : 'по умолчанию';
      throw new VisualError(4, `PhpStorm заливает каждое сохранение на сервер ${srv} (Always), а ${visualRel} не исключён: `
        + 'снимки из-под админа уехали бы на сервер (nginx отдаёт картинки мимо .htaccess).\n'
        + `Запустите node "${EXCLUDE_JS}" из корня проекта или добавьте в Settings → Build, Execution, Deployment → Deployment → сервер ${srv} → Excluded Paths локальный путь .claude (или ${visualRel}) и повторите.`);
    }
  }
  if (params && params.found && !matchRules(visualRel + '/x.png', parseRules(params.list('Не выкладывать')))) {
    warnings.push(`в «Не выкладывать» (.claude/CLAUDE.md) нет ${visualRel} — при ручной выкладке снимки не выкладывать; допишите .claude (или ${visualRel}) в параметр`);
  }
  return warnings;
}

// <папка снимков>/.gitignore — снимки не попадают в git, даже если в .gitignore проекта строки нет.
function ensureGitignore(visualDir) {
  const f = path.join(visualDir, '.gitignore');
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(visualDir, { recursive: true });
  fs.writeFileSync(f, GITIGNORE);
  return true;
}

module.exports = { GITIGNORE, readDeployment, checkDeploy, ensureGitignore };
````

`visual.js`, `report.js`:

````diff
diff --git a/plugins/kit/scripts/visual.js b/plugins/kit/scripts/visual.js
index 49e29e2..31b8848 100644
--- a/plugins/kit/scripts/visual.js
+++ b/plugins/kit/scripts/visual.js
@@ -19,15 +19,16 @@ const { buildSummary, consoleLines, buildHtml } = require('./lib/visual/report')
 const { diffPng } = require('./lib/visual/image');
 const home = require('./lib/visual/home');
 const { checkDeploy, ensureGitignore } = require('./lib/visual/guard');
-const { readParams } = require('./lib/params');
+const { kitInfo } = require('./lib/project');
 
 const USAGE = 'Команды: deps | install | login | discover [адрес…] [--ctx guest] | shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup]'
   + ' | check <метка> [фильтры] | compare <до> <после> | list; флаги --env прод|дев, --url адрес';
 
 function project() {
   const root = process.cwd();
-  const params = readParams(root);
-  return { root, params, mode: siteMode(params), visual: path.join(root, 'docs', 'visual') };
+  const info = kitInfo(root);
+  // Папка снимков — <папка документов>/visual: .claude/docs/visual, у непереехавших проектов — docs/visual.
+  return { root, params: info.params, mode: siteMode(info.params), visualRel: info.visualRel, visual: path.join(root, ...info.visualRel.split('/')) };
 }
 
 const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
@@ -41,10 +42,10 @@ function makeLog(file) {
   };
 }
 
-// Перед записью в docs/visual: защита выкладки (код 4), затем docs/visual/.gitignore.
+// Перед записью в папку снимков: защита выкладки (код 4), затем .gitignore в ней.
 function guard(p) {
-  for (const w of checkDeploy(p.root, p.params)) console.log('Внимание: ' + w);
-  if (ensureGitignore(p.visual)) console.log('Создан docs/visual/.gitignore — снимки только локально');
+  for (const w of checkDeploy(p.root, p.params, p.visualRel)) console.log('Внимание: ' + w);
+  if (ensureGitignore(p.visual)) console.log(`Создан ${p.visualRel}/.gitignore — снимки только локально`);
 }
 
 // Ключи снимков метки: 'ctx/vp/name' по файлам *.png.
@@ -269,7 +270,7 @@ async function cmdCheck(a) {
 function cmdList() {
   const p = project();
   if (!fs.existsSync(p.visual)) {
-    console.log('Снимков нет: docs/visual не создан');
+    console.log(`Снимков нет: ${p.visualRel} не создан`);
     return 0;
   }
   const dirs = fs.readdirSync(p.visual, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
````

````diff
diff --git a/plugins/kit/scripts/lib/visual/report.js b/plugins/kit/scripts/lib/visual/report.js
index 4cfa9e9..eca5ab4 100644
--- a/plugins/kit/scripts/lib/visual/report.js
+++ b/plugins/kit/scripts/lib/visual/report.js
@@ -57,7 +57,7 @@ function consoleLines(s) {
   return lines;
 }
 
-// Картинки — относительно папки сравнения docs/visual/compare-<до>-vs-<после>/.
+// Картинки — относительно папки сравнения <папка снимков>/compare-<до>-vs-<после>/.
 function buildHtml(s) {
   const img = (label, key) => `../${encodeURI(label)}/${encodeURI(key)}.png`;
   const fig = (src, cap) => `<figure><figcaption>${cap}</figcaption><img loading="lazy" src="${esc(src)}" alt="${cap}"></figure>`;
````

`check-closed.js`, `secret-scan.js`, `session-start.js`:

````diff
diff --git a/plugins/kit/scripts/check-closed.js b/plugins/kit/scripts/check-closed.js
index 8348ee3..0f888e6 100644
--- a/plugins/kit/scripts/check-closed.js
+++ b/plugins/kit/scripts/check-closed.js
@@ -2,15 +2,17 @@
 'use strict';
 // Проверка снаружи: служебные папки закрыты от веба — 403 на каждый файл и на саму папку (401 — сайт под паролем, тоже закрыт).
 // На сервер уезжает содержимое папки (не git), поэтому обходим диск; исключения — .git, .idea, .claude/worktrees
-// (git worktree Claude Code — копия всего проекта) и «Не выкладывать».
-// Запуск в корне проекта: node check-closed.js <url> [--dirs docs,.claude]
+// (git worktree Claude Code — копия всего проекта), папки снимков visual (сотни картинок; на сервер их не пускает
+// защита выкладки visual.js) и «Не выкладывать». Папка, которая сама (или через предка) в «Не выкладывать», всё равно
+// проверяется: на сервере могли остаться её старые копии (с 2.3.0 в «Не выкладывать» — .claude целиком).
+// Запуск в корне проекта: node check-closed.js <url> [--dirs a,b]; по умолчанию — docs, .claude и папка журнала вне .claude.
 const fs = require('fs');
 const path = require('path');
-const { kitInfo } = require('./lib/project');
+const { kitInfo, docsInClaude } = require('./lib/project');
 const { parseRules, matchRules } = require('./lib/paths');
 
 const TIMEOUT = Number(process.env.KIT_HTTP_TIMEOUT_MS) || 15000;
-const ALWAYS_SKIP = ['.git', '.idea', '.claude/worktrees'];
+const ALWAYS_SKIP = ['.git', '.idea', '.claude/worktrees', 'docs/visual', '.claude/docs/visual'];
 const CLOSED = new Set(['закрыт', 'закрыт (авторизация)', 'нет на сервере']);
 
 // Расширения, которые nginx часто отдаёт сам, мимо .htaccess (epsilon, 2026-09-22).
@@ -74,16 +76,21 @@ function verdict(requestedUrl, r) {
 async function main(argv) {
   const base = argv[0];
   if (!base || base.startsWith('--')) {
-    console.error('Использование: node check-closed.js <url> [--dirs docs,.claude]');
+    console.error('Использование: node check-closed.js <url> [--dirs a,b]');
     return 1;
   }
   const di = argv.indexOf('--dirs');
-  const dirs = (di >= 0 && argv[di + 1] ? argv[di + 1] : 'docs,.claude').split(',').map((s) => s.trim()).filter(Boolean);
   const cwd = process.cwd();
-  const rules = parseRules([...ALWAYS_SKIP, ...kitInfo(cwd).params.list('Не выкладывать')]);
+  const info = kitInfo(cwd);
+  const own = info.docsRel !== '.' && !docsInClaude(info.docsRel) && info.docsRel !== 'docs' ? [info.docsRel] : [];
+  const dirs = di >= 0 && argv[di + 1] ? argv[di + 1].split(',').map((s) => s.trim()).filter(Boolean) : ['docs', '.claude', ...own];
+  const skip = parseRules([...ALWAYS_SKIP, '/' + info.visualRel]);
+  const deploy = info.params.list('Не выкладывать');
   const targets = [];
   for (const d of dirs) {
-    if (matchRules(d, rules) || !fs.existsSync(path.join(cwd, d))) continue;
+    if (matchRules(d, skip) || !fs.existsSync(path.join(cwd, d))) continue;
+    // Правила «Не выкладывать», закрывающие саму папку или её предка, для неё не действуют — остальные действуют.
+    const rules = parseRules([...ALWAYS_SKIP, '/' + info.visualRel, ...deploy.filter((it) => !matchRules(d, parseRules([it])))]);
     targets.push({ rel: d + '/', url: urlFor(base, d) + '/' });
     for (const f of walk(cwd, d, rules, [])) targets.push({ rel: f, url: urlFor(base, f) });
   }
````

````diff
diff --git a/plugins/kit/scripts/secret-scan.js b/plugins/kit/scripts/secret-scan.js
index 1dc0c71..8c9342b 100644
--- a/plugins/kit/scripts/secret-scan.js
+++ b/plugins/kit/scripts/secret-scan.js
@@ -14,7 +14,7 @@ const { parseRules, matchRules, norm } = require('./lib/paths');
 
 const BASE_FORBIDDEN = [
   '.idea', '*.back*', '.settings.php', '.settings_extra.php', 'dbconn.php', '.env', '.env.* (кроме .env.example)',
-  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual',
+  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual', '.claude/docs/visual',
 ];
 const MAX_SIZE = 2 * 1024 * 1024;
 const PARAM_LINE = /^\s*[-*]\s+Секреты\s*:/i;
````

````diff
diff --git a/plugins/kit/scripts/session-start.js b/plugins/kit/scripts/session-start.js
index 7e32036..0a1ab52 100644
--- a/plugins/kit/scripts/session-start.js
+++ b/plugins/kit/scripts/session-start.js
@@ -3,7 +3,7 @@
 // Хук SessionStart (startup|resume|clear|compact): раздел «Сейчас» из журнала и правила процесса в контекст.
 // Вне kit-проекта молчит. Любая ошибка — тихий выход 0.
 const fs = require('fs');
-const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');
+const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude } = require('./lib/project');
 const { getSection } = require('./lib/md');
 
 const MAX_NOW = 4000;
@@ -23,6 +23,14 @@ const RULE_CLAUDE = '- Код пишет Claude: после записи про
 const RULE_NO_PARAMS = '- В .claude/CLAUDE.md нет раздела «Параметры для агентов» — предложи пользователю /kit:project-init (дополнит недостающее).';
 const RULE_WORKTREE = '- Сессия работает в git worktree — правки здесь не попадут на сервер автозаливкой основной папки, пока их не сольют в основную ветку; не проверяй результат на сервере сразу после записи.';
 
+// Где лежат документы проекта; старая раскладка (docs/) — подсказка о переезде.
+function docsRule(docsRel) {
+  const where = docsRel === '.' ? 'корне проекта' : docsRel + '/';
+  const rule = '- Документы проекта — в ' + where + ': планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
+    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.';
+  return docsInClaude(docsRel) ? rule : rule + ' Переезд в .claude/docs — через /kit:project-init.';
+}
+
 // Папка проекта — git worktree, который Claude Code (десктоп) создаёт внутри проекта в .claude/worktrees/.
 function inWorktree(dir) {
   return String(dir || '').replace(/\\/g, '/').toLowerCase().includes('/.claude/worktrees/');
@@ -54,6 +62,7 @@ function buildContext(info) {
   // После правил автозаливки и «Код пишет» — уточняет их для worktree.
   if (always && inWorktree(info.dir)) out.push(RULE_WORKTREE);
   if (!p.found) out.push(RULE_NO_PARAMS);
+  out.push(docsRule(info.docsRel));
   return out.join('\n') + '\n';
 }
 
@@ -69,4 +78,4 @@ function main() {
 }
 
 if (require.main === module) main();
-module.exports = { buildContext, inWorktree };
+module.exports = { buildContext, inWorktree, docsRule };
````

- [ ] **Шаг 4: тесты проходят.** Сначала пять файлов из шага 2, затем весь набор: `npm test` — 0 ✖ (пропущены только 3 теста симлинков, как в `master`).

- [ ] **Шаг 5: сдать контроллеру** — без коммита. **Остановка части A:** контроллер показывает пользователю итог (что сделано, тесты) и ждёт проверки.

---

## Часть B — тексты, версия, интеграция

### Задача 11.7: docs-keeper, git-keeper, `/kit:step-done` — реестр и архив

**Files:**
- Modify: `plugins/kit/agents/docs-keeper.md`, `plugins/kit/agents/git-keeper.md`, `plugins/kit/skills/step-done/SKILL.md`
- Test: `tests/content.test.js` (тесты docs-keeper, git-keeper, step-done)

**Interfaces:**
- Consumes: раскладка папки документов (11.3), запрет `.claude/docs/visual` в `secret-scan` (11.6).
- Produces (для 11.8, 11.9): блок `DOCS` — строки `<путь от папки документов> — <о чём> — <статус>`, перенос — `archive/x (было work/x) — …`; статусы `в работе, этап N`, `готово, этап N (ГГГГ-ММ-ДД)`, `устарел — <чем заменён>`; раздел журнала «Документы» (`| Файл | О чём | Статус |`) сразу после «Решений»; в step-done — подраздел «### Закрытие этапа — архив» до вызова docs-keeper; в FILES git-keeper — оба пути перенесённого документа.

- [ ] **Шаг 1: тесты** — первые три ханка диффа `tests/content.test.js` (docs-keeper, git-keeper, step-done):

````diff
diff --git a/tests/content.test.js b/tests/content.test.js
index fd0fd95..2352547 100644
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -26,9 +26,12 @@ test('docs-keeper: sonnet, без оболочки, читает парамет
   assert.equal(fm.model, 'sonnet');
   assert.equal(fm.tools, 'Read, Edit, Write, Grep, Glob');
   assert.ok(fm.description.length > 40);
-  for (const s of ['Параметры для агентов', 'COMMITS', 'STEP', 'DEPLOY', 'RULES', 'Сейчас', 'Залито на прод', 'Удалить с сервера', 'список изменённых файлов', '/kit:project-init', 'не нашёл строку']) {
+  for (const s of ['Параметры для агентов', 'COMMITS', 'STEP', 'DEPLOY', 'RULES', 'Сейчас', 'Залито на прод', 'Удалить с сервера', 'список изменённых файлов', '/kit:project-init', 'не нашёл строку',
+    '**DOCS**', '`.claude/docs/progress.md`', 'а если его нет, но есть `docs/progress.md`', '**папка документов**', '`deploy-prod.md` в папке документов',
+    '«Решения», «Документы», этапы', '| Файл | О чём | Статус |', '(было <старый путь>)', 'в работе, этап N', 'готово, этап N (ГГГГ-ММ-ДД)', 'перенос в архив делает `/kit:step-done`']) {
     assert.ok(body.includes(s), s);
   }
+  assert.ok(fm.description.includes('DOCS'));
 });
 
 test('git-keeper: haiku, один коммит, COAUTHOR дословно, запреты, secret-scan', () => {
@@ -41,7 +44,7 @@ test('git-keeper: haiku, один коммит, COAUTHOR дословно, за
     'FILES пуст', 'пустым списком путей', 'отдельный аргумент',
     'только в одинарных кавычках', "git commit -m '<MESSAGE>'", "'' в корзине", "'\\''Купить'\\''", 'из Bash',
     'git -c core.quotepath=false status --porcelain=v1', 'git -c core.quotepath=false diff --cached --name-only --diff-filter=D',
-    'components/bitrix/', 'заголовок отличается от MESSAGE', 'MSYS_NO_PATHCONV=1 git commit', 'кроме `.env.example`']) {
+    'components/bitrix/', 'заголовок отличается от MESSAGE', 'MSYS_NO_PATHCONV=1 git commit', 'кроме `.env.example`', '`docs/visual/` и `.claude/docs/visual/`']) {
     assert.ok(body.includes(s), s);
   }
   assert.doesNotMatch(body, /Co-Authored-By: Claude/, 'подпись не зашивается в агента');
@@ -75,9 +78,14 @@ test('step-done: агенты kit:, один коммит, COAUTHOR, запас
   for (const s of ['kit:docs-keeper', 'kit:git-keeper', 'rev-list --count', 'COAUTHOR', 'COMMITS', 'KIT_ROOT',
     'AskUserQuestion', 'general-purpose', '/kit:project-init', 'Сам коммит не делай',
     'git log -1 --format=%s', 'совпадает с MESSAGE целиком', 'git -c core.quotepath=false status --porcelain=v1',
-    '/kit:visual', 'docs/visual/', '.claude/scripts/visual/pages.json']) {
+    '/kit:visual', '<папка документов>/visual/', '.claude/scripts/visual/pages.json',
+    '`.claude/docs/progress.md`', '**папка документов**', '`DOCS`', 'work/<имя> — <о чём> — в работе, этап N', '### Закрытие этапа — архив',
+    '«Все в archive/ (Рекомендую)»', '«Оставить в work/»', 'Move-Item -LiteralPath', 'без git', '**оба** пути, старый и новый', 'git увидит переименование',
+    '<старые и новые пути документов, перенесённых в архив>']) {
     assert.ok(body.includes(s), s);
   }
+  const iArchive = body.indexOf('### Закрытие этапа — архив');
+  assert.ok(iArchive > 0 && iArchive < body.indexOf('## 3. docs-keeper'), 'архив — до вызова docs-keeper');
   assert.doesNotMatch(body, /^\s*git status/m, 'пути — только с core.quotepath=false');
 });
 
````

- [ ] **Шаг 2: убедиться, что тесты падают.** `node --test tests/content.test.js` — FAIL у docs-keeper (`**DOCS**`), git-keeper (`` `docs/visual/` и `.claude/docs/visual/` ``), step-done (`<папка документов>/visual/`).

- [ ] **Шаг 3: агенты:**

````diff
diff --git a/plugins/kit/agents/docs-keeper.md b/plugins/kit/agents/docs-keeper.md
index bfbbdae..0e5db04 100644
--- a/plugins/kit/agents/docs-keeper.md
+++ b/plugins/kit/agents/docs-keeper.md
@@ -1,6 +1,6 @@
 ---
 name: docs-keeper
-description: Ведёт журнал работ проекта, план выкладки на прод и правила проекта (.claude/CLAUDE.md) по блокам STEP/STATUS/SUMMARY/NEXT и необязательным COMMITS, STAGE, DECISIONS, BUGS, PROD_TODO, DEPLOY, NOTES, RULES, которые основной агент передаёт после проверенного шага (обычно из /kit:step-done). Код и git не трогает.
+description: Ведёт журнал работ проекта, план выкладки на прод и правила проекта (.claude/CLAUDE.md) по блокам STEP/STATUS/SUMMARY/NEXT и необязательным COMMITS, STAGE, DECISIONS, DOCS, BUGS, PROD_TODO, DEPLOY, NOTES, RULES, которые основной агент передаёт после проверенного шага (обычно из /kit:step-done). Код и git не трогает.
 tools: Read, Edit, Write, Grep, Glob
 model: sonnet
 ---
@@ -10,8 +10,8 @@ model: sonnet
 ## С чего начать
 
 1. Прочитай раздел «Параметры для агентов» в `.claude/CLAUDE.md`. Возьми из него:
-   - `Журнал` — путь журнала работ (параметра нет — `docs/progress.md`);
-   - `План выкладки` — путь плана выкладки (нет — `docs/deploy-prod.md`);
+   - `Журнал` — путь журнала работ (параметра нет — `.claude/docs/progress.md`, а если его нет, но есть `docs/progress.md` — он); папка журнала — **папка документов**;
+   - `План выкладки` — путь плана выкладки (нет — `deploy-prod.md` в папке документов);
    - `ID шага` — формат ID шагов (параметра нет — формат `N.M`); строки в таблицах этапов держи в порядке ID.
 2. Если файла журнала нет — ничего не создавай. Верни отчёт: «Журнала <путь> нет — нужен /kit:project-init».
 
@@ -27,6 +27,7 @@ model: sonnet
 - **COMMITS** — хеши коммитов прошлых шагов: `1.1=abc1234, 0.7=def5678`.
 - **STAGE** — название этапа, если начался новый.
 - **DECISIONS** — новые решения пользователя: дата и текст.
+- **DOCS** — строки реестра документов, по одной на документ: `<путь от папки документов> — <о чём> — <статус>`; перенос в архив — `archive/x.md (было work/x.md) — … — …`. Статусы: `в работе, этап N`, `готово, этап N (ГГГГ-ММ-ДД)`, `устарел — <чем заменён>`.
 - **BUGS** — новые баги или смена статуса: номер, текст, где находится.
 - **PROD_TODO** — что не забыть при выкладке или переключении.
 - **DEPLOY** — что дописать в план выкладки: любые из полей `Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`.
@@ -35,13 +36,14 @@ model: sonnet
 
 ## Как обновлять журнал
 
-Разделы журнала по порядку: «Сейчас», «Решения», этапы `## Этап N — название` с таблицей `| Шаг | Статус | Что сделано | Коммит |`, «Материалы заказчика», «Баги на потом», «Прод: не забыть», «Справочник». Если раздела нет, а данные для него пришли, — заведи раздел на своём месте.
+Разделы журнала по порядку: «Сейчас», «Решения», «Документы», этапы `## Этап N — название` с таблицей `| Шаг | Статус | Что сделано | Коммит |`, «Материалы заказчика», «Баги на потом», «Прод: не забыть», «Справочник». Если раздела нет, а данные для него пришли, — заведи раздел на своём месте.
 
 1. Прочитай файл целиком.
 2. Найди строку STEP в таблице этапа. Обнови статус, описание (если SUMMARY точнее) и коммит (если он есть в COMMITS). Строки нет — добавь в таблицу своего этапа по порядку ID. Для нового STAGE заведи раздел с такой же таблицей.
 3. Если STATUS = `✅`: у строки NEXT поставь `⏳` (строку добавь, если её нет) и обнови раздел «Сейчас»: этап, следующий шаг, блокеры и открытые вопросы.
 4. COMMITS — заполни только **пустые** ячейки «Коммит» у названных шагов, заполненные не трогай. Хеш пиши в обратных кавычках: `` `abc1234` ``. Шага из COMMITS нет ни в одной таблице — строку не добавляй; перечисли такие ID в отчёте («не нашёл строку для: …»).
 5. DECISIONS — допиши строки в таблицу «Решения». Старые строки не удаляй и не меняй.
+5а. DOCS — раздел «Документы» с таблицей `| Файл | О чём | Статус |` (раздела нет — заведи сразу после «Решений»). Пути — от папки документов (`work/plan-x.md`, `archive/plan-ssh.md`); журнал и план выкладки в реестр не входят. Строка с таким путём есть — обнови «О чём» и «Статус»; при «(было <старый путь>)» найди строку по старому пути и замени в ней путь; строки нет — добавь в конец таблицы. Строки реестра не удаляй. Прежние записи журнала со старыми путями не переписывай: актуальный путь — в реестре.
 6. BUGS — добавь или обнови строки в «Баги на потом». Исправленный баг не удаляй: пометь `✅` и укажи шаг, на котором исправлен.
 7. PROD_TODO — допиши пункты в «Прод: не забыть».
 8. NOTES — кратко добавь в подходящий раздел: «Материалы заказчика» или «Справочник».
@@ -65,7 +67,7 @@ model: sonnet
 
 ## Запрещено
 
-- редактировать любые файлы, кроме журнала, плана выкладки и `.claude/CLAUDE.md`;
+- редактировать любые файлы, кроме журнала, плана выкладки и `.claude/CLAUDE.md`; переносить, создавать и удалять документы (перенос в архив делает `/kit:step-done`);
 - запускать git и команды оболочки;
 - менять код проекта.
 
````

````diff
diff --git a/plugins/kit/agents/git-keeper.md b/plugins/kit/agents/git-keeper.md
index cbdb4f7..f3f8055 100644
--- a/plugins/kit/agents/git-keeper.md
+++ b/plugins/kit/agents/git-keeper.md
@@ -26,7 +26,7 @@ model: haiku
    `-c core.quotepath=false` — во всех командах, которые выводят пути: иначе кириллические имена приходят восьмеричными escape-последовательностями (`"\320\277…"`), и `git add` по ним файл не находит.
    Корень репозитория должен совпадать с текущей папкой. Файлы, которые уже лежат в индексе, но не входят в FILES, в коммит не попадут — это обеспечивает п. 5.
 2. Запрещённые пути. Прочитай параметр «Не коммитить» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`. Остановись и ничего не коммить, если среди FILES есть:
-   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`, `docs/visual/` (снимки `/kit:visual` из-под админа);
+   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`, `docs/visual/` и `.claude/docs/visual/` (снимки `/kit:visual` из-под админа);
    - пути из параметра «Не коммитить» (запись `X (кроме Y)`: X запрещён, Y разрешён).
 
    Правило со `/` в любом месте (`bitrix/`, `/bitrix`, `local/modules`) — путь от корня репозитория и всё внутри: `bitrix/` запрещает `bitrix/.settings.php`, но **не** `local/templates/…/components/bitrix/…` (копии шаблонов компонентов — обычная работа, их коммитят). Правило без `/` (`.idea`, `*.back*`) — имя в любом месте пути.
````

- [ ] **Шаг 4: step-done:**

````diff
diff --git a/plugins/kit/skills/step-done/SKILL.md b/plugins/kit/skills/step-done/SKILL.md
index aaf1b72..09c3a8c 100644
--- a/plugins/kit/skills/step-done/SKILL.md
+++ b/plugins/kit/skills/step-done/SKILL.md
@@ -12,7 +12,7 @@ argument-hint: "[ID шага]"
 
 ## 1. Исходное состояние
 
-1. Убедись, что это kit-проект: есть файл журнала (параметр «Журнал» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`, по умолчанию `docs/progress.md`). Журнала нет — остановись и предложи `/kit:project-init`.
+1. Убедись, что это kit-проект: есть файл журнала (параметр «Журнал» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`; по умолчанию `.claude/docs/progress.md`, в проекте, который ещё не переехал, — `docs/progress.md`). Журнала нет — остановись и предложи `/kit:project-init`. Папка журнала — **папка документов** (`.claude/docs`): в ней `work/`, `archive/` и снимки `visual/`.
 2. Запомни `HEAD` до закрытия шага:
    ```
    git rev-parse HEAD
@@ -28,9 +28,20 @@ argument-hint: "[ID шага]"
 
 Собери из разговора:
 - `STEP` — ID шага (аргумент команды, если передан), `STATUS`, `SUMMARY` (одна строка: что сделано и как проверено), `NEXT` (ID и одна строка);
-- по необходимости `STAGE`, `DECISIONS` (дата `YYYY-MM-DD` и текст), `BUGS`, `PROD_TODO`, `DEPLOY` (`Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`), `NOTES`, `RULES`.
+- по необходимости `STAGE`, `DECISIONS` (дата `YYYY-MM-DD` и текст), `DOCS`, `BUGS`, `PROD_TODO`, `DEPLOY` (`Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`), `NOTES`, `RULES`.
 
-На шаге снимали или сравнивали снимки (`/kit:visual`) — в NOTES: метки, какое сравнение и итог (совпадает / в пределах шума / что отличается, статусы и ошибки), путь к `report.html`. Снимки `docs/visual/` в FILES не включай (только локально, git-keeper их не пропустит); изменённый `.claude/scripts/visual/pages.json` — включай.
+На шаге снимали или сравнивали снимки (`/kit:visual`) — в NOTES: метки, какое сравнение и итог (совпадает / в пределах шума / что отличается, статусы и ошибки), путь к `report.html`. Снимки `<папка документов>/visual/` в FILES не включай (только локально, git-keeper их не пропустит); изменённый `.claude/scripts/visual/pages.json` — включай.
+
+Шаг создал документ в `work/` папки документов (план, спек, чек-лист, материалы) — строка в `DOCS`: `work/<имя> — <о чём> — в работе, этап N`; документ стал ненужным — статус `устарел — <чем заменён>`. Документы кладут в `work/`, а не в корень папки документов и не в `docs/…`.
+
+### Закрытие этапа — архив
+
+Шаг закрывает этап — передан `STAGE` (начинается новый этап) или номер этапа в `NEXT` (часть ID до первой `.`) отличается от номера в `STEP`; ID не вида `N.M` — только по `STAGE`. Тогда прочитай раздел «Документы» журнала: строки `work/…` со статусом `в работе, этап <номер закрываемого этапа>` — кандидаты в архив. Нет — ничего не спрашивай. Есть — AskUserQuestion, список файлов — в тексте вопроса: «Все в archive/ (Рекомендую)» / «Оставить в work/»; часть — через «Другое». Выбранное перенеси обычным перемещением, без git:
+```
+New-Item -ItemType Directory -Force '<папка документов>/archive' | Out-Null
+Move-Item -LiteralPath '<папка документов>/work/<имя>' -Destination '<папка документов>/archive/<имя>'
+```
+Папка-документ (`work/design/`) переносится целиком; имя в `archive/` занято — спроси пользователя, файлы не перезаписывай. В `DOCS` — `archive/<имя> (было work/<имя>) — <о чём> — готово, этап N (ГГГГ-ММ-ДД)`; в FILES — **оба** пути, старый и новый: git-keeper добавит их одной командой `git add -A -- …`, и git увидит переименование — коммит шага остаётся одним.
 
 `COMMITS` — хеши прошлых шагов из истории git:
 ```
@@ -58,6 +69,7 @@ COMMITS: …
 FILES:
 <файлы шага из п. 1.3>
 <файлы из отчёта docs-keeper>
+<старые и новые пути документов, перенесённых в архив>
 MESSAGE: <STEP>: <суть шага одной строкой>
 BODY: <как проверено, 1–3 строки>
 COAUTHOR: <строка Co-Authored-By>
````

- [ ] **Шаг 5: тесты проходят.** `npm test` — 0 ✖.

- [ ] **Шаг 6: сдать контроллеру** — без коммита.

### Задача 11.8: шаблоны и справки, `/kit:project-init` (исключения скриптом, переезд), `/kit:visual`

**Files:**
- Modify: `plugins/kit/skills/project-init/templates/CLAUDE.md`, `progress.md`, `deploy-prod.md`, `gitignore-bitrix`, `gitignore-general`
- Modify: `plugins/kit/skills/project-init/reference/phpstorm.md`, `reference/bitrix.md`, `plugins/kit/skills/project-init/SKILL.md`
- Modify: `plugins/kit/skills/visual/SKILL.md`, `plugins/kit/skills/visual/reference/pages.md`
- Test: `tests/templates.test.js`, `tests/content.test.js` (тесты project-init, visual)

**Interfaces:**
- Consumes: `phpstorm-exclude.js --also/--check` (11.5), `check-closed.js --dirs docs` и проверка исключённой `.claude` (11.6), DOCS и архив (11.7).
- Produces: шаблон `CLAUDE.md` — «Журнал: .claude/docs/progress.md», «План выкладки: .claude/docs/deploy-prod.md», «Не выкладывать: {{ИСКЛЮЧЕНИЯ — через запятую: всегда .idea, .git, .claude; по ответу — .gitignore, local/modules}}», правило «Документы»; `progress.md` — раздел «Документы» после «Решений»; `.gitignore` — `!/.claude/docs/`, `!/.claude/docs/**`, затем `/.claude/docs/visual/`; `phpstorm.md` — «## Что исключать — хук `phpstorm-exclude.js`»; `project-init` — п. 4.0 «Исключения PhpStorm — до любой записи в проект», вопрос 3 второго вызова «`.gitignore`» / «`local/modules`» / «Больше ничего», п. 4.7 «Переезд со старой раскладки» (исключения → `.gitignore` → старые копии на сервере → таблица «файл → куда» → перенос → закрытие), п. 4.8 «Закрыть шаг»; `visual` — пути `<папка снимков>`, код 4 → `phpstorm-exclude.js`.

- [ ] **Шаг 1: тесты** — `tests/templates.test.js` и оставшиеся три ханка `tests/content.test.js` (project-init, visual):

````diff
diff --git a/tests/templates.test.js b/tests/templates.test.js
index 1d49ade..90465b8 100644
--- a/tests/templates.test.js
+++ b/tests/templates.test.js
@@ -20,11 +20,12 @@ function ignored(gitignore, paths) {
   return new Set(r.stdout.split(/\r?\n/).filter(Boolean));
 }
 
-test('gitignore-bitrix: служебное, ядро и секреты игнорируются, правила, скрипты и материалы — в git', () => {
-  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php', 'docs/visual/before/admin/desktop/home.png',
+test('gitignore-bitrix: служебное, ядро, снимки и секреты игнорируются; правила, документы, скрипты и материалы — в git', () => {
+  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php', '.claude/docs/visual/before/admin/desktop/home.png', '.claude/docs/visual/.gitignore',
     'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1',
     '.env', '.env.local', 'local/.env.production', 'cert/site.pem', 'local/ssl/private.key'];
-  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', '.claude/scripts/visual/pages.json', 'upload/docs/a.png', 'local/templates/x/a.php',
+  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', '.claude/scripts/visual/pages.json', '.claude/docs/progress.md', '.claude/docs/deploy-prod.md',
+    '.claude/docs/work/plan-12345.md', '.claude/docs/work/design/a.png', '.claude/docs/archive/plan-ssh.md', 'upload/docs/a.png', 'local/templates/x/a.php',
     'local/templates/x/components/bitrix/news.list/.default/template.php', 'docs/progress.md', 'local/php_interface/env.php',
     '.env.example', 'local/.env.example'];
   const set = ignored(read('gitignore-bitrix'), [...yes, ...no]);
@@ -32,9 +33,9 @@ test('gitignore-bitrix: служебное, ядро и секреты игно
   for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
 });
 
-test('gitignore-general: служебное и секреты игнорируются', () => {
-  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1', 'docs/visual/links.json'];
-  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', '.claude/scripts/visual/pages.json', 'src/a.php', 'docs/progress.md', '.env.example'];
+test('gitignore-general: служебное, снимки и секреты игнорируются; документы — в git', () => {
+  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1', '.claude/docs/visual/links.json'];
+  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', '.claude/scripts/visual/pages.json', 'src/a.php', '.claude/docs/progress.md', '.claude/docs/work/spec.md', '.claude/docs/archive/a.md', 'docs/progress.md', '.env.example'];
   const set = ignored(read('gitignore-general'), [...yes, ...no]);
   for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
   for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
@@ -46,6 +47,18 @@ test('CLAUDE.md: у параметра «Выкладка» три вариан
   assert.deepEqual(line[1].split(' | '), ['PhpStorm Always', 'вручную; дев — PhpStorm Always', 'вручную']);
 });
 
+test('CLAUDE.md: документы — в .claude/docs, в «Не выкладывать» — .claude', () => {
+  const v = parseParams(read('CLAUDE.md'));
+  assert.equal(v['журнал'], '.claude/docs/progress.md');
+  assert.equal(v['план выкладки'], '.claude/docs/deploy-prod.md');
+  assert.ok(v['не выкладывать'].includes('всегда .idea, .git, .claude;'), v['не выкладывать']);
+  const tpl = read('CLAUDE.md');
+  assert.ok(tpl.includes('`.claude/docs/visual/`'));
+  assert.ok(tpl.includes('в `work/`') && tpl.includes('в `archive/`') && tpl.includes('раздел «Документы» журнала'));
+  const rest = tpl.split('.claude/docs/').join('').split('upload/docs/').join('');
+  assert.ok(!rest.includes('docs/'), 'старых путей docs/ в шаблоне нет');
+});
+
 test('CLAUDE.md: раздел параметров со всеми ключами', () => {
   const v = parseParams(read('CLAUDE.md'));
   assert.ok(v, 'нет раздела «Параметры для агентов»');
@@ -70,9 +83,12 @@ test('CLAUDE.md → «Не коммитить» → правила путей: 
 
 test('progress.md: разделы журнала и таблица этапа 0', () => {
   const md = read('progress.md');
-  for (const s of ['Сейчас', 'Решения', 'Этап 0', 'Материалы заказчика', 'Баги на потом', 'Прод: не забыть', 'Справочник']) {
+  for (const s of ['Сейчас', 'Решения', 'Документы', 'Этап 0', 'Материалы заказчика', 'Баги на потом', 'Прод: не забыть', 'Справочник']) {
     assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
   }
+  assert.ok(getSection(md, 'Документы').includes('| Файл | О чём | Статус |'));
+  assert.ok(!md.includes('`docs/`'), 'старых путей docs/ в журнале нет');
+  assert.ok(md.indexOf('## Решения') < md.indexOf('## Документы') && md.indexOf('## Документы') < md.indexOf('## Этап 0'), '«Документы» — после «Решений», до этапов');
   const rows = parseTable(getSection(md, 'Этап 0'));
   assert.deepEqual(Object.keys(rows[0]), ['Шаг', 'Статус', 'Что сделано', 'Коммит']);
   assert.equal(rows[0]['Шаг'], '0.1');
````

````diff
diff --git a/tests/content.test.js b/tests/content.test.js
index fd0fd95..2352547 100644
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -96,11 +104,12 @@ test('project-init: только командой, все шаги и шабло
   for (const s of ['AskUserQuestion', 'secret-scan.js', 'site-probe.js', 'check-closed.js', 'deployment.xml', 'watcherTasks.xml',
     'webServers.xml', '0.1: Исходники с прода (копия прода)', 'kit:git-keeper', '/kit:step-done', 'core.autocrlf', 'core.quotepath',
     'Варианта «это не секрет» нет', '4.0', 'сам не коммить', 'не больше 4 вопросов', 'Grep с `-o` по `rootFolder=',
-    '403 на папку ещё не доказывает',
-    '`.claude/scripts`, `.claude/settings.local.json`, `.claude/worktrees` и `docs/visual` (Рекомендую)', 'сервера автозаливки',
-    'Always только на дев — дев', 'вопрос 3 (исключения; всегда `.idea` и `.git`)',
+    '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --also', '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --check --also', 'Код 2 — `deployment.xml` не разобран',
+    'File → Reload All from Disk', '`.idea`, `.git` и `.claude` исключаются всегда', '«Больше ничего»', 'сервера автозаливки',
+    'Always только на дев — дев', 'норма — 404 «нет на сервере»',
     '4.5 Проверки выкладки — любой режим, если известен адрес сервера (прод, дев или адрес из п. 4.0)', 'по обоим',
-    'после 2–3 повторов — как в п. 4.0',
+    '### 4.7 Переезд со старой раскладки', '### 4.8 Закрыть шаг', 'git check-ignore -q .claude/docs/progress.md', '`!/.claude/docs/`, `!/.claude/docs/**`',
+    '--dirs docs', '**до** переноса', 'Таблица «файл → куда»', 'одной записью `.claude`', 'show --stat -M HEAD', '`/kit:step-done` (п. 4.8)',
     'ssh-probe.js', 'reference/ssh.md', 'SSH прод', 'SSH дев', 'PHP на сервере', 'Host key verification failed', '«SSH нет»',
     'только строки `Host`, `HostName`, `User`', '[совпадает]', '/kit:server',
     'Grep `-i` по `^\\s*(Host|HostName|User)(\\s*=\\s*|\\s+)\\S`', 'строки целиком, без `-o`', 'шаблоны с `*`, `?`, `!` в варианты не брать',
@@ -115,17 +124,23 @@ test('project-init: только командой, все шаги и шабло
   const tpl = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8');
   assert.ok(tpl.includes('| SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; справка reference/ssh.md)'), 'шаблон: третий вариант «Работа на сервере»');
   const q3 = /3\. Исключения деплоя[^\n]*/.exec(body)[0];
-  assert.equal((q3.match(/«[^»]*»/g) || []).length, 4, 'в вопросе про исключения ровно 4 варианта: ' + q3);
+  assert.deepEqual(q3.split('. В тексте вопроса')[0].match(/«[^»]*»/g),['«`.gitignore`»', '«`local/modules`»', '«Больше ничего»'], 'варианты вопроса про исключения: ' + q3);
+  const i47 = body.indexOf('### 4.7 Переезд');
+  const steps = ['1. **Исключения.**', '2. **`.gitignore`.**', '3. **Старые копии на сервере.**', '4. **Таблица «файл → куда»**', '5. **Перенос**', '6. **Закрытие**'].map((t) => body.indexOf(t, i47));
+  assert.ok(steps.every((v, i) => v > i47 && (i === 0 || v > steps[i - 1])), 'переезд: исключения → .gitignore → старые копии → таблица → перенос → закрытие');
+  assert.ok(!body.includes('docs/.htaccess` и `.claude/.htaccess`'), 'docs/.htaccess — только при старой раскладке');
   const q4 = /4\. Как файлы попадают на сервер: [^\n]*?\./.exec(body)[0];
   assert.deepEqual(q4.match(/«[^»]*»/g), ['«PhpStorm Always на прод»', '«PhpStorm Always только на дев, прод вручную»', '«вручную списком файлов»']);
-  for (const s of ['`autoUpload="Always"` / `myAutoUpload` = `ALWAYS`', 'Только при автозаливке на любой сервер',
+  for (const s of ['`autoUpload="Always"` / `myAutoUpload` = `ALWAYS`', 'Дальше — только при автозаливке на любой сервер',
     '| PhpStorm Always на прод | `PhpStorm Always` |', '| PhpStorm Always только на дев, прод вручную | `вручную; дев — PhpStorm Always` |',
     '| вручную списком файлов | `вручную` |']) {
     assert.ok(body.includes(s), s);
   }
-  assert.ok(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8').includes('`.claude/worktrees`'));
-  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: .*\.claude\/worktrees, docs\/visual/);
-  assert.ok(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8').includes('`docs/visual`'));
+  const pstorm = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8');
+  for (const s of ['`.claude/worktrees`', '## Что исключать — хук `phpstorm-exclude.js`', 'Всегда: `.idea`, `.git`, `.claude`', 'File → Reload All from Disk', 'маски (`*.back*`)']) {
+    assert.ok(pstorm.includes(s), 'phpstorm.md: ' + s);
+  }
+  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: \{\{ИСКЛЮЧЕНИЯ — через запятую: всегда \.idea, \.git, \.claude;/);
   for (const t of ['CLAUDE.md', 'progress.md', 'deploy-prod.md', 'gitignore-bitrix', 'gitignore-general', 'htaccess-deny']) {
     assert.ok(body.includes('`' + t + '`'), 'скилл не называет шаблон ' + t);
     assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', t)), 'нет шаблона ' + t);
@@ -179,7 +194,7 @@ test('visual: сценарий, коды, согласие на установк
   assert.equal(fm.name, 'visual');
   assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
   assert.ok(fm.description.length > 40);
-  for (const s of ['${CLAUDE_PLUGIN_ROOT}/scripts/visual.js', '.claude/scripts/visual/pages.json', 'docs/visual', '%LOCALAPPDATA%\\kit\\visual\\deps',
+  for (const s of ['${CLAUDE_PLUGIN_ROOT}/scripts/visual.js', '.claude/scripts/visual/pages.json', '`.claude/docs/visual/…`', '`docs/visual/…`', '<папка снимков>/compare-', '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js', '%LOCALAPPDATA%\\kit\\visual\\deps',
     'deps', 'install', 'login', 'discover / catalog/ personal/', 'shoot before', 'check before', 'compare before after-', 'after-10.5a', '--only', '--no-setup', '--env дев',
     'AskUserQuestion', 'run_in_background', 'Пароли вводит только пользователь', '"unsafe": true', 'Excluded Paths', 'noise.json', 'report.html',
     'summary.json', 'Статусы и ошибки', 'через Read', '/kit:step-done', 'NOTES', 'не коммитить и не выкладывать', 'Git Bash', '`.idea` не править']) {
````

- [ ] **Шаг 2: убедиться, что тесты падают.** `node --test tests/templates.test.js tests/content.test.js` — FAIL: `.claude/docs/progress.md` игнорируется шаблоном, нет раздела «Документы», «Журнал» — `docs/progress.md`; в project-init нет `phpstorm-exclude.js`, в visual — `<папка снимков>`.

- [ ] **Шаг 3: шаблоны:**

````diff
diff --git a/plugins/kit/skills/project-init/templates/CLAUDE.md b/plugins/kit/skills/project-init/templates/CLAUDE.md
index 622509b..2cf78ef 100644
--- a/plugins/kit/skills/project-init/templates/CLAUDE.md
+++ b/plugins/kit/skills/project-init/templates/CLAUDE.md
@@ -16,7 +16,7 @@
 - **Работа на сервере:** {{SSH — `ssh ХОСТ`, папка сайта `ПАПКА`, PHP CLI `PHP_НА_СЕРВЕРЕ`; `/kit:server` работает по SSH, консоль — запасной путь (в режиме bitrix). | SSH нет — `/kit:server` работает через Командную PHP-строку в Chrome. | SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; справка reference/ssh.md)}}
 - **Выкладка:** {{PhpStorm, сервер `СЕРВЕР`, автозаливка Always — любое сохранение файла в проекте, в том числе правка Claude, сразу уходит на сервер. | на прод — вручную, списком изменённых файлов (`/kit:deploy-list`); на дев — PhpStorm, сервер `СЕРВЕР`, автозаливка Always: любое сохранение сразу уходит на дев. | вручную, списком изменённых файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки.}}
   - Не выкладываются: {{ИСКЛЮЧЕНИЯ}}.
-  - `docs/` и `.claude/` закрыты `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА_ПРОВЕРКИ | ещё не проверено}}).
+  - `.claude/` (правила, документы `.claude/docs`, скрипты) из выкладки исключена: Excluded Paths PhpStorm дописывает хук kit, для ручной выкладки — «Не выкладывать»; на случай ручной заливки закрыта `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА_ПРОВЕРКИ | ещё не проверено}}).
   - Удаление файла локально на сервере его **не удаляет** — список в разделе «Удалить с сервера» плана выкладки.
 - **Синтаксис:** `{{PHP_EXE}} -l <файл>` — хук плагина делает это после каждой правки PHP.
 
@@ -24,12 +24,13 @@
 
 - {{Что нельзя сломать: живые страницы, формы в CRM, оплата, почта — и чем это защищено}}
 - Секреты — только в {{/bitrix/.settings_extra.php | .env (в git не попадает)}}, в git не класть.
-- Снимки публичной части (`/kit:visual`) — в `docs/visual/`, только локально: в git и на сервер не попадают (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`).
+- Снимки публичной части (`/kit:visual`) — в `.claude/docs/visual/`, только локально: в git и на сервер не попадают (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`).
 
 ## Как работаем
 
 - **Код пишет {{Claude | пользователь}}.** {{Один шаг за раз: код во временной папке → `php -l` → запись в проект → проверка результата на сервере (десктоп и мобильная ширина) → следующий шаг. | Claude даёт один маленький шаг, ждёт ответа, проверяет (`git diff`, `php -l`, сервер) и только потом даёт следующий; «сделай сам» относится только к тому шагу, на котором прозвучало.}}
 - **Выбор** за пользователем, вопросы — только через AskUserQuestion.
+- **Документы** — в `.claude/docs/`: журнал и план выкладки в корне; планы, спеки, чек-листы, материалы задач — в `work/`; готовое и устаревшее — в `archive/`; реестр — раздел «Документы» журнала (новый документ — строкой DOCS в `/kit:step-done`, в архив — при закрытии этапа).
 - **После проверки шага** — `/kit:step-done`: `kit:docs-keeper` обновляет журнал и план выкладки, `kit:git-keeper` делает один коммит `ID: …`.
 - **Git** пользователь сам не трогает, команды git ему не выдаём.
 - **Форматирование:** файлы целиком не переформатировать. Переводы строк — LF.
@@ -52,9 +53,9 @@
 - SSH дев: {{ХОСТ:ПАПКА_САЙТА_ДЕВА | —}}
 - PHP на сервере: {{ПУТЬ_К_PHP_CLI | —}}
 - PHP: {{PHP_EXE | —}}
-- Журнал: docs/progress.md
-- План выкладки: docs/deploy-prod.md
+- Журнал: .claude/docs/progress.md
+- План выкладки: .claude/docs/deploy-prod.md
 - ID шага: N.M (например 0.3, 2.1)
-- Не выкладывать: {{ИСКЛЮЧЕНИЯ — через запятую: всегда .idea, .git; обычно .claude/scripts, .claude/settings.local.json, .claude/worktrees, docs/visual}}
+- Не выкладывать: {{ИСКЛЮЧЕНИЯ — через запятую: всегда .idea, .git, .claude; по ответу — .gitignore, local/modules}}
 - Не коммитить: {{bitrix/, upload/ (кроме upload/docs/), *.back* | *.back*}}
 - Секреты: {{подстроки секретов проекта | —}}
````

````diff
diff --git a/plugins/kit/skills/project-init/templates/progress.md b/plugins/kit/skills/project-init/templates/progress.md
index 44ba60b..de4607f 100644
--- a/plugins/kit/skills/project-init/templates/progress.md
+++ b/plugins/kit/skills/project-init/templates/progress.md
@@ -5,7 +5,7 @@
 ## Сейчас
 
 - **Этап:** 0 — подготовка
-- **Следующий шаг:** 0.2 — правила проекта, журнал, план выкладки, закрытие `docs/` и `.claude/`
+- **Следующий шаг:** 0.2 — правила проекта, журнал, план выкладки, исключение и закрытие `.claude/`
 - **Блокеры и открытые вопросы:** —
 
 ## Решения
@@ -14,12 +14,17 @@
 |---|---|
 | {{ДАТА}} | {{Решение из ответов /kit:project-init — по строке на ответ}} |
 
+## Документы
+
+| Файл | О чём | Статус |
+|---|---|---|
+
 ## Этап 0 — подготовка
 
 | Шаг | Статус | Что сделано | Коммит |
 |---|---|---|---|
 | 0.1 | ✅ | git: `.gitignore`, `core.autocrlf=input`, `core.quotepath=false`, исходники с {{прода или дева}} | `{{ХЕШ}}` |
-| 0.2 | ⏳ | Правила проекта `.claude/CLAUDE.md` с «Параметрами для агентов», журнал, план выкладки, `.htaccess` для `docs/` и `.claude/` | |
+| 0.2 | ⏳ | Правила проекта `.claude/CLAUDE.md` с «Параметрами для агентов», журнал и план выкладки в `.claude/docs/`, исключения PhpStorm, `.htaccess` для `.claude/` | |
 
 ## Материалы заказчика
 
````

````diff
diff --git a/plugins/kit/skills/project-init/templates/deploy-prod.md b/plugins/kit/skills/project-init/templates/deploy-prod.md
index 67ee1f2..7da4e0d 100644
--- a/plugins/kit/skills/project-init/templates/deploy-prod.md
+++ b/plugins/kit/skills/project-init/templates/deploy-prod.md
@@ -4,7 +4,7 @@
 
 - {{Заливает PhpStorm автоматически (сервер `СЕРВЕР`, автозаливка Always): любое сохранение файла в проекте сразу уходит на прод. | Выкладка вручную, списком файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки (по таблице «Залито на прод» ниже).}}
 - Не выкладываются: {{ИСКЛЮЧЕНИЯ}}.
-- `docs/` и `.claude/` закрыты `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА и итог | ещё не проверено}}). nginx может отдавать статику (pdf, docx, картинки, txt…) мимо `.htaccess` — такие файлы в `docs/` и `.claude/` не держать.
+- `.claude/` (правила, документы `.claude/docs`, скрипты) не выкладывается: Excluded Paths PhpStorm дописывает хук kit, при ручной выкладке она в «Не выкладывать»; на случай ручной заливки закрыта `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА и итог | ещё не проверено}}). nginx может отдавать статику (pdf, docx, картинки, txt…) мимо `.htaccess` — поэтому главное — не выкладывать.
 - До записи в проект — `php -l` (PHP {{ВЕРСИЯ_PHP}}).
 - Удалённые локально файлы на сервере удаляются отдельно — раздел «Удалить с сервера».
 
````

````diff
diff --git a/plugins/kit/skills/project-init/templates/gitignore-bitrix b/plugins/kit/skills/project-init/templates/gitignore-bitrix
index 1543bc4..ed58641 100644
--- a/plugins/kit/skills/project-init/templates/gitignore-bitrix
+++ b/plugins/kit/skills/project-init/templates/gitignore-bitrix
@@ -1,13 +1,15 @@
-# Служебное IDE и Claude Code: в git только правила, .htaccess и скрипты консоли
+# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты консоли
 /.idea/
 /.claude/*
 !/.claude/CLAUDE.md
 !/.claude/.htaccess
 !/.claude/scripts/
 !/.claude/scripts/**
+!/.claude/docs/
+!/.claude/docs/**
 
 # Снимки /kit:visual — только локально (из-под админа)
-/docs/visual/
+/.claude/docs/visual/
 
 # Ядро и загрузки Битрикса (секреты — в bitrix/.settings_extra.php); материалы задачи — в upload/docs/
 /bitrix/
````

````diff
diff --git a/plugins/kit/skills/project-init/templates/gitignore-general b/plugins/kit/skills/project-init/templates/gitignore-general
index 5238903..6d443e3 100644
--- a/plugins/kit/skills/project-init/templates/gitignore-general
+++ b/plugins/kit/skills/project-init/templates/gitignore-general
@@ -1,13 +1,15 @@
-# Служебное IDE и Claude Code: в git только правила, .htaccess и скрипты консоли
+# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты консоли
 /.idea/
 /.claude/*
 !/.claude/CLAUDE.md
 !/.claude/.htaccess
 !/.claude/scripts/
 !/.claude/scripts/**
+!/.claude/docs/
+!/.claude/docs/**
 
 # Снимки /kit:visual — только локально (из-под админа)
-/docs/visual/
+/.claude/docs/visual/
 
 # Секреты и зависимости
 .env
````

- [ ] **Шаг 4: справки:**

````diff
diff --git a/plugins/kit/skills/project-init/reference/phpstorm.md b/plugins/kit/skills/project-init/reference/phpstorm.md
index 74ba1de..4118921 100644
--- a/plugins/kit/skills/project-init/reference/phpstorm.md
+++ b/plugins/kit/skills/project-init/reference/phpstorm.md
@@ -2,11 +2,11 @@
 
 ## Где настройки
 
-- **Исключения деплоя:** Settings → Build, Execution, Deployment → Deployment → сервер (например `ftp`) → вкладка **Excluded Paths** → «Add local path» для каждого пути.
+- **Исключения деплоя:** Settings → Build, Execution, Deployment → Deployment → сервер (например `ftp`) → вкладка **Excluded Paths**. С 2.3.0 руками туда не ходить: исключения дописывает хук kit `phpstorm-exclude.js` (ниже); руками — только если хук сообщил, что `deployment.xml` не разобран.
 - **Автозаливка:** Settings → Build, Execution, Deployment → Deployment → **Options** → «Upload changed files automatically to the default server»: `Always` / `On explicit save action (Ctrl+S)` / `Never`. Флажок «Upload external changes» — заливать и правки, сделанные вне IDE (правки Claude).
 - **File Watchers:** Settings → Tools → **File Watchers** — снять флажок у вотчера или удалить его.
 
-## Что лежит в `.idea` (только читать, не править)
+## Что лежит в `.idea` (только читать; `excludedPath` дописывает только `phpstorm-exclude.js`)
 
 - `.idea/deployment.xml`, компонент `PublishConfigData`:
   - `autoUpload="Always"` и `<option name="myAutoUpload" value="ALWAYS" />` — автозаливка при каждом сохранении;
@@ -16,15 +16,14 @@
 - `.idea/webServers.xml` — серверы: `url`, `rootFolder` (часто содержит домен, например `/www/alpha.example.com`), хост FTP. Пароли не читать и не выводить.
 - `.idea/watcherTasks.xml` — вотчеры: `<TaskOptions isEnabled="true">`, `name`, `fileExtension`, `output`.
 
-## Что исключать
+## Что исключать — хук `phpstorm-exclude.js`
 
-- Всегда: `.idea`, `.git`.
-- `.claude/scripts` — скрипты Командной PHP-строки: в git есть, на сервере не нужны.
-- Служебные файлы Claude Code в `.claude`: `settings.local.json` и любые новые — Claude Code может завести их позже; при появлении добавлять в исключения.
-- `.claude/worktrees` — git worktree, которые Claude Code (десктоп) создаёт внутри проекта: в каждом полная копия сайта. Без исключения при автозаливке она уедет на сервер; правки в worktree попадают на сервер только после слияния в основную ветку основной папки.
-- `docs/visual` — снимки `/kit:visual`, сделанные из-под администратора: на сервер нельзя (nginx отдаёт картинки мимо `.htaccess`). При автозаливке без этого исключения `visual.js` не снимает (код 4).
-- `.claude/CLAUDE.md` и `docs/` можно выкладывать: папки закрыты `.htaccess`, проверка — `check-closed.js`. Или исключить `.claude` целиком — решает пользователь.
-- `local/modules/` — если модули лежат в проекте только для чтения.
+Хук SessionStart плагина kit в kit-проекте при каждом старте сессии сверяет `.idea/deployment.xml` и дописывает недостающее каждому серверу, сопоставленному с корнем проекта (`local="$PROJECT_DIR$"`; сервер с подпапкой, например `dist`, не трогается). Только добавляет — ничего не удаляет и не меняет; сообщает одной строкой `[kit] Исключения PhpStorm: добавлено «ftp» — …`. Руками: `node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" [--also a,b]` из корня проекта, сверка — `--check` (0 — всё на месте, 1 — не хватает, 2 — файл не разобран).
+
+- Всегда: `.idea`, `.git`, `.claude` — вся служебная папка: правила `CLAUDE.md`, документы `.claude/docs` (журнал, план выкладки, `work/`, `archive/`, снимки `visual/` из-под админа), скрипты консоли `.claude/scripts`, `settings.local.json` и `.claude/worktrees` — git worktree Claude Code (десктоп) с полной копией сайта.
+- Проект ещё не переехал (журнал в `docs/`) — и `docs`.
+- Простые пути из «Не выкладывать» (`.gitignore`, `local/modules` — если модули лежат в проекте только для чтения, `bitrix`…); маски (`*.back*`) и `(кроме …)` PhpStorm не понимает — их учитывает только `/kit:deploy-list`.
+- Если PhpStorm открыт и правку файла не подхватил (в Excluded Paths новых строк нет) — File → Reload All from Disk или перезапуск PhpStorm.
 
 ## Грабли
 
````

````diff
diff --git a/plugins/kit/skills/project-init/reference/bitrix.md b/plugins/kit/skills/project-init/reference/bitrix.md
index 4cd6cfb..846ba61 100644
--- a/plugins/kit/skills/project-init/reference/bitrix.md
+++ b/plugins/kit/skills/project-init/reference/bitrix.md
@@ -6,11 +6,13 @@
 - Заголовок скрыт — `ssh-probe.js` (версии PHP на сервере) или `/kit:server`, код `echo PHP_VERSION;`.
 - Синтаксис проверяем той же версией: `C:\OSPanel\modules\PHP-X.Y\php.exe -l` (параметр «PHP»; хук `php-lint` делает это после каждой правки). На PHP 7.x — никакого синтаксиса PHP 8 (`match`, `?->`, именованные аргументы, `str_contains`).
 
-## Закрытие `docs/` и `.claude/`
+## Закрытие `.claude/` (и старой `docs/`)
 
-- `.htaccess` с `Require all denied` действует, только если запрос доходит до Apache. На хостингах nginx + Apache статику (pdf, docx, xlsx, картинки, txt, zip…) часто отдаёт сам nginx — мимо `.htaccess` (найдено в epsilon 2026-09-22). Поэтому:
-  - проверять **каждый файл** снаружи — `check-closed.js` (ожидается 403);
-  - в `docs/` и `.claude/` не держать статические форматы; если нужно — дописать `.php` к имени (`tz.docx.php`), тогда запрос идёт в Apache.
+- С 2.3.0 документы проекта лежат в `.claude/docs`, а `.claude` исключена из выкладки целиком (Excluded Paths дописывает хук kit `phpstorm-exclude.js`, для ручной выкладки — «Не выкладывать»). На сервер такие файлы не уезжают — это главная защита.
+- `.htaccess` с `Require all denied` — страховка на случай ручной заливки папки целиком; действует, только если запрос доходит до Apache. На хостингах nginx + Apache статику (pdf, docx, xlsx, картинки, txt, zip…) часто отдаёт сам nginx — мимо `.htaccess` (найдено в epsilon 2026-09-22). Поэтому:
+  - проверять **каждый файл** снаружи — `check-closed.js` (норма — 404 «нет на сервере» или 403);
+  - в старой `docs/` (проект ещё не переехал) не держать статические форматы; если нужно — дописать `.php` к имени (`tz.docx.php`), тогда запрос идёт в Apache.
+- Старые копии `docs/` и `.claude/` на сервере (выложенные до 2.3.0) сами не исчезают — `check-closed.js` находит их (403/ОТКРЫТ), удаление — через «Удалить с сервера».
 - Проверять всегда снаружи, по настоящему адресу.
 
 ## `.min.css` / `.min.js`
````

- [ ] **Шаг 5: project-init:**

````diff
diff --git a/plugins/kit/skills/project-init/SKILL.md b/plugins/kit/skills/project-init/SKILL.md
index a321b3b..6553992 100644
--- a/plugins/kit/skills/project-init/SKILL.md
+++ b/plugins/kit/skills/project-init/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: project-init
-description: Подготовить проект к работе по схеме kit — git, .gitignore, скан секретов, первый коммит, .claude/CLAUDE.md с «Параметрами для агентов», журнал docs/progress.md, план выкладки docs/deploy-prod.md, .htaccess для docs/ и .claude/; в любом режиме — проверка 403 снаружи и (при автозаливке) исключения PhpStorm; в режиме 1С-Битрикс — File Watchers. В существующем проекте дополняет недостающее, ничего не перезаписывает.
+description: Подготовить проект к работе по схеме kit — git, .gitignore, скан секретов, первый коммит, .claude/CLAUDE.md с «Параметрами для агентов», журнал и план выкладки в .claude/docs, исключения PhpStorm (дописывает phpstorm-exclude.js), .htaccess для .claude/; переезд старой docs/ в .claude/docs; в любом режиме — проверка снаружи; в режиме 1С-Битрикс — File Watchers. В существующем проекте дополняет недостающее, ничего не перезаписывает.
 disable-model-invocation: true
 ---
 
@@ -13,9 +13,10 @@ disable-model-invocation: true
 ## 1. Разведка (только чтение)
 
 - **git:** есть ли `.git`; `git config --get core.autocrlf`, `git config --get core.quotepath`; число коммитов (`git rev-list --count HEAD`) и первый коммит.
-- **Файлы kit:** `.claude/CLAUDE.md` (есть ли раздел `## Параметры для агентов`), `docs/progress.md`, `docs/deploy-prod.md`, `docs/.htaccess`, `.claude/.htaccess`, `.gitignore`, проектные копии агентов `.claude/agents/docs-keeper.md` и `.claude/agents/git-keeper.md`, служебные файлы Claude Code в `.claude/` (`settings.local.json` и т. п.).
+- **Файлы kit:** `.claude/CLAUDE.md` (есть ли раздел `## Параметры для агентов`), журнал и план выкладки (`.claude/docs/progress.md`, `.claude/docs/deploy-prod.md`), `.claude/.htaccess`, `.gitignore` (игнорирует ли git папку документов: `git check-ignore -q .claude/docs/progress.md` — код 0 значит игнорирует; шаблоны до 2.3.0 игнорируют `/.claude/*`), проектные копии агентов `.claude/agents/docs-keeper.md` и `.claude/agents/git-keeper.md`, служебные файлы Claude Code в `.claude/` (`settings.local.json` и т. п.).
+- **Старая раскладка** — параметр «Журнал» указывает в `docs/` или есть `docs/progress.md`: состав `docs/` (`git -c core.quotepath=false ls-files docs` и неотслеживаемое — например `docs/visual/`), `docs/.htaccess`; переезд — п. 4.7.
 - **Битрикс:** `bitrix/`, `local/`, `local/templates/`, `urlrewrite.php`, `.settings.php` — признаки режима «bitrix».
-- **PhpStorm** (только читать):
+- **PhpStorm** (только читать; исключения в `deployment.xml` дописывает только `phpstorm-exclude.js`, п. 4.0):
   - `.idea/deployment.xml` — `autoUpload`, `autoUploadExternalChanges`, `serverName`, список `excludedPath`;
   - `.idea/webServers.xml` — Grep с `-o` по `rootFolder="[^"]*"|url="[^"]*"` — выводить только совпавшую часть; файл целиком не открывать. Из `rootFolder` (например `/www/alpha.example.com`) — догадка домена `alpha.example.com`;
   - `.idea/watcherTasks.xml` — включённые File Watchers (`name`, `isEnabled`).
@@ -33,7 +34,7 @@ disable-model-invocation: true
 Второй вызов — не больше 4 вопросов, в каждом 2–4 варианта:
 1. Адрес прода: `https://<домен из rootFolder>` (Рекомендую) и `https://www.<домен>`; догадки нет — «Прода пока нет» / «Введу адрес в «Другое»».
 2. Задача: «Без задачи» / «Есть — номер и название в «Другое»».
-3. Исключения деплоя (мультивыбор, 4 варианта): «`.idea` и `.git` (Рекомендую)», «`.claude/scripts`, `.claude/settings.local.json`, `.claude/worktrees` и `docs/visual` (Рекомендую)», «`.gitignore`», «`local/modules`»; уже исключённые в `deployment.xml` перечисли в тексте вопроса. `.claude/worktrees` — git worktree, которые Claude Code (десктоп) создаёт внутри проекта: полная копия сайта, при автозаливке уехала бы на сервер. `docs/visual` — снимки `/kit:visual` из-под админа: nginx отдаёт картинки мимо `.htaccess`.
+3. Исключения деплоя сверх обязательных (мультивыбор, 3 варианта): «`.gitignore`», «`local/modules`», «Больше ничего». В тексте вопроса: `.idea`, `.git` и `.claude` исключаются всегда — `.claude` закрывает правила, документы `.claude/docs` (журнал, планы, снимки `/kit:visual` из-под админа), скрипты консоли, `settings.local.json` и `.claude/worktrees` (git worktree Claude Code — полная копия сайта); уже исключённые в `deployment.xml` — перечисли. Выбранное идёт в «Не выкладывать» и в `--also` для `phpstorm-exclude.js`.
 4. Только режим «bitrix» и если в `watcherTasks.xml` есть включённые вотчеры: оставить / убрать (вотчеры срабатывают и на правки Claude — см. справку phpstorm.md).
 
 Адрес дева (при «дев + прод») — третьим вызовом.
@@ -68,17 +69,26 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/site-probe.js" <адрес прода>
 
 ## 4. Выполнение
 
-### 4.0 Автозаливка — до любой записи в проект
+### 4.0 Исключения PhpStorm — до любой записи в проект
 
-Только при автозаливке на любой сервер (в любом режиме): ответ на вопрос 4 первого вызова — «PhpStorm Always на прод» или «PhpStorm Always только на дев, прод вручную» — **или** `autoUpload="Always"` / `myAutoUpload` = `ALWAYS` в `.idea/deployment.xml` по разведке (расхождение ответа и настроек выяснено в разделе 2). Всё в этом пункте и пофайловая проверка в п. 4.5 — для **сервера автозаливки**, то есть того, куда заливает PhpStorm: Always на прод — прод; Always только на дев — дев (адрес — из третьего вызова вопросов; сверь с `url` сервера по умолчанию из разведки `.idea`). Адреса этого сервера нет (прода пока нет, адрес дева не назван) — спроси адрес сервера, куда заливает PhpStorm; п. 4.5 использует его же.
-1. Исключения PhpStorm по второму вызову, вопрос 3 (исключения; всегда `.idea` и `.git`) — инструкция из справки phpstorm.md. Когда пользователь ответит «готово», перечитай `.idea/deployment.xml` и сверь `excludedPath`; расхождения — стоп и вопрос. До этого в проект ничего не писать: `git init` создаст `.git/`, а Claude Code может в любой момент записать `.claude/settings.local.json` — при автозаливке всё это уедет на сервер.
-2. Сразу после — п. 4.2 (`.htaccess`), затем:
+Если есть `.idea/deployment.xml` — в любом режиме, **до любой записи в проект**: `git init` создаст `.git/`, а Claude Code может в любой момент записать `.claude/settings.local.json` — при автозаливке всё это уехало бы на сервер.
+1. Дописать исключения (в новом проекте раздела параметров ещё нет, а хук SessionStart вне kit-проекта молчит — поэтому руками и с `--also`):
    ```
-   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес сервера автозаливки>
+   node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --also <выбранное во втором вызове, вопрос 3, через запятую>
+   ```
+   Скрипт дописывает `.idea`, `.git`, `.claude` (и папку журнала, если она вне `.claude`) и пути из `--also` каждому серверу, сопоставленному с корнем проекта; только добавляет. Код 2 — `deployment.xml` не разобран: стоп, пользователь добавляет исключения руками (справка phpstorm.md), потом — дальше.
+2. Сверка — код 0 обязателен:
    ```
-   папки `docs/` и `.claude/` отвечают 403 (или 401 — сайт под паролем) — продолжай; 404 — PhpStorm ещё не залил, подожди и повтори; «ОТКРЫТ», «редирект», «нет ответа» — стоп и разбор (справка bitrix.md). 403 на папку ещё не доказывает, что `.htaccess` работает: без листинга папок сервер тоже отвечает 403. Проверка по файлам — в п. 4.5.
+   node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --check --also <то же>
+   ```
+   Код 1 — покажи пользователю, чего не хватает у какого сервера, и стоп. Строку «Если PhpStorm открыт и не подхватил — File → Reload All from Disk» из вывода п. 1 передай пользователю.
 
-После 2–3 повторов с 404 — спроси пользователя: открыт ли PhpStorm с этим проектом и включён ли «Upload external changes» (`autoUploadExternalChanges` в `deployment.xml`).
+Дальше — только при автозаливке на любой сервер (в любом режиме): ответ на вопрос 4 первого вызова — «PhpStorm Always на прод» или «PhpStorm Always только на дев, прод вручную» — **или** `autoUpload="Always"` / `myAutoUpload` = `ALWAYS` в `.idea/deployment.xml` по разведке (расхождение ответа и настроек выяснено в разделе 2). Проверка ниже и пофайловая в п. 4.5 — для **сервера автозаливки**, то есть того, куда заливает PhpStorm: Always на прод — прод; Always только на дев — дев (адрес — из третьего вызова вопросов; сверь с `url` сервера по умолчанию из разведки `.idea`). Адреса этого сервера нет (прода пока нет, адрес дева не назван) — спроси адрес сервера, куда заливает PhpStorm; п. 4.5 использует его же.
+3. П. 4.2 (`.htaccess`), затем:
+   ```
+   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес сервера автозаливки>
+   ```
+   Исключённые папки на сервер не уезжают: норма — 404 «нет на сервере» и 403/401 (старые копии, закрытые `.htaccess`; 401 — сайт под паролем). «ОТКРЫТ», «редирект», «нет ответа» — стоп и разбор (справка bitrix.md); открытые старые копии — в «Удалить с сервера» (DEPLOY на шаге 4.8).
 
 Потом — п. 4.1 и дальше.
 
@@ -91,21 +101,21 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/site-probe.js" <адрес прода>
    node "${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js" --all
    ```
    Код 1 — покажи находки (значения замаскированы) и спроси через AskUserQuestion: «исключить путь — дописать в `.gitignore`» / «стоп — пользователь уберёт секрет сам (например, перенесёт в `/bitrix/.settings_extra.php`)». Варианта «это не секрет» нет: git-keeper повторит скан по индексу и остановится на той же строке. Код 2 — стоп, отчёт. Первый коммит — только после кода 0.
-4. Первый коммит — через агента `kit:git-keeper`, как в `/kit:step-done` (п. 4): FILES — пути так, как их выводит `git -c core.quotepath=false status --porcelain` (без `?? ` и без кавычек), кроме `.claude/` и `docs/`; MESSAGE `0.1: Исходники с прода (копия прода)` (если исходники скачаны с дева — `0.1: Исходники с дева (копия прода)`), COAUTHOR и KIT_ROOT — как в `/kit:step-done`.
+4. Первый коммит — через агента `kit:git-keeper`, как в `/kit:step-done` (п. 4): FILES — пути так, как их выводит `git -c core.quotepath=false status --porcelain` (без `?? ` и без кавычек), кроме `.claude/` (и `docs/` при старой раскладке); MESSAGE `0.1: Исходники с прода (копия прода)` (если исходники скачаны с дева — `0.1: Исходники с дева (копия прода)`), COAUTHOR и KIT_ROOT — как в `/kit:step-done`.
    Проверка — как в `/kit:step-done`, п. 5: `git rev-list --count HEAD` = 1, заголовок `0.1:`, подпись дословно. git-keeper остановился или проверка не прошла — сообщи пользователю и остановись: сам не коммить, `git add` не выполняй, индекс не чини.
 
 Репозиторий уже есть — выполни из этого раздела только п. 2 (сверка `.gitignore`) и проверь `core.autocrlf`/`core.quotepath`: предложи `input` и `false`, если они другие.
 
 ### 4.2 Закрыть служебные папки
 
-`docs/.htaccess` и `.claude/.htaccess` из шаблона `htaccess-deny` (если файла нет).
+`.claude/.htaccess` из шаблона `htaccess-deny` (если нет) — страховка на случай ручной заливки папки целиком. Старая раскладка и переезд отложен (п. 4.7) — и `docs/.htaccess`.
 
 ### 4.3 Правила проекта `.claude/CLAUDE.md`
 
 - Файла нет — собери из шаблона `CLAUDE.md`: заполни все `{{…}}` ответами и разведкой, из вариантов `{{A | B}}` оставь нужный, лишнее убери. Собери файл во временной папке сессии, проверь, что `{{` не осталось, и запиши в проект одной записью (Write).
 - Файл есть, раздела «Параметры для агентов» нет — покажи заполненный раздел и допиши его в конец файла после согласия. Остальное в файле не трогай.
 - Раздел есть — сверь значения с ответами; расхождения покажи и правь только с согласия.
-- Проектные копии `.claude/agents/docs-keeper.md` / `git-keeper.md` — предложи удалить: агенты теперь приходят из плагина (`kit:docs-keeper`, `kit:git-keeper`), а проектные живут рядом под другим именем и путают. Если `.claude/agents/` уезжала на сервер — передай в `/kit:step-done` (п. 4.7) блок `DEPLOY: Удалить: .claude/agents/docs-keeper.md, .claude/agents/git-keeper.md — агенты теперь из плагина`.
+- Проектные копии `.claude/agents/docs-keeper.md` / `git-keeper.md` — предложи удалить: агенты теперь приходят из плагина (`kit:docs-keeper`, `kit:git-keeper`), а проектные живут рядом под другим именем и путают. Если `.claude/agents/` уезжала на сервер — передай в `/kit:step-done` (п. 4.8) блок `DEPLOY: Удалить: .claude/agents/docs-keeper.md, .claude/agents/git-keeper.md — агенты теперь из плагина`.
 - Параметр «Секреты» — подстроки, характерные для секретов этого проекта (ключи секции в `.settings_extra.php` и т. п.); нет таких — `—`. Вебхуки Б24, пароли и приватные ключи `secret-scan.js` ищет и без параметра.
 
 Параметр «PHP» — путь `C:\OSPanel\modules\PHP-X.Y\php.exe` по версии из `site-probe.js` или названной пользователем; PHP на сервере нет — `—`.
@@ -122,26 +132,25 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/site-probe.js" <адрес прода>
 
 ### 4.4 Журнал и план выкладки
 
-Из шаблонов `progress.md` и `deploy-prod.md`, если файлов нет, — собери каждый файл во временной папке сессии, проверь, что `{{` не осталось, и запиши в проект одной записью (Write):
+Из шаблонов `progress.md` и `deploy-prod.md`, если файлов нет, — в `.claude/docs/` (сначала `git check-ignore -q .claude/docs/progress.md` — должен быть код 1; код 0 — папку игнорирует `.gitignore`: сперва сверка `.gitignore` из п. 4.1). Собери каждый файл во временной папке сессии, проверь, что `{{` не осталось, и запиши в проект одной записью (Write):
 - «Решения» — ответы этого запуска, каждая строка с сегодняшней датой;
+- «Документы» — пустая таблица (документы появятся в `work/`);
 - «Этап 0 — подготовка»: `0.1 ✅` с хешем первого коммита (репозиторий уже был — строка про его первый коммит), `0.2 ⏳`;
-- «Общие правила» плана выкладки — по ответам: как файлы попадают на сервер, исключения, закрытие `docs/` и `.claude/`.
+- «Общие правила» плана выкладки — по ответам: как файлы попадают на сервер, исключения, `.claude/` исключена и закрыта `.htaccess`.
 
-Журнал уже есть — не трогай его: данные этого запуска уйдут в docs-keeper на шаге 4.7.
+Журнал уже есть — не трогай его: данные этого запуска уйдут в docs-keeper на шаге 4.8.
 
 ### 4.5 Проверки выкладки — любой режим, если известен адрес сервера (прод, дев или адрес из п. 4.0)
 
 Проверяй каждый известный адрес; заданы оба (прод и дев) — `check-closed.js` по обоим, по очереди.
-- Сервер автозаливки (п. 4.0) — ещё раз после п. 4.3–4.4, когда PhpStorm залил новые файлы:
-  ```
-  node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес сервера автозаливки>
-  ```
-  каждый файл, кроме исключённых из выкладки, — 403 (или 401 — сайт под паролем). 404 на новый файл — PhpStorm его ещё не залил: подожди и повтори, проверкой не считать; после 2–3 повторов — как в п. 4.0: спроси, открыт ли PhpStorm с этим проектом и включён ли «Upload external changes». «ОТКРЫТ», редирект, нет ответа — стоп и разбор.
-- Сервер с ручной выкладкой (при «вручную» — прод; при «дев + прод» с автозаливкой на дев — прод): исключения PhpStorm для него не нужны; после того как пользователь выложил туда `docs/` и `.claude/`:
-  ```
-  node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес>
-  ```
-  Код 0 — всё 403/401 (или 404 — ещё не выложено). Код 1 — есть другие ответы (ОТКРЫТ, редирект, нет ответа): стоп и разбор (справка bitrix.md).
+```
+node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес>
+```
+Скрипт обходит `.claude/` (и `docs/`, если она есть) и запрашивает каждый файл снаружи — в том числе исключённые из выкладки: на сервере могли остаться старые копии.
+- Сервер автозаливки (п. 4.0) — ещё раз после п. 4.3–4.4: новые файлы `.claude` на сервер не уехали — 404.
+- Сервер с ручной выкладкой (при «вручную» — прод; при «дев + прод» с автозаливкой на дев — прод): `.claude` в «Не выкладывать», `/kit:deploy-list` её не предлагает.
+
+Код 0 — всё 404/403/401. Код 1 — есть другие ответы (ОТКРЫТ, редирект, нет ответа): стоп и разбор (справка bitrix.md); открытые старые копии — в «Удалить с сервера».
 
 Итог проверки — в NOTES для `/kit:step-done` и в строку «проверка снаружи» в `.claude/CLAUDE.md` (дата и итог).
 
@@ -149,7 +158,26 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/site-probe.js" <адрес прода>
 
 File Watchers — по второму вызову, вопрос 4 (вотчеры): «убрать» — инструкция из справки phpstorm.md, затем сверка `watcherTasks.xml`.
 
-### 4.7 Закрыть шаг
+### 4.7 Переезд со старой раскладки — только если разведка нашла журнал в `docs/`
+
+Отдельной строкой в плане на согласие: «перенести `docs/` в `.claude/docs`». Отказ — старая раскладка работает дальше (`docs/.htaccess` — п. 4.2; хук исключений всё равно исключает `docs` из выкладки). Согласие — строго по порядку, каждый пункт после предыдущего:
+1. **Исключения.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --check` — код 0 (нет `deployment.xml` — тоже можно). Код 1 — сначала п. 4.0: иначе перенесённое уехало бы на сервер.
+2. **`.gitignore`.** `git check-ignore -q .claude/docs/progress.md`: код 0 (игнорируется) — покажи и с согласия допиши строки шаблона `!/.claude/docs/`, `!/.claude/docs/**`, затем `/.claude/docs/visual/` (после строк-исключений; строку `/docs/visual/`, если есть, замени ею) и проверь снова — нужен код 1. Без этого git-keeper не добавит новые пути (`git add` отказывает для игнорируемых), а старые пропали бы из индекса.
+3. **Старые копии на сервере.** Адрес сервера известен (автозаливка или ручная выкладка `docs/`) — **до** переноса:
+   ```
+   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес> --dirs docs
+   ```
+   Файлы с 403/401 лежат на сервере — в DEPLOY `Удалить` на шаге 4.8 (путь от корня сайта, «переехал в `.claude/docs`, на сервере не нужен»); удаляет `/kit:server` через `delete-list.php` (копия, сухой прогон, согласие) или пользователь. «ОТКРЫТ» — стоп и разбор, как в п. 4.0.
+4. **Таблица «файл → куда»** — покажи и согласуй (спорное — через AskUserQuestion): журнал и план выкладки — в корень `.claude/docs/`; остальное — в `work/` (текущее) или в `archive/` (этап, к которому документ относится, по журналу закрыт); папки (`design/`, `screenshots/`) — целиком; `docs/visual/` — в `.claude/docs/visual/`, только локально, мимо git (его `.gitignore` переезжает с ним); `docs/.htaccess` не переносится (папку закрывает `.claude/.htaccess`) — удалить, в FILES как удалённый.
+5. **Перенос** — обычным перемещением, без git:
+   ```
+   New-Item -ItemType Directory -Force '.claude/docs/work', '.claude/docs/archive' | Out-Null
+   Move-Item -LiteralPath 'docs/<имя>' -Destination '.claude/docs/<куда>/<имя>'
+   ```
+   Затем с согласия (правки показать): в `.claude/CLAUDE.md` — «Журнал: .claude/docs/progress.md», «План выкладки: .claude/docs/deploy-prod.md» и старые пути `docs/…` в тексте; в «Не выкладывать» `.claude/scripts`, `.claude/settings.local.json`, `.claude/worktrees`, `docs/visual`, `docs` заменяются одной записью `.claude` (прочее — как было). Пустую `docs/` удалить.
+6. **Закрытие** — вместе со всем запуском на шаге 4.8: DOCS — строки реестра по таблице п. 4 (`work/…` — «в работе, этап N» или «устарел — …», `archive/…` — «готово, этап N»); DEPLOY — `Удалить` из п. 3; FILES — старые и новые пути, `.gitignore`, `.claude/CLAUDE.md`. После коммита: `git -c core.quotepath=false show --stat -M HEAD` — переименования (`docs/… => .claude/docs/…`), а не удаление и добавление; `git check-ignore -q .claude/docs/progress.md` — код 1.
+
+### 4.8 Закрыть шаг
 
 `/kit:step-done`:
 - Журнал создан в этом запуске — STEP `0.2`, SUMMARY — что создано и проверено, NEXT — первый рабочий шаг (спроси пользователя; по умолчанию «0.3 — изучение задачи»); DECISIONS не передавай — они уже записаны в п. 4.4.
@@ -157,4 +185,4 @@ File Watchers — по второму вызову, вопрос 4 (вотчер
 
 ## 5. Итог пользователю
 
-Коротко: что создано, что дополнено, что пропущено; какие действия остались за пользователем (исключения PhpStorm, File Watchers, выкладка `docs/` и `.claude/` при ручной выкладке, удаление старых агентов с сервера, вход по SSH-ключу, если его нет (справка reference/ssh.md)).
+Коротко: что создано, что дополнено, что пропущено; какие действия остались за пользователем (File Watchers; если PhpStorm был открыт — убедиться, что новые строки видны в Excluded Paths, иначе File → Reload All from Disk; удаление старых копий `docs/` и агентов с сервера; вход по SSH-ключу, если его нет (справка reference/ssh.md)).
````

- [ ] **Шаг 6: visual:**

````diff
diff --git a/plugins/kit/skills/visual/SKILL.md b/plugins/kit/skills/visual/SKILL.md
index b5b9449..e309713 100644
--- a/plugins/kit/skills/visual/SKILL.md
+++ b/plugins/kit/skills/visual/SKILL.md
@@ -1,6 +1,6 @@
 ---
 name: visual
-description: Снимки публичной части сайта «до/после» и их сравнение — перед обновлением ядра, модулей или шаблона и после каждого шага, который может задеть вид страниц. Список страниц проекта, вход администратора (входит пользователь), эталон, контрольный прогон для замера шума, снимки «после», сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт. Снимки — только локально в docs/visual.
+description: Снимки публичной части сайта «до/после» и их сравнение — перед обновлением ядра, модулей или шаблона и после каждого шага, который может задеть вид страниц. Список страниц проекта, вход администратора (входит пользователь), эталон, контрольный прогон для замера шума, снимки «после», сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт. Снимки — только локально в .claude/docs/visual.
 argument-hint: "[discover | login | before | after <метка> | compare <до> <после>]"
 ---
 
@@ -11,7 +11,7 @@ argument-hint: "[discover | login | before | after <метка> | compare <до>
 | Что | Где |
 |---|---|
 | Список страниц проекта | `.claude/scripts/visual/pages.json` — в git; формат и рецепты — `${CLAUDE_PLUGIN_ROOT}/skills/visual/reference/pages.md` |
-| Снимки, сравнения, `links.json` | `docs/visual/…` — **только локально**: не коммитить и не выкладывать (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`) |
+| Снимки, сравнения, `links.json` | папка снимков `.claude/docs/visual/…` (в проекте, который ещё не переехал, — `docs/visual/…`; инструмент берёт папку журнала сам) — **только локально**: не коммитить и не выкладывать (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`) |
 | Зависимости (playwright-core, pixelmatch, pngjs) | `%LOCALAPPDATA%\kit\visual\deps` — одни на все проекты |
 | Сессия входа | `%LOCALAPPDATA%\kit\visual\auth\…` — вне проекта, своя на проект и хост |
 
@@ -21,10 +21,10 @@ argument-hint: "[discover | login | before | after <метка> | compare <до>
 
 - Пароли вводит только пользователь: `login` открывает окно Chrome, вход — его руками. Claude в это окно ничего не вводит.
 - Опасные адреса (выход, отмена и повтор заказа, `action=`, `sessid=`, удаление, `/bitrix/`) не снимать. `"unsafe": true` в `pages.json` — только с согласия пользователя на конкретный адрес (AskUserQuestion).
-- `docs/visual` не коммитить и не выкладывать; снимки и метки не удалять без согласия пользователя.
-- `.idea` не править: код 4 — пользователь сам добавляет исключение в PhpStorm.
+- Папку снимков не коммитить и не выкладывать; снимки и метки не удалять без согласия пользователя.
+- `.idea` не править: исключения PhpStorm дописывает только `phpstorm-exclude.js` (код 4 — п. 6).
 - Установка зависимостей — только после согласия пользователя (п. 1).
-- Долгие команды — `login`, полный `shoot`, `check` — запускай в фоне (Bash с `run_in_background`) и жди уведомления о завершении: окно входа ждёт до 15 минут, полный прогон — минуты, это дольше лимита одного вызова. Вывод `shoot` дублируется в `docs/visual/<метка>/shoot.log`.
+- Долгие команды — `login`, полный `shoot`, `check` — запускай в фоне (Bash с `run_in_background`) и жди уведомления о завершении: окно входа ждёт до 15 минут, полный прогон — минуты, это дольше лимита одного вызова. Вывод `shoot` дублируется в `<папка снимков>/<метка>/shoot.log`.
 - Git Bash переписывает аргументы, начинающиеся с `/` (`discover /catalog/` → `C:/Program Files/Git/catalog/`). Инструмент это исправляет, но надёжнее передавать адреса без ведущего `/`: `discover catalog/ personal/`.
 
 ## 1. Подготовка
@@ -47,7 +47,7 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" deps
    ```
    node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" discover / catalog/ personal/
    ```
-   `/` — главная; без аргументов — только главная. Вывод: затравки (статус, заголовок, USER_ID), группы похожих ссылок с числом и примером, опасные, файлы. Всё — в `docs/visual/links.json`.
+   `/` — главная; без аргументов — только главная. Вывод: затравки (статус, заголовок, USER_ID), группы похожих ссылок с числом и примером, опасные, файлы. Всё — в `<папка снимков>/links.json`.
 3. Составь список: по одной странице на группу (одна карточка товара, один раздел каталога, одна новость), главная, 404 (`/net-takoj-stranicy-visual/`), поиск с запросом. Контексты: `guest` — гость; `admin` (`"auth": true`) — страницы под входом. Для магазина — `setup`/`teardown` корзины, чтобы у админа корзина и оформление снимались с товарами (рецепт в справке). Опасные адреса не бери.
 4. Покажи список пользователю (контекст, имя, адрес) — AskUserQuestion «Снимаем эти страницы?» с вариантами «Да» / «Поправлю» (правки — через «Другое»). После «Да» запиши `.claude/scripts/visual/pages.json` (Write). Файл войдёт в коммит шага.
 
@@ -70,7 +70,7 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" deps
 node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" shoot before
 node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" check before
 ```
-Обе — в фоне, по очереди. `check` снимает `before-check` (заново, с адреса, с которого снята `before`) теми же настройками и сравнивает с `before`: что разошлось между двумя одинаковыми прогонами — шум (строки текста — с точностью до чисел, JS-ошибки, ответы), он пишется в `docs/visual/before/noise.json` и дальше не считается отличием. Скажи пользователю: сколько совпало на 0 %, какие страницы шумят и насколько, какие страницы не снялись. Строки «внимание … статус …» в выводе `check` — не шум: статус страницы скачет, разберись.
+Обе — в фоне, по очереди. `check` снимает `before-check` (заново, с адреса, с которого снята `before`) теми же настройками и сравнивает с `before`: что разошлось между двумя одинаковыми прогонами — шум (строки текста — с точностью до чисел, JS-ошибки, ответы), он пишется в `<папка снимков>/before/noise.json` и дальше не считается отличием. Скажи пользователю: сколько совпало на 0 %, какие страницы шумят и насколько, какие страницы не снялись. Строки «внимание … статус …» в выводе `check` — не шум: статус страницы скачет, разберись.
 
 Эталон уже есть — не переснимай без просьбы пользователя: метку (`before`, `main-25.200`) выбери вместе с ним.
 
@@ -87,9 +87,9 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" check before
    ```
 3. Разбор — в таком порядке:
    - **«Статусы и ошибки»** — смена статуса (200 → 500), редирект, USER_ID, новые JS-ошибки, новые ответы ≥ 400: это главное, разбери каждую строку;
-   - **«Отличается»** — открой дифф-картинку `docs/visual/compare-<до>-vs-<после>/<контекст>/<ширина>/<имя>.png` и оба снимка (`docs/visual/<метка>/…png`) через Read и посмотри сам, что изменилось; текст — пропавшие и появившиеся строки в выводе и в `summary.json` той же папки;
+   - **«Отличается»** — открой дифф-картинку `<папка снимков>/compare-<до>-vs-<после>/<контекст>/<ширина>/<имя>.png` и оба снимка (`<папка снимков>/<метка>/…png`) через Read и посмотри сам, что изменилось; текст — пропавшие и появившиеся строки в выводе и в `summary.json` той же папки;
    - «В пределах шума» и «не снимали» — только упомянуть.
-4. Доклад пользователю: что отличается и почему (ожидаемо или поломка), что в пределах шума, путь к отчёту `docs/visual/compare-<до>-vs-<после>/report.html` (открыть в браузере).
+4. Доклад пользователю: что отличается и почему (ожидаемо или поломка), что в пределах шума, путь к отчёту `<папка снимков>/compare-<до>-vs-<после>/report.html` (открыть в браузере).
 
 ## 6. Коды
 
@@ -99,10 +99,10 @@ node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" check before
 | 1 | `shoot`/`check` — страницы не снялись; `compare` — отличия сверх шума | разобрать: причина в выводе |
 | 2 | аргументы или `pages.json`: опасный адрес без `unsafe`, опечатка в ключе, нет страницы, нет адреса сайта, нет метки, метка снята с другого адреса (прод/дев) | исправить: для другого адреса — другая метка |
 | 3 | нет сессии, истекла, вход не обнаружен | п. 3 |
-| 4 | PhpStorm заливает каждое сохранение (Always), а `docs/visual` не исключён | сказать пользователю: Settings → Build, Execution, Deployment → Deployment → сервер → Excluded Paths → локальный путь `docs/visual` (справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md`); повторить после его «готово» |
+| 4 | PhpStorm заливает каждое сохранение (Always), а папка снимков не исключена ни сама, ни через `.claude` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js"` из корня проекта и повторить; снова 4 (файл не разобран) — сказать пользователю: Settings → Build, Execution, Deployment → Deployment → сервер → Excluded Paths → локальный путь `.claude` (справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md`); повторить после его «готово» |
 | 5 | нет зависимостей или Chrome | п. 1 |
 
-Предупреждение «в «Не выкладывать» нет docs/visual» — предложи пользователю дописать `docs/visual` в параметр «Не выкладывать» `.claude/CLAUDE.md` (через `/kit:step-done`, блок RULES).
+Предупреждение «в «Не выкладывать» нет <папка снимков>» — предложи пользователю дописать `.claude` (или саму папку снимков) в параметр «Не выкладывать» `.claude/CLAUDE.md` (через `/kit:step-done`, блок RULES).
 
 ## 7. Закрытие шага
 
````

````diff
diff --git a/plugins/kit/skills/visual/reference/pages.md b/plugins/kit/skills/visual/reference/pages.md
index c0a9c94..5e47531 100644
--- a/plugins/kit/skills/visual/reference/pages.md
+++ b/plugins/kit/skills/visual/reference/pages.md
@@ -50,7 +50,7 @@
 ## Ключи
 
 **Верхний уровень:**
-- `contexts` — обязательно: `{ имя: контекст }`. Имя — латиница, цифры, `.`, `_`, `-`; папка снимков — `docs/visual/<метка>/<контекст>/<ширина>/<имя страницы>.png`.
+- `contexts` — обязательно: `{ имя: контекст }`. Имя — латиница, цифры, `.`, `_`, `-`; папка снимков — `.claude/docs/visual/<метка>/<контекст>/<ширина>/<имя страницы>.png` (в непереехавшем проекте — `docs/visual/…`).
 - `login` — `{ "url": "/auth/", "check": "…" }`: страница входа и выражение JS, которое у вошедшего пользователя возвращает его ID (пусто или `0` — не вошёл). По умолчанию (режим `bitrix` и вне kit-проекта) — `window.BX && BX.message && BX.message('USER_ID')`. В общем режиме для контекста с `auth` — обязательно, например `document.querySelector('.user-menu [data-id]')?.dataset.id`.
 - `hide` — селекторы, которые скрыть на всех страницах (`display:none`): баннеры, чаты, cookie-плашки. Панель Битрикса, `.style-switcher` Аспро и jivo скрыты всегда.
 - `mask` — селекторы, которые закрасить (элемент остаётся на месте, размер страницы тот же): таймеры, счётчики, случайные блоки.
````

- [ ] **Шаг 7: тесты проходят.** `npm test` — 0 ✖.

- [ ] **Шаг 8: сдать контроллеру** — без коммита.

### Задача 11.9: README, версия 2.3.0, интеграционный проект; интеграция — контроллер

**Files:**
- Modify: `README.md`, `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `tests/integration/make-it-project.js`

**Interfaces:**
- Consumes: всё выше; `NO_BLOCK` из `tests/deployment-fixtures.js` (11.4).
- Produces: версия `2.3.0`; `node tests/integration/make-it-project.js <папка> [--old] [--deployment]`.

- [ ] **Шаг 1: README и манифесты:**

````diff
diff --git a/README.md b/README.md
index 5073e89..f7ca51a 100644
--- a/README.md
+++ b/README.md
@@ -39,18 +39,34 @@ claude plugin install kit@claude-kit
 
 | Что | Как вызвать | Зачем |
 |---|---|---|
-| `/kit:project-init` | командой | новый проект или дополнение существующего: git, `.gitignore`, скан секретов, `.claude/CLAUDE.md` с параметрами, журнал, план выкладки, `.htaccess`; Битрикс — версия PHP прода, 403 снаружи, PhpStorm |
-| `/kit:step-done` | Claude сам после проверенного шага или командой | журнал (docs-keeper) → один коммит (git-keeper) → проверка |
+| `/kit:project-init` | командой | новый проект или дополнение существующего: git, `.gitignore`, скан секретов, `.claude/CLAUDE.md` с параметрами, журнал и план выкладки в `.claude/docs`, исключения PhpStorm, `.htaccess`; переезд старой `docs/` в `.claude/docs`; Битрикс — версия PHP прода, проверка снаружи, PhpStorm |
+| `/kit:step-done` | Claude сам после проверенного шага или командой | журнал и реестр документов (docs-keeper) → при закрытии этапа — документы этапа в `archive/` (с вашего выбора) → один коммит (git-keeper) → проверка |
 | `/kit:deploy-list` | командой или Claude | что залить и что удалить на сервере с последней выкладки |
 | `/kit:server` | Claude при необходимости | работа на сервере: сначала SSH (команды оболочки, PHP через `remote-php.js`), иначе Командная PHP-строка в Chrome; чтение — сразу, изменения — с согласия |
 | `/kit:visual` | Claude перед изменением и после или командой | снимки публичной части «до/после» (гость и админ, 1920 и 390), контрольный прогон для замера шума, сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт `report.html` |
 | `kit:docs-keeper` (sonnet) | из `/kit:step-done` | журнал, план выкладки, правила проекта |
 | `kit:git-keeper` (haiku) | из `/kit:step-done` | один коммит, проверка путей и секретов, подпись дословно |
-| хук SessionStart | сам | раздел «Сейчас» и правила процесса в контекст — при старте, после `/clear` и после сжатия |
+| хук SessionStart | сам | раздел «Сейчас» и правила процесса в контекст — при старте, после `/clear` и после сжатия; исключения PhpStorm (`.idea`, `.git`, `.claude`, «Не выкладывать») дописывает в `.idea/deployment.xml` сам (`phpstorm-exclude.js`) |
 | хук PostToolUse | сам | `php -l` версией PHP проекта после каждой правки `.php` |
 | хук PreToolUse | сам | запрет `cd` вне подоболочки и `sed -i` по PHP |
 
-Хуки работают только в kit-проектах — там, где есть раздел «Параметры для агентов» в `.claude/CLAUDE.md` или журнал `docs/progress.md`. В остальных папках плагин молчит.
+Хуки работают только в kit-проектах — там, где есть раздел «Параметры для агентов» в `.claude/CLAUDE.md` или журнал (`.claude/docs/progress.md`, до переезда — `docs/progress.md`). В остальных папках плагин молчит.
+
+## Документы проекта (с 2.3.0)
+
+```
+.claude/docs/
+  progress.md      журнал (+ раздел «Документы» — реестр: файл, о чём, статус)
+  deploy-prod.md   план выкладки
+  work/            текущие планы, спеки, чек-листы, материалы задач
+  archive/         готовое и устаревшее — туда их переносит /kit:step-done при закрытии этапа
+  visual/          снимки /kit:visual — только локально
+```
+
+- `.claude` исключается из выкладки целиком: исключения PhpStorm (Excluded Paths) хук дописывает сам при каждом старте сессии — руками в настройки ходить не нужно; для ручной выкладки `.claude` стоит в «Не выкладывать». Так на сервер не уезжают ни журнал, ни планы, ни скриншоты (nginx отдаёт статику мимо `.htaccess`).
+- `.claude` — защищённая папка Claude Code: в режимах Manual и acceptEdits запись туда просит подтверждения (в вопросе есть «разрешить правки в `.claude` на эту сессию»); в auto решает классификатор, в bypassPermissions — без вопросов. Правило allow в settings.json это не снимает.
+- Если PhpStorm открыт и новую строку в Excluded Paths не показал — File → Reload All from Disk.
+- Проекты со старой `docs/` работают как раньше; переезд — `/kit:project-init` (правит `.gitignore`, переносит файлы по вашей таблице «файл → куда», меняет параметры, записывает старые копии `docs/` на сервере в «Удалить с сервера» — одним шагом и коммитом).
 
 ## Параметры проекта
 
@@ -69,10 +85,10 @@ claude plugin install kit@claude-kit
 - SSH дев: —
 - PHP на сервере: /opt/php74/bin/php
 - PHP: C:\OSPanel\modules\PHP-7.4\php.exe
-- Журнал: docs/progress.md
-- План выкладки: docs/deploy-prod.md
+- Журнал: .claude/docs/progress.md
+- План выкладки: .claude/docs/deploy-prod.md
 - ID шага: N.M (например 0.3, 2.1)
-- Не выкладывать: .idea, .git, .claude/scripts, .claude/settings.local.json, .claude/worktrees
+- Не выкладывать: .idea, .git, .claude
 - Не коммитить: bitrix/, upload/ (кроме upload/docs/), *.back*
 - Секреты: —
 ```
@@ -82,16 +98,16 @@ claude plugin install kit@claude-kit
 - **SSH прод / SSH дев** — `хост:папка сайта`: псевдоним из `~/.ssh/config` (или `user@host`) и абсолютный путь к корню сайта на сервере; `—` — SSH нет: в режиме bitrix при заданном адресе `/kit:server` работает через Командную PHP-строку; в общем режиме выполнить на сервере негде. Порт — только через `~/.ssh/config`. Вход — только по ключу без пароля; настройка — `plugins/kit/skills/project-init/reference/ssh.md`.
 - **PHP на сервере** — полный путь к PHP CLI нужной версии: команда `php` на хостинге бывает старой (на ispmanager — 5.4).
 - **Пути** в «Не выкладывать» и «Не коммитить»: со `/` в любом месте — от корня проекта (`bitrix/` — только корневая папка, копии шаблонов в `local/templates/…/components/bitrix/` коммитятся), без `/` — имя в любом месте пути (`.idea`, `*.back*`).
-- **`.claude/worktrees`** — git worktree, которые Claude Code (десктоп) создаёт внутри проекта; при автозаливке PhpStorm их нужно исключить из выкладки, иначе на сервер уедет копия сайта.
+- **`.claude/worktrees`** — git worktree, которые Claude Code (десктоп) создаёт внутри проекта (полная копия сайта); исключение `.claude` закрывает и их.
 
-Полное описание ключей — `docs/spec-claude-kit.md`, раздел 5.
+Полное описание ключей — спек `spec-claude-kit.md` (в репозитории — `.claude/docs/work/`), раздел 5.
 
 ## Снимки «до/после» (`/kit:visual`, с 2.2.0)
 
 - Нужен установленный Google Chrome (браузеры Playwright не скачиваются) и один раз на машину — зависимости: Claude спросит и выполнит `node visual.js install` — `npm install` playwright-core, pixelmatch, pngjs (~15 МБ) в `%LOCALAPPDATA%\kit\visual\deps`. Обновления плагина их не трогают.
-- Список страниц проекта — `.claude/scripts/visual/pages.json` (в git); снимки — `docs/visual/`, **только локально**: инструмент сам кладёт туда `.gitignore` и не снимает, если PhpStorm с автозаливкой Always не исключает `docs/visual` (снимки из-под админа, nginx отдаёт картинки мимо `.htaccess`).
+- Список страниц проекта — `.claude/scripts/visual/pages.json` (в git); снимки — `.claude/docs/visual/` (до переезда — `docs/visual/`), **только локально**: инструмент сам кладёт туда `.gitignore` и не снимает, если PhpStorm с автозаливкой Always не исключает папку снимков (снимки из-под админа, nginx отдаёт картинки мимо `.htaccess`); с 2.3.0 исключение дописывает хук.
 - Вход администратора — окно Chrome, входите вы сами; сессия хранится в `%LOCALAPPDATA%\kit\visual\auth`, своя на каждый проект.
-- В проектах, созданных до 2.2.0: дописать `docs/visual` в «Не выкладывать» и в исключения PhpStorm (или `/kit:project-init` предложит это сам).
+- В проектах, созданных до 2.2.0: исключения PhpStorm с 2.3.0 дописывает хук; в «Не выкладывать» — `.claude` (или `docs/visual` до переезда).
 
 ## Переход с 1.x на 2.0
 
@@ -110,5 +126,5 @@ claude plugin install kit@claude-kit
 - Тесты: `npm ci` один раз (devDependencies `pngjs` и `pixelmatch` — для тестов сравнения снимков), затем `npm test` (`node --test tests/*.test.js`); PHP-тесты используют `C:\OSPanel\modules\PHP-7.2`, `PHP-7.4`, `PHP-8.3` и пропускаются, если их нет.
 - Проверка манифестов: `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict`.
 - Запуск без установки: `claude --plugin-dir C:\OSPanel\home\claude-kit\plugins\kit`.
-- Журнал разработки — `docs/progress.md`, спек — `docs/spec-claude-kit.md`, планы — `docs/plan-claude-kit.md` (этапы 0–6) `docs/plan-ssh.md` (этап 8) и `docs/plan-visual.md` (этап 10).
+- Журнал разработки — `.claude/docs/progress.md`, спек — `.claude/docs/work/spec-claude-kit.md`, план этапа 11 — `.claude/docs/work/plan-docs.md`, планы завершённых этапов — `.claude/docs/archive/` (реестр — раздел «Документы» журнала).
 - Снимки вживую (Chrome и сайт) тестами не проверяются: `node plugins/kit/scripts/visual.js …` из корня проекта; `KIT_VISUAL_HOME` — другая папка на машине вместо `%LOCALAPPDATA%\kit\visual`, `KIT_VISUAL_DEPS` — папка с `node_modules` (так тесты берут зависимости из корня репозитория).
````

````diff
diff --git a/plugins/kit/.claude-plugin/plugin.json b/plugins/kit/.claude-plugin/plugin.json
index 6c8810d..d62695d 100644
--- a/plugins/kit/.claude-plugin/plugin.json
+++ b/plugins/kit/.claude-plugin/plugin.json
@@ -1,7 +1,7 @@
 {
   "name": "kit",
-  "version": "2.2.0",
-  "description": "Каркас работы над проектами: журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку; снимки публичной части «до/после» и их сравнение.",
+  "version": "2.3.0",
+  "description": "Каркас работы над проектами: документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку; снимки публичной части «до/после» и их сравнение.",
   "author": { "name": "Mikle Seregin" },
   "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh", "screenshots"]
 }
````

````diff
diff --git a/.claude-plugin/marketplace.json b/.claude-plugin/marketplace.json
index 7b5e153..38463be 100644
--- a/.claude-plugin/marketplace.json
+++ b/.claude-plugin/marketplace.json
@@ -8,8 +8,8 @@
     {
       "name": "kit",
       "source": "./plugins/kit",
-      "description": "Журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, снимки «до/после» и сравнение, хуки правил и php -l.",
-      "version": "2.2.0",
+      "description": "Документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, снимки «до/после» и сравнение, хуки правил и php -l.",
+      "version": "2.3.0",
       "author": { "name": "Mikle Seregin" }
     }
   ]
````

- [ ] **Шаг 2: интеграционный проект** — `tests/integration/make-it-project.js` целиком:

````js
'use strict';
// Готовит временный kit-проект для проверки плагина через claude --plugin-dir.
// Запуск: node tests/integration/make-it-project.js <новая папка> [--old] [--deployment]
//   --old         старая раскладка: журнал и план выкладки в docs/ (без реестра и work/)
//   --deployment  .idea/deployment.xml без исключений (сервер ftp, автозаливка) — для хука phpstorm-exclude.js
const fs = require('fs');
const path = require('path');
const { git, writeFiles } = require('../helpers');
const { paramsMd, progressMd } = require('../fixtures');
const { NO_BLOCK } = require('../deployment-fixtures');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target || fs.existsSync(target)) {
  console.error('Нужна новая папка: node tests/integration/make-it-project.js <папка> [--old] [--deployment]');
  process.exit(1);
}
const old = args.includes('--old');
const docs = old ? 'docs' : '.claude/docs';
const dir = path.resolve(target);
const now = ['- **Этап:** 0 — подготовка', '- **Следующий шаг:** 0.2 — проверка плагина', '- **Блокеры и открытые вопросы:** —'].join('\n');
const registry = old ? [] : [
  '', '## Документы', '',
  '| Файл | О чём | Статус |', '|---|---|---|',
  '| work/plan-0.md | план подготовки | в работе, этап 0 |',
];
const files = {
  '.claude/CLAUDE.md': paramsMd({
    'Режим': 'bitrix',
    'Код пишет': 'Claude',
    'Окружение': 'прод',
    'Выкладка': 'вручную',
    'Прод': 'https://example.invalid',
    'PHP': 'C:\\OSPanel\\modules\\PHP-7.4\\php.exe',
    'Журнал': docs + '/progress.md',
    'План выкладки': docs + '/deploy-prod.md',
    'Не выкладывать': '.idea, .git, .claude',
  }, '# kit-it — правила работы'),
  [docs + '/progress.md']: progressMd(now) + [
    ...registry,
    '', '## Этап 0 — подготовка', '',
    '| Шаг | Статус | Что сделано | Коммит |', '|---|---|---|---|',
    '| 0.1 | ✅ | исходники | |', '| 0.2 | ⏳ | проверка плагина | |', '',
  ].join('\n'),
  [docs + '/deploy-prod.md']: [
    '# Выкладка на прод — kit-it', '', '## Общие правила', '', '- тест', '',
    '## Залито на прод', '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|', '',
    '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', '',
  ].join('\n'),
  'index.php': '<?php\necho "ok";\n',
  '.gitignore': '/.idea/\n',
};
if (!old) files[docs + '/work/plan-0.md'] = '# План подготовки\n\n- проверить плагин\n';
if (args.includes('--deployment')) files['.idea/deployment.xml'] = NO_BLOCK;
writeFiles(dir, files);
git(dir, 'init', '-q');
git(dir, 'config', 'core.autocrlf', 'input');
git(dir, 'add', '-A');
git(dir, 'commit', '-q', '-m', '0.1: исходники');
console.log(dir);
````

- [ ] **Шаг 3: проверки исполнителя.** `npm test` — 280 тестов, 277 ✔, 3 пропущены; `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict` — без ошибок и предупреждений; `node tests/integration/make-it-project.js <временная папка> --deployment` и `… <другая временная папка> --old` — создаются, `git ls-files` — `.claude/docs/…` (новая) и `docs/…` (старая).

- [ ] **Шаг 4: сдать контроллеру** — без коммита.

- [ ] **Шаг 5 (контроллер): интеграция в живой сессии.** Во временной папке вне репозитория (`%TEMP%`), из PowerShell (Git Bash переписывает `/kit:…`):
  1. `node tests/integration/make-it-project.js <папка A> --deployment`; из папки A — `claude -p --plugin-dir <рабочая копия>\plugins\kit --permission-mode bypassPermissions "Какие строки [kit] ты видишь в начале сессии? Процитируй дословно."` — есть `[kit] Исключения PhpStorm: добавлено «ftp» — .idea, .git, .claude…` и `[kit] Проект ведётся по журналу .claude/docs/progress.md.`, в `.idea/deployment.xml` — три строки `excludedPath`; второй запуск — строки про исключения нет.
  2. Из папки A: `claude -p --plugin-dir … --permission-mode bypassPermissions "/kit:step-done 0.2 — STATUS ✅, SUMMARY: проверка плагина, NEXT: 1.1 — первый шаг, STAGE: 1 — работа. Если спросишь про архив — ответ: «Все в archive/»."` — ровно один новый коммит `0.2: …`; `git -C <папка A> show --stat -M HEAD` — `.claude/docs/{work => archive}/plan-0.md` и журнал; в журнале у `archive/plan-0.md` статус «готово, этап 0 (…)». `bypassPermissions` — только во временной папке: запись в `.claude` иначе упрётся в подтверждения (`-p` их не показывает).
  3. `node tests/integration/make-it-project.js <папка B> --old`; сессия из папки B — журнал `docs/progress.md`, строка «Документы проекта — в docs/: … Переезд в .claude/docs — через /kit:project-init.».
  Итог — в SUMMARY/NOTES шага 11.9. **Остановка части B.**

---

## Часть C — живые проверки (контроллер с пользователем)

### Задача 11.10: хук на проекте пользователя с открытым PhpStorm

Цель — убедиться, что PhpStorm подхватывает правку `.idea/deployment.xml` снаружи и не затирает её своими настройками (риск из спека §11); строки `[kit]` хука — из 11.9.

- [ ] **Шаг 1.** AskUserQuestion: на каком проекте (варианты — kit-проекты с автозаливкой, где `.claude` ещё не исключена целиком, например alpha или beta; «Другое»); PhpStorm с этим проектом должен быть открыт. Показать, что будет дописано: `node "<рабочая копия>\plugins\kit\scripts\phpstorm-exclude.js" --check` из корня проекта — только чтение.
- [ ] **Шаг 2.** С согласия пользователя (AskUserQuestion с точной командой): `node "<рабочая копия>\plugins\kit\scripts\phpstorm-exclude.js"` из корня проекта. Перед запуском — копия `.idea/deployment.xml` в папку сессии (для возврата).
- [ ] **Шаг 3.** Пользователь открывает Settings → Build, Execution, Deployment → Deployment → сервер → Excluded Paths: новые строки видны? Нет — File → Reload All from Disk и снова. Затем пользователь меняет в Deployment любую безвредную настройку туда и обратно и жмёт Apply/OK → `node … --check` — код 0 (строки не затёрты).
- [ ] **Шаг 4.** Итог — в NOTES 11.10 (что видно, понадобился ли Reload); если PhpStorm затирает строки — стоп, баг в журнал, решение с пользователем (например, хук пишет только при закрытом PhpStorm или подсказывает Reload).

### Задача 11.11: пилот переезда — claude-kit

- [ ] **Шаг 1.** Контроллер выполняет в рабочей копии этапа 11 п. 4.7 новой `project-init/SKILL.md` по тексту (без запуска команды — это репозиторий плагина, не сайт): `.gitignore` репозитория (`/.claude/worktrees/`, `/.claude/settings.local.json`) `.claude/docs` не игнорирует — проверить `git check-ignore`; `deployment.xml` у репозитория нет — п. 1 и 3 пропускаются.
- [ ] **Шаг 2.** Таблица «файл → куда» на согласие (AskUserQuestion): `progress.md` → `.claude/docs/`; `spec-claude-kit.md` → `.claude/docs/work/`; `plan-docs.md` → `.claude/docs/work/`; `plan-claude-kit.md`, `plan-ssh.md`, `plan-visual.md` → `.claude/docs/archive/`; `MyObservations.md` (файл пользователя) — куда скажет пользователь (рекомендация — `work/`: п. 1 про консоль — следующий этап).
- [ ] **Шаг 3.** Перенос (`Move-Item`), `.claude/CLAUDE.md` репозитория: «Журнал: .claude/docs/progress.md», строки про `docs/progress.md`, спек, план; ссылки на `docs/…` в README уже новые (11.10); в самом журнале и спеке старые пути в истории не переписывать — только шапку спека (`docs/` → `.claude/docs/`) и раздел «Справочник» журнала, если там пути для работы.
- [ ] **Шаг 4.** `/kit:step-done 11.11` (docs-keeper — установленной версии 2.2.0: параметр «Журнал» он читает и путь найдёт, а блока DOCS не знает — в запросе ему описать словами: завести раздел «Документы» после «Решений» с таблицей `| Файл | О чём | Статус |` и строками по таблице шага 2): DOCS — реестр по таблице шага 2; FILES — старые и новые пути, `.claude/CLAUDE.md`. Проверка: `git show --stat -M HEAD` — переименования; SessionStart новой сессии (или `node plugins/kit/scripts/session-start.js` с `CLAUDE_PROJECT_DIR`) — журнал `.claude/docs/progress.md`. **Остановка части C.**

---

## Часть D — выпуск

### Задача 11.12: финальное ревью, слияние, обновление установленного плагина

- [ ] **Шаг 1.** Финальное ревью ветки этапа 11 (opus) против спека; находки — исправления отдельными коммитами `11.12а`, `11.12б`; повторное ревью.
- [ ] **Шаг 2.** Слияние в `master` основного checkout `C:\OSPanel\home\claude-kit` (перемоткой, если `master` не ушёл вперёд); `claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit` — «updated from 2.2.0 to 2.3.0»; в кэше `~/.claude/plugins/cache/claude-kit/kit/2.3.0` есть `scripts/phpstorm-exclude.js`, `scripts/lib/deployment.js`. Сессии перезапустить.
- [ ] **Шаг 3.** Push `master` на GitHub — только с согласия пользователя (AskUserQuestion).
- [ ] **Шаг 4.** Пользователю — что изменится в его проектах после перезапуска сессий: хук допишет `.claude` (и `docs` у непереехавших) в Excluded Paths; переезд проектов — по одному через `/kit:project-init`, когда скажет.
