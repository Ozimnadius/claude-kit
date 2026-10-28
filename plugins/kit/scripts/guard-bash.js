#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Bash|PowerShell) в kit-проектах:
// - cd вне подоболочки меняет рабочий каталог всей сессии → запрет;
// - sed -i по PHP портит обратные слеши неймспейсов → запрет;
// - только в проекте Мэтта («Система Мэтта: да»): коммит в обход /kit:step-done (commit, merge локальной ветки, revert,
//   cherry-pick, am; завершение начатого слияния при MERGE_HEAD — пропуск), создание веток и worktree → запрет
//   при любой выкладке; при автозаливке PhpStorm Always ещё и перезапись рабочей копии (bisect, stash, checkout
//   и switch на другой коммит или ветку, reset --hard, restore --source, rebase, pull --rebase): файлы с диска уезжают
//   на сервер.
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');
const { isMattProject } = require('./lib/matt');

const BASH_CD = new Set(['cd', 'pushd', 'popd']);
const PS_CD = new Set(['cd', 'chdir', 'sl', 'set-location']);
const SKIP_WORDS = new Set(['then', 'do', 'else', '!', 'time']);

const REASON_CD = 'cd в Bash меняет рабочий каталог всей сессии. Используй абсолютные пути (git -C <путь>, node <путь>) или подоболочку ( cd <путь> && … ).';
const REASON_CD_PS = 'cd/Set-Location в PowerShell меняет рабочий каталог всей сессии (скобки не помогают). Используй абсолютные пути, -LiteralPath, git -C <путь>.';
const REASON_SED = 'sed -i по PHP портит обратные слеши неймспейсов. Правь PHP через Edit (или скриптом на node/python).';
const REASON_COMMIT = 'Коммит — только через /kit:step-done (kit-commit.js): в проекте Мэтта исполнитель не коммитит, тикет принимает общая сессия.';
const REASON_BRANCH = 'При автозаливке PhpStorm ветки и worktree нельзя: файлы с диска уезжают на сервер. Работай в текущей ветке основной папки.';
const REASON_BRANCH_MATT = 'В проекте Мэтта ветки и worktree не используем: шаг коммитится в текущую ветку основной папки через /kit:step-done; '
  + 'прототип и исследования — в тикет и папку документов (work/<тема>/).';
const REASON_REWRITE = 'При автозаливке PhpStorm нельзя переписывать рабочую копию старыми версиями (bisect, stash, переход на другой коммит '
  + 'или ветку, reset --hard): файлы с диска сразу уезжают на сервер. Бисекцию и опыты со старыми версиями — в отдельной копии: '
  + 'git clone во временную папку.';

function stripHeredocs(cmd) {
  return cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' $3');
}

