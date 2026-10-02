'use strict';
// Аргументы visual.js: команда, позиционные, флаги; пути, переписанные Git Bash; имена и метки.
const { undoMsys } = require('../msys');

// Ошибка с кодом выхода: 2 — аргументы или pages.json, 3 — сессия, 4 — защита выкладки, 5 — зависимости или Chrome.
class VisualError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Имя страницы, контекста и метка: латиница, цифры, . _ -, первый символ — буква или цифра.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALUE_FLAGS = ['only', 'ctx', 'vp', 'env', 'url'];
const BOOL_FLAGS = ['no-setup'];

function parseArgs(argv) {
  const out = { cmd: argv[0] || '', positional: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new VisualError(2, `флагу ${a} нужно значение`);
      out.flags[name] = v;
      i++;
    } else if (name && BOOL_FLAGS.includes(name)) out.flags[name] = true;
    else if (name !== null) throw new VisualError(2, `неизвестный флаг ${a}`);
    else out.positional.push(a);
  }
  return out;
}

// Git Bash (MSYS) переписывает «/catalog/» в «C:/Program Files/Git/catalog/» (MSYS2 — в «C:/msys64/catalog/») — возвращаем как было.
function fixMsysPath(a) {
  return undoMsys(a).replace(/\\/g, '/');
}

// Адрес-затравка discover: путь от корня сайта (полный адрес — берётся путь и query).
function seedPath(a) {
  let s = fixMsysPath(a);
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    s = u.pathname + u.search;
  }
  return s.startsWith('/') ? s : '/' + s;
}

function parseOnly(v) {
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Метка прогона; reserved — метки, которые делают только сами команды (compare-…, …-check).
function checkLabel(label, { reserved = false } = {}) {
  if (!label) throw new VisualError(2, 'нужна метка, например before или after-1.1');
  if (!NAME_RE.test(label)) throw new VisualError(2, `метка «${label}»: латиница, цифры, . _ -, первый символ — буква или цифра`);
  if (reserved && (label.startsWith('compare-') || label.endsWith('-check'))) {
    throw new VisualError(2, `метка «${label}»: compare-… и …-check делают сами команды compare и check`);
  }
  return label;
}

module.exports = { VisualError, NAME_RE, parseArgs, fixMsysPath, seedPath, parseOnly, checkLabel };
