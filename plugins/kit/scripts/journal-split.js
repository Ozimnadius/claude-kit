#!/usr/bin/env node
'use strict';
// Журнал по частям (с 2.13.0): progress.md — «Сейчас», «Этапы» (оглавление), «Документы», «Прод: не забыть», текущий этап;
// journal/decisions.md — «Решения», journal/bugs.md — «Баги на потом», journal/reference.md — «Справочник» и «Материалы заказчика»,
// journal/stages/stage-NN.md — закрытые этапы.
//   --migrate   журнал в старой раскладке → части; уже по частям — код 0 и сообщение.
//   --stage N   закрытый этап N из progress.md → journal/stages/stage-NN.md, строка оглавления — ссылкой на файл.
// Текст переносится строка в строку: до записи каждая непустая строка исходника должна найтись в результате
// (столько же раз) — иначе ничего не пишется, код 2. Запись — во временные файлы, progress.md заменяется последним.
// Коды: 0 — готово или делать нечего, 2 — ошибка (сообщение в stderr).
const fs = require('fs');
const path = require('path');
const { resolveProjectDir, kitInfo } = require('./lib/project');

const PARTS = {
  decisions: { file: 'decisions.md', title: 'решения', sections: ['Решения'] },
  bugs: { file: 'bugs.md', title: 'баги', sections: ['Баги на потом'] },
  reference: { file: 'reference.md', title: 'справочник и материалы заказчика', sections: ['Справочник', 'Материалы заказчика'] },
};
const STAGE_RE = /^##\s+Этап\s+(\d+)\b\s*(?:—\s*(.*))?$/;
const INDEX_TITLE = 'Этапы';

class SplitError extends Error {}

const normalize = (text) => String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// → { head: [строки до первого ##], sections: [{ title, lines (с заголовком) }] }
function parse(text) {
  const lines = normalize(text).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const head = [];
  const sections = [];
  for (const line of lines) {
    const m = /^##\s+(.*?)\s*$/.exec(line);
    if (m) sections.push({ title: m[1], lines: [line] });
    else if (sections.length) sections[sections.length - 1].lines.push(line);
    else head.push(line);
  }
  return { head, sections };
}

const stageOf = (section) => {
  const m = STAGE_RE.exec(section.lines[0]);
  return m ? { n: Number(m[1]), name: (m[2] || '').trim() } : null;
};

// Текущий этап по «Сейчас» → { n, closed } или null (раздела или номера нет).
function currentStage(sections) {
  const now = sections.find((s) => s.title.startsWith('Сейчас'));
  if (!now) return null;
  const line = now.lines.find((l) => /\*\*Этап:\*\*/.test(l));
  if (!line) return null;
  const text = line.replace(/^.*?\*\*Этап:\*\*\s*/, '');
  const m = /^(?:этап\s*)?(\d+)/i.exec(text);
  if (!m) return null;
  const first = text.split(';')[0];
  return { n: Number(m[1]), closed: /закрыт/i.test(first) };
}

