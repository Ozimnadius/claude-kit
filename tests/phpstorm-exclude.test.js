'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN, makeProject, writeFiles, runScript } = require('./helpers');
const { paramsMd, progressMd } = require('./fixtures');
const { BETA, GAMMA, NO_BLOCK, BROKEN } = require('./deployment-fixtures');
const { readDeployment, isExcluded } = require('../plugins/kit/scripts/lib/deployment');
const { plainPath, mainRoot } = require('../plugins/kit/scripts/phpstorm-exclude');

const XML = '.idea/deployment.xml';
const hook = (dir) => runScript('phpstorm-exclude.js', { args: ['--hook'], input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir } });
const cli = (dir, ...args) => runScript('phpstorm-exclude.js', { args, cwd: dir });
const xmlOf = (dir) => fs.readFileSync(path.join(dir, XML), 'utf8');
const excluded = (dir) => readDeployment(xmlOf(dir)).servers[0].excluded;
// Хук отвечает JSON с systemMessage (его видит пользователь и Claude) — или ничего.
const msg = (r) => (r.stdout ? JSON.parse(r.stdout).systemMessage : '');

test('hooks.json: SessionStart запускает phpstorm-exclude.js --hook рядом с session-start.js', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0];
  assert.equal(hooks.matcher, 'startup|resume|clear|compact');
  const args = hooks.hooks.map((h) => h.args.join(' '));
  assert.deepEqual(args, ['${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js --hook', '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js', '${CLAUDE_PLUGIN_ROOT}/scripts/remote-check.js']);
});

test('--hook: kit-exec.php (файл-канал /kit:server) не исключается из выкладки — иначе PhpStorm не залил бы его на сервер', () => {
  const dir = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: BETA });
  const r = hook(dir);
  assert.equal(r.code, 0);
  assert.ok(!xmlOf(dir).includes('kit-exec'));
});

test('--hook: вне kit-проекта и без настроек выкладки — тишина, файл не тронут', () => {
  const foreign = makeProject({ [XML]: NO_BLOCK, 'index.php': '' });
  const r = hook(foreign);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(xmlOf(foreign), NO_BLOCK);
  const noIdea = hook(makeProject({ '.claude/docs/progress.md': progressMd() }));
  assert.equal(noIdea.stdout, '');
  const noComponent = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: '<project version="4" />\n' });
  assert.equal(hook(noComponent).stdout, '');
});

test('--hook: старая раскладка (beta) — дописаны .claude и docs, systemMessage с сервером и подсказкой; повтор — тишина', () => {
  const dir = makeProject({ 'docs/progress.md': progressMd(), [XML]: BETA });
  const r = hook(dir);
  assert.equal(r.code, 0);
  const line = '[kit] Исключения PhpStorm: добавлено «ftp» — .claude, docs. Если PhpStorm открыт и не подхватил — File → Reload All from Disk.';
  assert.deepEqual(JSON.parse(r.stdout), {
    systemMessage: line,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: line },
  }, 'пользователю — systemMessage, Claude — additionalContext');
  assert.deepEqual(excluded(dir).slice(-2), ['.claude', 'docs']);
  assert.equal(hook(dir).stdout, '', 'второй запуск — добавлять нечего');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.idea')), ['deployment.xml'], 'временный файл не остался');
});

test('--hook: новая раскладка — папка документов внутри .claude не добавляется; «Не выкладывать» — только простые пути', () => {
  const md = paramsMd({ 'Не выкладывать': '.idea, .git, .claude, ./local/modules, /bitrix/, *.back*, upload/ (кроме upload/docs/), C:\\x, ../y, ./.claude' });
  const dir = makeProject({ '.claude/CLAUDE.md': md, '.claude/docs/progress.md': progressMd(), [XML]: NO_BLOCK });
  const r = hook(dir);
  assert.match(msg(r), /добавлено «ftp» — \.idea, \.git, \.claude, local\/modules, bitrix\./);
  assert.deepEqual(excluded(dir), ['.idea', '.git', '.claude', 'local/modules', 'bitrix']);
});

test('--hook: журнал в корне проекта — «.» в исключения не попадает', () => {
  const dir = makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Журнал': 'progress.md' }), [XML]: NO_BLOCK });
  hook(dir);
  assert.deepEqual(excluded(dir), ['.idea', '.git', '.claude']);
});

test('--hook: неразобранный файл — systemMessage-предупреждение, файл не тронут, код 0', () => {
  const dir = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: BROKEN });
  const r = hook(dir);
  assert.equal(r.code, 0);
  assert.match(msg(r), /^\[kit\] Исключения PhpStorm: \.idea\/deployment\.xml не разобран \(нет <\/paths> у сервера «ftp»\)/);
  assert.match(msg(r), /добавьте \.idea, \.git, \.claude в Excluded Paths руками/);
  assert.equal(xmlOf(dir), BROKEN);
});

