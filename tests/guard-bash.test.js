'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { checkCommand, checkGit } = require('../plugins/kit/scripts/guard-bash');
const { makeProject, writeFiles, runScript, git } = require('./helpers');
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

// Система Мэтта (с 3.3.0): git commit в обход /kit:step-done, ветки и worktree — отказ; при автозаливке PhpStorm Always
// причина про автозаливку, иначе — про порядок работы Мэтта (с 47.8б ветки запрещены при любой выкладке).
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
  // До 47.8б вне автозаливки ветка проходила (Р-8: коммиты шагов уходили в неё) — теперь отказ.
  ['bash', 'git checkout -b feature', false, 'matt-branch'],
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
  // До 47.8б переход на ветку при автозаливке проходил (Р-2: файлы другой ветки уезжали на сервер) — теперь отказ.
  ['bash', 'git switch main', true, 'rewrite'],
  ['bash', 'git checkout --orphan x', true, 'branch'],
  ['bash', 'git -C /c/x branch feature', true, 'branch'],
  ['bash', 'git branch -m a b', true, null],
  ['bash', 'git branch --show-current', true, null],
  ['bash', 'git branch -vv', true, null],
  ['bash', 'git branch --list "f*"', true, null],
  ['bash', 'git worktree list', true, null],
  ['bash', 'git worktree remove ../w', true, null],
  // До 47.8б: checkout ветки при автозаливке и ветки/worktree вне её проходили (Р-2, Р-8) — теперь отказ.
  ['bash', 'git checkout main', true, 'rewrite'],
  ['bash', 'git branch feature', false, 'matt-branch'],
  ['bash', 'git worktree add ../w', false, 'matt-branch'],
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

