'use strict';
// Синхронизация с продом (этап 48): сценарии для сервера по SSH («sh -s» на stdin) и разбор их ответа — сверка (состояние, md5
// и размер отслеживаемых файлов, список остальных с отрезанием по .gitignore) и скачивание (base64 между метками). Только текст
// сценариев и разбор; подключение, сверка с git и запись — в prod-sync.js, правила без SSH — в lib/prod.js.
const { shq } = require('./ssh');

const NO_ROOT = 'нет папки сайта'; // KIT_ERR сценариев: «SSH <окружение>» указывает не туда — код 2, а не «Повторить»
// Отрезается на сервере всегда: папки с этими именами на любой глубине и служебные папки в корне (как ALWAYS_SKIP выкладки).
const PRUNE_NAMES = ['.git', '.idea'];
const ALWAYS_PRUNE = ['.claude', '.superpowers', '.worktrees', 'docs/superpowers'];

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
// временной папке mktemp -d, вне папки сайта; убирается по выходу. Р-86: вызовы k — каждый своей строкой на верхнем уровне,
// поток 3 открыт exec: группу «{ …; } 3>» bash выполняет рекурсивно, глубина стека растёт с числом файлов (на Windows 4000
// файлов роняли сценарий).
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
    'exec 3> "$T/z"',
    ...tracked.map((p, i) => 'k ' + (i + 1) + ' ' + shq(p)),
    'exec 3>&-',
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

module.exports = { NO_ROOT, pruneRules, findPrune, listScript, parseList, fetchScript, parseFetch };
