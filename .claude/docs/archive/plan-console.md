# Файл-канал `kit-exec.php` и баги канала `/kit:server` — план реализации

> **Для исполнителя:** идти по задачам по порядку, шаги — с чекбоксами. Каждый проверенный шаг закрывается через `/kit:step-done` (docs-keeper → git-keeper, один коммит `ID: …`). Код, тесты и диффы ниже собраны и прогнаны в копии репозитория (база `7047cf0`); состояние после каждой задачи проверено отдельно (таблица «Проверка» в конце).

**Цель:** работа на сервере без SSH для сайтов на 1С-Битрикс — файл `kit-exec.php` (диагностический скрипт с проверкой администратора), который Claude открывает во встроенном браузере; плюс исправления багов К13, К14, К16, К20; версия 2.4.0.

**Архитектура:** `remote-php.js` (SSH-канал) остаётся, получает общий таймаут, MSYS2 и `DOCUMENT_ROOT` в общем режиме. Новый канал — `scripts/kit-exec.js` + `scripts/lib/kitexec.js`: из кода задачи собирают `kit-exec.php` (ядро Битрикса → проверка `$USER->IsAdmin()` → сверка `?run=` → код задачи), скилл `/kit:server` кладёт файл в корень сайта, открывает его во встроенном браузере и читает вывод. Канал через Claude in Chrome и Командную PHP-строку удаляется целиком (К15, К17 — неактуальны).

**Стек:** node ≥ 18 без npm-зависимостей у скриптов плагина; тесты — `node --test`; PHP 7.2/7.4/8.3 в `C:\OSPanel\modules`.

**Спек:** `.claude/docs/work/spec-claude-kit.md` — §2 (решения 2026-09-30), §4, §5, §7.3, §7.4, §9, §11, §13.

## Общие ограничения

- Файлы — UTF-8 без BOM, LF. Скрипты плагина — без npm-зависимостей.
- Вне kit-проекта хуки и инструменты молчат; `kit-exec.js` и `remote-php.js` вне проекта работают по флагам.
- `kit-exec.php` — только для Битрикса; для остального без SSH — «выполнить негде, включить SSH».
- Согласие пользователя: чтение — сразу; любое изменение — AskUserQuestion с точным кодом. Запись `kit-exec.php` в проект пользователя с автозаливкой PhpStorm — это заливка на сервер: **только с согласия в момент запуска** (задачи 12.9, 12.10). Пароли не вводить.
- Версия 2.4.0 — в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json` одинаково (задача 12.8).
- Git — только через `/kit:step-done`; push `master` — только с согласия пользователя.
- Исправления после ревью — отдельными коммитами с тем же ID и буквой (`12.4а`), без amend.
- Ветка и worktree — новые (см. «Подготовка»); `.superpowers/` в git не кладём.
- Известная особенность среды: PHP 7.2 из OSPanel сам, без кода плагина, иногда падает (код `3221225477`, access violation) или зависает, когда PHP запускают параллельно (проверено 2026-09-30: 9 сбоев из 300 запусков при 16 параллельных; 7.4 и 8.3 — 0 из 300). Поэтому `tests/helpers.js` (задача 12.3) повторяет такой запуск (до 4 попыток, только при коде `3221225477` или зависании); любой другой результат — как есть. Тест, упавший с этим кодом мимо `helpers.js`, — прогнать файл отдельно; повторное падение — настоящая ошибка.

## Отклонения от спека (найдены при проверке кода)

- `kit-exec.php` выполняет код только при `?run=<номер своей сборки>` (спек §2, §7.4, §9, §11 уже синхронизированы): иначе проверка «уехал ли новый файл» повторила бы запуск старого изменяющего файла.
- `KIT_SSH_GRACE` — переменная окружения только для тестов (запас в секундах до остановки ssh после серверного `timeout`, по умолчанию 10).
- Код 2 у `remote-php.js` при отсутствии SSH говорит про файл `kit-exec.php` (было — про консоль).

## Подготовка (до задачи 12.3)

- [ ] Worktree от локального `master` (EnterWorktree по умолчанию ответвляется от `origin/master`, где нет неотправленных коммитов): из основной папки — `git -C C:/OSPanel/home/claude-kit worktree add .claude/worktrees/stage12-console -b claude/stage12-console master`, затем `EnterWorktree` на этот путь. Защита worktree отклоняет Bash-команды со словом «git» в путях и `node` со скриптом из переменной — правки через Edit/Write, команды с буквальными путями.
- [ ] В worktree `node_modules` (нужны только `pixelmatch` и `pngjs` — как в `%LOCALAPPDATA%\kit\visual\deps\node_modules`; `playwright-core` **не копировать** — тест `visual-cli` ждёт его отсутствия): `Copy-Item -Recurse "$env:LOCALAPPDATA\kit\visual\deps\node_modules\pixelmatch","$env:LOCALAPPDATA\kit\visual\deps\node_modules\pngjs" -Destination "<worktree>\node_modules\"` (папку `node_modules` создать).
- [ ] Базовый прогон: `node --test tests/*.test.js` в worktree — `ℹ tests 285`, `ℹ pass 282`, `ℹ fail 0`, `ℹ skipped 3`.

## Карта файлов

| Файл | Что | Задача |
|---|---|---|
| `plugins/kit/scripts/lib/msys.js` (новый) | пути, переписанные Git Bash и MSYS2 | 12.3 |
| `plugins/kit/scripts/lib/ssh.js` | общий таймаут `runSsh` (К13) | 12.3 |
| `plugins/kit/scripts/remote-php.js` | `--timeout`, серверный `timeout`, MSYS2, `DOCUMENT_ROOT` в общем режиме (К13, К16, К20), новая подсказка при коде 2 | 12.3 |
| `plugins/kit/scripts/lib/visual/args.js` | `fixMsysPath` через `lib/msys.js` (К16) | 12.3 |
| `plugins/kit/skills/server/scripts/check-files.php` | «DOCUMENT_ROOT не задан — стоп» (К20) | 12.3 |
| `plugins/kit/scripts/lib/kitexec.js` (новый) | тело `kit-exec.php` | 12.4 |
| `plugins/kit/scripts/kit-exec.js` (новый) | CLI: сборка, `php -l` | 12.4 |
| `plugins/kit/scripts/secret-scan.js`, `agents/git-keeper.md`, `templates/gitignore-bitrix` | `/kit-exec.php` — не коммитить | 12.5 |
| `plugins/kit/skills/server/SKILL.md`, `reference/ssh.md` | скилл без Chrome-консоли, «Как включить SSH у хостинга» | 12.6 |
| `project-init/SKILL.md`, шаблоны, справки, `plugin.json` (описание), комментарии PHP | `Include` (К14), «SSH нет», тексты | 12.7 |
| `README.md`, `plugin.json`/`marketplace.json` (версия) | 2.4.0 | 12.8 |
| `tests/…` | по задачам | 12.3–12.7 |

---

### Задача 12.3: SSH-канал — общий таймаут, MSYS2, `DOCUMENT_ROOT` в общем режиме (К13, К16, К20)

**Файлы:**
- Создать: `plugins/kit/scripts/lib/msys.js`, `tests/msys.test.js`
- Изменить: `plugins/kit/scripts/lib/ssh.js`, `plugins/kit/scripts/lib/visual/args.js`, `plugins/kit/scripts/remote-php.js`, `plugins/kit/skills/server/scripts/check-files.php`
- Тесты: `tests/helpers.js` (повтор запуска PHP при сбоях PHP 7.2), `tests/fake-ssh.js` (сценарий `hang`), `tests/remote-php.test.js`, `tests/ssh.test.js`, `tests/console-scripts.test.js`, `tests/visual-args-links.test.js`

**Интерфейсы:**
- Производит: `spawnPhp(version, args, opts)` (`tests/helpers.js`, повторяет запуск PHP при коде `3221225477` или зависании; им пользуются `runPhp`, `phpLint` и тесты файла-канала); `isMsysRewritten(p) → boolean`, `undoMsys(p) → string` (`lib/msys.js`); `runSsh(host, remoteCmd, stdin, { timeoutMs }) → { connected, exitCode, stdout, stderr, timedOut? }`; у `remote-php.js` — флаг `--timeout сек` (1–3600, по умолчанию 110), экспорты `remoteCommand(phpBin, seconds)`, `plainPrefix(root)`, `fixLines(text, file, prefixLines, shift, label?)` (пятый аргумент нужен `kit-exec.js` в задаче 12.4).

- [ ] **Шаг 1: тесты.**

Создать `tests/msys.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMsysRewritten, undoMsys } = require('../plugins/kit/scripts/lib/msys');

test('isMsysRewritten: Git Bash и MSYS2 переписали путь сервера — да; обычные пути — нет', () => {
  for (const p of ['C:/Program Files/Git/opt/php74/bin/php', 'C:\\Program Files\\Git\\var\\www\\x', 'D:/Tools/PortableGit/catalog/',
    'C:/msys64/opt/php74/bin/php', 'C:/msys32/var/www/x', 'c:/MSYS64/usr/bin']) {
    assert.equal(isMsysRewritten(p), true, p);
  }
  for (const p of ['/opt/php74/bin/php', '/var/www/x', 'C:/Users/user/site/a.php', 'C:/gitea/x', 'C:/msys6/x', 'php', '']) {
    assert.equal(isMsysRewritten(p), false, p);
  }
});

test('undoMsys: возвращает путь как был, прочее не трогает', () => {
  assert.equal(undoMsys('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(undoMsys('C:/msys64/opt/php74/bin/php'), '/opt/php74/bin/php');
  assert.equal(undoMsys('C:\\Program Files\\Git\\personal\\'), '/personal\\');
  assert.equal(undoMsys('/catalog/'), '/catalog/');
  assert.equal(undoMsys('C:/Users/user/site/a.php'), 'C:/Users/user/site/a.php');
});
```

Изменить существующие тесты (дифф от `7047cf0`):

```diff
--- a/tests/helpers.js
+++ b/tests/helpers.js
@@ -74,19 +74,31 @@
   return dir;
 }
 
+// PHP 7.2 из OSPanel сам, без кода плагина, иногда падает (код 0xC0000005) или зависает, когда тесты идут параллельно
+// (проверено: ~3 % запусков при 16 параллельных; 7.4 и 8.3 — стабильны). Такой запуск повторяем, любой другой результат — как есть.
+const PHP_CRASH = 3221225477;
+function spawnPhp(version, args, opts = {}) {
+  let r;
+  for (let attempt = 0; attempt < 4; attempt++) {
+    r = spawnSync(php(version), args, { encoding: 'utf8', ...opts, timeout: 20000 });
+    if (r.status !== null && r.status !== PHP_CRASH) break;
+  }
+  return r;
+}
+
 function runPhp(version, code) {
   const file = path.join(tmpDir('kit-php-'), 'run.php');
   fs.writeFileSync(file, code);
-  const r = spawnSync(php(version), ['-d', 'display_errors=stderr', file], { encoding: 'utf8', timeout: 60000 });
+  const r = spawnPhp(version, ['-d', 'display_errors=stderr', file]);
   return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
 }
 
 function phpLint(version, code) {
-  const r = spawnSync(php(version), ['-l'], { input: code, encoding: 'utf8', timeout: 60000 });
+  const r = spawnPhp(version, ['-l'], { input: code });
   return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
 }
 
 module.exports = {
   ROOT, PLUGIN, SCRIPTS, php, hasPhp, tmpDir, writeFiles, makeProject,
-  runScript, runScriptAsync, git, gitRepo, runPhp, phpLint,
+  runScript, runScriptAsync, git, gitRepo, spawnPhp, runPhp, phpLint,
 };
```

```diff
--- a/tests/fake-ssh.js
+++ b/tests/fake-ssh.js
@@ -4,8 +4,10 @@
 // Хост выбирает сценарий: down, denied — не пустил (255, без метки); drop — начал выводить и оборвался (255, без метки);
 // empty — команда ничего не вывела (только метка с кодом 0); closed — закрылся, не прочитав stdin (255, без метки,
 // лог не пишется).
-// Иначе: FAKE_SSH_OUT задан — печатает его и метку с кодом FAKE_SSH_EXIT (по умолчанию 0); не задан — команда вида
-// '<php>'; printf … выполняется локальным PHP: stdin → php, затем метка с кодом php (как настоящий сервер).
+// hang — прочитал stdin и завис (для проверки таймаута: runSsh убивает процесс).
+// Иначе: FAKE_SSH_OUT задан — печатает его и метку с кодом FAKE_SSH_EXIT (по умолчанию 0); не задан — в команде
+// первый путь в одинарных кавычках ('<php>', в том числе внутри «timeout -k 5 N '<php>'») выполняется локальным PHP:
+// stdin → php, затем метка с кодом php (как настоящий сервер).
 // FAKE_SSH_LOG — файл для проверок: { opts, host, command, stdin }.
 // Выход — через process.exitCode, а не process.exit(): на Windows запись в канал асинхронная и обрезалась бы.
 const fs = require('fs');
@@ -38,6 +40,10 @@
   if (host === 'down') return fail('', 'ssh: connect to host down port 22: Connection timed out\n');
   if (host === 'denied') return fail('', 'user100@denied: Permission denied (publickey).\n');
   if (host === 'drop') return fail('начало\n', 'Connection to drop closed by remote host.\n');
+  if (host === 'hang') {
+    setInterval(() => {}, 1000);
+    return 0;
+  }
   if (host === 'empty') {
     process.stdout.write(mark(0));
     return 0;
@@ -46,7 +52,7 @@
     process.stdout.write(process.env.FAKE_SSH_OUT + mark(process.env.FAKE_SSH_EXIT || 0));
     return 0;
   }
-  const m = /^'((?:[^']|'\\'')*)'/.exec(command);
+  const m = /'((?:[^']|'\\'')*)'/.exec(command);
   const bin = m ? m[1].replace(/'\\''/g, "'") : command.split(/\s+/)[0];
   const r = spawnSync(bin, ['-d', 'display_errors=stderr'], { input: stdin });
   process.stdout.write(Buffer.concat([r.stdout || Buffer.alloc(0), Buffer.from(mark(r.status === null ? 255 : r.status))]));
```

