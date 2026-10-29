'use strict';
// Вход с прода (этап 48): правила сверки сервера с git — три версии файла (база, HEAD, сервер), база входа, что не забирать,
// наши доработки, ждущее удаления, совмещение (git merge-file), File Watchers PhpStorm, строка для пользователя и отметка
// входа. Только чистые правила и git; сервер, скачивание и коммит — в prod-entry.js. Отметка — `.claude/kit-prod.json`:
// читается без исключений, пишется атомарно.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { git, isSsh, baseFromPlan, sectionOf } = require('./deploy');
const { getSection, parseTable } = require('./md');
const { writeFilesAtomic } = require('./atomic');

// Заголовок коммита входа: по нему находятся база, «наши доработки» и файлы, не идущие на заливку.
const ENTRY_RE = /^(Прод|Дев): изменения без kit /;
const FILE_LIMIT = 10 * 1024 * 1024; // файл больше — не забирается
const ENTRY_LIMIT = 50 * 1024 * 1024; // за один вход больше — стоп и вопрос
const MARK_FILE = '.claude/kit-prod.json';
const MARK_TTL_MS = 7 * 24 * 3600 * 1000;
const LIST_LIMIT = 10;

function plural(n, one, few, many) {
  const m100 = Math.abs(Math.trunc(n)) % 100;
  const m10 = m100 % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  return m10 >= 2 && m10 <= 4 ? few : many;
}

// «Прод: изменения без kit на 2026-10-29 (3 файла)»; окружение «дев» — «Дев: …».
function entrySubject(env, date, n) {
  return `${env === 'дев' ? 'Дев' : 'Прод'}: изменения без kit на ${date} (${n} ${plural(n, 'файл', 'файла', 'файлов')})`;
}

// md5 содержимого без байтов 0x0D (как `tr -d '\r' | md5sum` на сервере): CRLF и LF — одна версия, двоичные файлы целы.
function md5NoCr(buf) {
  const h = crypto.createHash('md5');
  let from = 0;
  for (;;) {
    const i = buf.indexOf(13, from);
    if (i < 0) {
      h.update(buf.subarray(from));
      break;
    }
    h.update(buf.subarray(from, i));
    from = i + 1;
  }
  return h.digest('hex');
}

// Таблица Т-5. Версия — md5 без \r или null (файла нет).
// same — на сервере без нас не менялось (наше незалитое остаётся), take — изменили без нас (забрать),
// ours — наше уже на сервере, merge — менялось и у нас, и без нас.
function classify({ base, head, server }) {
  if (server === base) return 'same';
  if (head === base) return 'take';
  if (server === head) return 'ours';
  return 'merge';
}

const commitHash = (cwd, rev) => {
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', rev + '^{commit}']);
  return r.ok ? r.out.trim() : null;
};

// База входа (Т-5) — по путям, «известное состояние сервера» (с 48.3, Р-24). base (D) — коммит последней строки «Залито на …»
// плана (хеш, которого нет в репозитории, не в счёт — с пометкой); нет — первый коммит репозитория. Поверх D — пути, которые меняли
// коммиты входа своего окружения из D..HEAD (после D или не связанные с ней): overlay — путь → полный хеш самого нового такого
// коммита (путь удалён им — версии в базе нет). Дерево одного коммита входа базой быть не может: это HEAD на момент входа, в нём и
// наши незалитые шаги, а сервер с ними не совпадал. Более старая база для остальных путей безопасна — ложного «забрать» поверх
// нашего незалитого не будет. → { base, source, overlay: Map, entries: число коммитов входа поверх } | { error }.
function entryBase(cwd, info, env) {
  if (!commitHash(cwd, 'HEAD')) return { error: 'в репозитории нет коммитов или это не git' };
  const planRaw = baseFromPlan(path.resolve(cwd, info.planRel), env, { cwd, byStep: isSsh(info) });
  const planned = planRaw ? commitHash(cwd, planRaw) : null;
  const note = planRaw && !planned ? ' (хеш ' + planRaw + ' из плана выкладки не найден в репозитории)' : '';
  let base = planned;
  let source = '«' + sectionOf(env) + '» в ' + info.planRel;
  if (!base) {
    const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).out.trim().split(/\s+/).filter(Boolean);
    if (!roots.length) return { error: 'не найден первый коммит репозитория' };
    base = roots[roots.length - 1];
    source = 'первый коммит репозитория' + note;
  }
  // только коммиты входа своего окружения: вход с дева говорит о деве, а прод мог быть любым; git log — от новых к старым
  const prefix = (env === 'дев' ? 'Дев' : 'Прод') + ': изменения без kit ';
  const overlay = new Map();
  let entries = 0;
  for (const c of logPaths(cwd, ['^' + base])) {
    if (!c.subject.startsWith(prefix)) continue;
    entries++;
    for (const p of c.paths) if (!overlay.has(p)) overlay.set(p, c.hash);
  }
  if (entries) source += '; поверх — ' + entries + ' ' + plural(entries, 'коммит', 'коммита', 'коммитов') + ' входа';
  return { base, source, overlay, entries };
}

