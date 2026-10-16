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

test('frontmatter навыков и агентов: значение с «: » взято в кавычки — иначе это не простой скаляр YAML (К39)', () => {
  const files = [];
  for (const d of fs.readdirSync(path.join(PLUGIN, 'skills'))) {
    const f = path.join(PLUGIN, 'skills', d, 'SKILL.md');
    if (fs.existsSync(f)) files.push(f);
  }
  if (fs.existsSync(path.join(PLUGIN, 'agents'))) for (const a of fs.readdirSync(path.join(PLUGIN, 'agents'))) files.push(path.join(PLUGIN, 'agents', a));
  assert.ok(files.length >= 5, 'нашлось файлов: ' + files.length);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const head = /^---\n([\s\S]*?)\n---\n/.exec(src);
    assert.ok(head, 'нет frontmatter: ' + file);
    for (const line of head[1].split('\n')) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (!kv || /^["'[{|>]/.test(kv[2])) continue;
      assert.ok(!/:\s/.test(kv[2]), path.basename(path.dirname(file)) + '/' + path.basename(file) + ': ' + kv[1] + ' — значение с «: » без кавычек');
    }
  }
});

const skill = (name) => frontmatter(path.join(PLUGIN, 'skills', name, 'SKILL.md'));

test('коммит — скрипт kit-commit.js, агента git-keeper нет (К54, с 2.14.0)', () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'agents', 'git-keeper.md')), 'агент git-keeper удалён');
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(md|js|json|php)$/.test(e.name)) files.push(p);
  });
  walk(PLUGIN);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(PLUGIN, f).replace(/\\/g, '/');
    assert.ok(!src.includes('kit:git-keeper'), rel + ': агента kit:git-keeper больше нет');
    assert.ok(!src.includes('git-keeper'), rel + ': упоминание git-keeper');
  }
  const { body } = skill('project-init');
  for (const s of ['kit-commit.js', 'Проектные копии старых агентов kit']) assert.ok(body.includes(s), s);
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

const ref = (name) => fs.readFileSync(path.join(PLUGIN, 'skills', 'step-done', 'reference', name), 'utf8');

test('step-done: ядро — kit-step.js → блоки → kit-journal.js → просмотр → kit-commit.js --inbox; не больше 14 КБ, ветки — в справках (3.0.0)', () => {
  const file = path.join(PLUGIN, 'skills', 'step-done', 'SKILL.md');
  assert.ok(fs.statSync(file).size <= 14336, 'ядро step-done — ' + fs.statSync(file).size + ' байт');
  const { fm, body } = skill('step-done');
  assert.equal(fm.name, 'step-done');
  assert.ok(fm.description.length > 40 && fm.description.includes('Claude по SSH'));
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  for (const s of ['scripts/kit-step.js"', "scripts/kit-journal.js\" <<'KIT_BLOCKS'", 'scripts/kit-commit.js" --inbox', "<<'KIT_MSG'", 'Co-Authored-By', '**Bash**',
    'reference/ssh.md', 'reference/stage-close.md', 'reference/push.md', '/kit:project-init', 'Код 3', 'Код 4', '<CHECK дословно>',
    '«Коммитить»', '«Есть вопросы — оставлю комментарии»', '«Не коммитить пока»', 'mcp__ccd_view__show_pane', '`uncommitted`', 'mcp__ccd_view__get_layout',
    'mcp__ccd_view__close_pane', 'Ctrl+Enter', '«Заменяет №N»', '«Решения агента на этом шаге (можно возразить)»', 'Правило: <что изменилось>',
    'описание выбранного варианта', '/kit:visual', '.claude/scripts/visual/pages.json', 'git -c core.quotepath=false']) {
    assert.ok(body.includes(s), s);
  }
  const order = ['## 1. Подготовка', '## 2. Блоки', '## 3. Журнал', '## 4. Просмотр', '## 5. Коммит', '## 6. Ответ пользователю'].map((t) => body.indexOf(t));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'порядок: подготовка → блоки → журнал → просмотр → коммит → ответ');
  for (const old of ['COMMITS', 'Коммит: сразу', '«Работает»', 'general-purpose', 'decision-inbox.js']) assert.ok(!body.includes(old), 'осталось: ' + old);
});

