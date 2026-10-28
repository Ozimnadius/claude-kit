'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject, tmpDir, writeFiles, runScript } = require('./helpers');
const { ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, paramsMd, progressMd, journalFiles } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { mattRules } = require('../plugins/kit/scripts/session-start');

// Файлов плагинов и настроек этого компьютера тесты не читают: по умолчанию оба пути — на файл, которого нет.
const NO_FILE = path.join(tmpDir('kit-ss-nofile-'), 'нет.json');

// Хук отдаёт JSON (с 3.1.0): stdout — контекст Claude, user — напоминание пользователю.
// env — переменные окружения хука (KIT_PLUGINS_FILE, KIT_USER_SETTINGS — поверх «нет файла»).
const runEnv = (dir, env = {}) => {
  const r = runScript('session-start.js', {
    input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
    env: { KIT_PLUGINS_FILE: NO_FILE, KIT_USER_SETTINGS: NO_FILE, ...env },
  });
  if (!r.stdout) return { ...r, user: '' };
  const o = JSON.parse(r.stdout);
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
  return { ...r, stdout: o.hookSpecificOutput.additionalContext, user: o.systemMessage || '' };
};
const run = (dir) => runEnv(dir);
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

// Система Мэтта (с 3.3.0): правила Мэтта вместо правил superpowers; плагин не на проекте — напоминание о /kit:project-init.
const MATT_PLUGIN = 'mattpocock-skills@claude-plugins-official';
const MATT_PARAMS = { 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да', 'Версия kit': VERSION };
const MATT_RULE = /- Система Мэтта \(проект Мэтта\)/;
const MATT_REMIND_CTX = '- Система Мэтта: да, но плагин mattpocock-skills на этот проект не поставлен или выключен — запустите /kit:project-init (поставит его и выключит superpowers в проекте).';
const MATT_REMIND_USER = '[kit] Система Мэтта: плагин mattpocock-skills на этот проект не поставлен — запустите /kit:project-init.';

// Подставной installed_plugins.json: запись плагина Мэтта на проект dir (поля поверх — over).
function pluginsOn(dir, over = {}) {
  const file = path.join(tmpDir('kit-ss-plugins-'), 'installed_plugins.json');
  const rec = { scope: 'project', projectPath: dir, installPath: '/x', version: '1.3.1', ...over };
  fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: { [MATT_PLUGIN]: [rec] } }));
  return { KIT_PLUGINS_FILE: file };
}

const mattFiles = (params = MATT_PARAMS) => ({ '.claude/CLAUDE.md': paramsMd(params), '.claude/docs/progress.md': progressMd() });