// 47.8б: ветки и worktree при любой выкладке (Р-8), перезапись рабочей копии при автозаливке (Р-2),
// коммиты без подкоманды commit (Р-19).
const GIT_478B = [
  // Ветки и worktree вне автозаливки — отказ с причиной про порядок Мэтта; просмотр и удаление — пропуск.
  ['bash', 'git switch -c x', false, 'matt-branch'],
  ['bash', 'git switch -C x', false, 'matt-branch'],
  ['bash', 'git switch --create x', false, 'matt-branch'],
  ['bash', 'git switch --force-create x', false, 'matt-branch'],
  ['bash', 'git switch --orphan x', false, 'matt-branch'],
  ['bash', 'git checkout -B x', false, 'matt-branch'],
  ['bash', 'git checkout --orphan x', false, 'matt-branch'],
  ['bash', 'git checkout -b prototype/menu && git add -A', false, 'matt-branch'],
  ['bash', 'git -C /c/x branch research/a', false, 'matt-branch'],
  ['powershell', 'git worktree add ..\\w -b x', false, 'matt-branch'],
  ['powershell', 'if ($?) { git switch -c x }', false, 'matt-branch'],
  ['bash', 'git switch -C x', true, 'branch'],
  ['bash', 'git branch', false, null],
  ['bash', 'git branch -d old', false, null],
  ['bash', 'git branch --show-current', false, null],
  ['bash', 'git worktree list', false, null],
  ['bash', 'git worktree remove ../w', false, null],
  // Вне автозаливки перезапись рабочей копии не трогаем.
  ['bash', 'git checkout master', false, null],
  ['bash', 'git checkout 1a2b3c4', false, null],
  ['bash', 'git switch main', false, null],
  ['bash', 'git stash', false, null],
  ['bash', 'git bisect start', false, null],
  ['bash', 'git reset --hard', false, null],
  ['bash', 'git restore --source HEAD~1 a.php', false, null],
  // Автозаливка: bisect — кроме reset, log, view/visualize.
  ['bash', 'git bisect start', true, 'rewrite'],
  ['bash', 'git bisect start HEAD 1a2b3c4 && git bisect run npm test', true, 'rewrite'],
  ['bash', 'git bisect good', true, 'rewrite'],
  ['bash', 'git bisect bad 1a2b3c4', true, 'rewrite'],
  ['bash', 'git bisect skip', true, 'rewrite'],
  ['powershell', 'git bisect run php test.php', true, 'rewrite'],
  ['bash', 'git bisect reset', true, null],
  ['bash', 'git bisect log', true, null],
  ['bash', 'git bisect view', true, null],
  ['bash', 'git bisect visualize', true, null],
  // stash — кроме list и show.
  ['bash', 'git stash', true, 'rewrite'],
  ['bash', 'git stash -u', true, 'rewrite'],
  ['bash', 'git stash push -m x', true, 'rewrite'],
  ['bash', 'git stash pop', true, 'rewrite'],
  ['bash', 'git stash apply stash@{0}', true, 'rewrite'],
  ['powershell', 'git stash; git pull --ff-only; git stash pop', true, 'rewrite'],
  ['bash', 'git stash list', true, null],
  ['bash', 'git stash show -p stash@{0}', true, null],
  // checkout без «--» — отказ; «-- <пути>» и «HEAD -- <пути>» (ssh.md) — пропуск, другая ревизия перед «--» — отказ.
  ['bash', 'git checkout master', true, 'rewrite'],
  ['bash', 'git checkout 1a2b3c4', true, 'rewrite'],
  ['bash', 'git checkout file.php', true, 'rewrite'],
  ['bash', 'git checkout .', true, 'rewrite'],
  ['bash', 'git checkout HEAD~5 -- .', true, 'rewrite'],
  ['bash', 'git checkout 1a2b3c4 -- a.php', true, 'rewrite'],
  ['bash', 'git checkout master -- a.php b.php', true, 'rewrite'],
  ['powershell', 'git checkout origin/master -- local/a.php', true, 'rewrite'],
  ['bash', 'git checkout -- a.php "b c.php"', true, null],
  ['bash', 'git checkout HEAD -- a.php', true, null],
  ['bash', 'git checkout -q HEAD -- a.php', true, null],
  ['bash', 'git -C /c/x checkout -- a.php', true, null],
  ['powershell', 'git checkout HEAD -- "local/a b.php"', true, null],
  // switch без создания — отказ.
  ['bash', 'git switch -', true, 'rewrite'],
  ['bash', 'git switch --detach 1a2b3c4', true, 'rewrite'],
  // reset: --hard, --merge, --keep — отказ; остальное (индекс, --soft) — пропуск.
  ['bash', 'git reset --hard', true, 'rewrite'],
  ['bash', 'git reset --hard HEAD~1', true, 'rewrite'],
  ['bash', 'git reset --merge', true, 'rewrite'],
  ['bash', 'git reset --keep HEAD~1', true, 'rewrite'],
  ['bash', 'git reset', true, null],
  ['bash', 'git reset -- a.php', true, null],
  ['bash', 'git reset HEAD a.php', true, null],
  ['bash', 'git reset --soft HEAD~1', true, null],
  ['bash', 'git reset --mixed', true, null],
  // restore: источник не HEAD — отказ; из индекса, --staged, источник HEAD — пропуск.
  ['bash', 'git restore --source HEAD~3 .', true, 'rewrite'],
  ['bash', 'git restore --source=1a2b3c4 a.php', true, 'rewrite'],
  ['bash', 'git restore -s master -- a.php', true, 'rewrite'],
  ['bash', 'git restore -s1a2b3c4 a.php', true, 'rewrite'],
  ['powershell', 'git restore --source HEAD~1 -- a.php', true, 'rewrite'],
  ['bash', 'git restore a.php', true, null],
  ['bash', 'git restore .', true, null],
  ['bash', 'git restore --staged a.php', true, null],
  ['bash', 'git restore --source HEAD a.php', true, null],
  ['bash', 'git restore --source=HEAD a.php', true, null],
  ['bash', 'git restore -s HEAD -- a.php', true, null],
  // Коммиты без подкоманды commit — при любой выкладке; выход из начатой операции и без коммита — пропуск.
  ['bash', 'git merge feature', false, 'commit'],
  ['bash', 'git merge --no-ff feature', false, 'commit'],
  ['bash', 'git merge --continue', false, 'commit'],
  ['bash', 'git merge feature', true, 'commit'],
  // Раунд 1: слияние удалённой ветки — поток kit «ветка разошлась с удалённой» (remote-check.js, push.md) — пропуск.
  ['powershell', 'git fetch; git merge origin/master', false, null],
  ['bash', 'git merge origin/master', false, null],
  ['bash', 'git merge origin/master', true, null],
  ['bash', 'git merge --no-ff origin/master', false, null],
  ['bash', 'git merge -m "Слияние с удалённой" origin/master', false, null],
  ['bash', 'git merge -s ort -X ours origin/master', false, null],
  ['bash', 'git merge @{u}', false, null],
  ['bash', 'git merge @{upstream}', false, null],
  ['powershell', "git merge '@{u}'", false, null],
  ['bash', 'git merge master@{u}', false, null],
  ['bash', 'git merge FETCH_HEAD', false, null],
  ['bash', 'git merge refs/remotes/origin/master', false, null],
  ['bash', 'git merge', false, null],
  // Локальная ветка (в том числе среди удалённых, refs/heads/…, значение опции с «/») — по-прежнему коммит.
  ['bash', 'git merge refs/heads/feature', false, 'commit'],
  ['bash', 'git merge origin/master feature', false, 'commit'],
  ['bash', 'git merge -m "origin/master" feature', false, 'commit'],
  ['bash', 'git merge -X ours feature', false, 'commit'],
  ['bash', 'git merge --continue', true, 'commit'],
  ['bash', 'git merge --abort', false, null],
  ['bash', 'git merge --quit', false, null],
  ['bash', 'git merge --ff-only origin/master', false, null],
  ['bash', 'git merge-base HEAD origin/master', false, null],
  ['bash', 'git merge-file a.php base.php b.php', false, null],
  ['bash', 'git revert HEAD', false, 'commit'],
  ['bash', 'git revert --no-edit HEAD', false, 'commit'],
  ['bash', 'git revert --continue', false, 'commit'],
  ['bash', 'git revert --abort', false, null],
  ['bash', 'git revert --quit', false, null],
  ['bash', 'git revert --skip', false, null],
  ['bash', 'git revert -n HEAD', false, null],
  ['bash', 'git revert --no-commit HEAD~2..HEAD', false, null],
  ['bash', 'git cherry-pick 1a2b3c4', false, 'commit'],
  ['bash', 'git cherry-pick --continue', false, 'commit'],
  ['bash', 'git cherry-pick 1a2b3c4', true, 'commit'],
  ['bash', 'git cherry-pick --abort', false, null],
  ['bash', 'git cherry-pick --quit', false, null],
  ['bash', 'git cherry-pick --skip', false, null],
  ['bash', 'git cherry-pick -n 1a2b3c4', false, null],
  ['bash', 'git cherry-pick --no-commit a..b', false, null],
  ['bash', 'git am 0001-x.patch', false, 'commit'],
  ['bash', 'git am --continue', false, 'commit'],
  ['powershell', 'Get-Content x.patch | git am', false, 'commit'],
  ['bash', 'git am --abort', false, null],
  ['bash', 'git am --quit', false, null],
  ['bash', 'git am --skip', false, null],
  // pull и push не трогаем (remote-check велит git pull --ff-only, отправка — kit-commit.js --push).
  ['bash', 'git pull --ff-only', true, null],
  ['bash', 'git pull', false, null],
  ['bash', 'git push', false, null],
  // Раунд 1: rebase и pull --rebase при автозаливке — перезапись (переключение на upstream, маркеры конфликта на диске);
  // выход из начатого rebase — пропуск; вне автозаливки rebase не трогаем (kit разрешает его с согласия пользователя).
  ['bash', 'git rebase origin/master', true, 'rewrite'],
  ['bash', 'git rebase -i HEAD~3', true, 'rewrite'],
  ['bash', 'git rebase --continue', true, 'rewrite'],
  ['bash', 'git rebase --skip', true, 'rewrite'],
  ['powershell', 'git -C "C:\\x" rebase origin/master', true, 'rewrite'],
  ['bash', 'git rebase --abort', true, null],
  ['bash', 'git rebase --quit', true, null],
  ['bash', 'git rebase --show-current-patch', true, null],
  ['bash', 'git rebase origin/master', false, null],
  ['bash', 'git rebase --continue', false, null],
  ['bash', 'git pull --rebase', true, 'rewrite'],
  ['bash', 'git pull -r origin master', true, 'rewrite'],
  ['bash', 'git pull --rebase=merges origin master', true, 'rewrite'],
  ['powershell', 'git pull --rebase origin master', true, 'rewrite'],
  ['bash', 'git pull --rebase=false', true, null],
  ['bash', 'git pull --no-rebase', true, null],
  ['bash', 'git pull --ff-only origin master', true, null],
  ['bash', 'git pull --rebase', false, null],
  ['bash', 'git pull -r', false, null],
  // Раунд 1: git stash branch создаёт ветку — при любой выкладке; соседние подкоманды stash — как раньше.
  ['bash', 'git stash branch x', false, 'matt-branch'],
  ['bash', 'git stash branch x stash@{1}', true, 'branch'],
  ['bash', 'git stash list', false, null],
  ['bash', 'git stash pop', false, null],
  // 47.8ж: git am --show-current-patch (и =diff, =raw) только показывает патч — как у rebase, не коммит.
  ['bash', 'git am --show-current-patch', false, null],
  ['bash', 'git am --show-current-patch=diff', true, null],
  ['powershell', 'git am --show-current-patch=raw', false, null],
  ['bash', 'git am --continue --show-current-patch-x', false, 'commit'],
];

