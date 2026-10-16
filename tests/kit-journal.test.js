'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject, runScript } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { getSection, parseTable } = require('../plugins/kit/scripts/lib/md');

const J = '.claude/docs/progress.md';
const D = '.claude/docs/journal/decisions.md';
const B = '.claude/docs/journal/bugs.md';
const RF = '.claude/docs/journal/reference.md';
const P = '.claude/docs/deploy-prod.md';
const PLAN = '.claude/docs/work/plan-x.md';

const STAGE36 = '| Шаг | Статус | Что сделано | Как проверено |\n|---|---|---|---|\n| 36.1 | ✅ | спек и план | согласовано |\n| 36.3 | ⏳ | третий | |';
const PROGRESS = [
  '# Журнал работ — тест', '',
  '## Сейчас', '',
  '- **Этап:** 36 — облегчение kit (начат 2026-10-16); последний шаг 36.1 — спек и план',
  '- **Следующий шаг:** 36.3 — третий',
  '- **Блокеры и открытые вопросы:** старые блокеры', '',
  '## Этапы', '',
  'Части журнала: решения — `journal/decisions.md`, баги — `journal/bugs.md`.', '',
  '| Этап | Название | Файл |', '|---|---|---|',
  '| 35 | прошлый этап | `journal/stages/stage-35.md` |',
  '| 36 | облегчение kit | ниже |', '',
  '## Документы', '',
  '| Файл | О чём | Статус |', '|---|---|---|',
  '| work/spec-x.md | спек этапа 36 | в работе, этап 36 |',
  '| work/plan-x.md | план этапа 36 | в работе, этап 36 |', '',
  '## Прод: не забыть', '',
  '- (пока пусто)', '',
  '## Этап 36 — облегчение kit', '',
  STAGE36, '',
].join('\n');
const DECISIONS = [
  '# тест — решения', '', '## Решения', '',
  '| Дата | Решение |', '|---|---|', '| 2026-09-01 | старое решение |', '',
  'С kit 2.8 — с обоснованием:', '',
  '| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |', '|---|---|---|---|---|---|---|',
  '| 29 | 2026-10-01 | 30.1 | прежнее решение | причина | — | пользователь |',
  '| 50 | 2026-10-15 | 35.3 | последнее решение | причина | — | агент |', '',
].join('\n');
const BUGS = ['# тест — баги', '', '## Баги на потом', '', '| № | Баг | Где | Статус |', '|---|---|---|---|',
  '| К60 | баг 60 | x.js | открыт |', '| К61 | баг 61 | y.js | открыт |', ''].join('\n');
const REFERENCE = ['# тест — справочник', '', '## Справочник', '', '- старый факт', ''].join('\n');
const DEPLOY_PLAN = ['# Выкладка на прод — тест', '', '## Общие правила', '', '- тест', '',
  '## Залито на прод', '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|', '',
  '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', '',
  '## Чек-лист переключения', '', '1. (заполняется по ходу работы)', ''].join('\n');

function project(params = {}, files = {}) {
  return makeProject({
    '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий', 'Окружение': 'прод', 'Выкладка': 'вручную', ...params }),
    [J]: PROGRESS, [D]: DECISIONS, [B]: BUGS, [RF]: REFERENCE, [P]: DEPLOY_PLAN,
    '.claude/docs/journal/stages/stage-35.md': '# тест — этап 35\n\n## Этап 35 — прошлый этап\n\n| Шаг | Статус | Что сделано | Как проверено |\n|---|---|---|---|\n| 35.1 | ✅ | а | б |\n',
    [PLAN]: '# План\n\n## Чек-лист\n\n- [x] 36.1 — спек\n- [ ] 36.2 — второй\n- [ ] 36.3 — третий\n- [ ] 36.4 — четвёртый\n',
    '.claude/docs/work/spec-x.md': '# Спек\n\nТекст без чек-листа.\n',
    ...files,
  });
}

