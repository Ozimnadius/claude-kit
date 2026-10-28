'use strict';
// Журнал проекта в формате kit 3.0 — один формат: документы в .claude/docs, журнал по частям (journal/), таблица
// текущего этапа со столбцом «Как проверено», таблица решений «| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |»,
// «Окружение» — прод или дев. Старый формат переводит /kit:project-init; до переезда kit шаги в проекте не закрывает.
// Правка журнала по блокам шага (kit-journal.js вместо агента-модели, с 3.0.0): все правки — в памяти, запись —
// только если легли все блоки; перевод строки и BOM каждого файла сохраняются, нетронутые строки не меняются.
const fs = require('fs');
const path = require('path');
const { normalize, getSection } = require('./md');
const { serverEnv } = require('./project');
const { writeFilesAtomic, PartialWriteError } = require('./atomic');

class JournalError extends Error {}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

// ---------- Разделы и таблицы ----------

const HEADING = /^#{1,2}\s/;
const STAGE_RE = /^Этап\s+(\d+)/;
const isRow = (l) => l.trim().startsWith('|');
const isSep = (l) => /^\s*\|?\s*:?-{3,}/.test(l);
const stageTest = (n) => (title) => new RegExp('^Этап\\s+' + n + '(?!\\d)').test(title);
const anyStage = (title) => STAGE_RE.test(title);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Ячейки строки таблицы как в файле: «\|» остаётся частью текста.
function cellsOf(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}
const esc = (s) => String(s).replace(/(?<!\\)\|/g, '\\|');
const rowOf = (cells) => '|' + cells.map((c) => (c ? ' ' + c + ' ' : ' ')).join('|') + '|';

// Раздел «## …», заголовок которого проходит test: { start, end, title } — строка заголовка и следующий заголовок # или ##.
function findSection(lines, test) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.*?)\s*$/.exec(lines[i]);
    if (!m || !test(m[1])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (HEADING.test(lines[j])) {
        end = j;
        break;
      }
    }
    return { start: i, end, title: m[1] };
  }
  return null;
}

// Номер последнего раздела «## Этап N» («## Этапы» — оглавление, не этап); null — разделов этапов нет.
function lastStageNum(lines) {
  let n = null;
  for (const l of lines) {
    const m = /^##\s+Этап\s+(\d+)/.exec(l);
    if (m) n = Number(m[1]);
  }
  return n;
}

// Таблицы в строках [from, to): { head, first, end, cols } — шапка, первая строка данных, строка за таблицей, заголовки.
function tablesIn(lines, from = 0, to = lines.length) {
  const out = [];
  for (let i = from; i + 1 < to; i++) {
    if (!isRow(lines[i]) || !isSep(lines[i + 1])) continue;
    let end = i + 2;
    while (end < to && isRow(lines[end])) end++;
    out.push({ head: i, first: i + 2, end, cols: cellsOf(lines[i]) });
    i = end - 1;
  }
  return out;
}

function columns(t, names, what) {
  const col = {};
  for (const n of names) {
    col[n] = t.cols.indexOf(n);
    if (col[n] < 0) throw new JournalError(`${what} не разбирается: нет столбца «${n}»`);
  }
  return col;
}

function rowAt(lines, t, col, value) {
  for (let i = t.first; i < t.end; i++) if (cellsOf(lines[i])[col] === value) return i;
  return -1;
}

function newRow(t, values) {
  const cells = t.cols.map(() => '');
  for (const [c, v] of Object.entries(values)) if (v !== undefined) cells[c] = v;
  return rowOf(cells);
}

// Строка переписывается, только если значение ячейки действительно меняется: выровненные руками строки не портятся.
function setCells(lines, i, t, values) {
  const cells = cellsOf(lines[i]);
  while (cells.length < t.cols.length) cells.push('');
  let changed = false;
  for (const [c, v] of Object.entries(values)) {
    if (v !== undefined && cells[c] !== v) {
      cells[c] = v;
      changed = true;
    }
  }
  if (changed) lines[i] = rowOf(cells);
}

// Позиция после последней непустой строки раздела.
function sectionTail(lines, s) {
  let at = s.end;
  while (at > s.start + 1 && !lines[at - 1].trim()) at--;
  return at;
}

function insertAtTail(lines, s, add) {
  const at = sectionTail(lines, s);
  lines.splice(at, 0, ...(at === s.start + 1 ? ['', ...add] : add));
}

