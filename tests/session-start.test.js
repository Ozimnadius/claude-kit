'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeProject, writeFiles, runScript } = require('./helpers');
const { ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, paramsMd, progressMd, journalFiles } = require('./fixtures');

// Хук отдаёт JSON (с 3.1.0): stdout — контекст Claude, user — напоминание пользователю.
const run = (dir) => {
  const r = runScript('session-start.js', {
    input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
  });
  if (!r.stdout) return { ...r, user: '' };
  const o = JSON.parse(r.stdout);
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
  return { ...r, stdout: o.hookSpecificOutput.additionalContext, user: o.systemMessage || '' };
};
const VERSION = require('../plugins/kit/.claude-plugin/plugin.json').version;

test('чужой проект — тишина', () => {
  const r = run(makeProject({ 'index.php': '<?php' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('alpha: «Сейчас», общие правила, Always и «код пишет Claude»', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': ALPHA_CLAUDE_MD, ...journalFiles() }));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас \(из \.claude\/docs\/progress\.md\)/);
  assert.match(r.stdout, /1\.2 — инвентаризация на проде/);
  assert.match(r.stdout, /\/kit:step-done/);
  assert.match(r.stdout, /AskUserQuestion/);
  assert.match(r.stdout, /PhpStorm Always/);
  assert.match(r.stdout, /Код пишет Claude/);
  assert.doesNotMatch(r.stdout, /Код пишет пользователь/);
  assert.doesNotMatch(r.stdout, /нет раздела «Параметры для агентов»/);
  assert.doesNotMatch(r.stdout, /в старом формате/, 'журнал kit 3.0 — без правила о переезде');
});

test('superpowers по правилам kit: правило всегда, с путём к шаблону спеки; ветки и worktree — только при автозаливке', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'PhpStorm Always' });
  const alpha = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(alpha, /- Superpowers по правилам kit: спеки и планы — в \.claude\/docs\/work\/ \(spec-<тема>\.md по шаблону .*\/skills\/project-init\/templates\/spec\.md, plan-<тема>\.md с разделом «Чек-лист» в начале: строка на задачу «- \[ \] N\.M — …», шаги внутри задач — без чекбоксов\), не в docs\/superpowers\//);
  assert.match(alpha, /коммит только через \/kit:step-done; задача плана = шаг kit N\.M/);
  const tpl = /по шаблону (\S+?), plan/.exec(alpha)[1];
  assert.ok(require('fs').existsSync(tpl), 'шаблон есть: ' + tpl);
  assert.match(alpha, /Superpowers при автозаливке: без отдельных веток и worktree/);
  const gamma = run(makeProject({ '.claude/CLAUDE.md': GAMMA_CLAUDE_MD, ...journalFiles() })).stdout;
  assert.doesNotMatch(gamma, /Superpowers при автозаливке/, 'выкладка вручную — без правила про ветки');
});

test('журнал по частям: строка о journal/ — только если папка есть', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'вручную' });
  const split = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd(), '.claude/docs/journal/decisions.md': '# решения\n' })).stdout;
  assert.ok(split.includes('- Журнал по частям: решения — .claude/docs/journal/decisions.md, баги — .claude/docs/journal/bugs.md, '
    + 'справочник и материалы заказчика — .claude/docs/journal/reference.md, закрытые этапы — .claude/docs/journal/stages/; ищи и там.'), split);
  const single = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() })).stdout;
  assert.doesNotMatch(single, /Журнал по частям/);
});

test('git worktree в .claude/worktrees/ при PhpStorm Always — предупреждение про автозаливку', () => {
  const files = { '.claude/CLAUDE.md': ALPHA_CLAUDE_MD, ...journalFiles() };
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

test('старый формат — правило о переезде с признаками через «; »; правил автозаливки по старому значению нет (с 3.0.0)', () => {
  const md = paramsMd({ 'Окружение': 'дев+прод', 'Выкладка': 'вручную; дев — PhpStorm Always' });
  const out = run(makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() })).stdout;
  assert.ok(out.includes('- Журнал или параметры в старом формате (журнал одним файлом; Окружение: дев+прод; Выкладка: вручную; дев — PhpStorm Always) '
    + '— до работы предложи пользователю /kit:project-init: переезд на формат kit 3.0.\n'), out);
  assert.doesNotMatch(out, /Автозаливка на дев|любое сохранение в проекте сразу уходит/);
});

