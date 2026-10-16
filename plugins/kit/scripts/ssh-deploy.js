#!/usr/bin/env node
'use strict';
// Заливка шага на сервер по SSH (режим «Выкладка: Claude по SSH»): всё, что изменилось с последней заливки, — одним
// подключением, сценарием sh на stdin: файлы в base64, удаления, сверка md5.
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек]         список, без подключения
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --go    залить, удалить, сверить md5
//   node ssh-deploy.js [--env прод|дев] [--go] -- <пути>                         только эти пути (откат шага): есть
//                                                                                 локально — залить, нет — удалить
//   node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] --docs [--all] [--go]
//                                                                                 документы на сервер («Документы на сервере: да»):
//                                                                                 .claude/.htaccess (первым), .claude/CLAUDE.md,
//                                                                                 .claude/docs без visual — изменённые с базы;
//                                                                                 --all — все, без удалений (первая заливка)
// Сервер — --env, иначе «Окружение»; куда — «SSH прод» / «SSH дев» (хост:/папка). База — как у deploy-list.js
// (lib/deploy.js), но изменения — до папки проекта: и незакоммиченное, и новые файлы. Удаляется на сервере только то,
// чего нет на диске (файл, убранный из git через git rm --cached, остаётся). Повтор безопасен.
// Коды: 0 — залито и сверено (или нечего); 1 — часть не вышла; 2 — SSH не задан или параметр неверный; с --docs —
// «Документы на сервере» не «да» или нет .claude/.htaccess;
// 3 — нет подключения, обрыв, вышло время; 4 — аргументы, git, недопустимый путь (на сервер ничего не ушло).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kitInfo, serverEnv, docsOnServer } = require('./lib/project');
const { matchRules } = require('./lib/paths');
const { shq, serverSsh, runSsh, lastLine } = require('./lib/ssh');
const { skipRules, git, resolveBase, changes, docsChanges } = require('./lib/deploy');

const USAGE = 'Использование: node ssh-deploy.js [--env прод|дев] [--base <коммит>] [--timeout сек] [--docs [--all]] [--go] [-- <пути>]';
// Меньше предела инструмента Bash (120 с): при зависании — код 3, а не обрыв вызова.
const DEFAULT_TIMEOUT = 100;
const EOF = 'KIT_B64'; // в алфавите base64 нет «_» — строка тела с ней не совпадёт

function parseArgs(argv) {
  const o = { env: null, base: null, timeout: DEFAULT_TIMEOUT, go: false, paths: null, docs: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      o.paths = argv.slice(i + 1).map((p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, ''));
      if (!o.paths.length) throw new Error('после -- нет путей');
      if (o.base !== null) throw new Error('--base и пути после -- вместе не задаются');
      break;
    }
    if (a === '--go') o.go = true;
    else if (a === '--docs') o.docs = true;
    else if (a === '--all') o.all = true;
    else if (a === '--env' || a === '--base' || a === '--timeout') {
      if (i + 1 >= argv.length) throw new Error('нет значения у ' + a);
      o[a.slice(2)] = argv[++i];
    } else throw new Error('неизвестный аргумент ' + a);
  }
  if (o.all && !o.docs) throw new Error('--all — только вместе с --docs');
  if (o.docs && o.paths) throw new Error('--docs и пути после -- вместе не задаются');
  if (o.env !== null && o.env !== 'прод' && o.env !== 'дев') throw new Error('--env: прод или дев');
  if (typeof o.timeout === 'string') {
    if (!/^\d+$/.test(o.timeout) || Number(o.timeout) < 1 || Number(o.timeout) > 600) throw new Error('--timeout: секунды, от 1 до 600');
    o.timeout = Number(o.timeout);
  }
  return o;
}

// Путь от корня сайта, который можно отдать оболочке сервера: не абсолютный, без «..», без управляющих символов.
function safePath(p) {
  const s = String(p);
  return s !== '' && !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.split('/').includes('..') && !/[\x00-\x1f\x7f]/.test(s);
}

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