test('запись не удалась (файл только для чтения) — предупреждение с путями, временного файла нет; без --hook — код 2', {
  skip: process.platform !== 'win32' && 'на POSIX rename поверх файла только для чтения проходит — сбой записи так не смоделировать',
}, () => {
  const dir = makeProject({ '.claude/docs/progress.md': progressMd(), [XML]: NO_BLOCK });
  const file = path.join(dir, XML);
  fs.chmodSync(file, 0o444);
  try {
    const r = hook(dir);
    assert.equal(r.code, 0);
    assert.match(msg(r), /^\[kit\] Исключения PhpStorm: не удалось записать \.idea\/deployment\.xml \(E[A-Z]+\) — добавьте в Excluded Paths руками: «ftp» — \.idea, \.git, \.claude\.$/);
    assert.equal(xmlOf(dir), NO_BLOCK);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.idea')), ['deployment.xml'], 'временный файл удалён');
    const c = cli(dir);
    assert.equal(c.code, 2);
    assert.match(c.stdout, /не удалось записать/);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.idea')), ['deployment.xml']);
  } finally {
    fs.chmodSync(file, 0o666);
  }
});

test('--hook в git worktree (.claude/worktrees/<имя>) — исключения основной папки по её параметрам', () => {
  const main = makeProject({ 'docs/progress.md': progressMd(), [XML]: NO_BLOCK });
  const wt = writeFiles(path.join(main, '.claude', 'worktrees', 'brave-turing-1a2b3c'), { 'docs/progress.md': progressMd(), 'index.php': '' });
  const r = hook(wt);
  assert.match(msg(r), /добавлено «ftp» — \.idea, \.git, \.claude, docs\./);
  assert.deepEqual(excluded(main), ['.idea', '.git', '.claude', 'docs']);
  assert.equal(fs.existsSync(path.join(wt, '.idea')), false, 'в worktree .idea не создаётся');
  assert.equal(mainRoot('C:\\p\\site\\.claude\\worktrees\\x\\sub'), 'C:\\p\\site');
  assert.equal(mainRoot('/home/u/site/.claude/worktrees/x'), '/home/u/site');
  assert.equal(mainRoot('C:\\p\\site'), 'C:\\p\\site');
});

// «Документы на сервере: да» (zeta): на сервер уезжают только .claude/docs, CLAUDE.md и .htaccess.
const DENY = fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'htaccess-deny'), 'utf8');
const OWN_DENY = 'Require all denied\n';
const docsProject = (extra = {}) => ({
  '.claude/CLAUDE.md': paramsMd({ 'Документы на сервере': 'да', ...extra }),
  '.claude/.htaccess': OWN_DENY,
  '.claude/docs/progress.md': progressMd(),
  '.claude/agents/x.md': '',
  '.claude/settings.local.json': '{}',
});
const OPENED = ['.claude/agents', '.claude/settings.local.json', '.claude/worktrees', '.claude/skills', '.claude/docs/visual'];

