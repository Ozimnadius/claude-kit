'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VisualError, parseArgs, fixMsysPath, seedPath, parseOnly, checkLabel } = require('../plugins/kit/scripts/lib/visual/args');
const { dangerReason, isFile, cleanLink, linkPattern, collectLinks, groupLinks } = require('../plugins/kit/scripts/lib/visual/links');

const BASE = 'https://beta.example.com';

test('parseArgs: команда, позиционные, флаги со значением и без', () => {
  const a = parseArgs(['shoot', 'after-1.1', '--only', 'home,order', '--ctx', 'admin', '--vp', 'mobile', '--no-setup', '--env', 'дев', '--url', 'https://x.ru']);
  assert.equal(a.cmd, 'shoot');
  assert.deepEqual(a.positional, ['after-1.1']);
  assert.deepEqual(a.flags, { only: 'home,order', ctx: 'admin', vp: 'mobile', 'no-setup': true, env: 'дев', url: 'https://x.ru' });
  assert.deepEqual(parseArgs([]), { cmd: '', positional: [], flags: {} });
});

test('parseArgs: неизвестный флаг и флаг без значения — код 2', () => {
  for (const argv of [['shoot', 'a', '--fast'], ['shoot', 'a', '--only'], ['shoot', 'a', '--only', '--ctx', 'x']]) {
    assert.throws(() => parseArgs(argv), (e) => e instanceof VisualError && e.code === 2, argv.join(' '));
  }
});

