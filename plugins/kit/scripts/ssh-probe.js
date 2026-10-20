#!/usr/bin/env node
'use strict';
// Разведка сервера по SSH для /kit:project-init — только чтение, одно подключение:
// node ssh-probe.js <хост> [--url адрес] [--php X.Y]
// Печатает пользователя и $HOME, папки сайта (пометка bitrix — есть bitrix/.settings.php; у такой папки — кандидаты
// рабочих папок в bitrix/ для вопроса «где правят файлы») и PHP CLI с версиями
// (пометка «совпадает» — major.minor равны X.Y). Коды: 0 — подключился; 1 — скрипт разведки на сервере завершился
// не 0 (вывод неполный); 3 — не подключился; 4 — аргументы.
const { shq, validHost, runSsh, lastLine } = require('./lib/ssh');

const USAGE = 'Использование: node ssh-probe.js <хост> [--url адрес] [--php X.Y]';

function parseArgs(argv) {
  const o = { host: null, url: null, php: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' || a === '--php') {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error('неизвестный флаг ' + a);
    } else if (o.host) {
      throw new Error('лишний аргумент ' + a);
    } else {
      o.host = a;
    }
  }
  if (!o.host) throw new Error('не указан хост');
  if (!validHost(o.host)) throw new Error('недопустимый хост ' + o.host);
  return o;
}

// Домены сайта из адреса: как есть и без www.
function domainsOf(url) {
  let h = null;
  try {
    h = new URL(url).hostname;
  } catch (e) {
    return [];
  }
  if (!h) return [];
  const bare = h.replace(/^www\./i, '');
  return bare === h ? [h] : [h, bare];
}

// Скрипт для «sh -s» на сервере: кандидаты папки сайта (ispmanager, «домен/public_html», BitrixVM) и PHP CLI;
// у папки с Битриксом — что в ней есть для вопроса «где правят файлы» (с 3.2.0): шаблоны и компоненты в bitrix/,
// папки js/css решений, init.php в bitrix/ и local/, копии шаблонов в local/templates.
function probeScript(domains) {
  const dirs = [];
  for (const d of domains) dirs.push('"$HOME"/www/' + shq(d), '"$HOME"/' + shq(d) + '/public_html', '/home/bitrix/ext_www/' + shq(d));
  dirs.push('"$HOME"/public_html', '/home/bitrix/www');
  return [
    'echo "USER $(id -un)"',
    'echo "HOME $HOME"',
    'for p in ' + dirs.join(' ') + '; do',
    '  [ -d "$p" ] || continue',
    '  r=$(readlink -f "$p" 2>/dev/null)',
    '  [ -n "$r" ] || r=$(cd "$p" 2>/dev/null && pwd -P)',
    '  [ -n "$r" ] || r="$p"',
    '  if [ -f "$p/bitrix/.settings.php" ]; then echo "DIR $r bitrix"; else echo "DIR $r"; continue; fi',
    '  for w in "$p"/bitrix/templates/*/ "$p"/bitrix/components/*/ "$p"/bitrix/js/*.*/ "$p"/bitrix/css/*.*/ "$p"/local/templates/*/; do',
    '    [ -d "$w" ] && echo "HAS $r ${w#"$p"/}"',
    '  done',
    '  for w in bitrix/php_interface/init.php local/php_interface/init.php; do [ -f "$p/$w" ] && echo "HAS $r $w"; done',
    'done',
    'for b in /opt/php*/bin/php /usr/local/php*/bin/php $(command -v php 2>/dev/null); do',
    '  [ -x "$b" ] || continue',
    '  echo "PHP $b $("$b" -r \'echo PHP_VERSION;\' </dev/null 2>/dev/null)"',
    'done',
    'exit 0',
  ].join('\n') + '\n';
}

const majorMinor = (v) => (/^(\d+\.\d+)/.exec(String(v || '')) || [])[1] || null;