test('step-done: справки ssh.md, stage-close.md, push.md — порядок SSH, закрытие этапа, отправка (3.0.0)', () => {
  const ssh = ref('ssh.md');
  for (const s of ['scripts/ssh-deploy.js" --go', '«Залить на сервер»', '«Не заливать пока»', 'свежий сухой прогон', '«Повторить заливку» / «Остановиться»', 'повтор безопасен',
    '«Добавить в «Не выкладывать» (Рекомендую)» / «Остановиться»', '«В этот шаг (уедут на сервер и в коммит)» / «Остановиться — разберусь с ними»',
    'уезжает на сервер всё равно', '**Отказ от шага**', 'ssh-deploy.js" --go -- <пути>', 'DEPLOY Файлы:', 'scripts/ssh-deploy.js" --go --docs',
    '«Повторить заливку документов» (Рекомендую) / «Остановиться»', 'после проверки на сервере — коммит, а при заданном «Удалённом репозитории» — и отправка', 'browser_batch']) {
    assert.ok(ssh.includes(s), 'ssh.md: ' + s);
  }
  assert.ok(!ssh.includes('«Работает»'), 'ssh.md: без проверки руками пользователя («Код пишет: пользователь» удалён)');
  const sc = ref('stage-close.md');
  for (const s of ['`| Пункт | Шаги | Итог |`', '«В «Баги на потом» (Рекомендую)» / «На следующий этап» / «Не делаем — решением»', 'RECONCILE: ГГГГ-ММ-ДД | этап N | сверено с:',
    'не уверен — «частично» с пояснением', '«Все в archive/ (Рекомендую)»', '«Оставить в work/»', 'Move-Item -LiteralPath', '**оба** пути, старый и новый',
    'git увидит переименование', '(`постоянный` кандидатом не бывает)', '`git ls-files <старый путь>` пусто', 'scripts/journal-split.js" --stage <N>']) {
    assert.ok(sc.includes(s), 'stage-close.md: ' + s);
  }
  assert.ok(sc.indexOf('kit-journal.js') >= 0 && sc.indexOf('kit-journal.js') < sc.indexOf('journal-split.js" --stage'), 'перенос этапа — после записи журнала');
  const push = ref('push.md');
  for (const s of ['нет сети, входа или вышло время', 'на удалённом есть коммиты, которых здесь нет', 'в истории секреты', 'в истории запрещённые пути',
    '«Отправить как есть» / «Не отправлять»', '`--force`, `pull`, `rebase`', 'Git Credential Manager', 'коммит остаётся локально']) {
    assert.ok(push.includes(s), 'push.md: ' + s);
  }
});

test('docs-keeper нет: ни агента, ни упоминаний в плагине, README и описании маркетплейса (3.0.0)', () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'agents', 'docs-keeper.md')), 'агент docs-keeper удалён');
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p);
    } else if (/\.(md|js|json|php)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('docs-keeper')) hits.push(path.relative(PLUGIN, p));
  });
  walk(PLUGIN);
  for (const f of ['README.md', '.claude-plugin/marketplace.json']) if (fs.readFileSync(path.join(PLUGIN, '..', '..', f), 'utf8').includes('docs-keeper')) hits.push(f);
  assert.deepEqual(hits, []);
});