```diff
--- a/tests/remote-php.test.js
+++ b/tests/remote-php.test.js
@@ -29,13 +29,16 @@
   }
 });
 
-test('remote-php: путь сервера, переписанный Git Bash (MSYS), — код 4 с подсказкой MSYS_NO_PATHCONV=1', () => {
+test('remote-php: путь сервера, переписанный Git Bash или MSYS2, — код 4 с подсказкой MSYS_NO_PATHCONV=1 / MSYS2_ARG_CONV_EXCL', () => {
   const p = makeProject({ 'a.php': 'echo 1;\n' });
   for (const args of [['--host', 'ok', '--php', 'C:/Program Files/Git/opt/php74/bin/php', 'a.php'],
-    ['--bitrix', '--host', 'ok', '--root', 'C:/Program Files/Git/var/www/x', 'a.php']]) {
+    ['--bitrix', '--host', 'ok', '--root', 'C:/Program Files/Git/var/www/x', 'a.php'],
+    ['--host', 'ok', '--php', 'C:/msys64/opt/php74/bin/php', 'a.php'],
+    ['--bitrix', '--host', 'ok', '--root', 'C:/msys64/var/www/x', 'a.php']]) {
     const r = run(p, args);
     assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
     assert.match(r.stderr, /MSYS_NO_PATHCONV=1/, JSON.stringify(args));
+    assert.match(r.stderr, /MSYS2_ARG_CONV_EXCL/, JSON.stringify(args));
     assert.equal(r.sent, null, JSON.stringify(args));
   }
 });
@@ -51,22 +54,71 @@
   }
 });
 
-test('remote-php: SSH для сервера не задан — код 2; консоль — только bitrix с адресом, иначе выполнить негде', () => {
+test('remote-php: SSH для сервера не задан — код 2; файл kit-exec.php — только bitrix с адресом, иначе выполнить негде', () => {
   const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- SSH прод: —']) });
   const r = run(p, ['a.php']);
   assert.equal(r.code, 2);
   assert.match(r.stderr, /SSH прод/);
-  assert.match(r.stderr, /Командн/);
+  assert.match(r.stderr, /kit-exec/);
   assert.equal(r.sent, null);
   for (const lines of [['- Режим: общий', '- Прод: https://x.ru', '- SSH прод: —'], ['- Режим: bitrix', '- Прод: —', '- SSH прод: —']]) {
     const g = run(makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(lines) }), ['a.php']);
     assert.equal(g.code, 2, lines.join(' '));
     assert.match(g.stderr, /негде/, lines.join(' '));
+    assert.match(g.stderr, /включить SSH/, lines.join(' '));
     assert.match(g.stderr, /reference\/ssh\.md/, lines.join(' '));
-    assert.doesNotMatch(g.stderr, /Командн/, lines.join(' '));
+    assert.doesNotMatch(g.stderr, /kit-exec/, lines.join(' '));
   }
 });
 
+test('remote-php: --timeout — от 1 до 3600 секунд, иначе код 4', () => {
+  const p = makeProject({ 'a.php': 'echo 1;\n' });
+  for (const value of ['0', '3601', 'abc', '-5', '1.5', '']) {
+    const r = run(p, ['--host', 'ok', '--timeout', value, 'a.php']);
+    assert.equal(r.code, 4, JSON.stringify(value) + ': ' + r.stderr);
+    assert.match(r.stderr, /--timeout/);
+    assert.equal(r.sent, null, JSON.stringify(value));
+  }
+});
+
+test('remote-php: PHP запускается под серверным timeout (по умолчанию 110 с, --timeout меняет), stdin идёт в PHP', { skip }, () => {
+  const p = makeProject({ 'a.php': 'echo 1;\n' });
+  const d = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
+  assert.equal(d.code, 0, d.stderr);
+  assert.equal(d.stdout, '1');
+  assert.equal(d.sent.command, 'if command -v timeout >/dev/null 2>&1; then timeout -k 5 110 \'' + php('7.4') + '\'; else \'' + php('7.4') + '\'; fi; printf "\\n__KIT_EXIT=%s\\n" "$?"');
+  const t = run(p, ['--host', 'ok', '--timeout', '30', '--php', php('7.4'), 'a.php']);
+  assert.match(t.sent.command, /timeout -k 5 30 '/);
+});
+
+test('remote-php: зависание — ssh останавливается по времени, код 3 «результат неизвестен»', () => {
+  const p = makeProject({ 'a.php': 'echo 1;\n' });
+  const r = run(p, ['--host', 'hang', '--timeout', '1', 'a.php'], { KIT_SSH_GRACE: '0' });
+  assert.equal(r.code, 3, r.stderr);
+  assert.match(r.stderr, /вышло время/);
+  assert.match(r.stderr, /результат неизвестен/);
+});
+
+test('remote-php: серверный timeout сработал (код 124) — код 3 «результат неизвестен»', () => {
+  const p = makeProject({ 'a.php': 'echo 1;\n' });
+  const r = run(p, ['--host', 'ok', '--timeout', '5', 'a.php'], { FAKE_SSH_OUT: 'начало', FAKE_SSH_EXIT: '124' });
+  assert.equal(r.code, 3, r.stderr);
+  assert.equal(r.stdout, 'начало');
+  assert.match(r.stderr, /не уложился в --timeout 5 с/);
+  assert.match(r.stderr, /результат неизвестен/);
+});
+
+test('remote-php: общий режим — DOCUMENT_ROOT из «SSH …» или --root; без папки — чистый PHP; неабсолютная --root — код 4', () => {
+  const withRoot = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', '--root', '/var/www/it\'s', 'a.php']);
+  assert.equal(withRoot.sent.stdin, '<?php\n$_SERVER[\'DOCUMENT_ROOT\'] = \'/var/www/it\\\'s\';\necho 1;\n');
+  const noRoot = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', 'a.php']);
+  assert.equal(noRoot.sent.stdin, '<?php\necho 1;\n');
+  const bad = run(makeProject({ 'a.php': 'echo 1;\n' }), ['--plain', '--host', 'ok', '--root', 'var/www', 'a.php']);
+  assert.equal(bad.code, 4);
+  assert.match(bad.stderr, /папка сайта/);
+  assert.equal(bad.sent, null);
+});
+
 test('remote-php: чистый PHP — вывод без <pre>, на stdin — код с приставкой, PHP в кавычках', { skip }, () => {
   const p = makeProject({ 'a.php': 'echo "<pre>привет\\n</pre>";\n' });
   const r = run(p, ['--host', 'ok', '--php', php('7.4'), 'a.php']);
@@ -74,7 +126,7 @@
   assert.equal(r.stdout, 'привет\n');
   assert.equal(r.sent.host, 'ok');
   assert.ok(r.sent.opts.includes('BatchMode=yes'));
-  assert.ok(r.sent.command.startsWith("'" + php('7.4') + "'"), r.sent.command);
+  assert.ok(r.sent.command.includes("'" + php('7.4') + "'"), r.sent.command);
   assert.equal(r.sent.stdin, '<?php\necho "<pre>привет\\n</pre>";\n');
 });
 
@@ -143,13 +195,13 @@
   });
   const r = run(p, ['a.php']);
   assert.equal(r.sent.host, 'ok');
-  assert.ok(r.sent.command.startsWith("'" + php('7.4') + "'"));
+  assert.ok(r.sent.command.includes("'" + php('7.4') + "'"));
   assert.match(r.sent.stdin, /\$_SERVER\['DOCUMENT_ROOT'\] = '\/var\/www\/site';/);
   assert.match(r.sent.stdin, /\$_SERVER\['HTTP_HOST'\] = \$_SERVER\['SERVER_NAME'\] = 'alpha\.example\.com';/);
   assert.match(r.sent.stdin, /define\('NO_AGENT_CHECK', true\)/);
   assert.match(r.sent.stdin, /prolog_before\.php/);
   assert.equal(run(p, ['--env', 'дев', 'a.php']).code, 2);
-  assert.equal(run(p, ['--plain', 'a.php']).sent.stdin, '<?php\necho 1;\n');
+  assert.equal(run(p, ['--plain', 'a.php']).sent.stdin, "<?php\n$_SERVER['DOCUMENT_ROOT'] = '/var/www/site';\necho 1;\n");
 });
 
 test('remote-php: не пустил — код 3 с причиной; обрыв после начала вывода — код 3, вывод показан', () => {
```

```diff
--- a/tests/ssh.test.js
+++ b/tests/ssh.test.js
@@ -93,6 +93,18 @@
   assert.match(none.stderr, /не удалось запустить ssh/);
 });
 
+test('runSsh: общий таймаут — зависший ssh останавливается, connected: false и timedOut; без timeoutMs — как раньше', async () => {
+  const t0 = Date.now();
+  const { r } = await withFake({}, () => runSsh('hang', 'true', '', { timeoutMs: 300 }));
+  assert.equal(r.connected, false);
+  assert.equal(r.exitCode, null);
+  assert.equal(r.timedOut, true);
+  assert.equal(lastLine(r.stderr), 'время вышло (0 с), ssh остановлен');
+  assert.ok(Date.now() - t0 < 5000, 'остановился по таймеру, а не ждал вечно');
+  const ok = (await withFake({ FAKE_SSH_OUT: 'ок' }, () => runSsh('ok', 'true', '', { timeoutMs: 60000 }))).r;
+  assert.deepEqual(ok, { connected: true, exitCode: 0, stdout: 'ок', stderr: '' });
+});
+
 test('runSsh: ssh закрылся, не прочитав stdin (2 МБ), — connected: false без исключения', async () => {
   const { r } = await withFake({}, () => runSsh('closed', 'true', Buffer.alloc(2 * 1024 * 1024)));
   assert.equal(r.connected, false);
```

```diff
--- a/tests/console-scripts.test.js
+++ b/tests/console-scripts.test.js
@@ -67,6 +67,14 @@
   });
 }
 
+test('check-files.php: DOCUMENT_ROOT не задан — «стоп» без предупреждений PHP', { skip: !hasPhp('7.4') }, () => {
+  const r = runPhp('7.4', '<?php\nerror_reporting(E_ALL);\n' + read('check-files.php'));
+  assert.equal(r.code, 0, r.stderr);
+  assert.equal(r.stderr, '', 'предупреждения PHP');
+  assert.match(r.stdout, /DOCUMENT_ROOT не задан — стоп/);
+  assert.doesNotMatch(r.stdout, /Итого/);
+});
+
 test('md5-check: ок, переводы строк, отличается, нет', { skip: !hasPhp('7.4') }, () => {
   const project = makeProject({ 'a.txt': 'one\ntwo\n', 'b.txt': 'x\ny\n', 'c.txt': 'same\n', 'd.txt': 'gone\n' });
   const server = writeFiles(tmpDir(), { 'a.txt': 'one\ntwo\n', 'b.txt': 'x\r\ny\r\n', 'c.txt': 'changed\n' });
```

```diff
--- a/tests/visual-args-links.test.js
+++ b/tests/visual-args-links.test.js
@@ -24,6 +24,7 @@
   assert.equal(fixMsysPath('C:/Program Files/Git/catalog/'), '/catalog/');
   assert.equal(fixMsysPath('C:\\Program Files\\Git\\personal\\orders\\'), '/personal/orders/');
   assert.equal(fixMsysPath('D:/Tools/PortableGit/catalog/'), '/catalog/');
+  assert.equal(fixMsysPath('C:/msys64/personal/orders/'), '/personal/orders/');
   assert.equal(fixMsysPath('/catalog/'), '/catalog/');
   assert.equal(seedPath('C:/Program Files/Git/catalog/'), '/catalog/');
   assert.equal(seedPath('catalog/'), '/catalog/');
```

