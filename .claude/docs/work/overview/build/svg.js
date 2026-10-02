'use strict';
// Мини-библиотека для ручных схем обзора: блоки, ромбы, стрелки, подписи.
// На странице цвета приходят классами из её CSS; отдельный SVG-файл (для Markdown на GitHub) несёт свой <style>.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LH = { t: 17, s: 15, m: 15, tm: 17, ag: 15 };
const CW = { t: 7.4, s: 6.5, m: 6.9, lbl: 6.3, tm: 7.6, ag: 7.0 };
const warnings = [];

// Цвета и классы схем — общие для страницы (CSS страницы) и отдельных SVG-файлов.
const LIGHT = '--bg:#F1F3F4;--surface:#FFFFFF;--ink:#15191E;--muted:#58616C;--rule:#DDE1E5;--rule-strong:#B6BEC7;--edge:#6A737F;'
  + '--hook:#B0590C;--hook-bg:#FDF1E3;--skill:#2552CC;--skill-bg:#EBF0FD;--skill-ink:#1C44B0;'
  + '--agent:#0A7769;--agent-bg:#E2F3EF;--user:#BE2A50;--user-bg:#FCECF0;--code-bg:#ECEFF2';
const DARK = '--bg:#0F1215;--surface:#161A1F;--ink:#E5E8EC;--muted:#99A3AE;--rule:#272D34;--rule-strong:#3B434C;--edge:#8993A0;'
  + '--hook:#EE9C4C;--hook-bg:#2A1F14;--skill:#86A8FF;--skill-bg:#17213A;--skill-ink:#AAC2FF;'
  + '--agent:#4FC8B6;--agent-bg:#122724;--user:#FF7D98;--user-bg:#2D1820;--code-bg:#1E2329';

const DIAGRAM_CSS = `
.dg text{fill:currentColor}
.dg .t{font-weight:600;font-size:13.5px}
.dg .s{fill:var(--muted);font-size:12px}
.dg .m{font-family:var(--f-mono);font-size:11.5px}
.dg .tm{font-family:var(--f-mono);font-size:12.5px;font-weight:600}
.dg .ag{font-family:var(--f-mono);font-size:11.5px;font-weight:600;fill:var(--agent)}
.dg .loop{fill:var(--muted);font-size:12.5px;font-style:italic}
.dg .cap{fill:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase}
.dg .box{fill:var(--surface);stroke:var(--rule-strong);stroke-width:1.2}
.dg .k-core .box{stroke:var(--ink);stroke-width:1.8}
.dg .k-hook .box{fill:var(--hook-bg);stroke:var(--hook)}
.dg .k-skill .box{fill:var(--skill-bg);stroke:var(--skill)}
.dg .k-skill .tm{fill:var(--skill-ink)}
.dg .k-agent .box{fill:var(--agent-bg);stroke:var(--agent)}
.dg .k-agent .tm{fill:var(--agent)}
.dg .k-user .box{fill:var(--user-bg);stroke:var(--user)}
.dg .k-user .t,.dg .k-user .tm{fill:var(--user)}
.dg .k-ext .box{fill:none;stroke:var(--muted);stroke-dasharray:5 4}
.dg .k-note .box{fill:var(--bg);stroke:var(--rule-strong)}
.dg .e{fill:none;stroke:var(--edge);stroke-width:1.4}
.dg .e.d{stroke-dasharray:5 4}
.dg .e.u{stroke:var(--user)}
.dg .ah{fill:var(--edge)}
.dg .ah.u{fill:var(--user)}
.dg .life{stroke:var(--rule-strong);stroke-width:1.2;stroke-dasharray:3 4}
.dg .lbl{font-size:11.5px;fill:var(--muted);paint-order:stroke;stroke:var(--surface);stroke-width:5px;stroke-linejoin:round}
.dg .lbl.u{fill:var(--user);font-weight:600}
`;

