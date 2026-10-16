# План этапа 35 — «Документы на сервере» в режиме «Claude по SSH»

## Чек-лист

- [x] 35.1 — общий набор документов (`lib/project.js`), `docsChanges` (`lib/deploy.js`), флаги `--docs` и `--all` в `ssh-deploy.js`; спек и план этапа
- [x] 35.2 — хук PhpStorm при «Claude по SSH», п. 3в `/kit:step-done`, вопрос и первая заливка в `/kit:project-init`, шаблоны `CLAUDE.md` и `deploy-prod.md`
- [x] 35.3 — выпуск 2.18.0: версии, спек плагина, README, обзор

> Каждая задача — шаг kit, закрывается `/kit:step-done`; остановка на проверку пользователя — после каждой. Строки чек-листа отмечает docs-keeper. Исполнение — superpowers:executing-plans или subagent-driven-development; сам superpowers не коммитит.

**Цель:** при «Выкладка: Claude по SSH» и «Документы на сервере: да» на сервере после каждого шага — те же документы, что локально (`.claude/docs` без снимков `visual`, `.claude/CLAUDE.md`, `.claude/.htaccess`), включая журнал этого шага; снаружи `/.claude/` закрыта.

**Архитектура:** набор «документы на сервере» один на оба режима — `DOCS_KEEP` и `isDocOnServer` в `lib/project.js` (их берёт и хук PhpStorm). `lib/deploy.js` получает `docsChanges` — документы, изменённые от базы основной заливки, или все (`all`), с `.htaccess` первым. `ssh-deploy.js --docs [--all]` заливает их тем же сценарием `sh -s`, что и код. `/kit:step-done` вызывает `--docs` в новом п. 3в — после docs-keeper, перед коммитом; `/kit:project-init` задаёт вопрос «Документы на сервере» и при «Claude по SSH», а первую заливку делает `--docs --all`.

**Технологии:** Node.js (только встроенные модули), `node:test`, git, OpenSSH (`ssh`), на сервере — `sh`, `base64`, `md5sum`.

**Спек:** `.claude/docs/work/spec-ssh-docs.md`

## Общие ограничения

- Файлы — UTF-8 без BOM, LF; файлы целиком не переформатировать; PHP и тексты скиллов править только Edit.
- Тексты плагина, вывод скриптов, комментарии — по-русски; имена в коде — латиницей.
- Репозиторий публичный: в файлах, тестах и сообщениях коммитов — только обезличенно (alpha, beta…, `*.example.com`, `user100`, `203.0.113.x`, `C:\Users\user`).
- Перед каждым коммитом: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Один проверенный шаг — один коммит `35.N: …` через `/kit:step-done`; исправления после ревью — `35.Nа`, `35.Nб`, без amend.
- Frontmatter скиллов: значение с «: » — только в кавычках (тест К39).
- Коды `ssh-deploy.js` не меняются: 0 — залито и сверено (или нечего); 1 — часть не вышла; 2 — настройка (SSH не задан или неверный; с `--docs` — «Документы на сервере» не `да` или нет `.claude/.htaccess`); 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, недопустимый путь (на сервер ничего не ушло).
- Основная заливка (без `--docs`) не меняется: `.claude` в неё не попадает ни при каком значении параметра.

## На что смотреть при ревью

- Документы не менялись, изменился только код → `--docs` отвечает «Нечего заливать», код 0, без подключения: один `.htaccess` не едет (тест в задаче 35.1).
- «Не выкладывать» содержит `.claude` (так пишет `/kit:project-init` для ручной выкладки) → документам это не мешает; другая запись под `.claude/docs` — действует (тест в задаче 35.1).
- Путь в другом регистре (`.Claude/Docs/…`, `.claude/claude.md`) → считается документом; `.claude/docsx/…` — нет (тест в задаче 35.1).
- Неотслеживаемое в `.claude` без `.gitignore` (`skills`, `scripts`, `settings.local.json`, `kit-inbox.jsonl`, снимки `visual`) → в `--docs` и `--docs --all` не попадает (тест в задаче 35.1).
- «PhpStorm Always» и «Документы на сервере: да» → хук ведёт себя как раньше (убирает `.claude`, создаёт `.htaccess`, предупреждает о «Exclude items by name»); меняется только «Claude по SSH» (тест в задаче 35.2).

---

### Задача 35.1: набор документов и `ssh-deploy.js --docs`

**Файлы:**
- Изменить: `plugins/kit/scripts/lib/project.js` — `DOCS_KEEP`, `docsOnServer`, `isDocOnServer`
- Изменить: `plugins/kit/scripts/lib/deploy.js` — `docsRules`, `docsChanges`
- Изменить: `plugins/kit/scripts/ssh-deploy.js` — `--docs`, `--all`, отказы, заголовки, без строки DEPLOY
- Изменить: `plugins/kit/scripts/phpstorm-exclude.js` — `KEEP` и `docsOnServer` из `lib/project.js` (поведение не меняется; режим SSH — задача 35.2)
- Тесты: `tests/ssh-deploy.test.js`
- Документы шага: `.claude/docs/work/spec-ssh-docs.md`, `.claude/docs/work/plan-ssh-docs.md` (уже записаны — в FILES и DOCS: `work/spec-ssh-docs.md` и `work/plan-ssh-docs.md` — `в работе, этап 35`)

