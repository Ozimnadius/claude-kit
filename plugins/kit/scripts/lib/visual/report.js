'use strict';
// Итог сравнения: summary.json (для Claude), report.html (для человека), строки для консоли.

const VERDICTS = {
  diff: 'отличается',
  missing: 'не снято',
  noise: 'в пределах шума',
  new: 'новый',
  nobefore: 'нет «до»',
  skipped: 'не снимали',
  same: 'совпадает',
};
const ORDER = Object.keys(VERDICTS);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const realChanges = (r) => (r.changes || []).filter((c) => !c.noise);
const textStat = (r) => (r.text && (r.text.removed.length || r.text.added.length) ? `  текст −${r.text.removed.length}/+${r.text.added.length}` : '');

// rows: [{ key, verdict, pct?, size?, text?, changes?, noise?, reason? }]; setup: ['setup ctx/vp: …'].
function buildSummary({ before, after, base, dateBefore, dateAfter, rows, setup = [], noiseHint = false, date = new Date().toISOString() }) {
  const counts = Object.fromEntries(ORDER.map((v) => [v, 0]));
  for (const r of rows) counts[r.verdict]++;
  const sorted = [...rows].sort((x, y) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict)
    || (y.pct || 0) - (x.pct || 0) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return {
    before, after, base, dateBefore, dateAfter, date, noiseHint, counts, setup,
    problems: counts.diff + counts.missing + setup.length,
    rows: sorted,
  };
}

function consoleLines(s) {
  const lines = [`Сравнение ${s.before} → ${s.after}${s.base ? ` (${s.base})` : ''}`];
  const meta = s.rows.filter((r) => realChanges(r).length);
  if (meta.length || s.setup.length) {
    lines.push('Статусы и ошибки:');
    for (const t of s.setup) lines.push('  ' + t);
    for (const r of meta) lines.push(`  ${r.key}  ${realChanges(r).map((c) => c.text).join('; ')}`);
  }
  const pick = (v) => s.rows.filter((r) => r.verdict === v);
  if (pick('diff').length) {
    lines.push('Отличается:');
    for (const r of pick('diff')) lines.push(`  ${String(r.pct === undefined ? '' : r.pct).padStart(7)}%  ${r.key}${textStat(r)}`);
  }
  if (pick('missing').length) {
    lines.push('Не снято:');
    for (const r of pick('missing')) lines.push(`  ${r.key}${r.reason ? '  ' + r.reason : ''}`);
  }
  if (pick('noise').length) {
    lines.push('В пределах шума:');
    for (const r of pick('noise')) lines.push(`  ${String(r.pct).padStart(7)}%  (шум ${r.noise.pct}%)  ${r.key}`);
  }
  const c = s.counts;
  const extra = [['new', 'новых'], ['nobefore', 'нет «до»'], ['skipped', 'не снимали']].filter(([k]) => c[k]).map(([k, t]) => `, ${t} ${c[k]}`).join('');
  lines.push(`Итого: совпадает ${c.same}, в пределах шума ${c.noise}, отличается ${c.diff}, не снято ${c.missing}${extra} (из ${s.rows.length})`);
  if (s.noiseHint) lines.push(`Шум не измерен: node visual.js check ${s.before}`);
  return lines;
}

