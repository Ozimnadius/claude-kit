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
  summaryLine, MARK_FILE, readMark, writeMark, watcherExts, mergeVersions, bigOf, stopLines, md5Eol } = prod;

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

test('entryBase: база — заливка (нет — первый коммит), поверх — пути своих коммитов синхронизации после неё; заливка после синхронизации — наложения нет (Р-24)', () => {
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
  assert.equal(r2.base, step, 'коммит синхронизации позже заливки — не база, а наложение');
  assert.deepEqual(overlayOf(r2), [['a.php', entry]]);
  assert.equal(r2.entries, 1);
  assert.equal(r2.source, '«Залито на прод» в plan.md; поверх — 1 коммит синхронизации');

  writeFiles(dir, { 'a.php': '4' });
  const step2 = commit(dir, '1.2: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([step.slice(0, 9), step2.slice(0, 9)]));
  commit(dir, '1.2а: план');
  const r3 = entryBase(dir, info, 'прод');
  assert.equal(r3.base, step2, 'заливка позже синхронизации — база для всех путей');
  assert.deepEqual(overlayOf(r3), []);
  assert.equal(r3.source, '«Залито на прод» в plan.md');
});

test('entryBase и baseTree: несколько коммитов синхронизации подряд — у пути версия из самого нового, что его менял; удалённого синхронизацией нет; незалитый шаг — не база', () => {
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
  const e3 = commit(dir, 'Прод: изменения без kit на 2026-10-30 (1 файл)'); // вторая часть той же синхронизации (Р-16)
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, first);
  assert.equal(r.entries, 3);
  assert.deepEqual(overlayOf(r), [['b.php', e2], ['c.php', e2], ['d.php', e3]]);
  assert.equal(r.source, 'первый коммит репозитория; поверх — 3 коммита синхронизации');
  assert.notEqual(e1, e2);
  const t = baseTree(dir, r);
  const blob = (rev, p) => git(dir, 'rev-parse', rev + ':' + p).trim();
  assert.equal(t.get('a.php').oid, blob(first, 'a.php'), 'наш незалитый шаг — не база');
  assert.equal(t.get('b.php').oid, blob(e2, 'b.php'));
  assert.ok(!t.has('c.php'), 'удалён коммитом синхронизации — в базе нет');
  assert.equal(t.get('d.php').oid, blob(e3, 'd.php'));
  assert.equal(t.get('.claude/CLAUDE.md').mode, '100644');
  assert.deepEqual([...baseTree(dir, { base: first, overlay: new Map() }).keys()].sort(), ['.claude/CLAUDE.md', 'a.php', 'b.php', 'c.php']);
});

test('entryBase: коммит плана и синхронизации не связаны — база из плана, коммит синхронизации — наложение', () => {
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
  assert.match(r.source, /поверх — 1 коммит синхронизации/);
});

test('entryBase: учитываются только коммиты синхронизации своего окружения — «Дев» не наложение для прода и наоборот', () => {
  const dir = kitRepo();
  const info = kitInfo(dir);
  const first = git(dir, 'rev-parse', 'HEAD').trim();
  writeFiles(dir, { 'a.php': '2' });
  const dev = commit(dir, 'Дев: изменения без kit на 2026-10-29 (2 файла)');
  assert.deepEqual(overlayOf(entryBase(dir, info, 'прод')), [], 'коммит синхронизации с дева — не в счёт для прода');
  assert.equal(entryBase(dir, info, 'прод').base, first);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'дев')), [['a.php', dev]]);
  writeFiles(dir, { 'a.php': '3' });
  const prodEntry = commit(dir, ENTRY);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'прод')), [['a.php', prodEntry]]);
  assert.deepEqual(overlayOf(entryBase(dir, info, 'дев')), [['a.php', dev]], 'коммит синхронизации с прода — не в счёт для дева');
  // «Залито на прод» важнее чужого коммита синхронизации
  writeFiles(dir, { 'a.php': '4' });
  const step = commit(dir, '1.1: правка');
  fs.writeFileSync(path.join(dir, 'plan.md'), plan([step.slice(0, 9)]));
  commit(dir, '1.1а: план');
  writeFiles(dir, { 'a.php': '5' });
  commit(dir, 'Дев: изменения без kit на 2026-10-30 (1 файл)');
  const r = entryBase(dir, info, 'прод');
  assert.equal(r.base, step);
  assert.deepEqual(overlayOf(r), [], 'коммит синхронизации дева после заливки прода — не наложение');
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
  assert.match(r2.source, /не найден.*; поверх — 1 коммит синхронизации$/);
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

