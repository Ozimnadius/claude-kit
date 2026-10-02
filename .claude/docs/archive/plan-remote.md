# План этапа 16 — удалённый репозиторий проекта (работа с другого компьютера)

> **Исполнителям:** задачи по порядку, каждая закрывается `/kit:step-done` (один проверенный шаг — один коммит `ID: …`). Остановки на проверку пользователя — после частей A (16.4), B (16.6), C (16.8). Шаги — с чекбоксами (`- [ ]`).

**Цель:** git kit-проекта уходит в закрытый удалённый репозиторий после каждого шага, а при старте сессии kit сверяет ветку с удалённой — чтобы продолжить работу с другого компьютера одним `git clone`.

**Архитектура:** параметр «Удалённый репозиторий» (имя remote); `secret-scan.js --history` — проверка всей истории перед первой отправкой; хук SessionStart `remote-check.js` — `git fetch` без окон входа и строка о состоянии; `/kit:step-done` после проверки коммита делает `git push -u <имя> HEAD` (git-keeper не пушит); `/kit:project-init` задаёт вопрос и делает `git remote add`.

**Стек:** Node ≥ 18 без зависимостей, `node --test`, git ≥ 2.31 (`--diff-merges=first-parent`; у пользователя 2.48).

**Спек:** `.claude/docs/work/spec-claude-kit.md` — §2 (решения 2026-09-30 об этапе 16), §5, §6.2, §7.1 п. 6а, §7.3 (третий вызов, п. 4.1а), §8 (`remote-check.js`), §9, §10, §11, §13, §14.

## Общие ограничения

- Файлы — UTF-8 без BOM, LF; файлы целиком не переформатировать.
- Хуки: вне kit-проекта — тишина; любая внутренняя ошибка — exit 0 без вывода.
- `--force`, `pull`, `rebase`, слияния — никогда сами, только после явного выбора пользователя.
- Пароли и токены Claude не вводит и не вписывает в адрес; вход — пользователь (Git Credential Manager или SSH-ключ).
- Параметр «Удалённый репозиторий» — имя remote (`origin`); `—` или отсутствие строки — «не отправлять».
- Удалённая ветка — `refs/remotes/<имя>/<ветка>`; её нет — «первая отправка» (скан истории).
- Перед каждым коммитом: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Приоритет — простота и надёжность основных сценариев: без тестов на экзотику, мелкие находки — в «Баги на потом».
- Поддельные секреты в тестах и в этом плане — только склейкой строк (`'…/rest/1/' + 'abcdef123456/'`): целиком их находит secret-scan, и git-keeper останавливается.

## На что смотреть при проверке

1. **Пользователь создал репозиторий не пустым (с README)** — первая отправка отклонена: `/kit:step-done` останавливается и говорит, что на удалённом есть коммиты, а не повторяет и не делает `--force` (текст скилла, тест содержимого — 16.5).
2. **Нет сети или не выполнен вход при старте** — хук не висит и не открывает окно входа: `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `BatchMode=yes`, 8 с; строка «не удалось проверить» (тест с недоступным remote — 16.4).
3. **Ветка worktree с «/» в имени** (`claude/xyz`) — сверка работает (`refs/remotes/origin/claude/xyz`) (тест — 16.4).
4. **Remote называется не `origin`** (например, `github`) — все строки называют заданное имя (тест — 16.4).
5. **Секрет добавлен давно и уже удалён из файлов** — `--all` его не видит, `--history` находит с хешем коммита (тест — 16.3).

---

## Часть A — скрипты

### Задача 16.3: `secret-scan.js --history`

**Файлы:**
- Изменить: `plugins/kit/scripts/secret-scan.js` (шапка, `main()`)
- Тест: `tests/secret-scan.test.js` (дописать в конец)

**Интерфейсы:**
- Даёт: `node secret-scan.js --history` из корня проекта → коды 0 / 1 / 2; находка — `<7 знаков хеша>: <путь>:<строка>: <вид> — <маска>`; путь из истории — `<путь>: запрещённый путь (<правило>)`; чисто — `secret-scan: чисто (коммитов: N, файлов: M)`. Используют 16.5 (`/kit:step-done`) и 16.6.

- [ ] **Шаг 1: тесты** — в конец `tests/secret-scan.test.js`:

```js
test('--history: секрет удалён из файлов, но остался в истории — находка с хешем; путь из «Не коммитить» в истории — находка', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Не коммитить': 'bitrix/' }), 'a.php': '<?php\n' });
  // Вебхук собирается из двух частей: целиком в исходнике теста его нашёл бы secret-scan при коммите шага.
  writeFiles(dir, {
    'a.php': "<?php\n$hook = 'https://x.bitrix24.ru/rest/1/" + "abcdef123456/';\n",
    'bitrix/php_interface/init.php': '<?php\n',
  });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: секрет');
  const bad = git(dir, 'rev-parse', 'HEAD').trim().slice(0, 7);
  writeFiles(dir, { 'a.php': '<?php\n' });
  git(dir, 'rm', '-q', '-r', 'bitrix');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: убрал');
  assert.equal(scan(dir, '--all').code, 0, 'в текущих файлах секрета уже нет');
  const r = scan(dir, '--history');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(bad + ': a.php:2: вебхук Битрикс24 — abc…(12 симв.)'), r.stdout);
  assert.match(r.stdout, /bitrix\/php_interface\/init\.php: запрещённый путь \(bitrix\/\)/);
  assert.doesNotMatch(r.stdout, /abcdef123456/);
});