// Команды kit и aspro (step-done, ssh.md, push.md, project-init, remote-check, report, aspro-merge) — пропуск
// при любой выкладке; в теле heredoc слова git-команд не считаются.
const KIT_CMDS = [
  ['bash', 'git checkout -- a.php'],
  ['bash', 'git checkout HEAD -- local/a.php'],
  ['bash', 'git push -u origin HEAD'],
  ['bash', 'git pull --ff-only'],
  ['bash', 'git merge origin/master'],
  ['bash', 'git tag pre-aspro-1.7.21'],
  ['bash', 'git diff -w --ignore-cr-at-eol pre-aspro-1.7.21 -- local/'],
  ['bash', 'git diff HEAD -- a.php'],
  ['bash', 'git -c core.quotepath=false diff --stat -- "a.php" "b.php"'],
  ['bash', 'git log --reverse --format="%ad %s" --date=short'],
  ['bash', 'git log --format="%h %s"'],
  ['bash', 'git show --stat 1a2b3c4'],
  ['bash', 'git -c core.quotepath=false show --stat -M HEAD'],
  ['bash', 'git status'],
  ['bash', 'git -c core.quotepath=false status --porcelain'],
  ['bash', 'git add -A -- .claude/docs/archive/x.md'],
  ['bash', 'git ls-files .claude/docs/work/x'],
  ['bash', 'git hash-object local/a.php'],
  ['bash', 'git check-ignore -q .claude/docs/progress.md'],
  ['bash', 'git rev-list --count HEAD'],
  ['bash', 'git remote -v'],
  ['bash', 'git ls-remote --heads origin'],
  ['bash', 'git init'],
  ['bash', 'git config core.autocrlf input'],
  ['powershell', 'git -C "C:\\Users\\user\\site" status'],
  ['bash', "node \"/c/k/scripts/kit-journal.js\" <<'KIT_BLOCKS'\nSTEP: 2.1\nSUMMARY: git stash, git checkout master, git merge feature, git reset --hard\nKIT_BLOCKS"],
  ['bash', "node \"/c/k/scripts/kit-commit.js\" --inbox 2 --push origin -- \"a.php\" <<'KIT_MSG'\n2.1: git bisect start, git switch -c x\n\ngit cherry-pick 1a2b3c4\nKIT_MSG"],
];

