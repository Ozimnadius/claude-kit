'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gitRepo, git, writeFiles, makeProject } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const prod = require('../plugins/kit/scripts/lib/prod');

const { ENTRY_RE, entrySubject, md5NoCr, classify, entryBase, baseTree, FILE_LIMIT, ENTRY_LIMIT, skipTake, oursPaths, pendingDelete, inPending,
  summaryLine, MARK_FILE, readMark, writeMark, markSession, sessionDone, lastNeed, watcherExts, mergeVersions } = prod;

const PARAMS = { 'Режим': 'общий', 'Прод': 'https://alpha.example.com', 'Выкладка': 'вручную', 'План выкладки': 'plan.md' };
const ENTRY = 'Прод: изменения без kit на 2026-10-29 (1 файл)';
const plan = (rows, { del = '', delHead = '| Путь | Почему | Удалён |\n|---|---|---|' } = {}) => ['# Выкладка', '', '## Залито на прод', '',
  '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|',
  ...rows.map((c) => '| 1.1 | 2026-10-15 | a.php | `' + c + '` | ок |'), '', '## Удалить с сервера', '', delHead, del, ''].join('\n');
const commit = (dir, msg) => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD').trim();
};
const kitRepo = (files = {}) => gitRepo({ '.claude/CLAUDE.md': paramsMd(PARAMS), 'a.php': '1', ...files });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

test('ENTRY_RE и предельные числа', () => {
  assert.ok(ENTRY_RE.test(ENTRY));
  assert.ok(ENTRY_RE.test('Дев: изменения без kit на 2026-10-29 (12 файлов)'));
  assert.ok(!ENTRY_RE.test('3.1: изменения без kit'));
  assert.ok(!ENTRY_RE.test('Прод: изменения с kit'));
  assert.equal(FILE_LIMIT, 10 * 1024 * 1024);
  assert.equal(ENTRY_LIMIT, 50 * 1024 * 1024);
  assert.equal(MARK_FILE, '.claude/kit-prod.json');
});

test('classify: таблица Т-5 и отсутствие файла', () => {
  assert.equal(classify({ base: 'a', head: 'b', server: 'a' }), 'same');
  assert.equal(classify({ base: 'a', head: 'a', server: 'c' }), 'take');
  assert.equal(classify({ base: 'a', head: 'b', server: 'b' }), 'ours');
  assert.equal(classify({ base: 'a', head: 'b', server: 'c' }), 'merge');
  assert.equal(classify({ base: null, head: null, server: 'c' }), 'take');
  assert.equal(classify({ base: 'a', head: 'a', server: null }), 'take');
  assert.equal(classify({ base: 'a', head: null, server: 'a' }), 'same');
  assert.equal(classify({ base: null, head: 'b', server: null }), 'same');
  assert.equal(classify({ base: 'a', head: 'a', server: 'a' }), 'same', 'всё равно — ничего');
  assert.equal(classify({ base: null, head: 'b', server: 'c' }), 'merge', 'добавлен и у нас, и без нас, по-разному');
  assert.equal(classify({ base: null, head: 'b', server: 'b' }), 'ours', 'добавлен у нас и уже на сервере');
});

test('md5NoCr: CRLF и LF — один хеш, каждый \\r убирается, двоичные файлы', () => {
  assert.equal(md5NoCr(Buffer.from('a\r\nb\r\n')), md5NoCr(Buffer.from('a\nb\n')));
  assert.equal(md5NoCr(Buffer.from('a\nb\n')), md5('a\nb\n'));
  assert.equal(md5NoCr(Buffer.from('a\rb\r\r\n')), md5('ab\n'), 'одиночный \\r тоже');
  const bin = Buffer.from([0, 255, 13, 128, 13, 10, 7]);
  assert.equal(md5NoCr(bin), crypto.createHash('md5').update(Buffer.from([0, 255, 128, 10, 7])).digest('hex'));
  assert.match(md5NoCr(Buffer.alloc(0)), /^[0-9a-f]{32}$/);
  assert.equal(md5NoCr(Buffer.alloc(0)), 'd41d8cd98f00b204e9800998ecf8427e');
});

const overlayOf = (r) => [...r.overlay].sort((a, b) => (a[0] < b[0] ? -1 : 1));

