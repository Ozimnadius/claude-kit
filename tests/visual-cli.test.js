'use strict';
// visual.js целиком без браузера: compare, list, check-метки, коды 2/3/4/5 до запуска Chrome;
// shoot/check и browser.js — с поддельным playwright-core (fakeDeps).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, tmpDir, makeProject, writeFiles, runScript } = require('./helpers');
const { paramsMd } = require('./fixtures');

const { PNG } = require('pngjs');

// Поддельный playwright-core: браузер не запускается. Страница — EventEmitter (on/once/off); goto → статус 200;
// login.check (строка в evaluate) → exports.uid ('' — нет входа); innerText — постоянный текст; снимок — белый PNG 20×20;
// click по селектору с «missing» — ошибка. exports.contexts — параметры newContext, exports.pages — открытые страницы.
const FAKE_PW = `'use strict';
const fs = require('fs');
const { EventEmitter } = require('events');
const { PNG } = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'pngjs'))});
const ok = async () => {};
const locator = (sel) => {
  const l = { first: () => l, nth: () => l, hover: ok, fill: ok, waitFor: ok,
    click: async () => { if (String(sel).includes('missing')) throw new Error('нет элемента ' + sel); } };
  return l;
};
function newPage() {
  let at = 'about:blank';
  const page = Object.assign(new EventEmitter(), {
    goto: async (url) => { at = url; return { status: () => 200 }; },
    waitForLoadState: ok, addStyleTag: ok, waitForTimeout: ok,
    evaluate: async (fn) => (typeof fn === 'string' ? module.exports.uid : String(fn).includes('innerText') ? 'Главная\\nКорзина (3)' : undefined),
    url: () => at,
    title: async () => 'Главная',
    locator, getByText: locator,
    screenshot: async ({ path }) => {
      const img = new PNG({ width: 20, height: 20 });
      img.data.fill(255);
      fs.writeFileSync(path, PNG.sync.write(img));
    },
  });
  module.exports.pages.push(page);
  return page;
}
module.exports = {
  uid: '', contexts: [], pages: [],
  devices: { 'iPhone 13': {} },
  chromium: {
    launch: async () => ({
      isConnected: () => true,
      close: ok,
      newContext: async (opts) => {
        module.exports.contexts.push(opts);
        const own = [];
        return {
          newPage: async () => { const p = newPage(); own.push(p); return p; },
          pages: () => own,
          storageState: async ({ path }) => fs.writeFileSync(path, '{}'),
          close: ok,
        };
      },
    }),
  },
};
`;

// Папка для KIT_VISUAL_DEPS: pngjs и pixelmatch — переходники к node_modules репозитория, playwright-core — pwSource.
function fakeDeps(pwSource = FAKE_PW) {
  const pixelmatch = pathToFileURL(path.join(ROOT, 'node_modules', 'pixelmatch', 'index.js')).href;
  return writeFiles(tmpDir('kit-visual-deps-'), {
    'node_modules/pngjs/package.json': '{"version":"7.0.0","main":"index.js"}',
    'node_modules/pngjs/index.js': `module.exports = require(${JSON.stringify(path.join(ROOT, 'node_modules', 'pngjs'))});`,
    'node_modules/pixelmatch/package.json': '{"version":"7.2.0","type":"module","main":"index.js"}',
    'node_modules/pixelmatch/index.js': `export { default } from ${JSON.stringify(pixelmatch)};`,
    'node_modules/playwright-core/package.json': '{"name":"playwright-core","version":"1.63.0","main":"index.js"}',
    'node_modules/playwright-core/index.js': pwSource,
  });
}
const fakeEnv = (pwSource) => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-'), KIT_VISUAL_DEPS: fakeDeps(pwSource) });

// Новая раскладка (с 2.3.0): снимки — в .claude/docs/visual; .claude — в «Не выкладывать».
const VIS = ['.claude', 'docs', 'visual'];
const PARAMS = { 'Режим': 'bitrix', 'Прод': 'https://beta.example.com', 'Не выкладывать': '.idea, .git, .claude' };
const PAGES = { contexts: { guest: { pages: [{ name: 'home', url: '/' }] }, admin: { auth: true, pages: [{ name: 'order', url: '/order/' }] } } };

