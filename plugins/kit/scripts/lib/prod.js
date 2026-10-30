'use strict';
// Синхронизация с продом (этап 48): правила сверки сервера с git без SSH — три версии файла (база, HEAD, сервер), база
// синхронизации, что не забирать (недопустимое имя пути, файл с секретом), наши доработки, ждущее удаления, совмещение (git merge-file) и папка
// конфликтов, File Watchers PhpStorm и объём за раз, строки для пользователя, отметка синхронизации; blob из git и md5 его
// вариантов переводов строк; правки рабочей копии (git status) и чтение её файла. Только правила и git; сценарии для сервера и
// их разбор — lib/prod-ssh.js; без SSH (FTP) — lib/prod-ftp.js; подключение, скачивание, запись и коммит — prod-sync.js.
// Отметка — `.claude/kit-prod.json`: читается без исключений, пишется атомарно.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { git, isSsh, baseFromPlan, sectionOf } = require('./deploy');
const { getSection, parseTable } = require('./md');
const { writeFilesAtomic } = require('./atomic');
const { readDeployment } = require('./deployment');
const { parseRules, matchRules, safePath } = require('./paths');
const { BASE_FORBIDDEN, secretFindings } = require('../secret-scan');

// Заголовок коммита синхронизации: по нему находятся база, «наши доработки» и файлы, не идущие на заливку.
const ENTRY_RE = /^(Прод|Дев): изменения без kit /;
const FILE_LIMIT = 10 * 1024 * 1024; // файл больше — не забирается
const ENTRY_LIMIT = 50 * 1024 * 1024; // за одну синхронизацию больше — стоп и вопрос
const UNKNOWN_SIZE = 1024 * 1024; // размер файла неизвестен — для объёма за раз и порций скачивания
const MARK_FILE = '.claude/kit-prod.json';
const LIST_LIMIT = 10;
const REGULAR = new Set(['100644', '100755']); // ссылки (120000) и подмодули (160000) — вне сверки

function plural(n, one, few, many) {
  const m100 = Math.abs(Math.trunc(n)) % 100;
  const m10 = m100 % 10;
  if (m100 >= 11 && m100 <= 14) return many;
  if (m10 === 1) return one;
  return m10 >= 2 && m10 <= 4 ? few : many;
}

// Начало заголовка коммитов синхронизации окружения env (entryBase, entryDeploy).
const entryPrefix = (env) => (env === 'дев' ? 'Дев' : 'Прод') + ': изменения без kit ';

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

// База синхронизации (Т-5) — по путям, «известное состояние сервера» (с 48.3, Р-24). base (D) — коммит последней строки «Залито
// на …» плана (хеш, которого нет в репозитории, не в счёт — с пометкой); нет — первый коммит репозитория. Поверх D — пути, которые
// меняли коммиты синхронизации своего окружения из D..HEAD (после D или не связанные с ней): overlay — путь → полный хеш самого
// нового такого коммита (путь удалён им — версии в базе нет). Дерево одного коммита синхронизации базой быть не может: это HEAD на
// момент синхронизации, в нём и наши незалитые шаги, а сервер с ними не совпадал. Более старая база для остальных путей
// безопасна — ложного «забрать» поверх нашего незалитого не будет. → { base, source, overlay: Map, entries: число коммитов
// синхронизации поверх } | { error }.
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
  // только коммиты синхронизации своего окружения: синхронизация с девом говорит о деве, а прод мог быть любым; git log — от
  // новых к старым
  const prefix = entryPrefix(env);
  const overlay = new Map();
  let entries = 0;
  for (const c of logPaths(cwd, ['^' + base])) {
    if (!c.subject.startsWith(prefix)) continue;
    entries++;
    for (const p of c.paths) if (!overlay.has(p)) overlay.set(p, c.hash);
  }
  if (entries) source += '; поверх — ' + entries + ' ' + plural(entries, 'коммит', 'коммита', 'коммитов') + ' синхронизации';
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

// Известное состояние сервера по entryBase как дерево: дерево base, поверх — пути overlay из своих коммитов синхронизации (нет
// в его дереве — удалён, в базе его нет). → Map<путь, { mode, oid }>. Ошибку git бросает.
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

// Наши доработки (Т-7): пути, которые менял хоть один коммит, кроме первого и коммитов синхронизации.
function oursPaths(cwd) {
  const out = new Set();
  for (const c of logPaths(cwd)) {
    if (ENTRY_RE.test(c.subject)) continue;
    for (const p of c.paths) out.add(p);
  }
  return out;
}