function stripHereStrings(cmd) {
  return cmd.replace(/@(['"])[ \t]*\r?\n[\s\S]*?\r?\n\1@/g, "''");
}

// Комментарии вне кавычек — до конца строки (# в начале слова: начало строки/после пробела,
// табуляции, ; & | ( ); PowerShell — ещё и после закрывающей кавычки, и блочные <# … #>. В bash
// # сразу после закрывающей кавычки — часть слова (echo 'a'#b), не комментарий. # внутри бареворда
// (a#b, ${#x}, $#, URL https://a.ru/#x) — не комментарий. Вызывать после
// stripHeredocs/stripHereStrings — тело heredoc/here-string не должно разбираться на комментарии.
function stripComments(cmd, shell) {
  const esc = shell === 'powershell' ? '`' : '\\';
  const BOUNDARY = new Set([' ', '\t', ';', '&', '|', '(', ')', '\n', '\r']);
  let out = '';
  let q = null;
  let atWordStart = true;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      out += ch;
      if (ch === esc && q === '"') {
        out += cmd[i + 1] || '';
        i++;
        atWordStart = false;
      } else if (ch === q) {
        q = null;
        atWordStart = shell === 'powershell';
      } else {
        atWordStart = false;
      }
      continue;
    }
    if (ch === esc) {
      out += ch + (cmd[i + 1] || '');
      i++;
      atWordStart = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      out += ch;
      atWordStart = false;
      continue;
    }
    if (shell === 'powershell' && ch === '<' && cmd[i + 1] === '#') {
      const end = cmd.indexOf('#>', i + 2);
      i = end === -1 ? cmd.length - 1 : end + 1;
      out += ' ';
      atWordStart = true;
      continue;
    }
    if (ch === '#' && atWordStart) {
      let j = i;
      while (j < cmd.length && cmd[j] !== '\n') j++;
      i = j - 1;
      atWordStart = false;
      continue;
    }
    out += ch;
    atWordStart = BOUNDARY.has(ch);
  }
  return out;
}

// Команды верхнего уровня: text — без содержимого кавычек, raw — как есть, depth — глубина скобок в начале.
function splitCommands(cmd, shell) {
  const out = [];
  const esc = shell === 'powershell' ? '`' : '\\';
  let text = '';
  let raw = '';
  let depth = 0;
  let startDepth = 0;
  let q = null;
  const push = () => {
    out.push({ text, raw, depth: startDepth });
    text = '';
    raw = '';
    startDepth = depth;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) {
      raw += ch;
      if (ch === esc && q === '"') {
        raw += cmd[i + 1] || '';
        i++;
      } else if (ch === q) {
        q = null;
        text += ' ';
      }
      continue;
    }
    if (ch === esc) {
      raw += ch + (cmd[i + 1] || '');
      text += ' ';
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      raw += ch;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      push();
      i++;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n' || ch === '\r') {
      push();
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    text += ch;
    raw += ch;
  }
  push();
  return out;
}

function firstWord(seg, shell) {
  let s = seg.text.trim();
  let depth = seg.depth;
  for (;;) {
    if (s.startsWith('$(')) {
      depth++;
      s = s.slice(2).trim();
      continue;
    }
    if (s.startsWith('(')) {
      depth++;
      s = s.slice(1).trim();
      continue;
    }
    if (s.startsWith('{')) {
      s = s.slice(1).trim();
      continue;
    }
    const m = /^(\S+)\s*/.exec(s);
    if (!m) return null;
    const w = m[1];
    if (SKIP_WORDS.has(w.toLowerCase()) || (shell === 'bash' && /^[A-Za-z_]\w*=/.test(w))) {
      s = s.slice(m[0].length);
      continue;
    }
    return { word: w.toLowerCase().replace(/[)}]+$/, ''), depth };
  }
}

// .php считается целью sed, если он есть вне кавычек (seg.text), либо если весь закавыченный
// аргумент оканчивается на .php (seg.raw) — иначе `sed -i 's/old.php/new.php/' file.txt` ловится
// по .php внутри самого sed-скрипта, хотя реальная цель — file.txt.
function hasPhpTarget(seg) {
  return /\.php\b/i.test(seg.text) || /(['"])[^'"]*\.php\1/i.test(seg.raw);
}

// Сегменты команды без heredoc, here-string и комментариев — общие для checkCommand и checkGit.
function segmentsOf(cmd, shell) {
  let src = shell === 'powershell' ? stripHereStrings(cmd) : stripHeredocs(cmd);
  src = stripComments(src, shell);
  return splitCommands(src, shell);
}

function checkCommand(cmd, shell) {
  const segs = segmentsOf(cmd, shell);
  for (const seg of segs) {
    const fw = firstWord(seg, shell);
    if (!fw) continue;
    if (shell === 'bash' && BASH_CD.has(fw.word) && fw.depth === 0) return REASON_CD;
    if (shell === 'powershell' && PS_CD.has(fw.word)) return REASON_CD_PS;
  }
  for (const seg of segs) {
    if (/(^|\s)sed(\s|$)/.test(seg.text)
      && /(^|\s)(-[A-Za-z]*i[A-Za-z.]*|--in-place)(?=[\s=]|$)/.test(seg.text)
      && hasPhpTarget(seg)) return REASON_SED;
  }
  return null;
}

// Слова сегмента по raw: text кавычки вырезает, и аргумент в кавычках (git -C "C:\my dir" commit) съел бы подкоманду.
// Внутри кавычек escape остаётся как есть (путь C:\x\git.exe цел), вне кавычек — снимается; escape перед концом
// строки — продолжение строки, то есть разделитель слов.
function wordsOf(raw, shell) {
  const esc = shell === 'powershell' ? '`' : '\\';
  const out = [];
  let w = null;
  let q = null;
  const end = () => {
    if (w !== null) out.push(w);
    w = null;
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === esc && q === '"') {
        w += ch + (raw[i + 1] || '');
        i++;
      } else w += ch;
      continue;
    }
    if (ch === esc) {
      const next = raw[i + 1] || '';
      if (next === '\n' || next === '\r' || next === '') end();
      else w = (w || '') + next;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      if (w === null) w = '';
      continue;
    }
    if (/\s/.test(ch)) end();
    else w = (w || '') + ch;
  }
  end();
  return out;
}

