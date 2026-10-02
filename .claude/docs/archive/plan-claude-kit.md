# План реализации: плагин `kit` (маркетплейс `claude-kit`)

> **Для исполнителя:** обязательный навык — superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans; задачи выполняются по порядку, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** плагин Claude Code `kit`, который убирает рутину при старте и ведении проектов пользователя: агенты журнала и git, закрытие шага, инициализация проекта (общий режим и 1С-Битрикс), Командная PHP-строка, хуки правил процесса, `php -l` и защиты от граблей.

**Архитектура:** репозиторий — маркетплейс `claude-kit`, плагин лежит в `plugins/kit/` и грузится на месте. Проектная специфика живёт в разделе «Параметры для агентов» файла `.claude/CLAUDE.md` проекта; её читают агенты (markdown-инструкции), хуки и инструменты (node без зависимостей, общий разбор в `scripts/lib/`). Всё, что можно проверить кодом, сделано скриптами с тестами `node --test`; агенты и скиллы — markdown с проверкой структуры и интеграционной прогонкой через `claude --plugin-dir -p`.

**Стек:** Node.js ≥ 18 (установлен v24.15.0), `node:test`, git 2.48 (Windows), PHP из `C:\OSPanel\modules\PHP-X.Y\php.exe`, Claude Code 2.1.278.

**Спек:** `docs/spec-claude-kit.md` — читать вместе с планом.

## Общие ограничения

