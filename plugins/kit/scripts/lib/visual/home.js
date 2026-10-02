'use strict';
// Папка снимков на машине (<дом>): зависимости deps/ и сессии входа auth/ — вне проекта и вне кэша плагина.
// <дом> = KIT_VISUAL_HOME или %LOCALAPPDATA%\kit\visual (вне Windows — ~/.cache/kit/visual).
// KIT_VISUAL_DEPS — другая папка с node_modules (только для тестов: корень репозитория с devDependencies).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { VisualError } = require('./args');

const MANIFEST = path.join(__dirname, '..', '..', 'visual-deps', 'package.json');
const IMAGE_DEPS = ['pixelmatch', 'pngjs'];

function homeDir(env = process.env) {
  if (env.KIT_VISUAL_HOME) return env.KIT_VISUAL_HOME;
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'kit', 'visual');
  return path.join(os.homedir(), '.cache', 'kit', 'visual');
}

function depsDir(env = process.env) {
  return env.KIT_VISUAL_DEPS || path.join(homeDir(env), 'deps');
}

// Закреплённые версии: { имя: версия }.
function pinned() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).dependencies;
}

// Чего не хватает в dir/node_modules: [{ name, want, have }]; пусто — всё стоит ровно тех версий.
function missingDeps(dir, names = Object.keys(pinned())) {
  const want = pinned();
  const out = [];
  for (const name of names) {
    let have = null;
    try {
      have = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch (e) {
      have = null;
    }
    if (have !== want[name]) out.push({ name, want: want[name], have });
  }
  return out;
}

function requireDeps(dir, names) {
  const miss = missingDeps(dir, names);
  if (!miss.length) return;
  const list = miss.map((m) => `${m.name} ${m.want}${m.have ? ` (стоит ${m.have})` : ''}`).join(', ');
  throw new VisualError(5, `нет зависимостей снимков в ${dir}: ${list}\nУстановка — только с согласия пользователя: node visual.js install`);
}

async function loadImageLibs(dir) {
  requireDeps(dir, IMAGE_DEPS);
  const req = createRequire(path.join(dir, 'package.json'));
  const { PNG } = req('pngjs');
  const pixelmatch = (await import(pathToFileURL(req.resolve('pixelmatch')).href)).default;
  return { PNG, pixelmatch };
}

function loadPlaywright(dir) {
  requireDeps(dir);
  return createRequire(path.join(dir, 'package.json'))('playwright-core');
}

// Поставить зависимости в <дом>/deps (не в KIT_VISUAL_DEPS): копия манифеста плагина и npm install.
function installDeps(env = process.env) {
  const dir = path.join(homeDir(env), 'deps');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(MANIFEST, path.join(dir, 'package.json'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
    cwd: dir, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.error || r.status !== 0) throw new VisualError(5, `npm install не отработал${r.error ? ': ' + r.error.message : ` (код ${r.status})`}`);
  requireDeps(dir);
  return dir;
}

// Файл сессии входа: свой на проект (имя папки + хеш полного пути) и на хост сайта.
function authFile(root, base, env = process.env) {
  const abs = path.resolve(root);
  const name = path.basename(abs).replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
  const hash = crypto.createHash('sha1').update(abs.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 8);
  const host = new URL(base).host.replace(/:/g, '_');
  return path.join(homeDir(env), 'auth', `${name}-${hash}@${host}.json`);
}

module.exports = { MANIFEST, IMAGE_DEPS, homeDir, depsDir, pinned, missingDeps, requireDeps, loadImageLibs, loadPlaywright, installDeps, authFile };