const WANT_GIT = {
  commit: /^Коммит — только через \/kit:step-done/,
  branch: /^При автозаливке PhpStorm ветки и worktree нельзя/,
  'matt-branch': /^В проекте Мэтта ветки и worktree не используем/,
  rewrite: /^При автозаливке PhpStorm нельзя переписывать рабочую копию/,
};

const KIT_ROWS = KIT_CMDS.flatMap(([shell, cmd]) => [[shell, cmd, false, null], [shell, cmd, true, null]]);
for (const [shell, cmd, always, want] of [...GIT, ...GIT_MORE, ...GIT_478B, ...KIT_ROWS]) {
  test(`checkGit ${shell}${always ? ' (автозаливка)' : ''}: ${JSON.stringify(cmd)} → ${want || 'разрешено'}`, () => {
    const reason = checkGit(cmd, shell, { always });
    if (want === null) assert.equal(reason, null);
    else assert.match(reason, WANT_GIT[want]);
  });
}

test('checkGit: тексты причин 47.8б', () => {
  assert.equal(checkGit('git switch -c x', 'bash', { always: false }),
    'В проекте Мэтта ветки и worktree не используем: шаг коммитится в текущую ветку основной папки через /kit:step-done; '
    + 'прототип и исследования — в тикет и папку документов (work/<тема>/).');
  assert.equal(checkGit('git switch -c x', 'bash', { always: true }),
    'При автозаливке PhpStorm ветки и worktree нельзя: файлы с диска уезжают на сервер. Работай в текущей ветке основной папки.');
  // 47.8ж: совет — прямой, и страж его пропускает (цель -C вне проекта, см. ниже).
  assert.equal(checkGit('git bisect start', 'bash', { always: true }),
    'При автозаливке PhpStorm нельзя переписывать рабочую копию старыми версиями (bisect, stash, переход на другой коммит или ветку, '
    + 'reset --hard): файлы с диска сразу уезжают на сервер. Бисекцию и опыты со старыми версиями — в копии вне проекта: '
    + 'git clone <проект> <временная папка>, затем git -C <копия> bisect … (путь — абсолютный, без переменных).');
  assert.equal(checkGit('git merge feature', 'bash', { always: false }),
    'Коммит — только через /kit:step-done (kit-commit.js): в проекте Мэтта исполнитель не коммитит, тикет принимает общая сессия.');
});

