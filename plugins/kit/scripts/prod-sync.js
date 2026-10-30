#!/usr/bin/env node
'use strict';
// Синхронизация с продом (этап 48): сайт на сервере сверяется с git по SSH (без SSH — по скачанному по FTP, ниже) — что там
// изменили, добавили и удалили без kit, забирается в рабочую копию байт в байт и коммитится коммитом синхронизации
// (kit-commit.js, без просмотра и вопросов: прод главный). Запускается только по просьбе пользователя (/kit:sync): ни хуков, ни
// записей сессий.
//   node prod-sync.js [--timeout сек]           синхронизация: сверка, забор, коммит синхронизации; в отметке — named и
//                                               pending = []
//   node prod-sync.js --check [--timeout сек]   план синхронизации без записи (исполнитель Мэтта; сессия в worktree — всегда
//                                               так, и сверяется основная папка проекта): файлы, индекс и отметка не меняются
//   node prod-sync.js --abort [--timeout сек]   отмена незаконченной синхронизации (Т-10): пути pending — к HEAD (и их
//                                               временные *.kit-tmp), кроме изменённых после остановки; новый файл из
//                                               скачанного по FTP (pending с ftp, нет в HEAD) не удаляется — снимается с
//                                               индекса и называется (Р-85); pending = []; к серверу не подключается; наши
//                                               правки и совмещённое не трогает (их в pending нет); в worktree — «отменять
//                                               нечего»; автозаливка PhpStorm Always — код 1 до любой записи (Р-84)
//   --watchers-ok — забирать, хотя среди забираемого исходники File Watchers при PhpStorm Always; --big-ok — забирать больше
//   50 МБ за раз; --delete-ok — удалять у нас, хотя на сервере нет многих файлов сайта (Р-83); --abort с --check, --ftp-done,
//   --watchers-ok, --big-ok, --dirty-ok, --delete-ok — код 4
// Вне синхронизации (Т-4, Р-83; по SSH и без SSH — syncRules из lib/prod.js): не файлы сайта (ALWAYS_SKIP, «Не выкладывать»),
// служебные файлы git (.gitignore, .gitattributes в любой папке) и исключённое у сервера автозаливки PhpStorm — не сверяются, не
// забираются, не удаляются, не восстанавливаются. Р-88: при «Выкладка: Claude по SSH» исключённое в PhpStorm заливает
// ssh-deploy.js — оно сверяется как файлы сайта, но нет на сервере — у нас не удаляется («Оставлено у нас», один раз — named).
// По SSH на сервере нет больше 20 файлов сайта и больше 10 % отслеживаемых — до любой записи код 1 (неверный «SSH <окружение>»
// или переналитый сайт), без --delete-ok ничего не удаляется. Повтор с непустым pending по SSH откатывает его к HEAD — при
// PhpStorm Always откат уехал бы на сервер: код 1 до любой записи (Р-84).
// Без SSH (Т-9, 48.8): адрес сервера задан («Прод» / «Дев»), «SSH <окружение>» пуст — lib/prod-ftp.js.
//   node prod-sync.js [--check] [--dirty-ok]   ничего не пишет: незаконченная синхронизация — «Повторить / Отменить»;
//                                               правки файлов сайта в рабочей копии (Р-60) — скачивание затрёт их, «Скачаю
//                                               всё равно (--dirty-ok) / Отложить»; иначе корни для скачивания по FTP в PhpStorm
//                                               — «Скачал (--ftp-done) / Не буду скачивать»
//   node prod-sync.js --ftp-done [--big-ok]     разбор скачанного: «сервер» — файлы сайта на диске, правила Т-5 те же;
//                                               изменённое и добавленное без нас — в коммит синхронизации; наше незалитое,
//                                               вернувшееся к базе, — из HEAD; совмещение: наша — HEAD, их — скачанное;
//                                               конфликт — рабочая копия = HEAD, скачанное — во временную папку; не забираемое
//                                               отслеживаемое — к HEAD; «Не выкладывать» не трогается (Р-72); чего нет в HEAD
//                                               (новое не забираемое, ждущее удаления), не удаляется (Р-68). pending прошлой
//                                               остановки к HEAD не откатывается (Р-61); автозаливка PhpStorm Always — код 1
//                                               до любой записи (Р-70); File Watchers не проверяются, --watchers-ok ничего не
//                                               меняет (Р-62); удалённые на сервере и новые вне скачанных папок не видны.
//   --ftp-done с --check или при заданном «SSH <окружение>» — код 4; сессия в worktree — код 1, синхронизация без SSH — в
//   основной папке (Р-64)
// Папка проекта — корень git текущей папки; сервер — «Окружение» (прод или дев), куда — «SSH прод» / «SSH дев». Три версии
// файла (база, HEAD, сервер) и правила без SSH — lib/prod.js; сценарии для сервера и разбор их ответа — lib/prod-ssh.js. Сверка —
// одним подключением, сценарием sh на stdin: состояние, md5 и размер отслеживаемых файлов (пачкой, без процесса на файл) и
// список остальных с размером (find без того, что точно исключает .gitignore); md5 сервера сравнивается у нас с вариантами
// blob (CRLF и LF — одна версия), неясное скачивается. Наши незакоммиченные правки (Т-8): сервер = рабочая копия — наше уже на
// сервере, не трогаем; менялось и у нас, и без нас — совмещение (git merge-file) в рабочую копию, мимо коммита синхронизации;
// не совместилось — рабочая копия не тронута, версия сервера — во временной папке. Порядок (Р-40): больше 50 МБ за раз —
// остановка до любого скачивания; кандидаты на совмещение скачиваются и совмещаются в памяти; File Watchers при PhpStorm
// Always — остановка по тому, что синхронизация запишет, до записи; затем забор. Скачанное пишется через временный файл; пути
// забора до записи — в pending отметки (.claude/kit-prod.json) с md5 записываемого: повтор вернёт их к HEAD и доведёт
// синхронизацию до конца, отмена (--abort) — вернёт к HEAD; файл, изменённый после остановки (на диске не записанное и не
// HEAD), оба не трогают (Р-57). Много путей — несколько коммитов синхронизации подряд; закоммиченная часть уходит из pending.
// Файл с секретом (Т-11): скачанное для забора и версия сервера совмещаемого до записи проверяются secretPaths (lib/prod.js:
// secretFindings из secret-scan.js — те же находки, что у --cached в kit-commit.js); находка — путь не пишется, не совмещается, не коммитится и
// называется один раз (named). Файл забора и «наша» совмещаемого пишутся, только если на диске то, что видела сверка
// (Р-58); иначе — «изменён во время синхронизации», каждый раз.
// Коды: 0 — синхронизация сделана (или нечего забирать; с --check — синхронизация ничего не запишет; с --abort — отменено или
// отменять нечего); 1 — нужен ответ пользователя (не совместилось — синхронизация сделана без этих файлов; File Watchers,
// больше 50 МБ, на сервере нет многих файлов сайта, откат при автозаливке Always — ничего не записано; остановка после записи — kit-commit.js не сделал или не проверил коммит, записано не то,
// что скачано: «Повторить / Отменить»; записано не то, что совмещено, а забора не было — «Повторить / Отложить»; с --check —
// есть что забрать; без SSH до скачивания — всегда: правки, список корней или незаконченная синхронизация; worktree без
// SSH); 2 — синхронизировать не с чем, параметр неверный или на сервере нет папки сайта; 3 — нет подключения, обрыв, вышло
// время («Повторить / Отложить»); 4 — аргументы, git, отметка не записана. Весь вывод — в stdout; последняя строка — итог для
// пользователя (код 0) или что делать Claude.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { kitInfo, serverEnv } = require('./lib/project');
const { matchRules, safePath } = require('./lib/paths');
const { serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { git } = require('./lib/deploy');
const { projectRoot } = require('./lib/matt');
const { writeFilesAtomic } = require('./lib/atomic');
const { NO_ROOT, pruneRules, listScript, parseList, fetchScript, parseFetch } = require('./lib/prod-ssh');
const { ftpRoots, ftpDirty, dirtyLines, rootLines, ftpSurvey, ftpPlan, autoUpload, alwaysStop, ALWAYS_STOP } = require('./lib/prod-ftp');
const {
  ENTRY_LIMIT, UNKNOWN_SIZE, SKIP, REGULAR, plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, oursPaths,
  pendingDelete, pendingEntry, ignoredOf, dirtyPaths, readWork, mergeVersions, listOf, summaryLine, readMark, writeMark, hasMd5, readText, clean,
  takeRule, watcherHits, bigOf, stopLines, conflictDir, md5Eol, catBlobs, blobHashes, blobVariants, secretPaths, syncRules, ideaKeep,
} = require('./lib/prod');

const USAGE = 'Использование: node prod-sync.js [--check] [--watchers-ok] [--big-ok] [--delete-ok] [--dirty-ok] [--timeout сек] | ' +
  '--ftp-done [--big-ok] [--timeout сек] | --abort [--timeout сек]';
// Меньше предела инструмента Bash (120 с): зависший сервер — код 3, а не оборванный вызов. Срок — общий на все подключения
// синхронизации.
const DEFAULT_TIMEOUT = 100;
// Пути одного вызова kit-commit.js: сумма длин плюс 3 знака на путь (предел командной строки Windows — 32 767 на весь вызов,
// а kit-commit.js передаёт те же пути в git).
const ARG_LIMIT = 24000;
const FETCH_LIMIT = 16 * 1024 * 1024; // скачивание за одно подключение — по размеру файлов
const KIT_COMMIT = path.join(__dirname, 'kit-commit.js');
// Не дошло до записи (нет связи, обрыв, вышло время) — повторить или отложить.
const ASK = 'спроси пользователя: Повторить / ' + SKIP;
// Остановка после записи (Т-10, Р-51): pending остаётся — по нему работают и повтор, и отмена.
const AGAIN = 'спроси пользователя: Повторить / Отменить (`prod-sync.js --abort`)';
const KEPT = 'записанное синхронизацией — в pending: «Повторить» вернёт эти файлы к HEAD и доведёт синхронизацию до конца, ' +
  '«Отменить» вернёт их к HEAD; изменённые после остановки, наши правки и совмещённое оба ответа не тронут';
// Те же ответы без SSH (Р-61): повтор — с --ftp-done, и pending к HEAD он не откатывает (на диске — скачанное).
const TAIL = {
  ssh: { ask: ASK, again: AGAIN, kept: KEPT },
  ftp: {
    ask: 'спроси пользователя: Повторить (`prod-sync.js --ftp-done`) / ' + SKIP,
    again: 'спроси пользователя: Повторить (`prod-sync.js --ftp-done`) / Отменить (`prod-sync.js --abort`)',
    kept: 'забираемое из скачанного — в pending: «Повторить» разберёт скачанное заново, без отката к HEAD, «Отменить» вернёт ' +
      'забираемое отслеживаемое к HEAD, а новые файлы оставит в рабочей копии; изменённые после остановки, восстановленное из ' +
      'HEAD и совмещённое оба ответа не тронут',
  },
};
const NOTHING = '[kit] Отменять нечего: незаконченной синхронизации нет';
const SECRET_WHY = 'секрет — заливка нашей правки этого файла затрёт серверную'; // Т-11: называется один раз
const MOVED_WHY = 'изменён во время синхронизации — повтори'; // файл поменялся до записи забора или совмещённого: каждый раз
const UNTOUCHED_WHY = 'изменён после остановки синхронизации — не тронут'; // Р-57: отмена и повтор его не откатывают
const LEFT_WHY = 'новый файл оставлен в рабочей копии — удали сам, если не нужен'; // Р-85: его положило скачивание по FTP
const ROLLBACK_WHY = 'откат к git уйдёт на сервер'; // Р-84: автозаливка Always — повтор с откатом и отмена не идут
const IDEA_KEPT_WHY = 'нет на сервере — не удалён: исключён в PhpStorm'; // Р-88: «Claude по SSH», называется один раз
const KIND = { changed: 'изменён', added: 'добавлен', removed: 'удалён' };
// Р-83: на сервере нет больше MASS_DELETE файлов сайта и больше MASS_SHARE отслеживаемых — до записи вопрос, а не удаление у нас
const MASS_DELETE = 20;
const MASS_SHARE = 0.1;

const FLAGS = {
  '--check': 'check', '--ftp-done': 'ftpDone', '--abort': 'abort', '--watchers-ok': 'watchersOk', '--big-ok': 'bigOk', '--dirty-ok': 'dirtyOk',
  '--delete-ok': 'deleteOk',
};
// Флаги ответа запуска по SSH — для «повторить» в вопросе (Р-84): те же, что у этого запуска, в порядке USAGE.
const flagsOf = (o) => [['watchersOk', '--watchers-ok'], ['bigOk', '--big-ok'], ['deleteOk', '--delete-ok']]
  .filter(([k]) => o[k]).map(([, f]) => ' ' + f).join('');

function parseArgs(argv) {
  const o = { check: false, ftpDone: false, abort: false, watchersOk: false, bigOk: false, dirtyOk: false, deleteOk: false, timeout: DEFAULT_TIMEOUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (Object.prototype.hasOwnProperty.call(FLAGS, a)) o[FLAGS[a]] = true;
    else if (a === '--timeout') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 600) throw new Error('--timeout: секунды, от 1 до 600');
      o.timeout = Number(v);
    } else throw new Error('неизвестный аргумент ' + a);
  }
  // Р-53: отмена ничего не сверяет и не забирает — с режимами синхронизации не сочетается
  if (o.abort && (o.check || o.ftpDone || o.watchersOk || o.bigOk || o.dirtyOk || o.deleteOk)) throw new Error('--abort — только сам или с --timeout');
  // Р-65: разбор скачанного пишет — со сверкой без записи не сочетается
  if (o.ftpDone && o.check) throw new Error('--ftp-done — без --check: разбор скачанного записывает и коммитит');
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