// Новый раздел перед разделом before (заголовок проходит before) или в конце файла.
function addSection(lines, title, body, before) {
  const block = ['## ' + title, '', ...body, ''];
  const at = before ? findSection(lines, before) : null;
  if (at) {
    lines.splice(at.start, 0, ...block);
    return;
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push('', ...block);
}

// Пункты «- …» в конец раздела: заглушку «(пока пусто)» заменяет первый пункт, уже записанные дословно не повторяются.
function addItems(lines, find, items) {
  for (const item of items) {
    const s = find();
    const line = '- ' + item;
    let stub = -1;
    let has = false;
    for (let i = s.start + 1; i < s.end; i++) {
      const l = lines[i].trim();
      if (l === line) has = true;
      if (/^-\s*\(пока пусто\)$/.test(l)) stub = i;
    }
    if (has) continue;
    if (stub >= 0) lines[stub] = line;
    else insertAtTail(lines, s, [line]);
  }
}

// ---------- Формат проекта ----------

// Признаки старого формата; пустой массив — формат текущий. Журнала ещё нет (проект до /kit:project-init) — не признак.
function oldFormat(info) {
  const signs = [];
  const p = info.params;
  const inDocs = /^\.claude\/docs\//i.test(info.journalRel);
  if (!inDocs || (!info.hasJournal && fs.existsSync(path.join(info.dir, 'docs', 'progress.md')))) signs.push('журнал не в .claude/docs');
  const parts = path.join(path.dirname(info.journalPath), 'journal');
  if (info.hasJournal) {
    if (!fs.existsSync(parts)) signs.push('журнал одним файлом');
    const lines = normalize(read(info.journalPath) || '').split('\n');
    const n = lastStageNum(lines);
    const sec = n === null ? null : findSection(lines, stageTest(n));
    const t = sec ? tablesIn(lines, sec.start, sec.end)[0] : null;
    if (t && !t.cols.includes('Как проверено')) signs.push('нет столбца «Как проверено»');
  }
  const decisions = read(path.join(parts, 'decisions.md'));
  const all = decisions === null ? [] : tablesIn(normalize(decisions).split('\n'));
  const last = all[all.length - 1];
  if (last && !last.cols.includes('Почему')) signs.push('старая таблица решений');
  if (/^дев\s*\+\s*прод$/i.test(p.get('Окружение', '').trim())) signs.push('Окружение: дев+прод');
  if (/^вручную\s*;.*always/i.test(p.get('Выкладка', '').trim())) signs.push('Выкладка: вручную; дев — PhpStorm Always');
  return signs;
}

// Сообщение о старом формате — одно для хука старта, kit-step.js и kit-journal.js.
function oldFormatText(signs) {
  return 'Журнал или параметры в старом формате (' + signs.join('; ') + ') — до работы предложи пользователю /kit:project-init: переезд на формат kit 3.0.';
}

// ---------- Блоки шага ----------

const SINGLE = ['STEP', 'STATUS', 'SUMMARY', 'CHECK', 'NEXT', 'STAGE', 'BLOCKERS', 'RECONCILE'];
const LISTS = ['DECISIONS', 'DOCS', 'BUGS', 'PROD_TODO', 'NOTES'];
const REQUIRED = ['STEP', 'STATUS', 'SUMMARY', 'NEXT'];
const STATUSES = ['✅', '⏳', '⏸', '❌'];
const SHAPE = { DECISIONS: 5, BUGS: 4 };

// Поля строки блока через «|»; «\|» — часть текста и в таблицу уходит как есть.
const fields = (s) => String(s).split(/(?<!\\)\|/).map((f) => f.trim());
const after = (s, prefix) => String(s || '').replace(new RegExp('^' + prefix + '\\s*:\\s*'), '');

// «<путь> — <о чём> — <статус>»; путь может быть «archive/x.md (было work/x.md)».
function parseDoc(line) {
  const m = /^(.+?) — (.+) — ((?:в работе|готово|устарел|постоянный).*)$/.exec(line);
  let p;
  let about;
  let status;
  if (m) [, p, about, status] = m;
  else {
    const parts = line.split(' — ');
    if (parts.length < 3) return null;
    p = parts[0];
    status = parts[parts.length - 1];
    about = parts.slice(1, -1).join(' — ');
  }
  const was = /^(.*?)\s*\(было\s+(.+?)\)$/.exec(p.trim());
  return { path: (was ? was[1] : p).trim(), old: was ? was[2].trim() : null, about: about.trim(), status: status.trim() };
}

function addItem(blocks, k, v) {
  if (k === 'DEPLOY') {
    const m = /^(Файлы|Коммит|Проверка|Удалить|Чек-лист):\s*(.*)$/.exec(v);
    if (!m || !m[2]) return `строка DEPLOY — «Поле: значение» (Файлы, Коммит, Проверка, Удалить, Чек-лист): «${v.slice(0, 60)}»`;
    if (Array.isArray(blocks.DEPLOY[m[1]])) blocks.DEPLOY[m[1]].push(m[2]);
    else if (m[1] in blocks.DEPLOY) return `поле DEPLOY «${m[1]}» повторяется`;
    else blocks.DEPLOY[m[1]] = m[2];
    return null;
  }
  if (SHAPE[k] && fields(v).length !== SHAPE[k]) return `строка ${k} — ${SHAPE[k]} полей через « | »: «${v.slice(0, 60)}»`;
  if (k === 'DOCS' && !parseDoc(v)) return `строка DOCS — «<путь> — <о чём> — <статус>»: «${v.slice(0, 60)}»`;
  blocks[k].push(v);
  return null;
}

// Однострочный блок — «КЛЮЧ: значение», многострочный — «КЛЮЧ:» и строки «- …» до следующего ключа.
// → { blocks, error }: error — текст для кода 4 (ничего не записано).
function parseBlocks(text) {
  const blocks = {};
  let list = null;
  const fail = (error) => ({ blocks: null, error });
  for (const raw of normalize(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const key = /^([A-Z][A-Z_]*):\s*(.*)$/.exec(line);
    const item = key ? null : /^-\s+(.*)$/.exec(line);
    if (key) {
      const [, k, v] = key;
      if (!SINGLE.includes(k) && !LISTS.includes(k) && k !== 'DEPLOY') return fail(`неизвестный блок ${k}`);
      if (k in blocks) return fail(`блок ${k} повторяется`);
      if (SINGLE.includes(k)) {
        blocks[k] = v;
        list = null;
        continue;
      }
      blocks[k] = k === 'DEPLOY' ? { 'Удалить': [], 'Чек-лист': [] } : [];
      list = k;
      const err = v ? addItem(blocks, k, v) : null;
      if (err) return fail(err);
    } else if (item && list) {
      const err = addItem(blocks, list, item[1].trim());
      if (err) return fail(err);
    } else {
      return fail(`строка вне блока: «${line.slice(0, 80)}»`);
    }
  }
  for (const k of REQUIRED) if (!blocks[k]) return fail(k in blocks ? `блок ${k} без значения` : `нет блока ${k}`);
  for (const k of ['STAGE', 'BLOCKERS', 'RECONCILE']) if (k in blocks && !blocks[k]) return fail(`блок ${k} без значения`);
  if (!STATUSES.includes(blocks.STATUS)) return fail(`STATUS — один из ${STATUSES.join(' ')}, а не «${blocks.STATUS}»`);
  if (blocks.NEXT !== '—' && !/^\S+ — /.test(blocks.NEXT)) return fail('NEXT — «ID — строка» или «—»');
  if (blocks.RECONCILE && fields(blocks.RECONCILE).length !== 6) {
    return fail('RECONCILE — 6 полей через « | »: дата | этап N | сверено с: … | пунктов M, сделано K | расхождения: … | на следующий этап: …');
  }
  const d = blocks.DEPLOY;
  if (d && (d['Коммит'] || d['Проверка']) && !d['Файлы']) return fail('DEPLOY: «Коммит» и «Проверка» — только вместе с «Файлы»');
  return { blocks, error: null };
}

// ---------- Правка по блокам ----------

// Файл проекта в памяти: строки без переводов; перевод строки и BOM — как в файле.
class Doc {
  constructor(rel, text) {
    this.rel = rel;
    this.original = text;
    this.bom = text.charCodeAt(0) === 0xfeff;
    const body = this.bom ? text.slice(1) : text;
    this.eol = body.includes('\r\n') ? '\r\n' : '\n';
    this.lines = body.split(/\r?\n/);
  }

  text() {
    return (this.bom ? '﻿' : '') + this.lines.join(this.eol);
  }
}

const stageNum = (id) => {
  const m = /^(\d+)\./.exec(id);
  return m ? Number(m[1]) : null;
};

// «36.2а» → [36, 2, 'а']; ID не вида N.M — null (такие строки — в конец таблицы).
function idKey(id) {
  const m = /^(\d+)\.(\d+)(.*)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2]), m[3]] : null;
}

