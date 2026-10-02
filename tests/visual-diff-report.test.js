'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence, metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
} = require('../plugins/kit/scripts/lib/visual/diff');
const { buildSummary, consoleLines, buildHtml } = require('../plugins/kit/scripts/lib/visual/report');

// textDiff прототипа beta (.claude/scripts/visual/visual.mjs, коммит 0.3) — дословно.
function prototypeTextDiff(a, b) {
  const A = a.split('\n').map((s) => s.trim()).filter(Boolean);
  const B = b.split('\n').map((s) => s.trim()).filter(Boolean);
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
  const ca = count(A), cb = count(B);
  const removed = [...ca].filter(([s, n]) => (cb.get(s) || 0) < n).map(([s]) => s);
  const added = [...cb].filter(([s, n]) => (ca.get(s) || 0) < n).map(([s]) => s);
  return { removed, added };
}

const page = (over = {}) => ({ ctx: 'admin', vp: 'desktop', name: 'order', url: '/order/', status: 200, final: '/order/', uid: '1', errors: [], bad: [], failed: [], ...over });

test('textDiff совпадает с прототипом, в том числе с повторами строк и \\r\\n', () => {
  const cases = [
    ['a\nb\nc', 'a\nc\nd'],
    ['  Корзина (3)  \n\nИтого', 'Корзина (0)\nИтого\nИтого'],
    ['x\nx\ny', 'x\ny\ny'],
    ['', 'новое'],
    ['строка\r\nещё', 'строка\nещё'],
  ];
  for (const [a, b] of cases) assert.deepEqual(textDiff(a, b), prototypeTextDiff(a, b), JSON.stringify([a, b]));
  assert.deepEqual(textDiff('Корзина (3)\nИтого', 'Корзина (0)\nИтого'), { removed: ['Корзина (3)'], added: ['Корзина (0)'] });
});

test('applyTextNoise: строки шума (с точностью до чисел) уходят в отдельные списки', () => {
  const td = { removed: ['Найдено: 12', 'Цена 100'], added: ['Найдено: 13', 'Цена 120'] };
  assert.deepEqual(applyTextNoise(td, { removed: ['Найдено: 13'], added: ['Найдено: 12'] }),
    { removed: ['Цена 100'], added: ['Цена 120'], noiseRemoved: ['Найдено: 12'], noiseAdded: ['Найдено: 13'] });
  assert.deepEqual(applyTextNoise(td, null), { ...td, noiseRemoved: [], noiseAdded: [] });
  const timer = applyTextNoise({ removed: ['1790338514967'], added: ['1790338600000', 'Новая строка'] }, { removed: ['1790338514967'], added: ['1790338537147'] });
  assert.deepEqual(timer, { removed: [], added: ['Новая строка'], noiseRemoved: ['1790338514967'], noiseAdded: ['1790338600000'] }, 'таймер с третьим значением — тоже шум');
  assert.deepEqual(applyTextNoise({ removed: ['Цена 100'], added: ['Цена 120'] }, { removed: ['Найдено 12'], added: [] }).removed, ['Цена 100'], 'другая строка с числом — не шум');
});

test('metaChanges: статус, адрес, USER_ID, JS и сеть (ключ без query), шум помечен', () => {
  const a = page({ errors: ['old err', 'flaky 1'], bad: [{ status: 404, url: '/img/a.png?v=1', type: 'image' }] });
  const b = page({ status: 500, final: '/order/?x=1', uid: '', errors: ['old err', 'flaky 2', 'new err'],
    bad: [{ status: 404, url: '/img/a.png?v=2', type: 'image' }, { status: 500, url: '/order/ajax.php?t=1', type: 'xhr' }],
    failed: [{ url: 'https://mc.yandex.ru/watch', error: 'net::ERR_ABORTED', type: 'script' }] });
  const ch = metaChanges(a, b, { errors: ['flaky 1', 'flaky 2'], net: [] });
  assert.deepEqual(ch.map((c) => [c.kind, c.text, c.noise]), [
    ['status', 'статус 200 → 500', false],
    ['final', 'адрес /order/ → /order/?x=1', false],
    ['uid', 'USER_ID 1 → (пусто)', false],
    ['js', 'JS: + flaky 2', true],
    ['js', 'JS: + new err', false],
    ['js', 'JS: − flaky 1', true],
    ['net', 'ответ: + 500 /order/ajax.php', false],
    ['net', 'запрос: + net::ERR_ABORTED https://mc.yandex.ru/watch', false],
  ]);
  const proto = { ...page(), bad: undefined, failed: undefined };
  assert.deepEqual(metaChanges(proto, b, null).filter((c) => c.kind === 'net'), [], 'у метки прототипа сети нет — не сравниваем');
  assert.deepEqual(metaChanges(null, b), []);
});

