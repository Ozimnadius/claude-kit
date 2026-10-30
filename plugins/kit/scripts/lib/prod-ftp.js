'use strict';
// Синхронизация с продом без SSH (этап 48, шаг 48.8; Т-9): адрес сервера задан («Прод» / «Дев»), «SSH <окружение>» пуст.
// До скачивания — правки в рабочей копии (скачивание их затрёт, Р-60) и корни для скачивания по FTP в PhpStorm (ftpRoots: то,
// что сверяет Т-4, без исключённого .gitignore и «Не выкладывать», Р-69, и без локального игнорируемого на диске, Р-71); после
// скачивания (prod-sync.js --ftp-done) «сервер» —
// файлы сайта на диске: версии — база (baseTree), HEAD и скачанное, правила — те же, что по SSH (classify, Т-5). Разбор не
// удаляет файлов, которых нет в HEAD (Р-68), и не идёт при автозаливке PhpStorm Always (Р-70): возврат из HEAD она залила бы на
// сервер. Здесь — корни, правки, строки для пользователя, разбор скачанного, секреты и совмещение в памяти; запись, коммит и
// отметка — prod-sync.js. Удалённые на сервере файлы и новые вне скачанных папок по FTP не видны. Что вне синхронизации
// (служебные файлы git, исключённое в PhpStorm, «Не выкладывать») — syncRules из lib/prod.js, как по SSH (Р-83).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { matchRules } = require('./paths');
const { ALWAYS_SKIP, isSsh, git } = require('./deploy');
const {
  REGULAR, SKIP, md5NoCr, classify, treeOf, baseTree, pendingDelete, pendingEntry, ignoredOf, dirtyPaths, readWork, mergeVersions,
  catBlobs, blobHashes, clean, secretPaths, syncRules, deploymentOf,
} = require('./prod');

// строк в списке правок (Р-60), дальше — «и ещё N»; корни выводятся все (Р-73): каждый скачивают вручную, иначе изменения на
// сервере в нескачанных пропали бы молча
const LIMIT = 30;
const PROBE = 'kit-probe'; // пробное имя в каталоге: исключает ли .gitignore или skipRules его обычное содержимое (Р-69)
// Последняя строка вывода — что спросить у пользователя (Р-60, Р-70).
const DOWNLOADED = 'спроси пользователя: Скачал (`prod-sync.js --ftp-done`) / Не буду скачивать';
const DIRTY_OK = 'спроси пользователя: Скачаю всё равно (`prod-sync.js --dirty-ok`) / ' + SKIP;
const ALWAYS_OFF = 'на время синхронизации выключи автозаливку PhpStorm (Tools → Deployment → Automatic Upload): иначе возврат файлов из ' +
  'HEAD уйдёт на сервер';
// Остановка при автозаливке PhpStorm Always до любой записи (Р-70, Р-84) — для разбора скачанного, повтора по SSH и отмены:
// why — чем грозит запуск (пусто — не сказано), cmd — запуск для повтора после ответа «Выключил».
const alwaysStop = (cmd, why = '') => ['автозаливка PhpStorm включена — ' + (why ? why + '; ' : '') + 'выключи её (Tools → Deployment → ' +
  'Automatic Upload; PhpStorm записывает настройку не сразу — File → Save All) и повтори', 'спроси пользователя: Выключил — повторить (`' +
  cmd + '`) / ' + SKIP];
const ALWAYS_STOP = alwaysStop('prod-sync.js --ftp-done');

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const lines = (items) => items.map((p) => '  ' + clean(p));
const upTo = (items) => [...lines(items.slice(0, LIMIT)), ...(items.length > LIMIT ? ['  и ещё ' + (items.length - LIMIT)] : [])];
// Автозаливка PhpStorm Always (.idea/deployment.xml; нет или не разобран — нет): разбор скачанного, повтор с откатом и отмена не
// идут (Р-70, Р-84).
const autoUpload = (dir) => deploymentOf(dir).always;