function idAfter(a, b) {
  const x = idKey(a);
  const y = idKey(b);
  if (!x || !y) return false;
  if (x[0] !== y[0]) return x[0] > y[0];
  if (x[1] !== y[1]) return x[1] > y[1];
  return x[2] > y[2];
}

// Строка шага: есть — правятся переданные ячейки, нет — новая строка по порядку ID.
function upsertStep(lines, t, col, id, values) {
  const i = rowAt(lines, t, col['Шаг'], id);
  if (i >= 0) {
    setCells(lines, i, t, values);
    return;
  }
  let at = t.end;
  for (let j = t.first; j < t.end; j++) {
    if (idAfter(cellsOf(lines[j])[col['Шаг']], id)) {
      at = j;
      break;
    }
  }
  lines.splice(at, 0, newRow(t, { [col['Шаг']]: id, ...values }));
}

const STEP_COLS = ['Шаг', 'Статус', 'Что сделано', 'Как проверено'];

function stageTable(ctx, n) {
  const sec = findSection(ctx.J.lines, stageTest(n));
  if (!sec) {
    const moved = fs.existsSync(path.join(ctx.info.dir, ctx.docs, 'journal', 'stages', `stage-${String(n).padStart(2, '0')}.md`));
    throw new JournalError(moved ? `этап ${n} уже перенесён — шаг пишется в текущий этап`
      : `в журнале нет раздела «Этап ${n}» — для нового этапа передайте STAGE: ${n} — название`);
  }
  const t = tablesIn(ctx.J.lines, sec.start, sec.end)[0];
  if (!t) throw new JournalError(`в разделе «Этап ${n}» нет таблицы шагов`);
  return { t, col: columns(t, STEP_COLS, `таблица этапа ${n}`) };
}

