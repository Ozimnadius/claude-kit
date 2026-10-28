'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCommand, checkGit } = require('../plugins/kit/scripts/guard-bash');
const { makeProject, runScript } = require('./helpers');
const { progressMd, paramsMd } = require('./fixtures');

const CASES = [
  ['bash', 'cd /c/x && ls', 'cd'],
  ['bash', 'ls; cd x', 'cd'],
  ['bash', 'pushd /c/x', 'cd'],
  ['bash', 'if true; then cd x; fi', 'cd'],
  ['bash', 'FOO=1 cd x', 'cd'],
  ['bash', '(cd x) && cd y', 'cd'],
  ['bash', '( cd /c/x && ls )', null],
  ['bash', 'echo "$(cd /c/x; pwd)"', null],
  ['bash', 'git -C /c/x status', null],
  ['bash', 'echo "cd x && y"', null],
  ['bash', "cat <<'EOF' > f.txt\ncd x\nEOF", null],
  ['bash', 'git commit -m "$(cat <<\'EOF\'\nшаг\ncd x\nEOF\n)"', null],
  ['bash', 'abcd x', null],
  ['bash', "sed -i 's/a/b/' a.php", 'sed'],
  ['bash', "sed -i.bak 's/\\\\/x/' local/a.php", 'sed'],
  ['bash', "find . -name '*.php' -exec sed -i 's/a/b/' {} \\;", 'sed'],
  ['bash', "sed -n '1,5p' a.php", null],
  ['bash', "sed -i 's/a/b/' a.txt", null],
  ['bash', "grep -i foo a.php | sed 's/a/b/'", null],
  ['powershell', 'cd C:\\x; git status', 'cd'],
  ['powershell', 'Set-Location C:\\x', 'cd'],
  ['powershell', '(Set-Location C:\\x); ls', 'cd'],
  ['powershell', '& { sl C:\\x }', 'cd'],
  ['powershell', 'Get-ChildItem C:\\x | Select-Object Name', null],
  ['powershell', "Write-Output 'cd x'", null],
  ['powershell', "$s = @'\ncd x\n'@; $s", null],
  ['powershell', 'git -C "C:\\x" status', null],
  ['bash', 'git status  # note: do this then && cd build', null],
  ['bash', 'ls -la  # keep it simple; cd later', null],
  ['bash', 'ls -la  # note: run tests | cd build', null],
  ['bash', '# see (note without closing paren\ncd x', 'cd'],
  ['bash', 'echo a # (\ncd x', 'cd'],
  ['bash', "echo 'a # b' && cd x", 'cd'],
  ['bash', 'echo ${#arr}; cd x', 'cd'],
  ['bash', "sed -i 's/old.php/new.php/' file.txt", null],
  ['bash', "sed -i 's/a/b/' \"local/a.php\"", 'sed'],
  ['powershell', 'Get-ChildItem # потом cd x', null],
  ['powershell', '<# cd x #> Get-ChildItem', null],
  ['powershell', '# коммент\nSet-Location C:\\x', 'cd'],
  ['bash', '(ls -la)# note: then && cd build', null],
  ['bash', 'echo hi)#comment && cd build', null],
  ['powershell', "'before'#comment; cd C:\\x", null],
  ['bash', "echo 'a'#b; cd x", 'cd'],
  ['bash', 'curl https://a.ru/#x && cd y', 'cd'],
  ['bash', "ssh -o BatchMode=yes alpha 'cd /var/www/site && ls -la'", null],
  ['bash', 'ssh alpha "cd ~/www && md5sum index.php"', null],
  ['powershell', "ssh -o BatchMode=yes alpha 'cd /var/www/site; ls'", null],
];

for (const [shell, cmd, want] of CASES) {
  test(`${shell}: ${JSON.stringify(cmd)} → ${want || 'разрешено'}`, () => {
    const reason = checkCommand(cmd, shell);
    if (want === null) assert.equal(reason, null);
    else assert.match(reason, want === 'cd' ? /каталог/ : /sed/);
  });
}

test('хук: в kit-проекте — JSON deny, в чужом и для безопасной команды — тишина', () => {
  const kit = makeProject({ '.claude/docs/progress.md': progressMd() });
  const r = runScript('guard-bash.js', {
    input: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cd /c/x && ls' }, cwd: kit },
  });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[kit\]/);
  const foreign = makeProject({ 'a.txt': '' });
  const r2 = runScript('guard-bash.js', { input: { tool_name: 'Bash', tool_input: { command: 'cd /c/x' }, cwd: foreign } });
  assert.equal(r2.stdout, '');
  const r3 = runScript('guard-bash.js', { input: { tool_name: 'PowerShell', tool_input: { command: 'git status' }, cwd: kit } });
  assert.equal(r3.stdout, '');
});