// Сценарий для «sh -s»: files — [{ path, data: Buffer }], del — [путь]. Итоги — строками KIT_* по номерам (пути
// в выводе не разбираются). Файл пишется во временный рядом и копируется поверх: у существующего остаются права
// и владелец, а оборванная передача не оставляет его наполовину записанным.
function buildScript(root, files, del) {
  const lines = [
    'cd ' + shq(root) + " || { echo 'KIT_ERR нет папки сайта'; exit 0; }",
    "command -v base64 >/dev/null 2>&1 && command -v md5sum >/dev/null 2>&1 || { echo 'KIT_ERR на сервере нет base64 или md5sum'; exit 0; }",
  ];
  files.forEach((f, i) => {
    const n = i + 1;
    const tmp = shq(f.path + '.kit-tmp');
    lines.push('mkdir -p ' + shq(path.posix.dirname(f.path)) + ' && base64 -d > ' + tmp + " <<'" + EOF + "'");
    const b64 = f.data.toString('base64');
    for (let k = 0; k < b64.length; k += 76) lines.push(b64.slice(k, k + 76));
    lines.push(EOF);
    lines.push('if [ $? -eq 0 ] && cat ' + tmp + ' > ' + shq(f.path) + "; then echo 'KIT_PUT " + n + "'; else echo 'KIT_FAIL " + n + "'; fi");
    lines.push('rm -f ' + tmp);
  });
  del.forEach((p, i) => {
    lines.push('rm -f -- ' + shq(p) + " && echo 'KIT_DEL " + (i + 1) + "' || echo 'KIT_FAILDEL " + (i + 1) + "'");
  });
  files.forEach((f, i) => {
    lines.push("printf 'KIT_MD5 " + (i + 1) + " %s\\n' \"$(md5sum < " + shq(f.path) + ' 2>/dev/null | cut -c1-32)"');
  });
  lines.push('exit 0');
  return lines.join('\n') + '\n';
}

function parseResult(text) {
  const r = { err: null, put: new Set(), fail: new Set(), del: new Set(), failDel: new Set(), md5: new Map() };
  for (const line of String(text).split(/\r?\n/)) {
    let m;
    if ((m = /^KIT_ERR (.+)$/.exec(line))) r.err = m[1];
    else if ((m = /^KIT_PUT (\d+)$/.exec(line))) r.put.add(Number(m[1]));
    else if ((m = /^KIT_FAIL (\d+)$/.exec(line))) r.fail.add(Number(m[1]));
    else if ((m = /^KIT_DEL (\d+)$/.exec(line))) r.del.add(Number(m[1]));
    else if ((m = /^KIT_FAILDEL (\d+)$/.exec(line))) r.failDel.add(Number(m[1]));
    else if ((m = /^KIT_MD5 (\d+) ?([0-9a-f]{32})?\s*$/.exec(line))) r.md5.set(Number(m[1]), m[2] || '');
  }
  return r;
}

const shortList = (list, max = 10) => (list.length <= max ? list.join(', ') : list.slice(0, max).join(', ') + ' и ещё ' + (list.length - max));

// Значение поля «Файлы» блока DEPLOY для /kit:step-done.
function deployLine(files, del) {
  const parts = ['залито ' + files.length + ': ' + shortList(files)];
  if (del.length) parts.push('удалено ' + del.length + ': ' + shortList(del));
  return parts.join('; ') + ' (ssh-deploy.js, md5 сверен)';
}

