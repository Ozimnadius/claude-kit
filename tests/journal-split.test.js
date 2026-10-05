'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject, runScript } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { assertNothingLost, SplitError } = require('../plugins/kit/scripts/journal-split');

const J = '.claude/docs/progress.md';
const journal = (now = '- **Этап:** 3 — третий (начат 2026-10-01); сделан шаг 3.1') => [
  '# Журнал работ — тест', '', '> Ведёт docs-keeper.', '',
  '## Сейчас', '', now, '- **Следующий шаг:** 3.2 — дальше', '- **Блокеры и открытые вопросы:** блокеров нет', '',
  '## Решения', '', '| Дата | Решение |', '|---|---|', '| 2026-09-01 | Первое \\| с чертой |', '',
  '## Документы', '', '| Файл | О чём | Статус |', '|---|---|---|', '| work/plan.md | план | в работе, этап 3 |', '',
  '## Этап 1 — первый', '', '| Шаг | Статус | Что сделано | Коммит |', '|---|---|---|---|', '| 1.1 | ✅ | раз | `aaa1111` |', '',
  '## Этап 2 — второй \\| с чертой', '', '| Шаг | Статус | Что сделано | Как проверено | Коммит |', '|---|---|---|---|---|', '| 2.1 | ✅ | два | тест | `bbb2222` |', '',
  'Сверка 2026-10-01 (сверено с: таблица этапа): пунктов 1, сделано 1; расхождения: нет.', '',
  '### Подраздел этапа 2', '', '- деталь', '',
  '## Этап 3 — третий', '', '| Шаг | Статус | Что сделано | Как проверено | Коммит |', '|---|---|---|---|---|', '| 3.1 | ✅ | три | тест | |', '| 3.2 | ⏳ | дальше | | |', '',
  '## Материалы заказчика', '', '- макет', '',
  '## Баги на потом', '', '| № | Баг | Где | Статус |', '|---|---|---|---|', '| К1 | баг | тут | ⏳ |', '',
  '## Прод: не забыть', '', '- проверить форму', '',
  '## Справочник', '', '- Прод: example.com', '',
].join('\n');
const project = (text = journal()) => makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }), [J]: text });
const run = (dir, ...args) => runScript('journal-split.js', { args, cwd: dir });
const read = (dir, rel) => fs.readFileSync(path.join(dir, '.claude/docs', rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, '.claude/docs', rel));

test('--migrate: части, закрытые этапы — в stages/, текущий и «Документы», «Прод: не забыть» — в progress.md, оглавление; ни одна строка не потеряна', () => {
  const dir = project();
  const src = journal();
  const r = run(dir, '--migrate');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /закрытых этапов перенесено — 2, текущий этап 3 остался в progress\.md/);
  const p = read(dir, 'progress.md');
  for (const s of ['## Сейчас', '## Этапы', '## Документы', '## Этап 3 — третий', '## Прод: не забыть']) assert.ok(p.includes(s), s);
  for (const s of ['## Решения', '## Этап 1', '## Этап 2', '## Баги на потом', '## Справочник', '## Материалы заказчика']) assert.ok(!p.includes(s), s);
  assert.ok(p.indexOf('## Сейчас') < p.indexOf('## Этапы') && p.indexOf('## Этапы') < p.indexOf('## Документы'), 'оглавление — сразу после «Сейчас»');
  assert.ok(p.includes('| 1 | первый | `journal/stages/stage-01.md` |'));
  assert.ok(p.includes('| 2 | второй \\| с чертой | `journal/stages/stage-02.md` |'), 'черта в названии экранирована');
  assert.ok(p.includes('| 3 | третий | ниже |'));
  assert.ok(read(dir, 'journal/decisions.md').startsWith('# тест — решения\n\n## Решения\n'));
  assert.ok(read(dir, 'journal/bugs.md').includes('| К1 | баг | тут | ⏳ |'));
  const ref = read(dir, 'journal/reference.md');
  assert.ok(ref.indexOf('## Материалы заказчика') < ref.indexOf('## Справочник'), 'порядок разделов сохранён');
  const s2 = read(dir, 'journal/stages/stage-02.md');
  assert.ok(s2.includes('Сверка 2026-10-01') && s2.includes('### Подраздел этапа 2'), 'сверка и подразделы — вместе с этапом');
  const all = [p, read(dir, 'journal/decisions.md'), read(dir, 'journal/bugs.md'), ref, read(dir, 'journal/stages/stage-01.md'), s2];
  assert.doesNotThrow(() => assertNothingLost(src, all));
  const again = run(dir, '--migrate');
  assert.equal(again.code, 0);
  assert.match(again.stdout, /уже по частям/);
  assert.equal(read(dir, 'progress.md'), p, 'повтор ничего не меняет');
});