- Имя плагина `kit`, маркетплейса `claude-kit`; команды `/kit:<скилл>`, агенты `kit:<агент>`. Версия `0.1.0` до выпуска, `1.0.0` на задаче 6.1; версия в `plugin.json` и `marketplace.json` одинаковая.
- Node.js ≥ 18, никаких npm-зависимостей. Скрипты — CommonJS, `'use strict'`.
- Windows 11: пути с `\` и `/`, PowerShell 5.1 и Git Bash. Хуки запускаются в exec-форме `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/…"]`.
- Файлы — UTF-8 без BOM, переводы строк LF. Тексты для пользователя, комментарии и сообщения — по-русски.
- Хуки: вне kit-проекта (нет ни раздела «Параметры для агентов» в `.claude/CLAUDE.md`, ни файла журнала) — ничего не выводят и ничего не блокируют; любая внутренняя ошибка — выход 0 без вывода.
- Агенты: `docs-keeper` — `model: sonnet`, `git-keeper` — `model: haiku`.
- PHP для тестов: `C:\OSPanel\modules\PHP-7.4\php.exe` (основной), `PHP-7.2` и `PHP-8.3` (совместимость). Нет бинарника — тест пропускается (`t.skip`), а не падает.
- Git: одна задача = один шаг = один коммит `<ID>: <суть>` с подписью `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; в тот же коммит — обновлённый `docs/progress.md` (строка шага ✅, следующая ⏳, раздел «Сейчас», хеш прошлого шага). Запрещены `push`, `reset`, `checkout`, `stash`, `amend`, `rebase`, `git add .`.
- Bash: без `cd` в основной оболочке — абсолютные пути или `( cd … )`; PHP не править `sed`.
- Тесты запускаются из корня worktree: `node --test tests/*.test.js` (Node сам раскрывает шаблон).

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `.claude-plugin/marketplace.json` | маркетплейс `claude-kit`, запись плагина `kit` | 1.1 |
| `plugins/kit/.claude-plugin/plugin.json` | манифест плагина | 1.1 |
| `package.json` | `npm test` → `node --test tests/*.test.js` | 1.1 |
| `tests/helpers.js` | временные папки, запуск скриптов, git, PHP | 1.1 |
| `tests/fixtures.js` | тексты `CLAUDE.md` и журнала для тестов | 1.1 |
| `tests/manifest.test.js` | согласованность манифестов | 1.1 |
| `plugins/kit/scripts/lib/params.js` | разбор «Параметров для агентов» | 1.2 |
| `plugins/kit/scripts/lib/md.js` | разделы и таблицы markdown | 1.2 |
| `plugins/kit/scripts/lib/paths.js` | правила путей «Не коммитить» / «Не выкладывать» | 1.2 |
| `plugins/kit/scripts/lib/project.js` | stdin хука, папка проекта, признак kit-проекта | 1.2 |
| `tests/lib.test.js` | тесты библиотеки | 1.2 |
| `plugins/kit/hooks/hooks.json` | регистрация хуков | 2.1–2.3 |
| `plugins/kit/scripts/session-start.js` + `tests/session-start.test.js` | «Сейчас» и правила в контекст | 2.1 |
| `plugins/kit/scripts/php-lint.js` + `tests/php-lint.test.js` | `php -l` после записи | 2.2 |
| `plugins/kit/scripts/guard-bash.js` + `tests/guard-bash.test.js` | запрет `cd` и `sed -i` по PHP | 2.3 |
| `plugins/kit/scripts/secret-scan.js` + `tests/secret-scan.test.js` | секреты и запрещённые пути | 3.1 |
| `plugins/kit/scripts/deploy-list.js` + `tests/deploy-list.test.js` | что залить / удалить | 3.2 |
| `plugins/kit/scripts/site-probe.js`, `check-closed.js` + `tests/net.test.js` | версия PHP прода; 403 снаружи | 3.3 |
| `plugins/kit/scripts/md5-check.js`, `plugins/kit/skills/bitrix-console/scripts/*.php` + `tests/console-scripts.test.js` | скрипты Командной PHP-строки | 3.4 |
| `plugins/kit/agents/docs-keeper.md`, `git-keeper.md` + `tests/content.test.js` | агенты | 4.1 |
| `plugins/kit/skills/step-done/SKILL.md`, `skills/deploy-list/SKILL.md` | закрытие шага, список выкладки | 5.1 |
| `plugins/kit/skills/project-init/**` + `tests/templates.test.js` | инициализация проекта, шаблоны, справки | 5.2 |
| `plugins/kit/skills/bitrix-console/SKILL.md` | работа с Командной PHP-строкой | 5.3 |
| `README.md` | установка, обновление, команды, миграция | 6.1 |
| `docs/progress.md` | журнал репозитория | каждая задача |

## Этапы и шаги журнала

| Этап | Шаги |
|---|---|
| 1 — каркас и библиотека | 1.1, 1.2 |
| 2 — хуки | 2.1, 2.2, 2.3 |
| 3 — инструменты | 3.1, 3.2, 3.3, 3.4 |
| 4 — агенты | 4.1 |
| 5 — скиллы | 5.1, 5.2, 5.3 |
| 6 — проверка и выпуск | 6.1, 6.2, 6.3 |
| 7 — миграция gamma и alpha | решается с пользователем после 6.3 |

---

## Этап 1 — каркас и библиотека

### Задача 1.1: маркетплейс, манифест плагина, тестовая обвязка

**Файлы:**
- Создать: `.claude-plugin/marketplace.json`, `plugins/kit/.claude-plugin/plugin.json`, `package.json`, `tests/helpers.js`, `tests/fixtures.js`, `tests/manifest.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Даёт (для всех следующих тестов): `tests/helpers.js` — `ROOT`, `PLUGIN`, `SCRIPTS`, `php(version) → путь`, `hasPhp(version) → bool`, `tmpDir(prefix?)`, `writeFiles(root, {rel: content})`, `makeProject({rel: content}) → dir`, `runScript(name, {args, input, cwd, env}) → {code, stdout, stderr}` (синхронно; `CLAUDE_PROJECT_DIR` по умолчанию пустой), `runScriptAsync(name, {args, cwd, env}) → Promise<{code, stdout, stderr}>`, `git(cwd, ...args) → stdout`, `gitRepo({rel: content}) → dir` (init + первый коммит), `runPhp(version, code) → {code, stdout, stderr}`, `phpLint(version, code) → {code, out}`.
- Даёт: `tests/fixtures.js` — `paramsMd(values, title?) → текст CLAUDE.md`, `ALPHA`, `GAMMA` (объекты параметров), `ALPHA_CLAUDE_MD`, `GAMMA_CLAUDE_MD`, `progressMd(nowText?) → текст журнала`.

- [ ] **Шаг 1: написать падающий тест**

`tests/manifest.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('marketplace.json и plugin.json согласованы', () => {
  const mp = readJson('.claude-plugin/marketplace.json');
  const pl = readJson('plugins/kit/.claude-plugin/plugin.json');
  assert.equal(mp.name, 'claude-kit');
  assert.equal(mp.plugins.length, 1);
  assert.equal(mp.plugins[0].name, 'kit');
  assert.equal(mp.plugins[0].source, './plugins/kit');
  assert.equal(pl.name, 'kit');
  assert.match(pl.version, /^\d+\.\d+\.\d+$/);
  assert.equal(mp.plugins[0].version, pl.version);
});
```

`tests/helpers.js`:

```js
'use strict';
// Общая обвязка тестов: временные проекты, запуск скриптов плагина, git, PHP.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'kit');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const PHP_DIR = 'C:\\OSPanel\\modules';

const php = (version) => path.join(PHP_DIR, 'PHP-' + version, 'php.exe');
const hasPhp = (version) => fs.existsSync(php(version));

function tmpDir(prefix = 'kit-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}

function makeProject(files = {}) {
  return writeFiles(tmpDir(), files);
}

function scriptEnv(env) {
  return { ...process.env, CLAUDE_PROJECT_DIR: '', ...env };
}

function runScript(name, { args = [], input, cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], {
    cwd: cwd || ROOT,
    input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: scriptEnv(env),
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runScriptAsync(name, { args = [], cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, name), ...args], { cwd: cwd || ROOT, env: scriptEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

function git(cwd, ...args) {
  const r = spawnSync('git', [
    '-c', 'user.name=kit', '-c', 'user.email=kit@test.local',
    '-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', ...args,
  ], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}

function gitRepo(files = {}) {
  const dir = makeProject(files);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '0.1: исходники');
  return dir;
}

function runPhp(version, code) {
  const file = path.join(tmpDir('kit-php-'), 'run.php');
  fs.writeFileSync(file, code);
  const r = spawnSync(php(version), ['-d', 'display_errors=stderr', file], { encoding: 'utf8', timeout: 60000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function phpLint(version, code) {
  const r = spawnSync(php(version), ['-l'], { input: code, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

module.exports = {
  ROOT, PLUGIN, SCRIPTS, php, hasPhp, tmpDir, writeFiles, makeProject,
  runScript, runScriptAsync, git, gitRepo, runPhp, phpLint,
};
```

`tests/fixtures.js`:

```js
'use strict';
// Тексты проектных файлов для тестов.

function paramsMd(values, title = '# Тестовый проект — правила работы') {
  const lines = Object.entries(values).map(([k, v]) => `- ${k}: ${v}`);
  return [
    title, '', '## Проект', '', '- Тест.', '',
    '## Параметры для агентов', '',
    'Читают агенты, хуки и скиллы плагина kit. Формат строк не менять: `- Ключ: значение`, списки через запятую.', '',
    ...lines, '',
  ].join('\n');
}

const ALPHA = {
  'Режим': 'bitrix',
  'Код пишет': 'Claude',
  'Окружение': 'прод',
  'Выкладка': 'PhpStorm Always',
  'Прод': 'https://alpha.example.com',
  'Дев': '—',
  'PHP': '`C:\\OSPanel\\modules\\PHP-7.4\\php.exe`',
  'Журнал': 'docs/progress.md',
  'План выкладки': 'docs/deploy-prod.md',
  'ID шага': 'N.M (например 0.3, 2.1)',
  'Не выкладывать': '.idea, .git, .claude/scripts, .claude/settings.local.json',
  'Не коммитить': 'bitrix/, upload/ (кроме upload/docs/), *.back*',
  'Секреты': 'bitrix24.ru/rest/, apikey=, "API_KEY" =>',
};

const GAMMA = {
  'Режим': 'bitrix',
  'Код пишет': 'пользователь',
  'Окружение': 'дев+прод',
  'Выкладка': 'вручную',
  'Прод': 'https://gamma.example.com',
  'Дев': 'http://user200.hosting.example',
  'PHP': 'C:\\OSPanel\\modules\\PHP-8.2\\php.exe',
  'Не выкладывать': '.idea, .claude, .git, .gitignore, local/modules',
};

const ALPHA_CLAUDE_MD = paramsMd(ALPHA, '# alpha.example.com — правила работы');
const GAMMA_CLAUDE_MD = paramsMd(GAMMA, '# gamma.example.com — правила работы');

const DEFAULT_NOW = [
  '- **Этап:** 1 — изучение',
  '- **Следующий шаг:** 1.2 — инвентаризация на проде',
  '- **Блокеры и открытые вопросы:** —',
].join('\n');

function progressMd(now = DEFAULT_NOW) {
  return [
    '# Журнал работ — тест', '',
    '> Ведёт агент docs-keeper после каждого проверенного шага.', '',
    '## Сейчас', '', now, '',
    '## Решения', '', '| Дата | Решение |', '|---|---|', '| 2026-09-23 | Тест |', '',
  ].join('\n');
}

module.exports = { paramsMd, ALPHA, GAMMA, ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, progressMd };
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/manifest.test.js`
Ожидается: FAIL — `ENOENT … .claude-plugin/marketplace.json`.

- [ ] **Шаг 3: создать манифесты и package.json**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "claude-kit",
  "owner": { "name": "Mikle Seregin" },
  "metadata": {
    "description": "Личный маркетплейс: плагин kit — каркас работы над проектами и модуль для сайтов на 1С-Битрикс."
  },
  "plugins": [
    {
      "name": "kit",
      "source": "./plugins/kit",
      "description": "Журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, Командная PHP-строка Битрикса, хуки правил и php -l.",
      "version": "0.1.0",
      "author": { "name": "Mikle Seregin" }
    }
  ]
}
```

`plugins/kit/.claude-plugin/plugin.json`:

```json
{
  "name": "kit",
  "version": "0.1.0",
  "description": "Каркас работы над проектами: журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс.",
  "author": { "name": "Mikle Seregin" },
  "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm"]
}
```

`package.json`:

```json
{
  "name": "claude-kit",
  "private": true,
  "description": "Маркетплейс claude-kit с плагином kit для Claude Code",
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

- [ ] **Шаг 4: тест проходит, манифесты валидны**

Запуск: `node --test tests/manifest.test.js` → PASS.
Запуск: `claude plugin validate plugins/kit` и `claude plugin validate .` → без ошибок (предупреждения записать в журнал, если есть).

- [ ] **Шаг 5: журнал и коммит**

В `docs/progress.md`: этап «Этап 1 — каркас и библиотека» с таблицей шагов 1.1–1.2 (1.1 ✅, 1.2 ⏳), в строке 0.3 — хеш коммита плана, «Сейчас» → 1.2.

```bash
git add -- .claude-plugin/marketplace.json plugins/kit/.claude-plugin/plugin.json package.json tests/helpers.js tests/fixtures.js tests/manifest.test.js docs/progress.md
git commit -m "1.1: маркетплейс claude-kit, манифест плагина kit, тестовая обвязка" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- .claude-plugin/marketplace.json plugins/kit/.claude-plugin/plugin.json package.json tests/helpers.js tests/fixtures.js tests/manifest.test.js docs/progress.md
```

### Задача 1.2: библиотека — параметры, markdown, пути, проект

**Файлы:**
- Создать: `plugins/kit/scripts/lib/params.js`, `plugins/kit/scripts/lib/md.js`, `plugins/kit/scripts/lib/paths.js`, `plugins/kit/scripts/lib/project.js`, `tests/lib.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `tests/helpers.js` (`makeProject`), `tests/fixtures.js` (`ALPHA_CLAUDE_MD`, `paramsMd`, `progressMd`).
- Даёт:
  - `lib/params.js`: `parseParams(md) → {ключ_в_нижнем_регистре: сырая_строка} | null`; `splitList(value) → string[]`; `stripTicks(s) → string`; `readParams(projectDir) → Params`, где `Params = { found: bool, file: string, values: object, get(key, def?) → string|def, list(key) → string[] }`; `makeParams(values|null, file) → Params`.
  - `lib/md.js`: `getSection(md, title) → string|null` (раздел `## <title…>` до следующего `#`/`##`); `parseTable(text) → Array<{заголовок: ячейка}>` (первая таблица); `normalize(md) → string`.
  - `lib/paths.js`: `parseRules(items: string[]) → Rule[]` (`Rule = {pattern, match(p), except: []}`, поддержка `шаблон (кроме a, b)`); `matchRules(path, rules) → Rule|null`; `norm(path) → string` (прямые слеши, без `./` и ведущего `/`).
  - `lib/project.js`: `readStdinJson() → object` (пусто/ошибка → `{}`); `resolveProjectDir(input) → string` (`CLAUDE_PROJECT_DIR` → `input.cwd` → `process.cwd()`); `kitInfo(dir) → { dir, params, journalRel, journalPath, hasJournal, planRel, isKit }`.

- [ ] **Шаг 1: написать падающие тесты**

`tests/lib.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseParams, splitList, readParams } = require('../plugins/kit/scripts/lib/params');
const { getSection, parseTable } = require('../plugins/kit/scripts/lib/md');
const { parseRules, matchRules, norm } = require('../plugins/kit/scripts/lib/paths');
const { kitInfo, resolveProjectDir } = require('../plugins/kit/scripts/lib/project');
const { makeProject } = require('./helpers');
const { ALPHA_CLAUDE_MD, paramsMd, progressMd } = require('./fixtures');

test('splitList: запятые внутри скобок и обратных кавычек не делят список', () => {
  assert.deepEqual(
    splitList('bitrix/, upload/ (кроме upload/docs/, upload/x/), `a,b`, *.back*'),
    ['bitrix/', 'upload/ (кроме upload/docs/, upload/x/)', 'a,b', '*.back*'],
  );
});

test('splitList: прочерк и пустые элементы отбрасываются', () => {
  assert.deepEqual(splitList('—'), []);
  assert.deepEqual(splitList('a, , b'), ['a', 'b']);
});

test('parseParams: нет раздела — null', () => {
  assert.equal(parseParams('# x\n\n## Проект\n- a: b\n'), null);
});

test('parseParams: раздел заканчивается на следующем заголовке ##, подзаголовок ### не мешает', () => {
  const v = parseParams('## Параметры для агентов\n\n- PHP: `C:\\x\\php.exe`\n### Прочее\n- Прод: https://a.ru\n\n## Другое\n- Журнал: z.md\n');
  assert.equal(v.php, '`C:\\x\\php.exe`');
  assert.equal(v['прод'], 'https://a.ru');
  assert.equal(v['журнал'], undefined);
});

test('readParams: параметры alpha', () => {
  const p = readParams(makeProject({ '.claude/CLAUDE.md': ALPHA_CLAUDE_MD }));
  assert.equal(p.found, true);
  assert.equal(p.get('PHP'), 'C:\\OSPanel\\modules\\PHP-7.4\\php.exe');
  assert.equal(p.get('Дев', 'нет'), 'нет');
  assert.equal(p.get('выкладка'), 'PhpStorm Always');
  assert.deepEqual(p.list('Не выкладывать'), ['.idea', '.git', '.claude/scripts', '.claude/settings.local.json']);
  assert.deepEqual(p.list('Не коммитить'), ['bitrix/', 'upload/ (кроме upload/docs/)', '*.back*']);
  assert.deepEqual(p.list('Секреты'), ['bitrix24.ru/rest/', 'apikey=', '"API_KEY" =>']);
});

test('readParams: нет файла — found=false, умолчания работают', () => {
  const p = readParams(makeProject({ 'index.php': '<?php' }));
  assert.equal(p.found, false);
  assert.equal(p.get('Журнал', 'docs/progress.md'), 'docs/progress.md');
  assert.deepEqual(p.list('Секреты'), []);
});

test('readParams: CRLF и BOM', () => {
  const dir = makeProject({ '.claude/CLAUDE.md': '\uFEFF## Параметры для агентов\r\n- Выкладка: PhpStorm Always\r\n' });
  assert.equal(readParams(dir).get('Выкладка'), 'PhpStorm Always');
});

test('getSection: раздел «Сейчас» до следующего заголовка', () => {
  const now = getSection(progressMd('- **Этап:** 2\n### деталь\n- x'), 'Сейчас');
  assert.equal(now, '- **Этап:** 2\n### деталь\n- x');
  assert.equal(getSection('# a\n## Другое\ntext', 'Сейчас'), null);
});

test('parseTable: первая таблица раздела', () => {
  const rows = parseTable('текст\n\n| Шаг | Дата | Коммит |\n|---|---|---|\n| 1.1 | 2026-09-23 | `abc1234` |\n| 1.2 | | |\n\nпосле');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Коммит'], '`abc1234`');
  assert.equal(rows[1]['Дата'], '');
});

test('paths: правила папок, масок, имён и исключений', () => {
  const rules = parseRules(['bitrix/', '.idea', '*.back*', 'upload/ (кроме upload/docs/)', '.claude/settings.local.json', '.settings.php']);
  const hit = (p) => (matchRules(p, rules) || {}).pattern || null;
  assert.equal(hit('bitrix/.settings.php'), 'bitrix/');
  assert.equal(hit('local/bitrix.php'), null);
  assert.equal(hit('.idea/workspace.xml'), '.idea');
  assert.equal(hit('sub/.idea/x.xml'), '.idea');
  assert.equal(hit('local/a.php.back1'), '*.back*');
  assert.equal(hit('upload/iblock/a.jpg'), 'upload/ (кроме upload/docs/)');
  assert.equal(hit('upload/docs/a.png'), null);
  assert.equal(hit('.claude/settings.local.json'), '.claude/settings.local.json');
  assert.equal(hit('.claude/CLAUDE.md'), null);
  assert.equal(hit('local/php_interface/.settings.php'), '.settings.php');
  assert.equal(hit('local\\x\\a.php.back'), '*.back*');
  assert.equal(norm('./a\\b'), 'a/b');
});

test('paths: маска со слешем проверяет путь и папки-предки', () => {
  const rules = parseRules(['local/templates/*/css/*.map', '.claude/scripts']);
  assert.ok(matchRules('local/templates/aspro/css/a.css.map', rules));
  assert.equal(matchRules('local/templates/aspro/css/a.css', rules), null);
  assert.ok(matchRules('.claude/scripts/01-inventory.php', rules));
  assert.equal(matchRules('.claude/scripts-old/x', rules), null);
});

test('kitInfo: журнал, параметры, чужой проект', () => {
  const onlyJournal = kitInfo(makeProject({ 'docs/progress.md': progressMd() }));
  assert.equal(onlyJournal.isKit, true);
  assert.equal(onlyJournal.params.found, false);
  const onlyParams = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'docs/log.md' }) }));
  assert.equal(onlyParams.isKit, true);
  assert.equal(onlyParams.hasJournal, false);
  assert.equal(onlyParams.journalRel, 'docs/log.md');
  assert.equal(onlyParams.planRel, 'docs/deploy-prod.md');
  assert.equal(kitInfo(makeProject({ 'index.php': '' })).isKit, false);
});

test('resolveProjectDir: CLAUDE_PROJECT_DIR важнее cwd из stdin', () => {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = 'C:\\proj';
  assert.equal(resolveProjectDir({ cwd: 'C:\\other' }), 'C:\\proj');
  process.env.CLAUDE_PROJECT_DIR = '';
  assert.equal(resolveProjectDir({ cwd: 'C:\\other' }), 'C:\\other');
  process.env.CLAUDE_PROJECT_DIR = saved === undefined ? '' : saved;
  if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  assert.equal(path.isAbsolute(resolveProjectDir({})), true);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/lib.test.js`
Ожидается: FAIL — `Cannot find module '../plugins/kit/scripts/lib/params'`.

- [ ] **Шаг 3: написать библиотеку**

`plugins/kit/scripts/lib/params.js`:

```js
'use strict';
// Разбор раздела «Параметры для агентов» из .claude/CLAUDE.md проекта.
// Строка параметра: `- Ключ: значение`; списки через запятую (запятая внутри `…` или (…) не делит).
const fs = require('fs');
const path = require('path');

const SECTION_RE = /^##\s+Параметры для агентов\s*$/;
const EMPTY = new Set(['', '—', '–', '-']);

function stripTicks(s) {
  const t = String(s).trim();
  if (t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`' && !t.slice(1, -1).includes('`')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function splitList(value) {
  const items = [];
  let cur = '';
  let depth = 0;
  let tick = false;
  for (const ch of String(value)) {
    if (ch === '`') tick = !tick;
    else if (!tick && ch === '(') depth++;
    else if (!tick && ch === ')' && depth > 0) depth--;
    else if (!tick && depth === 0 && ch === ',') {
      items.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  items.push(cur);
  return items.map(stripTicks).filter((s) => !EMPTY.has(s));
}

function parseParams(md) {
  const lines = String(md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => SECTION_RE.test(l.trim()));
  if (start < 0) return null;
  const values = {};
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const m = /^\s*[-*]\s+([^:`]+?):\s*(.*?)\s*$/.exec(lines[i]);
    if (m) values[m[1].trim().toLowerCase()] = m[2];
  }
  return values;
}

function makeParams(values, file) {
  const vals = values || {};
  const raw = (key) => {
    const v = vals[String(key).toLowerCase()];
    return v === undefined ? undefined : stripTicks(v);
  };
  return {
    found: values !== null && values !== undefined,
    file,
    values: vals,
    get(key, def) {
      const v = raw(key);
      return v === undefined || EMPTY.has(v) ? def : v;
    },
    list(key) {
      const v = vals[String(key).toLowerCase()];
      return v === undefined ? [] : splitList(v);
    },
  };
}

function readParams(projectDir) {
  const file = path.join(projectDir, '.claude', 'CLAUDE.md');
  let values = null;
  try {
    values = parseParams(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    values = null;
  }
  return makeParams(values, file);
}

module.exports = { parseParams, splitList, stripTicks, readParams, makeParams };
```

`plugins/kit/scripts/lib/md.js`:

```js
'use strict';
// Разделы и таблицы markdown-документов проекта (журнал, план выкладки).

function normalize(md) {
  return String(md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

// Текст раздела «## <title…>» до следующего заголовка # или ##; null — раздела нет.
function getSection(md, title) {
  const lines = normalize(md).split('\n');
  const start = lines.findIndex((l) => {
    const m = /^##\s+(.*?)\s*$/.exec(l);
    return m !== null && m[1].startsWith(title);
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

// Первая markdown-таблица в тексте: массив строк-объектов {заголовок: ячейка}.
function parseTable(text) {
  const lines = normalize(text).split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const head = splitRow(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const row = {};
      head.forEach((h, k) => {
        row[h] = cells[k] === undefined ? '' : cells[k];
      });
      rows.push(row);
    }
    return rows;
  }
  return [];
}

module.exports = { getSection, parseTable, normalize };
```

`plugins/kit/scripts/lib/paths.js`:

```js
'use strict';
// Правила путей из параметров («Не коммитить», «Не выкладывать»): `шаблон` или `шаблон (кроме a, b)`.
// Имя без слеша — любой сегмент пути; путь со слешем — от корня проекта (и всё внутри);
// * — внутри сегмента, ** — через сегменты. Регистр не важен (Windows).
const { splitList } = require('./params');

function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

function compile(token) {
  const t = norm(token).replace(/\/+$/, '');
  const hasSlash = t.includes('/');
  if (/[*?]/.test(t)) {
    const re = globToRe(t);
    if (!hasSlash) return (p) => p.split('/').some((seg) => re.test(seg));
    return (p) => {
      const segs = p.split('/');
      for (let i = 1; i <= segs.length; i++) if (re.test(segs.slice(0, i).join('/'))) return true;
      return false;
    };
  }
  const low = t.toLowerCase();
  return (p) => {
    const lp = p.toLowerCase();
    if (lp === low || lp.startsWith(low + '/')) return true;
    return !hasSlash && lp.split('/').includes(low);
  };
}

function parseRule(item) {
  const m = /^(.*?)\s*\(\s*кроме\s+(.*)\)\s*$/i.exec(item);
  const pattern = (m ? m[1] : item).trim();
  const except = m ? splitList(m[2]) : [];
  return { pattern: item.trim(), match: compile(pattern), except: except.map(compile) };
}

function parseRules(items) {
  return items.filter(Boolean).map(parseRule);
}

// Первое правило, под которое попадает путь, или null.
function matchRules(p, rules) {
  const np = norm(p);
  for (const r of rules) {
    if (r.match(np) && !r.except.some((e) => e(np))) return r;
  }
  return null;
}

module.exports = { parseRules, matchRules, norm };
```

`plugins/kit/scripts/lib/project.js`:

```js
'use strict';
// Общее для хуков и инструментов: вход хука, папка проекта, признаки kit-проекта.
const fs = require('fs');
const path = require('path');
const { readParams } = require('./params');

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

// Kit-проект — есть раздел «Параметры для агентов» или файл журнала.
function kitInfo(dir) {
  const params = readParams(dir);
  const journalRel = params.get('Журнал', 'docs/progress.md');
  const journalPath = path.resolve(dir, journalRel);
  const hasJournal = fs.existsSync(journalPath);
  return {
    dir,
    params,
    journalRel,
    journalPath,
    hasJournal,
    planRel: params.get('План выкладки', 'docs/deploy-prod.md'),
    isKit: params.found || hasJournal,
  };
}

module.exports = { readStdinJson, resolveProjectDir, kitInfo };
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/lib.test.js` → PASS (все 13).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 1.2 ✅ (+ хеш 1.1), этап 2 с таблицей 2.1–2.3 (2.1 ⏳), «Сейчас» → 2.1.

```bash
git add -- plugins/kit/scripts/lib tests/lib.test.js docs/progress.md
git commit -m "1.2: библиотека — параметры проекта, разделы и таблицы markdown, правила путей, признак kit-проекта" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/lib tests/lib.test.js docs/progress.md
```

---

## Этап 2 — хуки

### Задача 2.1: хук SessionStart — «Сейчас» и правила процесса

**Файлы:**
- Создать: `plugins/kit/scripts/session-start.js`, `plugins/kit/hooks/hooks.json`, `tests/session-start.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/project.js` (`readStdinJson`, `resolveProjectDir`, `kitInfo`), `lib/md.js` (`getSection`).
- Даёт: `session-start.js` — экспорт `buildContext(info) → string` (пусто вне kit-проекта); как хук: stdout = текст для контекста, код 0 всегда.

- [ ] **Шаг 1: написать падающие тесты**

`tests/session-start.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeProject, runScript } = require('./helpers');
const { ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, paramsMd, progressMd } = require('./fixtures');

const run = (dir) => runScript('session-start.js', {
  input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
});

test('чужой проект — тишина', () => {
  const r = run(makeProject({ 'index.php': '<?php' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('alpha: «Сейчас», общие правила, Always и «код пишет Claude»', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': ALPHA_CLAUDE_MD, 'docs/progress.md': progressMd() }));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас \(из docs\/progress\.md\)/);
  assert.match(r.stdout, /1\.2 — инвентаризация на проде/);
  assert.match(r.stdout, /\/kit:step-done/);
  assert.match(r.stdout, /AskUserQuestion/);
  assert.match(r.stdout, /PhpStorm Always/);
  assert.match(r.stdout, /Код пишет Claude/);
  assert.doesNotMatch(r.stdout, /Код пишет пользователь/);
  assert.doesNotMatch(r.stdout, /kit:project-init/);
});

test('gamma: код пишет пользователь, выкладка вручную', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': GAMMA_CLAUDE_MD, 'docs/progress.md': progressMd() }));
  assert.match(r.stdout, /Код пишет пользователь/);
  assert.doesNotMatch(r.stdout, /PhpStorm Always/);
});

test('только журнал — подсказка про /kit:project-init', () => {
  const r = run(makeProject({ 'docs/progress.md': progressMd() }));
  assert.match(r.stdout, /## Сейчас/);
  assert.match(r.stdout, /\/kit:project-init/);
});

test('только параметры, журнала нет', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'docs/log.md' }) }));
  assert.match(r.stdout, /Журнала docs\/log\.md нет/);
  assert.match(r.stdout, /Правила процесса/);
});

test('длинное «Сейчас» обрезается', () => {
  const r = run(makeProject({ 'docs/progress.md': progressMd('- **Этап:** ' + 'я'.repeat(10000)) }));
  assert.match(r.stdout, /обрезано — полностью в docs\/progress\.md/);
  assert.ok(r.stdout.length < 8000, 'длина ' + r.stdout.length);
});

test('CLAUDE_PROJECT_DIR важнее cwd; мусор на stdin не ломает хук', () => {
  const dir = makeProject({ 'docs/progress.md': progressMd() });
  const r = runScript('session-start.js', { input: 'не json', env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас/);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/session-start.test.js`
Ожидается: FAIL — скрипта `session-start.js` нет (код не 0, пустой stdout).

- [ ] **Шаг 3: написать хук и зарегистрировать его**

`plugins/kit/scripts/session-start.js`:

```js
#!/usr/bin/env node
'use strict';
// Хук SessionStart (startup|resume|clear|compact): раздел «Сейчас» из журнала и правила процесса в контекст.
// Вне kit-проекта молчит. Любая ошибка — тихий выход 0.
const fs = require('fs');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');
const { getSection } = require('./lib/md');

const MAX_NOW = 4000;

const RULES = [
  '- Один шаг за раз: следующий — только после проверки предыдущего.',
  '- Выбор за пользователем; вопросы — только через AskUserQuestion.',
  '- После проверенного шага — /kit:step-done (docs-keeper → git-keeper, один коммит на шаг).',
  '- Git пользователь не трогает, команды git ему не выдаём; коммиты — только через git-keeper.',
  '- Переводы строк LF; файлы целиком не переформатировать.',
  '- Грабли: cd в Bash меняет каталог всей сессии — только абсолютные пути или ( cd … ); PHP не править sed (портит \\ неймспейсов) — только Edit; Git Bash переписывает аргументы вида /путь — PowerShell или MSYS_NO_PATHCONV=1.',
];
const RULE_ALWAYS = '- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на сервер. Черновики — только во временной папке сессии; PHP собрать и проверить php -l там, в проект — одной правкой. Удаление локально сервер не трогает.';
const RULE_USER = '- Код пишет пользователь: Claude даёт один маленький шаг и ждёт ответа; «сделай сам» относится только к текущему шагу.';
const RULE_CLAUDE = '- Код пишет Claude: после записи проверить результат на сервере (страница, десктоп и мобильная ширина).';
const RULE_NO_PARAMS = '- В .claude/CLAUDE.md нет раздела «Параметры для агентов» — предложи пользователю /kit:project-init (дополнит недостающее).';

function buildContext(info) {
  if (!info.isKit) return '';
  const out = ['[kit] Проект ведётся по журналу ' + info.journalRel + '.'];
  if (info.hasJournal) {
    let now = getSection(fs.readFileSync(info.journalPath, 'utf8'), 'Сейчас');
    if (now) {
      if (now.length > MAX_NOW) now = now.slice(0, MAX_NOW) + '\n… (обрезано — полностью в ' + info.journalRel + ')';
      out.push('', '## Сейчас (из ' + info.journalRel + ')', now);
    } else {
      out.push('', 'В журнале нет раздела «Сейчас».');
    }
  } else {
    out.push('', 'Журнала ' + info.journalRel + ' нет — его создаёт /kit:project-init.');
  }
  out.push('', '## Правила процесса (плагин kit)', ...RULES);
  const p = info.params;
  if (/always/i.test(p.get('Выкладка', ''))) out.push(RULE_ALWAYS);
  const who = p.get('Код пишет', '').toLowerCase();
  if (who.startsWith('пользов')) out.push(RULE_USER);
  else if (who.startsWith('claude')) out.push(RULE_CLAUDE);
  if (!p.found) out.push(RULE_NO_PARAMS);
  return out.join('\n') + '\n';
}

function main() {
  try {
    const input = readStdinJson();
    const text = buildContext(kitInfo(resolveProjectDir(input)));
    if (text) process.stdout.write(text);
  } catch (e) {
    // хук не должен ломать сессию
  }
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { buildContext };
```

`plugins/kit/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"], "timeout": 10 }
        ]
      }
    ]
  }
}
```

- [ ] **Шаг 4: тесты проходят, плагин валиден**

Запуск: `node --test tests/session-start.test.js` → PASS (7).
Запуск: `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 2.1 ✅ (+ хеш 1.2), 2.2 ⏳, «Сейчас» → 2.2.

```bash
git add -- plugins/kit/scripts/session-start.js plugins/kit/hooks/hooks.json tests/session-start.test.js docs/progress.md
git commit -m "2.1: хук SessionStart — раздел «Сейчас» и правила процесса в контекст" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/session-start.js plugins/kit/hooks/hooks.json tests/session-start.test.js docs/progress.md
```

### Задача 2.2: хук PostToolUse — `php -l` версией PHP проекта

**Файлы:**
- Создать: `plugins/kit/scripts/php-lint.js`, `tests/php-lint.test.js`
- Изменить: `plugins/kit/hooks/hooks.json`, `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/project.js`; `tests/helpers.js` (`makeProject`, `runScript`, `hasPhp`, `php`), `tests/fixtures.js` (`paramsMd`).
- Даёт: `php-lint.js` — экспорт `lint(phpExe, file) → {ok: true} | {ok: false, text}`, `isConsoleScript(file, src) → bool`; как хук: ошибка — stderr и код 2, иначе код 0 без вывода.

- [ ] **Шаг 1: написать падающие тесты**

`tests/php-lint.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeProject, runScript, hasPhp, php } = require('./helpers');
const { paramsMd } = require('./fixtures');

const skip = !hasPhp('7.4');
const project = (files) => makeProject({ '.claude/CLAUDE.md': paramsMd({ 'PHP': php('7.4') }), ...files });
const run = (dir, file, tool = 'Write') => runScript('php-lint.js', {
  input: { hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: path.join(dir, file) }, cwd: dir },
});

test('верный PHP — тишина', { skip }, () => {
  const dir = project({ 'a.php': '<?php\necho 1;\n' });
  const r = run(dir, 'a.php');
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('синтаксическая ошибка — код 2 и текст для Claude', { skip }, () => {
  const dir = project({ 'bad.php': '<?php\necho 1\necho 2;\n' });
  const r = run(dir, 'bad.php', 'Edit');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /php -l \(PHP 7\.4\)/);
  assert.match(r.stderr, /bad\.php/);
  assert.match(r.stderr, /line 3/);
});

test('синтаксис PHP 8 на PHP 7.4 — ошибка', { skip }, () => {
  const dir = project({ 'm.php': "<?php\n$x = match (1) { 1 => 'a', default => 'b' };\n" });
  assert.equal(run(dir, 'm.php').code, 2);
});

test('скрипт консоли без <?php: верный — тишина, ошибка — номер строки без приставки', { skip }, () => {
  const dir = project({
    '.claude/scripts/01-ok.php': "echo 'ok';\n",
    '.claude/scripts/02-bad.php': "echo 'a';\necho 'b'\necho 'c';\n",
  });
  assert.equal(run(dir, '.claude/scripts/01-ok.php').code, 0);
  const r = run(dir, '.claude/scripts/02-bad.php');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /02-bad\.php/);
  assert.match(r.stderr, /line 3/);
  assert.doesNotMatch(r.stderr, /Standard input code/);
});

test('HTML в .php вне папки скриптов — не ошибка', { skip }, () => {
  const dir = project({ 'include/area.php': '<p>Текст области</p>\n' });
  assert.equal(run(dir, 'include/area.php').code, 0);
});

test('не PHP, нет параметра PHP, чужой проект — тишина', () => {
  const dir = project({ 'a.js': 'x(' });
  assert.equal(run(dir, 'a.js').code, 0);
  const noParam = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'bitrix' }), 'bad.php': '<?php echo' });
  assert.equal(run(noParam, 'bad.php').code, 0);
  const foreign = makeProject({ 'bad.php': '<?php echo' });
  assert.equal(run(foreign, 'bad.php').code, 0);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/php-lint.test.js`
Ожидается: FAIL — нет `php-lint.js`.

- [ ] **Шаг 3: написать хук и зарегистрировать его**

`plugins/kit/scripts/php-lint.js`:

```js
#!/usr/bin/env node
'use strict';
// Хук PostToolUse (Write|Edit|MultiEdit): php -l версией PHP из параметров проекта («PHP»).
// Скрипты Командной PHP-строки лежат без <?php — их проверяем через stdin с приставкой.
// Ошибка синтаксиса → stderr и код 2 (Claude видит сообщение). Иначе и при любой внутренней ошибке — тихо, код 0.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const CONSOLE_DIRS = ['/.claude/scripts/', '/skills/bitrix-console/scripts/'];

function isConsoleScript(file, src) {
  const p = file.replace(/\\/g, '/');
  return CONSOLE_DIRS.some((d) => p.includes(d)) && !/<\?(php|=)/i.test(src);
}

function phpLabel(phpExe) {
  const m = /PHP-?(\d+\.\d+)/i.exec(phpExe);
  return m ? 'PHP ' + m[1] : 'PHP';
}

function lint(phpExe, file) {
  const src = fs.readFileSync(file, 'utf8');
  const consoleMode = isConsoleScript(file, src);
  const opts = { encoding: 'utf8', timeout: 20000 };
  const res = consoleMode
    ? spawnSync(phpExe, ['-l'], { ...opts, input: '<?php\n' + src })
    : spawnSync(phpExe, ['-l', file], opts);
  if (res.error || res.status === 0) return { ok: true };
  const seen = new Set();
  const lines = [];
  for (const raw of ((res.stdout || '') + '\n' + (res.stderr || '')).split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^No syntax errors/i.test(l) || /^Errors parsing/i.test(l)) continue;
    l = l.replace(/^PHP\s+/, '');
    if (consoleMode) {
      l = l.replace(/Standard input code/g, file)
        .replace(/on line (\d+)/g, (m, n) => 'on line ' + Math.max(1, Number(n) - 1));
    }
    if (!seen.has(l)) {
      seen.add(l);
      lines.push(l);
    }
  }
  return { ok: false, text: lines.join('\n') || 'php -l завершился с кодом ' + res.status };
}

function main() {
  try {
    const input = readStdinJson();
    const file = input.tool_input && input.tool_input.file_path;
    if (!file || !/\.php$/i.test(file)) return 0;
    const info = kitInfo(resolveProjectDir(input));
    if (!info.isKit) return 0;
    const phpExe = info.params.get('PHP');
    if (!phpExe || !fs.existsSync(phpExe)) return 0;
    const abs = path.resolve(info.dir, file);
    if (!fs.existsSync(abs)) return 0;
    const r = lint(phpExe, abs);
    if (r.ok) return 0;
    process.stderr.write('php -l (' + phpLabel(phpExe) + ') нашёл ошибку в ' + file + ':\n' + r.text + '\n');
    return 2;
  } catch (e) {
    return 0;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { lint, isConsoleScript };
```

`plugins/kit/hooks/hooks.json` (целиком):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"], "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/php-lint.js"], "timeout": 30 }
        ]
      }
    ]
  }
}
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/php-lint.test.js` → PASS (6). Если `php -l` не читает stdin (тест консольного скрипта падает на «ok»), заменить stdin на временный файл в `os.tmpdir()` с приставкой `<?php\n` и подменой его пути в сообщении на исходный — и прогнать снова.
Запуск: `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 2.2 ✅ (+ хеш 2.1), 2.3 ⏳, «Сейчас» → 2.3.

```bash
git add -- plugins/kit/scripts/php-lint.js plugins/kit/hooks/hooks.json tests/php-lint.test.js docs/progress.md
git commit -m "2.2: хук php -l версией PHP проекта, скрипты консоли — с приставкой <?php" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/php-lint.js plugins/kit/hooks/hooks.json tests/php-lint.test.js docs/progress.md
```

### Задача 2.3: хук PreToolUse — страж грабель Bash и PowerShell

**Файлы:**
- Создать: `plugins/kit/scripts/guard-bash.js`, `tests/guard-bash.test.js`
- Изменить: `plugins/kit/hooks/hooks.json`, `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/project.js`; `tests/helpers.js` (`makeProject`, `runScript`), `tests/fixtures.js` (`progressMd`).
- Даёт: `guard-bash.js` — экспорт `checkCommand(cmd, shell: 'bash'|'powershell') → string|null` (причина запрета или null), `splitCommands(cmd, shell) → Array<{text, raw, depth}>`; как хук: запрет — JSON `hookSpecificOutput.permissionDecision: "deny"` в stdout, код 0.

- [ ] **Шаг 1: написать падающие тесты**

`tests/guard-bash.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCommand } = require('../plugins/kit/scripts/guard-bash');
const { makeProject, runScript } = require('./helpers');
const { progressMd } = require('./fixtures');

const CASES = [
  ['bash', 'cd /c/x && ls', 'cd'],
  ['bash', 'ls; cd x', 'cd'],
  ['bash', 'pushd /c/x', 'cd'],
  ['bash', 'if true; then cd x; fi', 'cd'],
  ['bash', 'FOO=1 cd x', 'cd'],
  ['bash', '(cd x) && cd y', 'cd'],
  ['bash', '( cd /c/x && ls )', null],
  ['bash', 'echo "$(cd /c/x; pwd)"', null],
  ['bash', 'git -C /c/x status', null],
  ['bash', 'echo "cd x && y"', null],
  ['bash', "cat <<'EOF' > f.txt\ncd x\nEOF", null],
  ['bash', 'git commit -m "$(cat <<\'EOF\'\nшаг\ncd x\nEOF\n)"', null],
  ['bash', 'abcd x', null],
  ['bash', "sed -i 's/a/b/' a.php", 'sed'],
  ['bash', "sed -i.bak 's/\\\\/x/' local/a.php", 'sed'],
  ['bash', "find . -name '*.php' -exec sed -i 's/a/b/' {} \\;", 'sed'],
  ['bash', "sed -n '1,5p' a.php", null],
  ['bash', "sed -i 's/a/b/' a.txt", null],
  ['bash', "grep -i foo a.php | sed 's/a/b/'", null],
  ['powershell', 'cd C:\\x; git status', 'cd'],
  ['powershell', 'Set-Location C:\\x', 'cd'],
  ['powershell', '(Set-Location C:\\x); ls', 'cd'],
  ['powershell', '& { sl C:\\x }', 'cd'],
  ['powershell', 'Get-ChildItem C:\\x | Select-Object Name', null],
  ['powershell', "Write-Output 'cd x'", null],
  ['powershell', "$s = @'\ncd x\n'@; $s", null],
  ['powershell', 'git -C "C:\\x" status', null],
];

for (const [shell, cmd, want] of CASES) {
  test(`${shell}: ${JSON.stringify(cmd)} → ${want || 'разрешено'}`, () => {
    const reason = checkCommand(cmd, shell);
    if (want === null) assert.equal(reason, null);
    else assert.match(reason, want === 'cd' ? /каталог/ : /sed/);
  });
}

test('хук: в kit-проекте — JSON deny, в чужом и для безопасной команды — тишина', () => {
  const kit = makeProject({ 'docs/progress.md': progressMd() });
  const r = runScript('guard-bash.js', {
    input: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cd /c/x && ls' }, cwd: kit },
  });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[kit\]/);
  const foreign = makeProject({ 'a.txt': '' });
  const r2 = runScript('guard-bash.js', { input: { tool_name: 'Bash', tool_input: { command: 'cd /c/x' }, cwd: foreign } });
  assert.equal(r2.stdout, '');
  const r3 = runScript('guard-bash.js', { input: { tool_name: 'PowerShell', tool_input: { command: 'git status' }, cwd: kit } });
  assert.equal(r3.stdout, '');
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/guard-bash.test.js`
Ожидается: FAIL — `Cannot find module '../plugins/kit/scripts/guard-bash'`.

- [ ] **Шаг 3: написать хук и зарегистрировать его**

`plugins/kit/scripts/guard-bash.js`:

```js
#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Bash|PowerShell) в kit-проектах:
// - cd вне подоболочки меняет рабочий каталог всей сессии → запрет;
// - sed -i по PHP портит обратные слеши неймспейсов → запрет.
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const BASH_CD = new Set(['cd', 'pushd', 'popd']);
const PS_CD = new Set(['cd', 'chdir', 'sl', 'set-location']);
const SKIP_WORDS = new Set(['then', 'do', 'else', '!', 'time']);

const REASON_CD = 'cd в Bash меняет рабочий каталог всей сессии. Используй абсолютные пути (git -C <путь>, node <путь>) или подоболочку ( cd <путь> && … ).';
const REASON_CD_PS = 'cd/Set-Location в PowerShell меняет рабочий каталог всей сессии (скобки не помогают). Используй абсолютные пути, -LiteralPath, git -C <путь>.';
const REASON_SED = 'sed -i по PHP портит обратные слеши неймспейсов. Правь PHP через Edit (или скриптом на node/python).';

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' $3');
}

function stripHereStrings(cmd) {
  return cmd.replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

// Команды верхнего уровня: text — без содержимого кавычек, raw — как есть, depth — глубина скобок в начале.
function splitCommands(cmd, shell) {
  const out = [];
  const esc = shell === 'powershell' ? '`' : '\\';
  let text = '';
  let raw = '';
  let depth = 0;
  let startDepth = 0;
  let q = null;
  const push = () => {
    out.push({ text, raw, depth: startDepth });
    text = '';
    raw = '';
    startDepth = depth;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      raw += ch;
      if (ch === esc && q === '"') {
        raw += cmd[i + 1] || '';
        i++;
      } else if (ch === q) {
        q = null;
        text += ' ';
      }
      continue;
    }
    if (ch === esc) {
      raw += ch + (cmd[i + 1] || '');
      text += ' ';
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      raw += ch;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      push();
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r') {
      push();
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    text += ch;
    raw += ch;
  }
  push();
  return out;
}

function firstWord(seg, shell) {
  let s = seg.text.trim();
  let depth = seg.depth;
  for (;;) {
    if (s.startsWith('$(')) {
      depth++;
      s = s.slice(2).trim();
      continue;
    }
    if (s.startsWith('(')) {
      depth++;
      s = s.slice(1).trim();
      continue;
    }
    if (s.startsWith('{')) {
      s = s.slice(1).trim();
      continue;
    }
    const m = /^(\S+)\s*/.exec(s);
    if (!m) return null;
    const w = m[1];
    if (SKIP_WORDS.has(w.toLowerCase()) || (shell === 'bash' && /^[A-Za-z_]\w*=/.test(w))) {
      s = s.slice(m[0].length);
      continue;
    }
    return { word: w.toLowerCase().replace(/[)}]+$/, ''), depth };
  }
}

