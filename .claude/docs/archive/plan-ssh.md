# План реализации: этап 8 — `/kit:server` (SSH, иначе Командная PHP-строка)

> **Для исполнителя:** обязательный навык — superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans; задачи выполняются по порядку, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** работа на сервере сайта сначала по SSH (команды оболочки и PHP с ядром Битрикса), а если SSH не задан или не пустил — через Командную PHP-строку в Chrome; одна команда `/kit:server` вместо `/kit:bitrix-console`, версия плагина 2.0.0.

**Архитектура:** общая основа `scripts/lib/ssh.js` (адрес сервера из параметров, запуск `ssh -o BatchMode=yes` без оболочки, служебная метка `__KIT_EXIT=N`, по которой «PHP упал» отличается от «сервер не пустил»). Поверх неё два инструмента: `remote-php.js` (код из файла → приставка с ядром Битрикса → stdin PHP на сервере) и `ssh-probe.js` (разведка папки сайта и PHP для `/kit:project-init`). Скилл `bitrix-console` переезжает в `skills/server` и получает канал SSH перед прежним браузерным. Тесты не ходят на настоящие серверы: вместо `ssh` — заглушка `tests/fake-ssh.js` через переменную `KIT_SSH`, PHP-код заглушка выполняет локальным PHP 7.4.

**Стек:** Node.js ≥ 18 (установлен v24), `node:test`, OpenSSH (Git Bash 9.9 и Windows 9.5 — оба проверены на alpha 2026-09-24), PHP из `C:\OSPanel\modules\PHP-X.Y\php.exe`, Claude Code 2.1.278.

**Спек:** `docs/spec-claude-kit.md` (дополнен 2026-09-24: §3 факты про SSH, §5 параметры, §7.3 SSH-шаг, §7.4 `/kit:server`, §9 `remote-php.js`, `ssh-probe.js`, `lib/ssh.js`, §11 проверка) — читать вместе с планом.

## Общие ограничения

