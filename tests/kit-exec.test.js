'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, php, hasPhp, phpLint, spawnPhp, PLUGIN } = require('./helpers');
const { buildKitExec } = require('../plugins/kit/scripts/lib/kitexec');

const skip = !hasPhp('7.4');
const params = (lines) => '# Проект\n\n## Параметры для агентов\n\n' + lines.join('\n') + '\n';

// Поддельное ядро Битрикса: $USER->IsAdmin() — по переменной окружения FAKE_ADMIN; BX_UTF — по FAKE_UTF;
// FAKE_PRE — пролог что-то выводит (заголовки уходят); FAKE_KERNEL — как настоящее ядро (ExceptionHandler): своя
// shutdown-функция при любой ошибке печатает [ядро] и делает die().
const PROLOG = '<?php\n'
  + 'class KitFakeUser { function IsAdmin() { return getenv("FAKE_ADMIN") === "1"; } }\n'
  + '$USER = new KitFakeUser();\n'
  + 'if (getenv("FAKE_UTF") === "1") { define("BX_UTF", true); }\n'
  + 'if (getenv("FAKE_PRE") === "1") { echo "\\n"; }\n'
  + 'register_shutdown_function(function () { if (getenv("FAKE_KERNEL") === "1" && error_get_last()) { echo "[ядро]"; die(); } });\n';