// Блоки: строка — «КЛЮЧ: значение», массив — «КЛЮЧ:» и строки «- …».
const blocks = (o) => Object.entries(o)
  .map(([k, v]) => (Array.isArray(v) ? [k + ':', ...v.map((x) => '- ' + x)].join('\n') : k + ': ' + v)).join('\n') + '\n';
const run = (dir, input) => runScript('kit-journal.js', { cwd: dir, input, env: { KIT_TODAY: '2026-10-20' } });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const stageRows = (dir, n) => parseTable(getSection(read(dir, J), 'Этап ' + n));
const BASE = { STEP: '36.2', STATUS: '✅', SUMMARY: 'второй сделан', CHECK: 'тесты', NEXT: '36.3 — третий' };

function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) walk(r);
      else out[r] = read(dir, r);
    }
  };
  walk('.claude');
  return out;
}

test('строка шага: 36.2 встаёт между 36.1 и 36.3; 36.3 ✅ правится на месте; у NEXT 36.4 — ⏳', () => {
  const dir = project();
  const r = run(dir, blocks(BASE));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  let rows = stageRows(dir, 36);
  assert.deepEqual(rows.map((x) => x['Шаг']), ['36.1', '36.2', '36.3']);
  assert.deepEqual(rows[1], { 'Шаг': '36.2', 'Статус': '✅', 'Что сделано': 'второй сделан', 'Как проверено': 'тесты' });
  assert.ok(r.stdout.startsWith('## Сейчас\n'), r.stdout);
  assert.match(r.stdout, /\nИзменены файлы:\n(".+"\n)*"\.claude\/docs\/progress\.md"\n/);
  const r2 = run(dir, blocks({ ...BASE, STEP: '36.3', SUMMARY: 'третий сделан', CHECK: 'проверено', NEXT: '36.4 — четвёртый' }));
  assert.equal(r2.code, 0, r2.stdout + r2.stderr);
  rows = stageRows(dir, 36);
  assert.deepEqual(rows.map((x) => [x['Шаг'], x['Статус']]), [['36.1', '✅'], ['36.2', '✅'], ['36.3', '✅'], ['36.4', '⏳']]);
  assert.equal(rows[2]['Что сделано'], 'третий сделан');
  assert.equal(rows[2]['Как проверено'], 'проверено');
  assert.equal(rows[3]['Что сделано'], 'четвёртый');
});

test('Сейчас: этап с прежней датой и последним шагом, следующий — NEXT; BLOCKERS заменяет пункт, без BLOCKERS — прежний; NEXT — → этап закрыт', () => {
  const dir = project();
  run(dir, blocks({ ...BASE, BLOCKERS: 'новые блокеры' }));
  let now = getSection(read(dir, J), 'Сейчас');
  assert.ok(now.includes('- **Этап:** 36 — облегчение kit (начат 2026-10-16); последний шаг 36.2 — второй сделан'), now);
  assert.ok(now.includes('- **Следующий шаг:** 36.3 — третий'), now);
  assert.ok(now.includes('- **Блокеры и открытые вопросы:** новые блокеры'), now);
  run(dir, blocks({ ...BASE, STEP: '36.3', SUMMARY: 'третий сделан', NEXT: '—' }));
  now = getSection(read(dir, J), 'Сейчас');
  assert.ok(now.includes('- **Этап:** 36 — облегчение kit — закрыт 2026-10-20'), now);
  assert.ok(now.includes('- **Следующий шаг:** нет — этап закрыт'), now);
  assert.ok(now.includes('- **Блокеры и открытые вопросы:** новые блокеры'), 'без BLOCKERS — прежний текст: ' + now);
});