function checkCommand(cmd, shell) {
  const src = shell === 'powershell' ? stripHereStrings(cmd) : stripHeredocs(cmd);
  const segs = splitCommands(src, shell);
  for (const seg of segs) {
    const fw = firstWord(seg, shell);
    if (!fw) continue;
    if (shell === 'bash' && BASH_CD.has(fw.word) && fw.depth === 0) return REASON_CD;
    if (shell === 'powershell' && PS_CD.has(fw.word)) return REASON_CD_PS;
  }
  for (const seg of segs) {
    if (/(^|\s)sed(\s|$)/.test(seg.text)
      && /(^|\s)(-[A-Za-z]*i[A-Za-z.]*|--in-place)(?=[\s=]|$)/.test(seg.text)
      && /\.php\b/i.test(seg.raw)) return REASON_SED;
  }
  return null;
}

function main() {
  try {
    const input = readStdinJson();
    const tool = input.tool_name;
    const cmd = input.tool_input && input.tool_input.command;
    if (!cmd || (tool !== 'Bash' && tool !== 'PowerShell')) return;
    if (!kitInfo(resolveProjectDir(input)).isKit) return;
    const reason = checkCommand(cmd, tool === 'PowerShell' ? 'powershell' : 'bash');
    if (!reason) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[kit] ' + reason,
      },
    }));
  } catch (e) {
    // хук не должен ломать сессию
  }
}

if (require.main === module) main();
module.exports = { checkCommand, splitCommands };
```

`plugins/kit/hooks/hooks.json` (целиком, финальный вид):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"], "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/php-lint.js"], "timeout": 30 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/guard-bash.js"], "timeout": 10 }
        ]
      }
    ]
  }
}
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/guard-bash.test.js` → PASS (28).
Запуск: `node --test tests/*.test.js` → PASS (все); `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 2.3 ✅ (+ хеш 2.2), этап 3 с таблицей 3.1–3.4 (3.1 ⏳), «Сейчас» → 3.1.

```bash
git add -- plugins/kit/scripts/guard-bash.js plugins/kit/hooks/hooks.json tests/guard-bash.test.js docs/progress.md
git commit -m "2.3: страж грабель — запрет cd вне подоболочки и sed -i по PHP в kit-проектах" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/guard-bash.js plugins/kit/hooks/hooks.json tests/guard-bash.test.js docs/progress.md
```

---

## Этап 3 — инструменты

### Задача 3.1: `secret-scan.js` — секреты и запрещённые пути

**Файлы:**
- Создать: `plugins/kit/scripts/secret-scan.js`, `tests/secret-scan.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/params.js` (`readParams`), `lib/paths.js` (`parseRules`, `matchRules`, `norm`); `tests/helpers.js` (`gitRepo`, `git`, `writeFiles`, `runScript`), `tests/fixtures.js` (`paramsMd`, `ALPHA`).
- Даёт: CLI `node secret-scan.js --cached [-- пути…] | --all | --files пути…` в корне проекта; вывод `secret-scan: чисто (файлов: N)` или `secret-scan: найдено K:` и строки `путь:строка: вид — ма…(N симв.)` / `путь: запрещённый путь (шаблон)`; код 0 / 1 / 2 (ошибка запуска). Экспорт `scanLine(line, extra) → string[]`, `looksSecret(v) → bool`. Используется агентом git-keeper (4.1) и `/kit:project-init` (5.2).

- [ ] **Шаг 1: написать падающие тесты**

`tests/secret-scan.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gitRepo, git, writeFiles, runScript } = require('./helpers');
const { paramsMd, ALPHA } = require('./fixtures');

const scan = (dir, ...args) => runScript('secret-scan.js', { args, cwd: dir });

test('--cached: вебхук Б24 в добавленной строке — код 1, значение замаскировано', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'a.php': "<?php\n$hook = 'https://x.bitrix24.ru/rest/1/abcdef123456/';\n" });
  git(dir, 'add', 'a.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /a\.php:2: вебхук Битрикс24 — abc…\(12 симв\.\)/);
  assert.doesNotMatch(r.stdout, /abcdef123456/);
});

test('--cached: пароль с цифрами — находка', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'cfg.php': "<?php\nreturn ['password' => 'Qw3rty!x9'];\n" });
  git(dir, 'add', 'cfg.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /cfg\.php:2: пароль или токен — Qw3…\(9 симв\.\)/);
});

test('--cached: подписи, переменные и ключ из переменной — не секреты', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'lang.php': "<?php\n$MESS['PASSWORD'] = 'Пароль';\n$arr = ['PASSWORD' => 'Пароль', 'token' => $token];\n$url = '?apikey=' . $key;\n" });
  git(dir, 'add', 'lang.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /чисто/);
});

test('--cached -- пути: проверяются только переданные', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'a.php': "<?php $p = ['password' => 'Secr3tValue'];\n", 'b.php': '<?php echo 1;\n' });
  git(dir, 'add', 'a.php', 'b.php');
  assert.equal(scan(dir, '--cached', '--', 'b.php').code, 0);
  assert.equal(scan(dir, '--cached', '--', 'a.php').code, 1);
});

test('шаблоны из параметра «Секреты»; строка параметров в CLAUDE.md не считается', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  writeFiles(dir, { 'api.php': '<?php\n$c = ["API_KEY" => "k-123456"];\n' });
  git(dir, 'add', 'api.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /api\.php:2: шаблон «"API_KEY" =>»/);
  const all = scan(dir, '--all');
  assert.doesNotMatch(all.stdout, /CLAUDE\.md/);
});

test('запрещённые пути: базовые и из параметра «Не коммитить» с исключением', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  writeFiles(dir, { 'bitrix/.settings.php': '<?php return [];\n', 'local/x.php.back1': 'x', 'upload/docs/a.txt': 'ok', 'upload/iblock/b.txt': 'b' });
  const r = scan(dir, '--files', 'bitrix/.settings.php', 'local/x.php.back1', 'upload/docs/a.txt', 'upload/iblock/b.txt');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /bitrix\/\.settings\.php: запрещённый путь/);
  assert.match(r.stdout, /local\/x\.php\.back1: запрещённый путь \(\*\.back\*\)/);
  assert.match(r.stdout, /upload\/iblock\/b\.txt: запрещённый путь \(upload\/ \(кроме upload\/docs\/\)\)/);
  assert.doesNotMatch(r.stdout, /upload\/docs/);
});

test('--all: чистый репозиторий — код 0; приватный ключ найден, бинарный файл пропущен', () => {
  const clean = gitRepo({ 'a.php': '<?php echo 1;\n' });
  const ok = scan(clean, '--all');
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /чисто \(файлов: 1\)/);
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'k.pem.txt': '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n', 'img.bin': Buffer.from([0, 1, 2, 45, 45, 45]) });
  const r = scan(dir, '--all');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /k\.pem\.txt:1: приватный ключ/);
  assert.doesNotMatch(r.stdout, /img\.bin/);
});

test('без режима — код 2 и подсказка', () => {
  const r = scan(gitRepo({ 'a.txt': '' }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Использование/);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/secret-scan.test.js`
Ожидается: FAIL — скрипта нет.

- [ ] **Шаг 3: написать скрипт**

`plugins/kit/scripts/secret-scan.js`:

```js
#!/usr/bin/env node
'use strict';
// Поиск секретов и запрещённых путей перед коммитом. Значения в выводе маскируются.
// Запуск в корне проекта:
//   node secret-scan.js --cached [-- пути…]   добавленные строки из индекса
//   node secret-scan.js --all                 всё, что попадёт в git (tracked + untracked без ignored)
//   node secret-scan.js --files пути…         указанные файлы
// Код 0 — чисто, 1 — есть находки, 2 — ошибка запуска.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readParams } = require('./lib/params');
const { parseRules, matchRules, norm } = require('./lib/paths');

const BASE_FORBIDDEN = [
  '.idea', '*.back*', '.settings.php', '.settings_extra.php', 'dbconn.php', '.env', '.env.*',
  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees',
];
const MAX_SIZE = 2 * 1024 * 1024;
const PARAM_LINE = /^\s*[-*]\s+Секреты\s*:/i;

// Слова вроде «Пароль» или «password_field» — подписи, а не секреты.
function looksSecret(v) {
  if (/^[\p{L}_ -]+$/u.test(v) && v.length < 16) return false;
  if (/^(\$|\{\{|%|<\?)/.test(v)) return false;
  return true;
}

const PATTERNS = [
  { kind: 'вебхук Битрикс24', re: /bitrix24\.[a-z.]+\/rest\/\d+\/([a-z0-9]{6,})/i },
  { kind: 'приватный ключ', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----()/ },
  {
    kind: 'пароль или токен',
    re: /(?:password|passwd|secret|token|api_?key)['"]?\s*(?:=>|=|:)\s*['"]([^'"\s]{6,})['"]/i,
    check: looksSecret,
  },
  { kind: 'ключ в URL', re: /[?&]api_?key=([^&\s'"]{6,})/i, check: (v) => !v.startsWith('$') },
];

function mask(v) {
  return v ? v.slice(0, 3) + '…(' + v.length + ' симв.)' : '';
}

function scanLine(line, extra) {
  if (PARAM_LINE.test(line)) return [];
  const found = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(line);
    if (m && (!p.check || p.check(m[1]))) found.push(p.kind + (m[1] ? ' — ' + mask(m[1]) : ''));
  }
  for (const s of extra) {
    const i = line.indexOf(s);
    if (i >= 0) found.push('шаблон «' + s + '» — ' + mask(line.slice(i + s.length).trim()));
  }
  return found;
}

function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || '').trim());
  return r.stdout;
}

function scanDiff(diff, extra, out) {
  let file = null;
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/\t.*$/, '').replace(/^b\//, '').trim();
      continue;
    }
    if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith('+') && file && file !== '/dev/null') {
      for (const f of scanLine(line.slice(1).replace(/\r$/, ''), extra)) out.push(file + ':' + lineNo + ': ' + f);
      lineNo++;
    }
  }
}

function scanFile(root, rel, extra, out) {
  let st;
  try {
    st = fs.statSync(path.join(root, rel));
  } catch (e) {
    return;
  }
  if (!st.isFile() || st.size > MAX_SIZE) return;
  const buf = fs.readFileSync(path.join(root, rel));
  if (buf.subarray(0, 8000).includes(0)) return;
  buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
    for (const f of scanLine(line, extra)) out.push(norm(rel) + ':' + (i + 1) + ': ' + f);
  });
}

function main(argv) {
  const root = process.cwd();
  const params = readParams(root);
  const extra = params.list('Секреты');
  const rules = parseRules([...BASE_FORBIDDEN, ...params.list('Не коммитить')]);
  const findings = [];
  let files;
  if (argv[0] === '--cached') {
    const sep = argv.indexOf('--');
    const paths = sep >= 0 ? argv.slice(sep + 1) : [];
    const spec = paths.length ? ['--', ...paths] : [];
    files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT', ...spec]).split('\0').filter(Boolean);
    scanDiff(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', ...spec]), extra, findings);
  } else if (argv[0] === '--all') {
    files = git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    files.forEach((f) => scanFile(root, f, extra, findings));
  } else if (argv[0] === '--files' && argv.length > 1) {
    files = argv.slice(1).map(norm);
    files.forEach((f) => scanFile(root, f, extra, findings));
  } else {
    console.error('Использование: node secret-scan.js --cached [-- пути…] | --all | --files пути…');
    return 2;
  }
  const pathHits = [];
  for (const f of files) {
    const r = matchRules(f, rules);
    if (r) pathHits.push(norm(f) + ': запрещённый путь (' + r.pattern + ')');
  }
  const all = [...pathHits, ...findings];
  if (!all.length) {
    console.log('secret-scan: чисто (файлов: ' + files.length + ')');
    return 0;
  }
  console.log('secret-scan: найдено ' + all.length + ':');
  all.forEach((l) => console.log('  ' + l));
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error('secret-scan: ' + e.message);
    process.exitCode = 2;
  }
}
module.exports = { scanLine, looksSecret };
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/secret-scan.test.js` → PASS (8).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 3.1 ✅ (+ хеш 2.3), 3.2 ⏳, «Сейчас» → 3.2.

```bash
git add -- plugins/kit/scripts/secret-scan.js tests/secret-scan.test.js docs/progress.md
git commit -m "3.1: secret-scan — секреты в добавляемых строках и запрещённые пути, значения маскируются" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/secret-scan.js tests/secret-scan.test.js docs/progress.md
```

### Задача 3.2: `deploy-list.js` — что залить и что удалить на сервере

**Файлы:**
- Создать: `plugins/kit/scripts/deploy-list.js`, `tests/deploy-list.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/project.js` (`kitInfo`), `lib/md.js` (`getSection`, `parseTable`), `lib/paths.js` (`parseRules`, `matchRules`); `tests/helpers.js` (`gitRepo`, `git`, `writeFiles`, `runScript`, `makeProject`), `tests/fixtures.js` (`paramsMd`).
- Даёт: CLI `node deploy-list.js [--base <коммит>]` в корне проекта: строки `База: <хеш> (<откуда>)`, `Залить (N):` + `  M путь`, `Удалить с сервера (N):` + `  D путь`, `Не закоммичено — в список не вошло (N):`; код 0 / 1 (не git или нет базы). Экспорт `baseFromPlan(planPath) → хеш|null`. Используется скиллом `/kit:deploy-list` (5.1).

- [ ] **Шаг 1: написать падающие тесты**

`tests/deploy-list.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { paramsMd } = require('./fixtures');

const planMd = (commit) => [
  '# Выкладка', '', '## Общие правила', '', '- тест', '',
  '## Залито на прод', '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  '| 1.1 | 2026-09-20 | a.php | `' + commit + '` | ок |',
  '| 1.2 | | | | |', '',
  '## Удалить с сервера', '',
].join('\n');

function setup(mode) {
  const dir = gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': mode, 'Не выкладывать': '.claude, .gitignore' }),
    'a.php': '1', 'b.php': '1', 'docs/deploy-prod.md': '# пусто\n',
  });
  const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'docs/deploy-prod.md': planMd(base), 'a.php': '2', 'c.php': 'new', '.claude/scripts/x.php': 'x' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: изменения');
  writeFiles(dir, { 'd.php': 'untracked' });
  return { dir, base };
}

test('вручную: база из «Залито на прод», залить и удалить, исключения, незакоммиченное', () => {
  const { dir, base } = setup('вручную');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + base + ' \\(«Залито на прод» в docs/deploy-prod\\.md\\)'));
  assert.match(r.stdout, /Залить \(3\):/);
  assert.match(r.stdout, /\n  M a\.php/);
  assert.match(r.stdout, /\n  A c\.php/);
  assert.match(r.stdout, /\n  M docs\/deploy-prod\.md/);
  assert.match(r.stdout, /Удалить с сервера \(1\):\n  D b\.php/);
  assert.doesNotMatch(r.stdout, /x\.php/);
  assert.match(r.stdout, /Не закоммичено[^\n]*\n  \?\? d\.php/);
});