// Слова перед командой: к SKIP_WORDS (then, do, …) — ещё if/elif/elseif/while/until. Условие PowerShell в скобках
// (if ($?) { git commit }) отдельно не снимается: команда в блоке начинается после «{», см. gitCalls.
const GIT_SKIP = new Set([...SKIP_WORDS, 'if', 'elif', 'elseif', 'while', 'until']);
// Глобальные опции git, которым нужен отдельный аргумент (-C dir, -c k=v, --git-dir dir, …); остальные «-…» — флаги.
const GIT_OPT_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
// Опции git branch, при которых слово рядом (в том числе значение опции отдельным словом) ветку не создаёт:
// просмотр, удаление, переименование, смена отслеживаемой ветки, описание.
const BRANCH_VIEW = new RegExp('^(-[A-Za-z]*[arldDmMv][A-Za-z]*|-u|--list|--delete|--move|--show-current|--contains|--no-contains|'
  + '--merged|--no-merged|--sort|--points-at|--format|--set-upstream-to|--unset-upstream|--edit-description)(=|$)');
const OPENERS = /^(\$\(|\(|\{)+/;

// Вызов git в начале списка слов → { sub, rest } (подкоманда и её слова после глобальных опций); не git — null.
function gitCallOf(ws, shell) {
  let i = 0;
  for (; i < ws.length; i++) {
    const w = ws[i].replace(OPENERS, '');
    if (w === '' || GIT_SKIP.has(w.toLowerCase()) || (shell === 'bash' && /^[A-Za-z_]\w*=/.test(w))) continue;
    break;
  }
  if (i >= ws.length) return null;
  // git, git.exe и путь к нему ("C:/Program Files/Git/cmd/git.exe").
  const bin = ws[i].replace(OPENERS, '').split(/[\\/]/).pop().toLowerCase();
  if (bin !== 'git' && bin !== 'git.exe') return null;
  let j = i + 1;
  for (; j < ws.length && ws[j].startsWith('-'); j++) {
    if (GIT_OPT_ARG.has(ws[j])) j++;
  }
  if (j >= ws.length) return null;
  // Хвост — до закрывающей «}» блока; скобки на концах слов (git branch -d x) — не часть аргумента.
  let rest = ws.slice(j + 1);
  const close = rest.indexOf('}');
  if (close !== -1) rest = rest.slice(0, close);
  rest = rest.map((a) => a.replace(/[)}]+$/, '')).filter((a) => a !== '');
  return { sub: ws[j].replace(/[)}]+$/, ''), rest };
}

// Вызовы git в сегменте. Команда начинается в начале сегмента и после каждой «{» и «}» в середине: блоки PowerShell
// (if ($?) { git commit }, ... | ForEach-Object { git commit }, } else { git commit }, if($x){git commit}).
function gitCalls(seg, shell) {
  const ws = wordsOf(seg.raw, shell);
  const lists = [ws];
  ws.forEach((w, k) => {
    if (w === '}') lists.push(ws.slice(k + 1));
    for (let p = w.indexOf('{'); p !== -1; p = w.indexOf('{', p + 1)) lists.push([w.slice(p), ...ws.slice(k + 1)]);
  });
  return lists.map((l) => gitCallOf(l, shell)).filter(Boolean);
}