// 47.8ж: совет «бисекция — в копии» страж больше не запрещает. Цель вызова — папка запуска (папка сессии, cd в подоболочке
// bash, затем -C по порядку), --git-dir и --work-tree (-c core.worktree): и репозиторий, и рабочая копия вне проекта
// (не в .claude/worktrees/) — перезапись не проверяется; коммит и ветки — при любой цели. Корень C:/proj, сессия в нём, автозаливка.
const GIT_478ZH = [ // [оболочка, команда, ожидание]
  ['bash', 'git clone C:/proj C:/Users/user/AppData/Local/Temp/bis', null],
  ['bash', 'git -C C:/Users/user/AppData/Local/Temp/bis bisect start HEAD v1', null],
  ['bash', 'git -C "C:/Users/user/AppData/Local/Temp/bis" bisect good && git -C C:/Users/user/AppData/Local/Temp/bis bisect bad', null],
  ['powershell', 'git -C "C:\\Temp\\bis" checkout 1a2b3c4', null],
  ['powershell', "git -C 'C:\\Temp\\bis' stash; git -C 'C:\\Temp\\bis' stash pop", null],
  ['bash', 'git -C /c/Temp/bis checkout 1a2b3c4', null],
  ['bash', 'git -C /cygdrive/c/Temp/bis switch master', null],
  ['bash', 'git -C D:/bis reset --hard v1', null],
  ['bash', 'git -C ../bis bisect start', null],
  ['bash', 'git -C C:/Temp -C bis bisect start', null],
  ['bash', '( cd C:/Users/user/AppData/Local/Temp/bis && git bisect start HEAD v1 && git bisect run npm test )', null],
  ['bash', '(cd /c/Temp/bis; git checkout 1a2b3c4)', null],
  ['bash', '( cd C:/Temp && cd bis && git bisect good )', null],
  ['bash', '( cd "C:/Temp/my bis" && ( git bisect good ) )', null],
  ['bash', '( cd C:/Temp/bis && git -C sub rebase origin/master )', null],
  ['bash', 'git --git-dir=C:/Temp/bis/.git --work-tree=C:/Temp/bis checkout 1a2b3c4', null],
  ['bash', 'git --git-dir C:/Temp/bis/.git --work-tree C:/Temp/bis checkout 1a2b3c4', null],
  // Своя цель: проект, его подпапка, worktree приложения, тот же путь в форме Git Bash, другим регистром, через «..».
  ['bash', 'git -C C:/proj bisect start', 'rewrite'],
  ['bash', 'git -C C:/PROJ/local checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git -C /c/proj checkout 1a2b3c4', 'rewrite'],
  ['powershell', 'git -C "C:\\proj\\.claude\\worktrees\\w1" checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git -C . bisect start', 'rewrite'],
  ['bash', 'git -C C:/Temp/bis -C C:/proj checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git -C C:/Temp/../proj checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git -C "" bisect start', 'rewrite'],
  // Не разобрать (переменные, ~user, cd -) — как своя.
  ['bash', 'git -C $TMP/bis bisect start', 'rewrite'],
  ['bash', 'git -C "${TEMP}/bis" bisect start', 'rewrite'],
  ['powershell', 'git -C $env:TEMP\\bis bisect start', 'rewrite'],
  ['powershell', 'git -C "%TEMP%\\bis" bisect start', 'rewrite'],
  ['bash', 'git -C ~other/bis bisect start', 'rewrite'],
  ['bash', '( cd - && git bisect start )', 'rewrite'],
  ['bash', '( cd $TMP/bis && git bisect start )', 'rewrite'],
  ['bash', '( pushd C:/Temp/bis && popd && git bisect start )', 'rewrite'],
  // Репозиторий или рабочая копия — в проекте: переписывается проект.
  ['bash', 'git -C C:/Temp/bis --work-tree=C:/proj checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git --work-tree=C:/Temp/bis checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git --git-dir=C:/Temp/bis/.git checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git --git-dir=C:/proj/.git --work-tree=C:/Temp/bis checkout 1a2b3c4', 'rewrite'],
  ['bash', 'git -C C:/Temp/bis -c core.worktree=C:/proj checkout 1a2b3c4', 'rewrite'],
  // cd действует только до конца своей подоболочки.
  ['bash', '( cd C:/Temp/bis && git bisect good ) && git bisect good', 'rewrite'],
  ['bash', '( cd C:/Temp/bis ); git bisect start', 'rewrite'],
  ['bash', '( cd C:/Temp/bis && git log ) && ( git checkout 1a2b3c4 )', 'rewrite'],
  ['bash', '( cd C:/Temp/bis && git -C C:/proj checkout 1a2b3c4 )', 'rewrite'],
  ['bash', '( cd C:/Temp/bis && cd C:/proj && git checkout 1a2b3c4 )', 'rewrite'],
  ['bash', '( cd C:/Temp/bis && ( cd C:/proj ) && git checkout 1a2b3c4 )', null],
  // Коммит и ветки — при любой цели: папка вне проекта может оказаться worktree этого же репозитория.
  ['bash', 'git -C C:/Temp/bis commit -m x', 'commit'],
  ['bash', '( cd C:/Temp/bis && git merge feature )', 'commit'],
  ['bash', 'git -C C:/Temp/bis checkout -b try', 'branch'],
  ['bash', 'git -C C:/Temp/bis worktree add ../w', 'branch'],
];
for (const [shell, cmd, want] of GIT_478ZH) {
  test(`checkGit 47.8ж ${shell}: ${JSON.stringify(cmd)} → ${want || 'разрешено'}`, () => {
    const reason = checkGit(cmd, shell, { always: true, root: 'C:/proj', cwd: 'C:/proj' });
    if (want === null) assert.equal(reason, null);
    else assert.match(reason, WANT_GIT[want]);
  });
}

