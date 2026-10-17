'use strict';
// Плагин aspro (этап 37): манифест и запись маркетплейса согласованы с версией инструмента сверки; поставка полная и
// без лишних типов файлов; скил с корректным frontmatter. Содержимое skills/aspro-merge/ приходит скриптом выпуска
// лаборатории — тест проверяет форму поставки, а не работу инструмента (её проверяют тесты лаборатории; PHP здесь не нужен).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const PLUGIN = path.join(ROOT, 'plugins', 'aspro');
const SKILL = path.join(PLUGIN, 'skills', 'aspro-merge');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

test('aspro: plugin.json, запись маркетплейса и версия инструмента совпадают', () => {
  const pl = readJson(path.join(PLUGIN, '.claude-plugin', 'plugin.json'));
  const mp = readJson(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = mp.plugins.find((p) => p.name === 'aspro');
  assert.ok(entry, 'в marketplace.json нет записи aspro');
  assert.equal(entry.source, './plugins/aspro');
  assert.equal(pl.name, 'aspro');
  assert.match(pl.version, /^\d+\.\d+\.\d+$/);
  assert.equal(entry.version, pl.version, 'версия в marketplace.json');
  const tool = read('tool/lib/Tool.php').match(/const\s+VERSION\s*=\s*'([^']+)'/);
  const site = read('tool/integration/aspro_merge.php').match(/const\s+VERSION\s*=\s*'([^']+)'/);
  assert.ok(tool && site, 'нет константы VERSION в Tool.php или в файле подключения');
  assert.equal(tool[1], pl.version, 'AsproMerge\\Tool::VERSION');
  assert.equal(site[1], pl.version, 'AsproMergeSite::VERSION');
});

test('aspro: обязательные файлы поставки на месте', () => {
  for (const rel of [
    'SKILL.md', 'docs/GUIDE.md', 'docs/DESIGN.md',
    'tool/merge.php', 'tool/README.md', 'tool/config.example.php', 'tool/.htaccess',
    'tool/integration/aspro_merge.php', 'tool/lib/bootstrap.php', 'tool/lib/Tool.php', 'tool/lib/xmerge.php',
    'tool/lib/LICENSE-xmerge.md', 'tool/lib/LICENSE-LGPL-2.1.txt',
  ]) assert.ok(fs.existsSync(path.join(SKILL, rel)), 'нет ' + rel);
  assert.ok(!fs.existsSync(path.join(SKILL, 'tool', 'tests')), 'тесты лаборатории в поставку не входят');
});

test('aspro: лицензии — полный текст LGPL 2.1 и уведомление в движке слияния', () => {
  const lgpl = read('tool/lib/LICENSE-LGPL-2.1.txt');
  assert.match(lgpl, /GNU LESSER GENERAL PUBLIC LICENSE/);
  assert.match(lgpl, /Version 2\.1, February 1999/);
  assert.match(read('tool/lib/xmerge.php'), /SPDX-License-Identifier: LGPL-2\.1-or-later/);
  assert.match(readJson(path.join(PLUGIN, '.claude-plugin', 'plugin.json')).license, /LGPL-2\.1-or-later/);
});

test('aspro: в поставке только разрешённые типы файлов', () => {
  const bad = walk(PLUGIN).map((f) => path.relative(PLUGIN, f).split(path.sep).join('/'))
    .filter((rel) => !/(\.php|\.md|\.json|\.txt|(^|\/)\.htaccess)$/.test(rel));
  assert.deepEqual(bad, []);
});

test('aspro: SKILL.md — frontmatter с name и description', () => {
  const m = read('SKILL.md').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert.ok(m, 'нет frontmatter');
  assert.match(m[1], /^name: aspro-merge$/m);
  assert.match(m[1], /^description: \S/m);
});
