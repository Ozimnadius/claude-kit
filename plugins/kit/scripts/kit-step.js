#!/usr/bin/env node
'use strict';
// Подготовка шага к закрытию (с 3.0.0) — одной командой, только чтение, из корня проекта: node kit-step.js [<STEP>].
// Печатает: файлы шага — готовые аргументы для kit-commit.js (в кавычках, при переименовании оба пути; длинный список —
// свёрнутым в папки) и пути, которые
// скрипт коммита не пропустит; входящие ответы — готовыми строками DECISIONS и NOTES; режим — выкладка (при «Claude по SSH»
// итог сухого прогона ssh-deploy.js), «Документы на сервере», удалённый репозиторий; напоминание о закрытии этапа.
// Коды: 0 — готово; 2 — не kit-проект, нет журнала, старый формат или при «Claude по SSH» не прошёл сухой прогон
// (SSH не задан — заливать некуда); 4 — неверные аргументы.
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectDir, kitInfo, docsOnServer } = require('./lib/project');
const { oldFormat, oldFormatText } = require('./lib/journal');
const { isSsh } = require('./lib/deploy');
const { norm } = require('./lib/paths');
const { INBOX, readInbox } = require('./decision-inbox');

const SCAN = path.join(__dirname, 'secret-scan.js');
const DEPLOY = path.join(__dirname, 'ssh-deploy.js');

function run(cmd, args, cwd, input) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? 2 : r.status, stdout: r.stdout || '', stderr: (r.stderr || (r.error ? r.error.message : '')).trim() };
}
const git = (cwd, args) => run('git', ['-c', 'core.quotepath=false', ...args], cwd);

// git status -z: записи «XY путь»; у переименования и копии следом — старый путь. → [[путь] | [старый, новый]].
// Без замка индекса (--no-optional-locks, с 3.3.0): соседняя сессия в той же папке в это время может делать git add.
function stepFiles(cwd) {
  const parts = git(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall']).stdout.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length < 4) continue;
    const file = parts[i].slice(3);
    out.push(/[RC]/.test(parts[i].slice(0, 2)) ? [parts[++i], file] : [file]);
  }
  return out;
}

// Длинный список (копия папки с сервера — тысячи файлов) не влезает в командную строку Windows (~32 000 знаков; Git Bash —
// «Argument list too long»): с 3.2.0 файлы сворачиваются в самые верхние папки, все изменения в которых идут в коммит —
// без запрещённых путей и переименований. Папка для kit-commit.js — все её изменения: secret-scan.js проверит каждый файл.
// → [{ args: [путь] | [старый, новый], n — сколько файлов }].
const FOLD_CHARS = 8000;
function foldFiles(pass, blocked) {
  const list = pass.map((f) => ({ args: f, n: 1 }));
  if (pass.flat().reduce((n, p) => n + p.length + 3, 0) <= FOLD_CHARS) return list;
  const stop = new Set();
  for (const p of [...blocked.keys(), ...pass.filter((f) => f.length > 1).flat()]) {
    const segs = norm(p).split('/');
    for (let i = 1; i < segs.length; i++) stop.add(segs.slice(0, i).join('/'));
  }
  const groups = new Map();
  for (const f of pass) {
    const segs = norm(f[0]).split('/');
    let key = f.length > 1 ? null : segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join('/')).find((d) => !stop.has(d));
    if (!key) key = f.join('\0');
    const g = groups.get(key) || { dir: key, files: [] };
    g.files.push(f);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => (g.files.length > 1 ? { args: [g.dir], n: g.files.length } : { args: g.files[0], n: 1 }));
}