// STAGE: «N — название» или «название» (номер — из STEP, иначе следующий за последним этапом).
function parseStage(text, stepN, lines) {
  const m = /^(\d+)\s*—\s*(.+)$/.exec(text);
  if (m) return { n: Number(m[1]), name: m[2].trim() };
  const last = lastStageNum(lines);
  return { n: stepN !== null ? stepN : last === null ? 0 : last + 1, name: text.trim() };
}

// Новый раздел этапа в конце журнала и строка оглавления «Этапы»; раздел уже есть — false.
function addStage(lines, stage) {
  if (findSection(lines, stageTest(stage.n))) return false;
  addSection(lines, `Этап ${stage.n} — ${stage.name}`, ['| ' + STEP_COLS.join(' | ') + ' |', '|---|---|---|---|']);
  const idx = findSection(lines, (t) => /^Этапы(\s|$)/.test(t));
  const t = idx ? tablesIn(lines, idx.start, idx.end)[0] : null;
  if (t && rowAt(lines, t, 0, String(stage.n)) < 0) lines.splice(t.end, 0, rowOf([String(stage.n), esc(stage.name), 'ниже']));
  return true;
}

function writeStep(ctx, n) {
  const { J, b } = ctx;
  const { t, col } = stageTable(ctx, n);
  upsertStep(J.lines, t, col, b.STEP, {
    [col['Статус']]: b.STATUS,
    [col['Что сделано']]: esc(b.SUMMARY),
    [col['Как проверено']]: b.CHECK ? esc(b.CHECK) : undefined,
  });
  if (b.STATUS !== '✅' || b.NEXT === '—') return;
  const [, nextId, nextText] = /^(\S+) — (.*)$/.exec(b.NEXT);
  const nn = stageNum(nextId) === null ? n : stageNum(nextId);
  // Этапа NEXT ещё нет — его раздел заведёт STAGE следующего шага.
  if (!findSection(J.lines, stageTest(nn))) return;
  const next = stageTable(ctx, nn);
  const i = rowAt(J.lines, next.t, next.col['Шаг'], nextId);
  if (i >= 0) setCells(J.lines, i, next.t, { [next.col['Статус']]: '⏳' });
  else upsertStep(J.lines, next.t, next.col, nextId, { [next.col['Статус']]: '⏳', [next.col['Что сделано']]: esc(nextText) });
}

function reconcile(ctx) {
  const { J, b, today } = ctx;
  const [date, st, withF, counts, diff] = fields(b.RECONCILE);
  const n = Number((/\d+/.exec(st) || [])[0]);
  const { t } = stageTable(ctx, n);
  const line = `Сверка ${date || today} (сверено с: ${after(withF, 'сверено с')}): ${counts}; расхождения: ${after(diff, 'расхождения')}.`;
  const sec = findSection(J.lines, stageTest(n));
  let last = -1;
  for (let i = t.end; i < sec.end; i++) {
    const l = J.lines[i].trim();
    if (l === line) return;
    if (l.startsWith('Сверка ')) last = i;
    else if (l) break;
  }
  if (last >= 0) J.lines.splice(last + 1, 0, line);
  else J.lines.splice(t.end, 0, '', line);
}

