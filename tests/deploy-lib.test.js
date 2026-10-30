'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { skipRules, commitOfStep, baseFromPlan, changes, sectionOf } = require('../plugins/kit/scripts/lib/deploy');
const { entryDeploy } = require('../plugins/kit/scripts/lib/prod');
const { parseRules } = require('../plugins/kit/scripts/lib/paths');

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

const commitAll = (dir, msg) => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
};
const sorted = (items) => items.map((i) => i.path).sort();
const items = (list) => list.map((i) => i.status + ' ' + i.path).sort();

test('changes с exclude: файл только из коммита синхронизации после базы — не в списке; тот же файл, изменённый потом шагом, — в списке', () => {
  const dir = gitRepo({ 'a.php': '1', 'b.php': '1', 'c.php': '1', 'd.php': '1', 'e.php': '1', 'f.php': '1', 'old.php': 'o' });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': 'шаг' });
  commitAll(dir, '1.1: шаг до синхронизации');
  // синхронизация с продом: изменённый, удалённый, новый и переименованный на сервере
  writeFiles(dir, { 'b.php': 'сервер', 'd.php': 'сервер', 'e.php': 'сервер', 'n/новый файл.php': 'сервер', 'new.php': 'o' });
  fs.unlinkSync(path.join(dir, 'c.php'));
  fs.unlinkSync(path.join(dir, 'old.php'));
  commitAll(dir, 'Прод: изменения без kit на 2026-10-30 (6 файлов)');
  writeFiles(dir, { 'd.php': 'шаг после' });
  commitAll(dir, '1.2: шаг после синхронизации');
  writeFiles(dir, { 'f.php': 'дев' });
  commitAll(dir, 'Дев: изменения без kit на 2026-10-30 (1 файл)');
  writeFiles(dir, { 'e.php': 'правка в рабочей копии' });

  const ed = entryDeploy(dir, base, 'прод');
  assert.deepEqual([...ed.exclude].sort(), ['b.php', 'c.php', 'n/новый файл.php', 'new.php', 'old.php']);
  assert.deepEqual(items(ed.include), ['M d.php', 'M e.php'], 'отличается от версии синхронизации — заливается');
  const all = changes(dir, base, []);
  assert.deepEqual(sorted(all.upload), ['a.php', 'b.php', 'd.php', 'e.php', 'f.php', 'n/новый файл.php', 'new.php']);
  assert.deepEqual(sorted(all.del), ['c.php', 'old.php']);
  const ch = changes(dir, base, [], ed.exclude, ed.include);
  assert.deepEqual(sorted(ch.upload), ['a.php', 'd.php', 'e.php', 'f.php'], 'шаги, правка рабочей копии и синхронизация с девом — в списке');
  assert.deepEqual(ch.del, []);
  assert.deepEqual(sorted(ch.excluded), ['b.php', 'c.php', 'n/новый файл.php', 'new.php', 'old.php']);
  const dev = entryDeploy(dir, base, 'дев');
  assert.deepEqual([...dev.exclude], ['f.php'], 'окружение — своё');
  assert.deepEqual(dev.include, []);
  // файл синхронизации удалён в рабочей копии или изменён в индексе — это наша правка
  fs.unlinkSync(path.join(dir, 'b.php'));
  writeFiles(dir, { 'new.php': 'o2' });
  git(dir, 'add', 'new.php');
  const after = entryDeploy(dir, base, 'прод');
  assert.deepEqual([...after.exclude].sort(), ['c.php', 'n/новый файл.php', 'old.php']);
  assert.deepEqual(items(after.include), ['D b.php', 'M d.php', 'M e.php', 'M new.php']);
  // удалённый синхронизацией файл снова лежит на диске (неотслеживаемый) — на сервере его нет
  writeFiles(dir, { 'c.php': 'снова' });
  const back = entryDeploy(dir, base, 'прод');
  assert.deepEqual([...back.exclude].sort(), ['n/новый файл.php', 'old.php']);
  assert.ok(items(back.include).includes('M c.php'));
});