test('checkGit 47.8ж: цель вне проекта без автозаливки — как раньше; без ctx.root и при сессии вне проекта', () => {
  const ctx = { root: 'C:/proj', cwd: 'C:/proj' };
  assert.equal(checkGit('git -C C:/Temp/bis bisect start', 'bash', { ...ctx, always: false }), null);
  assert.match(checkGit('git -C C:/Temp/bis switch -c x', 'bash', { ...ctx, always: false }), WANT_GIT['matt-branch']);
  // Без корня (прежние вызовы) — цель не разбирается: отказ, как до 47.8ж.
  assert.match(checkGit('git -C C:/Temp/bis bisect start', 'bash', { always: true }), WANT_GIT.rewrite);
  // Папка сессии — worktree приложения: относительный путь — от неё; без cwd — от корня.
  assert.match(checkGit('git bisect start', 'bash', { always: true, root: 'C:/proj', cwd: 'C:/proj/.claude/worktrees/w1' }), WANT_GIT.rewrite);
  assert.equal(checkGit('git -C ../../../../bis bisect start', 'bash', { always: true, root: 'C:/proj', cwd: 'C:/proj/.claude/worktrees/w1' }), null);
  assert.match(checkGit('git -C ../../bis bisect start', 'bash', { always: true, root: 'C:/proj', cwd: 'C:/proj/.claude/worktrees/w1' }), WANT_GIT.rewrite);
  assert.equal(checkGit('git -C ../bis bisect start', 'bash', { always: true, root: 'C:/proj' }), null);
  // ~ — домашняя папка (вне проекта).
  assert.equal(checkGit('git -C ~/bis bisect start', 'bash', { always: true, root: 'C:/proj', cwd: 'C:/proj' }), null);
});

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

const reasonOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;

test('guard-bash: ветки и worktree в проекте Мэтта запрещены при любой выкладке; причина — по автозаливке', () => {
  const always = withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' });
  assert.match(reasonOf(hook(always, 'git worktree add ../w')), /^\[kit\] При автозаливке PhpStorm ветки и worktree нельзя/);
  assert.match(reasonOf(hook(always, 'git checkout -b feature')), /ветки и worktree нельзя/);
  assert.equal(hook(always, 'git branch'), '');
  assert.equal(hook(always, 'git worktree list'), '');
  assert.match(reasonOf(hook(always, 'git commit -m x')), /\/kit:step-done/);
  // Мэтт без автозаливки (вручную, «PhpStorm on-demand» — не Always) — тоже отказ, причина про порядок Мэтта (до 47.8б — пропуск).
  const manual = withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' });
  assert.match(reasonOf(hook(manual, 'git checkout -b feature')), /^\[kit\] В проекте Мэтта ветки и worktree не используем/);
  assert.match(reasonOf(hook(manual, 'git switch -c x', 'PowerShell')), /^\[kit\] В проекте Мэтта ветки и worktree не используем/);
  assert.match(reasonOf(hook(withParams({ 'Выкладка': 'PhpStorm on-demand', 'Система Мэтта': 'да' }), 'git worktree add ../w')),
    /^\[kit\] В проекте Мэтта ветки и worktree не используем/);
  assert.equal(hook(manual, 'git branch -d old'), '');
  // Автозаливка без Мэтта, обычный kit-проект — ветки как раньше разрешены.
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'git checkout -b feature'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'вручную' }), 'git switch -c x'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'нет' }), 'git worktree add ../w'), '');
});

test('guard-bash: при автозаливке в проекте Мэтта — отказ на перезапись рабочей копии; вне автозаливки и вне Мэтта — пропуск', () => {
  const always = withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' });
  assert.match(reasonOf(hook(always, 'git bisect start && git bisect run npm test')), /^\[kit\] При автозаливке PhpStorm нельзя переписывать рабочую копию/);
  assert.match(reasonOf(hook(always, 'git checkout master')), /^\[kit\] При автозаливке PhpStorm нельзя переписывать/);
  assert.match(reasonOf(hook(always, 'git stash; git stash pop', 'PowerShell')), /^\[kit\] При автозаливке PhpStorm нельзя переписывать/);
  assert.equal(hook(always, 'git checkout -- a.php'), '');
  assert.equal(hook(always, 'git checkout HEAD -- a.php'), '');
  assert.equal(hook(always, 'git stash list'), '');
  assert.equal(hook(always, 'git bisect reset'), '');
  // Мэтт без автозаливки, автозаливка без Мэтта — как раньше.
  assert.equal(hook(withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' }), 'git checkout master'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'git reset --hard'), '');
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'git bisect start'), '');
});

