'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseParams, splitList, readParams } = require('../plugins/kit/scripts/lib/params');
const { getSection, parseTable } = require('../plugins/kit/scripts/lib/md');
const { parseRules, matchRules, norm } = require('../plugins/kit/scripts/lib/paths');
const { kitInfo, resolveProjectDir, docsInClaude } = require('../plugins/kit/scripts/lib/project');
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

test('parseTable: «\\|» — часть ячейки, столбцы не сдвигаются (К35)', () => {
  const rows = parseTable('| Шаг | Что | Коммит |\n|---|---|---|\n| 2.2 | Хук (`Write\\|Edit\\|MultiEdit`) | `abc1234` |\n| 2.3 | a \\| b | `def5678` |\n| 2.4 | конец\\| |\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['Что'], 'Хук (`Write|Edit|MultiEdit`)');
  assert.equal(rows[0]['Коммит'], '`abc1234`');
  assert.equal(rows[1]['Что'], 'a | b');
  assert.equal(rows[1]['Коммит'], '`def5678`');
  assert.equal(rows[2]['Что'], 'конец|');
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

test('paths: токен со слешем в любом месте — от корня, без слеша — любой сегмент', () => {
  const rules = parseRules(['bitrix/', 'upload/ (кроме upload/docs/)', '/local/php_interface', '.idea']);
  const hit = (p) => (matchRules(p, rules) || {}).pattern || null;
  assert.equal(hit('local/templates/x/components/bitrix/news.list/.default/template.php'), null);
  assert.equal(hit('bitrix/.settings.php'), 'bitrix/');
  assert.equal(hit('bitrix'), 'bitrix/');
  assert.equal(hit('local/components/my/upload/class.php'), null);
  assert.equal(hit('upload/iblock/a.jpg'), 'upload/ (кроме upload/docs/)');
  assert.equal(hit('upload/docs/a.png'), null);
  assert.equal(hit('local/php_interface/init.php'), '/local/php_interface');
  assert.equal(hit('sub/local/php_interface/init.php'), null);
  assert.equal(hit('.idea/workspace.xml'), '.idea');
  assert.equal(hit('local/.idea/workspace.xml'), '.idea');
  const lead = parseRules(['/bitrix']);
  assert.ok(matchRules('bitrix/admin/index.php', lead));
  assert.equal(matchRules('local/templates/x/components/bitrix/news.list/template.php', lead), null);
  const back = parseRules(['local\\modules\\']);
  assert.ok(matchRules('local/modules/my.module/install/index.php', back));
  assert.equal(matchRules('x/local/modules/a.php', back), null);
});

test('paths: «**/» — ноль или больше папок, как в .gitignore (К32)', () => {
  const rules = parseRules(['**/*.sql', 'src/**/tmp', '**/cache']);
  const hit = (p) => Boolean(matchRules(p, rules));
  for (const p of ['dump.sql', 'a/dump.sql', 'a/b/dump.sql', 'src/tmp', 'src/a/tmp', 'src/a/b/tmp/x.txt', 'cache', 'x/cache', 'x/cache/y']) {
    assert.ok(hit(p), p);
  }
  for (const p of ['dump.sqlx', 'lib/tmp', 'srcx/tmp', 'cachex', 'a/cachex/y']) assert.equal(hit(p), false, p);
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

test('kitInfo: папка документов — .claude/docs по умолчанию, старая docs/ — запасной путь, параметр важнее', () => {
  const fresh = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }) }));
  assert.equal(fresh.journalRel, '.claude/docs/progress.md');
  assert.equal(fresh.docsRel, '.claude/docs');
  assert.equal(fresh.planRel, '.claude/docs/deploy-prod.md');
  assert.equal(fresh.visualRel, '.claude/docs/visual');
  assert.equal(fresh.hasJournal, false);
  const moved = kitInfo(makeProject({ '.claude/docs/progress.md': progressMd(), 'docs/progress.md': progressMd() }));
  assert.equal(moved.journalRel, '.claude/docs/progress.md', 'новая раскладка важнее старой');
  assert.equal(moved.isKit, true);
  const old = kitInfo(makeProject({ 'docs/progress.md': progressMd() }));
  assert.equal(old.journalRel, 'docs/progress.md');
  assert.equal(old.docsRel, 'docs');
  assert.equal(old.planRel, 'docs/deploy-prod.md');
  assert.equal(old.visualRel, 'docs/visual');
  const param = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'docs\\progress.md', 'План выкладки': 'deploy.md' }), '.claude/docs/progress.md': progressMd() }));
  assert.equal(param.journalRel, 'docs/progress.md', 'параметр важнее найденного файла; \\ → /');
  assert.equal(param.hasJournal, false);
  assert.equal(param.planRel, 'deploy.md');
  assert.equal(param.visualRel, 'docs/visual');
  const root = kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'progress.md' }) }));
  assert.equal(root.docsRel, '.');
  assert.equal(root.planRel, 'deploy-prod.md');
  assert.equal(root.visualRel, 'visual');
  assert.equal(docsInClaude('.claude/docs'), true);
  assert.equal(docsInClaude('docs'), false);
  assert.equal(docsInClaude('.claudex/docs'), false);
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
