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

// ---------- 47.8в: writeAll — повтор переименования и «записано частично» ----------

const fs = require('fs');
const path = require('path');
const { writeAll, PartialWriteError } = require('../plugins/kit/scripts/lib/journal');

// fs.renameSync на время fn: fail(to) — true, если это переименование должно упасть EPERM.
function withRename(fail, fn) {
  const real = fs.renameSync;
  const calls = [];
  fs.renameSync = (from, to) => {
    calls.push(String(to));
    if (fail(String(to), calls.length)) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), { code: 'EPERM' });
    return real(from, to);
  };
  try {
    return fn(calls);
  } finally {
    fs.renameSync = real;
  }
}
const FILES = () => new Map([['.claude/docs/journal/decisions.md', 'решения\n'], ['.claude/docs/journal/bugs.md', 'баги\n'], ['.claude/docs/progress.md', 'журнал\n']]);
const tmpLeft = (dir) => ['.claude/docs', '.claude/docs/journal'].flatMap((d) => fs.readdirSync(path.join(dir, d))).filter((f) => f.includes('kit-tmp'));

test('writeAll: EPERM дважды, затем переименование проходит — всё записано, временных файлов нет (47.8в)', () => {
  const dir = makeProject(journalFiles());
  withRename((to, n) => n <= 2, (calls) => {
    writeAll(dir, FILES());
    assert.equal(calls.length, 5, 'две неудачи и три удачных переименования');
  });
  assert.equal(fs.readFileSync(path.join(dir, '.claude/docs/progress.md'), 'utf8'), 'журнал\n');
  assert.equal(fs.readFileSync(path.join(dir, '.claude/docs/journal/bugs.md'), 'utf8'), 'баги\n');
  assert.deepEqual(tmpLeft(dir), []);
});

test('writeAll: журнал не переименовывается никогда — PartialWriteError с уже записанными файлами; первый файл — исходная ошибка (47.8в)', () => {
  const dir = makeProject(journalFiles());
  const before = fs.readFileSync(path.join(dir, '.claude/docs/progress.md'), 'utf8');
  withRename((to) => to.endsWith('progress.md'), (calls) => {
    assert.throws(() => writeAll(dir, FILES()), (e) => {
      assert.ok(e instanceof PartialWriteError, e.stack);
      assert.deepEqual(e.written, ['.claude/docs/journal/decisions.md', '.claude/docs/journal/bugs.md']);
      assert.deepEqual(e.failed, ['.claude/docs/progress.md']);
      assert.equal(e.cause.code, 'EPERM');
      return true;
    });
    assert.equal(calls.filter((c) => c.endsWith('progress.md')).length, 6, 'первая попытка и 5 повторов');
  });
  assert.equal(fs.readFileSync(path.join(dir, '.claude/docs/progress.md'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(dir, '.claude/docs/journal/decisions.md'), 'utf8'), 'решения\n');
  assert.deepEqual(tmpLeft(dir), []);
  const fresh = makeProject(journalFiles());
  withRename(() => true, () => {
    assert.throws(() => writeAll(fresh, FILES()), (e) => !(e instanceof PartialWriteError) && e.code === 'EPERM');
  });
  assert.deepEqual(tmpLeft(fresh), []);
});

test('writeAll: другая ошибка переименования (ENOENT) — без повторов (47.8в)', () => {
  const dir = makeProject(journalFiles());
  const real = fs.renameSync;
  let n = 0;
  fs.renameSync = () => {
    n++;
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  try {
    assert.throws(() => writeAll(dir, FILES()), (e) => e.code === 'ENOENT');
  } finally {
    fs.renameSync = real;
  }
  assert.equal(n, 1);
});

test('writeFilesAtomic rollbackNew: новые файлы и созданные папки убраны — NothingWrittenError; файл, бывший до записи, не тронут — PartialWriteError с ним (47.8в, раунд 1)', () => {
  const { writeFilesAtomic, NothingWrittenError } = require('../plugins/kit/scripts/lib/atomic');
  const dir = makeProject({ 'old.md': 'было\n', 'last.md': 'журнал\n' });
  const at = (rel) => path.join(dir, rel);
  const entries = (withOld) => [
    ...(withOld ? [{ file: at('old.md'), text: 'стало\n', label: 'old.md' }] : []),
    { file: at('new/deep/a.md'), text: 'a\n', label: 'new/deep/a.md' },
    { file: at('last.md'), text: 'новый журнал\n', label: 'last.md' },
  ];
  withRename((to) => to.endsWith('last.md'), () => {
    assert.throws(() => writeFilesAtomic(entries(false), { mkdir: true, rollbackNew: true }), (e) => {
      assert.ok(e instanceof NothingWrittenError, e.stack);
      assert.equal(e.message, 'last.md занят: EPERM');
      return true;
    });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['last.md', 'old.md'], 'new/ и new/deep/ убраны');
    assert.throws(() => writeFilesAtomic(entries(true), { mkdir: true, rollbackNew: true }), (e) => {
      assert.ok(e instanceof PartialWriteError, e.stack);
      assert.deepEqual(e.written, ['old.md']);
      assert.deepEqual(e.failed, ['last.md']);
      return true;
    });
  });
  assert.equal(fs.readFileSync(at('old.md'), 'utf8'), 'стало\n', 'бывший файл не удаляется');
  assert.ok(!fs.existsSync(at('new')), 'новый файл и его пустые папки — удалены');
  assert.equal(fs.readFileSync(at('last.md'), 'utf8'), 'журнал\n');
});