**Интерфейсы:**
- Даёт (из `lib/project.js`): `DOCS_KEEP` — `['docs', 'CLAUDE.md', '.htaccess']` (имена внутри `.claude`); `docsOnServer(params) → boolean` — параметр «Документы на сервере» ровно `да` (регистр не важен); `isDocOnServer(rel, info) → boolean` — путь от корня проекта (через `/` или `\`) — `.claude/.htaccess`, `.claude/CLAUDE.md` или под `.claude/docs/`, но не под `info.visualRel`; регистр не важен. Берёт задача 35.2 (`phpstorm-exclude.js`).
- Даёт (из `lib/deploy.js`): `docsChanges(cwd, info, { base, all }) → { upload: [{status, path}], del: [{status, path}] }`.
- Даёт (CLI): `node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --docs [--all] [--go]`; вывод — «Документы — залить (N):», «Документы — удалить (M):», без строки «DEPLOY Файлы:». Берёт задача 35.2 (тексты `/kit:step-done`, `/kit:project-init`).

**Шаг 1. Тесты (должны упасть).** В `tests/ssh-deploy.test.js`:

1) В импорт добавить `isDocOnServer`:
```js
const { parseArgs, safePath, buildScript, parseResult } = require('../plugins/kit/scripts/ssh-deploy');
const { isDocOnServer } = require('../plugins/kit/scripts/lib/project');
```

2) В первом тесте (`parseArgs и safePath: …`) заменить три строки с `parseArgs` и список плохих аргументов:
```js
  assert.deepEqual(parseArgs([]), { env: null, base: null, timeout: 100, go: false, paths: null, docs: false, all: false });
  assert.deepEqual(parseArgs(['--go', '--env', 'дев', '--base', 'abc1234', '--timeout', '5']), { env: 'дев', base: 'abc1234', timeout: 5, go: true, paths: null, docs: false, all: false });
  assert.deepEqual(parseArgs(['--go', '--', 'a.php', 'b c/d.php']).paths, ['a.php', 'b c/d.php']);
  assert.deepEqual(parseArgs(['--docs', '--all', '--go']), { env: null, base: null, timeout: 100, go: true, paths: null, docs: true, all: true });
  for (const bad of [['--env', 'тест'], ['--timeout', '0'], ['--timeout', '601'], ['--нет'], ['--base'], ['--'], ['--base', 'x', '--', 'a.php'], ['--all'], ['--docs', '--', 'a.php']]) assert.throws(() => parseArgs(bad), bad.join(' '));
```

3) После функции `project(...)` — заготовка проекта с документами на сервере:
```js
// «Документы на сервере: да» (этап 35): .htaccess и документы — в git, как в kit-проекте.
function docsProject(target, extra = {}) {
  return gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'SSH прод': target, 'Документы на сервере': 'да', ...extra }),
    '.claude/.htaccess': 'Require all denied\n',
    '.claude/docs/progress.md': 'журнал',
    '.claude/docs/work/plan-a.md': 'план',
    'a.php': '1',
  });
}
```

4) В конец файла — новые тесты:
```js
test('isDocOnServer: .htaccess, CLAUDE.md и docs без visual; регистр не важен; остальное в .claude и вне её — нет (этап 35)', () => {
  const info = { visualRel: '.claude/docs/visual' };
  for (const p of ['.claude/.htaccess', '.claude/CLAUDE.md', '.claude/claude.md', '.claude/docs/progress.md', '.Claude/Docs/work/a.md', '.claude\\docs\\archive\\b.md']) {
    assert.ok(isDocOnServer(p, info), p);
  }
  for (const p of ['.claude/docs/visual/a.png', '.claude/skills/x/SKILL.md', '.claude/scripts/a.php', '.claude/settings.local.json', '.claude/kit-inbox.jsonl', '.claude/docsx/a.md', 'docs/progress.md', 'a.php']) {
    assert.ok(!isDocOnServer(p, info), p);
  }
});

test('--docs: изменённые, новые и удалённые документы; .htaccess первым; служебное в .claude, снимки и сайт — нет; основная заливка — без .claude (этап 35)', () => {
  const dir = docsProject('ok:/srv/site', { 'Не выкладывать': '.idea, .git, .claude, .claude/docs/work/secret.md' });
  writeFiles(dir, {
    '.claude/docs/progress.md': 'журнал 2', '.claude/docs/archive/plan-b.md': 'новый', '.claude/docs/work/secret.md': 'нет',
    '.claude/docs/visual/a.png': 'снимок', '.claude/skills/x/SKILL.md': 's', '.claude/scripts/a.php': 'p',
    '.claude/settings.local.json': '{}', '.claude/kit-inbox.jsonl': '', 'a.php': '2',
  });
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const r = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs'], env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Документы — залить \(3\):\n  \.claude\/\.htaccess\n  \.claude\/docs\/progress\.md\n  \.claude\/docs\/archive\/plan-b\.md\n/);
  assert.match(r.stdout, /Документы — удалить \(1\):\n  \.claude\/docs\/work\/plan-a\.md/);
  assert.doesNotMatch(r.stdout, /secret|visual|skills|scripts|settings\.local|kit-inbox|a\.php/);
  assert.ok(!fs.existsSync(log), 'без --go подключения нет');
  const main = runScript('ssh-deploy.js', { cwd: dir, env: env() });
  assert.equal(main.code, 0, main.stderr);
  assert.match(main.stdout, /Залить \(1\):\n  a\.php\n/);
  assert.doesNotMatch(main.stdout, /\.claude/);
});

