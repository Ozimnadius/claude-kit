'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeProject, writeFiles, runScript } = require('./helpers');
const { ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, paramsMd, progressMd } = require('./fixtures');

const run = (dir) => runScript('session-start.js', {
  input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
});

test('чужой проект — тишина', () => {
  const r = run(makeProject({ 'index.php': '<?php' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('alpha: «Сейчас», общие правила, Always и «код пишет Claude»', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': ALPHA_CLAUDE_MD, 'docs/progress.md': progressMd() }));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас \(из docs\/progress\.md\)/);
  assert.match(r.stdout, /1\.2 — инвентаризация на проде/);
  assert.match(r.stdout, /\/kit:step-done/);
  assert.match(r.stdout, /AskUserQuestion/);
  assert.match(r.stdout, /PhpStorm Always/);
  assert.match(r.stdout, /Код пишет Claude/);
  assert.doesNotMatch(r.stdout, /Код пишет пользователь/);
  assert.doesNotMatch(r.stdout, /нет раздела «Параметры для агентов»/);
});

test('superpowers по правилам kit: правило всегда, с путём к шаблону спеки; ветки и worktree — только при автозаливке', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'PhpStorm Always' });
  const alpha = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(alpha, /- Superpowers по правилам kit: спеки и планы — в \.claude\/docs\/work\/ \(spec-<тема>\.md по шаблону .*\/skills\/project-init\/templates\/spec\.md, plan-<тема>\.md с разделом «Чек-лист» в начале: строка на задачу «- \[ \] N\.M — …», шаги внутри задач — без чекбоксов\), не в docs\/superpowers\//);
  assert.match(alpha, /коммит только через \/kit:step-done; задача плана = шаг kit N\.M/);
  const tpl = /по шаблону (\S+?), plan/.exec(alpha)[1];
  assert.ok(require('fs').existsSync(tpl), 'шаблон есть: ' + tpl);
  assert.match(alpha, /Superpowers при автозаливке: без отдельных веток и worktree/);
  const gamma = run(makeProject({ '.claude/CLAUDE.md': GAMMA_CLAUDE_MD, 'docs/progress.md': progressMd() })).stdout;
  assert.match(gamma, /спеки и планы — в docs\/work\//);
  assert.doesNotMatch(gamma, /Superpowers при автозаливке/, 'выкладка вручную — без правила про ветки');
});

test('git worktree в .claude/worktrees/ при PhpStorm Always — предупреждение про автозаливку', () => {
  const files = { '.claude/CLAUDE.md': ALPHA_CLAUDE_MD, 'docs/progress.md': progressMd() };
  const main = makeProject();
  const wt = writeFiles(path.join(main, '.claude', 'worktrees', 'brave-turing-1a2b3c'), files);
  const r = run(wt);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /PhpStorm Always/);
  assert.match(r.stdout, /Сессия работает в git worktree — правки здесь не попадут на сервер автозаливкой основной папки/);
  assert.ok(r.stdout.indexOf('git worktree') > r.stdout.indexOf('Код пишет Claude'), 'предупреждение — после правила «Код пишет Claude»');
  const viaEnv = runScript('session-start.js', { input: {}, env: { CLAUDE_PROJECT_DIR: wt.replace(/\\/g, '/') } });
  assert.match(viaEnv.stdout, /git worktree/);
  assert.doesNotMatch(run(makeProject(files)).stdout, /git worktree/, 'основная папка — без предупреждения');
  const manual = writeFiles(path.join(main, '.claude', 'worktrees', 'manual'), { '.claude/CLAUDE.md': GAMMA_CLAUDE_MD });
  assert.doesNotMatch(run(manual).stdout, /git worktree/, 'выкладка вручную — без предупреждения');
});

test('«вручную; дев — PhpStorm Always»: правило про черновики — про дев, не про прод', () => {
  const md = paramsMd({ 'Код пишет': 'пользователь', 'Окружение': 'дев+прод', 'Выкладка': 'вручную; дев — PhpStorm Always' });
  const r = run(makeProject({ '.claude/CLAUDE.md': md }));
  assert.match(r.stdout, /Автозаливка на дев: любое сохранение в проекте сразу уходит на дев-сервер/);
  assert.match(r.stdout, /Черновики — только во временной папке сессии/);
  assert.doesNotMatch(r.stdout, /Выкладка: PhpStorm Always —/);
  const alpha = run(makeProject({ '.claude/CLAUDE.md': ALPHA_CLAUDE_MD }));
  assert.match(alpha.stdout, /Выкладка: PhpStorm Always — любое сохранение/);
  assert.doesNotMatch(alpha.stdout, /Автозаливка на дев/);
  const main = makeProject();
  const wt = writeFiles(path.join(main, '.claude', 'worktrees', 'dev'), { '.claude/CLAUDE.md': md });
  assert.match(run(wt).stdout, /git worktree/, 'worktree при автозаливке на дев — тоже предупреждение');
});

test('gamma: код пишет пользователь, выкладка вручную', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': GAMMA_CLAUDE_MD, 'docs/progress.md': progressMd() }));
  assert.match(r.stdout, /Код пишет пользователь/);
  assert.doesNotMatch(r.stdout, /PhpStorm Always/);
});

test('только журнал — подсказка про /kit:project-init', () => {
  const r = run(makeProject({ 'docs/progress.md': progressMd() }));
  assert.match(r.stdout, /## Сейчас/);
  assert.match(r.stdout, /нет раздела «Параметры для агентов» — предложи пользователю \/kit:project-init/);
});

test('только параметры, журнала нет', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'docs/log.md' }) }));
  assert.match(r.stdout, /Журнала docs\/log\.md нет/);
  assert.match(r.stdout, /Правила процесса/);
});

test('длинное «Сейчас» обрезается', () => {
  const r = run(makeProject({ 'docs/progress.md': progressMd('- **Этап:** ' + 'я'.repeat(10000)) }));
  assert.match(r.stdout, /обрезано — полностью в docs\/progress\.md/);
  assert.ok(r.stdout.length < 8000, 'длина ' + r.stdout.length);
});

test('CLAUDE_PROJECT_DIR важнее cwd; мусор на stdin не ломает хук', () => {
  const dir = makeProject({ 'docs/progress.md': progressMd() });
  const r = runScript('session-start.js', { input: 'не json', env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас/);
});

test('документы: новая раскладка — правило про .claude/docs без подсказки о переезде; старая — с подсказкой', () => {
  const md = paramsMd({ 'Режим': 'bitrix', 'Код пишет': 'Claude', 'Выкладка': 'вручную' });
  const fresh = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() }));
  assert.match(fresh.stdout, /## Сейчас \(из \.claude\/docs\/progress\.md\)/);
  assert.ok(fresh.stdout.includes('- Документы проекта — в .claude/docs/: планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.\n'), fresh.stdout);
  assert.doesNotMatch(fresh.stdout, /Переезд в \.claude\/docs/);
  const old = run(makeProject({ 'docs/progress.md': progressMd() }));
  assert.match(old.stdout, /- Документы проекта — в docs\/: .* Переезд в \.claude\/docs — через \/kit:project-init\./);
  assert.equal(run(makeProject({ 'index.php': '' })).stdout, '', 'вне kit-проекта — тишина');
});
