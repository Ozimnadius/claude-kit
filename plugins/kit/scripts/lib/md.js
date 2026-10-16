'use strict';
// Разделы и таблицы markdown-документов проекта (журнал, план выкладки).

function normalize(md) {
  return String(md).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// Текст раздела «## <title…>» до следующего заголовка # или ##; null — раздела нет.
function getSection(md, title) {
  const lines = normalize(md).split('\n');
  const start = lines.findIndex((l) => {
    const m = /^##\s+(.*?)\s*$/.exec(l);
    return m !== null && m[1].startsWith(title);
  });
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

// Ячейки строки таблицы. «\|» — часть текста ячейки (как в GFM, в том числе внутри обратных кавычек: `Write\|Edit`);
// слеш убирается. Неэкранированный «|» делит ячейки.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

// Первая markdown-таблица в тексте: массив строк-объектов {заголовок: ячейка}.
function parseTable(text) {
  const lines = normalize(text).split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    if (!/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const head = splitRow(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      const row = {};
      head.forEach((h, k) => {
        row[h] = cells[k] === undefined ? '' : cells[k];
      });
      rows.push(row);
    }
    return rows;
  }
  return [];
}

module.exports = { getSection, parseTable, normalize };