// Заливка после синхронизации (Т-13, Р-78, с 48.10). Для путей, которые после base меняли коммиты синхронизации своего окружения
// (заголовок — как в entryBase), известное состояние сервера — версия самого нового такого коммита (как overlay в entryBase и
// baseTree; нет файла в его дереве — на сервере его нет). Рабочая копия совпадает с ним — путь в exclude: он уже на сервере, даже
// если changes от базы его видит. Отличается — в include: { status: 'M' } (файл есть — залить) или { status: 'D' } (нет —
// удалить с сервера), даже если от базы разницы нет (шаг вернул файл к версии базы или удалил добавленный синхронизацией).
// Остальные пути — как прежде, по changes. Коммиты — base..HEAD через logPaths: --no-renames (переименование — удаление и новый
// файл), слияния и корневые коммиты пропускаются — изменения слияния лежат в коммитах веток, а что слияние поправило само, видно
// по содержимому. Сравнение — как в changes (Р-79): отслеживаемый путь — git diff --name-only рабочей копии против дерева
// коммита синхронизации (один вызов на коммит), с той же оглядкой на индекс при core.autocrlf и .gitattributes: CRLF на диске
// при LF в git — та же версия, и blob с CRLF, закоммиченный до autocrlf, — тоже. Неотслеживаемый файл (версии в индексе нет) —
// git hash-object с фильтрами пути, как его возьмёт будущий git add, против oid дерева. Файл на диске, которого git не видит
// (игнорируемый и не отслеживаемый), и путь с переводом строки — ни в один список. Не ответил git — пустые списки: заливается
// всё, как до 48.10. → { exclude: Set<путь>, include: [{ status, path }] }.
function entryDeploy(cwd, base, env) {
  const none = () => ({ exclude: new Set(), include: [] });
  if (!base || !commitHash(cwd, base)) return none();
  const prefix = entryPrefix(env);
  const latest = new Map(); // путь → самый новый коммит синхронизации (git log — от новых к старым)
  for (const c of logPaths(cwd, ['^' + base])) {
    if (!c.subject.startsWith(prefix)) continue;
    for (const p of c.paths) if (!latest.has(p) && !p.includes('\n')) latest.set(p, c.hash);
  }
  if (!latest.size) return none();
  try {
    const listed = (args) => {
      const r = git(cwd, ['ls-files', '-z', ...args]);
      if (!r.ok) throw new Error('git ls-files: ' + r.err);
      return new Set(r.out.split('\0').filter(Boolean));
    };
    const tracked = listed(['--cached']);
    const visible = listed(['--others', '--exclude-standard']); // неотслеживаемые, которые git видит
    const isFile = (p) => {
      try {
        return fs.statSync(path.join(cwd, p)).isFile();
      } catch (e) {
        return false; // нет файла
      }
    };
    const byCommit = new Map();
    for (const [p, h] of latest) {
      if (!byCommit.has(h)) byCommit.set(h, []);
      byCommit.get(h).push(p);
    }
    const out = none();
    const fresh = []; // неотслеживаемые файлы на диске: { path, oid на сервере или null }
    for (const [h, paths] of byCommit) {
      // отслеживаемые — как в changes: рабочая копия против дерева h (без pathspec — длина командной строки)
      const d = git(cwd, ['diff', '--name-only', '--no-renames', '-z', h]);
      if (!d.ok) return none();
      const differ = new Set(d.out.split('\0').filter(Boolean));
      let tree = null;
      for (const p of paths) {
        const file = isFile(p);
        if (tracked.has(p)) {
          if (differ.has(p)) out.include.push({ status: file ? 'M' : 'D', path: p });
          else out.exclude.add(p);
          continue;
        }
        if (file && !visible.has(p)) continue; // на диске, но git его не видит (игнорируемый)
        if (!tree) tree = treeOf(cwd, h);
        const srv = tree.has(p) ? tree.get(p).oid : null;
        if (file) fresh.push({ path: p, srv });
        else if (srv) out.include.push({ status: 'D', path: p });
        else out.exclude.add(p);
      }
    }
    if (fresh.length) {
      // неотслеживаемые: версии в индексе нет — hash-object нормализует так же, как будущий git add
      const r = spawnSync('git', ['hash-object', '--stdin-paths'],
        { cwd, input: fresh.map((f) => f.path).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      const oids = r.status === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
      if (oids.length !== fresh.length) return none();
      fresh.forEach((f, i) => {
        if (oids[i] === f.srv) out.exclude.add(f.path);
        else out.include.push({ status: 'M', path: f.path });
      });
    }
    return out;
  } catch (e) {
    return none();
  }
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

// Запись «Удалить с сервера» или пути, удалённого шагом, которой отвечает rel (папка — одной записью); нет — null.
function pendingEntry(pending, rel) {
  if (!inPending(pending, rel)) return null;
  return pending.has(rel) ? rel : [...pending].find((p) => p.endsWith('/') && rel.startsWith(p));
}

// Пути, которые исключает .gitignore (и info/exclude). --no-index: путь внутри подмодуля не роняет git; путь может и не
// существовать (пробный путь корней FTP).
function ignoredOf(dir, paths) {
  if (!paths.length) return new Set();
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'check-ignore', '--no-index', '-z', '--stdin'],
    { cwd: dir, input: paths.join('\0') + '\0', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status === 1) return new Set(); // ничего не игнорируется
  if (r.status !== 0) throw new Error('git check-ignore: ' + String(r.stderr || r.error || '').trim());
  return new Set(r.stdout.split('\0').filter(Boolean));
}

// Пути с незакоммиченной правкой: изменён, в индексе, удалён, неотслеживаемый (игнорируемые .gitignore — нет).
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
// забранное коммитом синхронизации); merged — совмещённое с нашими незакоммиченными правками в этой синхронизации (Р-33);
// conflicts — не совместилось само (Р-37: подробности и вопрос — строками ниже); conflictsAhead — не совместится само (--check,
// Р-39: вопрос задаст синхронизация в основной папке). «Совпадает с git» — только если всё пусто. Без SSH (48.8): local —
// [{ path, why }] не забранное, что лежит в рабочей копии и не в git (Р-68: разбор скачанного его не удаляет); ftp — в конце
// одна фраза, что удалённые на сервере файлы и новые вне перечисленных папок по FTP не видны (Р-67).
const cleanText = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?');
const listOf = (items, fmt = cleanText) => items.slice(0, LIST_LIMIT).map(fmt).join(', ') +
  (items.length > LIST_LIMIT ? ' и ещё ' + (items.length - LIST_LIMIT) : '');

function summaryLine(input = {}) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const { env } = input;
  const keys = ['changed', 'added', 'removed', 'ours', 'merged', 'conflicts', 'conflictsAhead', 'skipped', 'local', 'waiting'];
  const all = keys.map((k) => list(input[k]));
  const [changed, added, removed, ours, merged, conflicts, ahead, skipped, local, waiting] = all;
  const dev = env === 'дев';
  const head = '[kit] ' + (dev ? 'Синхронизация с девом: ' : 'Синхронизация с продом: ');
  const ftp = input.ftp ? ' Удалённые на сервере файлы и новые вне перечисленных папок по FTP не видны.' : '';
  const why = (s) => cleanText(s.path) + ' (' + cleanText(s.why) + ')';
  if (!all.some((a) => a.length)) return head + (dev ? 'дев' : 'прод') + ' совпадает с git.' + ftp;
  const parts = [`файлов без kit: изменено ${changed.length}, добавлено ${added.length}, удалено ${removed.length}.`];
  if (ours.length) parts.push(`Наши прошлые доработки среди изменённых (проверьте, не затёрты ли): ${listOf(ours)}.`);
  if (merged.length) parts.push(`Совмещено с нашими незакоммиченными правками — проверьте в панели изменений: ${listOf(merged)}.`);
  if (conflicts.length) parts.push(`Не совместилось само — вопрос ниже: ${listOf(conflicts)}.`);
  if (ahead.length) parts.push(`Не совместится само — вопрос задаст синхронизация в основной папке: ${listOf(ahead)}.`);
  if (skipped.length) parts.push(`Не забрано, осталось на сервере: ${listOf(skipped, why)}.`);
  if (local.length) parts.push(`Не забрано, лежит в рабочей копии, в git не идёт — удали сам, если не нужен: ${listOf(local, why)}.`);
  if (waiting.length) parts.push(`Ждёт удаления с сервера: ${listOf(waiting)}.`);
  return head + parts.join(' ') + ftp;
}

// ---- Имя пути, File Watchers и объём за раз, папка конфликтов ----------------------------------------------------------
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
};
const clean = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
// Вариант ответа «не сейчас» в вопросах пользователю (Р-42): синхронизация откладывается, ничего не записано.
const SKIP = 'Отложить';

