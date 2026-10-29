#!/usr/bin/env node
'use strict';
// Синхронизация с продом (этап 48): сайт на сервере сверяется с git по SSH — что там изменили, добавили и удалили без kit,
// забирается в рабочую копию байт в байт и коммитится коммитом синхронизации (kit-commit.js, без просмотра и вопросов: прод
// главный).
//   node prod-sync.js [--timeout сек]           синхронизация: сверка, забор, коммит синхронизации, отметка сессии done
//   node prod-sync.js --check [--timeout сек]   план синхронизации без записи (исполнитель Мэтта; сессия в worktree — всегда
//                                               так, и сверяется основная папка проекта): файлы, индекс и pending не
//                                               меняются; синхронизация ничего не запишет — отметка checked в папке сессии
//   --watchers-ok — забирать, хотя среди забираемого исходники File Watchers при PhpStorm Always; --big-ok — забирать больше
//   50 МБ за раз; --skip, --hook и --ftp-done — пока код 4 (первые два уберёт шаг 48.7, FTP сделает 48.8)
// Папка проекта — корень git текущей папки; сервер — «Окружение» (прод или дев), куда — «SSH прод» / «SSH дев». Три версии
// файла (база, HEAD, сервер) и правила без SSH — lib/prod.js; сценарии для сервера и разбор их ответа — lib/prod-ssh.js. Сверка —
// одним подключением, сценарием sh на stdin: состояние, md5 и размер отслеживаемых файлов (пачкой, без процесса на файл) и
// список остальных с размером (find без того, что точно исключает .gitignore); md5 сервера сравнивается у нас с вариантами
// blob (CRLF и LF — одна версия), неясное скачивается. Наши незакоммиченные правки (Т-8): сервер = рабочая копия — наше уже на
// сервере, не трогаем; менялось и у нас, и без нас — совмещение (git merge-file) в рабочую копию, мимо коммита синхронизации;
// не совместилось — рабочая копия не тронута, версия сервера — во временной папке. Порядок (Р-40): больше 50 МБ за раз —
// остановка до любого скачивания; кандидаты на совмещение скачиваются и совмещаются в памяти; File Watchers при PhpStorm
// Always — остановка по тому, что синхронизация запишет, до записи; затем забор. Скачанное пишется через временный файл; пути
// забора до записи — в pending отметки (.claude/kit-prod.json): повтор вернёт их к HEAD и доведёт синхронизацию до конца.
// Много путей — несколько коммитов синхронизации подряд.
// Коды: 0 — синхронизация сделана (или нечего забирать; с --check — синхронизация ничего не запишет); 1 — нужен ответ
// пользователя (не совместилось — синхронизация сделана без этих файлов; File Watchers или больше 50 МБ — ничего не записано;
// запрещённый путь или секрет в скачанном; с --check — есть что забрать); 2 — синхронизировать не с чем, параметр неверный или
// на сервере нет папки сайта; 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, запись. Весь вывод — в stdout;
// последняя строка — итог для пользователя (код 0) или что делать Claude.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { kitInfo, serverEnv } = require('./lib/project');
const { parseRules, matchRules } = require('./lib/paths');
const { serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { skipRules, git } = require('./lib/deploy');
const { projectRoot } = require('./lib/matt');
const { writeFilesAtomic } = require('./lib/atomic');
const { safePath } = require('./ssh-deploy');
const { BASE_FORBIDDEN } = require('./secret-scan');
const { NO_ROOT, pruneRules, listScript, parseList, fetchScript, parseFetch } = require('./lib/prod-ssh');
const {
  ENTRY_LIMIT, UNKNOWN_SIZE, SKIP, plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, skipTake, oursPaths,
  pendingDelete, inPending, mergeVersions, listOf, summaryLine, readMark, writeMark, markSession, lastNeed, readText, clean, badName,
  watcherHits, bigOf, stopLines, conflictDir, md5Eol, catBlobs, blobHashes, blobVariants,
} = require('./lib/prod');

const USAGE = 'Использование: node prod-sync.js [--check] [--watchers-ok] [--big-ok] [--timeout сек]';
// Меньше предела инструмента Bash (120 с): зависший сервер — код 3, а не оборванный вызов. Срок — общий на все подключения
// синхронизации.
const DEFAULT_TIMEOUT = 100;
// Пути одного вызова kit-commit.js: сумма длин плюс 3 знака на путь (предел командной строки Windows — 32 767 на весь вызов,
// а kit-commit.js передаёт те же пути в git).
const ARG_LIMIT = 24000;
const FETCH_LIMIT = 16 * 1024 * 1024; // скачивание за одно подключение — по размеру файлов
const REGULAR = new Set(['100644', '100755']); // ссылки (120000) и подмодули (160000) — вне сверки
const KIT_COMMIT = path.join(__dirname, 'kit-commit.js');
const ASK = 'спроси пользователя: Повторить / ' + SKIP;
const KIND = { changed: 'изменён', added: 'добавлен', removed: 'удалён' };

const FLAGS = { '--check': 'check', '--ftp-done': 'ftpDone', '--skip': 'skip', '--hook': 'hook', '--watchers-ok': 'watchersOk', '--big-ok': 'bigOk' };

function parseArgs(argv) {
  const o = { check: false, ftpDone: false, skip: false, hook: false, watchersOk: false, bigOk: false, timeout: DEFAULT_TIMEOUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.prototype.hasOwnProperty.call(FLAGS, a)) o[FLAGS[a]] = true;
    else if (a === '--timeout') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 600) throw new Error('--timeout: секунды, от 1 до 600');
      o.timeout = Number(v);
    } else throw new Error('неизвестный аргумент ' + a);
  }
  return o;
}