test('guard-bash (47.8ж): при автозаливке в проекте Мэтта бисекция в копии вне проекта проходит; в проекте и его worktree — отказ', () => {
  const always = withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' });
  const copy = makeProject();
  const fwd = (p) => p.replace(/\\/g, '/');
  // Совет причины — прямой.
  assert.match(reasonOf(hook(always, 'git bisect start')), /в копии вне проекта: git clone <проект> <временная папка>, затем git -C <копия> bisect …/);
  assert.equal(hook(always, 'git clone "' + fwd(always) + '" "' + fwd(copy) + '"'), '');
  assert.equal(hook(always, 'git -C "' + fwd(copy) + '" bisect start HEAD 1a2b3c4'), '');
  assert.equal(hook(always, '( cd "' + fwd(copy) + '" && git bisect good && git bisect bad )'), '');
  assert.equal(hook(always, 'git -C "' + copy + '" checkout 1a2b3c4', 'PowerShell'), '');
  // Относительный путь — от папки сессии (cwd ввода): соседняя временная папка — вне проекта.
  assert.equal(hook(always, 'git -C ../' + path.basename(copy) + ' bisect start'), '');
  assert.match(reasonOf(hook(always, 'git -C "' + fwd(always) + '" bisect start')), /^\[kit\] При автозаливке PhpStorm нельзя переписывать/);
  assert.match(reasonOf(hook(always, 'git -C "' + fwd(path.join(always, '.claude', 'worktrees', 'w1')) + '" checkout 1a2b3c4')), /нельзя переписывать/);
  assert.match(reasonOf(hook(always, '( cd "' + fwd(copy) + '" && git bisect good ) && git bisect good')), /нельзя переписывать/);
  // Коммит в копии — как везде.
  assert.match(reasonOf(hook(always, 'git -C "' + fwd(copy) + '" commit -m x')), /^\[kit\] Коммит — только через/);
  // Worktree-сессия приложения: CLAUDE_PROJECT_DIR — основная папка, cwd — worktree: своя цель, отказ.
  const wt = path.join(always, '.claude', 'worktrees', 'w1');
  fs.mkdirSync(wt, { recursive: true });
  const r = runScript('guard-bash.js', { input: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git checkout 1a2b3c4' }, cwd: wt },
    env: { CLAUDE_PROJECT_DIR: always } });
  assert.match(reasonOf(r.stdout), /нельзя переписывать/);
});

test('guard-bash: merge, revert, cherry-pick, am в проекте Мэтта — причина коммита; в обычном kit-проекте — пропуск', () => {
  const manual = withParams({ 'Выкладка': 'вручную', 'Система Мэтта': 'да' });
  assert.match(reasonOf(hook(manual, 'git merge feature')), /^\[kit\] Коммит — только через \/kit:step-done/);
  assert.match(reasonOf(hook(manual, 'git revert --no-edit HEAD', 'PowerShell')), /^\[kit\] Коммит — только через/);
  assert.match(reasonOf(hook(manual, 'git cherry-pick --continue')), /^\[kit\] Коммит — только через/);
  assert.equal(hook(manual, 'git merge --abort'), '');
  assert.equal(hook(manual, 'git merge origin/master'), '', 'слияние удалённой ветки — поток kit с согласия пользователя');
  assert.equal(hook(manual, 'git rebase origin/master'), '', 'rebase вне автозаливки не трогаем');
  assert.match(reasonOf(hook(withParams({ 'Выкладка': 'PhpStorm Always', 'Система Мэтта': 'да' }), 'git pull --rebase')),
    /^\[kit\] При автозаливке PhpStorm нельзя переписывать/);
  assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), 'git rebase origin/master'), '', 'без Мэтта — как раньше');
  assert.equal(hook(manual, 'git pull --ff-only'), '');
  assert.equal(hook(manual, 'git push -u origin HEAD'), '');
  for (const cmd of ['git merge feature', 'git revert HEAD', 'git cherry-pick 1a2b3c4', 'git am x.patch']) {
    assert.equal(hook(withParams({ 'Выкладка': 'вручную' }), cmd), '', cmd);
    assert.equal(hook(withParams({ 'Выкладка': 'PhpStorm Always' }), cmd), '', cmd);
  }
});