test('fixMsysPath и seedPath: путь, переписанный Git Bash, возвращается как был', () => {
  assert.equal(fixMsysPath('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(fixMsysPath('C:\\Program Files\\Git\\personal\\orders\\'), '/personal/orders/');
  assert.equal(fixMsysPath('D:/Tools/PortableGit/catalog/'), '/catalog/');
  assert.equal(fixMsysPath('C:/msys64/personal/orders/'), '/personal/orders/');
  assert.equal(fixMsysPath('/catalog/'), '/catalog/');
  assert.equal(seedPath('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(seedPath('catalog/'), '/catalog/');
  assert.equal(seedPath('/'), '/');
  assert.equal(seedPath('https://beta.example.com/catalog/?q=1'), '/catalog/?q=1');
});

test('parseOnly: список через запятую', () => {
  assert.deepEqual(parseOnly('home, order,,basket'), ['home', 'order', 'basket']);
  assert.deepEqual(parseOnly(undefined), []);
});

test('checkLabel: допустимые, недопустимые и зарезервированные метки', () => {
  for (const l of ['before', 'after-1.1', 'main-25.200', 'A_1']) assert.equal(checkLabel(l, { reserved: true }), l);
  for (const l of ['', '-x', '.x', 'a b', 'a/b', '../x', 'пример']) {
    assert.throws(() => checkLabel(l), (e) => e.code === 2, JSON.stringify(l));
  }
  assert.throws(() => checkLabel('before-check', { reserved: true }), /check/);
  assert.throws(() => checkLabel('compare-a-vs-b', { reserved: true }), /compare/);
  assert.equal(checkLabel('before-check'), 'before-check');
});

test('dangerReason: опасные адреса с причиной, обычные — null', () => {
  const bad = {
    '/auth/?logout=yes': 'выход',
    '/personal/cancel/109/?CANCEL=Y': 'отмена заказа',
    '/personal/order/?ID=5&CANCEL=Y': 'отмена заказа',
    '/personal/orders/?COPY_ORDER=Y&ID=109': 'повтор заказа',
    '/catalog/x/1/?action=ADD2BASKET&id=1': 'действие через GET',
    '/basket/?del=5': 'удаление',
    '/basket/?delete_id=5': 'удаление',
    '/items/remove/5/': 'удаление',
    '/news/?sessid=abc': 'sessid',
    '/subscribe/?unsubscribe=1': 'отписка',
    '/?clear_cache=Y': 'сброс кеша',
    '/bitrix/admin/': 'служебное',
  };
  for (const [url, why] of Object.entries(bad)) assert.match(dangerReason(url) || '', new RegExp(why), url);
  for (const url of ['/', '/catalog/', '/personal/order/1/', '/order/?delivery=2', '/catalog/?q=%D0%B1', '/local/bitrix/x/', '/auth/?forgot_password=yes']) {
    assert.equal(dangerReason(url), null, url);
  }
  assert.match(dangerReason('/my-action/1/', [/\/my-action\//i]), /pages\.json/);
});

test('isFile: документы и картинки — файлы', () => {
  assert.ok(isFile('/upload/docs/price.PDF'));
  assert.ok(isFile('/img/a.jpg?v=2'));
  assert.ok(!isFile('/catalog/'));
});

test('cleanLink: свой сайт, без #, без меток рекламы; чужое — null', () => {
  assert.equal(cleanLink('https://beta.example.com/catalog/#top', BASE), '/catalog/');
  assert.equal(cleanLink('https://beta.example.com/catalog/?utm_source=x&q=1&gclid=2', BASE), '/catalog/?q=1');
  assert.equal(cleanLink('https://beta.example.com/auth/?backurl=/', BASE), '/auth/?backurl=/');
  assert.equal(cleanLink('http://beta.example.com/company/', BASE), '/company/');
  assert.equal(cleanLink('https://beta.example.com', BASE), '/');
  for (const h of ['https://vk.com/beta', 'mailto:a@b.ru', 'tel:+7900', 'javascript:void(0)', 'https://www.beta.example.com/']) {
    assert.equal(cleanLink(h, BASE), null, h);
  }
  assert.equal(cleanLink('https://x.ru/shop/catalog/', 'https://x.ru/shop'), '/catalog/');
  assert.equal(cleanLink('https://x.ru/blog/', 'https://x.ru/shop'), null);
});

test('cleanLink: значение sessid (токен сессии) — ***, опасность сохраняется', () => {
  const url = cleanLink('https://beta.example.com/?logout=yes&sessid=abc123', BASE);
  assert.equal(url, '/?logout=yes&sessid=***');
  assert.match(dangerReason(url), /выход/);
  assert.equal(cleanLink('https://beta.example.com/news/?SESSID=abc123&utm_source=x#top', BASE), '/news/?SESSID=***');
  const [link] = collectLinks([{ seed: '/', hrefs: [BASE + '/basket/?sessid=f00d&id=1'] }], BASE);
  assert.equal(link.url, '/basket/?sessid=***&id=1');
  assert.match(link.danger, /sessid/);
});

test('linkPattern: числа → {n}, у query — имена', () => {
  assert.equal(linkPattern('/catalog/section_a/1001/'), '/catalog/section_a/{n}/');
  assert.equal(linkPattern('/news/?PAGEN_1=2'), '/news/?PAGEN_1');
  assert.equal(linkPattern('/catalog/?q=a&sort=b&q=c'), '/catalog/?q&sort');
});

test('collectLinks и groupLinks: откуда найдено, пометки, группы без опасных и файлов', () => {
  const links = collectLinks([
    { seed: '/', hrefs: [BASE + '/catalog/a/1/', BASE + '/catalog/a/2/', BASE + '/personal/cancel/1/?CANCEL=Y', BASE + '/price.pdf', 'https://vk.com/x'] },
    { seed: '/personal/', hrefs: [BASE + '/catalog/a/1/', BASE + '/personal/orders/'] },
  ], BASE);
  assert.deepEqual(links.map((l) => l.url), ['/catalog/a/1/', '/catalog/a/2/', '/personal/cancel/1/?CANCEL=Y', '/personal/orders/', '/price.pdf']);
  assert.deepEqual(links[0].from, ['/', '/personal/']);
  assert.equal(links[2].danger, 'отмена заказа');
  assert.equal(links[4].file, true);
  assert.deepEqual(groupLinks(links), [
    { pattern: '/catalog/a/{n}/', count: 2, example: '/catalog/a/1/' },
    { pattern: '/personal/orders/', count: 1, example: '/personal/orders/' },
  ]);
});