test('--docs: документы не менялись — «Нечего заливать» без подключения, один .htaccess не едет; --all — все документы набора без удалений (этап 35)', () => {
  const dir = docsProject('ok:/srv/site');
  writeFiles(dir, { 'a.php': '2', '.claude/skills/x/SKILL.md': 's', '.claude/docs/visual/a.png': 'снимок' });
  const log = path.join(tmpDir('kit-ssh-log-'), 'log.json');
  const none = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env({ FAKE_SSH_LOG: log }) });
  assert.equal(none.code, 0, none.stderr);
  assert.match(none.stdout, /Нечего заливать/);
  assert.ok(!fs.existsSync(log), 'подключения нет');
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const all = runScript('ssh-deploy.js', { cwd: dir, args: ['--docs', '--all'], env: env() });
  assert.equal(all.code, 0, all.stderr);
  assert.match(all.stdout, /База: — \(все документы, --all\)/);
  assert.match(all.stdout, /Документы — залить \(3\):\n  \.claude\/\.htaccess\n  \.claude\/CLAUDE\.md\n  \.claude\/docs\/progress\.md\n/);
  assert.match(all.stdout, /Документы — удалить \(0\):/);
});

test('--docs: «Документы на сервере» не «да» — код 2; нет .claude/.htaccess — код 2; --all без --docs и --docs с путями — код 4 (этап 35)', () => {
  const off = docsProject('ok:/srv/site', { 'Документы на сервере': 'нет' });
  const r = runScript('ssh-deploy.js', { cwd: off, args: ['--docs'], env: env() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /документы на сервер не выкладываются/);
  const noDeny = docsProject('ok:/srv/site');
  fs.unlinkSync(path.join(noDeny, '.claude', '.htaccess'));
  const d = runScript('ssh-deploy.js', { cwd: noDeny, args: ['--docs', '--all'], env: env() });
  assert.equal(d.code, 2);
  assert.match(d.stderr, /нет \.claude\/\.htaccess/);
  assert.equal(runScript('ssh-deploy.js', { cwd: noDeny, args: ['--all'], env: env() }).code, 4);
  assert.equal(runScript('ssh-deploy.js', { cwd: noDeny, args: ['--docs', '--', '.claude/docs/progress.md'], env: env() }).code, 4);
});

test('--docs --go через локальный sh: документы записаны, удалённое удалено, md5 сверен, строки DEPLOY нет; повтор — снова 0 (этап 35)', { skip: !SH }, async () => {
  const server = tmpDir('kit-server-');
  writeFiles(server, { '.claude/docs/work/plan-a.md': 'план' });
  const dir = docsProject('sh:' + shPath(server));
  writeFiles(dir, { '.claude/docs/progress.md': 'журнал шага 35.1\n' });
  fs.unlinkSync(path.join(dir, '.claude', 'docs', 'work', 'plan-a.md'));
  const r = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Залито и сверено: 2 из 2/);
  assert.match(r.stdout, /Удалено: 1 из 1/);
  assert.doesNotMatch(r.stdout, /DEPLOY Файлы/);
  assert.equal(fs.readFileSync(path.join(server, '.claude', '.htaccess'), 'utf8'), 'Require all denied\n');
  assert.equal(fs.readFileSync(path.join(server, '.claude', 'docs', 'progress.md'), 'utf8'), 'журнал шага 35.1\n');
  assert.ok(!fs.existsSync(path.join(server, '.claude', 'docs', 'work', 'plan-a.md')));
  const again = await runScriptAsync('ssh-deploy.js', { cwd: dir, args: ['--docs', '--go'], env: env() });
  assert.equal(again.code, 0, again.stdout + again.stderr);
});
```

**Шаг 2. Запустить — должны упасть.**
Команда: `node --test tests/ssh-deploy.test.js`
Ожидается: падают первый тест (`parseArgs` без `docs`/`all`) и новые тесты (`isDocOnServer is not a function`, «неизвестный аргумент --docs» — код 4).

**Шаг 3. `lib/project.js`.** После функции `serverEnv` добавить и дописать в `module.exports` `DOCS_KEEP, docsOnServer, isDocOnServer`:
```js
// «Документы на сервере: да» (с 2.6.0): из .claude на сервер уезжают только эти имена — автозаливкой PhpStorm
// (phpstorm-exclude.js) и заливкой по SSH (ssh-deploy.js --docs, с 2.18.0). Снимки visual внутри docs — нет.
const DOCS_KEEP = ['docs', 'CLAUDE.md', '.htaccess'];

function docsOnServer(params) {
  return /^да$/i.test(String(params.get('Документы на сервере', '')).trim());
}

// Путь от корня проекта входит в документы на сервере: .claude/.htaccess, .claude/CLAUDE.md, .claude/docs/… без снимков
// visual. Регистр не важен (Windows).
function isDocOnServer(rel, info) {
  const p = slash(rel).toLowerCase();
  const visual = slash(info.visualRel).toLowerCase() + '/';
  return DOCS_KEEP.some((n) => {
    const k = '.claude/' + n.toLowerCase();
    return p === k || p.startsWith(k + '/');
  }) && !p.startsWith(visual);
}

module.exports = { JOURNAL_DEFAULTS, readStdinJson, resolveProjectDir, kitInfo, docsInClaude, serverEnv, DOCS_KEEP, docsOnServer, isDocOnServer };
```
(`slash` уже есть в файле: `\` → `/`, снимает `./` в начале.)

**Шаг 4. `lib/deploy.js`.** Импорт — `const { docsInClaude, isDocOnServer } = require('./project');`. Перед `module.exports` добавить:
```js
// Документы на сервер («Документы на сервере: да», ssh-deploy.js --docs, с 2.18.0). Записи «Не выкладывать», которые
// закрывают .claude целиком, — для ручной выкладки; документам они не мешают (как у хука PhpStorm). Остальные — действуют.
function docsRules(info) {
  return parseRules(info.params.list('Не выкладывать').filter((r) => !/^\/?\.claude\/?$/i.test(String(r).trim())));
}

const HTACCESS = '.claude/.htaccess';

