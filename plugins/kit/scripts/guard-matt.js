#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Write|Edit|MultiEdit|NotebookEdit|Agent|Task|EnterWorktree|mcp__ccd_session__start_session) — только
// в kit-проекте с параметром «Система Мэтта: да»:
// - файлы системы Мэтта (глоссарий, ADR, .scratch/, опросники, папки teach и triage и т. п.) в корень проекта (на сайте
//   это корень сайта) → запрет: их место — папка документов (<docs>/GLOSSARY.md, <docs>/adr/, <docs>/work/…);
// - сессия, субагент и подчинённая сессия в отдельном worktree → запрет при любой выкладке (исполнители работают
//   в основной папке; при автозаливке PhpStorm Always правки из копии ещё и не дойдут до сервера); облачная копия
//   (isolation: remote) → запрет только при Always.
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');
const { isMattProject, projectRoot } = require('./lib/matt');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Файлы корня проекта и начала путей, которые система Мэтта кладёт «по умолчанию» (сравнение без регистра, косые вперёд):
// глоссарий и карта контекстов, ADR, трекер и .scratch/; to-questionnaire — to-questionnaire-<slug>.md в текущей папке;
// teach — MISSION.md, RESOURCES.md, lessons/, learning-records/; triage — .out-of-scope/. Общие имена teach (NOTES.md,
// reference/, assets/) не берём: так называются и папки сайта.
const ROOT_FILES = new Set(['glossary.md', 'glossary-map.md', 'context.md', 'context-map.md', 'mission.md', 'resources.md']);
const ROOT_MASKS = [/^to-questionnaire-[^/]*\.md$/];
const ROOT_DIRS = ['docs/adr/', 'docs/agents/', '.scratch/', 'lessons/', 'learning-records/', '.out-of-scope/'];

const reasonFiles = (docsRel) => 'Файлы системы Мэтта — в ' + docsRel + '/: глоссарий — GLOSSARY.md, ADR — adr/, карта и спек — work/<тема>/, '
  + 'тикеты карты — work/<тема>/issues/, тикеты реализации — work/<тема>-build/issues/, прочие документы навыков — work/. '
  + 'В корень проекта (на сайте это корень сайта) их не кладём.';
const REASON_WORKTREE = 'При автозаливке PhpStorm отдельная копия (worktree) не годится: правки из неё не дойдут до сервера и разойдутся '
  + 'с основной папкой. Запускай без worktree.';
const REASON_WORKTREE_MATT = 'В проекте Мэтта worktree не используем: исполнители работают в основной папке, шаг коммитит общая сессия '
  + 'через /kit:step-done.';

// Путь относительно корня проекта: косые вперёд, без регистра; вне проекта (.. или другой диск) — null.
// Корень с буквой диска считается по правилам Windows при любой ОС (тесты, чистая функция).
function relInRoot(root, p) {
  const P = /^[A-Za-z]:/.test(root) ? path.win32 : path;
  const rel = P.relative(root, P.resolve(root, p));
  if (P.isAbsolute(rel)) return null;
  const r = rel.replace(/\\/g, '/').toLowerCase();
  return r === '..' || r.startsWith('../') ? null : r;
}

// Путь — файл системы Мэтта в корне проекта (не в папке документов).
function isMattRootFile(root, p, docsRel) {
  const rel = relInRoot(root, p);
  if (rel === null) return false;
  // Сама папка документов — верное место: при «Журнал: docs/progress.md» там же docs/adr/ и docs/agents/.
  const docs = String(docsRel || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (docs === '.' || rel.startsWith(docs + '/')) return false;
  return ROOT_FILES.has(rel) || ROOT_MASKS.some((m) => m.test(rel)) || ROOT_DIRS.some((d) => rel.startsWith(d));
}

// Корни из cwd ввода. В worktree-сессии приложения CLAUDE_PROJECT_DIR — основная папка, путь worktree — только в cwd:
// cwd внутри <проект>/.claude/worktrees/<имя> → сам worktree (не подпапка) и его основная папка; cwd вне основной папки
// main → он сам; cwd — подпапка основной папки (например, .claude/docs) корнем не становится: документы — не корень.
function cwdRoots(cwd, main) {
  if (typeof cwd !== 'string' || !cwd) return [];
  const wt = /^(.*?[\\/]\.claude[\\/]worktrees[\\/][^\\/]+)/i.exec(cwd);
  if (wt) return [wt[1], projectRoot(cwd)];
  return main && relInRoot(main, cwd) !== null ? [] : [cwd];
}

// input — ввод хука ({ tool_name, tool_input }), ctx — { root, docsRel, always } → причина отказа или null.
function checkTool(input, ctx) {
  const tool = input && input.tool_name;
  const ti = (input && input.tool_input) || {};
  if (WRITE_TOOLS.has(tool)) {
    const p = ti.file_path || ti.notebook_path;
    if (typeof p === 'string' && p && ctx.root && isMattRootFile(ctx.root, p, ctx.docsRel)) return reasonFiles(ctx.docsRel);
    return null;
  }
  const agent = tool === 'Agent' || tool === 'Task';
  if (tool === 'EnterWorktree' || (agent && ti.isolation === 'worktree')
    || (tool === 'mcp__ccd_session__start_session' && ti.use_worktree === true)) {
    return ctx.always ? REASON_WORKTREE : REASON_WORKTREE_MATT;
  }
  // Облачная копия ветки основной папки не трогает — мешает только автозаливке (правки не дойдут до сервера).
  if (agent && ti.isolation === 'remote' && ctx.always) return REASON_WORKTREE;
  return null;
}

function main() {
  try {
    const input = readStdinJson();
    const dir = resolveProjectDir(input);
    const info = kitInfo(dir);
    if (!info.isKit || !isMattProject(info.params)) return;
    const always = /^phpstorm always/i.test(String(info.params.get('Выкладка', '')).trim());
    // Основная папка проекта и, если сессия в worktree приложения, папка самой сессии: файл в корне любой из них — мимо документов.
    let reason = null;
    for (const root of new Set([projectRoot(dir), dir, ...cwdRoots(input && input.cwd, projectRoot(dir))])) {
      reason = checkTool(input, { root, docsRel: info.docsRel, always });
      if (reason) break;
    }
    if (!reason) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[kit] ' + reason,
      },
    }));
  } catch (e) {
    // хук не должен ломать сессию
  }
}

if (require.main === module) main();
module.exports = { checkTool };