test('правила «Код пишет пользователь» нет ни при каком параметре (с 3.0.0)', () => {
  for (const who of ['пользователь', 'Claude', '—']) {
    const out = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Код пишет': who }), ...journalFiles() })).stdout;
    assert.doesNotMatch(out, /Код пишет пользователь/, who);
  }
});

test('проверка результата на сервере — только при адресе сервера окружения, одним пакетным вызовом браузера (с 3.0.0)', () => {
  const out = (params) => run(makeProject({ '.claude/CLAUDE.md': paramsMd(params), ...journalFiles() })).stdout;
  const rule = /- Код пишет Claude: после записи проверить результат на сервере/;
  assert.doesNotMatch(out({ 'Код пишет': 'Claude', 'Прод': '—', 'Дев': '—' }), rule, 'без адреса — правила нет');
  const prod = out({ 'Прод': 'shop.example.com' });
  assert.match(prod, rule);
  assert.match(prod, /страницу проверяй одним пакетным вызовом браузера \(browser_batch: открыть, снимок на десктопе, мобильная ширина, снимок\), снимки — уменьшенные/);
  assert.doesNotMatch(out({ 'Окружение': 'дев', 'Прод': 'shop.example.com' }), rule, '«дев» — адрес берётся из «Дев»');
  assert.match(out({ 'Окружение': 'дев', 'Дев': 'dev.example.com' }), rule);
});

test('только журнал — подсказка про /kit:project-init', () => {
  const r = run(makeProject({ '.claude/docs/progress.md': progressMd() }));
  assert.match(r.stdout, /## Сейчас/);
  assert.match(r.stdout, /нет раздела «Параметры для агентов» — предложи пользователю \/kit:project-init/);
});

test('только параметры, журнала нет', () => {
  const r = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }) }));
  assert.match(r.stdout, /Журнала \.claude\/docs\/progress\.md нет/);
  assert.match(r.stdout, /Правила процесса/);
  assert.doesNotMatch(r.stdout, /в старом формате/, 'журнала ещё нет — это не старый формат');
});

test('длинное «Сейчас» обрезается', () => {
  const r = run(makeProject({ '.claude/docs/progress.md': progressMd('- **Этап:** ' + 'я'.repeat(10000)) }));
  assert.match(r.stdout, /обрезано — полностью в \.claude\/docs\/progress\.md/);
  assert.ok(r.stdout.length < 8000, 'длина ' + r.stdout.length);
});