test('entryBase: база — заливка (нет — первый коммит), поверх — пути своих коммитов входа после неё; заливка после входа — наложения нет (Р-24)', () => {
  const dir = kitRepo();
  const info = kitInfo(dir);
  const first = git(dir, 'rev-parse', 'HEAD').trim();
  const r0 = entryBase(dir, info, 'прод');
  assert.equal(r0.base, first);
  assert.equal(r0.source, 'первый коммит репозитория');
  assert.deepEqual(overlayOf(r0), []);
  assert.equal(r0.entries, 0);

  writeFiles(dir, { 'a.php': '2' });
  const step = commit(dir, '1.1: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([step.slice(0, 9)]));
  commit(dir, '1.1а: план');
  const r1 = entryBase(dir, info, 'прод');
  assert.equal(r1.base, step);
  assert.equal(r1.base.length, 40);
  assert.equal(r1.source, '«Залито на прод» в plan.md');

  assert.deepEqual(overlayOf(r1), []);

  writeFiles(dir, { 'a.php': '3' });
  const entry = commit(dir, ENTRY);
  const r2 = entryBase(dir, info, 'прод');
  assert.equal(r2.base, step, 'коммит входа позже заливки — не база, а наложение');
  assert.deepEqual(overlayOf(r2), [['a.php', entry]]);
  assert.equal(r2.entries, 1);
  assert.equal(r2.source, '«Залито на прод» в plan.md; поверх — 1 коммит входа');

  writeFiles(dir, { 'a.php': '4' });
  const step2 = commit(dir, '1.2: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([step.slice(0, 9), step2.slice(0, 9)]));
  commit(dir, '1.2а: план');
  const r3 = entryBase(dir, info, 'прод');
  assert.equal(r3.base, step2, 'заливка позже входа — база для всех путей');
  assert.deepEqual(overlayOf(r3), []);
  assert.equal(r3.source, '«Залито на прод» в plan.md');
});

test('entryBase и baseTree: несколько коммитов входа подряд — у пути версия из самого нового, что его менял; удалённого входом нет; незалитый шаг — не база', () => {
  const dir = kitRepo({ 'b.php': 'b', 'c.php': 'c' });
  const info = kitInfo(dir);
  const first = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': 'наш шаг' });
  commit(dir, '1.1: правка, не залита');
  writeFiles(dir, { 'b.php': 'b1' });
  const e1 = commit(dir, ENTRY);
  writeFiles(dir, { 'b.php': 'b2' });
  fs.rmSync(path.join(dir, 'c.php'));
  const e2 = commit(dir, 'Прод: изменения без kit на 2026-10-30 (2 файла)');
  writeFiles(dir, { 'd.php': 'd' });
  const e3 = commit(dir, 'Прод: изменения без kit на 2026-10-30 (1 файл)'); // вторая часть того же входа (Р-16)
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, first);
  assert.equal(r.entries, 3);
  assert.deepEqual(overlayOf(r), [['b.php', e2], ['c.php', e2], ['d.php', e3]]);
  assert.equal(r.source, 'первый коммит репозитория; поверх — 3 коммита входа');
  assert.notEqual(e1, e2);
  const t = baseTree(dir, r);
  const blob = (rev, p) => git(dir, 'rev-parse', rev + ':' + p).trim();
  assert.equal(t.get('a.php').oid, blob(first, 'a.php'), 'наш незалитый шаг — не база');
  assert.equal(t.get('b.php').oid, blob(e2, 'b.php'));
  assert.ok(!t.has('c.php'), 'удалён коммитом входа — в базе нет');
  assert.equal(t.get('d.php').oid, blob(e3, 'd.php'));
  assert.equal(t.get('.claude/CLAUDE.md').mode, '100644');
  assert.deepEqual([...baseTree(dir, { base: first, overlay: new Map() }).keys()].sort(), ['.claude/CLAUDE.md', 'a.php', 'b.php', 'c.php']);
});

test('entryBase: коммит плана и входа не связаны — база из плана, коммит входа — наложение', () => {
  const dir = kitRepo();
  const info = kitInfo(dir);
  git(dir, 'checkout', '-q', '-b', 'side');
  writeFiles(dir, { 'side.php': 's' });
  const side = commit(dir, '9.9: в стороне');
  git(dir, 'checkout', '-q', '-');
  writeFiles(dir, { 'a.php': '2' });
  const entry = commit(dir, ENTRY);
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([side]));
  commit(dir, '1.1а: план');
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, side);
  assert.deepEqual(overlayOf(r), [['a.php', entry]]);
  assert.match(r.source, /поверх — 1 коммит входа/);
});

test('entryBase: учитываются только коммиты входа своего окружения — «Дев» не наложение для прода и наоборот', () => {
  const dir = kitRepo();
  const info = kitInfo(dir);
  const first = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  const dev = commit(dir, 'Дев: изменения без kit на 2026-10-29 (2 файла)');
  assert.deepEqual(overlayOf(entryBase(dir, info, 'прод')), [], 'коммит входа с дева — не в счёт для прода');
  assert.equal(entryBase(dir, info, 'прод').base, first);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'дев')), [['a.php', dev]]);
  writeFiles(dir, { 'a.php': '3' });
  const prodEntry = commit(dir, ENTRY);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'прод')), [['a.php', prodEntry]]);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'дев')), [['a.php', dev]], 'коммит входа с прода — не в счёт для дева');
  // «Залито на прод» важнее чужого коммита входа
  writeFiles(dir, { 'a.php': '4' });
  const step = commit(dir, '1.1: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([step.slice(0, 9)]));
  commit(dir, '1.1а: план');
  writeFiles(dir, { 'a.php': '5' });
  commit(dir, 'Дев: изменения без kit на 2026-10-30 (1 файл)');
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, step);
  assert.deepEqual(overlayOf(r), [], 'коммит входа дева после заливки прода — не наложение');
  assert.equal(r.source, '«Залито на прод» в plan.md');
});