test('PhpStorm Always: только удаления', () => {
  const { dir } = setup('PhpStorm Always');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.match(r.stdout, /PhpStorm Always/);
  assert.doesNotMatch(r.stdout, /Залить \(/);
  assert.match(r.stdout, /Удалить с сервера \(1\)/);
});

test('без плана — от первого коммита; --base', () => {
  const dir = gitRepo({ 'a.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.1: правка');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.match(r.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.match(r.stdout, /\n  M a\.php/);
  const r2 = runScript('deploy-list.js', { cwd: dir, args: ['--base', 'HEAD'] });
  assert.match(r2.stdout, /аргумент --base/);
  assert.match(r2.stdout, /Залить \(0\)/);
});

test('не git-репозиторий и неверная база — код 1', () => {
  assert.equal(runScript('deploy-list.js', { cwd: makeProject({ 'a.php': '' }) }).code, 1);
  const dir = gitRepo({ 'a.php': '1' });
  assert.equal(runScript('deploy-list.js', { cwd: dir, args: ['--base', 'deadbeef'] }).code, 1);
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/deploy-list.test.js`
Ожидается: FAIL — скрипта нет.

- [ ] **Шаг 3: написать скрипт**

`plugins/kit/scripts/deploy-list.js`:

```js
#!/usr/bin/env node
'use strict';
// Что залить на сервер и что удалить на нём с последней выкладки.
// Запуск в корне проекта: node deploy-list.js [--base <коммит>]
// База: --base → последний «Коммит» в таблице «Залито на прод» плана выкладки → первый коммит репозитория.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { kitInfo } = require('./lib/project');
const { getSection, parseTable } = require('./lib/md');
const { parseRules, matchRules } = require('./lib/paths');

const ALWAYS_SKIP = ['.git', '.idea'];

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim() };
}

function baseFromPlan(planPath) {
  if (!fs.existsSync(planPath)) return null;
  const section = getSection(fs.readFileSync(planPath, 'utf8'), 'Залито на прод');
  if (!section) return null;
  const rows = parseTable(section);
  for (let i = rows.length - 1; i >= 0; i--) {
    const hashes = (rows[i]['Коммит'] || '').match(/\b[0-9a-f]{7,40}\b/g);
    if (hashes) return hashes[hashes.length - 1];
  }
  return null;
}

function parseNameStatusZ(out) {
  const parts = out.split('\0').filter((s) => s !== '');
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) items.push({ status: parts[i][0], path: parts[i + 1] });
  return items;
}

function main(argv) {
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('deploy-list: здесь нет git-репозитория');
    return 1;
  }
  const info = kitInfo(cwd);
  let base = null;
  let source = '';
  const bi = argv.indexOf('--base');
  if (bi >= 0 && argv[bi + 1]) {
    base = argv[bi + 1];
    source = 'аргумент --base';
  }
  if (!base) {
    base = baseFromPlan(path.resolve(cwd, info.planRel));
    if (base) source = '«Залито на прод» в ' + info.planRel;
  }
  if (!base) {
    const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).out.trim().split(/\s+/).filter(Boolean);
    base = roots[roots.length - 1];
    source = 'первый коммит репозитория';
  }
  if (!base || !git(cwd, ['rev-parse', '--verify', '--quiet', base + '^{commit}']).ok) {
    console.error('deploy-list: коммит ' + base + ' не найден');
    return 1;
  }
  const rules = parseRules([...ALWAYS_SKIP, ...info.params.list('Не выкладывать')]);
  const items = parseNameStatusZ(git(cwd, ['diff', '--name-status', '--no-renames', '-z', base + '..HEAD']).out)
    .filter((it) => !matchRules(it.path, rules));
  const upload = items.filter((it) => it.status !== 'D');
  const del = items.filter((it) => it.status === 'D');
  const always = /always/i.test(info.params.get('Выкладка', ''));
  const lines = ['База: ' + git(cwd, ['rev-parse', '--short', base]).out.trim() + ' (' + source + ')'];
  if (always) {
    lines.push('', 'Выкладка: PhpStorm Always — заливает PhpStorm при сохранении, показаны только удаления.');
  } else {
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

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/deploy-list.test.js` → PASS (4).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 3.2 ✅ (+ хеш 3.1), 3.3 ⏳, «Сейчас» → 3.3.

```bash
git add -- plugins/kit/scripts/deploy-list.js tests/deploy-list.test.js docs/progress.md
git commit -m "3.2: deploy-list — что залить и что удалить на сервере с последней выкладки" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/deploy-list.js tests/deploy-list.test.js docs/progress.md
```

### Задача 3.3: `site-probe.js` и `check-closed.js` — проверки снаружи

**Файлы:**
- Создать: `plugins/kit/scripts/site-probe.js`, `plugins/kit/scripts/check-closed.js`, `tests/net.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `lib/project.js` (`kitInfo`), `lib/paths.js`; `tests/helpers.js` (`runScriptAsync`, `makeProject`, `writeFiles`, `tmpDir`), `tests/fixtures.js` (`paramsMd`).
- Даёт:
  - `node site-probe.js <url>` — строки `URL: …`, `Server: …`, `X-Powered-By: …`, `PHP: 7.4.33 → C:\OSPanel\modules\PHP-7.4\php.exe (есть)` или подсказка про `echo PHP_VERSION;`; код 0 / 1 (нет ответа). Папка модулей — `KIT_PHP_MODULES` или `C:\OSPanel\modules`. Экспорт `phpExeFor(version) → {exe, exists}|null`.
  - `node check-closed.js <url> [--dirs docs,.claude]` в корне проекта — строка на файл/папку: `код вердикт путь[ — подсказка]`, итог `Итого: N, закрыто/нет: M, ОТКРЫТО: K, прочее: X`; код 0 / 1. Используются `/kit:project-init` (5.2).

- [ ] **Шаг 1: написать падающие тесты**

`tests/net.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { runScriptAsync, makeProject, writeFiles, tmpDir } = require('./helpers');
const { paramsMd } = require('./fixtures');

function serve(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(decodeURIComponent(req.url));
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

test('site-probe: версия PHP из X-Powered-By и путь к php.exe', async () => {
  const { server, url } = await serve((req, res) => {
    res.setHeader('X-Powered-By', 'PHP/7.4.33');
    res.setHeader('Server', 'nginx');
    res.end('ok');
  });
  const modules = writeFiles(tmpDir(), { 'PHP-7.4/php.exe': '' });
  try {
    const r = await runScriptAsync('site-probe.js', { args: [url], env: { KIT_PHP_MODULES: modules } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Server: nginx/);
    assert.match(r.stdout, /X-Powered-By: PHP\/7\.4\.33/);
    assert.match(r.stdout, /PHP: 7\.4\.33 → .*PHP-7\.4.*php\.exe \(есть\)/);
  } finally {
    server.close();
  }
});

test('site-probe: версия скрыта — подсказка про консоль; нет ответа — код 1', async () => {
  const { server, url } = await serve((req, res) => res.end('ok'));
  try {
    const r = await runScriptAsync('site-probe.js', { args: [url] });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /echo PHP_VERSION/);
  } finally {
    server.close();
  }
  const dead = await runScriptAsync('site-probe.js', { args: ['http://127.0.0.1:1'] });
  assert.equal(dead.code, 1);
});

test('check-closed: 403 — закрыт, 404 — нет, 200 — ОТКРЫТ с подсказкой; исключения не запрашиваются', async () => {
  const codes = { '/docs/': 403, '/docs/a.md': 403, '/docs/b.pdf': 200, '/docs/план.md': 403, '/.claude/': 403, '/.claude/CLAUDE.md': 404 };
  const { server, url, seen } = await serve((req, res) => {
    res.statusCode = codes[decodeURIComponent(req.url)] || 500;
    res.end();
  });
  const dir = makeProject({
    '.claude/CLAUDE.md': paramsMd({ 'Не выкладывать': '.claude/scripts' }),
    '.claude/scripts/01-x.php': 'x',
    'docs/a.md': 'a', 'docs/b.pdf': 'b', 'docs/план.md': 'п',
  });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /200\s+ОТКРЫТ\s+docs\/b\.pdf — nginx отдаёт \.pdf/);
    assert.match(r.stdout, /403\s+закрыт\s+docs\/план\.md/);
    assert.match(r.stdout, /404\s+нет на сервере\s+\.claude\/CLAUDE\.md/);
    assert.match(r.stdout, /ОТКРЫТО: 1/);
    assert.ok(!seen.some((p) => p.includes('scripts')), seen.join(', '));
  } finally {
    server.close();
  }
});

test('check-closed: всё закрыто — код 0', async () => {
  const { server, url } = await serve((req, res) => {
    res.statusCode = 403;
    res.end();
  });
  const dir = makeProject({ 'docs/progress.md': '# журнал', '.claude/CLAUDE.md': '# правила' });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /ОТКРЫТО: 0/);
  } finally {
    server.close();
  }
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/net.test.js`
Ожидается: FAIL — скриптов нет.

- [ ] **Шаг 3: написать скрипты**

`plugins/kit/scripts/site-probe.js`:

```js
#!/usr/bin/env node
'use strict';
// Версия PHP сайта по заголовку X-Powered-By и путь к такому же php.exe в OSPanel.
// Запуск: node site-probe.js <url>
const fs = require('fs');
const path = require('path');

const MODULES = process.env.KIT_PHP_MODULES || 'C:\\OSPanel\\modules';

function phpExeFor(version) {
  const m = /^(\d+)\.(\d+)/.exec(version || '');
  if (!m) return null;
  const exe = path.join(MODULES, 'PHP-' + m[1] + '.' + m[2], 'php.exe');
  return { exe, exists: fs.existsSync(exe) };
}

async function probe(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'kit-site-probe' } });
  try {
    await res.body?.cancel();
  } catch (e) {
    // тело не нужно
  }
  const powered = res.headers.get('x-powered-by') || '';
  const m = /PHP\/(\d+\.\d+(?:\.\d+)?)/i.exec(powered);
  return { status: res.status, finalUrl: res.url, server: res.headers.get('server') || '', powered, php: m ? m[1] : null };
}

async function main(argv) {
  const url = argv[0];
  if (!url) {
    console.error('Использование: node site-probe.js <url>');
    return 1;
  }
  let r;
  try {
    r = await probe(url);
  } catch (e) {
    console.error('site-probe: нет ответа от ' + url + ': ' + e.message);
    return 1;
  }
  const lines = [
    'URL: ' + url + (r.finalUrl && r.finalUrl !== url ? ' → ' + r.finalUrl : '') + ' — ' + r.status,
    'Server: ' + (r.server || '—'),
    'X-Powered-By: ' + (r.powered || '—'),
  ];
  if (r.php) {
    const exe = phpExeFor(r.php);
    lines.push('PHP: ' + r.php + ' → ' + exe.exe + (exe.exists ? ' (есть)' : ' (НЕТ в OSPanel — поставить модуль или взять ближайшую версию)'));
  } else {
    lines.push('PHP: сервер версию не сообщает — узнать через /kit:bitrix-console (echo PHP_VERSION;) или спросить пользователя');
  }
  console.log(lines.join('\n'));
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { phpExeFor, probe };
```

`plugins/kit/scripts/check-closed.js`:

```js
#!/usr/bin/env node
'use strict';
// Проверка снаружи: служебные папки закрыты от веба — 403 на каждый файл и на саму папку.
// На сервер уезжает содержимое папки (не git), поэтому обходим диск; исключения — .git, .idea и «Не выкладывать».
// Запуск в корне проекта: node check-closed.js <url> [--dirs docs,.claude]
const fs = require('fs');
const path = require('path');
const { kitInfo } = require('./lib/project');
const { parseRules, matchRules } = require('./lib/paths');

// Расширения, которые nginx часто отдаёт сам, мимо .htaccess (epsilon, 2026-09-22).
const NGINX_STATIC = ['bmp', 'css', 'doc', 'docx', 'eot', 'gif', 'gz', 'ico', 'jpeg', 'jpg', 'js', 'mp3', 'mp4', 'otf',
  'pdf', 'png', 'ppt', 'pptx', 'rar', 'svg', 'tar', 'tif', 'ttf', 'txt', 'webm', 'webp', 'woff', 'woff2', 'xls', 'xlsx', 'zip'];

function walk(root, rel, rules, out) {
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const r = rel + '/' + name;
    if (matchRules(r, rules)) continue;
    if (fs.statSync(path.join(root, r)).isDirectory()) walk(root, r, rules, out);
    else out.push(r);
  }
  return out;
}

function urlFor(base, rel) {
  return base.replace(/\/+$/, '') + '/' + rel.split('/').map(encodeURIComponent).join('/');
}

async function status(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'kit-check-closed' } });
    try {
      await res.body?.cancel();
    } catch (e) {
      // тело не нужно
    }
    return res.status;
  } catch (e) {
    return 0;
  }
}

function verdict(code) {
  if (code === 403) return 'закрыт';
  if (code === 404) return 'нет на сервере';
  if (code >= 200 && code < 300) return 'ОТКРЫТ';
  if (code === 0) return 'нет ответа';
  return 'код ' + code;
}

async function main(argv) {
  const base = argv[0];
  if (!base || base.startsWith('--')) {
    console.error('Использование: node check-closed.js <url> [--dirs docs,.claude]');
    return 1;
  }
  const di = argv.indexOf('--dirs');
  const dirs = (di >= 0 && argv[di + 1] ? argv[di + 1] : 'docs,.claude').split(',').map((s) => s.trim()).filter(Boolean);
  const cwd = process.cwd();
  const rules = parseRules(['.git', '.idea', ...kitInfo(cwd).params.list('Не выкладывать')]);
  const targets = [];
  for (const d of dirs) {
    if (matchRules(d, rules) || !fs.existsSync(path.join(cwd, d))) continue;
    targets.push({ rel: d + '/', url: urlFor(base, d) + '/' });
    for (const f of walk(cwd, d, rules, [])) targets.push({ rel: f, url: urlFor(base, f) });
  }
  let open = 0;
  let bad = 0;
  const lines = [];
  for (const t of targets) {
    const code = await status(t.url);
    const v = verdict(code);
    if (v === 'ОТКРЫТ') open++;
    if (v !== 'закрыт' && v !== 'нет на сервере') bad++;
    let note = '';
    if (v === 'ОТКРЫТ') {
      const ext = (t.rel.split('.').pop() || '').toLowerCase();
      note = NGINX_STATIC.includes(ext)
        ? ' — nginx отдаёт .' + ext + ' мимо .htaccess: переименовать в .' + ext + '.php или убрать из выкладки'
        : ' — .htaccess не действует: проверить, дошёл ли он до сервера';
    }
    lines.push(String(code || '—').padEnd(4) + ' ' + v.padEnd(15) + t.rel + note);
  }
  console.log(lines.join('\n'));
  console.log('\nИтого: ' + targets.length + ', закрыто/нет: ' + (targets.length - bad) + ', ОТКРЫТО: ' + open + ', прочее: ' + (bad - open));
  return bad ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { verdict, urlFor };
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/net.test.js` → PASS (4).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 3.3 ✅ (+ хеш 3.2), 3.4 ⏳, «Сейчас» → 3.4.

```bash
git add -- plugins/kit/scripts/site-probe.js plugins/kit/scripts/check-closed.js tests/net.test.js docs/progress.md
git commit -m "3.3: site-probe (версия PHP прода) и check-closed (403 на каждый файл docs/ и .claude/)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/scripts/site-probe.js plugins/kit/scripts/check-closed.js tests/net.test.js docs/progress.md
```

### Задача 3.4: скрипты Командной PHP-строки и `md5-check.js`

**Файлы:**
- Создать: `plugins/kit/skills/bitrix-console/scripts/inventory.php`, `plugins/kit/skills/bitrix-console/scripts/delete-list.php`, `plugins/kit/skills/bitrix-console/scripts/check-files.php`, `plugins/kit/scripts/md5-check.js`, `tests/console-scripts.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `tests/helpers.js` (`runScript`, `makeProject`, `writeFiles`, `tmpDir`, `runPhp`, `phpLint`, `hasPhp`, `PLUGIN`).
- Даёт: три скрипта для консоли (без `<?php`, без `use`); `check-files.php` содержит строку-метку `$files = []; // KIT:FILES`; CLI `node md5-check.js <файлы…>` → на stdout готовый код для консоли, код 0 / 1 (нет файлов или ошибка чтения); экспорт `build(files, cwd) → string`. Вывод `check-files.php`: строки `ок | путь`, `ок | путь (переводы строк отличаются)`, `ОТЛИЧАЕТСЯ | путь`, `нет | путь`. Вывод `delete-list.php`: `СУХОЙ ПРОГОН…`/`УДАЛЕНИЕ`, строки `есть`, `удалён`, `НЕ УДАЛЁН`, `ПРОПУЩЕН`, `нет`, `папка удалена`, либо `… — стоп.` Используются скиллом `/kit:bitrix-console` (5.3).

- [ ] **Шаг 1: написать падающие тесты**

`tests/console-scripts.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, runPhp, phpLint, hasPhp, PLUGIN } = require('./helpers');

const DIR = path.join(PLUGIN, 'skills', 'bitrix-console', 'scripts');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const docRoot = (dir) => "<?php\n$_SERVER['DOCUMENT_ROOT'] = '" + dir.replace(/\\/g, '/') + "';\n";

function configure(src, cfg) {
  const list = (a) => '[' + a.map((s) => "'" + s + "'").join(', ') + ']';
  return src
    .replace(/^\$dryRun = .*$/m, () => '$dryRun = ' + (cfg.dryRun ? 'true' : 'false') + ';')
    .replace(/^\$base = .*$/m, () => "$base = '" + cfg.base + "';")
    .replace(/^\$allowedExt = .*$/m, () => '$allowedExt = ' + list(cfg.ext) + ';')
    .replace(/^\$files = \[[\s\S]*?\n\];/m, () => '$files = ' + list(cfg.files) + ';')
    .replace(/^\$removeEmptyDirs = .*$/m, () => '$removeEmptyDirs = ' + (cfg.rmdirs ? 'true' : 'false') + ';');
}

for (const v of ['7.2', '7.4', '8.3']) {
  test(`скрипты консоли: без <?php и use, php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const src = read(name);
      assert.doesNotMatch(src, /<\?php/, name);
      assert.doesNotMatch(src, /^\s*use\s+[\\A-Za-z]/m, name);
      const r = phpLint(v, '<?php\n' + src);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
  });
}

test('md5-check: ок, переводы строк, отличается, нет', { skip: !hasPhp('7.4') }, () => {
  const project = makeProject({ 'a.txt': 'one\ntwo\n', 'b.txt': 'x\ny\n', 'c.txt': 'same\n', 'd.txt': 'gone\n' });
  const server = writeFiles(tmpDir(), { 'a.txt': 'one\ntwo\n', 'b.txt': 'x\r\ny\r\n', 'c.txt': 'changed\n' });
  const gen = runScript('md5-check.js', { args: ['a.txt', 'b.txt', 'c.txt', 'd.txt'], cwd: project });
  assert.equal(gen.code, 0, gen.stderr);
  assert.doesNotMatch(gen.stdout, /<\?php/);
  assert.match(gen.stdout, /файлов: 4/);
  const r = runPhp('7.4', docRoot(server) + gen.stdout);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ок \| a\.txt\n/);
  assert.match(r.stdout, /ок \| b\.txt \(переводы строк отличаются\)/);
  assert.match(r.stdout, /ОТЛИЧАЕТСЯ \| c\.txt/);
  assert.match(r.stdout, /нет \| d\.txt/);
  assert.match(r.stdout, /Итого: ок 2, отличается 1, нет 1/);
});

test('md5-check: без файлов — код 1', () => {
  assert.equal(runScript('md5-check.js', { cwd: makeProject({}) }).code, 1);
});

test('delete-list: сухой прогон ничего не удаляет; удаление — только внутри базы и по расширениям', { skip: !hasPhp('7.4') }, () => {
  const site = writeFiles(tmpDir(), { 'css/a.scss': 'a', 'css/b.css': 'b', 'css/sub/d.scss': 'd', 'outside.scss': 'o' });
  const cfg = { base: '/css', ext: ['scss'], files: ['a.scss', 'b.css', '../outside.scss', 'nope.scss', 'sub/d.scss'], rmdirs: true };
  const dry = runPhp('7.4', docRoot(site) + configure(read('delete-list.php'), { ...cfg, dryRun: true }));
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /СУХОЙ ПРОГОН/);
  assert.match(dry.stdout, /есть\s+a\.scss/);
  assert.match(dry.stdout, /ПРОПУЩЕН\s+b\.css/);
  assert.match(dry.stdout, /ПРОПУЩЕН\s+\.\.\/outside\.scss/);
  assert.match(dry.stdout, /нет\s+nope\.scss/);
  assert.ok(fs.existsSync(path.join(site, 'css/a.scss')));
  const real = runPhp('7.4', docRoot(site) + configure(read('delete-list.php'), { ...cfg, dryRun: false }));
  assert.equal(real.code, 0, real.stderr);
  assert.match(real.stdout, /удалён\s+a\.scss/);
  assert.match(real.stdout, /удалён\s+sub\/d\.scss/);
  assert.match(real.stdout, /папка удалена/);
  assert.ok(!fs.existsSync(path.join(site, 'css/a.scss')));
  assert.ok(!fs.existsSync(path.join(site, 'css/sub')));
  assert.ok(fs.existsSync(path.join(site, 'css/b.css')));
  assert.ok(fs.existsSync(path.join(site, 'outside.scss')));
});

