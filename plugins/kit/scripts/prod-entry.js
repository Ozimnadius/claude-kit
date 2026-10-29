#!/usr/bin/env node
'use strict';
// Вход с прода (этап 48): сайт на сервере сверяется с git по SSH — что там изменили, добавили и удалили без kit, забирается в
// рабочую копию байт в байт и коммитится коммитом входа (kit-commit.js, без просмотра и вопросов: прод главный).
//   node prod-entry.js [--timeout сек]           вход: сверка, забор, коммит входа, отметка сессии done
//   node prod-entry.js --check [--timeout сек]   только сверка (исполнитель Мэтта; сессия в worktree — всегда так): файлы,
//                                                индекс и pending не меняются; забирать нечего — отметка checked
//   --skip, --ftp-done, --hook — режимы шага 48.5; --watchers-ok, --big-ok — шага 48.4 (пока принимаются без действия)
// Папка проекта — корень git текущей папки; сервер — «Окружение» (прод или дев), куда — «SSH прод» / «SSH дев». Три версии
// файла (база, HEAD, сервер) и правила — lib/prod.js. Сверка — одним подключением, сценарием sh на stdin: состояние и md5
// отслеживаемых файлов (пачкой, без процесса на файл) и список остальных с размером (find без того, что точно исключает
// .gitignore); md5 сервера сравнивается у нас с вариантами blob (CRLF и LF — одна версия), неясное скачивается. Скачанное
// пишется через временный файл; пути забора до записи — в pending отметки (.claude/kit-prod.json): повтор вернёт их к HEAD
// и доведёт вход до конца. Много путей — несколько коммитов входа подряд.
// Коды: 0 — вход сделан (или нечего забирать; с --check — забирать нечего); 1 — нужен ответ пользователя (совмещение — шаг
// 48.4, запрещённый путь или секрет в скачанном; с --check — есть что забрать); 2 — вход не нужен или параметр неверный;
// 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, запись. Весь вывод — в stdout; последняя строка — итог для
// пользователя (код 0) или что делать Claude.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { kitInfo, serverEnv } = require('./lib/project');
const { parseRules, matchRules } = require('./lib/paths');
const { shq, serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { skipRules, git } = require('./lib/deploy');
const { projectRoot } = require('./lib/matt');
const { writeFilesAtomic } = require('./lib/atomic');
const { safePath } = require('./ssh-deploy');
const { BASE_FORBIDDEN } = require('./secret-scan');
const {
  plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, skipTake, oursPaths, pendingDelete, inPending, summaryLine,
  readMark, writeMark, markSession, lastNeed,
} = require('./lib/prod');

const USAGE = 'Использование: node prod-entry.js [--check] [--timeout сек]';
// Меньше предела инструмента Bash (120 с): зависший сервер — код 3, а не оборванный вызов. Срок — общий на все подключения входа.
const DEFAULT_TIMEOUT = 100;
// Пути одного вызова kit-commit.js: сумма длин плюс 3 знака на путь (предел командной строки Windows — 32 767 на весь вызов,
// а kit-commit.js передаёт те же пути в git).
const ARG_LIMIT = 24000;
const FETCH_LIMIT = 16 * 1024 * 1024; // скачивание за одно подключение — по размеру файлов
const UNKNOWN_SIZE = 1024 * 1024;
const REGULAR = new Set(['100644', '100755']); // ссылки (120000) и подмодули (160000) — вне сверки
const KIT_COMMIT = path.join(__dirname, 'kit-commit.js');
const ASK = 'спроси пользователя: Повторить / Работать без входа (`prod-entry.js --skip`)';
const KIND = { changed: 'изменён', added: 'добавлен', removed: 'удалён' };
// Отрезается на сервере всегда: папки с этими именами на любой глубине и служебные папки в корне (как ALWAYS_SKIP выкладки).
const PRUNE_NAMES = ['.git', '.idea'];
const ALWAYS_PRUNE = ['.claude', '.superpowers', '.worktrees', 'docs/superpowers'];

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

const REPLACEMENT = String.fromCharCode(0xfffd); // имя на сервере не в UTF-8 — после разбора это уже другое имя
const WIN_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// Путь нельзя безопасно записать в рабочую копию и отдать kit-commit.js: не safePath, «\» (kit-commit.js читает его как «/»),
// имя не в UTF-8; на Windows ещё <>:"|?*, CON, PRN, AUX, NUL, COM1–9, LPT1–9 (и с расширением), точка или пробел в конце части.
function badName(p, win = process.platform === 'win32') {
  const s = String(p);
  if (!safePath(s) || s.includes('\\') || s.includes(REPLACEMENT)) return true;
  if (!win) return false;
  return /[<>:"|?*]/.test(s) || s.split('/').some((seg) => WIN_RESERVED.test(seg) || /[. ]$/.test(seg));
}

// ---- Отрезание на сервере (Р-11) ----------------------------------------------------------------------------------------
const WILD = /[*?[\]\\]/;

// Строка .gitignore → { neg, rooted, anchored, path, dir, deep, literal, prefix }; пустая и комментарий — null. path — без «/»
// по краям и без конечных «/*», «/**» (deep); dir — был «/» на конце; prefix — буквальные части пути до первой со звёздочкой.
function ignoreLine(raw) {
  let s = String(raw).replace(/\r$/, '').replace(/ +$/, '');
  if (!s || s.startsWith('#')) return null;
  const neg = s.startsWith('!');
  if (neg) s = s.slice(1);
  const rooted = s.startsWith('/');
  const anchored = s.replace(/\/+$/, '').includes('/'); // как в git: «/» в начале или в середине
  const dir = s.endsWith('/');
  s = s.replace(/\/+$/, '');
  const deep = /\/\*\*?$/.test(s);
  s = s.replace(/\/\*\*?$/, '').replace(/^\/+/, '');
  const segs = s.split('/');
  const literal = s !== '' && segs.every((x) => x !== '' && x !== '.' && x !== '..' && !WILD.test(x));
  const prefix = [];
  for (const x of segs) {
    if (x === '' || WILD.test(x)) break;
    prefix.push(x);
  }
  return { neg, rooted, anchored, path: s, dir, deep, literal, prefix: prefix.join('/') };
}

const globName = (x) => new RegExp('^' + x.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

// Отрезание — только ускорение (ядро Битрикса — десятки тысяч файлов): верность даёт локальный фильтр git check-ignore, поэтому
// отрезается лишь то, откуда git ничего не вернёт; сомнение — не отрезать. Из корневого .gitignore — строки без «!», от корня,
// с буквальным путём P: «/P», «/P/» — P целиком, если её (или папку над ней) не возвращает отрицание; «/P/*», «/P/**» — дети P,
// кроме возвращённых отрицаниями «!/P/C…» и имён «!X». Отрицание со звёздочкой у P или над ней, «!/P/**» — P не трогаем. Есть
// свой P/.gitignore (hasOwnIgnore(P), Р-25) — детей P не отрезать: его «!» могут вернуть их; P целиком git и не читает.
// → [{ name } | { path } | { path, dir: true } | { path, children: true, keep: [дети], names: [маски имён] }].
function pruneRules(text, hasOwnIgnore = () => false) {
  const rules = [...PRUNE_NAMES.map((name) => ({ name })), ...ALWAYS_PRUNE.map((p) => ({ path: p }))];
  let t = String(text || '');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const lines = t.split('\n').map(ignoreLine).filter(Boolean);
  const loose = [...new Set(lines.filter((l) => l.neg && !l.anchored).map((l) => l.path))]; // «!X» — имя на любой глубине
  const odd = loose.some((x) => /[[\\]/.test(x));
  const tied = lines.filter((l) => l.neg && l.anchored);
  const inside = (q, p) => q.startsWith(p + '/');
  const over = (q, p) => q === '' || p.startsWith(q + '/');
  const covered = (p) => p.split('/').some((x) => PRUNE_NAMES.includes(x)) || ALWAYS_PRUNE.some((a) => p === a || inside(p, a));
  const seen = new Set();
  for (const l of lines) {
    // «/P/*/» — только папки-дети: файлы в P git не исключает
    if (l.neg || !l.rooted || !l.literal || (l.dir && l.deep)) continue;
    const p = l.path;
    const key = (l.deep ? '*' : '') + p;
    if (covered(p) || seen.has(key)) continue;
    seen.add(key);
    let blocked = l.deep ? odd || hasOwnIgnore(p) : loose.some((x) => /[[\\]/.test(x) || globName(x).test(p.split('/').pop()));
    const keep = new Set();
    for (const n of tied) {
      if (!n.literal) {
        if (n.prefix === p || inside(n.prefix, p) || over(n.prefix, p)) blocked = true;
      } else if (n.path === p || over(n.path, p)) {
        if (n.deep || !l.deep) blocked = true; // «!/P/**» возвращает детей; «!/P» — саму P
      } else if (inside(n.path, p) && l.deep) keep.add(n.path.slice(p.length + 1).split('/')[0]);
    }
    if (blocked) continue;
    if (l.deep) rules.push({ path: p, children: true, keep: [...keep].sort(), names: loose });
    else rules.push(l.dir ? { path: p, dir: true } : { path: p });
  }
  return rules;
}

// Правила отрезания → выражение find (от «.»): «\( … -o … \) -prune». Дети P — `-path './P/*' ! -path './P/*/*'`, кроме
// оставленных детей и имён.
function findPrune(rules) {
  const at = (p) => shq('./' + p);
  const alts = rules.map((r) => {
    if (r.name) return '-name ' + shq(r.name);
    if (!r.children) return r.dir ? '\\( -path ' + at(r.path) + ' -type d \\)' : '-path ' + at(r.path);
    const parts = ['-path', at(r.path + '/*'), '!', '-path', at(r.path + '/*/*')];
    for (const c of r.keep) parts.push('!', '-path', at(r.path + '/' + c));
    for (const n of r.names) parts.push('!', '-name', shq(n));
    return '\\( ' + parts.join(' ') + ' \\)';
  });
  return '\\( ' + alts.join(' -o ') + ' \\) -prune';
}

// ---- Сценарии для сервера -----------------------------------------------------------------------------------------------

// Сверка для «sh -s», только чтение. Отслеживаемые (tracked) — состояние встроенными командами оболочки, по номерам: KIT_S <n> N
// (нет; ближайшая существующая папка выше — папка, читается и проходима), U (не читается), O (не обычный файл); «есть» — без
// строки, их md5 как есть — пачкой (xargs -0 md5sum), по порядку номеров, между KIT_H и KIT_L. Затем find остальных обычных
// файлов с отрезанием — «размер путь\0» в base64 до KIT_LE <код find>. Список для md5sum — во временной папке mktemp -d, вне
// папки сайта; убирается по выходу.
function listScript(root, tracked, rules) {
  return [
    'cd ' + shq(root) + " || { echo 'KIT_ERR нет папки сайта'; exit 0; }",
    'for c in md5sum base64 find xargs cut mktemp; do command -v "$c" >/dev/null 2>&1 || { echo "KIT_ERR на сервере нет $c"; exit 0; }; done',
    "find . -maxdepth 0 -printf '' >/dev/null 2>&1 || { echo 'KIT_ERR find на сервере без -printf (нужен GNU find)'; exit 0; }",
    "T=$(mktemp -d 2>/dev/null) && [ -d \"$T\" ] || { echo 'KIT_ERR не создать временную папку (mktemp -d)'; exit 0; }",
    "trap 'rm -rf \"$T\"' EXIT",
    'k() {',
    '  if [ -L "$2" ]; then echo "KIT_S $1 O"',
    '  elif [ -f "$2" ]; then',
    "    if [ -r \"$2\" ]; then printf '%s\\0' \"./$2\" >&3; else echo \"KIT_S $1 U\"; fi",
    '  elif [ -e "$2" ]; then echo "KIT_S $1 O"',
    '  else',
    '    d=$2',
    '    while :; do',
    '      case $d in */*) d=${d%/*} ;; *) d=. ;; esac',
    '      if [ "$d" = . ] || [ -e "$d" ] || [ -L "$d" ]; then break; fi',
    '    done',
    '    if [ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ]; then echo "KIT_S $1 N"; else echo "KIT_S $1 U"; fi',
    '  fi',
    '}',
    '{ :',
    ...tracked.map((p, i) => 'k ' + (i + 1) + ' ' + shq(p)),
    '} 3> "$T/z"',
    'echo KIT_H',
    'if [ -s "$T/z" ]; then <"$T/z" xargs -0 md5sum | cut -c1-33; fi',
    'echo KIT_L',
    'find . ' + findPrune(rules) + " -o -type f -printf '%s %P\\0' > \"$T/f\" 2>/dev/null",
    'r=$?',
    'base64 < "$T/f"',
    'echo "KIT_LE $r"',
    'echo KIT_END',
    'exit 0',
  ].join('\n') + '\n';
}

const lines = (stdout) => String(stdout).split('\n').map((l) => l.replace(/\r$/, ''));
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const STATES = { N: 'absent', U: 'unreadable', O: 'notfile' };

// Ответ сверки → { err (KIT_ERR), bad (не разобран — как обрыв), state: Map<путь, file | absent | unreadable | notfile>,
// md5: Map<путь, md5 как есть>, files: Map<путь, размер> — все обычные файлы из find, findFailed }. Хеши сопоставляются с путями
// по порядку; имена из вывода md5sum не разбираются (строка может начинаться с «\» — хеш после него).
function parseList(stdout, tracked) {
  const r = { err: null, bad: null, state: new Map(), md5: new Map(), files: new Map(), findFailed: false };
  const fail = (why) => Object.assign(r, { bad: why });
  let sec = 'states';
  const hashes = [];
  const b64 = [];
  let ended = false;
  for (const line of lines(stdout)) {
    let m;
    if ((m = /^KIT_ERR (.+)$/.exec(line))) {
      r.err = m[1];
      return r;
    }
    if (sec === 'states') {
      if ((m = /^KIT_S (\d+) ([NUO])$/.exec(line))) {
        const p = tracked[Number(m[1]) - 1];
        if (p === undefined) return fail('номер ' + m[1] + ' вне списка');
        r.state.set(p, STATES[m[2]]);
      } else if (line === 'KIT_H') sec = 'hashes';
    } else if (sec === 'hashes') {
      if (line === 'KIT_L') sec = 'list';
      else if (line) hashes.push(line);
    } else if (sec === 'list') {
      if ((m = /^KIT_LE (\d+)$/.exec(line))) {
        r.findFailed = m[1] !== '0';
        sec = 'end';
      } else b64.push(line);
    } else if (line === 'KIT_END') ended = true;
  }
  if (!ended) return fail('ответ оборван');
  const present = tracked.filter((p) => !r.state.has(p));
  if (hashes.length !== present.length) return fail(`хешей ${hashes.length}, а файлов ${present.length}`);
  for (let i = 0; i < present.length; i++) {
    const m = /^\\?([0-9a-f]{32})(?: |$)/.exec(hashes[i]);
    if (!m) return fail('строка хеша ' + (i + 1) + ' не разобрана');
    r.state.set(present[i], 'file');
    r.md5.set(present[i], m[1]);
  }
  const raw = b64.join('');
  if (!B64.test(raw)) return fail('список файлов не в base64');
  const buf = Buffer.from(raw, 'base64');
  for (let from = 0; from < buf.length;) {
    const end = buf.indexOf(0, from);
    if (end < 0) return fail('список файлов оборван');
    const m = /^(\d+) ([\s\S]+)$/.exec(buf.subarray(from, end).toString('utf8'));
    if (!m) return fail('строка списка файлов не разобрана');
    r.files.set(m[2], Number(m[1]));
    from = end + 1;
  }
  return r;
}

// Скачивание для «sh -s»: по каждому пути — KIT_F <n>, base64 файла, KIT_FE <n>; не вышло (пропал, не обычный файл, не
// читается) — KIT_FX <n>. В алфавите base64 нет «_» и пробела: строка тела с меткой не совпадёт.
function fetchScript(root, paths) {
  return [
    'cd ' + shq(root) + " || { echo 'KIT_ERR нет папки сайта'; exit 0; }",
    "command -v base64 >/dev/null 2>&1 || { echo 'KIT_ERR на сервере нет base64'; exit 0; }",
    'g() {',
    '  echo "KIT_F $1"',
    '  if [ -f "$2" ] && [ ! -L "$2" ] && [ -r "$2" ] && base64 2>/dev/null < "$2"; then echo "KIT_FE $1"; else echo "KIT_FX $1"; fi',
    '}',
    ...paths.map((p, i) => 'g ' + (i + 1) + ' ' + shq(p)),
    'echo KIT_END',
    'exit 0',
  ].join('\n') + '\n';
}

// Ответ скачивания → { err, bad, data: Map<путь, Buffer>, failed: Set<путь> }; нет метки конца или ответа по пути — bad.
function parseFetch(stdout, paths) {
  const r = { err: null, bad: null, data: new Map(), failed: new Set() };
  const fail = (why) => Object.assign(r, { bad: why });
  let cur = 0;
  let body = [];
  let ended = false;
  for (const line of lines(stdout)) {
    let m;
    if (cur) {
      if ((m = /^KIT_F([EX]) (\d+)$/.exec(line)) && Number(m[2]) === cur) {
        if (m[1] === 'X') r.failed.add(paths[cur - 1]);
        else {
          const raw = body.join('');
          if (!B64.test(raw)) return fail('файл ' + cur + ' не в base64');
          r.data.set(paths[cur - 1], Buffer.from(raw, 'base64'));
        }
        cur = 0;
      } else body.push(line);
    } else if ((m = /^KIT_ERR (.+)$/.exec(line))) {
      r.err = m[1];
      return r;
    } else if ((m = /^KIT_F (\d+)$/.exec(line))) {
      cur = Number(m[1]);
      if (paths[cur - 1] === undefined) return fail('номер ' + cur + ' вне списка');
      body = [];
    } else if (line === 'KIT_END') ended = true;
  }
  if (!ended || cur) return fail('ответ оборван');
  const lost = paths.filter((p) => !r.data.has(p) && !r.failed.has(p));
  return lost.length ? fail('нет ответа по ' + lost.join(', ')) : r;
}

// ---- git и рабочая копия ------------------------------------------------------------------------------------------------
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const CR = Buffer.from([13]);
const exists = (abs) => {
  try {
    fs.lstatSync(abs);
    return true;
  } catch (e) {
    return false;
  }
};
const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
};
const clean = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

// Прошлый вход оборвался после записи (Т-12): его пути — к HEAD. Есть в HEAD — git checkout HEAD; нет — из индекса и с диска.
function restore(dir, paths, argLimit) {
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

// ---- Вход ---------------------------------------------------------------------------------------------------------------

// Одно подключение в общий срок входа. → { stdout } | { fail: причина }.
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

// Сверка: подключение 1 — состояние, md5 и список сервера; версии по Т-5 (Р-13); что не забирать (Р-17); скачивание неясных и
// (кроме --check) забираемых. → { fail } | { take: [{ path, kind: changed | added | removed, size, data? }], merge: [путь],
// once: [{ path, why }] — называются один раз, each: [{ path, why }] — каждый вход, waiting: [запись], findFailed }.
async function survey(c) {
  const { dir } = c;
  const site = (p) => !matchRules(p, c.rules);
  const head = treeOf(dir, 'HEAD');
  const base = baseTree(dir, c.b); // известное состояние сервера: заливка и поверх — свои коммиты входа (Р-24)
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
  const cands = [];
  for (const p of loose) {
    const raw = list.md5.get(p);
    const hit = [baseF.get(p), headF.get(p)].find((oid) => oid && variants.get(oid).has(raw));
    if (hit) server.set(p, ver(hit));
    else cands.push({ path: p, kind: 'unclear', size: list.files.get(p) }); // неясный: решит содержимое
  }
  const merge = [];
  for (const [p, v] of server) {
    const k = judge(p, v);
    if (k === 'take') cands.push({ path: p, kind: v === null ? 'removed' : 'changed', size: list.files.get(p) });
    else if (k === 'merge') merge.push(p);
  }

  // Новые на сервере: нет ни в HEAD, ни в базе, файлы сайта, не под путём из git (подмодуль, ссылка, файл вместо папки) и не
  // исключены .gitignore.
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
    else cands.push({ path: p, kind: 'added', size: list.files.get(p) });
  }

  // Что не забирается (Р-17): недопустимое имя, запрещённое к коммиту, архив, больше 10 МБ. Windows не различает регистр: новый
  // путь, совпавший без регистра с путём git или с другим новым, затёр бы чужой файл — тоже недопустимое имя.
  const forbid = parseRules([...BASE_FORBIDDEN, ...c.info.params.list('Не коммитить')]);
  const win = process.platform === 'win32';
  const lower = new Map();
  if (win) for (const p of [...known, ...cands.filter((it) => it.kind === 'added').map((it) => it.path)]) lower.set(p.toLowerCase(), (lower.get(p.toLowerCase()) || 0) + 1);
  const whyNot = (it) => {
    if (badName(it.path) || (win && it.kind === 'added' && lower.get(it.path.toLowerCase()) > 1)) return 'недопустимое имя';
    if (matchRules(it.path, forbid)) return 'запрещён к коммиту';
    return skipTake(it.path, it.size);
  };
  const once = [];
  const keep = [];
  for (const it of cands) {
    const why = whyNot(it);
    if (why) once.push({ path: it.path, why });
    else keep.push(it);
  }

  const got = await download(c, keep.filter((it) => it.kind === 'unclear' || (!c.check && it.kind !== 'removed')));
  if (got.fail) return got;
  const take = [];
  for (const it of keep) {
    if (got.failed.has(it.path)) {
      each.push({ path: it.path, why: 'не читается' });
      continue;
    }
    const data = got.data.get(it.path);
    if (!data || it.kind === 'added') {
      take.push(data ? { ...it, data } : it);
      continue;
    }
    // Скачанный отслеживаемый — версия сервера по содержимому: неясный решается точно, изменённый мог смениться после сверки.
    const k = judge(it.path, md5NoCr(data));
    if (k === 'take') take.push({ ...it, kind: 'changed', data });
    else if (k === 'merge') merge.push(it.path);
  }
  return { take: take.sort(byPath), merge: merge.sort(), once, each, waiting: [...waiting].sort(), findFailed: list.findFailed };
}

// Коммит(ы) входа через kit-commit.js (Р-16): по части путей на вызов, --push — у последней. → { code: 0, commit } | { code, lines }.
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
      out.push(`Коммит входа: ${git(dir, ['rev-parse', '--short', 'HEAD']).out.trim()} (${part.length} ${plural(part.length, 'файл', 'файла', 'файлов')})`);
      if (r.status === 4) out.push('коммит входа не отправлен: ' + ((/kit-commit: не отправлено — (.+)$/m.exec(text) || [])[1] || lastLine(text)));
      continue;
    }
    const shown = text ? text.split('\n') : [];
    const again = 'файлы записаны и остались в pending — повтор prod-entry.js вернёт их к HEAD и заберёт заново';
    if (r.status === 1) {
      return { code: 1, lines: [...shown, 'kit-commit.js остановил коммит входа (запрещённый путь или секрет в скачанном) — разбери с пользователем, как у шагов; ' + again] };
    }
    return { code: 4, lines: [...shown, `коммит входа не сделан (kit-commit.js, код ${r.status}) — ${again}; не проходит — скажи пользователю`] };
  }
  return { code: 0, commit };
}

// Вход для тестов и main. opts: { check, env, timeoutMs, sessionId, argLimit, watchersOk, bigOk (48.4) }.
// → { code, out: [строки], commit? (хеш последнего коммита входа) }.
async function entry(dir, opts = {}) {
  const out = [];
  try {
    return await enter(dir, opts, out);
  } catch (e) {
    out.push('вход не сделан: ' + e.message + ' — повтор prod-entry.js безопасен; не проходит — скажи пользователю');
    return { code: 4, out };
  }
}

async function enter(dir, opts, out) {
  const stop = (code, ...more) => {
    out.push(...more);
    return { code, out };
  };
  const info = kitInfo(dir);
  if (!info.isKit) return stop(2, 'вход не нужен: не kit-проект');
  const env = opts.env || serverEnv(info.params);
  const addrKey = env === 'дев' ? 'Дев' : 'Прод';
  const sshKey = 'SSH ' + env;
  if (!info.params.get(addrKey) && !info.params.get(sshKey)) return stop(2, `вход не нужен: сервер не задан (параметры «${addrKey}» и «${sshKey}» пусты)`);
  const target = serverSsh(info.params, env);
  if (!target) {
    const v = info.params.get(sshKey);
    if (!v) return stop(2, 'без SSH: вход по FTP — шаг 48.5');
    return stop(2, `параметр «${sshKey}» неверный: ${v} — нужно хост:/абсолютная/папка`, 'исправь его через /kit:project-init или ' + ASK);
  }
  const b = entryBase(dir, info, env);
  if (b.error) return stop(4, 'вход не сделан: ' + b.error);
  out.push(`Сервер: ${env} — ${target.host}:${target.root}`, `База: ${git(dir, ['rev-parse', '--short', b.base]).out.trim()} (${b.source})`);

  const wt = mainFolder(dir);
  const check = !!opts.check || wt !== null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT * 1000;
  const argLimit = opts.argLimit || ARG_LIMIT;
  const c = { dir, info, env, target, b, check, rules: skipRules(info), deadline: Date.now() + timeoutMs, timeoutSec: Math.round(timeoutMs / 1000) };
  const sid = opts.sessionId || process.env.KIT_SESSION_ID || lastNeed(dir) || null;
  const noMark = 'отметка не поставлена: хук не пустит правки — перезапусти сессию';
  const saveMark = (fn) => {
    try {
      const m = readMark(dir); // заново прямо перед записью: чужие записи сессий целы
      fn(m);
      writeMark(dir, m);
      return null;
    } catch (e) {
      return stop(4, 'отметка входа не записана: ' + e.message + ' — повтор prod-entry.js безопасен');
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
      return stop(4, 'отметка входа не записана: ' + e.message + ' — повтор prod-entry.js безопасен');
    }
  };

  // Р-14 п.1: прошлый вход оборвался после записи — его пути вернуть к HEAD (к забору шли только пути без наших правок).
  const pendingBefore = readMark(dir).pending;
  if (!check && pendingBefore.length) {
    restore(dir, pendingBefore.filter((p) => safePath(p) && !matchRules(p, c.rules)), argLimit);
    const bad = saveMark((m) => { m.pending = []; });
    if (bad) return bad;
  }

  const s = await survey(c);
  if (s.fail) return stop(3, 'сверка не сделана: ' + s.fail + ' — повтор безопасен', ASK);
  if (s.findFailed) out.push('find на сервере прочитал не всё — новые файлы в нечитаемых папках не сверены');
  const ours = oursPaths(dir);
  const pick = (kind) => s.take.filter((it) => it.kind === kind).map((it) => it.path);
  const [changed, added, removed] = ['changed', 'added', 'removed'].map(pick);
  const named = new Set(readMark(dir).named);
  const skipped = [...s.once.filter((it) => !named.has(it.path)), ...s.each].sort(byPath);
  const line = () => summaryLine({ env, changed, added, removed, ours: [...changed, ...removed].filter((p) => ours.has(p)).sort(), skipped, waiting: s.waiting });

  if (check) {
    if (s.take.length || s.merge.length || readMark(dir).pending.length) {
      return stop(1, line(), `есть изменения без kit — вход делает общая сессия в основной папке (${wt || projectRoot(dir)})`);
    }
    return markDone('checked') || stop(0, line());
  }

  // Р-14 п.3 (до 48.4): путь к забору с незакоммиченной правкой или «менялось и у нас, и без нас» — стоп, ничего не записано.
  const dirty = dirtyPaths(dir);
  const busy = s.take.filter((it) => dirty.has(it.path)).map((it) => it.path);
  if (busy.length || s.merge.length) {
    return stop(1, 'Совмещение — шаг 48.4; вход остановлен, ничего не записано:',
      ...busy.map((p) => '  ' + clean(p) + ' — незакоммиченная правка, а на сервере изменён без нас'),
      ...s.merge.map((p) => '  ' + clean(p) + ' — менялся и у нас, и без нас'),
      'совмещение — шаг 48.4: назови пользователю эти файлы и ' + ASK);
  }

  let commit;
  if (s.take.length) {
    // Р-14 п.4–6: pending до записи, удаления, запись через временный файл со сверкой md5, коммит(ы) входа.
    const failed = saveMark((m) => { m.pending = s.take.map((it) => it.path); });
    if (failed) return failed;
    for (const it of s.take) if (it.kind === 'removed') removeLocal(dir, it.path);
    const files = s.take.filter((it) => it.data);
    writeFilesAtomic(files.map((it) => ({ file: path.join(dir, it.path), text: it.data, label: it.path })), { mkdir: true });
    const wrong = files.filter((it) => md5(fs.readFileSync(path.join(dir, it.path))) !== md5(it.data)).map((it) => clean(it.path));
    if (wrong.length) return stop(4, 'записано не то, что скачано (md5 не совпал): ' + wrong.join(', '), 'вход не сделан — повтор prod-entry.js вернёт файлы к HEAD и заберёт заново');
    const r = commitEntry(dir, env, s.take, info.params.get('Удалённый репозиторий') || null, argLimit, out);
    if (r.code) return stop(r.code, ...r.lines);
    commit = r.commit;
  }
  const bad = saveMark((m) => {
    m.pending = [];
    m.named = [...new Set(s.once.map((it) => it.path))].sort(); // названное один раз; исчезнувшее с сервера — забывается
  });
  if (bad) return bad;
  const unmarked = markDone('done', commit);
  if (unmarked) return unmarked;
  out.push(line());
  return commit ? { code: 0, out, commit } : { code: 0, out };
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.log('prod-entry: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const later = [['--skip', o.skip], ['--ftp-done', o.ftpDone], ['--hook', o.hook]].find(([, on]) => on);
  if (later) {
    console.log('prod-entry: режим ' + later[0] + ' — в шаге 48.5');
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
    console.log('prod-entry: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 4;
  });
}
module.exports = { parseArgs, badName, pruneRules, findPrune, listScript, parseList, fetchScript, parseFetch, entry, main };