// all — все документы на диске (отслеживаемые и новые неигнорируемые), без удалений; иначе — изменения от base до папки
// проекта. Есть что залить или удалить — .claude/.htaccess (если он на диске) первым: папка закрыта раньше, чем на сервер
// попадёт первый документ, а удалённый на сервере .htaccess восстанавливается.
function docsChanges(cwd, info, { base = null, all = false } = {}) {
  const rules = docsRules(info);
  const keep = (p) => isDocOnServer(p, info) && !matchRules(p, rules);
  let upload;
  let del = [];
  if (all) {
    const listed = (extra) => git(cwd, ['ls-files', '-z', ...extra, '--', '.claude']).out.split('\0').filter(Boolean);
    upload = [...listed([]), ...listed(['--others', '--exclude-standard'])]
      .filter((p) => keep(p) && fs.existsSync(path.join(cwd, p)))
      .map((p) => ({ status: 'M', path: p }));
  } else {
    const ch = changes(cwd, base, rules, { worktree: true });
    upload = ch.upload.filter((it) => keep(it.path));
    del = ch.del.filter((it) => keep(it.path));
  }
  upload = upload.filter((it) => it.path.toLowerCase() !== HTACCESS);
  if ((upload.length || del.length) && fs.existsSync(path.join(cwd, HTACCESS))) upload.unshift({ status: 'M', path: HTACCESS });
  return { upload, del };
}

module.exports = { ALWAYS_SKIP, skipRules, git, sectionOf, isSsh, commitOfStep, baseFromPlan, resolveBase, changes, docsRules, docsChanges };
```

**Шаг 5. `ssh-deploy.js`.**

5.1. Шапка — добавить строки после строки про `-- <пути>`:
```js
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --docs [--all] [--go]
//                                                                                 документы на сервер («Документы на сервере: да»):
//                                                                                 .claude/.htaccess (первым), .claude/CLAUDE.md,
//                                                                                 .claude/docs без visual — изменённые с базы;
//                                                                                 --all — все, без удалений (первая заливка)
```
и в строку «Коды»: `2 — SSH не задан или параметр неверный` → `2 — SSH не задан или параметр неверный; с --docs — «Документы на сервере» не «да» или нет .claude/.htaccess`.

5.2. Импорты:
```js
const { kitInfo, serverEnv, docsOnServer } = require('./lib/project');
const { skipRules, git, resolveBase, changes, docsChanges } = require('./lib/deploy');
```

5.3. `USAGE`:
```js
const USAGE = 'Использование: node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] [--docs [--all]] [--go] [-- <пути>]';
```

5.4. `parseArgs` — начальный объект и флаги, проверки после цикла:
```js
  const o = { env: null, base: null, timeout: DEFAULT_TIMEOUT, go: false, paths: null, docs: false, all: false };
```
```js
    if (a === '--go') o.go = true;
    else if (a === '--docs') o.docs = true;
    else if (a === '--all') o.all = true;
    else if (a === '--env' || a === '--base' || a === '--timeout') {
```
После цикла, перед проверкой `--env`:
```js
  if (o.all && !o.docs) throw new Error('--all — только вместе с --docs');
  if (o.docs && o.paths) throw new Error('--docs и пути после -- вместе не задаются');
```

5.5. `main` — сразу после блока `if (!target) { … return 2; }`:
```js
  if (o.docs) {
    if (!docsOnServer(info.params)) {
      console.error('ssh-deploy: документы на сервер не выкладываются (параметр «Документы на сервере» — не «да»)');
      return 2;
    }
    if (!fs.existsSync(path.join(cwd, '.claude', '.htaccess'))) {
      console.error('ssh-deploy: нет .claude/.htaccess — документы были бы открыты снаружи; создайте его (/kit:project-init) — на сервер ничего не ушло');
      return 2;
    }
  }
```

5.6. Ветки списка — заменить `} else { b = resolveBase(...) … }` на:
```js
  } else if (o.all) {
    b = { short: '—', source: 'все документы, --all' };
    ({ upload, del } = docsChanges(cwd, info, { all: true }));
  } else {
    b = resolveBase(cwd, info, env, o.base);
    if (b.error) {
      console.error('ssh-deploy: ' + b.error);
      return 4;
    }
    ({ upload, del } = o.docs ? docsChanges(cwd, info, { base: b.base }) : changes(cwd, b.base, rules, { worktree: true }));
  }
```

5.7. Заголовки списка — в `head`:
```js
  const [put, rm] = o.docs ? ['Документы — залить', 'Документы — удалить'] : ['Залить', 'Удалить'];
  const head = [
    'Сервер: ' + env + ' — ' + target.host + ':' + target.root,
    'База: ' + b.short + ' (' + b.source + ')',
    '', put + ' (' + files.length + '):', ...files.map((f) => '  ' + f.path),
    '', rm + ' (' + dels.length + '):', ...dels.map((p) => '  ' + p),
  ];
```

5.8. Строка DEPLOY — только у основной заливки (документы заливаются после docs-keeper):
```js
  } else if (!skipped.length && !o.docs) {
    out.push('', 'DEPLOY Файлы: ' + deployLine(files.map((f) => f.path), dels));
  }