test('--history: чистая история — код 0 и число коммитов; не git — код 2', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'b.php': '<?php\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1');
  const r = scan(dir, '--history');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /secret-scan: чисто \(коммитов: 2, файлов: 2\)/);
  // GIT_CEILING_DIRECTORIES — чтобы временная папка не оказалась «внутри» чужого репозитория выше по дереву.
  const notGit = makeProject({ 'a.php': '' });
  const n = runScript('secret-scan.js', { args: ['--history'], cwd: notGit, env: { GIT_CEILING_DIRECTORIES: path.dirname(notGit) } });
  assert.equal(n.code, 2, n.stdout + n.stderr);
});
```

В начале файла: `const path = require('path');` после `require('node:assert/strict')`, и `makeProject` — в импорт из `./helpers`: `const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');`.

- [ ] **Шаг 2:** `node --test tests/secret-scan.test.js` — два новых теста падают (режима `--history` нет: код 2 и «Использование»).

- [ ] **Шаг 3: код.** В шапку `secret-scan.js`, после строки `//   node secret-scan.js --paths [--] пути…` и её продолжения:

```js
//   node secret-scan.js --history             все коммиты текущей ветки (с 2.5.0, перед первой отправкой в удалённый
//                                             репозиторий): добавленные строки каждого коммита и пути, бывшие в истории
```

В `main()` — объявление рядом с `let files;`:

```js
  let commits = null;
```

Ветка режима — перед `} else {` с «Использование»:

```js
  } else if (argv[0] === '--history') {
    // По коммиту за раз: первый коммит проекта — копия сайта, одним `git log -p` он упёрся бы в память.
    commits = git(['rev-list', '--reverse', 'HEAD']).split(/\s+/).filter(Boolean);
    for (const c of commits) {
      const found = [];
      scanDiff(git(['show', '--format=', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--diff-merges=first-parent', c]), extra, found);
      for (const f of found) findings.push(c.slice(0, 7) + ': ' + f);
    }
    files = [...new Set(git(['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', 'HEAD'])
      .split(/[\0\n]/).filter(Boolean))];
```

Строку «Использование» заменить на:

```js
    console.error('Использование: node secret-scan.js --cached [-- пути…] | --all | --files пути… | --paths [--] пути… | --history');
```

Строку «чисто» заменить на:

```js
    console.log('secret-scan: чисто (' + (commits ? 'коммитов: ' + commits.length + ', ' : '') + 'файлов: ' + files.length + ')');
```

- [ ] **Шаг 4:** `node --test tests/secret-scan.test.js` — все тесты проходят.
- [ ] **Шаг 5:** `npm test`, обе валидации; `/kit:step-done` — `16.3: secret-scan --history — проверка всей истории ветки на секреты и запрещённые пути (перед первой отправкой)`.

### Задача 16.4: хук `remote-check.js`

**Файлы:**
- Создать: `plugins/kit/scripts/remote-check.js`
- Изменить: `plugins/kit/hooks/hooks.json`, `tests/phpstorm-exclude.test.js:20-25` (список хуков SessionStart)
- Тест: `tests/remote-check.test.js` (новый)

**Интерфейсы:**
- Даёт: хук SessionStart; `check(dir, env?) → { context: string[], user: string[] } | null` (экспорт для тестов). Строки — точно как в коде ниже (на них опираются тесты и обзор в 16.7).