// git ls-tree -r: путь → { mode, oid }. Ошибку git бросает.
function treeOf(cwd, rev) {
  const r = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', rev]);
  if (!r.ok) throw new Error('git ls-tree ' + rev + ': ' + r.err);
  const out = new Map();
  for (const rec of r.out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, , oid] = rec.slice(0, tab).split(' ');
    out.set(rec.slice(tab + 1), { mode, oid });
  }
  return out;
}

// Известное состояние сервера по entryBase как дерево: дерево base, поверх — пути overlay из своих коммитов входа (нет в его
// дереве — удалён, в базе его нет). → Map<путь, { mode, oid }>. Ошибку git бросает.
function baseTree(cwd, b) {
  const tree = treeOf(cwd, b.base);
  const byCommit = new Map();
  for (const [p, h] of b.overlay || []) {
    if (!byCommit.has(h)) byCommit.set(h, []);
    byCommit.get(h).push(p);
  }
  for (const [h, paths] of byCommit) {
    const t = treeOf(cwd, h);
    for (const p of paths) {
      if (t.has(p)) tree.set(p, t.get(p));
      else tree.delete(p);
    }
  }
  return tree;
}

// Что не забирается: бэкапы и архивы (как при первом скачивании в /kit:project-init) и файлы больше предела.
// Маски — по имени файла, без регистра. size не число — размер неизвестен, только маски.
const SKIP_MASKS = ['_*.back*', '*_back*.zip', '*.tar.gz*', '*.zip', '*.rar', '*.7z', '*.tar', '*.gz', '*.sql', '*.bak'].map(
  (m) => new RegExp('^' + m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i'));

function skipTake(rel, size) {
  const name = String(rel).split(/[\\/]/).pop();
  if (SKIP_MASKS.some((re) => re.test(name))) return 'архив';
  if (Number.isFinite(size) && size > FILE_LIMIT) return 'больше 10 МБ';
  return null;
}

// Коммиты, достижимые из HEAD (от новых к старым), и их пути: [{ hash, subject, paths }]. Корневые коммиты и слияния
// пропускаются (дифф корня огромен, изменения слияния — в его родителях). -z: пути с пробелом, кириллицей, кавычкой и переводом
// строки целы. extra — доп. аргументы git log (например, «^<коммит>» — только после него).
function logPaths(cwd, extra = []) {
  const args = ['log', '-z', '--name-only', '--no-renames', '--min-parents=1', '--max-parents=1', ...extra, '--format=%x01%H %s%x02', 'HEAD'];
  const r = git(cwd, args);
  if (!r.ok) return [];
  const commits = [];
  for (const chunk of r.out.split('\x01')) {
    const end = chunk.indexOf('\x02');
    if (end < 0) continue;
    // после заголовка: NUL, затем «\n» перед первым путём и пути через NUL
    let rest = chunk.slice(end + 1);
    if (rest.startsWith('\0')) rest = rest.slice(1);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    const head = chunk.slice(0, end);
    const sp = head.indexOf(' ');
    commits.push({ hash: head.slice(0, sp), subject: head.slice(sp + 1), paths: rest.split('\0').filter(Boolean) });
  }
  return commits;
}

// Наши доработки (Т-7): пути, которые менял хоть один коммит, кроме первого и коммитов входа.
function oursPaths(cwd) {
  const out = new Set();
  for (const c of logPaths(cwd)) {
    if (ENTRY_RE.test(c.subject)) continue;
    for (const p of c.paths) out.add(p);
  }
  return out;
}

// Запись из «Удалить с сервера» → путь: без обратных кавычек, `/` вместо `\`, без ведущих `/` и `./`; папка (`/`, `/*`, `/**`
// на конце) — с `/` на конце; пусто — ''.
function normalizePending(cell) {
  let p = String(cell || '').trim().replace(/^`+|`+$/g, '').trim().replace(/\\/g, '/');
  p = p.replace(/^(?:\.?\/)+/, '');
  const dir = /\/(?:\*{1,2})?$/.test(p);
  p = p.replace(/\/(?:\*{1,2})?$/, '');
  return p ? (dir ? p + '/' : p) : '';
}

// Ждёт удаления с сервера (Т-5): (а) удалено коммитом шага и нет в HEAD — при ручной выкладке и автозаливке удалённое в git на
// сервере само не удаляется; (б) открытые пункты «Удалить с сервера» плана выкладки (закрыт — есть «✅» в «Удалён»).
function pendingDelete(cwd, info) {
  const out = new Set();
  const tree = git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
  if (tree.ok) {
    const inHead = new Set(tree.out.split('\0').filter(Boolean));
    for (const c of logPaths(cwd, ['--diff-filter=D'])) {
      if (ENTRY_RE.test(c.subject)) continue;
      for (const p of c.paths) if (!inHead.has(p)) out.add(p);
    }
  }
  try {
    const file = path.resolve(cwd, info.planRel);
    const section = fs.existsSync(file) ? getSection(fs.readFileSync(file, 'utf8'), 'Удалить с сервера') : null;
    if (section) {
      for (const row of parseTable(section)) {
        if (Object.prototype.hasOwnProperty.call(row, 'Удалён') && String(row['Удалён']).includes('✅')) continue;
        const p = normalizePending(row['Путь']);
        if (p) out.add(p);
      }
    }
  } catch (e) {
    // нечитаемый план — остаётся то, что нашлось по git
  }
  return out;
}

// rel ждёт удаления: точное совпадение или внутри записи папки (с `/` на конце). Регистр важен (сервер и git — как Linux).
function inPending(pending, rel) {
  if (pending.has(rel)) return true;
  for (const p of pending) if (p.endsWith('/') && rel.startsWith(p)) return true;
  return false;
}

// Расширения включённых File Watchers PhpStorm (Т-14): .idea/watcherTasks.xml, задачи <TaskOptions …> без isEnabled="false",
// их <option name="fileExtension" value="…" /> — без точки, нижним регистром. Нет файла или не разобран — пустое множество.
function watcherExts(dir) {
  const out = new Set();
  let xml;
  try {
    xml = fs.readFileSync(path.join(dir, '.idea', 'watcherTasks.xml'), 'utf8');
  } catch (e) {
    return out;
  }
  const re = /<TaskOptions\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[2]) continue; // <TaskOptions /> — задача без настроек
    const end = xml.indexOf('</TaskOptions>', re.lastIndex);
    if (end < 0) break; // обрезанный файл
    const body = xml.slice(re.lastIndex, end);
    re.lastIndex = end;
    if (/\bisEnabled="false"/i.test(m[1])) continue;
    for (const o of body.matchAll(/<option\b([^>]*?)\/?>/g)) {
      const v = /\bname="fileExtension"/.test(o[1]) && /\bvalue="([^"]*)"/.exec(o[1]);
      const ext = v ? v[1].trim().replace(/^\.+/, '').toLowerCase() : '';
      if (ext) out.add(ext);
    }
  }
  return out;
}