// Собирает kit-exec.php из code в поддельный сайт и запускает его локальным PHP как страницу.
// query — то, что придёт в ?run= (по умолчанию — номер файла); null — параметра нет.
function page(v, code, { admin = true, utf = true, run = 'abc123', query = run, pre = false, kernel = false } = {}) {
  const site = writeFiles(tmpDir('kit-site-'), { 'bitrix/modules/main/include/prolog_before.php': PROLOG });
  const { php: body } = buildKitExec(code, { run });
  fs.writeFileSync(path.join(site, 'kit-exec.php'), body);
  const root = site.replace(/\\/g, '/');
  const get = query === null ? '' : "$_GET['run'] = '" + query + "';\n";
  fs.writeFileSync(path.join(site, 'run.php'), "<?php\n$_SERVER['DOCUMENT_ROOT'] = '" + root + "';\n" + get + "require '" + root + "/kit-exec.php';\n");
  const r = spawnPhp(v, ['-d', 'display_errors=0', path.join(site, 'run.php')], {
    env: { ...process.env, FAKE_ADMIN: admin ? '1' : '0', FAKE_UTF: utf ? '1' : '0', FAKE_PRE: pre ? '1' : '0', FAKE_KERNEL: kernel ? '1' : '0' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', site };
}

test('kitexec: номер запуска — латиница и цифры, 4–32 знака', () => {
  for (const run of ['', 'abc', 'a b c d', 'abc-123', 'x'.repeat(33), undefined, 'абвг']) {
    assert.throws(() => buildKitExec('echo 1;', { run }), /номер запуска/, String(run));
  }
  assert.doesNotThrow(() => buildKitExec('echo 1;', { run: 'a1B2' }));
  assert.doesNotThrow(() => buildKitExec('echo 1;', { run: 'x'.repeat(32) }));
});

test('kitexec: права проверяются до кода задачи, без NOT_CHECK_PERMISSIONS, ничего не читает из запроса', () => {
  const marker = 'echo "МЕТКА-КОДА";';
  const { php: body } = buildKitExec(marker, { run: 'abc123' });
  assert.ok(body.indexOf('IsAdmin()') > 0 && body.indexOf('IsAdmin()') < body.indexOf('МЕТКА-КОДА'), 'IsAdmin раньше кода');
  assert.ok(body.indexOf('prolog_before.php') < body.indexOf('IsAdmin()'));
  assert.ok(body.indexOf('headers_sent()') > body.indexOf('prolog_before.php') && body.indexOf('headers_sent()') < body.indexOf("header('Content-Type"), 'заголовки проверяются после ядра и до своих header()');
  assert.ok(body.indexOf('register_shutdown_function') < body.indexOf('prolog_before.php'), 'своя shutdown-функция — раньше ядра: та гасит скрипт через die()');
  for (const bad of ['NOT_CHECK_PERMISSIONS', '$_POST', '$_REQUEST', '$_FILES', '$_COOKIE', 'php://input', 'eval(', 'file_put_contents', 'unlink']) {
    assert.ok(!body.includes(bad), 'в файле-канале не должно быть ' + bad);
  }
  // Из запроса читается одно: ?run= — и только чтобы сверить с номером этого файла.
  assert.deepEqual(body.match(/\$_GET\[[^\]]*\]/g), ["$_GET['run']", "$_GET['run']"]);
  assert.ok(body.indexOf('IsAdmin()') < body.indexOf("$_GET['run']"), 'сначала права, потом номер запуска');
  assert.ok(body.indexOf("$_GET['run']") < body.indexOf('МЕТКА-КОДА'), 'номер запуска проверяется до кода задачи');
  assert.match(body, /header\('Content-Type: text\/plain; charset=utf-8'\)/);
  assert.match(body, /header\('Cache-Control: no-store'\)/);
  assert.match(body, /header\('X-Robots-Tag: noindex'\)/);
  assert.match(body, /header\('X-Content-Type-Options: nosniff'\)/);
  assert.match(body, /http_response_code\(403\)/);
  assert.match(body, /echo 'KIT-RUN abc123' \. "\\n";/);
  assert.ok(body.startsWith('<?php\n'));
  assert.ok(!body.includes('\r'), 'переводы строк LF');
});

test('kitexec: ведущий <?php и BOM отрезаются; shift = число строк приставки минус съеденные', () => {
  const plain = buildKitExec('echo 1;\n', { run: 'abc123' });
  const withTag = buildKitExec('\uFEFF<?php\necho 1;\n', { run: 'abc123' });
  assert.equal(plain.shift, plain.prefixLines);
  assert.equal(withTag.shift, withTag.prefixLines - 1);
  assert.equal(withTag.prefixLines, plain.prefixLines);
  for (const b of [plain, withTag]) {
    assert.equal(b.php.split('\n').slice(b.prefixLines)[0], 'echo 1;', 'код начинается сразу после приставки');
    assert.ok(b.php.includes('($e[\'line\'] - ' + b.shift + ')'), 'сдвиг вписан в приставку');
    assert.ok(b.php.includes('($kitError->getLine() - ' + b.shift + ')'), 'сдвиг вписан в обработчик ошибок');
  }
  const noNl = buildKitExec('echo 1;', { run: 'abc123' }).php;
  assert.ok(noNl.includes('echo 1;\n} catch'), 'после кода без \\n — перевод строки, затем хвост try/catch');
  assert.ok(buildKitExec('echo 1;\n?>\n', { run: 'abc123' }).php.includes('echo 1;\n} catch'), 'завершающий ?> отрезается: иначе хвост стал бы текстом');
});

for (const v of ['7.2', '7.4', '8.3']) {
  test(`kitexec: собранный файл и библиотечные скрипты проходят php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    const dir = path.join(PLUGIN, 'skills', 'server', 'scripts');
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const { php: body } = buildKitExec(fs.readFileSync(path.join(dir, name), 'utf8'), { run: 'abc123' });
      const r = phpLint(v, body);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
    assert.equal(phpLint(v, buildKitExec('', { run: 'abc123' }).php).code, 0, 'пустой код');
  });
}

test('страница: администратор — KIT-RUN первой строкой, потом вывод кода без <pre>', { skip }, () => {
  const r = page('7.4', 'echo "<pre>привет\\n</pre>";\n');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'KIT-RUN abc123\nпривет\n');
});

test('страница: не администратор — одна строка, код не выполняется', { skip }, () => {
  const r = page('7.4', 'echo "СЕКРЕТ"; file_put_contents(__DIR__ . "/след.txt", "1");\n', { admin: false });
  assert.equal(r.out, 'kit: только для администратора');
  assert.ok(!r.out.includes('KIT-RUN') && !r.out.includes('СЕКРЕТ'));
  assert.ok(!fs.existsSync(path.join(r.site, 'след.txt')), 'код задачи не выполнялся');
});

test('страница: чужой или пустой ?run= — файл называет свой номер и код не выполняет (старый файл не повторит запуск)', { skip }, () => {
  for (const query of ['zzz999', '', 'ABC123', 'abc123 ', null]) {
    const r = page('7.4', 'echo "СЕКРЕТ"; file_put_contents(__DIR__ . "/след.txt", "1");\n', { query });
    assert.match(r.out, /^KIT-RUN abc123\nkit: код не выполнялся — нужен адрес \/kit-exec\.php\?run=abc123\n$/, JSON.stringify(query));
    assert.ok(!r.out.includes('СЕКРЕТ') && !fs.existsSync(path.join(r.site, 'след.txt')), 'код не выполнялся: ' + JSON.stringify(query));
  }
  const ok = page('7.4', 'echo "СЕКРЕТ";\n');
  assert.equal(ok.out, 'KIT-RUN abc123\nСЕКРЕТ');
});

test('страница: исключение — текст и строка файла с кодом (с <?php и без)', { skip }, () => {
  const a = page('7.4', 'echo "до\\n";\nthrow new Exception("сломалось");\n');
  assert.equal(a.out, 'KIT-RUN abc123\nдо\n\nОшибка: сломалось (строка 2 кода)\n');
  const b = page('7.4', '<?php\necho "до\\n";\n\nthrow new Exception("сломалось");\n');
  assert.match(b.out, /Ошибка: сломалось \(строка 4 кода\)/);
});

test('страница: фатальная ошибка — текст и строка кода, вывод до неё остаётся', { skip }, () => {
  const r = page('7.4', 'echo "до\\n";\n\ntrigger_error("бум", E_USER_ERROR);\n');
  assert.match(r.out, /^KIT-RUN abc123\nдо\n/);
  assert.match(r.out, /Фатальная ошибка: бум \(строка 3 кода\)/);
});

test('страница: ядро гасит скрипт в своей shutdown-функции (die) — фатальная ошибка задачи всё равно названа, до вывода ядра', { skip }, () => {
  const r = page('7.4', 'echo "до\\n";\n\ntrigger_error("бум", E_USER_ERROR);\n', { kernel: true });
  assert.match(r.out, /^KIT-RUN abc123\nдо\n\nФатальная ошибка: бум \(строка 3 кода\)\n\[ядро\]$/);
});

test('страница: пролог уже что-то вывел (заголовки ушли) — код не выполняется ни у гостя, ни у администратора; сказано почему', { skip }, () => {
  for (const admin of [true, false]) {
    const r = page('7.4', 'echo "СЕКРЕТ"; file_put_contents(__DIR__ . "/след.txt", "1");\n', { admin, pre: true });
    assert.match(r.out, /^\nkit: headers already sent - kit-exec\.php does not work on this site, use SSH$/, 'admin=' + admin);
    assert.ok(!r.out.includes('KIT-RUN') && !r.out.includes('СЕКРЕТ') && !fs.existsSync(path.join(r.site, 'след.txt')));
  }
});

test('страница: функции и классы, объявленные до вызова, работают; завершающий ?> допустим', { skip }, () => {
  const a = page('7.4', 'function hello() { return "привет "; }\nclass Box { public $v = "класс"; }\necho hello() . (new Box)->v;\n?>\n');
  assert.equal(a.out, 'KIT-RUN abc123\nпривет класс');
});

test('страница: сайт не в UTF-8 — вывод из windows-1251 в UTF-8; в UTF-8 — без перекодировки', { skip }, (t) => {
  const mb = spawnPhp('7.4', ['-r', 'echo extension_loaded("mbstring") ? "да" : "нет";']).stdout;
  if (mb !== 'да') {
    t.skip('в PHP 7.4 нет mbstring');
    return;
  }
  const cp = page('7.4', 'echo "\\xE0\\xE1";\n', { utf: false });
  assert.equal(cp.out, 'KIT-RUN abc123\nаб');
  const utf = page('7.4', 'echo "аб";\n', { utf: true });
  assert.equal(utf.out, 'KIT-RUN abc123\nаб');
  // Собственные сообщения файла — тоже читаемы: их кириллица приводится к кодировке сайта до перекодировки буфера.
  const err = page('7.4', 'echo "\\xE0";\nthrow new Exception("boom");\n', { utf: false });
  assert.equal(err.out, 'KIT-RUN abc123\nа\nОшибка: boom (строка 2 кода)\n');
  const fatal = page('7.4', 'trigger_error("boom", E_USER_ERROR);\n', { utf: false });
  assert.match(fatal.out, /\nФатальная ошибка: boom \(строка 1 кода\)\n$/);
});

test('kit-exec.js: сборка по параметрам проекта — файл, адрес, номер запуска; php -l', { skip }, () => {
  const p = makeProject({
    'a.php': 'echo "привет";\n',
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru/', '- Дев: https://dev.x.ru', '- PHP: ' + php('7.4')]),
  });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Адрес: https:\/\/x\.ru\/kit-exec\.php\?run=abc123$/m);
  assert.match(r.stdout, /номер запуска abc123/);
  assert.match(fs.readFileSync(out, 'utf8'), /KIT-RUN abc123/);
  const dev = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out, '--env', 'дев'], cwd: p });
  assert.match(dev.stdout, /^Адрес: https:\/\/dev\.x\.ru\/kit-exec\.php\?run=abc123$/m);
});

test('kit-exec.js: ошибка в коде — код 1, строка файла с кодом, файл не пишется', { skip }, () => {
  const p = makeProject({
    'a.php': 'echo 1;\necho 1 +;\n',
    '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: ' + php('7.4')]),
  });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a\.php on line 2/);
  assert.doesNotMatch(r.stderr, /Standard input code/);
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: не Битрикс или нет адреса — код 2; аргументы, файл, номер запуска — код 4', () => {
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const common = { 'a.php': 'echo 1;\n' };
  const general = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: общий', '- Прод: https://x.ru']) });
  const g = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: general });
  assert.equal(g.code, 2);
  assert.match(g.stderr, /только для сайтов на 1С-Битрикс/);
  assert.match(g.stderr, /включить SSH/);
  const noUrl = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: —']) });
  const n = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: noUrl });
  assert.equal(n.code, 2);
  assert.match(n.stderr, /нет адреса сервера/);
  const bitrix = makeProject({ ...common, '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru']) });
  for (const args of [[], ['a.php'], ['a.php', '--run', 'abc123'], ['a.php', '--run', 'мало', '--out', out],
    ['a.php', '--run', 'abc123', '--out', out, '--нет'], ['a.php', 'b.php', '--run', 'abc123', '--out', out],
    ['a.php', '--run', 'abc123', '--out', out, '--env', 'тест'], ['нет.php', '--run', 'abc123', '--out', out]]) {
    const r = runScript('kit-exec.js', { args, cwd: bitrix });
    assert.equal(r.code, 4, JSON.stringify(args) + ': ' + r.stderr);
  }
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: без php -l файл не собирается — нет параметра «PHP» или php не запускается: код 4, файл не пишется', () => {
  const noPhp = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: —']) });
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: noPhp });
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /php -l/);
  assert.match(r.stderr, /файл не собираю/);
  assert.ok(!fs.existsSync(out));
  // php по пути есть, но -l не поддерживает (здесь — node): это не «ошибка в коде», код 1 занимать нельзя.
  const notPhp = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru']) });
  const n = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out, '--php', process.execPath], cwd: notPhp });
  assert.equal(n.code, 4, n.stderr);
  assert.match(n.stderr, /php -l не удалось выполнить/);
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: файл с кодом не в UTF-8 — код 4, а не молчаливая порча кириллицы', () => {
  const p = makeProject({ '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: —']) });
  const task = path.join(p, 'cp1251.php');
  fs.writeFileSync(task, Buffer.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0x22, 0xE0, 0xE1, 0x22, 0x3B, 0x0A]));
  const out = path.join(tmpDir('kit-out-'), 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['cp1251.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /не в UTF-8/);
  assert.ok(!fs.existsSync(out));
});

test('kit-exec.js: не удалось записать --out (нет папки) — код 4, не «внутренняя ошибка»', { skip }, () => {
  const p = makeProject({ 'a.php': 'echo 1;\n', '.claude/CLAUDE.md': params(['- Режим: bitrix', '- Прод: https://x.ru', '- PHP: ' + php('7.4')]) });
  const out = path.join(tmpDir('kit-out-'), 'нет-такой-папки', 'kit-exec.php');
  const r = runScript('kit-exec.js', { args: ['a.php', '--run', 'abc123', '--out', out], cwd: p });
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /не удалось записать/);
});