// ---- git и рабочая копия ------------------------------------------------------------------------------------------------
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const exists = (abs) => {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (e) {
    return false;
  }
};
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Пути, которые исключает .gitignore (и info/exclude). --no-index: путь внутри подмодуля не роняет git.
function ignoredOf(dir, paths) {
  if (!paths.length) return new Set();
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'check-ignore', '--no-index', '-z', '--stdin'],
    { cwd: dir, input: paths.join('\0') + '\0', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status === 1) return new Set(); // ничего не игнорируется
  if (r.status !== 0) throw new Error('git check-ignore: ' + String(r.stderr || r.error || '').trim());
  return new Set(r.stdout.split('\0').filter(Boolean));
}

// Пути с незакоммиченной правкой: изменён, в индексе, удалён, неотслеживаемый.
function dirtyPaths(dir) {
  const r = git(dir, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall', '--no-renames']);
  if (!r.ok) throw new Error('git status: ' + r.err);
  return new Set(r.out.split('\0').filter((x) => x.length > 3).map((x) => x.slice(3)));
}

// Файл рабочей копии; нет файла (или на его месте папка, или над ним файл) — null. Другая ошибка чтения — исключение.
function readWork(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel));
  } catch (e) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(e.code)) return null;
    throw e;
  }
}

// Наши незакоммиченные правки (Р-27): путь из git status, у которого версия рабочей копии (md5 без \r; файла нет — null) ≠
// версии HEAD (headVer); отличие только в \r — не правка. same(p, raw) — сырой md5 сервера (null — файла нет) совпал с файлом
// рабочей копии как есть или в варианте переводов строк (Р-28: наше уже на сервере). Файлы читаются по запросу, один раз.
function workCopy(dir, headVer) {
  const status = dirtyPaths(dir);
  const seen = new Map();
  const info = (p) => {
    if (!seen.has(p)) {
      const b = readWork(dir, p);
      seen.set(p, b === null ? null : { noCr: md5NoCr(b), raws: new Set([md5(b), md5Eol(b, false), md5Eol(b, true)]) });
    }
    return seen.get(p);
  };
  const noCr = (p) => (info(p) ? info(p).noCr : null);
  return {
    status,
    noCr,
    dirty: (p) => status.has(p) && noCr(p) !== headVer(p),
    same: (p, raw) => (raw === null ? info(p) === null : !!info(p) && info(p).raws.has(raw)),
  };
}

// М-6: записать путь мешает локальное — на его месте папка или над ним файл. → причина | null. Ссылку на папку над путём
// считаем папкой (stat идёт по ссылке).
function blockedOnDisk(dir, rel) {
  try {
    if (fs.lstatSync(path.join(dir, rel)).isDirectory()) return 'у нас на этом месте папка';
  } catch (e) {
    // нет — не мешает
  }
  const segs = rel.split('/');
  for (let i = 1; i < segs.length; i++) {
    const up = segs.slice(0, i).join('/');
    let st;
    try {
      st = fs.statSync(path.join(dir, up));
    } catch (e) {
      return null; // папки нет — запись её создаст
    }
    if (!st.isDirectory()) return 'у нас файл ' + up + ' на месте папки';
  }
  return null;
}

// М-7: временные файлы записи (<путь>.<pid>.kit-tmp, lib/atomic.js), оставшиеся после обрыва.
function dropTmp(dir, rel) {
  const abs = path.join(dir, rel);
  const name = path.basename(abs);
  let list;
  try {
    list = fs.readdirSync(path.dirname(abs));
  } catch (e) {
    return;
  }
  for (const f of list) {
    if (f.startsWith(name + '.') && /^\.\d+\.kit-tmp$/.test(f.slice(name.length))) fs.rmSync(path.join(path.dirname(abs), f), { force: true });
  }
}

