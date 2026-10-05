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
  for (const a of fs.readdirSync(path.join(PLUGIN, 'agents'))) files.push(path.join(PLUGIN, 'agents', a));
  assert.ok(files.length >= 7, 'нашлось файлов: ' + files.length);
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

const agent = (name) => frontmatter(path.join(PLUGIN, 'agents', name + '.md'));
const skill = (name) => frontmatter(path.join(PLUGIN, 'skills', name, 'SKILL.md'));

test('docs-keeper: sonnet, без оболочки, читает параметры, COMMITS и отчёт со списком файлов', () => {
  const { fm, body } = agent('docs-keeper');
  assert.equal(fm.name, 'docs-keeper');
  assert.equal(fm.model, 'sonnet');
  assert.equal(fm.tools, 'Read, Edit, Write, Grep, Glob');
  assert.ok(fm.description.length > 40);
  for (const s of ['Параметры для агентов', 'COMMITS', 'STEP', 'DEPLOY', 'RULES', 'Сейчас', 'Залито на прод', 'Удалить с сервера', 'список изменённых файлов', '/kit:project-init', 'не нашёл строку',
    '**DOCS**', '`.claude/docs/progress.md`', 'а если его нет, но есть `docs/progress.md`', '**папка документов**', '`deploy-prod.md` в папке документов',
    '«Решения», «Документы», этапы', '| Файл | О чём | Статус |', '(было <старый путь>)', 'в работе, этап N', 'готово, этап N (ГГГГ-ММ-ДД)', 'перенос в архив делает `/kit:step-done`',
    '`постоянный` (документ на все этапы',
    '`—` — следующего шага нет', 'строку шага не добавляй и ничего не помечай `⏳`',
    '`ГГГГ-ММ-ДД | решение | почему | что отвергли | пользователь`', '| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |',
    'старого формата `| Дата | Решение |` — в неё не дописывай', '`С kit 2.8 — с обоснованием:`', 'не записано: нет "почему"',
    '` → заменено №M`', '`Правило: <что изменилось>`',
    '**RECONCILE**', '8а. RECONCILE — под таблицей этапа N', '`Сверка ГГГГ-ММ-ДД (сверено с: <…>): пунктов M, сделано K; расхождения: <…>.`', '`на следующий этап (сверка этапа N): <пункты>`',
    '**CHECK**', '«нет CHECK»', '`| Шаг | Статус | Что сделано | Как проверено | Коммит |`', '`SUMMARY; проверено: CHECK`', 'ищи по заголовку колонки']) {
    assert.ok(body.includes(s), s);
  }
  assert.ok(fm.description.includes('DOCS'));
});

