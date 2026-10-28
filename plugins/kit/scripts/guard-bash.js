#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Bash|PowerShell) в kit-проектах:
// - cd вне подоболочки меняет рабочий каталог всей сессии → запрет;
// - sed -i по PHP портит обратные слеши неймспейсов → запрет;
// - только в проекте Мэтта («Система Мэтта: да»): git commit в обход /kit:step-done → запрет, а при автозаливке
//   PhpStorm Always ещё и создание веток и worktree (файлы с диска уезжают на сервер).
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

// Система Мэтта: git commit — всегда запрет; при ctx.always (PhpStorm Always) — ещё создание веток и worktree.
// Идёт по тем же сегментам, что checkCommand; слово commit не в подкоманде (git log --grep commit, echo "git commit",
// тело heredoc) не считается. Алиасы git (git ci) не разворачиваются.
function checkGit(cmd, shell, ctx) {
  const always = Boolean(ctx && ctx.always);
  for (const call of segmentsOf(cmd, shell).flatMap((seg) => gitCalls(seg, shell))) {
    if (call.sub === 'commit') return REASON_COMMIT;
    if (!always) continue;
    // Опции checkout и switch читаем до «--»: дальше идут пути.
    const dd = call.rest.indexOf('--');
    const opts = dd === -1 ? call.rest : call.rest.slice(0, dd);
    if (call.sub === 'checkout' && opts.some((a) => /^(-[bB]|--orphan(=|$))/.test(a))) return REASON_BRANCH;
    if (call.sub === 'switch' && opts.some((a) => /^(-[cC]|--create(=|$)|--force-create(=|$)|--orphan(=|$))/.test(a))) return REASON_BRANCH;
    if (call.sub === 'branch' && !call.rest.some((a) => BRANCH_VIEW.test(a)) && call.rest.some((a) => !a.startsWith('-'))) return REASON_BRANCH;
    if (call.sub === 'worktree' && call.rest[0] === 'add') return REASON_BRANCH;
  }
  return null;
}

function main() {
  try {
    const input = readStdinJson();
    const tool = input.tool_name;
    const cmd = input.tool_input && input.tool_input.command;
    if (!cmd || (tool !== 'Bash' && tool !== 'PowerShell')) return;
    const info = kitInfo(resolveProjectDir(input));
    if (!info.isKit) return;
    const shell = tool === 'PowerShell' ? 'powershell' : 'bash';
    const reason = checkCommand(cmd, shell)
      || (isMattProject(info.params)
        ? checkGit(cmd, shell, { always: /^phpstorm always/i.test(String(info.params.get('Выкладка', '')).trim()) })
        : null);
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
