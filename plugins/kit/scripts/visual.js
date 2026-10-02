#!/usr/bin/env node
'use strict';
// Снимки публичной части сайта «до/после» и их сравнение (/kit:visual). Запуск — из корня проекта:
//   node visual.js deps | install | login | discover [адрес…] [--ctx guest] | list
//   node visual.js shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup]
//   node visual.js check <метка> [те же фильтры]   — контрольный прогон <метка>-check (с адреса метки) и шум
//   node visual.js compare <до> <после>
// Общие флаги: --env прод|дев, --url адрес. Коды: 0 норма; 1 есть проблемы; 2 аргументы или pages.json;
// 3 сессия; 4 защита выкладки; 5 нет зависимостей или Chrome.
const fs = require('fs');
const path = require('path');
const { VisualError, parseArgs, seedPath, parseOnly, checkLabel } = require('./lib/visual/args');
const { CONFIG_REL, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups } = require('./lib/visual/config');
const { dangerReason, collectLinks, groupLinks } = require('./lib/visual/links');
const {
  pageKey, textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence, metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
} = require('./lib/visual/diff');
const { buildSummary, consoleLines, buildHtml } = require('./lib/visual/report');
const { diffPng } = require('./lib/visual/image');
const home = require('./lib/visual/home');
const { checkDeploy, ensureGitignore } = require('./lib/visual/guard');
const { kitInfo } = require('./lib/project');

const USAGE = 'Команды: deps | install | login | discover [адрес…] [--ctx guest] | shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup]'
  + ' | check <метка> [фильтры] | compare <до> <после> | list; флаги --env прод|дев, --url адрес';

function project() {
  const root = process.cwd();
  const info = kitInfo(root);
  // Папка снимков — <папка документов>/visual: .claude/docs/visual, у непереехавших проектов — docs/visual.
  return { root, params: info.params, mode: siteMode(info.params), visualRel: info.visualRel, visual: path.join(root, ...info.visualRel.split('/')) };
}

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const writeJson = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 1));
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');

function makeLog(file) {
  return (line) => {
    console.log(line);
    if (file) fs.appendFileSync(file, line + '\n');
  };
}

// Перед записью в папку снимков: защита выкладки (код 4), затем .gitignore в ней.
function guard(p) {
  for (const w of checkDeploy(p.root, p.params, p.visualRel)) console.log('Внимание: ' + w);
  if (ensureGitignore(p.visual)) console.log(`Создан ${p.visualRel}/.gitignore — снимки только локально`);
}