- [ ] **Шаг 2: тесты падают.** `node --test tests/msys.test.js tests/remote-php.test.js tests/ssh.test.js tests/console-scripts.test.js tests/visual-args-links.test.js`. Ожидаемо: FAIL — нет модуля `lib/msys`, нет флага `--timeout`, у `runSsh` нет таймаута, `check-files.php` без `DOCUMENT_ROOT` даёт предупреждение PHP (10 падений из 77). **Осторожно:** у прежнего `runSsh` нет таймаута, поэтому тест «зависание» оставляет процесс `node …\tests\fake-ssh.js … hang`, и раннер тестов не завершается, пока его не остановить (PowerShell: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" \| Where-Object { $_.CommandLine -match 'fake-ssh' }` → `Stop-Process -Id <PID> -Force`); запускать шаг 2 с `--test-timeout=20000` и в фоне.

- [ ] **Шаг 3: код.**

Создать `plugins/kit/scripts/lib/msys.js`:

```javascript
'use strict';
// Путь, переписанный MSYS: Git Bash превращает аргумент «/путь» в «C:/Program Files/Git/путь», MSYS2 — в «C:/msys64/путь».
// Общее для remote-php.js (код 4 с подсказкой) и visual/args.js (возвращает путь как был).
const MSYS_RE = /^[A-Za-z]:[\\/].*?(?:Git|msys(?:32|64)?)[\\/]/i;

const isMsysRewritten = (p) => MSYS_RE.test(String(p));

// «C:/Program Files/Git/catalog/» → «/catalog/»; остальные пути — без изменений.
const undoMsys = (p) => String(p).replace(MSYS_RE, '/');

module.exports = { isMsysRewritten, undoMsys };
```

Изменить (дифф от `7047cf0`):

```diff
--- a/plugins/kit/scripts/lib/ssh.js
+++ b/plugins/kit/scripts/lib/ssh.js
@@ -50,24 +50,28 @@
   return lines.length ? lines[lines.length - 1] : '';
 }
 
-// Выполнить remoteCmd на host, stdin — строка или Buffer.
-// → { connected, exitCode, stdout, stderr }; connected: false — метки нет (не пустил или соединение оборвалось).
-function runSsh(host, remoteCmd, stdin) {
+// Выполнить remoteCmd на host, stdin — строка или Buffer; timeoutMs — общий таймаут (нет — без ограничения).
+// → { connected, exitCode, stdout, stderr }; connected: false — метки нет (не пустил, соединение оборвалось
+// или вышло время — тогда ещё timedOut: true).
+function runSsh(host, remoteCmd, stdin, { timeoutMs } = {}) {
   return new Promise((resolve) => {
     const { cmd, pre } = sshBinary();
     const args = [...pre, ...SSH_OPTS, host, remoteCmd + '; printf "\\n__KIT_EXIT=%s\\n" "$?"'];
     const out = [];
     const err = [];
     let done = false;
+    let timedOut = false;
+    let timer = null;
     const finish = (extraErr) => {
       if (done) return;
       done = true;
+      if (timer) clearTimeout(timer);
       const stdout = Buffer.concat(out).toString('utf8');
       const stderr = Buffer.concat(err).toString('utf8') + (extraErr || '');
       const m = MARK_RE.exec(stdout);
-      resolve(m
-        ? { connected: true, exitCode: Number(m[1]), stdout: stdout.slice(0, m.index), stderr }
-        : { connected: false, exitCode: null, stdout, stderr });
+      if (m) resolve({ connected: true, exitCode: Number(m[1]), stdout: stdout.slice(0, m.index), stderr });
+      else if (timedOut) resolve({ connected: false, exitCode: null, stdout, stderr: stderr + 'время вышло (' + Math.round(timeoutMs / 1000) + ' с), ssh остановлен\n', timedOut: true });
+      else resolve({ connected: false, exitCode: null, stdout, stderr });
     };
     let child;
     try {
@@ -76,6 +80,12 @@
       finish('не удалось запустить ssh: ' + e.message + '\n');
       return;
     }
+    if (timeoutMs > 0) {
+      timer = setTimeout(() => {
+        timedOut = true;
+        try { child.kill(); } catch (e) { /* уже завершился */ }
+      }, timeoutMs);
+    }
     child.stdout.on('data', (d) => out.push(d));
     child.stderr.on('data', (d) => err.push(d));
     child.on('error', (e) => finish('не удалось запустить ssh: ' + e.message + '\n'));
```

```diff
--- a/plugins/kit/scripts/lib/visual/args.js
+++ b/plugins/kit/scripts/lib/visual/args.js
@@ -1,5 +1,6 @@
 'use strict';
 // Аргументы visual.js: команда, позиционные, флаги; пути, переписанные Git Bash; имена и метки.
+const { undoMsys } = require('../msys');
 
 // Ошибка с кодом выхода: 2 — аргументы или pages.json, 3 — сессия, 4 — защита выкладки, 5 — зависимости или Chrome.
 class VisualError extends Error {
@@ -31,9 +32,9 @@
   return out;
 }
 
-// Git Bash (MSYS) переписывает «/catalog/» в «C:/Program Files/Git/catalog/» — возвращаем как было.
+// Git Bash (MSYS) переписывает «/catalog/» в «C:/Program Files/Git/catalog/» (MSYS2 — в «C:/msys64/catalog/») — возвращаем как было.
 function fixMsysPath(a) {
-  return String(a).replace(/^[A-Za-z]:[\\/].*?Git[\\/]/i, '/').replace(/\\/g, '/');
+  return undoMsys(a).replace(/\\/g, '/');
 }
 
 // Адрес-затравка discover: путь от корня сайта (полный адрес — берётся путь и query).
```

```diff
--- a/plugins/kit/scripts/remote-php.js
+++ b/plugins/kit/scripts/remote-php.js
@@ -1,21 +1,25 @@
 #!/usr/bin/env node
 'use strict';
 // Выполнить PHP-код на сервере по SSH (канал SSH скилла /kit:server).
-// node remote-php.js [--env прод|дев] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>
-// Код в файле — как для Командной PHP-строки, без <?php (если есть — отрезается). Режим bitrix (параметр «Режим»
-// или --bitrix): перед кодом подключается ядро Битрикса. Код уходит на stdin «PHP на сервере», файл на сервер не пишется.
-// Коды: 0 — выполнено; 1 — PHP завершился не 0; 2 — SSH для сервера не задан; 3 — нет подключения или оно оборвалось;
-// 4 — аргументы, файл, путь, переписанный Git Bash, или неверный параметр «SSH прод» / «SSH дев».
+// node remote-php.js [--env прод|дев] [--timeout сек] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>
+// Код в файле — без <?php (если есть — отрезается). Режим bitrix (параметр «Режим» или --bitrix): перед кодом
+// подключается ядро Битрикса. Код уходит на stdin «PHP на сервере», файл на сервер не пишется. PHP запускается под
+// `timeout` сервера (если он есть) на --timeout секунд (по умолчанию 110), сам ssh останавливается на 10 секунд позже.
+// Коды: 0 — выполнено; 1 — PHP завершился не 0; 2 — SSH для сервера не задан; 3 — нет подключения, оно оборвалось или
+// вышло время; 4 — аргументы, файл, путь, переписанный Git Bash или MSYS2, или неверный параметр «SSH прод» / «SSH дев».
 const fs = require('fs');
 const path = require('path');
 const { readParams } = require('./lib/params');
 const { shq, validHost, serverSsh, runSsh, lastLine } = require('./lib/ssh');
+const { isMsysRewritten } = require('./lib/msys');
 
-const USAGE = 'Использование: node remote-php.js [--env прод|дев] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>';
-const VALUE_FLAGS = { '--env': 'env', '--host': 'host', '--root': 'root', '--php': 'php', '--url': 'url' };
-// Git Bash (MSYS) переписывает аргумент «/путь» в «C:/Program Files/Git/путь».
-const MSYS_RE = /^[A-Za-z]:\/(?:.*\/)?Git\//i;
-
+const USAGE = 'Использование: node remote-php.js [--env прод|дев] [--timeout сек] [--plain|--bitrix] [--host H --root R --php P --url U] <файл>';
+const VALUE_FLAGS = { '--env': 'env', '--host': 'host', '--root': 'root', '--php': 'php', '--url': 'url', '--timeout': 'timeout' };
+// Меньше таймаута инструмента Bash (120 с): при зависании PHP получим код 3, а не обрыв всего вызова.
+const DEFAULT_TIMEOUT = 110;
+// ssh останавливается позже серверного timeout: сначала PHP снимает сервер, потом — запасной таймер.
+// KIT_SSH_GRACE — только для тестов (иначе проверка зависания длилась бы 10 секунд).
+const SSH_GRACE = process.env.KIT_SSH_GRACE !== undefined ? Number(process.env.KIT_SSH_GRACE) : 10;
 // Строка PHP в одинарных кавычках.
 const pq = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
 
@@ -42,9 +46,13 @@
   if (!o.file) throw new Error('не указан файл с кодом');
   if (o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
   if (o.host !== undefined && !validHost(o.host)) throw new Error('недопустимый хост ' + o.host);
+  if (o.timeout !== undefined && !(/^\d+$/.test(o.timeout) && Number(o.timeout) >= 1 && Number(o.timeout) <= 3600)) {
+    throw new Error('--timeout: секунды, от 1 до 3600');
+  }
+  o.timeoutSec = o.timeout === undefined ? DEFAULT_TIMEOUT : Number(o.timeout);
   for (const k of ['root', 'php']) {
-    if (o[k] !== undefined && MSYS_RE.test(o[k])) {
-      throw new Error('--' + k + ' ' + o[k] + ': Git Bash переписал путь сервера — запусти с MSYS_NO_PATHCONV=1 перед node (путь к файлу тогда — в виде C:/…) или из PowerShell');
+    if (o[k] !== undefined && isMsysRewritten(o[k])) {
+      throw new Error('--' + k + ' ' + o[k] + ': Git Bash (MSYS2) переписал путь сервера — запусти с MSYS_NO_PATHCONV=1 (MSYS2 — MSYS2_ARG_CONV_EXCL=\'*\') перед node (путь к файлу тогда — в виде C:/…) или из PowerShell');
     }
   }
   return o;
@@ -73,6 +81,18 @@
   return lines.join('\n') + '\n';
 }
 
+// Общий режим: чистый PHP; папка сайта известна — DOCUMENT_ROOT задан (нужен check-files.php и delete-list.php).
+function plainPrefix(root) {
+  return root ? '<?php\n$_SERVER[\'DOCUMENT_ROOT\'] = ' + pq(root) + ';\n' : '<?php\n';
+}
+
+// PHP на сервере под `timeout`, если он есть (coreutils): по истечении секунд — SIGTERM, через 5 с — SIGKILL, код 124.
+// Ветки if/else — обе читают stdin, выполняется одна.
+function remoteCommand(phpBin, seconds) {
+  const p = shq(phpBin);
+  return 'if command -v timeout >/dev/null 2>&1; then timeout -k 5 ' + seconds + ' ' + p + '; else ' + p + '; fi';
+}
+
 // Скрипт для stdin: приставка + код без <?php. shift — на сколько номер строки в скрипте больше номера в файле.
 function buildScript(code, { mode, root, domain }) {
   let body = String(code).replace(/^\uFEFF/, '');
@@ -82,16 +102,16 @@
     removed = open[0].includes('\n') ? 1 : 0;
     body = body.slice(open[0].length);
   }
-  const prefix = mode === 'bitrix' ? bitrixPrefix(root, domain) : '<?php\n';
+  const prefix = mode === 'bitrix' ? bitrixPrefix(root, domain) : plainPrefix(root);
   const prefixLines = prefix.split('\n').length - 1;
   return { script: prefix + body, prefixLines, shift: prefixLines - removed };
 }
 
 // «Standard input code» → путь файла; номер строки — строка файла, строки приставки помечаются.
-function fixLines(text, file, prefixLines, shift) {
+function fixLines(text, file, prefixLines, shift, label = 'приставка remote-php') {
   return String(text).replace(/Standard input code( on line |:|\()(\d+)/g, (m, sep, n) => {
     const line = Number(n);
-    return line <= prefixLines ? 'приставка remote-php' + sep + line : file + sep + (line - shift);
+    return line <= prefixLines ? label + sep + line : file + sep + (line - shift);
   });
 }
 
@@ -127,25 +147,34 @@
   const url = o.url || params.get(o.env === 'дев' ? 'Дев' : 'Прод');
   if (!host) {
     console.error('remote-php: SSH для сервера «' + o.env + '» не задан (параметр «' + sshKey + '») — ' + (mode === 'bitrix' && url
-      ? 'выполнить через Командную PHP-строку (/kit:server, канал «консоль»)'
-      : 'выполнить на сервере негде: настроить вход по ключу, справка reference/ssh.md'));
+      ? 'выполнить через файл kit-exec.php (/kit:server, файл-канал: node kit-exec.js)'
+      : 'выполнить на сервере негде: включить SSH, справка reference/ssh.md'));
     return 2;
   }
   const root = o.root || target.root;
-  if (mode === 'bitrix' && !(root && isAbsolute(root))) {
-    console.error('remote-php: для ядра Битрикса нужна папка сайта — абсолютный путь (параметр «' + sshKey + '» или --root)');
+  if ((mode === 'bitrix' && !root) || (root && !isAbsolute(root))) {
+    console.error('remote-php: ' + (mode === 'bitrix' ? 'для ядра Битрикса нужна ' : 'нужна ') +
+      'папка сайта — абсолютный путь (параметр «' + sshKey + '» или --root)');
     return 4;
   }
   const phpBin = o.php || params.get('PHP на сервере', 'php');
   const { script, prefixLines, shift } = buildScript(code, { mode, root, domain: url ? domainOf(url) : null });
-  const r = await runSsh(host, shq(phpBin), script);
+  const r = await runSsh(host, remoteCommand(phpBin, o.timeoutSec), script, { timeoutMs: (o.timeoutSec + SSH_GRACE) * 1000 });
   const fix = (t) => fixLines(t, o.file, prefixLines, shift);
   process.stdout.write(fix(stripPre(r.stdout)));
   if (r.stderr) process.stderr.write(fix(r.stderr));
+  const unknown = ' Если код что-то менял — результат неизвестен: не повторять, проверить состояние чтением.';
   if (!r.connected) {
+    if (r.timedOut) {
+      console.error('remote-php: вышло время (' + o.timeoutSec + ' с + ' + SSH_GRACE + ' с), ssh остановлен; долгому скрипту — больший --timeout.' + unknown);
+      return 3;
+    }
     const why = lastLine(r.stderr);
-    console.error('remote-php: нет подключения к ' + host + ' или оно оборвалось' + (why ? ': ' + why : '') +
-      '. Если код что-то менял — результат неизвестен: не повторять, проверить состояние чтением.');
+    console.error('remote-php: нет подключения к ' + host + ' или оно оборвалось' + (why ? ': ' + why : '') + '.' + unknown);
+    return 3;
+  }
+  if (r.exitCode === 124) {
+    console.error('remote-php: PHP не уложился в --timeout ' + o.timeoutSec + ' с и остановлен на сервере (timeout); долгому скрипту — больший --timeout.' + unknown);
     return 3;
   }
   if (r.exitCode !== 0) {
@@ -161,4 +190,4 @@
     process.exitCode = 1;
   });
 }
-module.exports = { parseArgs, buildScript, bitrixPrefix, fixLines, stripPre };
+module.exports = { parseArgs, buildScript, bitrixPrefix, plainPrefix, remoteCommand, fixLines, stripPre };
```

```diff
--- a/plugins/kit/skills/server/scripts/check-files.php
+++ b/plugins/kit/skills/server/scripts/check-files.php
@@ -4,7 +4,11 @@
 
 $files = []; // KIT:FILES — 'путь от корня сайта' => ['md5 как есть', 'md5 с LF']
 
-$root = rtrim($_SERVER['DOCUMENT_ROOT'], '/\\');
+$root = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/\\') : '';
+if ($root === '') {
+    echo "<pre>DOCUMENT_ROOT не задан — стоп.\n</pre>";
+    return;
+}
 $total = ['ок' => 0, 'ОТЛИЧАЕТСЯ' => 0, 'нет' => 0];
 echo "<pre>";
 echo "Файлов в списке: " . count($files) . "\n\n";
```

- [ ] **Шаг 4: тесты проходят.** Те же файлы — `ℹ fail 0`; затем весь набор `node --test tests/*.test.js` — `ℹ tests 294`, `ℹ pass 291`, `ℹ fail 0`, `ℹ skipped 3`.

- [ ] **Шаг 5: закрыть шаг** — `/kit:step-done 12.3` (BUGS: К13, К16, К20 — исправлены; SUMMARY — общий таймаут SSH (серверный `timeout` + остановка ssh), `lib/msys.js`, `DOCUMENT_ROOT` в общем режиме).

---

### Задача 12.4: файл-канал — сборка `kit-exec.php`

**Файлы:**
- Создать: `plugins/kit/scripts/lib/kitexec.js`, `plugins/kit/scripts/kit-exec.js`, `tests/kit-exec.test.js`

**Интерфейсы:**
- Потребляет: `fixLines(text, file, prefixLines, shift, label)` из `remote-php.js` (задача 12.3); `readParams` из `lib/params`.
- Производит: `buildKitExec(code, { run }) → { php, prefixLines, shift }` (бросает `Error` при неверном `run`), `validRun(run)`; CLI `node kit-exec.js <код.php> --run N --out <файл> [--env прод|дев] [--url U] [--php P] [--bitrix]`, коды 0/1/2/4 (спек §9), строка `Адрес: <адрес>/kit-exec.php?run=<N>`.

- [ ] **Шаг 1: тесты.** Создать `tests/kit-exec.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, php, hasPhp, phpLint, spawnPhp, PLUGIN } = require('./helpers');
const { buildKitExec } = require('../plugins/kit/scripts/lib/kitexec');

const skip = !hasPhp('7.4');
const params = (lines) => '# Проект\n\n## Параметры для агентов\n\n' + lines.join('\n') + '\n';

// Поддельное ядро Битрикса: $USER->IsAdmin() — по переменной окружения FAKE_ADMIN; BX_UTF — по FAKE_UTF.
const PROLOG = '<?php\n'
  + 'class KitFakeUser { function IsAdmin() { return getenv("FAKE_ADMIN") === "1"; } }\n'
  + '$USER = new KitFakeUser();\n'
  + 'if (getenv("FAKE_UTF") === "1") { define("BX_UTF", true); }\n';

// Собирает kit-exec.php из code в поддельный сайт и запускает его локальным PHP как страницу.
// query — то, что придёт в ?run= (по умолчанию — номер файла); null — параметра нет.
function page(v, code, { admin = true, utf = true, run = 'abc123', query = run } = {}) {
  const site = writeFiles(tmpDir('kit-site-'), { 'bitrix/modules/main/include/prolog_before.php': PROLOG });
  const { php: body } = buildKitExec(code, { run });
  fs.writeFileSync(path.join(site, 'kit-exec.php'), body);
  const root = site.replace(/\\/g, '/');
  const get = query === null ? '' : "$_GET['run'] = '" + query + "';\n";
  fs.writeFileSync(path.join(site, 'run.php'), "<?php\n$_SERVER['DOCUMENT_ROOT'] = '" + root + "';\n" + get + "require '" + root + "/kit-exec.php';\n");
  const r = spawnPhp(v, ['-d', 'display_errors=0', path.join(site, 'run.php')], {
    env: { ...process.env, FAKE_ADMIN: admin ? '1' : '0', FAKE_UTF: utf ? '1' : '0' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', site };
}

test('kitexec: номер запуска — латиница и цифры, 4–32 знака', () => {
  for (const run of ['', 'abc', 'a b c d', 'abc-123', 'x'.repeat(33), undefined, 'абвг']) {
    assert.throws(() => buildKitExec('echo 1;', { run }), /номер запуска/, String(run));
  }
  assert.doesNotThrow(() => buildKitExec('echo 1;', { run: 'a1B2' }));
  assert.doesNotThrow(() => buildKitExec('echo 1;', { run: 'x'.repeat(32) }));
});

test('kitexec: права проверяются до кода задачи, без NOT_CHECK_PERMISSIONS, ничего не читает из запроса', () => {
  const marker = 'echo "МЕТКА-КОДА";';
  const { php: body } = buildKitExec(marker, { run: 'abc123' });
  assert.ok(body.indexOf('IsAdmin()') > 0 && body.indexOf('IsAdmin()') < body.indexOf('МЕТКА-КОДА'), 'IsAdmin раньше кода');
  assert.ok(body.indexOf('prolog_before.php') < body.indexOf('IsAdmin()'));
  for (const bad of ['NOT_CHECK_PERMISSIONS', '$_POST', '$_REQUEST', '$_FILES', '$_COOKIE', 'php://input', 'eval(', 'file_put_contents', 'unlink']) {
    assert.ok(!body.includes(bad), 'в файле-канале не должно быть ' + bad);
  }
  // Из запроса читается одно: ?run= — и только чтобы сверить с номером этого файла.
  assert.deepEqual(body.match(/\$_GET\[[^\]]*\]/g), ["$_GET['run']", "$_GET['run']"]);
  assert.ok(body.indexOf('IsAdmin()') < body.indexOf("$_GET['run']"), 'сначала права, потом номер запуска');
  assert.ok(body.indexOf("$_GET['run']") < body.indexOf('МЕТКА-КОДА'), 'номер запуска проверяется до кода задачи');
  assert.match(body, /header\('Content-Type: text\/plain; charset=utf-8'\)/);
  assert.match(body, /header\('Cache-Control: no-store'\)/);
  assert.match(body, /header\('X-Robots-Tag: noindex'\)/);
  assert.match(body, /header\('X-Content-Type-Options: nosniff'\)/);
  assert.match(body, /http_response_code\(403\)/);
  assert.match(body, /echo 'KIT-RUN abc123' \. "\\n";/);
  assert.ok(body.startsWith('<?php\n'));
  assert.ok(!body.includes('\r'), 'переводы строк LF');
});

test('kitexec: ведущий <?php и BOM отрезаются; shift = число строк приставки минус съеденные', () => {
  const plain = buildKitExec('echo 1;\n', { run: 'abc123' });
  const withTag = buildKitExec('\uFEFF<?php\necho 1;\n', { run: 'abc123' });
  assert.equal(plain.shift, plain.prefixLines);
  assert.equal(withTag.shift, withTag.prefixLines - 1);
  assert.equal(withTag.prefixLines, plain.prefixLines);
  for (const b of [plain, withTag]) {
    assert.equal(b.php.split('\n').slice(b.prefixLines)[0], 'echo 1;', 'код начинается сразу после приставки');
    assert.ok(b.php.includes('($e[\'line\'] - ' + b.shift + ')'), 'сдвиг вписан в приставку');
    assert.ok(b.php.includes('($kitError->getLine() - ' + b.shift + ')'), 'сдвиг вписан в обработчик ошибок');
  }
  assert.ok(buildKitExec('echo 1;', { run: 'abc123' }).php.includes('echo 1;\n} catch'), 'после кода без \\n — перевод строки');
});

for (const v of ['7.2', '7.4', '8.3']) {
  test(`kitexec: собранный файл и библиотечные скрипты проходят php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    const dir = path.join(PLUGIN, 'skills', 'server', 'scripts');
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const { php: body } = buildKitExec(fs.readFileSync(path.join(dir, name), 'utf8'), { run: 'abc123' });
      const r = phpLint(v, body);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
    assert.equal(phpLint(v, buildKitExec('', { run: 'abc123' }).php).code, 0, 'пустой код');
  });
}

test('страница: администратор — KIT-RUN первой строкой, потом вывод кода без <pre>', { skip }, () => {
  const r = page('7.4', 'echo "<pre>привет\\n</pre>";\n');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'KIT-RUN abc123\nпривет\n');
});

test('страница: не администратор — одна строка, код не выполняется', { skip }, () => {
  const r = page('7.4', 'echo "СЕКРЕТ"; file_put_contents(__DIR__ . "/след.txt", "1");\n', { admin: false });
  assert.equal(r.out, 'kit: только для администратора');
  assert.ok(!r.out.includes('KIT-RUN') && !r.out.includes('СЕКРЕТ'));
  assert.ok(!fs.existsSync(path.join(r.site, 'след.txt')), 'код задачи не выполнялся');
});

test('страница: чужой или пустой ?run= — файл называет свой номер и код не выполняет (старый файл не повторит запуск)', { skip }, () => {
  for (const query of ['zzz999', '', 'ABC123', 'abc123 ', null]) {
    const r = page('7.4', 'echo "СЕКРЕТ"; file_put_contents(__DIR__ . "/след.txt", "1");\n', { query });
    assert.match(r.out, /^KIT-RUN abc123\nkit: код не выполнялся — нужен адрес \/kit-exec\.php\?run=abc123\n$/, JSON.stringify(query));
    assert.ok(!r.out.includes('СЕКРЕТ') && !fs.existsSync(path.join(r.site, 'след.txt')), 'код не выполнялся: ' + JSON.stringify(query));
  }
  const ok = page('7.4', 'echo "СЕКРЕТ";\n');
  assert.equal(ok.out, 'KIT-RUN abc123\nСЕКРЕТ');
});

test('страница: исключение — текст и строка файла с кодом (с <?php и без)', { skip }, () => {
  const a = page('7.4', 'echo "до\\n";\nthrow new Exception("сломалось");\n');
  assert.equal(a.out, 'KIT-RUN abc123\nдо\n\nОшибка: сломалось (строка 2 кода)\n');
  const b = page('7.4', '<?php\necho "до\\n";\n\nthrow new Exception("сломалось");\n');
  assert.match(b.out, /Ошибка: сломалось \(строка 4 кода\)/);
});

test('страница: фатальная ошибка — текст и строка кода, вывод до неё остаётся', { skip }, () => {
  const r = page('7.4', 'echo "до\\n";\n\ntrigger_error("бум", E_USER_ERROR);\n');
  assert.match(r.out, /^KIT-RUN abc123\nдо\n/);
  assert.match(r.out, /Фатальная ошибка: бум \(строка 3 кода\)/);
});

test('страница: сайт не в UTF-8 — вывод из windows-1251 в UTF-8; в UTF-8 — без перекодировки', { skip }, (t) => {
  const mb = spawnPhp('7.4', ['-r', 'echo extension_loaded("mbstring") ? "да" : "нет";']).stdout;
  if (mb !== 'да') {
    t.skip('в PHP 7.4 нет mbstring');
    return;
  }
  const cp = page('7.4', 'echo "\\xE0\\xE1";\n', { utf: false });
  assert.equal(cp.out, 'KIT-RUN abc123\nаб');
  const utf = page('7.4', 'echo "аб";\n', { utf: true });
  assert.equal(utf.out, 'KIT-RUN abc123\nаб');
  // Собственные сообщения файла — тоже читаемы: их кириллица приводится к кодировке сайта до перекодировки буфера.
  const err = page('7.4', 'echo "\\xE0";\nthrow new Exception("boom");\n', { utf: false });
  assert.equal(err.out, 'KIT-RUN abc123\nа\nОшибка: boom (строка 2 кода)\n');
  const fatal = page('7.4', 'trigger_error("boom", E_USER_ERROR);\n', { utf: false });
  assert.match(fatal.out, /\nФатальная ошибка: boom \(строка 1 кода\)\n$/);
});

test('kit-exec.js: сборка по параметрам проекта — файл, адрес, номер запуска; php -l', { skip }, () => {
  const p = makeProject({
    'a.php': 'echo "привет";\n',
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru/', '- Дев: https://dev.x.ru', '- PHP: ' + php('7.4')]),
  });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Адрес: https:\/\/x\.ru\/kit-exec\.php\?run=abc123$/m);
  assert.match(r.stdout, /номер запуска abc123/);
  assert.match(fs.readFileSync(out, 'utf8'), /KIT-RUN abc123/);
  const dev = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out, '--env', 'дев'], cwd: p });
  assert.match(dev.stdout, /^Адрес: https:\/\/dev\.x\.ru\/kit-exec\.php\?run=abc123$/m);
});

