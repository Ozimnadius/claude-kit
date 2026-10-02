'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMsysRewritten, undoMsys } = require('../plugins/kit/scripts/lib/msys');

test('isMsysRewritten: Git Bash и MSYS2 переписали путь сервера — да; обычные пути — нет', () => {
  for (const p of ['C:/Program Files/Git/opt/php74/bin/php', 'C:\\Program Files\\Git\\var\\www\\x', 'D:/Tools/PortableGit/catalog/',
    'C:/msys64/opt/php74/bin/php', 'C:/msys32/var/www/x', 'c:/MSYS64/usr/bin']) {
    assert.equal(isMsysRewritten(p), true, p);
  }
  for (const p of ['/opt/php74/bin/php', '/var/www/x', 'C:/Users/user/site/a.php', 'C:/gitea/x', 'C:/msys6/x', 'php', '']) {
    assert.equal(isMsysRewritten(p), false, p);
  }
  // Git и msys — целое имя папки, а не хвост имени: legit, digit, MyGit — обычные папки.
  for (const p of ['C:/x/legit/y', 'C:/x/digit/y', 'C:/MyGit/x', 'C:/Users/user/NotGit/x', 'D:/work/msys6432/x']) {
    assert.equal(isMsysRewritten(p), false, p);
  }
});

test('undoMsys: возвращает путь как был, прочее не трогает', () => {
  assert.equal(undoMsys('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(undoMsys('C:/msys64/opt/php74/bin/php'), '/opt/php74/bin/php');
  assert.equal(undoMsys('C:\\Program Files\\Git\\personal\\'), '/personal\\');
  assert.equal(undoMsys('/catalog/'), '/catalog/');
  assert.equal(undoMsys('C:/Users/user/site/a.php'), 'C:/Users/user/site/a.php');
  assert.equal(undoMsys('C:/x/legit/y'), 'C:/x/legit/y');
  assert.equal(undoMsys('C:/Program Files/Git/opt/Git/x'), '/opt/Git/x', 'обрезается по первому месту, а не по последнему');
});