// Раунд 2: идёт слияние (MERGE_HEAD) — завершение начатого слияния (git merge --continue, git commit без путей) проходит:
// иначе слияние удалённой ветки, на которое согласился пользователь, при конфликте нечем завершить.
test('checkGit: при слиянии (ctx.inMerge) — git merge --continue и git commit без путей проходят, остальное — как раньше', () => {
  let calls = 0;
  const merging = { always: false, inMerge: () => { calls++; return true; } };
  for (const cmd of ['git merge --continue', 'git commit --no-edit', 'git commit', 'git commit -m "Слияние с origin/master"',
    'git commit -q -F -', 'git commit --message=x', 'git -c core.quotepath=false commit --no-edit', 'git add a.php && git commit --no-edit']) {
    assert.equal(checkGit(cmd, 'bash', merging), null, cmd);
    assert.equal(checkGit(cmd, 'bash', { ...merging, always: true }), null, cmd + ' (автозаливка)');
  }
  assert.equal(checkGit('git commit --no-edit', 'powershell', merging), null);
  // Пути, «--», другие опции (-a заберёт и чужие правки), другие коммиты — отказ и при слиянии.
  for (const cmd of ['git commit -- a.php', 'git commit a.php', 'git commit --no-edit -- a.php', 'git commit -a', 'git commit --amend',
    'git commit --no-verify -m x', 'git merge feature', 'git merge --continue feature', 'git cherry-pick 1a2b3c4', 'git revert HEAD']) {
    assert.match(checkGit(cmd, 'bash', merging), /^Коммит — только через \/kit:step-done/, cmd);
  }
  // Слияния нет, проверка упала, ctx без inMerge — отказ.
  for (const ctx of [{ inMerge: () => false }, { inMerge: () => { throw new Error('x'); } }, { always: true }, undefined]) {
    assert.match(checkGit('git commit --no-edit', 'bash', ctx), /^Коммит — только через/);
    assert.match(checkGit('git merge --continue', 'bash', ctx), /^Коммит — только через/);
  }
  // Каталог git проверяется только для команды, которая и так получила бы отказ.
  calls = 0;
  for (const cmd of ['git status', 'git merge origin/master', 'git checkout -- a.php', 'git log', 'git switch -c x', 'git commit -- a.php']) {
    checkGit(cmd, 'bash', merging);
  }
  assert.equal(calls, 0);
});

test('guard-bash: временный репозиторий с MERGE_HEAD — завершение слияния проходит; без MERGE_HEAD и с путями — отказ', () => {
  const params = { 'Выкладка': 'вручную', 'Система Мэтта': 'да' };
  const dir = withParams(params);
  git(dir, 'init', '-q');
  const head = path.join(dir, '.git', 'MERGE_HEAD');
  // Без MERGE_HEAD — как раньше.
  assert.match(reasonOf(hook(dir, 'git commit --no-edit')), /^\[kit\] Коммит — только через/);
  assert.match(reasonOf(hook(dir, 'git merge --continue')), /^\[kit\] Коммит — только через/);
  fs.writeFileSync(head, '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d\n');
  assert.equal(hook(dir, 'git commit --no-edit'), '');
  assert.equal(hook(dir, 'git merge --continue'), '');
  assert.equal(hook(dir, 'git commit -m x', 'PowerShell'), '');
  assert.match(reasonOf(hook(dir, 'git commit -- a.php')), /^\[kit\] Коммит — только через/);
  assert.match(reasonOf(hook(dir, 'git commit -a')), /^\[kit\] Коммит — только через/);
  assert.match(reasonOf(hook(dir, 'git merge feature')), /^\[kit\] Коммит — только через/);
  // При автозаливке — так же.
  const always = withParams({ ...params, 'Выкладка': 'PhpStorm Always' });
  writeFiles(always, { '.git/MERGE_HEAD': '1a2b3c4\n' });
  assert.equal(hook(always, 'git commit --no-edit'), '');
  // .git — файл «gitdir: …» (worktree): MERGE_HEAD — в каталоге из него, относительный путь — от корня.
  const wt = withParams(params);
  const gitdir = makeProject({ 'HEAD': 'ref: refs/heads/master\n' });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ' + gitdir + '\n');
  assert.match(reasonOf(hook(wt, 'git commit --no-edit')), /^\[kit\] Коммит/);
  fs.writeFileSync(path.join(gitdir, 'MERGE_HEAD'), '1a2b3c4\n');
  assert.equal(hook(wt, 'git commit --no-edit'), '');
  const rel = withParams(params);
  writeFiles(rel, { '.gitdata/MERGE_HEAD': '1a2b3c4\n', '.git': 'gitdir: .gitdata\n' });
  assert.equal(hook(rel, 'git merge --continue'), '');
  // Битый .git-файл, MERGE_HEAD — папка, а не файл — как «слияния нет».
  const broken = withParams(params);
  writeFiles(broken, { '.git': 'не gitdir\n', 'MERGE_HEAD': 'x' });
  assert.match(reasonOf(hook(broken, 'git commit --no-edit')), /^\[kit\] Коммит/);
  const dirHead = withParams(params);
  fs.mkdirSync(path.join(dirHead, '.git', 'MERGE_HEAD'), { recursive: true });
  assert.match(reasonOf(hook(dirHead, 'git commit --no-edit')), /^\[kit\] Коммит/);
  // Обычный kit-проект с MERGE_HEAD — как раньше: пропуск всего.
  const plain = withParams({ 'Выкладка': 'вручную' });
  writeFiles(plain, { '.git/MERGE_HEAD': '1a2b3c4\n' });
  assert.equal(hook(plain, 'git commit -- a.php'), '');
});
