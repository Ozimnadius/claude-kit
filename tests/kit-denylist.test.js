'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, gitRepo, writeFiles } = require('./helpers');

const TOOL = path.join(ROOT, 'tools', 'kit-denylist.js');
const LIST = '# комментарий\nsecret-client\nw:user999\n';
const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const withList = (files = {}) => {
  const dir = gitRepo(files);
  fs.writeFileSync(path.join(dir, '.git', 'info', 'kit-denylist'), LIST);
  return dir;
};
// git без -c user.* из helpers.git — коммит должен пройти через хуки; ошибки не бросаем.
const gitc = (dir, ...args) => spawnSync('git', ['-c', 'user.name=kit', '-c', 'user.email=kit@test.local', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });

test('tree: слово в файле, в экранированной форме и в имени файла — код 1 с местом; «w:» — только целым словом', () => {
  const dir = withList({
    'a.md': 'ok\nсайт secret-client.ru\n',
    'b.js': "assert.match(x, /secret-client\\.ru/);\nconst u = 'user9990';\n",
    'docs/secret-client-notes.md': 'чисто',
  });
  const r = run(dir, 'tree');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a\.md:2: «secret-client»/);
  assert.match(r.out, /b\.js:1: «secret-client»/);
  assert.match(r.out, /путь docs\/secret-client-notes\.md: «secret-client»/);
  assert.doesNotMatch(r.out, /user999/, 'user9990 — другое слово');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'host user999@x\n');
  assert.match(run(dir, 'tree').out, /c\.txt:1: «user999»/, 'новый, ещё не добавленный файл тоже проверяется');
});

test('staged: только добавленные строки и новые имена; удалённая строка со словом — не находка', () => {
  const dir = withList({ 'old.md': 'было secret-client\n' });
  writeFiles(dir, { 'old.md': 'стало чисто\n' });
  gitc(dir, 'add', '-A');
  assert.equal(run(dir, 'staged').code, 0, 'удаление слова — не утечка');
  writeFiles(dir, { 'new.md': 'одна\nдве user999\n' });
  gitc(dir, 'add', '-A');
  const r = run(dir, 'staged');
  assert.equal(r.code, 1);
  assert.match(r.out, /new\.md:2: «user999»/);
});

test('msg: слово в сообщении — код 1; строки «#» (подсказки git) не считаются', () => {
  const dir = withList({ 'a.md': 'a' });
  const f = path.join(dir, 'MSG');
  fs.writeFileSync(f, '20.1: чисто\n# secret-client в комментарии git\n');
  assert.equal(run(dir, 'msg', f).code, 0);
  fs.writeFileSync(f, '20.1: проверка на Secret-Client\n');
  const r = run(dir, 'msg', f);
  assert.equal(r.code, 1);
  assert.match(r.out, /сообщение коммита, строка 1: «secret-client»/);
});

test('нет списка — предупреждение, код 0', () => {
  const dir = gitRepo({ 'a.md': 'secret-client' });
  const r = run(dir, 'tree');
  assert.equal(r.code, 0);
  assert.match(r.out, /нет списка .*kit-denylist — проверка не выполнена/);
});

test('install: хуки pre-commit и commit-msg останавливают коммит со словом в файле или сообщении; чистый проходит; чужой хук не трогается', () => {
  const dir = withList({ 'a.md': 'a' });
  const inst = run(dir, 'install');
  assert.equal(inst.code, 0, inst.out);
  assert.match(inst.out, /хуки pre-commit и commit-msg поставлены/);
  writeFiles(dir, { 'b.md': 'утечка secret-client\n' });
  gitc(dir, 'add', '-A');
  const bad = gitc(dir, 'commit', '-q', '-m', 'чисто');
  assert.notEqual(bad.status, 0, 'pre-commit должен остановить');
  assert.match(bad.stderr, /b\.md:1: «secret-client»/);
  writeFiles(dir, { 'b.md': 'чисто\n' });
  gitc(dir, 'add', '-A');
  const badMsg = gitc(dir, 'commit', '-q', '-m', 'про user999');
  assert.notEqual(badMsg.status, 0, 'commit-msg должен остановить');
  assert.match(badMsg.stderr, /сообщение коммита/);
  const ok = gitc(dir, 'commit', '-q', '-m', 'чистый коммит');
  assert.equal(ok.status, 0, ok.stderr);
  const other = withList({ 'a.md': 'a' });
  fs.writeFileSync(path.join(other, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const r = run(other, 'install');
  assert.equal(r.code, 2);
  assert.match(r.out, /pre-commit уже есть и он не наш/);
  assert.equal(fs.readFileSync(path.join(other, '.git', 'hooks', 'pre-commit'), 'utf8'), '#!/bin/sh\nexit 0\n');
});
