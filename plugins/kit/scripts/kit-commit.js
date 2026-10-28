#!/usr/bin/env node
'use strict';
// Один коммит проверенного шага (с 2.14.0, вместо агента-модели; К54 — модель искажала слова в сообщении).
// Запуск в корне проекта, из Bash; сообщение — heredoc с кавычками, он ничего не подставляет:
//   node kit-commit.js [--inbox N] [--push <имя>] -- <путь1> <путь2> … <<'KIT_MSG'
//   28.1: заголовок
//
//   тело
//
//   Co-Authored-By: …
//   KIT_MSG
// Порядок: secret-scan --paths → git add → secret-scan --cached → git commit -F - -- <пути> → самопроверка
// (один новый коммит, сообщение побайтно, только переданные пути, переданных путей нет в git status).
// С 3.3.0: абсолютный путь внутри репозитория (`C:\…`, `C:/…`, `c:/…`) — сразу от корня; чужой index.lock — до 3 повторов
// git add / git commit (commit — пока HEAD прежний); свои git status — без замка индекса (--no-optional-locks).
// После проверенного коммита (с 3.0.0): --inbox N — убрать первые N входящих (decision-inbox.js); --push <имя> — отправить:
// ветки на удалённом ещё нет — сначала secret-scan --history, затем git push -u <имя> HEAD (до 90 с, без запросов в терминале;
// окно входа Git Credential Manager — для пользователя). Без --force, pull и rebase.
// Код 0 — коммит сделан и проверен (и отправлен, если просили); 1 — остановила проверка путей или секретов, коммита нет;
// 2 — ошибка запуска, git или хука, коммита нет (HEAD мог сдвинуть чужой коммит — тогда так и сказано); 3 — коммит есть,
// самопроверка нашла расхождение (или git commit вернул ошибку, а коммит с поданным сообщением и родителем уже создан —
// повтор не выполнен, сводка git show --stat);
// 4 — коммит сделан и проверен, но не отправлен (причина — строкой «kit-commit: не отправлено — …»).
// Индекс при остановке не трогается (К53): reset, restore, rm --cached, amend — не выполняются.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { norm, repoPath } = require('./lib/paths');
const { INBOX, clearFirst } = require('./decision-inbox');

const SCAN = path.join(__dirname, 'secret-scan.js');
// Меньше предела команды Bash (120 с): зависший вход — код 4 «вышло время» от самого скрипта, а не оборванный вызов
// (коммит к тому времени уже есть). Долгую первую отправку step-done запускает с увеличенным таймаутом Bash.
const PUSH_TIMEOUT_MS = 90000;

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input: input || '', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 2, stdout: '', out: r.error.message };
  return { code: r.status, stdout: r.stdout || '', out: ((r.stdout || '') + (r.stderr || '')).trimEnd() };
}
const git = (args, input) => run('git', ['-c', 'core.quotepath=false', ...args], input);
const scan = (args) => run(process.execPath, [SCAN, ...args]);
const lines = (s) => s.split('\n').map((l) => norm(l.trim())).filter(Boolean);

// Чужой index.lock (git status соседней сессии или PhpStorm держит замок доли секунды) — git add и git commit повторяются
// до 3 раз с паузой 0,5 с (с 3.3.0). safe() — можно ли повторять: для git commit — HEAD не сдвинулся, то есть коммита не было.
const LOCK_RETRIES = 3;
const LOCK_PAUSE_MS = 500;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function lockRetry(attempt, safe = () => true, pause = sleep) {
  let r = attempt();
  for (let i = 0; i < LOCK_RETRIES && r.code !== 0 && /index\.lock/.test(r.out) && safe(); i++) {
    pause(LOCK_PAUSE_MS);
    r = attempt();
  }
  return r;
}