- Node.js ≥ 18, никаких npm-зависимостей. Скрипты — CommonJS, `'use strict'`, первая строка исполняемых — `#!/usr/bin/env node`.
- Windows 11: пути с `\` и `/`, PowerShell 5.1 и Git Bash. Файлы — UTF-8 без BOM, переводы строк LF. Тексты для пользователя, комментарии и сообщения — по-русски.
- Тесты: `node --test tests/*.test.js` из корня worktree (`C:\OSPanel\home\claude-kit\.claude\worktrees\ecstatic-mendeleev-03da1a`). PHP для тестов — `C:\OSPanel\modules\PHP-7.4\php.exe` (плюс 7.2 и 8.3 там, где уже проверялись); нет бинарника — тест пропускается (`skip`), а не падает.
- **Тесты никогда не подключаются к настоящим серверам.** `ssh` в тестах — только заглушка `tests/fake-ssh.js` (`KIT_SSH`). Настоящий сервер — только задача 8.9, её выполняет контроллер с согласия пользователя.
- Все вызовы ssh — `-o BatchMode=yes -o ConnectTimeout=15` (в `lib/ssh.js` ещё `ServerAliveInterval=15`, `ServerAliveCountMax=4`); `StrictHostKeyChecking=no` / `accept-new` не использовать.
- Хост SSH — только `^[A-Za-z0-9_][A-Za-z0-9_.@-]*$`: без `-` в начале, иначе значение из параметров проекта стало бы опцией ssh (`-oProxyCommand=…` запускает локальную команду).
- Версия плагина меняется только в задаче 8.8: `2.0.0` одинаково в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json`.
- Bash: без `cd` в основной оболочке (страж kit блокирует) — абсолютные пути, `git -C <путь>`, подоболочка `( cd … )`; PHP не править `sed`.
- **Git и журнал:** исполнитель не коммитит и не правит `docs/progress.md`; из git ему можно только читать (`status`, `diff`, `log`, `show`). Перенос папки скилла — `git mv` (задача 8.6) — единственное исключение. Шаг закрывает контроллер после ревью через `/kit:step-done` (docs-keeper → git-keeper, один коммит `8.N: …`); исправления по ревью — отдельными коммитами с тем же ID и буквой (`8.4а`), без amend.
- Упоминания `bitrix-console` в истории (`docs/progress.md`, `docs/plan-claude-kit.md`, спек §2/§4/§7.4 — «вместо», «до 2.0.0») остаются как есть; в плагине, README и тестах после задачи 8.7 их нет (кроме проверки, что старой папки нет).

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `plugins/kit/scripts/lib/ssh.js` | хост и папка из «SSH прод/дев», кавычки, запуск ssh, метка | 8.3 |
| `tests/fake-ssh.js` | заглушка ssh для тестов (сценарии по имени хоста, локальный PHP) | 8.3 |
| `tests/ssh.test.js` | тесты `lib/ssh.js` | 8.3 |
| `plugins/kit/scripts/remote-php.js` + `tests/remote-php.test.js` | PHP-код на сервере по SSH | 8.4 |
| `plugins/kit/scripts/ssh-probe.js` + `tests/ssh-probe.test.js` | разведка папки сайта и PHP | 8.5 |
| `plugins/kit/skills/server/**` (было `skills/bitrix-console/**`) | скилл `/kit:server`, библиотека PHP-скриптов | 8.6 |
| `plugins/kit/skills/project-init/reference/ssh.md` | справка: вход по ключу | 8.6 |
| `plugins/kit/scripts/php-lint.js`, `md5-check.js` | пути библиотеки `skills/server/scripts/` | 8.6 |
| `tests/content.test.js`, `console-scripts.test.js`, `guard-bash.test.js` | скилл server, пути, `ssh '… cd …'` не блокируется | 8.6 |
| `plugins/kit/skills/project-init/SKILL.md`, `templates/CLAUDE.md`, `templates/deploy-prod.md`, `reference/bitrix.md` | SSH-шаг, параметры, упоминания `/kit:server` | 8.7 |
| `plugins/kit/skills/deploy-list/SKILL.md`, `plugins/kit/scripts/site-probe.js` | упоминания `/kit:server` | 8.7 |
| `tests/templates.test.js`, `tests/net.test.js`, `tests/content.test.js` | новые ключи, подсказка, нет `bitrix-console` в плагине | 8.7 |
| `README.md`, `plugin.json`, `marketplace.json` | описание, параметры, версия 2.0.0 | 8.8 |
| `docs/spec-claude-kit.md` | уточнение про допустимый хост | 8.3 |

## Шаги журнала и остановки

| Часть | Шаги | Кто | Остановка на проверку пользователя |
|---|---|---|---|
| A — инструменты | 8.3 `lib/ssh.js`, 8.4 `remote-php.js`, 8.5 `ssh-probe.js` | исполнители (sonnet), ревью по каждой задаче | после 8.5 |
| B — скиллы и тексты | 8.6 `/kit:server`, 8.7 `project-init` и упоминания | исполнители (sonnet), ревью | после 8.7 |
| C — выпуск и живая проверка | 8.8 README, 2.0.0, validate, `plugin details`; 8.9 alpha (только чтение) | 8.8 — исполнитель; 8.9 — контроллер с пользователем | после 8.9 |
| D — слияние | 8.10 финальное ревью (opus), слияние в `master`, обновление установленного плагина, push с согласия | контроллер | в конце |

---

## Часть A — инструменты

### Задача 8.3: `lib/ssh.js` и заглушка ssh

**Files:**
- Create: `plugins/kit/scripts/lib/ssh.js`
- Create: `tests/fake-ssh.js`
- Create: `tests/ssh.test.js`
- Modify: `docs/spec-claude-kit.md` (§9, абзац «`lib/ssh.js`»)

**Interfaces:**
- Consumes: `plugins/kit/scripts/lib/params.js` — `parseParams(md)`, `makeParams(values)` → `{ get(key, def) }` (обратные кавычки вокруг значения снимает `get`); `tests/helpers.js` — `tmpDir(prefix)`.
- Produces (для 8.4, 8.5):
  - `SSH_OPTS: string[]` — `['-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4']`;
  - `shq(s: string) → string` — строка в одинарных кавычках для удалённой оболочки POSIX (`'` → `'\''`);
  - `validHost(host: string) → boolean`;
  - `parseTarget(value: string) → { host, root } | null`;
  - `serverSsh(params, env = 'прод') → { host, root } | null` (env — `'прод'` или `'дев'`);
  - `runSsh(host, remoteCmd, stdin) → Promise<{ connected: boolean, exitCode: number|null, stdout: string, stderr: string }>`;
  - `lastLine(text) → string` — последняя непустая строка (причина отказа ssh);
  - заглушка `tests/fake-ssh.js`: `KIT_SSH=<путь>/fake-ssh.js` (`.js` запускается через `process.execPath`); хост `down` / `denied` — отказ (255, без метки), `drop` — `начало\n` в stdout и обрыв, `empty` — только метка с кодом 0; иначе при `FAKE_SSH_OUT` — печатает его и метку с кодом `FAKE_SSH_EXIT` (по умолчанию 0), без `FAKE_SSH_OUT` — выполняет PHP из команды `'<php>'; …` локально (`-d display_errors=stderr`, stdin → php) и печатает метку с кодом php; `FAKE_SSH_LOG` — JSON `{ opts, host, command, stdin }`.

- [ ] **Шаг 1: заглушка ssh `tests/fake-ssh.js`**

```js
#!/usr/bin/env node
'use strict';
// Заглушка ssh для тестов (KIT_SSH): node fake-ssh.js [-o опция]… <хост> <команда>.
// Хост выбирает сценарий: down, denied — не пустил (255, без метки); drop — начал выводить и оборвался (255, без метки);
// empty — команда ничего не вывела (только метка с кодом 0).
// Иначе: FAKE_SSH_OUT задан — печатает его и метку с кодом FAKE_SSH_EXIT (по умолчанию 0); не задан — команда вида
// '<php>'; printf … выполняется локальным PHP: stdin → php, затем метка с кодом php (как настоящий сервер).
// FAKE_SSH_LOG — файл для проверок: { opts, host, command, stdin }.
// Выход — через process.exitCode, а не process.exit(): на Windows запись в канал асинхронная и обрезалась бы.
const fs = require('fs');
const { spawnSync } = require('child_process');

const mark = (code) => '\n__KIT_EXIT=' + code + '\n';

function fail(out, err) {
  process.stdout.write(out);
  process.stderr.write(err);
  return 255;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = [];
  let i = 0;
  while (argv[i] === '-o') {
    opts.push(argv[i + 1]);
    i += 2;
  }
  const host = argv[i];
  const command = argv.slice(i + 1).join(' ');
  const stdin = fs.readFileSync(0);
  if (process.env.FAKE_SSH_LOG) {
    fs.writeFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ opts, host, command, stdin: stdin.toString('utf8') }));
  }
  if (host === 'down') return fail('', 'ssh: connect to host down port 22: Connection timed out\n');
  if (host === 'denied') return fail('', 'user100@denied: Permission denied (publickey).\n');
  if (host === 'drop') return fail('начало\n', 'Connection to drop closed by remote host.\n');
  if (host === 'empty') {
    process.stdout.write(mark(0));
    return 0;
  }
  if (process.env.FAKE_SSH_OUT !== undefined) {
    process.stdout.write(process.env.FAKE_SSH_OUT + mark(process.env.FAKE_SSH_EXIT || 0));
    return 0;
  }
  const m = /^'((?:[^']|'\\'')*)'/.exec(command);
  const bin = m ? m[1].replace(/'\\''/g, "'") : command.split(/\s+/)[0];
  const r = spawnSync(bin, ['-d', 'display_errors=stderr'], { input: stdin });
  process.stdout.write(Buffer.concat([r.stdout || Buffer.alloc(0), Buffer.from(mark(r.status === null ? 255 : r.status))]));
  process.stderr.write(r.stderr || Buffer.alloc(0));
  return 0;
}

process.exitCode = main();
```

- [ ] **Шаг 2: падающие тесты `tests/ssh.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('./helpers');
const { makeParams, parseParams } = require('../plugins/kit/scripts/lib/params');
const { SSH_OPTS, shq, validHost, parseTarget, serverSsh, runSsh, lastLine } = require('../plugins/kit/scripts/lib/ssh');

const FAKE = path.join(__dirname, 'fake-ssh.js');
const KEYS = ['KIT_SSH', 'FAKE_SSH_LOG', 'FAKE_SSH_OUT', 'FAKE_SSH_EXIT'];

// runSsh берёт KIT_SSH из process.env в момент вызова; тесты в файле идут по очереди.
async function withFake(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  Object.assign(process.env, { KIT_SSH: FAKE, FAKE_SSH_LOG: log }, env);
  try {
    const r = await fn();
    return { r, sent: fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null };
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('validHost и parseTarget: хост:абсолютная папка; опции ssh, пробелы и ~ не проходят', () => {
  assert.deepEqual(parseTarget('alpha:/var/www/user100/data/www/alpha.example.com/'), { host: 'alpha', root: '/var/www/user100/data/www/alpha.example.com' });
  assert.deepEqual(parseTarget(' user100@alpha.example.com:/home/bitrix/www '), { host: 'user100@alpha.example.com', root: '/home/bitrix/www' });
  for (const bad of ['', '—', 'alpha', 'alpha:', 'alpha:~/www/x', ':/x', 'bad host:/x', '-oProxyCommand=calc:/x', 'alpha:/', undefined]) {
    assert.equal(parseTarget(bad), null, String(bad));
  }
  assert.ok(validHost('alpha'));
  assert.ok(validHost('user100@203.0.113.10'));
  assert.ok(!validHost('-oProxyCommand=calc'));
  assert.ok(!validHost('a b'));
  assert.ok(!validHost(''));
});

test('serverSsh: «SSH прод» / «SSH дев» из параметров, обратные кавычки снимаются', () => {
  const params = makeParams(parseParams('## Параметры для агентов\n\n- SSH прод: `alpha:/var/www/s`\n- SSH дев: —\n'));
  assert.deepEqual(serverSsh(params), { host: 'alpha', root: '/var/www/s' });
  assert.deepEqual(serverSsh(params, 'прод'), { host: 'alpha', root: '/var/www/s' });
  assert.equal(serverSsh(params, 'дев'), null);
  assert.equal(serverSsh(params, 'тест'), null);
  assert.equal(serverSsh(makeParams(null)), null);
});

test('shq и lastLine', () => {
  assert.equal(shq("a'b"), "'a'\\''b'");
  assert.equal(shq('/opt/php74/bin/php'), "'/opt/php74/bin/php'");
  assert.equal(lastLine('a\n\n  b  \n\n'), 'b');
  assert.equal(lastLine(''), '');
  assert.equal(lastLine(undefined), '');
});

test('runSsh: опции без пароля, метка — код команды, вывод без метки, stdin передаётся', async () => {
  const { r, sent } = await withFake({ FAKE_SSH_OUT: 'привет', FAKE_SSH_EXIT: '7' }, () => runSsh('ok', "'php'", 'КОД'));
  assert.deepEqual(r, { connected: true, exitCode: 7, stdout: 'привет', stderr: '' });
  assert.deepEqual(sent.opts, ['BatchMode=yes', 'ConnectTimeout=15', 'ServerAliveInterval=15', 'ServerAliveCountMax=4']);
  assert.deepEqual(SSH_OPTS.filter((x) => x !== '-o'), sent.opts);
  assert.equal(sent.host, 'ok');
  assert.equal(sent.command, '\'php\'; printf "\\n__KIT_EXIT=%s\\n" "$?"');
  assert.equal(sent.stdin, 'КОД');
});

test('runSsh: пустой вывод команды — пустой stdout', async () => {
  const { r } = await withFake({}, () => runSsh('empty', 'true', ''));
  assert.deepEqual(r, { connected: true, exitCode: 0, stdout: '', stderr: '' });
});

test('runSsh: не пустил, обрыв, нет ssh — connected: false', async () => {
  const down = (await withFake({}, () => runSsh('down', 'true', ''))).r;
  assert.equal(down.connected, false);
  assert.equal(down.exitCode, null);
  assert.equal(lastLine(down.stderr), 'ssh: connect to host down port 22: Connection timed out');
  const drop = (await withFake({}, () => runSsh('drop', 'true', ''))).r;
  assert.equal(drop.connected, false);
  assert.equal(drop.stdout, 'начало\n');
  const none = (await withFake({ KIT_SSH: path.join(tmpDir(), 'нет-ssh.exe') }, () => runSsh('ok', 'true', ''))).r;
  assert.equal(none.connected, false);
  assert.match(none.stderr, /не удалось запустить ssh/);
});
```

- [ ] **Шаг 3: запустить — тесты падают**

Run: `node --test tests/ssh.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/lib/ssh'`.

- [ ] **Шаг 4: `plugins/kit/scripts/lib/ssh.js`**

```js
'use strict';
// SSH для kit: адрес сервера из «SSH прод» / «SSH дев», запуск ssh без пароля и метка завершения удалённой команды.
// Метка нужна, потому что ssh возвращает 255 и когда не пустил, и когда 255 вернула сама команда (фатальная ошибка PHP).
const { spawn } = require('child_process');

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
const MARK_RE = /\n__KIT_EXIT=(\d+)\s*$/;
const KEYS = { 'прод': 'SSH прод', 'дев': 'SSH дев' };

// Строка для удалённой оболочки POSIX в одинарных кавычках.
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Псевдоним из ~/.ssh/config или user@host. Без «-» в начале: иначе значение стало бы опцией ssh (-oProxyCommand=…).
function validHost(host) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(String(host || ''));
}

// «хост:/папка» → { host, root }; нет значения, нет «:», недопустимый хост, папка не абсолютная или «/» → null.
function parseTarget(value) {
  const v = String(value || '').trim();
  const i = v.indexOf(':');
  if (i <= 0) return null;
  const host = v.slice(0, i).trim();
  const root = v.slice(i + 1).trim().replace(/\/+$/, '');
  if (!validHost(host) || !root.startsWith('/')) return null;
  return { host, root };
}

// Параметр «SSH прод» / «SSH дев» (env — 'прод' или 'дев').
function serverSsh(params, env = 'прод') {
  const key = KEYS[env];
  return key ? parseTarget(params.get(key)) : null;
}

// Что запускать: KIT_SSH (заглушка тестов *.js — через node) или ssh из PATH.
function sshBinary() {
  const bin = process.env.KIT_SSH || 'ssh';
  return /\.js$/i.test(bin) ? { cmd: process.execPath, pre: [bin] } : { cmd: bin, pre: [] };
}

// Последняя непустая строка — причина отказа ssh для сообщения пользователю.
function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// Выполнить remoteCmd на host, stdin — строка или Buffer.
// → { connected, exitCode, stdout, stderr }; connected: false — метки нет (не пустил или соединение оборвалось).
function runSsh(host, remoteCmd, stdin) {
  return new Promise((resolve) => {
    const { cmd, pre } = sshBinary();
    const args = [...pre, ...SSH_OPTS, host, remoteCmd + '; printf "\\n__KIT_EXIT=%s\\n" "$?"'];
    const out = [];
    const err = [];
    let done = false;
    const finish = (extraErr) => {
      if (done) return;
      done = true;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8') + (extraErr || '');
      const m = MARK_RE.exec(stdout);
      resolve(m
        ? { connected: true, exitCode: Number(m[1]), stdout: stdout.slice(0, m.index), stderr }
        : { connected: false, exitCode: null, stdout, stderr });
    };
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      finish('не удалось запустить ssh: ' + e.message + '\n');
      return;
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => finish('не удалось запустить ssh: ' + e.message + '\n'));
    child.on('close', () => finish());
    child.stdin.on('error', () => {});
    child.stdin.end(stdin == null ? '' : stdin);
  });
}

module.exports = { SSH_OPTS, shq, validHost, parseTarget, serverSsh, runSsh, lastLine };
```

- [ ] **Шаг 5: тесты проходят**

Run: `node --test tests/ssh.test.js`
Expected: PASS, 6 тестов.

- [ ] **Шаг 6: спек — допустимый хост**

В `docs/spec-claude-kit.md`, §9, абзац «**`lib/ssh.js`**», первую строку списка

```
- `serverSsh(params, env)` → `{ host, root }` из «SSH прод» / «SSH дев» (деление по первому `:`; нет значения, нет `:`, папка не абсолютная → `null`);
```

заменить на

```
- `serverSsh(params, env)` → `{ host, root }` из «SSH прод» / «SSH дев» (деление по первому `:`; нет значения, нет `:`, папка не абсолютная → `null`); хост — только `^[A-Za-z0-9_][A-Za-z0-9_.@-]*$` (`validHost`): без `-` в начале, иначе значение из параметров проекта стало бы опцией ssh (`-oProxyCommand=…` запускает локальную команду); то же проверяют флаг `--host` у `remote-php.js` и хост у `ssh-probe.js` (код 4);
```

- [ ] **Шаг 7: весь набор тестов**

Run: `node --test tests/*.test.js`
Expected: PASS (было 126 тестов + 6 новых). Шаг закрывает контроллер: `/kit:step-done 8.3`.

---

### Задача 8.4: `remote-php.js` — PHP-код на сервере

**Files:**
- Create: `plugins/kit/scripts/remote-php.js`
- Create: `tests/remote-php.test.js`

**Interfaces:**
- Consumes: `lib/params.js` — `readParams(dir) → { get(key, def) }`; `lib/ssh.js` — `shq`, `validHost`, `serverSsh`, `runSsh`, `lastLine` (задача 8.3); заглушка `tests/fake-ssh.js`; `tests/helpers.js` — `runScript(name, { args, cwd, env })` → `{ code, stdout, stderr }` (ставит `CLAUDE_PROJECT_DIR: ''`), `makeProject(files)`, `writeFiles(root, files)`, `tmpDir`, `php(version)`, `hasPhp(version)`, `runPhp(version, code)`.
- Produces (для 8.6 — текст скилла, 8.9 — живая проверка): CLI `node remote-php.js [--env прод|дев] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>`, коды 0 выполнено / 1 PHP завершился не 0 / 2 SSH для сервера не задан / 3 нет подключения или обрыв / 4 аргументы или файл; экспорт `{ parseArgs, buildScript, bitrixPrefix, fixLines, stripPre }`.

Поведение (спек §9):
- параметры проекта — из `CLAUDE_PROJECT_DIR`, иначе из текущей папки: «SSH прод»/«SSH дев» (`serverSsh`), «PHP на сервере» (по умолчанию `php`), «Прод»/«Дев» (домен → `HTTP_HOST`), «Режим» (`bitrix` → с ядром; иначе чистый PHP); флаги важнее параметров;
- `--root` проверяется как абсолютный путь POSIX **или** Windows (Windows — только ради тестов с локальным PHP);
- в режиме bitrix без папки сайта — код 4;
- код уходит на stdin команды `shq(<PHP на сервере>)`; `<?php` в начале файла отрезается; `<pre>`/`</pre>` из stdout убираются; `Standard input code( on line |:|\()N` → `<файл, как передан в аргументе><тот же разделитель><N − сдвиг>`; строки приставки — `приставка remote-php<разделитель>N`.

- [ ] **Шаг 1: падающие тесты `tests/remote-php.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, php, hasPhp, runPhp } = require('./helpers');

const FAKE = path.join(__dirname, 'fake-ssh.js');
const skip = !hasPhp('7.4');
const params = (lines) => '# Проект\n\n## Параметры для агентов\n\n' + lines.join('\n') + '\n';

function run(project, args, env = {}) {
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('remote-php.js', { args, cwd: project, env: { KIT_SSH: FAKE, FAKE_SSH_LOG: log, ...env } });
  const sent = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null;
  return { ...r, sent };
}

const fakeSite = (prolog) => writeFiles(tmpDir('kit-site-'), { 'bitrix/modules/main/include/prolog_before.php': prolog });

test('remote-php: аргументы, файл и хост — код 4, ssh не запускается', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  for (const args of [[], ['--nope', 'a.php'], ['--env', 'тест', 'a.php'], ['--host', 'ok', 'нет.php'],
    ['--host', '-oProxyCommand=calc', 'a.php'], ['a.php', 'b.php'], ['--host']]) {
    const r = run(p, args);
    assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
    assert.equal(r.sent, null, JSON.stringify(args));
  }
});

test('remote-php: SSH для сервера не задан — код 2 и подсказка про консоль', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- SSH прод: —']) });
  const r = run(p, ['a.php']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SSH прод/);
  assert.match(r.stderr, /Командн/);
  assert.equal(r.sent, null);
});

test('remote-php: чистый PHP — вывод без <pre>, на stdin — код с приставкой, PHP в кавычках', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo "<pre>привет\\n</pre>";\n' });
  const r = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'привет\n');
  assert.equal(r.sent.host, 'ok');
  assert.ok(r.sent.opts.includes('BatchMode=yes'));
  assert.ok(r.sent.command.startsWith("'" + php('7.4') + "'"), r.sent.command);
  assert.equal(r.sent.stdin, '<?php\necho "<pre>привет\\n</pre>";\n');
});

test('remote-php: <?php в файле отрезается; ошибка разбора — номер строки файла, код 1', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo 1;\necho 1 +;\n', 'b.php': '<?php\necho 1;\necho 1 +;\n' });
  const a = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(a.code, 1);
  assert.match(a.stdout + a.stderr, /a\.php on line 2/);
  assert.doesNotMatch(a.stdout + a.stderr, /Standard input code/);
  const b = run(p, ['--host', 'ok', '--php', php('7.4'), 'b.php']);
  assert.equal(b.code, 1);
  assert.match(b.stdout + b.stderr, /b\.php on line 3/);
  assert.ok(!b.sent.stdin.includes('<?php\n<?php'));
});

test('remote-php: фатальная ошибка PHP (255) — код 1, а не «нет подключения»', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo "до";\nthrow new Exception("x");\n' });
  const r = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /до/);
  assert.match(r.stderr, /a\.php(:| on line )2/);
  assert.match(r.stderr, /кодом 255/);
});

test('remote-php: --bitrix — DOCUMENT_ROOT, домен, без агентов, ядро подключено; строки считаются от файла', { skip }, () => {
  const site = fakeSite("<?php\ndefine('BX_UTF', true);\necho '[ядро]';\n");
  const root = site.replace(/\\/g, '/');
  const p = makeProject({
    'a.php': 'echo "|", $_SERVER["DOCUMENT_ROOT"], "|", $_SERVER["HTTP_HOST"], "|", defined("NO_AGENT_CHECK") ? "без агентов" : "с агентами", "|";\n',
    'b.php': 'echo 1;\necho 1 +;\n',
  });
  const args = ['--bitrix', '--host', 'ok', '--root', root, '--php', php('7.4'), '--url', 'https://alpha.example.com/'];
  const r = run(p, [...args, 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, '[ядро]|' + root + '|alpha.example.com|без агентов|');
  const b = run(p, [...args, 'b.php']);
  assert.equal(b.code, 1);
  assert.match(b.stdout + b.stderr, /b\.php on line 2/);
});

test('remote-php: сайт не в UTF-8 — вывод перекодируется из windows-1251', { skip }, (t) => {
  if (runPhp('7.4', '<?php echo extension_loaded("mbstring") ? "да" : "нет";').stdout !== 'да') {
    t.skip('в PHP 7.4 нет mbstring');
    return;
  }
  const site = fakeSite('<?php\n');
  const p = makeProject({ 'a.php': 'echo "\\xE0\\xE1";\n' });
  const r = run(p, ['--bitrix', '--host', 'ok', '--root', site.replace(/\\/g, '/'), '--php', php('7.4'), 'a.php']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'аб');
});

test('remote-php: --bitrix без папки сайта — код 4', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const r = run(p, ['--bitrix', '--host', 'ok', 'a.php']);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /папка сайта/);
  assert.equal(r.sent, null);
});

test('remote-php: параметры проекта — хост, папка, PHP на сервере, режим bitrix, домен из «Прод»; дев не задан — код 2', { skip }, () => {
  const p = makeProject({
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://alpha.example.com', '- SSH прод: `ok:/var/www/site/`', '- SSH дев: —',
      '- PHP на сервере: ' + php('7.4')]),
    'a.php': 'echo 1;\n',
  });
  const r = run(p, ['a.php']);
  assert.equal(r.sent.host, 'ok');
  assert.ok(r.sent.command.startsWith("'" + php('7.4') + "'"));
  assert.match(r.sent.stdin, /\$_SERVER\['DOCUMENT_ROOT'\] = '\/var\/www\/site';/);
  assert.match(r.sent.stdin, /\$_SERVER\['HTTP_HOST'\] = \$_SERVER\['SERVER_NAME'\] = 'alpha\.example\.com';/);
  assert.match(r.sent.stdin, /define\('NO_AGENT_CHECK', true\)/);
  assert.match(r.sent.stdin, /prolog_before\.php/);
  assert.equal(run(p, ['--env', 'дев', 'a.php']).code, 2);
  assert.equal(run(p, ['--plain', 'a.php']).sent.stdin, '<?php\necho 1;\n');
});

test('remote-php: не пустил — код 3 с причиной; обрыв после начала вывода — код 3, вывод показан', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n' });
  const down = run(p, ['--host', 'down', 'a.php']);
  assert.equal(down.code, 3);
  assert.match(down.stderr, /Connection timed out/);
  assert.match(down.stderr, /remote-php: нет подключения к down/);
  const drop = run(p, ['--host', 'drop', 'a.php']);
  assert.equal(drop.code, 3);
  assert.equal(drop.stdout, 'начало\n');
  assert.match(drop.stderr, /результат неизвестен/);
});
```

- [ ] **Шаг 2: запустить — тесты падают**

Run: `node --test tests/remote-php.test.js`
Expected: FAIL — скрипта `remote-php.js` нет (код не 0/2/3/4, `Cannot find module`).

- [ ] **Шаг 3: `plugins/kit/scripts/remote-php.js`**

```js
#!/usr/bin/env node
'use strict';
// Выполнить PHP-код на сервере по SSH (канал SSH скилла /kit:server).
// node remote-php.js [--env прод|дев] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>
// Код в файле — как для Командной PHP-строки, без <?php (если есть — отрезается). Режим bitrix (параметр «Режим»
// или --bitrix): перед кодом подключается ядро Битрикса. Код уходит на stdin «PHP на сервере», файл на сервер не пишется.
// Коды: 0 — выполнено; 1 — PHP завершился не 0; 2 — SSH для сервера не задан; 3 — нет подключения или оно оборвалось;
// 4 — аргументы или файл.
const fs = require('fs');
const path = require('path');
const { readParams } = require('./lib/params');
const { shq, validHost, serverSsh, runSsh, lastLine } = require('./lib/ssh');

const USAGE = 'Использование: node remote-php.js [--env прод|дев] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>';
const VALUE_FLAGS = { '--env': 'env', '--host': 'host', '--root': 'root', '--php': 'php', '--url': 'url' };

// Строка PHP в одинарных кавычках.
const pq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

// Папка сайта на сервере — абсолютный путь POSIX; Windows-путь принимается ради тестов с локальным PHP.
const isAbsolute = (p) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);

function parseArgs(argv) {
  const o = { env: 'прод', mode: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[VALUE_FLAGS[a]] = argv[++i];
    } else if (a === '--plain' || a === '--bitrix') {
      o.mode = a.slice(2);
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.file) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.file = a;
    }
  }
  if (!o.file) throw new Error('не указан файл с кодом');
  if (o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (o.host !== undefined && !validHost(o.host)) throw new Error('недопустимый хост ' + o.host);
  return o;
}

function domainOf(url) {
  try {
    return new URL(url).hostname || null;
  } catch (e) {
    return null;
  }
}

// Приставка режима bitrix: DOCUMENT_ROOT, домен, ядро без агентов, статистики и почтовых событий, вывод в UTF-8.
function bitrixPrefix(root, domain) {
  const lines = ['<?php', "$_SERVER['DOCUMENT_ROOT'] = " + pq(root) + ';'];
  if (domain) lines.push("$_SERVER['HTTP_HOST'] = $_SERVER['SERVER_NAME'] = " + pq(domain) + ';');
  lines.push(
    "define('NO_KEEP_STATISTIC', true); define('NOT_CHECK_PERMISSIONS', true);",
    "define('NO_AGENT_CHECK', true); define('NO_AGENT_STATISTIC', true); define('DisableEventsCheck', true);",
    "define('BX_NO_ACCELERATOR_RESET', true); define('STOP_STATISTICS', true);",
    "chdir($_SERVER['DOCUMENT_ROOT']);",
    "require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';",
    "if (!defined('BX_UTF') || !BX_UTF) { ob_start(function ($s) { return mb_convert_encoding($s, 'UTF-8', 'Windows-1251'); }); }",
  );
  return lines.join('\n') + '\n';
}

// Скрипт для stdin: приставка + код без <?php. shift — на сколько номер строки в скрипте больше номера в файле.
function buildScript(code, { mode, root, domain }) {
  let body = String(code).replace(/^\uFEFF/, '');
  let removed = 0;
  const open = /^<\?php(?:[ \t]*\r?\n|[ \t]+|$)/i.exec(body);
  if (open) {
    removed = open[0].includes('\n') ? 1 : 0;
    body = body.slice(open[0].length);
  }
  const prefix = mode === 'bitrix' ? bitrixPrefix(root, domain) : '<?php\n';
  const prefixLines = prefix.split('\n').length - 1;
  return { script: prefix + body, prefixLines, shift: prefixLines - removed };
}

// «Standard input code» → путь файла; номер строки — строка файла, строки приставки помечаются.
function fixLines(text, file, prefixLines, shift) {
  return String(text).replace(/Standard input code( on line |:|\()(\d+)/g, (m, sep, n) => {
    const line = Number(n);
    return line <= prefixLines ? 'приставка remote-php' + sep + line : file + sep + (line - shift);
  });
}

const stripPre = (text) => String(text).replace(/<\/?pre>/gi, '');

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('remote-php: ' + e.message + '\n' + USAGE);
    return 4;
  }
  let code;
  try {
    code = fs.readFileSync(path.resolve(o.file), 'utf8');
  } catch (e) {
    console.error('remote-php: не удалось прочитать ' + o.file + ': ' + e.message);
    return 4;
  }
  const params = readParams(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const target = serverSsh(params, o.env) || {};
  const host = o.host || target.host;
  if (!host) {
    console.error('remote-php: SSH для сервера «' + o.env + '» не задан (параметр «SSH ' + o.env + '») — выполнить через Командную PHP-строку (/kit:server, канал «консоль»)');
    return 2;
  }
  const mode = o.mode || (String(params.get('Режим', 'общий')).toLowerCase() === 'bitrix' ? 'bitrix' : 'plain');
  const root = o.root || target.root;
  if (mode === 'bitrix' && !(root && isAbsolute(root))) {
    console.error('remote-php: для ядра Битрикса нужна папка сайта — абсолютный путь (параметр «SSH ' + o.env + '» или --root)');
    return 4;
  }
  const url = o.url || params.get(o.env === 'дев' ? 'Дев' : 'Прод');
  const phpBin = o.php || params.get('PHP на сервере', 'php');
  const { script, prefixLines, shift } = buildScript(code, { mode, root, domain: url ? domainOf(url) : null });
  const r = await runSsh(host, shq(phpBin), script);
  const fix = (t) => fixLines(t, o.file, prefixLines, shift);
  process.stdout.write(fix(stripPre(r.stdout)));
  if (r.stderr) process.stderr.write(fix(r.stderr));
  if (!r.connected) {
    const why = lastLine(r.stderr);
    console.error('remote-php: нет подключения к ' + host + ' или оно оборвалось' + (why ? ': ' + why : '') +
      '. Если код что-то менял — результат неизвестен: не повторять, проверить состояние чтением.');
    return 3;
  }
  if (r.exitCode !== 0) {
    console.error('remote-php: PHP завершился с кодом ' + r.exitCode);
    return 1;
  }
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
module.exports = { parseArgs, buildScript, bitrixPrefix, fixLines, stripPre };
```

- [ ] **Шаг 4: тесты проходят**

Run: `node --test tests/remote-php.test.js`
Expected: PASS, 10 тестов (перекодировка может быть пропущена, если в локальном PHP 7.4 нет mbstring — это не ошибка, но в отчёте указать).

- [ ] **Шаг 5: приставка проходит `php -l` на 7.2/7.4/8.3**

Добавить в конец `tests/remote-php.test.js`:

```js
const { phpLint } = require('./helpers');
const { buildScript } = require('../plugins/kit/scripts/remote-php');

for (const v of ['7.2', '7.4', '8.3']) {
  test(`remote-php: приставка bitrix и библиотечные скрипты проходят php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    const dir = path.join(__dirname, '..', 'plugins', 'kit', 'skills', 'bitrix-console', 'scripts');
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      const { script } = buildScript(src, { mode: 'bitrix', root: "/var/www/it's", domain: 'alpha.example.com' });
      const r = phpLint(v, script);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
  });
}
```

(Путь `skills/bitrix-console/scripts` задача 8.6 заменит на `skills/server/scripts`.)

Run: `node --test tests/remote-php.test.js`
Expected: PASS, 13 тестов.

- [ ] **Шаг 6: весь набор тестов**

Run: `node --test tests/*.test.js`
Expected: PASS. Шаг закрывает контроллер: `/kit:step-done 8.4`.

---

### Задача 8.5: `ssh-probe.js` — разведка сервера для `/kit:project-init`

**Files:**
- Create: `plugins/kit/scripts/ssh-probe.js`
- Create: `tests/ssh-probe.test.js`

**Interfaces:**
- Consumes: `lib/ssh.js` — `shq`, `validHost`, `runSsh`, `lastLine`; заглушка `tests/fake-ssh.js` (`FAKE_SSH_OUT`, `FAKE_SSH_LOG`, хост `denied`); `tests/helpers.js` — `runScript`, `writeFiles`, `tmpDir`.
- Produces (для 8.7 — текст `project-init`): CLI `node ssh-probe.js <хост> [--url адрес] [--php X.Y]`, коды 0 / 3 (не подключился) / 4 (аргументы); вывод строками `Подключение: ок (<пользователь>, <$HOME>)`, `Папка: <путь>[ [bitrix]]` (или `Папка: не найдена — спросить пользователя`), `PHP: <путь> <версия>[ [совпадает]]` (или `PHP: не найден`); экспорт `{ parseArgs, domainsOf, probeScript, parseProbe, format }`.

- [ ] **Шаг 1: падающие тесты `tests/ssh-probe.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runScript, writeFiles, tmpDir } = require('./helpers');
const { domainsOf, probeScript, parseProbe } = require('../plugins/kit/scripts/ssh-probe');

const FAKE = path.join(__dirname, 'fake-ssh.js');

test('ssh-probe: домены — как есть и без www', () => {
  assert.deepEqual(domainsOf('https://www.alpha.example.com/'), ['www.alpha.example.com', 'alpha.example.com']);
  assert.deepEqual(domainsOf('https://alpha.example.com'), ['alpha.example.com']);
  assert.deepEqual(domainsOf('не адрес'), []);
});

test('ssh-probe: вывод — папки без повторов, пометки bitrix и «совпадает»; скрипт уходит на stdin sh -s', () => {
  const out = ['USER user100', 'HOME /var/www/user100/data',
    'DIR /var/www/user100/data/www/alpha.example.com bitrix', 'DIR /var/www/user100/data/www/alpha.example.com bitrix',
    'PHP /opt/php54/bin/php 5.4.45', 'PHP /opt/php74/bin/php 7.4.33', 'PHP /usr/bin/php 5.4.45'].join('\n');
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-probe.js', {
    args: ['ok', '--url', 'https://www.alpha.example.com', '--php', '7.4'],
    env: { KIT_SSH: FAKE, FAKE_SSH_LOG: log, FAKE_SSH_OUT: out },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, [
    'Подключение: ок (user100, /var/www/user100/data)',
    'Папка: /var/www/user100/data/www/alpha.example.com [bitrix]',
    'PHP: /opt/php54/bin/php 5.4.45',
    'PHP: /opt/php74/bin/php 7.4.33 [совпадает]',
    'PHP: /usr/bin/php 5.4.45',
  ].join('\n') + '\n');
  const sent = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(sent.host, 'ok');
  assert.match(sent.command, /^sh -s; printf/);
  assert.ok(sent.stdin.includes("\"$HOME\"/www/'www.alpha.example.com'"));
  assert.ok(sent.stdin.includes("\"$HOME\"/www/'alpha.example.com'"));
  assert.ok(sent.stdin.includes('/home/bitrix/www'));
});

test('ssh-probe: ничего не найдено — подсказки вместо пустоты', () => {
  const r = runScript('ssh-probe.js', { args: ['ok'], env: { KIT_SSH: FAKE, FAKE_SSH_OUT: 'USER u\nHOME /home/u' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Папка: не найдена — спросить пользователя$/m);
  assert.match(r.stdout, /^PHP: не найден$/m);
});

test('ssh-probe: не пустил — код 3 с причиной; аргументы и хост — код 4', () => {
  const r = runScript('ssh-probe.js', { args: ['denied'], env: { KIT_SSH: FAKE } });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /Permission denied \(publickey\)/);
  for (const args of [[], ['-oProxyCommand=x'], ['ok', '--php'], ['ok', '--nope'], ['ok', 'лишний']]) {
    assert.equal(runScript('ssh-probe.js', { args, env: { KIT_SSH: FAKE } }).code, 4, JSON.stringify(args));
  }
});

test('ssh-probe: parseProbe — версия без пометки, если X.Y не задана', () => {
  const p = parseProbe('PHP /opt/php74/bin/php 7.4.33\nPHP /x/php \nDIR /a b/c', null);
  assert.deepEqual(p.php, [{ path: '/opt/php74/bin/php', version: '7.4.33', match: false }, { path: '/x/php', version: null, match: false }]);
  assert.deepEqual(p.dirs, [{ path: '/a b/c', bitrix: false }]);
});

const shOk = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout === 'ok\n';

test('ssh-probe: скрипт разведки в настоящем sh находит папки и пометку bitrix', { skip: !shOk }, () => {
  const home = writeFiles(tmpDir('kit-home-'), { 'www/alpha.example.com/bitrix/.settings.php': '<?php', 'public_html/index.php': '' });
  const r = spawnSync('sh', ['-s'], { input: probeScript(['alpha.example.com']), env: { ...process.env, HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const p = parseProbe(r.stdout, null);
  assert.ok(p.dirs.some((d) => /www\/alpha\.example\.com$/.test(d.path) && d.bitrix), r.stdout);
  assert.ok(p.dirs.some((d) => /public_html$/.test(d.path) && !d.bitrix), r.stdout);
  assert.match(r.stdout, /^USER \S+/m);
});
```

- [ ] **Шаг 2: запустить — тесты падают**

Run: `node --test tests/ssh-probe.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/ssh-probe'`.

- [ ] **Шаг 3: `plugins/kit/scripts/ssh-probe.js`**

```js
#!/usr/bin/env node
'use strict';
// Разведка сервера по SSH для /kit:project-init — только чтение, одно подключение:
// node ssh-probe.js <хост> [--url адрес] [--php X.Y]
// Печатает пользователя и $HOME, папки сайта (пометка bitrix — есть bitrix/.settings.php) и PHP CLI с версиями
// (пометка «совпадает» — major.minor равны X.Y). Коды: 0 — подключился; 3 — не подключился; 4 — аргументы.
const { shq, validHost, runSsh, lastLine } = require('./lib/ssh');

const USAGE = 'Использование: node ssh-probe.js <хост> [--url адрес] [--php X.Y]';

function parseArgs(argv) {
  const o = { host: null, url: null, php: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' || a === '--php') {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.host) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.host = a;
    }
  }
  if (!o.host) throw new Error('не указан хост');
  if (!validHost(o.host)) throw new Error('недопустимый хост ' + o.host);
  return o;
}

// Домены сайта из адреса: как есть и без www.
function domainsOf(url) {
  let h = null;
  try {
    h = new URL(url).hostname;
  } catch (e) {
    return [];
  }
  if (!h) return [];
  const bare = h.replace(/^www\./i, '');
  return bare === h ? [h] : [h, bare];
}

// Скрипт для «sh -s» на сервере: кандидаты папки сайта (ispmanager, «домен/public_html», BitrixVM) и PHP CLI.
function probeScript(domains) {
  const dirs = [];
  for (const d of domains) dirs.push('"$HOME"/www/' + shq(d), '"$HOME"/' + shq(d) + '/public_html', '/home/bitrix/ext_www/' + shq(d));
  dirs.push('"$HOME"/public_html', '/home/bitrix/www');
  return [
    'echo "USER $(id -un)"',
    'echo "HOME $HOME"',
    'for p in ' + dirs.join(' ') + '; do',
    '  [ -d "$p" ] || continue',
    '  r=$(readlink -f "$p")',
    '  if [ -f "$p/bitrix/.settings.php" ]; then echo "DIR $r bitrix"; else echo "DIR $r"; fi',
    'done',
    'for b in /opt/php*/bin/php /usr/local/php*/bin/php $(command -v php 2>/dev/null); do',
    '  [ -x "$b" ] || continue',
    '  echo "PHP $b $("$b" -r \'echo PHP_VERSION;\' 2>/dev/null)"',
    'done',
    'exit 0',
  ].join('\n') + '\n';
}

