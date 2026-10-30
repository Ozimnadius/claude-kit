'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN, makeProject, writeFiles, git } = require('./helpers');
const { parseParams, makeParams } = require('../plugins/kit/scripts/lib/params');
const { parseRules, matchRules } = require('../plugins/kit/scripts/lib/paths');
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

test('gitignore-bitrix: служебное, ядро, снимки и секреты игнорируются; правила, документы, скрипты и материалы — в git', () => {
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/kit-inbox.jsonl', '.claude/kit-prod.json', '.claude/agents/x.md', '.claude/worktrees/x/index.php', '.claude/docs/visual/before/admin/desktop/home.png', '.claude/docs/visual/.gitignore',
    '.claude/skills/bitrix-orm/SKILL.md', '.claude/skills/bitrix-orm/rules/reading.md',
    'kit-exec.php', 'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1',
    '.env', '.env.local', 'local/.env.production', 'cert/site.pem', 'local/ssl/private.key',
    '.superpowers/brainstorm/1/content/a.html', '.worktrees/feature/index.php'];
  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', '.claude/scripts/visual/pages.json', '.claude/docs/progress.md', '.claude/docs/deploy-prod.md',
    '.claude/docs/work/plan-12345.md', '.claude/docs/work/design/a.png', '.claude/docs/archive/plan-ssh.md', 'upload/docs/a.png', 'local/templates/x/a.php',
    'local/templates/x/components/bitrix/news.list/.default/template.php', 'docs/progress.md', 'local/php_interface/env.php', 'local/kit-exec.php',
    '.env.example', 'local/.env.example'];
  const set = ignored(read('gitignore-bitrix'), [...yes, ...no]);
  for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
});