```

**Шаг 6. `phpstorm-exclude.js` — общий набор.** Импорт и константы (поведение не меняется):
```js
const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude, DOCS_KEEP, docsOnServer } = require('./lib/project');
```
```js
const KEEP = DOCS_KEEP;
```
Локальную функцию `const docsOnServer = (info) => /^да$/i.test(...)` удалить; её вызовы `docsOnServer(info)` (в `required` и `run`) заменить на `docsOnServer(info.params)`.

**Шаг 7. Тесты — должны пройти.**
Команды: `node --test tests/ssh-deploy.test.js tests/phpstorm-exclude.test.js tests/deploy-lib.test.js tests/deploy-list.test.js`
Ожидается: все ✔ (тесты через локальный `sh` — ✔ или пропущены, если `sh` нет).

**Шаг 8. Полная проверка:** `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict` — без ошибок.

**Шаг 9. Закрыть шаг — `/kit:step-done`:** STEP `35.1`, STAGE — «35 — «Документы на сервере» в режиме «Claude по SSH»»; DOCS — `work/spec-ssh-docs.md` и `work/plan-ssh-docs.md` (`в работе, этап 35`); DECISIONS — подход А (документы отдельной заливкой `--docs` после docs-keeper, перед коммитом), отвергнуты Б (вместе с кодом и повторная полная заливка — код дважды), В (все документы каждый шаг — тяжелеет с архивом), коммит без документов при неудачной заливке (незалитое потерялось бы — база следующей заливки — коммит шага); `.htaccess` первым только когда есть что заливать (иначе подключение каждый шаг впустую). Остановка — на проверку пользователя.

---

### Задача 35.2: хук PhpStorm, `/kit:step-done`, `/kit:project-init`, шаблоны

**Файлы:**
- Изменить: `plugins/kit/scripts/phpstorm-exclude.js` — при «Claude по SSH» документы для PhpStorm закрыты
- Изменить: `plugins/kit/skills/step-done/SKILL.md` — п. 1.4, 3а.3, 3б.4, новый п. 3в
- Изменить: `plugins/kit/skills/project-init/SKILL.md` — вопрос «Документы на сервере», параметр, «Общие правила», п. 4.8
- Изменить: `plugins/kit/skills/project-init/templates/CLAUDE.md` — строка про `.claude/` (третий вариант)
- Изменить: `plugins/kit/skills/project-init/templates/deploy-prod.md` — строка про `.claude/` в «Общих правилах» (варианты)
- Тесты: `tests/phpstorm-exclude.test.js`, `tests/content.test.js`

**Интерфейсы:**
- Берёт: `DOCS_KEEP`, `docsOnServer(params)` из `lib/project.js`; `isSsh(info)` из `lib/deploy.js`; CLI `ssh-deploy.js --docs [--all] [--go]` (задача 35.1).
- Даёт: тексты скиллов, на которые опираются тесты `content.test.js` (строки ниже — дословно).

**Шаг 1. Тесты (должны упасть).**

1) `tests/phpstorm-exclude.test.js` — после теста «Exclude items by name» (тот, что с `*.md;docs`):
```js
test('«Claude по SSH» и «Документы на сервере: да»: PhpStorm не заливает — .claude остаётся в Excluded Paths, .htaccess не создаётся, предупреждения про имена нет (этап 35)', () => {
  const xml = GAMMA.replace('autoUpload="Always"', 'exclude=".svn;.idea;.git;*.md;docs;node_modules" autoUpload="Always"');
  const files = docsProject({ 'Выкладка': 'Claude по SSH' });
  delete files['.claude/.htaccess'];
  const dir = makeProject({ ...files, [XML]: xml });
  const m = msg(hook(dir));
  assert.doesNotMatch(m, /не уедут|убрано|создан/);
  assert.ok(excluded(dir).includes('.claude'));
  assert.equal(fs.existsSync(path.join(dir, '.claude/.htaccess')), false);
});
```

2) `tests/content.test.js` — в тесте `project-init: вопрос «Документы на сервере» — только при автозаливке, шаблон пишет ответ (К55)`: заголовок — `project-init: вопрос «Документы на сервере» — при автозаливке и «Claude по SSH», шаблон пишет ответ (К55, этап 35)`, строку `'Без автозаливки вопрос не задавай'` заменить на `'При «вручную» вопрос не задавай'`.

3) `tests/content.test.js` — после теста `К56–К60: …` новый тест:
```js
test('«Документы на сервере» в режиме «Claude по SSH»: п. 3в step-done, вопрос и первая заливка в project-init, шаблоны (этап 35)', () => {
  const sd = skill('step-done').body;
  for (const s of ['## 3в. Заливка документов', 'scripts/ssh-deploy.js" --go --docs', '«Повторить заливку документов» (Рекомендую) / «Остановиться»',
    'снова п. 3в', 'документы уедут на сервер (`ssh-deploy.js --docs`)', 'перед коммитом — п. 3в']) {
    assert.ok(sd.includes(s), 'step-done: ' + s);
  }
  const i3b = sd.indexOf('## 3б. Заливка по SSH');
  const i3v = sd.indexOf('## 3в. Заливка документов');
  assert.ok(i3v > i3b && i3v < sd.indexOf('## 4. Коммит'), '3в — между 3б и коммитом');
  const pi = skill('project-init').body;
  for (const s of ['при «PhpStorm Always» и «Claude по SSH» — вопрос «Документы на сервере»', 'scripts/ssh-deploy.js" --go --docs --all', '**Документы на сервер**']) {
    assert.ok(pi.includes(s), 'project-init: ' + s);
  }
  const tpl = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8');
  assert.ok(tpl.includes('| из `.claude/` на сервер уезжают только документы: их заливает `/kit:step-done`'), 'шаблон CLAUDE.md: вариант для SSH');
  const dp = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'deploy-prod.md'), 'utf8');
  assert.ok(dp.includes('`ssh-deploy.js --docs`'), 'шаблон deploy-prod.md: вариант для SSH');
  assert.ok(dp.includes('| из `.claude/` автозаливка PhpStorm везёт на сервер только документы'), 'шаблон deploy-prod.md: вариант для PhpStorm');
});
```

**Шаг 2. Запустить — должны упасть.**
Команда: `node --test tests/phpstorm-exclude.test.js tests/content.test.js`
Ожидается: падают новый тест хука (`.claude` убрана, сообщение «убрано») и оба теста текстов.

**Шаг 3. `phpstorm-exclude.js`.** Импорт `isSsh`: `const { isSsh } = require('./lib/deploy');`. Под `const OPEN_NOTE = …` добавить:
```js
// Документы открыты для PhpStorm: «Документы на сервере: да» и не «Claude по SSH» — в этом режиме PhpStorm не заливает,
// .claude для него закрыта при любом значении параметра, документы везёт ssh-deploy.js --docs (с 2.18.0).
const docsOpen = (info) => docsOnServer(info.params) && !isSsh(info);
```
Вызовы `docsOnServer(info.params)` в `required` и `run` (после задачи 35.1) заменить на `docsOpen(info)`. В шапке файла к строке «Документы на сервере: да» дописать: `при «Выкладка: Claude по SSH» — как при «нет»: PhpStorm не заливает, документы везёт ssh-deploy.js --docs.`

**Шаг 4. `step-done/SKILL.md`.**

4.1. П. 1.4 — после предложения «`«Нечего заливать» (шаг меняет только документы) — обычный порядок.`» дописать:
```
 При «Документы на сервере: да» в любом порядке перед коммитом — п. 3в (заливка документов).