const BLOCKERS = 'Блокеры и открытые вопросы';
const nowSection = (lines) => findSection(lines, (t) => t.startsWith('Сейчас'));

function nowItem(lines, label) {
  const s = nowSection(lines);
  const re = new RegExp('^- \\*\\*' + escRe(label) + ':\\*\\*\\s*(.*)$');
  for (let i = s.start + 1; i < s.end; i++) {
    const m = re.exec(lines[i]);
    if (m) return { i, text: m[1] };
  }
  return null;
}

function setNowItem(lines, label, text) {
  const line = `- **${label}:** ${text}`;
  const it = nowItem(lines, label);
  if (it) lines[it.i] = line;
  else insertAtTail(lines, nowSection(lines), [line]);
}

// Напоминания сверки «на следующий этап (сверка этапа N): …» — сверка дописывает их в конец «Блокеров».
const REMINDERS = /(^|;\s*)на следующий этап \(сверка этапа \d+\):.*$/;

// «Сейчас» — снимок: «Этап» и «Следующий шаг» переписываются при ✅, «Блокеры» — текстом BLOCKERS, сверка дописывает пункт.
// Начат новый этап (STAGE создал раздел) — прежние напоминания сверки из «Блокеров» убираются: их этап начался.
function updateNow(ctx, n, stage, created) {
  const { J, b, today } = ctx;
  if (!nowSection(J.lines)) throw new JournalError('в журнале нет раздела «Сейчас»');
  if (b.STATUS === '✅') {
    const nowN = stage ? stage.n : n;
    const sec = findSection(J.lines, stageTest(nowN));
    const name = sec ? sec.title.replace(/^Этап\s+\d+\s*(—\s*)?/, '').trim() : '';
    const title = name ? `${nowN} — ${name}` : String(nowN);
    const prev = nowItem(J.lines, 'Этап');
    const pm = prev ? /^(\d+)\b.*?\(начат (\d{4}-\d{2}-\d{2})\)/.exec(prev.text) : null;
    const date = pm && Number(pm[1]) === nowN ? pm[2] : created ? today : null;
    const closed = b.NEXT === '—' && /^\d+\.\d+/.test(b.STEP);
    setNowItem(J.lines, 'Этап', closed ? `${title} — закрыт ${today}` : `${title}${date ? ` (начат ${date})` : ''}; последний шаг ${b.STEP} — ${b.SUMMARY}`);
    setNowItem(J.lines, 'Следующий шаг', b.NEXT === '—' ? 'нет — этап закрыт' : b.NEXT);
  }
  if (b.BLOCKERS) setNowItem(J.lines, BLOCKERS, b.BLOCKERS);
  else if (created) {
    const it = nowItem(J.lines, BLOCKERS);
    if (it && REMINDERS.test(it.text)) setNowItem(J.lines, BLOCKERS, it.text.replace(REMINDERS, '').trim() || '—');
  }
  if (!b.RECONCILE) return;
  const f = fields(b.RECONCILE);
  const next = after(f[5], 'на следующий этап');
  if (!next || next === '—') return;
  const add = `на следующий этап (сверка этапа ${Number((/\d+/.exec(f[1]) || [])[0])}): ${next}`;
  const cur = (nowItem(J.lines, BLOCKERS) || { text: '' }).text.trim();
  if (cur.includes(add)) return;
  setNowItem(J.lines, BLOCKERS, /^(—|-|нет|блокеров нет)?\.?$/i.test(cur) ? add : `${cur}; ${add}`);
}

function decisions(ctx) {
  const { b, warnings } = ctx;
  const d = ctx.load(ctx.part('decisions.md'), true);
  const all = tablesIn(d.lines);
  const t = all[all.length - 1];
  if (!t) throw new JournalError(`в ${d.rel} нет таблицы решений`);
  const col = columns(t, ['№', 'Дата', 'Шаг', 'Решение', 'Почему', 'Что отвергли', 'Кто'], `таблица решений ${d.rel}`);
  const rows = () => {
    const out = [];
    for (let i = t.first; i < t.end; i++) out.push({ i, c: cellsOf(d.lines[i]) });
    return out;
  };
  let last = Math.max(0, ...rows().map((r) => Number(r.c[col['№']]) || 0));
  for (const line of b.DECISIONS) {
    const [date, text, why, rejected, who] = fields(line);
    const cells = { [col['Дата']]: date, [col['Шаг']]: b.STEP, [col['Решение']]: esc(text), [col['Почему']]: esc(why), [col['Что отвергли']]: esc(rejected), [col['Кто']]: who };
    const same = rows().find((r) => Object.entries(cells).every(([c, v]) => (Number(c) === col['Решение'] ? r.c[c].replace(/( → заменено №\d+)+$/, '') : r.c[c]) === v));
    let num = same ? Number(same.c[col['№']]) : 0;
    if (!same) {
      num = ++last;
      d.lines.splice(t.end, 0, newRow(t, { [col['№']]: String(num), ...cells }));
      t.end++;
    }
    const rep = /^Заменяет\s+([^:]*)/.exec(text);
    if (!rep) continue;
    for (const [, k] of rep[1].matchAll(/№\s*(\d+)/g)) {
      const r = rows().find((x) => x.c[col['№']] === k);
      const mark = ` → заменено №${num}`;
      if (!r) warnings.push(`решения №${k} нет — «${mark.trim()}» не дописано`);
      else if (!r.c[col['Решение']].includes(mark)) setCells(d.lines, r.i, t, { [col['Решение']]: r.c[col['Решение']] + mark });
    }
  }
}

