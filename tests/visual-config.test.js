'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject } = require('./helpers');
const { makeParams } = require('../plugins/kit/scripts/lib/params');
const {
  CONFIG_REL, BITRIX_CHECK, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups,
} = require('../plugins/kit/scripts/lib/visual/config');

const BETA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'visual-pages-beta.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const code2 = (re) => (e) => e.code === 2 && re.test(e.message);
const minimal = (extra = {}) => ({ contexts: { guest: { pages: [{ name: 'home', url: '/' }] } }, ...extra });

test('pages.json прототипа beta проходит проверку без правок', () => {
  const cfg = validateConfig(BETA, 'bitrix');
  assert.deepEqual(cfg.contexts.map((c) => c.name), ['guest', 'admin']);
  const admin = cfg.contexts[1];
  assert.equal(admin.auth, true);
  assert.deepEqual(admin.viewports, ['desktop', 'mobile']);
  assert.equal(admin.setup.length, 12);
  assert.equal(admin.teardown.length, 3);
  const popup = admin.pages.find((p) => p.name === 'catalog-popup');
  assert.equal(popup.fullPage, false);
  assert.deepEqual(popup.viewports, ['desktop']);
  assert.equal(popup.actions[0].hover, "header a.dropdown-toggle[href='/catalog/']");
  assert.equal(admin.pages.find((p) => p.name === 'home').fullPage, true);
  assert.deepEqual(cfg.login, { url: '/auth/', check: BITRIX_CHECK });
});

test('login: из pages.json, по умолчанию Битрикс; в общем режиме без check — null', () => {
  assert.deepEqual(loginSettings(undefined, 'bitrix'), { url: '/auth/', check: BITRIX_CHECK });
  assert.deepEqual(loginSettings(undefined, null), { url: '/auth/', check: BITRIX_CHECK });
  assert.deepEqual(loginSettings(undefined, 'общий'), { url: '/auth/', check: null });
  assert.deepEqual(loginSettings({ url: '/login/', check: 'window.uid' }, 'общий'), { url: '/login/', check: 'window.uid' });
  const auth = { contexts: { admin: { auth: true, pages: [{ name: 'home', url: '/' }] } } };
  assert.throws(() => validateConfig(auth, 'общий'), code2(/login\.check/));
  assert.equal(validateConfig({ ...auth, login: { check: 'window.uid' } }, 'общий').login.check, 'window.uid');
  assert.equal(validateConfig(auth, 'bitrix').login.check, BITRIX_CHECK);
});

test('опечатка в ключе, повтор имени, url без /, неверная ширина — код 2 со всеми ошибками сразу', () => {
  const raw = clone(BETA);
  raw.contexts.admin.pages[2].fullpage = false;
  raw.contexts.admin.pages[3].name = raw.contexts.admin.pages[4].name;
  raw.contexts.guest.pages[0].url = 'catalog/';
  raw.contexts.guest.viewports = ['tablet'];
  raw.contexts.admin.setup[0].gotoo = '/x/';
  assert.throws(() => validateConfig(raw, 'bitrix'), (e) => e.code === 2
    && /неизвестный ключ contexts\.admin\.pages\[2\]\.fullpage/.test(e.message)
    && /pages\[4\]\.name: повтор «section-b»/.test(e.message)
    && /contexts\.guest\.pages\[0\]\.url/.test(e.message)
    && /contexts\.guest\.viewports/.test(e.message)
    && /неизвестный ключ contexts\.admin\.setup\[0\]\.gotoo/.test(e.message));
});

test('ключи с _ — комментарии; действие без глагола — ошибка', () => {
  assert.ok(validateConfig(minimal({ _comment: 'x' }), 'bitrix'));
  const raw = minimal();
  raw.contexts.guest.pages[0].actions = [{ optional: true }];
  assert.throws(() => validateConfig(raw, 'bitrix'), code2(/нет действия/));
});