// Картинки — относительно папки сравнения <папка снимков>/compare-<до>-vs-<после>/.
function buildHtml(s) {
  const img = (label, key) => `../${encodeURI(label)}/${encodeURI(key)}.png`;
  const fig = (src, cap) => `<figure><figcaption>${cap}</figcaption><img loading="lazy" src="${esc(src)}" alt="${cap}"></figure>`;
  const li = (arr, cls) => arr.map((l) => `<li${cls ? ` class="${cls}"` : ''}>${esc(l)}</li>`).join('');
  const detail = (r) => {
    const ch = r.changes && r.changes.length ? `<ul>${r.changes.map((c) => `<li${c.noise ? ' class="nz"' : ''}>${esc(c.text)}</li>`).join('')}</ul>` : '';
    const t = r.text && (r.text.removed.length || r.text.added.length || (r.text.noiseRemoved || []).length || (r.text.noiseAdded || []).length)
      ? `<p><b>Пропало:</b></p><ul>${li(r.text.removed)}${li(r.text.noiseRemoved || [], 'nz')}</ul><p><b>Появилось:</b></p><ul>${li(r.text.added)}${li(r.text.noiseAdded || [], 'nz')}</ul>`
      : '';
    let imgs = '';
    if (['diff', 'noise'].includes(r.verdict)) imgs = fig(img(s.before, r.key), 'до') + fig(img(s.after, r.key), 'после') + fig(`${encodeURI(r.key)}.png`, 'дифф');
    else if (r.verdict === 'missing') imgs = fig(img(s.before, r.key), 'до');
    else if (['new', 'nobefore'].includes(r.verdict)) imgs = fig(img(s.after, r.key), 'после');
    const head = `${esc(r.key)} — ${VERDICTS[r.verdict]}${r.pct !== undefined ? `, ${r.pct}%` : ''}${r.reason ? ` — ${esc(r.reason)}` : ''}`;
    return `<details id="${esc(r.key)}"${r.verdict === 'diff' ? ' open' : ''}><summary>${head}</summary>${ch}${t}<div class="imgs">${imgs}</div></details>`;
  };
  const withDetail = (r) => ['diff', 'noise', 'missing', 'new', 'nobefore'].includes(r.verdict);
  const metaRows = s.rows.filter((r) => r.changes && r.changes.length);
  const c = s.counts;
  return `<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>Сравнение ${esc(s.before)} → ${esc(s.after)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top;text-align:left}
tr.diff,tr.missing{background:#fee}tr.noise{background:#ffd}.nz{color:#999}.imgs{display:flex;gap:8px}figure{margin:0}.imgs img{width:32vw;border:1px solid #999}details{margin:6px 0}</style>
<h1>Сравнение «${esc(s.before)}» → «${esc(s.after)}»</h1>
<p>${esc(s.base || '')} · до: ${esc(s.dateBefore || '—')} · после: ${esc(s.dateAfter || '—')}</p>
<p>Итого: совпадает ${c.same}, в пределах шума ${c.noise}, отличается ${c.diff}, не снято ${c.missing}, новых ${c.new}, нет «до» ${c.nobefore}, не снимали ${c.skipped}.</p>
${s.noiseHint ? `<p>Шум не измерен: <code>node visual.js check ${esc(s.before)}</code></p>` : ''}
<h2>Статусы и ошибки</h2>
${metaRows.length || s.setup.length ? `<table><tr><th>Снимок</th><th>Что изменилось</th></tr>
${s.setup.map((t) => `<tr class="diff"><td>setup</td><td>${esc(t)}</td></tr>`).join('\n')}
${metaRows.map((r) => `<tr><td><a href="#${esc(r.key)}">${esc(r.key)}</a></td><td>${r.changes.map((ch) => `<span${ch.noise ? ' class="nz"' : ''}>${esc(ch.text)}</span>`).join('<br>')}</td></tr>`).join('\n')}
</table>` : '<p>Без изменений.</p>'}
<h2>Снимки</h2>
<table><tr><th>Снимок</th><th>Вердикт</th><th>% пикселей (шум)</th><th>Размер</th><th>Текст: пропало / появилось</th></tr>
${s.rows.map((r) => `<tr class="${r.verdict}"><td>${withDetail(r) ? `<a href="#${esc(r.key)}">${esc(r.key)}</a>` : esc(r.key)}</td><td>${VERDICTS[r.verdict]}</td><td>${r.pct === undefined ? '' : r.pct + (r.noise ? ` (${r.noise.pct})` : '')}</td><td>${esc(r.size || '')}</td><td>${r.text ? `${r.text.removed.length} / ${r.text.added.length}` : ''}</td></tr>`).join('\n')}
</table>
${s.rows.filter(withDetail).map(detail).join('\n')}
</html>
`;
}

module.exports = { VERDICTS, esc, buildSummary, consoleLines, buildHtml };