// Версия файла рабочей копии: md5 без \r; нет файла — null.
function diskVer(dir, rel) {
  const b = readWork(dir, rel);
  return b === null ? null : md5NoCr(b);
}

// Откат незаконченной синхронизации (отмена и повтор, Т-12, Р-57): entries — элементы pending. К HEAD — путь, на диске у которого
// то, что записала синхронизация (md5 из pending), или уже версия HEAD (не успела записать); элемент без md5 (первая
// редакция) — к HEAD, как прежде. Иначе файл изменили после остановки: не трогать, только снять из индекса поставленное туда
// kit-commit.js (git reset — рабочая копия цела), назвать. Р-85: новый файл из разбора скачанного по FTP (ftp, нет в HEAD) на
// диске — его положило скачивание, а не синхронизация: не удалять, только снять из индекса, назвать (left; изменён после
// остановки — kept, как прочие). Временные файлы записи — убрать у всех (М-7). → { back, kept, left }.
async function rollback(dir, entries, argLimit) {
  const head = treeOf(dir, 'HEAD');
  const oidOf = (p) => (head.has(p) && REGULAR.has(head.get(p).mode) ? head.get(p).oid : null);
  const blobs = await blobHashes(dir, [...new Set(entries.filter(hasMd5).map((e) => oidOf(e.path)).filter(Boolean))]);
  const back = [];
  const kept = [];
  const left = [];
  for (const e of entries) {
    if (!hasMd5(e)) {
      back.push(e.path);
      continue;
    }
    const disk = diskVer(dir, e.path);
    const oid = oidOf(e.path);
    const headVer = !head.has(e.path) ? null : oid ? blobs.get(oid).noCr : undefined;
    if (e.ftp && !head.has(e.path) && disk !== null) (disk === e.md5 ? left : kept).push(e.path);
    else (disk === e.md5 || disk === headVer ? back : kept).push(e.path);
  }
  restore(dir, back, argLimit);
  const unstage = [...kept, ...left];
  for (const p of unstage) dropTmp(dir, p);
  for (const part of byLength(unstage, argLimit)) {
    const r = git(dir, ['--literal-pathspecs', 'reset', '-q', '--', ...part]);
    if (!r.ok) throw new Error('git reset: ' + r.err);
  }
  return { back, kept, left };
}