// Ключи снимков метки: 'ctx/vp/name' по файлам *.png.
function listPngs(dir) {
  const out = new Set();
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else if (e.name.endsWith('.png')) out.add(prefix + e.name.slice(0, -4));
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

function cmdDeps() {
  const dir = home.depsDir();
  home.requireDeps(dir);
  console.log('Зависимости снимков на месте: ' + dir);
  return 0;
}

function cmdInstall() {
  console.log('Установлено: ' + home.installDeps());
  return 0;
}

async function cmdLogin(a) {
  const p = project();
  const base = siteBase(p.params, a.flags);
  const raw = readConfigFile(p.root);
  const login = raw ? validateConfig(raw, p.mode).login : loginSettings(undefined, p.mode);
  if (!login.check) throw new VisualError(2, `в общем режиме нужен login.check в ${CONFIG_REL}`);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  const uid = await require('./lib/visual/browser').login({ pw, base, loginCfg: login, file, log: console.log });
  console.log(`Вход обнаружен (USER_ID=${uid}). Сессия сохранена: ${file}`);
  return 0;
}

async function cmdDiscover(a) {
  const p = project();
  const base = siteBase(p.params, a.flags);
  if (a.flags.ctx && a.flags.ctx !== 'guest') throw new VisualError(2, '--ctx у discover: только guest');
  const raw = readConfigFile(p.root);
  const cfg = raw ? validateConfig(raw, p.mode) : null;
  const extra = cfg ? cfg.danger : [];
  const seeds = a.positional.length ? a.positional.map(seedPath) : ['/'];
  for (const s of seeds) {
    const d = dangerReason(s, extra);
    if (d) throw new VisualError(2, `адрес ${s}: опасный — ${d}`);
  }
  guard(p);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  const storage = a.flags.ctx === 'guest' || !fs.existsSync(file) ? null : file;
  const check = (cfg ? cfg.login : loginSettings(undefined, p.mode)).check;
  const pages = await require('./lib/visual/browser').discover({ pw, base, seeds, storage, check });
  const links = collectLinks(pages.map((x) => ({ seed: x.url, hrefs: x.hrefs })), base, extra);
  const out = { base, date: new Date().toISOString(), ctx: storage ? 'auth' : 'guest', seeds: pages.map(({ hrefs, ...r }) => r), links };
  const target = path.join(p.visual, 'links.json');
  writeJson(target, out);
  console.log(storage ? `С сессией: ${storage}` : 'Гостем');
  for (const s of out.seeds) {
    console.log(s.fail ? `ERR ${s.url}  ${s.fail}` : `${s.url} → ${s.final} | ${s.title} | USER_ID=${s.uid || '—'} | ${s.status}`);
  }
  console.log('Группы страниц (число, шаблон, пример):');
  for (const g of groupLinks(links)) console.log(`  ${String(g.count).padStart(4)}  ${g.pattern}${g.count > 1 ? '   напр. ' + g.example : ''}`);
  const danger = links.filter((l) => l.danger);
  if (danger.length) {
    console.log('Опасные — не снимать:');
    for (const l of danger) console.log(`  ${l.url} — ${l.danger}`);
  }
  const files = links.filter((l) => l.file).length;
  if (files) console.log(`Файлы (не страницы): ${files}`);
  console.log(`Записано: ${rel(target)} (ссылок ${links.length})`);
  return 0;
}

// Съёмка в метку: общий путь shoot и check.
async function runShoot(p, flags, label) {
  const base = siteBase(p.params, flags);
  const cfg = loadConfig(p.root, p.mode);
  const sel = selectGroups(cfg, { only: parseOnly(flags.only), ctx: flags.ctx, vp: flags.vp });
  const outDir = path.join(p.visual, label);
  const metaFile = path.join(outDir, 'meta.json');
  const old = readJson(metaFile);
  // Метка — снимки одного адреса: дописывание с другого смешало бы прод и дев в одном meta.json.
  if (old && old.base && old.base !== base) throw new VisualError(2, `метка ${label} снята с ${old.base}; для другого адреса — другая метка`);
  guard(p);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  if (sel.groups.some((g) => g.ctx.auth) && !fs.existsSync(file)) {
    throw new VisualError(3, `нет сессии входа (${file}) — node visual.js login`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const log = makeLog(path.join(outDir, 'shoot.log'));
  const date = new Date().toISOString();
  log(`— ${date} shoot ${label} ${base}${sel.full ? '' : ' ' + JSON.stringify(sel.filters)}`);
  const res = await require('./lib/visual/browser').shoot({
    pw, base, cfg, groups: sel.groups, outDir, authFile: file, noSetup: !!flags['no-setup'], log,
  });
  writeJson(metaFile, mergeMeta(old, {
    base, env: flags.url ? null : flags.env || 'прод', date, full: sel.full, filters: sel.filters,
    groups: sel.groups.map((g) => `${g.ctx.name}/${g.vp}`), setup: res.setup, pages: res.pages,
  }));
  const failed = res.pages.filter((r) => r.fail);
  const s5xx = res.pages.filter((r) => r.status >= 500);
  log(`Готово: ${res.pages.length - failed.length}/${res.pages.length} снимков → ${rel(outDir)}`);
  if (s5xx.length) log('Статус ≥ 500: ' + s5xx.map((r) => `${pageKey(r)} ${r.status}`).join(', '));
  if (failed.length) log('Не снялись: ' + failed.map((r) => `${pageKey(r)} (${r.fail})`).join(', '));
  if (res.noSession.length) return 3;
  return failed.length ? 1 : 0;
}

async function cmdShoot(a) {
  const label = checkLabel(a.positional[0], { reserved: true });
  return runShoot(project(), a.flags, label);
}

// Сравнение двух меток → папка compare-<до>-vs-<после> и сводка; useNoise — учитывать <до>/noise.json.
async function compareLabels(p, before, after, { useNoise = true } = {}) {
  const dirA = path.join(p.visual, before);
  const dirB = path.join(p.visual, after);
  for (const [l, d] of [[before, dirA], [after, dirB]]) if (!fs.existsSync(d)) throw new VisualError(2, `нет метки ${l} (${rel(d)})`);
  const libs = await home.loadImageLibs(home.depsDir());
  const metaA = readJson(path.join(dirA, 'meta.json'));
  const metaB = readJson(path.join(dirB, 'meta.json'));
  const noise = useNoise ? readJson(path.join(dirA, 'noise.json')) : null;
  const outDir = path.join(p.visual, `compare-${before}-vs-${after}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ia = metaIndex(metaA);
  const ib = metaIndex(metaB);
  const pa = listPngs(dirA);
  const pb = listPngs(dirB);
  const rows = [];
  for (const key of [...new Set([...pa, ...pb, ...ia.keys(), ...ib.keys()])].sort()) {
    const a = ia.get(key);
    const b = ib.get(key);
    const hasA = pa.has(key) && !(a && a.fail);
    const hasB = pb.has(key) && !(b && b.fail);
    const v = presence({ hasA, hasB, a, b, fullB: isFull(metaB) });
    if (v) {
      rows.push({ key, verdict: v, reason: v === 'missing' ? (b && b.fail) || 'нет снимка «после»' : v === 'nobefore' ? a.fail : undefined });
      continue;
    }
    if (!hasA) continue;
    const img = diffPng(fs.readFileSync(path.join(dirA, key + '.png')), fs.readFileSync(path.join(dirB, key + '.png')), libs);
    fs.mkdirSync(path.dirname(path.join(outDir, key + '.png')), { recursive: true });
    fs.writeFileSync(path.join(outDir, key + '.png'), img.diff);
    const ta = path.join(dirA, key + '.txt');
    const tb = path.join(dirB, key + '.txt');
    const nz = (noise && noise.snapshots && noise.snapshots[key]) || null;
    const text = fs.existsSync(ta) && fs.existsSync(tb) ? applyTextNoise(textDiff(fs.readFileSync(ta, 'utf8'), fs.readFileSync(tb, 'utf8')), nz) : null;
    const row = { key, pct: img.pct, size: img.size, text, changes: metaChanges(a, b, nz), noise: nz ? { pct: nz.pct || 0 } : null };
    row.verdict = verdictOf(row);
    rows.push(row);
  }
  const summary = buildSummary({
    before, after, base: (metaB && metaB.base) || (metaA && metaA.base), dateBefore: metaA && metaA.date, dateAfter: metaB && metaB.date,
    rows, setup: setupChanges(metaA, metaB), noiseHint: useNoise && !noise,
  });
  writeJson(path.join(outDir, 'summary.json'), summary);
  fs.writeFileSync(path.join(outDir, 'report.html'), buildHtml(summary));
  return { summary, outDir };
}

async function cmdCompare(a) {
  const [before, after] = a.positional;
  if (!before || !after) throw new VisualError(2, 'нужны две метки: compare <до> <после>');
  checkLabel(before);
  checkLabel(after);
  const { summary, outDir } = await compareLabels(project(), before, after);
  for (const line of consoleLines(summary)) console.log(line);
  console.log('Отчёт: ' + rel(path.join(outDir, 'report.html')));
  return summary.problems ? 1 : 0;
}

async function cmdCheck(a) {
  const label = checkLabel(a.positional[0], { reserved: true });
  const p = project();
  const meta = readJson(path.join(p.visual, label, 'meta.json'));
  if (!meta) throw new VisualError(2, `нет метки ${label} — сначала shoot ${label}`);
  // Контрольный прогон — с адреса метки: шум с другого сайта испортил бы noise.json.
  let flags = a.flags;
  if (meta.base) {
    if (!flags.env && !flags.url) flags = { ...flags, url: meta.base };
    else {
      const base = siteBase(p.params, flags);
      if (base !== meta.base) {
        throw new VisualError(2, `метка ${label} снята с ${meta.base}, а адрес сейчас ${base} — контрольный прогон должен быть с того же адреса`);
      }
    }
  }
  const check = label + '-check';
  // <метка>-check делает только эта команда — каждый контрольный прогон с нуля.
  fs.rmSync(path.join(p.visual, check), { recursive: true, force: true });
  const code = await runShoot(p, flags, check);
  if (code === 3) return 3;
  const { summary, outDir } = await compareLabels(p, label, check, { useNoise: false });
  const noiseFile = path.join(p.visual, label, 'noise.json');
  const fresh = noiseFromRows(summary.rows);
  writeJson(noiseFile, mergeNoise(readJson(noiseFile), fresh, check, summary.date));
  const compared = summary.rows.filter((r) => ['same', 'noise', 'diff'].includes(r.verdict));
  const zero = compared.filter((r) => r.pct === 0 && !(fresh[r.key] && (fresh[r.key].removed.length || fresh[r.key].added.length)));
  console.log(`Контрольный прогон ${check}: совпали на 0 % — ${zero.length} из ${compared.length}`);
  for (const [k, s] of Object.entries(fresh)) {
    const parts = [`${s.pct}%`];
    if (s.removed.length || s.added.length) parts.push(`текст: ${s.removed.length + s.added.length} строк`);
    if (s.errors.length) parts.push(`JS: ${s.errors.length}`);
    if (s.net.length) parts.push(`сеть: ${s.net.length}`);
    console.log(`  шум ${k}  ${parts.join('  ')}`);
  }
  for (const r of summary.rows.filter((x) => x.verdict === 'missing')) console.log(`  не снято ${r.key}  ${r.reason || ''}`);
  const statusFlaps = compared.filter((r) => r.changes.some((c) => ['status', 'final', 'uid'].includes(c.kind)));
  for (const r of statusFlaps) console.log(`  внимание ${r.key}: ${r.changes.filter((c) => ['status', 'final', 'uid'].includes(c.kind)).map((c) => c.text).join('; ')} — это не шум, разобрать`);
  console.log(`Шум: ${rel(noiseFile)}; отчёт: ${rel(path.join(outDir, 'report.html'))}`);
  return code;
}

function cmdList() {
  const p = project();
  if (!fs.existsSync(p.visual)) {
    console.log(`Снимков нет: ${p.visualRel} не создан`);
    return 0;
  }
  const dirs = fs.readdirSync(p.visual, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const d of dirs) {
    if (d.startsWith('compare-')) {
      const s = readJson(path.join(p.visual, d, 'summary.json'));
      if (s) console.log(`сравнение  ${d}  совпадает ${s.counts.same}, шум ${s.counts.noise}, отличается ${s.counts.diff}, не снято ${s.counts.missing}`);
      continue;
    }
    const m = readJson(path.join(p.visual, d, 'meta.json'));
    if (!m) continue;
    const ok = m.pages.filter((r) => !r.fail).length;
    const noise = fs.existsSync(path.join(p.visual, d, 'noise.json')) ? '  шум измерен' : '';
    console.log(`метка  ${d}  ${String(m.date || '').slice(0, 16).replace('T', ' ')}  снимков ${ok}  ${isFull(m) ? 'полный' : 'частичный'}  ${m.base || ''}${noise}`);
  }
  return 0;
}

const COMMANDS = { deps: cmdDeps, install: cmdInstall, login: cmdLogin, discover: cmdDiscover, shoot: cmdShoot, check: cmdCheck, compare: cmdCompare, list: cmdList };

async function main(argv) {
  const a = parseArgs(argv);
  const run = COMMANDS[a.cmd];
  if (!run) {
    console.error(USAGE);
    return 2;
  }
  return run(a);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code || 0;
  },
  (e) => {
    console.error('Ошибка: ' + (e instanceof VisualError ? e.message : (e && e.stack) || e));
    process.exitCode = e instanceof VisualError ? e.code : 1;
  },
);