- [ ] **Шаг 1: тесты** — `tests/remote-check.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN, makeProject, tmpDir, writeFiles, runScript, git, gitRepo } = require('./helpers');
const { paramsMd } = require('./fixtures');

// GIT_CEILING_DIRECTORIES — чтобы временная папка не оказалась «внутри» чужого репозитория выше по дереву.
const run = (dir) => runScript('remote-check.js', {
  input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
  env: { GIT_CEILING_DIRECTORIES: path.dirname(dir) },
});
const out = (dir) => {
  const r = run(dir);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

function commit(dir, file, text) {
  writeFiles(dir, { [file]: text });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'шаг ' + file);
}

// kit-проект в git; «удалённый» — локальный bare-репозиторий под именем name; push — ветка уже отправлена.
function project({ name = 'origin', branch = '', push = true } = {}) {
  const bare = tmpDir('kit-remote-');
  git(bare, 'init', '-q', '--bare');
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': name }), 'a.txt': '1\n' });
  if (branch) git(dir, 'checkout', '-q', '-b', branch);
  git(dir, 'remote', 'add', name, bare);
  if (push) git(dir, 'push', '-q', '-u', name, 'HEAD');
  return { dir, bare };
}

// «Другой компьютер»: клон, коммит, отправка.
function pushFromOther(bare) {
  const parent = tmpDir('kit-other-');
  git(parent, 'clone', '-q', bare, 'p');
  const other = path.join(parent, 'p');
  commit(other, 'b.txt', 'дома\n');
  git(other, 'push', '-q');
}

test('hooks.json: remote-check.js — в SessionStart, таймаут 15 с', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks;
  const h = hooks.find((x) => x.args.join(' ') === '${CLAUDE_PLUGIN_ROOT}/scripts/remote-check.js');
  assert.ok(h, 'нет remote-check.js');
  assert.equal(h.timeout, 15);
});

test('тишина: вне kit-проекта, без параметра, параметр «—», не git', () => {
  assert.equal(out(makeProject({ 'index.php': '' })), null);
  assert.equal(out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }) })), null);
  assert.equal(out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': '—' }) })), null);
  assert.equal(out(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': 'origin' }) })), null);
});

test('параметр есть, а remote нет — строка пользователю и в контекст', () => {
  const o = out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': 'origin' }) }));
  assert.equal(o.systemMessage, '[kit] Параметр «Удалённый репозиторий: origin», но remote origin в git нет — подключить через /kit:project-init.');
  assert.equal(o.hookSpecificOutput.additionalContext, o.systemMessage);
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('ветка ещё не отправлена — только в контекст, с правилом отправки', () => {
  const { dir } = project({ push: false });
  const o = out(dir);
  assert.equal(o.systemMessage, undefined);
  const ctx = o.hookSpecificOutput.additionalContext;
  assert.match(ctx, /ещё не отправлена в origin — отправит \/kit:step-done \(первый раз — после проверки истории на секреты\)/);
  assert.match(ctx, /\[kit\] Удалённый репозиторий origin: после каждого шага \/kit:step-done отправляет коммит \(git push -u origin HEAD\)/);
});

test('в синхроне (ветка worktree с «/» в имени) — строка в контекст, пользователю ничего', () => {
  const { dir } = project({ branch: 'claude/test-branch' });
  const o = out(dir);
  assert.equal(o.systemMessage, undefined);
  assert.match(o.hookSpecificOutput.additionalContext, /^\[kit\] В синхроне с origin\.\n\[kit\] Удалённый репозиторий origin:/);
});

test('на удалённом новые коммиты (работали с другого компьютера) — pull --ff-only, видно пользователю', () => {
  const { dir, bare } = project();
  pushFromOther(bare);
  const o = out(dir);
  assert.equal(o.systemMessage, '[kit] На origin новых коммитов: 1 (работали с другого компьютера) — до любой правки выполни git pull --ff-only; мешают незакоммиченные изменения — стоп и вопрос пользователю.');
  assert.ok(o.hookSpecificOutput.additionalContext.startsWith(o.systemMessage + '\n'));
});

test('не отправлено (remote называется github) — push с этим именем', () => {
  const { dir } = project({ name: 'github' });
  commit(dir, 'c.txt', 'здесь\n');
  const o = out(dir);
  assert.equal(o.systemMessage, '[kit] Не отправлено в github коммитов: 1 — отправь: git push -u github HEAD.');
  assert.match(o.hookSpecificOutput.additionalContext, /Удалённый репозиторий github:/);
});

test('разошлись — стоп и вопрос', () => {
  const { dir, bare } = project();
  pushFromOther(bare);
  commit(dir, 'c.txt', 'здесь\n');
  const o = out(dir);
  assert.match(o.systemMessage, /разошлась с origin: здесь 1, там 1 — стоп, спроси пользователя; --force, rebase и слияния — только с его согласия\.$/);
});

test('remote недоступен — «не удалось проверить», код 0', () => {
  const { dir } = project();
  git(dir, 'remote', 'set-url', 'origin', path.join(tmpDir('kit-gone-'), 'нет-такого.git'));
  const o = out(dir);
  assert.match(o.systemMessage, /^\[kit\] Не удалось проверить origin: .+ — работа идёт дальше, отправка — в \/kit:step-done\.$/);
  assert.match(o.hookSpecificOutput.additionalContext, /Удалённый репозиторий origin:/);
});
```

- [ ] **Шаг 2:** `node --test tests/remote-check.test.js` — падают (скрипта нет).

- [ ] **Шаг 3: код** — `plugins/kit/scripts/remote-check.js`:

```js
#!/usr/bin/env node
'use strict';
// Хук SessionStart (с 2.5.0): сверка ветки с удалённым репозиторием из параметра «Удалённый репозиторий».
// git fetch — не дольше 8 с и без окон входа; в контекст Claude — строка состояния и правило отправки,
// пользователю (systemMessage) — только то, что требует действия. Вне kit-проекта, без параметра, не в git,
// с отсоединённым HEAD — тишина. Любая внутренняя ошибка — тихий выход 0.
const { spawnSync } = require('child_process');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const FETCH_MS = 8000;

function git(dir, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, ...opts });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
  };
}

// Ни вопросов в терминале, ни окна Git Credential Manager, ни ожидания пароля ssh: нет входа — просто ошибка.
function fetchEnv(env) {
  const e = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  if (!e.GIT_SSH_COMMAND) e.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=5';
  return e;
}

const lastLine = (s) => String(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';

// → { context, user } — строки в контекст Claude и пользователю; null — молчать.
function check(dir, env = process.env) {
  const info = kitInfo(dir);
  if (!info.isKit) return null;
  const name = info.params.get('Удалённый репозиторий', '');
  if (!name) return null;
  if (!git(dir, ['rev-parse', '--is-inside-work-tree']).ok) return null;
  const head = git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!head.ok) return null;
  const branch = head.out;
  if (!git(dir, ['remote']).out.split(/\r?\n/).includes(name)) {
    const s = `[kit] Параметр «Удалённый репозиторий: ${name}», но remote ${name} в git нет — подключить через /kit:project-init.`;
    return { context: [s], user: [s] };
  }
  const rule = `[kit] Удалённый репозиторий ${name}: после каждого шага /kit:step-done отправляет коммит (git push -u ${name} HEAD); --force, rebase и слияния — только с согласия пользователя.`;
  const f = git(dir, ['fetch', '--quiet', name], { env: fetchEnv(env), timeout: FETCH_MS });
  if (!f.ok) {
    const why = f.timedOut ? `вышло время (${FETCH_MS / 1000} с)` : lastLine(f.err) || 'git fetch завершился с ошибкой';
    const s = `[kit] Не удалось проверить ${name}: ${why} — работа идёт дальше, отправка — в /kit:step-done.`;
    return { context: [s, rule], user: [s] };
  }
  // Удалённая ветка — та, куда отправляет `git push -u <имя> HEAD`; upstream не берём: он может смотреть в другой remote.
  const remoteRef = `refs/remotes/${name}/${branch}`;
  if (!git(dir, ['rev-parse', '--verify', '--quiet', remoteRef]).ok) {
    const s = `[kit] Ветка ${branch} ещё не отправлена в ${name} — отправит /kit:step-done (первый раз — после проверки истории на секреты).`;
    return { context: [s, rule], user: [] };
  }
  const [ahead, behind] = git(dir, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]).out.split(/\s+/).map(Number);
  let s;
  if (ahead && behind) {
    s = `[kit] Ветка ${branch} разошлась с ${name}: здесь ${ahead}, там ${behind} — стоп, спроси пользователя; --force, rebase и слияния — только с его согласия.`;
  } else if (behind) {
    s = `[kit] На ${name} новых коммитов: ${behind} (работали с другого компьютера) — до любой правки выполни git pull --ff-only; мешают незакоммиченные изменения — стоп и вопрос пользователю.`;
  } else if (ahead) {
    s = `[kit] Не отправлено в ${name} коммитов: ${ahead} — отправь: git push -u ${name} HEAD.`;
  } else {
    return { context: [`[kit] В синхроне с ${name}.`, rule], user: [] };
  }
  return { context: [s, rule], user: [s] };
}

function main() {
  try {
    const r = check(resolveProjectDir(readStdinJson()));
    if (r) {
      const o = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: r.context.join('\n') } };
      if (r.user.length) o.systemMessage = r.user.join('\n');
      process.stdout.write(JSON.stringify(o) + '\n');
    }
  } catch (e) {
    // хук не должен ломать сессию
  }
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { check };
```

