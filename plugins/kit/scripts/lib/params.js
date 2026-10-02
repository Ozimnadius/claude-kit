'use strict';
// Разбор раздела «Параметры для агентов» из .claude/CLAUDE.md проекта.
// Строка параметра: `- Ключ: значение`; списки через запятую (запятая внутри `…` или (…) не делит).
const fs = require('fs');
const path = require('path');

const SECTION_RE = /^##\s+Параметры для агентов\s*$/;
const EMPTY = new Set(['', '—', '–', '-']);

function stripTicks(s) {
  const t = String(s).trim();
  if (t.length >= 2 && t[0] === '`' && t[t.length - 1] === '`' && !t.slice(1, -1).includes('`')) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function splitList(value) {
  const items = [];
  let cur = '';
  let depth = 0;
  let tick = false;
  for (const ch of String(value)) {
    if (ch === '`') tick = !tick;
    else if (!tick && ch === '(') depth++;
    else if (!tick && ch === ')' && depth > 0) depth--;
    else if (!tick && depth === 0 && ch === ',') {
      items.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  items.push(cur);
  return items.map(stripTicks).filter((s) => !EMPTY.has(s));
}

function parseParams(md) {
  const lines = String(md).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => SECTION_RE.test(l.trim()));
  if (start < 0) return null;
  const values = {};
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    const m = /^\s*[-*]\s+([^:`]+?):\s*(.*?)\s*$/.exec(lines[i]);
    if (m) values[m[1].trim().toLowerCase()] = m[2];
  }
  return values;
}

function makeParams(values, file) {
  const vals = values || {};
  const raw = (key) => {
    const v = vals[String(key).toLowerCase()];
    return v === undefined ? undefined : stripTicks(v);
  };
  return {
    found: values !== null && values !== undefined,
    file,
    values: vals,
    get(key, def) {
      const v = raw(key);
      return v === undefined || EMPTY.has(v) ? def : v;
    },
    list(key) {
      const v = vals[String(key).toLowerCase()];
      return v === undefined ? [] : splitList(v);
    },
  };
}

function readParams(projectDir) {
  const file = path.join(projectDir, '.claude', 'CLAUDE.md');
  let values = null;
  try {
    values = parseParams(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    values = null;
  }
  return makeParams(values, file);
}

module.exports = { parseParams, splitList, stripTicks, readParams, makeParams };