const REGISTRY = (t) => t.startsWith('Документы');

function docsRegistry(ctx) {
  const { J, b } = ctx;
  if (!findSection(J.lines, REGISTRY)) addSection(J.lines, 'Документы', ['| Файл | О чём | Статус |', '|---|---|---|'], anyStage);
  for (const line of b.DOCS) {
    const sec = findSection(J.lines, REGISTRY);
    const t = tablesIn(J.lines, sec.start, sec.end)[0];
    if (!t) throw new JournalError('в разделе «Документы» нет таблицы');
    const col = columns(t, ['Файл', 'О чём', 'Статус'], 'реестр «Документы»');
    const doc = parseDoc(line);
    const values = { [col['О чём']]: esc(doc.about), [col['Статус']]: esc(doc.status) };
    let i = rowAt(J.lines, t, col['Файл'], doc.path);
    if (i < 0 && doc.old) {
      i = rowAt(J.lines, t, col['Файл'], doc.old);
      values[col['Файл']] = doc.path;
    }
    if (i >= 0) setCells(J.lines, i, t, values);
    else J.lines.splice(t.end, 0, newRow(t, { [col['Файл']]: doc.path, ...values }));
  }
}

// Документы реестра `work/…` со статусом «в работе, этап N».
function stagePlans(lines, n) {
  const sec = findSection(lines, REGISTRY);
  const t = sec ? tablesIn(lines, sec.start, sec.end)[0] : null;
  if (!t) return [];
  const file = t.cols.indexOf('Файл');
  const status = t.cols.indexOf('Статус');
  const out = [];
  for (let i = t.first; i < t.end; i++) {
    const c = cellsOf(lines[i]);
    if ((c[file] || '').startsWith('work/') && new RegExp(`^в работе, этап ${n}(?!\\d)`).test(c[status] || '')) out.push(c[file]);
  }
  return out;
}

// Галочка в чек-листе плана этапа: документы «в работе, этап N» — до и после DOCS этого вызова (план, оставленный в work/
// при закрытии этапа, DOCS переводит на следующий этап) — и план, который этот же вызов перенёс в архив. Предупреждение —
// только если в плане есть строки этого этапа: у плана прошлого этапа строк нового нет, и это не ошибка.
function checklist(ctx, n) {
  const { J, b, warnings } = ctx;
  const paths = [...(ctx.plansBefore || []), ...stagePlans(J.lines, n)];
  for (const line of b.DOCS || []) {
    const d = parseDoc(line);
    if (d.old && d.path.startsWith('archive/')) paths.push(d.path);
  }
  const box = new RegExp('^(\\s*- \\[)([ xX])(\\] ' + escRe(b.STEP) + ' —)');
  const ofStage = new RegExp('^\\s*- \\[[ xX]\\] ' + n + '\\.');
  for (const p of new Set(paths)) {
    const doc = ctx.load(ctx.docs + '/' + p, false);
    if (!doc) continue;
    const i = doc.lines.findIndex((l) => box.test(l));
    if (i >= 0) doc.lines[i] = doc.lines[i].replace(box, '$1x$3');
    else if (doc.lines.some((l) => ofStage.test(l))) warnings.push(`в плане ${p} нет строки ${b.STEP}`);
  }
}