В тесте «параметр есть, а remote нет» `additionalContext` равен `systemMessage` — в этой ветке правила нет (remote не подключён, отправлять некуда).

- [ ] **Шаг 4:** `hooks.json` — в `SessionStart[0].hooks` третьим элементом, после `session-start.js`:

```json
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/remote-check.js"], "timeout": 15 }
```

(у строки `session-start.js` — запятая в конце). В `tests/phpstorm-exclude.test.js` тест «hooks.json: SessionStart запускает phpstorm-exclude.js --hook рядом с session-start.js» — ожидаемый список:

```js
  assert.deepEqual(args, ['${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js --hook', '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js', '${CLAUDE_PLUGIN_ROOT}/scripts/remote-check.js']);
```

- [ ] **Шаг 5:** `node --test tests/remote-check.test.js tests/phpstorm-exclude.test.js` — всё проходит.
- [ ] **Шаг 6:** `npm test`, обе валидации; `/kit:step-done` — `16.4: хук SessionStart remote-check.js — сверка ветки с удалённым репозиторием (fetch без окон входа, pull --ff-only / push / стоп)`.
- [ ] **Остановка A:** отчёт пользователю (что сделано, тесты, коммиты), AskUserQuestion «дальше?».

## Часть B — скиллы и агент

### Задача 16.5: отправка в `/kit:step-done`, git-keeper не пушит

**Файлы:**
- Изменить: `plugins/kit/skills/step-done/SKILL.md` (frontmatter `description`, новый раздел «5а», раздел «6»)
- Изменить: `plugins/kit/agents/git-keeper.md:8`
- Тест: `tests/content.test.js` (тесты `step-done` и `git-keeper`)

**Интерфейсы:**
- Пользуется: `secret-scan.js --history` (16.3); строками хука (16.4) — только как ориентир, скилл их не разбирает.

- [ ] **Шаг 1: тесты.** В тест «step-done: агенты kit:, один коммит, COAUTHOR, запасной путь» — в массив строк дописать:

```js
    '## 5а. Отправка в удалённый репозиторий', 'Удалённый репозиторий', 'git rev-parse --verify --quiet refs/remotes/<имя>/<ветка>',
    '${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js" --history', 'git push -u <имя> HEAD', 'Git Credential Manager',
    '`--force`, `pull`, `rebase` и слияния — только после его явного выбора', 'коммит остаётся локально',
```

и после цикла:

```js
  const i5 = body.indexOf('## 5. Проверка');
  const i5a = body.indexOf('## 5а. Отправка в удалённый репозиторий');
  assert.ok(i5 > 0 && i5a > i5 && i5a < body.indexOf('## 6. Ответ пользователю'), 'отправка — после проверки коммита');
```

В тест «git-keeper: haiku, один коммит, COAUTHOR дословно, запреты, secret-scan» после цикла:

```js
  assert.ok(!body.includes('remote нет'));
  assert.ok(body.includes('это делает `/kit:step-done` после проверки коммита'));
```

- [ ] **Шаг 2:** `node --test tests/content.test.js` — эти два теста падают.

- [ ] **Шаг 3: `step-done/SKILL.md`.** Frontmatter `description` — заменить на:

```yaml
description: Закрыть проверенный шаг в kit-проекте — журнал и план выкладки обновляет агент kit:docs-keeper, ровно один коммит делает агент kit:git-keeper, результат проверяется, а при заданном «Удалённом репозитории» коммит отправляется туда. Вызывай сам сразу после того, как результат шага проверен; пользователь может вызвать и командой.
```

Между концом раздела «## 5. Проверка» (абзац «Что-то не так … сообщи о проблеме и остановись.») и «## 6. Ответ пользователю» вставить:

````markdown
## 5а. Отправка в удалённый репозиторий

