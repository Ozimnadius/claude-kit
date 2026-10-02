#!/usr/bin/env node
'use strict';
// Хук PreToolUse (Bash|PowerShell) в kit-проектах:
// - cd вне подоболочки меняет рабочий каталог всей сессии → запрет;
// - sed -i по PHP портит обратные слеши неймспейсов → запрет.
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const BASH_CD = new Set(['cd', 'pushd', 'popd']);
const PS_CD = new Set(['cd', 'chdir', 'sl', 'set-location']);
const SKIP_WORDS = new Set(['then', 'do', 'else', '!', 'time']);

const REASON_CD = 'cd в Bash меняет рабочий каталог всей сессии. Используй абсолютные пути (git -C <путь>, node <путь>) или подоболочку ( cd <путь> && … ).';
const REASON_CD_PS = 'cd/Set-Location в PowerShell меняет рабочий каталог всей сессии (скобки не помогают). Используй абсолютные пути, -LiteralPath, git -C <путь>.';
const REASON_SED = 'sed -i по PHP портит обратные слеши неймспейсов. Правь PHP через Edit (или скриптом на node/python).';

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

function checkCommand(cmd, shell) {
  let src = shell === 'powershell' ? stripHereStrings(cmd) : stripHeredocs(cmd);
  src = stripComments(src, shell);
  const segs = splitCommands(src, shell);
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

function main() {
  try {
    const input = readStdinJson();
    const tool = input.tool_name;
    const cmd = input.tool_input && input.tool_input.command;
    if (!cmd || (tool !== 'Bash' && tool !== 'PowerShell')) return;
    if (!kitInfo(resolveProjectDir(input)).isKit) return;
    const reason = checkCommand(cmd, tool === 'PowerShell' ? 'powershell' : 'bash');
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
module.exports = { checkCommand, splitCommands };