// Начало правила skipRules со слешем (путь от корня проекта) до первой маски — нижним регистром; правило-имя без слеша и маска с
// самого начала — null: лежать может где угодно (под ним разбор ничего не трогает, Р-72).
function rulePrefix(item) {
  const token = String(item).replace(/\s*\(\s*кроме\s+.*\)\s*$/i, '').trim().replace(/\\/g, '/');
  if (!token.includes('/')) return null;
  const t = token.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const g = t.search(/[*?]/);
  const cut = g < 0 ? t.length : t.lastIndexOf('/', g);
  return cut > 0 ? t.slice(0, cut).toLowerCase() : null;
}

// Каталоги, в которых на диске лежит локальное игнорируемое .gitignore (Р-71): одним вызовом git ls-files --others --ignored
// (--directory — целиком игнорируемая папка одной записью «папка/», внутрь git не ходит). Файл «a/b/c» даёт a и a/b, папка
// «a/b/» — a и a/b. → Set каталогов.
function ignoredDirs(dir) {
  const r = git(dir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory', '-z']);
  if (!r.ok) throw new Error('git ls-files --ignored: ' + r.err);
  const out = new Set();
  for (const e of r.out.split('\0').filter(Boolean)) {
    const segs = e.replace(/\/+$/, '').split('/');
    for (let i = 1; i < segs.length; i++) out.add(segs.slice(0, i).join('/'));
    if (e.endsWith('/')) out.add(segs.join('/'));
  }
  return out;
}

// Корни для скачивания по FTP (Т-4, Т-9, Р-69, Р-71) — по файлам сайта в git (индекс, обычные файлы, не под syncRules: и не
// служебные файлы git, и не исключённое в PhpStorm, Р-83, кроме «Claude по SSH», Р-88), от первой части пути вниз. Каталог D — корень целиком, если в нём нет
// исключённого: пробный D/kit-probe не исключают ни .gitignore (git check-ignore --no-index), ни syncRules, ни одно правило
// skipRules со слешем и ни один путь Excluded Paths PhpStorm не лежит в D, и на диске в D нет локального игнорируемого
// (скачивание «с заменой» затёрло бы, например, local/php_interface/dbconn.php). Иначе D дробится на файлы сайта прямо в нём и
// дочерние каталоги с файлами сайта — рекурсивно (отслеживаемый файл под целиком исключённой папкой — сам корень; игнорируемое в
// корни не попадает). Каталог — с «/» на конце. → [корень] по алфавиту.
function ftpRoots(dir, info) {
  const rules = syncRules(dir, info);
  // Excluded Paths — вне синхронизации, кроме «Claude по SSH» (Р-88: там они — файлы сайта)
  const inside = [...[...ALWAYS_SKIP, ...info.params.list('Не выкладывать')].map(rulePrefix),
    ...(isSsh(info) ? [] : deploymentOf(dir).excluded.map((p) => p.toLowerCase()))].filter(Boolean);
  const local = ignoredDirs(dir);
  const r = git(dir, ['ls-files', '-s', '-z']);
  if (!r.ok) throw new Error('git ls-files: ' + r.err);
  const files = new Set();
  for (const rec of r.out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0 || !REGULAR.has(rec.slice(0, rec.indexOf(' ')))) continue;
    const p = rec.slice(tab + 1);
    if (!matchRules(p, rules)) files.add(p);
  }
  const roots = [];
  let level = new Map(); // каталог → файлы сайта под ним
  const place = (d, paths) => { // файлы прямо в d — корни, остальное — по дочерним каталогам
    for (const p of paths) {
      const i = p.indexOf('/', d ? d.length + 1 : 0);
      if (i < 0) roots.push(p);
      else {
        const sub = p.slice(0, i);
        if (!level.has(sub)) level.set(sub, []);
        level.get(sub).push(p);
      }
    }
  };
  place('', files);
  while (level.size) {
    const cur = level;
    level = new Map();
    const probe = (d) => d + '/' + PROBE;
    const ignored = ignoredOf(dir, [...cur.keys()].map(probe));
    for (const [d, paths] of cur) {
      const low = d.toLowerCase();
      if (ignored.has(probe(d)) || matchRules(probe(d), rules) || inside.some((x) => x === low || x.startsWith(low + '/')) || local.has(d)) place(d, paths);
      else roots.push(d + '/');
    }
  }
  return roots.sort();
}