```

4.2. П. 3а.3 — после предложения про порядок **SSH** (заканчивается «…«Залить (N)», «Удалить (M)».») дописать:
```
 При «Документы на сервере: да» в обычном порядке в описании «Коммитить» — «документы уедут на сервер (`ssh-deploy.js --docs`)»; в порядке **SSH** ответ «Залить на сервер» включает и п. 3в.
```

4.3. П. 3б.4 заменить на:
```
4. **Прошла** — п. 3 (docs-keeper с итогом заливки и проверки), затем п. 3в (при «Документы на сервере: да») и п. 4 без нового вопроса: ответ «Залить на сервер» включает заливку документов, коммит и отправку.
```

4.4. Между концом п. 3б (абзац «Отказ от шага») и `## 4. Коммит` — новый раздел:
````
## 3в. Заливка документов

Только при «Выкладка: Claude по SSH» и «Документы на сервере: да» — в любом порядке шага, сразу перед коммитом (п. 4): обычный порядок — после п. 3 и ответа «Коммитить»; порядок **SSH** — после п. 3б и п. 3; «Коммит: сразу» — после п. 3. Журнал, план выкладки и другие документы шага пишет docs-keeper уже после заливки кода — поэтому они едут отдельно, перед коммитом. Из корня проекта:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-deploy.js" --go --docs
```
Уезжают `.claude/.htaccess` (первым), `.claude/CLAUDE.md` и `.claude/docs` без снимков `visual` — изменённые с последней заливки; удалённые в git — удаляются на сервере. Нового вопроса нет: заливку документов включают ответы «Коммитить» и «Залить на сервер».

- Код 0 (и «Нечего заливать») — п. 4.
- Код 1 или 3 — покажи причину; повтор безопасен — AskUserQuestion «Повторить заливку документов» (Рекомендую) / «Остановиться». Остановились — коммита нет: правки, журнал и уже залитый код остаются; пользователь скажет продолжить — снова п. 3в, затем п. 4, docs-keeper заново не вызывай. Коммита без документов нет: следующая заливка считает от коммита шага, и незалитые документы на сервер уже не попали бы.
- Код 2 (параметр не «да» или нет `.claude/.htaccess`) — покажи вывод и стоп: предложи `/kit:project-init`. Код 4 — покажи вывод и стоп.
````

**Шаг 5. `project-init/SKILL.md`.**

5.1. Абзац «Следующим вызовом — только при «PhpStorm Always» — вопрос «Документы на сервере»: …» (раздел «Выкладка — после SSH») заменить целиком на:
```
Следующим вызовом — при «PhpStorm Always» и «Claude по SSH» — вопрос «Документы на сервере»: «Нет — `.claude` целиком не выкладывается» / «Да — документы уезжают на сервер». Первым с «(Рекомендую)» — значение параметра из существующего раздела, иначе «Нет». В тексте вопроса: «да» — на сервер уезжают `.claude/docs` (журнал, планы; без снимков `visual`), `.claude/CLAUDE.md` и `.claude/.htaccess`, например чтобы открывать их по FTP: при «PhpStorm Always» — автозаливкой (остальное в `.claude` — `scripts`, `skills`, `settings.local.json`, `kit-inbox.jsonl`, `worktrees` — хук исключает поимённо), при «Claude по SSH» — заливкой `/kit:step-done` перед коммитом шага (`ssh-deploy.js --docs`, `.htaccess` — первым; остальное в `.claude` не уезжает); снаружи папку закрывает `.htaccess`. При «вручную» вопрос не задавай: ручная выкладка `.claude` не везёт, параметр — `нет`.
```

5.2. Абзац «Параметр «Документы на сервере» — ответ на вопрос …»: `вопроса не было (нет автозаливки) — \`нет\`` → `вопроса не было (выкладка вручную) — \`нет\``; `В шаблоне при «да» — второй вариант строки про \`.claude/\` в пункте «Выкладка».` → `В шаблоне при «да» — вариант строки про \`.claude/\` в пункте «Выкладка» и в «Общих правилах» плана выкладки по способу выкладки: автозаливка PhpStorm или заливка \`/kit:step-done\` по SSH.`

5.3. Строка «- «Общие правила» плана выкладки — по ответам: …»: `\`.claude/\` исключена и закрыта \`.htaccess\`` → `\`.claude/\` исключена и закрыта \`.htaccess\` (при «Документы на сервере: да» — вариант строки про документы на сервере)`.