function png(w, h, dots = []) {
  const img = new PNG({ width: w, height: h });
  img.data.fill(255);
  for (const [x, y] of dots) img.data.fill(0, (w * y + x) * 4, (w * y + x) * 4 + 3);
  return PNG.sync.write(img);
}

const rec = (ctx, vp, name, over = {}) => ({ ctx, vp, name, url: '/' + name + '/', status: 200, final: '/' + name + '/', title: name, uid: ctx === 'admin' ? '1' : '', errors: [], bad: [], failed: [], ...over });

// Проект с параметрами и метками; label: { meta?, files: { 'ctx/vp/name': { png, txt } } }.
function project({ labels = {}, pages = PAGES, params = PARAMS, extra = {} } = {}) {
  const files = { '.claude/CLAUDE.md': paramsMd(params), '.claude/scripts/visual/pages.json': JSON.stringify(pages), ...extra };
  const dir = makeProject(files);
  for (const [label, l] of Object.entries(labels)) {
    for (const [key, f] of Object.entries(l.files || {})) {
      const base = path.join(dir, ...VIS, label, key);
      fs.mkdirSync(path.dirname(base), { recursive: true });
      if (f.png) fs.writeFileSync(base + '.png', f.png);
      if (f.txt !== undefined) fs.writeFileSync(base + '.txt', f.txt);
    }
    if (l.meta) fs.writeFileSync(path.join(dir, ...VIS, label, 'meta.json'), JSON.stringify(l.meta));
  }
  return dir;
}

// Зависимости сравнения — из корня репозитория (devDependencies); <дом> — пустая временная папка.
const ENV = () => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-'), KIT_VISUAL_DEPS: ROOT });
const visual = (dir, args, env = ENV()) => runScript('visual.js', { args, cwd: dir, env });

const BEFORE = {
  meta: { base: 'https://beta.example.com', date: '2026-09-25T09:00:00Z', full: true, pages: [rec('guest', 'desktop', 'home'), rec('admin', 'desktop', 'order')] },
  files: { 'guest/desktop/home': { png: png(20, 20), txt: 'Главная\nКорзина (3)' }, 'admin/desktop/order': { png: png(20, 20), txt: 'Оформление' } },
};

test('compare: одинаковые метки — код 0, «совпадает», отчёт и summary.json', () => {
  const dir = project({ labels: { before: BEFORE, after: BEFORE } });
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Итого: совпадает 2, в пределах шума 0, отличается 0, не снято 0 \(из 2\)/);
  assert.match(r.stdout, /Шум не измерен: node visual\.js check before/);
  const out = path.join(dir, ...VIS, 'compare-before-vs-after');
  assert.ok(fs.existsSync(path.join(out, 'report.html')));
  assert.ok(fs.existsSync(path.join(out, 'guest', 'desktop', 'home.png')), 'дифф-картинка');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).counts.same, 2);
});

test('compare: пиксели, текст, статус 500 и новый ответ ≥400 — код 1, статусы первыми', () => {
  const after = {
    meta: { ...BEFORE.meta, date: '2026-09-25T12:00:00Z', pages: [rec('guest', 'desktop', 'home'),
      rec('admin', 'desktop', 'order', { status: 500, bad: [{ status: 500, url: '/order/ajax.php?x=1', type: 'xhr' }] })] },
    files: { 'guest/desktop/home': { png: png(20, 20, [[1, 1], [2, 2]]), txt: 'Главная\nКорзина (0)' }, 'admin/desktop/order': { png: png(20, 20), txt: 'Оформление' } },
  };
  const dir = project({ labels: { before: BEFORE, after } });
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.indexOf('Статусы и ошибки:') < r.stdout.indexOf('Отличается:'));
  assert.match(r.stdout, /admin\/desktop\/order {2}статус 200 → 500; ответ: \+ 500 \/order\/ajax\.php/);
  assert.match(r.stdout, /0\.5% {2}guest\/desktop\/home {2}текст −1\/\+1/);
  const html = fs.readFileSync(path.join(dir, ...VIS, 'compare-before-vs-after', 'report.html'), 'utf8');
  assert.ok(html.includes('Корзина (3)') && html.includes('Корзина (0)'));
});

