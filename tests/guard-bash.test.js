'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCommand } = require('../plugins/kit/scripts/guard-bash');
const { makeProject, runScript } = require('./helpers');
const { progressMd } = require('./fixtures');

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
  const kit = makeProject({ 'docs/progress.md': progressMd() });
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