// «a.php (изменён после остановки синхронизации — не тронут), …» — для строки отмены и повтора (Р-57).
const untouched = (paths) => listOf(paths, (p) => clean(p) + ' (' + UNTOUCHED_WHY + ')');
// «n.php (новый файл оставлен в рабочей копии — удали сам, если не нужен), …» (Р-85).
const leftNew = (paths) => listOf(paths, (p) => clean(p) + ' (' + LEFT_WHY + ')');

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
// judge(путь, версия сервера), work — наши правки (null — кандидатов нет), baseOid(путь) и headOid(путь) — blob базы и HEAD
// или null, headVer(путь) — версия HEAD (md5 без \r; нет в HEAD — null), total — сколько файлов сайта сверено как отслеживаемые
// (HEAD ∪ база; Р-83) }. Файлы сайта — не под c.rules (syncRules).
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
  const rule = takeRule(c.info);
  const win = process.platform === 'win32';
  const spell = new Map(); // нижний регистр → написания
  if (win) {
    for (const p of [...known, ...(work ? work.status : []), ...left.filter((it) => it.kind === 'added').map((it) => it.path)]) {
      const k = p.toLowerCase();
      if (!spell.has(k)) spell.set(k, new Set());
      spell.get(k).add(p);
    }
  }
  const whyNot = (it) => (win && it.kind === 'added' && spell.get(it.path.toLowerCase()).size > 1 ? 'недопустимое имя' : rule(it.path, it.size));
  // Сторона: совмещение — наша правка, merge или неясный при HEAD ≠ базе (по содержимому станет merge или «ничего»); остальное —
  // забор (неясный при HEAD = базе станет забором или «ничего»).
  const side = (it) => (work.dirty(it.path) || it.kind === 'merge' || (it.kind === 'unclear' && ver(headF.get(it.path)) !== ver(baseF.get(it.path)))
    ? 'merge' : 'take');
  const once = [];
  const keep = [];
  const ideaKept = c.ideaKeep || (() => false);
  for (const it of left) {
    // Р-88: при «Claude по SSH» путь под Excluded Paths PhpStorm, которого нет на сервере, — не удаление и не конфликт «удалён на
    // сервере»: у нас не удаляется, называется один раз (named)
    if (it.gone && ideaKept(it.path)) {
      once.push({ path: it.path, why: IDEA_KEPT_WHY, kept: true });
      continue;
    }
    const why = whyNot(it);
    const blocked = why ? null : blockedOnDisk(dir, it.path);
    if (why) once.push({ path: it.path, why });
    else if (blocked) each.push({ path: it.path, why: blocked });
    else keep.push({ ...it, side: side(it) });
  }
  return {
    items: keep.sort(byPath), once, each, waiting: [...waiting].sort(), findFailed: list.findFailed, judge, work,
    baseOid: (p) => baseF.get(p) || null, headOid: (p) => headF.get(p) || null, headVer: (p) => ver(headF.get(p)), total: tracked.length,
  };
}

