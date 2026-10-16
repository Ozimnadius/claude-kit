#!/usr/bin/env node
'use strict';
// Журнал шага по блокам — скриптом вместо агента-модели (с 3.0.0). Из корня проекта, блоки — на stdin:
//   node kit-journal.js <<'KIT_BLOCKS'
//   STEP: 36.3
//   …
//   KIT_BLOCKS
// Обязательные блоки: STEP, STATUS (✅ ⏳ ⏸ ❌), SUMMARY, CHECK (при ✅), NEXT («ID — строка» или «—»); необязательные:
// STAGE, BLOCKERS, DECISIONS, DOCS, BUGS, PROD_TODO, DEPLOY, NOTES, RECONCILE. Всё или ничего: при ошибке не пишет ничего.
// Вывод: раздел «Сейчас» после правки, изменённые файлы (пути от корня — аргументы для kit-commit.js), предупреждения.
// Коды: 0 — записано; 1 — записано с предупреждениями; 2 — ничего не записано (журнала нет, старый формат, нет раздела
// этапа, таблица не разбирается); 4 — неверные блоки. Дата — локальная, в тестах — KIT_TODAY.
const fs = require('fs');
const { resolveProjectDir, kitInfo } = require('./lib/project');
const { parseBlocks, applyBlocks, writeAll, JournalError } = require('./lib/journal');

function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((x) => String(x).padStart(2, '0')).join('-');
}

function main() {
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf8');
  } catch (e) {
    // нет stdin — блоков нет, это скажет разбор
  }
  const { blocks, error } = parseBlocks(input);
  if (error) {
    console.error(`kit-journal: ${error} — ничего не записано`);
    return 4;
  }
  const info = kitInfo(resolveProjectDir({}));
  let r;
  try {
    r = applyBlocks(info, blocks, { today: process.env.KIT_TODAY || today() });
    writeAll(info.dir, r.files);
  } catch (e) {
    console.error(`kit-journal: ${e instanceof JournalError ? e.message : e.stack || e.message} — ничего не записано`);
    return 2;
  }
  const out = ['## Сейчас', r.now || '', '', 'Изменены файлы:'];
  out.push(...(r.files.size ? [...r.files.keys()].map((p) => `"${p}"`) : ['нет']));
  if (r.warnings.length) out.push('Предупреждения:', ...r.warnings);
  console.log(out.join('\n'));
  return r.warnings.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