Только если в «Параметрах для агентов» задан `Удалённый репозиторий` (не `—`) и проверка п. 5 прошла. `<имя>` — значение параметра, `<ветка>` — вывод `git symbolic-ref --short HEAD`. Параметра нет — пункт пропусти: коммит остаётся только локально.

1. Первая отправка — ветки там ещё не было:
   ```
   git rev-parse --verify --quiet refs/remotes/<имя>/<ветка>
   ```
   Код не 0 — сначала проверь всю историю ветки на секреты и запрещённые пути:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js" --history
   ```
   Код 1 — не отправляй: покажи находки (значения замаскированы, впереди — хеш коммита) и скажи, что секрет остался в истории: убрать его из истории или начать новый репозиторий с текущего состояния — решает пользователь; историю сам не переписывай. Код 2 — не отправляй, покажи ошибку.
2. Отправка:
   ```
   git push -u <имя> HEAD
   ```
   Откроется окно входа (Git Credential Manager) — входит пользователь; пароли и токены не вводи и не вписывай в адрес.
3. Не вышло:
   - `rejected`, `fetch first`, `non-fast-forward` — на удалённом есть коммиты, которых здесь нет (работали с другого компьютера, или репозиторий создан не пустым): стоп, скажи пользователю и спроси через AskUserQuestion, что делать. `--force`, `pull`, `rebase` и слияния — только после его явного выбора;
   - нет сети, вход не выполнен, репозиторий не найден, вышло время — коммит остаётся локально: причина — одной строкой (последняя строка вывода git). Не повторяй: неотправленное уйдёт со следующим шагом, а при старте сессии хук напомнит.
````

Раздел «## 6. Ответ пользователю» — первое предложение заменить на:

```markdown
Коротко: хеш и заголовок коммита, отправлен ли он (`<имя>/<ветка>` или почему нет), раздел «Сейчас» из отчёта docs-keeper.
```

- [ ] **Шаг 4: `git-keeper.md`, строка 8** — заменить:

```markdown
Ты отвечаешь только за git в репозитории текущей рабочей папки (корень проекта). В удалённый репозиторий не отправляешь: это делает `/kit:step-done` после проверки коммита. Файлы проекта не создаёшь, не правишь и не удаляешь. **Один вызов — не больше одного коммита.**
```

Список «Запрещено» (`push`, `pull`, `fetch` …) не меняется.

- [ ] **Шаг 5:** `node --test tests/content.test.js` — проходит.
- [ ] **Шаг 6:** `npm test`, обе валидации; `/kit:step-done` — `16.5: /kit:step-done отправляет проверенный коммит в удалённый репозиторий (скан истории перед первой отправкой, без --force); git-keeper не пушит`.

### Задача 16.6: подключение в `/kit:project-init`, параметр в шаблоне

**Файлы:**
- Изменить: `plugins/kit/skills/project-init/SKILL.md` (frontmatter, разведка, раздел 2, новый 4.1а, 4.3, 4.8, раздел 5)
- Изменить: `plugins/kit/skills/project-init/templates/CLAUDE.md` (раздел параметров)
- Тест: `tests/content.test.js` (тест `project-init`), `tests/templates.test.js` (тест «раздел параметров со всеми ключами»)

- [ ] **Шаг 1: тесты.** В тест «project-init: только командой, все шаги и шаблоны на месте» — в массив строк:

```js
    'git remote -v', '### 4.1а Удалённый репозиторий', 'git remote add origin <адрес>', 'Удалённый репозиторий: origin',
    'закрытым и **пустым**', 'логин, пароль или токен', 'Git Credential Manager', 'git remote set-url origin <адрес>',
```

В `tests/templates.test.js`, тест «CLAUDE.md: раздел параметров со всеми ключами», — в список ключей дописать `'удалённый репозиторий'`.

- [ ] **Шаг 2:** `node --test tests/content.test.js tests/templates.test.js` — падают.

- [ ] **Шаг 3: `project-init/SKILL.md`.**

Frontmatter `description` — после «первый коммит,» вставить «удалённый репозиторий (работа с другого компьютера),».

Раздел 1, строку `- **git:** …` заменить на:

```markdown
- **git:** есть ли `.git`; `git config --get core.autocrlf`, `git config --get core.quotepath`; число коммитов (`git rev-list --count HEAD`) и первый коммит; `git remote -v` — имя и адрес удалённого репозитория (логин или токен в адресе, если есть, пользователю не показывай — маскируй).
```

Раздел 2, строку `Адрес дева (при «дев + прод») — третьим вызовом.` заменить на:

```markdown
Третий вызов — адрес дева (при «дев + прод») и удалённый репозиторий: «Удалённый репозиторий для работы с другого компьютера — git проекта с журналом отправляется туда после каждого шага». Варианты: найденный разведкой remote (`origin` — первым с «(Рекомендую)»; параметр `Удалённый репозиторий` уже задан — он первым), «Создам закрытый репозиторий — адрес впишу в «Другое»», «Не нужен». В тексте вопроса: репозиторий создаёт пользователь (GitHub, GitLab или сервер, где разрешает работодатель) закрытым и **пустым** — без README и лицензии, иначе первая отправка будет отклонена; вход — он же, при первой отправке. Параметр уже задан и такой remote есть — вопрос не задавай.
```

После абзаца «Репозиторий уже есть — выполни из этого раздела только п. 2 …» (конец раздела 4.1) вставить:

```markdown
### 4.1а Удалённый репозиторий — если ответ не «Не нужен»