// Забор: скачать (кроме удалённых на сервере; pick — что скачать, без него — всё: --check скачивает только неясные и названные
// раньше) и разобрать по содержимому (Р-13): неясный решается точно, изменённый мог смениться после сверки, вернувшийся к базе —
// не забирается; скачанное с секретом (Т-11) — не забирается. → { fail } | { take: [{ path, kind: changed | added | removed, size,
// gone, data }], each: [{ path, why }], secret: [{ path, why }] }.
async function collect(c, s, items, pick = null) {
  const want = (it) => !it.gone && (!pick || pick(it));
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
  const bad = await secretPaths(c, s, take);
  return { take: take.filter((it) => !bad.has(it.path)), each, secret: [...bad].map((p) => ({ path: p, why: SECRET_WHY })) };
}

// Совмещение в памяти (Р-29, Р-39, Р-40): скачать кандидатов (кроме удалённых на сервере) и совместить во временной папке вне
// проекта — в проект ничего не пишется. Наша — файл с диска, база — blob известного состояния сервера, их — скачанное. Сервер =
// рабочая копия без \r — наше уже на сервере; сервер вернулся к базе или к HEAD — ничего; версия сервера с секретом (Т-11) —
// не совмещается и в папку конфликтов не пишется; результат равен нашей — совмещено раньше. → { fail } | { merged: [{ path,
// result, ours }] — синхронизация запишет (ours — «наша», с которой совмещено), conflicts: [{ path, why, ours, theirs, base }] —
// версии (Buffer | null), each: [{ path, why }], secret: [{ path, why }] }.
async function mergePlan(c, s, items) {
  const merged = [];
  const conflicts = [];
  const each = [];
  const secret = [];
  if (!items.length) return { merged, conflicts, each, secret };
  const got = await download(c, items.filter((it) => !it.gone));
  if (got.fail) return got;
  const bases = new Map();
  await catBlobs(c.dir, [...new Set(items.map((it) => s.baseOid(it.path)).filter(Boolean))], (oid, buf) => bases.set(oid, Buffer.from(buf)));
  const bad = await secretPaths(c, s, [...got.data].map(([p, data]) => ({ path: p, data })));
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
    if (theirs && bad.has(it.path)) {
      secret.push({ path: it.path, why: SECRET_WHY });
      continue;
    }
    const ours = readWork(c.dir, it.path);
    const oid = s.baseOid(it.path);
    const base = oid ? bases.get(oid) : null;
    const r = mergeVersions({ ours, base, theirs });
    if (r.conflict) conflicts.push({ path: it.path, why: r.conflict, ours, theirs, base });
    else if (r.result && !(ours && r.result.equals(ours))) merged.push({ path: it.path, result: r.result, ours });
  }
  return { merged, conflicts, each, secret };
}

// Запись совмещения (Р-29, Р-30): временные файлы записи у кандидатов на совмещение (cands) — убрать (М-7); совмещённое — только
// если файл на диске всё ещё та «наша», с которой совмещено (пользователь мог сохранить его, пока скачивался забор: иначе его
// правка затёрлась бы), через временный файл со сверкой md5; конфликтам — версии сервера и базы во временную папку вне проекта
// (conflictDir: её читает Claude, убирает следующий конфликт). → { written: [путь], moved: [путь — «наша» поменялась, не
// записан], wrong: [путь — md5 не совпал], conflicts: [{ path, why, ours, server, base }] — полные пути или null }.
function applyMerges(dir, mp, cands) {
  for (const it of cands) dropTmp(dir, it.path);
  const ready = [];
  const moved = [];
  for (const m of mp.merged) {
    const now = readWork(dir, m.path);
    if (now && now.equals(m.ours)) ready.push(m);
    else moved.push(m.path);
  }
  const writes = ready.map((m) => ({ file: path.join(dir, m.path), text: m.result, label: m.path }));
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
  return { written: ready.map((m) => m.path), moved, wrong, conflicts };
}

// Коммит(ы) синхронизации через kit-commit.js (Р-16): по части путей на вызов, --push — у последней; после каждой
// закоммиченной части — onPart(её пути) (М-1: убрать их из pending). → { code: 0, commit } | { code: 1, lines } — остановка
// после записи (Р-51): вывод kit-commit.js, причина, «Повторить / Отменить» (t — ответы по SSH или без SSH, TAIL).
function commitEntry(dir, env, take, remoteName, argLimit, out, onPart, t = TAIL.ssh) {
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
      onPart(part);
      continue;
    }
    const shown = text ? text.split('\n') : [];
    const why = r.status === 1
      ? 'kit-commit.js остановил коммит синхронизации (запрещённый путь или секрет в скачанном) — разбери с пользователем, как у шагов; ' +
        '«Повторить» поможет, только если файл на сервере поправят'
      : r.status === 3
        ? 'коммит синхронизации сделан, но не проверен (kit-commit.js, код 3) — историю не чинить (без amend, reset и revert): ' +
          'повтор и отмена коммит не трогают'
        : `коммит синхронизации не сделан (kit-commit.js, код ${r.status})`;
    return { code: 1, lines: [...shown, why, t.kept, t.again] };
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

