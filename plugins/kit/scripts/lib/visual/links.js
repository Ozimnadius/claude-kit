'use strict';
// Ссылки для discover и проверка адресов: опасные (меняют данные или сессию), файлы, группы похожих ссылок.

// Проверяется путь с query, без учёта регистра. Порядок важен: причина — первое совпадение.
const DANGER = [
  [/logout/i, 'выход — сессия пропадёт'],
  [/\/cancel\/|[?&]cancel=y/i, 'отмена заказа'],
  [/copy_order=/i, 'повтор заказа'],
  [/[?&]action=/i, 'действие через GET (корзина, сравнение, удаление)'],
  [/[?&](del|delete|remove)(_[a-z0-9]+)?=|\/(delete|remove)\//i, 'удаление'],
  [/sessid=/i, 'ссылка с sessid — что-то меняет'],
  [/unsubscribe/i, 'отписка'],
  [/clear_cache/i, 'сброс кеша'],
  [/^\/bitrix\//i, 'служебное (/bitrix/)'],
];
const FILE_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|svg|mp4|webm|mp3|csv|xml|txt)$/i;
const TRACKING_RE = /^(utm_.*|yclid|gclid|fbclid)$/i;

// Причина, по которой адрес опасно открывать, или null; extra — RegExp из «danger» в pages.json.
function dangerReason(url, extra = []) {
  for (const [re, why] of DANGER) if (re.test(url)) return why;
  for (const re of extra) if (re.test(url)) return `опасно по pages.json (${re.source})`;
  return null;
}

function isFile(url) {
  return FILE_RE.test(String(url).split('?')[0]);
}

// Ссылка своего сайта → путь от корня сайта с query (без #, без меток рекламы); чужая или не http(s) → null.
// Значение sessid (токен сессии администратора) заменяется на *** — в вывод и links.json не пишется; опасность по sessid= остаётся.
function cleanLink(href, base) {
  let u;
  try {
    u = new URL(href, base + '/');
  } catch (e) {
    return null;
  }
  const b = new URL(base);
  if (!/^https?:$/.test(u.protocol) || u.host !== b.host) return null;
  const prefix = b.pathname.replace(/\/+$/, '');
  if (prefix && u.pathname !== prefix && !u.pathname.startsWith(prefix + '/')) return null;
  let search = u.search;
  if ([...u.searchParams.keys()].some((k) => TRACKING_RE.test(k))) {
    for (const k of [...u.searchParams.keys()]) if (TRACKING_RE.test(k)) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    search = q ? '?' + q : '';
  }
  search = search.replace(/([?&]sessid=)[^&]*/gi, '$1***');
  return (u.pathname.slice(prefix.length) || '/') + search;
}

// Шаблон группы: сегменты из цифр → {n}, у query — только имена параметров.
function linkPattern(url) {
  const [p, q] = String(url).split('?');
  const segs = p.split('/').map((s) => (/^\d+$/.test(s) ? '{n}' : s)).join('/');
  if (!q) return segs;
  const names = [...new Set(q.split('&').map((kv) => kv.split('=')[0]).filter(Boolean))].sort();
  return segs + '?' + names.join('&');
}

// pages: [{ seed, hrefs }] → [{ url, pattern, from, danger?, file? }], без повторов, по алфавиту.
function collectLinks(pages, base, extra = []) {
  const map = new Map();
  for (const { seed, hrefs } of pages) {
    for (const h of hrefs || []) {
      const url = cleanLink(h, base);
      if (!url) continue;
      let rec = map.get(url);
      if (!rec) {
        rec = { url, pattern: linkPattern(url), from: [] };
        const d = dangerReason(url, extra);
        if (d) rec.danger = d;
        else if (isFile(url)) rec.file = true;
        map.set(url, rec);
      }
      if (!rec.from.includes(seed)) rec.from.push(seed);
    }
  }
  return [...map.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

// Группы страниц (без опасных и файлов): [{ pattern, count, example }].
function groupLinks(links) {
  const groups = new Map();
  for (const l of links) {
    if (l.danger || l.file) continue;
    const g = groups.get(l.pattern);
    if (g) g.count++;
    else groups.set(l.pattern, { pattern: l.pattern, count: 1, example: l.url });
  }
  return [...groups.values()].sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
}

module.exports = { DANGER, dangerReason, isFile, cleanLink, linkPattern, collectLinks, groupLinks };