const REPLACEMENT = String.fromCharCode(0xfffd); // имя на сервере не в UTF-8 — после разбора это уже другое имя
const WIN_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// Путь нельзя безопасно записать в рабочую копию и отдать kit-commit.js: не safePath, «\» (kit-commit.js читает его как «/»),
// имя не в UTF-8, пробел в начале или в конце части (самопроверка kit-commit.js обрезает пробелы, М-5); на Windows ещё
// <>:"|?*, CON, PRN, AUX, NUL, COM1–9, LPT1–9 (и с расширением), точка в конце части.
function badName(p, win = process.platform === 'win32') {
  const s = String(p);
  if (!safePath(s) || s.includes('\\') || s.includes(REPLACEMENT)) return true;
  const segs = s.split('/');
  if (segs.some((seg) => /^ | $/.test(seg))) return true;
  if (!win) return false;
  return /[<>:"|?*]/.test(s) || segs.some((seg) => WIN_RESERVED.test(seg) || /\.$/.test(seg));
}

// Что не забирается (Р-17, Т-11) — по SSH и без SSH: недопустимое имя, запрещённое к коммиту (BASE_FORBIDDEN и «Не
// коммитить»), архив, больше 10 МБ. → (путь, размер) → причина | null.
function takeRule(info) {
  const forbid = parseRules([...BASE_FORBIDDEN, ...info.params.list('Не коммитить')]);
  return (p, size) => (badName(p) ? 'недопустимое имя' : matchRules(p, forbid) ? 'запрещён к коммиту' : skipTake(p, size));
}

// Размер для пользователя: меньше 1 МБ — в КБ (с округлением вверх), иначе в МБ до десятых, с запятой.
const mb = (n) => (n < 1024 * 1024 ? Math.max(1, Math.ceil(n / 1024)) + ' КБ' : String(Math.round(n / 104857.6) / 10).replace('.', ',') + ' МБ');

// File Watchers при PhpStorm Always (Т-14, Р-31): пути, которые пересоберёт вотчер. Always — .idea/deployment.xml (нет или не
// разобран — не Always), расширения — watcherExts. → { exts: [расширения], hits: [пути] }.
function watcherHits(dir, paths) {
  const none = { exts: [], hits: [] };
  if (!paths.length) return none;
  const exts = watcherExts(dir);
  if (!exts.size || !readDeployment(readText(path.join(dir, '.idea', 'deployment.xml'))).always) return none;
  const extOf = (p) => {
    const name = p.split('/').pop();
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };
  return { exts: [...exts].sort(), hits: paths.filter((p) => exts.has(extOf(p))).sort() };
}

// Объём за раз (Р-31): сумма размеров (неизвестный — UNKNOWN_SIZE) больше предела → { total, top: [[папка, размер]] — до 5
// самых тяжёлых: папка файла, обрезанная до трёх уровней, файл в корне — сам по себе } | null.
function bigOf(items, limit) {
  const size = (it) => (Number.isFinite(it.size) ? it.size : UNKNOWN_SIZE);
  const total = items.reduce((n, it) => n + size(it), 0);
  if (total <= limit) return null;
  const dirs = new Map();
  for (const it of items) {
    const segs = it.path.split('/');
    const key = segs.length > 1 ? segs.slice(0, Math.min(3, segs.length - 1)).join('/') + '/' : it.path;
    dirs.set(key, (dirs.get(key) || 0) + size(it));
  }
  return { total, top: [...dirs].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5) };
}