// Правки перед скачиванием (Р-60, Р-68, Р-72): изменённые и удалённые отслеживаемые файлы сайта — по содержимому без \r
// (отличие только в \r — не правка); неотслеживаемые файлы сайта (не игнорируемые .gitignore), кроме тех, что разбор не заберёт
// и оставит как есть: есть в базе или ждёт удаления (pendingDelete), не забирается по Т-11 (c.whyNot — читается только
// забираемое по имени и размеру; файл с секретом). Под c.rules (syncRules: «Не выкладывать», .claude…, служебные файлы git, исключённое в PhpStorm) — не
// файлы сайта, не правки. c: { dir, info, b, rules, whyNot, secrets }. → [путь] по алфавиту.
async function ftpDirty(c) {
  const { dir } = c;
  const head = treeOf(dir, 'HEAD');
  const tracked = (p) => head.has(p) && REGULAR.has(head.get(p).mode);
  const paths = [...dirtyPaths(dir)].filter((p) => !matchRules(p, c.rules) && (!head.has(p) || tracked(p)));
  const blobs = await blobHashes(dir, [...new Set(paths.filter(tracked).map((p) => head.get(p).oid))]);
  const base = baseTree(dir, c.b);
  const pend = pendingDelete(dir, c.info);
  const out = [];
  const fresh = [];
  for (const p of paths) {
    if (head.has(p)) {
      const b = readWork(dir, p);
      if ((b === null ? null : md5NoCr(b)) !== blobs.get(head.get(p).oid).noCr) out.push(p);
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(path.join(dir, p));
    } catch (e) {
      continue;
    }
    if (!st.isFile() || base.has(p) || pendingEntry(pend, p) || c.whyNot(p, st.size)) continue;
    const data = readWork(dir, p);
    if (data !== null) fresh.push({ path: p, data });
  }
  const bad = await secretPaths(c, { headOid: () => null }, fresh);
  return [...out, ...fresh.map((f) => f.path).filter((p) => !bad.has(p))].sort();
}

// Строки до скачивания (Р-60, М-2, Р-70, Р-73): правки — до 30, что будет с ними и вопрос; корни — все, по одному в строке,
// подсказка PhpStorm (сервер автозаливки по умолчанию из .idea/deployment.xml), при Always — выключить автозаливку, и вопрос.
// Ничего не пишут.
function dirtyLines(paths) {
  return [`В рабочей копии незакоммиченные правки файлов сайта (${paths.length}):`, ...upTo(paths),
    'скачивание затрёт незакоммиченные правки, а правки файлов, которые скачивание не перезапишет, уйдут в коммит синхронизации как ' +
    'изменения сервера', DIRTY_OK];
}

function rootLines(dir, roots) {
  const d = deploymentOf(dir);
  const from = d.server ? 'Download from ' + clean(d.server) : 'Download from… — с сервера автозаливки';
  return [`Скачай с сервера по FTP — в папку проекта, с заменой файлов (${roots.length}):`, ...lines(roots),
    `В PhpStorm: выдели эти папки и файлы в дереве проекта → Tools → Deployment → ${from}. Удалённые на сервере файлы и новые вне ` +
    'перечисленных папок так не видны.', ...(d.always ? [ALWAYS_OFF] : []), DOWNLOADED];
}