test('compare: шум из noise.json — «в пределах шума», код 0', () => {
  const after = { meta: BEFORE.meta, files: { ...BEFORE.files, 'guest/desktop/home': { png: png(20, 20, [[1, 1]]), txt: 'Главная\nКорзина (4)' } } };
  const dir = project({ labels: { before: BEFORE, after } });
  fs.writeFileSync(path.join(dir, ...VIS, 'before', 'noise.json'), JSON.stringify({ runs: 1, snapshots: {
    'guest/desktop/home': { pct: 0.5, removed: ['Корзина (3)'], added: ['Корзина (4)'], errors: [], net: [] } } }));
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /В пределах шума:\n {5}0\.25% {2}\(шум 0\.5%\) {2}guest\/desktop\/home/);
  assert.doesNotMatch(r.stdout, /Шум не измерен/);
});

test('compare: полный «после» без снимка — «не снято» (код 1); частичный — «не снимали» (код 0); сбой снимка — «не снято» с причиной', () => {
  const partial = { meta: { ...BEFORE.meta, full: false, pages: [rec('guest', 'desktop', 'home')] }, files: { 'guest/desktop/home': BEFORE.files['guest/desktop/home'] } };
  const full = { ...partial, meta: { ...partial.meta, full: true } };
  const failed = { meta: { ...partial.meta, pages: [rec('guest', 'desktop', 'home'), { ...rec('admin', 'desktop', 'order'), fail: 'Timeout 60000ms' }] },
    files: { ...BEFORE.files } };
  const dir = project({ labels: { before: BEFORE, partial, full, failed } });
  const p = visual(dir, ['compare', 'before', 'partial']);
  assert.equal(p.code, 0);
  assert.match(p.stdout, /не снимали 1/);
  const f = visual(dir, ['compare', 'before', 'full']);
  assert.equal(f.code, 1);
  assert.match(f.stdout, /Не снято:\n {2}admin\/desktop\/order {2}нет снимка «после»/);
  const x = visual(dir, ['compare', 'before', 'failed']);
  assert.equal(x.code, 1);
  assert.match(x.stdout, /admin\/desktop\/order {2}Timeout 60000ms/, 'устаревший снимок при сбое не сравнивается');
});

test('compare: метка прототипа (meta без сети и без full) сравнивается с новой', () => {
  const proto = { meta: { base: 'https://beta.example.com', date: 'd', pages: BEFORE.meta.pages.map(({ bad, failed, ...r }) => r) }, files: BEFORE.files };
  const dir = project({ labels: { 'proto-now': proto, 'kit-now': BEFORE } });
  const r = visual(dir, ['compare', 'proto-now', 'kit-now']);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /совпадает 2/);
});