test('--hook, «Документы на сервере: да»: .claude убрана, исключено всё в ней, кроме docs, CLAUDE.md и .htaccess, плюс worktrees, скиллы и снимки; повтор — тишина', () => {
  const dir = makeProject({ ...docsProject(), [XML]: GAMMA });
  const r = hook(dir);
  assert.equal(r.code, 0);
  assert.equal(msg(r), '[kit] Исключения PhpStorm: убрано «ftp» — .claude; добавлено «ftp» — ' + OPENED.join(', ') + '. '
    + 'На сервер уезжают .claude/docs, .claude/CLAUDE.md и .claude/.htaccess (параметр «Документы на сервере: да») — '
    + 'после заливки проверьте снаружи, что /.claude/ закрыта (check-closed). Если PhpStorm открыт и не подхватил — File → Reload All from Disk.');
  const ex = excluded(dir);
  assert.deepEqual(ex, ['.idea', '.git', '.gitignore', 'local/modules', ...OPENED]);
  for (const p of ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/docs/progress.md']) assert.equal(isExcluded(ex, p), false, p);
  assert.equal(fs.readFileSync(path.join(dir, '.claude/.htaccess'), 'utf8'), OWN_DENY, 'свой .htaccess не перезаписан');
  assert.equal(hook(dir).stdout, '', 'второй запуск — менять нечего');
  assert.equal(cli(dir, '--check').code, 0);
});

test('«Документы на сервере: да», нет .claude/.htaccess — хук создаёт его из шаблона project-init; --check не создаёт и называет', () => {
  const files = docsProject();
  delete files['.claude/.htaccess'];
  const dir = makeProject({ ...files, [XML]: GAMMA });
  const c = cli(dir, '--check');
  assert.equal(c.code, 1);
  assert.equal(c.stdout, 'Исключения PhpStorm: нет .claude/.htaccess; убрать — «ftp» — .claude; не хватает — «ftp» — ' + OPENED.join(', ') + '.\n');
  assert.equal(fs.existsSync(path.join(dir, '.claude/.htaccess')), false);
  assert.equal(xmlOf(dir), GAMMA);
  const r = hook(dir);
  assert.match(msg(r), /^\[kit\] Исключения PhpStorm: создан \.claude\/\.htaccess \(Require all denied\); убрано «ftp» — \.claude; добавлено «ftp» — /);
  assert.equal(fs.readFileSync(path.join(dir, '.claude/.htaccess'), 'utf8'), DENY);
  assert.equal(cli(dir, '--check').code, 0);
});

test('«Документы на сервере: да»: .claude в «Не выкладывать» (ручная выкладка) в Excluded Paths не возвращается; «нет» — как раньше', () => {
  const dir = makeProject({ ...docsProject({ 'Не выкладывать': '.idea, .git, .claude' }), [XML]: NO_BLOCK });
  hook(dir);
  assert.deepEqual(excluded(dir), ['.idea', '.git', ...OPENED]);
  assert.equal(hook(dir).stdout, '');
  const off = makeProject({ ...docsProject({ 'Документы на сервере': 'нет' }), [XML]: NO_BLOCK });
  hook(off);
  assert.deepEqual(excluded(off), ['.idea', '.git', '.claude']);
});

test('«Документы на сервере: да»: «Exclude items by name» отсекает документы — предупреждение при каждом старте, сам список не меняется', () => {
  const xml = GAMMA.replace('autoUpload="Always"', 'exclude=".svn;.idea;.git;*.md;docs;node_modules" autoUpload="Always"');
  const dir = makeProject({ ...docsProject(), [XML]: xml });
  const warn = '[kit] Документы на сервер не уедут: в «Exclude items by name» PhpStorm (Settings → Build, Execution, Deployment → Deployment → Options) '
    + 'есть *.md, docs — из-за них не уезжают .claude/docs, .claude/CLAUDE.md. Уберите эти имена руками: список общий для всего проекта, kit его не меняет.';
  const first = msg(hook(dir));
  assert.ok(first.startsWith('[kit] Исключения PhpStorm: убрано «ftp» — .claude;'), first);
  assert.ok(first.endsWith('\n' + warn), first);
  assert.equal(msg(hook(dir)), warn, 'исключения на месте — остаётся предупреждение');
  assert.ok(xmlOf(dir).includes('exclude=".svn;.idea;.git;*.md;docs;node_modules"'));
  const off = makeProject({ ...docsProject({ 'Документы на сервере': 'нет' }), [XML]: xml });
  assert.doesNotMatch(msg(hook(off)), /не уедут/, 'параметр выключен — документы и не должны уезжать');
});

test('--check: 1 — не хватает (файл не меняется), 0 — после записи; 2 — не разобран; --also без значения', () => {
  const dir = makeProject({ [XML]: NO_BLOCK });
  const miss = cli(dir, '--check', '--also', '.gitignore, local/modules');
  assert.equal(miss.code, 1);
  assert.equal(miss.stdout, 'Исключения PhpStorm: не хватает — «ftp» — .idea, .git, .claude, .gitignore, local/modules.\n');
  assert.equal(xmlOf(dir), NO_BLOCK);
  const bare = cli(dir, '--also', '--check');
  assert.equal(bare.code, 1, '--also без значения: --check — флаг, а не путь');
  assert.equal(bare.stdout, 'Исключения PhpStorm: не хватает — «ftp» — .idea, .git, .claude.\n');
  const write = cli(dir, '--also', '.gitignore, local/modules');
  assert.equal(write.code, 0);
  assert.match(write.stdout, /добавлено «ftp» — \.idea, \.git, \.claude, \.gitignore, local\/modules/);
  const ok = cli(dir, '--check', '--also', '.gitignore, local/modules');
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /Исключения PhpStorm на месте: ftp\./);
  const broken = cli(makeProject({ [XML]: BROKEN }), '--check');
  assert.equal(broken.code, 2);
});

test('без --hook: работает и вне kit-проекта; нет настроек выкладки — код 0 с пояснением', () => {
  const dir = makeProject({ [XML]: GAMMA });
  const r = cli(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /на месте: ftp/);
  assert.equal(xmlOf(dir), GAMMA);
  const none = cli(makeProject({ 'index.php': '' }), '--check');
  assert.equal(none.code, 0);
  assert.match(none.stdout, /Настроек выкладки PhpStorm нет/);
});

test('plainPath: маски, «кроме», абсолютные и наружу — не пути; ./ снимается', () => {
  assert.equal(plainPath('/bitrix/'), 'bitrix');
  assert.equal(plainPath('local\\modules'), 'local/modules');
  assert.equal(plainPath('./local/modules'), 'local/modules');
  assert.equal(plainPath('.\\.claude'), '.claude');
  for (const bad of ['*.back*', 'upload/ (кроме upload/docs/)', 'a?b', '[ab]', 'C:\\x', '../y', 'a/../b', '.', './', '', '  ']) {
    assert.equal(plainPath(bad), null, bad);
  }
});