// \r\n → \n (одиночный \r остаётся) и обратно: каждый \n → \r\n (в буфере нет \r\n).
function toLf(buf) {
  if (!buf.includes(13)) return buf;
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] !== 13 || buf[i + 1] !== 10) out[n++] = buf[i];
  return out.subarray(0, n);
}
function toCrlf(buf) {
  let lf = 0;
  for (const b of buf) if (b === 10) lf++;
  const out = Buffer.alloc(buf.length + lf);
  let n = 0;
  for (const b of buf) {
    if (b === 10) out[n++] = 13;
    out[n++] = b;
  }
  return out;
}

// Трёхстороннее совмещение (Т-8, Р-29): версии — Buffer или null (файла нет). git merge-file -p над файлами во временной
// папке вне проекта (убирается всегда); CRLF → LF до совмещения, результат — в стиле нашей версии (в ней есть CRLF — каждый
// перевод строки CRLF). Базы нет (добавлен и у нас, и без нас) — пустой файл. → { result: Buffer | null (удалён у обоих) } |
// { conflict: причина }; ошибка git — тоже конфликт, не исключение.
function mergeVersions({ ours = null, base = null, theirs = null } = {}) {
  if (ours === null && theirs === null) return { result: null };
  if (ours === null) return { conflict: 'удалён у нас, изменён на сервере' };
  if (theirs === null) return { conflict: 'изменён у нас, удалён на сервере' };
  if ([ours, base, theirs].some((b) => b && b.includes(0))) return { conflict: 'двоичный файл' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-merge-'));
  try {
    const names = ['ours', 'base', 'theirs'];
    [ours, base || Buffer.alloc(0), theirs].forEach((b, i) => fs.writeFileSync(path.join(tmp, names[i]), toLf(b)));
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'наша', '-L', 'база', '-L', 'сервер', ...names],
      { cwd: tmp, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    if (r.status === 0) return { result: ours.includes('\r\n') ? toCrlf(r.stdout) : r.stdout };
    if (r.status > 0 && r.status < 128) return { conflict: 'правки пересекаются' }; // число конфликтов (не больше 127)
    const why = String(r.stderr || r.error || '').trim().split('\n').pop();
    return { conflict: 'git merge-file не совместил' + (why ? ': ' + why : '') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Строка для пользователя (Т-7). Массивы путей; skipped — [{ path, why }]. Числа — изменено/добавлено/удалено без kit (только
// забранное коммитом входа); merged — совмещённое с нашими незакоммиченными правками в этом входе (Р-33); conflicts — не
// совместилось само (Р-37: подробности и вопрос — строками ниже); conflictsAhead — не совместится само (--check, Р-39: вопрос
// задаст вход общей сессии). «Совпадает с git» — только если всё пусто.
const cleanText = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?');
const listOf = (items, fmt = cleanText) => items.slice(0, LIST_LIMIT).map(fmt).join(', ') +
  (items.length > LIST_LIMIT ? ' и ещё ' + (items.length - LIST_LIMIT) : '');

function summaryLine(input = {}) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const { env } = input;
  const keys = ['changed', 'added', 'removed', 'ours', 'merged', 'conflicts', 'conflictsAhead', 'skipped', 'waiting'];
  const all = keys.map((k) => list(input[k]));
  const [changed, added, removed, ours, merged, conflicts, ahead, skipped, waiting] = all;
  const dev = env === 'дев';
  const head = '[kit] ' + (dev ? 'Вход с дева: ' : 'Вход с прода: ');
  if (!all.some((a) => a.length)) return head + (dev ? 'дев' : 'прод') + ' совпадает с git.';
  const parts = [`файлов без kit: изменено ${changed.length}, добавлено ${added.length}, удалено ${removed.length}.`];
  if (ours.length) parts.push(`Наши прошлые доработки среди изменённых (проверьте, не затёрты ли): ${listOf(ours)}.`);
  if (merged.length) parts.push(`Совмещено с нашими незакоммиченными правками — проверьте в панели изменений: ${listOf(merged)}.`);
  if (conflicts.length) parts.push(`Не совместилось само — вопрос ниже: ${listOf(conflicts)}.`);
  if (ahead.length) parts.push(`Не совместится само — вопрос задаст вход общей сессии: ${listOf(ahead)}.`);
  if (skipped.length) parts.push(`Не забрано, осталось на сервере: ${listOf(skipped, (s) => cleanText(s.path) + ' (' + cleanText(s.why) + ')')}.`);
  if (waiting.length) parts.push(`Ждёт удаления с сервера: ${listOf(waiting)}.`);
  return head + parts.join(' ');
}

// ---- Отметка входа ----------------------------------------------------------------------------------------------
// Ключи сессий — внешний ввод (`__proto__`, `constructor`): запись в объект — через defineProperty, поиск — по собственным свойствам.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
const RESULTS = ['need', 'done', 'skipped', 'checked'];

function cleanMark(raw) {
  const mark = { sessions: {}, named: [], pending: [] };
  if (!isObj(raw)) return mark;
  if (isObj(raw.sessions)) {
    for (const id of Object.keys(raw.sessions)) {
      const r = raw.sessions[id];
      if (!isObj(r) || typeof r.result !== 'string') continue;
      const rec = { at: typeof r.at === 'string' ? r.at : '', result: r.result };
      if (typeof r.commit === 'string') rec.commit = r.commit;
      setOwn(mark.sessions, id, rec);
    }
  }
  mark.named = strings(raw.named);
  mark.pending = strings(raw.pending);
  return mark;
}

// Нет файла, битый JSON, поля не того типа — пустое значение этого поля. Не бросает.
function readMark(dir) {
  try {
    return cleanMark(JSON.parse(fs.readFileSync(path.join(dir, MARK_FILE), 'utf8').replace(/^\uFEFF/, '')));
  } catch (e) {
    return cleanMark(null);
  }
}

// Атомарная запись; записи сессий старше 7 дней и с нечитаемым `at` убираются. Ошибку записи бросает — решает вызывающий.
function writeMark(dir, mark) {
  const clean = cleanMark(mark);
  const sessions = {};
  const oldest = Date.now() - MARK_TTL_MS;
  for (const id of Object.keys(clean.sessions)) {
    const at = Date.parse(clean.sessions[id].at);
    if (Number.isFinite(at) && at >= oldest) setOwn(sessions, id, clean.sessions[id]);
  }
  const text = JSON.stringify({ sessions, named: clean.named, pending: clean.pending }, null, 2) + '\n';
  writeFilesAtomic([{ file: path.join(dir, MARK_FILE), text }], { mkdir: true });
}

// Запись своей сессии: файл читается заново прямо перед записью, чужие записи, named и pending сохраняются.
function markSession(dir, id, result, commit) {
  if (typeof id !== 'string' || !id || !RESULTS.includes(result)) return;
  const mark = readMark(dir);
  const rec = { at: new Date().toISOString(), result };
  if (commit) rec.commit = commit;
  setOwn(mark.sessions, id, rec);
  writeMark(dir, mark);
}

function sessionDone(dir, id) {
  if (typeof id !== 'string' || !id) return false;
  const { sessions } = readMark(dir);
  return hasOwn(sessions, id) && ['done', 'skipped', 'checked'].includes(sessions[id].result);
}

// Сессия последней записи `need` (с самым поздним `at`); нет — null.
function lastNeed(dir) {
  const { sessions } = readMark(dir);
  let best = null;
  let bestAt = -Infinity;
  for (const id of Object.keys(sessions)) {
    if (sessions[id].result !== 'need') continue;
    const at = Date.parse(sessions[id].at);
    if (Number.isFinite(at) && at >= bestAt) {
      best = id;
      bestAt = at;
    }
  }
  return best;
}

module.exports = {
  ENTRY_RE, FILE_LIMIT, ENTRY_LIMIT, MARK_FILE, plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, skipTake,
  oursPaths, pendingDelete, inPending, watcherExts, mergeVersions, listOf, summaryLine, readMark, writeMark, markSession, sessionDone,
  lastNeed,
};
