'use strict';
// pages.json проекта: чтение, проверка, умолчания, выбор страниц; адрес сайта из параметров проекта.
const fs = require('fs');
const path = require('path');
const { VisualError, NAME_RE } = require('./args');
const { dangerReason } = require('./links');

const CONFIG_REL = '.claude/scripts/visual/pages.json';
const VIEWPORTS = ['desktop', 'mobile'];
const BITRIX_CHECK = "window.BX && BX.message && BX.message('USER_ID')";
const TOP_KEYS = ['login', 'hide', 'mask', 'danger', 'contexts'];
const LOGIN_KEYS = ['url', 'check'];
const CTX_KEYS = ['auth', 'viewports', 'setup', 'teardown', 'pages', 'hide', 'mask'];
const PAGE_KEYS = ['name', 'url', 'actions', 'viewports', 'fullPage', 'hide', 'mask', 'unsafe'];
const ACTION_VERBS = ['goto', 'click', 'clickAccept', 'clickText', 'hover', 'fill', 'eval', 'wait', 'waitFor'];
const ACTION_KEYS = [...ACTION_VERBS, 'nth', 'value', 'optional', 'unsafe'];
const STRING_VERBS = ['click', 'clickAccept', 'clickText', 'hover', 'fill', 'eval', 'waitFor'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Режим проекта из параметров: 'bitrix', 'общий' или null (не kit-проект).
function siteMode(params) {
  const m = params.get('Режим', null);
  return m ? m.toLowerCase() : null;
}

// Адрес сайта: --url, иначе «Прод» (с --env дев — «Дев»); без завершающего /.
function siteBase(params, { env, url } = {}) {
  if (env && env !== 'прод' && env !== 'дев') throw new VisualError(2, '--env: прод или дев');
  const key = env === 'дев' ? 'Дев' : 'Прод';
  const base = url || params.get(key, null);
  if (!base) throw new VisualError(2, `адрес сайта не задан: параметр «${key}» в .claude/CLAUDE.md или --url`);
  if (!/^https?:\/\/[^/]+/i.test(base)) throw new VisualError(2, `адрес сайта должен начинаться с http:// или https://: ${base}`);
  return base.replace(/\/+$/, '');
}

// Вход: url страницы входа и выражение JS, которое у вошедшего пользователя возвращает его ID.
// Проверка Битрикса — по умолчанию в режиме bitrix и вне kit-проекта; в общем режиме — только из pages.json.
function loginSettings(raw, mode) {
  const l = isObj(raw) ? raw : {};
  return { url: l.url || '/auth/', check: l.check || (mode === 'общий' ? null : BITRIX_CHECK) };
}

function validateConfig(raw, mode) {
  if (!isObj(raw)) throw new VisualError(2, 'pages.json: нужен объект');
  const errs = [];
  const keysOk = (obj, allowed, at) => {
    for (const k of Object.keys(obj)) {
      if (!k.startsWith('_') && !allowed.includes(k)) errs.push(`неизвестный ключ ${at ? at + '.' : ''}${k}`);
    }
  };
  const strList = (v, at) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
      errs.push(`${at}: нужен список строк`);
      return [];
    }
    return v;
  };
  const vpList = (v, at, def) => {
    if (v === undefined) return def;
    if (!Array.isArray(v) || !v.length || v.some((x) => !VIEWPORTS.includes(x))) {
      errs.push(`${at}: список из ${VIEWPORTS.join(', ')}`);
      return def;
    }
    return v;
  };
  const unsafeHint = '; уберите адрес или добавьте "unsafe": true (только с согласия пользователя)';
  const actionList = (v, at, danger) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errs.push(`${at}: нужен список действий`);
      return [];
    }
    v.forEach((a, i) => {
      const aat = `${at}[${i}]`;
      if (!isObj(a)) return errs.push(`${aat}: нужен объект`);
      keysOk(a, ACTION_KEYS, aat);
      if (!ACTION_VERBS.some((k) => a[k] !== undefined)) errs.push(`${aat}: нет действия (${ACTION_VERBS.join(', ')})`);
      if (a.goto !== undefined) {
        if (typeof a.goto !== 'string' || !a.goto.startsWith('/')) errs.push(`${aat}.goto: адрес от корня сайта, с / в начале`);
        else if (a.unsafe !== true) {
          const d = dangerReason(a.goto, danger);
          if (d) errs.push(`${aat}.goto: опасный адрес ${a.goto} — ${d}${unsafeHint}`);
        }
      }
      for (const k of STRING_VERBS) if (a[k] !== undefined && typeof a[k] !== 'string') errs.push(`${aat}.${k}: нужна строка`);
      if (a.wait !== undefined && !(Number.isFinite(a.wait) && a.wait >= 0)) errs.push(`${aat}.wait: число миллисекунд`);
      if (a.nth !== undefined && !(Number.isInteger(a.nth) && a.nth >= 0)) errs.push(`${aat}.nth: целое число ≥ 0`);
      if (a.value !== undefined && typeof a.value !== 'string' && typeof a.value !== 'number') errs.push(`${aat}.value: строка или число`);
      for (const k of ['optional', 'unsafe']) if (a[k] !== undefined && typeof a[k] !== 'boolean') errs.push(`${aat}.${k}: true или false`);
    });
    return v;
  };

  keysOk(raw, TOP_KEYS, '');
  if (raw.login !== undefined) {
    if (!isObj(raw.login)) errs.push('login: нужен объект');
    else {
      keysOk(raw.login, LOGIN_KEYS, 'login');
      for (const k of LOGIN_KEYS) if (raw.login[k] !== undefined && typeof raw.login[k] !== 'string') errs.push(`login.${k}: нужна строка`);
    }
  }
  const danger = [];
  for (const s of strList(raw.danger, 'danger')) {
    try {
      danger.push(new RegExp(s, 'i'));
    } catch (e) {
      errs.push(`danger: неверное регулярное выражение ${s}`);
    }
  }
  const cfg = {
    login: loginSettings(raw.login, mode),
    hide: strList(raw.hide, 'hide'),
    mask: strList(raw.mask, 'mask'),
    danger,
    contexts: [],
  };
  if (!isObj(raw.contexts) || !Object.keys(raw.contexts).length) errs.push('contexts: нужен хотя бы один контекст');
  else {
    for (const [name, c] of Object.entries(raw.contexts)) {
      const at = `contexts.${name}`;
      if (!NAME_RE.test(name)) errs.push(`${at}: имя — латиница, цифры, . _ -`);
      if (!isObj(c)) {
        errs.push(`${at}: нужен объект`);
        continue;
      }
      keysOk(c, CTX_KEYS, at);
      if (c.auth !== undefined && typeof c.auth !== 'boolean') errs.push(`${at}.auth: true или false`);
      const ctx = {
        name,
        auth: c.auth === true,
        viewports: vpList(c.viewports, at + '.viewports', VIEWPORTS),
        hide: strList(c.hide, at + '.hide'),
        mask: strList(c.mask, at + '.mask'),
        setup: actionList(c.setup, at + '.setup', danger),
        teardown: actionList(c.teardown, at + '.teardown', danger),
        pages: [],
      };
      if (!Array.isArray(c.pages) || !c.pages.length) errs.push(`${at}.pages: нужен непустой список страниц`);
      else {
        c.pages.forEach((pg, i) => {
          const pat = `${at}.pages[${i}]`;
          if (!isObj(pg)) return errs.push(`${pat}: нужен объект`);
          keysOk(pg, PAGE_KEYS, pat);
          const nm = typeof pg.name === 'string' ? pg.name : '';
          if (!NAME_RE.test(nm)) errs.push(`${pat}.name: латиница, цифры, . _ -, первый символ — буква или цифра`);
          else if (ctx.pages.some((x) => x.name === nm)) errs.push(`${pat}.name: повтор «${nm}» в контексте ${name}`);
          if (typeof pg.url !== 'string' || !pg.url.startsWith('/')) errs.push(`${pat}.url: адрес от корня сайта, с / в начале`);
          else if (pg.unsafe !== true) {
            const d = dangerReason(pg.url, danger);
            if (d) errs.push(`${pat} (${nm}): опасный адрес ${pg.url} — ${d}${unsafeHint}`);
          }
          for (const k of ['fullPage', 'unsafe']) if (pg[k] !== undefined && typeof pg[k] !== 'boolean') errs.push(`${pat}.${k}: true или false`);
          ctx.pages.push({
            name: nm,
            url: pg.url,
            actions: actionList(pg.actions, pat + '.actions', danger),
            viewports: pg.viewports === undefined ? null : vpList(pg.viewports, pat + '.viewports', null),
            fullPage: pg.fullPage !== false,
            hide: strList(pg.hide, pat + '.hide'),
            mask: strList(pg.mask, pat + '.mask'),
          });
        });
      }
      cfg.contexts.push(ctx);
    }
  }
  if (cfg.contexts.some((c) => c.auth) && !cfg.login.check) {
    errs.push('контекст с "auth": true — в общем режиме нужен login.check (выражение JS, которое у вошедшего пользователя возвращает его ID)');
  }
  if (errs.length) throw new VisualError(2, `${CONFIG_REL}:\n  ` + errs.join('\n  '));
  return cfg;
}