test('kit-exec.js: ошибка в коде — код 1, строка файла с кодом, файл не пишется', { skip }, () => {
  const p = makeProject({
    'a.php': 'echo 1;\necho 1 +;\n',
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: ' + php('7.4')]),
  });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a\.php on line 2/);
  assert.doesNotMatch(r.stderr, /Standard input code/);
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: не Битрикс или нет адреса — код 2; аргументы, файл, номер запуска — код 4', () => {
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const common = { 'a.php': 'echo 1;\n' };
  const general = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: общий', '- Прод: https://x.ru']) });
  const g = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: general });
  assert.equal(g.code, 2);
  assert.match(g.stderr, /только для сайтов на 1С-Битрикс/);
  assert.match(g.stderr, /включить SSH/);
  const noUrl = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: —']) });
  const n = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: noUrl });
  assert.equal(n.code, 2);
  assert.match(n.stderr, /нет адреса сервера/);
  const bitrix = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru']) });
  for (const args of [[], ['a.php'], ['a.php', '--run', 'abc123'], ['a.php', '--run', 'мало', '--out', out],
    ['a.php', '--run', 'abc123', '--out', out, '--нет'], ['a.php', 'b.php', '--run', 'abc123', '--out', out],
    ['a.php', '--run', 'abc123', '--out', out, '--env', 'тест'], ['нет.php', '--run', 'abc123', '--out', out]]) {
    const r = runScript('kit-exec.js', { args, cwd: bitrix });
    assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
  }
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: без параметра «PHP» — php -l пропущен с предупреждением, файл собран', () => {
  const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: —']) });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /php -l пропущен/);
  assert.ok(fs.existsSync(out));
});
```

- [ ] **Шаг 2: тесты падают.** `node --test tests/kit-exec.test.js` — FAIL: `Cannot find module '../plugins/kit/scripts/lib/kitexec'`.

- [ ] **Шаг 3: код.** Создать `plugins/kit/scripts/lib/kitexec.js`:

```javascript
'use strict';
// Тело kit-exec.php — файл-канал /kit:server для Битрикса без SSH (спек §7.4).
// Файл лежит в корне сайта, код одной задачи вшит в него при сборке; ничего из запроса он не выполняет.
// Порядок: ядро Битрикса (права проверяются по-настоящему) → проверка администратора → номер запуска → код задачи.
// Код выполняется только при ?run=<номер этого файла>: старый файл, который ещё не заменили новым, при открытии
// нового адреса называет свой номер и ничего не делает (иначе проверка «уехал ли файл» повторила бы старый запуск).
const RUN_RE = /^[A-Za-z0-9]{4,32}$/;
const validRun = (run) => typeof run === 'string' && RUN_RE.test(run);

// Приставка. @RUN@ — номер запуска, @SHIFT@ — на сколько номер строки в файле больше номера в файле с кодом.
const HEAD = String.raw`<?php
define('NO_KEEP_STATISTIC', true); define('NO_AGENT_CHECK', true); define('NO_AGENT_STATISTIC', true);
define('DisableEventsCheck', true); define('BX_NO_ACCELERATOR_RESET', true); define('STOP_STATISTICS', true);
require $_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_before.php';
global $USER;
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header('X-Content-Type-Options: nosniff');
if (!is_object($USER) || !$USER->IsAdmin()) {
    http_response_code(403);
    echo 'kit: только для администратора';
    exit;
}
echo 'KIT-RUN @RUN@' . "\n";
if ((isset($_GET['run']) ? (string) $_GET['run'] : '') !== '@RUN@') {
    echo 'kit: код не выполнялся — нужен адрес /kit-exec.php?run=@RUN@' . "\n";
    exit;
}
$kitUtf = defined('BX_UTF') && BX_UTF;
$kitText = function ($s) use ($kitUtf) { return $kitUtf ? $s : mb_convert_encoding($s, 'Windows-1251', 'UTF-8'); };
ob_start(function ($s) use ($kitUtf) {
    $s = preg_replace('~</?pre>~i', '', $s);
    return $kitUtf ? $s : mb_convert_encoding($s, 'UTF-8', 'Windows-1251');
});
register_shutdown_function(function () use ($kitText) {
    $e = error_get_last();
    if ($e && in_array($e['type'], array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR), true)) {
        echo $kitText("\nФатальная ошибка: ") . $e['message'] . ' (' . ($e['file'] === __FILE__ ? $kitText('строка ') . ($e['line'] - @SHIFT@) . $kitText(' кода') : basename($e['file']) . ':' . $e['line']) . ")\n";
    }
});
try {
`;

const TAIL = String.raw`
} catch (\Throwable $kitError) {
    echo $kitText("\nОшибка: ") . $kitError->getMessage() . ' (' . ($kitError->getFile() === __FILE__ ? $kitText('строка ') . ($kitError->getLine() - @SHIFT@) . $kitText(' кода') : basename($kitError->getFile()) . ':' . $kitError->getLine()) . ")\n";
}
`;

// Код без BOM и без ведущего <?php; removed — сколько строк съел <?php.
function stripOpenTag(code) {
  let body = String(code).replace(/^﻿/, '');
  let removed = 0;
  const open = /^<\?php(?:[ \t]*\r?\n|[ \t]+|$)/i.exec(body);
  if (open) {
    removed = open[0].includes('\n') ? 1 : 0;
    body = body.slice(open[0].length);
  }
  return { body, removed };
}

// → { php, prefixLines, shift }; shift — на сколько номер строки в php больше номера в файле с кодом.
function buildKitExec(code, { run }) {
  if (!validRun(run)) throw new Error('номер запуска — латиница и цифры, 4–32 знака');
  const { body, removed } = stripOpenTag(code);
  const prefixLines = HEAD.split('\n').length - 1;
  const shift = prefixLines - removed;
  const fill = (s) => s.replace(/@RUN@/g, run).replace(/@SHIFT@/g, String(shift));
  const code2 = body.endsWith('\n') || body === '' ? body : body + '\n';
  return { php: fill(HEAD) + code2 + fill(TAIL).replace(/^\n/, ''), prefixLines, shift };
}

module.exports = { validRun, buildKitExec };
```

Создать `plugins/kit/scripts/kit-exec.js`:

```javascript
#!/usr/bin/env node
'use strict';
// Собрать kit-exec.php — файл-канал /kit:server для Битрикса без SSH (спек §7.4).
// node kit-exec.js <код.php> --run N --out <файл> [--env прод|дев] [--url U] [--php P] [--bitrix]
// Код в файле — без <?php (если есть — отрезается) и без use. Собранный файл проверяется `php -l`.
// Скрипт только собирает файл (во временную папку сессии); в корень сайта его кладёт Claude одной записью.
// Коды: 0 — собрано; 1 — php -l нашёл ошибку; 2 — не режим bitrix или нет адреса сервера; 4 — аргументы, файл, --run.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readParams } = require('./lib/params');
const { buildKitExec, validRun } = require('./lib/kitexec');
const { fixLines } = require('./remote-php');

const USAGE = 'Использование: node kit-exec.js <код.php> --run N --out <файл> [--env прод|дев] [--url U] [--php P] [--bitrix]';
const VALUE_FLAGS = { '--run': 'run', '--out': 'out', '--env': 'env', '--url': 'url', '--php': 'php' };

function parseArgs(argv) {
  const o = { env: 'прод', file: null, bitrix: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[VALUE_FLAGS[a]] = argv[++i];
    } else if (a === '--bitrix') {
      o.bitrix = true;
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.file) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.file = a;
    }
  }
  if (!o.file) throw new Error('не указан файл с кодом');
  if (!o.out) throw new Error('не указан --out');
  if (o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (!validRun(o.run)) throw new Error('--run: номер запуска — латиница и цифры, 4–32 знака');
  return o;
}

// Адрес страницы: <адрес сайта>/kit-exec.php?run=<номер запуска> (без номера файл код не выполняет).
function pageUrl(base, run) {
  return String(base).replace(/\/+$/, '') + '/kit-exec.php?run=' + run;
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('kit-exec: ' + e.message + '\n' + USAGE);
    return 4;
  }
  let code;
  try {
    code = fs.readFileSync(path.resolve(o.file), 'utf8');
  } catch (e) {
    console.error('kit-exec: не удалось прочитать ' + o.file + ': ' + e.message);
    return 4;
  }
  const params = readParams(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const bitrix = o.bitrix || String(params.get('Режим', 'общий')).toLowerCase() === 'bitrix';
  const url = o.url || params.get(o.env === 'дев' ? 'Дев' : 'Прод');
  if (!bitrix) {
    console.error('kit-exec: файл-канал — только для сайтов на 1С-Битрикс (параметр «Режим: bitrix»); выполнить на сервере негде — включить SSH, справка reference/ssh.md');
    return 2;
  }
  if (!url) {
    console.error('kit-exec: нет адреса сервера «' + o.env + '» (параметр «' + (o.env === 'дев' ? 'Дев' : 'Прод') + '» или --url)');
    return 2;
  }
  const { php, prefixLines, shift } = buildKitExec(code, { run: o.run });
  const phpBin = o.php || params.get('PHP');
  if (phpBin && fs.existsSync(phpBin)) {
    const r = spawnSync(phpBin, ['-l'], { input: php, encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) {
      const text = fixLines((r.stdout || '') + (r.stderr || ''), o.file, prefixLines, shift, 'приставка kit-exec')
        .replace(/^Errors parsing Standard input code\r?\n?/mg, '');
      console.error('kit-exec: php -l нашёл ошибку:\n' + text.trim());
      return 1;
    }
  } else {
    console.error('kit-exec: php -l пропущен — нет параметра «PHP» (или --php) с путём к php.exe');
  }
  fs.writeFileSync(path.resolve(o.out), php, 'utf8');
  console.log('Собрано: ' + o.out + ' (номер запуска ' + o.run + ')');
  console.log('Адрес: ' + pageUrl(url, o.run));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error('kit-exec: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 1;
  }
}
module.exports = { parseArgs, pageUrl };
```

- [ ] **Шаг 4: тесты проходят.** `node --test tests/kit-exec.test.js` — 16 тестов, `ℹ fail 0`; весь набор — `ℹ tests 310`, `ℹ pass 307`, `ℹ fail 0`, `ℹ skipped 3`.

- [ ] **Шаг 5: закрыть шаг** — `/kit:step-done 12.4` (SUMMARY — `kit-exec.js` и `lib/kitexec.js`: сборка `kit-exec.php` с проверкой администратора, `?run=`, номером запуска, разбором ошибок; тесты на поддельном ядре Битрикса на PHP 7.2/7.4/8.3).

---

### Задача 12.5: `/kit-exec.php` — не коммитить и не выкладывать через git

**Файлы:**
- Изменить: `plugins/kit/scripts/secret-scan.js`, `plugins/kit/agents/git-keeper.md`, `plugins/kit/skills/project-init/templates/gitignore-bitrix`
- Тесты: `tests/secret-scan.test.js`, `tests/templates.test.js`, `tests/phpstorm-exclude.test.js`, `tests/content.test.js` (строка про git-keeper)

**Интерфейсы:** производит базовый запрет `/kit-exec.php` (только корень) в `secret-scan.js` и в списке запретов git-keeper; строку `/kit-exec.php` в шаблоне `.gitignore` для Битрикса.

- [ ] **Шаг 1: тесты.**

```diff
--- a/tests/secret-scan.test.js
+++ b/tests/secret-scan.test.js
@@ -208,6 +208,15 @@
   assert.doesNotMatch(r.stdout, /progress\.md|plan\.md/);
 });
 
+test('kit-exec.php (файл-канал /kit:server) — базовый запрет только в корне проекта', () => {
+  const dir = gitRepo({ 'x.txt': '' });
+  writeFiles(dir, { 'kit-exec.php': '<?php\n', 'local/kit-exec.php': '<?php\n', 'kit-exec.php.md': 'x', 'my-kit-exec.php': '<?php\n' });
+  const r = scan(dir, '--files', 'kit-exec.php', 'local/kit-exec.php', 'kit-exec.php.md', 'my-kit-exec.php');
+  assert.equal(r.code, 1);
+  assert.match(r.stdout, /^\s+kit-exec\.php: запрещённый путь \(\/kit-exec\.php\)/m);
+  assert.doesNotMatch(r.stdout, /local\/kit-exec|kit-exec\.php\.md|my-kit-exec/);
+});
+
 test('.env.example — не запрещённый путь, .env и .env.local — запрещённые', () => {
   const dir = gitRepo({ 'x.txt': '' });
   writeFiles(dir, { '.env.example': 'DB_PASSWORD=\n', '.env.local': 'X=1\n', '.env': 'X=1\n' });
```

```diff
--- a/tests/templates.test.js
+++ b/tests/templates.test.js
@@ -22,11 +22,11 @@
 
 test('gitignore-bitrix: служебное, ядро, снимки и секреты игнорируются; правила, документы, скрипты и материалы — в git', () => {
   const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php', '.claude/docs/visual/before/admin/desktop/home.png', '.claude/docs/visual/.gitignore',
-    'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1',
+    'kit-exec.php', 'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1',
     '.env', '.env.local', 'local/.env.production', 'cert/site.pem', 'local/ssl/private.key'];
   const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', '.claude/scripts/visual/pages.json', '.claude/docs/progress.md', '.claude/docs/deploy-prod.md',
     '.claude/docs/work/plan-12345.md', '.claude/docs/work/design/a.png', '.claude/docs/archive/plan-ssh.md', 'upload/docs/a.png', 'local/templates/x/a.php',
-    'local/templates/x/components/bitrix/news.list/.default/template.php', 'docs/progress.md', 'local/php_interface/env.php',
+    'local/templates/x/components/bitrix/news.list/.default/template.php', 'docs/progress.md', 'local/php_interface/env.php', 'local/kit-exec.php',
     '.env.example', 'local/.env.example'];
   const set = ignored(read('gitignore-bitrix'), [...yes, ...no]);
   for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
```

```diff
--- a/tests/phpstorm-exclude.test.js
+++ b/tests/phpstorm-exclude.test.js
@@ -24,6 +24,13 @@
   assert.deepEqual(args, ['${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js --hook', '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js']);
 });
 
+test('--hook: kit-exec.php (файл-канал /kit:server) не исключается из выкладки — иначе PhpStorm не залил бы его на сервер', () => {
+  const dir = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: BETA });
+  const r = hook(dir);
+  assert.equal(r.code, 0);
+  assert.ok(!xmlOf(dir).includes('kit-exec'));
+});
+
 test('--hook: вне kit-проекта и без настроек выкладки — тишина, файл не тронут', () => {
   const foreign = makeProject({ [XML]: NO_BLOCK, 'index.php': '' });
   const r = hook(foreign);
```

```diff
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -45,7 +45,7 @@
     'FILES пуст', 'пустым списком путей', 'отдельный аргумент',
     'только в одинарных кавычках', "git commit -m '<MESSAGE>'", "'' в корзине", "'\\''Купить'\\''", 'из Bash',
     'git -c core.quotepath=false status --porcelain=v1', 'git -c core.quotepath=false diff --cached --name-only --diff-filter=D',
-    'components/bitrix/', 'заголовок отличается от MESSAGE', 'MSYS_NO_PATHCONV=1 git commit', 'кроме `.env.example`', '`docs/visual/` и `.claude/docs/visual/`', "-- '.claude/docs/progress.md'", '-- ".claude/docs/progress.md"']) {
+    'components/bitrix/', 'заголовок отличается от MESSAGE', 'MSYS_NO_PATHCONV=1 git commit', 'кроме `.env.example`', '`/kit-exec.php` (файл-канал `/kit:server`, только в корне сайта)', '`docs/visual/` и `.claude/docs/visual/`', "-- '.claude/docs/progress.md'", '-- ".claude/docs/progress.md"']) {
     assert.ok(body.includes(s), s);
   }
   assert.doesNotMatch(body, /Co-Authored-By: Claude/, 'подпись не зашивается в агента');
```

- [ ] **Шаг 2: тесты падают.** `node --test tests/secret-scan.test.js tests/templates.test.js tests/content.test.js` — FAIL (нет запрета, нет строки в шаблоне, нет текста в git-keeper); `tests/phpstorm-exclude.test.js` уже проходит — он закрепляет, что хук не исключает `kit-exec.php`.

- [ ] **Шаг 3: код.**

```diff
--- a/plugins/kit/scripts/secret-scan.js
+++ b/plugins/kit/scripts/secret-scan.js
@@ -15,6 +15,7 @@
 const BASE_FORBIDDEN = [
   '.idea', '*.back*', '.settings.php', '.settings_extra.php', 'dbconn.php', '.env', '.env.* (кроме .env.example)',
   '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual', '.claude/docs/visual',
+  '/kit-exec.php', // файл-канал /kit:server (только корень): на сервере на время работы, в git не нужен
 ];
 const MAX_SIZE = 2 * 1024 * 1024;
 const PARAM_LINE = /^\s*[-*]\s+Секреты\s*:/i;
```

```diff
--- a/plugins/kit/agents/git-keeper.md
+++ b/plugins/kit/agents/git-keeper.md
@@ -26,7 +26,7 @@
    `-c core.quotepath=false` — во всех командах, которые выводят пути: иначе кириллические имена приходят восьмеричными escape-последовательностями (`"\320\277…"`), и `git add` по ним файл не находит.
    Корень репозитория должен совпадать с текущей папкой. Файлы, которые уже лежат в индексе, но не входят в FILES, в коммит не попадут — это обеспечивает п. 5.
 2. Запрещённые пути. Прочитай параметр «Не коммитить» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`. Остановись и ничего не коммить, если среди FILES есть:
-   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`, `docs/visual/` и `.claude/docs/visual/` (снимки `/kit:visual` из-под админа);
+   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`, `/kit-exec.php` (файл-канал `/kit:server`, только в корне сайта), `docs/visual/` и `.claude/docs/visual/` (снимки `/kit:visual` из-под админа);
    - пути из параметра «Не коммитить» (запись `X (кроме Y)`: X запрещён, Y разрешён).
 
    Правило со `/` в любом месте (`bitrix/`, `/bitrix`, `local/modules`) — путь от корня репозитория и всё внутри: `bitrix/` запрещает `bitrix/.settings.php`, но **не** `local/templates/…/components/bitrix/…` (копии шаблонов компонентов — обычная работа, их коммитят). Правило без `/` (`.idea`, `*.back*`) — имя в любом месте пути.
```

```diff
--- a/plugins/kit/skills/project-init/templates/gitignore-bitrix
+++ b/plugins/kit/skills/project-init/templates/gitignore-bitrix
@@ -11,6 +11,9 @@
 # Снимки /kit:visual — только локально (из-под админа)
 /.claude/docs/visual/
 
+# Файл-канал /kit:server — на сервере только на время работы, в git не нужен
+/kit-exec.php
+
 # Ядро и загрузки Битрикса (секреты — в bitrix/.settings_extra.php); материалы задачи — в upload/docs/
 /bitrix/
 /upload/*
```