5.4. П. 4.8 — после абзаца «**Точка отсчёта заливки** — …» новый абзац:
````
**Документы на сервер** — только при «Claude по SSH» и «Документы на сервере: да» (новый проект или параметр включён этим запуском), после точки отсчёта: все документы — одной заливкой, `.htaccess` первым:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/ssh-deploy.js" --go --docs --all
```
Код 0 — проверка снаружи: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-closed.js" <адрес сервера>` — документы — 403; итог — в CHECK шага. Коды 1 и 3 — причину пользователю, повтор безопасен; код 2 — нет `.claude/.htaccess`: создать (п. 4.2) и повторить. Дальше документы шагов заливает `/kit:step-done` (п. 3в).
````

**Шаг 6. Шаблон `templates/CLAUDE.md`.** В строке про `.claude/` (пункт «Выкладка») перед закрывающими `}}` второго варианта добавить третий вариант — текст `{{A | B}}` становится `{{A | B | C}}`, где C:
```
из `.claude/` на сервер уезжают только документы: их заливает `/kit:step-done` перед коммитом шага (`ssh-deploy.js --docs`, «Документы на сервере: да») — `.claude/docs` (без снимков `visual`), `CLAUDE.md` и `.htaccess` (первым); остальное в ней (скрипты, скиллы, служебные файлы) не уезжает, ручная выкладка `.claude` не включает («Не выкладывать»); снаружи папку закрывает `.htaccess` (`Require all denied`)
```
(в тексте варианта C перед ним — ` | `, как у B).

**Шаг 7. Шаблон `templates/deploy-prod.md`.** Строку 7 («- `.claude/` (правила, документы `.claude/docs`, скрипты) не выкладывается: …») заменить на:
```
- {{`.claude/` (правила, документы `.claude/docs`, скрипты) не выкладывается: Excluded Paths PhpStorm дописывает хук kit, при ручной выкладке и заливке по SSH она в «Не выкладывать»; на случай ручной заливки закрыта `.htaccess` (`Require all denied`) | из `.claude/` автозаливка PhpStorm везёт на сервер только документы — `.claude/docs` (без снимков `visual`), `CLAUDE.md` и `.htaccess` («Документы на сервере: да»); остальное в ней хук kit исключает поимённо; снаружи папку закрывает `.htaccess` (`Require all denied`) | из `.claude/` на сервер уезжают только документы — `.claude/docs` (без снимков `visual`), `CLAUDE.md` и `.htaccess` (первым): их заливает `/kit:step-done` перед коммитом шага (`ssh-deploy.js --docs`, «Документы на сервере: да»); остальное в ней не уезжает; снаружи папку закрывает `.htaccess` (`Require all denied`)}}; проверка снаружи — `check-closed` ({{ДАТА и итог | ещё не проверено}}). nginx может отдавать статику (pdf, docx, картинки, txt…) мимо `.htaccess` — поэтому главное — не выкладывать (при «Документы на сервере: да» — не класть в `.claude/docs` то, что нельзя показать).
```

**Шаг 8. Тесты — должны пройти.**
Команды: `node --test tests/phpstorm-exclude.test.js tests/content.test.js tests/templates.test.js`
Ожидается: все ✔.

**Шаг 9. Полная проверка:** `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict` — без ошибок.

**Шаг 10. Закрыть шаг — `/kit:step-done`** (STEP `35.2`). Остановка — на проверку пользователя.

---

### Задача 35.3: выпуск 2.18.0

**Файлы:**
- Изменить: `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — `version` `2.17.2` → `2.18.0`
- Изменить: `.claude/docs/work/spec-claude-kit.md` — строка «Дополнен», таблица параметров, раздел «Заливка: `ssh-deploy.js` и `lib/deploy.js`», п. 4б порядка SSH, раздел тестов
- Изменить: `README.md` — строки про «Документы на сервере» (62, 120, 145) и `/kit:step-done` (34)
- Изменить: `.claude/docs/work/overview/build/build.js` — версия в подвале и шапке, абзац про `phpstorm-exclude.js`, пункт «Выкладка», строка «Claude по SSH» в таблице; пересборка
- Тесты: без новых — `npm test` целиком

**Интерфейсы:**
- Берёт: всё из задач 35.1 и 35.2 (имена флагов `--docs`, `--all`, п. 3в, поведение хука).

**Шаг 1. Версия.** В `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json`: `"version": "2.17.2"` → `"version": "2.18.0"`.

**Шаг 2. Спек плагина `spec-claude-kit.md`.**

2.1. После строки «> Дополнен 2026-10-15: этап 34 — …» добавить:
```
> Дополнен 2026-10-15: этап 35 — «Документы на сервере» в режиме «Claude по SSH»: `ssh-deploy.js --docs` (документы — `.claude/docs` без снимков `visual`, `.claude/CLAUDE.md`, `.claude/.htaccess` первым; изменённые с последней заливки, `--all` — все, без удалений), п. 3в `/kit:step-done` — заливка документов после docs-keeper, перед коммитом; `/kit:project-init` спрашивает «Документы на сервере» и при «Claude по SSH», первая заливка — `--docs --all` и `check-closed`; хук `phpstorm-exclude.js` при «Claude по SSH» держит `.claude` закрытой для PhpStorm; общий набор документов — `lib/project.js`; версия 2.18.0 (§4, 5, 7.1, 7.3, 8, 11). Спек и план — `.claude/docs/work/spec-ssh-docs.md`, `plan-ssh-docs.md`.
```

2.2. Строка таблицы параметров «| Документы на сервере | …» заменить на:
```
| Документы на сервере | `да` / `нет` (с 2.6.0, этап 18) | `нет` — `.claude` исключена из выкладки целиком | project-init (спрашивает при автозаливке и при «Claude по SSH», с 2.15.2 / 2.18.0), phpstorm-exclude (`да` и не «Claude по SSH» — из `.claude` автозаливкой уезжают `docs`, `CLAUDE.md`, `.htaccess`, §8), ssh-deploy (`--docs` — то же по SSH, с 2.18.0), step-done (п. 3в) |
```

2.3. Раздел «### Заливка: `ssh-deploy.js` и `lib/deploy.js`» — в блок вызовов добавить строку:
```
node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --docs [--all] [--go]   — документы на сервер (с 2.18.0)
```
и после пункта «**Откат шага**» — пункт:
```
- **Документы** (с 2.18.0, «Документы на сервере: да») — `--docs`: `.claude/.htaccess` (первым, если есть что заливать или удалять), `.claude/CLAUDE.md`, `.claude/docs` без снимков `visual` (набор — `DOCS_KEEP` / `isDocOnServer` в `lib/project.js`, общий с хуком PhpStorm) — изменённые от той же базы, удалённые — удаляются; «Не выкладывать» действует, кроме записей `.claude`; `--all` — все документы на диске, без удалений (первая заливка, починка). Параметр не `да` или нет `.claude/.htaccess` — код 2; `--all` без `--docs`, `--docs` с путями — код 4. Строки «DEPLOY Файлы» нет. Основная заливка `.claude` не берёт никогда.
```

2.4. П. 4б «**Порядок SSH**» — в конец пункта дописать: ` При «Документы на сервере: да» перед коммитом в любом порядке — п. 3в: \`ssh-deploy.js --go --docs\` (коды 1 и 3 — «Повторить заливку документов» / «Остановиться»; коммита без документов нет).`