test('report: отчёт заказчику простыми словами, период, без внутренних подробностей, дата — заметкой во входящие', () => {
  const { fm, body } = skill('report');
  assert.equal(fm.name, 'report');
  assert.ok(fm.description.length > 40);
  for (const s of ['«Отчёт заказчику: ГГГГ-ММ-ДД …»', 'с начала текущего этапа', 'git log --since=<дата> --format="%ad %s" --date=short', '«Залито на прод»',
    '«Кто: агент»', 'Внутренние решения о процессе и инструментах', '«Баги на потом» без `✅`', '**Не включай никогда:**', 'хеши коммитов, ID шагов, пути и имена файлов',
    'Раздел без пунктов не выводи', 'Нужно ваше подтверждение', '**Без кухни разработки:**', 'Из описаний шагов не бери', '**Журнал по частям**', '`journal/stages/stage-NN.md`', 'только по просьбе', 'decision-inbox.js" --note "Отчёт заказчику:',
    'по ID в начале заголовка', 'git log --format="%h %s"', 'при «Выкладка: PhpStorm Always» — шаги, закоммиченные в периоде']) {
    assert.ok(body.includes(s), s);
  }
  assert.doesNotMatch(body, /docs-keeper"|git commit|git add/, 'отчёт ничего не коммитит');
});

test('финальное ревью этапа 32: точка отсчёта заливки в project-init', () => {
  const pi = skill('project-init').body;
  for (const s of ['**Точка отсчёта заливки**', '«Сервер совпадает с проектом — записать точку отсчёта»']) assert.ok(pi.includes(s), 'project-init: ' + s);
});

test('«Документы на сервере» в режиме «Claude по SSH»: вопрос и первая заливка в project-init, шаблоны (этап 35)', () => {
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

test('report: таблица «Залито» по окружению (этап 32)', () => {
  assert.ok(skill('report').body.includes('«Залито на дев»'));
});

test('/kit:why и /kit:deploy-list удалены: ни скиллов, ни скрипта, ни упоминаний в плагине и README (3.0.0)', () => {
  for (const p of ['skills/why', 'skills/deploy-list', 'scripts/deploy-list.js']) assert.ok(!fs.existsSync(path.join(PLUGIN, p)), 'осталось: ' + p);
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p);
    } else if (/\.(md|js|json|php)$/.test(e.name) && /deploy-list|kit:why/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(PLUGIN, p));
  });
  walk(PLUGIN);
  if (/deploy-list|kit:why/.test(fs.readFileSync(path.join(PLUGIN, '..', '..', 'README.md'), 'utf8'))) hits.push('README.md');
  assert.deepEqual(hits, []);
});

