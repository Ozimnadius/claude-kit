#!/usr/bin/env node
'use strict';
// Входящие ответы пользователя — материал для DECISIONS в /kit:step-done (решения не теряются при сжатии контекста).
//   --hook      хук PostToolUse (AskUserQuestion): в kit-проекте дописывает по строке JSON на вопрос
//               в .claude/kit-inbox.jsonl — вопрос, варианты с описаниями, ответ, свой ли это текст. Всегда код 0, без вывода.
//   --list      входящие для Claude, по порядку; последняя строка — «записей: N». Нет — «Входящих ответов нет.»
//   --clear N   убрать первые N записей — разобранные (ответы, пришедшие после --list, остаются).
// Отсеивает процедурные вопросы («Закрывать?», «Начинать?») не скрипт, а Claude в /kit:step-done — по смыслу.
// Файл локальный: в git не идёт (шаблоны .gitignore, запрет в secret-scan), из выкладки исключён хуком phpstorm-exclude.js.
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const INBOX = path.join('.claude', 'kit-inbox.jsonl');

// Ответы — в результате инструмента (так их пишет и журнал сессии), запасной путь — во входе.
function answersOf(input) {
  let res = input.tool_response;
  if (typeof res === 'string') {
    try {
      res = JSON.parse(res);
    } catch (e) {
      res = null;
    }
  }
  const a = (res && res.answers) || (input.tool_input && input.tool_input.answers);
  return a && typeof a === 'object' ? a : null;
}

// → строки записей; вопрос без ответа (диалог закрыли) не пишется.
function entriesOf(input, now = new Date()) {
  const answers = answersOf(input);
  const questions = (input.tool_input && input.tool_input.questions) || [];
  if (!answers || !Array.isArray(questions)) return [];
  const out = [];
  for (const q of questions) {
    if (!q || typeof q.question !== 'string' || !(q.question in answers)) continue;
    const answer = String(answers[q.question]);
    const options = (q.options || []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') }));
    const labels = new Set(options.map((o) => o.label));
    // Мультивыбор приходит подписями через «, »; не совпало ни с одной подписью — свой текст из «Другое».
    const parts = q.multiSelect ? answer.split(', ') : [answer];
    out.push({
      ts: now.toISOString(),
      session: input.session_id || '',
      question: q.question,
      header: q.header || '',
      multiSelect: Boolean(q.multiSelect),
      options,
      answer,
      own: !parts.every((p) => labels.has(p)),
    });
  }
  return out;
}

function readInbox(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      // битая строка (оборванная запись) — пропустить
    }
  }
  return out;
}

function listText(entries) {
  if (!entries.length) return 'Входящих ответов нет.';
  const lines = [];
  entries.forEach((e, i) => {
    lines.push(`${i + 1}. [${String(e.ts).slice(0, 10)}] ${e.question} → ${e.answer}${e.own ? ' (свой ответ)' : ''}`);
    const chosen = e.options.filter((o) => o.label === e.answer || (e.multiSelect && e.answer.split(', ').includes(o.label)));
    for (const o of chosen) if (o.description) lines.push(`   выбрано: ${o.label} — ${o.description}`);
    const other = e.options.filter((o) => !chosen.includes(o));
    if (other.length) lines.push(`   другие: ${other.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label)).join('; ')}`);
  });
  lines.push(`записей: ${entries.length}`);
  return lines.join('\n');
}

// Убрать первые n строк; остальное — тем же текстом. Ничего не осталось — файл удаляется.
function clearFirst(file, n) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return 0;
  }
  const lines = text.split('\n').filter((l) => l.trim());
  const rest = lines.slice(n);
  if (rest.length) fs.writeFileSync(file, rest.join('\n') + '\n');
  else fs.rmSync(file, { force: true });
  return Math.min(n, lines.length);
}

function hook() {
  try {
    const input = readStdinJson();
    if (input.tool_name && input.tool_name !== 'AskUserQuestion') return;
    const dir = resolveProjectDir(input);
    if (!kitInfo(dir).isKit) return;
    const entries = entriesOf(input);
    if (!entries.length) return;
    const file = path.join(dir, INBOX);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  } catch (e) {
    // хук не должен ломать сессию
  }
}

function main(argv) {
  if (argv.includes('--hook')) {
    hook();
    return 0;
  }
  const file = path.join(resolveProjectDir({}), INBOX);
  if (argv.includes('--list')) {
    console.log(listText(readInbox(file)));
    return 0;
  }
  const ci = argv.indexOf('--clear');
  if (ci >= 0) {
    const n = Number(argv[ci + 1]);
    if (!Number.isInteger(n) || n < 0) {
      console.error('--clear: нужно число записей, например --clear 3 (из строки «записей: N» вывода --list)');
      return 2;
    }
    console.log(`Убрано записей: ${clearFirst(file, n)}.`);
    return 0;
  }
  console.error('Использование: node decision-inbox.js --hook | --list | --clear N');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { INBOX, entriesOf, readInbox, listText, clearFirst };