test('oursPaths: первый коммит и коммиты синхронизации не считаются, слияния — тоже; пути с пробелом, кириллицей и кавычкой', () => {
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

test('pendingDelete: удалено шагом и нет в HEAD; синхронизацией — нет; вернувшееся — нет', () => {
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

  assert.equal(summaryLine({ env: 'прод', changed: [], added: [], removed: [], ours: [], skipped: [], waiting: [] }), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(summaryLine({ env: 'прод' }), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.equal(summaryLine({ env: 'дев' }), '[kit] Синхронизация с девом: дев совпадает с git.');

  const only = summaryLine({ env: 'прод', changed: ['a.php', 'b.php', 'c.php'], added: ['n.php'] });
  assert.equal(only.startsWith('[kit] Синхронизация с продом: '), true);
  assert.match(only, /изменено 3, добавлено 1, удалено 0/);
  assert.ok(!only.includes('\n'));
  assert.ok(!/доработ|не забрано|удален/i.test(only.replace(/удалено 0/, '')), 'пустые части не выводятся: ' + only);
  const nulls = { env: 'прод', changed: null, added: null, removed: 5, ours: 'x', skipped: {}, waiting: undefined };
  assert.equal(summaryLine(nulls), '[kit] Синхронизация с продом: прод совпадает с git.', 'null и не-массив — как пустой массив');
  assert.match(summaryLine({ ...nulls, added: ['n'], ours: null }), /изменено 0, добавлено 1, удалено 0/);
  assert.equal(summaryLine(), '[kit] Синхронизация с продом: прод совпадает с git.');
  assert.match(summaryLine({ env: 'дев', removed: ['x'] }), /^\[kit\] Синхронизация с девом: .*изменено 0, добавлено 0, удалено 1/);

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
    '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. ' + PART + 'a.php, b.php.');
  assert.equal(summaryLine({ env: 'прод', merged: [] }), '[kit] Синхронизация с продом: прод совпадает с git.');
  const full = summaryLine({ env: 'дев', changed: ['x.php'], ours: ['x.php'], merged: ['m.php'], skipped: [{ path: 'a.zip', why: 'архив' }] });
  const iOurs = full.indexOf('доработ');
  const iMerged = full.indexOf('Совмещено');
  const iSkip = full.indexOf('Не забрано');
  assert.ok(iOurs > 0 && iMerged > iOurs && iSkip > iMerged, full);
  assert.match(full, /^\[kit\] Синхронизация с девом: файлов без kit: изменено 1/);
});

test('summaryLine: conflicts (Р-37) — «Не совместилось само — вопрос ниже»; одни конфликты — не «совпадает»', () => {
  assert.equal(summaryLine({ env: 'прод', conflicts: ['a.php', 'b.php'] }),
    '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php, b.php.');
  assert.equal(summaryLine({ env: 'дев', conflicts: ['a.php'] }),
    '[kit] Синхронизация с девом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместилось само — вопрос ниже: a.php.');
  assert.equal(summaryLine({ env: 'прод', conflicts: [] }), '[kit] Синхронизация с продом: прод совпадает с git.');
  const full = summaryLine({ env: 'прод', changed: ['x.php'], merged: ['m.php'], conflicts: ['c.php'], skipped: [{ path: 'a.zip', why: 'архив' }] });
  const iMerged = full.indexOf('Совмещено');
  const iConf = full.indexOf('Не совместилось');
  const iSkip = full.indexOf('Не забрано');
  assert.ok(iMerged > 0 && iConf > iMerged && iSkip > iConf, full);
  const many = summaryLine({ env: 'прод', conflicts: Array.from({ length: 12 }, (_, i) => `c${i}.php`) });
  assert.match(many, /c9\.php и ещё 2\.$/);
});

test('summaryLine: conflictsAhead (--check, Р-39) — «Не совместится само — вопрос задаст синхронизация в основной папке»; одни — не «совпадает»', () => {
  assert.equal(summaryLine({ env: 'прод', conflictsAhead: ['a.php'] }),
    '[kit] Синхронизация с продом: файлов без kit: изменено 0, добавлено 0, удалено 0. Не совместится само — вопрос задаст синхронизация в основной папке: a.php.');
  assert.equal(summaryLine({ env: 'прод', conflictsAhead: [] }), '[kit] Синхронизация с продом: прод совпадает с git.');
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

test('отметка (48.7): только named и pending; старый файл с sessions читается без ошибки, при записи поле пропадает', () => {
  const dir = makeProject({});
  const empty = { named: [], pending: [] };
  assert.deepEqual(readMark(dir), empty, 'файла нет');
  writeMark(dir, { named: ['x.zip'], pending: ['old.php'], sessions: { A: { at: new Date().toISOString(), result: 'need' } } });
  assert.deepEqual(readMark(dir), { named: ['x.zip'], pending: [{ path: 'old.php' }] }, 'строка — md5 неизвестен');
  const file = path.join(dir, MARK_FILE);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { named: ['x.zip'], pending: ['old.php'] }, 'sessions не пишется');

  // файл первой редакции (с записями сессий) — читается, при записи sessions пропадает
  fs.writeFileSync(file, JSON.stringify({ sessions: { s1: { at: new Date().toISOString(), result: 'done', commit: 'abc1234' }, s2: { at: 'x', result: 'need' } },
    named: ['a.zip'], pending: ['p.php'] }));
  const old = readMark(dir);
  assert.deepEqual(old, { named: ['a.zip'], pending: [{ path: 'p.php' }] });
  writeMark(dir, { ...old, pending: [] });
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ named: ['a.zip'], pending: [] }, null, 2) + '\n');

  // файл — UTF-8 без BOM, LF
  const raw = fs.readFileSync(file);
  assert.notEqual(raw[0], 0xef);
  assert.ok(!raw.includes(13));
  assert.equal(raw[raw.length - 1], 10);

  // битый файл — пустая отметка; запись после него работает
  fs.writeFileSync(file, '{ не json');
  assert.deepEqual(readMark(dir), empty);
  writeMark(dir, { named: [], pending: ['n.php'] });
  assert.deepEqual(readMark(dir), { named: [], pending: [{ path: 'n.php' }] });
});

test('отметка (Р-57): элемент pending — { path, md5 }: md5 записанного (md5NoCr), null — синхронизация файл удаляет; строка первой редакции — md5 неизвестен; битые элементы отброшены', () => {
  const dir = makeProject({});
  const file = path.join(dir, MARK_FILE);
  const h = md5('a2' + String.fromCharCode(10));
  writeMark(dir, { named: [], pending: [{ path: 'a.php', md5: h }, { path: 'gone.php', md5: null }, 'old.php', { path: 'x.php' }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).pending,
    [{ path: 'a.php', md5: h }, { path: 'gone.php', md5: null }, 'old.php', 'x.php'], 'md5 неизвестен — строкой, как в первой редакции');
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php', md5: h }, { path: 'gone.php', md5: null }, { path: 'old.php' }, { path: 'x.php' }]);
  fs.writeFileSync(file, JSON.stringify({ named: [], pending: [{ path: 'a.php', md5: 5 }, { md5: h }, null, 7, { path: 3 }, [], { path: 'b.php', md5: 'abc' }] }));
  assert.deepEqual(readMark(dir).pending, [{ path: 'a.php' }, { path: 'b.php', md5: 'abc' }], 'md5 не строка и не null — неизвестен; без пути — отброшен');
});

test('отметка: поля не того типа — пустые; BOM не мешает; записей сессий и функций для них нет (48.7)', () => {
  const dir = makeProject({});
  const file = path.join(dir, MARK_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ sessions: { ok: { at: new Date().toISOString(), result: 'need' } }, named: ['a', 3, null, 'b'], pending: 'нет' }));
  assert.deepEqual(readMark(dir), { named: ['a', 'b'], pending: [] });
  for (const raw of ['[]', 'null', '5', '"s"', '{"sessions":[1],"named":{}}']) {
    fs.writeFileSync(file, raw);
    assert.deepEqual(readMark(dir), { named: [], pending: [] }, raw);
  }
  fs.writeFileSync(file, String.fromCharCode(0xfeff) + JSON.stringify({ named: ['z.zip'] }));
  assert.deepEqual(readMark(dir), { named: ['z.zip'], pending: [] }, 'BOM не мешает');
  for (const name of ['markSession', 'sessionDone', 'lastNeed']) assert.equal(prod[name], undefined, name);
  const src = fs.readFileSync(require.resolve('../plugins/kit/scripts/lib/prod'), 'utf8');
  assert.doesNotMatch(src, /sessions|MARK_TTL/, 'записей сессий в lib/prod.js нет');
});