test('project-init: только командой, все шаги и шаблоны на месте', () => {
  const { fm, body } = skill('project-init');
  assert.equal(fm.name, 'project-init');
  assert.equal(fm['disable-model-invocation'], 'true');
  for (const s of ['AskUserQuestion', 'secret-scan.js', 'site-probe.js', 'check-closed.js', 'deployment.xml', 'watcherTasks.xml',
    'webServers.xml', '0.1: Исходники с прода (копия прода)', 'journal/decisions.md`, `journal/bugs.md`, `journal/reference.md` (журнал по частям', 'journal-split.js" --migrate', 'kit-commit.js', '/kit:step-done', 'core.autocrlf', 'core.quotepath',
    'Варианта «это не секрет» нет', '4.0', 'сам не коммить', 'не больше 4 вопросов', 'Grep с `-o` по `rootFolder=',
    '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --also', '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --check --also', 'Код 2 — `deployment.xml` не разобран',
    'File → Reload All from Disk', '`.idea`, `.git` и `.claude` исключаются всегда', '«Больше ничего»', 'сервера автозаливки',
    'это сервер окружения', 'норма — 404 «нет на сервере»',
    '4.5 Проверки выкладки — любой режим, если известен адрес сервера (прод, дев или адрес из п. 4.0)', 'Проверяй адрес сервера окружения',
    '### 4.7 Переезд на формат kit 3.0', '### 4.8 Закрыть шаг', 'git check-ignore -q .claude/docs/progress.md', '`!/.claude/docs/`, `!/.claude/docs/**`',
    'git remote -v', '### 4.1а Удалённый репозиторий', 'git remote add origin <адрес>', 'Удалённый репозиторий: origin',
    'закрытым и **пустым**', 'с логином, паролем или токеном', 'Git Credential Manager', 'git remote set-url origin <адрес>',
    'git ls-remote --heads origin', 'он создан не пустым',
    'Журнал уже есть в любой раскладке', 'не переносить вовсе', 'документы на все этапы (спек, замечания) — `постоянный`', '`archive/…` — `готово, этап N (ГГГГ-ММ-ДД)`',
    '--dirs docs', '**до** переноса', 'Таблица «файл → куда»', 'одной записью `.claude`', 'show --stat -M HEAD', '`/kit:step-done` (п. 4.8)',
    'ssh-probe.js', 'reference/ssh.md', 'SSH прод', 'SSH дев', 'PHP на сервере', 'Host key verification failed', '«SSH нет»',
    'только строки `Host`, `HostName`, `User`', '[совпадает]', '/kit:server',
    'Grep `-i` по `^\\s*(Host|HostName|User)(\\s*=\\s*|\\s+)\\S`', 'строки целиком, без `-o`', 'шаблоны с `*`, `?`, `!` в варианты не брать',
    'решение пользователя важнее догадки', '«HostName совпал с доменом»', 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
    'Код 4 — хост недопустим', 'порт — только через `~/.ssh/config`', 'Код 1 — скрипт разведки не доработал',
    'в общем режиме выполнить на сервере негде']) {
    assert.ok(body.includes(s), s);
  }
  for (const line of body.split('\n').filter((l) => l.includes('~/.ssh/config'))) {
    assert.ok(!line.includes('с `-o`'), 'строки ~/.ssh/config — целиком, без -o: ' + line);
  }
  assert.ok(!body.includes('первая отправка будет отклонена'), 'непустой репозиторий на GitHub (ветка main) push не отклоняет — рядом появится master');
  const tpl = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8');
  assert.ok(tpl.includes('| SSH нет — выполнить на сервере негде (`/kit:server` работает только по SSH; включить SSH — справка reference/ssh.md)'), 'шаблон: третий вариант «Работа на сервере»');
  assert.ok(tpl.includes('SSH нет — `/kit:server` работает через файл `kit-exec.php`'), 'шаблон: второй вариант — файл-канал');
  assert.doesNotMatch(tpl + body, /Командн|канал «консоль»|консоль — запасной/, 'консоли больше нет');
  for (const s of ['`^\\s*Include\\s+\\S`', 'вложенные `Include` — до глубины 2', 'файлы из `Include` — только ради этих строк',
    '5. «SSH нет»: режим bitrix с адресом', 'строка `/kit-exec.php` попадёт в `.gitignore`', 'Как включить SSH у хостинга']) {
    assert.ok(body.includes(s), s);
  }
  const q3 = /3\. Исключения деплоя[^\n]*/.exec(body)[0];
  assert.deepEqual(q3.split('. В тексте вопроса')[0].match(/«[^»]*»/g),['«`.gitignore`»', '«`local/modules`»', '«Больше ничего»'], 'варианты вопроса про исключения: ' + q3);
  const i47 = body.indexOf('#### Перенос `docs/` в `.claude/docs`');
  assert.ok(i47 > 0, 'подраздел «Перенос docs/ в .claude/docs» в п. 4.7');
  const steps = ['1. **Исключения.**', '2. **`.gitignore`.**', '3. **Старые копии на сервере.**', '4. **Таблица «файл → куда»**', '5. **Перенос**', '6. **Закрытие**'].map((t) => body.indexOf(t, i47));
  assert.ok(steps.every((v, i) => v > i47 && (i === 0 || v > steps[i - 1])), 'переезд: исключения → .gitignore → старые копии → таблица → перенос → закрытие');
  assert.ok(!body.includes('docs/.htaccess` и `.claude/.htaccess`'), 'docs/.htaccess — только при старой раскладке');
  for (const s of ['`autoUpload="Always"` / `myAutoUpload` = `ALWAYS`', 'Дальше — только при автозаливке (в любом режиме)',
    '| PhpStorm Always | `PhpStorm Always` |', '| Claude по SSH | `Claude по SSH` |',
    '| вручную списком файлов | `вручную` |']) {
    assert.ok(body.includes(s), s);
  }
  const pstorm = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8');
  for (const s of ['`.claude/worktrees`', '## Что исключать — хук `phpstorm-exclude.js`', 'Всегда: `.idea`, `.git`, `.claude`', 'File → Reload All from Disk', 'маски (`*.back*`)',
    'Tools → Deployment → Automatic Upload']) {
    assert.ok(pstorm.includes(s), 'phpstorm.md: ' + s);
  }
  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: \{\{ИСКЛЮЧЕНИЯ — через запятую: всегда \.idea, \.git, \.claude;/);
  for (const t of ['CLAUDE.md', 'progress.md', 'deploy-prod.md', 'gitignore-bitrix', 'gitignore-general', 'htaccess-deny']) {
    assert.ok(body.includes('`' + t + '`'), 'скилл не называет шаблон ' + t);
    assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', t)), 'нет шаблона ' + t);
  }
});

test('project-init: вопрос «Документы на сервере» — при автозаливке и «Claude по SSH», шаблон пишет ответ (К55, этап 35)', () => {
  const { body } = skill('project-init');
  for (const s of ['вопрос «Документы на сервере»', 'При «вручную» вопрос не задавай', 'Параметр «Документы на сервере» — ответ на вопрос «Документы на сервере»',
    'исключение `.claude` сменится поимённым', '[kit] Документы на сервер не уедут', 'при «Документы на сервере: да» — 403']) {
    assert.ok(body.includes(s), s);
  }
  const tpl = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8');
  assert.match(tpl, /^- Документы на сервере: \{\{да \| нет\}\}$/m);
  assert.ok(tpl.includes('| из `.claude/` автозаливка везёт на сервер только документы'), 'шаблон: вариант строки про .claude при «да»');
});

test('project-init: выкладка — после SSH, варианты по окружению; автозаливка выключена на время настройки; этап 0 закрывается (этап 31)', () => {
  const { body } = skill('project-init');
  const at = (s, from = 0) => { const i = body.indexOf(s, from); assert.ok(i >= 0, 'нет: ' + s); return i; };
  // Первый вызов вопросов — без выкладки; вопрос «Выкладка» — после разведки SSH и до плана на согласие.
  const call1 = body.slice(at('Первый вызов'), at('Второй вызов'));
  assert.doesNotMatch(call1, /^\d\. Как файлы попадают/m, 'в первом вызове нет вопроса о выкладке: окружение ещё неизвестно');
  assert.ok(call1.includes('после SSH (раздел «Выкладка» ниже)'));
  const ssh = at('### SSH — после site-probe');
  const deploy = at('### Выкладка — после SSH');
  const plan = at('## 3. План на согласие');
  assert.ok(ssh < deploy && deploy < plan, 'порядок: SSH → выкладка → план на согласие');
  const sect = body.slice(deploy, plan);
  for (const s of ['«PhpStorm Always» / «Claude по SSH» / «вручную списком файлов»', '«Claude по SSH» — только если SSH-разведка']) {
    assert.ok(sect.includes(s), 'варианты выкладки: ' + s);
  }
  assert.ok(sect.indexOf('Как файлы попадают на сервер') < sect.indexOf('вопрос «Документы на сервере»'), '«Документы на сервере» — после ответа о выкладке');
  assert.ok(!body.includes('расходится с разведкой'), 'отдельного вопроса о расхождении нет — его снимает выключение автозаливки');
  // Автозаливка: выключить в начале п. 4.0 (до исключений), включить и залить нужное в п. 4.8 до /kit:step-done.
  const s40 = at('### 4.0');
  const off = at('Tools → Deployment → Automatic Upload', s40);
  assert.ok(off < at('1. Дописать исключения', s40), 'автозаливку выключают до исключений');
  assert.ok(body.slice(s40, at('### 4.1 ')).includes('File → Save All'));
  const s48 = at('### 4.8 Закрыть шаг');
  const on = body.slice(s48, at('`/kit:step-done`:', s48));
  for (const s of ['включает автозаливку', 'Upload to', '`.claude/.htaccess` — первым', 'check-closed.js']) assert.ok(on.includes(s), 'п. 4.8: ' + s);
  // Этап 0 — только инициализация: шаг 0.2 закрывает его, следующий — этап 1.
  for (const s of ['STAGE `1 — ', '«1.1 — изучение задачи»']) assert.ok(body.slice(s48).includes(s), 'п. 4.8: ' + s);
  assert.ok(!body.includes('0.3 — изучение задачи'), 'рабочие шаги — не в этапе 0');
});

test('project-init: переезд на формат kit 3.0 — пункт плана на каждый признак, вопрос о скиллах Битрикса, без «Код пишет» и «Коммит» (этап 36)', () => {
  const { body } = skill('project-init');
  // Скиллы Битрикса — отдельный вопрос при каждом запуске (раздел 2), а не строка плана на согласие.
  const q = body.indexOf('«Ставить скиллы Битрикса?»');
  assert.ok(q > 0 && q < body.indexOf('## 3. План на согласие'), 'вопрос о скиллах — в разделе 2');
  for (const s of ['«Да (Рекомендую)»', '«Нет» — не ставить, уже поставленные не трогать', 'уже поставленные обновляются до последних']) {
    assert.ok(body.includes(s), s);
  }
  // Переезд: признаки — из правила хука; строка плана на признак; отказ — kit 3.0 шаги не закрывает.
  for (const s of ['переезд на формат kit 3.0', 'в старом формате (', 'kit 3.0 в проекте шаги не закрывает', 'journal-split.js" --migrate',
    'вставь столбец «Как проверено»', '`С kit 2.8 — с обоснованием:`', '**Окружение: дев+прод**', '**Выкладка: вручную; дев — PhpStorm Always**',
    'Строки параметров «Код пишет» и «Коммит» (с 3.0.0 их нет) — предложи убрать']) {
    assert.ok(body.includes(s), s);
  }
  assert.ok(!body.includes('«Перевести на части (Рекомендую)»'), 'журнал на части — пункт переезда, без отдельного вопроса');
  const s48 = body.slice(body.indexOf('### 4.8 Закрыть шаг'));
  assert.ok(s48.includes('переезд на kit 3.0'), 'п. 4.8: шаг переезда — в текущем этапе или новый этап «переезд на kit 3.0»');
  // Удалённые режимы: вопроса «кто пишет код» и параметра «Коммит» нет.
  assert.ok(!/Кто пишет код/.test(body), 'вопроса «Кто пишет код» нет');
  assert.ok(!body.includes('Параметр «Коммит» — `после просмотра`'), 'указаний о параметре «Коммит» нет');
});

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

test('server: сначала SSH (BatchMode, remote-php, --timeout, коды), иначе файл kit-exec.php; правила изменений', () => {
  const { fm, body } = skill('server');
  assert.equal(fm.name, 'server');
  assert.notEqual(fm['disable-model-invocation'], 'true');
  assert.ok(fm.description.length > 40);
  for (const s of [
    'SSH прод', 'SSH дев', 'PHP на сервере', '-o BatchMode=yes -o ConnectTimeout=15', '${CLAUDE_PLUGIN_ROOT}/scripts/remote-php.js',
    '--bitrix', '--plain', '--timeout', 'под `timeout` сервера', 'Host key verification failed', 'accept-new', 'Permission denied (publickey)',
    'This account is currently not available', 'результат неизвестен', 'kit-backup', '`rm` по списку не использовать',
    'reference/ssh.md', 'Как включить SSH у хостинга', 'NOT_CHECK_PERMISSIONS', 'Одно согласие — одно действие', 'Окна подтверждения в браузере нет',
    'без `<?php`', 'без `use`', '$dryRun', 'AskUserQuestion', 'inventory.php', 'delete-list.php',
    'check-files.php', 'md5-check.js', '.claude/scripts/',
    'MSYS_NO_PATHCONV=1', "MSYS2_ARG_CONV_EXCL='*'", 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
    '`.settings_extra.php`', 'не `cat`', 'не править `sed -i`', 'обе команды (копия и правка)', '`~` не внутри папки сайта',
    '`$allowedMasks`', '`$backupDir`', "`$base = '/'`", "`'*.php.back*'`", 'не `\'*.back*\'`', 'Стоп-лист', 'стоп-лист не править',
    '«Копии — в …»', 'копии <папка>', 'Папки скрипт не удаляет', 'max_execution_time',
    // файл-канал
    'kit-exec.php', '${CLAUDE_PLUGIN_ROOT}/scripts/kit-exec.js', '$USER->IsAdmin()', 'kit: только для администратора', 'KIT-RUN', '?run=',
    'Открытие страницы = выполнение кода', 'открывай один раз и только после согласия пользователя', 'Только режим `bitrix` и заданный адрес сервера',
    'mcp__Claude_Browser__tabs_create', 'mcp__Claude_Browser__navigate', 'mcp__Claude_Browser__get_page_text', 'mcp__Claude_Browser__tabs_close',
    'войти администратором', 'пароли вводит только он', 'корень **основной** папки', 'Каждый запуск заменяет прежний', '/kit-exec.php', '.gitignore',
    'не добавляй ни в «Не выкладывать», ни в Excluded Paths', 'Deployment → Upload to…', 'PhpStorm → Remote Host', 'Удалить с сервера',
    'файл удаляешь ты, а не пользователь', 'unlink(__FILE__)', 'KIT-DELETED', 'KIT-DELETE-FAILED', 'Маркеры — латиницей', 'kit-exec.php удалён ✅',
    'с **другим** номером', 'код не выполнялся', 'Ошибка: … (строка N кода)', 'без строки `KIT-RUN`',
    // повтор страницы: только когда код точно не выполнялся; успех — не «неизвестно»; пустая страница для изменяющего кода — «неизвестно»
    'точно известно, что код не выполнялся', 'код выполнен: адрес больше не открывай', 'для изменяющего кода это «результат неизвестен»',
    // вход админом, заголовки, php -l обязателен, UTF-8, функции — до вызова, удаление на нескольких серверах
    '<адрес сайта>/bitrix/admin/', 'kit: headers already sent', 'без проверки файл не собирается', 'не в UTF-8', 'объявляй **до** вызова', 'удаляй последним',
    'по умолчанию 90', 'написанные до 2.4.0']) {
    assert.ok(body.includes(s), s);
  }
  assert.ok(!body.includes('foreground: true'), 'вкладку вперёд выводит tabs_select: параметр foreground есть только у tabs_create, а вход нужен уже после создания вкладки');
  assert.ok(!body.includes("'kit-exec.php удалён с сервера'"), 'маркеры удаления — латиницей: русский текст в коде на сайте в windows-1251 превращается в кракозябры');
  assert.ok(!body.includes('ни при каком результате'), 'правило повтора не должно противоречить повторам при 403/404');
  assert.ok(!body.includes('$allowedExt'), 'расширения заменены масками');
  assert.doesNotMatch(body, /консол|Командн|Chrome|BXCodeEditors|__FPHPSubmit|php_command_line|window\.confirm/, 'канала через Chrome и Командную PHP-строку больше нет');
  const i = ['### 3.1', '### 3.2', '### 3.3', '### 3.4'].map((h) => body.indexOf(h));
  assert.ok(i.every((v, k) => v > 0 && (k === 0 || v > i[k - 1])), 'файл-канал: собрать → доставить → открыть → завершить');
  assert.ok(body.indexOf('kit-exec.js') < body.indexOf('mcp__Claude_Browser__navigate'), 'сначала сборка, потом открытие страницы');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'skills', 'bitrix-console')), 'старая папка скилла удалена');
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'ssh.md'), 'utf8');
  for (const s of ['ssh-keygen -t ed25519', 'authorized_keys', 'chmod 700', 'chmod 600', 'Доступ к shell', 'BatchMode=yes',
    'IdentityFile', '/opt/php74/bin/php', 'bitrix', 'Закрыть доступ', 'REMOTE HOST IDENTIFICATION HAS CHANGED', 'ssh-keygen -R',
    'Без доступа к shell ключ не класть', '## Как включить SSH у хостинга']) {
    assert.ok(ref.includes(s), 'ssh.md: ' + s);
  }
  assert.doesNotMatch(ref, /Командн|канал «консоль»/, 'ssh.md: консоли больше нет');
});

