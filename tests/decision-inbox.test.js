'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN, makeProject, runScript } = require('./helpers');
const { paramsMd, progressMd } = require('./fixtures');
const { readInbox } = require('../plugins/kit/scripts/decision-inbox');

const INBOX = '.claude/kit-inbox.jsonl';
const kitProject = () => makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }), '.claude/docs/progress.md': progressMd() });
const inbox = (dir) => readInbox(path.join(dir, INBOX));

// Так приходит в хук после AskUserQuestion: вопросы — во входе, ответы «вопрос → подпись или свой текст» — в результате.
const Q_STORE = {
  question: 'Где хранить файл входящих?', header: 'Входящие', multiSelect: false,
  options: [{ label: 'Локально (Рекомендую)', description: 'не в git и не на сервере' }, { label: 'В папке документов', description: 'попадает в git' }],
};
const Q_FREE = { question: 'Как вести крупные задачи?', header: 'Спека', multiSelect: false, options: [{ label: 'Надстройка', description: '' }, { label: 'Свой скилл', description: '' }] };
const Q_MULTI = { question: 'Что исключить?', header: 'Исключения', multiSelect: true, options: [{ label: '.gitignore', description: '' }, { label: 'local/modules', description: '' }] };
const Q_SKIPPED = { question: 'Без ответа?', header: 'Пропуск', multiSelect: false, options: [{ label: 'Да', description: '' }, { label: 'Нет', description: '' }] };
const hookInput = (dir, answers, extra = {}) => ({
  hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', session_id: 's1', cwd: dir,
  tool_input: { questions: [Q_STORE, Q_FREE, Q_MULTI, Q_SKIPPED] },
  tool_response: { questions: [Q_STORE, Q_FREE, Q_MULTI, Q_SKIPPED], answers },
  ...extra,
});
const ANSWERS = { 'Где хранить файл входящих?': 'Локально (Рекомендую)', 'Как вести крупные задачи?': 'Что за надстройка?', 'Что исключить?': '.gitignore, local/modules' };
const hook = (input) => runScript('decision-inbox.js', { args: ['--hook'], input });
const cli = (dir, ...args) => runScript('decision-inbox.js', { args, cwd: dir });

test('hooks.json: PostToolUse AskUserQuestion запускает decision-inbox.js --hook', () => {
  const post = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PostToolUse;
  const entry = post.find((h) => h.matcher === 'AskUserQuestion');
  assert.ok(entry, 'нет записи с matcher AskUserQuestion');
  assert.deepEqual(entry.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/scripts/decision-inbox.js', '--hook']);
});

test('--hook: по записи на отвеченный вопрос — варианты с описаниями, ответ, свой ли текст; без вывода, код 0', () => {
  const dir = kitProject();
  const r = hook(hookInput(dir, ANSWERS));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  const e = inbox(dir);
  assert.equal(e.length, 3, 'вопрос без ответа не пишется');
  assert.equal(e[0].question, 'Где хранить файл входящих?');
  assert.equal(e[0].answer, 'Локально (Рекомендую)');
  assert.equal(e[0].own, false);
  assert.deepEqual(e[0].options[1], { label: 'В папке документов', description: 'попадает в git' });
  assert.equal(e[0].session, 's1');
  assert.match(e[0].ts, /^\d{4}-\d\d-\d\dT/);
  assert.equal(e[1].own, true, 'текст из «Другое» — свой ответ');
  assert.equal(e[2].own, false, 'мультивыбор: подписи через «, »');
  hook(hookInput(dir, { 'Без ответа?': 'Нет' }));
  assert.equal(inbox(dir).length, 4, 'следующий вызов дописывает');
});

test('--hook: вне kit-проекта, другой инструмент, нет ответов, мусор на stdin — файла нет, код 0', () => {
  const plain = makeProject({ 'index.php': '' });
  assert.equal(hook(hookInput(plain, ANSWERS)).code, 0);
  assert.equal(fs.existsSync(path.join(plain, INBOX)), false);
  const dir = kitProject();
  hook(hookInput(dir, ANSWERS, { tool_name: 'Write' }));
  hook(hookInput(dir, undefined));
  assert.equal(runScript('decision-inbox.js', { args: ['--hook'], input: 'не json' }).code, 0);
  assert.equal(fs.existsSync(path.join(dir, INBOX)), false);
});

test('--hook: результат строкой JSON и ответы только во входе — тоже читаются', () => {
  const dir = kitProject();
  hook({ ...hookInput(dir, ANSWERS), tool_response: JSON.stringify({ answers: { 'Что исключить?': '.gitignore' } }) });
  hook({ ...hookInput(dir, ANSWERS), tool_response: undefined, tool_input: { questions: [Q_STORE], answers: { 'Где хранить файл входящих?': 'В папке документов' } } });
  assert.deepEqual(inbox(dir).map((e) => e.answer), ['.gitignore', 'В папке документов']);
});

test('--list: ответ, выбранное с описанием, другие варианты, «записей: N»; --clear N убирает первые N, пришедшие позже остаются', () => {
  const dir = kitProject();
  assert.equal(cli(dir, '--list').stdout, 'Входящих ответов нет.\n');
  hook(hookInput(dir, ANSWERS));
  const list = cli(dir, '--list').stdout;
  assert.match(list, /^1\. \[\d{4}-\d\d-\d\d\] Где хранить файл входящих\? → Локально \(Рекомендую\)\n   выбрано: Локально \(Рекомендую\) — не в git и не на сервере\n   другие: В папке документов — попадает в git\n/);
  assert.match(list, /2\. \[.+\] Как вести крупные задачи\? → Что за надстройка\? \(свой ответ\)\n   другие: Надстройка; Свой скилл\n/);
  assert.match(list, /записей: 3\n$/);
  hook(hookInput(dir, { 'Без ответа?': 'Да' }));
  assert.equal(cli(dir, '--clear', '3').stdout, 'Убрано записей: 3.\n');
  assert.deepEqual(inbox(dir).map((e) => e.question), ['Без ответа?']);
  cli(dir, '--clear', '5');
  assert.equal(fs.existsSync(path.join(dir, INBOX)), false, 'всё разобрано — файла нет');
  assert.equal(cli(dir, '--clear').code, 2);
  assert.equal(cli(dir).code, 2);
});