// Остановка (Р-31, Р-40): вотчеры и объём — одной остановкой, одним вопросом; последняя строка — что делать Claude. flags —
// флаги режима перед ответом по объёму (без SSH — «--ftp-done », Р-62).
function stopLines(w, big, limit, flags = '') {
  const said = [];
  const ask = [];
  if (w && w.hits.length) {
    said.push(`File Watchers PhpStorm (${w.exts.join(', ')}) — среди забираемого ${w.hits.length} ${plural(w.hits.length, 'файл', 'файла', 'файлов')}: ` +
      `${listOf(w.hits)}; пересборка перезапишет результат, PhpStorm (Always) зальёт его на сервер`);
    ask.push('по вотчерам — Забирать (`prod-sync.js --watchers-ok`; лучше выключить вотчеры на время синхронизации) / ' + SKIP);
  }
  if (big) {
    said.push(`Забрать за одну синхронизацию — ${mb(big.total)} (больше ${mb(limit)}); самые тяжёлые папки: ${big.top.map(([d, n]) => clean(d) + ' — ' + mb(n)).join(', ')}`);
    ask.push('по объёму — Забрать всё (`prod-sync.js ' + flags + '--big-ok`) / Не забирать папки (допиши их в .gitignore и повтори синхронизацию) / ' + SKIP);
  }
  return ['Синхронизация остановлена, ничего не записано:', ...said.map((l) => '  ' + l),
    'спроси пользователя одним AskUserQuestion: ' + ask.join('; ') + (ask.length > 1 ? '; оба ответа «забирать» — флаги вместе' : '')];
}