// Кандидаты рабочих папок в bitrix/ по списку «что есть» (пути от корня сайта): шаблон без копии в local/templates
// (кроме .default), компоненты не bitrix, js/css решения с тем же пространством, что у компонентов, и
// bitrix/php_interface/init.php, если local/php_interface/init.php нет (тогда действует он). → { work, copies }.
function workCandidates(has) {
  const list = has.map((p) => p.replace(/\/+$/, ''));
  const name = (p) => p.split('/').pop();
  const copies = list.filter((p) => p.startsWith('local/templates/')).map(name);
  const tpl = list.filter((p) => p.startsWith('bitrix/templates/') && name(p) !== '.default');
  const ns = list.filter((p) => p.startsWith('bitrix/components/') && name(p) !== 'bitrix').map(name);
  const work = [
    ...tpl.filter((p) => !copies.includes(name(p))),
    ...ns.map((n) => 'bitrix/components/' + n),
    ...list.filter((p) => /^bitrix\/(js|css)\//.test(p) && ns.includes(name(p).split('.')[0])),
  ];
  if (list.includes('bitrix/php_interface/init.php') && !list.includes('local/php_interface/init.php')) work.push('bitrix/php_interface/init.php');
  return { work, copies: tpl.map(name).filter((t) => copies.includes(t)) };
}

// has — { папка сайта: [пути от её корня] } из строк HAS (только у папок с Битриксом).
function parseProbe(text, wantPhp) {
  const res = { user: null, home: null, dirs: [], php: [], has: {} };
  const want = majorMinor(wantPhp);
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    if ((m = /^USER (.+)$/.exec(line))) {
      res.user = m[1];
    } else if ((m = /^HOME (.+)$/.exec(line))) {
      res.home = m[1];
    } else if ((m = /^DIR (.+?)( bitrix)?$/.exec(line))) {
      if (!res.dirs.some((d) => d.path === m[1])) res.dirs.push({ path: m[1], bitrix: Boolean(m[2]) });
    } else if ((m = /^HAS (.+?) ((?:bitrix|local)\/.+)$/.exec(line))) {
      const list = (res.has[m[1]] = res.has[m[1]] || []);
      if (!list.includes(m[2])) list.push(m[2]);
    } else if ((m = /^PHP (\S+) ?(.*)$/.exec(line))) {
      const version = m[2].trim() || null;
      if (!res.php.some((x) => x.path === m[1])) {
        res.php.push({ path: m[1], version, match: Boolean(want && majorMinor(version) === want) });
      }
    }
  }
  return res;
}

function format(p) {
  const out = ['Подключение: ок (' + (p.user || '?') + ', ' + (p.home || '?') + ')'];
  for (const d of p.dirs) {
    out.push('Папка: ' + d.path + (d.bitrix ? ' [bitrix]' : ''));
    if (!d.bitrix) continue;
    const { work, copies } = workCandidates(p.has[d.path] || []);
    out.push('  где правят — кандидаты в bitrix/: ' + (work.length ? work.join(', ') : 'нет'));
    if (copies.length) out.push('  шаблоны с копией в local/templates (правят копию): ' + copies.join(', '));
  }
  if (!p.dirs.length) out.push('Папка: не найдена — спросить пользователя');
  if (p.php.length) for (const x of p.php) out.push('PHP: ' + x.path + ' ' + (x.version || '?') + (x.match ? ' [совпадает]' : ''));
  else out.push('PHP: не найден');
  return out.join('\n');
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('ssh-probe: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const r = await runSsh(o.host, 'sh -s', probeScript(o.url ? domainsOf(o.url) : []));
  if (!r.connected) {
    if (r.stderr) process.stderr.write(r.stderr);
    const why = lastLine(r.stderr);
    console.error('ssh-probe: нет подключения к ' + o.host + (why ? ': ' + why : ''));
    return 3;
  }
  console.log(format(parseProbe(r.stdout, o.php)));
  if (r.exitCode !== 0) {
    if (r.stderr) process.stderr.write(r.stderr);
    console.error('ssh-probe: скрипт разведки завершился с кодом ' + r.exitCode + ' — вывод неполный');
    return 1;
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
    console.error('ssh-probe: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 1;
  });
}
module.exports = { parseArgs, domainsOf, probeScript, parseProbe, format, workCandidates };
