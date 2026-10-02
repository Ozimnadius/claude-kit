'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { runScriptAsync, makeProject, writeFiles, tmpDir } = require('./helpers');
const { paramsMd } = require('./fixtures');

function serve(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push(decodeURIComponent(req.url));
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

test('site-probe: версия PHP из X-Powered-By и путь к php.exe', async () => {
  const { server, url } = await serve((req, res) => {
    res.setHeader('X-Powered-By', 'PHP/7.4.33');
    res.setHeader('Server', 'nginx');
    res.end('ok');
  });
  const modules = writeFiles(tmpDir(), { 'PHP-7.4/php.exe': '' });
  try {
    const r = await runScriptAsync('site-probe.js', { args: [url], env: { KIT_PHP_MODULES: modules } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Server: nginx/);
    assert.match(r.stdout, /X-Powered-By: PHP\/7\.4\.33/);
    assert.match(r.stdout, /PHP: 7\.4\.33 → .*PHP-7\.4.*php\.exe \(есть\)/);
  } finally {
    server.close();
  }
});

test('site-probe: версия скрыта — подсказка про консоль; нет ответа — код 1', async () => {
  const { server, url } = await serve((req, res) => res.end('ok'));
  try {
    const r = await runScriptAsync('site-probe.js', { args: [url] });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /echo PHP_VERSION/);
    assert.match(r.stdout, /\/kit:server/);
    assert.match(r.stdout, /ssh-probe\.js/);
  } finally {
    server.close();
  }
  const dead = await runScriptAsync('site-probe.js', { args: ['http://127.0.0.1:1'] });
  assert.equal(dead.code, 1);
});

test('check-closed: 403 — закрыт, 404 — нет, 200 — ОТКРЫТ с подсказкой; исключения не запрашиваются', async () => {
  const codes = { '/docs/': 403, '/docs/a.md': 403, '/docs/b.pdf': 200, '/docs/план.md': 403, '/.claude/': 403, '/.claude/CLAUDE.md': 404 };
  const { server, url, seen } = await serve((req, res) => {
    res.statusCode = codes[decodeURIComponent(req.url)] || 500;
    res.end();
  });
  const dir = makeProject({
    '.claude/CLAUDE.md': paramsMd({ 'Не выкладывать': '.claude/scripts' }),
    '.claude/scripts/01-x.php': 'x',
    'docs/a.md': 'a', 'docs/b.pdf': 'b', 'docs/план.md': 'п',
  });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /200\s+ОТКРЫТ\s+docs\/b\.pdf — nginx отдаёт \.pdf/);
    assert.match(r.stdout, /403\s+закрыт\s+docs\/план\.md/);
    assert.match(r.stdout, /404\s+нет на сервере\s+\.claude\/CLAUDE\.md/);
    assert.match(r.stdout, /ОТКРЫТО: 1/);
    assert.ok(!seen.some((p) => p.includes('scripts')), seen.join(', '));
  } finally {
    server.close();
  }
});

test('check-closed: всё закрыто — код 0', async () => {
  const { server, url } = await serve((req, res) => {
    res.statusCode = 403;
    res.end();
  });
  const dir = makeProject({ 'docs/progress.md': '# журнал', '.claude/CLAUDE.md': '# правила' });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /ОТКРЫТО: 0/);
  } finally {
    server.close();
  }
});

test('check-closed: по умолчанию запросы идут по одному, KIT_HTTP_CONCURRENCY=N — параллельно, вывод в порядке файлов (К38)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const { server, url } = await serve((req, res) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      inFlight--;
      res.statusCode = 403;
      res.end();
    }, 40);
  });
  const files = {};
  for (let i = 1; i <= 12; i++) files['docs/f' + String(i).padStart(2, '0') + '.md'] = 'x';
  const dir = makeProject(files);
  try {
    const seq = await runScriptAsync('check-closed.js', { args: [url, '--dirs', 'docs'], cwd: dir });
    assert.equal(seq.code, 0, seq.stdout);
    assert.equal(maxInFlight, 1, 'по умолчанию — по одному');
    // Параллельный запуск на Windows с Node 24 изредка аварийно завершается (код 3221226505, К41) — такой запуск повторяем.
    let par;
    for (let attempt = 0; attempt < 4; attempt++) {
      maxInFlight = 0;
      par = await runScriptAsync('check-closed.js', { args: [url, '--dirs', 'docs'], cwd: dir, env: { KIT_HTTP_CONCURRENCY: '4' } });
      if (par.code !== 3221226505) break;
    }
    assert.equal(par.code, 0, par.stdout);
    assert.ok(maxInFlight > 1, 'запросы шли по одному: ' + maxInFlight);
    const order = [...par.stdout.matchAll(/docs\/(f\d\d)\.md/g)].map((m) => m[1]);
    assert.deepEqual(order, Object.keys(files).map((f) => f.slice(5, 8)));
  } finally {
    server.close();
  }
});