test('рабочие папки в bitrix/ (с 3.2.0): пример справки bitrix.md поверх шаблона — папки в git, прочее ядро и бэкапы нет; «Не коммитить» с «кроме» их пропускает', () => {
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'bitrix.md'), 'utf8');
  const block = /\*\*`\.gitignore`\.\*\*[\s\S]*?```\n([\s\S]*?)```/.exec(ref);
  assert.ok(block, 'в справке нет примера исключений .gitignore');
  const lines = block[1].replace(/<шаблон>/g, 'theme').replace(/<пространство>/g, 'vendor');
  const tpl = read('gitignore-bitrix');
  assert.ok(/^\/bitrix\/\*$/m.test(tpl) && !/^\/bitrix\/$/m.test(tpl), 'в шаблоне /bitrix/*, а не /bitrix/');
  const gi = tpl.replace(/^\/bitrix\/\*$/m, lines.trimEnd());
  const work = ['bitrix/templates/theme/header.php', 'bitrix/templates/theme/components/bitrix/menu/top/template.php',
    'bitrix/components/vendor/catalog/component.php', 'bitrix/php_interface/init.php'];
  const core = ['bitrix/.settings.php', 'bitrix/php_interface/dbconn.php', 'bitrix/templates/.default/a.php', 'bitrix/components/bitrix/news/component.php',
    'bitrix/modules/main/include.php', 'bitrix/templates/theme/_header.php.back1.2.3', 'bitrix/components/vendor/_catalog.back1.2'];
  const set = ignored(gi, [...work, ...core]);
  for (const p of work) assert.ok(!set.has(p), 'рабочий файл не должен игнорироваться: ' + p);
  for (const p of core) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  const rule = /`(bitrix\/ \(кроме [^`]*\)), upload\/ \(кроме upload\/docs\/\), \*\.back\*`/.exec(ref);
  assert.ok(rule, 'в справке нет примера «Не коммитить»');
  const rules = parseRules([rule[1].replace(/<шаблон>/g, 'theme').replace(/<пространство>/g, 'vendor'), '*.back*']);
  for (const p of work) assert.equal(matchRules(p, rules), null, '«Не коммитить» не должен ловить: ' + p);
  for (const p of ['bitrix/.settings.php', 'bitrix/modules/main/include.php', 'bitrix/templates/theme/_header.php.back1.2.3']) assert.ok(matchRules(p, rules), p);
});

test('gitignore-general: служебное, снимки и секреты игнорируются; документы — в git', () => {
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/kit-inbox.jsonl', '.claude/kit-prod.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1', '.claude/docs/visual/links.json',
    '.superpowers/brainstorm/1/content/a.html', '.worktrees/feature/src/a.php'];
  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', '.claude/scripts/visual/pages.json', 'src/a.php', '.claude/docs/progress.md', '.claude/docs/work/spec.md', '.claude/docs/archive/a.md', 'docs/progress.md', '.env.example'];
  const set = ignored(read('gitignore-general'), [...yes, ...no]);
  for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
});

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

test('CLAUDE.md: документы — в .claude/docs, в «Не выкладывать» — .claude', () => {
  const v = parseParams(read('CLAUDE.md'));
  assert.equal(v['журнал'], '.claude/docs/progress.md');
  assert.equal(v['план выкладки'], '.claude/docs/deploy-prod.md');
  assert.ok(v['не выкладывать'].includes('всегда .idea, .git, .claude;'), v['не выкладывать']);
  const tpl = read('CLAUDE.md');
  assert.ok(tpl.includes('`.claude/docs/visual/`'));
  assert.ok(tpl.includes('в `work/`') && tpl.includes('в `archive/`') && tpl.includes('раздел «Документы» журнала'));
  // «Крупная задача» — два варианта (47.8а): superpowers по правилам kit / по навыку /kit:matt при «Система Мэтта: да».
  const big = /^- \*\*Крупная задача\*\* — \{\{([^}]*)\}\}/m.exec(tpl);
  assert.ok(big, 'строка «Крупная задача» с вариантами');
  const [sp, matt, ...more] = big[1].split(' | ');
  assert.equal(more.length, 0, 'вариантов два');
  assert.ok(sp.startsWith('`superpowers:brainstorming`') && sp.includes('не в `docs/superpowers/`'), 'правило superpowers в «Как работаем»: ' + sp);
  assert.ok(matt.startsWith('по навыку `/kit:matt` (система Мэтта)') && matt.includes('не пишутся') && !matt.includes('superpowers:'), 'вариант для системы Мэтта: ' + matt);
  // 47.8ж: в проекте Мэтта ветки и worktree запрещены при любой выкладке — в самом варианте, хвост про автозаливку — отдельно.
  assert.ok(matt.includes('без веток и worktree при любой выкладке'), 'вариант Мэтта: без веток и worktree');
  assert.ok(tpl.includes('с разделом «Чек-лист» в начале: строка на задачу `- [ ] N.M — …`'), 'чек-лист задач в плане');
  const rest = tpl.split('.claude/docs/').join('').split('upload/docs/').join('').split('docs/superpowers/').join('');
  assert.ok(!rest.includes('docs/'), 'старых путей docs/ в шаблоне нет');
});

test('CLAUDE.md: раздел параметров со всеми ключами', () => {
  const v = parseParams(read('CLAUDE.md'));
  assert.ok(v, 'нет раздела «Параметры для агентов»');
  for (const k of ['режим', 'окружение', 'выкладка', 'прод', 'дев', 'ssh прод', 'ssh дев', 'php на сервере', 'php', 'журнал', 'план выкладки', 'id шага', 'не выкладывать', 'не коммитить', 'секреты', 'удалённый репозиторий', 'система мэтта']) {
    assert.ok(k in v, 'нет ключа ' + k);
  }
});

test('CLAUDE.md → «Не коммитить» → правила путей: копии шаблонов components/bitrix/ коммитятся', () => {
  // Заполнить шаблон первыми вариантами {{A | B}} — как для Битрикс-проекта.
  const filled = read('CLAUDE.md').replace(/\{\{([^}]*)\}\}/g, (m, inner) => inner.split(' | ')[0].trim());
  assert.ok(!filled.includes('{{'));
  const items = makeParams(parseParams(filled)).list('Не коммитить');
  assert.deepEqual(items, ['bitrix/', 'upload/ (кроме upload/docs/)', '*.back*']);
  const rules = parseRules(items);
  assert.equal(matchRules('local/templates/x/components/bitrix/news.list/.default/template.php', rules), null);
  assert.ok(matchRules('bitrix/.settings.php', rules));
  assert.ok(matchRules('upload/iblock/a.jpg', rules));
  assert.equal(matchRules('upload/docs/a.png', rules), null);
  assert.ok(matchRules('local/templates/x/a.php.back2', rules));
});

test('progress.md и journal/*.md: журнал по частям — разделы, оглавление «Этапы», таблица этапа 0', () => {
  const md = read('progress.md');
  for (const s of ['Сейчас', 'Этапы', 'Документы', 'Прод: не забыть', 'Этап 0']) assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  for (const s of ['## Решения', '## Баги на потом', '## Справочник', '## Материалы заказчика']) assert.ok(!md.includes(s), s + ' — в частях, не в журнале');
  assert.ok(md.indexOf('## Сейчас') < md.indexOf('## Этапы') && md.indexOf('## Этапы') < md.indexOf('## Документы') && md.indexOf('## Документы') < md.indexOf('## Этап 0'));
  assert.ok(getSection(md, 'Этапы').includes('| 0 | инициализация проекта | ниже |'));
  assert.ok(md.includes('## Этап 0 — инициализация проекта') && !md.includes('подготовка'), 'этап 0 — инициализация проекта');
  assert.ok(getSection(md, 'Документы').includes('| Файл | О чём | Статус |'));
  assert.ok(!md.includes('`docs/`'), 'старых путей docs/ в журнале нет');
  const dec = read('journal/decisions.md');
  const bugs = read('journal/bugs.md');
  const ref = read('journal/reference.md');
  assert.ok(getSection(bugs, 'Баги на потом').includes('| № | Баг | Где | Статус |'));
  assert.ok(getSection(ref, 'Материалы заказчика') !== null && getSection(ref, 'Справочник') !== null);
  const decisions = parseTable(getSection(dec, 'Решения'));
  assert.deepEqual(Object.keys(decisions[0]), ['№', 'Дата', 'Шаг', 'Решение', 'Почему', 'Что отвергли', 'Кто']);
  const rows = parseTable(getSection(md, 'Этап 0'));
  assert.deepEqual(Object.keys(rows[0]), ['Шаг', 'Статус', 'Что сделано', 'Как проверено'], 'без столбца «Коммит» (с 3.0.0)');
  assert.ok(!md.includes('{{ХЕШ}}'), 'хеша первого коммита в журнале нет');
  assert.ok(rows[0]['Как проверено'], 'у 0.1 заполнено «Как проверено»');
  assert.equal(rows[0]['Шаг'], '0.1');
});

test('spec.md: разделы kit поверх дизайна brainstorming', () => {
  const md = read('spec.md');
  for (const s of ['Задача', 'Требования', 'Критерии готовности', 'Предположения', 'Открытые вопросы', 'Дизайн']) {
    assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  }
  assert.ok(md.includes('Т-1.') && md.includes('[УТОЧНИТЬ:') && md.includes('work/spec-<тема>.md') && md.includes('DECISIONS'));
});

test('deploy-prod.md: разделы, таблица «Залито на прод | дев» по окружению, вариант для «Claude по SSH»', () => {
  const md = read('deploy-prod.md');
  for (const s of ['Общие правила', 'Залито на {{прод | дев}}', 'Удалить с сервера', 'Чек-лист переключения']) {
    assert.ok(getSection(md, s) !== null, 'нет раздела ' + s);
  }
  assert.match(md, /^# Выкладка на \{\{прод \| дев\}\} — \{\{ДОМЕН\}\}$/m);
  assert.ok(getSection(md, 'Общие правила').includes('ssh-deploy.js'));
  assert.match(getSection(md, 'Залито на {{прод | дев}}'), /\| Шаг \| Дата \| Файлы \| Коммит \| Проверка \|/);
  const always = getSection(md, 'Общие правила').split(' | ').find((v) => v.includes('Заливает PhpStorm автоматически'));
  assert.match(always, /таблица «Залито на …» не ведётся/, 'при автозаливке «Залито» не ведётся (с 3.0.0)');
  assert.match(always, /«Удалить с сервера»/);
  assert.match(getSection(md, 'Удалить с сервера'), /\| Путь \| Почему \| Удалён \|/);
});

test('htaccess-deny: Apache 2.4 и 2.2', () => {
  const h = read('htaccess-deny');
  assert.match(h, /Require all denied/);
  assert.match(h, /Deny from all/);
});

test('шаблон CLAUDE.md: без параметров «Код пишет» и «Коммит», проверка страницы — пакетом browser_batch (с 3.0.0)', () => {
  const md = read('CLAUDE.md');
  const v = parseParams(md);
  assert.ok(!('код пишет' in v) && !('коммит' in v), 'параметров «Код пишет» и «Коммит» нет');
  assert.ok(!md.includes('Код пишет {{') && !md.includes('Claude даёт один маленький шаг'), 'варианта «код пишет пользователь» нет');
  const how = /^- \*\*Код пишет Claude\.\*\* \{\{(.*)\}\}$/m.exec(md);
  assert.ok(how, 'правило «Код пишет Claude» с вариантами по выкладке');
  for (const variant of how[1].split(' | ')) assert.ok(variant.includes('browser_batch'), 'вариант без browser_batch: ' + variant);
});