// Система Мэтта (с 3.3.0): git commit в обход /kit:step-done и (при автозаливке PhpStorm) ветки и worktree — отказ.
const GIT = [ // [оболочка, команда, автозаливка, ожидание]
  ['bash', 'git commit -m "x"', false, 'commit'],
  ['bash', 'git add a.php && git commit -m x', false, 'commit'],
  ['bash', 'git -C /c/x -c user.name=a commit -q -F -', false, 'commit'],
  ['powershell', 'git commit -m x', false, 'commit'],
  ['bash', "node \"/c/k/scripts/kit-commit.js\" -- \"a.php\" <<'KIT_MSG'\n47.2: x\nKIT_MSG", false, null],
  ['bash', 'git log --grep commit', false, null],
  ['bash', 'echo "git commit"', false, null],
  ['bash', 'git checkout -b feature', true, 'branch'],
  ['bash', 'git switch -c feature', true, 'branch'],
  ['bash', 'git branch feature', true, 'branch'],
  ['bash', 'git worktree add ../w', true, 'branch'],
  ['bash', 'git checkout -b feature', false, null],
  ['bash', 'git branch', true, null],
  ['bash', 'git branch -d old', true, null],
  ['bash', 'git checkout -- a.php', true, null],
];

// Остальные формы: git.exe, опции до подкоманды, цепочки, PowerShell, переименование и просмотр.
const GIT_MORE = [
  ['bash', 'git.exe commit -m x', false, 'commit'],
  ['bash', 'git --no-pager commit -m x', false, 'commit'],
  ['bash', 'git -C /c/x -c core.quotepath=false --git-dir=/c/x/.git commit -m x', false, 'commit'],
  ['bash', '( cd /c/x && git commit -m x )', false, 'commit'],
  ['bash', 'ls; git commit -m x', false, 'commit'],
  ['bash', 'git status | git commit -F -', false, 'commit'],
  ['powershell', 'git add a.php; git commit -m x', false, 'commit'],
  ['powershell', "git commit -m @'\nтекст\n'@", false, 'commit'],
  ['bash', 'git commit-tree HEAD^{tree}', false, null],
  ['bash', 'git status', false, null],
  ['bash', 'git switch --create x', true, 'branch'],
  ['bash', 'git switch main', true, null],
  ['bash', 'git checkout --orphan x', true, 'branch'],
  ['bash', 'git -C /c/x branch feature', true, 'branch'],
  ['bash', 'git branch -m a b', true, null],
  ['bash', 'git branch --show-current', true, null],
  ['bash', 'git branch -vv', true, null],
  ['bash', 'git branch --list "f*"', true, null],
  ['bash', 'git worktree list', true, null],
  ['bash', 'git worktree remove ../w', true, null],
  ['bash', 'git checkout main', true, null],
  ['bash', 'git branch feature', false, null],
  ['bash', 'git worktree add ../w', false, null],
  // Блоки и условия: команда после «{» и «else», условие в скобках не мешает.
  ['powershell', 'if ($x) { git commit -m x }', false, 'commit'],
  ['powershell', 'git add .; if ($?) { git commit -m x }', false, 'commit'],
  ['powershell', 'if ($a) { git add . } else { git commit -m x }', false, 'commit'],
  ['powershell', 'if ($a) { git add . } elseif ($b) { git commit -m x }', false, 'commit'],
  ['powershell', 'Get-ChildItem | ForEach-Object { git commit -m $_ }', false, 'commit'],
  ['powershell', 'foreach ($f in $list) { git commit -m $f }', false, 'commit'],
  ['powershell', 'if ($x) {git commit -m x}', false, 'commit'],
  ['powershell', 'if($x){git commit -m x}', false, 'commit'],
  ['powershell', '$h = @{ a = 1 }; git status', false, null],
  ['bash', 'if true; then git commit -m x; fi', false, 'commit'],
  ['bash', 'if git commit -m x; then echo ok; fi', false, 'commit'],
  ['bash', 'for f in a b; do git commit -m $f; done', false, 'commit'],
  ['powershell', 'if ($x) { git status }', false, null],
  ['powershell', 'if ($x) { Write-Output ok }', false, null],
  ['powershell', "Write-Output 'if ($x) { git commit }'", false, null],
  ['powershell', 'if ($x) { git branch }', true, null],
  ['powershell', 'if ($x) { git checkout -b feature }', true, 'branch'],
  ['powershell', 'git add .; if ($?) { git branch feature }', true, 'branch'],
  // git branch: опции со значением отдельным словом, смена отслеживаемой ветки, описание — не создание ветки.
  ['bash', 'git branch --sort committerdate', true, null],
  ['bash', 'git branch --sort=-committerdate', true, null],
  ['bash', 'git branch --points-at HEAD', true, null],
  ['bash', 'git branch --no-contains x', true, null],
  ['bash', 'git branch -u origin/main', true, null],
  ['bash', 'git branch --format "%(refname)"', true, null],
  ['bash', 'git branch --set-upstream-to origin/x', true, null],
  ['bash', 'git branch --set-upstream-to=origin/x feature', true, null],
  ['bash', 'git branch --unset-upstream', true, null],
  ['bash', 'git branch --edit-description', true, null],
  ['bash', 'git branch -f x HEAD', true, 'branch'],
  ['bash', 'git branch -c a b', true, 'branch'],
  ['bash', 'git branch --track x origin/x', true, 'branch'],
];