2.5. Раздел тестов — после строки «- С 2.17.0 (этап 32): …» добавить:
```
- С 2.18.0 (этап 35): `isDocOnServer` (регистр, `visual`, `docsx`), `ssh-deploy.js --docs` — состав, `.htaccess` первым, «Нечего заливать» без подключения, `--all`, коды 2 и 4, заливка через `fake-ssh.js` с локальным `sh` (`ssh-deploy.test.js`); хук PhpStorm при «Claude по SSH» (`phpstorm-exclude.test.js`); тексты п. 3в `step-done`, вопрос и п. 4.8 `project-init`, шаблоны (`content.test.js`).
```

**Шаг 3. README.md.**
- Строка 34 (`/kit:step-done`): в конце ячейки после `…проверка там до коммита` дописать `; при «Документы на сервере: да» (с 2.18.0) — документы следом (`ssh-deploy.js --docs`) перед коммитом`.
- Строка 62: после `После первой заливки проверьте снаружи, что \`/.claude/\` закрыта (\`check-closed\`).` дописать: ` В режиме «Claude по SSH» (с 2.18.0) те же документы заливает \`/kit:step-done\` перед коммитом шага (\`ssh-deploy.js --docs\`, \`.htaccess\` — первым), первую заливку всех документов делает \`/kit:project-init\`; хук PhpStorm в этом режиме держит \`.claude\` исключённой.`
- Строка 120: `(по умолчанию; \`/kit:project-init\` спрашивает при автозаливке PhpStorm, с 2.15.2)` → `(по умолчанию; \`/kit:project-init\` спрашивает при автозаливке PhpStorm, с 2.15.2, и при «Claude по SSH», с 2.18.0)`; после `остальное в \`.claude\` остаётся исключённым` дописать `; при «Claude по SSH» их заливает \`/kit:step-done\` (\`ssh-deploy.js --docs\`)`.
- Строка 145: `хук исключает \`.claude/skills\` заранее` → `хук исключает \`.claude/skills\` заранее, а \`ssh-deploy.js --docs\` берёт только \`.claude/docs\`, \`CLAUDE.md\` и \`.htaccess\``.

**Шаг 4. Обзор `build.js`.**
- Строка `const footer = …версии 2.17.1…` → `2.18.0`; `<div class="eyebrow">claude-kit · плагин kit 2.17.1</div>` → `2.18.0`.
- Абзац про `phpstorm-exclude.js` (начинается «Второй скрипт SessionStart»): после `— документы уезжают на сервер автозаливкой, папка закрыта из веба.` дописать ` В режиме «Claude по SSH» (с 2.18.0) хук держит <code>.claude</code> исключённой: документы туда же заливает <code>/kit:step-done</code> скриптом <code>ssh-deploy.js --docs</code>.`
- Пункт «<b>Выкладка</b> (с 2.17.0)»: `при автозаливке — вопрос «Документы на сервере».` → `при автозаливке и «Claude по SSH» — вопрос «Документы на сервере» (при SSH — с 2.18.0).`
- Строка таблицы `<tr><td>Claude по SSH</td>…` — в конец описания (перед `</td></tr>`) дописать `; документы при «Документы на сервере: да» — <code>ssh-deploy.js --docs</code> перед коммитом (с 2.18.0)`.
- Пересобрать: `node .claude/docs/work/overview/build/build.js` (из корня репозитория); `git status` — изменились `overview.html`, `overview.md` (и, если затронуты, `img/*.svg`).

**Шаг 5. Проверка:** `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`, `node tools/kit-denylist.js tree` — без ошибок; `grep -n "2.17.2" plugins/kit/.claude-plugin/plugin.json .claude-plugin/marketplace.json` — пусто.

**Шаг 6. Закрыть шаг — `/kit:step-done`** (STEP `35.3`; этап 35 закрывается — сверка RECONCILE по спеку и плану; документы этапа — в `archive/` с выбора пользователя). После коммита, с согласия пользователя: `git push origin master`, `claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit`. Живая проверка — по желанию пользователя, в проекте с SSH (в его сессии): `ssh-deploy.js --go --docs --all`, `check-closed` — 403, шаг с документами.
