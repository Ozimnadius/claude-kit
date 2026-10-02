'use strict';
// Сравнение прогонов без картинок: дифф текста, шум контрольного прогона, статусы и ошибки из meta.json, вердикт.
// Здесь же — ведение meta.json (дописывание частичного прогона) и noise.json (шум по контрольным прогонам).

// Доля пикселей сверх двойного шума, которая ещё считается шумом (в процентах).
const PIXEL_MARGIN = 0.1;

const pageKey = (r) => `${r.ctx}/${r.vp}/${r.name}`;
const stripQuery = (u) => String(u).split('?')[0];

function textLines(s) {
  return String(s).split('\n').map((x) => x.trim()).filter(Boolean);
}

// Как в прототипе: пропало / появилось с учётом числа повторов строки.
function textDiff(a, b) {
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
  const ca = count(textLines(a));
  const cb = count(textLines(b));
  const removed = [...ca].filter(([s, n]) => (cb.get(s) || 0) < n).map(([s]) => s);
  const added = [...cb].filter(([s, n]) => (ca.get(s) || 0) < n).map(([s]) => s);
  return { removed, added };
}

// Строка с точностью до чисел: «Найдено 12» и «Найдено 13», таймер 1790338514967 и 1790338537147 — одно и то же.
const numless = (l) => l.replace(/\d+/g, '#');

// Строки, разошедшиеся в контрольном прогоне (в любую сторону), — шум с точностью до чисел:
// уходят в noiseRemoved/noiseAdded и на вердикт не влияют.
function applyTextNoise(td, noise) {
  const nz = new Set([...((noise && noise.removed) || []), ...((noise && noise.added) || [])].map(numless));
  const isNoise = (l) => nz.has(numless(l));
  return {
    removed: td.removed.filter((l) => !isNoise(l)),
    added: td.added.filter((l) => !isNoise(l)),
    noiseRemoved: td.removed.filter(isNoise),
    noiseAdded: td.added.filter(isNoise),
  };
}

// Отличия meta страницы: [{ kind: status|final|uid|js|net, key?, text, noise }].
// Сеть сравнивается, только если записана в обоих прогонах (у меток прототипа её нет).
function metaChanges(a, b, noise) {
  const out = [];
  if (!a || !b) return out;
  const nErr = new Set((noise && noise.errors) || []);
  const nNet = new Set((noise && noise.net) || []);
  if (a.status !== b.status) out.push({ kind: 'status', text: `статус ${a.status} → ${b.status}`, noise: false });
  if (a.final !== b.final) out.push({ kind: 'final', text: `адрес ${a.final} → ${b.final}`, noise: false });
  if ((a.uid || '') !== (b.uid || '')) out.push({ kind: 'uid', text: `USER_ID ${a.uid || '(пусто)'} → ${b.uid || '(пусто)'}`, noise: false });
  const sets = (xs, ys, key, kind, label, nz) => {
    const ka = new Set((xs || []).map(key));
    const kb = new Set((ys || []).map(key));
    for (const k of kb) if (!ka.has(k)) out.push({ kind, key: k, text: `${label}: + ${k}`, noise: nz.has(k) });
    for (const k of ka) if (!kb.has(k)) out.push({ kind, key: k, text: `${label}: − ${k}`, noise: nz.has(k) });
  };
  sets(a.errors, b.errors, (x) => String(x), 'js', 'JS', nErr);
  if (Array.isArray(a.bad) && Array.isArray(b.bad)) sets(a.bad, b.bad, (r) => `${r.status} ${stripQuery(r.url)}`, 'net', 'ответ', nNet);
  if (Array.isArray(a.failed) && Array.isArray(b.failed)) sets(a.failed, b.failed, (r) => `${r.error} ${stripQuery(r.url)}`, 'net', 'запрос', nNet);
  return out;
}