for (const [shell, cmd, always, want] of [...GIT, ...GIT_MORE]) {
  test(`checkGit ${shell}${always ? ' (автозаливка)' : ''}: ${JSON.stringify(cmd)} → ${want || 'разрешено'}`, () => {
    const reason = checkGit(cmd, shell, { always });
    if (want === null) assert.equal(reason, null);
    else assert.match(reason, want === 'commit' ? /\/kit:step-done/ : /ветки и worktree нельзя/);
  });
}

// Хук целиком: ответ на команду в проектах разных видов.
function hook(dir, command, tool = 'Bash') {
  const r = runScript('guard-bash.js', { input: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd: dir } });
  assert.equal(r.code, 0);
  return r.stdout;
}

const withParams = (params) => makeProject({ '.claude/CLAUDE.md': paramsMd(params), '.claude/docs/progress.md': progressMd() });

test('guard-bash: в проекте Мэтта git commit — отказ с [kit], в обычном kit-проекте — пропуск', () => {
  const matt = withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' });
  const out = JSON.parse(hook(matt, 'git commit -m x'));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[kit\] Коммит — только через \/kit:step-done/);
  assert.match(JSON.parse(hook(matt, 'git add a; git commit -m x', 'PowerShell')).hookSpecificOutput.permissionDecisionReason, /^\[kit\]/);
  assert.equal(hook(matt, 'git status'), '');
  assert.equal(hook(matt, "node \"/c/k/scripts/kit-commit.js\" -- a.php <<'KIT_MSG'\n47.4: x\nKIT_MSG"), '', 'kit-commit.js проходит');
  // Обычный kit-проект, проект с «Система Мэтта: нет» и без параметра — как раньше.
  assert.equal(hook(withParams({ 'Выкладка': 'вручную' }), 'git commit -m x'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'нет' }), 'git commit -m x'), '');
  assert.equal(hook(makeProject({ '.claude/docs/progress.md': progressMd() }), 'git commit -m x'), '');
  // Не kit-проект (ни параметров, ни журнала) — тишина.
  assert.equal(hook(makeProject({ 'a.txt': '' }), 'git commit -m x'), '');
  // Прежний запрет cd действует и в проекте Мэтта.
  assert.match(JSON.parse(hook(matt, 'cd /c/x && ls')).hookSpecificOutput.permissionDecisionReason, /каталог/);
});

test('guard-bash: ветки и worktree запрещены только при автозаливке PhpStorm Always в проекте Мэтта', () => {
  const always = withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' });
  const reason = JSON.parse(hook(always, 'git worktree add ../w')).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /^\[kit\] При автозаливке PhpStorm ветки и worktree нельзя/);
  assert.match(JSON.parse(hook(always, 'git checkout -b feature')).hookSpecificOutput.permissionDecisionReason, /ветки и worktree нельзя/);
  assert.equal(hook(always, 'git branch'), '');
  assert.equal(hook(always, 'git worktree list'), '');
  assert.match(JSON.parse(hook(always, 'git commit -m x')).hookSpecificOutput.permissionDecisionReason, /\/kit:step-done/);
  // Автозаливка без Мэтта — ветки как раньше разрешены; Мэтт без автозаливки — разрешены.
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'git checkout -b feature'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' }), 'git checkout -b feature'), '');
  // «PhpStorm on-demand» — не Always.
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm on-demand', 'Система Мэтта': 'да' }), 'git worktree add ../w'), '');
});