test('entryBase: «Claude по SSH» — строка без хеша ищется по ID шага; без SSH пропускается', () => {
  const files = (mode) => ({ '.claude/CLAUDE.md': paramsMd({ ...PARAMS, 'Выкладка': mode }), 'a.php': '1' });
  const dir = gitRepo(files('Claude по SSH'));
  writeFiles(dir, { 'a.php': '2' });
  const step = commit(dir, '1.1: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan(['']));
  commit(dir, '1.1а: план');
  const ssh = entryBase(dir, kitInfo(dir), 'прод');
  assert.equal(ssh.base, step);
  assert.equal(ssh.source, '«Залито на прод» в plan.md');

  const manual = gitRepo(files('вручную'));
  writeFiles(manual, { 'a.php': '2' });
  commit(manual, '1.1: правка');
  fs.writeFileSync(path.join(manual, 'plan.md'), plan(['']));
  commit(manual, '1.1а: план');
  const r = entryBase(manual, kitInfo(manual), 'прод');
  assert.equal(r.base, git(manual, 'rev-list', '--max-parents=0', 'HEAD').trim());
  assert.equal(r.source, 'первый коммит репозитория');
});

test('entryBase: хеш плана, которого нет в репозитории, не в счёт — с пометкой', () => {
  const dir = kitRepo();
  const info = kitInfo(dir);
  const first = git(dir, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(dir, 'plan.md'), plan(['deadbeef0']));
  commit(dir, '1.1а: план');
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, first);
  assert.match(r.source, /первый коммит репозитория/);
  assert.match(r.source, /не найден/);
  writeFiles(dir, { 'a.php': '2' });
  const entry = commit(dir, ENTRY);
  const r2 = entryBase(dir, info, 'прод');
  assert.equal(r2.base, first);
  assert.deepEqual(overlayOf(r2), [['a.php', entry]]);
  assert.match(r2.source, /не найден.*; поверх — 1 коммит входа$/);
});

test('entryBase: не git и пустой репозиторий — error', () => {
  const dir = makeProject({ '.claude/CLAUDE.md': paramsMd(PARAMS) });
  assert.ok(entryBase(dir, kitInfo(dir), 'прод').error);
  git(dir, 'init', '-q');
  assert.ok(entryBase(dir, kitInfo(dir), 'прод').error);
});

test('skipTake: архивы и бэкапы без регистра, предел 10 МБ — включительно проходит, на байт больше — нет', () => {
  for (const n of ['_old.back', '_old.back1.php', 'dir/_X.BACK2', 'a/b/_site_back.zip', 'x_back_2024.ZIP', 'site.tar.gz', 'site.tar.gz.1', 'a.zip',
    'a.RAR', 'a.7z', 'a.tar', 'a.gz', 'dump.SQL', 'a.bak', 'д/копия сайта.zip', 'win\\a.zip']) {
    assert.equal(skipTake(n, 10), 'архив', n);
  }
  for (const n of ['index.php', 'upload/a.jpg', 'backup.php', 'a/zip', 'a/sql/x.php', 'bak', 'a.zipx', 'x/back.php']) assert.equal(skipTake(n, 10), null, n);
  assert.equal(skipTake('big.bin', FILE_LIMIT), null);
  assert.equal(skipTake('big.bin', FILE_LIMIT + 1), 'больше 10 МБ');
  assert.equal(skipTake('a.zip', FILE_LIMIT + 1), 'архив', 'маска — раньше размера');
  assert.equal(skipTake('big.bin', undefined), null, 'размер неизвестен — только маски');
  assert.equal(skipTake('big.bin', NaN), null);
  assert.equal(skipTake('a.zip', NaN), 'архив');
  assert.equal(skipTake('a/_dir.back/index.php', 10), null, 'маска — только по имени файла');
});