// Ошибки setup, которых не было «до»: ['setup admin/desktop: …'].
function setupChanges(ma, mb) {
  const a = (ma && ma.setup) || {};
  const b = (mb && mb.setup) || {};
  return Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `setup ${k}: ${b[k]}`);
}

// Вердикт сравнённого снимка: same | noise | diff.
// row: { pct, text: { removed, added } | null, changes, noise: { pct } | null }.
function verdictOf(row) {
  const textChanged = !!(row.text && (row.text.removed.length || row.text.added.length));
  if (row.changes.some((c) => !c.noise)) return 'diff';
  if (row.pct === 0 && !textChanged) return 'same';
  if (row.noise && !textChanged && row.pct <= 2 * row.noise.pct + PIXEL_MARGIN) return 'noise';
  return 'diff';
}

// Снимок, которого нет в одном из прогонов: missing | skipped | new | nobefore | null (есть в обоих).
function presence({ hasA, hasB, a, b, fullB }) {
  if (hasA && hasB) return null;
  if (hasA) return (b && b.fail) || fullB ? 'missing' : 'skipped';
  if (hasB) return a && a.fail ? 'nobefore' : 'new';
  return b && b.fail ? 'missing' : null;
}

function metaIndex(meta) {
  return new Map(((meta && meta.pages) || []).map((r) => [pageKey(r), r]));
}

// Полный ли прогон; у меток прототипа поля full нет — они полные (частичные писали meta-<имя>.json).
function isFull(meta) {
  return !meta || meta.full !== false;
}

// Дописать прогон в meta.json метки: снятые страницы заменяются, остальные остаются.
// run: { base, env, date, full, filters, groups: ['ctx/vp'], setup: { 'ctx/vp': ошибка }, pages }.
function mergeMeta(old, run) {
  const fresh = new Set(run.pages.map(pageKey));
  const pages = [...((old && old.pages) || []).filter((r) => !fresh.has(pageKey(r))), ...run.pages];
  const setup = { ...((old && old.setup) || {}) };
  for (const g of run.groups) delete setup[g];
  Object.assign(setup, run.setup);
  return {
    base: run.base,
    env: run.env,
    date: run.date,
    full: !!run.full || (!!old && isFull(old)),
    runs: [...((old && old.runs) || []), { date: run.date, filters: run.filters }],
    setup,
    pages,
  };
}

// Шум из сравнения «метка ↔ метка-check» (без учёта прежнего шума).
function noiseFromRows(rows) {
  const snapshots = {};
  for (const r of rows) {
    if (!['same', 'noise', 'diff'].includes(r.verdict)) continue;
    const errors = r.changes.filter((c) => c.kind === 'js').map((c) => c.key);
    const net = r.changes.filter((c) => c.kind === 'net').map((c) => c.key);
    const removed = r.text ? r.text.removed : [];
    const added = r.text ? r.text.added : [];
    if (r.pct > 0 || removed.length || added.length || errors.length || net.length) {
      snapshots[r.key] = { pct: r.pct, removed, added, errors, net };
    }
  }
  return snapshots;
}

// Дополнить noise.json новым контрольным прогоном: % — максимум, строки и ошибки — объединение.
function mergeNoise(old, snapshots, check, date) {
  const uni = (a = [], b = []) => [...new Set([...a, ...b])];
  const out = {
    runs: ((old && old.runs) || 0) + 1,
    date,
    checks: [...((old && old.checks) || []), check],
    snapshots: { ...((old && old.snapshots) || {}) },
  };
  for (const [k, s] of Object.entries(snapshots)) {
    const o = out.snapshots[k];
    out.snapshots[k] = !o ? s : {
      pct: Math.max(o.pct || 0, s.pct || 0),
      removed: uni(o.removed, s.removed),
      added: uni(o.added, s.added),
      errors: uni(o.errors, s.errors),
      net: uni(o.net, s.net),
    };
  }
  return out;
}

module.exports = {
  PIXEL_MARGIN, pageKey, textLines, textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence,
  metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
};
