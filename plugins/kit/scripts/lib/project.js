'use strict';
// Общее для хуков и инструментов: вход хука, папка проекта, признаки kit-проекта, папка документов.
const fs = require('fs');
const path = require('path');
const { readParams } = require('./params');

// Журнал по умолчанию: новая раскладка (с 2.3.0), затем старая — проекты, которые ещё не переехали.
const JOURNAL_DEFAULTS = ['.claude/docs/progress.md', 'docs/progress.md'];

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

// Параметр «Журнал»; не задан — первый существующий из JOURNAL_DEFAULTS, иначе новая раскладка.
function journalOf(dir, params) {
  const fromParam = params.get('Журнал', '');
  if (fromParam) return slash(fromParam);
  return JOURNAL_DEFAULTS.find((rel) => fs.existsSync(path.resolve(dir, rel))) || JOURNAL_DEFAULTS[0];
}

// Kit-проект — есть раздел «Параметры для агентов» или файл журнала.
// Папка документов — папка журнала: там план выкладки по умолчанию, work/, archive/ и снимки visual/.
function kitInfo(dir) {
  const params = readParams(dir);
  const journalRel = journalOf(dir, params);
  const journalPath = path.resolve(dir, journalRel);
  const hasJournal = fs.existsSync(journalPath);
  const docsRel = path.posix.dirname(journalRel);
  const inDocs = (name) => (docsRel === '.' ? name : docsRel + '/' + name);
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

// Папка документов лежит внутри .claude (новая раскладка) — её закрывает исключение .claude.
function docsInClaude(docsRel) {
  return /^\.claude(\/|$)/i.test(docsRel);
}

module.exports = { JOURNAL_DEFAULTS, readStdinJson, resolveProjectDir, kitInfo, docsInClaude };
