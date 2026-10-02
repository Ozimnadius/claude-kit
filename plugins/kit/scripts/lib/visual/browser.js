'use strict';
// Съёмка в системном Chrome через Playwright (channel: 'chrome' — браузеры Playwright не скачиваются).
// Перенос прототипа beta (visual.mjs, коммит 0.3): стабилизация, действия, снимок во всю высоту и innerText.
// Вживую проверяется на сайте (/kit:visual), в тестах — с поддельным playwright-core; pw — модуль из home.loadPlaywright.
const fs = require('fs');
const path = require('path');
const { VisualError } = require('./args');

// Панель админа Битрикса, ожидание Битрикса, переключатель тем Аспро, чат jivo.
const BASE_HIDE = ['#bx-panel', '#bx-panel-back', '#bx-admin-prefix', '.bx-core-waitwindow', '.style-switcher', '#jivo-iframe-container', 'jdiv'];
const firstLine = (s) => String(s || '').split('\n')[0];

function viewports(devices) {
  return {
    desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    mobile: { ...devices['iPhone 13'], deviceScaleFactor: 1 },
  };
}

// Без анимаций, transition и курсора; свои hide — отдельным правилом (ошибка в селекторе не ломает базовое).
function stableCss(hide = []) {
  return '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}\n'
    + 'html{scroll-behavior:auto!important}\n'
    + `${BASE_HIDE.join(',')}{display:none!important}\n`
    + (hide.length ? `${hide.join(',')}{display:none!important}\n` : '');
}

// Адрес от корня сайта, если это свой сайт; иначе целиком.
function relUrl(url, base) {
  return url.startsWith(base) ? url.slice(base.length) || '/' : url;
}

async function launch(pw, headless = true) {
  try {
    return await pw.chromium.launch({ channel: 'chrome', headless });
  } catch (e) {
    throw new VisualError(5, 'не удалось запустить Chrome — нужен установленный Google Chrome (браузеры Playwright не скачиваются): ' + firstLine(e.message));
  }
}

