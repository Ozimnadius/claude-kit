'use strict';
// Журнал проекта в формате kit 3.0 — один формат: документы в .claude/docs, журнал по частям (journal/), таблица
// текущего этапа со столбцом «Как проверено», таблица решений «| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |»,
// «Окружение» — прод или дев. Старый формат переводит /kit:project-init; до переезда kit шаги в проекте не закрывает.
const fs = require('fs');
const path = require('path');
const { normalize, splitRow } = require('./md');

const STAGE_RE = /^##\s+Этап\s+\d+/;

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

// Шапки всех markdown-таблиц текста по порядку: строка «| … |», за ней разделитель «|---|».
function tableHeads(text) {
  const lines = normalize(text).split('\n');
  const heads = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) heads.push(splitRow(lines[i]));
  }
  return heads;
}

// Текст последнего раздела «## Этап N …» до следующего заголовка # или ##; null — разделов этапов нет («## Этапы» — оглавление).
function lastStage(md) {
  const lines = normalize(md).split('\n');
  let start = -1;
  lines.forEach((l, i) => {
    if (STAGE_RE.test(l)) start = i;
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n');
}

// Признаки старого формата; пустой массив — формат текущий. Журнала ещё нет (проект до /kit:project-init) — не признак.
function oldFormat(info) {
  const signs = [];
  const p = info.params;
  const inDocs = /^\.claude\/docs\//i.test(info.journalRel);
  if (!inDocs || (!info.hasJournal && fs.existsSync(path.join(info.dir, 'docs', 'progress.md')))) signs.push('журнал не в .claude/docs');
  const parts = path.join(path.dirname(info.journalPath), 'journal');
  if (info.hasJournal) {
    if (!fs.existsSync(parts)) signs.push('журнал одним файлом');
    const stage = lastStage(read(info.journalPath) || '');
    const head = stage === null ? null : tableHeads(stage)[0];
    if (head && !head.includes('Как проверено')) signs.push('нет столбца «Как проверено»');
  }
  const decisions = read(path.join(parts, 'decisions.md'));
  const last = decisions === null ? null : tableHeads(decisions).pop();
  if (last && !last.includes('Почему')) signs.push('старая таблица решений');
  if (/^дев\s*\+\s*прод$/i.test(p.get('Окружение', '').trim())) signs.push('Окружение: дев+прод');
  if (/^вручную\s*;.*always/i.test(p.get('Выкладка', '').trim())) signs.push('Выкладка: вручную; дев — PhpStorm Always');
  return signs;
}

// Сообщение о старом формате — одно для хука старта, kit-step.js и kit-journal.js.
function oldFormatText(signs) {
  return 'Журнал или параметры в старом формате (' + signs.join('; ') + ') — до работы предложи пользователю /kit:project-init: переезд на формат kit 3.0.';
}

module.exports = { oldFormat, oldFormatText };
