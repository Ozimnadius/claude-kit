'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT, makeProject, runScript, hasPhp, php } = require('./helpers');
const { paramsMd } = require('./fixtures');

const skip = !hasPhp('7.4');
const project = (files) => makeProject({ '.claude/CLAUDE.md': paramsMd({ 'PHP': php('7.4') }), ...files });
const run = (dir, file, tool = 'Write') => runScript('php-lint.js', {
  input: { hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: path.join(dir, file) }, cwd: dir },
});

test('верный PHP — тишина', { skip }, () => {
  const dir = project({ 'a.php': '<?php\necho 1;\n' });
  const r = run(dir, 'a.php');
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('синтаксическая ошибка — код 2 и текст для Claude', { skip }, () => {
  const dir = project({ 'bad.php': '<?php\necho 1\necho 2;\n' });
  const r = run(dir, 'bad.php', 'Edit');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /php -l \(PHP 7\.4\)/);
  assert.match(r.stderr, /bad\.php/);
  assert.match(r.stderr, /line 3/);
});

test('синтаксис PHP 8 на PHP 7.4 — ошибка', { skip }, () => {
  const dir = project({ 'm.php': "<?php\n$x = match (1) { 1 => 'a', default => 'b' };\n" });
  assert.equal(run(dir, 'm.php').code, 2);
});

test('скрипт консоли без <?php: верный — тишина, ошибка — номер строки без приставки', { skip }, () => {
  const dir = project({
    '.claude/scripts/01-ok.php': "echo 'ok';\n",
    '.claude/scripts/02-bad.php': "echo 'a';\necho 'b'\necho 'c';\n",
  });
  assert.equal(run(dir, '.claude/scripts/01-ok.php').code, 0);
  const r = run(dir, '.claude/scripts/02-bad.php');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /02-bad\.php/);
  assert.match(r.stderr, /line 3/);
  assert.doesNotMatch(r.stderr, /Standard input code/);
});

test('HTML в .php вне папки скриптов — не ошибка', { skip }, () => {
  const dir = project({ 'include/area.php': '<p>Текст области</p>\n' });
  assert.equal(run(dir, 'include/area.php').code, 0);
});

test('параметр PHP — только абсолютный путь к существующему php.exe, иначе тишина', { skip }, () => {
  const bad = { 'bad.php': '<?php\necho 1\necho 2;\n' };
  // Относительный путь (от папки, где запускается хук) — не принимается, даже если файл существует.
  const rel = path.relative(ROOT, php('7.4'));
  assert.ok(!path.isAbsolute(rel));
  const relDir = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'PHP': rel }), ...bad });
  const r1 = run(relDir, 'bad.php');
  assert.equal(r1.code, 0, r1.stderr);
  assert.equal(r1.stderr + r1.stdout, '');
  // Абсолютный путь к существующему файлу, но не php.exe (node.exe) — не принимается.
  const nodeDir = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'PHP': process.execPath }), ...bad });
  const r2 = run(nodeDir, 'bad.php');
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(r2.stderr + r2.stdout, '');
  // Регистр имени не важен.
  const upper = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'PHP': php('7.4').replace(/php\.exe$/, 'PHP.EXE') }), ...bad });
  assert.equal(run(upper, 'bad.php').code, 2);
});

test('не PHP, нет параметра PHP, чужой проект — тишина', () => {
  const dir = project({ 'a.js': 'x(' });
  assert.equal(run(dir, 'a.js').code, 0);
  const noParam = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'bitrix' }), 'bad.php': '<?php echo' });
  assert.equal(run(noParam, 'bad.php').code, 0);
  const foreign = makeProject({ 'bad.php': '<?php echo' });
  assert.equal(run(foreign, 'bad.php').code, 0);
});

test('PHP завершился без сообщения об ошибке (упал) — не «ошибка синтаксиса» для Claude (К44)', () => {
  // Вместо PHP — node: на «-l» он выходит с кодом 9 и не пишет «error», как упавший PHP (0xC0000005).
  const { lint } = require('../plugins/kit/scripts/php-lint');
  const dir = makeProject({ 'a.php': '<?php\necho 1;\n' });
  assert.deepEqual(lint(process.execPath, path.join(dir, 'a.php')), { ok: true });
});