// root — корень репозитория: абсолютный путь внутри него → путь от корня с «/» до всех проверок (с 3.3.0, lib/paths.js).
function parseArgs(argv, root = null) {
  const sep = argv.indexOf('--');
  if (sep < 0) return { error: 'нет путей: node kit-commit.js [--inbox N] [--push <имя>] -- <пути…> <<\'KIT_MSG\'' };
  let inbox = null;
  let push = null;
  const opts = argv.slice(0, sep);
  for (let i = 0; i < opts.length; i++) {
    const v = opts[i + 1] || '';
    if (opts[i] === '--inbox') {
      if (!/^\d+$/.test(v)) return { error: '--inbox: нужно число входящих, например --inbox 3' };
      inbox = Number(v);
      i++;
    } else if (opts[i] === '--push') {
      if (!v || v.startsWith('-')) return { error: '--push: нужно имя удалённого репозитория, например --push origin' };
      push = v;
      i++;
    } else {
      return { error: 'неизвестные аргументы: ' + opts.slice(i).join(' ') };
    }
  }
  const paths = argv.slice(sep + 1).map((p) => repoPath(p, root).replace(/\/+$/, '')).filter(Boolean);
  if (!paths.length) return { error: 'список файлов пуст — коммитить нечего' };
  if (paths.includes('.')) return { error: 'путь «.» не принимается — перечисли файлы шага' };
  return { paths, inbox, push };
}