test('oursPaths: первый коммит и коммиты входа не считаются, слияния — тоже; пути с пробелом, кириллицей и кавычкой', () => {
  const dir = kitRepo({ 'first.php': '1' });
  assert.deepEqual([...oursPaths(dir)], [], 'только первый коммит');
  writeFiles(dir, { 'a.php': '2', "д/с пробелом 'x'.php": 'n' });
  commit(dir, '1.1: правка');
  writeFiles(dir, { 'entry.php': 'e', 'a.php': 'entry' });
  commit(dir, ENTRY);
  writeFiles(dir, { 'first.php': '2' });
  commit(dir, '1.2: ещё');
  fs.unlinkSync(path.join(dir, 'first.php'));
  commit(dir, '1.3: удалили');
  assert.deepEqual([...oursPaths(dir)].sort(), ['a.php', "д/с пробелом 'x'.php", 'first.php'].sort());
  assert.ok(!oursPaths(dir).has('entry.php'));
});

test('oursPaths: ветка с слиянием; пустой репозиторий и не git — пустой Set', () => {
  const dir = kitRepo();
  git(dir, 'checkout', '-q', '-b', 'side');
  writeFiles(dir, { 'side.php': 's' });
  commit(dir, '2.1: в ветке');
  git(dir, 'checkout', '-q', '-');
  writeFiles(dir, { 'main.php': 'm' });
  commit(dir, '2.2: в основной');
  git(dir, 'merge', '-q', '--no-ff', '-m', '2.3: слияние', 'side');
  assert.deepEqual([...oursPaths(dir)].sort(), ['main.php', 'side.php']);
  const empty = makeProject({});
  assert.equal(oursPaths(empty).size, 0);
  git(empty, 'init', '-q');
  assert.equal(oursPaths(empty).size, 0);
});

test('pendingDelete: удалено шагом и нет в HEAD; входом — нет; вернувшееся — нет', () => {
  const dir = kitRepo({ 'gone.php': '1', 'back.php': '1', 'by-entry.php': '1', 'keep.php': '1', 'д/ста рое.php': '1' });
  fs.unlinkSync(path.join(dir, 'gone.php'));
  fs.unlinkSync(path.join(dir, 'back.php'));
  fs.rmSync(path.join(dir, 'д'), { recursive: true });
  commit(dir, '1.1: удалили');
  fs.unlinkSync(path.join(dir, 'by-entry.php'));
  commit(dir, ENTRY);
  writeFiles(dir, { 'back.php': 'вернули' });
  commit(dir, '1.2: вернули');
  const p = pendingDelete(dir, kitInfo(dir));
  assert.deepEqual([...p].sort(), ['gone.php', 'д/ста рое.php'].sort());
});

test('pendingDelete: «Удалить с сервера» — открытые пункты, закрытые ✅ нет; папки, обратные кавычки, слеши', () => {
  const del = ['| `old/copy/` | старая копия | |', '| /upload/_tmp/** | мусор | |', '| .\\bitrix\\x.php | чужой | |', '| `done.php` | уже | ✅ 2026-10-20, скрипт |',
    '| `half.php` | не вышло | нет |', '| | пустой | |', '| a/b/* | папка | |'].join('\n');
  const dir = kitRepo({ 'plan.md': plan(['deadbeef0'], { del }) });
  const p = pendingDelete(dir, kitInfo(dir));
  assert.deepEqual([...p].sort(), ['a/b/', 'bitrix/x.php', 'half.php', 'old/copy/', 'upload/_tmp/'].sort());
  // нет колонки «Удалён» — открыты все
  const dir2 = kitRepo({ 'plan.md': plan(['deadbeef0'], { del: '| `x.php` | ✅ почему |', delHead: '| Путь | Почему |\n|---|---|' }) });
  assert.deepEqual([...pendingDelete(dir2, kitInfo(dir2))], ['x.php']);
  // нет плана или раздела — только git
  const dir3 = kitRepo();
  assert.equal(pendingDelete(dir3, kitInfo(dir3)).size, 0);
  fs.writeFileSync(path.join(dir3, 'plan.md'), '# Выкладка\n\n## Залито на прод\n');
  assert.equal(pendingDelete(dir3, kitInfo(dir3)).size, 0);
});

test('inPending: точное совпадение и «внутри записи папки», с учётом регистра', () => {
  const p = new Set(['a.php', 'old/copy/', 'Dir/']);
  assert.ok(inPending(p, 'a.php'));
  assert.ok(inPending(p, 'old/copy/x/y.php'));
  assert.ok(inPending(p, 'Dir/z'));
  assert.ok(!inPending(p, 'dir/z'));
  assert.ok(!inPending(p, 'old/copy2/x.php'));
  assert.ok(!inPending(p, 'old/copy'));
  assert.ok(!inPending(p, 'A.php'));
  assert.ok(!inPending(new Set(), 'a.php'));
});