test('entryDeploy: шаг вернул файл синхронизации к версии базы — залить; удалил добавленный синхронизацией — удалить с сервера', () => {
  const dir = gitRepo({ 'x.php': 'v1', 'keep.php': 'k' });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'x.php': 'v2 с сервера', 'n.php': 'с сервера', 'ign/s.log': 'с сервера' });
  commitAll(dir, 'Прод: изменения без kit на 2026-10-30 (3 файла)');
  // шаг отверг правку сервера: x.php — снова v1, n.php удалён; ign/ теперь под .gitignore, файл лежит на диске
  writeFiles(dir, { 'x.php': 'v1', '.gitignore': 'ign/\n' });
  fs.unlinkSync(path.join(dir, 'n.php'));
  git(dir, 'rm', '-q', '--cached', 'ign/s.log');
  commitAll(dir, '1.1: вернуть x.php, убрать n.php');
  const all = changes(dir, base, []);
  assert.deepEqual(sorted(all.upload), ['.gitignore'], 'от базы разницы нет — прежняя дыра');
  assert.deepEqual(all.del, []);
  const ed = entryDeploy(dir, base, 'прод');
  assert.deepEqual(items(ed.include), ['D n.php', 'M x.php']);
  assert.deepEqual([...ed.exclude], [], 'игнорируемый файл на диске — ни в одном списке');
  const ch = changes(dir, base, [], ed.exclude, ed.include);
  assert.deepEqual(sorted(ch.upload), ['.gitignore', 'x.php']);
  assert.deepEqual(sorted(ch.del), ['n.php']);
  assert.deepEqual(ch.excluded, []);
  // правило исключений действует и на добавленные пути
  assert.deepEqual(sorted(changes(dir, base, parseRules(['x.php', 'n.php']), ed.exclude, ed.include).upload), ['.gitignore']);
  // синхронизация другого окружения — не в счёт
  assert.deepEqual(entryDeploy(dir, base, 'дев'), { exclude: new Set(), include: [] });
});

test('entryDeploy: сравнение по содержимому, как у git diff — CRLF в рабочей копии при LF в git (core.autocrlf) — та же версия', () => {
  const dir = gitRepo({ 'x.php': 'v1\n' });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'x.php': 'v2\n', 'y.php': 'y\n' });
  commitAll(dir, 'Прод: изменения без kit на 2026-10-30 (2 файла)');
  git(dir, 'config', 'core.autocrlf', 'true');
  writeFiles(dir, { 'x.php': 'v2\r\n', 'y.php': 'другое\r\n' });
  const ed = entryDeploy(dir, base, 'прод');
  assert.deepEqual([...ed.exclude], ['x.php']);
  assert.deepEqual(items(ed.include), ['M y.php']);
});

test('entryDeploy и слияние: путь из коммита синхронизации ветки — исключается; изменённый самим слиянием — нет; база — HEAD — пусто', () => {
  const dir = gitRepo({ 'a.php': '1', 'g.php': '1', 'h.php': '1' });
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  const main = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'side');
  writeFiles(dir, { 'g.php': 'сервер', 'h.php': 'сервер' });
  commitAll(dir, 'Прод: изменения без kit на 2026-10-30 (2 файла)');
  git(dir, 'checkout', '-q', main);
  writeFiles(dir, { 'a.php': 'шаг' });
  commitAll(dir, '1.1: шаг');
  git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side');
  writeFiles(dir, { 'g.php': 'правка при слиянии' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'слияние');
  const ed = entryDeploy(dir, base, 'прод');
  assert.deepEqual([...ed.exclude], ['h.php']);
  assert.deepEqual(items(ed.include), ['M g.php']);
  assert.deepEqual(entryDeploy(dir, git(dir, 'rev-parse', 'HEAD').trim(), 'прод'), { exclude: new Set(), include: [] });
});