test('правила без SSH — в lib/prod.js (48.6): имя пути, вотчеры и объём, папка конфликтов, blob и его варианты; lib/prod.js не берёт lib/prod-ssh.js', () => {
  for (const name of ['badName', 'watcherHits', 'bigOf', 'stopLines', 'conflictDir', 'md5Eol', 'catBlobs', 'blobHashes', 'blobVariants', 'readText', 'clean']) {
    assert.equal(typeof prod[name], 'function', name);
  }
  assert.equal(prod.UNKNOWN_SIZE, 1024 * 1024);
  assert.equal(prod.SKIP, 'Отложить');
  assert.ok(!fs.readFileSync(require.resolve('../plugins/kit/scripts/lib/prod'), 'utf8').includes("require('./prod-ssh')"), 'без круговой зависимости');
  assert.equal(md5Eol(Buffer.from('a\r\nb\n'), false), md5('a\nb\n'));
  assert.equal(md5Eol(Buffer.from('a\r\nb\n'), true), md5('a\r\nb\r\n'));
});

test('bigOf и stopLines (48.6): «Синхронизация остановлена, ничего не записано»; варианты «… / Отложить», флаги prod-sync.js', () => {
  const MB = 1024 * 1024;
  assert.equal(bigOf([{ path: 'a.bin', size: 10 * MB }, { path: 'b.php' }], ENTRY_LIMIT), null);
  const big = bigOf([{ path: 'media/a/b/c/1.bin', size: 40 * MB }, { path: '2.bin', size: 20 * MB }, { path: 'x.php' }], ENTRY_LIMIT);
  assert.deepEqual(big, { total: 61 * MB, top: [['media/a/b/', 40 * MB], ['2.bin', 20 * MB], ['x.php', MB]] }, 'размер неизвестен — 1 МБ');
  const ask = 'спроси пользователя одним AskUserQuestion: ';
  const byWatchers = 'по вотчерам — Забирать (`prod-sync.js --watchers-ok`; лучше выключить вотчеры на время синхронизации) / Отложить';
  const bySize = 'по объёму — Забрать всё (`prod-sync.js --big-ok`) / Не забирать папки (допиши их в .gitignore и повтори синхронизацию) / Отложить';
  assert.deepEqual(stopLines({ exts: ['scss'], hits: ['a.scss'] }, big, ENTRY_LIMIT), [
    'Синхронизация остановлена, ничего не записано:',
    '  File Watchers PhpStorm (scss) — среди забираемого 1 файл: a.scss; пересборка перезапишет результат, PhpStorm (Always) зальёт его на сервер',
    '  Забрать за одну синхронизацию — 61 МБ (больше 50 МБ); самые тяжёлые папки: media/a/b/ — 40 МБ, 2.bin — 20 МБ, x.php — 1 МБ',
    ask + byWatchers + '; ' + bySize + '; оба ответа «забирать» — флаги вместе',
  ]);
  assert.equal(stopLines(null, big, ENTRY_LIMIT).pop(), ask + bySize);
  assert.equal(stopLines({ exts: ['scss'], hits: ['a.scss'] }, null, ENTRY_LIMIT).pop(), ask + byWatchers);
});