test('git-keeper: haiku, один коммит, COAUTHOR дословно, запреты, secret-scan', () => {
  const { fm, body } = agent('git-keeper');
  assert.equal(fm.name, 'git-keeper');
  assert.equal(fm.model, 'haiku');
  assert.equal(fm.tools, 'PowerShell, Bash, Read, Grep, Glob');
  for (const s of ['COAUTHOR', 'дословно', 'не больше одного коммита', '--diff-filter=D', 'secret-scan.js', 'KIT_ROOT',
    'Не коммитить', 'push', 'commit --amend', 'git add .', '--no-verify', 'stash', 'reset',
    'FILES пуст', 'пустым списком путей', 'отдельный аргумент',
    'только в одинарных кавычках', "MSYS_NO_PATHCONV=1 git commit -m '<MESSAGE>'", "'\\''Купить'\\''", '**всегда из Bash**', 'первый символ каждого `-m`',
    'git -c core.quotepath=false status --porcelain=v1', 'git -c core.quotepath=false diff --cached --name-only --diff-filter=D',
    'components/bitrix/', 'заголовок отличается от MESSAGE', 'MSYS_NO_PATHCONV=1 git commit', '--paths -- <FILES>', 'до `git add`', 'список здесь не дублируется', '-- ".claude/docs/progress.md"']) {
    assert.ok(body.includes(s), s);
  }
  assert.doesNotMatch(body, /\.pem|\.settings_extra\.php|dbconn\.php/, 'базовый список запрещённых путей живёт в secret-scan.js, а не в тексте агента');
  assert.ok(!body.includes('remote нет'));
  assert.ok(body.includes('BODY в сообщении отличается от переданного'), 'git-keeper сообщает о расхождении BODY (К42)');
  assert.ok(body.includes('BODY: совпал дословно / отличается'), 'в отчёте git-keeper — сверка BODY (К42)');
  assert.ok(body.includes('уже лежат в индексе (например, после прошлой остановки), добавляй всё равно'), 'git add — и для файлов, уже лежащих в индексе (К43)');
  assert.ok(body.includes('это делает `/kit:step-done` после проверки коммита'));
  assert.doesNotMatch(body, /Co-Authored-By: Claude/, 'подпись не зашивается в агента');
  assert.doesNotMatch(body, /-m "</, 'сообщение коммита не в двойных кавычках');
  assert.doesNotMatch(body, /- PowerShell: `git commit/, 'коммит не из PowerShell: обратная кавычка там — экранирование, BODY терял её');
  assert.doesNotMatch(body, /^\s*git (status|diff --cached --name)/m, 'пути — только с core.quotepath=false');
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

test('step-done: агенты kit:, один коммит, COAUTHOR, запасной путь', () => {
  const { fm, body } = skill('step-done');
  assert.equal(fm.name, 'step-done');
  assert.ok(fm.description.length > 40);
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  for (const s of ['kit:docs-keeper', 'kit:git-keeper', 'rev-list --count', 'COAUTHOR', 'COMMITS', 'KIT_ROOT',
    'AskUserQuestion', 'general-purpose', '/kit:project-init', 'Сам коммит не делай',
    'git log -1 --format=%s', 'совпадает с MESSAGE целиком', 'git -c core.quotepath=false status --porcelain=v1',
    '/kit:visual', '<папка документов>/visual/', '.claude/scripts/visual/pages.json',
    '`.claude/docs/progress.md`', '**папка документов**', '`DOCS`', 'work/<имя> — <о чём> — в работе, этап N', '### Закрытие этапа — архив',
    '«Все в archive/ (Рекомендую)»', '«Оставить в work/»', 'Move-Item -LiteralPath', 'без git', '**оба** пути, старый и новый', 'git увидит переименование',
    '<старые и новые пути документов, перенесённых в архив>',
    '(`постоянный` кандидатом не бывает)', 'статусом `в работе, этап <номер следующего этапа>`', '`git ls-files <старый путь>` пусто', '`NEXT` пустой или `—` при `STEP` вида `N.M`', 'ID не вида `N.M` (`Р6а`) — только по `STAGE`',
    '### Закрытие этапа — сверка', '`| Пункт | Шаги | Итог |`', '«В «Баги на потом» (Рекомендую)» / «На следующий этап» / «Не делаем — решением»',
    'RECONCILE: ГГГГ-ММ-ДД | этап N | сверено с:', 'строка «Сверка …» из `RECONCILE`', 'не уверен — «частично» с пояснением',
    '## 5а. Отправка в удалённый репозиторий', 'Удалённый репозиторий', 'git rev-parse --verify --quiet refs/remotes/<имя>/<ветка>',
    '${CLAUDE_PLUGIN_ROOT}/scripts/secret-scan.js" --history', 'git push -u <имя> HEAD', 'Git Credential Manager',
    '`--force`, `pull`, `rebase` и слияния — только после его явного выбора', 'коммит остаётся локально',
    'находки только «запрещённый путь»', '«Отправить как есть» / «Не отправлять»',
    'BODY (если передавался) есть в сообщении дословно', 'шаг на этом не останавливается',
    '`ГГГГ-ММ-ДД | решение | почему | что отвергли (или —) | пользователь / агент`', 'Не больше 1–3 за шаг', 'не придумывай',
    '«Заменяет №N»', 'не записано: нет "почему"', '«Решения агента на этом шаге (можно возразить)»',
    'CHECK: …', 'BODY: <CHECK дословно>', '`SUMMARY` (одна строка: что сделано)',
    '**Входящие ответы**', '${CLAUDE_PLUGIN_ROOT}/scripts/decision-inbox.js" --list', 'Запомни N из последней строки «записей: N»', 'Процедурные ответы пропусти',
    '${CLAUDE_PLUGIN_ROOT}/scripts/decision-inbox.js" --clear N', 'входящие не трогай']) {
    assert.ok(body.includes(s), s);
  }
  const i5 = body.indexOf('## 5. Проверка');
  const i5a = body.indexOf('## 5а. Отправка в удалённый репозиторий');
  assert.ok(i5 > 0 && i5a > i5 && i5a < body.indexOf('## 6. Ответ пользователю'), 'отправка — после проверки коммита');
  const iList = body.indexOf('decision-inbox.js" --list');
  const iClear = body.indexOf('decision-inbox.js" --clear N');
  assert.ok(iList > 0 && iList < body.indexOf('## 3. docs-keeper') && iClear > i5 && iClear < i5a, 'входящие: чтение — до docs-keeper, очистка — после проверки коммита');
  const iArchive = body.indexOf('### Закрытие этапа — архив');
  assert.ok(iArchive > 0 && iArchive < body.indexOf('## 3. docs-keeper'), 'архив — до вызова docs-keeper');
  const iRec = body.indexOf('### Закрытие этапа — сверка');
  assert.ok(iRec > 0 && iRec < iArchive, 'сверка — до архива: документы этапа ещё в work/');
  assert.doesNotMatch(body, /^\s*git status/m, 'пути — только с core.quotepath=false');
});

test('deploy-list: вызывает скрипт и записывает выкладку через step-done', () => {
  const { fm, body } = skill('deploy-list');
  assert.equal(fm.name, 'deploy-list');
  assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/scripts/deploy-list.js'));
  assert.ok(body.includes('/kit:step-done'));
  assert.ok(body.includes('DEPLOY'));
});

test('project-init: только командой, все шаги и шаблоны на месте', () => {
  const { fm, body } = skill('project-init');
  assert.equal(fm.name, 'project-init');
  assert.equal(fm['disable-model-invocation'], 'true');
  for (const s of ['AskUserQuestion', 'secret-scan.js', 'site-probe.js', 'check-closed.js', 'deployment.xml', 'watcherTasks.xml',
    'webServers.xml', '0.1: Исходники с прода (копия прода)', 'kit:git-keeper', '/kit:step-done', 'core.autocrlf', 'core.quotepath',
    'Варианта «это не секрет» нет', '4.0', 'сам не коммить', 'не больше 4 вопросов', 'Grep с `-o` по `rootFolder=',
    '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --also', '${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" --check --also', 'Код 2 — `deployment.xml` не разобран',
    'File → Reload All from Disk', '`.idea`, `.git` и `.claude` исключаются всегда', '«Больше ничего»', 'сервера автозаливки',
    'Always только на дев — дев', 'норма — 404 «нет на сервере»',
    '4.5 Проверки выкладки — любой режим, если известен адрес сервера (прод, дев или адрес из п. 4.0)', 'по обоим',
    '### 4.7 Переезд со старой раскладки', '### 4.8 Закрыть шаг', 'git check-ignore -q .claude/docs/progress.md', '`!/.claude/docs/`, `!/.claude/docs/**`',
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
  const i47 = body.indexOf('### 4.7 Переезд');
  const steps = ['1. **Исключения.**', '2. **`.gitignore`.**', '3. **Старые копии на сервере.**', '4. **Таблица «файл → куда»**', '5. **Перенос**', '6. **Закрытие**'].map((t) => body.indexOf(t, i47));
  assert.ok(steps.every((v, i) => v > i47 && (i === 0 || v > steps[i - 1])), 'переезд: исключения → .gitignore → старые копии → таблица → перенос → закрытие');
  assert.ok(!body.includes('docs/.htaccess` и `.claude/.htaccess`'), 'docs/.htaccess — только при старой раскладке');
  const q4 = /4\. Как файлы попадают на сервер: [^\n]*?\./.exec(body)[0];
  assert.deepEqual(q4.match(/«[^»]*»/g), ['«PhpStorm Always на прод»', '«PhpStorm Always только на дев, прод вручную»', '«вручную списком файлов»']);
  for (const s of ['`autoUpload="Always"` / `myAutoUpload` = `ALWAYS`', 'Дальше — только при автозаливке на любой сервер',
    '| PhpStorm Always на прод | `PhpStorm Always` |', '| PhpStorm Always только на дев, прод вручную | `вручную; дев — PhpStorm Always` |',
    '| вручную списком файлов | `вручную` |']) {
    assert.ok(body.includes(s), s);
  }
  const pstorm = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8');
  for (const s of ['`.claude/worktrees`', '## Что исключать — хук `phpstorm-exclude.js`', 'Всегда: `.idea`, `.git`, `.claude`', 'File → Reload All from Disk', 'маски (`*.back*`)']) {
    assert.ok(pstorm.includes(s), 'phpstorm.md: ' + s);
  }
  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: \{\{ИСКЛЮЧЕНИЯ — через запятую: всегда \.idea, \.git, \.claude;/);
  for (const t of ['CLAUDE.md', 'progress.md', 'deploy-prod.md', 'gitignore-bitrix', 'gitignore-general', 'htaccess-deny']) {
    assert.ok(body.includes('`' + t + '`'), 'скилл не называет шаблон ' + t);
    assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', t)), 'нет шаблона ' + t);
  }
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

module.exports = { frontmatter, agent, skill };

test('скиллы Битрикса: project-init ставит их bitrix-skills.js (п. 4.6, только bitrix), шаблон CLAUDE.md — правило пользоваться ими', () => {
  const read = (...p) => fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', ...p), 'utf8');
  const init = read('SKILL.md');
  assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'bitrix-skills.js')));
  for (const s of ['node "${CLAUDE_PLUGIN_ROOT}/scripts/bitrix-skills.js"', 'git check-ignore -q .claude/skills/bitrix-framework/SKILL.md',
    '`/.claude/skills/`', 'без `bitrix24-*`', 'обновить скиллы Битрикса']) {
    assert.ok(init.includes(s), 'project-init: ' + s);
  }
  const tpl = read('templates', 'CLAUDE.md');
  assert.match(tpl, /Код на Битриксе — по скиллам в `\.claude\/skills\/`: начинай с `bitrix-framework`/);
  assert.match(tpl, /нет `\.claude\/skills\/bitrix-framework\/` \(например, после `git clone` на другом компьютере\) — поставь их через `\/kit:project-init`\. \| \(режим «общий» — строки нет\)\}\}/);
});