// Части по сумме длин путей плюс 3 знака на путь; путь длиннее предела — отдельной частью.
function byLength(paths, limit) {
  const parts = [];
  let cur = [];
  let len = 0;
  for (const p of paths) {
    if (cur.length && len + p.length + 3 > limit) {
      parts.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += p.length + 3;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

// Удалить файл рабочей копии (нет — не ошибка) и опустевшие папки над ним, кроме корня.
function removeLocal(dir, rel) {
  const abs = path.join(dir, rel);
  fs.rmSync(abs, { force: true });
  for (let d = path.dirname(abs); d.length > dir.length && d.startsWith(dir); d = path.dirname(d)) {
    try {
      fs.rmdirSync(d);
    } catch (e) {
      break; // не пуста
    }
  }
}

// Прошлая синхронизация оборвалась после записи (Т-12): её пути — к HEAD. Есть в HEAD — git checkout HEAD; нет — из индекса и с
// диска. Временные файлы записи рядом с путями — убрать (М-7).
function restore(dir, paths, argLimit) {
  for (const p of paths) dropTmp(dir, p);
  const head = treeOf(dir, 'HEAD');
  const inHead = paths.filter((p) => head.has(p));
  const gone = paths.filter((p) => !head.has(p));
  for (const part of byLength(inHead, argLimit)) {
    const r = git(dir, ['--literal-pathspecs', 'checkout', 'HEAD', '--', ...part]);
    if (!r.ok) throw new Error('git checkout HEAD: ' + r.err);
  }
  for (const part of byLength(gone, argLimit)) {
    const r = git(dir, ['--literal-pathspecs', 'rm', '-q', '--cached', '--ignore-unmatch', '--', ...part]);
    if (!r.ok) throw new Error('git rm --cached: ' + r.err);
  }
  for (const p of gone) removeLocal(dir, p);
}

// Основная папка, если dir — worktree: <проект>/.claude/worktrees/<имя> или связанный git worktree в другом месте; иначе null.
function mainFolder(dir) {
  const root = projectRoot(dir);
  if (path.resolve(root) !== path.resolve(dir)) return root;
  const a = git(dir, ['rev-parse', '--absolute-git-dir']);
  const c = git(dir, ['rev-parse', '--git-common-dir']);
  if (!a.ok || !c.ok) return null;
  // настоящие пути: папку проекта могли передать иначе, чем её пишет git (короткие имена 8.3, регистр, ссылки)
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch (e) {
      return path.resolve(p);
    }
  };
  const abs = real(path.resolve(dir, a.out.trim()));
  const common = real(path.resolve(dir, c.out.trim()));
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (key(abs) === key(common)) return null;
  return path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : common;
}

// Запись «Удалить с сервера» или пути, удалённого шагом, которой отвечает rel (папка — одной записью); нет — null.
function pendingEntry(pending, rel) {
  if (!inPending(pending, rel)) return null;
  return pending.has(rel) ? rel : [...pending].find((p) => p.endsWith('/') && rel.startsWith(p));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Синхронизация ------------------------------------------------------------------------------------------------------

// Одно подключение в общий срок синхронизации. → { stdout } | { fail: причина }.
async function remote(c, script) {
  const late = 'вышло время (' + c.timeoutSec + ' с)';
  const left = c.deadline - Date.now();
  if (left <= 0) return { fail: late };
  const r = await runSsh(c.target.host, 'sh -s', script, { timeoutMs: left });
  if (!r.connected) return { fail: r.timedOut ? late : 'нет подключения или обрыв: ' + (lastLine(r.stderr) || 'ssh завершился без ответа') };
  return { stdout: r.stdout };
}

const unparsed = (why) => ({ fail: 'ответ сервера не разобран (' + why + ')' });

// Скачать файлы порциями до FETCH_LIMIT. → { data: Map, failed: Set } | { fail }.
async function download(c, items) {
  const parts = [];
  let cur = [];
  let sum = 0;
  for (const it of items) {
    const n = Number.isFinite(it.size) ? it.size : UNKNOWN_SIZE;
    if (cur.length && sum + n > FETCH_LIMIT) {
      parts.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(it.path);
    sum += n;
  }
  if (cur.length) parts.push(cur);
  const data = new Map();
  const failed = new Set();
  for (const paths of parts) {
    const res = await remote(c, fetchScript(c.target.root, paths));
    if (res.fail) return res;
    const f = parseFetch(res.stdout, paths);
    if (f.err) return { fail: f.err };
    if (f.bad) return unparsed(f.bad);
    for (const [p, b] of f.data) data.set(p, b);
    for (const p of f.failed) failed.add(p);
  }
  return { data, failed };
}

// Сверка без скачивания: подключение 1 — состояние, md5, размеры и список сервера; версии по Т-5 (Р-13); наши правки и «наше
// уже на сервере» (Р-27, Р-28; md5 новых на сервере, которые есть и у нас, — подключением 2); что не забирать (Р-17); М-6.
// → { fail } | { items: [{ path, kind: unclear | changed | added | removed | merge, side: take | merge, size, gone — на сервере
// файла нет, raw }],
// once: [{ path, why }] — называются один раз, each: [{ path, why }] — каждый раз, waiting: [запись], findFailed,
// judge(путь, версия сервера), work — наши правки (null — кандидатов нет), baseOid(путь) — blob базы или null }.
async function survey(c) {
  const { dir } = c;
  const site = (p) => !matchRules(p, c.rules);
  const head = treeOf(dir, 'HEAD');
  const base = baseTree(dir, c.b); // известное состояние сервера: заливка и поверх — свои коммиты синхронизации (Р-24)
  const filesOf = (tree) => new Map([...tree].filter(([p, e]) => REGULAR.has(e.mode) && site(p)).map(([p, e]) => [p, e.oid]));
  const headF = filesOf(head);
  const baseF = filesOf(base);
  // Отслеживаемые — HEAD ∪ база. Только в базе: сейчас игнорируется или лежит на диске (убран из git через git rm --cached
  // нарочно, как в ssh-deploy.js) — вне сверки.
  const baseOnly = [...baseF.keys()].filter((p) => !headF.has(p));
  const kept = new Set(baseOnly.filter((p) => exists(path.join(dir, p))));
  const ignoredBase = ignoredOf(dir, baseOnly.filter((p) => !kept.has(p)));
  for (const p of baseOnly) if (kept.has(p) || ignoredBase.has(p)) baseF.delete(p);
  const tracked = [...new Set([...headF.keys(), ...baseF.keys()])].sort();

  const rules = pruneRules(readText(path.join(dir, '.gitignore')), (p) => exists(path.join(dir, p, '.gitignore')));
  const res = await remote(c, listScript(c.target.root, tracked, rules));
  if (res.fail) return res;
  const list = parseList(res.stdout, tracked);
  if (list.err) return { fail: list.err };
  if (list.bad) return unparsed(list.bad);

  const blobs = await blobHashes(dir, [...new Set([...headF.values(), ...baseF.values()])]);
  const ver = (oid) => (oid ? blobs.get(oid).noCr : null);
  const judge = (p, server) => classify({ base: ver(baseF.get(p)), head: ver(headF.get(p)), server });
  const pend = pendingDelete(dir, c.info);
  const waiting = new Set();
  const each = [];
  const server = new Map(); // путь → версия сервера (md5 без \r; null — файла нет)
  const loose = []; // md5 не совпал с blob как есть — сверить с вариантами переводов строк
  for (const p of tracked) {
    const st = list.state.get(p);
    if (!headF.has(p) && st !== 'absent') {
      const w = pendingEntry(pend, p);
      if (w) {
        waiting.add(w);
        continue;
      }
    }
    if (st === 'unreadable' || st === 'notfile') each.push({ path: p, why: st === 'notfile' ? 'не файл' : 'не читается' });
    else if (st === 'absent') server.set(p, null);
    else {
      const raw = list.md5.get(p);
      const hit = [baseF.get(p), headF.get(p)].find((oid) => oid && blobs.get(oid).raw === raw);
      if (hit) server.set(p, ver(hit));
      else loose.push(p);
    }
  }
  const variants = await blobVariants(dir, [...new Set(loose.flatMap((p) => [baseF.get(p), headF.get(p)]).filter(Boolean))]);
  const items = [];
  for (const p of loose) {
    const raw = list.md5.get(p);
    const hit = [baseF.get(p), headF.get(p)].find((oid) => oid && variants.get(oid).has(raw));
    if (hit) server.set(p, ver(hit));
    else items.push({ path: p, kind: 'unclear', size: list.sizes.get(p), gone: false, raw }); // неясный: решит содержимое
  }
  for (const [p, v] of server) {
    const k = judge(p, v);
    if (k !== 'take' && k !== 'merge') continue;
    const gone = v === null;
    items.push({ path: p, kind: k === 'merge' ? 'merge' : gone ? 'removed' : 'changed', size: list.sizes.get(p), gone, raw: gone ? null : list.md5.get(p) });
  }

  // Новые на сервере: нет ни в HEAD, ни в базе, файлы сайта, не под путём из git (подмодуль, ссылка, файл вместо папки) и не
  // исключены .gitignore. md5 сервера у них нет — «наше ли» решает подключение 2.
  const known = new Set([...head.keys(), ...base.keys()]);
  const under = (p) => {
    for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) if (known.has(p.slice(0, i))) return true;
    return false;
  };
  const fresh = [...list.files.keys()].filter((p) => !known.has(p) && site(p) && !under(p));
  const ignored = ignoredOf(dir, fresh);
  for (const p of fresh) {
    if (ignored.has(p)) continue;
    const w = pendingEntry(pend, p);
    if (w) waiting.add(w);
    else items.push({ path: p, kind: 'added', size: list.files.get(p), gone: false });
  }

  // Наши правки — только если есть кандидаты (М-4). Сервер = рабочая копия — наше уже на сервере (Р-28): не скачивать, не
  // совмещать, не забирать, в строку и в проверки File Watchers и 50 МБ не включать.
  const work = items.length ? workCopy(dir, (p) => ver(headF.get(p))) : null;
  let left = items.filter((it) => it.kind === 'added' || !(work.dirty(it.path) && work.same(it.path, it.gone ? null : it.raw)));

  // Подключение 2 — только если новый на сервере есть и у нас (неотслеживаемый): md5 по списку, без обхода папки сайта. До «не
  // забирать»: своё на сервере не называется и там.
  const probe = left.filter((it) => it.kind === 'added' && work.dirty(it.path)).map((it) => it.path);
  if (probe.length) {
    const res2 = await remote(c, listScript(c.target.root, probe, null));
    if (res2.fail) return res2;
    const h = parseList(res2.stdout, probe);
    if (h.err) return { fail: h.err };
    if (h.bad) return unparsed(h.bad);
    const drop = new Set(probe.filter((p) => h.state.get(p) === 'absent' || (h.md5.has(p) && work.same(p, h.md5.get(p)))));
    left = left.filter((it) => !drop.has(it.path));
  }

  // Что не забирается (Р-17): недопустимое имя, запрещённое к коммиту, архив, больше 10 МБ. Windows не различает регистр: новый
  // путь, совпавший без регистра с путём git, с другим новым или с нашим неотслеживаемым, затёр бы чужой файл — тоже
  // недопустимое имя. Затем М-6 — по диску, до проверок объёма и вотчеров: такой путь не забирается, не совмещается и называется
  // каждый раз.
  const forbid = parseRules([...BASE_FORBIDDEN, ...c.info.params.list('Не коммитить')]);
  const win = process.platform === 'win32';
  const spell = new Map(); // нижний регистр → написания
  if (win) {
    for (const p of [...known, ...(work ? work.status : []), ...left.filter((it) => it.kind === 'added').map((it) => it.path)]) {
      const k = p.toLowerCase();
      if (!spell.has(k)) spell.set(k, new Set());
      spell.get(k).add(p);
    }
  }
  const whyNot = (it) => {
    if (badName(it.path) || (win && it.kind === 'added' && spell.get(it.path.toLowerCase()).size > 1)) return 'недопустимое имя';
    if (matchRules(it.path, forbid)) return 'запрещён к коммиту';
    return skipTake(it.path, it.size);
  };
  // Сторона: совмещение — наша правка, merge или неясный при HEAD ≠ базе (по содержимому станет merge или «ничего»); остальное —
  // забор (неясный при HEAD = базе станет забором или «ничего»).
  const side = (it) => (work.dirty(it.path) || it.kind === 'merge' || (it.kind === 'unclear' && ver(headF.get(it.path)) !== ver(baseF.get(it.path)))
    ? 'merge' : 'take');
  const once = [];
  const keep = [];
  for (const it of left) {
    const why = whyNot(it);
    const blocked = why ? null : blockedOnDisk(dir, it.path);
    if (why) once.push({ path: it.path, why });
    else if (blocked) each.push({ path: it.path, why: blocked });
    else keep.push({ ...it, side: side(it) });
  }
  return {
    items: keep.sort(byPath), once, each, waiting: [...waiting].sort(), findFailed: list.findFailed, judge, work,
    baseOid: (p) => baseF.get(p) || null,
  };
}

// Забор: скачать (кроме удалённых на сервере; all = false — только неясные, для --check) и разобрать по содержимому (Р-13):
// неясный решается точно, изменённый мог смениться после сверки, вернувшийся к базе — не забирается.
// → { fail } | { take: [{ path, kind: changed | added | removed, size, gone, data }], each: [{ path, why }] }.
async function collect(c, s, items, all = true) {
  const want = (it) => !it.gone && (all || it.kind === 'unclear');
  const got = await download(c, items.filter(want));
  if (got.fail) return got;
  const take = [];
  const each = [];
  for (const it of items) {
    if (got.failed.has(it.path)) {
      each.push({ path: it.path, why: 'не читается' });
      continue;
    }
    const data = want(it) ? got.data.get(it.path) : null;
    if (!it.gone && !want(it)) { // --check: как нашла сверка
      take.push({ path: it.path, kind: it.kind, size: it.size, gone: false, data: null });
      continue;
    }
    if (it.kind !== 'added' && s.judge(it.path, data ? md5NoCr(data) : null) !== 'take') continue;
    take.push({ path: it.path, kind: it.kind === 'added' ? 'added' : data ? 'changed' : 'removed', size: it.size, gone: !data, data });
  }
  return { take, each };
}

// Совмещение в памяти (Р-29, Р-39, Р-40): скачать кандидатов (кроме удалённых на сервере) и совместить во временной папке вне
// проекта — в проект ничего не пишется. Наша — файл с диска, база — blob известного состояния сервера, их — скачанное. Сервер =
// рабочая копия без \r — наше уже на сервере; сервер вернулся к базе или к HEAD — ничего; результат равен нашей — совмещено
// раньше. → { fail } | { merged: [{ path, result }] — синхронизация запишет, conflicts: [{ path, why, ours, theirs, base }] —
// версии (Buffer | null), each: [{ path, why }] }.
async function mergePlan(c, s, items) {
  const merged = [];
  const conflicts = [];
  const each = [];
  if (!items.length) return { merged, conflicts, each };
  const got = await download(c, items.filter((it) => !it.gone));
  if (got.fail) return got;
  const bases = new Map();
  await catBlobs(c.dir, [...new Set(items.map((it) => s.baseOid(it.path)).filter(Boolean))], (oid, buf) => bases.set(oid, Buffer.from(buf)));
  for (const it of items) {
    if (got.failed.has(it.path)) {
      each.push({ path: it.path, why: 'не читается' });
      continue;
    }
    const theirs = it.gone ? null : got.data.get(it.path);
    const v = theirs ? md5NoCr(theirs) : null;
    const mine = s.work.dirty(it.path);
    if (mine && v === s.work.noCr(it.path)) continue; // наше уже на сервере
    const k = it.kind === 'added' ? 'take' : s.judge(it.path, v);
    if (k !== 'merge' && !(k === 'take' && mine)) continue; // сервер вернулся к базе или к нашему
    const ours = readWork(c.dir, it.path);
    const oid = s.baseOid(it.path);
    const base = oid ? bases.get(oid) : null;
    const r = mergeVersions({ ours, base, theirs });
    if (r.conflict) conflicts.push({ path: it.path, why: r.conflict, ours, theirs, base });
    else if (r.result && !(ours && r.result.equals(ours))) merged.push({ path: it.path, result: r.result });
  }
  return { merged, conflicts, each };
}

// Запись совмещения (Р-29, Р-30): временные файлы записи у кандидатов на совмещение (cands) — убрать (М-7); совмещённое — через
// временный файл со сверкой md5; конфликтам — версии сервера и базы во временную папку вне проекта (conflictDir: её читает
// Claude, убирает следующий конфликт). → { wrong: [путь — md5 не совпал], conflicts: [{ path, why, ours, server, base }] —
// полные пути или null }.
function applyMerges(dir, mp, cands) {
  for (const it of cands) dropTmp(dir, it.path);
  const writes = mp.merged.map((m) => ({ file: path.join(dir, m.path), text: m.result, label: m.path }));
  if (writes.length) writeFilesAtomic(writes, { mkdir: true });
  const wrong = writes.filter((w) => md5(fs.readFileSync(w.file)) !== md5(w.text)).map((w) => w.label);
  let tmp = null;
  const conflicts = mp.conflicts.map((k) => {
    tmp = tmp || conflictDir(dir);
    const put = (side, buf) => {
      if (!buf) return null;
      const file = path.join(tmp, side, ...k.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return file;
    };
    return { path: k.path, why: k.why, ours: k.ours ? path.join(dir, k.path) : null, server: put('server', k.theirs), base: put('base', k.base) };
  });
  return { wrong, conflicts };
}

// Коммит(ы) синхронизации через kit-commit.js (Р-16): по части путей на вызов, --push — у последней. → { code: 0, commit } |
// { code, lines }.
function commitEntry(dir, env, take, remoteName, argLimit, out) {
  const kind = new Map(take.map((it) => [it.path, it.kind]));
  const parts = byLength(take.map((it) => it.path), argLimit);
  let commit = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const msg = entrySubject(env, today(), part.length) + '\n\n' + part.map((p) => KIND[kind.get(p)] + ': ' + clean(p)).join('\n') + '\n';
    const push = remoteName && i === parts.length - 1 ? ['--push', remoteName] : [];
    // Пути — буквально: имя с «[» или «*» git иначе принял бы за маску.
    const r = spawnSync(process.execPath, [KIT_COMMIT, ...push, '--', ...part], {
      cwd: dir, input: msg, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1' },
    });
    const text = ((r.stdout || '') + (r.stderr || '')).trimEnd();
    if (r.status === 0 || r.status === 4) {
      commit = git(dir, ['rev-parse', 'HEAD']).out.trim();
      out.push(`Коммит синхронизации: ${git(dir, ['rev-parse', '--short', 'HEAD']).out.trim()} (${part.length} ${plural(part.length, 'файл', 'файла', 'файлов')})`);
      if (r.status === 4) out.push('коммит синхронизации не отправлен: ' + ((/kit-commit: не отправлено — (.+)$/m.exec(text) || [])[1] || lastLine(text)));
      continue;
    }
    const shown = text ? text.split('\n') : [];
    const again = 'файлы записаны и остались в pending — повтор prod-sync.js вернёт их к HEAD и заберёт заново';
    if (r.status === 1) {
      return { code: 1, lines: [...shown, 'kit-commit.js остановил коммит синхронизации (запрещённый путь или секрет в скачанном) — разбери с пользователем, как у шагов; ' + again] };
    }
    const what = r.status === 3 ? 'коммит синхронизации сделан, но не проверен' : 'коммит синхронизации не сделан';
    return { code: 4, lines: [...shown, `${what} (kit-commit.js, код ${r.status}) — ${again}; не проходит — скажи пользователю`] };
  }
  return { code: 0, commit };
}

// Основная папка годится для сверки из worktree (Р-39): есть, kit-проект, git с коммитами.
function usableHome(p) {
  try {
    return fs.statSync(p).isDirectory() && kitInfo(p).isKit && git(p, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok;
  } catch (e) {
    return false;
  }
}

// Синхронизация для тестов и main. opts: { check, env, timeoutMs, sessionId, argLimit, entryLimit, watchersOk, bigOk }.
// → { code, out: [строки], commit? (хеш последнего коммита синхронизации) }.
async function entry(dir, opts = {}) {
  const out = [];
  try {
    return await enter(dir, opts, out);
  } catch (e) {
    out.push('синхронизация не сделана: ' + e.message + ' — повтор prod-sync.js безопасен; не проходит — скажи пользователю');
    return { code: 4, out };
  }
}

async function enter(dir, opts, out) {
  const stop = (code, ...more) => {
    out.push(...more);
    return { code, out };
  };
  // Р-39: сессия в worktree сверяет основную папку — её параметры, базу, HEAD, рабочую копию и pending отметки: «есть что
  // забрать» значит «синхронизация в основной папке что-то сделает». Основная недоступна (нет, не git, не kit-проект) — своя,
  // как в 48.3. Отметка сессии (checked) — всегда в папке сессии (dir).
  const wt = mainFolder(dir);
  const home = wt !== null && usableHome(wt) ? wt : dir;
  const info = kitInfo(home);
  if (!info.isKit) return stop(2, 'синхронизировать не с чем: не kit-проект');
  const env = opts.env || serverEnv(info.params);
  const addrKey = env === 'дев' ? 'Дев' : 'Прод';
  const sshKey = 'SSH ' + env;
  if (!info.params.get(addrKey) && !info.params.get(sshKey)) return stop(2, `синхронизировать не с чем: сервер не задан (параметры «${addrKey}» и «${sshKey}» пусты)`);
  const target = serverSsh(info.params, env);
  if (!target) {
    const v = info.params.get(sshKey);
    if (!v) return stop(2, 'без SSH: синхронизация по FTP — шаг 48.5');
    return stop(2, `параметр «${sshKey}» неверный: ${v} — нужно хост:/абсолютная/папка`, 'исправь его через /kit:project-init или ' + ASK);
  }
  const b = entryBase(home, info, env);
  if (b.error) return stop(4, 'синхронизация не сделана: ' + b.error, 'скажи пользователю: синхронизация — после первого коммита исходников сайта (/kit:project-init); до того — ' + SKIP);
  out.push(`Сервер: ${env} — ${target.host}:${target.root}`, `База: ${git(home, ['rev-parse', '--short', b.base]).out.trim()} (${b.source})`);
  if (home !== dir) out.push('Сверка — по основной папке проекта: ' + home);

  const check = !!opts.check || wt !== null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT * 1000;
  const argLimit = opts.argLimit || ARG_LIMIT;
  const entryLimit = opts.entryLimit || ENTRY_LIMIT;
  const c = { dir: home, info, env, target, b, check, rules: skipRules(info), deadline: Date.now() + timeoutMs, timeoutSec: Math.round(timeoutMs / 1000) };
  const sid = opts.sessionId || process.env.KIT_SESSION_ID || lastNeed(dir) || null;
  const noMark = 'отметка не поставлена: хук не пустит правки — перезапусти сессию';
  const saveMark = (fn) => { // только обычная синхронизация: там home — папка сессии
    try {
      const m = readMark(home); // заново прямо перед записью: чужие записи сессий целы
      fn(m);
      writeMark(home, m);
      return null;
    } catch (e) {
      return stop(4, 'отметка синхронизации не записана: ' + e.message + ' — повтор prod-sync.js безопасен');
    }
  };
  const markDone = (result, commit) => {
    if (!sid) {
      out.push(noMark);
      return null;
    }
    try {
      markSession(dir, sid, result, commit);
      return null;
    } catch (e) {
      return stop(4, 'отметка синхронизации не записана: ' + e.message + ' — повтор prod-sync.js безопасен');
    }
  };

  // Р-14 п.1: прошлая синхронизация оборвалась после записи — её пути вернуть к HEAD (к забору шли только пути без наших
  // правок).
  const pendingBefore = readMark(home).pending;
  if (!check && pendingBefore.length) {
    restore(home, pendingBefore.filter((p) => safePath(p) && !matchRules(p, c.rules)), argLimit);
    const bad = saveMark((m) => { m.pending = []; });
    if (bad) return bad;
  }

  // Нет папки сайта на сервере — неверный «SSH <окружение>», повтор не поможет (М-9); остальное — связь: код 3.
  const failed = (why) => (why === NO_ROOT
    ? stop(2, `сверка не сделана: на сервере нет папки сайта ${target.root}`, `спроси пользователя: Проверить «${sshKey}» (/kit:project-init) / ${SKIP}`)
    : stop(3, 'сверка не сделана: ' + why + ' — повтор безопасен', ASK));
  const s = await survey(c);
  if (s.fail) return failed(s.fail);
  if (s.findFailed) out.push('find на сервере прочитал не всё — новые файлы в нечитаемых папках не сверены');
  const named = new Set(readMark(home).named);
  const each = [...s.each];
  // Строка (Р-33, Р-37): числа — забранное коммитом синхронизации (в --check — что синхронизация запишет); наши доработки —
  // только при непустом заборе (М-4); extra — merged, conflicts или conflictsAhead.
  const line = (take, extra = {}) => {
    const kindOf = (it) => (it.kind === 'added' ? 'added' : it.gone ? 'removed' : 'changed');
    const [changed, added, removed] = ['changed', 'added', 'removed'].map((k) => take.filter((it) => kindOf(it) === k).map((it) => it.path));
    const ours = changed.length || removed.length ? oursPaths(home) : new Set();
    const skipped = [...s.once.filter((it) => !named.has(it.path)), ...each].sort(byPath);
    return summaryLine({ env, changed, added, removed, ours: [...changed, ...removed].filter((p) => ours.has(p)).sort(), skipped, waiting: s.waiting, ...extra });
  };
  const takeSide = s.items.filter((it) => it.side === 'take');
  const mergeSide = s.items.filter((it) => it.side === 'merge');

  if (check) {
    // Р-39: план синхронизации без записи — неясные скачиваются, кандидаты на совмещение совмещаются в памяти; в проект ничего
    // не пишется. «Есть что забрать» — только то, что синхронизация запишет: забор и совмещённое ≠ рабочей копии; конфликт, М-6,
    // своё на сервере, совмещённое раньше и «не забирать» — названы, но не держат.
    const got = await collect(c, s, takeSide, false);
    if (got.fail) return failed(got.fail);
    const mp = await mergePlan(c, s, mergeSide);
    if (mp.fail) return failed(mp.fail);
    each.push(...got.each, ...mp.each);
    const writes = [...got.take, ...mp.merged.map((m) => ({ path: m.path, kind: 'changed', gone: false }))].sort(byPath);
    const sum = line(writes, { conflictsAhead: mp.conflicts.map((k) => k.path) });
    if (writes.length || readMark(home).pending.length) {
      return stop(1, sum, `есть изменения без kit — синхронизация в основной папке проекта (${wt || projectRoot(dir)})`);
    }
    return markDone('checked') || stop(0, sum);
  }

  // Р-40 (1): объём — по всем кандидатам (забор и совмещение), до любого скачивания; остановка по объёму — сразу и вотчеры по всем
  // кандидатам, одним вопросом.
  const sized = s.items.filter((it) => !it.gone);
  const big = opts.bigOk ? null : bigOf(sized, entryLimit);
  if (big) return stop(1, ...stopLines(opts.watchersOk ? null : watcherHits(home, sized.map((it) => it.path)), big, entryLimit));
  // (2) кандидатов на совмещение — скачать и совместить в памяти.
  const mp = await mergePlan(c, s, mergeSide);
  if (mp.fail) return failed(mp.fail);
  // (3) вотчеры — по тому, что синхронизация запишет: забор (кроме удалений) и совмещённое ≠ рабочей копии; до скачивания
  // остального забора и до любой записи — ничего не записано, отметка не меняется.
  if (!opts.watchersOk) {
    const w = watcherHits(home, [...takeSide.filter((it) => !it.gone).map((it) => it.path), ...mp.merged.map((m) => m.path)]);
    if (w.hits.length) return stop(1, ...stopLines(w, null, entryLimit));
  }
  // (4) забор: скачать, записать.
  const got = await collect(c, s, takeSide);
  if (got.fail) return failed(got.fail);
  each.push(...got.each, ...mp.each);
  const take = got.take;
  if (take.length) {
    // Р-14 п.4–6: pending до записи, удаления, запись через временный файл со сверкой md5.
    const bad = saveMark((m) => { m.pending = take.map((it) => it.path); });
    if (bad) return bad;
    for (const it of take) if (it.kind === 'removed') removeLocal(home, it.path);
    const files = take.filter((it) => it.data);
    writeFilesAtomic(files.map((it) => ({ file: path.join(home, it.path), text: it.data, label: it.path })), { mkdir: true });
    const wrong = files.filter((it) => md5(fs.readFileSync(path.join(home, it.path))) !== md5(it.data)).map((it) => clean(it.path));
    if (wrong.length) return stop(4, 'записано не то, что скачано (md5 не совпал): ' + wrong.join(', '), 'синхронизация не сделана — повтор prod-sync.js вернёт файлы к HEAD и заберёт заново');
  }
  // Совмещённое — в рабочую копию, мимо pending и коммита синхронизации (Р-26, Р-29); пишется до коммита — его остановка
  // совмещённое не откатывает (Р-34): повтор совместит заново с тем же результатом.
  const ap = applyMerges(home, mp, mergeSide);
  if (ap.wrong.length) return stop(4, 'записано не то, что совмещено (md5 не совпал): ' + ap.wrong.map(clean).join(', '), 'синхронизация не сделана — повтор prod-sync.js совместит заново');
  // Р-30: не совместилось — по каждому пути причина, наша, версии сервера и базы (временные файлы); конфликт — при каждой
  // синхронизации.
  const at = (v) => v || 'нет';
  const conflicts = ap.conflicts.length ? [`Не совместилось само — рабочая копия этих файлов не тронута (${ap.conflicts.length}):`,
    ...ap.conflicts.map((k) => `  ${clean(k.path)} — ${k.why}; наша — ${at(k.ours)}; сервера — ${at(k.server)}; база — ${at(k.base)}`)] : [];
  const merged = mp.merged.map((m) => m.path);
  let commit;
  if (take.length) {
    const r = commitEntry(home, env, take, info.params.get('Удалённый репозиторий') || null, argLimit, out);
    const kept = merged.length ? ['совмещённое с нашими правками осталось в рабочей копии: ' + listOf(merged)] : [];
    if (r.code) return stop(r.code, ...kept, ...conflicts, ...r.lines);
    commit = r.commit;
  }
  const bad = saveMark((m) => {
    m.pending = [];
    m.named = [...new Set(s.once.map((it) => it.path))].sort(); // названное один раз; исчезнувшее с сервера — забывается
  });
  if (bad) return bad;
  const unmarked = markDone('done', commit);
  if (unmarked) return unmarked;
  out.push(line(take, { merged, conflicts: ap.conflicts.map((k) => k.path) }));
  const done = commit ? { out, commit } : { out };
  if (!conflicts.length) return { code: 0, ...done };
  out.push(...conflicts,
    'синхронизация сделана, кроме этих файлов; спроси пользователя по каждому: Совместить вручную (правь рабочую копию по версии сервера) / ' +
    'Оставить нашу (при следующей синхронизации вопрос повторится, пока наша версия не залита) / Взять версию сервера (скопируй её в рабочую ' +
    'копию; «сервера — нет» — удали файл)');
  return { code: 1, ...done };
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.log('prod-sync: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const later = [['--skip', o.skip], ['--ftp-done', o.ftpDone], ['--hook', o.hook]].find(([, on]) => on);
  if (later) {
    console.log('prod-sync: режим ' + later[0] + ' — в шаге 48.5');
    return 4;
  }
  const cwd = process.cwd();
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  const dir = top.ok && top.out.trim() ? path.resolve(top.out.trim()) : cwd;
  const r = await entry(dir, { check: o.check, timeoutMs: o.timeout * 1000, watchersOk: o.watchersOk, bigOk: o.bigOk });
  console.log(r.out.join('\n'));
  return r.code;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
    console.log('prod-sync: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 4;
  });
}
module.exports = { parseArgs, entry, main };