1. Адрес `http://` или `https://` с логином, паролем или токеном перед `@` (`https://user:token@github.com/…`) не принимай — переспроси: он лёг бы открытым текстом в `.git/config`; вход — через Git Credential Manager при первой отправке. `git@хост:путь` и `ssh://…` — можно (вход по SSH-ключу).
2. `origin` нет — `git remote add origin <адрес>`; есть с другим адресом — AskUserQuestion: оставить / заменить (`git remote set-url origin <адрес>`).
3. Параметр в `.claude/CLAUDE.md` (п. 4.3): `Удалённый репозиторий: origin`; ответ «Не нужен» — `—`.
4. Первая отправка — в `/kit:step-done` шага 4.8: он сам проверит историю на секреты и выполнит `git push -u origin HEAD`.
```

В 4.3, после абзаца про параметр «Выкладка» (таблица) — строка:

```markdown
Параметр «Удалённый репозиторий» — `origin` по п. 4.1а или `—`.
```

В 4.8 — последним пунктом списка:

```markdown
- Параметр «Удалённый репозиторий» задан — `/kit:step-done` проверит историю и отправит коммит (его п. 5а); окно входа — пользователь. Отправка не удалась — скажи почему; коммит остаётся и уйдёт со следующим шагом.
```

В разделе 5 «Итог пользователю» — в перечень действий за пользователем дописать: «вход в GitHub/GitLab при первой отправке (если отправка не удалась)».

- [ ] **Шаг 4: шаблон `templates/CLAUDE.md`** — после строки `- Секреты: {{подстроки секретов проекта | —}}`:

```markdown
- Удалённый репозиторий: {{origin | —}}
```

- [ ] **Шаг 5:** `node --test tests/content.test.js tests/templates.test.js` — проходит.
- [ ] **Шаг 6:** `npm test`, обе валидации; `/kit:step-done` — `16.6: /kit:project-init подключает удалённый репозиторий (вопрос, проверка адреса, git remote add, параметр); параметр в шаблоне CLAUDE.md`.
- [ ] **Остановка B:** отчёт, AskUserQuestion «дальше?».

## Часть C — документы и выпуск

### Задача 16.7: README и обзор со схемами

**Файлы:**
- Изменить: `README.md`
- Изменить: `.claude/docs/work/overview/build/build.js`, `.claude/docs/work/overview/build/diagrams.js`
- Пересобрать: `.claude/docs/work/overview/overview.md`, `overview.html`, `img/*.svg` (`node .claude/docs/work/overview/build/build.js`)

- [ ] **Шаг 1: README.**
  - Таблица «Что внутри», строка `/kit:step-done`: колонку «Зачем» заменить на «журнал и реестр документов (docs-keeper) → при закрытии этапа — документы этапа в `archive/` (с вашего выбора) → один коммит (git-keeper) → проверка → отправка в удалённый репозиторий, если он задан».
  - Строка «хук SessionStart»: дописать в конец «; сверка с удалённым репозиторием (`remote-check.js`): новые коммиты там — Claude делает `git pull --ff-only`, неотправленные — отправляет, разошлись — стоп».
  - «Параметры проекта»: в пример после `- Секреты: —` — строку `- Удалённый репозиторий: origin`; в список пояснений — пункт: «**Удалённый репозиторий** — имя remote в git (`origin`), куда `/kit:step-done` отправляет каждый проверенный коммит (первый раз — после проверки всей истории на секреты); `—` — не отправлять. Адрес хранится в `.git/config`; подключает `/kit:project-init`.»
  - Новый раздел после «Параметры проекта»:

```markdown
## Работа с другого компьютера (с 2.5.0)

Если git проекта лежит в закрытом удалённом репозитории (параметр «Удалённый репозиторий»), продолжить работу дома или на другой машине — это:

1. Claude Code, Node.js ≥ 18 и плагин — «Установка» выше (с GitHub).
2. `git clone <адрес>` — для сайтов в ту же папку, что на работе (например `C:\OSPanel\home\<сайт>`): параметр «PHP» — путь к `php.exe` на машине, и он в git. OSPanel в другой папке — `php -l` молча пропускается, а `kit-exec.php` не собирается.
3. PhpStorm: открыть папку и настроить сервер выкладки (`.idea` не в git); исключения `.idea`, `.git`, `.claude` хук допишет сам при первом старте сессии.
4. SSH к серверу — свой ключ этой машины (`plugins/kit/skills/project-init/reference/ssh.md`); Битрикс без SSH — файл-канал `kit-exec.php`.
5. `/kit:visual` — зависимости ставятся заново; эталоны `before` остались на первой машине — снять заново.
6. Работать с одного компьютера за раз: при старте сессии хук сам подтянет коммиты, сделанные на другой машине (`git pull --ff-only`), а `/kit:step-done` отправит свои. Ветки разошлись — Claude остановится и спросит.

Репозиторий создаёте вы (закрытым и пустым — без README), вход в GitHub/GitLab — тоже вы (окно Git Credential Manager при первой отправке). Секреты в репозиторий не попадают: `.gitignore`, git-keeper и `secret-scan.js`, а перед первой отправкой — проверка всей истории.
```

- [ ] **Шаг 2: `diagrams.js` — `hooks()`** заменить целиком:

```js
// 3. Хуки: событие → признак kit-проекта → скрипт → проверка → итог.
function hooks() {
  const d = makeDiagram('d3', 1040, 446, 'Три хука: каждое событие сначала проверяет, kit-проект ли это; если нет — тишина. SessionStart дописывает исключения PhpStorm, кладёт в контекст раздел «Сейчас» и правила и сверяет ветку с удалённым репозиторием; PreToolUse запрещает cd вне подоболочки и sed -i по PHP; PostToolUse прогоняет php -l и при ошибке возвращает код 2.');
  d.box({ x: 20, y: 22, w: 200, h: 140, k: 'hook', L: [['tm', 'SessionStart'], ['m', 'startup · resume'], ['m', 'clear · compact']] });
  d.box({ x: 20, y: 200, w: 200, h: 70, k: 'hook', L: [['tm', 'PreToolUse'], ['m', 'Bash · PowerShell']] });
  d.box({ x: 20, y: 312, w: 200, h: 70, k: 'hook', L: [['tm', 'PostToolUse'], ['m', 'Write · Edit · MultiEdit']] });
  d.box({ x: 262, y: 22, w: 130, h: 360, k: 'core', L: [['t', 'kit-проект?'], ['s', '«Параметры»'], ['s', 'или журнал']] });
  d.edge([[327, 382], [327, 410]], { c: 'u' });
  d.label(327, 430, 'нет → тишина, код 0', 'middle', 'u');
  d.edge([[220, 92], [262, 92]]);
  d.edge([[220, 235], [262, 235]]);
  d.edge([[220, 347], [262, 347]]);
  d.box({ x: 432, y: 22, w: 190, h: 40, L: [['m', 'phpstorm-exclude.js']] });
  d.box({ x: 432, y: 72, w: 190, h: 40, L: [['m', 'session-start.js']] });
  d.box({ x: 432, y: 122, w: 190, h: 40, L: [['m', 'remote-check.js']] });
  d.box({ x: 432, y: 210, w: 190, h: 50, L: [['m', 'guard-bash.js']] });
  d.box({ x: 432, y: 322, w: 190, h: 50, L: [['m', 'php-lint.js']] });
  d.edge([[392, 42], [432, 42]]);
  d.edge([[392, 92], [432, 92]]);
  d.edge([[392, 142], [432, 142]]);
  d.edge([[392, 235], [432, 235]], { lbl: 'да', lx: 412, ly: 227 });
  d.edge([[392, 347], [432, 347]]);
  d.box({ x: 662, y: 22, w: 358, h: 40, k: 'ext', L: [['s', 'Excluded Paths в .idea/deployment.xml']] });
  d.box({ x: 662, y: 72, w: 358, h: 40, L: [['s', 'в контекст Claude: «Сейчас» + правила']] });
  d.box({ x: 662, y: 122, w: 358, h: 40, k: 'ext', L: [['s', 'git fetch → pull --ff-only, push или стоп']] });
  d.box({ x: 662, y: 202, w: 180, h: 66, L: [['m', 'cd вне ( … )'], ['m', 'Set-Location'], ['m', 'sed -i по .php']] });
  d.box({ x: 870, y: 210, w: 150, h: 50, k: 'user', L: [['t', 'deny'], ['s', '+ причина']] });
  d.box({ x: 662, y: 314, w: 180, h: 66, L: [['s', '.php и параметр'], ['s', '«PHP» — путь'], ['s', 'к php.exe']] });
  d.box({ x: 870, y: 322, w: 150, h: 50, k: 'user', L: [['t', 'код 2'], ['s', 'ошибка → Claude']] });
  d.edge([[622, 42], [662, 42]]);
  d.edge([[622, 92], [662, 92]]);
  d.edge([[622, 142], [662, 142]]);
  d.edge([[622, 235], [662, 235]]);
  d.edge([[842, 235], [870, 235]]);
  d.edge([[622, 347], [662, 347]]);
  d.edge([[842, 347], [870, 347]]);
  d.text(945, 280, 'иначе — выполняется', 's', 'middle');
  d.text(945, 392, 'нет ошибки — тишина', 's', 'middle');
  return d;
}
```

- [ ] **Шаг 3: `diagrams.js` — `stepDone()`**: высота `640` → `700` в `makeDiagram('d4', 1040, 700, …)`, в конец подписи `aria` дописать « Если задан удалённый репозиторий — после проверки коммит отправляется: в первый раз — после проверки всей истории на секреты.»; конец линий жизни `632` → `692`; после строки `msg(620, …)` добавить:

```js
  msg(652, 'C', 'SS', '--history — только перед первой отправкой');
  msg(684, 'C', 'G', 'push -u <имя> HEAD — если задан «Удалённый репозиторий»');
```

`map()`: в `ext[1]` — `[['s', 'журнал и план'], ['s', 'коммит и push']]`. `cycle()`: у `/kit:step-done` подпись `'журнал + один коммит'` → `'журнал, коммит, push'`.

- [ ] **Шаг 4: `build.js`.**
  - `eyebrow`: `плагин kit 2.4.2` → `плагин kit 2.5.0`; `footer`: `версии 2.4.2` → `версии 2.5.0`; в `inv` `13` node-скриптов → `14`.
  - Раздел `huki`: после абзаца про `phpstorm-exclude.js` (перед `<h3>Страж команд и php -l</h3>`) вставить:

```html
  <p>Третий скрипт SessionStart, <code>remote-check.js</code> (с 2.5.0), работает, только если задан параметр «Удалённый репозиторий». Он делает <code>git fetch</code> не дольше 8 секунд и без окон входа и сравнивает ветку с удалённой: новые коммиты там — Claude до любой правки выполняет <code>git pull --ff-only</code>; неотправленные здесь — отправляет; разошлись — останавливается и спрашивает. Нет сети или входа — строка «не удалось проверить», работа идёт дальше.</p>
```

  - Раздел `step-done`: подпись схемы дописать предложением «Если задан удалённый репозиторий, после проверки коммит отправляется (git push -u); в первый раз — только после проверки всей истории на секреты.»; в список «Особенности» первым пунктом:

```html
        <li><b>Отправка</b> (с 2.5.0) — после проверки коммита, если задан «Удалённый репозиторий»: <code>git push -u &lt;имя&gt; HEAD</code>. Отклонено — стоп и вопрос; нет сети или входа — коммит остаётся и уйдёт со следующим шагом. <code>--force</code> — никогда без согласия.</li>
```

  - Новый раздел после `deploy-list` (перед `project-init`) и пункт оглавления `['udalennyj', 'Удалённый репозиторий']` после `deploy-list` в массиве `toc`:

```html
<section id="udalennyj">
  <h2>Удалённый репозиторий и работа с другого компьютера</h2>
  <p>С 2.5.0 git проекта можно держать в закрытом удалённом репозитории (GitHub, GitLab, корпоративный сервер). Тогда заболели или работаете из дома — достаточно <code>git clone</code>: вместе с кодом придут журнал, решения, план выкладки, правила и скрипты. Репозиторий создаёте вы — закрытым и пустым, вход тоже ваш; подключает его <code>/kit:project-init</code> (параметр «Удалённый репозиторий: origin»).</p>
  <ol class="chain">
    <li><span>шаг проверен</span></li>
    <li><span>один коммит (git-keeper)</span></li>
    <li><span>первый раз: <code>secret-scan --history</code></span></li>
    <li><span><code>git push -u origin HEAD</code></span></li>
  </ol>
  <ul>
    <li>На другой машине: плагин, <code>git clone</code> в ту же папку (параметр «PHP» — путь на машине, и он в git), сервер выкладки в PhpStorm (<code>.idea</code> не в git), свой SSH-ключ, зависимости снимков заново.</li>
    <li>Работать с одного компьютера за раз: при старте хук подтянет чужие коммиты, <code>/kit:step-done</code> отправит свои; разошлись — Claude остановится и спросит.</li>
    <li>Адрес с логином или токеном внутри не принимается; перед первой отправкой проверяется вся история — секрет из старых коммитов остановит отправку.</li>
  </ul>
</section>
```

  - Таблица «Параметры: кто что читает» (`class="mx"`): новая колонка `remote-check` после `phpstorm-exclude` — в `<thead>` `<th>remote-check</th>`, в каждой строке `<tbody>` пустая `<td></td>` на этой позиции, у строки «Журнал» `colspan="10"` → `colspan="11"`; последней строкой:

```html
      <tr><td>Удалённый репозиторий</td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
```

  и под таблицей в абзац про «Окружение» дописать: «„Удалённый репозиторий“ читает ещё `/kit:step-done` — чтобы отправить коммит.»
  - Таблица «Грабли»: последней строкой:

```html
      <tr><td>заболел — продолжить работу не с чего</td><td>удалённый репозиторий: коммит уходит после каждого шага, при старте сессии — сверка; дома — <code>git clone</code></td></tr>
```

- [ ] **Шаг 5:** `node .claude/docs/work/overview/build/build.js` — «Собрано…», предупреждений о ширине нет; открыть `img/03-huki.svg` и `img/04-step-done.svg` (Read) — текст в блоках, стрелки не пересекают подписи.
- [ ] **Шаг 6:** `npm test`, обе валидации; `/kit:step-done` — `16.7: README и обзор — удалённый репозиторий и работа с другого компьютера (схемы хуков и step-done, раздел, параметры)`.

### Задача 16.8: версия 2.5.0

**Файлы:** `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Шаг 1:** `version` → `2.5.0` в обоих. `description` в `plugin.json` и в записи плагина `marketplace.json` — после «закрытие шага» вставить «, отправка в закрытый удалённый репозиторий и сверка с ним при старте (работа с другого компьютера)».
- [ ] **Шаг 2:** `npm test` (тест манифестов сверяет версии), обе валидации.
- [ ] **Шаг 3:** `/kit:step-done` — `16.8: выпуск 2.5.0 — удалённый репозиторий проекта (параметр, отправка после шага, secret-scan --history, хук remote-check.js)`; STAGE не передавать, NEXT — `16.9 — живая проверка`.
- [ ] **Шаг 4 — с согласия пользователя (AskUserQuestion):** `claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit`; `git push origin master`. Перезапуск сессий — пользователь.
- [ ] **Остановка C:** отчёт, AskUserQuestion «живую проверку делаем?».

### Задача 16.9: живая проверка (с пользователем, по его согласию)

Сценарий «заболел»: пользователь создаёт закрытый пустой репозиторий (например, `kit-remote-test` на GitHub) и даёт адрес.
1. Временный kit-проект `C:\OSPanel\home\kit-remote-test` (файл, `.claude/CLAUDE.md` с параметрами, журнал из шаблона): `git init`, первый коммит через git-keeper, `git remote add origin <адрес>`, параметр `Удалённый репозиторий: origin`.
2. Шаг `0.2` через `/kit:step-done`: `secret-scan --history` — чисто; `git push -u origin HEAD` — окно входа, входит пользователь; отправлено.
3. «Дом»: `git clone <адрес> C:\OSPanel\home\kit-remote-test-home`, коммит и `git push` там.
4. Новая сессия в первой папке: хук пишет «На origin новых коммитов: 1 …»; Claude делает `git pull --ff-only`.
5. Итог — в NOTES `/kit:step-done` `16.9`; временные папки и тестовый репозиторий удаляет пользователь (или Claude — с его согласия, только локальные папки). STAGE не передавать; NEXT — `—` (этап 16 закрыт).
