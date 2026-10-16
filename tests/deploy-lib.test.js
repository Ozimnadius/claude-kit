'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { skipRules, commitOfStep, baseFromPlan, changes, sectionOf } = require('../plugins/kit/scripts/lib/deploy');

const plan = (title, rows) => ['# Выкладка', '', '## ' + title, '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map(([step, commit]) => '| ' + step + ' | 2026-10-15 | a.php | ' + (commit ? '`' + commit + '`' : '') + ' | ок |'), '',
  '## Удалить с сервера', ''].join('\n');

test('sectionOf: таблица по окружению', () => {
  assert.equal(sectionOf('прод'), 'Залито на прод');
  assert.equal(sectionOf('дев'), 'Залито на дев');
});

test('commitOfStep: точный ID до «: » — 32.1 не находит 32.10', () => {
  const dir = gitRepo({ 'a.php': '1' });
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '32.10: десятый');
  assert.equal(commitOfStep(dir, '32.1'), null);
  assert.ok(git(dir, 'rev-parse', 'HEAD').trim().startsWith(commitOfStep(dir, '32.10')));
  assert.equal(commitOfStep(dir, ''), null);
});

test('baseFromPlan: хеш из «Коммит»; пустой — по ID только с byStep; таблица по окружению', () => {
  const dir = gitRepo({ 'a.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.2: правка');
  const step = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  const file = path.join(dir, 'plan.md');
  fs.writeFileSync(file, plan('Залито на прод', [['1.1', first], ['1.2', '']]));
  assert.equal(baseFromPlan(file, 'прод'), first, 'без byStep пустая строка пропускается');
  assert.equal(baseFromPlan(file, 'прод', { cwd: dir, byStep: true }), step);
  assert.equal(baseFromPlan(file, 'дев', { cwd: dir, byStep: true }), null, 'таблицы «Залито на дев» нет');
  fs.writeFileSync(file, plan('Залито на дев', [['1.1', first]]));
  assert.equal(baseFromPlan(file, 'дев'), first);
  assert.equal(baseFromPlan(path.join(dir, 'нет.md'), 'прод'), null);
});

test('changes: незакоммиченное, удалённое и новые файлы; игнорируемое и исключённое — нет', () => {
  const dir = gitRepo({ '.gitignore': 'ign/\n', 'a.php': '1', 'b.php': '1', '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH' }) });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2', 'new/с пробелом.php': 'n', 'ign/x.php': 'i', '.claude/docs/x.md': 'd', '.idea/w.xml': 'x',
    '.superpowers/brainstorm/a.html': 's', '.worktrees/w/a.php': 'w', 'docs/superpowers/specs/s.md': 'p' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  const rules = skipRules(kitInfo(dir));
  const wt = changes(dir, base, rules);
  assert.deepEqual(wt.upload.map((i) => i.path).sort(), ['a.php', 'new/с пробелом.php']);
  assert.deepEqual(wt.del.map((i) => i.path), ['b.php']);
});
