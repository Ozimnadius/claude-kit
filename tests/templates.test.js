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
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php', '.claude/docs/visual/before/admin/desktop/home.png', '.claude/docs/visual/.gitignore',
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

test('gitignore-general: служебное, снимки и секреты игнорируются; документы — в git', () => {
  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1', '.claude/docs/visual/links.json',
    '.superpowers/brainstorm/1/content/a.html', '.worktrees/feature/src/a.php'];
  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', '.claude/scripts/visual/pages.json', 'src/a.php', '.claude/docs/progress.md', '.claude/docs/work/spec.md', '.claude/docs/archive/a.md', 'docs/progress.md', '.env.example'];
  const set = ignored(read('gitignore-general'), [...yes, ...no]);
  for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
  for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
});

test('CLAUDE.md: у параметра «Выкладка» три варианта', () => {
  const line = /^- Выкладка: \{\{(.*)\}\}$/m.exec(read('CLAUDE.md'));
  assert.ok(line, 'нет строки параметра «Выкладка» с плейсхолдером');
  assert.deepEqual(line[1].split(' | '), ['PhpStorm Always', 'вручную; дев — PhpStorm Always', 'вручную']);
});

test('CLAUDE.md: документы — в .claude/docs, в «Не выкладывать» — .claude', () => {
  const v = parseParams(read('CLAUDE.md'));
  assert.equal(v['журнал'], '.claude/docs/progress.md');
  assert.equal(v['план выкладки'], '.claude/docs/deploy-prod.md');
  assert.ok(v['не выкладывать'].includes('всегда .idea, .git, .claude;'), v['не выкладывать']);
  const tpl = read('CLAUDE.md');
  assert.ok(tpl.includes('`.claude/docs/visual/`'));
  assert.ok(tpl.includes('в `work/`') && tpl.includes('в `archive/`') && tpl.includes('раздел «Документы» журнала'));
  assert.ok(tpl.includes('**Крупная задача** — `superpowers:brainstorming`') && tpl.includes('не в `docs/superpowers/`'), 'правило superpowers в «Как работаем»');
  assert.ok(tpl.includes('с разделом «Чек-лист» в начале: строка на задачу `- [ ] N.M — …`'), 'чек-лист задач в плане');
  const rest = tpl.split('.claude/docs/').join('').split('upload/docs/').join('').split('docs/superpowers/').join('');
  assert.ok(!rest.includes('docs/'), 'старых путей docs/ в шаблоне нет');
});

test('CLAUDE.md: раздел параметров со всеми ключами', () => {
  const v = parseParams(read('CLAUDE.md'));
  assert.ok(v, 'нет раздела «Параметры для агентов»');
  for (const k of ['режим', 'код пишет', 'окружение', 'выкладка', 'прод', 'дев', 'ssh прод', 'ssh дев', 'php на сервере', 'php', 'журнал', 'план выкладки', 'id шага', 'не выкладывать', 'не коммитить', 'секреты', 'удалённый репозиторий']) {
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
  assert.ok(getSection(md, 'Этапы').includes('| 0 | подготовка | ниже |'));
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
  assert.deepEqual(Object.keys(rows[0]), ['Шаг', 'Статус', 'Что сделано', 'Как проверено', 'Коммит']);
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