test('check-closed: новая раскладка — .claude в «Не выкладывать» всё равно проверяется, снимки visual не обходятся', async () => {
  const { server, url, seen } = await serve((req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const dir = makeProject({
    '.claude/CLAUDE.md': paramsMd({ 'Не выкладывать': '.idea, .git, .claude, .claude/scripts' }),
    '.claude/docs/progress.md': '# журнал',
    '.claude/docs/work/plan.md': 'план',
    '.claude/docs/visual/before/guest/desktop/home.png': 'x',
    '.claude/scripts/01-x.php': 'x',
  });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    for (const p of ['/.claude/', '/.claude/docs/progress.md', '/.claude/docs/work/plan.md']) assert.ok(seen.includes(p), p + ' ∉ ' + seen.join(', '));
    assert.ok(!seen.some((p) => p.includes('visual')), seen.join(', '));
    assert.ok(!seen.some((p) => p.includes('scripts')), 'подпапка из «Не выкладывать» — пропускается: ' + seen.join(', '));
    assert.ok(!seen.some((p) => p.startsWith('/docs')), 'docs/ нет на диске — не запрашивается');
  } finally {
    server.close();
  }
});

test('check-closed: .claude/worktrees и скиллы .claude/skills не обходятся и не запрашиваются', async () => {
  const { server, url, seen } = await serve((req, res) => {
    res.statusCode = 403;
    res.end();
  });
  const dir = makeProject({
    '.claude/CLAUDE.md': '# правила',
    '.claude/worktrees/x/a.md': 'копия',
    '.claude/worktrees/x/docs/progress.md': 'копия журнала',
    '.claude/skills/bitrix-orm/SKILL.md': 'скилл',
    '.claude/skills/bitrix-orm/rules/reading.md': 'правило',
    'docs/a.md': 'a',
  });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.ok(seen.includes('/.claude/CLAUDE.md'), seen.join(', '));
    assert.ok(!seen.some((p) => p.includes('worktrees') || p.includes('skills')), seen.join(', '));
    assert.doesNotMatch(r.stdout, /worktrees|skills/);
  } finally {
    server.close();
  }
});

test('check-closed: 401 — закрыт (авторизация), код 0', async () => {
  const { server, url } = await serve((req, res) => {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="dev"');
    res.end();
  });
  const dir = makeProject({ 'docs/a.md': 'a' });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /401\s+закрыт \(авторизация\)\s+docs\/a\.md/);
    assert.match(r.stdout, /закрыто\/нет: 2, ОТКРЫТО: 0, прочее: 0/);
  } finally {
    server.close();
  }
});

test('site-probe: сервер принял соединение и молчит — таймаут, код 1', async () => {
  const { server, url } = await serve(() => {
    // ничего не отвечаем — имитация зависшего сервера
  });
  try {
    const r = await runScriptAsync('site-probe.js', { args: [url], env: { KIT_HTTP_TIMEOUT_MS: '500' } });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /нет ответа/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('check-closed: редирект всего на страницу входа — не ОТКРЫТ, а редирект', async () => {
  const { server, url } = await serve((req, res) => {
    if (decodeURIComponent(req.url) === '/auth/login') {
      res.statusCode = 200;
      res.end('login');
      return;
    }
    res.statusCode = 302;
    res.setHeader('Location', '/auth/login');
    res.end();
  });
  const dir = makeProject({ 'docs/a.md': 'a' });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [url], cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /редирект/);
    assert.match(r.stdout, /→ .*\/auth\/login/);
    assert.match(r.stdout, /ОТКРЫТО: 0/);
    assert.ok(!r.stdout.includes('nginx отдаёт'));
  } finally {
    server.close();
  }
});

test('check-closed: редирект на тот же путь другого хоста — вердикт по итоговому коду', async () => {
  const second = await serve((req, res) => {
    res.statusCode = 403;
    res.end();
  });
  const first = await serve((req, res) => {
    res.statusCode = 301;
    res.setHeader('Location', second.url + req.url);
    res.end();
  });
  const dir = makeProject({ 'docs/a.md': 'a' });
  try {
    const r = await runScriptAsync('check-closed.js', { args: [first.url], cwd: dir });
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /закрыт/);
    assert.match(r.stdout, /ОТКРЫТО: 0/);
    assert.ok(!r.stdout.includes('редирект'));
  } finally {
    first.server.close();
    second.server.close();
  }
});