// Папка конфликтов (Р-38): kit-prod-<8 знаков md5 пути папки проекта (на Windows — в нижнем регистре)>-* в os.tmpdir().
// Прежние папки этого проекта убираются перед созданием новой; ошибки — молча (занятые остаются, чужие проекты не трогаются).
function conflictDir(dir) {
  const key = path.resolve(dir);
  const tag = 'kit-prod-' + md5(process.platform === 'win32' ? key.toLowerCase() : key).slice(0, 8) + '-';
  let old = [];
  try {
    old = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(tag));
  } catch (e) {
    // список не прочитан — убирать нечего
  }
  for (const f of old) {
    try {
      fs.rmSync(path.join(os.tmpdir(), f), { recursive: true, force: true });
    } catch (e) {
      // занята — остаётся
    }
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), tag));
}

// ---- git: blob и md5 вариантов переводов строк -------------------------------------------------------------------------
const CR = Buffer.from([13]);

// md5 варианта с другими переводами строк: toCrlf — одиночный \n → \r\n, иначе \r\n → \n.
function md5Eol(buf, toCrlf) {
  const h = crypto.createHash('md5');
  let from = 0;
  for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) {
    const cr = i > 0 && buf[i - 1] === 13;
    if (toCrlf && !cr) {
      h.update(buf.subarray(from, i));
      h.update(CR);
      from = i;
    } else if (!toCrlf && cr) {
      h.update(buf.subarray(from, i - 1));
      from = i;
    }
  }
  h.update(buf.subarray(from));
  return h.digest('hex');
}

// Содержимое blob одним процессом git cat-file --batch, потоком: onBlob(oid, buf) по одному — в памяти один blob за раз.
function catBlobs(dir, oids, onBlob) {
  return new Promise((resolve, reject) => {
    if (!oids.length) {
      resolve();
      return;
    }
    const child = spawn('git', ['cat-file', '--batch'], { cwd: dir, windowsHide: true });
    let chunks = [];
    let len = 0;
    let cur = null;
    let left = oids.length;
    let failed = null;
    let errText = '';
    const flat = () => {
      const b = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, len);
      chunks = [b];
      return b;
    };
    const drop = (b, n) => {
      chunks = [b.subarray(n)];
      len -= n;
    };
    child.stdout.on('data', (d) => {
      if (failed) return;
      chunks.push(d);
      len += d.length;
      try {
        for (;;) {
          if (!cur) {
            if (!len) break;
            const b = flat();
            const nl = b.indexOf(10);
            if (nl < 0) break;
            const head = b.subarray(0, nl).toString('utf8');
            const m = /^([0-9a-f]+) blob (\d+)$/.exec(head);
            if (!m) throw new Error('git cat-file: ' + head);
            cur = { oid: m[1], size: Number(m[2]) };
            drop(b, nl + 1);
          }
          if (len < cur.size + 1) break;
          const b = flat();
          onBlob(cur.oid, b.subarray(0, cur.size));
          drop(b, cur.size + 1);
          cur = null;
          left--;
        }
      } catch (e) {
        failed = e;
        child.kill();
      }
    });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (e) => { failed = failed || e; });
    child.on('close', () => {
      if (failed) reject(failed);
      else if (left) reject(new Error('git cat-file: ответ неполный ' + errText.trim()));
      else resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(oids.join('\n') + '\n');
  });
}