async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error('ssh-deploy: ' + e.message + '\n' + USAGE);
    return 4;
  }
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('ssh-deploy: здесь нет git-репозитория');
    return 4;
  }
  const info = kitInfo(cwd);
  const env = o.env || serverEnv(info.params);
  const key = 'SSH ' + env;
  const target = serverSsh(info.params, env);
  if (!target) {
    const v = info.params.get(key);
    console.error('ssh-deploy: ' + (v
      ? 'параметр «' + key + '» неверный: ' + v + ' — нужно хост:/абсолютная/папка, порт — только через ~/.ssh/config'
      : 'SSH для сервера «' + env + '» не задан (параметр «' + key + '») — заливать некуда: /kit:project-init'));
    return 2;
  }
  if (o.docs) {
    if (!docsOnServer(info.params)) {
      console.error('ssh-deploy: документы на сервер не выкладываются (параметр «Документы на сервере» — не «да»)');
      return 2;
    }
    if (!fs.existsSync(path.join(cwd, '.claude', '.htaccess'))) {
      console.error('ssh-deploy: нет .claude/.htaccess — документы были бы открыты снаружи; создайте его (/kit:project-init) — на сервер ничего не ушло');
      return 2;
    }
  }
  const rules = skipRules(info);
  const onDisk = (p) => fs.existsSync(path.join(cwd, p));
  let b;
  let upload;
  let del;
  if (o.paths) {
    // Откат шага: только названные пути, по текущему состоянию папки; исключённое из выкладки не трогаем.
    const refused = o.paths.filter((p) => !safePath(p) || matchRules(p, rules));
    if (refused.length) {
      console.error('ssh-deploy: недопустимые или исключённые из выкладки пути — на сервер ничего не ушло: '
        + refused.map((p) => JSON.stringify(p)).join(', '));
      return 4;
    }
    b = { short: '—', source: 'пути из аргументов' };
    upload = o.paths.filter(onDisk).map((p) => ({ status: 'M', path: p }));
    del = o.paths.filter((p) => !onDisk(p)).map((p) => ({ status: 'D', path: p }));
  } else if (o.all) {
    b = { short: '—', source: 'все документы, --all' };
    ({ upload, del } = docsChanges(cwd, info, { all: true }));
  } else {
    b = resolveBase(cwd, info, env, o.base);
    if (b.error) {
      console.error('ssh-deploy: ' + b.error);
      return 4;
    }
    ({ upload, del } = o.docs ? docsChanges(cwd, info, { base: b.base }) : changes(cwd, b.base, rules, { worktree: true }));
  }
  const bad = [...upload, ...del].filter((it) => !safePath(it.path));
  if (bad.length) {
    console.error('ssh-deploy: недопустимые пути — на сервер ничего не ушло: ' + bad.map((it) => JSON.stringify(it.path)).join(', '));
    return 4;
  }
  // Удалён в git, но лежит на диске (git rm --cached) — на сервере не удаляем: его могли перестать отслеживать нарочно.
  const kept = del.filter((it) => onDisk(it.path)).map((it) => it.path);
  del = del.filter((it) => !onDisk(it.path));
  const files = [];
  const skipped = [];
  for (const it of upload) {
    const abs = path.join(cwd, it.path);
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { /* нет файла */ }
    if (st && st.isFile()) files.push({ path: it.path, data: fs.readFileSync(abs) });
    else skipped.push(it.path);
  }
  const dels = del.map((it) => it.path);
  const [put, rm] = o.docs ? ['Документы — залить', 'Документы — удалить'] : ['Залить', 'Удалить'];
  const head = [
    'Сервер: ' + env + ' — ' + target.host + ':' + target.root,
    'База: ' + b.short + ' (' + b.source + ')',
    '', put + ' (' + files.length + '):', ...files.map((f) => '  ' + f.path),
    '', rm + ' (' + dels.length + '):', ...dels.map((p) => '  ' + p),
  ];
  if (kept.length) head.push('', 'Не удаляю — файл есть локально (' + kept.length + '):', ...kept.map((p) => '  ' + p));
  if (skipped.length) {
    head.push('', 'Пропущено — не файл (' + skipped.length + '):', ...skipped.map((p) => '  ' + p),
      'Подмодуль или вложенный git-репозиторий: повтор не поможет — добавьте путь в «Не выкладывать».');
  }
  console.log(head.join('\n'));
  if (!files.length && !dels.length) {
    console.log('\nНечего заливать.');
    return skipped.length ? 1 : 0;
  }
  if (!o.go) return 0;
  const r = await runSsh(target.host, 'sh -s', buildScript(target.root, files, dels), { timeoutMs: o.timeout * 1000 });
  if (!r.connected) {
    if (r.stderr) process.stderr.write(r.stderr);
    const why = r.timedOut ? 'вышло время (' + o.timeout + ' с)' : lastLine(r.stderr);
    console.error('ssh-deploy: нет подключения или обрыв' + (why ? ': ' + why : '') + ' — результат неизвестен, повтор безопасен');
    return 3;
  }
  const res = parseResult(r.stdout);
  if (res.err) {
    console.error('ssh-deploy: ' + res.err + ' — ничего не записано');
    return 1;
  }
  const problems = [];
  let ok = 0;
  files.forEach((f, i) => {
    const n = i + 1;
    if (!res.put.has(n)) problems.push(f.path + ' — ' + (res.fail.has(n) ? 'не записан' : 'результат неизвестен'));
    else if (res.md5.get(n) !== md5(f.data)) problems.push(f.path + ' — md5 не совпал');
    else ok++;
  });
  let deleted = 0;
  dels.forEach((p, i) => {
    if (res.del.has(i + 1)) deleted++;
    else problems.push(p + ' — ' + (res.failDel.has(i + 1) ? 'не удалён' : 'результат неизвестен'));
  });
  if (r.exitCode !== 0) problems.push('сценарий на сервере завершился с кодом ' + r.exitCode);
  const out = ['', 'Залито и сверено: ' + ok + ' из ' + files.length, 'Удалено: ' + deleted + ' из ' + dels.length];
  if (problems.length) {
    out.push('', 'Не вышло (' + problems.length + ') — повтор безопасен:', ...problems.map((p) => '  ' + p));
    if (r.stderr) process.stderr.write(r.stderr);
  } else if (!skipped.length && !o.docs) {
    // Строка DEPLOY — только у основной заливки: документы уезжают после записи журнала (kit-journal.js).
    out.push('', 'DEPLOY Файлы: ' + deployLine(files.map((f) => f.path), dels));
  }
  console.log(out.join('\n'));
  return problems.length || skipped.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => {
    console.error('ssh-deploy: внутренняя ошибка: ' + (e && e.message));
    process.exitCode = 4;
  });
}
module.exports = { parseArgs, safePath, buildScript, parseResult, deployLine };