// Отправка проверенного коммита: первая (ветки на удалённом нет) — после проверки всей истории. → { code: 0 | 4, lines }.
function pushTo(name) {
  const branch = git(['symbolic-ref', '--short', 'HEAD']).stdout.trim();
  if (!branch) return { code: 4, lines: ['kit-commit: не отправлено — HEAD не на ветке'] };
  const lines = [];
  if (git(['rev-parse', '--verify', '--quiet', `refs/remotes/${name}/${branch}`]).code !== 0) {
    const r = scan(['--history']);
    lines.push(r.out);
    if (r.code === 2) return { code: 4, lines: [...lines, 'kit-commit: не отправлено — проверка истории (secret-scan.js --history) не отработала'] };
    if (r.code !== 0) {
      const hits = r.out.split('\n').filter((l) => /^\s{2}\S/.test(l)).map((l) => l.trim());
      const paths = hits.filter((h) => /: запрещённый путь \(/.test(h));
      const why = paths.length === hits.length
        ? 'в истории запрещённые пути: ' + paths.map((h) => h.replace(/: запрещённый путь \(.*$/, '')).join(', ')
        : `в истории секреты: ${hits.length - paths.length} (список выше)`;
      return { code: 4, lines: [...lines, 'kit-commit: не отправлено — ' + why] };
    }
  }
  const p = spawnSync('git', ['push', '-u', name, 'HEAD'], { encoding: 'utf8', timeout: PUSH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (p.status === 0) return { code: 0, lines: [...lines, `kit-commit: отправлено в ${name}/${branch}`] };
  const err = ((p.stderr || '') + (p.stdout || '')).trim();
  // «! [rejected] … (fetch first)» — там чужие коммиты; «! [remote rejected] … (… declined)» — отказал сам сервер (хук, защита ветки).
  const why = /\[rejected\]|fetch first|non-fast-forward/i.test(err) ? 'на удалённом есть коммиты, которых здесь нет'
    : /\[remote rejected\]|declined/i.test(err) ? 'удалённый репозиторий отклонил отправку (хук или защита ветки)'
      : 'нет сети, входа или вышло время';
  return { code: 4, lines: [...lines, err.split('\n').pop() || String(p.error || ''), 'kit-commit: не отправлено — ' + why] };
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
  const early = parseArgs(argv);
  if (early.error) return stop(2, 'kit-commit: ' + early.error);
  const message = cleanMessage(input);
  if (!message) return stop(2, "kit-commit: сообщение коммита пустое — передай его в stdin (heredoc <<'KIT_MSG')");

  const top = git(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return stop(2, top.out, 'kit-commit: не репозиторий git');
  if (!samePath(top.stdout.trim(), process.cwd())) {
    return stop(2, `kit-commit: запусти из корня репозитория (${top.stdout.trim()}), а не из ${process.cwd()}`);
  }
  // Абсолютные пути «из отчёта» — от корня, до проверки путей, git add и самопроверки (корень — это cwd, проверено выше).
  const a = parseArgs(argv, process.cwd());
  if (a.error) return stop(2, 'kit-commit: ' + a.error);
  const head = () => git(['rev-parse', '--verify', '-q', 'HEAD']).stdout.trim();
  const before = head(); // '' — первый коммит

  let r = scan(['--paths', '--', ...a.paths]);
  if (r.code === 1) return stop(1, r.out, 'kit-commit: стоп — запрещённые пути, ничего не добавлено');
  if (r.code !== 0) return stop(2, r.out, 'kit-commit: secret-scan.js --paths не отработал');

  const deleted = new Set(lines(git(['diff', '--cached', '--name-only', '--diff-filter=D']).stdout));
  const toAdd = a.paths.filter((p) => !deleted.has(p));
  if (toAdd.length) {
    r = lockRetry(() => git(['add', '-A', '--', ...toAdd]));
    if (r.code !== 0) return stop(2, r.out, 'kit-commit: git add не прошёл, коммита нет');
  }

  r = scan(['--cached', '--', ...a.paths]);
  if (r.code !== 0) {
    const why = r.code === 1 ? 'стоп — найдены секреты' : 'secret-scan.js --cached не отработал';
    return stop(r.code === 1 ? 1 : 2, r.out,
      `kit-commit: ${why}, коммита нет. Индекс оставлен как есть:`, git(['diff', '--cached', '--name-only']).out);
  }

  // Повтор — только пока HEAD прежний: упавший git commit мог всё же создать коммит, второй повтор его не удвоит.
  r = lockRetry(() => git(['commit', '-q', '--cleanup=whitespace', '-F', '-', '--', ...a.paths], message), () => head() === before);
  // Родители и сообщение HEAD — для самопроверки и для вопроса «чей коммит», когда git commit упал, а HEAD сдвинулся.
  const headInfo = () => {
    const raw = git(['cat-file', 'commit', 'HEAD']).stdout;
    return { parents: git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(/\s+/).slice(1), stored: raw.slice(raw.indexOf('\n\n') + 2) };
  };
  const statReport = () => {
    const stat = git(['show', '--stat', '--format=%h %s', 'HEAD']).out.split('\n');
    return [stat[0], ...(stat.length <= 22 ? stat.slice(1) : [stat[stat.length - 1]])];
  };
  if (r.code !== 0) {
    const now = head();
    if (now === before) return stop(2, r.out, 'kit-commit: git commit не прошёл, коммита нет');
    // HEAD сдвинулся: свой — только с поданным сообщением и родителем before; иначе это коммит соседней сессии.
    const h = headInfo();
    const was = `был ${before || 'нет'}, стал ${now}`;
    if (h.stored !== message || h.parents.join(' ') !== before) {
      return stop(2, r.out, `kit-commit: git commit не прошёл — HEAD сдвинул чужой коммит, наш не создан (${was})`);
    }
    return stop(3, r.out, ...statReport(), `kit-commit: git commit вернул ошибку, но коммит с поданным сообщением создан (${was}) — повтор не выполнен`);
  }

  const problems = [];
  const { parents, stored } = headInfo();
  if (parents.join(' ') !== before) problems.push(`новых коммитов не один: родитель ${parents.join(' ') || 'нет'}, был HEAD ${before || 'нет'}`);
  if (stored !== message) problems.push('сообщение в коммите отличается от поданного:\n--- подано\n' + message + '--- в коммите\n' + stored);
  const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']).stdout);
  const extra = files.filter((f) => !a.paths.some((p) => f === p || f.startsWith(p + '/')));
  if (extra.length) problems.push('в коммите файлы сверх переданных: ' + extra.join(', '));
  const left = git(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall', '--', ...a.paths]).stdout.split('\0').filter((x) => x.length > 3).map((x) => x.slice(3));
  if (left.length) problems.push('после коммита в git status остались: ' + left.join(', '));

  const report = statReport();
  const status = git(['--no-optional-locks', 'status', '--short']).out;
  console.log([...report, 'git status --short:', status || '(чисто)'].join('\n'));
  if (problems.length) return stop(3, 'kit-commit: коммит создан, но самопроверка нашла расхождение:', ...problems);
  const done = ['kit-commit: сообщение совпало с поданным, в коммите только переданные пути'];
  if (a.inbox) done.push(`kit-commit: входящих убрано: ${clearFirst(path.join(process.cwd(), INBOX), a.inbox)}`);
  if (!a.push) return stop(0, ...done);
  const sent = pushTo(a.push);
  return stop(sent.code, ...done, ...sent.lines);
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

module.exports = { main, parseArgs, cleanMessage, lockRetry, PUSH_TIMEOUT_MS };
