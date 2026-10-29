#!/usr/bin/env node
'use strict';
// Вход с прода (этап 48): сайт на сервере сверяется с git по SSH — что там изменили, добавили и удалили без kit, забирается в
// рабочую копию байт в байт и коммитится коммитом входа (kit-commit.js, без просмотра и вопросов: прод главный).
//   node prod-entry.js [--timeout сек]           вход: сверка, забор, коммит входа, отметка сессии done
//   node prod-entry.js --check [--timeout сек]   план входа без записи (исполнитель Мэтта; сессия в worktree — всегда так, и
//                                                сверяется основная папка проекта): файлы, индекс и pending не меняются;
//                                                вход ничего не запишет — отметка checked в папке сессии
//   --watchers-ok — забирать, хотя среди забираемого исходники File Watchers при PhpStorm Always; --big-ok — забирать больше
//   50 МБ за вход; --skip, --ftp-done, --hook — режимы шага 48.5
// Папка проекта — корень git текущей папки; сервер — «Окружение» (прод или дев), куда — «SSH прод» / «SSH дев». Три версии
// файла (база, HEAD, сервер) и правила — lib/prod.js. Сверка — одним подключением, сценарием sh на stdin: состояние, md5 и
// размер отслеживаемых файлов (пачкой, без процесса на файл) и список остальных с размером (find без того, что точно исключает
// .gitignore); md5 сервера сравнивается у нас с вариантами blob (CRLF и LF — одна версия), неясное скачивается. Наши
// незакоммиченные правки (Т-8): сервер = рабочая копия — наше уже на сервере, не трогаем; менялось и у нас, и без нас —
// совмещение (git merge-file) в рабочую копию, мимо коммита входа; не совместилось — рабочая копия не тронута, версия сервера —
// во временной папке. Порядок (Р-40): больше 50 МБ за вход — остановка до любого скачивания; кандидаты на совмещение
// скачиваются и совмещаются в памяти; File Watchers при PhpStorm Always — остановка по тому, что вход запишет, до записи;
// затем забор. Скачанное пишется через временный файл; пути забора до записи — в pending отметки (.claude/kit-prod.json):
// повтор вернёт их к HEAD и доведёт вход до конца. Много путей — несколько коммитов входа подряд.
// Коды: 0 — вход сделан (или нечего забирать; с --check — вход ничего не запишет); 1 — нужен ответ пользователя (не
// совместилось — вход сделан без этих файлов; File Watchers или больше 50 МБ — ничего не записано; запрещённый путь или секрет
// в скачанном; с --check — есть что забрать); 2 — вход не нужен, параметр неверный или на сервере нет папки сайта; 3 — нет
// подключения, обрыв, вышло время; 4 — аргументы, git, запись. Весь вывод — в stdout; последняя строка — итог для
// пользователя (код 0) или что делать Claude.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { kitInfo, serverEnv } = require('./lib/project');
const { parseRules, matchRules } = require('./lib/paths');
const { shq, serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { skipRules, git } = require('./lib/deploy');
const { projectRoot } = require('./lib/matt');
const { writeFilesAtomic } = require('./lib/atomic');
const { readDeployment } = require('./lib/deployment');
const { safePath } = require('./ssh-deploy');
const { BASE_FORBIDDEN } = require('./secret-scan');
const {
  ENTRY_LIMIT, plural, entrySubject, md5NoCr, classify, entryBase, treeOf, baseTree, skipTake, oursPaths, pendingDelete, inPending,
  watcherExts, mergeVersions, listOf, summaryLine, readMark, writeMark, markSession, lastNeed,
} = require('./lib/prod');

const USAGE = 'Использование: node prod-entry.js [--check] [--watchers-ok] [--big-ok] [--timeout сек]';
// Меньше предела инструмента Bash (120 с): зависший сервер — код 3, а не оборванный вызов. Срок — общий на все подключения входа.
const DEFAULT_TIMEOUT = 100;
// Пути одного вызова kit-commit.js: сумма длин плюс 3 знака на путь (предел командной строки Windows — 32 767 на весь вызов,
// а kit-commit.js передаёт те же пути в git).
const ARG_LIMIT = 24000;
const FETCH_LIMIT = 16 * 1024 * 1024; // скачивание за одно подключение — по размеру файлов
const UNKNOWN_SIZE = 1024 * 1024;
const REGULAR = new Set(['100644', '100755']); // ссылки (120000) и подмодули (160000) — вне сверки
const KIT_COMMIT = path.join(__dirname, 'kit-commit.js');
const SKIP = 'Работать без входа (`prod-entry.js --skip`)';
const ASK = 'спроси пользователя: Повторить / ' + SKIP;
const NO_ROOT = 'нет папки сайта'; // KIT_ERR сценариев: «SSH <окружение>» указывает не туда — код 2, а не «Повторить»
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
// .gitignore в папке от первой части P до P (hasOwnIgnore, Р-25 и М-1) — не отрезать: его «!» важнее корневого и может вернуть
// детей P или саму P; для «P целиком» — до родителя P (свой P/.gitignore git не читает).
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
    const segs = p.split('/');
    const owners = segs.slice(0, l.deep ? segs.length : segs.length - 1).map((x, i) => segs.slice(0, i + 1).join('/'));
    let blocked = (l.deep ? odd : loose.some((x) => /[[\\]/.test(x) || globName(x).test(segs[segs.length - 1]))) || owners.some(hasOwnIgnore);
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
// строки, их md5 как есть — пачкой (xargs -0 md5sum), по порядку номеров, между KIT_H и KIT_Z, их размеры — так же пачкой
// (find … -maxdepth 0 на пачку; М-11: и в отрезанных папках) до KIT_L. Затем find остальных обычных файлов с отрезанием —
// «размер путь\0» в base64 до KIT_LE <код find>; rules = null — без find (md5 только по списку). Список для md5sum — во
// временной папке mktemp -d, вне папки сайта; убирается по выходу.
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
    'echo KIT_Z',
    'if [ -s "$T/z" ]; then <"$T/z" xargs -0 sh -c \'find "$@" -maxdepth 0 -printf "%s\\n"\' sh; fi',
    'echo KIT_L',
    rules ? 'find . ' + findPrune(rules) + " -o -type f -printf '%s %P\\0' > \"$T/f\" 2>/dev/null" : ': > "$T/f"',
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
// md5: Map<путь, md5 как есть>, sizes: Map<путь, размер> — отслеживаемых «есть», files: Map<путь, размер> — все обычные файлы
// из find, findFailed }. Хеши и размеры сопоставляются с путями по порядку; имена из вывода md5sum не разбираются (строка может
// начинаться с «\» — хеш после него).
function parseList(stdout, tracked) {
  const r = { err: null, bad: null, state: new Map(), md5: new Map(), sizes: new Map(), files: new Map(), findFailed: false };
  const fail = (why) => Object.assign(r, { bad: why });
  let sec = 'states';
  const hashes = [];
  const sizes = [];
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
      if (line === 'KIT_Z') sec = 'sizes';
      else if (line) hashes.push(line);
    } else if (sec === 'sizes') {
      if (line === 'KIT_L') sec = 'list';
      else if (line) sizes.push(line);
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
  if (sizes.length !== present.length) return fail(`размеров ${sizes.length}, а файлов ${present.length}`);
  for (let i = 0; i < present.length; i++) {
    const m = /^\\?([0-9a-f]{32})(?: |$)/.exec(hashes[i]);
    if (!m) return fail('строка хеша ' + (i + 1) + ' не разобрана');
    if (!/^\d+$/.test(sizes[i])) return fail('строка размера ' + (i + 1) + ' не разобрана');
    r.state.set(present[i], 'file');
    r.md5.set(present[i], m[1]);
    r.sizes.set(present[i], Number(sizes[i]));
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

// Прошлый вход оборвался после записи (Т-12): его пути — к HEAD. Есть в HEAD — git checkout HEAD; нет — из индекса и с диска.
// Временные файлы записи рядом с путями — убрать (М-7).
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

// Сверка без скачивания: подключение 1 — состояние, md5, размеры и список сервера; версии по Т-5 (Р-13); наши правки и «наше
// уже на сервере» (Р-27, Р-28; md5 новых на сервере, которые есть и у нас, — подключением 2); что не забирать (Р-17); М-6.
// → { fail } | { items: [{ path, kind: unclear | changed | added | removed | merge, side: take | merge, size, gone — на сервере
// файла нет, raw }],
// once: [{ path, why }] — называются один раз, each: [{ path, why }] — каждый вход, waiting: [запись], findFailed,
// judge(путь, версия сервера), work — наши правки (null — кандидатов нет), baseOid(путь) — blob базы или null }.
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
  // каждый вход.
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
// раньше. → { fail } | { merged: [{ path, result }] — вход запишет, conflicts: [{ path, why, ours, theirs, base }] — версии
// (Buffer | null), each: [{ path, why }] }.
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

// Объём за вход (Р-31): сумма размеров (неизвестный — UNKNOWN_SIZE) больше предела → { total, top: [[папка, размер]] — до 5
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

// Остановка (Р-31, Р-40): вотчеры и объём — одной остановкой, одним вопросом; последняя строка — что делать Claude.
function stopLines(w, big, limit) {
  const said = [];
  const ask = [];
  if (w && w.hits.length) {
    said.push(`File Watchers PhpStorm (${w.exts.join(', ')}) — среди забираемого ${w.hits.length} ${plural(w.hits.length, 'файл', 'файла', 'файлов')}: ` +
      `${listOf(w.hits)}; пересборка перезапишет результат, PhpStorm (Always) зальёт его на сервер`);
    ask.push('по вотчерам — Забирать (`prod-entry.js --watchers-ok`; лучше выключить вотчеры на время входа) / ' + SKIP);
  }
  if (big) {
    said.push(`Забрать за вход — ${mb(big.total)} (больше ${mb(limit)}); самые тяжёлые папки: ${big.top.map(([d, n]) => clean(d) + ' — ' + mb(n)).join(', ')}`);
    ask.push('по объёму — Забрать всё (`prod-entry.js --big-ok`) / Не забирать папки (допиши их в .gitignore и повтори вход) / ' + SKIP);
  }
  return ['Вход остановлен, ничего не записано:', ...said.map((l) => '  ' + l),
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
    const what = r.status === 3 ? 'коммит входа сделан, но не проверен' : 'коммит входа не сделан';
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

// Вход для тестов и main. opts: { check, env, timeoutMs, sessionId, argLimit, entryLimit, watchersOk, bigOk }.
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
  // Р-39: сессия в worktree сверяет основную папку — её параметры, базу, HEAD, рабочую копию и pending отметки: «есть что
  // забрать» значит «вход общей сессии что-то сделает». Основная недоступна (нет, не git, не kit-проект) — своя, как в 48.3.
  // Отметка сессии (checked) — всегда в папке сессии (dir).
  const wt = mainFolder(dir);
  const home = wt !== null && usableHome(wt) ? wt : dir;
  const info = kitInfo(home);
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
  const b = entryBase(home, info, env);
  if (b.error) return stop(4, 'вход не сделан: ' + b.error, 'скажи пользователю: вход — после первого коммита исходников сайта (/kit:project-init); до того — ' + SKIP);
  out.push(`Сервер: ${env} — ${target.host}:${target.root}`, `База: ${git(home, ['rev-parse', '--short', b.base]).out.trim()} (${b.source})`);
  if (home !== dir) out.push('Сверка — по основной папке проекта: ' + home);

  const check = !!opts.check || wt !== null;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT * 1000;
  const argLimit = opts.argLimit || ARG_LIMIT;
  const entryLimit = opts.entryLimit || ENTRY_LIMIT;
  const c = { dir: home, info, env, target, b, check, rules: skipRules(info), deadline: Date.now() + timeoutMs, timeoutSec: Math.round(timeoutMs / 1000) };
  const sid = opts.sessionId || process.env.KIT_SESSION_ID || lastNeed(dir) || null;
  const noMark = 'отметка не поставлена: хук не пустит правки — перезапусти сессию';
  const saveMark = (fn) => { // только обычный вход: там home — папка сессии
    try {
      const m = readMark(home); // заново прямо перед записью: чужие записи сессий целы
      fn(m);
      writeMark(home, m);
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
  // Строка (Р-33, Р-37): числа — забранное коммитом входа (в --check — что вход запишет); наши доработки — только при непустом
  // заборе (М-4); extra — merged, conflicts или conflictsAhead.
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
    // Р-39: план входа без записи — неясные скачиваются, кандидаты на совмещение совмещаются в памяти; в проект ничего не пишется.
    // «Есть что забрать» — только то, что вход запишет: забор и совмещённое ≠ рабочей копии; конфликт, М-6, своё на сервере,
    // совмещённое раньше и «не забирать» — названы, но не держат.
    const got = await collect(c, s, takeSide, false);
    if (got.fail) return failed(got.fail);
    const mp = await mergePlan(c, s, mergeSide);
    if (mp.fail) return failed(mp.fail);
    each.push(...got.each, ...mp.each);
    const writes = [...got.take, ...mp.merged.map((m) => ({ path: m.path, kind: 'changed', gone: false }))].sort(byPath);
    const sum = line(writes, { conflictsAhead: mp.conflicts.map((k) => k.path) });
    if (writes.length || readMark(home).pending.length) {
      return stop(1, sum, `есть изменения без kit — вход делает общая сессия в основной папке (${wt || projectRoot(dir)})`);
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
  // (3) вотчеры — по тому, что вход запишет: забор (кроме удалений) и совмещённое ≠ рабочей копии; до скачивания остального забора
  // и до любой записи — ничего не записано, отметка не меняется.
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
    if (wrong.length) return stop(4, 'записано не то, что скачано (md5 не совпал): ' + wrong.join(', '), 'вход не сделан — повтор prod-entry.js вернёт файлы к HEAD и заберёт заново');
  }
  // Совмещённое — в рабочую копию, мимо pending и коммита входа (Р-26, Р-29); пишется до коммита — его остановка совмещённое не
  // откатывает (Р-34): повтор совместит заново с тем же результатом.
  const ap = applyMerges(home, mp, mergeSide);
  if (ap.wrong.length) return stop(4, 'записано не то, что совмещено (md5 не совпал): ' + ap.wrong.map(clean).join(', '), 'вход не сделан — повтор prod-entry.js совместит заново');
  // Р-30: не совместилось — по каждому пути причина, наша, версии сервера и базы (временные файлы); конфликт — на каждом входе.
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
    'вход сделан, кроме этих файлов; спроси пользователя по каждому: Совместить вручную (правь рабочую копию по версии сервера) / ' +
    'Оставить нашу (на следующем входе вопрос повторится, пока наша версия не залита) / Взять версию сервера (скопируй её в рабочую ' +
    'копию; «сервера — нет» — удали файл)');
  return { code: 1, ...done };
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