test('visual: сценарий, коды, согласие на установку, вход пользователем, фон, NOTES; пример справки проходит проверку', () => {
  const { fm, body } = skill('visual');
  assert.equal(fm.name, 'visual');
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  assert.ok(fm.description.length > 40);
  for (const s of ['${CLAUDE_PLUGIN_ROOT}/scripts/visual.js', '.claude/scripts/visual/pages.json', '`.claude/docs/visual/…`', '`docs/visual/…`', '<папка снимков>/compare-', '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js', '%LOCALAPPDATA%\\kit\\visual\\deps',
    'deps', 'install', 'login', 'discover / catalog/ personal/', 'shoot before', 'check before', 'compare before after-', 'after-10.5a', '--only', '--no-setup', '--env дев',
    'AskUserQuestion', 'run_in_background', 'Пароли вводит только пользователь', '"unsafe": true', 'Excluded Paths', 'noise.json', 'report.html',
    'summary.json', 'Статусы и ошибки', 'через Read', '/kit:step-done', 'NOTES', 'не коммитить и не выкладывать', 'Git Bash', '`.idea` не править']) {
    assert.ok(body.includes(s), s);
  }
  for (const code of ['| 0 |', '| 1 |', '| 2 |', '| 3 |', '| 4 |', '| 5 |']) assert.ok(body.includes(code), 'код ' + code);
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'visual', 'reference', 'pages.md'), 'utf8');
  for (const s of ['clickAccept', 'fullPage', 'viewports', 'setup', 'teardown', 'unsafe', 'login', 'hide', 'mask', 'danger', 'COPY_ORDER', 'sessid']) {
    assert.ok(ref.includes(s), 'pages.md: ' + s);
  }
  const { validateConfig } = require('../plugins/kit/scripts/lib/visual/config');
  const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(ref)[1]);
  assert.deepEqual(validateConfig(example, 'bitrix').contexts.map((c) => c.name), ['guest', 'admin']);
});

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