- [ ] **Шаг 4: тесты проходят.** Те же файлы — `ℹ fail 0`; весь набор — `ℹ tests 312`, `ℹ pass 309`, `ℹ fail 0`, `ℹ skipped 3`.

- [ ] **Шаг 5: закрыть шаг** — `/kit:step-done 12.5`.

---

### Задача 12.6: скилл `/kit:server` — без Chrome-консоли, с файл-каналом; справка «Как включить SSH у хостинга»

**Файлы:**
- Изменить: `plugins/kit/skills/server/SKILL.md` (переписывается целиком), `plugins/kit/skills/project-init/reference/ssh.md`
- Тесты: `tests/content.test.js` (блок `server:` заменяется)

**Интерфейсы:** потребляет `kit-exec.js` (12.4), `remote-php.js --timeout` (12.3). Порядок разделов скилла: Правила → 1. Сервер и канал → 2. Канал SSH → 3. Файл-канал (3.1 собрать, 3.2 положить и доставить, 3.3 открыть и прочитать, 3.4 завершить) → Библиотека скриптов → Изменяющие скрипты.

- [ ] **Шаг 1: тест.**

```diff
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -150,46 +150,44 @@
   }
 });
 
-test('server: сначала SSH (BatchMode, remote-php, коды), иначе консоль; правила изменений', () => {
+test('server: сначала SSH (BatchMode, remote-php, --timeout, коды), иначе файл kit-exec.php; правила изменений', () => {
   const { fm, body } = skill('server');
   assert.equal(fm.name, 'server');
   assert.notEqual(fm['disable-model-invocation'], 'true');
   assert.ok(fm.description.length > 40);
   for (const s of [
     'SSH прод', 'SSH дев', 'PHP на сервере', '-o BatchMode=yes -o ConnectTimeout=15', '${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js',
-    '--bitrix', '--plain', 'Host key verification failed', 'accept-new', 'Permission denied (publickey)',
+    '--bitrix', '--plain', '--timeout', 'под `timeout` сервера', 'Host key verification failed', 'accept-new', 'Permission denied (publickey)',
     'This account is currently not available', 'результат неизвестен', 'kit-backup', '`rm` по списку не использовать',
-    'reference/ssh.md', 'NOT_CHECK_PERMISSIONS', 'Одно согласие — одно действие',
-    'php_command_line.php', 'tabs_create_mcp', 'tabs_close_mcp', 'BXCodeEditors', 'pTA.id', 'SetValue',
-    '__FPHPSubmit', '<pre>', 'без `<?php`', 'без `use`', '$dryRun', 'AskUserQuestion', 'inventory.php', 'delete-list.php',
-    'check-files.php', 'md5-check.js', '.claude/scripts/', 'не открывать, не править и не выполнять',
-    'Новый `queryN` не появился', 'повторно не нажимай', 'закрывай в любом случае',
-    'echo "<pre>"; … echo "</pre>";', "setAttribute('data-kit-old'", 'pre:not([data-kit-old])', 'не больше 10 чтений',
-    '«Выполнить» повторно не нажимай ни в каком случае',
-    'window.confirm', 'Окно подтверждает только пользователь', '«Нажал ОК»', '«Нажал Отмена»', 'остатки прежних вкладок после «+», не трогать',
-    'это не ошибка, решает сверка `ok: true`', 'MSYS_NO_PATHCONV=1', 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
+    'reference/ssh.md', 'Как включить SSH у хостинга', 'NOT_CHECK_PERMISSIONS', 'Одно согласие — одно действие', 'Окна подтверждения в браузере нет',
+    'без `<?php`', 'без `use`', '$dryRun', 'AskUserQuestion', 'inventory.php', 'delete-list.php',
+    'check-files.php', 'md5-check.js', '.claude/scripts/',
+    'MSYS_NO_PATHCONV=1', "MSYS2_ARG_CONV_EXCL='*'", 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
     '`.settings_extra.php`', 'не `cat`', 'не править `sed -i`', 'обе команды (копия и правка)', '`~` не внутри папки сайта',
     '`$allowedMasks`', '`$backupDir`', "`$base = '/'`", "`'*.php.back*'`", 'не `\'*.back*\'`', 'Стоп-лист', 'стоп-лист не править',
-    '«Копии — в …»', 'копии <папка>', 'Папки скрипт не удаляет', 'max_execution_time']) {
+    '«Копии — в …»', 'копии <папка>', 'Папки скрипт не удаляет', 'max_execution_time',
+    // файл-канал
+    'kit-exec.php', '${CLAUDE_PLUGIN_ROOT}/scripts/kit-exec.js', '$USER->IsAdmin()', 'kit: только для администратора', 'KIT-RUN', '?run=',
+    'Открытие страницы = выполнение кода', 'открывай один раз и только после согласия пользователя', 'Только режим `bitrix` и заданный адрес сервера',
+    'mcp__Claude_Browser__tabs_create', 'mcp__Claude_Browser__navigate', 'mcp__Claude_Browser__get_page_text', 'mcp__Claude_Browser__tabs_close',
+    'войти администратором', 'пароли вводит только он', 'корень **основной** папки', 'Каждый запуск заменяет прежний', '/kit-exec.php', '.gitignore',
+    'не добавляй ни в «Не выкладывать», ни в Excluded Paths', 'Deployment → Upload to…', 'PhpStorm → Remote Host', 'Удалить с сервера',
+    'с **другим** номером', 'код не выполнялся', 'Ошибка: … (строка N кода)', 'без строки `KIT-RUN`']) {
     assert.ok(body.includes(s), s);
   }
   assert.ok(!body.includes('$allowedExt'), 'расширения заменены масками');
-  assert.match(body, /setTimeout\(\(\) => b\[0\]\.click\(\)/, 'клик «Выполнить» — после возврата сниппета');
-  assert.doesNotMatch(body, /^\s*b\[0\]\.click\(\);/m, 'синхронный клик повесил бы сниппет на окне подтверждения');
-  assert.ok((body.match(/pTA\.isConnected/g) || []).length >= 2, 'редакторы — только с pTA на странице');
-  const s34 = body.slice(body.indexOf('### 3.4'), body.indexOf('### 3.5'));
-  const iClick = s34.indexOf('setTimeout');
-  const iAsk = s34.indexOf('AskUserQuestion');
-  const iRead = s34.indexOf('pre:not([data-kit-old])');
-  assert.ok(iClick >= 0 && iClick < iAsk && iAsk < iRead, 'порядок в 3.4: клик → вопрос про окно подтверждения → чтение <pre>');
-  assert.ok(!body.includes('__kitPreBefore'), 'сравнение текста до/после заменено пометкой');
+  assert.doesNotMatch(body, /консол|Командн|Chrome|BXCodeEditors|__FPHPSubmit|php_command_line|window\.confirm/, 'канала через Chrome и Командную PHP-строку больше нет');
+  const i = ['### 3.1', '### 3.2', '### 3.3', '### 3.4'].map((h) => body.indexOf(h));
+  assert.ok(i.every((v, k) => v > 0 && (k === 0 || v > i[k - 1])), 'файл-канал: собрать → доставить → открыть → завершить');
+  assert.ok(body.indexOf('kit-exec.js') < body.indexOf('mcp__Claude_Browser__navigate'), 'сначала сборка, потом открытие страницы');
   assert.ok(!fs.existsSync(path.join(PLUGIN, 'skills', 'bitrix-console')), 'старая папка скилла удалена');
   const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'ssh.md'), 'utf8');
   for (const s of ['ssh-keygen -t ed25519', 'authorized_keys', 'chmod 700', 'chmod 600', 'Доступ к shell', 'BatchMode=yes',
     'IdentityFile', '/opt/php74/bin/php', 'bitrix', 'Закрыть доступ', 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
-    'Без доступа к shell ключ не класть']) {
+    'Без доступа к shell ключ не класть', '## Как включить SSH у хостинга']) {
     assert.ok(ref.includes(s), 'ssh.md: ' + s);
   }
