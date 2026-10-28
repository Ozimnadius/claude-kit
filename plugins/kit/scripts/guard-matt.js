#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Write|Edit|MultiEdit|NotebookEdit|Agent|Task|mcp__ccd_session__start_session) — только в kit-проекте
// с параметром «Система Мэтта: да»:
// - файлы системы Мэтта (глоссарий, ADR, .scratch/ и т. п.) в корень проекта (на сайте это корень сайта) → запрет:
//   их место — папка документов (<docs>/GLOSSARY.md, <docs>/adr/, <docs>/work/…);
// - при автозаливке PhpStorm Always субагент и подчинённая сессия в отдельном worktree → запрет (правки из копии
//   не дойдут до сервера).
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');
const { isMattProject, projectRoot } = require('./lib/matt');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Файлы корня проекта и начала путей, которые система Мэтта кладёт «по умолчанию» (сравнение без регистра, косые вперёд).
const ROOT_FILES = new Set(['glossary.md', 'glossary-map.md', 'context.md', 'context-map.md']);
const ROOT_DIRS = ['docs/adr/', 'docs/agents/', '.scratch/'];

const reasonFiles = (docsRel) => 'Файлы системы Мэтта — в ' + docsRel + '/: глоссарий — GLOSSARY.md, ADR — adr/, карта, спек и тикеты — '
  + 'work/<тема>/ и work/<тема>-build/. В корень проекта (на сайте это корень сайта) их не кладём.';
const REASON_WORKTREE = 'При автозаливке PhpStorm отдельная копия (worktree) не годится: правки из неё не дойдут до сервера и разойдутся '
  + 'с основной папкой. Запускай без worktree.';

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
  return ROOT_FILES.has(rel) || ROOT_DIRS.some((d) => rel.startsWith(d));
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
  if (!ctx.always) return null;
  if ((tool === 'Agent' || tool === 'Task') && ti.isolation === 'worktree') return REASON_WORKTREE;
  if (tool === 'mcp__ccd_session__start_session' && ti.use_worktree === true) return REASON_WORKTREE;
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
    for (const root of new Set([projectRoot(dir), dir])) {
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
