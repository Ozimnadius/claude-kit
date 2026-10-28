'use strict';
// Хук guard-matt.js (kit 3.3): в проекте Мэтта — файлы системы Мэтта не в корень проекта, субагенты, подчинённые
// сессии и сама сессия не в отдельном worktree (при любой выкладке), при автозаливке PhpStorm Always — и не в облачной копии.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkTool } = require('../plugins/kit/scripts/guard-matt');
const { PLUGIN, makeProject, runScript } = require('./helpers');
const { progressMd, paramsMd } = require('./fixtures');

const CASES = [ // корень C:\proj; [инструмент, ввод, автозаливка, ожидание]
  ['Write', { file_path: 'C:\\proj\\GLOSSARY.md' }, false, 'files'],
  ['Write', { file_path: 'c:/PROJ/glossary.md' }, false, 'files'],
  ['Edit', { file_path: 'docs/adr/0001-x.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\.scratch\\x\\issues\\01-a.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\.claude\\docs\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\local\\docs\\adr\\x.md' }, false, null],
  ['Write', { file_path: 'C:\\Temp\\GLOSSARY.md' }, false, null],
  ['Agent', { isolation: 'worktree', prompt: 'x' }, true, 'worktree'],
  ['mcp__ccd_session__start_session', { use_worktree: true }, true, 'worktree'],
  // До 47.8б вне автозаливки worktree проходил — теперь отказ с причиной про порядок Мэтта (решение пользователя 2026-10-28).
  ['mcp__ccd_session__start_session', { use_worktree: true }, false, 'worktree-matt'],
  ['Agent', { prompt: 'x' }, true, null],
  // Остальные имена из списка файлов, остальные инструменты записи.
  ['Write', { file_path: 'C:\\proj\\glossary-map.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\CONTEXT.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\context-map.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\docs\\agents\\issue-tracker.md' }, false, 'files'],
  ['MultiEdit', { file_path: 'C:\\proj\\docs\\adr\\0002-y.md' }, false, 'files'],
  ['NotebookEdit', { notebook_path: 'C:\\proj\\.scratch\\n.ipynb' }, false, 'files'],
  // Корень определяется верно: .. внутри пути, другой диск, вне проекта, похожие имена.
  ['Write', { file_path: 'C:\\proj\\sub\\..\\GLOSSARY.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\sub\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\..\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: '../GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'D:\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'D:\\proj\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'C:\\proj2\\GLOSSARY.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\GLOSSARY.md.bak' }, false, null],
  ['Write', { file_path: 'C:\\proj\\..glossary.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\.scratch-old\\a.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\README.md' }, false, null],
  // Нет пути, не строка, другие инструменты — пропуск.
  ['Write', {}, false, null],
  ['Write', { file_path: 42 }, false, null],
  ['Read', { file_path: 'C:\\proj\\GLOSSARY.md' }, false, null],
  ['Bash', { command: 'echo x > GLOSSARY.md' }, false, null],
  // Worktree: Task, ложные значения, автозаливка без isolation.
  ['Task', { isolation: 'worktree', prompt: 'x' }, true, 'worktree'],
  ['Task', { isolation: 'worktree', prompt: 'x' }, false, 'worktree-matt'],
  ['Agent', { isolation: 'worktree', prompt: 'x' }, false, 'worktree-matt'],
  ['Agent', { isolation: 'none', prompt: 'x' }, true, null],
  ['mcp__ccd_session__start_session', { use_worktree: false }, true, null],
  ['mcp__ccd_session__start_session', { use_worktree: 'true' }, true, null],
  ['mcp__ccd_session__start_session', { use_worktree: 'true' }, false, null],
  ['mcp__ccd_session__start_session', { prompt: 'x' }, true, null],
  ['Agent', undefined, true, null],
  // 47.8б: EnterWorktree — при любой выкладке; облачная копия (isolation: remote) — только при автозаливке.
  ['EnterWorktree', {}, true, 'worktree'],
  ['EnterWorktree', { name: 'x' }, false, 'worktree-matt'],
  ['EnterWorktree', undefined, false, 'worktree-matt'],
  ['ExitWorktree', {}, true, null],
  ['Agent', { isolation: 'remote', prompt: 'x' }, true, 'worktree'],
  ['Task', { isolation: 'remote', prompt: 'x' }, true, 'worktree'],
  ['Agent', { isolation: 'remote', prompt: 'x' }, false, null],
  ['Task', { isolation: 'remote' }, false, null],
  // 47.8б: файлы навыков to-questionnaire, teach и triage в корне — отказ; в документах, в подпапках и похожие — пропуск.
  ['Write', { file_path: 'C:\\proj\\to-questionnaire-hosting.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\TO-QUESTIONNAIRE-Hosting.MD' }, false, 'files'],
  ['Write', { file_path: 'to-questionnaire-x.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\MISSION.md' }, false, 'files'],
  ['Write', { file_path: 'c:\\proj\\resources.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\lessons\\01-intro.html' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\learning-records\\0001-x.md' }, false, 'files'],
  ['Write', { file_path: 'C:\\proj\\.out-of-scope\\dark-mode.md' }, false, 'files'],
  ['Edit', { file_path: '.out-of-scope/dark-mode.md' }, true, 'files'],
  ['Write', { file_path: 'C:\\proj\\.claude\\docs\\work\\x\\to-questionnaire-hosting.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\.claude\\docs\\work\\x\\MISSION.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\.claude\\docs\\work\\x\\lessons\\01-intro.html' }, false, null],
  ['Write', { file_path: 'C:\\proj\\sub\\to-questionnaire-x.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\sub\\MISSION.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\local\\lessons\\a.php' }, false, null],
  ['Write', { file_path: 'C:\\proj\\to-questionnaire-x.txt' }, false, null],
  ['Write', { file_path: 'C:\\proj\\questionnaire-x.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\lessons.md' }, false, null],
  ['Write', { file_path: 'C:\\proj\\.out-of-scope-old\\a.md' }, false, null],
  // 47.8ж: teach пишет в lessons/ только уроки HTML (lessons/0001-<имя>.html) — раздел сайта /lessons/ с PHP и подпапками проходит.
  ['Write', { file_path: 'C:\\proj\\LESSONS\\0002-Next.HTML' }, true, 'files'],
  ['Write', { file_path: 'C:\\proj\\lessons\\index.php' }, false, null],
  ['Edit', { file_path: 'lessons/index.php' }, true, null],
  ['Write', { file_path: 'C:\\proj\\lessons\\2024\\a.html' }, false, null],
  ['Write', { file_path: 'C:\\proj\\lessons\\style.css' }, false, null],
  ['Write', { file_path: 'C:\\proj\\learning-records\\index.php' }, false, 'files'],
];

const WANT = {
  files: /\.claude\/docs\/: глоссарий/,
  worktree: /^При автозаливке PhpStorm отдельная копия \(worktree\) не годится/,
  'worktree-matt': /^В проекте Мэтта worktree не используем/,
};

test('checkTool: файлы Мэтта в корне и worktree при автозаливке', () => {
  for (const [tool, toolInput, always, want] of CASES) {
    const reason = checkTool({ tool_name: tool, tool_input: toolInput }, { root: 'C:\\proj', docsRel: '.claude/docs', always });
    const label = `${tool} ${JSON.stringify(toolInput)}${always ? ' (автозаливка)' : ''}`;
    if (want === null) assert.equal(reason, null, label);
    else assert.match(reason, WANT[want], label);
  }
});

test('checkTool: тексты причин и папка документов из ctx.docsRel', () => {
  const files = checkTool({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\GLOSSARY.md' } }, { root: 'C:\\proj', docsRel: '.claude/docs', always: false });
  // С 47.8б тикеты карты и тикеты реализации названы раздельно (research-A М-5), добавлены прочие документы навыков.
  assert.equal(files, 'Файлы системы Мэтта — в .claude/docs/: глоссарий — GLOSSARY.md, ADR — adr/, карта и спек — work/<тема>/, '
    + 'тикеты карты — work/<тема>/issues/, тикеты реализации — work/<тема>-build/issues/, прочие документы навыков — work/. '
    + 'В корень проекта (на сайте это корень сайта) их не кладём.');
  const wt = checkTool({ tool_name: 'Agent', tool_input: { isolation: 'worktree' } }, { root: 'C:\\proj', docsRel: '.claude/docs', always: true });
  assert.equal(wt, 'При автозаливке PhpStorm отдельная копия (worktree) не годится: правки из неё не дойдут до сервера и разойдутся с основной папкой. Запускай без worktree.');
  const wtMatt = checkTool({ tool_name: 'EnterWorktree', tool_input: {} }, { root: 'C:\\proj', docsRel: '.claude/docs', always: false });
  assert.equal(wtMatt, 'В проекте Мэтта worktree не используем: исполнители работают в основной папке, шаг коммитит общая сессия через /kit:step-done.');
  // Другая папка документов — другая подсказка.
  assert.match(checkTool({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\GLOSSARY.md' } }, { root: 'C:\\proj', docsRel: 'notes', always: false }), /в notes\/: глоссарий/);
  // Корень проекта — путь POSIX: тоже работает.
  assert.match(checkTool({ tool_name: 'Write', tool_input: { file_path: '/srv/proj/glossary.md' } }, { root: '/srv/proj', docsRel: '.claude/docs', always: false }), /глоссарий/);
  assert.equal(checkTool({ tool_name: 'Write', tool_input: { file_path: '/srv/other/glossary.md' } }, { root: '/srv/proj', docsRel: '.claude/docs', always: false }), null);
});

test('checkTool: файлы внутри самой папки документов разрешены (Журнал: docs/progress.md → docs/adr/ — верное место)', () => {
  const ctx = { root: 'C:\\proj', docsRel: 'docs', always: false };
  assert.equal(checkTool({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\docs\\adr\\0001-x.md' } }, ctx), null);
  assert.equal(checkTool({ tool_name: 'Write', tool_input: { file_path: 'docs/agents/domain.md' } }, ctx), null);
  assert.match(checkTool({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\GLOSSARY.md' } }, ctx), /в docs\/: глоссарий/);
  assert.match(checkTool({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\.scratch\\a.md' } }, ctx), /в docs\/: глоссарий/);
});

// Хук целиком: проекты разных видов.
const withParams = (params) => makeProject({ '.claude/CLAUDE.md': paramsMd(params), '.claude/docs/progress.md': progressMd() });
const matt = (extra = {}) => withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да', ...extra });

function hook(dir, tool, toolInput, env = {}) {
  const r = runScript('guard-matt.js', { input: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd: dir }, env });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  return r.stdout;
}

const reasonOf = (stdout) => {
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  return out.hookSpecificOutput.permissionDecisionReason;
};

test('guard-matt: чужой и обычный kit-проект — пропуск, проект Мэтта — отказ с [kit]', () => {
  const dir = matt();
  // Абсолютный путь системы (с «\» на Windows) и относительный — отказ с подсказкой.
  const abs = reasonOf(hook(dir, 'Write', { file_path: path.join(dir, 'GLOSSARY.md'), content: 'x' }));
  assert.match(abs, /^\[kit\] Файлы системы Мэтта — в \.claude\/docs\/: глоссарий — GLOSSARY\.md/);
  assert.match(reasonOf(hook(dir, 'Edit', { file_path: 'docs/adr/0001-x.md' })), /^\[kit\] Файлы системы Мэтта/);
  assert.match(reasonOf(hook(dir, 'MultiEdit', { file_path: path.join(dir, '.scratch', 'a', 'issues', '01-x.md') })), /^\[kit\]/);
  assert.match(reasonOf(hook(dir, 'NotebookEdit', { notebook_path: path.join(dir, 'CONTEXT.md') })), /^\[kit\]/);
  // Путь со слешами вперёд и в другом регистре (Windows).
  assert.match(reasonOf(hook(dir, 'Write', { file_path: dir.replace(/\\/g, '/').toUpperCase() + '/glossary-map.md' })), /^\[kit\]/);
  // Файлы в документах, в подпапках и вне проекта (другая временная папка) — пропуск.
  assert.equal(hook(dir, 'Write', { file_path: path.join(dir, '.claude', 'docs', 'GLOSSARY.md') }), '');
  assert.equal(hook(dir, 'Write', { file_path: '.claude/docs/adr/0001-x.md' }), '');
  assert.equal(hook(dir, 'Write', { file_path: path.join(dir, 'local', 'docs', 'adr', 'x.md') }), '');
  assert.equal(hook(dir, 'Write', { file_path: path.join(makeProject({ 'a.txt': '' }), 'GLOSSARY.md') }), '');
  assert.equal(hook(dir, 'Write', { file_path: path.join(dir, 'index.php') }), '');
  assert.equal(hook(dir, 'Read', { file_path: path.join(dir, 'GLOSSARY.md') }), '');
  // Обычный kit-проект, «Система Мэтта: нет» и не kit-проект (ни параметров, ни журнала) — тишина.
  const w = { file_path: 'GLOSSARY.md' };
  assert.equal(hook(withParams({ 'Выкладка': 'вручную' }), 'Write', w), '');
  assert.equal(hook(withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'нет' }), 'Write', w), '');
  assert.equal(hook(makeProject({ '.claude/docs/progress.md': progressMd() }), 'Write', w), '');
  assert.equal(hook(makeProject({ 'a.txt': '' }), 'Write', w), '');
});

test('guard-matt: worktree в проекте Мэтта запрещён при любой выкладке (причина — по автозаливке), облачная копия — при PhpStorm Always', () => {
  const always = matt({ 'Выкладка': 'PhpStorm Always' });
  const r1 = reasonOf(hook(always, 'Agent', { isolation: 'worktree', prompt: 'x' }));
  assert.match(r1, /^\[kit\] При автозаливке PhpStorm отдельная копия \(worktree\) не годится/);
  assert.match(reasonOf(hook(always, 'Task', { isolation: 'worktree', prompt: 'x' })), /^\[kit\]/);
  assert.match(reasonOf(hook(always, 'mcp__ccd_session__start_session', { use_worktree: true, prompt: 'x' })), /worktree\) не годится/);
  assert.match(reasonOf(hook(always, 'EnterWorktree', {})), /^\[kit\] При автозаливке PhpStorm отдельная копия \(worktree\) не годится/);
  assert.match(reasonOf(hook(always, 'Agent', { isolation: 'remote', prompt: 'x' })), /^\[kit\] При автозаливке PhpStorm отдельная копия/);
  assert.equal(hook(always, 'Agent', { prompt: 'x' }), '');
  assert.equal(hook(always, 'mcp__ccd_session__start_session', { prompt: 'x' }), '');
  // Файлы системы Мэтта при автозаливке тоже запрещены.
  assert.match(reasonOf(hook(always, 'Write', { file_path: 'glossary.md' })), /Файлы системы Мэтта/);
  // Мэтт без автозаливки и «PhpStorm on-demand» — worktree тоже отказ (до 47.8б — пропуск), облачная копия — пропуск.
  const MATT_WT = /^\[kit\] В проекте Мэтта worktree не используем/;
  assert.match(reasonOf(hook(matt(), 'Agent', { isolation: 'worktree', prompt: 'x' })), MATT_WT);
  assert.match(reasonOf(hook(matt(), 'EnterWorktree', { name: 'x' })), MATT_WT);
  assert.match(reasonOf(hook(matt(), 'mcp__ccd_session__start_session', { use_worktree: true, prompt: 'x' })), MATT_WT);
  assert.match(reasonOf(hook(matt({ 'Выкладка': 'PhpStorm on-demand' }), 'Agent', { isolation: 'worktree', prompt: 'x' })), MATT_WT);
  assert.equal(hook(matt(), 'Agent', { isolation: 'remote', prompt: 'x' }), '');
  assert.equal(hook(matt(), 'mcp__ccd_session__start_session', { use_worktree: false, prompt: 'x' }), '');
  // Автозаливка без Мэтта, обычный kit-проект — как раньше: всё разрешено.
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'Agent', { isolation: 'worktree', prompt: 'x' }), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'нет' }), 'mcp__ccd_session__start_session', { use_worktree: true }), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'EnterWorktree', {}), '');
  assert.equal(hook(withParams({ 'Выкладка': 'вручную' }), 'EnterWorktree', {}), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'Agent', { isolation: 'remote', prompt: 'x' }), '');
  assert.equal(hook(makeProject({ 'a.txt': '' }), 'EnterWorktree', {}), '');
});

test('guard-matt: сессия в worktree приложения — корень и папка сессии проверяются обе', () => {
  const files = {
    '.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' }),
    '.claude/docs/progress.md': progressMd(),
    '.claude/worktrees/w1/.claude/CLAUDE.md': paramsMd({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' }),
    '.claude/worktrees/w1/.claude/docs/progress.md': progressMd(),
  };
  const dir = makeProject(files);
  const wt = path.join(dir, '.claude', 'worktrees', 'w1');
  assert.match(reasonOf(hook(wt, 'Write', { file_path: path.join(wt, 'GLOSSARY.md') })), /^\[kit\]/);
  assert.match(reasonOf(hook(wt, 'Write', { file_path: path.join(dir, 'GLOSSARY.md') })), /^\[kit\]/);
  assert.match(reasonOf(hook(wt, 'Write', { file_path: 'docs/adr/0001-x.md' })), /^\[kit\]/);
  assert.equal(hook(wt, 'Write', { file_path: path.join(wt, '.claude', 'docs', 'GLOSSARY.md') }), '');
  assert.equal(hook(wt, 'Write', { file_path: path.join(wt, 'src', 'index.php') }), '');
});

test('guard-matt: worktree-сессия приложения — CLAUDE_PROJECT_DIR основной папки, путь worktree только в cwd ввода: корень worktree проверяется', () => {
  const dir = matt();
  const wt = path.join(dir, '.claude', 'worktrees', 'w1');
  fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
  const run = (toolInput) => hook(wt, 'Write', toolInput, { CLAUDE_PROJECT_DIR: dir });
  assert.match(reasonOf(run({ file_path: path.join(wt, 'GLOSSARY.md') })), /^\[kit\] Файлы системы Мэтта/);
  assert.match(reasonOf(run({ file_path: path.join(wt, '.out-of-scope', 'x.md') })), /^\[kit\] Файлы системы Мэтта/);
  assert.match(reasonOf(run({ file_path: path.join(wt, 'to-questionnaire-x.md') })), /^\[kit\] Файлы системы Мэтта/);
  assert.match(reasonOf(run({ file_path: path.join(dir, 'GLOSSARY.md') })), /^\[kit\] Файлы системы Мэтта/);
  assert.match(reasonOf(run({ file_path: 'docs/adr/0001-x.md' })), /^\[kit\]/);
  // Документы worktree и основной папки, код — пропуск.
  assert.equal(run({ file_path: path.join(wt, '.claude', 'docs', 'GLOSSARY.md') }), '');
  assert.equal(run({ file_path: path.join(dir, '.claude', 'docs', 'GLOSSARY.md') }), '');
  assert.equal(run({ file_path: path.join(wt, 'src', 'index.php') }), '');
  // cwd — подпапка worktree: корень — сам worktree, а не подпапка (раунд 1).
  const sub = (toolInput) => hook(path.join(wt, 'src'), 'Write', toolInput, { CLAUDE_PROJECT_DIR: dir });
  assert.match(reasonOf(sub({ file_path: path.join(wt, 'GLOSSARY.md') })), /^\[kit\] Файлы системы Мэтта/);
  assert.equal(sub({ file_path: path.join(wt, 'src', 'GLOSSARY.md') }), '');
  // cwd ввода не строка — проверка по основной папке, без сбоя.
  const r = runScript('guard-matt.js', {
    input: { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'GLOSSARY.md') }, cwd: 42 }, env: { CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r.code, 0);
  assert.match(reasonOf(r.stdout), /^\[kit\] Файлы системы Мэтта/);
});

test('guard-matt: cwd — подпапка основной папки — корнем не становится; cwd вне проекта — становится (раунд 1)', () => {
  const dir = matt();
  const docs = path.join(dir, '.claude', 'docs');
  const inDocs = (toolInput) => hook(docs, 'Write', toolInput, { CLAUDE_PROJECT_DIR: dir });
  // Ложный отказ до раунда 1: cwd=.claude/docs становился корнем, и GLOSSARY.md в документах — «в корне».
  assert.equal(inDocs({ file_path: path.join(docs, 'GLOSSARY.md') }), '');
  assert.equal(inDocs({ file_path: path.join(docs, 'adr', '0001-x.md') }), '');
  assert.equal(hook(path.join(dir, 'local'), 'Write', { file_path: path.join(dir, 'local', 'MISSION.md') }, { CLAUDE_PROJECT_DIR: dir }), '');
  // Корень основной папки по-прежнему проверяется.
  assert.match(reasonOf(inDocs({ file_path: path.join(dir, 'GLOSSARY.md') })), /^\[kit\] Файлы системы Мэтта/);
  // cwd вне проекта — его корень тоже проверяется.
  const other = makeProject({ 'a.txt': '' });
  assert.match(reasonOf(hook(other, 'Write', { file_path: path.join(other, 'GLOSSARY.md') }, { CLAUDE_PROJECT_DIR: dir })), /^\[kit\] Файлы системы Мэтта/);
  assert.equal(hook(other, 'Write', { file_path: path.join(other, 'sub', 'GLOSSARY.md') }, { CLAUDE_PROJECT_DIR: dir }), '');
});

test('guard-matt: пустой, битый или неполный ввод — тишина и код 0', () => {
  for (const input of ['', 'не json', '{}', '{"tool_name":"Write"}', '{"tool_name":"Write","tool_input":null}', 'null']) {
    const r = runScript('guard-matt.js', { input });
    assert.equal(r.code, 0, input);
    assert.equal(r.stdout, '', input);
    assert.equal(r.stderr, '', input);
  }
  const dir = matt();
  assert.equal(hook(dir, 'Write', undefined), '');
  assert.equal(hook(dir, 'Write', null), '');
  assert.equal(hook(dir, 'Agent', 'isolation'), '');
});

test('hooks.json: guard-matt.js в PreToolUse на Write|Edit|MultiEdit|NotebookEdit|Agent|Task|EnterWorktree|mcp__ccd_session__start_session', () => {
  const pre = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const entry = pre.find((h) => h.matcher === 'Write|Edit|MultiEdit|NotebookEdit|Agent|Task|EnterWorktree|mcp__ccd_session__start_session');
  assert.ok(entry, 'нет записи с нужным matcher');
  assert.deepEqual(entry.hooks, [
    { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/scripts/guard-matt.js'], timeout: 10 },
  ]);
  // Запись guard-bash.js на месте и идёт раньше.
  const bash = pre.findIndex((h) => h.matcher === 'Bash|PowerShell');
  assert.ok(bash !== -1 && bash < pre.indexOf(entry), 'Bash|PowerShell — раньше записи guard-matt.js');
  assert.deepEqual(pre[bash].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/scripts/guard-bash.js']);
  // Файл хука существует.
  assert.ok(fs.existsSync(path.join(PLUGIN, 'scripts', 'guard-matt.js')));
});