test('проект Мэтта с плагином: правила Мэтта и места файлов, без правил superpowers', () => {
  const dir = makeProject(mattFiles());
  const { stdout: ctx, user } = runEnv(dir, pluginsOn(dir));
  assert.match(ctx, MATT_RULE);
  assert.match(ctx, /work\/<тема>-build\//);
  assert.match(ctx, /matt-skill\.js" <имя>/);
  assert.doesNotMatch(ctx, /Superpowers по правилам kit/);
  assert.doesNotMatch(ctx, /Superpowers при автозаливке/);
  assert.equal(user, '');
  assert.ok(!ctx.includes(MATT_REMIND_CTX), 'напоминания нет');
  // Путь к скрипту — абсолютный, с «/», и файл по нему есть.
  const script = /node "([^"]+matt-skill\.js)" <имя>/.exec(ctx)[1];
  assert.ok(!script.includes('\\'), script);
  assert.ok(path.isAbsolute(script) && fs.existsSync(script), 'скрипт есть: ' + script);
  // Места файлов — по папке документов проекта.
  assert.ok(ctx.includes('- Файлы системы Мэтта — в .claude/docs/: карта, тикеты-решения и спек — work/<тема>/ (map.md, issues/NN-<slug>.md, spec.md), '
    + 'тикеты реализации — work/<тема>-build/ (issues/NN-<slug>.md, README.md), глоссарий — GLOSSARY.md, ADR — adr/NNNN-<slug>.md, '
    + 'исследования и прочие документы навыков — work/, прототипы prototype — HTML в work/<тема>/ (варианты экранов на сайте — только где правки не уходят на прод сами); '
    + 'трекер задач — эти локальные файлы. В корень проекта (GLOSSARY.md, CONTEXT.md, docs/adr/, docs/agents/, .scratch/) не пиши.\n'), ctx);
  assert.match(ctx, /implement-spec и setup-matt-pocock-skills не используются; вопросы грилинга — через AskUserQuestion\./);
  assert.match(ctx, /## Правила процесса \(плагин kit\)/, 'общие правила kit на месте');
});

test('проект Мэтта без плагина на проекте: напоминание о /kit:project-init в контексте и пользователю, правила superpowers на месте', () => {
  const dir = makeProject(mattFiles());
  // Запись есть, но на другой проект — для этого проекта плагин не поставлен.
  const { stdout: ctx, user } = runEnv(dir, pluginsOn(path.join(dir, 'другой')));
  assert.ok(ctx.includes(MATT_REMIND_CTX), ctx);
  assert.equal(user, MATT_REMIND_USER);
  assert.match(ctx, /Superpowers по правилам kit/);
  assert.match(ctx, /Superpowers при автозаливке/);
  assert.doesNotMatch(ctx, MATT_RULE);
  assert.doesNotMatch(ctx, /Файлы системы Мэтта/);
  // Нет installed_plugins.json вовсе — то же самое, без сбоя.
  const none = runEnv(makeProject(mattFiles()));
  assert.equal(none.code, 0);
  assert.equal(none.user, MATT_REMIND_USER);
  assert.ok(none.stdout.includes(MATT_REMIND_CTX));
  // Битый installed_plugins.json — как «не установлен».
  const broken = path.join(tmpDir('kit-ss-broken-'), 'installed_plugins.json');
  fs.writeFileSync(broken, '{не json');
  const bad = runEnv(makeProject(mattFiles()), { KIT_PLUGINS_FILE: broken });
  assert.equal(bad.code, 0);
  assert.equal(bad.user, MATT_REMIND_USER);
  assert.match(bad.stdout, /Superpowers по правилам kit/);
});

test('проект Мэтта, плагин выключен в настройках проекта: напоминание, правила superpowers', () => {
  const dir = makeProject({ ...mattFiles(), '.claude/settings.json': JSON.stringify({ enabledPlugins: { [MATT_PLUGIN]: false } }) });
  const r = runEnv(dir, pluginsOn(dir));
  assert.ok(r.stdout.includes(MATT_REMIND_CTX), r.stdout);
  assert.equal(r.user, MATT_REMIND_USER);
  assert.match(r.stdout, /Superpowers по правилам kit/);
  assert.doesNotMatch(r.stdout, MATT_RULE);
});

test('напоминание о Мэтте и о версии kit — пользователю вместе, через перевод строки', () => {
  const dir = makeProject(mattFiles({ ...MATT_PARAMS, 'Версия kit': '0.0.1' }));
  const lines = runEnv(dir).user.split('\n');
  assert.equal(lines.length, 2, lines.join(' | '));
  assert.match(lines[0], /^\[kit\] Проект настроен на kit 0\.0\.1, установлен /);
  assert.equal(lines[1], MATT_REMIND_USER);
});

test('сессия в worktree приложения: плагин на проект ищется по основной папке', () => {
  const main = makeProject();
  const wt = writeFiles(path.join(main, '.claude', 'worktrees', 'brave-turing-1a2b3c'), mattFiles());
  const r = runEnv(wt, pluginsOn(main));
  assert.match(r.stdout, MATT_RULE);
  assert.equal(r.user, '');
});

test('обычный kit-проект: строк Мэтта нет, superpowers по правилам kit', () => {
  const files = mattFiles({ 'Выкладка': 'PhpStorm Always', 'Версия kit': VERSION });
  const plain = runEnv(makeProject(files));
  assert.match(plain.stdout, /Superpowers по правилам kit/);
  assert.match(plain.stdout, /Superpowers при автозаливке/);
  assert.doesNotMatch(plain.stdout, /Система Мэтта|Мэтт/);
  assert.equal(plain.user, '');
  // «нет» — как обычный проект, даже если плагин на проекте стоит.
  const dir = makeProject(mattFiles({ ...MATT_PARAMS, 'Система Мэтта': 'нет' }));
  const off = runEnv(dir, pluginsOn(dir));
  assert.match(off.stdout, /Superpowers по правилам kit/);
  assert.doesNotMatch(off.stdout, /Система Мэтта|Мэтт/);
  assert.equal(off.user, '');
});

test('плагин Мэтта 9.9.9 при большой работе — строка «проверены на 1.3.1» для Claude, не пользователю; без work/*/issues/ — строки нет', () => {
  const warn = /- Плагин Мэтта обновился: правила kit проверены на 1\.3\.1, стоит 9\.9\.9 — если навык ведёт себя не так, как в \/kit:matt \(пути, имена навыков, поля тикетов\), сверь и скажи пользователю\./;
  const big = makeProject({ ...mattFiles(), '.claude/docs/work/alpha-topic/issues/01-first.md': '# тикет\n' });
  const r = runEnv(big, pluginsOn(big, { version: '9.9.9' }));
  assert.match(r.stdout, MATT_RULE);
  assert.match(r.stdout, warn);
  assert.equal(r.user, '', 'пользователю строки о версии плагина нет');
  const small = makeProject({ ...mattFiles(), '.claude/docs/work/alpha-topic/spec.md': '# спек\n' });
  assert.doesNotMatch(runEnv(small, pluginsOn(small, { version: '9.9.9' })).stdout, /Плагин Мэтта обновился/, 'папки issues/ нет — строки нет');
  assert.doesNotMatch(runEnv(big, pluginsOn(big)).stdout, /Плагин Мэтта обновился/, 'версия 1.3.1 — строки нет');
});

test('mattRules: не проект Мэтта — пусто; плагин на проекте — правила; нет плагина — напоминание', () => {
  const plain = makeProject(mattFiles({ 'Версия kit': VERSION }));
  assert.deepEqual(mattRules(kitInfo(plain)), { on: false, lines: [], user: '' });
  const dir = makeProject(mattFiles());
  const prev = { p: process.env.KIT_PLUGINS_FILE, s: process.env.KIT_USER_SETTINGS };
  try {
    process.env.KIT_USER_SETTINGS = NO_FILE;
    process.env.KIT_PLUGINS_FILE = pluginsOn(dir).KIT_PLUGINS_FILE;
    const on = mattRules(kitInfo(dir));
    assert.equal(on.on, true);
    assert.equal(on.user, '');
    assert.equal(on.lines.length, 2, 'правило и места файлов; версия плагина проверена — строки о версии нет');
    process.env.KIT_PLUGINS_FILE = NO_FILE;
    const off = mattRules(kitInfo(dir));
    assert.equal(off.on, false);
    assert.deepEqual(off.lines, [MATT_REMIND_CTX]);
    assert.equal(off.user, MATT_REMIND_USER);
  } finally {
    for (const [k, v] of [['KIT_PLUGINS_FILE', prev.p], ['KIT_USER_SETTINGS', prev.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