test('delete-list: база — корень сайта или вне его — стоп', { skip: !hasPhp('7.4') }, () => {
  const site = writeFiles(tmpDir(), { 'a.scss': 'a' });
  for (const base of ['/', '/..']) {
    const r = runPhp('7.4', docRoot(site) + configure(read('delete-list.php'), { base, ext: ['scss'], files: ['a.scss'], dryRun: false, rmdirs: false }));
    assert.match(r.stdout, /стоп/, base);
  }
  assert.ok(fs.existsSync(path.join(site, 'a.scss')));
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/console-scripts.test.js`
Ожидается: FAIL — `ENOENT … inventory.php`.

- [ ] **Шаг 3: написать скрипты**

`plugins/kit/skills/bitrix-console/scripts/inventory.php`:

```php
// Инвентаризация сайта на 1С-Битрикс: окружение, сайты и шаблоны, сторонние модули,
// инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы b_file.
// Только чтение, ничего не меняет. Запуск: /kit:bitrix-console (Командная PHP-строка). Код без <?php.

global $DB;
\Bitrix\Main\Loader::includeModule('iblock');

echo "<pre>";

echo "=== ОКРУЖЕНИЕ\n";
echo 'PHP ' . PHP_VERSION . ' | main ' . (defined('SM_VERSION') ? SM_VERSION : '?')
    . ' | ' . (defined('BX_UTF') && BX_UTF ? 'UTF-8' : 'не UTF-8')
    . ' | DOCUMENT_ROOT ' . $_SERVER['DOCUMENT_ROOT'] . "\n";
echo 'Агенты на cron: ' . \COption::GetOptionString('main', 'agents_use_crontab', 'N')
    . ' | check_agents: ' . \COption::GetOptionString('main', 'check_agents', 'Y') . "\n";

echo "\n=== САЙТЫ: ID | активен | по умолчанию | папка | домен | название\n";
$rsSite = \Bitrix\Main\SiteTable::getList(['order' => ['SORT' => 'ASC']]);
while ($site = $rsSite->fetch()) {
    echo $site['LID'] . ' | ' . $site['ACTIVE'] . ' | ' . $site['DEF'] . ' | ' . $site['DIR']
        . ' | ' . $site['SERVER_NAME'] . ' | ' . $site['NAME'] . "\n";
    $rsTpl = \CSite::GetTemplateList($site['LID']);
    while ($tpl = $rsTpl->Fetch()) {
        $cond = trim((string) $tpl['CONDITION']);
        echo '    шаблон ' . $tpl['TEMPLATE'] . ($cond !== '' ? ' — условие: ' . $cond : ' — без условия') . "\n";
    }
}

echo "\n=== ПАПКИ ШАБЛОНОВ\n";
foreach (['/local/templates', '/bitrix/templates'] as $dir) {
    $list = glob($_SERVER['DOCUMENT_ROOT'] . $dir . '/*', GLOB_ONLYDIR);
    echo $dir . ': ' . ($list ? implode(', ', array_map('basename', $list)) : '—') . "\n";
}

echo "\n=== СТОРОННИЕ МОДУЛИ: id | версия\n";
foreach (\Bitrix\Main\ModuleManager::getInstalledModules() as $id => $module) {
    if (strpos($id, '.') !== false) {
        echo $id . ' | ' . \Bitrix\Main\ModuleManager::getVersion($id) . "\n";
    }
}

echo "\n=== ИНФОБЛОКИ: #ID [тип] CODE — название | активен | элементы активные/все | разделы | URL списка\n";
$rsIb = \CIBlock::GetList(['IBLOCK_TYPE' => 'ASC', 'ID' => 'ASC'], ['CHECK_PERMISSIONS' => 'N']);
while ($ib = $rsIb->Fetch()) {
    $all = \CIBlockElement::GetList([], ['IBLOCK_ID' => $ib['ID'], 'CHECK_PERMISSIONS' => 'N'], []);
    $active = \CIBlockElement::GetList([], ['IBLOCK_ID' => $ib['ID'], 'ACTIVE' => 'Y', 'CHECK_PERMISSIONS' => 'N'], []);
    $sections = \CIBlockSection::GetCount(['IBLOCK_ID' => $ib['ID']]);
    echo '#' . $ib['ID'] . ' [' . $ib['IBLOCK_TYPE_ID'] . '] ' . $ib['CODE'] . ' — ' . $ib['NAME']
        . ' | ' . $ib['ACTIVE'] . ' | ' . $active . '/' . $all . ' | ' . $sections . ' | ' . $ib['LIST_PAGE_URL'] . "\n";
    $props = [];
    $rsProp = \CIBlockProperty::GetList(['SORT' => 'ASC'], ['IBLOCK_ID' => $ib['ID']]);
    while ($p = $rsProp->Fetch()) {
        $props[] = $p['CODE'] . ':' . $p['PROPERTY_TYPE'] . ($p['USER_TYPE'] ? '/' . $p['USER_TYPE'] : '')
            . ($p['MULTIPLE'] == 'Y' ? '*' : '') . ' (' . $p['NAME'] . ')';
    }
    if ($props) {
        echo '    свойства: ' . implode('; ', $props) . "\n";
    }
}

echo "\n=== ПОЛЬЗОВАТЕЛЬСКИЕ ПОЛЯ разделов инфоблоков и HL-блоков\n";
$rsUf = \CUserTypeEntity::GetList(['ENTITY_ID' => 'ASC', 'SORT' => 'ASC'], []);
while ($uf = $rsUf->Fetch()) {
    if (strpos($uf['ENTITY_ID'], 'IBLOCK_') === 0 || strpos($uf['ENTITY_ID'], 'HLBLOCK_') === 0) {
        echo $uf['ENTITY_ID'] . ' ' . $uf['FIELD_NAME'] . ':' . $uf['USER_TYPE_ID'] . ($uf['MULTIPLE'] == 'Y' ? '*' : '') . "\n";
    }
}

echo "\n=== HL-БЛОКИ\n";
if (\Bitrix\Main\Loader::includeModule('highloadblock')) {
    $rsHl = \Bitrix\Highloadblock\HighloadBlockTable::getList(['order' => ['ID' => 'ASC']]);
    while ($hl = $rsHl->fetch()) {
        echo 'HL#' . $hl['ID'] . ' ' . $hl['NAME'] . ' (' . $hl['TABLE_NAME'] . ")\n";
    }
} else {
    echo "модуль highloadblock не установлен\n";
}

echo "\n=== ФАЙЛЫ b_file: модуль | тип | файлов | МБ (40 крупнейших групп)\n";
$res = $DB->Query("SELECT MODULE_ID, SUBSTRING_INDEX(CONTENT_TYPE, '/', 1) AS T, COUNT(*) AS CNT, ROUND(SUM(FILE_SIZE) / 1048576) AS MB"
    . " FROM b_file GROUP BY MODULE_ID, T ORDER BY MB DESC LIMIT 40");
while ($row = $res->Fetch()) {
    echo $row['MODULE_ID'] . ' | ' . $row['T'] . ' | ' . $row['CNT'] . ' | ' . $row['MB'] . "\n";
}

echo "</pre>";
```

`plugins/kit/skills/bitrix-console/scripts/delete-list.php`:

```php
// Удаление файлов на сервере строгим списком. МЕНЯЕТ сервер: запуск только с отдельного согласия пользователя.
// Порядок: сначала $dryRun = true (только показывает, что лежит на сервере), вывод — пользователю, потом $dryRun = false.
// Удаляет только файлы из $files внутри $base и только с расширениями из $allowedExt; путь проверяется через realpath.
// Запуск: /kit:bitrix-console (Командная PHP-строка). Код без <?php.

$dryRun = true;
$base = '/local/templates/ШАБЛОН/css';
$allowedExt = ['scss', 'map'];
$files = [
    'пример.scss',
];
$removeEmptyDirs = false;

$root = realpath(rtrim($_SERVER['DOCUMENT_ROOT'], '/\\'));
$baseReal = $root === false ? false : realpath($root . DIRECTORY_SEPARATOR . trim($base, '/\\'));
echo "<pre>";
echo ($dryRun ? "СУХОЙ ПРОГОН — ничего не удаляется" : "УДАЛЕНИЕ") . "\n";
echo "База: " . $base . "\n\n";
if ($root === false || $baseReal === false || !is_dir($baseReal) || $baseReal === $root
    || strpos($baseReal . DIRECTORY_SEPARATOR, $root . DIRECTORY_SEPARATOR) !== 0) {
    echo "База не найдена, совпадает с корнем сайта или лежит вне него — стоп.\n</pre>";
    return;
}
$allowedExt = array_map('strtolower', $allowedExt);
$touched = [];
foreach ($files as $rel) {
    $path = $baseReal . DIRECTORY_SEPARATOR . ltrim($rel, '/\\');
    if (!file_exists($path)) {
        echo "нет         " . $rel . "\n";
        continue;
    }
    $real = realpath($path);
    $ext = strtolower(pathinfo((string) $real, PATHINFO_EXTENSION));
    if ($real === false || strpos($real, $baseReal . DIRECTORY_SEPARATOR) !== 0 || !is_file($real) || !in_array($ext, $allowedExt, true)) {
        echo "ПРОПУЩЕН    " . $rel . " — вне базы, не файл или расширение не из списка\n";
        continue;
    }
    if ($dryRun) {
        echo "есть        " . $rel . " (" . filesize($real) . " байт)\n";
    } else {
        echo (@unlink($real) ? "удалён      " : "НЕ УДАЛЁН   ") . $rel . "\n";
    }
    $touched[dirname($real)] = true;
}
if ($removeEmptyDirs && !$dryRun) {
    $dirs = array_keys($touched);
    usort($dirs, function ($a, $b) {
        return strlen($b) - strlen($a);
    });
    foreach ($dirs as $dir) {
        while ($dir !== $baseReal && strpos($dir, $baseReal . DIRECTORY_SEPARATOR) === 0 && is_dir($dir)
            && count(array_diff(scandir($dir), ['.', '..'])) === 0) {
            $name = substr($dir, strlen($baseReal) + 1);
            if (!@rmdir($dir)) {
                echo "папку не удалить " . $name . "\n";
                break;
            }
            echo "папка удалена " . $name . "\n";
            $dir = dirname($dir);
        }
    }
}
echo "</pre>";
```

`plugins/kit/skills/bitrix-console/scripts/check-files.php`:

```php
// Сверка файлов на сервере с локальными по md5. Только чтение.
// Список файлов вставляет `node md5-check.js <файлы…>` (плагин kit); как есть не запускать — список пуст.
// Запуск: /kit:bitrix-console (Командная PHP-строка). Код без <?php.

$files = []; // KIT:FILES — 'путь от корня сайта' => ['md5 как есть', 'md5 с LF']

$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\');
$total = ['ок' => 0, 'ОТЛИЧАЕТСЯ' => 0, 'нет' => 0];
echo "<pre>";
echo "Файлов в списке: " . count($files) . "\n\n";
foreach ($files as $rel => $sums) {
    $path = $root . '/' . $rel;
    if (!is_file($path)) {
        $total['нет']++;
        echo "нет | " . $rel . "\n";
        continue;
    }
    $note = '';
    if (md5_file($path) === $sums[0]) {
        $status = 'ок';
    } elseif (md5(str_replace("\r\n", "\n", file_get_contents($path))) === $sums[1]) {
        $status = 'ок';
        $note = ' (переводы строк отличаются)';
    } else {
        $status = 'ОТЛИЧАЕТСЯ';
    }
    $total[$status]++;
    echo $status . ' | ' . $rel . $note . "\n";
}
echo "\nИтого: ок " . $total['ок'] . ", отличается " . $total['ОТЛИЧАЕТСЯ'] . ", нет " . $total['нет'] . "\n";
echo "</pre>";
```

`plugins/kit/scripts/md5-check.js`:

```js
#!/usr/bin/env node
'use strict';
// Печатает код для Командной PHP-строки: сверка md5 файлов на сервере с локальными.
// Запуск в корне проекта: node md5-check.js <файлы…> (пути от корня проекта = от корня сайта).
// Шаблон — skills/bitrix-console/scripts/check-files.php, список вставляется в строку «$files = []; // KIT:FILES».
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'bitrix-console', 'scripts', 'check-files.php');
const MARK = /^\$files = \[\];.*KIT:FILES.*$/m;

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function build(files, cwd) {
  const rows = files.map((f) => {
    const rel = f.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    const buf = fs.readFileSync(path.join(cwd, rel));
    const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    return '    ' + q(rel) + ' => [' + q(md5(buf)) + ', ' + q(md5(lf)) + '],';
  });
  const tpl = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
  if (!MARK.test(tpl)) throw new Error('в check-files.php нет строки «$files = []; // KIT:FILES»');
  const g = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' });
  const commit = g.status === 0 ? g.stdout.trim() : '—';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const head = '// Сгенерировано md5-check.js ' + stamp + ' UTC, коммит ' + commit + ', файлов: ' + rows.length + '\n';
  return head + tpl.replace(MARK, () => '$files = [\n' + rows.join('\n') + '\n];');
}

function main(argv) {
  if (!argv.length) {
    console.error('Использование: node md5-check.js <файлы…>');
    return 1;
  }
  try {
    process.stdout.write(build(argv, process.cwd()));
    return 0;
  } catch (e) {
    console.error('md5-check: ' + e.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { build };
```

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/console-scripts.test.js` → PASS (7, если все три версии PHP есть).
Запуск: `node --test tests/*.test.js` → PASS (все).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 3.4 ✅ (+ хеш 3.3), этап 4 с 4.1 ⏳, «Сейчас» → 4.1.

```bash
git add -- plugins/kit/skills/bitrix-console/scripts plugins/kit/scripts/md5-check.js tests/console-scripts.test.js docs/progress.md
git commit -m "3.4: скрипты Командной PHP-строки — инвентаризация, удаление строгим списком, сверка md5; md5-check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/skills/bitrix-console/scripts plugins/kit/scripts/md5-check.js tests/console-scripts.test.js docs/progress.md
```

---

## Этап 4 — агенты

### Задача 4.1: `kit:docs-keeper` и `kit:git-keeper`

**Файлы:**
- Создать: `plugins/kit/agents/docs-keeper.md`, `plugins/kit/agents/git-keeper.md`, `tests/content.test.js`
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: `scripts/secret-scan.js` (3.1) — git-keeper вызывает `node "<KIT_ROOT или ${CLAUDE_PLUGIN_ROOT}>/scripts/secret-scan.js" --cached -- <FILES>`.
- Даёт: агенты `kit:docs-keeper` (вход — блоки STEP, STATUS, SUMMARY, NEXT, COMMITS, STAGE, DECISIONS, BUGS, PROD_TODO, DEPLOY, NOTES, RULES; отчёт — изменения, «Сейчас», список изменённых файлов) и `kit:git-keeper` (вход — FILES, MESSAGE, BODY, COAUTHOR, KIT_ROOT; отчёт — хеш, файлы, статус, подпись). `tests/content.test.js` — функция `frontmatter(file) → {fm, body}` и проверка ссылок `${CLAUDE_PLUGIN_ROOT}/…`; задачи 5.x дописывают в этот файл свои тесты.

- [ ] **Шаг 1: написать падающие тесты**

`tests/content.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN } = require('./helpers');

function frontmatter(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  assert.ok(m, 'нет frontmatter: ' + file);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { fm, body: src.slice(m[0].length) };
}

const agent = (name) => frontmatter(path.join(PLUGIN, 'agents', name + '.md'));
const skill = (name) => frontmatter(path.join(PLUGIN, 'skills', name, 'SKILL.md'));

test('docs-keeper: sonnet, без оболочки, читает параметры, COMMITS и отчёт со списком файлов', () => {
  const { fm, body } = agent('docs-keeper');
  assert.equal(fm.name, 'docs-keeper');
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.tools, 'Read, Edit, Write, Grep, Glob');
  assert.ok(fm.description.length > 40);
  for (const s of ['Параметры для агентов', 'COMMITS', 'STEP', 'DEPLOY', 'RULES', 'Сейчас', 'Залито на прод', 'Удалить с сервера', 'список изменённых файлов', '/kit:project-init']) {
    assert.ok(body.includes(s), s);
  }
});

test('git-keeper: haiku, один коммит, COAUTHOR дословно, запреты, secret-scan', () => {
  const { fm, body } = agent('git-keeper');
  assert.equal(fm.name, 'git-keeper');
  assert.equal(fm.model, 'haiku');
  assert.equal(fm.tools, 'PowerShell, Bash, Read, Grep, Glob');
  for (const s of ['COAUTHOR', 'дословно', 'не больше одного коммита', '--diff-filter=D', 'secret-scan.js', 'KIT_ROOT',
    'Не коммитить', 'push', 'commit --amend', 'git add .', '--no-verify', 'stash', 'reset']) {
    assert.ok(body.includes(s), s);
  }
  assert.doesNotMatch(body, /Co-Authored-By: Claude/, 'подпись не зашивается в агента');
});

test('ссылки ${CLAUDE_PLUGIN_ROOT}/… в агентах и скиллах ведут на существующие файлы', () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.md')) files.push(p);
  });
  for (const dir of ['agents', 'skills']) if (fs.existsSync(path.join(PLUGIN, dir))) walk(path.join(PLUGIN, dir));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      const target = m[1].replace(/[.,)]+$/, '').replace(/\/$/, '');
      assert.ok(fs.existsSync(path.join(PLUGIN, target)), path.relative(PLUGIN, f) + ' → ' + target);
    }
  }
});

module.exports = { frontmatter, agent, skill };
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/content.test.js`
Ожидается: FAIL — `ENOENT … agents/docs-keeper.md`.

- [ ] **Шаг 3: написать агентов**

`plugins/kit/agents/docs-keeper.md`:

````markdown
---
name: docs-keeper
description: Ведёт журнал работ проекта, план выкладки на прод и правила проекта (.claude/CLAUDE.md) по блокам STEP/STATUS/SUMMARY/NEXT и необязательным COMMITS, STAGE, DECISIONS, BUGS, PROD_TODO, DEPLOY, NOTES, RULES, которые основной агент передаёт после проверенного шага (обычно из /kit:step-done). Код и git не трогает.
tools: Read, Edit, Write, Grep, Glob
model: sonnet
---

Ты ведёшь документы проекта в текущей рабочей папке — это корень проекта. Код проекта и git не трогаешь, команды оболочки не запускаешь.

## С чего начать

1. Прочитай раздел «Параметры для агентов» в `.claude/CLAUDE.md`. Возьми из него:
   - `Журнал` — путь журнала работ (параметра нет — `docs/progress.md`);
   - `План выкладки` — путь плана выкладки (нет — `docs/deploy-prod.md`);
   - `ID шага` — формат ID шагов; строки в таблицах этапов держи в порядке ID.
2. Если файла журнала нет — ничего не создавай. Верни отчёт: «Журнала <путь> нет — нужен /kit:project-init».

## Что тебе передают

Обязательно:
- **STEP** — ID шага, например `0.3`, `2.1` или `Р6а`.
- **STATUS** — `✅` готово, `⏳` в работе, `⏸` отложено, `❌` отменено.
- **SUMMARY** — одна строка: что сделано и как проверено.
- **NEXT** — ID следующего шага и одна строка о нём.

Необязательно:
- **COMMITS** — хеши коммитов прошлых шагов: `1.1=abc1234, 0.7=def5678`.
- **STAGE** — название этапа, если начался новый.
- **DECISIONS** — новые решения пользователя: дата и текст.
- **BUGS** — новые баги или смена статуса: номер, текст, где находится.
- **PROD_TODO** — что не забыть при выкладке или переключении.
- **DEPLOY** — что дописать в план выкладки: любые из полей `Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`.
- **NOTES** — факты, которые нужно сохранить: ID, адреса, результаты проверок, материалы заказчика.
- **RULES** — изменения постоянных правил для `.claude/CLAUDE.md`.

## Как обновлять журнал

Разделы журнала по порядку: «Сейчас», «Решения», этапы `## Этап N — название` с таблицей `| Шаг | Статус | Что сделано | Коммит |`, «Материалы заказчика», «Баги на потом», «Прод: не забыть», «Справочник». Если раздела нет, а данные для него пришли, — заведи раздел на своём месте.

1. Прочитай файл целиком.
2. Найди строку STEP в таблице этапа. Обнови статус, описание (если SUMMARY точнее) и коммит (если он есть в COMMITS). Строки нет — добавь в таблицу своего этапа по порядку ID. Для нового STAGE заведи раздел с такой же таблицей.
3. Если STATUS = `✅`: у строки NEXT поставь `⏳` (строку добавь, если её нет) и обнови раздел «Сейчас»: этап, следующий шаг, блокеры и открытые вопросы.
4. COMMITS — заполни только **пустые** ячейки «Коммит» у названных шагов, заполненные не трогай. Хеш пиши в обратных кавычках: `` `abc1234` ``.
5. DECISIONS — допиши строки в таблицу «Решения». Старые строки не удаляй и не меняй.
6. BUGS — добавь или обнови строки в «Баги на потом». Исправленный баг не удаляй: пометь `✅` и укажи шаг, на котором исправлен.
7. PROD_TODO — допиши пункты в «Прод: не забыть».
8. NOTES — кратко добавь в подходящий раздел: «Материалы заказчика» или «Справочник».
9. Формат: markdown-таблицы, русский язык, даты `YYYY-MM-DD`. Пиши только то, что есть во входных данных, ничего не выдумывай. Существующие разделы не переписывай и не сокращай.

## Как обновлять план выкладки

Только если есть блок DEPLOY. Разделы плана: «Общие правила», «Залито на прод», «Удалить с сервера», «Чек-лист переключения».

1. `Файлы` (с `Коммит` и `Проверка`) — строка в таблицу «Залито на прод»: `| шаг | дата | файлы | коммит | проверка |`.
2. `Удалить` — строки в «Удалить с сервера»: `| путь | почему | |`. Колонка «Удалён» пустая, пока файл не удалён; когда сообщили об удалении — `✅ ДАТА, чем удалено`.
3. `Чек-лист` — пункты в «Чек-лист переключения» по порядку.
4. Пути — от корня сайта. Скрипты вставляй целиком в блоках ```php, чтобы их можно было выполнить без правок.
5. «Общие правила» не трогай. Ничего не удаляй.

Если файла плана выкладки нет — не создавай его, напиши об этом в отчёте.

## Как обновлять .claude/CLAUDE.md

Только если есть блок RULES: точечно добавь или измени пункты в нужном разделе. Файл — короткий свод правил, историю туда не пиши (для неё есть журнал). Раздел «Параметры для агентов» меняй, только если RULES прямо называет параметр, и сохраняй формат строк `- Ключ: значение`.

## Запрещено

- редактировать любые файлы, кроме журнала, плана выкладки и `.claude/CLAUDE.md`;
- запускать git и команды оболочки;
- менять код проекта.

## Отчёт

Верни:
- что изменилось в каждом файле, 2–5 строк;
- текст раздела «Сейчас» после правки;
- **список изменённых файлов** — пути от корня проекта, по одному в строке (основной агент передаст их в git-keeper).
````

`plugins/kit/agents/git-keeper.md`:

````markdown
---
name: git-keeper
description: Git для kit-проекта. Делает один коммит проверенного шага — только переданные файлы, — проверяет запрещённые пути и секреты, подпись Co-Authored-By пишет дословно из блока COAUTHOR. Вызывается основным агентом после docs-keeper (обычно из /kit:step-done). Не пушит и не переписывает историю.
tools: PowerShell, Bash, Read, Grep, Glob
model: haiku
---

Ты отвечаешь только за git в репозитории текущей рабочей папки (корень проекта, remote нет). Файлы проекта не создаёшь, не правишь и не удаляешь. **Один вызов — не больше одного коммита.**

## Что тебе передают

- **FILES** — пути файлов шага от корня репозитория, включая удалённые; можно папки.
- **MESSAGE** — заголовок коммита, начинается с ID шага: `2.1: скрытая страница новой главной`.
- **BODY** (необязательно) — 1–3 строки пояснения.
- **COAUTHOR** (необязательно) — строка вида `Co-Authored-By: … <…>`. Пиши её **дословно**, символ в символ. Никогда не подставляй название своей модели и не придумывай подпись сам: код шага писал основной агент. Нет блока COAUTHOR — коммит без подписи.
- **KIT_ROOT** (необязательно) — папка плагина kit.

## Порядок работы

1. Исходное состояние — выполни и сохрани вывод:
   ```
   git rev-parse --show-toplevel
   git status --porcelain=v1
   git diff --cached --name-status
   ```
   Корень репозитория должен совпадать с текущей папкой. Файлы, которые уже лежат в индексе, но не входят в FILES, в коммит не попадут — это обеспечивает п. 5.
2. Запрещённые пути. Прочитай параметр «Не коммитить» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`. Остановись и ничего не коммить, если среди FILES есть:
   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*`, `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`;
   - пути из параметра «Не коммитить» (запись `X (кроме Y)`: X запрещён, Y разрешён).
3. Добавь файлы шага в индекс. Пути, которые **уже помечены в индексе как удалённые**, повторно не добавляй — их показывает команда:
   ```
   git diff --cached --name-only --diff-filter=D
   ```
   Остальные пути из FILES добавь одной командой: `git add -A -- <пути>`. Ошибка — стоп, отчёт.
4. Проверка секретов в добавляемых строках. Скрипт — `${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js`; если передан KIT_ROOT — `<KIT_ROOT>/scripts/secret-scan.js`:
   ```
   node "<путь к secret-scan.js>" --cached -- <FILES>
   ```
   Код 1 — найдены секреты или запрещённые пути: стоп, ничего не коммить, верни вывод скрипта (значения в нём уже замаскированы). Код 2 или скрипт не найден — стоп, отчёт.
5. Коммит — **одна** команда, только эти пути:
   ```
   git commit -m "<MESSAGE>" [-m "<BODY>"] [-m "<COAUTHOR>"] -- <FILES>
   ```
   Не прошёл — стоп и отчёт с выводом. Второй попытки другим способом нет: не меняй команду, не делай второй коммит, не исправляй индекс.
6. Проверь и отчитайся:
   ```
   git show --stat --format="%h %s%n%n%b" HEAD
   git status --short
   ```
   Для большого коммита достаточно последней строки статистики. Прямо напиши, если в коммит попало что-то кроме FILES или подпись в сообщении отличается от COAUTHOR.

## Запрещено

- `push`, `pull`, `fetch`;
- `reset`, `restore` (в любом виде), `checkout`, `switch`, `stash`, `clean`;
- `rebase`, `merge`, `cherry-pick`, `revert`, `commit --amend`;
- `gc`, `prune`, `filter-branch`, изменение `git config`;
- `git add .`, `git add -A` без путей, `git add -f`, `--no-verify`;
- второй коммит в том же вызове;
- создание, правка и удаление файлов проекта;
- `cd` в основной оболочке — все команды из текущей папки.

Если что-то пошло не так или непонятно — ничего не исправляй сам. Верни отчёт с командами и их выводом.

## Особенности проектов

- `core.autocrlf=input`: предупреждения `CRLF will be replaced by LF` — норма.
- Первый коммит репозитория — копия прода (или дева). На сервер выкладывают не из git: git нужен, чтобы по шагам видеть, какие файлы изменились.

## Отчёт

- хеш и заголовок коммита;
- файлы коммита (или последняя строка статистики);
- вывод `git status --short`;
- подпись: совпала с COAUTHOR дословно / не передавалась;
- если остановился — на каком пункте и почему, с выводом команд.
````

- [ ] **Шаг 4: тесты проходят, плагин валиден**

Запуск: `node --test tests/content.test.js` → PASS (3).
Запуск: `claude plugin validate plugins/kit` → агенты распознаны, без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 4.1 ✅ (+ хеш 3.4), этап 5 с 5.1–5.3 (5.1 ⏳), «Сейчас» → 5.1.

```bash
git add -- plugins/kit/agents tests/content.test.js docs/progress.md
git commit -m "4.1: агенты kit:docs-keeper (sonnet) и kit:git-keeper (haiku) — параметры из проекта, один коммит, подпись дословно" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/agents tests/content.test.js docs/progress.md
```

---

## Этап 5 — скиллы

### Задача 5.1: `/kit:step-done` и `/kit:deploy-list`

**Файлы:**
- Создать: `plugins/kit/skills/step-done/SKILL.md`, `plugins/kit/skills/deploy-list/SKILL.md`
- Изменить: `tests/content.test.js` (дописать тесты), `docs/progress.md`

**Интерфейсы:**
- Использует: агенты `kit:docs-keeper`, `kit:git-keeper` (4.1), `scripts/deploy-list.js` (3.2).
- Даёт: `/kit:step-done [ID]` — вызывается Claude сам (без `disable-model-invocation`) и из `/kit:project-init` (5.2); `/kit:deploy-list [коммит]`.

- [ ] **Шаг 1: дописать падающие тесты**

В конец `tests/content.test.js` (до `module.exports`):

```js
test('step-done: агенты kit:, один коммит, COAUTHOR, запасной путь', () => {
  const { fm, body } = skill('step-done');
  assert.equal(fm.name, 'step-done');
  assert.ok(fm.description.length > 40);
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  for (const s of ['kit:docs-keeper', 'kit:git-keeper', 'rev-list --count', 'COAUTHOR', 'COMMITS', 'KIT_ROOT',
    'AskUserQuestion', 'general-purpose', '/kit:project-init']) {
    assert.ok(body.includes(s), s);
  }
});

test('deploy-list: вызывает скрипт и записывает выкладку через step-done', () => {
  const { fm, body } = skill('deploy-list');
  assert.equal(fm.name, 'deploy-list');
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/scripts/deploy-list.js'));
  assert.ok(body.includes('/kit:step-done'));
  assert.ok(body.includes('DEPLOY'));
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/content.test.js`
Ожидается: FAIL — `ENOENT … skills/step-done/SKILL.md`.

- [ ] **Шаг 3: написать скиллы**

`plugins/kit/skills/step-done/SKILL.md`:

````markdown
---
name: step-done
description: Закрыть проверенный шаг в kit-проекте — журнал и план выкладки обновляет агент kit:docs-keeper, ровно один коммит делает агент kit:git-keeper, результат проверяется. Вызывай сам сразу после того, как результат шага проверен; пользователь может вызвать и командой.
argument-hint: "[ID шага]"
---

# Закрытие шага

Закрывай только проверенный шаг: `php -l`, результат на сервере или в браузере — что положено по правилам проекта. Не проверен — сначала проверь.

Все команды — из корня проекта, без `cd`.

## 1. Исходное состояние

1. Убедись, что это kit-проект: есть файл журнала (параметр «Журнал» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`, по умолчанию `docs/progress.md`). Журнала нет — остановись и предложи `/kit:project-init`.
2. Запомни `HEAD` до закрытия шага:
   ```
   git rev-parse HEAD
   ```
3. Изменения шага:
   ```
   git status --porcelain=v1
   ```
   FILES — файлы, которые изменил этот шаг. Если в статусе есть изменения, которые к шагу не относятся или о которых ты не знаешь, — спроси пользователя через AskUserQuestion, что с ними делать (в этот коммит / оставить как есть). Пути, которые git-keeper не пропустит (`.idea/`, секреты, параметр «Не коммитить»), в FILES не включай.

## 2. Данные для docs-keeper

Собери из разговора:
- `STEP` — ID шага (аргумент команды, если передан), `STATUS`, `SUMMARY` (одна строка: что сделано и как проверено), `NEXT` (ID и одна строка);
- по необходимости `STAGE`, `DECISIONS` (дата `YYYY-MM-DD` и текст), `BUGS`, `PROD_TODO`, `DEPLOY` (`Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`), `NOTES`, `RULES`.

`COMMITS` — хеши прошлых шагов из истории git:
```
git log --format="%h %s" -50
```
ID коммита — часть заголовка до первого `: `. Передай пары `ID=хеш` за последние шаги (у одного ID несколько коммитов — все через запятую). docs-keeper заполнит только пустые ячейки «Коммит».

## 3. docs-keeper

Вызови агента `kit:docs-keeper` (Agent, subagent_type `kit:docs-keeper`) с блоками:
```
STEP: …
STATUS: …
SUMMARY: …
NEXT: …
COMMITS: …
<необязательные блоки>
```
Дождись отчёта: в нём «Сейчас» и список изменённых файлов.

## 4. git-keeper

Вызови агента `kit:git-keeper` (subagent_type `kit:git-keeper`):
```
FILES:
<файлы шага из п. 1.3>
<файлы из отчёта docs-keeper>
MESSAGE: <STEP>: <суть шага одной строкой>
BODY: <как проверено, 1–3 строки>
COAUTHOR: <строка Co-Authored-By>
KIT_ROOT: ${CLAUDE_PLUGIN_ROOT}
```
**COAUTHOR** — строка `Co-Authored-By: …` из твоих собственных системных инструкций о подписи коммитов, дословно. Таких инструкций нет — блок COAUTHOR не передавай.

## 5. Проверка

```
git rev-list --count <HEAD из п. 1.2>..HEAD
git log -1 --format=%B
git status --porcelain=v1
```
- новых коммитов ровно **1**;
- заголовок начинается с `<STEP>:`;
- строка COAUTHOR есть в сообщении дословно (если передавалась);
- файлов шага в статусе больше нет.

Что-то не так (0 или 2 коммита, чужая подпись, лишние файлы) — сообщи пользователю, что именно и какие команды это показали. Историю сам не чини: никаких `reset`, `amend`, `rebase`.

## 6. Ответ пользователю

Коротко: хеш и заголовок коммита, раздел «Сейчас» из отчёта docs-keeper. Хеш попадёт в журнал при следующем `/kit:step-done` — запоминать его не нужно.

## Если агенты не подхватились

Типов агентов `kit:docs-keeper` / `kit:git-keeper` нет — запусти агента general-purpose: в запрос — полный текст файла `${CLAUDE_PLUGIN_ROOT}/agents/docs-keeper.md` (или `${CLAUDE_PLUGIN_ROOT}/agents/git-keeper.md`) без заголовка `---` и те же блоки; модель — из заголовка файла (`sonnet` / `haiku`). Для git-keeper передай KIT_ROOT обязательно: в тексте, переданном так, `${CLAUDE_PLUGIN_ROOT}` не раскроется.
````

`plugins/kit/skills/deploy-list/SKILL.md`:

````markdown
---
name: deploy-list
description: Показать, что выложить на сервер и что удалить на нём с последней выкладки — по таблице «Залито на прод» плана выкладки или от указанного коммита. Для ручной выкладки; при автозаливке PhpStorm Always — только удаления.
argument-hint: "[коммит]"
---

# Список на выкладку

1. Запусти из корня проекта (аргумент команды, если передан, — это `--base`):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/deploy-list.js" [--base <коммит>]
   ```
2. Покажи пользователю вывод как есть: база и откуда она взята, «Залить», «Удалить с сервера», незакоммиченное.
3. Есть незакоммиченные изменения — скажи, что они в список не вошли: сначала шаг нужно закрыть (`/kit:step-done`).
4. Удаления на сервере делает пользователь (PhpStorm → Remote Host) или скрипт в Командной PHP-строке (`/kit:bitrix-console`, шаблон `delete-list.php` — только с его согласия и после сухого прогона).
5. Когда пользователь сообщит, что выложил, — запиши это через `/kit:step-done` блоком DEPLOY: `Файлы` (что залито), `Коммит` (HEAD на момент выкладки), `Удалить` (что осталось удалить на сервере), `Проверка` (что проверено на сервере).
````

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/content.test.js` → PASS (5).
Запуск: `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 5.1 ✅ (+ хеш 4.1), 5.2 ⏳, «Сейчас» → 5.2.

```bash
git add -- plugins/kit/skills/step-done plugins/kit/skills/deploy-list tests/content.test.js docs/progress.md
git commit -m "5.1: скиллы /kit:step-done (журнал → один коммит → проверка) и /kit:deploy-list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/skills/step-done plugins/kit/skills/deploy-list tests/content.test.js docs/progress.md
```

### Задача 5.2: `/kit:project-init` — шаблоны, справки, скилл

**Файлы:**
- Создать: `plugins/kit/skills/project-init/SKILL.md`, `plugins/kit/skills/project-init/templates/CLAUDE.md`, `…/templates/progress.md`, `…/templates/deploy-prod.md`, `…/templates/gitignore-bitrix`, `…/templates/gitignore-general`, `…/templates/htaccess-deny`, `…/reference/phpstorm.md`, `…/reference/bitrix.md`, `tests/templates.test.js`
- Изменить: `tests/content.test.js`, `docs/progress.md`

**Интерфейсы:**
- Использует: `scripts/secret-scan.js`, `site-probe.js`, `check-closed.js` (3.x), агент `kit:git-keeper` (4.1), `/kit:step-done` (5.1); в тестах — `lib/params.js` (`parseParams`), `lib/md.js` (`getSection`, `parseTable`), `tests/helpers.js` (`PLUGIN`, `makeProject`, `writeFiles`, `git`).
- Даёт: `/kit:project-init` (только командой пользователя: `disable-model-invocation: true`); шаблоны, которые разбираются теми же `parseParams`, `getSection`, `parseTable`, что и хуки и `deploy-list.js`.

- [ ] **Шаг 1: написать падающие тесты**

`tests/templates.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN, makeProject, writeFiles, git } = require('./helpers');
const { parseParams } = require('../plugins/kit/scripts/lib/params');
const { getSection, parseTable } = require('../plugins/kit/scripts/lib/md');

const TPL = path.join(PLUGIN, 'skills', 'project-init', 'templates');
const read = (name) => fs.readFileSync(path.join(TPL, name), 'utf8');

function ignored(gitignore, paths) {
  const dir = makeProject({ '.gitignore': gitignore });
  writeFiles(dir, Object.fromEntries(paths.map((p) => [p, 'x'])));
  git(dir, 'init', '-q');
  const r = spawnSync('git', ['check-ignore', '--stdin'], { cwd: dir, input: paths.join('\n') + '\n', encoding: 'utf8' });
  return new Set(r.stdout.split(/\r?\n/).filter(Boolean));
}

test('gitignore-bitrix: служебное и ядро игнорируются, правила, скрипты и материалы — в git', () => {
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', 'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1'];
  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', 'upload/docs/a.png', 'local/templates/x/a.php', 'docs/progress.md'];
  const set = ignored(read('gitignore-bitrix'), [...yes, ...no]);
  for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
});

test('gitignore-general: служебное и секреты игнорируются', () => {
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1'];
  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', 'src/a.php', 'docs/progress.md'];
  const set = ignored(read('gitignore-general'), [...yes, ...no]);
  for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
});

test('CLAUDE.md: раздел параметров со всеми ключами', () => {
  const v = parseParams(read('CLAUDE.md'));
  assert.ok(v, 'нет раздела «Параметры для агентов»');
  for (const k of ['режим', 'код пишет', 'окружение', 'выкладка', 'прод', 'дев', 'php', 'журнал', 'план выкладки', 'id шага', 'не выкладывать', 'не коммитить', 'секреты']) {
    assert.ok(k in v, 'нет ключа ' + k);
  }
});

test('progress.md: разделы журнала и таблица этапа 0', () => {
  const md = read('progress.md');
  for (const s of ['Сейчас', 'Решения', 'Этап 0', 'Материалы заказчика', 'Баги на потом', 'Прод: не забыть', 'Справочник']) {
    assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  }
  const rows = parseTable(getSection(md, 'Этап 0'));
  assert.deepEqual(Object.keys(rows[0]), ['Шаг', 'Статус', 'Что сделано', 'Коммит']);
  assert.equal(rows[0]['Шаг'], '0.1');
});

test('deploy-prod.md: разделы и колонки «Залито на прод»', () => {
  const md = read('deploy-prod.md');
  for (const s of ['Общие правила', 'Залито на прод', 'Удалить с сервера', 'Чек-лист переключения']) {
    assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  }
  assert.match(getSection(md, 'Залито на прод'), /\| Шаг \| Дата \| Файлы \| Коммит \| Проверка \|/);
  assert.match(getSection(md, 'Удалить с сервера'), /\| Путь \| Почему \| Удалён \|/);
});

test('htaccess-deny: Apache 2.4 и 2.2', () => {
  const h = read('htaccess-deny');
  assert.match(h, /Require all denied/);
  assert.match(h, /Deny from all/);
});
```

В конец `tests/content.test.js` (до `module.exports`):

```js
test('project-init: только командой, все шаги и шаблоны на месте', () => {
  const { fm, body } = skill('project-init');
  assert.equal(fm.name, 'project-init');
  assert.equal(fm['disable-model-invocation'], 'true');
  for (const s of ['AskUserQuestion', 'secret-scan.js', 'site-probe.js', 'check-closed.js', 'deployment.xml', 'watcherTasks.xml',
    'webServers.xml', '0.1: Исходники с прода (копия прода)', 'kit:git-keeper', '/kit:step-done', 'core.autocrlf', 'core.quotepath']) {
    assert.ok(body.includes(s), s);
  }
  for (const t of ['CLAUDE.md', 'progress.md', 'deploy-prod.md', 'gitignore-bitrix', 'gitignore-general', 'htaccess-deny']) {
    assert.ok(body.includes('`' + t + '`'), 'скилл не называет шаблон ' + t);
    assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', t)), 'нет шаблона ' + t);
  }
});
```

- [ ] **Шаг 2: убедиться, что тесты падают**

Запуск: `node --test tests/templates.test.js tests/content.test.js`
Ожидается: FAIL — `ENOENT … templates/gitignore-bitrix` и `skills/project-init/SKILL.md`.

- [ ] **Шаг 3: написать шаблоны, справки и скилл**

`plugins/kit/skills/project-init/templates/CLAUDE.md`:

````markdown
# {{ДОМЕН}} — правила работы

**После новой сессии или сжатия контекста первым делом прочитай `{{ЖУРНАЛ}}`**: там текущий шаг, решения, материалы заказчика и баги. Плагин kit подставляет его раздел «Сейчас» сам; эта строка — на случай, если плагин выключен.

## Проект

- {{Что за сайт: назначение, CMS и шаблон — например «1С-Битрикс + Аспро „…“, шаблон `…`»}}
- Задача: {{Б24 #НОМЕР — название | без задачи}}.
- Журнал: `{{ЖУРНАЛ}}`. Выкладка: `{{ПЛАН_ВЫКЛАДКИ}}`.

## Окружение

- **Локально:** `{{ПАПКА_ПРОЕКТА}}`. {{Что лежит в проекте и чего нет (ядро, модули)}}. Windows, PowerShell.
- **Прод:** {{ПРОД}}, PHP {{ВЕРСИЯ_PHP}}.
- {{**Дев:** АДРЕС, PHP ВЕРСИЯ. | Дева нет — проверяем на проде.}}
- **Выкладка:** {{PhpStorm, сервер `СЕРВЕР`, автозаливка Always — любое сохранение файла в проекте, в том числе правка Claude, сразу уходит на сервер. | вручную, списком изменённых файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки.}}
  - Не выкладываются: {{ИСКЛЮЧЕНИЯ}}.
  - `docs/` и `.claude/` закрыты `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА_ПРОВЕРКИ | ещё не проверено}}).
  - Удаление файла локально на сервере его **не удаляет** — список в разделе «Удалить с сервера» плана выкладки.
- **Синтаксис:** `{{PHP_EXE}} -l <файл>` — хук плагина делает это после каждой правки PHP.

## Безопасность

- {{Что нельзя сломать: живые страницы, формы в CRM, оплата, почта — и чем это защищено}}
- Секреты — только в `/bitrix/.settings_extra.php`, в git не класть.

## Как работаем

- **Код пишет {{Claude | пользователь}}.** {{Один шаг за раз: код во временной папке → `php -l` → запись в проект → проверка результата на сервере (десктоп и мобильная ширина) → следующий шаг. | Claude даёт один маленький шаг, ждёт ответа, проверяет (`git diff`, `php -l`, сервер) и только потом даёт следующий; «сделай сам» относится только к тому шагу, на котором прозвучало.}}
- **Выбор** за пользователем, вопросы — только через AskUserQuestion.
- **После проверки шага** — `/kit:step-done`: `kit:docs-keeper` обновляет журнал и план выкладки, `kit:git-keeper` делает один коммит `ID: …`.
- **Git** пользователь сам не трогает, команды git ему не выдаём.
- **Форматирование:** файлы целиком не переформатировать. Переводы строк — LF.

## Код

- {{Правила кода проекта: где свои классы и неймспейс, как правим шаблоны (копии в `local/templates/…/components/…`), что не трогаем (ядро, модуль Аспро)}}

## Параметры для агентов

Читают агенты, хуки и скиллы плагина kit. Формат строк не менять: `- Ключ: значение`, списки через запятую.

- Режим: {{bitrix | общий}}
- Код пишет: {{Claude | пользователь}}
- Окружение: {{прод | дев+прод}}
- Выкладка: {{PhpStorm Always | вручную}}
- Прод: {{ПРОД}}
- Дев: {{ДЕВ | —}}
- PHP: {{PHP_EXE | —}}
- Журнал: docs/progress.md
- План выкладки: docs/deploy-prod.md
- ID шага: N.M (например 0.3, 2.1)
- Не выкладывать: {{ИСКЛЮЧЕНИЯ}}
- Не коммитить: {{bitrix/, upload/ (кроме upload/docs/), *.back* | *.back*}}
- Секреты: {{подстроки секретов проекта | —}}
````

`plugins/kit/skills/project-init/templates/progress.md`:

````markdown
# Журнал работ — {{Б24 #НОМЕР — название | ДОМЕН}}

> Ведёт агент docs-keeper после каждого проверенного шага. После сжатия контекста и в новой сессии читать первым. Правила проекта — `.claude/CLAUDE.md`.

## Сейчас

- **Этап:** 0 — подготовка
- **Следующий шаг:** 0.2 — правила проекта, журнал, план выкладки, закрытие `docs/` и `.claude/`
- **Блокеры и открытые вопросы:** —

## Решения

| Дата | Решение |
|---|---|
| {{ДАТА}} | {{Решение из ответов /kit:project-init — по строке на ответ}} |

## Этап 0 — подготовка

| Шаг | Статус | Что сделано | Коммит |
|---|---|---|---|
| 0.1 | ✅ | git: `.gitignore`, `core.autocrlf=input`, `core.quotepath=false`, исходники с {{прода | дева}} | `{{ХЕШ}}` |
| 0.2 | ⏳ | Правила проекта `.claude/CLAUDE.md` с «Параметрами для агентов», журнал, план выкладки, `.htaccess` для `docs/` и `.claude/` | |

## Материалы заказчика

- (пока пусто)

## Баги на потом

| № | Баг | Где | Статус |
|---|---|---|---|

## Прод: не забыть

- (пока пусто)

## Справочник

- Прод: {{ПРОД}}, {{Server из site-probe}}, **PHP {{ВЕРСИЯ_PHP}}**. Синтаксис: `{{PHP_EXE}} -l`.
- {{Корень сайта на сервере, версия ядра — когда станут известны}}
````

`plugins/kit/skills/project-init/templates/deploy-prod.md`:

````markdown
# Выкладка на прод — {{ДОМЕН}}

## Общие правила

- {{Заливает PhpStorm автоматически (сервер `СЕРВЕР`, автозаливка Always): любое сохранение файла в проекте сразу уходит на прод. | Выкладка вручную, списком файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки (по таблице «Залито на прод» ниже).}}
- Не выкладываются: {{ИСКЛЮЧЕНИЯ}}.
- `docs/` и `.claude/` закрыты `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА и итог | ещё не проверено}}). nginx может отдавать статику (pdf, docx, картинки, txt…) мимо `.htaccess` — такие файлы в `docs/` и `.claude/` не держать.
- До записи в проект — `php -l` (PHP {{ВЕРСИЯ_PHP}}).
- Удалённые локально файлы на сервере удаляются отдельно — раздел «Удалить с сервера».

## Залито на прод

| Шаг | Дата | Файлы | Коммит | Проверка |
|---|---|---|---|---|

## Удалить с сервера

Удалять через Remote Host в PhpStorm или скриптом в Командной PHP-строке (`/kit:bitrix-console`, шаблон `delete-list.php`: с согласия пользователя, строгий список, сначала сухой прогон).

| Путь | Почему | Удалён |
|---|---|---|

## Чек-лист переключения

1. (заполняется по ходу работы)
````

`plugins/kit/skills/project-init/templates/gitignore-bitrix`:

```gitignore
# Служебное IDE и Claude Code: в git только правила, .htaccess и скрипты консоли
/.idea/
/.claude/*
!/.claude/CLAUDE.md
!/.claude/.htaccess
!/.claude/scripts/
!/.claude/scripts/**

# Ядро и загрузки Битрикса (секреты — в bitrix/.settings_extra.php); материалы задачи — в upload/docs/
/bitrix/
/upload/*
!/upload/docs/

# Резервные копии обновлений
*.back*
```

`plugins/kit/skills/project-init/templates/gitignore-general`:

```gitignore
# Служебное IDE и Claude Code: в git только правила, .htaccess и скрипты консоли
/.idea/
/.claude/*
!/.claude/CLAUDE.md
!/.claude/.htaccess
!/.claude/scripts/
!/.claude/scripts/**

# Секреты и зависимости
.env
.env.*
node_modules/

# Резервные копии
*.back*
```

`plugins/kit/skills/project-init/templates/htaccess-deny`:

```apache
# Служебная папка: доступ по вебу запрещён, файлы смотреть по FTP.
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order deny,allow
    Deny from all
</IfModule>
```

`plugins/kit/skills/project-init/reference/phpstorm.md`:

````markdown
# PhpStorm: деплой, исключения, File Watchers

## Где настройки

- **Исключения деплоя:** Settings → Build, Execution, Deployment → Deployment → сервер (например `ftp`) → вкладка **Excluded Paths** → «Add local path» для каждого пути.
- **Автозаливка:** Settings → Build, Execution, Deployment → Deployment → **Options** → «Upload changed files automatically to the default server»: `Always` / `On explicit save action (Ctrl+S)` / `Never`. Флажок «Upload external changes» — заливать и правки, сделанные вне IDE (правки Claude).
- **File Watchers:** Settings → Tools → **File Watchers** — снять флажок у вотчера или удалить его.

## Что лежит в `.idea` (только читать, не править)

- `.idea/deployment.xml`, компонент `PublishConfigData`:
  - `autoUpload="Always"` и `<option name="myAutoUpload" value="ALWAYS" />` — автозаливка при каждом сохранении;
  - `autoUploadExternalChanges="true"` — внешние правки тоже уезжают;
  - `serverName` — сервер по умолчанию;
  - `<excludedPath local="true" path="$PROJECT_DIR$/.claude/scripts" />` — исключения.
- `.idea/webServers.xml` — серверы: `url`, `rootFolder` (часто содержит домен, например `/www/alpha.example.com`), хост FTP. Пароли не читать и не выводить.
- `.idea/watcherTasks.xml` — вотчеры: `<TaskOptions isEnabled="true">`, `name`, `fileExtension`, `output`.

## Что исключать

- Всегда: `.idea`, `.git`.
- `.claude/scripts` — скрипты Командной PHP-строки: в git есть, на сервере не нужны.
- Служебные файлы Claude Code в `.claude`: `settings.local.json` и любые новые — Claude Code может завести их позже; при появлении добавлять в исключения.
- `.claude/CLAUDE.md` и `docs/` можно выкладывать: папки закрыты `.htaccess`, проверка — `check-closed.js`. Или исключить `.claude` целиком — решает пользователь.
- `local/modules/` — если модули лежат в проекте только для чтения.

## Грабли

- Автозаливка работает, только пока PhpStorm открыт с этим проектом. После правки проверять, что изменение дошло до сервера.
- Удаление файла локально на сервере его **не удаляет** — удалять отдельно (Remote Host или `delete-list.php`), список — в «Удалить с сервера».
- Файл, открытый в редакторе PhpStorm с несохранёнными правками, при сохранении затрёт правку Claude.
- File Watchers срабатывают и на внешние правки (правки Claude), с задержкой 10–15 с: SCSS пересоберёт CSS, минификатор перезапишет `.min`. SCSS-исходники в проектах часто расходятся с CSS, правленым руками, — пересборка сотрёт ручные правки.
- MCP-сервер PhpStorm (встроенный) даёт инспекции, поиск, `git_status`, IDE-действия, но удалять файлы на сервере не умеет.
````

`plugins/kit/skills/project-init/reference/bitrix.md`:

````markdown
# 1С-Битрикс: что проверить при старте проекта

## Версия PHP прода

- Заголовок `X-Powered-By: PHP/7.4.33` показывает `site-probe.js` (п. 4.5 скилла).
- Заголовок скрыт — `/kit:bitrix-console`, код `echo PHP_VERSION;`.
- Синтаксис проверяем той же версией: `C:\OSPanel\modules\PHP-X.Y\php.exe -l` (параметр «PHP»; хук `php-lint` делает это после каждой правки). На PHP 7.x — никакого синтаксиса PHP 8 (`match`, `?->`, именованные аргументы, `str_contains`).

## Закрытие `docs/` и `.claude/`

- `.htaccess` с `Require all denied` действует, только если запрос доходит до Apache. На хостингах nginx + Apache статику (pdf, docx, xlsx, картинки, txt, zip…) часто отдаёт сам nginx — мимо `.htaccess` (найдено в epsilon 2026-09-22). Поэтому:
  - проверять **каждый файл** снаружи — `check-closed.js` (ожидается 403);
  - в `docs/` и `.claude/` не держать статические форматы; если нужно — дописать `.php` к имени (`tz.docx.php`), тогда запрос идёт в Apache.
- Проверять всегда снаружи, по настоящему адресу.

## `.min.css` / `.min.js`

Битрикс отдаёт `.min`-файл, только если он не старее исходника. Устаревшие `.min` Аспро (`template_styles.min.css`, `styles.min.css`) не трогать и не создавать: иначе Битрикс начнёт отдавать старый код.

## Секреты

Только в `/bitrix/.settings_extra.php` (своя секция), читать через конфиг-класс проекта. В git не класть: `/bitrix/` в `.gitignore`, git-keeper и `secret-scan.js` проверяют пути и строки.

## Командная PHP-строка

Проверки и разовые скрипты на сервере — `/kit:bitrix-console`: только чтение — сразу, изменения — с согласия пользователя и после сухого прогона.
````

`plugins/kit/skills/project-init/SKILL.md`:

````markdown
---
name: project-init
description: Подготовить проект к работе по схеме kit — git, .gitignore, скан секретов, первый коммит, .claude/CLAUDE.md с «Параметрами для агентов», журнал docs/progress.md, план выкладки docs/deploy-prod.md, .htaccess для docs/ и .claude/; в режиме 1С-Битрикс — версия PHP прода, проверка 403 снаружи, исключения PhpStorm и File Watchers. В существующем проекте дополняет недостающее, ничего не перезаписывает.
disable-model-invocation: true
---

# Инициализация проекта (kit)

Работай в корне проекта, без `cd`. Все вопросы — только через AskUserQuestion; вариант, найденный разведкой, ставь первым с пометкой «(Рекомендую)». Ничего не перезаписывай: существующие файлы только дополняются, и только после согласия пользователя.

Шаблоны — в `${CLAUDE_PLUGIN_ROOT}/skills/project-init/templates/`. Перед шагами про PhpStorm и Битрикс прочитай справки `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md` и `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/bitrix.md`.

## 1. Разведка (только чтение)

- **git:** есть ли `.git`; `git config --get core.autocrlf`, `git config --get core.quotepath`; число коммитов (`git rev-list --count HEAD`) и первый коммит.
- **Файлы kit:** `.claude/CLAUDE.md` (есть ли раздел `## Параметры для агентов`), `docs/progress.md`, `docs/deploy-prod.md`, `docs/.htaccess`, `.claude/.htaccess`, `.gitignore`, проектные копии агентов `.claude/agents/docs-keeper.md` и `.claude/agents/git-keeper.md`, служебные файлы Claude Code в `.claude/` (`settings.local.json` и т. п.).
- **Битрикс:** `bitrix/`, `local/`, `local/templates/`, `urlrewrite.php`, `.settings.php` — признаки режима «bitrix».
- **PhpStorm** (только читать):
  - `.idea/deployment.xml` — `autoUpload`, `autoUploadExternalChanges`, `serverName`, список `excludedPath`;
  - `.idea/webServers.xml` — `rootFolder` (например `/www/alpha.example.com` → домен `alpha.example.com`); пароли и логины не читать и не выводить;
  - `.idea/watcherTasks.xml` — включённые File Watchers (`name`, `isEnabled`).

## 2. Вопросы

Первый вызов AskUserQuestion (4 вопроса):
1. Режим: 1С-Битрикс / общий.
2. Окружение: только прод (проверяем на проде) / дев + прод.
3. Кто пишет код: Claude / пользователь по шагам.
4. Как файлы попадают на сервер: PhpStorm, автозаливка Always / вручную списком файлов.

Второй вызов:
1. Адрес прода (вариант-догадка из `rootFolder`, свой — через «Другое»); при «дев + прод» — ещё вопрос про адрес дева.
2. Задача: номер Б24 и название (через «Другое»; вариант «без задачи»).
3. Исключения деплоя (мультивыбор): `.idea`, `.git`, `.claude/scripts`, `.claude/settings.local.json`, `.gitignore`, `local/modules` и найденные в `deployment.xml`. Для автозаливки рекомендовать `.idea`, `.git`, `.claude/scripts`, `.claude/settings.local.json`.
4. Только режим «bitrix» и только если в `watcherTasks.xml` есть включённые вотчеры: оставить / убрать (вотчеры срабатывают и на правки Claude — см. справку phpstorm.md).

## 3. План на согласие

Покажи таблицу «что есть / что сделаю / что пропущу» по пунктам раздела 4 и порядок действий. Отдельно скажи, что при автозаливке всё записанное сразу уезжает на сервер. Согласие — через AskUserQuestion. Без согласия ничего не пиши.

## 4. Выполнение

### 4.1 Git — только если репозитория нет

1. `git init`, затем `git config core.autocrlf input` и `git config core.quotepath false`.
2. `.gitignore` из шаблона `gitignore-bitrix` или `gitignore-general`. Файл уже есть — покажи, каких строк не хватает, и допиши их с согласия.
3. Скан секретов по всему, что попадёт в первый коммит:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js" --all
   ```
   Код 1 — покажи находки (значения замаскированы) и спроси, что делать: добавить пути в `.gitignore` / это не секрет / стоп. После правок — скан ещё раз.
4. Первый коммит — через агента `kit:git-keeper`, как в `/kit:step-done` (п. 4): FILES — папки и файлы верхнего уровня из `git status --porcelain` (без `.claude/` и `docs/`), MESSAGE `0.1: Исходники с прода (копия прода)` (если исходники скачаны с дева — `0.1: Исходники с дева (копия прода)`), COAUTHOR и KIT_ROOT — как в `/kit:step-done`.

Репозиторий уже есть — только проверь `core.autocrlf` и `core.quotepath` и предложи выставить `input` и `false`, если они другие.

### 4.2 Закрыть служебные папки — первыми

`docs/.htaccess` и `.claude/.htaccess` из шаблона `htaccess-deny` (если файла нет). При автозаливке — подожди 10–15 с, пока PhpStorm их зальёт, и только потом пиши остальное.

### 4.3 Правила проекта `.claude/CLAUDE.md`

- Файла нет — собери из шаблона `CLAUDE.md`: заполни все `{{…}}` ответами и разведкой, из вариантов `{{A | B}}` оставь нужный, лишнее убери. После записи проверь, что `{{` в файле не осталось.
- Файл есть, раздела «Параметры для агентов» нет — покажи заполненный раздел и допиши его в конец файла после согласия. Остальное в файле не трогай.
- Раздел есть — сверь значения с ответами; расхождения покажи и правь только с согласия.
- Проектные копии `.claude/agents/docs-keeper.md` / `git-keeper.md` — предложи удалить: агенты теперь приходят из плагина (`kit:docs-keeper`, `kit:git-keeper`), а проектные живут рядом под другим именем и путают. Если `.claude/agents/` уезжала на сервер — внеси её в «Удалить с сервера» плана выкладки.
- Параметр «Секреты» — подстроки, характерные для секретов этого проекта (ключи секции в `.settings_extra.php` и т. п.); нет таких — `—`. Вебхуки Б24, пароли и приватные ключи `secret-scan.js` ищет и без параметра.

Параметр «PHP» в режиме «bitrix» заполняется в п. 4.5; в общем режиме — спроси версию PHP сервера (или `—`, если PHP нет).

### 4.4 Журнал и план выкладки

Из шаблонов `progress.md` и `deploy-prod.md`, если файлов нет:
- «Решения» — ответы этого запуска, каждая строка с сегодняшней датой;
- «Этап 0 — подготовка»: `0.1 ✅` с хешем первого коммита (репозиторий уже был — строка про его первый коммит), `0.2 ⏳`;
- «Общие правила» плана выкладки — по ответам: как файлы попадают на сервер, исключения, закрытие `docs/` и `.claude/`.

Журнал уже есть — не трогай его: данные этого запуска уйдут в docs-keeper на шаге 4.6.

### 4.5 Только режим «bitrix»

1. Версия PHP прода:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/site-probe.js" <адрес прода>
   ```
   Путь `C:\OSPanel\modules\PHP-X.Y\php.exe` из вывода — в параметр «PHP» (модуля нет в OSPanel — сказать пользователю). Версия скрыта — спроси пользователя или узнай через `/kit:bitrix-console` (`echo PHP_VERSION;`).
2. Исключения PhpStorm: дай пользователю инструкцию из справки phpstorm.md — какие пути исключить (ответ 2.3) и где это в настройках. Когда пользователь ответит, что сделал, — перечитай `.idea/deployment.xml` и сверь `excludedPath` с ответом; расхождения назови.
3. File Watchers — по ответу 2.4: «убрать» — инструкция из справки, затем сверка `watcherTasks.xml`.
4. Закрытость снаружи — когда файлы `docs/` и `.claude/` уже на сервере (при автозаливке — сразу, при ручной выкладке — после того как пользователь их выложил):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес прода>
   ```
   Код 0 — всё закрыто (403) или ещё не выложено (404). Код 1 — есть открытые файлы: стоп, разобрать (`.htaccess` не дошёл, хостинг без Apache, nginx отдаёт статику — см. справку bitrix.md). Дату и итог проверки записать в «Общие правила» плана выкладки.

### 4.6 Закрыть шаг 0.2

`/kit:step-done`: STEP `0.2`, SUMMARY — что создано и проверено, DECISIONS — ответы этого запуска (если журнал уже был), NEXT — первый рабочий шаг (спроси пользователя; по умолчанию «0.3 — изучение задачи»).

## 5. Итог пользователю

Коротко: что создано, что дополнено, что пропущено; какие действия остались за пользователем (исключения PhpStorm, File Watchers, выкладка `docs/` и `.claude/` при ручной выкладке, удаление старых агентов с сервера).
````

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/templates.test.js tests/content.test.js` → PASS.
Запуск: `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 5.2 ✅ (+ хеш 5.1), 5.3 ⏳, «Сейчас» → 5.3.

```bash
git add -- plugins/kit/skills/project-init tests/templates.test.js tests/content.test.js docs/progress.md
git commit -m "5.2: /kit:project-init — разведка, вопросы, git и секреты, шаблоны правил, журнала и выкладки, Битрикс-проверки" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/skills/project-init tests/templates.test.js tests/content.test.js docs/progress.md
```

### Задача 5.3: `/kit:bitrix-console`

**Файлы:**
- Создать: `plugins/kit/skills/bitrix-console/SKILL.md`
- Изменить: `tests/content.test.js`, `docs/progress.md`

**Интерфейсы:**
- Использует: скрипты `skills/bitrix-console/scripts/*.php` и `scripts/md5-check.js` (3.4); инструменты claude-in-chrome.
- Даёт: `/kit:bitrix-console [что выполнить]` — Claude вызывает сам, когда нужно выполнить код на сервере; используется в `/kit:project-init` (версия PHP) и `/kit:deploy-list` (удаления).

- [ ] **Шаг 1: дописать падающий тест**

В конец `tests/content.test.js` (до `module.exports`):

```js
test('bitrix-console: своя вкладка, редактор по pTA.id, сверка, запуск, сухой прогон', () => {
  const { fm, body } = skill('bitrix-console');
  assert.equal(fm.name, 'bitrix-console');
  assert.notEqual(fm['disable-model-invocation'], 'true');
  for (const s of ['php_command_line.php', 'tabs_create_mcp', 'tabs_close_mcp', 'BXCodeEditors', 'pTA.id', 'SetValue',
    '__FPHPSubmit', '<pre>', 'без `<?php`', 'без `use`', '$dryRun', 'AskUserQuestion', 'inventory.php', 'delete-list.php',
    'check-files.php', 'md5-check.js', '.claude/scripts/', 'не открывать, не править и не выполнять']) {
    assert.ok(body.includes(s), s);
  }
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Запуск: `node --test tests/content.test.js`
Ожидается: FAIL — `ENOENT … skills/bitrix-console/SKILL.md`.

- [ ] **Шаг 3: написать скилл**

`plugins/kit/skills/bitrix-console/SKILL.md`:

````markdown
---
name: bitrix-console
description: Выполнить PHP-код на сайте 1С-Битрикс через Командную PHP-строку админки (/bitrix/admin/php_command_line.php) в Chrome пользователя — инвентаризация, проверки, сверка файлов по md5, удаление файлов строгим списком. Скрипты только на чтение — сразу; изменяющие — только с отдельного согласия пользователя и после сухого прогона.
argument-hint: "[inventory | check-files <файлы> | delete-list | свой код]"
---

# Командная PHP-строка Битрикса

## Правила

- Код для консоли — **без `<?php`** и **без `use`**: полные имена классов (`\Bitrix\Main\Loader::includeModule('iblock')`).
- **Только чтение** — можно запускать сразу. **Изменяет что-либо** (файлы, база, настройки) — только после отдельного согласия пользователя через AskUserQuestion и после сухого прогона (`$dryRun = true`, вывод показать пользователю, потом `$dryRun = false`).
- Перед запуском проверь код `php -l` версией из параметра «PHP»: файл во временной папке сессии с приставкой `<?php` (для `.claude/scripts/*.php` это делает хук плагина при записи).
- Пароли не вводить: если админка просит войти — входит пользователь.
- Чужие вкладки консоли (например «PHP-строка (1)» с сохранённым кодом пользователя) не открывать, не править и не выполнять.
- Разметка админки отличается от описанной ниже (другая версия Битрикса) — остановись, опиши, что видишь, и спроси пользователя. Вслепую не выполнять.

## Библиотека скриптов

`${CLAUDE_PLUGIN_ROOT}/skills/bitrix-console/scripts/`:
- `inventory.php` — окружение, сайты и шаблоны, сторонние модули, инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы `b_file` по модулям и типам. Только чтение.
- `delete-list.php` — шаблон удаления строгим списком: `$dryRun`, `$base` (папка от корня сайта), `$allowedExt`, `$files`, `$removeEmptyDirs`. Каждый путь через `realpath` должен лежать внутри `$base`, быть файлом и иметь расширение из списка; база не может быть корнем сайта. **Изменяет сервер.**
- `check-files.php` — сверка файлов с локальными по md5. Готовый код печатает
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/md5-check.js" <файлы от корня проекта…>
  ```
  Только чтение.

Проектная копия скрипта (с конкретными путями, ID и т. п.) — в `.claude/scripts/NN-имя.php` проекта: в git есть, на сервер не уезжает (исключение деплоя). NN — следующий номер по порядку.

## Порядок работы

### 1. Браузер

Загрузи инструменты Chrome одним вызовом ToolSearch:
`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__computer`

1. `tabs_context_mcp` — посмотри вкладки; создай свою `tabs_create_mcp`. Вкладки пользователя не трогай.
2. Адрес — параметр «Прод» из «Параметров для агентов» (есть и «Дев» — спроси, где выполнять) + `/bitrix/admin/php_command_line.php`; `navigate` в своей вкладке.
3. Открылась форма входа — попроси пользователя войти в этой вкладке и дождись ответа.

### 2. Новая вкладка консоли

1. Посмотри, какие вкладки и редакторы уже есть (`javascript_tool`):
   ```js
   (() => ({
     textareas: [...document.querySelectorAll('textarea[id^="query"]')].map((t) => t.id),
     editors: Object.values(window.BXCodeEditors || {}).map((e) => e && e.pTA && e.pTA.id),
   }))()
   ```
2. Нажми «+» рядом с вкладками «PHP-строка (N)» (найди через `find` / `read_page`, нажми `computer` по ref).
3. Повтори п. 1: новая вкладка — тот `queryN`, которого раньше не было. Дальше работай только с ней.

### 3. Вставить код и сверить

Подставь id новой вкладки и код JSON-строкой (экранирование как у `JSON.stringify`):
```js
((id, code) => {
  const ed = Object.values(window.BXCodeEditors || {}).find((e) => e && e.pTA && e.pTA.id === id);
  const ta = document.getElementById(id);
  if (!ed || !ta) return { ok: false, why: 'нет редактора или textarea ' + id };
  ed.SetValue(code);
  ta.value = code;
  const back = typeof ed.GetValue === 'function' ? ed.GetValue() : ta.value;
  return { ok: back === code && ta.value === code, length: code.length };
})('queryN', "…код…")
```
`ok: false` — не запускать, разобраться: содержимое вкладки должно совпасть с твоим кодом полностью (Битрикс иногда подставляет во вкладку последний выполненный код).

### 4. Выполнить и прочитать результат

1. Кнопка «Выполнить» — видимая кнопка, у которой `onclick` содержит `__FPHPSubmit`:
   ```js
   (() => {
     const b = [...document.querySelectorAll('input[type=button],input[type=submit],button')]
       .filter((x) => (x.getAttribute('onclick') || '').includes('__FPHPSubmit') && x.offsetParent !== null);
     if (b.length !== 1) return { ok: false, found: b.length };
     b[0].click();
     return { ok: true };
   })()
   ```
   Найдено не ровно одна видимая кнопка — остановись и посмотри страницу (`read_page`).
2. Подожди 1–3 с (для тяжёлых скриптов дольше) и прочитай последний видимый `<pre>`:
   ```js
   (() => {
     const pres = [...document.querySelectorAll('pre')].filter((p) => p.offsetParent !== null);
     return pres.length ? pres[pres.length - 1].innerText : null;
   })()
   ```
   Пусто — подожди и повтори; ошибка PHP — покажи пользователю.

### 5. Завершить

1. Закрой свою вкладку браузера (`tabs_close_mcp`).
2. Сообщи пользователю итог (длинный вывод — выжимкой, полный — во временную папку сессии).
3. Факты, которые стоит сохранить (ID, результаты проверок, что удалено), — в NOTES / DEPLOY следующего `/kit:step-done`.

## Изменяющие скрипты

1. Скрипт с `$dryRun = true` → выполнить → показать пользователю, что будет изменено.
2. AskUserQuestion: «Выполнить по-настоящему?» — только явное «да».
3. Тот же код с `$dryRun = false` → выполнить → показать результат.
4. Проверить снаружи (например, удалённые пути отдают 404) и записать в план выкладки: «Удалить с сервера» → `✅ ДАТА, скрипт`.
````

- [ ] **Шаг 4: тесты проходят**

Запуск: `node --test tests/*.test.js` → PASS (все).
Запуск: `claude plugin validate plugins/kit` → без ошибок.

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 5.3 ✅ (+ хеш 5.2), этап 6 с 6.1–6.3 (6.1 ⏳), «Сейчас» → 6.1.

```bash
git add -- plugins/kit/skills/bitrix-console/SKILL.md tests/content.test.js docs/progress.md
git commit -m "5.3: /kit:bitrix-console — своя вкладка, редактор по pTA.id, сверка кода, запуск, сухой прогон для изменений" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- plugins/kit/skills/bitrix-console/SKILL.md tests/content.test.js docs/progress.md
```

---

## Этап 6 — проверка и выпуск

### Задача 6.1: README, версия 1.0.0, полный прогон и строгая валидация

**Файлы:**
- Изменить: `README.md`, `plugins/kit/.claude-plugin/plugin.json` (`"version": "1.0.0"`), `.claude-plugin/marketplace.json` (`"version": "1.0.0"` у плагина `kit`), `docs/progress.md`

**Интерфейсы:**
- Использует: всё из этапов 1–5.
- Даёт: документацию для установки и миграции; версия `1.0.0`.

- [ ] **Шаг 1: полный прогон тестов до правок**

Запуск: `node --test tests/*.test.js` → PASS (все). Упало — чинить в той задаче, которой принадлежит код, до продолжения.

- [ ] **Шаг 2: переписать README.md**

`README.md`:

````markdown
# claude-kit

Личный маркетплейс Claude Code с плагином **kit**: каркас работы над проектами (журнал, агенты журнала и git, закрытие шага, хуки правил процесса и `php -l`) и модуль для сайтов на 1С-Битрикс (инициализация проекта, Командная PHP-строка, проверки выкладки).

## Установка

```
claude plugin marketplace add C:\OSPanel\home\claude-kit
claude plugin install kit@claude-kit
```

То же в сессии: `/plugin marketplace add C:\OSPanel\home\claude-kit`, затем `/plugin install kit@claude-kit`. Нужен Node.js ≥ 18.

## Обновление

Плагин грузится прямо из папки `C:\OSPanel\home\claude-kit\plugins\kit` (ветка `master`), копии в кэше нет. Изменения подхватываются при старте новой сессии или командой `/reload-plugins`.

## Что внутри

| Что | Как вызвать | Зачем |
|---|---|---|
| `/kit:project-init` | командой | новый проект или дополнение существующего: git, `.gitignore`, скан секретов, `.claude/CLAUDE.md` с параметрами, журнал, план выкладки, `.htaccess`; Битрикс — версия PHP прода, 403 снаружи, PhpStorm |
| `/kit:step-done` | Claude сам после проверенного шага или командой | журнал (docs-keeper) → один коммит (git-keeper) → проверка |
| `/kit:deploy-list` | командой или Claude | что залить и что удалить на сервере с последней выкладки |
| `/kit:bitrix-console` | Claude при необходимости | Командная PHP-строка в Chrome: чтение — сразу, изменения — с согласия и после сухого прогона |
| `kit:docs-keeper` (sonnet) | из `/kit:step-done` | журнал, план выкладки, правила проекта |
| `kit:git-keeper` (haiku) | из `/kit:step-done` | один коммит, проверка путей и секретов, подпись дословно |
| хук SessionStart | сам | раздел «Сейчас» и правила процесса в контекст — при старте, после `/clear` и после сжатия |
| хук PostToolUse | сам | `php -l` версией PHP проекта после каждой правки `.php` |
| хук PreToolUse | сам | запрет `cd` вне подоболочки и `sed -i` по PHP |

Хуки работают только в kit-проектах — там, где есть раздел «Параметры для агентов» в `.claude/CLAUDE.md` или журнал `docs/progress.md`. В остальных папках плагин молчит.

## Параметры проекта

Раздел в `.claude/CLAUDE.md` проекта (создаёт `/kit:project-init`):

```markdown
## Параметры для агентов

- Режим: bitrix
- Код пишет: Claude
- Окружение: прод
- Выкладка: PhpStorm Always
- Прод: https://alpha.example.com
- Дев: —
- PHP: C:\OSPanel\modules\PHP-7.4\php.exe
- Журнал: docs/progress.md
- План выкладки: docs/deploy-prod.md
- ID шага: N.M (например 0.3, 2.1)
- Не выкладывать: .idea, .git, .claude/scripts, .claude/settings.local.json
- Не коммитить: bitrix/, upload/ (кроме upload/docs/), *.back*
- Секреты: —
```

Полное описание ключей — `docs/spec-claude-kit.md`, раздел 5.

## Перевод проекта со своими агентами на kit

1. `/kit:project-init` в проекте — допишет раздел параметров и недостающие файлы, ничего не перезапишет.
2. Удалить проектные `.claude/agents/docs-keeper.md` и `git-keeper.md`: плагинные агенты называются `kit:docs-keeper` и `kit:git-keeper` и с проектными не пересекаются — останутся два разных агента. Если `.claude/agents/` уезжала на сервер — удалить и там (раздел «Удалить с сервера» плана выкладки).
3. Убрать из `.claude/CLAUDE.md` строки о запуске агентов и о том, что делать, «если агенты не подхватились», — это теперь в плагине.

## Разработка

- Тесты: `npm test` (`node --test tests/*.test.js`); PHP-тесты используют `C:\OSPanel\modules\PHP-7.2`, `PHP-7.4`, `PHP-8.3` и пропускаются, если их нет.
- Проверка манифестов: `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict`.
- Запуск без установки: `claude --plugin-dir C:\OSPanel\home\claude-kit\plugins\kit`.
- Журнал разработки — `docs/progress.md`, спек — `docs/spec-claude-kit.md`, план — `docs/plan-claude-kit.md`.
````

- [ ] **Шаг 3: версия 1.0.0**

В `plugins/kit/.claude-plugin/plugin.json` и в записи плагина в `.claude-plugin/marketplace.json`: `"version": "1.0.0"`.

- [ ] **Шаг 4: полный прогон и строгая валидация**

Запуск: `node --test tests/*.test.js` → PASS (все).
Запуск: `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict` → без ошибок и предупреждений. Предупреждение про неизвестное поле — убрать поле, про отсутствующее рекомендуемое — добавить.
Запуск: `claude plugin details plugins/kit` (если принимает путь) — в списке 4 скилла, 2 агента, 3 события хуков; оценку токенов записать в журнал («Справочник»).

- [ ] **Шаг 5: журнал и коммит**

`docs/progress.md`: 6.1 ✅ (+ хеш 5.3), 6.2 ⏳, «Сейчас» → 6.2.

```bash
git add -- README.md plugins/kit/.claude-plugin/plugin.json .claude-plugin/marketplace.json docs/progress.md
git commit -m "6.1: README — установка, обновление, состав, параметры, перевод проектов; версия 1.0.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- README.md plugins/kit/.claude-plugin/plugin.json .claude-plugin/marketplace.json docs/progress.md
```

### Задача 6.2: интеграционная проверка через `claude --plugin-dir`

**Файлы:**
- Создать: `tests/integration/make-it-project.js`
- Изменить: `docs/progress.md`; по находкам — файлы плагина и их тесты

**Интерфейсы:**
- Использует: `tests/helpers.js` (`git`, `writeFiles`), `tests/fixtures.js` (`paramsMd`, `progressMd`); плагин целиком.
- Даёт: воспроизводимый временный kit-проект и записанные в журнал результаты: имена команд и агентов, работа трёх хуков, полная прогонка `/kit:step-done`.

Проверка идёт в отдельных сессиях `claude -p` во временной папке сессии (`<SCRATCH>` — папка scratchpad текущей сессии Claude Code), с плагином из worktree (`<WT>` — корень worktree). Постоянные настройки пользователя не меняются.

- [ ] **Шаг 1: написать генератор временного проекта**

`tests/integration/make-it-project.js`:

```js
'use strict';
// Готовит временный kit-проект для проверки плагина через claude --plugin-dir.
// Запуск: node tests/integration/make-it-project.js <новая папка>
const fs = require('fs');
const path = require('path');
const { git, writeFiles } = require('../helpers');
const { paramsMd, progressMd } = require('../fixtures');

const target = process.argv[2];
if (!target || fs.existsSync(target)) {
  console.error('Нужна новая папка: node tests/integration/make-it-project.js <папка>');
  process.exit(1);
}
const dir = path.resolve(target);
const now = ['- **Этап:** 0 — подготовка', '- **Следующий шаг:** 0.2 — проверка плагина', '- **Блокеры и открытые вопросы:** —'].join('\n');
writeFiles(dir, {
  '.claude/CLAUDE.md': paramsMd({
    'Режим': 'bitrix',
    'Код пишет': 'Claude',
    'Окружение': 'прод',
    'Выкладка': 'вручную',
    'Прод': 'https://example.invalid',
    'PHP': 'C:\\OSPanel\\modules\\PHP-7.4\\php.exe',
    'Не выкладывать': '.idea, .git, .claude',
  }, '# kit-it — правила работы'),
  'docs/progress.md': progressMd(now) + [
    '', '## Этап 0 — подготовка', '',
    '| Шаг | Статус | Что сделано | Коммит |', '|---|---|---|---|',
    '| 0.1 | ✅ | исходники | |', '| 0.2 | ⏳ | проверка плагина | |', '',
  ].join('\n'),
  'docs/deploy-prod.md': [
    '# Выкладка на прод — kit-it', '', '## Общие правила', '', '- тест', '',
    '## Залито на прод', '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|', '',
    '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', '',
  ].join('\n'),
  'index.php': '<?php\necho "ok";\n',
  '.gitignore': '/.idea/\n',
});
git(dir, 'init', '-q');
git(dir, 'config', 'core.autocrlf', 'input');
git(dir, 'add', '-A');
git(dir, 'commit', '-q', '-m', '0.1: исходники');
console.log(dir);
```

Запуск (PowerShell): `node <WT>\tests\integration\make-it-project.js <SCRATCH>\kit-it` → печатает путь папки.

- [ ] **Шаг 2: имена команд и агентов, SessionStart**

```powershell
$T = '<SCRATCH>\kit-it'; $P = '<WT>\plugins\kit'
Push-Location $T; try { claude --plugin-dir $P -p "Перечисли дословно имена всех доступных тебе слэш-команд и типов агентов, в имени которых есть kit. Затем дословно процитируй первую строку системного контекста, которая начинается с [kit]." } finally { Pop-Location }
```

Ожидается: `/kit:project-init`, `/kit:step-done`, `/kit:deploy-list`, `/kit:bitrix-console`, `kit:docs-keeper`, `kit:git-keeper`; строка `[kit] Проект ведётся по журналу docs/progress.md.` Записать в журнал, работает ли вызов без префикса (`/step-done`).

- [ ] **Шаг 3: хук `php -l`**

```powershell
Push-Location $T; try { claude --plugin-dir $P -p "Создай файл bad.php ровно с содержимым: <?php echo 1  (без точки с запятой — это нарочно). Потом ответь одной строкой: что сообщила система после записи файла." --allowedTools "Write" } finally { Pop-Location }
```

Ожидается: в ответе — `php -l (PHP 7.4) нашёл ошибку в …bad.php`. Затем удалить `bad.php` из временной папки.

- [ ] **Шаг 4: хук-страж `cd`**

```powershell
Push-Location $T; try { claude --plugin-dir $P -p "Выполни в Bash ровно эту команду: cd docs && ls . Ответь одной строкой: что ответила система." --allowedTools "Bash" } finally { Pop-Location }
```

Ожидается: ответ содержит `[kit] cd в Bash меняет рабочий каталог всей сессии`.

- [ ] **Шаг 5: полная прогонка `/kit:step-done`**

```powershell
node -e "require('fs').writeFileSync(process.argv[1], '<?php\necho \"hello\";\n')" "$T\hello.php"
Push-Location $T; try { claude --plugin-dir $P -p "Шаг 0.2 выполнен и проверен: добавлен hello.php, php -l чисто. Закрой шаг через /kit:step-done. NEXT: 0.3 — дальше по плану." --permission-mode acceptEdits --allowedTools "Read,Edit,Write,Grep,Glob,Agent,Skill,Bash,PowerShell" } finally { Pop-Location }
git -C $T log --format="%h %s%n%b" -3
git -C $T status --short
```

Ожидается:
- ровно один новый коммит после `0.1: исходники`, заголовок начинается с `0.2:`;
- в сообщении — строка `Co-Authored-By:` основного агента той сессии (не `Haiku`);
- `hello.php` и `docs/progress.md` в коммите, `git status --short` пуст;
- в журнале: 0.2 ✅, 0.3 ⏳, «Сейчас» обновлён.

- [ ] **Шаг 6: разобрать находки**

Всё сошлось — записать результаты в «Справочник» журнала. Не сошлось — найти причину (superpowers:systematic-debugging), исправить плагин с тестом на находку (если это код скрипта), прогнать `node --test tests/*.test.js` и повторить шаги 2–5 на новом временном проекте. Типовые развилки:
- `${CLAUDE_PLUGIN_ROOT}` в тексте агента не раскрылся — git-keeper берёт путь из KIT_ROOT (так и задумано), проверить, что step-done его передаёт;
- агенты не видны как `kit:…` — поправить имена в `step-done/SKILL.md` и `project-init/SKILL.md` на фактические и обновить тесты `tests/content.test.js`.

- [ ] **Шаг 7: журнал и коммит**

`docs/progress.md`: 6.2 ✅ (+ хеш 6.1), результаты шагов 2–5 в «Справочник», 6.3 ⏳, «Сейчас» → 6.3.

```bash
git add -- tests/integration/make-it-project.js docs/progress.md
git commit -m "6.2: интеграционная проверка через claude --plugin-dir — имена, хуки, полная прогонка /kit:step-done" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- tests/integration/make-it-project.js docs/progress.md
```

(плюс файлы плагина и тестов, если по находкам шага 6 были исправления)

### Задача 6.3: слияние в `master` и установка — только с согласия пользователя

**Файлы:**
- Изменить: `docs/progress.md`

**Интерфейсы:**
- Использует: ветку `claude/ecstatic-mendeleev-03da1a`, основной checkout `C:\OSPanel\home\claude-kit` (ветка `master`).
- Даёт: плагин `kit@claude-kit`, установленный у пользователя.

- [ ] **Шаг 1: ветка чистая, тесты зелёные**

```powershell
git status --short
node --test tests/*.test.js
```

Ожидается: пустой статус, все тесты PASS.

- [ ] **Шаг 2: состояние основного checkout**

```powershell
git -C C:\OSPanel\home\claude-kit status --short
git -C C:\OSPanel\home\claude-kit log --oneline -3
```

В индексе основного checkout есть `.idea/*` (добавил PhpStorm). Слияние с изменённым индексом git откажет. Спросить пользователя через AskUserQuestion: убрать `.idea/*` из индекса основного checkout (`git -C C:\OSPanel\home\claude-kit restore --staged .idea` — файлы на диске останутся, в `.gitignore` ветки уже есть `/.idea/`) / сделает сам / другое.

- [ ] **Шаг 3: слияние — только после явного «да»**

AskUserQuestion: «Слить ветку в master (fast-forward)?». После «да»:

```powershell
git -C C:\OSPanel\home\claude-kit merge --ff-only claude/ecstatic-mendeleev-03da1a
git -C C:\OSPanel\home\claude-kit log --oneline -3
```

- [ ] **Шаг 4: установка — только после явного «да»**

AskUserQuestion: «Подключить маркетплейс и установить плагин (меняет ваши настройки Claude Code)?». После «да»:

```powershell
claude plugin marketplace add C:\OSPanel\home\claude-kit
claude plugin install kit@claude-kit
claude plugin list
```

Ожидается: `kit@claude-kit` в списке, включён. Сказать пользователю: плагин заработает в новых сессиях.

- [ ] **Шаг 5: журнал, коммит и второй fast-forward**

`docs/progress.md`: 6.3 ✅ (+ хеш 6.2; что слито, что установлено), «Сейчас» → этап 7 «миграция gamma и alpha — решается с пользователем».

```bash
git add -- docs/progress.md
git commit -m "6.3: плагин kit слит в master и установлен (kit@claude-kit)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/progress.md
git -C C:/OSPanel/home/claude-kit merge --ff-only claude/ecstatic-mendeleev-03da1a
```

- [ ] **Шаг 6: итог**

Сообщить пользователю: что установлено, как обновлять, и вынести на решение этап 7 — миграцию gamma и alpha (план — `docs/spec-claude-kit.md`, раздел 12; вопросы через AskUserQuestion).

---

## Этап 7 — миграция gamma и alpha

Решается с пользователем после 6.3 и планируется отдельно (спек, раздел 12). Коротко: `/kit:project-init` в режиме дополнения в каждом проекте (это и проверка режима дополнения), удаление проектных агентов (в alpha — и с прода, через «Удалить с сервера»), живая проверка `/kit:bitrix-console` скриптом только на чтение в alpha — с согласия пользователя.