test('--migrate: этап в «Сейчас» закрыт — все этапы в stages/; «Сейчас» нет — последний этап остаётся', () => {
  const closed = project(journal('- **Этап:** 3 — третий — закрыт 2026-10-02'));
  run(closed, '--migrate');
  assert.ok(exists(closed, 'journal/stages/stage-03.md'));
  assert.ok(!read(closed, 'progress.md').includes('## Этап 3'));
  const noNow = project(journal().replace(/## Сейчас[\s\S]*?\n\n## Решения/, '## Решения'));
  run(noNow, '--migrate');
  assert.ok(read(noNow, 'progress.md').includes('## Этап 3 — третий'));
  assert.ok(exists(noNow, 'journal/stages/stage-02.md'));
});

test('--stage N: этап из progress.md → stages/, строка оглавления — ссылкой; повтор — файл не перезаписывается, код 2', () => {
  const dir = project();
  run(dir, '--migrate');
  const before = read(dir, 'progress.md');
  const r = run(dir, '--stage', '3');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Этап 3 перенесён в journal\/stages\/stage-03\.md, оглавление «Этапы» обновлено/);
  const p = read(dir, 'progress.md');
  assert.ok(!p.includes('## Этап 3'));
  assert.ok(p.includes('| 3 | третий | `journal/stages/stage-03.md` |'));
  assert.ok(read(dir, 'journal/stages/stage-03.md').includes('| 3.2 | ⏳ | дальше | | |'));
  assert.doesNotThrow(() => assertNothingLost(before, [p, read(dir, 'journal/stages/stage-03.md')], ['| 3 | третий | ниже |']));
  assert.throws(() => assertNothingLost(before, [p, read(dir, 'journal/stages/stage-03.md')]), SplitError, 'без списка заменённых строка «ниже» считается потерянной');
  assert.equal(run(dir, '--stage', '3').code, 0, 'раздела уже нет — делать нечего');
  fs.writeFileSync(path.join(dir, J), before);
  const again = run(dir, '--stage', '3');
  assert.equal(again.code, 2);
  assert.match(again.stderr, /уже есть — перенос прерван/);
});

test('--stage N: новый этап без строки в оглавлении — строка добавляется; журнал не по частям — код 2; без аргументов — код 2', () => {
  const dir = project();
  run(dir, '--migrate');
  const p = read(dir, 'progress.md') + '\n## Этап 4 — четвёртый\n\n| Шаг | Статус | Что сделано | Как проверено | Коммит |\n|---|---|---|---|---|\n| 4.1 | ✅ | четыре | тест | |\n';
  fs.writeFileSync(path.join(dir, J), p);
  assert.equal(run(dir, '--stage', '4').code, 0);
  const idx = read(dir, 'progress.md');
  assert.ok(idx.includes('| 3 | третий | ниже |\n| 4 | четвёртый | `journal/stages/stage-04.md` |'), idx);
  const old = project();
  const r = run(old, '--stage', '1');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /не по частям/);
  assert.equal(run(old).code, 2);
});

test('assertNothingLost: строка пропала — SplitError, ничего не пишется', () => {
  assert.throws(() => assertNothingLost('a\nb\nb\n', ['a\nb\n']), SplitError);
  assert.doesNotThrow(() => assertNothingLost('a\n\nb\n', ['b\n', 'новое\na\n']));
});
