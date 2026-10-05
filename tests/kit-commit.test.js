'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { cleanMessage, parseArgs } = require('../plugins/kit/scripts/kit-commit');

const ENV = {
  GIT_AUTHOR_NAME: 'kit', GIT_AUTHOR_EMAIL: 'kit@test.local',
  GIT_COMMITTER_NAME: 'kit', GIT_COMMITTER_EMAIL: 'kit@test.local',
};
const commit = (dir, paths, msg, cwd = dir) =>
  runScript('kit-commit.js', { args: ['--', ...paths], input: msg, cwd, env: ENV });
const lastMessage = (dir) => {
  const raw = git(dir, 'cat-file', 'commit', 'HEAD');
  return raw.slice(raw.indexOf('\n\n') + 2);
};
const count = (dir) => Number(git(dir, 'rev-list', '--count', 'HEAD').trim());
const staged = (dir) => git(dir, 'diff', '--cached', '--name-only').trim();
const committed = (dir) => git(dir, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', 'HEAD')
  .trim().split('\n').sort();

test('сообщение попадает в коммит побайтно: «спек», обратные кавычки, $arResult, апостроф, / в начале строки (К54)', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'a.php': '<?php\necho 1;\n' });
  const msg = "28.1: спек — вывод $arResult в шаблоне 'Купить'\n\n"
    + '/local/templates/x: `php -l` — ок, частям и спек не исправлены\n\n'
    + 'Co-Authored-By: Claude <noreply@anthropic.com>\n';
  const r = commit(dir, ['a.php'], msg);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(lastMessage(dir), msg);
  assert.equal(count(dir), 2);
  assert.match(r.stdout, /сообщение совпало с поданным/);
});

test('сообщение с \\r\\n — в коммите LF, самопроверка проходит', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt'], '28.1: a\r\n\r\nтело\r\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(lastMessage(dir), '28.1: a\n\nтело\n');
});

test('чужой файл в индексе не попадает в коммит и остаётся в индексе', () => {
  const dir = gitRepo({ 'a.txt': '1\n', 'b.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', 'b.txt': '2\n' });
  git(dir, 'add', 'b.txt');
  const r = commit(dir, ['a.txt'], '28.1: a\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['M\ta.txt']);
  assert.equal(staged(dir), 'b.txt');
});

test('запрещённый путь — код 1, ничего не добавлено, коммита нет', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { '.idea/workspace.xml': '<x/>\n', 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt', '.idea/workspace.xml'], '28.1: a\n');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), '');
  assert.match(r.stdout, /запрещённые пути/);
});

// Пароль собран из частей: литерал в файле теста остановил бы проверку секретов при коммите.
const SECRET = ['Qw3', 'rty!x9'].join('');

test('секрет в содержимом — код 1, коммита нет, индекс как есть, значение замаскировано', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'cfg.php': `<?php\nreturn ['password' => '${SECRET}'];\n` });
  const r = commit(dir, ['cfg.php'], '28.1: cfg\n');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), 'cfg.php');
  assert.doesNotMatch(r.stdout, new RegExp(SECRET));
  assert.match(r.stdout, /Индекс оставлен как есть/);
});

test('уже помеченное удаление, удаление в рабочей папке и изменение — одним коммитом', () => {
  const dir = gitRepo({ 'old.txt': '1\n', 'gone.txt': '1\n', 'a.txt': '1\n' });
  git(dir, 'rm', '-q', 'old.txt');
  fs.unlinkSync(path.join(dir, 'gone.txt'));
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['old.txt', 'gone.txt', 'a.txt'], '28.1: уборка\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['D\tgone.txt', 'D\told.txt', 'M\ta.txt']);
});

test('только уже помеченное удаление — git add не нужен, коммит проходит', () => {
  const dir = gitRepo({ 'old.txt': '1\n', 'a.txt': '1\n' });
  git(dir, 'rm', '-q', 'old.txt');
  const r = commit(dir, ['old.txt'], '28.1: удалить old\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(committed(dir), ['D\told.txt']);
});

test('пустой список путей, пустое сообщение или «.» — код 2, ничего не добавлено', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  assert.equal(commit(dir, [], '28.1: a\n').code, 2);
  assert.equal(commit(dir, ['a.txt'], '').code, 2);
  assert.equal(commit(dir, ['a.txt'], ' \n\n').code, 2);
  assert.equal(commit(dir, ['.'], '28.1: a\n').code, 2);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), '');
});

test('опечатка в пути — код 2, коммита нет', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n' });
  const r = commit(dir, ['a.txt', 'нет-такого.txt'], '28.1: a\n');
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
});

test('хук commit-msg отклонил — код 2, коммита нет, файлы остаются в индексе', () => {
  const dir = gitRepo({ 'a.txt': '1\n' });
  writeFiles(dir, { 'a.txt': '2\n', '.git/hooks/commit-msg': '#!/bin/sh\necho "запрещённое слово" >&2\nexit 1\n' });
  fs.chmodSync(path.join(dir, '.git/hooks/commit-msg'), 0o755);
  const r = commit(dir, ['a.txt'], '28.1: a\n');
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.equal(staged(dir), 'a.txt');
  assert.match(r.stdout, /запрещённое слово/);
});

test('первый коммит репозитория: папка с кириллицей и путь с пробелом', () => {
  const dir = makeProject({ 'Документы/план.md': '# план\n', 'с пробелом.txt': 'x\n', 'чужой.txt': 'y\n' });
  git(dir, 'init', '-q');
  git(dir, 'add', 'чужой.txt');
  const r = commit(dir, ['Документы/', 'с пробелом.txt'], '0.1: исходники\n');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(count(dir), 1);
  assert.deepEqual(committed(dir), ['A\tДокументы/план.md', 'A\tс пробелом.txt']);
  assert.equal(staged(dir), 'чужой.txt');
});

test('не из корня репозитория — код 2', () => {
  const dir = gitRepo({ 'sub/a.txt': '1\n' });
  writeFiles(dir, { 'sub/a.txt': '2\n' });
  const r = commit(dir, ['a.txt'], '28.1: a\n', path.join(dir, 'sub'));
  assert.equal(r.code, 2);
  assert.match(r.stdout, /из корня репозитория/);
  assert.equal(count(dir), 1);
});

test('cleanMessage и parseArgs', () => {
  assert.equal(cleanMessage('\n\nA  \r\n\n\n\nB\t\n\n'), 'A\n\nB\n');
  assert.equal(cleanMessage(' \n\r\n'), '');
  assert.deepEqual(parseArgs(['--', './a.txt', 'Документы/', 'b\\c.txt']), { paths: ['a.txt', 'Документы', 'b/c.txt'] });
  assert.match(parseArgs([]).error, /нет путей/);
  assert.match(parseArgs(['--x', '--', 'a']).error, /неизвестные аргументы/);
  assert.match(parseArgs(['--']).error, /пуст/);
  assert.match(parseArgs(['--', '.']).error, /«\.»/);
});