test('compare: нет метки или одной метки — код 2', () => {
  const dir = project({ labels: { before: BEFORE } });
  assert.equal(visual(dir, ['compare', 'before']).code, 2);
  const r = visual(dir, ['compare', 'before', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /нет метки nope/);
});

test('list: метки и сравнения', () => {
  const dir = project({ labels: { before: BEFORE, after: BEFORE } });
  visual(dir, ['compare', 'before', 'after']);
  const r = visual(dir, ['list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /метка {2}before {2}2026-09-25 09:00 {2}снимков 2 {2}полный {2}https:\/\/beta\.example\.com/);
  assert.match(r.stdout, /сравнение {2}compare-before-vs-after {2}совпадает 2/);
});

test('shoot: опасный адрес, опечатка, неверная или зарезервированная метка, нет адреса — код 2 до браузера', () => {
  const bad = { contexts: { guest: { pages: [{ name: 'cancel', url: '/personal/cancel/1/?CANCEL=Y' }] } } };
  let r = visual(project({ pages: bad }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /опасный адрес .*отмена заказа/);
  r = visual(project({ pages: { contexts: { guest: { pages: [{ name: 'home', url: '/', fullpage: false }] } } } }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /неизвестный ключ .*fullpage/);
  for (const l of ['before-check', 'compare-x', '../x']) assert.equal(visual(project(), ['shoot', l]).code, 2, l);
  assert.equal(visual(project(), ['shoot']).code, 2);
  r = visual(project({ params: { 'Режим': 'bitrix' } }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /«Прод»/);
  assert.equal(visual(project(), ['shoot', 'before', '--only', 'nope']).code, 2);
  assert.equal(visual(project(), ['frobnicate']).code, 2);
});

test('shoot: автозаливка PhpStorm без исключения .claude — код 4, папка снимков не создана', () => {
  const xml = '<project><component name="PublishConfigData" autoUpload="Always" serverName="ftp"><serverData><paths name="ftp"><serverdata>'
    + '<mappings><mapping deploy="/" local="$PROJECT_DIR$" web="/" /></mappings><excludedPaths>'
    + '<excludedPath local="true" path="$PROJECT_DIR$/.idea" /></excludedPaths></serverdata></paths></serverData></component></project>';
  const dir = project({ extra: { '.idea/deployment.xml': xml } });
  const r = visual(dir, ['shoot', 'before']);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /Excluded Paths/);
  assert.ok(!fs.existsSync(path.join(dir, ...VIS)));
});

test('shoot: исключена .claude (предок папки снимков) — не код 4; старая раскладка — снимки в docs/visual', () => {
  const xml = '<project><component name="PublishConfigData" autoUpload="Always" serverName="ftp"><serverData><paths name="ftp"><serverdata><excludedPaths>'
    + '<excludedPath local="true" path="$PROJECT_DIR$/.claude" /></excludedPaths></serverdata></paths></serverData></component></project>';
  const home = () => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-') });
  const r = visual(project({ extra: { '.idea/deployment.xml': xml } }), ['shoot', 'before'], home());
  assert.equal(r.code, 5, r.stdout + r.stderr);
  const old = project({ extra: { 'docs/progress.md': '# журнал\n' } });
  const r2 = visual(old, ['shoot', 'before'], home());
  assert.equal(r2.code, 5, r2.stdout + r2.stderr);
  assert.match(r2.stdout, /Создан docs\/visual\/\.gitignore/);
  assert.match(r2.stdout, /нет docs\/visual/, '«Не выкладывать» без docs — предупреждение');
  assert.ok(fs.existsSync(path.join(old, 'docs', 'visual', '.gitignore')));
  assert.ok(!fs.existsSync(path.join(old, ...VIS)));
});

test('shoot без зависимостей — код 5 с командой установки; .gitignore в папке снимков уже создан', () => {
  const dir = project();
  const r = visual(dir, ['shoot', 'before'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-') });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /playwright-core 1\.63\.0/);
  assert.match(r.stderr, /node visual\.js install/);
  assert.ok(fs.existsSync(path.join(dir, ...VIS, '.gitignore')));
});

test('shoot без сессии для контекста с auth — код 3 (зависимости есть)', () => {
  const r = visual(project(), ['shoot', 'before'], fakeEnv('module.exports = {};'));
  assert.equal(r.code, 3);
  assert.match(r.stderr, /нет сессии входа .*node visual\.js login/);
});

test('shoot: ошибка группы (не в цикле страниц) не роняет весь прогон — meta.json пишется, старый снимок группы удалён', () => {
  const broken = "module.exports = { devices: { 'iPhone 13': {} }, chromium: { launch: async () => ({ newContext: async () => { throw new Error('битая сессия'); }, close: async () => {} }) } };";
  const dir = project({
    pages: { contexts: { guest: { pages: [{ name: 'home', url: '/' }] } } },
    labels: { before: { files: { 'guest/desktop/home': { png: png(20, 20), txt: 'Старое' } } } },
  });
  const r = visual(dir, ['shoot', 'before'], fakeEnv(broken));
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /ERR guest\/desktop {2}группа guest\/desktop: битая сессия/);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, ...VIS, 'before', 'meta.json'), 'utf8'));
  const byKey = Object.fromEntries(meta.pages.map((p) => [`${p.ctx}/${p.vp}/${p.name}`, p]));
  assert.match(byKey['guest/desktop/home'].fail, /битая сессия/);
  assert.match(byKey['guest/mobile/home'].fail, /битая сессия/);
  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before', 'guest', 'desktop', 'home.png')));
  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before', 'guest', 'desktop', 'home.txt')));
});

test('shoot: метка снята с другого адреса — код 2 до защиты выкладки, папка снимков не тронута', () => {
  const dir = project({ labels: { before: BEFORE } });
  const vis = path.join(dir, ...VIS);
  const r = visual(dir, ['shoot', 'before', '--url', 'https://other.example']);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /метка before снята с https:\/\/beta\.example\.com; для другого адреса — другая метка/);
  assert.deepEqual(fs.readdirSync(vis), ['before']);
  assert.deepEqual(fs.readdirSync(path.join(vis, 'before')).sort(), ['admin', 'guest', 'meta.json']);
});

test('check: --url не тот, с которого снята метка, — код 2 до браузера; тот же адрес — дальше (код 5: нет playwright)', () => {
  const dir = project({ labels: { before: BEFORE } });
  const r = visual(dir, ['check', 'before', '--url', 'https://other.example']);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /метка before снята с https:\/\/beta\.example\.com, а адрес сейчас https:\/\/other\.example — контрольный прогон должен быть с того же адреса/);
  assert.ok(!fs.existsSync(path.join(dir, ...VIS, 'before-check')));
  assert.equal(visual(dir, ['check', 'before', '--url', 'https://beta.example.com/']).code, 5);
});

test('check: сквозной прогон с поддельным браузером — адрес метки, <метка>-check с нуля, noise.json', () => {
  const dir = project({ pages: { contexts: { guest: { pages: [{ name: 'home', url: '/' }] } } } });
  const vis = path.join(dir, ...VIS);
  const readMeta = (label, file = 'meta.json') => JSON.parse(fs.readFileSync(path.join(vis, label, file), 'utf8'));
  const env = fakeEnv();
  let r = visual(dir, ['shoot', 'before', '--url', 'https://dev.beta.test'], env);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(readMeta('before').base, 'https://dev.beta.test');
  assert.equal(readMeta('before').env, null, 'адрес из --url, не из параметров');
  writeFiles(vis, { 'before-check/guest/desktop/old.png': png(20, 20) });
  r = visual(dir, ['check', 'before'], env);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Контрольный прогон before-check: совпали на 0 % — 2 из 2/);
  assert.equal(readMeta('before', 'noise.json').runs, 1);
  assert.equal(readMeta('before-check').base, 'https://dev.beta.test', 'контрольный прогон — с адреса метки, не с «Прод»');
  assert.ok(!fs.existsSync(path.join(vis, 'before-check', 'guest', 'desktop', 'old.png')), 'before-check удалена перед прогоном');
});