test('опасный адрес страницы или goto без unsafe — код 2; с unsafe — можно', () => {
  const page = minimal();
  page.contexts.guest.pages.push({ name: 'cancel', url: '/personal/cancel/109/?CANCEL=Y' });
  assert.throws(() => validateConfig(page, 'bitrix'), code2(/cancel.*опасный адрес .*отмена заказа/));
  page.contexts.guest.pages[1].unsafe = true;
  assert.ok(validateConfig(page, 'bitrix'));
  const go = minimal();
  go.contexts.guest.setup = [{ goto: '/auth/?logout=yes' }];
  assert.throws(() => validateConfig(go, 'bitrix'), code2(/setup\[0\]\.goto: опасный адрес/));
  go.contexts.guest.setup[0].unsafe = true;
  assert.ok(validateConfig(go, 'bitrix'));
  const own = minimal({ danger: ['/my-action/'] });
  own.contexts.guest.pages.push({ name: 'act', url: '/my-action/1/' });
  assert.throws(() => validateConfig(own, 'bitrix'), code2(/опасно по pages\.json/));
  assert.throws(() => validateConfig(minimal({ danger: ['('] }), 'bitrix'), code2(/неверное регулярное выражение/));
});

test('loadConfig: нет файла или испорченный JSON — код 2', () => {
  const dir = makeProject();
  assert.equal(readConfigFile(dir), null);
  assert.throws(() => loadConfig(dir, 'bitrix'), code2(/сначала discover/));
  fs.mkdirSync(path.dirname(path.join(dir, CONFIG_REL)), { recursive: true });
  fs.writeFileSync(path.join(dir, CONFIG_REL), '{ "contexts": ');
  assert.throws(() => loadConfig(dir, 'bitrix'), code2(/pages\.json/));
  fs.writeFileSync(path.join(dir, CONFIG_REL), '﻿' + JSON.stringify(minimal()));
  assert.equal(loadConfig(dir, 'bitrix').contexts[0].pages[0].name, 'home');
});

test('selectGroups: все, --only (setup остаётся за группой), --ctx, --vp, ошибки фильтров', () => {
  const cfg = validateConfig(BETA, 'bitrix');
  const all = selectGroups(cfg);
  assert.equal(all.full, true);
  assert.deepEqual(all.groups.map((g) => `${g.ctx.name}/${g.vp}/${g.pages.length}`), ['guest/desktop/10', 'guest/mobile/10', 'admin/desktop/21', 'admin/mobile/20']);
  const only = selectGroups(cfg, { only: ['home', 'catalog-popup'] });
  assert.equal(only.full, false);
  assert.deepEqual(only.groups.map((g) => `${g.ctx.name}/${g.vp}/${g.pages.map((p) => p.name).join('+')}`),
    ['guest/desktop/home', 'guest/mobile/home', 'admin/desktop/home+catalog-popup', 'admin/mobile/home']);
  assert.equal(only.groups[2].ctx.setup.length, 12);
  assert.deepEqual(selectGroups(cfg, { ctx: 'admin', vp: 'mobile' }).groups.map((g) => g.ctx.name + '/' + g.vp), ['admin/mobile']);
  assert.deepEqual(selectGroups(cfg, { ctx: 'admin', vp: 'mobile' }).filters, { only: [], ctx: 'admin', vp: 'mobile' });
  assert.throws(() => selectGroups(cfg, { ctx: 'root' }), code2(/нет контекста root/));
  assert.throws(() => selectGroups(cfg, { vp: 'tablet' }), code2(/--vp/));
  assert.throws(() => selectGroups(cfg, { only: ['nope'] }), code2(/нет страниц nope/));
  assert.throws(() => selectGroups(cfg, { only: ['catalog-popup'], vp: 'mobile' }), code2(/нет страниц catalog-popup/));
});

test('siteBase и siteMode: адрес из параметров, --env дев, --url, ошибки', () => {
  const params = makeParams({ 'режим': 'bitrix', 'прод': 'https://beta.example.com/', 'дев': '—' });
  assert.equal(siteMode(params), 'bitrix');
  assert.equal(siteMode(makeParams(null)), null);
  assert.equal(siteBase(params), 'https://beta.example.com');
  assert.equal(siteBase(params, { url: 'https://dev.x.ru/' }), 'https://dev.x.ru');
  assert.throws(() => siteBase(params, { env: 'дев' }), code2(/«Дев»/));
  assert.throws(() => siteBase(params, { env: 'test' }), code2(/--env/));
  assert.throws(() => siteBase(makeParams(null)), code2(/«Прод»/));
  assert.throws(() => siteBase(params, { url: 'beta.example' }), code2(/http/));
});