// Сырое содержимое pages.json или null, если файла нет.
function readConfigFile(root) {
  const file = path.join(root, CONFIG_REL);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new VisualError(2, `${CONFIG_REL}: ${e.message}`);
  }
}

function loadConfig(root, mode) {
  const raw = readConfigFile(root);
  if (raw === null) throw new VisualError(2, `нет ${CONFIG_REL} — сначала discover и список страниц (/kit:visual)`);
  return validateConfig(raw, mode);
}

// Что снимать: группы «контекст × ширина» со своими страницами.
function selectGroups(cfg, { only = [], ctx, vp } = {}) {
  if (ctx && !cfg.contexts.some((c) => c.name === ctx)) {
    throw new VisualError(2, `нет контекста ${ctx} (есть: ${cfg.contexts.map((c) => c.name).join(', ')})`);
  }
  if (vp && !VIEWPORTS.includes(vp)) throw new VisualError(2, `--vp: ${VIEWPORTS.join(' или ')}`);
  const groups = [];
  const seen = new Set();
  for (const c of cfg.contexts) {
    if (ctx && c.name !== ctx) continue;
    for (const v of c.viewports) {
      if (vp && v !== vp) continue;
      const pages = c.pages.filter((p) => (!only.length || only.includes(p.name)) && (!p.viewports || p.viewports.includes(v)));
      pages.forEach((p) => seen.add(p.name));
      if (pages.length) groups.push({ ctx: c, vp: v, pages });
    }
  }
  const unknown = only.filter((n) => !seen.has(n));
  if (unknown.length) throw new VisualError(2, `--only: нет страниц ${unknown.join(', ')} в выбранных контекстах и ширинах`);
  if (!groups.length) throw new VisualError(2, 'нечего снимать: фильтры не оставили ни одной страницы');
  return { groups, full: !only.length && !ctx && !vp, filters: { only, ctx: ctx || null, vp: vp || null } };
}

module.exports = {
  CONFIG_REL, VIEWPORTS, BITRIX_CHECK, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups,
};