// Разбор скачанного (Т-9 по правилам Т-5): «сервер» — файл сайта на диске. Кандидаты — пути git status: файл, который git
// считает неизменённым, равен индексу, а индекс перед скачиванием — HEAD (Р-60), то есть «сервер = HEAD» — по Т-5 ничего. Нет
// на диске — ничего (удалённое на сервере по FTP не видно); игнорируемое .gitignore git status не даёт; под c.rules
// (syncRules: «Не выкладывать», .claude…, служебные файлы git, исключённое в PhpStorm) — не файлы сайта: не разбирается, не
// трогается и не называется (Р-72, Р-83). Чего нет в HEAD, разбор не
// удаляет (Р-68): ждущее удаления и путь базы — лежит, называется каждый раз; новое, что не забирается, — лежит, называется
// один раз. c: { dir, info, b, rules, whyNot(путь, размер) → причина | null }; skip — пути, которые в этот раз не разбираются
// (Р-61: изменены после остановки). → { take: [{ path, kind: changed | added, size }] — в коммит синхронизации, merge: [{ path,
// kind, size }] — совместить, undo: Set путей к HEAD (все — в HEAD): не забирается, вернулось к базе, отличие от HEAD только в
// \r, reverted: [путь] — скачанное вернуло к базе наше незалитое (Т-9), once: [{ path, why, local? }] — не
// забирается (называется один раз; local — новое, лежит в рабочей копии), waiting: [запись] — ждёт удаления с сервера (Р-63),
// baseOid(путь), headOid(путь) — blob или null }.
async function ftpSurvey(c, skip = new Set()) {
  const { dir } = c;
  const site = (p) => !matchRules(p, c.rules);
  const head = treeOf(dir, 'HEAD');
  const base = baseTree(dir, c.b);
  const filesOf = (tree) => new Map([...tree].filter(([p, e]) => REGULAR.has(e.mode) && site(p)).map(([p, e]) => [p, e.oid]));
  const headF = filesOf(head);
  const baseF = filesOf(base);
  const odd = (tree, files, p) => tree.has(p) && !files.has(p); // ссылка или подмодуль в git — вне сверки
  const status = [...dirtyPaths(dir)].filter((p) => !skip.has(p)).sort();
  const cands = status.filter((p) => site(p) && !odd(head, headF, p) && !odd(base, baseF, p));
  const blobs = await blobHashes(dir, [...new Set(cands.flatMap((p) => [headF.get(p), baseF.get(p)]).filter(Boolean))]);
  const ver = (oid) => (oid ? blobs.get(oid).noCr : null);
  const pend = pendingDelete(dir, c.info);
  const take = [];
  const merge = [];
  const undo = new Set();
  const reverted = [];
  const once = [];
  const waiting = new Set();
  const eol = (p, buf, oid) => { // = HEAD без \r: переводы строк — из HEAD молча
    if (md5(buf) !== blobs.get(oid).raw) undo.add(p);
  };
  for (const p of cands) {
    let st;
    try {
      st = fs.lstatSync(path.join(dir, p));
    } catch (e) {
      continue; // нет на диске
    }
    if (!st.isFile()) continue;
    const h = headF.get(p);
    if (!h) { // Р-68: нет в HEAD — не удаляется
      const w = pendingEntry(pend, p) || (baseF.has(p) ? p : null); // удалён нашим шагом или в «Удалить с сервера» (Р-63)
      const why = w ? null : c.whyNot(p, st.size);
      if (w) waiting.add(w);
      else if (why) once.push({ path: p, why, local: true });
      else take.push({ path: p, kind: 'added', size: st.size });
      continue;
    }
    const buf = readWork(dir, p);
    if (buf === null) continue;
    const bo = baseF.get(p);
    const k = classify({ base: ver(bo), head: ver(h), server: md5NoCr(buf) });
    if (k === 'same' && ver(h) !== ver(bo)) { // скачивание вернуло к базе наше незалитое — из HEAD
      reverted.push(p);
      undo.add(p);
      continue;
    }
    if (k === 'same' || k === 'ours') {
      eol(p, buf, h);
      continue;
    }
    const why = c.whyNot(p, st.size);
    if (why) {
      once.push({ path: p, why });
      undo.add(p);
    } else (k === 'take' ? take : merge).push({ path: p, kind: k === 'take' ? 'changed' : 'merge', size: st.size });
  }
  return {
    take, merge, undo, reverted, once, waiting: [...waiting].sort(), baseOid: (p) => baseF.get(p) || null, headOid: (p) => headF.get(p) || null,
  };
}

