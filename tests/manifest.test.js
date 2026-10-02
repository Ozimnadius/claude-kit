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