test('STAGE 37: раздел «## Этап 37 — …» в конце журнала и «| 37 | … | ниже |» в оглавлении; «Сейчас» — новый этап с сегодняшней датой', () => {
  const dir = project();
  const r = run(dir, blocks({ STEP: '37.1', STATUS: '✅', SUMMARY: 'начало', CHECK: 'ок', NEXT: '37.2 — дальше', STAGE: '37 — новый этап' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = read(dir, J);
  assert.ok(md.indexOf('## Этап 37 — новый этап') > md.indexOf('## Этап 36'), 'новый этап — в конце');
  assert.ok(md.trimEnd().endsWith('| 37.2 | ⏳ | дальше | |'), md.slice(-200));
  assert.ok(getSection(md, 'Этапы').includes('| 36 | облегчение kit | ниже |\n| 37 | новый этап | ниже |'), getSection(md, 'Этапы'));
  assert.deepEqual(stageRows(dir, 37).map((x) => [x['Шаг'], x['Статус']]), [['37.1', '✅'], ['37.2', '⏳']]);
  assert.ok(getSection(md, 'Сейчас').includes('- **Этап:** 37 — новый этап (начат 2026-10-20); последний шаг 37.1 — начало'));
});

test('DECISIONS: после №50 — №51 и №52, «Шаг» = STEP; «Заменяет №29» — в №29 « → заменено №51»', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, DECISIONS: [
    '2026-10-20 | Заменяет №29: новое решение | потому что | прежнее | пользователь',
    '2026-10-20 | ещё решение | — | — | агент'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const dec = read(dir, D);
  assert.ok(dec.includes('| 50 | 2026-10-15 | 35.3 | последнее решение | причина | — | агент |\n'
    + '| 51 | 2026-10-20 | 36.2 | Заменяет №29: новое решение | потому что | прежнее | пользователь |\n'
    + '| 52 | 2026-10-20 | 36.2 | ещё решение | — | — | агент |\n'), dec);
  assert.ok(dec.includes('| 29 | 2026-10-01 | 30.1 | прежнее решение → заменено №51 | причина | — | пользователь |'), dec);
  assert.ok(dec.includes('| 2026-09-01 | старое решение |'), 'старая таблица не тронута');
});

test('DOCS: статус обновляется; «archive/plan-x.md (было work/plan-x.md)» меняет путь; новая строка — в конец реестра', () => {
  const dir = project();
  const r = run(dir, blocks({ STEP: '36.2', STATUS: '⏳', SUMMARY: 'в работе', NEXT: '36.3 — третий', DOCS: [
    'work/spec-x.md — спек этапа 36 — готово, этап 36 (2026-10-20)',
    'archive/plan-x.md (было work/plan-x.md) — план этапа 36 — готово, этап 36 (2026-10-20)',
    'work/notes.md — заметки — в работе, этап 36'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(parseTable(getSection(read(dir, J), 'Документы')), [
    { 'Файл': 'work/spec-x.md', 'О чём': 'спек этапа 36', 'Статус': 'готово, этап 36 (2026-10-20)' },
    { 'Файл': 'archive/plan-x.md', 'О чём': 'план этапа 36', 'Статус': 'готово, этап 36 (2026-10-20)' },
    { 'Файл': 'work/notes.md', 'О чём': 'заметки', 'Статус': 'в работе, этап 36' },
  ]);
});

test('галочка: «- [ ] 36.3 —» → «- [x] 36.3 —» в плане «в работе, этап 36»; строки нет — предупреждение и код 1', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, STEP: '36.3', NEXT: '36.4 — четвёртый' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const plan = read(dir, PLAN);
  assert.ok(plan.includes('- [x] 36.3 — третий'), plan);
  assert.ok(plan.includes('- [ ] 36.2 — второй'), 'чужие строки не тронуты');
  assert.ok(r.stdout.includes('"' + PLAN + '"'), 'план — в списке изменённых файлов');
  const w = run(dir, blocks({ ...BASE, STEP: '36.9', NEXT: '—' }));
  assert.equal(w.code, 1, w.stdout + w.stderr);
  assert.match(w.stdout, /Предупреждения:\n(.+\n)*в плане work\/plan-x\.md нет строки 36\.9\n/);
  assert.doesNotMatch(w.stdout, /spec-x\.md нет строки/, 'документ без чек-листа — без предупреждения');
});

test('BUGS: «| К62 |» добавлен без номера (после К61); К61 — новый статус, остальные поля прежние', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, BUGS: ['— | новый баг | kit-journal.js | открыт', 'К61 | | | ✅ 36.2'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const bugs = read(dir, B);
  assert.ok(bugs.includes('| К61 | баг 61 | y.js | ✅ 36.2 |\n| К62 | новый баг | kit-journal.js | открыт |'), bugs);
});

test('NOTES: в «Справочник»; «Заказчик: …» — в «Материалы заказчика» без приставки', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, NOTES: ['адрес стенда — dev.example.com', 'Заказчик: прислал ТЗ v2'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const ref = read(dir, RF);
  assert.equal(getSection(ref, 'Справочник'), '- старый факт\n- адрес стенда — dev.example.com');
  assert.equal(getSection(ref, 'Материалы заказчика'), '- прислал ТЗ v2');
});

test('RECONCILE: строка «Сверка …» под таблицей этапа; «на следующий этап» — в конец «Блокеров»', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, RECONCILE: '2026-10-20 | этап 36 | сверено с: work/spec-x.md, work/plan-x.md | пунктов 8, сделано 7 | расхождения: Т-5 — на следующий этап | на следующий этап: Т-5' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = read(dir, J);
  assert.ok(getSection(md, 'Этап 36').endsWith('| 36.3 | ⏳ | третий | |\n\nСверка 2026-10-20 (сверено с: work/spec-x.md, work/plan-x.md): пунктов 8, сделано 7; расхождения: Т-5 — на следующий этап.'),
    getSection(md, 'Этап 36'));
  assert.ok(getSection(md, 'Сейчас').includes('- **Блокеры и открытые вопросы:** старые блокеры; на следующий этап (сверка этапа 36): Т-5'), getSection(md, 'Сейчас'));
});

test('DEPLOY: «вручную» — строка в «Залито на прод», удаление и чек-лист; «PhpStorm Always» — строки «Залито» нет, предупреждение', () => {
  const deploy = ['Файлы: a.php, b.php', 'Коммит: abc1234', 'Проверка: страница открылась', 'Удалить: /old.php — больше не нужен', 'Чек-лист: включить кеш'];
  const dir = project();
  const r = run(dir, blocks({ ...BASE, DEPLOY: deploy }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const plan = read(dir, P);
  assert.ok(getSection(plan, 'Залито на прод').includes('| 36.2 | 2026-10-20 | a.php, b.php | abc1234 | страница открылась |'), plan);
  assert.ok(getSection(plan, 'Удалить с сервера').includes('| /old.php | больше не нужен | |'), plan);
  assert.equal(getSection(plan, 'Чек-лист переключения'), '1. включить кеш');
  const always = project({ 'Выкладка': 'PhpStorm Always' });
  const w = run(always, blocks({ ...BASE, DEPLOY: deploy }));
  assert.equal(w.code, 1, w.stdout + w.stderr);
  assert.match(w.stdout, /при автозаливке «Залито» не ведётся/);
  assert.ok(!getSection(read(always, P), 'Залито на прод').includes('a.php'));
  assert.ok(getSection(read(always, P), 'Удалить с сервера').includes('| /old.php | больше не нужен | |'), 'удаления при автозаливке пишутся');
});

test('повтор тех же блоков — файлы те же', () => {
  const dir = project();
  const all = blocks({ ...BASE, STEP: '36.3', NEXT: '36.4 — четвёртый', BLOCKERS: 'блокеров нет',
    DECISIONS: ['2026-10-20 | Заменяет №29: новое решение | потому что | прежнее | пользователь'],
    DOCS: ['work/notes.md — заметки — в работе, этап 36'],
    BUGS: ['— | новый баг | kit-journal.js | открыт', 'К61 | | | ✅ 36.3'],
    PROD_TODO: ['сбросить кеш'], NOTES: ['факт', 'Заказчик: письмо'],
    RECONCILE: '2026-10-20 | этап 36 | сверено с: таблица этапа | пунктов 3, сделано 3 | расхождения: нет | на следующий этап: Т-9',
    DEPLOY: ['Файлы: a.php', 'Проверка: ок', 'Удалить: /old.php — не нужен', 'Чек-лист: включить кеш'] });
  const first = run(dir, all);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const snap = snapshot(dir);
  const again = run(dir, all);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.deepEqual(snapshot(dir), snap);
});

test('старый формат — код 2 и сообщение о переезде, файлы не изменились; неизвестный ключ, неверный STATUS и пустой SUMMARY — код 4', () => {
  const old = project({ 'Окружение': 'дев+прод' });
  const before = snapshot(old);
  const r = run(old, blocks(BASE));
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /в старом формате \(Окружение: дев\+прод\) — до работы предложи пользователю \/kit:project-init: переезд на формат kit 3\.0/);
  assert.deepEqual(snapshot(old), before);
  const dir = project();
  const clean = snapshot(dir);
  const unknown = run(dir, blocks(BASE) + 'COMMITS: 36.1=abc1234\n');
  assert.equal(unknown.code, 4, unknown.stdout + unknown.stderr);
  assert.match(unknown.stderr, /COMMITS/);
  assert.equal(run(dir, blocks({ ...BASE, STATUS: 'готово' })).code, 4);
  assert.equal(run(dir, blocks({ ...BASE, SUMMARY: '' })).code, 4);
  assert.deepEqual(snapshot(dir), clean);
});

test('шаг этапа, уже перенесённого в journal/stages, — код 2, файлы не изменились', () => {
  const dir = project();
  const before = snapshot(dir);
  const r = run(dir, blocks({ ...BASE, STEP: '35.4' }));
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /этап 35 уже перенесён — шаг пишется в текущий этап/);
  assert.deepEqual(snapshot(dir), before);
});

test('журнал, правленный руками: выровненная таблица и «\\|» в ячейке — строка находится, чужие строки не меняются', () => {
  const aligned = PROGRESS.replace(STAGE36, [
    '| Шаг  | Статус | Что сделано          | Как проверено |',
    '| ---- | ------ | -------------------- | ------------- |',
    '| 36.1 | ✅     | спек `a\\|b` и план  | согласовано   |',
    '| 36.3 | ⏳     | третий               |               |'].join('\n'));
  const dir = project({}, { [J]: aligned });
  const r = run(dir, blocks({ ...BASE, STEP: '36.3', SUMMARY: 'третий `x\\|y` сделан', NEXT: '36.4 — четвёртый' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = read(dir, J);
  assert.ok(md.includes('| 36.1 | ✅     | спек `a\\|b` и план  | согласовано   |'), 'чужая строка — как была');
  assert.ok(md.includes('| 36.3 | ✅ | третий `x\\|y` сделан | тесты |'), md);
  assert.deepEqual(stageRows(dir, 36).map((x) => x['Шаг']), ['36.1', '36.3', '36.4']);
});

test('журнал с CRLF: после правки переводы строк остаются CRLF', () => {
  const dir = project({}, { [J]: PROGRESS.replace(/\n/g, '\r\n') });
  const r = run(dir, blocks(BASE));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = read(dir, J);
  assert.ok(md.includes('| 36.1 | ✅ | спек и план | согласовано |\r\n| 36.2 | ✅ | второй сделан | тесты |\r\n'), md);
  assert.ok(!/[^\r]\n/.test(md), 'одиночных LF нет');
});

test('последний шаг этапа: план перенесён в архив (DOCS «было …») и галочка ставится в нём в том же вызове', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.claude/docs/archive'));
  fs.renameSync(path.join(dir, PLAN), path.join(dir, '.claude/docs/archive/plan-x.md'));
  const r = run(dir, blocks({ ...BASE, STEP: '36.4', SUMMARY: 'последний', NEXT: '—',
    DOCS: ['archive/plan-x.md (было work/plan-x.md) — план этапа 36 — готово, этап 36 (2026-10-20)'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(read(dir, '.claude/docs/archive/plan-x.md').includes('- [x] 36.4 — четвёртый'));
  assert.ok(r.stdout.includes('".claude/docs/archive/plan-x.md"'), r.stdout);
});

test('текущий этап начат при kit 2.x — столбец «Коммит»: новая строка с пустой ячейкой, заполненные не тронуты', () => {
  const withCommit = PROGRESS.replace(STAGE36,
    '| Шаг | Статус | Что сделано | Как проверено | Коммит |\n|---|---|---|---|---|\n| 36.1 | ✅ | спек и план | согласовано | `abc1234` |\n| 36.3 | ⏳ | третий | | |');
  const dir = project({}, { [J]: withCommit });
  const r = run(dir, blocks(BASE));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const md = read(dir, J);
  assert.ok(md.includes('| 36.1 | ✅ | спек и план | согласовано | `abc1234` |\n| 36.2 | ✅ | второй сделан | тесты | |\n'), md);
});

test('шаг нового этапа без STAGE — код 2 с подсказкой передать STAGE, файлы не изменились (финальная проверка, M5)', () => {
  const dir = project();
  const before = snapshot(dir);
  const r = run(dir, blocks({ ...BASE, STEP: '37.1', NEXT: '37.2 — дальше' }));
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /нет раздела «Этап 37» — для нового этапа передайте STAGE: 37 — название/);
  assert.deepEqual(snapshot(dir), before);
});

test('новый STAGE убирает из «Блокеров» прежние пункты «на следующий этап (сверка этапа N)», сверка того же вызова дописывает свой (финальная проверка, M6)', () => {
  const dir = project({}, { [J]: PROGRESS.replace('- **Блокеры и открытые вопросы:** старые блокеры',
    '- **Блокеры и открытые вопросы:** старые блокеры; на следующий этап (сверка этапа 35): Т-9') });
  const r = run(dir, blocks({ ...BASE, STEP: '36.4', SUMMARY: 'последний', NEXT: '37.1 — начало', STAGE: '37 — новый этап',
    RECONCILE: '2026-10-20 | этап 36 | сверено с: таблица этапа | пунктов 4, сделано 3 | расхождения: Т-5 — на следующий этап | на следующий этап: Т-5' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const now = getSection(read(dir, J), 'Сейчас');
  assert.ok(now.includes('- **Блокеры и открытые вопросы:** старые блокеры; на следующий этап (сверка этапа 36): Т-5'), now);
  assert.doesNotMatch(now, /сверка этапа 35/);
});

test('план, оставленный в work/ при закрытии этапа (DOCS — «в работе, этап 37»), получает галочку последнего шага (финальная проверка, M9)', () => {
  const dir = project();
  const r = run(dir, blocks({ ...BASE, STEP: '36.4', SUMMARY: 'последний', NEXT: '—', DOCS: ['work/plan-x.md — план этапа 36 — в работе, этап 37'] }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(read(dir, PLAN).includes('- [x] 36.4 — четвёртый'), read(dir, PLAN));
});

test('план прошлого этапа без строк нового этапа — шаг нового этапа без предупреждения (финальная проверка, M9)', () => {
  const progress = PROGRESS.replace('| work/plan-x.md | план этапа 36 | в работе, этап 36 |', '| work/plan-x.md | план этапа 36 | в работе, этап 37 |')
    + '\n## Этап 37 — новый\n\n| Шаг | Статус | Что сделано | Как проверено |\n|---|---|---|---|\n| 37.1 | ⏳ | начало | |\n';
  const dir = project({}, { [J]: progress });
  const r = run(dir, blocks({ ...BASE, STEP: '37.1', SUMMARY: 'начало', NEXT: '37.2 — дальше' }));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /нет строки/);
});