// Совмещение скачанного в памяти (Т-8, Р-29): наша — HEAD (рабочую копию перезаписало скачивание), база — blob базы, их —
// скачанное (theirs: путь → Buffer). Ничего не пишет. → { merged: [{ path, result, ours }] — ours: скачанное, что сейчас на
// диске (applyMerges в prod-sync.js пишет, только если на диске оно же), conflicts: [{ path, why, ours, theirs, base }] — версии
// (Buffer | null), same: [путь] — совмещённое равно HEAD: к HEAD }.
async function ftpMerges(dir, s, items, theirs) {
  const merged = [];
  const conflicts = [];
  const same = [];
  const blobs = new Map();
  await catBlobs(dir, [...new Set(items.flatMap((it) => [s.headOid(it.path), s.baseOid(it.path)]).filter(Boolean))], (oid, buf) => blobs.set(oid, Buffer.from(buf)));
  const blob = (oid) => (oid ? blobs.get(oid) : null);
  for (const it of items) {
    const ours = blob(s.headOid(it.path));
    const base = blob(s.baseOid(it.path));
    const their = theirs.get(it.path);
    const r = mergeVersions({ ours, base, theirs: their });
    if (r.conflict) conflicts.push({ path: it.path, why: r.conflict, ours, theirs: their, base });
    else if (!r.result || (ours && r.result.equals(ours))) same.push(it.path);
    else merged.push({ path: it.path, result: r.result, ours: their });
  }
  return { merged, conflicts, same };
}

// Что запишет разбор скачанного (Т-11, Т-8), без записи. Файл забора и совмещаемого читается один раз: md5 без \r забора — для
// pending, скачанное совмещаемого — для совмещения; в памяти держится только текст (двоичное secretFindings не проверяет).
// Скачанное с секретом (secretPaths, как по SSH) не забирается и не совмещается: отслеживаемое — к HEAD, новое — лежит (Р-68);
// совмещённое, равное HEAD, и конфликты — к HEAD (s.undo дополняется). c — как у ftpSurvey и ещё secrets; s — ftpSurvey.
// → { take: [{ path, kind, size, md5 }], cands — совмещаемые, mp — ftpMerges, secret: [путь в HEAD], secretLocal: [новый путь],
// gone: [путь] — пропал после разбора }.
async function ftpPlan(c, s) {
  const md5s = new Map();
  const theirs = new Map();
  const texts = [];
  const gone = [];
  for (const it of [...s.take, ...s.merge]) {
    const buf = readWork(c.dir, it.path);
    if (buf === null) {
      gone.push(it.path);
      continue;
    }
    md5s.set(it.path, md5NoCr(buf));
    if (it.kind === 'merge') theirs.set(it.path, buf);
    if (!buf.subarray(0, 8000).includes(0)) texts.push({ path: it.path, data: buf });
  }
  const bad = await secretPaths(c, s, texts);
  texts.length = 0;
  const secret = [...bad].filter((p) => s.headOid(p)).sort();
  for (const p of secret) s.undo.add(p);
  const keep = (it) => md5s.has(it.path) && !bad.has(it.path);
  const cands = s.merge.filter(keep);
  const mp = await ftpMerges(c.dir, s, cands, theirs);
  for (const p of [...mp.same, ...mp.conflicts.map((k) => k.path)]) s.undo.add(p);
  return {
    take: s.take.filter(keep).map((it) => ({ ...it, md5: md5s.get(it.path) })), cands, mp, secret,
    secretLocal: [...bad].filter((p) => !s.headOid(p)).sort(), gone,
  };
}

module.exports = { ftpRoots, ftpDirty, dirtyLines, rootLines, ftpSurvey, ftpMerges, ftpPlan, autoUpload, alwaysStop, ALWAYS_STOP };