test('entrySubject и summaryLine: склонение; нечего — «прод совпадает с git»; доработки, не забранное и ждущее удаления — отдельно', () => {
  const word = { 0: 'файлов', 1: 'файл', 2: 'файла', 4: 'файла', 5: 'файлов', 11: 'файлов', 12: 'файлов', 14: 'файлов', 20: 'файлов', 21: 'файл',
    22: 'файла', 25: 'файлов', 101: 'файл', 111: 'файлов', 112: 'файлов', 114: 'файлов', 121: 'файл' };
  for (const [n, w] of Object.entries(word)) assert.equal(entrySubject('прод', '2026-10-29', Number(n)), `Прод: изменения без kit на 2026-10-29 (${n} ${w})`);
  assert.equal(entrySubject('дев', '2026-10-29', 3), 'Дев: изменения без kit на 2026-10-29 (3 файла)');
  assert.ok(ENTRY_RE.test(entrySubject('прод', 'd', 1)) && ENTRY_RE.test(entrySubject('дев', 'd', 1)));

  assert.equal(summaryLine({ env: 'прод', changed: [], added: [], removed: [], ours: [], skipped: [], waiting: [] }), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(summaryLine({ env: 'прод' }), '[kit] Вход с прода: прод совпадает с git.');
  assert.equal(summaryLine({ env: 'дев' }), '[kit] Вход с дева: дев совпадает с git.');

  const only = summaryLine({ env: 'прод', changed: ['a.php', 'b.php', 'c.php'], added: ['n.php'] });
  assert.equal(only.startsWith('[kit] Вход с прода: '), true);
  assert.match(only, /изменено 3, добавлено 1, удалено 0/);
  assert.ok(!only.includes('\n'));
  assert.ok(!/доработ|не забрано|удален/i.test(only.replace(/удалено 0/, '')), 'пустые части не выводятся: ' + only);
  const nulls = { env: 'прод', changed: null, added: null, removed: 5, ours: 'x', skipped: {}, waiting: undefined };
  assert.equal(summaryLine(nulls), '[kit] Вход с прода: прод совпадает с git.', 'null и не-массив — как пустой массив');
  assert.match(summaryLine({ ...nulls, added: ['n'], ours: null }), /изменено 0, добавлено 1, удалено 0/);
  assert.equal(summaryLine(), '[kit] Вход с прода: прод совпадает с git.');
  assert.match(summaryLine({ env: 'дев', removed: ['x'] }), /^\[kit\] Вход с дева: .*изменено 0, добавлено 0, удалено 1/);

  const full = summaryLine({ env: 'прод', changed: ['a.php'], ours: ['a.php'], skipped: [{ path: 'x.zip', why: 'архив' }, { path: 'big.bin', why: 'больше 10 МБ' }],
    waiting: ['old.php'] });
  assert.ok(!full.includes('\n'));
  const iOurs = full.indexOf('доработ');
  const iSkip = full.indexOf('x.zip (архив)');
  const iWait = full.indexOf('old.php');
  assert.ok(iOurs > 0 && iSkip > iOurs && iWait > iSkip, full);
  assert.match(full, /big\.bin \(больше 10 МБ\)/);
  assert.match(full, /ждёт удаления с сервера/i);
  assert.match(full, /не забрано/i);
});

test('summaryLine: merged — «Совмещено с нашими незакоммиченными правками» после доработок; только оно — числа нулевые, не «совпадает»', () => {
  const PART = 'Совмещено с нашими незакоммиченными правками — проверьте в панели изменений: ';
  assert.equal(summaryLine({ env: 'прод', merged: ['a.php', 'b.php'] }),
    '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + PART + 'a.php, b.php.');
  assert.equal(summaryLine({ env: 'прод', merged: [] }), '[kit] Вход с прода: прод совпадает с git.');
  const full = summaryLine({ env: 'дев', changed: ['x.php'], ours: ['x.php'], merged: ['m.php'], skipped: [{ path: 'a.zip', why: 'архив' }] });
  const iOurs = full.indexOf('доработ');
  const iMerged = full.indexOf('Совмещено');
  const iSkip = full.indexOf('Не забрано');
  assert.ok(iOurs > 0 && iMerged > iOurs && iSkip > iMerged, full);
  assert.match(full, /^\[kit\] Вход с дева: файлов без kit: изменено 1/);
});

test('summaryLine: conflicts (Р-37) — «Не совместилось само — вопрос ниже»; одни конфликты — не «совпадает»', () => {
  assert.equal(summaryLine({ env: 'прод', conflicts: ['a.php', 'b.php'] }),
    '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php, b.php.');
  assert.equal(summaryLine({ env: 'дев', conflicts: ['a.php'] }),
    '[kit] Вход с дева: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php.');
  assert.equal(summaryLine({ env: 'прод', conflicts: [] }), '[kit] Вход с прода: прод совпадает с git.');
  const full = summaryLine({ env: 'прод', changed: ['x.php'], merged: ['m.php'], conflicts: ['c.php'], skipped: [{ path: 'a.zip', why: 'архив' }] });
  const iMerged = full.indexOf('Совмещено');
  const iConf = full.indexOf('Не совместилось');
  const iSkip = full.indexOf('Не забрано');
  assert.ok(iMerged > 0 && iConf > iMerged && iSkip > iConf, full);
  const many = summaryLine({ env: 'прод', conflicts: Array.from({ length: 12 }, (_, i) => `c${i}.php`) });
  assert.match(many, /c9\.php и ещё 2\.$/);
});

test('summaryLine: conflictsAhead (--check, Р-39) — «Не совместится само — вопрос задаст вход общей сессии»; одни — не «совпадает»', () => {
  assert.equal(summaryLine({ env: 'прод', conflictsAhead: ['a.php'] }),
    '[kit] Вход с прода: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместится само — вопрос задаст вход общей сессии: a.php.');
  assert.equal(summaryLine({ env: 'прод', conflictsAhead: [] }), '[kit] Вход с прода: прод совпадает с git.');
  const full = summaryLine({ env: 'прод', changed: ['x.php'], conflictsAhead: ['c.php'], skipped: [{ path: 'd', why: 'у нас на этом месте папка' }] });
  assert.ok(full.indexOf('Не совместится') > 0 && full.indexOf('Не забрано') > full.indexOf('Не совместится'), full);
});

// .idea/watcherTasks.xml PhpStorm: задачи по образцу настоящего файла.
const task = (attrs, ext, extra = '') => `    <TaskOptions${attrs}>\n      <option name="arguments" value="$FileName$" />\n` +
  (ext === null ? '' : `      <option name="fileExtension" value="${ext}" />\n`) + `      <option name="name" value="W" />\n${extra}      <envs />\n    </TaskOptions>\n`;
const watchers = (...tasks) => '<?xml version="1.0" encoding="UTF-8"?>\n<project version="4">\n  <component name="ProjectTasksOptions">\n' +
  tasks.join('') + '  </component>\n</project>\n';

test('watcherExts: включённые задачи (isEnabled="true" или без него), без точки и нижним регистром; выключенные — нет; нет файла или не разобран — пусто', () => {
  const dir = makeProject({});
  assert.deepEqual([...watcherExts(dir)], [], 'нет файла');
  writeFiles(dir, { '.idea/watcherTasks.xml': watchers(task(' isEnabled="true"', 'scss'), task(' isEnabled="false"', 'less'), task('', '.JS'),
    task(' isEnabled="true"', null), task(' isEnabled="true"', ' Ts ')) });
  assert.deepEqual([...watcherExts(dir)].sort(), ['js', 'scss', 'ts']);
  writeFiles(dir, { '.idea/watcherTasks.xml': '\uFEFF' + watchers('    <TaskOptions isEnabled="true" />\n', task(' isEnabled="true"', 'styl')) });
  assert.deepEqual([...watcherExts(dir)], ['styl'], 'самозакрытая задача не съедает следующую; BOM не мешает');
  writeFiles(dir, { '.idea/watcherTasks.xml': '<project><component name="ProjectTasksOptions"><TaskOptions isEnabled="true"><option name="fileExt' });
  assert.deepEqual([...watcherExts(dir)], [], 'обрезанный файл');
  writeFiles(dir, { '.idea/watcherTasks.xml': 'не xml' });
  assert.deepEqual([...watcherExts(dir)], []);
});

test('mergeVersions: сошлось — результат; правки пересекаются — конфликт; базы нет — пустой файл; временная папка убирается', () => {
  const B = (s) => Buffer.from(s);
  const base = B('l1\nl2\nl3\nl4\nl5\n');
  const made = [];
  const mk = fs.mkdtempSync;
  fs.mkdtempSync = (...a) => {
    const d = mk(...a);
    made.push(d);
    return d;
  };
  try {
    const ok = mergeVersions({ ours: B('L1\nl2\nl3\nl4\nl5\n'), base, theirs: B('l1\nl2\nl3\nl4\nL5\n') });
    assert.deepEqual(ok, { result: B('L1\nl2\nl3\nl4\nL5\n') });
    const bad = mergeVersions({ ours: B('наша\nl2\nl3\nl4\nl5\n'), base, theirs: B('сервер\nl2\nl3\nl4\nl5\n') });
    assert.deepEqual(bad, { conflict: 'правки пересекаются' });
    assert.deepEqual(mergeVersions({ ours: B('x\n'), base: null, theirs: B('x\n') }), { result: B('x\n') }, 'добавлен одинаково у обоих');
    assert.deepEqual(mergeVersions({ ours: B('x\n'), base: null, theirs: B('y\n') }), { conflict: 'правки пересекаются' });
  } finally {
    fs.mkdtempSync = mk;
  }
  assert.equal(made.length, 4);
  for (const d of made) {
    assert.ok(path.basename(d).startsWith('kit-merge-'), d);
    assert.ok(!fs.existsSync(d), 'временная папка убрана: ' + d);
  }
});

test('mergeVersions: CRLF → LF до совмещения, результат — в стиле нашей версии; удалён с одной стороны; NUL — двоичный, без merge-file', () => {
  const B = (s) => Buffer.from(s);
  const base = B('l1\nl2\nl3\nl4\nl5\n');
  assert.deepEqual(mergeVersions({ ours: B('L1\r\nl2\r\nl3\r\nl4\r\nl5\r\n'), base, theirs: B('l1\nl2\nl3\nl4\nL5\n') }),
    { result: B('L1\r\nl2\r\nl3\r\nl4\r\nL5\r\n') }, 'наша с CRLF — результат с CRLF');
  assert.deepEqual(mergeVersions({ ours: B('L1\nl2\nl3\nl4\nl5\n'), base: B('l1\r\nl2\r\nl3\r\nl4\r\nl5\r\n'), theirs: B('l1\r\nl2\r\nl3\r\nl4\r\nL5\r\n') }),
    { result: B('L1\nl2\nl3\nl4\nL5\n') }, 'сервер с CRLF, наша с LF — результат с LF, без ложного конфликта');
  assert.deepEqual(mergeVersions({ ours: null, base, theirs: B('x\n') }), { conflict: 'удалён у нас, изменён на сервере' });
  assert.deepEqual(mergeVersions({ ours: B('x\n'), base, theirs: null }), { conflict: 'изменён у нас, удалён на сервере' });
  assert.deepEqual(mergeVersions({ ours: null, base, theirs: null }), { result: null }, 'удалён у обоих — совмещать нечего');
  const made = [];
  const mk = fs.mkdtempSync;
  fs.mkdtempSync = (...a) => {
    made.push(a);
    return mk(...a);
  };
  try {
    for (const v of [{ ours: B('a\0b'), base, theirs: B('x\n') }, { ours: B('x\n'), base: B('\0'), theirs: B('y\n') }, { ours: B('x\n'), base, theirs: B('\0') }]) {
      assert.deepEqual(mergeVersions(v), { conflict: 'двоичный файл' });
    }
  } finally {
    fs.mkdtempSync = mk;
  }
  assert.equal(made.length, 0, 'двоичный файл — без временной папки и merge-file');
});

test('summaryLine: не больше 10 путей в части, дальше «и ещё N»; управляющие символы заменяются', () => {
  const many = Array.from({ length: 13 }, (_, i) => `f${i}.php`);
  const line = summaryLine({ env: 'прод', changed: many, ours: many, waiting: many });
  assert.ok(line.includes('f9.php') && !line.includes('f10.php'));
  assert.equal((line.match(/и ещё 3/g) || []).length, 2);
  const exactly = summaryLine({ env: 'прод', changed: ['a'], ours: many.slice(0, 10) });
  assert.ok(!exactly.includes('и ещё'));
  const bad = summaryLine({ env: 'прод', changed: ['a'], ours: ['x\ny\r\tz\u0000.php'], skipped: [{ path: 'q\nw.zip', why: 'архив' }] });
  assert.ok(!/[\u0000-\u001f]/.test(bad), JSON.stringify(bad));
  assert.match(bad, /x.y.+z.+\.php/);
});

test('отметка: две сессии не мешают друг другу, битый файл — пустая, старше 7 дней убираются, lastNeed — последняя need', () => {
  const dir = makeProject({});
  const empty = { sessions: {}, named: [], pending: [] };
  assert.deepEqual(readMark(dir), empty, 'файла нет');
  markSession(dir, 'A', 'need');
  markSession(dir, 'B', 'done', 'abc1234');
  const m = readMark(dir);
  assert.deepEqual(Object.keys(m.sessions).sort(), ['A', 'B']);
  assert.equal(m.sessions.A.result, 'need');
  assert.equal(m.sessions.B.result, 'done');
  assert.equal(m.sessions.B.commit, 'abc1234');
  assert.ok(!('commit' in m.sessions.A));
  assert.ok(!Number.isNaN(Date.parse(m.sessions.A.at)));
  assert.ok(!sessionDone(dir, 'A'));
  assert.ok(sessionDone(dir, 'B'));
  assert.equal(lastNeed(dir), 'A');

  // named и pending и записи других сессий сохраняются
  writeMark(dir, { ...readMark(dir), named: ['x.zip'], pending: ['old.php'] });
  markSession(dir, 'A', 'skipped');
  const m2 = readMark(dir);
  assert.deepEqual(m2.named, ['x.zip']);
  assert.deepEqual(m2.pending, ['old.php']);
  assert.equal(m2.sessions.B.commit, 'abc1234');
  assert.ok(sessionDone(dir, 'A'));
  markSession(dir, 'C', 'checked');
  assert.ok(sessionDone(dir, 'C'));
  assert.equal(lastNeed(dir), null);
  assert.ok(!sessionDone(dir, 'нет такой'));

  // lastNeed — самая поздняя need
  const t = (ms) => new Date(Date.now() - ms).toISOString();
  writeMark(dir, { sessions: { P: { at: t(3000), result: 'need' }, Q: { at: t(1000), result: 'need' }, R: { at: t(500), result: 'done' }, S: { at: t(2000), result: 'need' } },
    named: [], pending: [] });
  assert.equal(lastNeed(dir), 'Q');

  // файл — UTF-8 без BOM, LF
  const raw = fs.readFileSync(path.join(dir, MARK_FILE));
  assert.notEqual(raw[0], 0xef);
  assert.ok(!raw.includes(13));
  assert.equal(raw[raw.length - 1], 10);

  // битый файл — пустая отметка
  fs.writeFileSync(path.join(dir, MARK_FILE), '{ не json');
  assert.deepEqual(readMark(dir), empty);
  assert.equal(lastNeed(dir), null);
  markSession(dir, 'N', 'need');
  assert.deepEqual(Object.keys(readMark(dir).sessions), ['N'], 'после битого файла запись снова работает');
});

test('отметка: записи старше 7 дней и с нечитаемым at убираются при записи; поля не того типа — пустые', () => {
  const dir = makeProject({});
  const day = 24 * 3600 * 1000;
  writeMark(dir, { sessions: {
    old: { at: new Date(Date.now() - 8 * day).toISOString(), result: 'done' },
    edge: { at: new Date(Date.now() - 6 * day).toISOString(), result: 'done' },
    bad: { at: 'вчера', result: 'done' },
    noat: { result: 'done' },
  }, named: ['a'], pending: [] });
  assert.deepEqual(Object.keys(readMark(dir).sessions), ['edge']);

  const file = path.join(dir, MARK_FILE);
  fs.writeFileSync(file, JSON.stringify({ sessions: { ok: { at: new Date().toISOString(), result: 'need' }, str: 'x', nul: null, noRes: { at: 'x' }, num: { result: 5 } },
    named: ['a', 3, null, 'b'], pending: 'нет' }));
  const m = readMark(dir);
  assert.deepEqual(Object.keys(m.sessions), ['ok']);
  assert.deepEqual(m.named, ['a', 'b']);
  assert.deepEqual(m.pending, []);
  for (const raw of ['[]', 'null', '5', '"s"', '{"sessions":[1],"named":{}}']) {
    fs.writeFileSync(file, raw);
    assert.deepEqual(readMark(dir), { sessions: {}, named: [], pending: [] }, raw);
  }
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ sessions: { z: { at: new Date().toISOString(), result: 'done' } } }));
  assert.ok(sessionDone(dir, 'z'), 'BOM не мешает');
});