+  assert.doesNotMatch(ref, /Командн|канал «консоль»/, 'ssh.md: консоли больше нет');
 });
 
 test('visual: сценарий, коды, согласие на установку, вход пользователем, фон, NOTES; пример справки проходит проверку', () => {
```

- [ ] **Шаг 2: тест падает.** `node --test tests/content.test.js` — FAIL на тесте `server:` (в скилле ещё Chrome-консоль).

- [ ] **Шаг 3: тексты.** `plugins/kit/skills/server/SKILL.md` — заменить файл целиком:

````markdown
---
name: server
description: Выполнить что-то на сервере сайта — по SSH (команды оболочки и PHP, в режиме 1С-Битрикс — с ядром Битрикса), а если SSH не задан или не пустил — на сайте 1С-Битрикс через файл kit-exec.php, который Claude открывает во встроенном браузере (результат отдаётся только вошедшему администратору). Инвентаризация, проверки, сверка файлов по md5, логи, удаление файлов строгим списком. Чтение — сразу; любое изменение — только с отдельного согласия пользователя.
argument-hint: "[inventory | check-files <файлы> | delete-list | команда или код]"
---

# Работа на сервере: SSH, иначе файл kit-exec.php

## Правила

- **Только чтение** — можно сразу: `ls`, `find`, `md5sum`, `du`, `tail` и `grep` по логам, `inventory.php`, `check-files.php`, SELECT.
- **Любое изменение** — запись, удаление, перенос, `chmod`, правка файла, запросы, меняющие данные, `$dryRun = false` — только после AskUserQuestion с точной командой или кодом и явного «да». Одно согласие — одно действие. Порядок — раздел «Изменяющие скрипты». Окна подтверждения в браузере нет: согласие — только в чате.
- Код PHP — **без `<?php`** и **без `use`**: полные имена классов (`\Bitrix\Main\Loader::includeModule('iblock')`).
- Перед запуском проверь код `php -l` версией из параметра «PHP»: файл во временной папке сессии с приставкой `<?php` (для `.claude/scripts/*.php` это делает хук плагина при записи; собранный `kit-exec.php` проверяет сам `kit-exec.js`).
- Пароли не вводить: SSH — только по ключу (`BatchMode=yes` пароль не спросит); если сайт просит войти — входит пользователь.
- Секреты на сервере не выводить: `bitrix/.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env` — не `cat`; нужен ключ из них — показывай только наличие или маску.
- PHP на сервере не править `sed -i` (портит `\` неймспейсов).

## 1. Сервер и канал

Параметры — раздел «Параметры для агентов» в `.claude/CLAUDE.md`: `SSH прод` и `SSH дев` (`хост:папка сайта`), `PHP на сервере`, `Прод`, `Дев`, `Режим`.

1. Сервер — прод. Заданы оба (прод и дев), а пользователь не сказал, где выполнять, — спроси через AskUserQuestion.
2. Для сервера задан `SSH …` — **канал SSH** (раздел 2). Не задан — **файл-канал** (раздел 3), но только в режиме `bitrix` и при заданном адресе сервера («Прод» / «Дев»). Иначе остановись: выполнить на сервере негде — предложи включить SSH (справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/ssh.md`, раздел «Как включить SSH у хостинга»).
3. SSH не пустил — код 3 у `remote-php.js` или прямой `ssh` вернул 255 без вывода команды. Скажи пользователю одной строкой почему (последняя строка stderr ssh) и переходи на файл-канал, если он доступен (п. 2):
   - `Permission denied (publickey)` — ключ не подошёл;
   - `Host key verification failed` без строки `REMOTE HOST IDENTIFICATION HAS CHANGED` — новый сервер: попроси пользователя один раз войти самому (`ssh <хост>`, ответить `yes`); `StrictHostKeyChecking=no` и `accept-new` не используй;
   - в выводе есть `REMOTE HOST IDENTIFICATION HAS CHANGED` — отпечаток сервера сменился (переустановка сервера или подмена): **стоп**, на файл-канал сам не переходи. Скажи пользователю сверить отпечаток у хостера; старую запись удаляет он сам (`ssh-keygen -R <хост>` — имя из `HostName`, точную команду ssh печатает в том же предупреждении), Claude — нет. «Войти и ответить `yes`» здесь не годится;
   - `Connection timed out`, `Could not resolve hostname` — сервер недоступен;
   - `This account is currently not available` — shell не выдан (ispmanager: снят флажок «Доступ к shell»).

   Как настроить вход — справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/ssh.md`.

   **Изменяющий код — исключение:** код 3 после начала выполнения (обрыв связи, вышло время) значит «результат неизвестен». Не повторяй ни по SSH, ни через файл: проверь состояние только чтением и спроси пользователя. На файл-канал изменяющий код переходит, только если SSH отказал во входе (`Permission denied`, `Could not resolve hostname`, `Connection refused`, `Connection timed out` при подключении).

## 2. Канал SSH

Все вызовы `ssh` — с `-o BatchMode=yes -o ConnectTimeout=15`.

**Команды оболочки:**
```
ssh -o BatchMode=yes -o ConnectTimeout=15 <хост> '<команда>'
```
Команда целиком в одинарных кавычках, пути — абсолютные от папки сайта из параметра. `cd` внутри кавычек выполняется на сервере — страж kit его не блокирует. Долгой команде задай больший `timeout` Bash.

**PHP:** код — в файле: библиотечный скрипт, проектный `.claude/scripts/NN-имя.php` или временный файл в папке сессии.
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js" [--env дев] [--timeout сек] <файл>
```
Режим `bitrix` — перед кодом подключается ядро Битрикса: `DOCUMENT_ROOT` — папка сайта из параметра, домен — из «Прод»/«Дев», без агентов, статистики и почтовых событий. Общий режим — чистый PHP (`DOCUMENT_ROOT` — папка сайта из параметра). `--bitrix` и `--plain` меняют это. `<pre>` из вывода убирается, номера строк в ошибках PHP — строки твоего файла.

PHP запускается под `timeout` сервера (если он есть) на `--timeout` секунд, по умолчанию 110 — меньше лимита инструмента Bash. Долгому скрипту дай больший `--timeout` и запусти в фоне (Bash с `run_in_background`). Вышло время — код 3: результат неизвестен.

Флаги `--host/--root/--php/--url` нужны только вне kit-проекта (в kit-проекте всё берётся из параметров). В Git Bash аргумент, начинающийся с `/`, переписывается (`C:/Program Files/Git/…`, в MSYS2 — `C:/msys64/…`): флаги с путями сервера — с `MSYS_NO_PATHCONV=1` (MSYS2 — `MSYS2_ARG_CONV_EXCL='*'`) перед `node` (путь к файлу тогда `C:/…`, не `/c/…`) или из PowerShell. Команду оболочки в кавычках не начинать с `/` — `cd <папка> && …`, `exec /opt/…` или `MSYS_NO_PATHCONV=1`.

| Код | Значение | Что делать |
|---|---|---|
| 0 | выполнено | вывод — результат |
| 1 | PHP завершился с ошибкой | показать ошибку пользователю |
| 2 | SSH для сервера не задан | раздел 1, п. 2: файл-канал (режим `bitrix` и адрес сервера задан), иначе выполнить негде — включить SSH |
| 3 | нет подключения, оно оборвалось или вышло время | раздел 1, п. 3 |
| 4 | аргументы, файл, путь, переписанный Git Bash или MSYS2, или неверный параметр `SSH …` | исправить вызов; неверный параметр — показать пользователю, исправить с его согласия (`хост:/абсолютная/папка`, порт — только через `~/.ssh/config`) |

Сверка md5 — код печатает `md5-check.js`, выполняет `remote-php.js`:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/md5-check.js" <файлы от корня проекта…> > "<временная папка сессии>/check-files.php"
node "${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js" "<временная папка сессии>/check-files.php"
```

Отличия от файл-канала: в CLI нет авторизованного `$USER` (в файл-канале код работает от администратора), проверки прав модулей снимает `NOT_CHECK_PERMISSIONS`; файлы, созданные через SSH, принадлежат пользователю SSH (BitrixVM — входить под `bitrix`, не `root`); на сайте в windows-1251 вывод перекодируется в UTF-8, а русские строки внутри кода — нет.

## 3. Файл-канал — `kit-exec.php` для Битрикса без SSH

Только режим `bitrix` и заданный адрес сервера. Claude собирает файл `kit-exec.php` с кодом одной задачи, файл попадает в корень сайта, Claude открывает его во встроенном браузере и читает вывод. Файл отдаёт результат только вошедшему администратору (проверка `$USER->IsAdmin()`); всем остальным — 403 и одна строка. Ничего из запроса он не выполняет: код вшит при сборке, а номер запуска в адресе (`?run=…`) только сверяется с номером файла.

- **Открытие страницы = выполнение кода.** Страницу с изменяющим кодом открывай один раз и только после согласия пользователя; повторно — ни при каком результате. Нет ответа или обрыв — результат неизвестен: не открывай адрес снова, проверь состояние чтением (новым запуском) и спроси пользователя.
- Пароли не вводи: если сайт просит войти — входит пользователь, в этой же вкладке браузера.
- Нет встроенного браузера Claude (инструменты `mcp__Claude_Browser__*`) — скажи пользователю: файл-канал без него не работает; выход — включить SSH (справка `reference/ssh.md`).

### 3.1 Собрать файл

1. Код задачи — в файл во временной папке сессии (библиотечный скрипт и проектный `.claude/scripts/NN-имя.php` — как есть; без `<?php`, без `use`). Код печатает результат как обычно: `echo`; `<pre>` из вывода убираются.
2. Новый номер запуска на каждый запуск:
   ```
   node -e "console.log(require('crypto').randomBytes(4).toString('hex'))"
   ```
3. Сборка:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kit-exec.js" "<временная папка сессии>/task.php" --run <номер> --out "<временная папка сессии>/kit-exec.php" [--env дев]
   ```
   Скрипт проверяет `php -l` и печатает строку `Адрес: <сайт>/kit-exec.php?run=<номер>` — её открывать в п. 3.3. Коды: 0 — собрано; 1 — ошибка в коде (номера строк — строки твоего файла; покажи пользователю); 2 — не режим `bitrix` или нет адреса сервера: файл-канал недоступен, включить SSH; 4 — аргументы, файл, номер запуска.

### 3.2 Положить и доставить

1. Одной операцией скопируй `kit-exec.php` из папки сессии в корень **основной** папки проекта: `<корень проекта>/kit-exec.php`. Сессия в git worktree (`.claude/worktrees/<имя>`) — корень основной папки выше: из worktree файл на сервер не уедет. Каждый запуск заменяет прежний `kit-exec.php`.
2. Строки `/kit-exec.php` нет в `.gitignore` — предложи дописать (с согласия): git-keeper и secret-scan файл всё равно не пропустят, но без строки он виден в `git status`.
3. Доставка на сервер:
   - в «Выкладке» `PhpStorm Always` (для дева — «вручную; дев — PhpStorm Always») — файл уезжает сам, пока PhpStorm открыт с проектом; проверка — п. 3.3;
   - иначе — попроси пользователя одной строкой: «Залей `kit-exec.php` на <прод|дев> (PhpStorm → правый клик по файлу → Deployment → Upload to…)».
   - Путь `kit-exec.php` не добавляй ни в «Не выкладывать», ни в Excluded Paths PhpStorm: файл не уедет.
4. Локальную копию удали после запуска (при ручной заливке — после того, как пользователь залил): при автозаливке заливается каждое сохранение, удаление локального файла сервер не трогает.

### 3.3 Открыть и прочитать

Инструменты встроенного браузера Claude: `mcp__Claude_Browser__tabs_create` (своя вкладка), `mcp__Claude_Browser__navigate`, `mcp__Claude_Browser__get_page_text`, в конце `mcp__Claude_Browser__tabs_close`. Вкладки пользователя не трогай.

1. Открой адрес из вывода `kit-exec.js` в своей вкладке, прочитай текст страницы.
2. Разбор ответа:
   - первая строка `KIT-RUN <твой номер>`, дальше нет строки «код не выполнялся» — код выполнен, остальное — результат;
   - `kit: только для администратора` — попроси пользователя войти администратором на сайте в этой вкладке (пароли вводит только он), дождись ответа и открой адрес снова; вход остаётся на время сеанса;
   - первая строка `KIT-RUN` с **другим** номером — на сервере ещё прежний файл, новый не залит: код не выполнялся; подожди 5–10 секунд и открой адрес снова, всего до 6 раз, затем попроси пользователя проверить заливку;
   - обычная страница сайта или 404 — файла на сервере нет: то же ожидание доставки;
   - в выводе `Ошибка: … (строка N кода)` или `Фатальная ошибка: …` — показать пользователю; N — строка твоего файла с кодом.
3. Только чтение можно повторять; изменяющий код — раздел «Правила» этого раздела: одно открытие.

### 3.4 Завершить

1. Закрой свою вкладку браузера.
2. Сообщи пользователю итог (длинный вывод — выжимкой, полный — во временную папку сессии).
3. Работа на сервере закончена — предложи удалить `kit-exec.php` с сервера (PhpStorm → Remote Host → удалить файл): блок DEPLOY «Удалить с сервера» в следующем `/kit:step-done`. Пока файл лежит, он отдаёт результат только вошедшему администратору. Когда пользователь удалил файл, открой `<адрес>/kit-exec.php` — файла быть не должно (404 или страница сайта, без строки `KIT-RUN`).
4. Факты, которые стоит сохранить (ID, результаты проверок, что удалено), — в NOTES / DEPLOY следующего `/kit:step-done`.

Отличия от SSH: код работает внутри веб-запроса — `$USER` администратор со своими правами, `SITE_ID` — как у страницы в корне сайта; предупреждения и notice не видны; время ограничено `max_execution_time` и таймаутом веб-сервера; файлы и копии `delete-list.php` (`~/kit-backup`) принадлежат пользователю веб-сервера. Сам `kit-exec.php` через `delete-list.php` не удалить (он и есть канал) — его удаляет пользователь.

## Библиотека скриптов

`${CLAUDE_PLUGIN_ROOT}/skills/server/scripts/` — работают в обоих каналах:
- `inventory.php` — окружение, сайты и шаблоны, сторонние модули, инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы `b_file` по модулям и типам. Только чтение.
- `delete-list.php` — шаблон удаления строгим списком: `$dryRun` (удаляет только при строгом `false`), `$base` (папка от корня сайта; `'/'` — сам корень), `$allowedMasks` (маски имени файла: `*`, `?`, регистр латиницы не важен), `$files`, `$removeEmptyDirs`, `$backupDir` (по умолчанию `~/kit-backup`). Каждый путь через `realpath` должен лежать внутри `$base`, быть файлом, а не симлинком, и подходить под маску. Перед удалением файл копируется в `$backupDir/<ГГГГММДД-ЧЧММСС>/<путь от корня сайта>` вне папки сайта со сверкой размера и md5; копия не удалась — файл остаётся. Места под копии меньше, чем их размер плюс 100 МБ, — стоп. В корне сайта — только имена файлов без папок и без `$removeEmptyDirs`. Папки скрипт не удаляет вообще (только пустые внутри базы при `$removeEmptyDirs`). Стоп-лист в скрипте не удаляется никогда: в любой папке — `.htaccess`, `.access.php`, `.settings.php`, `dbconn.php`, `license_key.php`, `.env` и т. п.; в корне — ещё `index.php`, `urlrewrite.php`, `404.php`, `.section.php`, меню, `robots.txt`, `sitemap*.xml`, файлы подтверждения Яндекса и Google. Ошибка в настройках — «стоп», не удалено ничего. **Изменяет сервер.**
- `check-files.php` — сверка файлов с локальными по md5. Готовый код печатает
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/md5-check.js" <файлы от корня проекта…>
  ```
  Только чтение.

Проектная копия скрипта (с конкретными путями, ID и т. п.) — в `.claude/scripts/NN-имя.php` проекта: в git есть, на сервер не уезжает (исключение деплоя). NN — следующий номер по порядку.

## Изменяющие скрипты

1. Удаление файлов — шаблоном `delete-list.php`, в том числе одиночных файлов в корне сайта: `$base = '/'`, в `$files` — только имена (`'debug.php'`). `rm` по списку не использовать. Маски — самые узкие: имя целиком (`'debug.php'`) или хвост (`'*.php.back*'` — бэкапы апдейтера вида `_имя.php.back2.9.2`); не `'*.back*'` — под неё попадёт `jquery.backstretch.js`; `'*'` и `'*.*'` скрипт не примет. Скрипт с `$dryRun = true` → выполнить → показать пользователю, что будет удалено и куда лягут копии.
   - «стоп» в выводе — не удалено ничего: исправь список или маски. Файл из стоп-листа и папки этим скриптом не удалять, стоп-лист не править — скажи пользователю, удаляет он сам.
   - Папка копий — `~/kit-backup` пользователя, от которого работает PHP (в файл-канале — пользователь веб-сервера). Скрипт остановился на ней (домашняя папка не определилась, папка внутри сайта, её не создать, не хватит места) — спроси пользователя, куда класть копии вне папки сайта, и задай `$backupDir` абсолютным путём.
   - Крупные файлы (архивы в `/bitrix/backup/` и т. п.) — копия займёт столько же места, а в файл-канале долгая копия упрётся в `max_execution_time`: такие удаляй по SSH или предложи пользователю удалить самому.
2. AskUserQuestion: «Выполнить по-настоящему?» — только явное «да».
3. Тот же код с `$dryRun = false` → выполнить → показать результат и путь к копиям (строка «Копии — в …»). В файл-канале это второй файл с новым номером запуска (и одно открытие страницы).
4. Проверить снаружи (например, удалённые пути отдают 404) и записать в план выкладки: «Удалить с сервера» → `✅ ДАТА, скрипт, копии <папка>`. Вернуть файл — копированием из папки копий обратно (SSH — `cp -p`; в файл-канале — `copy()` в PHP), как любое изменение — с согласия. Копии скрипт не удаляет: старые убирает пользователь.
5. Правка файла на сервере (канал SSH) — сначала копия в `~/kit-backup/<ГГГГММДД-ЧЧММСС>/<путь от корня сайта>`: `mkdir -p` папки копии, затем `cp -p`. Копия — вне папки сайта: `.php.back` рядом с оригиналом веб-сервер отдал бы как текст. Заранее (это чтение) проверь, что `~` не внутри папки сайта: `echo "$HOME"` не начинается с папки сайта; иначе спроси пользователя, куда класть копию. В AskUserQuestion — обе команды (копия и правка); копия — после «да», перед правкой. Путь копии — в отчёт.
6. Любое другое изменение — та же схема: точная команда или код → AskUserQuestion → выполнить → проверить (md5, ответ сайта) → записать в NOTES следующего `/kit:step-done`.
````

`plugins/kit/skills/project-init/reference/ssh.md` (дифф от `7047cf0`):

````diff
--- a/plugins/kit/skills/project-init/reference/ssh.md
+++ b/plugins/kit/skills/project-init/reference/ssh.md
@@ -2,6 +2,16 @@
 
 Нужен для `/kit:server` (канал SSH) и SSH-шага `/kit:project-init`. Claude подключается только по ключу и без вопросов (`ssh -o BatchMode=yes`): пароль он не вводит, отпечаток нового сервера не принимает. Всё ниже делает пользователь; Claude подсказывает и проверяет.
 
+## Как включить SSH у хостинга
+
+Без SSH `/kit:server` работает только на сайтах 1С-Битрикс (файл `kit-exec.php`, который Claude открывает во встроенном браузере); на остальных сайтах выполнить на сервере негде. Включить SSH стоит и на Битриксе: по SSH не нужны файл на сервере и вход в админку, доступны команды оболочки, а время выполнения не ограничено временем веб-запроса.
+
+- **ISPmanager:** «Учётные записи → Пользователи» → пользователь → «Доступ» → флажок «Доступ к shell» (раздел 2).
+- **BitrixVM:** SSH уже включён; входить пользователем `bitrix`, не `root`.
+- **Другие хостинги:** в панели — раздел «SSH», «Shell» или «Доступ по SSH» (название зависит от хостера); на некоторых тарифах SSH выключен и включается в панели или по заявке в поддержку.
+- Хостер SSH не даёт — оставь параметры `SSH прод` / `SSH дев` как `—`: на Битриксе останется файл-канал, на остальных сайтах выполнить на сервере негде.
+- Включили — дальше разделы 1–4 (ключ, `authorized_keys`, `~/.ssh/config`, первый вход) и параметры проекта (раздел 5).
+
 ## 1. Ключ на своём компьютере (PowerShell)
 
 ```
@@ -23,7 +33,7 @@
   ```
   Без консоли — «Менеджер файлов»: создать `.ssh/authorized_keys`, вставить строку, «Атрибуты» — 700 для папки, 600 для файла. Применение шаблона тарифа ко всем пользователям может снять флажок «Доступ к shell» — тогда включить снова.
 - **BitrixVM:** ключ — пользователю `bitrix` (`/home/bitrix/.ssh/authorized_keys`), не `root`: файлы, созданные под `root`, веб-сервер потом не сможет менять.
-- Shell-клиента в панели нет, а «Доступ к shell» включён — ключ можно положить скриптом в Командной PHP-строке (`/kit:server`, канал «консоль», с согласия пользователя; права 700/600). Без доступа к shell ключ не класть: команды не заработают, а SSH-туннели откроются.
+- Shell-клиента в панели нет, а «Доступ к shell» включён — ключ можно положить скриптом через `/kit:server` (файл-канал на Битриксе, с согласия пользователя; права 700/600). Без доступа к shell ключ не класть: команды не заработают, а SSH-туннели откроются.
 
 ## 3. Короткое имя в `~/.ssh/config`
 
@@ -60,4 +70,4 @@
 
 ## 6. Закрыть доступ
 
-Сначала, пока shell ещё есть, удалить строку ключа из `~/.ssh/authorized_keys` (`sed -i '/claude-code@<проект>/d' ~/.ssh/authorized_keys` на сервере или в Shell-клиенте), потом снять флажок «Доступ к shell». Одного флажка мало: без shell пропадут консоль, команды и SFTP, но SSH-туннели по ключу останутся — через них видны службы сервера (например MySQL).
+Сначала, пока shell ещё есть, удалить строку ключа из `~/.ssh/authorized_keys` (`sed -i '/claude-code@<проект>/d' ~/.ssh/authorized_keys` на сервере или в Shell-клиенте), потом снять флажок «Доступ к shell». Одного флажка мало: без shell пропадут Shell-клиент, команды и SFTP, но SSH-туннели по ключу останутся — через них видны службы сервера (например MySQL).
````

- [ ] **Шаг 4: тест проходит.** `node --test tests/content.test.js` — `ℹ fail 0`; весь набор — `ℹ tests 312`, `ℹ pass 309`, `ℹ fail 0`, `ℹ skipped 3`.

- [ ] **Шаг 5: закрыть шаг** — `/kit:step-done 12.6`.

---

### Задача 12.7: `project-init`, шаблоны, справки, комментарии (К14)

**Файлы:**
- Изменить: `plugins/kit/skills/project-init/SKILL.md`, `templates/CLAUDE.md`, `templates/deploy-prod.md`, `templates/gitignore-bitrix`, `templates/gitignore-general`, `reference/bitrix.md`, `reference/phpstorm.md`, `plugins/kit/skills/deploy-list/SKILL.md`, `plugins/kit/scripts/md5-check.js`, `plugins/kit/scripts/php-lint.js`, `plugins/kit/skills/server/scripts/{check-files,delete-list,inventory}.php` (комментарии), `plugins/kit/.claude-plugin/plugin.json` (описание)
- Тесты: `tests/content.test.js`

**Интерфейсы:** SSH-шаг `project-init` — поиск псевдонимов с учётом `Include` (К14) и пункт 5 «SSH нет» по режимам; шаблон `CLAUDE.md` — три варианта «Работа на сервере»: SSH / файл `kit-exec.php` / выполнить негде — включить SSH.

- [ ] **Шаг 1: тесты.**

```diff
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -125,7 +125,13 @@
     assert.ok(!line.includes('с `-o`'), 'строки ~/.ssh/config — целиком, без -o: ' + line);
   }
   const tpl = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8');
-  assert.ok(tpl.includes('| SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; справка reference/ssh.md)'), 'шаблон: третий вариант «Работа на сервере»');
+  assert.ok(tpl.includes('| SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; включить SSH — справка reference/ssh.md)'), 'шаблон: третий вариант «Работа на сервере»');
+  assert.ok(tpl.includes('SSH нет — `/kit:server` работает через файл `kit-exec.php`'), 'шаблон: второй вариант — файл-канал');
+  assert.doesNotMatch(tpl + body, /Командн|канал «консоль»|консоль — запасной/, 'консоли больше нет');
+  for (const s of ['`^\\s*Include\\s+\\S`', 'вложенные `Include` — до глубины 2', 'файлы из `Include` — только ради этих строк',
+    '5. «SSH нет»: режим bitrix с адресом', 'строка `/kit-exec.php` попадёт в `.gitignore`', 'Как включить SSH у хостинга']) {
+    assert.ok(body.includes(s), s);
+  }
   const q3 = /3\. Исключения деплоя[^\n]*/.exec(body)[0];
   assert.deepEqual(q3.split('. В тексте вопроса')[0].match(/«[^»]*»/g),['«`.gitignore`»', '«`local/modules`»', '«Больше ничего»'], 'варианты вопроса про исключения: ' + q3);
   const i47 = body.indexOf('### 4.7 Переезд');
@@ -221,6 +227,19 @@
     }
   };
   walk(PLUGIN);
+  assert.deepEqual(hits, []);
+});
+
+test('в плагине нет канала через Командную PHP-строку и Claude in Chrome (удалён в 2.4.0)', () => {
+  const hits = [];
+  const walk = (dir) => {
+    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
+      const p = path.join(dir, e.name);
+      if (e.isDirectory()) walk(p);
+      else if (/Командн\S* PHP-строк|php_command_line|BXCodeEditors|__FPHPSubmit|claude-in-chrome|канал «консоль»/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(PLUGIN, p));
+    }
+  };
+  walk(PLUGIN);
   assert.deepEqual(hits, []);
 });
 
```

- [ ] **Шаг 2: тесты падают.** `node --test tests/content.test.js` — FAIL (тексты `project-init`, шаблона, «нет старого канала» в плагине).

- [ ] **Шаг 3: тексты.**

````diff
--- a/plugins/kit/skills/project-init/SKILL.md
+++ b/plugins/kit/skills/project-init/SKILL.md
@@ -34,7 +34,7 @@
 Второй вызов — не больше 4 вопросов, в каждом 2–4 варианта:
 1. Адрес прода: `https://<домен из rootFolder>` (Рекомендую) и `https://www.<домен>`; догадки нет — «Прода пока нет» / «Введу адрес в «Другое»».
 2. Задача: «Без задачи» / «Есть — номер и название в «Другое»».
-3. Исключения деплоя сверх обязательных (мультивыбор, 3 варианта): «`.gitignore`», «`local/modules`», «Больше ничего». В тексте вопроса: `.idea`, `.git` и `.claude` исключаются всегда — `.claude` закрывает правила, документы `.claude/docs` (журнал, планы, снимки `/kit:visual` из-под админа), скрипты консоли, `settings.local.json` и `.claude/worktrees` (git worktree Claude Code — полная копия сайта); уже исключённые в `deployment.xml` — перечисли. Выбранное идёт в «Не выкладывать» и в `--also` для `phpstorm-exclude.js`.
+3. Исключения деплоя сверх обязательных (мультивыбор, 3 варианта): «`.gitignore`», «`local/modules`», «Больше ничего». В тексте вопроса: `.idea`, `.git` и `.claude` исключаются всегда — `.claude` закрывает правила, документы `.claude/docs` (журнал, планы, снимки `/kit:visual` из-под админа), скрипты `/kit:server`, `settings.local.json` и `.claude/worktrees` (git worktree Claude Code — полная копия сайта); уже исключённые в `deployment.xml` — перечисли. Выбранное идёт в «Не выкладывать» и в `--also` для `phpstorm-exclude.js`.
 4. Только режим «bitrix» и если в `watcherTasks.xml` есть включённые вотчеры: оставить / убрать (вотчеры срабатывают и на правки Claude — см. справку phpstorm.md).
 
 Адрес дева (при «дев + прод») — третьим вызовом.
