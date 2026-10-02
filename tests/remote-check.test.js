'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PLUGIN, makeProject, tmpDir, writeFiles, runScript, git, gitRepo } = require('./helpers');
const { paramsMd } = require('./fixtures');

// GIT_CEILING_DIRECTORIES — чтобы временная папка не оказалась «внутри» чужого репозитория выше по дереву.
const run = (dir) => runScript('remote-check.js', {
  input: { hook_event_name: 'SessionStart', source: 'startup', cwd: dir },
  env: { GIT_CEILING_DIRECTORIES: path.dirname(dir) },
});
const out = (dir) => {
  const r = run(dir);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

function commit(dir, file, text) {
  writeFiles(dir, { [file]: text });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'шаг ' + file);
}

// kit-проект в git; «удалённый» — локальный bare-репозиторий под именем name; push — ветка уже отправлена.
function project({ name = 'origin', branch = '', push = true } = {}) {
  const bare = tmpDir('kit-remote-');
  git(bare, 'init', '-q', '--bare');
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': name }), 'a.txt': '1\n' });
  if (branch) git(dir, 'checkout', '-q', '-b', branch);
  git(dir, 'remote', 'add', name, bare);
  if (push) git(dir, 'push', '-q', '-u', name, 'HEAD');
  return { dir, bare };
}

// «Другой компьютер»: клон, коммит, отправка.
function pushFromOther(bare) {
  const parent = tmpDir('kit-other-');
  git(parent, 'clone', '-q', bare, 'p');
  const other = path.join(parent, 'p');
  commit(other, 'b.txt', 'дома\n');
  git(other, 'push', '-q');
}

test('hooks.json: remote-check.js — в SessionStart, таймаут 15 с', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks;
  const h = hooks.find((x) => x.args.join(' ') === '${CLAUDE_PLUGIN_ROOT}/scripts/remote-check.js');
  assert.ok(h, 'нет remote-check.js');
  assert.equal(h.timeout, 15);
});

test('тишина: вне kit-проекта, без параметра, параметр «—», не git', () => {
  assert.equal(out(makeProject({ 'index.php': '' })), null);
  assert.equal(out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Режим': 'общий' }) })), null);
  assert.equal(out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': '—' }) })), null);
  assert.equal(out(makeProject({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': 'origin' }) })), null);
});

test('параметр есть, а remote нет — строка пользователю и в контекст', () => {
  const o = out(gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Удалённый репозиторий': 'origin' }) }));
  assert.equal(o.systemMessage, '[kit] Параметр «Удалённый репозиторий: origin», но remote origin в git нет — подключить через /kit:project-init.');
  assert.equal(o.hookSpecificOutput.additionalContext, o.systemMessage);
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('ветка ещё не отправлена — только в контекст, с правилом отправки', () => {
  const { dir } = project({ push: false });
  const o = out(dir);
  assert.equal(o.systemMessage, undefined);
  const ctx = o.hookSpecificOutput.additionalContext;
  assert.match(ctx, /ещё не отправлена в origin — отправит \/kit:step-done \(первый раз — после проверки истории на секреты\)/);
  assert.match(ctx, /\[kit\] Удалённый репозиторий origin: после каждого шага \/kit:step-done отправляет коммит \(git push -u origin HEAD\)/);
});

test('в синхроне (ветка worktree с «/» в имени) — строка в контекст, пользователю ничего', () => {
  const { dir } = project({ branch: 'claude/test-branch' });
  const o = out(dir);
  assert.equal(o.systemMessage, undefined);
  assert.match(o.hookSpecificOutput.additionalContext, /^\[kit\] В синхроне с origin\.\n\[kit\] Удалённый репозиторий origin:/);
});

test('на удалённом новые коммиты (работали с другого компьютера) — pull --ff-only, видно пользователю', () => {
  const { dir, bare } = project();
  pushFromOther(bare);
  const o = out(dir);
  // pull — из remote параметра и своей ветки, а не по upstream (К47); имя ветки по умолчанию зависит от настроек git.
  const branch = git(dir, 'symbolic-ref', '--short', 'HEAD').trim();
  assert.equal(o.systemMessage, `[kit] На origin новых коммитов: 1 (работали с другого компьютера) — до любой правки выполни git pull --ff-only origin ${branch}, затем перечитай раздел «Сейчас» в .claude/docs/progress.md: в контексте он из журнала до pull; мешают незакоммиченные изменения — стоп и вопрос пользователю.`);
  assert.ok(o.hookSpecificOutput.additionalContext.startsWith(o.systemMessage + '\n'));
});

test('не отправлено (remote называется github) — push с этим именем', () => {
  const { dir } = project({ name: 'github' });
  commit(dir, 'c.txt', 'здесь\n');
  const o = out(dir);
  assert.equal(o.systemMessage, '[kit] Не отправлено в github коммитов: 1 — отправь: git push -u github HEAD.');
  assert.match(o.hookSpecificOutput.additionalContext, /Удалённый репозиторий github:/);
});

test('разошлись — стоп и вопрос', () => {
  const { dir, bare } = project();
  pushFromOther(bare);
  commit(dir, 'c.txt', 'здесь\n');
  const o = out(dir);
  assert.match(o.systemMessage, /разошлась с origin: здесь 1, там 1 — стоп, спроси пользователя; --force, rebase и слияния — только с его согласия\.$/);
});

test('remote недоступен — «не удалось проверить», код 0', () => {
  const { dir } = project();
  git(dir, 'remote', 'set-url', 'origin', path.join(tmpDir('kit-gone-'), 'нет-такого.git'));
  const o = out(dir);
  assert.match(o.systemMessage, /^\[kit\] Не удалось проверить origin: .+ — работа идёт дальше, отправка — в \/kit:step-done\.$/);
  assert.match(o.hookSpecificOutput.additionalContext, /Удалённый репозиторий origin:/);
});