function bugs(ctx) {
  const d = ctx.load(ctx.part('bugs.md'), true);
  const sec = findSection(d.lines, (t) => t.startsWith('Баги на потом'));
  const t = (sec ? tablesIn(d.lines, sec.start, sec.end) : tablesIn(d.lines))[0];
  if (!t) throw new JournalError(`в ${d.rel} нет таблицы багов`);
  const col = columns(t, ['№', 'Баг', 'Где', 'Статус'], `таблица багов ${d.rel}`);
  for (const line of ctx.b.BUGS) {
    const [num, bug, where, status] = fields(line);
    const values = { [col['Баг']]: bug ? esc(bug) : undefined, [col['Где']]: where ? esc(where) : undefined, [col['Статус']]: status ? esc(status) : undefined };
    if (num && num !== '—' && num !== '-') {
      const i = rowAt(d.lines, t, col['№'], num);
      if (i >= 0) setCells(d.lines, i, t, values);
      else d.lines.splice(t.end++, 0, newRow(t, { [col['№']]: num, ...values }));
      continue;
    }
    // Без номера — следующий с той же приставкой, что у последней строки (К61 → К62); тот же баг второй раз не пишется.
    const rows = [];
    for (let i = t.first; i < t.end; i++) rows.push(cellsOf(d.lines[i]));
    if (rows.some((c) => c[col['Баг']] === esc(bug))) continue;
    const m = /^(.*?)(\d+)$/.exec(rows.length ? rows[rows.length - 1][col['№']] : '');
    d.lines.splice(t.end++, 0, newRow(t, { [col['№']]: m ? m[1] + (Number(m[2]) + 1) : String(rows.length + 1), ...values }));
  }
}

function prodTodo(ctx) {
  const { J, b } = ctx;
  const find = () => findSection(J.lines, (t) => t.startsWith('Прод: не забыть'));
  if (!find()) addSection(J.lines, 'Прод: не забыть', b.PROD_TODO.map((i) => '- ' + i), anyStage);
  else addItems(J.lines, find, b.PROD_TODO);
}