// oid → { raw: md5 как есть, noCr: md5 без \r }.
async function blobHashes(dir, oids) {
  const out = new Map();
  await catBlobs(dir, oids, (oid, buf) => {
    const raw = md5(buf);
    out.set(oid, { raw, noCr: buf.includes(13) ? md5NoCr(buf) : raw });
  });
  return out;
}

// oid → md5 вариантов с \r\n → \n и с одиночными \n → \r\n (любой из них без \r равен blob без \r).
async function blobVariants(dir, oids) {
  const out = new Map();
  await catBlobs(dir, oids, (oid, buf) => out.set(oid, new Set([md5Eol(buf, false), md5Eol(buf, true)])));
  return out;
}

// Файлы с секретом (Т-11, Р-54) — по SSH и без SSH: versions — [{ path, data }] скачанного (data null — удалён на сервере, не
// проверяется); secretFindings против HEAD-версии файла (s.headOid; нет в HEAD — все строки), с доп. шаблонами «Секреты»
// проекта (c.secrets), как --cached у kit-commit.js. HEAD читается только для текстовых (двоичное secretFindings не
// проверяет). → Set путей с находкой.
async function secretPaths(c, s, versions) {
  const texts = versions.filter((v) => v.data && !v.data.subarray(0, 8000).includes(0));
  const heads = new Map();
  await catBlobs(c.dir, [...new Set(texts.map((v) => s.headOid(v.path)).filter(Boolean))], (oid, buf) => heads.set(oid, Buffer.from(buf)));
  const out = new Set();
  for (const v of texts) {
    const oid = s.headOid(v.path);
    if (secretFindings(v.data, oid ? heads.get(oid) : null, v.path, c.secrets).length) out.add(v.path);
  }
  return out;
}

// ---- Отметка синхронизации --------------------------------------------------------------------------------------
// Только named — уже названные в строке файлы «не забирать» (Т-11) — и pending — пути незаконченной синхронизации (Т-12).
// Записей сессий нет (с 48.7): синхронизация — только по просьбе пользователя; поле первой редакции читается без ошибки и при
// записи пропадает. Элемент pending (Р-57) — { path, md5 }: md5NoCr того, что синхронизация пишет в путь (null — удаляет);
// без md5 — неизвестно (строка первой редакции или md5 не строка и не null): в файле — строкой, путь — к HEAD, как прежде.
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
const hasMd5 = (e) => Object.prototype.hasOwnProperty.call(e, 'md5');

function pendingOf(v) {
  if (typeof v === 'string') return { path: v };
  if (!isObj(v) || typeof v.path !== 'string') return null;
  return typeof v.md5 === 'string' || v.md5 === null ? { path: v.path, md5: v.md5 } : { path: v.path };
}

function cleanMark(raw) {
  if (!isObj(raw)) return { named: [], pending: [] };
  return { named: strings(raw.named), pending: Array.isArray(raw.pending) ? raw.pending.map(pendingOf).filter(Boolean) : [] };
}

// Нет файла, битый JSON, поля не того типа — пустое значение этого поля. Не бросает.
function readMark(dir) {
  try {
    return cleanMark(JSON.parse(fs.readFileSync(path.join(dir, MARK_FILE), 'utf8').replace(/^\uFEFF/, '')));
  } catch (e) {
    return cleanMark(null);
  }
}

// Атомарная запись — только named и pending (элемент без md5 — строкой). Ошибку записи бросает — решает вызывающий.
function writeMark(dir, mark) {
  const { named, pending } = cleanMark(mark);
  const text = JSON.stringify({ named, pending: pending.map((e) => (hasMd5(e) ? e : e.path)) }, null, 2) + '\n';
  writeFilesAtomic([{ file: path.join(dir, MARK_FILE), text }], { mkdir: true });
}

module.exports = {
  ENTRY_RE, FILE_LIMIT, ENTRY_LIMIT, MARK_FILE, REGULAR, plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, skipTake,
  oursPaths, entryDeploy, pendingDelete, inPending, pendingEntry, ignoredOf, dirtyPaths, readWork, watcherExts, mergeVersions, listOf, summaryLine, readMark,
  writeMark, hasMd5, UNKNOWN_SIZE, SKIP, readText, clean, badName, takeRule, watcherHits, bigOf, stopLines, conflictDir, md5Eol,
  catBlobs, blobHashes, blobVariants, secretPaths,
};
