'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeProject } = require('./helpers');
const { paramsMd, journalFiles } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { oldFormat } = require('../plugins/kit/scripts/lib/journal');

const PARAMS = { 'Режим': 'общий', 'Окружение': 'прод', 'Выкладка': 'вручную' };
const signs = (files, params = PARAMS) => oldFormat(kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd(params), ...files })));

// Журнал с двумя этапами: шапки таблиц этапа 1 и этапа 2.
const twoStages = (first, last) => [
  '# Журнал работ — тест', '', '## Сейчас', '', '- **Этап:** 2 — правки', '',
  '## Этапы', '', '| Этап | Название | Файл |', '|---|---|---|', '| 1 | изучение | ниже |', '| 2 | правки | ниже |', '',
  '## Этап 1 — изучение', '', first, '|---|---|---|---|', '| 1.1 | ✅ | а | б |', '',
  '## Этап 2 — правки', '', last, '|---|---|---|---|', '| 2.1 | ⏳ | в | |', '',
].join('\n');
const CHECKED = '| Шаг | Статус | Что сделано | Как проверено |';
const COMMIT = '| Шаг | Статус | Что сделано | Коммит |';

test('текущий формат — []', () => {
  assert.deepEqual(signs(journalFiles()), []);
});

test('журнал в docs/ — «журнал не в .claude/docs»: без параметра и с параметром «Журнал»', () => {
  assert.deepEqual(signs(journalFiles(undefined, 'docs')), ['журнал не в .claude/docs']);
  assert.deepEqual(signs(journalFiles(undefined, 'docs'), { ...PARAMS, 'Журнал': 'docs/progress.md' }), ['журнал не в .claude/docs']);
});

test('нет journal/ — «журнал одним файлом»', () => {
  const files = journalFiles();
  delete files['.claude/docs/journal/decisions.md'];
  assert.deepEqual(signs(files), ['журнал одним файлом']);
});

test('последний этап без «Как проверено» — признак есть; ранний этап без него — нет', () => {
  assert.deepEqual(signs({ ...journalFiles(), '.claude/docs/progress.md': twoStages(CHECKED, COMMIT) }), ['нет столбца «Как проверено»']);
  assert.deepEqual(signs({ ...journalFiles(), '.claude/docs/progress.md': twoStages(COMMIT, CHECKED) }), []);
});

test('этапов в progress.md нет (все перенесены в journal/stages/) — признака «Как проверено» нет', () => {
  const progress = ['# Журнал работ — тест', '', '## Сейчас', '', '- **Этап:** 1 — изучение — закрыт 2026-10-01', '',
    '## Этапы', '', '| Этап | Название | Файл |', '|---|---|---|', '| 1 | изучение | `journal/stages/stage-01.md` |', ''].join('\n');
  assert.deepEqual(signs({ ...journalFiles(), '.claude/docs/progress.md': progress }), []);
});

test('последняя таблица решений | Дата | Решение | — «старая таблица решений»; новая под старой — признака нет', () => {
  const old = ['# Решения', '', '| Дата | Решение |', '|---|---|', '| 2026-09-23 | Тест |', ''].join('\n');
  assert.deepEqual(signs({ ...journalFiles(), '.claude/docs/journal/decisions.md': old }), ['старая таблица решений']);
  const both = old + ['', 'С kit 2.8 — с обоснованием:', '',
    '| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |', '|---|---|---|---|---|---|---|', ''].join('\n');
  assert.deepEqual(signs({ ...journalFiles(), '.claude/docs/journal/decisions.md': both }), []);
});

test('«Окружение: дев+прод» и «Выкладка: вручную; дев — PhpStorm Always» — по признаку', () => {
  assert.deepEqual(signs(journalFiles(), { ...PARAMS, 'Окружение': 'дев+прод', 'Выкладка': 'вручную; дев — PhpStorm Always' }),
    ['Окружение: дев+прод', 'Выкладка: вручную; дев — PhpStorm Always']);
  assert.deepEqual(signs(journalFiles(), { ...PARAMS, 'Окружение': 'дев', 'Выкладка': 'PhpStorm Always' }), []);
});