test('в плагине нет канала через Командную PHP-строку и Claude in Chrome (удалён в 2.4.0)', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/Командн\S*\s+(PHP-строк|строк\S*\s+PHP)|php_command_line|BXCodeEditors|__FPHPSubmit|claude-in-chrome|канал\s+«консоль»/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(PLUGIN, p));
    }
  };
  walk(PLUGIN);
  assert.deepEqual(hits, []);
});

module.exports = { frontmatter, skill };

test('скиллы Битрикса: project-init ставит их bitrix-skills.js (п. 4.6, только bitrix), шаблон CLAUDE.md — правило пользоваться ими', () => {
  const read = (...p) => fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', ...p), 'utf8');
  const init = read('SKILL.md');
  assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'bitrix-skills.js')));
  for (const s of ['node "${CLAUDE_PLUGIN_ROOT}/scripts/bitrix-skills.js"', 'git check-ignore -q .claude/skills/bitrix-framework/SKILL.md',
    '`/.claude/skills/`', 'без `bitrix24-*`', '«Ставить скиллы Битрикса?»']) {
    assert.ok(init.includes(s), 'project-init: ' + s);
  }
  const tpl = read('templates', 'CLAUDE.md');
  assert.match(tpl, /Код на Битриксе — по скиллам в `\.claude\/skills\/`: начинай с `bitrix-framework`/);
  assert.match(tpl, /нет `\.claude\/skills\/bitrix-framework\/` \(например, после `git clone` на другом компьютере\) — поставь их через `\/kit:project-init`\. \| \(режим «общий» — строки нет\)\}\}/);
});