// Подкоманды, которые создают коммит без git commit, и слова, при которых коммита нет: выход из начатой операции,
// --no-commit, fast-forward. --continue сюда не входит — он и создаёт коммит. git pull и git push коммитом не считаем.
const COMMIT_LIKE = new Map([
  ['merge', new Set(['--abort', '--quit', '--ff-only'])],
  ['revert', new Set(['--abort', '--quit', '--skip', '--no-commit', '-n'])],
  ['cherry-pick', new Set(['--abort', '--quit', '--skip', '--no-commit', '-n'])],
  ['am', new Set(['--abort', '--quit', '--skip'])],
]);
// Удалённая ветка в git merge: <remote>/<ветка>, refs/remotes/…, @{u}/@{upstream}/@{push} (и <ветка>@{u}), FETCH_HEAD.
// Локальные ветки в проекте Мэтта не создаются, поэтому «x/y» (кроме refs/heads/… и прочих refs/) считаем удалённой.
// «}» на конце слова gitCallOf срезает — отсюда «\}?».
const REMOTE_REF = /^(FETCH_HEAD|refs\/remotes\/\S+|(?!refs\/)[^\s/@-][^\s@]*\/\S+|[^\s@]*@\{(u|upstream|push)\}?)$/i;
// Опции git merge со значением отдельным словом: значение — не ветка.
const MERGE_OPT_ARG = new Set(['-m', '-F', '-s', '-X', '--message', '--file', '--strategy', '--strategy-option', '--into-name', '--cleanup']);
// Подкоманды bisect и stash, которые рабочую копию не трогают (bisect reset возвращает её, если бисекция уже начата).
const BISECT_OK = new Set(['reset', 'log', 'view', 'visualize']);
const STASH_OK = new Set(['list', 'show']);
// Выход из начатого rebase рабочую копию к старым версиям не ведёт.
const REBASE_OK = new Set(['--abort', '--quit', '--show-current-patch']);

// git merge только удалённых веток (без веток — upstream): поток kit «ветка разошлась с удалённой — слияние с согласия
// пользователя» (remote-check.js, step-done/reference/push.md). --continue — коммит при любых ветках.
function mergesRemote(rest) {
  if (rest.includes('--continue')) return false;
  const refs = [];
  for (let k = 0; k < rest.length; k++) {
    if (MERGE_OPT_ARG.has(rest[k])) k++;
    else if (!rest[k].startsWith('-')) refs.push(rest[k]);
  }
  return refs.every((r) => REMOTE_REF.test(r));
}

// Завершение начатого слияния: git merge --continue или git commit без путей и без «--» (допустимы -m, -F, --no-edit, -q).
// -a, --amend и прочие опции не допускаются: -a забрал бы в коммит слияния и чужие правки.
const FINISH_OPT_ARG = new Set(['-m', '--message', '-F', '--file']);
const FINISH_FLAGS = new Set(['--no-edit', '-q', '--quiet']);
function finishesMerge(call) {
  if (call.sub === 'merge') return call.rest.includes('--continue') && call.rest.every((a) => a === '--continue' || FINISH_FLAGS.has(a));
  if (call.sub !== 'commit') return false;
  for (let k = 0; k < call.rest.length; k++) {
    const a = call.rest[k];
    if (FINISH_OPT_ARG.has(a)) k++;
    else if (!FINISH_FLAGS.has(a) && !/^(-[mF].|--(message|file)=)/.test(a)) return false;
  }
  return true;
}

// Идёт слияние: в каталоге git проекта есть файл MERGE_HEAD. Каталог — <корень>/.git или путь из файла .git («gitdir: …»,
// относительный — от корня). Любой сбой — «слияния нет».
function mergeInProgress(dir) {
  try {
    let gitDir = path.join(dir, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return false;
      gitDir = path.resolve(dir, m[1]);
    }
    return fs.statSync(path.join(gitDir, 'MERGE_HEAD')).isFile();
  } catch (e) {
    return false;
  }
}

// Вызов создаёт коммит в обход kit-commit.js.
function makesCommit(call) {
  if (call.sub === 'commit') return true;
  const noCommit = COMMIT_LIKE.get(call.sub);
  if (!noCommit || call.rest.some((a) => noCommit.has(a))) return false;
  return !(call.sub === 'merge' && mergesRemote(call.rest));
}

// Вызов создаёт ветку или worktree; opts — слова до «--».
function createsBranch(call, opts) {
  if (call.sub === 'checkout') return opts.some((a) => /^(-[bB]|--orphan(=|$))/.test(a));
  if (call.sub === 'switch') return opts.some((a) => /^(-[cC]|--create(=|$)|--force-create(=|$)|--orphan(=|$))/.test(a));
  if (call.sub === 'branch') return !call.rest.some((a) => BRANCH_VIEW.test(a)) && call.rest.some((a) => !a.startsWith('-'));
  if (call.sub === 'stash') return call.rest[0] === 'branch';
  return call.sub === 'worktree' && call.rest[0] === 'add';
}

