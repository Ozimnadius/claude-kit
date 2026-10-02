#!/usr/bin/env node
'use strict';
// Проверка снаружи: служебные папки закрыты от веба — 403 на каждый файл и на саму папку (401 — сайт под паролем, тоже закрыт).
// На сервер уезжает содержимое папки (не git), поэтому обходим диск; исключения — .git, .idea, .claude/worktrees
// (git worktree Claude Code — копия всего проекта), .claude/skills (скиллы Битрикса из открытых репозиториев GitHub —
// сотни файлов без секретов), папки снимков visual (сотни картинок; на сервер их не пускает защита выкладки visual.js)
// и «Не выкладывать». Папка, которая сама (или через предка) в «Не выкладывать», всё равно
// проверяется: на сервере могли остаться её старые копии (с 2.3.0 в «Не выкладывать» — .claude целиком).
// Запуск в корне проекта: node check-closed.js <url> [--dirs a,b]; по умолчанию — docs, .claude и папка журнала вне .claude.
const fs = require('fs');
const path = require('path');
const { kitInfo, docsInClaude } = require('./lib/project');
const { parseRules, matchRules } = require('./lib/paths');

const TIMEOUT = Number(process.env.KIT_HTTP_TIMEOUT_MS) || 15000;
// Запросы независимы, но по умолчанию идут по одному: на Windows с Node 24 при нескольких одновременных соединениях процесс
// изредка аварийно завершается с кодом 3221226505 (0xC0000409), в том числе и на чистом http без fetch. Стенд из 12
// одновременных запусков: при одном запросе 0 из 920, при двух 0–3 из 1000, при четырёх и восьми 2–6 из 800; в полном наборе
// тестов при восьми падали 3 прогона из 4, при двух — 1 из 9. KIT_HTTP_CONCURRENCY=N — параллельно, если у машины сбоя нет
// (при сотнях файлов в docs или .claude проверка идёт в разы быстрее).
const CONCURRENCY = Math.max(1, Number(process.env.KIT_HTTP_CONCURRENCY) || 1);
const ALWAYS_SKIP = ['.git', '.idea', '.claude/worktrees', '.claude/skills', 'docs/visual', '.claude/docs/visual'];
const CLOSED = new Set(['закрыт', 'закрыт (авторизация)', 'нет на сервере']);

// Расширения, которые nginx часто отдаёт сам, мимо .htaccess (epsilon, 2026-09-22).
const NGINX_STATIC = ['bmp', 'css', 'doc', 'docx', 'eot', 'gif', 'gz', 'ico', 'jpeg', 'jpg', 'js', 'mp3', 'mp4', 'otf',
  'pdf', 'png', 'ppt', 'pptx', 'rar', 'svg', 'tar', 'tif', 'ttf', 'txt', 'webm', 'webp', 'woff', 'woff2', 'xls', 'xlsx', 'zip'];

function walk(root, rel, rules, out) {
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const r = rel + '/' + name;
    if (matchRules(r, rules)) continue;
    if (fs.statSync(path.join(root, r)).isDirectory()) walk(root, r, rules, out);
    else out.push(r);
  }
  return out;
}

// fn для каждого элемента, не больше limit одновременно; результаты — в порядке элементов.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function urlFor(base, rel) {
  return base.replace(/\/+$/, '') + '/' + rel.split('/').map(encodeURIComponent).join('/');
}

async function status(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'kit-check-closed' }, signal: AbortSignal.timeout(TIMEOUT) });
    try {
      await res.body?.cancel();
    } catch (e) {
      // тело не нужно
    }
    return { code: res.status, finalUrl: res.url, redirected: res.redirected };
  } catch (e) {
    return { code: 0, finalUrl: null, redirected: false };
  }
}

// Декодированный путь URL (кириллица в именах файлов) или null, если URL не разобрать.
function pathnameOf(u) {
  try {
    return decodeURIComponent(new URL(u).pathname);
  } catch (e) {
    return null;
  }
}

// requestedUrl — что запрашивали, r — результат status(). Настоящий редирект (другой путь,
// не просто смена схемы/хоста) — отдельный вердикт, а не «ОТКРЫТ» по коду финальной страницы.
function verdict(requestedUrl, r) {
  const { code, finalUrl, redirected } = r;
  if (redirected && finalUrl) {
    const from = pathnameOf(requestedUrl);
    const to = pathnameOf(finalUrl);
    if (from !== null && to !== null && from !== to) return 'редирект';
  }
  if (code === 403) return 'закрыт';
  if (code === 401) return 'закрыт (авторизация)';
  if (code === 404) return 'нет на сервере';
  if (code >= 200 && code < 300) return 'ОТКРЫТ';
  if (code === 0) return 'нет ответа';
  return 'код ' + code;
}

async function main(argv) {
  const base = argv[0];
  if (!base || base.startsWith('--')) {
    console.error('Использование: node check-closed.js <url> [--dirs a,b]');
    return 1;
  }
  const di = argv.indexOf('--dirs');
  const cwd = process.cwd();
  const info = kitInfo(cwd);
  const own = info.docsRel !== '.' && !docsInClaude(info.docsRel) && info.docsRel !== 'docs' ? [info.docsRel] : [];
  const dirs = di >= 0 && argv[di + 1] ? argv[di + 1].split(',').map((s) => s.trim()).filter(Boolean) : ['docs', '.claude', ...own];
  const skip = parseRules([...ALWAYS_SKIP, '/' + info.visualRel]);
  const deploy = info.params.list('Не выкладывать');
  const targets = [];
  for (const d of dirs) {
    if (matchRules(d, skip) || !fs.existsSync(path.join(cwd, d))) continue;
    // Правила «Не выкладывать», закрывающие саму папку или её предка, для неё не действуют — остальные действуют.
    const rules = parseRules([...ALWAYS_SKIP, '/' + info.visualRel, ...deploy.filter((it) => !matchRules(d, parseRules([it])))]);
    targets.push({ rel: d + '/', url: urlFor(base, d) + '/' });
    for (const f of walk(cwd, d, rules, [])) targets.push({ rel: f, url: urlFor(base, f) });
  }
  let open = 0;
  let bad = 0;
  const lines = [];
  const results = await mapLimit(targets, CONCURRENCY, (t) => status(t.url));
  for (const [i, t] of targets.entries()) {
    const r = results[i];
    const v = verdict(t.url, r);
    if (v === 'ОТКРЫТ') open++;
    if (!CLOSED.has(v)) bad++;
    let note = '';
    if (v === 'ОТКРЫТ') {
      const ext = (t.rel.split('.').pop() || '').toLowerCase();
      note = NGINX_STATIC.includes(ext)
        ? ' — nginx отдаёт .' + ext + ' мимо .htaccess: переименовать в .' + ext + '.php или убрать из выкладки'
        : ' — .htaccess не действует: проверить, дошёл ли он до сервера';
    } else if (v === 'редирект') {
      note = ' → ' + r.finalUrl;
    }
    lines.push(String(r.code || '—').padEnd(4) + ' ' + v.padEnd(21) + t.rel + note);
  }
  console.log(lines.join('\n'));
  console.log('\nИтого: ' + targets.length + ', закрыто/нет: ' + (targets.length - bad) + ', ОТКРЫТО: ' + open + ', прочее: ' + (bad - open));
  return bad ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
module.exports = { verdict, urlFor };
