'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('marketplace.json и plugin.json согласованы', () => {
  const mp = readJson('.claude-plugin/marketplace.json');
  const pl = readJson('plugins/kit/.claude-plugin/plugin.json');
  assert.equal(mp.name, 'claude-kit');
  assert.equal(mp.plugins.length, 1);
  assert.equal(mp.plugins[0].name, 'kit');
  assert.equal(mp.plugins[0].source, './plugins/kit');
  assert.equal(pl.name, 'kit');
  assert.match(pl.version, /^\d+\.\d+\.\d+$/);
  assert.equal(mp.plugins[0].version, pl.version);
});

test('мажорный выпуск: в README раздел «Переход на N.0», обзор собран по этой мажорной версии и без удалённого (3.0.0)', () => {
  const major = readJson('plugins/kit/.claude-plugin/plugin.json').version.split('.')[0];
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, new RegExp('^## Переход (с \\S+ )?на ' + major + '\\.0', 'm'), 'README: раздел о переходе на ' + major + '.0');
  const overview = fs.readFileSync(path.join(ROOT, '.claude', 'docs', 'work', 'overview', 'overview.md'), 'utf8');
  assert.match(overview, new RegExp('`plugins/kit` версии ' + major + '\\.\\d+\\.\\d+'), 'обзор пересобран по версии ' + major + '.x');
  for (const gone of ['docs-keeper', '/kit:why', '/kit:deploy-list', 'deploy-list.js']) assert.ok(!overview.includes(gone), 'в обзоре осталось: ' + gone);
});
