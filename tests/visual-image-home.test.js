'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpDir, writeFiles } = require('./helpers');
const { diffPng } = require('../plugins/kit/scripts/lib/visual/image');
const home = require('../plugins/kit/scripts/lib/visual/home');

// pngjs и pixelmatch — devDependencies корня репозитория (npm ci в корне).
async function libs() {
  let PNG;
  let pixelmatch;
  try {
    ({ PNG } = require('pngjs'));
    pixelmatch = (await import('pixelmatch')).default;
  } catch (e) {
    assert.fail('нет pngjs/pixelmatch — выполните npm ci в корне репозитория: ' + e.message);
  }
  return { PNG, pixelmatch };
}

// Белая картинка w×h; dots — [[x, y, [r, g, b]]].
function png(PNG, w, h, dots = []) {
  const img = new PNG({ width: w, height: h });
  img.data.fill(255);
  for (const [x, y, [r, g, b]] of dots) {
    const i = (w * y + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
  }
  return PNG.sync.write(img);
}

test('diffPng: одинаковые — 0 %, один пиксель из 100 — 1 %, дифф — PNG того же размера', async () => {
  const L = await libs();
  const a = png(L.PNG, 10, 10);
  const same = diffPng(a, png(L.PNG, 10, 10), L);
  assert.equal(same.pct, 0);
  assert.equal(same.changed, 0);
  assert.equal(same.size, '10×10 → 10×10');
  const one = diffPng(a, png(L.PNG, 10, 10, [[3, 4, [0, 0, 0]]]), L);
  assert.equal(one.changed, 1);
  assert.equal(one.pct, 1);
  const d = L.PNG.sync.read(one.diff);
  assert.deepEqual([d.width, d.height], [10, 10]);
});

test('diffPng: разная высота — добивается белым, отличие — только в полосе снизу', async () => {
  const L = await libs();
  const a = png(L.PNG, 10, 10);
  const taller = png(L.PNG, 10, 12, [[0, 11, [0, 0, 0]], [5, 11, [0, 0, 0]]]);
  const r = diffPng(a, taller, L);
  assert.equal(r.size, '10×10 → 10×12');
  assert.equal(r.changed, 2);
  assert.equal(r.pct, +((100 * 2) / 120).toFixed(3));
  assert.equal(diffPng(a, png(L.PNG, 10, 12), L).pct, 0, 'белая добивка на белом фоне — не отличие');
});

test('homeDir и depsDir: KIT_VISUAL_HOME, LOCALAPPDATA, KIT_VISUAL_DEPS', () => {
  assert.equal(home.homeDir({ KIT_VISUAL_HOME: 'X:\\h' }), 'X:\\h');
  if (process.platform === 'win32') assert.equal(home.homeDir({ LOCALAPPDATA: 'C:\\L' }), path.join('C:\\L', 'kit', 'visual'));
  assert.equal(home.depsDir({ KIT_VISUAL_HOME: 'X:\\h' }), path.join('X:\\h', 'deps'));
  assert.equal(home.depsDir({ KIT_VISUAL_HOME: 'X:\\h', KIT_VISUAL_DEPS: 'Y:\\d' }), 'Y:\\d');
});

test('pinned: точные версии как в прототипе, совпадают с devDependencies корня', () => {
  assert.deepEqual(home.pinned(), { pixelmatch: '7.2.0', 'playwright-core': '1.63.0', pngjs: '7.0.0' });
  const dev = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies;
  assert.equal(dev.pixelmatch, home.pinned().pixelmatch);
  assert.equal(dev.pngjs, home.pinned().pngjs);
});

test('missingDeps и requireDeps: пусто — всё стоит; нет или другая версия — код 5 с командой установки', () => {
  const dir = tmpDir('kit-visual-deps-');
  assert.deepEqual(home.missingDeps(dir).map((m) => m.name), ['pixelmatch', 'playwright-core', 'pngjs']);
  writeFiles(dir, {
    'node_modules/pixelmatch/package.json': '{"version":"7.2.0"}',
    'node_modules/pngjs/package.json': '{"version":"6.0.0"}',
  });
  assert.deepEqual(home.missingDeps(dir, home.IMAGE_DEPS), [{ name: 'pngjs', want: '7.0.0', have: '6.0.0' }]);
  assert.throws(() => home.requireDeps(dir), (e) => e.code === 5 && /pngjs 7\.0\.0 \(стоит 6\.0\.0\)/.test(e.message)
    && /playwright-core 1\.63\.0/.test(e.message) && /node visual\.js install/.test(e.message));
  assert.deepEqual(home.missingDeps(ROOT, home.IMAGE_DEPS), [], 'в корне репозитория стоят devDependencies');
});

test('loadImageLibs: из папки с node_modules — PNG и pixelmatch (ESM)', async () => {
  const L = await home.loadImageLibs(ROOT);
  assert.equal(typeof L.PNG, 'function');
  assert.equal(typeof L.pixelmatch, 'function');
  await assert.rejects(home.loadImageLibs(tmpDir('kit-visual-empty-')), (e) => e.code === 5);
});

test('authFile: вне проекта, свой на проект и на хост', () => {
  const env = { KIT_VISUAL_HOME: 'X:\\h' };
  const a = home.authFile('C:\\OSPanel\\home\\beta.server', 'https://beta.example.com', env);
  assert.match(a, /^X:\\h[\\/]auth[\\/]beta\.server-[0-9a-f]{8}@beta\.example\.com\.json$/);
  assert.equal(home.authFile('c:/ospanel/home/beta.server/', 'https://beta.example.com/', env), a, 'регистр и слеши пути не важны');
  assert.notEqual(home.authFile('C:\\OSPanel\\home\\other.server', 'https://beta.example.com', env), a);
  assert.notEqual(home.authFile('C:\\OSPanel\\home\\beta.server', 'https://dev.beta.example.com', env), a);
  assert.match(home.authFile('C:\\p\\my site', 'http://localhost:8080', env), /my_site-[0-9a-f]{8}@localhost_8080\.json$/);
});