// browser.js в процессе теста с тем же поддельным playwright-core.
const browserLib = () => require('../plugins/kit/scripts/lib/visual/browser');
const fakePw = () => require(path.join(fakeDeps(), 'node_modules', 'playwright-core'));

test('browser: clickAccept, клик которого не удался, снимает обработчик окна dialog', async () => {
  const pw = fakePw();
  const ctx = { name: 'guest', auth: false, hide: [], mask: [], teardown: [],
    setup: [{ clickAccept: '#missing-optional', optional: true }, { clickAccept: '#missing' }] };
  const group = { ctx, vp: 'desktop', pages: [{ name: 'home', url: '/', actions: [], fullPage: true, hide: [], mask: [] }] };
  const cfg = { login: { check: null }, hide: [], mask: [] };
  const res = await browserLib().shoot({ pw, base: 'https://site.test', cfg, groups: [group], outDir: tmpDir('kit-visual-out-'), authFile: null, noSetup: false, log: () => {} });
  assert.match(res.setup['guest/desktop'], /нет элемента #missing/);
  assert.equal(res.pages.filter((p) => !p.fail).length, 1);
  assert.equal(pw.pages[0].listenerCount('dialog'), 0, 'обработчик dialog не должен оставаться после неудачного клика');
});

test('browser: login — контекст с ignoreHTTPSErrors (дев с самоподписанным сертификатом)', async () => {
  const pw = fakePw();
  pw.uid = '7';
  const file = path.join(tmpDir('kit-visual-home-'), 'auth', 'site.json');
  const uid = await browserLib().login({ pw, base: 'https://dev.site.test', loginCfg: { url: '/auth/', check: 'x' }, file, log: () => {} });
  assert.equal(uid, '7');
  assert.ok(fs.existsSync(file));
  assert.equal(pw.contexts[0].ignoreHTTPSErrors, true);
});

test('deps: пусто — 5; check без эталона — 2; discover с опасной затравкой — 2', () => {
  const dir = project();
  assert.equal(visual(dir, ['deps'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-') }).code, 5);
  const c = visual(dir, ['check', 'before']);
  assert.equal(c.code, 2);
  assert.match(c.stderr, /сначала shoot before/);
  const d = visual(dir, ['discover', 'C:/Program Files/Git/auth/', '/personal/cancel/1/']);
  assert.equal(d.code, 2);
  assert.match(d.stderr, /\/personal\/cancel\/1\/: опасный/);
});