@@ -51,7 +51,7 @@
 
 Для каждого сервера с адресом: прод; дев — при «дев + прод». Справка — `reference/ssh.md`.
 
-1. Псевдонимы из `~/.ssh/config` — только строки `Host`, `HostName`, `User`: Grep `-i` по `^\s*(Host|HostName|User)(\s*=\s*|\s+)\S` — строки целиком, без `-o` (в этих строках секретов нет; `IdentityFile` и прочее не попадают); шаблоны с `*`, `?`, `!` в варианты не брать; ключи и другие файлы `~/.ssh` не открывай. Вопрос через AskUserQuestion, по вопросу на сервер, до 3 псевдонимов: в существующем разделе параметров `SSH …` уже задан — первым он с «(Рекомендую)» (решение пользователя важнее догадки); псевдоним, у которого `HostName` совпал с доменом сервера, — следом с пометкой «HostName совпал с доменом» (параметра нет — первым с «(Рекомендую)»); последний вариант — «SSH нет»; `user@host` — через «Другое».
+1. Псевдонимы из `~/.ssh/config` и файлов, которые он подключает строками `Include` (сначала Grep `-i` по `^\s*Include\s+\S` — строки целиком, в них только пути: относительный путь — от `~/.ssh/`, `~` — домашняя папка, маски — через Glob; вложенные `Include` — до глубины 2) — только строки `Host`, `HostName`, `User`: Grep `-i` по `^\s*(Host|HostName|User)(\s*=\s*|\s+)\S` — строки целиком, без `-o` (в этих строках секретов нет; `IdentityFile` и прочее не попадают); шаблоны с `*`, `?`, `!` в варианты не брать; ключи и другие файлы `~/.ssh` не открывай (файлы из `Include` — только ради этих строк). Вопрос через AskUserQuestion, по вопросу на сервер, до 3 псевдонимов: в существующем разделе параметров `SSH …` уже задан — первым он с «(Рекомендую)» (решение пользователя важнее догадки); псевдоним, у которого `HostName` совпал с доменом сервера, — следом с пометкой «HostName совпал с доменом» (параметра нет — первым с «(Рекомендую)»); последний вариант — «SSH нет»; `user@host` — через «Другое».
 2. Разведка (только чтение, одно подключение):
    ```
    node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-probe.js" <хост> --url <адрес сервера> [--php X.Y]
@@ -62,6 +62,7 @@
    - Код 4 — хост недопустим (пробел, `-` в начале, порт): переспроси; порт — только через `~/.ssh/config`.
 3. Код 0: папка сайта — единственная строка `Папка: … [bitrix]` (режим bitrix; в общем режиме — единственная найденная). Несколько или ни одной — вопрос: найденные — вариантами, свой путь — через «Другое». PHP — строка с `[совпадает]` → «PHP на сервере»; такой нет или версия сайта неизвестна — вопрос со списком найденных версий (выбранная версия идёт и в параметр «PHP», если site-probe версию не нашёл).
 4. Параметры: `SSH прод: <хост>:<папка>` (и `SSH дев`), `PHP на сервере: <путь>`; SSH нет — `—`. Уже заданные значения меняй только с согласия.
+5. «SSH нет»: режим bitrix с адресом — скажи пользователю, что `/kit:server` будет работать через файл-канал `kit-exec.php` (при первом запуске он войдёт администратором во встроенном браузере Claude), а строка `/kit-exec.php` попадёт в `.gitignore`; иначе выполнить на сервере будет негде — покажи раздел «Как включить SSH у хостинга» справки `reference/ssh.md`.
 
 ## 3. План на согласие
 
@@ -120,7 +121,7 @@
 
 Параметр «PHP» — путь `C:\OSPanel\modules\PHP-X.Y\php.exe` по версии из `site-probe.js` или названной пользователем; PHP на сервере нет — `—`.
 
-Параметры «SSH прод», «SSH дев», «PHP на сервере» — по разделу «SSH» (после site-probe); SSH нет — `—`: в режиме bitrix при заданном адресе `/kit:server` работает через Командную PHP-строку; в общем режиме выполнить на сервере негде.
+Параметры «SSH прод», «SSH дев», «PHP на сервере» — по разделу «SSH» (после site-probe); SSH нет — `—`: в режиме bitrix при заданном адресе `/kit:server` работает через файл-канал `kit-exec.php` (строка `/kit-exec.php` — в `.gitignore`, п. 4.1); в общем режиме выполнить на сервере негде — включить SSH (справка `reference/ssh.md`, «Как включить SSH у хостинга»).
 
 Параметр «Выкладка» — по ответу на вопрос 4 (с учётом уточнения из раздела 2):
 
````

```diff
--- a/plugins/kit/skills/project-init/templates/CLAUDE.md
+++ b/plugins/kit/skills/project-init/templates/CLAUDE.md
@@ -13,7 +13,7 @@
 - **Локально:** `{{ПАПКА_ПРОЕКТА}}`. {{Что лежит в проекте и чего нет (ядро, модули)}}. Windows, PowerShell.
 - **Прод:** {{ПРОД}}, PHP {{ВЕРСИЯ_PHP}}.
 - {{**Дев:** АДРЕС, PHP ВЕРСИЯ. | Дева нет — проверяем на проде.}}
-- **Работа на сервере:** {{SSH — `ssh ХОСТ`, папка сайта `ПАПКА`, PHP CLI `PHP_НА_СЕРВЕРЕ`; `/kit:server` работает по SSH, консоль — запасной путь (в режиме bitrix). | SSH нет — `/kit:server` работает через Командную PHP-строку в Chrome. | SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; справка reference/ssh.md)}}
+- **Работа на сервере:** {{SSH — `ssh ХОСТ`, папка сайта `ПАПКА`, PHP CLI `PHP_НА_СЕРВЕРЕ`; `/kit:server` работает по SSH, файл `kit-exec.php` — запасной путь (в режиме bitrix). | SSH нет — `/kit:server` работает через файл `kit-exec.php` (режим bitrix; результат Claude открывает во встроенном браузере, вход администратором — пользователь). | SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; включить SSH — справка reference/ssh.md)}}
 - **Выкладка:** {{PhpStorm, сервер `СЕРВЕР`, автозаливка Always — любое сохранение файла в проекте, в том числе правка Claude, сразу уходит на сервер. | на прод — вручную, списком изменённых файлов (`/kit:deploy-list`); на дев — PhpStorm, сервер `СЕРВЕР`, автозаливка Always: любое сохранение сразу уходит на дев. | вручную, списком изменённых файлов: `/kit:deploy-list` показывает, что изменилось с последней выкладки.}}
   - Не выкладываются: {{ИСКЛЮЧЕНИЯ}}.
   - `.claude/` (правила, документы `.claude/docs`, скрипты) из выкладки исключена: Excluded Paths PhpStorm дописывает хук kit, для ручной выкладки — «Не выкладывать»; на случай ручной заливки закрыта `.htaccess` (`Require all denied`); проверка снаружи — `check-closed` ({{ДАТА_ПРОВЕРКИ | ещё не проверено}}).
```

```diff
--- a/plugins/kit/skills/project-init/templates/deploy-prod.md
+++ b/plugins/kit/skills/project-init/templates/deploy-prod.md
@@ -15,7 +15,7 @@
 
 ## Удалить с сервера
 
-Удалять через Remote Host в PhpStorm или через `/kit:server` (SSH, иначе Командная PHP-строка; шаблон `delete-list.php`: с согласия пользователя, строгий список, сначала сухой прогон).
+Удалять через Remote Host в PhpStorm или через `/kit:server` (SSH, иначе файл-канал `kit-exec.php`; шаблон `delete-list.php`: с согласия пользователя, строгий список, сначала сухой прогон).
 
 | Путь | Почему | Удалён |
 |---|---|---|