// Отдельный файл: свои шрифты-запасные (в <img> веб-шрифты не грузятся), фон-карточка, тёмная тема по настройке системы.
const STANDALONE_CSS = `svg.dg{${LIGHT};--f-body:'Golos Text','Segoe UI',system-ui,-apple-system,Roboto,sans-serif;`
  + `--f-mono:'JetBrains Mono','Cascadia Mono',Consolas,'Liberation Mono',monospace;font-family:var(--f-body);font-size:13px;color:var(--ink)}`
  + `@media (prefers-color-scheme: dark){svg.dg{${DARK}}}`
  + '.dg .bgc{fill:var(--surface);stroke:var(--rule)}' + DIAGRAM_CSS.replace(/\n/g, '');

function est(cls, text) {
  return String(text).length * (CW[cls] || 6.8);
}

function textLines(L, { x, y, w, h, a = 'c', v = 'c', pad = 12, id }) {
  const H = L.reduce((n, [c]) => n + LH[c], 0);
  let cur = v === 'c' ? y + (h - H) / 2 : y + pad - 2;
  const tx = a === 'c' ? x + w / 2 : x + pad;
  const anchor = a === 'c' ? 'middle' : 'start';
  let out = '';
  for (const [c, t] of L) {
    const base = cur + LH[c] * 0.74;
    const wmax = w - (a === 'c' ? 12 : pad * 2);
    if (est(c, t) > wmax) warnings.push(`${id}: «${t}» ~${Math.round(est(c, t))} > ${wmax}`);
    out += `<text class="${c}" x="${tx}" y="${base.toFixed(1)}" text-anchor="${anchor}">${esc(t)}</text>`;
    cur += LH[c];
  }
  return out;
}

function makeDiagram(id, W, H, label) {
  const parts = [];
  const api = {
    id,
    alt: label,
    box(o) {
      const { x, y, w, h, k = '', L = [], a, v, rx = 8 } = o;
      parts.push(`<g class="n ${k ? 'k-' + k : ''}"><rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`
        + textLines(L, { x, y, w, h, a, v, id }) + '</g>');
    },
    diamond(o) {
      const { cx, cy, w, h, k = '', L = [] } = o;
      const pts = `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
      parts.push(`<g class="n ${k ? 'k-' + k : ''}"><polygon class="box" points="${pts}"/>`
        + textLines(L, { x: cx - w / 2, y: cy - h / 2, w, h, id }) + '</g>');
    },
    edge(pts, o = {}) {
      const { c = '', lbl, lx, ly, la = 'middle', lc = '', head = true } = o;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
      const mk = head ? ` marker-end="url(#${id}-${c.includes('u') ? 'u' : 'a'})"` : '';
      parts.push(`<path class="e ${c}" d="${d}"${mk}/>`);
      if (lbl) api.label(lx, ly, lbl, la, lc || (c.includes('u') ? 'u' : ''));
    },
    label(x, y, t, la = 'middle', lc = '') {
      parts.push(`<text class="lbl ${lc}" x="${x}" y="${y}" text-anchor="${la}">${esc(t)}</text>`);
    },
    text(x, y, t, cls = 's', la = 'start') {
      parts.push(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${la}">${esc(t)}</text>`);
    },
    line(x1, y1, x2, y2, cls = 'life') {
      parts.push(`<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    },
    // standalone — отдельный SVG-файл: размеры, свой стиль и фон; иначе — для вставки в страницу.
    render({ standalone = false } = {}) {
      const defs = ['a', 'u'].map((m) => `<marker id="${id}-${m}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah ${m === 'u' ? 'u' : ''}" d="M0,0 L10,5 L0,10 z"/></marker>`).join('');
      if (!standalone) {
        return `<svg class="dg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${parts.join('')}</svg>`;
      }
      const P = 16;
      return `<svg class="dg" xmlns="http://www.w3.org/2000/svg" width="${W + 2 * P}" height="${H + 2 * P}" viewBox="${-P} ${-P} ${W + 2 * P} ${H + 2 * P}" role="img" aria-label="${esc(label)}">`
        + `<title>${esc(label)}</title><style>${STANDALONE_CSS}</style><defs>${defs}</defs>`
        + `<rect class="bgc" x="${-P + 0.5}" y="${-P + 0.5}" width="${W + 2 * P - 1}" height="${H + 2 * P - 1}" rx="10"/>`
        + parts.join('') + '</svg>\n';
    },
  };
  return api;
}

module.exports = { makeDiagram, warnings, esc, LIGHT, DARK, DIAGRAM_CSS };