test('CLAUDE_PROJECT_DIR важнее cwd; мусор на stdin не ломает хук', () => {
  const dir = makeProject({ '.claude/docs/progress.md': progressMd() });
  const r = runScript('session-start.js', { input: 'не json', env: { CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /## Сейчас/);
});

test('документы — правило про .claude/docs без подсказки о переезде; журнал в docs/ — правило старого формата (с 3.0.0)', () => {
  const md = paramsMd({ 'Режим': 'bitrix', 'Выкладка': 'вручную' });
  const fresh = run(makeProject({ '.claude/CLAUDE.md': md, ...journalFiles() }));
  assert.match(fresh.stdout, /## Сейчас \(из \.claude\/docs\/progress\.md\)/);
  assert.ok(fresh.stdout.includes('- Документы проекта — в .claude/docs/: планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.\n'), fresh.stdout);
  assert.doesNotMatch(fresh.stdout, /Переезд в \.claude\/docs/);
  const old = run(makeProject({ '.claude/CLAUDE.md': md, ...journalFiles(undefined, 'docs') }));
  assert.match(old.stdout, /- Журнал или параметры в старом формате \(журнал не в \.claude\/docs\) — до работы предложи пользователю \/kit:project-init: переезд на формат kit 3\.0\./);
  assert.doesNotMatch(old.stdout, /Переезд в \.claude\/docs/);
  assert.equal(run(makeProject({ 'index.php': '' })).stdout, '', 'вне kit-проекта — тишина');
});

test('правило просмотра перед коммитом — всегда, в том числе при «Коммит: сразу» (с 3.0.0)', () => {
  const rule = /- Коммит — после просмотра: \/kit:step-done показывает незакоммиченные изменения/;
  const out = (params) => run(makeProject({ '.claude/CLAUDE.md': paramsMd(params), ...journalFiles() })).stdout;
  assert.match(out({ 'Режим': 'общий' }), rule);
  assert.match(out({ 'Коммит': 'после просмотра' }), rule);
  assert.match(out({ 'Коммит': 'сразу' }), rule);
});

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="PublishConfigData" autoUpload="Always" serverName="alpha">\n  </component>\n</project>\n';

test('«Claude по SSH»: правило заливки в /kit:step-done, «Код пишет Claude» — проверка после заливки; правил автозаливки нет (с 2.17.0)', () => {
  const md = paramsMd({ 'Выкладка': 'Claude по SSH', 'Окружение': 'прод', 'Прод': 'https://shop.example.com' });
  const out = run(makeProject({ '.claude/CLAUDE.md': md, ...journalFiles() })).stdout;
  assert.match(out, /- Выкладка: Claude по SSH — правки остаются локально, пока \/kit:step-done не зальёт их после просмотра/);
  assert.match(out, /Вне \/kit:step-done на сервер не заливай/);
  assert.match(out, /- Код пишет Claude: результат на сервере проверяй после заливки в \/kit:step-done .*browser_batch/);
  assert.doesNotMatch(out, /после записи проверить результат на сервере/);
  assert.doesNotMatch(out, /PhpStorm Always|Superpowers при автозаливке|уедут на сервер дважды/);
  assert.match(out, /после ответа «Коммитить» \(в режиме «Claude по SSH» — «Залить на сервер»\)/, 'К60: правило просмотра');
});

test('«Claude по SSH», а в deployment.xml автозаливка — предупреждение; без Always и при «PhpStorm Always» — нет', () => {
  const md = paramsMd({ 'Код пишет': 'Claude', 'Выкладка': 'Claude по SSH' });
  const base = { '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd() };
  const on = run(makeProject({ ...base, '.idea/deployment.xml': XML })).stdout;
  assert.match(on, /в PhpStorm включена автозаливка .*уедут на сервер дважды/);
  assert.match(on, /Tools → Deployment → Automatic Upload/);
  const off = run(makeProject({ ...base, '.idea/deployment.xml': XML.replace(' autoUpload="Always"', '') })).stdout;
  assert.doesNotMatch(off, /уедут на сервер дважды/);
  const always = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always' }), '.claude/docs/progress.md': progressMd(),
    '.idea/deployment.xml': XML })).stdout;
  assert.doesNotMatch(always, /уедут на сервер дважды/, 'при PhpStorm Always автозаливка — норма');
});

test('PhpStorm Always при «Окружение: дев» — сохранение уходит на дев-сервер; при «прод» — на сервер', () => {
  const dev = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always', 'Окружение': 'дев' }), '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(dev, /- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на дев-сервер\./);
  const prod = run(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'PhpStorm Always', 'Окружение': 'прод' }), '.claude/docs/progress.md': progressMd() })).stdout;
  assert.match(prod, /- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на сервер\./);
});

test('версия kit: совпала — тихо, иначе напоминание пользователю и строка в контекст', () => {
  const at = (v) => run(makeProject({ '.claude/CLAUDE.md': paramsMd(v === undefined ? {} : { 'Версия kit': v }), ...journalFiles() }));
  const same = at(VERSION);
  assert.equal(same.user, '');
  assert.doesNotMatch(same.stdout, /Версия kit в проекте|Проект настроен на kit/);
  const none = at();
  assert.match(none.user, /^\[kit\] Версия kit в проекте не отмечена \(установлен .+\) — запустите \/kit:project-init/);
  assert.match(none.stdout, /- Версия kit в проекте не отмечена .*решает он\./);
  assert.match(at('0.0.1').user, new RegExp('Проект настроен на kit 0\.0\.1, установлен ' + VERSION.replace(/\./g, '\.') + ' — запустите /kit:project-init'));
  assert.match(at('99.0.0').user, /Проект настроен на kit 99\.0\.0, а установлен более старый .+ — обновите плагин/);
  assert.match(at('3.x').user, /Проект настроен на kit 3\.x, установлен/, 'не разобрана — тоже расхождение');
  const noParams = run(makeProject({ '.claude/docs/progress.md': progressMd() }));
  assert.equal(noParams.user, '', 'нет раздела параметров — своё правило, без напоминания');
});