```

```diff
--- a/plugins/kit/skills/project-init/templates/gitignore-bitrix
+++ b/plugins/kit/skills/project-init/templates/gitignore-bitrix
@@ -1,4 +1,4 @@
-# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты консоли
+# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты `/kit:server`
 /.idea/
 /.claude/*
 !/.claude/CLAUDE.md
```

```diff
--- a/plugins/kit/skills/project-init/templates/gitignore-general
+++ b/plugins/kit/skills/project-init/templates/gitignore-general
@@ -1,4 +1,4 @@
-# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты консоли
+# Служебное IDE и Claude Code: в git только правила, .htaccess, документы и скрипты `/kit:server`
 /.idea/
 /.claude/*
 !/.claude/CLAUDE.md
```

```diff
--- a/plugins/kit/skills/project-init/reference/bitrix.md
+++ b/plugins/kit/skills/project-init/reference/bitrix.md
@@ -25,4 +25,4 @@
 
 ## Работа на сервере
 
-Проверки и разовые скрипты на сервере — `/kit:server`: сначала SSH, если не задан или не пустил — Командная PHP-строка; только чтение — сразу, изменения — с согласия пользователя (удаление — после сухого прогона).
+Проверки и разовые скрипты на сервере — `/kit:server`: сначала SSH, если не задан или не пустил — файл-канал `kit-exec.php` (только Битрикс); нет ни того ни другого — включить SSH (`reference/ssh.md`); только чтение — сразу, изменения — с согласия пользователя (удаление — после сухого прогона).
```

```diff
--- a/plugins/kit/skills/project-init/reference/phpstorm.md
+++ b/plugins/kit/skills/project-init/reference/phpstorm.md
@@ -20,7 +20,7 @@
 
 Хук SessionStart плагина kit в kit-проекте при каждом старте сессии сверяет `.idea/deployment.xml` и дописывает недостающее каждому серверу, сопоставленному с корнем проекта (`local="$PROJECT_DIR$"`; сервер с подпапкой, например `dist`, не трогается). Только добавляет — ничего не удаляет и не меняет; сообщает строкой `[kit] Исключения PhpStorm: добавлено «ftp» — …` (её видят и пользователь, и Claude), а если записать не вышло или файл не разобран — просит добавить руками. Из git worktree (`.claude/worktrees/<имя>`) правит `.idea` основной папки. Руками: `node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" [--also a,b]` из корня проекта, сверка — `--check` (0 — всё на месте, 1 — не хватает, 2 — файл не разобран).
 
-- Всегда: `.idea`, `.git`, `.claude` — вся служебная папка: правила `CLAUDE.md`, документы `.claude/docs` (журнал, план выкладки, `work/`, `archive/`, снимки `visual/` из-под админа), скрипты консоли `.claude/scripts`, `settings.local.json` и `.claude/worktrees` — git worktree Claude Code (десктоп) с полной копией сайта.
+- Всегда: `.idea`, `.git`, `.claude` — вся служебная папка: правила `CLAUDE.md`, документы `.claude/docs` (журнал, план выкладки, `work/`, `archive/`, снимки `visual/` из-под админа), скрипты `/kit:server` `.claude/scripts`, `settings.local.json` и `.claude/worktrees` — git worktree Claude Code (десктоп) с полной копией сайта.
 - Проект ещё не переехал (журнал в `docs/`) — и `docs`.
 - Простые пути из «Не выкладывать» (`.gitignore`, `local/modules` — если модули лежат в проекте только для чтения, `bitrix`…); маски (`*.back*`) и `(кроме …)` PhpStorm не понимает — их учитывает только `/kit:deploy-list`.
 - Если PhpStorm открыт и правку файла не подхватил (в Excluded Paths новых строк нет) — File → Reload All from Disk или перезапуск PhpStorm.
```

````diff
--- a/plugins/kit/skills/deploy-list/SKILL.md
+++ b/plugins/kit/skills/deploy-list/SKILL.md
@@ -12,5 +12,5 @@
    ```
 2. Покажи пользователю вывод как есть: база и откуда она взята, «Залить», «Удалить с сервера», незакоммиченное.
 3. Есть незакоммиченные изменения — скажи, что они в список не вошли: сначала шаг нужно закрыть (`/kit:step-done`).
-4. Удаления на сервере делает пользователь (PhpStorm → Remote Host) или Claude через `/kit:server` (SSH, иначе Командная PHP-строка; шаблон `delete-list.php` — только с согласия пользователя и после сухого прогона).
+4. Удаления на сервере делает пользователь (PhpStorm → Remote Host) или Claude через `/kit:server` (SSH, иначе файл-канал `kit-exec.php`; шаблон `delete-list.php` — только с согласия пользователя и после сухого прогона).
 5. Когда пользователь сообщит, что выложил, — запиши это через `/kit:step-done` блоком DEPLOY: `Файлы` (что залито), `Коммит` (HEAD на момент выкладки), `Удалить` (что осталось удалить на сервере), `Проверка` (что проверено на сервере).
````

```diff
--- a/plugins/kit/scripts/md5-check.js
+++ b/plugins/kit/scripts/md5-check.js
@@ -1,6 +1,6 @@
 #!/usr/bin/env node
 'use strict';
-// Печатает код сверки md5 файлов на сервере с локальными — для /kit:server (remote-php.js или Командная PHP-строка).
+// Печатает код сверки md5 файлов на сервере с локальными — для /kit:server (remote-php.js или файл-канал kit-exec.php).
 // Запуск в корне проекта: node md5-check.js <файлы…> (пути от корня проекта = от корня сайта).
 // Шаблон — skills/server/scripts/check-files.php, список вставляется в строку «$files = []; // KIT:FILES».
 const fs = require('fs');
```

```diff
--- a/plugins/kit/scripts/php-lint.js
+++ b/plugins/kit/scripts/php-lint.js
@@ -2,7 +2,7 @@
 'use strict';
 // Хук PostToolUse (Write|Edit|MultiEdit): php -l версией PHP из параметров проекта («PHP»).
 // Параметр «PHP» принимается, только если это абсолютный путь к существующему php.exe; иначе хук молчит.
-// Скрипты Командной PHP-строки лежат без <?php — их проверяем через временный файл в os.tmpdir()
+// Скрипты /kit:server лежат без <?php — их проверяем через временный файл в os.tmpdir()
 // с приставкой «<?php\n»: файл вне папки проекта, на автозаливку не влияет.
 // Ошибка синтаксиса → stderr и код 2 (Claude видит сообщение). Иначе и при любой внутренней ошибке — тихо, код 0.
 const fs = require('fs');
```

```diff
--- a/plugins/kit/skills/server/scripts/check-files.php
+++ b/plugins/kit/skills/server/scripts/check-files.php
@@ -1,6 +1,6 @@
 // Сверка файлов на сервере с локальными по md5. Только чтение.
 // Список файлов вставляет `node md5-check.js <файлы…>` (плагин kit); как есть не запускать — список пуст.
-// Запуск: /kit:server (SSH — remote-php.js, иначе Командная PHP-строка). Без открывающего тега PHP.
+// Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.
 
 $files = []; // KIT:FILES — 'путь от корня сайта' => ['md5 как есть', 'md5 с LF']
 
```

```diff
--- a/plugins/kit/skills/server/scripts/delete-list.php
+++ b/plugins/kit/skills/server/scripts/delete-list.php
@@ -3,7 +3,7 @@
 // Удаляет только файлы из $files внутри $base, имя которых подходит под маску из $allowedMasks; путь проверяется через realpath, симлинки не трогает.
 // Перед удалением файл копируется в $backupDir/<ГГГГММДД-ЧЧММСС>/<путь от корня сайта> (вне папки сайта); копия не удалась — файл остаётся.
 // $base = '/' (корень сайта) — только имена файлов без папок и без $removeEmptyDirs. Имена из стоп-листа не удаляются никогда.
-// Ошибка в настройках — «стоп», не удаляется ничего. Запуск: /kit:server (SSH — remote-php.js, иначе Командная PHP-строка). Без открывающего тега PHP.
+// Ошибка в настройках — «стоп», не удаляется ничего. Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.
 
 $dryRun = true;
 $base = '/local/templates/ШАБЛОН/css';
```

```diff
--- a/plugins/kit/skills/server/scripts/inventory.php
+++ b/plugins/kit/skills/server/scripts/inventory.php
@@ -1,6 +1,6 @@
 // Инвентаризация сайта на 1С-Битрикс: окружение, сайты и шаблоны, сторонние модули,
 // инфоблоки со свойствами, пользовательские поля, HL-блоки, файлы b_file.
-// Только чтение, ничего не меняет. Запуск: /kit:server (SSH — remote-php.js, иначе Командная PHP-строка). Без открывающего тега PHP.
+// Только чтение, ничего не меняет. Запуск: /kit:server (SSH — remote-php.js, иначе файл-канал kit-exec.php). Без открывающего тега PHP.
 
 global $DB;
 \Bitrix\Main\Loader::includeModule('iblock');
```

```diff
--- a/plugins/kit/.claude-plugin/plugin.json
+++ b/plugins/kit/.claude-plugin/plugin.json
@@ -1,7 +1,7 @@
 {
   "name": "kit",
   "version": "2.3.0",
-  "description": "Каркас работы над проектами: документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку; снимки публичной части «до/после» и их сравнение.",
+  "description": "Каркас работы над проектами: документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH, а на Битриксе без SSH — через файл kit-exec.php; снимки публичной части «до/после» и их сравнение.",
   "author": { "name": "Mikle Seregin" },
   "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh", "screenshots"]
 }
```

- [ ] **Шаг 4: тесты проходят.** `node --test tests/content.test.js tests/console-scripts.test.js tests/templates.test.js` — `ℹ fail 0`; весь набор — `ℹ tests 313`, `ℹ pass 310`, `ℹ fail 0`, `ℹ skipped 3`.

- [ ] **Шаг 5: закрыть шаг** — `/kit:step-done 12.7` (BUGS: К14 — исправлен).

---

### Задача 12.8: README, версия 2.4.0, проверка набора

**Файлы:** `README.md`, `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.

- [ ] **Шаг 1: правки.**

```diff
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # claude-kit
 
-Личный маркетплейс Claude Code с плагином **kit**: каркас работы над проектами (журнал, агенты журнала и git, закрытие шага, хуки правил процесса и `php -l`) и модуль для сайтов на 1С-Битрикс (инициализация проекта, работа на сервере по SSH или через Командную PHP-строку, проверки выкладки, снимки публичной части «до/после»).
+Личный маркетплейс Claude Code с плагином **kit**: каркас работы над проектами (журнал, агенты журнала и git, закрытие шага, хуки правил процесса и `php -l`) и модуль для сайтов на 1С-Битрикс (инициализация проекта, работа на сервере по SSH, а на Битриксе без SSH — через файл `kit-exec.php`, проверки выкладки, снимки публичной части «до/после»).
 
 ## Установка
 
@@ -42,7 +42,7 @@
 | `/kit:project-init` | командой | новый проект или дополнение существующего: git, `.gitignore`, скан секретов, `.claude/CLAUDE.md` с параметрами, журнал и план выкладки в `.claude/docs`, исключения PhpStorm, `.htaccess`; переезд старой `docs/` в `.claude/docs`; Битрикс — версия PHP прода, проверка снаружи, PhpStorm |
 | `/kit:step-done` | Claude сам после проверенного шага или командой | журнал и реестр документов (docs-keeper) → при закрытии этапа — документы этапа в `archive/` (с вашего выбора) → один коммит (git-keeper) → проверка |
 | `/kit:deploy-list` | командой или Claude | что залить и что удалить на сервере с последней выкладки |
-| `/kit:server` | Claude при необходимости | работа на сервере: сначала SSH (команды оболочки, PHP через `remote-php.js`), иначе Командная PHP-строка в Chrome; чтение — сразу, изменения — с согласия |
+| `/kit:server` | Claude при необходимости | работа на сервере: сначала SSH (команды оболочки, PHP через `remote-php.js`), иначе на Битриксе файл `kit-exec.php` (Claude открывает его во встроенном браузере, результат видит только вошедший администратор); чтение — сразу, изменения — с согласия |
 | `/kit:visual` | Claude перед изменением и после или командой | снимки публичной части «до/после» (гость и админ, 1920 и 390), контрольный прогон для замера шума, сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт `report.html` |
 | `kit:docs-keeper` (sonnet) | из `/kit:step-done` | журнал, план выкладки, правила проекта |
 | `kit:git-keeper` (haiku) | из `/kit:step-done` | один коммит, проверка путей и секретов, подпись дословно |
@@ -95,13 +95,21 @@
 
 - **Выкладка** — `PhpStorm Always` (автозаливка на прод), `вручную; дев — PhpStorm Always` (прод вручную, автозаливка только на дев) или `вручную`.
 - **PHP** — абсолютный путь к `php.exe`; относительный путь или другой файл хук `php -l` не принимает и молчит.
-- **SSH прод / SSH дев** — `хост:папка сайта`: псевдоним из `~/.ssh/config` (или `user@host`) и абсолютный путь к корню сайта на сервере; `—` — SSH нет: в режиме bitrix при заданном адресе `/kit:server` работает через Командную PHP-строку; в общем режиме выполнить на сервере негде. Порт — только через `~/.ssh/config`. Вход — только по ключу без пароля; настройка — `plugins/kit/skills/project-init/reference/ssh.md`.
+- **SSH прод / SSH дев** — `хост:папка сайта`: псевдоним из `~/.ssh/config` (или `user@host`) и абсолютный путь к корню сайта на сервере; `—` — SSH нет: в режиме bitrix при заданном адресе `/kit:server` работает через файл `kit-exec.php`; в общем режиме выполнить на сервере негде — включить SSH. Порт — только через `~/.ssh/config`. Вход — только по ключу без пароля; настройка — `plugins/kit/skills/project-init/reference/ssh.md`.
 - **PHP на сервере** — полный путь к PHP CLI нужной версии: команда `php` на хостинге бывает старой (на ispmanager — 5.4).
 - **Пути** в «Не выкладывать» и «Не коммитить»: со `/` в любом месте — от корня проекта (`bitrix/` — только корневая папка, копии шаблонов в `local/templates/…/components/bitrix/` коммитятся), без `/` — имя в любом месте пути (`.idea`, `*.back*`).
 - **`.claude/worktrees`** — git worktree, которые Claude Code (десктоп) создаёт внутри проекта (полная копия сайта); исключение `.claude` закрывает и их.
 
 Полное описание ключей — спек `spec-claude-kit.md` (в репозитории — `.claude/docs/work/`), раздел 5.
 
+## Работа на сервере без SSH (с 2.4.0)
+
+- **Битрикс без SSH — файл `kit-exec.php`.** Claude собирает его из кода задачи (`scripts/kit-exec.js`, проверка `php -l`), кладёт в корень сайта, открывает во встроенном браузере Claude и читает вывод. Файл отдаёт результат только вошедшему администратору (`$USER->IsAdmin()`, остальным — 403), выполняет только вшитый код и только при `?run=<номер запуска>` из своей сборки; вы один раз входите администратором в браузере Claude (пароли вводите вы). При автозаливке PhpStorm файл уезжает сам, иначе его заливаете вы (Upload to…). По окончании работы файл удаляется с сервера (PhpStorm → Remote Host); в git он не попадает (`/kit-exec.php` в `.gitignore`, в запретах git-keeper и secret-scan).
+- **Согласие — как по SSH:** чтение выполняется сразу, любое изменение — только после вопроса в чате с точным кодом. Окна подтверждения в браузере больше нет; Командная PHP-строка через Claude in Chrome (до 2.4.0) удалена.
+- **Не Битрикс и без SSH** — выполнить на сервере негде: включите SSH (`plugins/kit/skills/project-init/reference/ssh.md`, «Как включить SSH у хостинга»).
+- Общий таймаут SSH (`remote-php.js --timeout`, по умолчанию 110 с), `Include` в `~/.ssh/config`, пути MSYS2 и `DOCUMENT_ROOT` в общем режиме — исправления шагов К13, К14, К16, К20.
+- Проекты на Битриксе без SSH после обновления ничего менять не должны: параметры те же; строку `/kit-exec.php` в `.gitignore` `/kit:project-init` допишет с согласия.
+
 ## Снимки «до/после» (`/kit:visual`, с 2.2.0)
 
 - Нужен установленный Google Chrome (браузеры Playwright не скачиваются) и один раз на машину — зависимости: Claude спросит и выполнит `node visual.js install` — `npm install` playwright-core, pixelmatch, pngjs (~15 МБ) в `%LOCALAPPDATA%\kit\visual\deps`. Обновления плагина их не трогают.
@@ -111,8 +119,8 @@
 
 ## Переход с 1.x на 2.0
 
-- Команда `/kit:bitrix-console` переименована в `/kit:server`: сначала SSH, иначе прежняя Командная PHP-строка. В `docs/deploy-prod.md` и `.claude/CLAUDE.md` проектов заменить `/kit:bitrix-console` на `/kit:server`.
-- В проектах добавить параметры `SSH прод`, `SSH дев`, `PHP на сервере`. Проще всего — три строки вручную по образцу из «Параметров проекта» выше (`—`, если SSH нет); или `/kit:project-init` допишет их с согласия (раздел «SSH»). Без них `/kit:server` в режиме bitrix работает через консоль, как раньше.
+- Команда `/kit:bitrix-console` переименована в `/kit:server`: сначала SSH, иначе (с 2.4.0) файл `kit-exec.php`; до 2.4.0 — Командная PHP-строка в Chrome. В `docs/deploy-prod.md` и `.claude/CLAUDE.md` проектов заменить `/kit:bitrix-console` на `/kit:server`.
+- В проектах добавить параметры `SSH прод`, `SSH дев`, `PHP на сервере`. Проще всего — три строки вручную по образцу из «Параметров проекта» выше (`—`, если SSH нет); или `/kit:project-init` допишет их с согласия (раздел «SSH»). Без них `/kit:server` в режиме bitrix работает через файл `kit-exec.php` (с 2.4.0; до 2.4.0 — через Командную PHP-строку в Chrome).
 - После обновления плагина перезапустить сессии Claude Code.
 
 ## Перевод проекта со своими агентами на kit
```

```diff
--- a/plugins/kit/.claude-plugin/plugin.json
+++ b/plugins/kit/.claude-plugin/plugin.json
@@ -1,6 +1,6 @@
 {
   "name": "kit",
-  "version": "2.3.0",
+  "version": "2.4.0",
   "description": "Каркас работы над проектами: документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH, а на Битриксе без SSH — через файл kit-exec.php; снимки публичной части «до/после» и их сравнение.",
   "author": { "name": "Mikle Seregin" },
   "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh", "screenshots"]
```

```diff
--- a/.claude-plugin/marketplace.json
+++ b/.claude-plugin/marketplace.json
@@ -8,8 +8,8 @@
     {
       "name": "kit",
       "source": "./plugins/kit",
-      "description": "Документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, снимки «до/после» и сравнение, хуки правил и php -l.",
-      "version": "2.3.0",
+      "description": "Документы в .claude/docs (журнал, реестр, архив), исключения PhpStorm сами, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или (Битрикс без SSH) через файл kit-exec.php, снимки «до/после» и сравнение, хуки правил и php -l.",
+      "version": "2.4.0",
       "author": { "name": "Mikle Seregin" }
     }
   ]
```

- [ ] **Шаг 2: полная проверка.** `node --test tests/*.test.js` — `ℹ tests 313`, `ℹ pass 310`, `ℹ fail 0`, `ℹ skipped 3`; в PowerShell (не `claude.ps1` — политика выполнения): `claude.cmd plugin validate plugins/kit --strict` и `claude.cmd plugin validate . --strict` — «Validation passed» у обоих.

- [ ] **Шаг 3: закрыть шаг** — `/kit:step-done 12.8`. Часть A/B плана (12.3–12.8) завершена — **остановка на проверку пользователя.**

---

### Задача 12.9: живая проверка файл-канала на проекте Битрикс без SSH (delta)

Нужны: сайт delta (`C:\OSPanel\home\delta.server`, режим bitrix, SSH нет, PhpStorm Always по FTP), встроенный браузер Claude, пользователь. Только чтение на сервере. Инструменты берутся из worktree (`<worktree>\plugins\kit\scripts\…`), не из установленного плагина 2.3.0.

- [ ] **Шаг 1: разведка (только чтение локально).** Прочитать параметры проекта («Режим», «Прод», «PHP») в `delta.server\.claude\CLAUDE.md` и в `.idea\deployment.xml` — автозаливка и исключения (`node <worktree>\plugins\kit\scripts\phpstorm-exclude.js --check` из папки проекта, подоболочкой): `kit-exec.php` не должен быть в Excluded Paths. Пароли и `.settings.php` не открывать.
- [ ] **Шаг 2: код задачи** — во временную папку сессии, `probe.php`:

```php
echo 'PHP ', PHP_VERSION, "\n";
echo 'main ', defined('SM_VERSION') ? SM_VERSION : '?', "\n";
echo 'кодировка сайта: ', (defined('BX_UTF') && BX_UTF) ? 'UTF-8' : 'не UTF-8', "\n";
echo 'администратор: ', $USER->IsAdmin() ? 'да' : 'нет', "\n";
echo 'SITE_ID: ', defined('SITE_ID') ? SITE_ID : '?', "\n";
echo 'DOCUMENT_ROOT: ', $_SERVER['DOCUMENT_ROOT'], "\n";
```

- [ ] **Шаг 3: сборка** — из папки проекта, подоболочкой: `( cd C:/OSPanel/home/delta.server && node "<worktree>/plugins/kit/scripts/kit-exec.js" "<сессия>/probe.php" --run <N> --out "<сессия>/kit-exec.php" )`, где `<N>` — `node -e "console.log(require('crypto').randomBytes(4).toString('hex'))"`. Код 0, строка `Адрес:` — запомнить.
- [ ] **Шаг 4: согласие пользователя** (AskUserQuestion): текст вопроса — точный код `probe.php` (только чтение), файл `C:\OSPanel\home\delta.server\kit-exec.php`, что PhpStorm с автозаливкой **зальёт его на сервер delta**, что файл откроет только вошедший администратор, что после проверки пользователь удалит его на сервере. Варианты: «Да, записать и залить» / «Нет».
- [ ] **Шаг 5: положить и доставить.** Скопировать `kit-exec.php` в корень проекта (из основной папки, не из worktree). Автозаливка — файл уедет сам (PhpStorm открыт); нет — попросить пользователя залить (Upload to…).
- [ ] **Шаг 6: открыть** во встроенном браузере (`mcp__Claude_Browser__tabs_create`, `navigate` на адрес из шага 3, `get_page_text`):
  1. без входа — ожидается `kit: только для администратора`, HTTP 403; **зафиксировать**, что больше в ответе ничего нет (ни версий, ни имён);
  2. пользователь входит администратором в этой вкладке (пароль вводит только он), Claude открывает адрес снова — ожидается `KIT-RUN <N>` первой строкой и строки `probe.php`;
  3. адрес без `?run=` (`<сайт>/kit-exec.php`) — `KIT-RUN <N>` и «код не выполнялся — нужен адрес /kit-exec.php?run=<N>»; адрес с чужим `?run=zzzz9999` — то же.
- [ ] **Шаг 7: `inventory.php`** (только чтение): собрать вторым запуском с новым `<N>` из `plugins/kit/skills/server/scripts/inventory.php`, доставить и открыть тем же способом (нужно ещё одно согласие по тексту шага 4: кода — библиотечный `inventory.php`). Записать: версия ядра и PHP, кодировка, время выполнения, ошибки.
- [x] **Шаг 8: убрать (решение пользователя 2026-09-30, при исполнении: файл удаляет Claude, а не пользователь).** Последним запуском, с согласием и точным кодом: задача `echo @unlink(__FILE__) ? 'kit-exec.php удалён с сервера' : 'не удалось удалить kit-exec.php', "\n";` — собрать `kit-exec.js`, положить в корень, дождаться доставки, открыть страницу один раз; затем удалить локальную копию и открыть `<сайт>/kit-exec.php` — ожидается 404 или страница сайта, без `KIT-RUN`. Не удалось удалить (нет прав у PHP) — файл удаляет пользователь (PhpStorm → Remote Host). Закреплено в скилле `/kit:server` п. 3.4, спеке §7.4 и README шагом 12.9а.
- [ ] **Шаг 9: итог** — `/kit:step-done 12.9`: NOTES — что открылось, HTTP-статусы, время, версия ядра и кодировка, заметки по неудобствам; DEPLOY — «Удалить с сервера: `kit-exec.php` (delta) — ✅ ДАТА, проверено 404». Расхождение с ожиданием (например, 403 у администратора, кеш, редирект на авторизацию, сбой кодировки) — это дефект: исправить отдельным шагом `12.9а` с тестом, повторить шаги 3–8.

---

### Задача 12.10: сравнение SSH и файл-канала на одном сайте (beta)

beta: SSH настроен (`SSH прод`), режим bitrix, PhpStorm Always. Только чтение.

- [ ] **Шаг 1: по SSH** (только чтение; согласие пользователя на подключение к боевому серверу — в момент запуска): из папки проекта, подоболочкой — `node "<worktree>/plugins/kit/scripts/remote-php.js" "<worktree>/plugins/kit/skills/server/scripts/inventory.php" > "<сессия>/inventory-ssh.txt"`. Код 0.
- [ ] **Шаг 2: через файл-канал** — сборка `inventory.php` через `kit-exec.js` в папке beta, согласие пользователя на запись `kit-exec.php` в корень beta и заливку (как в 12.9, шаг 4), вход администратором во встроенном браузере (сессия beta), чтение результата в `<сессия>/inventory-file.txt`.
- [ ] **Шаг 3: сравнить** — `diff` двух файлов: различия допустимы только в контексте запуска (первая строка окружения: пользователь, `SITE_ID`, `DOCUMENT_ROOT`, время); в остальном (сайты, шаблоны, модули, инфоблоки, HL-блоки) вывод совпадает. Записать расхождения.
- [ ] **Шаг 4: убрать** — как в 12.9, шаг 8 (файл удаляет Claude последним запуском, с согласием; проверка 404).
- [ ] **Шаг 5: итог** — `/kit:step-done 12.10`. Часть C плана (12.9–12.10) завершена — **остановка на проверку пользователя.**

---

### Задача 12.11: финальное ревью, выпуск 2.4.0

- [ ] **Шаг 1: финальное ревью** ветки `claude/stage12-console` (opus): безопасность файла-канала (`IsAdmin` до кода, `?run=`, заголовки, кодировка), `runSsh`/`remote-php.js` (таймаут, гонки при `kill`), тексты скилла (нет ссылок на удалённое, согласие), совместимость (проекты без `kit-exec`), тесты. Исправления — `12.11а`, `12.11б`, … (с тестами, без amend); повторное ревью до «Ready to merge».
- [ ] **Шаг 2: закрытие этапа** — `/kit:step-done` со STAGE: `.claude/docs/work/plan-console.md` уходит в `archive/` (статус `готово, этап 12 (ГГГГ-ММ-ДД)`), в журнале К13, К14, К16, К20 — `✅`, К15, К17 — `неактуален`.
- [ ] **Шаг 3: выпуск** — слить ветку в `master` основного checkout `C:\OSPanel\home\claude-kit` перемоткой; `claude.cmd plugin marketplace update claude-kit`; `claude.cmd plugin update kit@claude-kit` — «updated from 2.3.0 to 2.4.0»; в кэше `~/.claude/plugins/cache/claude-kit/kit/2.4.0` есть `scripts/kit-exec.js`, `scripts/lib/kitexec.js`, `scripts/lib/msys.js`, файлы совпадают с `master`; сессии перезапустить.
- [ ] **Шаг 4: push `master` на GitHub** — только с согласия пользователя; worktree и ветка `claude/stage12-console` убираются — с согласия.

---

## Проверка (состояние после каждой задачи, собрано отдельно в копии репозитория)

| После задачи | Тестов | ✔ | ✖ | Пропущено |
|---|---|---|---|---|
| база (`7047cf0`) | 285 | 282 | 0 | 3 |
| 12.3 | 294 | 291 | 0 | 3 |
| 12.4 | 310 | 307 | 0 | 3 |
| 12.5 | 312 | 309 | 0 | 3 |
| 12.6 | 312 | 309 | 0 | 3 |
| 12.7 | 313 | 310 | 0 | 3 |
| 12.8 | 313 | 310 | 0 | 3 |

Итог этапа: `npm test` — `ℹ tests 313`, `ℹ pass 310`, `ℹ fail 0`, `ℹ skipped 3`; `claude.cmd plugin validate plugins/kit --strict` и `claude.cmd plugin validate . --strict` — «Validation passed».