test('отметка: id сессии — внешний ввод: __proto__, constructor, toString; пустой и не строка — ничего не пишет', () => {
  const dir = makeProject({});
  for (const bad of ['', null, undefined, 5, {}]) {
    markSession(dir, bad, 'done');
    assert.ok(!sessionDone(dir, bad));
  }
  assert.ok(!fs.existsSync(path.join(dir, MARK_FILE)), 'ничего не записано');
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.ok(!sessionDone(dir, id), id + ': до записи — нет');
  }
  markSession(dir, 'x', 'need');
  assert.ok(!sessionDone(dir, '__proto__'), 'чужая запись не видна под __proto__');
  assert.ok(!sessionDone(dir, 'constructor'));
  markSession(dir, '__proto__', 'done');
  markSession(dir, 'constructor', 'skipped');
  markSession(dir, 'toString', 'checked');
  assert.ok(sessionDone(dir, '__proto__'));
  assert.ok(sessionDone(dir, 'constructor'));
  assert.ok(sessionDone(dir, 'toString'));
  assert.equal(Object.getPrototypeOf(readMark(dir).sessions), Object.prototype, 'прототип не подменён');
  assert.deepEqual(Object.keys(readMark(dir).sessions).sort(), ['__proto__', 'constructor', 'toString', 'x']);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(lastNeed(dir), 'x');
  markSession(dir, '__proto__', 'need');
  assert.equal(lastNeed(dir), '__proto__');
  assert.equal(({}).result, undefined, 'Object.prototype не загрязнён');
});

test('markSession: неверный результат не пишется; commit — только если передан', () => {
  const dir = makeProject({});
  markSession(dir, 's', 'bogus');
  assert.ok(!fs.existsSync(path.join(dir, MARK_FILE)));
  markSession(dir, 's', 'done', 'abc');
  markSession(dir, 's', 'checked');
  const rec = readMark(dir).sessions.s;
  assert.equal(rec.result, 'checked');
  assert.ok(!('commit' in rec), 'запись сессии заменяется целиком');
});
