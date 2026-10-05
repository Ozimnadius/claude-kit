#!/usr/bin/env node
'use strict';
// Один коммит проверенного шага (с 2.14.0, вместо агента-модели; К54 — модель искажала слова в сообщении).
// Запуск в корне проекта, из Bash; сообщение — heredoc с кавычками, он ничего не подставляет:
//   node kit-commit.js -- <путь1> <путь2> … <<'KIT_MSG'
//   28.1: заголовок
//
//   тело
//
//   Co-Authored-By: …
//   KIT_MSG
// Порядок: secret-scan --paths → git add → secret-scan --cached → git commit -F - -- <пути> → самопроверка.
// Код 0 — коммит сделан и проверен; 1 — остановила проверка путей или секретов, коммита нет;
// 2 — ошибка запуска, git или хука, коммита нет; 3 — коммит есть, самопроверка нашла расхождение.
// Индекс при остановке не трогается (К53): reset, restore, rm --cached, amend, push — не выполняются.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { norm } = require('./lib/paths');

const SCAN = path.join(__dirname, 'secret-scan.js');

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: input || '', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 2, stdout: '', out: r.error.message };
  return { code: r.status, stdout: r.stdout || '', out: ((r.stdout || '') + (r.stderr || '')).trimEnd() };
}
const git = (args, input) => run('git', ['-c', 'core.quotepath=false', ...args], input);
const scan = (args) => run(process.execPath, [SCAN, ...args]);
const lines = (s) => s.split('\n').map((l) => norm(l.trim())).filter(Boolean);

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0) return { error: 'нет путей: node kit-commit.js -- <пути…> <<\'KIT_MSG\'' };
  if (sep > 0) return { error: 'неизвестные аргументы: ' + argv.slice(0, sep).join(' ') };
  const paths = argv.slice(sep + 1).map((p) => norm(p).replace(/\/+$/, '')).filter(Boolean);
  if (!paths.length) return { error: 'список файлов пуст — коммитить нечего' };
  if (paths.includes('.')) return { error: 'путь «.» не принимается — перечисли файлы шага' };
  return { paths };
}

// Как git --cleanup=whitespace: без \r и пробелов в концах строк, повторные пустые строки — одной,
// без пустых строк в начале и конце.
function cleanMessage(text) {
  const out = [];
  for (const l of String(text).replace(/\r/g, '').split('\n').map((s) => s.replace(/\s+$/, ''))) {
    if (l === '' && (!out.length || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? out.join('\n') + '\n' : '';
}

function samePath(a, b) {
  const real = (p) => {
    let r = path.resolve(p);
    try { r = fs.realpathSync.native(r); } catch { /* как есть */ }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return real(a) === real(b);
}

function stop(code, ...msg) {
  console.log(msg.filter(Boolean).join('\n'));
  return code;
}

function main(argv, input) {
  const a = parseArgs(argv);
  if (a.error) return stop(2, 'kit-commit: ' + a.error);
  const message = cleanMessage(input);
  if (!message) return stop(2, "kit-commit: сообщение коммита пустое — передай его в stdin (heredoc <<'KIT_MSG')");

  const top = git(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return stop(2, top.out, 'kit-commit: не репозиторий git');
  if (!samePath(top.stdout.trim(), process.cwd())) {
    return stop(2, `kit-commit: запусти из корня репозитория (${top.stdout.trim()}), а не из ${process.cwd()}`);
  }
  const before = git(['rev-parse', '--verify', '-q', 'HEAD']).stdout.trim(); // '' — первый коммит

  let r = scan(['--paths', '--', ...a.paths]);
  if (r.code === 1) return stop(1, r.out, 'kit-commit: стоп — запрещённые пути, ничего не добавлено');
  if (r.code !== 0) return stop(2, r.out, 'kit-commit: secret-scan.js --paths не отработал');

  const deleted = new Set(lines(git(['diff', '--cached', '--name-only', '--diff-filter=D']).stdout));
  const toAdd = a.paths.filter((p) => !deleted.has(p));
  if (toAdd.length) {
    r = git(['add', '-A', '--', ...toAdd]);
    if (r.code !== 0) return stop(2, r.out, 'kit-commit: git add не прошёл, коммита нет');
  }

  r = scan(['--cached', '--', ...a.paths]);
  if (r.code !== 0) {
    const why = r.code === 1 ? 'стоп — найдены секреты' : 'secret-scan.js --cached не отработал';
    return stop(r.code === 1 ? 1 : 2, r.out,
      `kit-commit: ${why}, коммита нет. Индекс оставлен как есть:`, git(['diff', '--cached', '--name-only']).out);
  }

  r = git(['commit', '-q', '--cleanup=whitespace', '-F', '-', '--', ...a.paths], message);
  if (r.code !== 0) return stop(2, r.out, 'kit-commit: git commit не прошёл, коммита нет');

  const problems = [];
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(/\s+/).slice(1);
  if (parents.join(' ') !== before) problems.push(`новых коммитов не один: родитель ${parents.join(' ') || 'нет'}, был HEAD ${before || 'нет'}`);
  const raw = git(['cat-file', 'commit', 'HEAD']).stdout;
  const stored = raw.slice(raw.indexOf('\n\n') + 2);
  if (stored !== message) problems.push('сообщение в коммите отличается от поданного:\n--- подано\n' + message + '--- в коммите\n' + stored);
  const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']).stdout);
  const extra = files.filter((f) => !a.paths.some((p) => f === p || f.startsWith(p + '/')));
  if (extra.length) problems.push('в коммите файлы сверх переданных: ' + extra.join(', '));

  const stat = git(['show', '--stat', '--format=%h %s', 'HEAD']).out.split('\n');
  const report = [stat[0], ...(stat.length <= 22 ? stat.slice(1) : [stat[stat.length - 1]])];
  const status = git(['status', '--short']).out;
  console.log([...report, 'git status --short:', status || '(чисто)'].join('\n'));
  if (problems.length) return stop(3, 'kit-commit: коммит создан, но самопроверка нашла расхождение:', ...problems);
  return stop(0, 'kit-commit: сообщение совпало с поданным, в коммите только переданные пути');
}

if (require.main === module) {
  let input = '';
  try { if (!process.stdin.isTTY) input = fs.readFileSync(0, 'utf8'); } catch { /* stdin закрыт или пуст */ }
  try {
    process.exitCode = main(process.argv.slice(2), input);
  } catch (e) {
    console.log('kit-commit: ' + e.message);
    process.exitCode = 2;
  }
}

module.exports = { main, parseArgs, cleanMessage };
