'use strict';
// Правила путей из параметров («Не коммитить», «Не выкладывать»): `шаблон` или `шаблон (кроме a, b)`.
// Токен без слеша — имя любого сегмента пути (`.idea`, `*.back*`); токен со слешем в любом месте —
// в начале, в середине или в конце (`/bitrix`, `local/modules`, `bitrix/`) — путь от корня проекта
// (и всё внутри): `bitrix/` не ловит `local/templates/…/components/bitrix/…`.
// * — внутри сегмента, ** — через сегменты («**/» — ноль или больше папок, как в .gitignore).
// Регистр не важен (Windows), `\` равен `/`.
const { splitList } = require('./params');

function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // «**/» — ноль или больше папок, как в .gitignore: `**/x` ловит и `x` в корне, `a/**/x` — и `a/x`.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i++;
        }
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

function compile(token) {
  // Слеш ищем в исходном токене — до снятия ведущего и завершающего `/`.
  const hasSlash = String(token).replace(/\\/g, '/').includes('/');
  const t = norm(token).replace(/\/+$/, '');
  if (/[*?]/.test(t)) {
    const re = globToRe(t);
    if (!hasSlash) return (p) => p.split('/').some((seg) => re.test(seg));
    return (p) => {
      const segs = p.split('/');
      for (let i = 1; i <= segs.length; i++) if (re.test(segs.slice(0, i).join('/'))) return true;
      return false;
    };
  }
  const low = t.toLowerCase();
  return (p) => {
    const lp = p.toLowerCase();
    if (lp === low || lp.startsWith(low + '/')) return true;
    return !hasSlash && lp.split('/').includes(low);
  };
}

function parseRule(item) {
  const m = /^(.*?)\s*\(\s*кроме\s+(.*)\)\s*$/i.exec(item);
  const pattern = (m ? m[1] : item).trim();
  const except = m ? splitList(m[2]) : [];
  return { pattern: item.trim(), match: compile(pattern), except: except.map(compile) };
}

function parseRules(items) {
  return items.filter(Boolean).map(parseRule);
}

// Первое правило, под которое попадает путь, или null.
function matchRules(p, rules) {
  const np = norm(p);
  for (const r of rules) {
    if (r.match(np) && !r.except.some((e) => e(np))) return r;
  }
  return null;
}

module.exports = { parseRules, matchRules, norm };