test('setupChanges: только новые или изменившиеся ошибки setup', () => {
  assert.deepEqual(setupChanges({ setup: { 'admin/desktop': 'x' } }, { setup: { 'admin/desktop': 'x', 'admin/mobile': 'Timeout' } }), ['setup admin/mobile: Timeout']);
  assert.deepEqual(setupChanges({}, {}), []);
});

test('verdictOf: совпадает, в пределах шума, отличается', () => {
  const r = (o) => ({ pct: 0, text: { removed: [], added: [] }, changes: [], noise: null, ...o });
  assert.equal(verdictOf(r()), 'same');
  assert.equal(verdictOf(r({ text: null })), 'same');
  assert.equal(verdictOf(r({ pct: 0.01 })), 'diff', 'без шума любое отличие — отличается');
  assert.equal(verdictOf(r({ pct: 0.9, noise: { pct: 0.5 } })), 'noise');
  assert.equal(verdictOf(r({ pct: 1.2, noise: { pct: 0.5 } })), 'diff');
  assert.equal(verdictOf(r({ pct: 0.05, noise: { pct: 0 } })), 'noise', 'текстовый шум даёт запас 0,1%');
  assert.equal(verdictOf(r({ pct: 0.2, noise: { pct: 0.5 }, text: { removed: ['Цена 100'], added: [] } })), 'diff');
  assert.equal(verdictOf(r({ changes: [{ noise: false }] })), 'diff', 'отличие meta — всегда отличается');
  assert.equal(verdictOf(r({ changes: [{ noise: true }] })), 'same');
});

test('presence: не снято, не снимали, новый, нет «до»', () => {
  assert.equal(presence({ hasA: true, hasB: true }), null);
  assert.equal(presence({ hasA: true, hasB: false, fullB: true }), 'missing');
  assert.equal(presence({ hasA: true, hasB: false, fullB: false }), 'skipped');
  assert.equal(presence({ hasA: true, hasB: false, fullB: false, b: { fail: 'Timeout' } }), 'missing');
  assert.equal(presence({ hasA: false, hasB: true }), 'new');
  assert.equal(presence({ hasA: false, hasB: true, a: { fail: 'x' } }), 'nobefore');
  assert.equal(presence({ hasA: false, hasB: false, b: { fail: 'x' } }), 'missing');
  assert.equal(presence({ hasA: false, hasB: false }), null);
});

test('mergeMeta: частичный прогон заменяет только свои страницы и ошибки setup своих групп', () => {
  const old = { base: 'https://x.ru', full: true, runs: [{ date: 'd1', filters: {} }], setup: { 'admin/desktop': 'old', 'admin/mobile': 'keep' },
    pages: [page({ name: 'home' }), page({ name: 'order', status: 500 })] };
  const m = mergeMeta(old, { base: 'https://x.ru', env: 'прод', date: 'd2', full: false, filters: { only: ['order'] },
    groups: ['admin/desktop'], setup: {}, pages: [page({ name: 'order', status: 200 })] });
  assert.equal(m.full, true);
  assert.deepEqual(m.pages.map((p) => `${p.name}:${p.status}`), ['home:200', 'order:200']);
  assert.deepEqual(m.setup, { 'admin/mobile': 'keep' });
  assert.equal(m.runs.length, 2);
  const fresh = mergeMeta(null, { base: 'b', env: 'прод', date: 'd', full: false, filters: {}, groups: [], setup: {}, pages: [] });
  assert.equal(fresh.full, false);
  assert.equal(isFull({ pages: [] }), true, 'метка прототипа — полная');
  assert.equal(metaIndex(m).get('admin/desktop/home').name, 'home');
});