// Отмена незаконченной синхронизации (Т-10, Р-53): пути pending — к HEAD (rollback: и из индекса, и временные файлы записи),
// изменённое после остановки — не тронуто и названо (Р-57), новый файл из скачанного по FTP — оставлен и назван (Р-85); pending =
// [], named не трогается. К серверу не подключается; наших правок и совмещённого в pending нет — они целы. Р-84: при автозаливке
// PhpStorm Always возврат к HEAD уехал бы на сервер — код 1 до любой записи (и отметка не тронута).
async function abortSync(dir, info, argLimit, out) {
  const { pending } = readMark(dir);
  if (!pending.length) {
    out.push(NOTHING);
    return { code: 0, out };
  }
  const rules = syncRules(dir, info);
  const undo = pending.filter((e) => safePath(e.path) && !matchRules(e.path, rules));
  if (undo.length && autoUpload(dir)) {
    out.push(...alwaysStop('prod-sync.js --abort', ROLLBACK_WHY));
    return { code: 1, out };
  }
  let r;
  try {
    r = await rollback(dir, undo, argLimit);
    const m = readMark(dir); // заново прямо перед записью
    m.pending = [];
    writeMark(dir, m);
  } catch (e) {
    out.push('отмена не сделана: ' + e.message + ' — повтор prod-sync.js --abort безопасен; не проходит — скажи пользователю');
    return { code: 4, out };
  }
  const n = r.back.length;
  const said = `[kit] Синхронизация отменена: к HEAD ${plural(n, 'возвращён', 'возвращено', 'возвращено')} ${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
  out.push([said, ...(r.kept.length ? [untouched(r.kept)] : []), ...(r.left.length ? [leftNew(r.left)] : [])].join('; '));
  return { code: 0, out };
}

// Остановка: строки — в out. → { code, out }.
const stopper = (out) => (code, ...more) => {
  out.push(...more);
  return { code, out };
};

// Запись отметки — прочитанной заново прямо перед записью; только синхронизация с записью: --check и worktree отметку не
// пишут (Р-52). → null | { code: 4, out }.
const markSaver = (home, stop) => (fn) => {
  try {
    const m = readMark(home);
    fn(m);
    writeMark(home, m);
    return null;
  } catch (e) {
    return stop(4, 'отметка синхронизации не записана: ' + e.message + ' — повтор prod-sync.js безопасен');
  }
};

// Базы синхронизации нет (не git, нет коммитов) — код 4; последняя строка — что делать Claude (М-9).
const noBase = (b) => ['синхронизация не сделана: ' + b.error,
  'скажи пользователю: синхронизация — после первого коммита исходников сайта (/kit:project-init); до того — ' + SKIP];

// Строка (Р-33, Р-37): числа — забранное коммитом синхронизации (в --check — что синхронизация запишет); наши доработки — только
// при непустом заборе (М-4); extra — merged, conflicts или conflictsAhead. once и each читаются при вызове (их дополняют после
// скачивания; once с local — без SSH: новое, что лежит в рабочей копии, Р-68; once с kept — нет на сервере, у нас не удалено,
// Р-88). x: { home, env, once, each, named, waiting, ftp —
// без SSH: фраза об удалённых на сервере (Р-67) }.
const lineOf = (x) => (take, extra = {}) => {
  const kindOf = (it) => (it.kind === 'added' ? 'added' : it.gone ? 'removed' : 'changed');
  const [changed, added, removed] = ['changed', 'added', 'removed'].map((k) => take.filter((it) => kindOf(it) === k).map((it) => it.path));
  const ours = changed.length || removed.length ? oursPaths(x.home) : new Set();
  const fresh = x.once.filter((it) => !x.named.has(it.path));
  const skipped = [...fresh.filter((it) => !it.local && !it.kept), ...x.each].sort(byPath);
  return summaryLine({
    env: x.env, changed, added, removed, ours: [...changed, ...removed].filter((p) => ours.has(p)).sort(), skipped,
    kept: fresh.filter((it) => it.kept).sort(byPath), local: fresh.filter((it) => it.local).sort(byPath), waiting: x.waiting, ftp: x.ftp, ...extra,
  });
};

const CONFLICT_ASK = 'синхронизация сделана, кроме этих файлов; спроси пользователя по каждому: Совместить вручную (правь рабочую копию по ' +
  'версии сервера) / Оставить нашу (при следующей синхронизации вопрос повторится, пока наша версия не залита) / Взять версию сервера ' +
  '(скопируй её в рабочую копию; «сервера — нет» — удали файл)';

// Хвост синхронизации — по SSH и без SSH, после записи забора. Совмещённое — в рабочую копию, мимо pending и коммита
// синхронизации (Р-26, Р-29); пишется до коммита — его остановка совмещённое не откатывает (Р-34): повтор совместит заново с тем
// же результатом. «Наша» поменялась после чтения — не пишется, называется каждый раз. Затем коммит(ы) синхронизации, отметка
// (pending = [], named), строка и вопрос по конфликтам. x: { home, env, info, argLimit, out, st, stop, saveMark, each, once, line,
// take, mp, cands — кандидаты на совмещение, ftp }.
function finish(x) {
  const { home, out, stop, take } = x;
  const t = x.ftp ? TAIL.ftp : TAIL.ssh;
  const ap = applyMerges(home, x.mp, x.cands);
  x.each.push(...ap.moved.map((p) => ({ path: p, why: MOVED_WHY })));
  if (ap.wrong.length) {
    // М-2: забора не было — pending пуст, отменять нечего
    return stop(1, 'записано не то, что совмещено (md5 не совпал): ' + ap.wrong.map(clean).join(', ') +
      ' — проверь эти файлы вручную: в них наши правки; повтор совместит заново', ...(take.length ? [t.kept, t.again] : [t.ask]));
  }
  // Р-30: не совместилось — по каждому пути причина, наша, версии сервера и базы (временные файлы); конфликт — при каждой
  // синхронизации. Без SSH рабочая копия конфликтного файла — HEAD (скачанное — во временной папке).
  const at = (v) => v || 'нет';
  const conflicts = ap.conflicts.length ? [`Не совместилось само — рабочая копия этих файлов ${x.ftp ? '— как в HEAD' : 'не тронута'} (${ap.conflicts.length}):`,
    ...ap.conflicts.map((k) => `  ${clean(k.path)} — ${k.why}; наша — ${at(k.ours)}; сервера — ${at(k.server)}; база — ${at(k.base)}`)] : [];
  const merged = ap.written;
  let commit;
  if (take.length) {
    // М-1: закоммиченная часть — из pending сразу (отмена после сбоя следующей части вернёт к HEAD только незакоммиченное)
    const onPart = (part) => {
      const done = new Set(part);
      const m = readMark(home);
      m.pending = m.pending.filter((e) => !done.has(e.path));
      writeMark(home, m);
    };
    const r = commitEntry(home, x.env, take, x.info.params.get('Удалённый репозиторий') || null, x.argLimit, out, onPart, t);
    const kept = merged.length ? ['совмещённое с нашими правками осталось в рабочей копии: ' + listOf(merged)] : [];
    if (r.code) return stop(r.code, ...kept, ...conflicts, ...r.lines);
    commit = r.commit;
  }
  const bad = x.saveMark((m) => {
    m.pending = [];
    m.named = [...new Set(x.once.map((it) => it.path))].sort(); // названное один раз; исчезнувшее с сервера — забывается
  });
  if (bad) return bad;
  x.st.written = false;
  out.push(x.line(take, { merged, conflicts: ap.conflicts.map((k) => k.path) }));
  const done = commit ? { out, commit } : { out };
  if (!conflicts.length) return { code: 0, ...done };
  out.push(...conflicts, CONFLICT_ASK);
  return { code: 1, ...done };
}

// Синхронизация (и отмена) для тестов и main. opts: { check, abort, ftpDone, dirtyOk, env, timeoutMs, argLimit, entryLimit,
// watchersOk, bigOk, deleteOk }. → { code, out: [строки], commit? (хеш последнего коммита синхронизации) }.
async function entry(dir, opts = {}) {
  const out = [];
  // written — пути забора уже в pending, запись началась (до отметки с pending = []); ftp — разбор скачанного (--ftp-done)
  const st = { written: false, ftp: false };
  try {
    return await enter(dir, opts, out, st);
  } catch (e) {
    const t = st.ftp ? TAIL.ftp : TAIL.ssh;
    // Р-51: остановка после записи — по pending работают и повтор, и отмена
    if (st.written) {
      out.push('синхронизация остановилась после записи: ' + e.message, t.kept, t.again);
      return { code: 1, out };
    }
    out.push('синхронизация не сделана: ' + e.message + ' — повтор prod-sync.js' + (st.ftp ? ' --ftp-done' : '') +
      ' безопасен; не проходит — скажи пользователю');
    return { code: 4, out };
  }
}

async function enter(dir, opts, out, st) {
  const stop = stopper(out);
  // Р-39: сессия в worktree сверяет основную папку — её параметры, базу, HEAD, рабочую копию и pending отметки: «есть что
  // забрать» значит «синхронизация в основной папке что-то сделает». Основная недоступна (нет, не git, не kit-проект) — своя,
  // как в 48.3. Р-52: --check и worktree ничего не пишут — ни файлов, ни отметки.
  const wt = mainFolder(dir);
  // Р-53: в worktree синхронизация не пишет — отменять в нём нечего; основная папка не трогается
  if (opts.abort && wt !== null) return stop(0, NOTHING);
  const home = wt !== null && usableHome(wt) ? wt : dir;
  const info = kitInfo(home);
  if (!info.isKit) return stop(2, 'синхронизировать не с чем: не kit-проект');
  const argLimit = opts.argLimit || ARG_LIMIT;
  if (opts.abort) return abortSync(home, info, argLimit, out);
  const env = opts.env || serverEnv(info.params);
  const addrKey = env === 'дев' ? 'Дев' : 'Прод';
  const sshKey = 'SSH ' + env;
  if (!info.params.get(addrKey) && !info.params.get(sshKey)) return stop(2, `синхронизировать не с чем: сервер не задан (параметры «${addrKey}» и «${sshKey}» пусты)`);
  // Р-65: «SSH <окружение>» задан — синхронизация по SSH, скачанное по FTP не разбирается
  if (opts.ftpDone && info.params.get(sshKey)) return stop(4, 'есть SSH — синхронизация по SSH, без --ftp-done');
  const target = serverSsh(info.params, env);
  if (!target) {
    const v = info.params.get(sshKey);
    if (!v) return ftpEnter(home, wt, info, env, opts, out, st);
    return stop(2, `параметр «${sshKey}» неверный: ${v} — нужно хост:/абсолютная/папка`, 'исправь его через /kit:project-init или ' + ASK);
  }
  const b = entryBase(home, info, env);
  if (b.error) return stop(4, ...noBase(b));
  out.push(`Сервер: ${env} — ${target.host}:${target.root}`, `База: ${git(home, ['rev-parse', '--short', b.base]).out.trim()} (${b.source})`);
  if (home !== dir) out.push('Сверка — по основной папке проекта: ' + home);

  const check = !!opts.check || wt !== null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT * 1000;
  const entryLimit = opts.entryLimit || ENTRY_LIMIT;
  const c = {
    dir: home, info, env, target, b, check, rules: syncRules(home, info), ideaKeep: ideaKeep(home, info), secrets: info.params.list('Секреты'),
    deadline: Date.now() + timeoutMs, timeoutSec: Math.round(timeoutMs / 1000),
  };
  const saveMark = markSaver(home, stop);

  // Р-14 п.1: прошлая синхронизация оборвалась после записи — её пути вернуть к HEAD (к забору шли только пути без наших
  // правок). Р-57: изменённое после остановки не трогается и дальше сверяется как наша правка. Р-84: при автозаливке PhpStorm
  // Always откат уехал бы на сервер поверх правки клиента — код 1 до любой записи и до подключения.
  const pendingBefore = readMark(home).pending;
  if (!check && pendingBefore.length) {
    const undo = pendingBefore.filter((e) => safePath(e.path) && !matchRules(e.path, c.rules));
    if (undo.length && autoUpload(home)) return stop(1, ...alwaysStop('prod-sync.js' + flagsOf(opts), ROLLBACK_WHY));
    const { kept, left } = await rollback(home, undo, argLimit);
    const bad = saveMark((m) => { m.pending = []; });
    if (bad) return bad;
    if (kept.length) out.push('Повтор после остановки: ' + untouched(kept) + '; дальше — как наша правка');
    if (left.length) out.push('Повтор после остановки: ' + leftNew(left));
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
  const once = [...s.once]; // и файлы с секретом — они находятся после скачивания (Т-11)
  const line = lineOf({ home, env, once, each, named, waiting: s.waiting });
  const takeSide = s.items.filter((it) => it.side === 'take');
  const mergeSide = s.items.filter((it) => it.side === 'merge');

  if (check) {
    // Р-39: план синхронизации без записи — неясные скачиваются, кандидаты на совмещение совмещаются в памяти; в проект ничего
    // не пишется. «Есть что забрать» — только то, что синхронизация запишет: забор и совмещённое ≠ рабочей копии; конфликт, М-6,
    // своё на сервере, совмещённое раньше и «не забирать» (и файл с секретом) — названы, но не держат. Названные раньше тоже
    // скачиваются: среди них файлы с секретом — их синхронизация снова не заберёт.
    const got = await collect(c, s, takeSide, (it) => it.kind === 'unclear' || named.has(it.path));
    if (got.fail) return failed(got.fail);
    const mp = await mergePlan(c, s, mergeSide);
    if (mp.fail) return failed(mp.fail);
    each.push(...got.each, ...mp.each);
    once.push(...got.secret, ...mp.secret);
    const writes = [...got.take, ...mp.merged.map((m) => ({ path: m.path, kind: 'changed', gone: false }))].sort(byPath);
    const sum = line(writes, { conflictsAhead: mp.conflicts.map((k) => k.path) });
    if (writes.length || readMark(home).pending.length) {
      // М-5: в основной папке синхронизация — здесь же, без --check; в worktree — в основной папке
      return stop(1, sum, wt === null ? 'есть изменения без kit — запусти синхронизацию: /kit:sync'
        : `есть изменения без kit — синхронизация в основной папке проекта (${wt})`);
    }
    return stop(0, sum);
  }

  // Р-83 (М-1): на сервере нет многих файлов сайта — скорее «SSH <окружение>» указывает не на ту папку или сайт переналили:
  // удалить их у нас одним коммитом без вопроса нельзя. До любой записи — вопрос; --delete-ok — удалять. Р-89: доля — от файлов
  // сайта без оставленных в этот раз (Р-88: нет на сервере, у нас не удаляются — kept из сверки, а не только named прошлых раз),
  // иначе сотни путей под исключённой папкой раздували бы знаменатель.
  const gone = takeSide.filter((it) => it.gone).map((it) => it.path);
  const total = s.total - s.once.filter((it) => it.kept).length;
  if (!opts.deleteOk && gone.length > MASS_DELETE && gone.length > total * MASS_SHARE) {
    return stop(1, `на сервере нет ${gone.length} из ${total} файлов сайта — проверь «${sshKey}» (/kit:project-init)`, '  например: ' + listOf(gone),
      `спроси пользователя: Удалить у нас (\`prod-sync.js${flagsOf({ ...opts, deleteOk: true })}\`) / Проверить «${sshKey}» / ${SKIP}`);
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
  // (4) забор: скачать (файлы с секретом — не забираются, Т-11), записать.
  const got = await collect(c, s, takeSide);
  if (got.fail) return failed(got.fail);
  each.push(...got.each, ...mp.each);
  once.push(...got.secret, ...mp.secret);
  // Р-58: файл забора на диске — тот, что видела сверка (версия HEAD; у нового — файла нет)? Пользователь мог сохранить его, пока
  // шло скачивание: такой путь не пишется и не коммитится, называется каждый раз.
  const moved = new Set(got.take.filter((it) => blockedOnDisk(home, it.path) || diskVer(home, it.path) !== s.headVer(it.path)).map((it) => it.path));
  each.push(...[...moved].map((p) => ({ path: p, why: MOVED_WHY })));
  const take = got.take.filter((it) => !moved.has(it.path));
  if (take.length) {
    // Р-14 п.4–6: pending до записи (Р-57: с md5 того, что будет записано; удаление — null), удаления, запись через временный
    // файл со сверкой md5. Остановка дальше — после записи (Р-51).
    const bad = saveMark((m) => { m.pending = take.map((it) => ({ path: it.path, md5: it.data ? md5NoCr(it.data) : null })); });
    if (bad) return bad;
    st.written = true;
    for (const it of take) if (it.kind === 'removed') removeLocal(home, it.path);
    const files = take.filter((it) => it.data);
    writeFilesAtomic(files.map((it) => ({ file: path.join(home, it.path), text: it.data, label: it.path })), { mkdir: true });
    const wrong = files.filter((it) => md5(fs.readFileSync(path.join(home, it.path))) !== md5(it.data)).map((it) => clean(it.path));
    if (wrong.length) return stop(1, 'записано не то, что скачано (md5 не совпал): ' + wrong.join(', '), KEPT, AGAIN);
  }
  return finish({ home, env, info, argLimit, out, st, stop, saveMark, each, once, line, take, mp, cands: mergeSide, ftp: false });
}

