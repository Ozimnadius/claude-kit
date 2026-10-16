'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { paramsMd, journalFiles } = require('./fixtures');

const FAKE = path.join(__dirname, 'fake-ssh.js');
const INBOX = '.claude/kit-inbox.jsonl';
const PARAMS = { 'Режим': 'общий', 'Окружение': 'прод', 'Выкладка': 'вручную', 'Не коммитить': 'secret/' };
const repo = (params = {}) => gitRepo({ '.claude/CLAUDE.md': paramsMd({ ...PARAMS, ...params }), ...journalFiles(), 'a.php': '1', 'old.txt': 'старый\n' });
const step = (dir, args = []) => runScript('kit-step.js', { args, cwd: dir, env: { KIT_SSH: FAKE } });
const entry = (o) => JSON.stringify({ ts: '2026-10-20T10:00:00.000Z', session: 's', header: 'h', multiSelect: false, own: false, ...o });

// Раздел вывода: от заголовка до пустой строки.
function block(out, title) {
  const i = out.indexOf(title);
  assert.ok(i >= 0, 'нет раздела «' + title + '»:\n' + out);
  const rest = out.slice(i);
  const end = rest.indexOf('\n\n');
  return end < 0 ? rest : rest.slice(0, end);
}

test('файлы шага: кириллица и переименование — в кавычках, при переименовании оба пути; напоминание о закрытии этапа', () => {
  const dir = repo();
  writeFiles(dir, { 'a.php': '2', 'папка/новый файл.php': 'n' });
  git(dir, 'mv', 'old.txt', 'new.txt');
  const r = step(dir, ['36.5']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const files = block(r.stdout, 'Файлы шага');
  assert.ok(files.includes('"a.php"'), files);
  assert.ok(files.includes('"папка/новый файл.php"'), files);
  assert.ok(files.includes('"old.txt" "new.txt"'), files);
  assert.match(r.stdout, /reference\/stage-close\.md/);
});

test('путь из «Не коммитить» и .idea — в «Не пойдут в коммит», а не в файлах шага', () => {
  const dir = repo();
  writeFiles(dir, { 'a.php': '2', 'secret/key.txt': 'k', '.idea/workspace.xml': '<x/>' });
  const r = step(dir);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(block(r.stdout, 'Файлы шага'), /secret\/|\.idea/);
  const skip = block(r.stdout, 'Не пойдут в коммит');
  assert.ok(skip.includes('secret/key.txt'), skip);
  assert.ok(skip.includes('.idea/workspace.xml'), skip);
});

test('входящие: выбранный вариант — «почему» из описания, «что отвергли» — другие через «; »; свой ответ; заметка — NOTES; входящих: 3', () => {
  const dir = repo();
  writeFiles(dir, { [INBOX]: [
    entry({ question: 'Где хранить снимки?', answer: 'Локально (Рекомендую)', options: [
      { label: 'Локально (Рекомендую)', description: 'не в git и не на сервере' }, { label: 'В git', description: 'видны всем' }, { label: 'На сервере', description: '' }] }),
    entry({ question: 'Как назвать?', answer: 'kit-journal', own: true, options: [{ label: 'journal', description: '' }, { label: 'docs', description: '' }] }),
    JSON.stringify({ ts: '2026-10-20T11:00:00.000Z', type: 'note', text: 'Отчёт заказчику: 2026-10-20' }),
  ].join('\n') + '\n' });
  const r = step(dir);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const inbox = block(r.stdout, 'Входящие');
  assert.ok(inbox.includes('- 2026-10-20 | Где хранить снимки? → Локально | не в git и не на сервере | В git; На сервере | пользователь'), inbox);
  assert.ok(inbox.includes('- 2026-10-20 | Как назвать? → kit-journal (свой ответ) | — | journal; docs | пользователь'), inbox);
  assert.ok(inbox.includes('NOTES:\n- Отчёт заказчику: 2026-10-20'), inbox);
  assert.match(inbox, /\nвходящих: 3$/);
});

test('«Claude по SSH»: итог сухого прогона ssh-deploy.js и указание reference/ssh.md; нечего заливать — без указания', () => {
  const dir = repo({ 'Выкладка': 'Claude по SSH', 'SSH прод': 'ok:/srv/site' });
  writeFiles(dir, { 'a.php': '2', 'b.php': 'новый' });
  const r = step(dir);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\nвыкладка: Claude по SSH — Залить 2, Удалить 0; порядок SSH — прочитай reference\/ssh\.md\n/);
  const clean = step(repo({ 'Выкладка': 'Claude по SSH', 'SSH прод': 'ok:/srv/site' }));
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /\nвыкладка: Claude по SSH — Нечего заливать\n/);
  assert.match(clean.stdout, /\nдокументы на сервере: нет\n/);
});

test('удалённый репозиторий без ветки — «первая отправка»; без параметра — «—»', () => {
  const bare = makeProject();
  git(bare, 'init', '-q', '--bare');
  const dir = repo({ 'Удалённый репозиторий': 'origin' });
  git(dir, 'remote', 'add', 'origin', bare);
  const r = step(dir);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\nудалённый репозиторий: origin — первая отправка\n/);
  assert.match(step(repo()).stdout, /\nудалённый репозиторий: —\n/);
});

test('старый формат — код 2 и сообщение о переезде; не kit-проект — код 2; лишний аргумент — код 4', () => {
  const r = step(repo({ 'Окружение': 'дев+прод' }));
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /в старом формате \(Окружение: дев\+прод\) — до работы предложи пользователю \/kit:project-init/);
  assert.equal(step(gitRepo({ 'a.txt': '1' })).code, 2);
  assert.equal(step(repo(), ['36.5', 'лишний']).code, 4);
});