const plain = (s) => String(s).replace(/\s*\(Рекомендую\)/g, '').trim();
const cell = (s) => String(s).replace(/(?<!\\)\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

// Входящие → строки DECISIONS «дата | вопрос → ответ | описание выбранного | другие варианты | пользователь» и NOTES.
function inboxAsDecisions(entries) {
  const decisions = [];
  const notes = [];
  for (const e of entries) {
    if (e.type === 'note') {
      notes.push(cell(e.text));
      continue;
    }
    const answers = e.multiSelect ? String(e.answer).split(', ') : [String(e.answer)];
    const options = e.options || [];
    const chosen = options.filter((o) => answers.includes(o.label));
    const why = chosen.map((o) => o.description).filter(Boolean).join('; ');
    const rejected = options.filter((o) => !chosen.includes(o)).map((o) => plain(o.label)).join('; ');
    const answer = plain(e.answer) + (e.own ? ' (свой ответ)' : '');
    decisions.push([String(e.ts).slice(0, 10), `${e.question} → ${answer}`, why || '—', rejected || '—', 'пользователь'].map(cell).join(' | '));
  }
  return { decisions, notes };
}

// Выкладка: при «Claude по SSH» — итог сухого прогона ssh-deploy.js (к серверу он не подключается). Прогон не прошёл —
// { error }: без заливки шаг закрылся бы без проверки на сервере.
function deployLines(info, cwd) {
  if (!isSsh(info)) return { lines: ['выкладка: ' + (info.params.get('Выкладка', '').trim() || '—')] };
  const r = run(process.execPath, [DEPLOY], cwd);
  if (r.code !== 0 && r.code !== 1) {
    return { error: `сухой прогон ssh-deploy.js не прошёл (код ${r.code}): ${(r.stderr || r.stdout).split('\n')[0]} — шаг не закрыть без заливки` };
  }
  const count = (title) => (new RegExp('^' + title + ' \\((\\d+)\\):', 'm').exec(r.stdout) || [0, 0])[1];
  const out = ['выкладка: Claude по SSH — ' + (/Нечего заливать/.test(r.stdout) ? 'Нечего заливать'
    : `Залить ${count('Залить')}, Удалить ${count('Удалить')}; порядок SSH — прочитай reference/ssh.md`)];
  const skipped = r.stdout.indexOf('Пропущено — не файл');
  if (skipped >= 0) out.push(r.stdout.slice(skipped).split('\n\n')[0].trimEnd());
  return { lines: out };
}

function remoteLine(info, cwd) {
  const name = info.params.get('Удалённый репозиторий', '');
  if (!name) return 'удалённый репозиторий: —';
  if (git(cwd, ['remote', 'get-url', name]).code !== 0) return `удалённый репозиторий: ${name} — нет в git remote`;
  const branch = git(cwd, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  const first = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${name}/${branch}`]).code !== 0;
  return `удалённый репозиторий: ${name}${first ? ' — первая отправка' : ''}`;
}

function main(argv) {
  if (argv.length > 1 || (argv[0] || '').startsWith('-')) {
    console.error('Использование: node kit-step.js [<STEP>]');
    return 4;
  }
  const cwd = resolveProjectDir({});
  const info = kitInfo(cwd);
  if (!info.isKit) {
    console.error('kit-step: не kit-проект — нужен /kit:project-init');
    return 2;
  }
  if (!info.hasJournal) {
    console.error(`kit-step: журнала ${info.journalRel} нет — нужен /kit:project-init`);
    return 2;
  }
  const signs = oldFormat(info);
  if (signs.length) {
    console.error('kit-step: ' + oldFormatText(signs));
    return 2;
  }
  const deploy = deployLines(info, cwd);
  if (deploy.error) {
    console.error('kit-step: ' + deploy.error);
    return 2;
  }
  const files = stepFiles(cwd);
  const blocked = new Map();
  let scanFailed = null;
  if (files.length) {
    // Список — через stdin: тысячи путей аргументами не запустились бы, и запрещённые пути молча прошли бы проверку.
    const scan = run(process.execPath, [SCAN, '--paths', '-'], cwd, files.flat().join('\n') + '\n');
    if (scan.code !== 0 && scan.code !== 1) scanFailed = (scan.stderr || scan.stdout).split('\n')[0];
    for (const l of scan.stdout.split('\n')) {
      const m = /^\s+(.+): запрещённый путь \((.+)\)$/.exec(l);
      if (m) blocked.set(m[1], m[2]);
    }
  }
  const pass = files.filter((f) => !f.some((p) => blocked.has(norm(p))));
  const folded = foldFiles(pass, blocked);
  const out = [argv[0] ? `Шаг ${argv[0]} — подготовка к закрытию` : 'Подготовка шага к закрытию', ''];
  const dirs = folded.filter((x) => x.n > 1).length;
  out.push(`Файлы шага (${pass.length}${dirs ? `, свёрнуты в ${folded.length} пути — передай их kit-commit.js как есть: папка — все её изменения, скрипт проверит каждый файл в ней; тысячи путей по одному команда на Windows не примет` : ''}):`,
    ...(folded.length ? folded.map((x) => '  ' + x.args.map((p) => `"${p}"`).join(' ') + (x.n > 1 ? ` — папка, файлов: ${x.n}` : '')) : ['  нет']));
  if (scanFailed !== null) out.push('', `Проверка путей не отработала (secret-scan.js): ${scanFailed} — «Не пойдут в коммит» не определены, скрипт коммита проверит пути сам.`);
  if (blocked.size) out.push('', `Не пойдут в коммит (${blocked.size}):`, ...[...blocked].map(([p, why]) => `  ${p} — запрещённый путь (${why})`));
  const inbox = readInbox(path.join(cwd, INBOX));
  const { decisions, notes } = inboxAsDecisions(inbox);
  out.push('', 'Входящие:');
  if (decisions.length) out.push('DECISIONS:', ...decisions.map((d) => '- ' + d));
  if (notes.length) out.push('NOTES:', ...notes.map((n) => '- ' + n));
  out.push(`входящих: ${inbox.length}`);
  out.push('', 'Режим:', ...deploy.lines,
    'документы на сервере: ' + (!docsOnServer(info.params) ? 'нет' : isSsh(info) ? 'да — перед коммитом заливка --docs, прочитай reference/ssh.md' : 'да'),
    remoteLine(info, cwd));
  out.push('', 'Шаг закрывает этап (NEXT другого этапа или —) — прочитай reference/stage-close.md.');
  console.log(out.join('\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { inboxAsDecisions, stepFiles, foldFiles, FOLD_CHARS };
