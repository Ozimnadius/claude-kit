'use strict';
// Общее для хуков и инструментов: вход хука, папка проекта, признаки kit-проекта, папка документов.
const fs = require('fs');
const path = require('path');
const { readParams } = require('./params');

// Журнал по умолчанию (с 3.0.0 — один формат): старую раскладку docs/ находит oldFormat (lib/journal.js), переводит /kit:project-init.
const JOURNAL_DEFAULTS = ['.claude/docs/progress.md'];

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function resolveProjectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}

const slash = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// Параметр «Журнал»; не задан — .claude/docs/progress.md.
function journalOf(params) {
  const fromParam = params.get('Журнал', '');
  return fromParam ? slash(fromParam) : JOURNAL_DEFAULTS[0];
}

// Kit-проект — есть раздел «Параметры для агентов» или файл журнала.
// Папка документов — папка журнала: там план выкладки по умолчанию, work/, archive/ и снимки visual/.
function kitInfo(dir) {
  const params = readParams(dir);
  const journalRel = journalOf(params);
  const journalPath = path.resolve(dir, journalRel);
  const hasJournal = fs.existsSync(journalPath);
  const docsRel = path.posix.dirname(journalRel);
  const inDocs = (name) => docsRel + '/' + name;
  return {
    dir,
    params,
    journalRel,
    journalPath,
    hasJournal,
    docsRel,
    planRel: slash(params.get('План выкладки', '') || inDocs('deploy-prod.md')),
    visualRel: inDocs('visual'),
    isKit: params.found || hasJournal,
  };
}

// Сервер проекта (с 2.17.0 проект ведёт один сервер — прод или дев): «Окружение: дев» — дев; «прод» и нет параметра — прод.
// По нему скрипты с --env выбирают сервер по умолчанию.
function serverEnv(params) {
  return /^дев$/i.test(String(params.get('Окружение', '')).trim()) ? 'дев' : 'прод';
}

// «Документы на сервере: да» (с 2.6.0): из .claude на сервер уезжают только эти имена — автозаливкой PhpStorm
// (phpstorm-exclude.js) и заливкой по SSH (ssh-deploy.js --docs, с 2.18.0). Снимки visual внутри docs — нет.
const DOCS_KEEP = ['docs', 'CLAUDE.md', '.htaccess'];

function docsOnServer(params) {
  return /^да$/i.test(String(params.get('Документы на сервере', '')).trim());
}

// Путь от корня проекта входит в документы на сервере: .claude/.htaccess, .claude/CLAUDE.md, .claude/docs/… без снимков
// visual. Регистр не важен (Windows).
function isDocOnServer(rel, info) {
  const p = slash(rel).toLowerCase();
  const visual = slash(info.visualRel).toLowerCase() + '/';
  return DOCS_KEEP.some((n) => {
    const k = '.claude/' + n.toLowerCase();
    return p === k || p.startsWith(k + '/');
  }) && !p.startsWith(visual);
}

module.exports = { JOURNAL_DEFAULTS, readStdinJson, resolveProjectDir, kitInfo, serverEnv, DOCS_KEEP, docsOnServer, isDocOnServer };