test('noiseFromRows и mergeNoise: шум копится по контрольным прогонам', () => {
  const rows = [
    { key: 'admin/mobile/search', verdict: 'diff', pct: 0.5, text: { removed: ['Найдено 12'], added: ['Найдено 13'] }, changes: [{ kind: 'js', key: 'e1' }] },
    { key: 'guest/desktop/home', verdict: 'same', pct: 0, text: { removed: [], added: [] }, changes: [] },
    { key: 'guest/desktop/x', verdict: 'missing', changes: [] },
  ];
  const s1 = noiseFromRows(rows);
  assert.deepEqual(Object.keys(s1), ['admin/mobile/search']);
  const n1 = mergeNoise(null, s1, 'before-check', 'd1');
  const n2 = mergeNoise(n1, { 'admin/mobile/search': { pct: 0.3, removed: ['Найдено 13'], added: ['Найдено 11'], errors: [], net: ['500 /x'] } }, 'before-check', 'd2');
  assert.equal(n2.runs, 2);
  assert.deepEqual(n2.checks, ['before-check', 'before-check']);
  assert.deepEqual(n2.snapshots['admin/mobile/search'], { pct: 0.5, removed: ['Найдено 12', 'Найдено 13'], added: ['Найдено 13', 'Найдено 11'], errors: ['e1'], net: ['500 /x'] });
});

const ROWS = [
  { key: 'guest/desktop/home', verdict: 'same', pct: 0, size: '1920×3000 → 1920×3000', text: { removed: [], added: [] }, changes: [] },
  { key: 'admin/desktop/order', verdict: 'diff', pct: 2.345, size: '1920×2000 → 1920×2100', text: { removed: ['<b>Итого</b>'], added: ['Итого & скидка'], noiseRemoved: ['Найдено 12'], noiseAdded: [] },
    changes: [{ kind: 'status', text: 'статус 200 → 500', noise: false }, { kind: 'js', key: 'x', text: 'JS: + flaky', noise: true }] },
  { key: 'admin/mobile/search', verdict: 'noise', pct: 0.4, noise: { pct: 0.5 }, text: { removed: [], added: [] }, changes: [] },
  { key: 'admin/mobile/order', verdict: 'missing', reason: 'Timeout 90000ms' },
];

test('buildSummary и consoleLines: порядок, счётчики, статусы первыми, подсказка про check', () => {
  const s = buildSummary({ before: 'before', after: 'after-1.1', base: 'https://x.ru', rows: ROWS, setup: ['setup admin/mobile: Timeout'], noiseHint: true, date: 'd' });
  assert.deepEqual(s.rows.map((r) => r.verdict), ['diff', 'missing', 'noise', 'same']);
  assert.equal(s.counts.diff, 1);
  assert.equal(s.problems, 3);
  const out = consoleLines(s).join('\n');
  assert.ok(out.indexOf('Статусы и ошибки:') < out.indexOf('Отличается:'));
  assert.match(out, /admin\/desktop\/order {2}статус 200 → 500\n/, 'шумная JS-ошибка в консоль не идёт');
  assert.match(out, /2\.345% {2}admin\/desktop\/order {2}текст −1\/\+1/);
  assert.match(out, /Не снято:\n {2}admin\/mobile\/order {2}Timeout 90000ms/);
  assert.match(out, /\(шум 0\.5%\) {2}admin\/mobile\/search/);
  assert.match(out, /Итого: совпадает 1, в пределах шума 1, отличается 1, не снято 1 \(из 4\)/);
  assert.match(out, /node visual\.js check before/);
  assert.doesNotMatch(consoleLines({ ...s, noiseHint: false }).join('\n'), /check before/);
});

test('buildHtml: всё экранировано, картинки относительно папки сравнения, шум серым', () => {
  const html = buildHtml(buildSummary({ before: 'before', after: 'after-1.1', base: 'https://x.ru', rows: ROWS, setup: [] }));
  assert.ok(html.includes('&lt;b&gt;Итого&lt;/b&gt;'));
  assert.ok(html.includes('Итого &amp; скидка'));
  assert.ok(!html.includes('<b>Итого</b>'));
  assert.ok(html.includes('src="../before/admin/desktop/order.png"'));
  assert.ok(html.includes('src="../after-1.1/admin/desktop/order.png"'));
  assert.ok(html.includes('src="admin/desktop/order.png"'));
  assert.ok(html.includes('<li class="nz">Найдено 12</li>'));
  assert.ok(html.includes('<span class="nz">JS: + flaky</span>'));
  assert.match(html, /<details id="admin\/desktop\/order" open>/);
  assert.ok(!html.includes('<details id="guest/desktop/home"'), 'у совпавших подробностей нет');
});