const majorMinor = (v) => (/^(\d+\.\d+)/.exec(String(v || '')) || [])[1] || null;

function parseProbe(text, wantPhp) {
  const res = { user: null, home: null, dirs: [], php: [] };
  const want = majorMinor(wantPhp);
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    if ((m = /^USER (.+)$/.exec(line))) {
      res.user = m[1];
    } else if ((m = /^HOME (.+)$/.exec(line))) {
      res.home = m[1];
    } else if ((m = /^DIR (.+?)( bitrix)?$/.exec(line))) {
      if (!res.dirs.some((d) => d.path === m[1])) res.dirs.push({ path: m[1], bitrix: Boolean(m[2]) });
    } else if ((m = /^PHP (\S+) ?(.*)$/.exec(line))) {
      const version = m[2].trim() || null;
      if (!res.php.some((x) => x.path === m[1])) {
        res.php.push({ path: m[1], version, match: Boolean(want && majorMinor(version) === want) });
      }
    }
  }
  return res;
}

function format(p) {
  const out = ['Подключение: ок (' + (p.user || '?') + ', ' + (p.home || '?') + ')'];
  if (p.dirs.length) for (const d of p.dirs) out.push('Папка: ' + d.path + (d.bitrix ? ' [bitrix]' : ''));
  else out.push('Папка: не найдена — спросить пользователя');
  if (p.php.length) for (const x of p.php) out.push('PHP: ' + x.path + ' ' + (x.version || '?') + (x.match ? ' [совпадает]' : ''));
  else out.push('PHP: не найден');
  return out.join('\n');
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('ssh-probe: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const r = await runSsh(o.host, 'sh -s', probeScript(o.url ? domainsOf(o.url) : []));
  if (!r.connected) {
    if (r.stderr) process.stderr.write(r.stderr);
    const why = lastLine(r.stderr);
    console.error('ssh-probe: нет подключения к ' + o.host + (why ? ': ' + why : ''));
    return 3;
  }
  console.log(format(parseProbe(r.stdout, o.php)));
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
module.exports = { parseArgs, domainsOf, probeScript, parseProbe, format };
```

- [ ] **Шаг 4: тесты проходят**

Run: `node --test tests/ssh-probe.test.js`
Expected: PASS, 6 тестов (последний пропускается, если `sh` нет в PATH; в Git Bash он есть). Если тест с настоящим `sh` падает из-за вида путей MSYS (`HOME` с `\`) — поправить тест (например, передать `HOME` в виде `/c/…`), а не скрипт разведки, и написать об этом в отчёте.

- [ ] **Шаг 5: весь набор тестов**

Run: `node --test tests/*.test.js`
Expected: PASS. Шаг закрывает контроллер: `/kit:step-done 8.5`. **Остановка A:** отчёт пользователю и вопрос «дальше?».

---

## Часть B — скиллы и тексты

### Задача 8.6: скилл `/kit:server`

**Files:**
- Move: `plugins/kit/skills/bitrix-console/` → `plugins/kit/skills/server/` (`git mv`, библиотека `scripts/*.php` едет вместе)
- Rewrite: `plugins/kit/skills/server/SKILL.md`
- Create: `plugins/kit/skills/project-init/reference/ssh.md`
- Modify: `plugins/kit/scripts/php-lint.js:14`, `plugins/kit/scripts/md5-check.js:5,11`
- Modify: `plugins/kit/skills/server/scripts/inventory.php:3`, `delete-list.php:4`, `check-files.php:3` (комментарий «Запуск: …»)
- Modify: `tests/content.test.js` (тест `bitrix-console` → `server`), `tests/console-scripts.test.js:8`, `tests/remote-php.test.js` (путь библиотеки), `tests/guard-bash.test.js` (CASES)

**Interfaces:**
- Consumes: `remote-php.js` — флаги и коды (8.4); `md5-check.js` — печатает код в stdout; `ssh-probe.js` не упоминается (он для project-init).
- Produces: скилл `server` (`/kit:server`), путь библиотеки `${CLAUDE_PLUGIN_ROOT}/skills/server/scripts/`, справка `skills/project-init/reference/ssh.md` (на неё ссылаются `server` и, в 8.7, `project-init`).

- [ ] **Шаг 1: перенос папки**

Run: `git -C C:/OSPanel/home/claude-kit/.claude/worktrees/ecstatic-mendeleev-03da1a mv plugins/kit/skills/bitrix-console plugins/kit/skills/server`
Expected: `git status` показывает переименования `R plugins/kit/skills/bitrix-console/… -> plugins/kit/skills/server/…`.

- [ ] **Шаг 2: тесты под новый путь и новый скилл (падают)**

`tests/console-scripts.test.js`, строка 8:
```js
const DIR = path.join(PLUGIN, 'skills', 'server', 'scripts');
```

`tests/remote-php.test.js`, в тесте «приставка bitrix и библиотечные скрипты проходят php -l»:
```js
    const dir = path.join(__dirname, '..', 'plugins', 'kit', 'skills', 'server', 'scripts');
```

`tests/content.test.js` — тест `bitrix-console: своя вкладка, …` заменить целиком:
```js
test('server: сначала SSH (BatchMode, remote-php, коды), иначе консоль; правила изменений', () => {
  const { fm, body } = skill('server');
  assert.equal(fm.name, 'server');
  assert.notEqual(fm['disable-model-invocation'], 'true');
  assert.ok(fm.description.length > 40);
  for (const s of [
    'SSH прод', 'SSH дев', 'PHP на сервере', '-o BatchMode=yes -o ConnectTimeout=15', '${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js',
    '--bitrix', '--plain', 'Host key verification failed', 'accept-new', 'Permission denied (publickey)',
    'This account is currently not available', 'результат неизвестен', 'kit-backup', '`rm` по списку не использовать',
    'reference/ssh.md', 'NOT_CHECK_PERMISSIONS', 'Одно согласие — одно действие',
    'php_command_line.php', 'tabs_create_mcp', 'tabs_close_mcp', 'BXCodeEditors', 'pTA.id', 'SetValue',
    '__FPHPSubmit', '<pre>', 'без `<?php`', 'без `use`', '$dryRun', 'AskUserQuestion', 'inventory.php', 'delete-list.php',
    'check-files.php', 'md5-check.js', '.claude/scripts/', 'не открывать, не править и не выполнять',
    'Новый `queryN` не появился', 'повторно не нажимай', 'закрывай в любом случае',
    'echo "<pre>"; … echo "</pre>";', "setAttribute('data-kit-old'", 'pre:not([data-kit-old])', 'не больше 10 чтений',
    '«Выполнить» повторно не нажимай ни в каком случае']) {
    assert.ok(body.includes(s), s);
  }
  assert.ok(!body.includes('__kitPreBefore'), 'сравнение текста до/после заменено пометкой');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'skills', 'bitrix-console')), 'старая папка скилла удалена');
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'ssh.md'), 'utf8');
  for (const s of ['ssh-keygen -t ed25519', 'authorized_keys', 'chmod 700', 'chmod 600', 'Доступ к shell', 'BatchMode=yes',
    'IdentityFile', '/opt/php74/bin/php', 'bitrix', 'Закрыть доступ']) {
    assert.ok(ref.includes(s), 'ssh.md: ' + s);
  }
});
```

`tests/guard-bash.test.js` — в массив `CASES` перед `];` добавить:
```js
  ['bash', "ssh -o BatchMode=yes alpha 'cd /var/www/site && ls -la'", null],
  ['bash', 'ssh alpha "cd ~/www && md5sum index.php"', null],
  ['powershell', "ssh -o BatchMode=yes alpha 'cd /var/www/site; ls'", null],
```

Run: `node --test tests/*.test.js`
Expected: FAIL — тест `server` (нет `skills/server/SKILL.md` с новым текстом и `reference/ssh.md`); остальные, в том числе новые случаи стража, — PASS (страж не учитывает содержимое кавычек). Если новые случаи стража падают — это находка: исправить `guard-bash.js` так, чтобы `cd` внутри кавычек аргумента не считался командой, и написать об этом в отчёте.

- [ ] **Шаг 3: пути в `php-lint.js` и `md5-check.js`, комментарии скриптов**

`plugins/kit/scripts/php-lint.js`, строка 14:
```js
const CONSOLE_DIRS = ['/.claude/scripts/', '/skills/server/scripts/'];
```

`plugins/kit/scripts/md5-check.js`, строки 3–5 и 11:
```js
// Печатает код сверки md5 файлов на сервере с локальными — для /kit:server (remote-php.js или Командная PHP-строка).
// Запуск в корне проекта: node md5-check.js <файлы…> (пути от корня проекта = от корня сайта).
// Шаблон — skills/server/scripts/check-files.php, список вставляется в строку «$files = []; // KIT:FILES».
```
```js
const TEMPLATE = path.join(__dirname, '..', 'skills', 'server', 'scripts', 'check-files.php');
```

В трёх PHP-скриптах `plugins/kit/skills/server/scripts/` в комментарии заменить `Запуск: /kit:bitrix-console (Командная PHP-строка).` на `Запуск: /kit:server (SSH — remote-php.js, иначе Командная PHP-строка).` — остальной текст строк не менять (правка через Edit, не `sed`).

- [ ] **Шаг 4: справка `plugins/kit/skills/project-init/reference/ssh.md`**

````markdown
# Вход на сервер по SSH-ключу

Нужен для `/kit:server` (канал SSH) и SSH-шага `/kit:project-init`. Claude подключается только по ключу и без вопросов (`ssh -o BatchMode=yes`): пароль он не вводит, отпечаток нового сервера не принимает. Всё ниже делает пользователь; Claude подсказывает и проверяет.

## 1. Ключ на своём компьютере (PowerShell)

```
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\<проект>_ed25519" -C "claude-code@<проект>"
```

Парольную фразу оставить пустой (Enter дважды): с фразой `BatchMode` не сможет её спросить и вход не состоится. `<проект>_ed25519` — приватный ключ, никому не передавать; `<проект>_ed25519.pub` — публичный, одна строка `ssh-ed25519 AAAA… claude-code@<проект>`.

## 2. Публичный ключ на сервер

Строка публичного ключа — отдельной строкой в `~/.ssh/authorized_keys` пользователя сайта; права: папка `~/.ssh` — 700, файл — 600, владелец — пользователь сайта.

- **ispmanager:** под root — «Учётные записи → Пользователи» → пользователь → раздел «Доступ» → флажок «Доступ к shell» → «Ok» (поле «Пароль» не трогать). Затем под пользователем — «Инструменты → Shell-клиент»:
  ```
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  echo '<строка публичного ключа>' >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  ls -la ~/.ssh
  ```
  Без консоли — «Менеджер файлов»: создать `.ssh/authorized_keys`, вставить строку, «Атрибуты» — 700 для папки, 600 для файла. Применение шаблона тарифа ко всем пользователям может снять флажок «Доступ к shell» — тогда включить снова.
- **BitrixVM:** ключ — пользователю `bitrix` (`/home/bitrix/.ssh/authorized_keys`), не `root`: файлы, созданные под `root`, веб-сервер потом не сможет менять.
- Shell нет совсем — ключ можно положить скриптом в Командной PHP-строке (`/kit:server`, канал «консоль», с согласия пользователя; права 700/600).

## 3. Короткое имя в `~/.ssh/config`

```
Host <псевдоним>
    HostName <домен или IP>
    User <пользователь сайта>
    IdentityFile ~/.ssh/<проект>_ed25519
```

Нестандартный порт — строкой `Port <порт>`. `ssh` из Git Bash и из Windows читают один и тот же `%USERPROFILE%\.ssh\config`.

## 4. Первый вход — руками

```
ssh <псевдоним>
```

На вопрос об отпечатке сервера ответить `yes` (Claude этого не делает). Спросило пароль — ключ не найден или не подошёл: пароль не вводить, Ctrl+C, проверить путь к ключу (`Identity file … not accessible`). Проверка без вопросов — код 0:

```
ssh -o BatchMode=yes <псевдоним> true
```

## 5. Что нужно знать о сервере

- Папка сайта — абсолютный путь: ispmanager — `~/www/<домен>` (например `/var/www/user100/data/www/alpha.example.com`), BitrixVM — `/home/bitrix/www` или `/home/bitrix/ext_www/<домен>`, многие хостинги — `~/<домен>/public_html`. Находит `ssh-probe.js`.
- PHP CLI: команда `php` бывает другой версии, чем у сайта (на ispmanager — часто 5.4); нужная — полным путём, например `/opt/php74/bin/php`. Это параметр «PHP на сервере».
- Параметры проекта: `SSH прод: <псевдоним>:<папка сайта>` (и `SSH дев`), `PHP на сервере: <путь>`.

## 6. Закрыть доступ

Сначала, пока shell ещё есть, удалить строку ключа из `~/.ssh/authorized_keys` (`sed -i '/claude-code@<проект>/d' ~/.ssh/authorized_keys` на сервере или в Shell-клиенте), потом снять флажок «Доступ к shell». Одного флажка мало: без shell пропадут консоль, команды и SFTP, но SSH-туннели по ключу останутся — через них видны службы сервера (например MySQL).
````

- [ ] **Шаг 5: `plugins/kit/skills/server/SKILL.md` — полный текст**

````markdown
---
name: server
description: Выполнить что-то на сервере сайта — по SSH (команды оболочки и PHP, в режиме 1С-Битрикс — с ядром Битрикса), а если SSH не задан или не пустил — PHP-код через Командную PHP-строку админки Битрикса в Chrome пользователя. Инвентаризация, проверки, сверка файлов по md5, логи, удаление файлов строгим списком. Чтение — сразу; любое изменение — только с отдельного согласия пользователя.
argument-hint: "[inventory | check-files <файлы> | delete-list | команда или код]"
---

# Работа на сервере: SSH, иначе Командная PHP-строка

## Правила

- **Только чтение** — можно сразу: `ls`, `find`, `md5sum`, `du`, `tail` и `grep` по логам, `inventory.php`, `check-files.php`, SELECT.
- **Любое изменение** — запись, удаление, перенос, `chmod`, правка файла, запросы, меняющие данные, `$dryRun = false` — только после AskUserQuestion с точной командой или кодом и явного «да». Одно согласие — одно действие. Порядок — раздел «Изменяющие скрипты».
- Код PHP — **без `<?php`** и **без `use`**: полные имена классов (`\Bitrix\Main\Loader::includeModule('iblock')`).
- Перед запуском проверь код `php -l` версией из параметра «PHP»: файл во временной папке сессии с приставкой `<?php` (для `.claude/scripts/*.php` это делает хук плагина при записи). php -l через stdin тоже работает: `"<PHP>" -l` с кодом на входе, приставка `<?php\n` обязательна.
- Пароли не вводить: SSH — только по ключу (`BatchMode=yes` пароль не спросит); если админка просит войти — входит пользователь.

## 1. Сервер и канал

Параметры — раздел «Параметры для агентов» в `.claude/CLAUDE.md`: `SSH прод` и `SSH дев` (`хост:папка сайта`), `PHP на сервере`, `Прод`, `Дев`, `Режим`.

1. Сервер — прод. Заданы оба (прод и дев), а пользователь не сказал, где выполнять, — спроси через AskUserQuestion.
2. Для сервера задан `SSH …` — **канал SSH** (раздел 2). Не задан — **канал «консоль»** (раздел 3).
3. SSH не пустил — код 3 у `remote-php.js` или прямой `ssh` вернул 255 без вывода команды. Скажи пользователю одной строкой почему (последняя строка stderr ssh) и переходи на консоль:
   - `Permission denied (publickey)` — ключ не подошёл;
   - `Host key verification failed` — новый или сменившийся отпечаток сервера: попроси пользователя один раз войти самому (`ssh <хост>`, ответить `yes`); `StrictHostKeyChecking=no` и `accept-new` не используй;
   - `Connection timed out`, `Could not resolve hostname` — сервер недоступен;
   - `This account is currently not available` — shell не выдан (ispmanager: снят флажок «Доступ к shell»).

   Как настроить вход — справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/ssh.md`.

   **Изменяющий код — исключение:** код 3 после начала выполнения значит «результат неизвестен». Не повторяй ни по SSH, ни в консоли: проверь состояние только чтением и спроси пользователя.
4. Канал «консоль» — только в режиме `bitrix` и если задан адрес сервера («Прод» / «Дев»). Иначе остановись: выполнить негде — предложи настроить вход по ключу (справка `reference/ssh.md`).

## 2. Канал SSH

Все вызовы `ssh` — с `-o BatchMode=yes -o ConnectTimeout=15`.

**Команды оболочки:**
```
ssh -o BatchMode=yes -o ConnectTimeout=15 <хост> '<команда>'
```
Команда целиком в одинарных кавычках, пути — абсолютные от папки сайта из параметра. `cd` внутри кавычек выполняется на сервере — страж kit его не блокирует. Долгой команде задай больший `timeout` Bash.

**PHP:** код — в файле: библиотечный скрипт, проектный `.claude/scripts/NN-имя.php` или временный файл в папке сессии.
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js" [--env дев] <файл>
```
Режим `bitrix` — перед кодом подключается ядро Битрикса: `DOCUMENT_ROOT` — папка сайта из параметра, домен — из «Прод»/«Дев», без агентов, статистики и почтовых событий. Общий режим — чистый PHP. `--bitrix` и `--plain` меняют это. `<pre>` из вывода убирается, номера строк в ошибках PHP — строки твоего файла.

| Код | Значение | Что делать |
|---|---|---|
| 0 | выполнено | вывод — результат |
| 1 | PHP завершился с ошибкой | показать ошибку пользователю |
| 2 | SSH для сервера не задан | канал «консоль» |
| 3 | нет подключения или оно оборвалось | раздел 1, п. 3 |
| 4 | аргументы или файл | исправить вызов |

Сверка md5 — код печатает `md5-check.js`, выполняет `remote-php.js`:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/md5-check.js" <файлы от корня проекта…> > "<временная папка сессии>/check-files.php"
node "${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js" "<временная папка сессии>/check-files.php"
```

Отличия от консоли: в CLI нет авторизованного `$USER` (консоль работает от администратора), проверки прав модулей снимает `NOT_CHECK_PERMISSIONS`; файлы, созданные через SSH, принадлежат пользователю SSH (BitrixVM — входить под `bitrix`, не `root`); на сайте в windows-1251 вывод перекодируется в UTF-8, а русские строки внутри кода — нет.

## 3. Канал «консоль» — Командная PHP-строка в Chrome пользователя

- Чужие вкладки консоли (например «PHP-строка (1)» с сохранённым кодом пользователя) не открывать, не править и не выполнять.
- Разметка админки отличается от описанной ниже (другая версия Битрикса) — остановись, опиши, что видишь, и спроси пользователя. Вслепую не выполнять.
- Свою вкладку браузера закрывай в любом случае — и когда остановился из-за ошибки, несовпадения разметки или отказа пользователя.

### 3.1 Браузер

Загрузи инструменты Chrome одним вызовом ToolSearch:
`select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__find,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__computer`

1. `tabs_context_mcp` — посмотри вкладки; создай свою `tabs_create_mcp`. Вкладки пользователя не трогай.
2. Адрес — «Прод» или «Дев» по серверу из раздела 1 + `/bitrix/admin/php_command_line.php`; `navigate` в своей вкладке.
3. Открылась форма входа — попроси пользователя войти в этой вкладке и дождись ответа.

### 3.2 Новая вкладка консоли

1. Посмотри, какие вкладки и редакторы уже есть (`javascript_tool`):
   ```js
   (() => ({
     textareas: [...document.querySelectorAll('textarea[id^="query"]')].map((t) => t.id),
     editors: Object.values(window.BXCodeEditors || {}).map((e) => e && e.pTA && e.pTA.id),
   }))()
   ```
2. Нажми «+» рядом с вкладками «PHP-строка (N)» (найди через `find` / `read_page`, нажми `computer` по ref).
3. Повтори п. 1: новая вкладка — тот `queryN`, которого раньше не было. Дальше работай только с ней. Новый `queryN` не появился — код не выполняй: посмотри страницу ещё раз (`read_page`) и сообщи пользователю; существующие `queryN` не трогай.

### 3.3 Вставить код и сверить

Подставь id новой вкладки и код JSON-строкой: вычисли `JSON.stringify(code)` и подставь результат вместо `"…код…"` — вручную кавычки и переводы строк не экранируй.
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

### 3.4 Выполнить и прочитать результат

Результат читается из последнего видимого `<pre>`, поэтому свой код оборачивай в `echo "<pre>"; … echo "</pre>";` (библиотечные скрипты уже так делают). На странице может остаться `<pre>` прошлого запуска — с тем же текстом, если скрипт тот же. Поэтому перед кликом все имеющиеся `<pre>` помечаются атрибутом `data-kit-old`, а результатом считается только `<pre>` без пометки.

1. Кнопка «Выполнить» — видимая кнопка, у которой `onclick` содержит `__FPHPSubmit`. Сниппет помечает все `<pre>` на странице и нажимает кнопку:
   ```js
   (() => {
     const b = [...document.querySelectorAll('input[type=button],input[type=submit],button')]
       .filter((x) => (x.getAttribute('onclick') || '').includes('__FPHPSubmit') && x.offsetParent !== null);
     if (b.length !== 1) return { ok: false, found: b.length };
     const old = document.querySelectorAll('pre');
     old.forEach((p) => p.setAttribute('data-kit-old', '1'));
     b[0].click();
     return { ok: true, marked: old.length };
   })()
   ```
   Найдено не ровно одна видимая кнопка — остановись и посмотри страницу (`read_page`).
2. Подожди 1–3 с (для тяжёлых скриптов дольше) и прочитай последний видимый `<pre>` **без** пометки:
   ```js
   (() => {
     const pres = [...document.querySelectorAll('pre:not([data-kit-old])')].filter((p) => p.offsetParent !== null);
     return pres.length ? { ready: true, text: pres[pres.length - 1].innerText } : { ready: false };
   })()
   ```
   `ready: true` — `text` и есть результат (пустой текст — скрипт ничего не вывел). `ready: false` — подожди 1–3 с и повтори именно чтение, всего **не больше 10 чтений**; не появился — стоп: `read_page` и сообщи пользователю, что видишь. «Выполнить» повторно не нажимай ни в каком случае (повторный клик запустит скрипт второй раз). Ошибка PHP — покажи пользователю.

### 3.5 Завершить

1. Закрой свою вкладку браузера (`tabs_close_mcp`).
2. Сообщи пользователю итог (длинный вывод — выжимкой, полный — во временную папку сессии).
3. Факты, которые стоит сохранить (ID, результаты проверок, что удалено), — в NOTES / DEPLOY следующего `/kit:step-done`.

## Библиотека скриптов

`${CLAUDE_PLUGIN_ROOT}/skills/server/scripts/` — работают в обоих каналах:
- `inventory.php` — окружение, сайты и шаблоны, сторонние модули, инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы `b_file` по модулям и типам. Только чтение.
- `delete-list.php` — шаблон удаления строгим списком: `$dryRun`, `$base` (папка от корня сайта), `$allowedExt`, `$files`, `$removeEmptyDirs`. Каждый путь через `realpath` должен лежать внутри `$base`, быть файлом и иметь расширение из списка; база не может быть корнем сайта. **Изменяет сервер.**
- `check-files.php` — сверка файлов с локальными по md5. Готовый код печатает
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/md5-check.js" <файлы от корня проекта…>
  ```
  Только чтение.

Проектная копия скрипта (с конкретными путями, ID и т. п.) — в `.claude/scripts/NN-имя.php` проекта: в git есть, на сервер не уезжает (исключение деплоя). NN — следующий номер по порядку.

## Изменяющие скрипты

1. Удаление файлов — шаблоном `delete-list.php`; `rm` по списку не использовать. Скрипт с `$dryRun = true` → выполнить → показать пользователю, что будет удалено.
2. AskUserQuestion: «Выполнить по-настоящему?» — только явное «да».
3. Тот же код с `$dryRun = false` → выполнить → показать результат.
4. Проверить снаружи (например, удалённые пути отдают 404) и записать в план выкладки: «Удалить с сервера» → `✅ ДАТА, скрипт`.
5. Правка файла на сервере (канал SSH) — сначала копия в `~/kit-backup/<ГГГГММДД-ЧЧММСС>/<путь от корня сайта>`: `mkdir -p` папки копии, затем `cp -p`. Копия — вне папки сайта: `.php.back` рядом с оригиналом веб-сервер отдал бы как текст. Путь копии — в отчёт.
6. Любое другое изменение — та же схема: точная команда или код → AskUserQuestion → выполнить → проверить (md5, ответ сайта) → записать в NOTES следующего `/kit:step-done`.
````

- [ ] **Шаг 6: тесты проходят**

Run: `node --test tests/*.test.js`
Expected: PASS (тест «все `${CLAUDE_PLUGIN_ROOT}/…` существуют» тоже — `scripts/remote-php.js`, `skills/server/scripts/`, `skills/project-init/reference/ssh.md` есть).

- [ ] **Шаг 7: остатки старого имени**

Run: Grep по `bitrix-console` в `plugins/` и `tests/`.
Expected: только `tests/content.test.js` (проверка, что старой папки нет) и упоминания в `project-init/SKILL.md`, `deploy-list/SKILL.md`, `project-init/reference/bitrix.md`, `project-init/templates/deploy-prod.md`, `scripts/site-probe.js` — их правит задача 8.7. Шаг закрывает контроллер: `/kit:step-done 8.6`.

---

### Задача 8.7: `/kit:project-init` — SSH-шаг; упоминания `/kit:server`

**Files:**
- Modify: `plugins/kit/skills/project-init/SKILL.md`
- Modify: `plugins/kit/skills/project-init/templates/CLAUDE.md`
- Modify: `plugins/kit/skills/project-init/templates/deploy-prod.md:18`
- Modify: `plugins/kit/skills/project-init/reference/bitrix.md:6,24-26`
- Modify: `plugins/kit/skills/deploy-list/SKILL.md:15`
- Modify: `plugins/kit/scripts/site-probe.js:56`
- Test: `tests/templates.test.js`, `tests/net.test.js`, `tests/content.test.js`

**Interfaces:**
- Consumes: `ssh-probe.js` (8.5) — вызов и формат вывода; справка `reference/ssh.md` (8.6); параметры `SSH прод`, `SSH дев`, `PHP на сервере` (спек §5).
- Produces: `project-init` пишет эти параметры в раздел «Параметры для агентов»; в плагине больше нет `bitrix-console`.

- [ ] **Шаг 1: падающие тесты**

`tests/templates.test.js`, тест «CLAUDE.md: раздел параметров со всеми ключами» — список ключей:
```js
  for (const k of ['режим', 'код пишет', 'окружение', 'выкладка', 'прод', 'дев', 'ssh прод', 'ssh дев', 'php на сервере', 'php', 'журнал', 'план выкладки', 'id шага', 'не выкладывать', 'не коммитить', 'секреты']) {
```

`tests/net.test.js`, тест «site-probe: версия скрыта — подсказка про консоль…», после `assert.match(r.stdout, /echo PHP_VERSION/);`:
```js
    assert.match(r.stdout, /\/kit:server/);
    assert.match(r.stdout, /ssh-probe\.js/);
```

`tests/content.test.js`, тест `project-init: только командой, …` — в первый массив строк добавить:
```js
    'ssh-probe.js', 'reference/ssh.md', 'SSH прод', 'SSH дев', 'PHP на сервере', 'Host key verification failed', '«SSH нет»',
    'только строки `Host`, `HostName`, `User`', '[совпадает]', '/kit:server',
```
и в конец файла (перед `module.exports`) — новый тест:
```js
test('в плагине и шаблонах нет старого имени bitrix-console', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (fs.readFileSync(p, 'utf8').includes('bitrix-console')) hits.push(path.relative(PLUGIN, p));
    }
  };
  walk(PLUGIN);
  assert.deepEqual(hits, []);
});
```

Run: `node --test tests/*.test.js`
Expected: FAIL — ключи шаблона, подсказка site-probe, строки project-init, старое имя в 5 файлах.

- [ ] **Шаг 2: шаблон `templates/CLAUDE.md`**

В разделе «## Окружение» после строки `- {{**Дев:** АДРЕС, PHP ВЕРСИЯ. | Дева нет — проверяем на проде.}}` добавить:
```
- **Работа на сервере:** {{SSH — `ssh ХОСТ`, папка сайта `ПАПКА`, PHP CLI `PHP_НА_СЕРВЕРЕ`; `/kit:server` работает по SSH, консоль — запасной путь. | SSH нет — `/kit:server` работает через Командную PHP-строку в Chrome.}}
```

В разделе «## Параметры для агентов» после строки `- Дев: {{ДЕВ | —}}` добавить:
```
- SSH прод: {{ХОСТ:ПАПКА_САЙТА | —}}
- SSH дев: {{ХОСТ:ПАПКА_САЙТА_ДЕВА | —}}
- PHP на сервере: {{ПУТЬ_К_PHP_CLI | —}}
```

- [ ] **Шаг 3: `project-init/SKILL.md`**

3.1. Строку
```
Шаблоны — в `${CLAUDE_PLUGIN_ROOT}/skills/project-init/templates/`. Перед шагами про PhpStorm и Битрикс прочитай справки `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md` и `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/bitrix.md`.
```
заменить на
```
Шаблоны — в `${CLAUDE_PLUGIN_ROOT}/skills/project-init/templates/`. Перед шагами про PhpStorm, Битрикс и SSH прочитай справки `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md`, `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/bitrix.md` и `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/ssh.md`.
```

3.2. В абзаце после вызова `site-probe.js` фрагмент
```
Модуля нет в OSPanel или версия скрыта — спроси пользователя (или узнай через `/kit:bitrix-console`, `echo PHP_VERSION;`); параметр «PHP» — путь к `php.exe` или `—`.
```
заменить на
```
Модуля нет в OSPanel или версия скрыта — спроси пользователя (или узнай после SSH-разведки ниже: `ssh-probe.js` печатает версии PHP на сервере; либо через `/kit:server`, `echo PHP_VERSION;`); параметр «PHP» — путь к `php.exe` или `—`.
```

3.3. Сразу после этого абзаца (перед `## 3. План на согласие`) вставить:
````markdown
### SSH — после site-probe, до плана на согласие

Для каждого сервера с адресом: прод; дев — при «дев + прод». Справка — `reference/ssh.md`.

1. Псевдонимы из `~/.ssh/config` — только строки `Host`, `HostName`, `User` (Grep по `^\s*(Host|HostName|User)\s` с `-o`); ключи и другие файлы `~/.ssh` не открывай. Вопрос через AskUserQuestion, по вопросу на сервер: до 3 псевдонимов — псевдоним, у которого `HostName` совпал с доменом сервера, первым с «(Рекомендую)»; в существующем разделе параметров `SSH …` уже задан — первым он; последний вариант — «SSH нет»; `user@host` — через «Другое».
2. Разведка (только чтение, одно подключение):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-probe.js" <хост> --url <адрес сервера> [--php X.Y]
   ```
   X.Y — версия PHP из site-probe. Код 3 — не пустил, причина — в выводе: `Host key verification failed` (новый сервер) — попроси пользователя один раз войти самому (`ssh <хост>`, ответить `yes`) и повтори; иначе параметр `—`, а шаги из справки `reference/ssh.md` — в итог пользователю.
3. Код 0: папка сайта — единственная строка `Папка: … [bitrix]` (режим bitrix; в общем режиме — единственная найденная). Несколько или ни одной — вопрос: найденные — вариантами, свой путь — через «Другое». PHP — строка с `[совпадает]` → «PHP на сервере»; такой нет или версия сайта неизвестна — вопрос со списком найденных версий (выбранная версия идёт и в параметр «PHP», если site-probe версию не нашёл).
4. Параметры: `SSH прод: <хост>:<папка>` (и `SSH дев`), `PHP на сервере: <путь>`; SSH нет — `—`. Уже заданные значения меняй только с согласия.
````

3.4. В разделе «### 4.3 Правила проекта `.claude/CLAUDE.md`» после абзаца про параметр «PHP» (`Параметр «PHP» — путь … PHP на сервере нет — `—`.`) добавить:
```
Параметры «SSH прод», «SSH дев», «PHP на сервере» — по разделу «SSH» (после site-probe); SSH нет — `—`, и `/kit:server` будет работать через Командную PHP-строку.
```

3.5. В разделе «## 5. Итог пользователю» в конец перечня действий, оставшихся за пользователем (внутри скобок после «удаление старых агентов с сервера»), добавить `, вход по SSH-ключу, если его нет (справка reference/ssh.md)`.

- [ ] **Шаг 4: остальные упоминания**

`templates/deploy-prod.md`, строка 18:
```
Удалять через Remote Host в PhpStorm или через `/kit:server` (SSH, иначе Командная PHP-строка; шаблон `delete-list.php`: с согласия пользователя, строгий список, сначала сухой прогон).
```

`reference/bitrix.md`, строка 6:
```
- Заголовок скрыт — `ssh-probe.js` (версии PHP на сервере) или `/kit:server`, код `echo PHP_VERSION;`.
```
и последний раздел целиком:
```
## Работа на сервере

Проверки и разовые скрипты на сервере — `/kit:server`: сначала SSH, если не задан или не пустил — Командная PHP-строка; только чтение — сразу, изменения — с согласия пользователя (удаление — после сухого прогона).
```

`deploy-list/SKILL.md`, п. 4:
```
4. Удаления на сервере делает пользователь (PhpStorm → Remote Host) или Claude через `/kit:server` (SSH, иначе Командная PHP-строка; шаблон `delete-list.php` — только с согласия пользователя и после сухого прогона).
```

`scripts/site-probe.js`, строка 56:
```js
    lines.push('PHP: сервер версию не сообщает — узнать по SSH (ssh-probe.js), через /kit:server (echo PHP_VERSION;) или спросить пользователя');
```

- [ ] **Шаг 5: тесты проходят**

Run: `node --test tests/*.test.js`
Expected: PASS. Шаг закрывает контроллер: `/kit:step-done 8.7`. **Остановка B:** отчёт пользователю и вопрос «дальше?».

---

## Часть C — выпуск и живая проверка

### Задача 8.8: README, версия 2.0.0, проверка плагина

**Files:**
- Modify: `README.md`
- Modify: `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: всё из 8.3–8.7.
- Produces: плагин 2.0.0, готовый к слиянию; вывод `claude plugin details` для отчёта.

- [ ] **Шаг 1: README**

1. Первый абзац: `(инициализация проекта, Командная PHP-строка, проверки выкладки)` → `(инициализация проекта, работа на сервере по SSH или через Командную PHP-строку, проверки выкладки)`.
2. Строку таблицы `| /kit:bitrix-console | … |` заменить на:
```
| `/kit:server` | Claude при необходимости | работа на сервере: сначала SSH (команды оболочки, PHP через `remote-php.js`), иначе Командная PHP-строка в Chrome; чтение — сразу, изменения — с согласия |
```
3. В пример раздела параметров после `- Дев: —` добавить:
```
- SSH прод: alpha:/var/www/user100/data/www/alpha.example.com
- SSH дев: —
- PHP на сервере: /opt/php74/bin/php
```
и после пункта **PHP** в списке под примером:
```
- **SSH прод / SSH дев** — `хост:папка сайта`: псевдоним из `~/.ssh/config` (или `user@host`) и абсолютный путь к корню сайта на сервере; `—` — SSH нет, `/kit:server` работает через Командную PHP-строку. Вход — только по ключу без пароля; настройка — `plugins/kit/skills/project-init/reference/ssh.md`.
- **PHP на сервере** — полный путь к PHP CLI нужной версии: команда `php` на хостинге бывает старой (на ispmanager — 5.4).
```
4. Перед разделом «## Перевод проекта со своими агентами на kit» вставить:
```
## Переход с 1.x на 2.0

- Команда `/kit:bitrix-console` переименована в `/kit:server`: сначала SSH, иначе прежняя Командная PHP-строка.
- В проектах добавить параметры `SSH прод`, `SSH дев`, `PHP на сервере` — `/kit:project-init` допишет их с согласия (раздел «SSH»); без них `/kit:server` работает через консоль, как раньше.
```
5. Раздел «Разработка», последняя строка: `план — `docs/plan-claude-kit.md`` → `планы — `docs/plan-claude-kit.md` (этапы 0–6) и `docs/plan-ssh.md` (этап 8)`.

- [ ] **Шаг 2: версия 2.0.0**

`plugins/kit/.claude-plugin/plugin.json`:
```json
{
  "name": "kit",
  "version": "2.0.0",
  "description": "Каркас работы над проектами: журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку.",
  "author": { "name": "Mikle Seregin" },
  "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh"]
}
```

`.claude-plugin/marketplace.json` — в записи плагина:
```json
      "description": "Журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, хуки правил и php -l.",
      "version": "2.0.0",
```

- [ ] **Шаг 3: тесты и проверка манифестов**

Run: `node --test tests/*.test.js`
Expected: PASS (в том числе `manifest.test.js` — версии совпадают).

Run: `claude plugin validate C:/OSPanel/home/claude-kit/.claude/worktrees/ecstatic-mendeleev-03da1a/plugins/kit --strict`
Run: `claude plugin validate C:/OSPanel/home/claude-kit/.claude/worktrees/ecstatic-mendeleev-03da1a --strict`
Expected: обе проверки без ошибок и предупреждений.

- [ ] **Шаг 4: состав плагина без установки**

Run: `claude --plugin-dir C:/OSPanel/home/claude-kit/.claude/worktrees/ecstatic-mendeleev-03da1a/plugins/kit plugin details kit`
Expected: версия 2.0.0; 4 скилла — `deploy-list`, `project-init`, `server`, `step-done` (без `bitrix-console`); 2 агента; 3 хука. Вывод целиком — в отчёт. Шаг закрывает контроллер: `/kit:step-done 8.8`.

---

### Задача 8.9: живая проверка на alpha (контроллер, только чтение)

Выполняет контроллер сам (нужны настоящий сервер, Chrome и вход пользователя в админку). **Перед первым подключением — согласие пользователя через AskUserQuestion** с перечнем команд ниже; всё — только чтение. alpha — не kit-проект, поэтому параметры передаются флагами. Корень worktree — `W=C:/OSPanel/home/claude-kit/.claude/worktrees/ecstatic-mendeleev-03da1a`, временная папка сессии — `<scratch>`.

- [ ] **Шаг 1: разведка**

Run: `node $W/plugins/kit/scripts/ssh-probe.js alpha --url https://alpha.example.com --php 7.4`
Expected: код 0; `Папка: /var/www/user100/data/www/alpha.example.com [bitrix]`; `PHP: /opt/php74/bin/php 7.4.33 [совпадает]`.

- [ ] **Шаг 2: `inventory.php` через SSH (баг К5)**

Run: `node $W/plugins/kit/scripts/remote-php.js --bitrix --host alpha --root /var/www/user100/data/www/alpha.example.com --php /opt/php74/bin/php --url https://alpha.example.com $W/plugins/kit/skills/server/scripts/inventory.php > <scratch>/inventory.txt`
Expected: код 0; в выводе версия PHP 7.4.33, `DOCUMENT_ROOT /var/www/user100/data/www/alpha.example.com`, сайты и шаблоны, инфоблоки. Ошибка PHP — разобрать (К5: `CIBlockSection::GetCount`, `CIBlockElement::GetList`, `SUBSTRING_INDEX`), исправление — отдельной задачей с согласия пользователя.

- [ ] **Шаг 3: `check-files.php` по двум файлам**

Два файла alpha, которые точно выложены (выбрать из `git -C C:/OSPanel/home/alpha.server ls-files local/templates` — например `header.php` и `footer.php` шаблона):
Run: `( cd C:/OSPanel/home/alpha.server && node $W/plugins/kit/scripts/md5-check.js <файл1> <файл2> ) > <scratch>/check-files.php`
Run: `node $W/plugins/kit/scripts/remote-php.js --bitrix --host alpha --root /var/www/user100/data/www/alpha.example.com --php /opt/php74/bin/php --url https://alpha.example.com <scratch>/check-files.php`
Expected: код 0; по каждому файлу `ок` / `ОТЛИЧАЕТСЯ` / `нет` и строка «Итого».

- [ ] **Шаг 4: запасной путь**

Run: `node $W/plugins/kit/scripts/remote-php.js --bitrix --host nosuchhost.invalid --root /var/www/x --php php <scratch>/check-files.php`
Expected: код 3, причина `Could not resolve hostname`.
Затем — канал «консоль» по разделу 3 скилла `server` (`plugins/kit/skills/server/SKILL.md` из worktree): своя вкладка Chrome, `https://alpha.example.com/bitrix/admin/php_command_line.php`, код `echo "<pre>"; echo PHP_VERSION; echo "</pre>";`; вход в админку — пользователь. Expected: `7.4.33`, вкладка закрыта.

- [ ] **Шаг 5: итог**

Закрыть шаг `/kit:step-done 8.9`: SUMMARY — что проверено и с каким результатом; BUGS — К5 обновить (прошёл ли `inventory.php` на живом Битриксе); найденные расхождения — строками «Баги на потом». **Остановка C:** отчёт пользователю и вопрос «дальше?».

---

## Часть D — слияние

### Задача 8.10: финальное ревью, слияние, обновление плагина

- [ ] **Шаг 1: финальное ревью ветки** — агент-ревьюер (opus) по диапазону `3aff061..HEAD` ветки `ssh-server` со спеком и этим планом. Находки — исправления отдельными коммитами `8.10а`, `8.10б` (исполнитель opus), каждый через `/kit:step-done`.
- [ ] **Шаг 2: слияние** — основной checkout `C:/OSPanel/home/claude-kit` на `master`, чистый: `git -C C:/OSPanel/home/claude-kit merge --ff-only ssh-server`. Не fast-forward — стоп и вопрос пользователю.
- [ ] **Шаг 3: обновление установленного плагина** — `claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit`; проверить, что в `~/.claude/plugins/cache/claude-kit/kit/2.0.0/skills/` есть `server` и нет `bitrix-console`; сказать пользователю перезапустить сессии.
- [ ] **Шаг 4: GitHub** — `git -C C:/OSPanel/home/claude-kit push origin master` — **только с согласия пользователя** (AskUserQuestion).
- [ ] **Шаг 5: уборка** — по заметке памяти `worktree-leftover-dir`: worktree `ecstatic-mendeleev-03da1a` и ветку `ssh-server` удалить после слияния (папку — из следующей сессии, эта в ней работает); закрыть шаг `/kit:step-done 8.10`, «Сейчас» — этап 8 завершён.
