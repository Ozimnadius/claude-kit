'use strict';
// Общая обвязка тестов: временные проекты, запуск скриптов плагина, git, PHP.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'kit');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const PHP_DIR = 'C:\\OSPanel\\modules';

const php = (version) => path.join(PHP_DIR, 'PHP-' + version, 'php.exe');
const hasPhp = (version) => fs.existsSync(php(version));

// Созданные папки убираются при выходе процесса тестов (не убралась — не страшно, останется в %TEMP%).
const madeDirs = [];
process.on('exit', () => {
  for (const d of madeDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* занята другим процессом */ }
  }
});

function tmpDir(prefix = 'kit-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  madeDirs.push(d);
  return d;
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}

function makeProject(files = {}) {
  return writeFiles(tmpDir(), files);
}

function scriptEnv(env) {
  return { ...process.env, CLAUDE_PROJECT_DIR: '', ...env };
}

function runScript(name, { args = [], input, cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], {
    cwd: cwd || ROOT,
    input: input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: scriptEnv(env),
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runScriptAsync(name, { args = [], cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, name), ...args], { cwd: cwd || ROOT, env: scriptEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

function git(cwd, ...args) {
  const r = spawnSync('git', [
    '-c', 'user.name=kit', '-c', 'user.email=kit@test.local',
    '-c', 'core.autocrlf=false', '-c', 'core.quotepath=false', ...args,
  ], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout;
}

function gitRepo(files = {}) {
  const dir = makeProject(files);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '0.1: исходники');
  return dir;
}

// PHP 7.2 из OSPanel сам, без кода плагина, иногда падает (код 0xC0000005) или зависает, когда тесты идут параллельно
// (проверено: ~3 % запусков при 16 параллельных; 7.4 и 8.3 — стабильны). Такой запуск повторяем, любой другой результат — как есть.
const PHP_CRASH = 3221225477;
function spawnPhp(version, args, opts = {}) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = spawnSync(php(version), args, { encoding: 'utf8', ...opts, timeout: 20000 });
    if (r.status !== null && r.status !== PHP_CRASH) break;
  }
  return r;
}

function runPhp(version, code) {
  const file = path.join(tmpDir('kit-php-'), 'run.php');
  fs.writeFileSync(file, code);
  const r = spawnPhp(version, ['-d', 'display_errors=stderr', file]);
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function phpLint(version, code) {
  const r = spawnPhp(version, ['-l'], { input: code });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

module.exports = {
  ROOT, PLUGIN, SCRIPTS, php, hasPhp, tmpDir, writeFiles, makeProject,
  runScript, runScriptAsync, git, gitRepo, spawnPhp, runPhp, phpLint,
};