const partOf = (title) => Object.keys(PARTS).find((k) => PARTS[k].sections.some((s) => title.startsWith(s))) || null;
const pad = (n) => String(n).padStart(2, '0');
const stageFile = (n) => `journal/stages/stage-${pad(n)}.md`;
// Неэкранированная черта в ячейке таблицы — «\|»; уже экранированная (из заголовка) остаётся как есть.
const cell = (s) => String(s).replace(/(?<!\\)\|/g, '\\|');
const journalTitle = (head) => {
  const h = head.find((l) => /^#\s/.test(l));
  return h ? h.replace(/^#\s+/, '').replace(/^Журнал работ\s*—\s*/, '') : 'журнал';
};

function indexSection(rows) {
  return [
    `## ${INDEX_TITLE}`,
    '',
    'Части журнала: решения — `journal/decisions.md`, баги — `journal/bugs.md`, справочник и материалы заказчика — `journal/reference.md`, закрытые этапы — `journal/stages/`.',
    '',
    '| Этап | Название | Файл |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.n} | ${cell(r.name)} | ${r.file ? '`' + r.file + '`' : 'ниже'} |`),
    '',
  ];
}

const withBlankEnd = (lines) => (lines.length && lines[lines.length - 1] !== '' ? [...lines, ''] : lines);
const join = (lines) => withBlankEnd(lines).join('\n').replace(/\n+$/, '\n');

// Каждая непустая строка исходника — в результате не реже, чем в исходнике; except — строки, которые скрипт меняет сам.
function assertNothingLost(source, outputs, except = []) {
  const skip = new Map();
  for (const l of except) skip.set(l, (skip.get(l) || 0) + 1);
  const count = new Map();
  for (const text of outputs) {
    for (const l of normalize(text).split('\n')) if (l.trim()) count.set(l, (count.get(l) || 0) + 1);
  }
  for (const l of normalize(source).split('\n')) {
    if (!l.trim()) continue;
    if (skip.get(l)) {
      skip.set(l, skip.get(l) - 1);
      continue;
    }
    const c = count.get(l) || 0;
    if (!c) throw new SplitError(`строка потерялась бы при переносе: «${l.slice(0, 80)}»`);
    count.set(l, c - 1);
  }
}

// Временный файл рядом → rename; файлы — по порядку, последним — progress.md.
function writeAll(files) {
  const tmps = [];
  try {
    for (const [file, text] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.kit-tmp`;
      fs.writeFileSync(tmp, text);
      tmps.push([tmp, file]);
    }
    for (const [tmp, file] of tmps) fs.renameSync(tmp, file);
  } finally {
    for (const [tmp] of tmps) fs.rmSync(tmp, { force: true });
  }
}

function migrate(journalPath) {
  const dir = path.dirname(journalPath);
  if (fs.existsSync(path.join(dir, 'journal', PARTS.decisions.file))) return { changed: false, message: 'Журнал уже по частям (journal/decisions.md есть) — переносить нечего.' };
  const source = fs.readFileSync(journalPath, 'utf8');
  const { head, sections } = parse(source);
  if (sections.some((s) => s.title.startsWith(INDEX_TITLE) && !stageOf(s))) throw new SplitError('в журнале уже есть раздел «Этапы» — перевод прерван, проверьте журнал руками');
  const stages = sections.map(stageOf).filter(Boolean);
  const cur = currentStage(sections);
  const keepN = cur ? (cur.closed ? null : cur.n) : (stages.length ? Math.max(...stages.map((s) => s.n)) : null);
  const title = journalTitle(head);
  const parts = { decisions: [], bugs: [], reference: [] };
  const stageFiles = [];
  const kept = [];
  const rows = [];
  for (const s of sections) {
    const st = stageOf(s);
    const part = partOf(s.title);
    if (st) {
      if (st.n === keepN) {
        kept.push(s);
        rows.push({ n: st.n, name: st.name, file: null });
      } else {
        stageFiles.push([stageFile(st.n), [`# ${title} — этап ${st.n}`, '', ...withBlankEnd(s.lines)]]);
        rows.push({ n: st.n, name: st.name, file: stageFile(st.n) });
      }
    } else if (part) {
      parts[part].push(...withBlankEnd(s.lines));
    } else {
      kept.push(s);
    }
  }
  if (new Set(stageFiles.map(([f]) => f)).size !== stageFiles.length) throw new SplitError('два раздела с одним номером этапа — перевод прерван, проверьте журнал руками');
  rows.sort((a, b) => a.n - b.n);
  const progress = [...withBlankEnd(head)];
  let indexed = false;
  for (const s of kept) {
    progress.push(...withBlankEnd(s.lines));
    if (!indexed && s.title.startsWith('Сейчас')) {
      progress.push(...indexSection(rows));
      indexed = true;
    }
  }
  if (!indexed) progress.splice(withBlankEnd(head).length, 0, ...indexSection(rows));
  const files = [];
  for (const [k, p] of Object.entries(PARTS)) {
    files.push([path.join(dir, 'journal', p.file), join([`# ${title} — ${p.title}`, '', ...parts[k]])]);
  }
  for (const [rel, lines] of stageFiles) files.push([path.join(dir, rel), join(lines)]);
  files.push([journalPath, join(progress)]);
  assertNothingLost(source, files.map(([, t]) => t));
  writeAll(files);
  return { changed: true, message: `Журнал разделён: части — journal/decisions.md, bugs.md, reference.md; закрытых этапов перенесено — ${stageFiles.length}${keepN !== null ? `, текущий этап ${keepN} остался в ${path.basename(journalPath)}` : ''}.` };
}

function closeStage(journalPath, n) {
  const dir = path.dirname(journalPath);
  if (!fs.existsSync(path.join(dir, 'journal'))) throw new SplitError('журнал не по частям (нет папки journal/) — сначала --migrate');
  const target = path.join(dir, stageFile(n));
  const source = fs.readFileSync(journalPath, 'utf8');
  const { head, sections } = parse(source);
  const idx = sections.findIndex((s) => (stageOf(s) || {}).n === n);
  if (idx < 0) return { changed: false, message: `Раздела «Этап ${n}» в ${path.basename(journalPath)} нет — переносить нечего.` };
  if (fs.existsSync(target)) throw new SplitError(`${stageFile(n)} уже есть — перенос прерван, файл не перезаписываю`);
  const stage = sections[idx];
  const st = stageOf(stage);
  const rest = sections.filter((_, i) => i !== idx);
  const index = rest.find((s) => s.title.startsWith(INDEX_TITLE) && !stageOf(s));
  const link = `\`${stageFile(n)}\``;
  const replaced = [];
  if (index) {
    const at = index.lines.findIndex((l) => new RegExp(`^\\|\\s*${n}\\s*\\|`).test(l));
    const row = `| ${n} | ${cell(st.name)} | ${link} |`;
    if (at >= 0) {
      replaced.push(index.lines[at]);
      index.lines[at] = index.lines[at].replace(/\|[^|]*\|\s*$/, `| ${link} |`);
    }
    else {
      let last = index.lines.length - 1;
      while (last > 0 && !index.lines[last].trim().startsWith('|')) last--;
      index.lines.splice(last + 1, 0, row);
    }
  }
  const progress = [...withBlankEnd(head)];
  for (const s of rest) progress.push(...withBlankEnd(s.lines));
  const files = [
    [target, join([`# ${journalTitle(head)} — этап ${n}`, '', ...stage.lines])],
    [journalPath, join(progress)],
  ];
  assertNothingLost(source, files.map(([, t]) => t), replaced);
  writeAll(files);
  return { changed: true, message: `Этап ${n} перенесён в ${stageFile(n)}${index ? ', оглавление «Этапы» обновлено' : ' (раздела «Этапы» нет — оглавление не обновлено)'}.` };
}

function main(argv) {
  try {
    const info = kitInfo(resolveProjectDir({}));
    if (!info.hasJournal) throw new SplitError(`журнала ${info.journalRel} нет`);
    let r;
    if (argv.includes('--migrate')) r = migrate(info.journalPath);
    else {
      const si = argv.indexOf('--stage');
      const n = si >= 0 ? Number(argv[si + 1]) : NaN;
      if (!Number.isInteger(n) || n < 0) {
        console.error('Использование: node journal-split.js --migrate | --stage N');
        return 2;
      }
      r = closeStage(info.journalPath, n);
    }
    console.log(r.message);
    return 0;
  } catch (e) {
    console.error(`journal-split: ${e instanceof SplitError ? e.message : e.stack || e.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parse, currentStage, migrate, closeStage, assertNothingLost, SplitError };