// Источник git restore (--source X, --source=X, -s X, -sX) — не HEAD.
function restoreFromOther(opts) {
  for (let k = 0; k < opts.length; k++) {
    const a = opts[k];
    let v = null;
    if (a === '--source' || a === '-s') v = opts[k + 1];
    else if (a.startsWith('--source=')) v = a.slice('--source='.length);
    else if (/^-s./.test(a)) v = a.slice(2);
    if (v !== null && v !== 'HEAD') return true;
  }
  return false;
}

// Вызов переписывает рабочую копию другой версией (создание ветки разобрано раньше); hasDd — есть «--», opts — слова до него.
function rewritesTree(call, hasDd, opts) {
  switch (call.sub) {
    case 'bisect': return !BISECT_OK.has(call.rest[0]);
    case 'stash': return !STASH_OK.has(call.rest[0]);
    case 'switch': return true;
    // Без «--» — ветка, коммит или файлы из индекса; с «--» — ревизия перед ним, если она не HEAD (ssh.md: checkout HEAD -- <путь>).
    case 'checkout': return !hasDd || opts.some((a) => !a.startsWith('-') && a !== 'HEAD');
    case 'reset': return opts.some((a) => /^--(hard|merge|keep)$/.test(a));
    case 'restore': return restoreFromOther(opts);
    // rebase переключает рабочую копию на upstream и при конфликте оставляет файлы с маркерами; pull --rebase — так же.
    case 'rebase': return !call.rest.some((a) => REBASE_OK.has(a));
    case 'pull': return opts.some((a) => a === '-r' || a === '--rebase' || (a.startsWith('--rebase=') && a !== '--rebase=false'));
    default: return false;
  }
}

// Система Мэтта: коммит в обход /kit:step-done, ветки и worktree — запрет при любой выкладке (причина ветки — по ctx.always);
// при ctx.always (PhpStorm Always) — ещё перезапись рабочей копии. Идёт по тем же сегментам, что checkCommand; слово
// commit не в подкоманде (git log --grep commit, echo "git commit", тело heredoc) не считается. Алиасы git (git ci) не разворачиваются.
// ctx.inMerge() — идёт ли слияние (MERGE_HEAD); зовётся только для завершения слияния, которое иначе получило бы отказ.
function checkGit(cmd, shell, ctx) {
  const always = Boolean(ctx && ctx.always);
  const inMerge = () => {
    try {
      return Boolean(ctx && typeof ctx.inMerge === 'function' && ctx.inMerge() === true);
    } catch (e) {
      return false;
    }
  };
  for (const call of segmentsOf(cmd, shell).flatMap((seg) => gitCalls(seg, shell))) {
    if (makesCommit(call)) {
      // Слияние удалённой ветки с согласия пользователя упёрлось в конфликт — завершить его больше нечем.
      if (finishesMerge(call) && inMerge()) continue;
      return REASON_COMMIT;
    }
    // Опции читаем до «--»: дальше идут пути.
    const dd = call.rest.indexOf('--');
    const opts = dd === -1 ? call.rest : call.rest.slice(0, dd);
    if (createsBranch(call, opts)) return always ? REASON_BRANCH : REASON_BRANCH_MATT;
    if (always && rewritesTree(call, dd !== -1, opts)) return REASON_REWRITE;
  }
  return null;
}

function main() {
  try {
    const input = readStdinJson();
    const tool = input.tool_name;
    const cmd = input.tool_input && input.tool_input.command;
    if (!cmd || (tool !== 'Bash' && tool !== 'PowerShell')) return;
    const dir = resolveProjectDir(input);
    const info = kitInfo(dir);
    if (!info.isKit) return;
    const shell = tool === 'PowerShell' ? 'powershell' : 'bash';
    const always = /^phpstorm always/i.test(String(info.params.get('Выкладка', '')).trim());
    const reason = checkCommand(cmd, shell)
      || (isMattProject(info.params) ? checkGit(cmd, shell, { always, inMerge: () => mergeInProgress(dir) }) : null);
    if (!reason) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: '[kit] ' + reason,
      },
    }));
  } catch (e) {
    // хук не должен ломать сессию
  }
}

if (require.main === module) main();
module.exports = { checkCommand, checkGit, splitCommands };