// NOTES: «Заказчик: …» — в «Материалы заказчика» без приставки, остальное (и «Отчёт заказчику: …») — в «Справочник».
function notes(ctx) {
  const d = ctx.load(ctx.part('reference.md'), true);
  const groups = { 'Справочник': [], 'Материалы заказчика': [] };
  for (const note of ctx.b.NOTES) {
    const m = /^Заказчик:\s*(.+)$/.exec(note);
    if (m) groups['Материалы заказчика'].push(m[1]);
    else groups['Справочник'].push(note);
  }
  for (const [title, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const find = () => findSection(d.lines, (t) => t.startsWith(title));
    if (find()) addItems(d.lines, find, items);
    else addSection(d.lines, title, items.map((i) => '- ' + i), title === 'Справочник' ? null : (t) => t.startsWith('Справочник'));
  }
}

function deploy(ctx) {
  const { info, b, today, warnings } = ctx;
  const plan = ctx.load(info.planRel, false);
  if (!plan) {
    warnings.push(`плана выкладки ${info.planRel} нет — DEPLOY не записан`);
    return;
  }
  const d = b.DEPLOY;
  if (d['Файлы'] && /^phpstorm always/i.test(info.params.get('Выкладка', '').trim())) warnings.push('при автозаливке «Залито» не ведётся');
  else if (d['Файлы']) {
    const title = 'Залито на ' + (serverEnv(info.params) === 'дев' ? 'дев' : 'прод');
    const find = () => findSection(plan.lines, (t) => t.startsWith(title));
    if (!find()) addSection(plan.lines, title, ['| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|'], (t) => t.startsWith('Удалить с сервера'));
    const s = find();
    const t = tablesIn(plan.lines, s.start, s.end)[0];
    if (!t) throw new JournalError(`в разделе «${title}» плана выкладки нет таблицы`);
    const col = columns(t, ['Шаг', 'Дата', 'Файлы', 'Коммит', 'Проверка'], `таблица «${title}»`);
    let dup = false;
    for (let i = t.first; i < t.end; i++) {
      const c = cellsOf(plan.lines[i]);
      if (c[col['Шаг']] === b.STEP && c[col['Файлы']] === esc(d['Файлы'])) dup = true;
    }
    if (!dup) {
      plan.lines.splice(t.end, 0, newRow(t, { [col['Шаг']]: b.STEP, [col['Дата']]: today, [col['Файлы']]: esc(d['Файлы']),
        [col['Коммит']]: esc(d['Коммит'] || ''), [col['Проверка']]: esc(d['Проверка'] || '') }));
    }
  }
  if (d['Удалить'].length) {
    const s = findSection(plan.lines, (t) => t.startsWith('Удалить с сервера'));
    const t = s ? tablesIn(plan.lines, s.start, s.end)[0] : null;
    if (!t) warnings.push('в плане выкладки нет таблицы «Удалить с сервера» — удаления не записаны');
    else {
      const col = columns(t, ['Путь', 'Почему'], 'таблица «Удалить с сервера»');
      for (const item of d['Удалить']) {
        const [p, ...why] = item.split(' — ');
        if (rowAt(plan.lines, t, col['Путь'], esc(p.trim())) >= 0) continue;
        plan.lines.splice(t.end++, 0, newRow(t, { [col['Путь']]: esc(p.trim()), [col['Почему']]: esc(why.join(' — ').trim()) }));
      }
    }
  }
  if (!d['Чек-лист'].length) return;
  const find = () => findSection(plan.lines, (t) => t.startsWith('Чек-лист переключения'));
  if (!find()) {
    warnings.push('в плане выкладки нет раздела «Чек-лист переключения» — пункты не записаны');
    return;
  }
  for (const item of d['Чек-лист']) {
    const s = find();
    let count = 0;
    let stub = -1;
    let has = false;
    for (let i = s.start + 1; i < s.end; i++) {
      const m = /^(\d+)\.\s+(.*)$/.exec(plan.lines[i].trim());
      if (!m) continue;
      if (/^\((заполняется по ходу работы|пока пусто)\)$/.test(m[2])) stub = i;
      else {
        count++;
        if (m[2] === item) has = true;
      }
    }
    if (has) continue;
    const line = `${count + 1}. ${item}`;
    if (stub >= 0) plan.lines[stub] = line;
    else insertAtTail(plan.lines, s, [line]);
  }
}

// Блоки → новые тексты файлов. Ничего не пишет; ошибки (журнала нет, старый формат, нет раздела этапа, таблица не
// разбирается) — JournalError. → { files: Map<путь от корня, текст> (журнал — последним), warnings, now }.
function applyBlocks(info, b, { today }) {
  if (!info.hasJournal) throw new JournalError(`журнала ${info.journalRel} нет — нужен /kit:project-init`);
  const signs = oldFormat(info);
  if (signs.length) throw new JournalError(oldFormatText(signs));
  const docs = path.posix.dirname(info.journalRel);
  const loaded = new Map();
  const load = (rel, need) => {
    if (loaded.has(rel)) return loaded.get(rel);
    const text = read(path.join(info.dir, rel));
    if (text === null) {
      if (need) throw new JournalError(`нет файла ${rel}`);
      return null;
    }
    const doc = new Doc(rel, text);
    loaded.set(rel, doc);
    return doc;
  };
  const ctx = { info, b, today, docs, load, part: (name) => docs + '/journal/' + name, warnings: [] };
  ctx.J = load(info.journalRel, true);
  const stepN = stageNum(b.STEP);
  const stage = b.STAGE ? parseStage(b.STAGE, stepN, ctx.J.lines) : null;
  const n = stepN !== null ? stepN : stage ? stage.n : lastStageNum(ctx.J.lines);
  if (n === null) throw new JournalError('в журнале нет раздела этапа — передайте STAGE');
  const created = stage ? addStage(ctx.J.lines, stage) : false;
  writeStep(ctx, n);
  if (b.RECONCILE) reconcile(ctx);
  updateNow(ctx, n, stage, created);
  if (b.DECISIONS) decisions(ctx);
  ctx.plansBefore = stagePlans(ctx.J.lines, n);
  if (b.DOCS) docsRegistry(ctx);
  if (b.STATUS === '✅') checklist(ctx, n);
  if (b.BUGS) bugs(ctx);
  if (b.PROD_TODO) prodTodo(ctx);
  if (b.NOTES) notes(ctx);
  if (b.DEPLOY) deploy(ctx);
  if (b.STATUS === '✅' && !b.CHECK) ctx.warnings.push('нет CHECK при ✅');
  const files = new Map();
  for (const doc of loaded.values()) if (doc !== ctx.J && doc.text() !== doc.original) files.set(doc.rel, doc.text());
  if (ctx.J.text() !== ctx.J.original) files.set(ctx.J.rel, ctx.J.text());
  return { files, warnings: ctx.warnings, now: getSection(ctx.J.lines.join('\n'), 'Сейчас') };
}

// Временные файлы рядом → rename по порядку (журнал — последним); временные файлы убираются и при ошибке.
// Переименование при чужом читателе повторяется (с 3.3.0); остановилось не на первом файле — PartialWriteError
// с уже записанными (пути от корня): повтор тех же блоков их не удваивает.
function writeAll(dir, files) {
  writeFilesAtomic([...files].map(([rel, text]) => ({ file: path.join(dir, rel), text, label: rel })));
}

module.exports = { oldFormat, oldFormatText, parseBlocks, applyBlocks, writeAll, JournalError, PartialWriteError };