async function newContext(browser, pw, vp, storage) {
  const opts = { ...viewports(pw.devices)[vp], ignoreHTTPSErrors: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' };
  if (storage) opts.storageState = storage;
  return browser.newContext(opts);
}

// ID вошедшего пользователя по выражению login.check; ошибка или нет входа — ''.
async function userId(page, check) {
  if (!check) return '';
  return page.evaluate(`(() => { try { const v = (${check}); return v ? String(v) : ''; } catch (e) { return ''; } })()`).catch(() => '');
}

// Видео — на первый кадр, слайдеры — на первый слайд без автопрокрутки. Выполняется в странице.
function freezeMotion() {
  document.querySelectorAll('video').forEach((v) => {
    try {
      v.pause();
      v.currentTime = 0;
      v.removeAttribute('autoplay');
    } catch (e) {
      // видео без данных
    }
  });
  document.querySelectorAll('*').forEach((el) => {
    const s = el.swiper;
    if (!s) return;
    try {
      if (s.autoplay) s.autoplay.stop();
      // Swiper в режиме loop: slideTo(0) попадает на клон — нужен slideToLoop.
      if (s.params && s.params.loop) s.slideToLoop(0, 0, false);
      else s.slideTo(0, 0, false);
    } catch (e) {
      // чужой объект swiper
    }
  });
  if (window.jQuery) {
    try {
      window.jQuery('.owl-carousel').trigger('stop.owl.autoplay');
      window.jQuery('.flexslider').each(function () {
        const f = window.jQuery(this).data('flexslider');
        if (f) {
          f.pause();
          f.flexAnimate(0);
        }
      });
    } catch (e) {
      // старые версии плагинов
    }
  }
}

async function stabilize(page, hide) {
  await page.addStyleTag({ content: stableCss(hide) }).catch(() => {});
  await page.evaluate(freezeMotion).catch(() => {});
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const h = () => document.documentElement.scrollHeight;
    for (let y = 0; y < h() && y < 40000; y += 700) {
      window.scrollTo(0, y);
      await sleep(120);
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.evaluate(freezeMotion).catch(() => {});
  await page.waitForTimeout(700);
}

// Как в прототипе: ключи действия выполняются в этом порядке; у click/clickAccept с optional таймаут 3 с.
async function runAction(page, base, a) {
  const t = a.optional ? 3000 : 15000;
  if (a.goto) await page.goto(base + a.goto, { waitUntil: 'load', timeout: 60000 });
  if (a.click) await page.locator(a.click).first().click({ timeout: t });
  // Клик с подтверждением окна confirm() — только там, где это явно задано в pages.json.
  if (a.clickAccept) {
    const accept = (d) => { d.accept().catch(() => {}); };
    page.once('dialog', accept);
    try {
      await page.locator(a.clickAccept).first().click({ timeout: t });
    } catch (e) {
      page.off('dialog', accept);
      throw e;
    }
  }
  if (a.clickText) await page.getByText(a.clickText, { exact: false }).first().click({ timeout: 15000 });
  if (a.hover) await page.locator(a.hover).first().hover({ timeout: 15000 });
  if (a.fill) await page.locator(a.fill).nth(a.nth || 0).fill(String(a.value ?? '1'), { timeout: 15000 });
  if (a.eval) await page.evaluate(a.eval);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.waitFor) await page.locator(a.waitFor).first().waitFor({ timeout: 15000 });
}

async function runActions(page, base, actions = []) {
  for (const a of actions) {
    try {
      await runAction(page, base, a);
    } catch (e) {
      if (!a.optional) throw e;
    }
  }
}

// Одна группа «контекст × ширина»: проверка входа, setup, страницы, teardown.
async function shootGroup({ browser, pw, base, cfg, group, outDir, authFile, noSetup, log, result }) {
  const { ctx, vp } = group;
  const key = `${ctx.name}/${vp}`;
  const context = await newContext(browser, pw, vp, ctx.auth ? authFile : null);
  const page = await context.newPage();
  const net = { errors: [], bad: [], failed: [] };
  page.on('pageerror', (e) => net.errors.push(String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') net.errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) net.bad.push({ status: r.status(), url: relUrl(r.url(), base), type: r.request().resourceType() });
  });
  page.on('requestfailed', (r) => {
    net.failed.push({ url: relUrl(r.url(), base), error: (r.failure() || {}).errorText || '', type: r.resourceType() });
  });
  const fail = (p, why) => result.pages.push({ ctx: ctx.name, vp, name: p.name, url: p.url, fail: why });
  let started = false;
  try {
    if (ctx.auth) {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const uid = await userId(page, cfg.login.check);
      if (!uid || uid === '0') {
        result.noSession.push(key);
        log(`ERR ${key}  нет входа (сессия истекла или не та) — node visual.js login`);
        group.pages.forEach((p) => fail(p, 'нет входа'));
        return;
      }
    }
    started = true;
    if (!noSetup && ctx.setup.length) {
      try {
        await runActions(page, base, ctx.setup);
      } catch (e) {
        result.setup[key] = firstLine(e.message);
        log(`[${key}] setup: ${result.setup[key]}`);
      }
    }
    for (const p of group.pages) {
      const rec = { ctx: ctx.name, vp, name: p.name, url: p.url };
      const dir = path.join(outDir, ctx.name, vp);
      const png = path.join(dir, p.name + '.png');
      const txt = path.join(dir, p.name + '.txt');
      net.errors.length = 0;
      net.bad.length = 0;
      net.failed.length = 0;
      try {
        const resp = await page.goto(base + p.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        await stabilize(page, [...cfg.hide, ...ctx.hide, ...p.hide]);
        if (p.actions.length) {
          await runActions(page, base, p.actions);
          await page.waitForTimeout(500);
        }
        rec.final = relUrl(page.url(), base);
        rec.title = await page.title();
        rec.uid = await userId(page, cfg.login.check);
        fs.mkdirSync(dir, { recursive: true });
        const mask = [...cfg.mask, ...ctx.mask, ...p.mask].map((s) => page.locator(s));
        await page.screenshot({ path: png, fullPage: p.fullPage, mask, timeout: 90000 });
        fs.writeFileSync(txt, await page.evaluate(() => (document.body ? document.body.innerText : '')));
        rec.errors = [...net.errors];
        rec.bad = [...net.bad];
        rec.failed = [...net.failed];
        log(`ok  ${key}/${p.name}  ${rec.status} ${rec.final}${rec.errors.length ? '  js-ошибок: ' + rec.errors.length : ''}${rec.bad.length ? '  ответов ≥400: ' + rec.bad.length : ''}`);
      } catch (e) {
        rec.fail = firstLine(e.message);
        // Снимок прежнего прогона этой метки устарел — убрать, чтобы сравнение его не взяло.
        for (const f of [png, txt]) fs.rmSync(f, { force: true });
        log(`ERR ${key}/${p.name}  ${rec.fail}`);
      }
      result.pages.push(rec);
    }
  } finally {
    if (started && !noSetup && ctx.teardown.length) {
      try {
        await runActions(page, base, ctx.teardown);
      } catch (e) {
        log(`[${key}] teardown: ${firstLine(e.message)}`);
      }
    }
    await context.close().catch(() => {});
  }
}

// → { pages: [meta страниц], setup: { 'ctx/vp': ошибка }, noSession: ['ctx/vp'] }.
async function shoot({ pw, base, cfg, groups, outDir, authFile, noSetup, log }) {
  const browser = await launch(pw);
  const result = { pages: [], setup: {}, noSession: [] };
  try {
    for (const group of groups) {
      const before = result.pages.length;
      try {
        await shootGroup({ browser, pw, base, cfg, group, outDir, authFile, noSetup, log, result });
      } catch (e) {
        // Ошибка вне цикла страниц (newContext, проверка входа) не должна ронять весь прогон:
        // страницы этой группы, которых ещё нет в result.pages, помечаются fail — meta.json пишется всегда.
        const { ctx, vp } = group;
        const reason = `группа ${ctx.name}/${vp}: ${firstLine(e.message)}`;
        const done = new Set(result.pages.slice(before).map((r) => r.name));
        for (const p of group.pages) {
          if (done.has(p.name)) continue;
          const dir = path.join(outDir, ctx.name, vp);
          for (const f of [path.join(dir, p.name + '.png'), path.join(dir, p.name + '.txt')]) fs.rmSync(f, { force: true });
          result.pages.push({ ctx: ctx.name, vp, name: p.name, url: p.url, fail: reason });
        }
        log(`ERR ${ctx.name}/${vp}  ${reason}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

// Окно Chrome: пользователь входит сам; вход — когда login.check вернул ID (не пусто и не 0) → storageState.
async function login({ pw, base, loginCfg, file, log, timeoutMs = 15 * 60 * 1000 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const browser = await launch(pw, false);
  try {
    const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true, locale: 'ru-RU' });
    const page = await context.newPage();
    await page.goto(base + loginCfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    log('Войдите на сайт в открывшемся окне Chrome. Жду до 15 минут…');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!browser.isConnected()) throw new VisualError(3, 'окно Chrome закрыто до входа');
      for (const p of context.pages()) {
        const uid = await userId(p, loginCfg.check);
        if (uid && uid !== '0') {
          await context.storageState({ path: file });
          return uid;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new VisualError(3, 'вход не обнаружен за 15 минут');
  } finally {
    await browser.close().catch(() => {});
  }
}

// Затравки discover: статус, финальный адрес, title, USER_ID и все ссылки страницы.
async function discover({ pw, base, seeds, storage, check }) {
  const browser = await launch(pw);
  try {
    const context = await newContext(browser, pw, 'desktop', storage);
    const page = await context.newPage();
    const out = [];
    for (const url of seeds) {
      const rec = { url, hrefs: [] };
      try {
        const resp = await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        rec.final = relUrl(page.url(), base);
        rec.title = await page.title();
        rec.uid = await userId(page, check);
        rec.hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
      } catch (e) {
        rec.fail = firstLine(e.message);
      }
      out.push(rec);
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { BASE_HIDE, stableCss, relUrl, viewports, userId, shoot, login, discover };