// Без SSH (Т-9, 48.8): адрес сервера задан, «SSH <окружение>» пуст — скачивание по FTP в PhpStorm (lib/prod-ftp.js). Без
// --ftp-done ничего не пишет: незаконченная синхронизация — сначала ответ на неё; правки файлов сайта в рабочей копии (Р-60,
// кроме --dirty-ok); иначе корни для скачивания. С --ftp-done — разбор скачанного по Т-5, запись, коммит и отметка, как по SSH;
// File Watchers не проверяются — скачивание уже прошло через PhpStorm (Р-62).
async function ftpEnter(home, wt, info, env, opts, out, st) {
  const stop = stopper(out);
  // Р-64: синхронизация без SSH — только в основной папке: в worktree скачанное не читается, ничего не пишется
  if (wt !== null) return stop(1, `синхронизация без SSH — в основной папке проекта (${wt})`);
  const b = entryBase(home, info, env);
  if (b.error) return stop(4, ...noBase(b));
  out.push(`Сервер: ${env} — ${clean(info.params.get(env === 'дев' ? 'Дев' : 'Прод'))} (без SSH — по FTP)`);
  const rules = syncRules(home, info);
  const argLimit = opts.argLimit || ARG_LIMIT;
  const pending = readMark(home).pending.filter((e) => safePath(e.path) && !matchRules(e.path, rules));
  const c = { dir: home, info, env, b, rules, secrets: info.params.list('Секреты'), whyNot: takeRule(info) };
  if (!opts.ftpDone) {
    // прошлая синхронизация остановилась после записи (Т-10): новое скачивание поверх записанного её спутало бы
    if (pending.length) {
      const n = pending.length;
      return stop(1, `прошлая синхронизация остановилась после записи: в pending ${n} ${plural(n, 'файл', 'файла', 'файлов')}`, TAIL.ftp.kept, TAIL.ftp.again);
    }
    const dirty = opts.dirtyOk ? [] : await ftpDirty(c);
    if (dirty.length) return stop(1, ...dirtyLines(dirty));
    const roots = ftpRoots(home, info);
    if (!roots.length) return stop(2, 'синхронизировать не с чем: в git нет файлов сайта — скачивать по FTP нечего');
    return stop(1, ...rootLines(home, roots));
  }
  st.ftp = true;
  out.push(`База: ${git(home, ['rev-parse', '--short', b.base]).out.trim()} (${b.source})`);
  // Р-70: при автозаливке Always возврат из HEAD и совмещённое PhpStorm залил бы на сервер — стоп до любой записи (и до pending)
  if (autoUpload(home)) return stop(1, ...ALWAYS_STOP);
  const entryLimit = opts.entryLimit || ENTRY_LIMIT;
  // Р-61: pending прошлой остановки к HEAD не откатывается (на диске — скачанное): записанное — разбирается как скачанное;
  // изменённое после остановки (Р-57) — не тронуто, из pending уходит, названо и в этот раз не разбирается.
  const moved = pending.filter((e) => hasMd5(e) && diskVer(home, e.path) !== e.md5).map((e) => e.path);
  if (moved.length) out.push('Повтор после остановки: ' + untouched(moved) + '; в этот раз не разбирается');
  const s = await ftpSurvey(c, new Set(moved));
  const named = new Set(readMark(home).named);
  const each = [];
  const once = [...s.once];
  // Р-62: объём забираемого — до любой записи
  const big = opts.bigOk ? null : bigOf(s.take, entryLimit);
  if (big) return stop(1, ...stopLines(null, big, entryLimit, '--ftp-done '));
  // Т-11: скачанное с секретом не забирается и не совмещается — отслеживаемое к HEAD, новое лежит (Р-68); названо один раз;
  // совмещение — в памяти. Пропавшее после разбора — называется каждый раз.
  const { take, cands, mp, secret, secretLocal, gone } = await ftpPlan(c, s);
  once.push(...secret.map((p) => ({ path: p, why: SECRET_WHY })), ...secretLocal.map((p) => ({ path: p, why: 'секрет', local: true })));
  each.push(...gone.map((p) => ({ path: p, why: MOVED_WHY })));
  // Р-61: до любой записи (восстановления из HEAD, удаления, совмещения) в pending — забор с md5 диска (что идёт в коммит);
  // остановка дальше — после записи (Р-51). Р-85: с пометкой ftp — файлы положило скачивание, отмена новые из них не удаляет
  const saveMark = markSaver(home, stop);
  if (take.length || pending.length) {
    const fail = saveMark((m) => { m.pending = take.map((it) => ({ path: it.path, md5: it.md5, ftp: true })); });
    if (fail) return fail;
    st.written = take.length > 0;
  }
  // поставленное в индекс остановленным kit-commit.js — снять (рабочая копия цела); не забираемое отслеживаемое, вернувшееся к
  // базе, совмещённое в HEAD и конфликты — к HEAD (все эти пути есть в HEAD: удалять разбор не удаляет, Р-68)
  for (const part of byLength(pending.map((e) => e.path), argLimit)) {
    const r = git(home, ['--literal-pathspecs', 'reset', '-q', '--', ...part]);
    if (!r.ok) throw new Error('git reset: ' + r.err);
  }
  restore(home, [...s.undo].sort(), argLimit);
  if (s.reverted.length) out.push('Восстановлено из HEAD — скачанное вернуло к базе наше незалитое: ' + listOf(s.reverted));
  const line = lineOf({ home, env, once, each, named, waiting: s.waiting, ftp: true });
  return finish({ home, env, info, argLimit, out, st, stop, saveMark, each, once, line, take, mp, cands, ftp: true });
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.log('prod-sync: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const cwd = process.cwd();
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  const dir = top.ok && top.out.trim() ? path.resolve(top.out.trim()) : cwd;
  const r = await entry(dir, {
    check: o.check, abort: o.abort, ftpDone: o.ftpDone, dirtyOk: o.dirtyOk, timeoutMs: o.timeout * 1000, watchersOk: o.watchersOk, bigOk: o.bigOk,
    deleteOk: o.deleteOk,
  });
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
