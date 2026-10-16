'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { paramsMd } = require('./fixtures');

const planMd = (commit) => [
  '# Выкладка', '', '## Общие правила', '', '- тест', '',
  '## Залито на прод', '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  '| 1.1 | 2026-09-20 | a.php | `' + commit + '` | ок |',
  '| 1.2 | | | | |', '',
  '## Удалить с сервера', '',
].join('\n');

function setup(mode) {
  const dir = gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': mode, 'Не выкладывать': '.claude, .gitignore' }),
    'a.php': '1', 'b.php': '1', '.claude/docs/progress.md': '# журнал\n', '.claude/docs/deploy-prod.md': '# пусто\n',
  });
  const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd(base), 'a.php': '2', 'c.php': 'new', '.claude/scripts/x.php': 'x' });
  fs.unlinkSync(path.join(dir, 'b.php'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: изменения');
  writeFiles(dir, { 'd.php': 'untracked' });
  return { dir, base };
}

test('вручную: база из «Залито на прод», залить и удалить, исключения, незакоммиченное', () => {
  const { dir, base } = setup('вручную');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + base + ' \\(«Залито на прод» в \\.claude/docs/deploy-prod\\.md\\)'));
  assert.match(r.stdout, /Залить \(2\):/);
  assert.match(r.stdout, /\n  M a\.php/);
  assert.match(r.stdout, /\n  A c\.php/);
  assert.match(r.stdout, /Удалить с сервера \(1\):\n  D b\.php/);
  assert.doesNotMatch(r.stdout, /x\.php/);
  assert.match(r.stdout, /Не закоммичено[^\n]*\n  \?\? d\.php/);
});

test('PhpStorm Always: только удаления', () => {
  const { dir } = setup('PhpStorm Always');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.match(r.stdout, /PhpStorm Always/);
  assert.doesNotMatch(r.stdout, /Залить \(/);
  assert.match(r.stdout, /Удалить с сервера \(1\)/);
});

test('новая раскладка: план выкладки — .claude/docs/deploy-prod.md без параметра', () => {
  const dir = gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Не выкладывать': '.claude' }),
    'a.php': '1', '.claude/docs/progress.md': '# журнал\n', '.claude/docs/deploy-prod.md': '# пусто\n',
  });
  const base = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { '.claude/docs/deploy-prod.md': planMd(base), 'a.php': '2' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: правка');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + base + ' \\(«Залито на прод» в \\.claude/docs/deploy-prod\\.md\\)'));
  assert.match(r.stdout, /Залить \(1\):\n  M a\.php/, '.claude — в «Не выкладывать», план не предлагается');
});

test('.claude не выкладывается всегда — даже без «Не выкладывать»; перенос в архив — не «удаления»', () => {
  const dir = gitRepo({
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную' }),
    'a.php': '1', '.claude/docs/progress.md': '# журнал\n', '.claude/docs/work/plan.md': 'план', 'local/.claude/x.txt': 'x',
  });
  writeFiles(dir, { '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Режим': 'общий' }), 'a.php': '2', 'local/.claude/x.txt': 'y' });
  fs.mkdirSync(path.join(dir, '.claude', 'docs', 'archive'));
  fs.renameSync(path.join(dir, '.claude', 'docs', 'work', 'plan.md'), path.join(dir, '.claude', 'docs', 'archive', 'plan.md'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: правка и архив');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Залить \(2\):\n  M a\.php\n  M local\/\.claude\/x\.txt/, 'только корневая .claude');
  assert.match(r.stdout, /Удалить с сервера \(0\)/);
  assert.doesNotMatch(r.stdout, /CLAUDE\.md|\.claude\/docs/);
});

test('kit-exec.php в корне (файл-канал /kit:server) не попадает ни в «Не закоммичено», ни в «Залить»; в подпапке — попадает', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную' }), 'a.php': '1' });
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.1: правка');
  writeFiles(dir, { 'kit-exec.php': '<?php // канал', 'sub/kit-exec.php': '<?php // чужой' });
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\n  \?\? kit-exec\.php/, 'корневой файл-канал не показывается');
  assert.match(r.stdout, /\n  \?\? sub\//, 'правило только для корня: файл в подпапке (git показывает папку целиком) виден');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: по ошибке закоммичено');
  const after = runScript('deploy-list.js', { cwd: dir, args: ['--base', 'HEAD~1'] });
  assert.doesNotMatch(after.stdout, /\n  A kit-exec\.php/, 'даже закоммиченный по ошибке — на сервер вручную не заливается списком');
  assert.match(after.stdout, /\n  A sub\/kit-exec\.php/);
});

test('без плана — от первого коммита; --base', () => {
  const dir = gitRepo({ 'a.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.1: правка');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.match(r.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.match(r.stdout, /\n  M a\.php/);
  const r2 = runScript('deploy-list.js', { cwd: dir, args: ['--base', 'HEAD'] });
  assert.match(r2.stdout, /аргумент --base/);
  assert.match(r2.stdout, /Залить \(0\)/);
});

test('не git-репозиторий и неверная база — код 1', () => {
  assert.equal(runScript('deploy-list.js', { cwd: makeProject({ 'a.php': '' }) }).code, 1);
  const dir = gitRepo({ 'a.php': '1' });
  assert.equal(runScript('deploy-list.js', { cwd: dir, args: ['--base', 'deadbeef'] }).code, 1);
});

const planFor = (title, rows) => ['# Выкладка', '', '## Общие правила', '', '- тест', '', '## ' + title, '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map(([step, commit]) => '| ' + step + ' | 2026-10-15 | a.php | ' + (commit ? '`' + commit + '`' : '') + ' | ок |'), ''].join('\n');

test('«Окружение: дев» — база из «Залито на дев»; --env прод — из «Залито на прод» (с 2.17.0)', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Окружение': 'дев' }), 'a.php': '1', 'b.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  git(dir, 'commit', '-q', '-am', '1.1: правка a');
  const devBase = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'b.php': '2', '.claude/docs/deploy-prod.md': planFor('Залито на дев', [['1.1', devBase]]) });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: правка b');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + devBase + ' \\(«Залито на дев» в \\.claude/docs/deploy-prod\\.md\\)'));
  assert.match(r.stdout, /Залить \(1\):\n  M b\.php/);
  const prod = runScript('deploy-list.js', { cwd: dir, args: ['--env', 'прод'] });
  assert.match(prod.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.equal(runScript('deploy-list.js', { cwd: dir, args: ['--env', 'тест'] }).code, 1);
});

test('«Claude по SSH»: пустой «Коммит» — коммит шага по ID; пометка «заливает /kit:step-done»; при «вручную» строка пропускается', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'Claude по SSH' }), 'a.php': '1', 'b.php': '1' });
  const first = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2', '.claude/docs/deploy-prod.md': planFor('Залито на прод', [['32.1', '']]) });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '32.1: правка a');
  const step = git(dir, 'rev-parse', '--short', 'HEAD').trim();
  writeFiles(dir, { 'b.php': '2' });
  git(dir, 'commit', '-q', '-am', '32.2: правка b');
  const r = runScript('deploy-list.js', { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('База: ' + step + ' \\(«Залито на прод»'));
  assert.match(r.stdout, /Claude по SSH — заливает \/kit:step-done/);
  assert.match(r.stdout, /Залить \(1\):\n  M b\.php/);
  writeFiles(dir, { '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную' }) });
  const manual = runScript('deploy-list.js', { cwd: dir });
  assert.match(manual.stdout, new RegExp('База: ' + first + ' \\(первый коммит репозитория\\)'));
  assert.doesNotMatch(manual.stdout, /Claude по SSH/);
});
