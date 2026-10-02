'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeProject, writeFiles, tmpDir, runPhp, phpLint, hasPhp, PLUGIN } = require('./helpers');

const DIR = path.join(PLUGIN, 'skills', 'server', 'scripts');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const docRoot = (dir) => "<?php\n$_SERVER['DOCUMENT_ROOT'] = '" + dir.replace(/\\/g, '/') + "';\n";

function sub(src, re, value) {
  assert.match(src, re, 'в шаблоне нет строки ' + re);
  return src.replace(re, () => value);
}

function configure(src, cfg) {
  const str = (s) => "'" + s + "'";
  const list = (a) => '[' + a.map(str).join(', ') + ']';
  let out = sub(src, /^\$dryRun = .*$/m, '$dryRun = ' + (cfg.dryRun ? 'true' : 'false') + ';');
  out = sub(out, /^\$base = .*$/m, '$base = ' + str(cfg.base) + ';');
  out = sub(out, /^\$allowedMasks = .*$/m, '$allowedMasks = ' + list(cfg.masks) + ';');
  out = sub(out, /^\$files = \[[\s\S]*?\n\];/m, '$files = ' + list(cfg.files) + ';');
  out = sub(out, /^\$removeEmptyDirs = .*$/m, '$removeEmptyDirs = ' + (cfg.rmdirs ? 'true' : 'false') + ';');
  return sub(out, /^\$backupDir = .*$/m, '$backupDir = ' + str(cfg.backup.replace(/\\/g, '/')) + ';');
}

// Запуск delete-list.php: без предупреждений PHP, вывод — stdout.
// head — код до DOCUMENT_ROOT (например, `namespace kit;` и подмены copy/md5_file/date), prelude — после него,
// edit — правка настроенного шаблона.
function del(v, site, cfg, { head = '', prelude = '', edit = (s) => s } = {}) {
  const code = '<?php\n' + head + "$_SERVER['DOCUMENT_ROOT'] = '" + site.replace(/\\/g, '/') + "';\n"
    + 'error_reporting(E_ALL);\n' + prelude + edit(configure(read('delete-list.php'), { dryRun: true, rmdirs: false, ...cfg }));
  const r = runPhp(v, code);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '', 'предупреждения PHP');
  return r.stdout;
}

const canSymlink = (() => {
  const dir = tmpDir();
  try {
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'), 'file');
    return true;
  } catch (e) {
    return false; // Windows без прав на симлинки — EPERM
  }
})();
const backupDir = () => path.join(tmpDir(), 'kit-backup');
const TS = /^\d{8}-\d{6}$/;
function backups(dir) {
  const list = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.equal(list.length, 1, 'одна папка копий: ' + list.join(', '));
  assert.match(list[0], TS);
  return path.join(dir, list[0]);
}

for (const v of ['7.2', '7.4', '8.3']) {
  test(`скрипты консоли: без <?php и use, php -l на PHP ${v}`, { skip: !hasPhp(v) }, () => {
    for (const name of ['inventory.php', 'delete-list.php', 'check-files.php']) {
      const src = read(name);
      assert.doesNotMatch(src, /<\?php/, name);
      assert.doesNotMatch(src, /^\s*use\s+[\\A-Za-z]/m, name);
      const r = phpLint(v, '<?php\n' + src);
      assert.equal(r.code, 0, name + ': ' + r.out);
    }
  });
}

test('check-files.php: DOCUMENT_ROOT не задан — «стоп» без предупреждений PHP', { skip: !hasPhp('7.4') }, () => {
  const r = runPhp('7.4', '<?php\nerror_reporting(E_ALL);\n' + read('check-files.php'));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '', 'предупреждения PHP');
  assert.match(r.stdout, /DOCUMENT_ROOT не задан — стоп/);
  assert.doesNotMatch(r.stdout, /Итого/);
});

test('md5-check: ок, переводы строк, отличается, нет', { skip: !hasPhp('7.4') }, () => {
  const project = makeProject({ 'a.txt': 'one\ntwo\n', 'b.txt': 'x\ny\n', 'c.txt': 'same\n', 'd.txt': 'gone\n' });
  const server = writeFiles(tmpDir(), { 'a.txt': 'one\ntwo\n', 'b.txt': 'x\r\ny\r\n', 'c.txt': 'changed\n' });
  const gen = runScript('md5-check.js', { args: ['a.txt', 'b.txt', 'c.txt', 'd.txt'], cwd: project });
  assert.equal(gen.code, 0, gen.stderr);
  assert.doesNotMatch(gen.stdout, /<\?php/);
  assert.match(gen.stdout, /файлов: 4/);
  const r = runPhp('7.4', docRoot(server) + gen.stdout);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ок \| a\.txt\n/);
  assert.match(r.stdout, /ок \| b\.txt \(переводы строк отличаются\)/);
  assert.match(r.stdout, /ОТЛИЧАЕТСЯ \| c\.txt/);
  assert.match(r.stdout, /нет \| d\.txt/);
  assert.match(r.stdout, /Итого: ок 2, отличается 1, нет 1/);
});

test('md5-check: без файлов — код 1', () => {
  assert.equal(runScript('md5-check.js', { cwd: makeProject({}) }).code, 1);
});

for (const v of ['7.2', '7.4', '8.3']) {
  const opts = { skip: !hasPhp(v) };

  test(`delete-list (PHP ${v}): сухой прогон ничего не трогает; удаление — внутри базы, по маскам, с копией`, opts, () => {
    const site = writeFiles(tmpDir(), { 'css/a.scss': 'a', 'css/b.css': 'b', 'css/sub/d.scss': 'd', 'outside.scss': 'o' });
    const backup = backupDir();
    const cfg = { base: '/css', masks: ['*.scss'], files: ['a.scss', 'b.css', '../outside.scss', 'nope.scss', 'sub/d.scss'], rmdirs: true, backup };
    const dry = del(v, site, { ...cfg, dryRun: true });
    assert.match(dry, /СУХОЙ ПРОГОН/);
    assert.match(dry, /есть\s+a\.scss/);
    assert.match(dry, /ПРОПУЩЕН\s+b\.css/);
    assert.match(dry, /ПРОПУЩЕН\s+\.\.\/outside\.scss/);
    assert.match(dry, /нет\s+nope\.scss/);
    assert.match(dry, /Копии лягут в .*kit-backup/);
    assert.ok(fs.existsSync(path.join(site, 'css/a.scss')));
    assert.ok(!fs.existsSync(backup), 'сухой прогон не создаёт папку копий');
    const real = del(v, site, { ...cfg, dryRun: false });
    assert.match(real, /удалён\s+a\.scss/);
    assert.match(real, /удалён\s+sub\/d\.scss/);
    assert.match(real, /папка удалена/);
    assert.ok(!fs.existsSync(path.join(site, 'css/a.scss')));
    assert.ok(!fs.existsSync(path.join(site, 'css/sub')));
    assert.ok(fs.existsSync(path.join(site, 'css/b.css')));
    assert.ok(fs.existsSync(path.join(site, 'outside.scss')));
    const ts = backups(backup);
    assert.match(real, /Копии — в .*kit-backup.\d{8}-\d{6}\n/);
    assert.equal(fs.readFileSync(path.join(ts, 'css', 'a.scss'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(ts, 'css', 'sub', 'd.scss'), 'utf8'), 'd');
    assert.ok(!fs.existsSync(path.join(ts, 'css', 'b.css')));
  });

  test(`delete-list (PHP ${v}): корень сайта — одиночные файлы по имени удаляются, копия — в папке копий`, opts, () => {
    const site = writeFiles(tmpDir(), { 'debug.php': 'dbg', 'index.php': 'i', 'sub/debug.php': 's' });
    const backup = backupDir();
    for (const base of ['/', '', '/sub/..']) {
      const dry = del(v, site, { base, masks: ['debug.php'], files: ['debug.php'], backup });
      assert.match(dry, /есть\s+debug\.php/, base);
    }
    assert.ok(!fs.existsSync(backup));
    const real = del(v, site, { base: '/', masks: ['debug.php'], files: ['/debug.php'], backup, dryRun: false });
    assert.match(real, /удалён\s+\/debug\.php/);
    assert.ok(!fs.existsSync(path.join(site, 'debug.php')));
    assert.ok(fs.existsSync(path.join(site, 'index.php')));
    assert.ok(fs.existsSync(path.join(site, 'sub', 'debug.php')));
    assert.equal(fs.readFileSync(path.join(backups(backup), 'debug.php'), 'utf8'), 'dbg');
  });

  test(`delete-list (PHP ${v}): корень — путь с папкой, «..», «.», обратный слеш, $removeEmptyDirs — стоп, не удалено ничего`, opts, () => {
    const site = writeFiles(tmpDir(), { 'debug.php': 'd', 'sub/x.php': 'x' });
    const backup = backupDir();
    for (const files of [['debug.php', 'sub/x.php'], ['../x.php'], ['..'], ['.'], ['sub\\x.php'], ['']]) {
      const out = del(v, site, { base: '/', masks: ['*.php'], files, backup, dryRun: false });
      assert.match(out, /стоп/, files.join(', '));
      assert.doesNotMatch(out, /удалён/);
    }
    const out = del(v, site, { base: '/', masks: ['*.php'], files: ['debug.php'], backup, dryRun: false, rmdirs: true });
    assert.match(out, /removeEmptyDirs.*стоп|стоп[\s\S]*removeEmptyDirs/);
    assert.ok(fs.existsSync(path.join(site, 'debug.php')));
    assert.ok(fs.existsSync(path.join(site, 'sub', 'x.php')));
    assert.ok(!fs.existsSync(backup));
  });

  test(`delete-list (PHP ${v}): стоп-лист — в корне и в любой папке, без учёта регистра`, opts, () => {
    const inRoot = ['index.php', 'INDEX.PHP', '.htaccess', 'urlrewrite.php', '.access.php', 'robots.txt', '404.php',
      '.section.php', '.top.menu.php', '.left.menu_ext.php', 'sitemap.xml', 'bitrix', 'upload', 'local'];
    const site = writeFiles(tmpDir(), {
      'index.php': 'i', '.htaccess': 'h', 'urlrewrite.php': 'u', '.access.php': 'a', 'robots.txt': 'r', '404.php': 'n',
      '.section.php': 's', '.top.menu.php': 'm', '.left.menu_ext.php': 'e', 'sitemap.xml': 'x',
      'bitrix/.settings.php': 'b', 'upload/f.jpg': 'f', 'local/php_interface/init.php': 'p',
      'docs/.htaccess': 'd', 'personal/.access.php': 'p', 'local/templates/t/index.php': 't',
    });
    const backup = backupDir();
    const stopped = /Ошибки в настройках — стоп[\s\S]*в стоп-листе — этим скриптом не удаляется/;
    for (const name of inRoot) {
      const out = del(v, site, { base: '/', masks: [name], files: [name], backup, dryRun: false });
      assert.match(out, stopped, name);
    }
    for (const [base, name] of [['/docs', '.htaccess'], ['/personal', '.access.php'], ['/bitrix', '.settings.php']]) {
      const out = del(v, site, { base, masks: [name], files: [name], backup, dryRun: false });
      assert.match(out, stopped, base + '/' + name);
    }
    for (const rel of ['index.php', '.htaccess', 'urlrewrite.php', 'bitrix/.settings.php', 'docs/.htaccess', 'personal/.access.php']) {
      assert.ok(fs.existsSync(path.join(site, rel)), rel);
    }
    assert.ok(!fs.existsSync(backup));
    const tpl = del(v, site, { base: '/local/templates/t', masks: ['index.php'], files: ['index.php'], backup });
    assert.match(tpl, /есть\s+index\.php/, 'index.php вне корня — не в стоп-листе');
  });

  test(`delete-list (PHP ${v}): маски — бэкапы апдейтера *.php.back2.9.2 удаляются, соседи — нет; «*», «*.*», с папкой — стоп`, opts, () => {
    const site = writeFiles(tmpDir(), {
      'catalog/_index.php.back2.9.2': 'b', 'catalog/_index.php': 'p', 'catalog/jquery.backstretch.min.js': 'j',
      '_404.php.back2.9.2': 'r', 'a.scss': 'a',
    });
    const backup = backupDir();
    const cfg = { base: '/catalog', masks: ['*.php.back*'], files: ['_index.php.back2.9.2', '_index.php', 'jquery.backstretch.min.js'], backup };
    const dry = del(v, site, cfg);
    assert.match(dry, /есть\s+_index\.php\.back2\.9\.2/);
    assert.match(dry, /ПРОПУЩЕН\s+_index\.php — /);
    assert.match(dry, /ПРОПУЩЕН\s+jquery\.backstretch\.min\.js/);
    const real = del(v, site, { ...cfg, dryRun: false });
    assert.match(real, /удалён\s+_index\.php\.back2\.9\.2/);
    assert.ok(!fs.existsSync(path.join(site, 'catalog/_index.php.back2.9.2')));
    assert.ok(fs.existsSync(path.join(site, 'catalog/_index.php')));
    assert.ok(fs.existsSync(path.join(site, 'catalog/jquery.backstretch.min.js')));
    const root = del(v, site, { base: '/', masks: ['*.back2.9.2'], files: ['_404.php.back2.9.2'], backup, dryRun: false });
    assert.match(root, /удалён\s+_404\.php\.back2\.9\.2/);
    assert.ok(!fs.existsSync(path.join(site, '_404.php.back2.9.2')));
    for (const masks of [['*'], ['*.*'], ['?*'], ['**'], ['.*'], ['sub/*.php'], [''], ['*.scss', '*']]) {
      const out = del(v, site, { base: '/', masks, files: ['a.scss'], backup, dryRun: false });
      assert.match(out, /стоп/, masks.join(', '));
    }
    assert.ok(fs.existsSync(path.join(site, 'a.scss')));
  });

  test(`delete-list (PHP ${v}): выход за базу через «..» и junction — пропуск, база вне корня — стоп`, opts, () => {
    const outside = writeFiles(tmpDir(), { 'secret.scss': 's' });
    const site = writeFiles(tmpDir(), { 'css/a.scss': 'a' });
    fs.symlinkSync(outside, path.join(site, 'css', 'out'), 'junction');
    fs.symlinkSync(outside, path.join(site, 'outlink'), 'junction');
    fs.symlinkSync(outside, path.join(site, 'jbase'), 'junction');
    const backup = backupDir();
    const up = '../../' + path.basename(outside) + '/secret.scss';
    const out = del(v, site, { base: '/css', masks: ['*.scss'], files: [up, 'out/secret.scss'], backup, dryRun: false });
    assert.match(out, new RegExp('ПРОПУЩЕН\\s+' + up.replace(/\./g, '\\.')));
    assert.match(out, /ПРОПУЩЕН\s+out\/secret\.scss/);
    const root = del(v, site, { base: '/', masks: ['outlink'], files: ['outlink'], backup, dryRun: false });
    assert.match(root, /ПРОПУЩЕН\s+outlink/);
    for (const base of ['/..', '/jbase']) {
      assert.match(del(v, site, { base, masks: ['*.scss'], files: ['secret.scss'], backup, dryRun: false }), /стоп/, base);
    }
    assert.ok(fs.existsSync(path.join(outside, 'secret.scss')));
    assert.ok(fs.existsSync(path.join(site, 'css', 'a.scss')));
    assert.ok(!fs.existsSync(backup));
  });

  test(`delete-list (PHP ${v}): симлинк на файл не удаляется — ни он, ни цель`, { skip: !hasPhp(v) ? true : !canSymlink && 'нет прав на симлинки (Windows)' }, () => {
    const site = writeFiles(tmpDir(), { 'css/a.scss': 'a' });
    fs.symlinkSync(path.join(site, 'css', 'a.scss'), path.join(site, 'css', 'l.scss'), 'file');
    const backup = backupDir();
    const out = del(v, site, { base: '/css', masks: ['*.scss'], files: ['l.scss'], backup, dryRun: false });
    assert.match(out, /ПРОПУЩЕН\s+l\.scss — симлинк/);
    assert.ok(fs.lstatSync(path.join(site, 'css', 'l.scss')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(site, 'css', 'a.scss')));
    assert.ok(!fs.existsSync(backup));
  });

  test(`delete-list (PHP ${v}): копия не удалась, не сверилась или уже есть — файл на месте; места нет — стоп`, opts, () => {
    const cfg = { base: '/', masks: ['debug.php'], files: ['debug.php'], dryRun: false };
    const fakes = {
      'copy не удался': 'function copy($a, $b) { return false; }',
      'копия с другим содержимым': 'function copy($a, $b) { return \\file_put_contents($b, \\str_repeat("x", \\filesize($a))) !== false; }',
      'md5_file не работает': 'function md5_file($f) { return false; }',
    };
    for (const [what, fake] of Object.entries(fakes)) {
      const site = writeFiles(tmpDir(), { 'debug.php': 'dbg' });
      const backup = backupDir();
      const out = del(v, site, { ...cfg, backup }, { head: 'namespace kit;\n' + fake + '\n' });
      assert.match(out, /НЕ УДАЛЁН\s+debug\.php — копия не удалась/, what);
      assert.equal(fs.readFileSync(path.join(site, 'debug.php'), 'utf8'), 'dbg', what);
      assert.ok(!fs.existsSync(backup), what + ': частичная копия и пустые папки убраны');
    }
    const site = writeFiles(tmpDir(), { 'debug.php': 'dbg' });
    const backup = backupDir();
    writeFiles(backup, { '20260101-000000/debug.php': 'old' });
    const fixedDate = { head: 'namespace kit;\nfunction date($f) { return "20260101-000000"; }\n' };
    const out = del(v, site, { ...cfg, backup }, fixedDate);
    assert.match(out, /НЕ УДАЛЁН\s+debug\.php — копия уже есть/);
    assert.equal(fs.readFileSync(path.join(backup, '20260101-000000', 'debug.php'), 'utf8'), 'old');
    assert.ok(fs.existsSync(path.join(site, 'debug.php')));
    const noSpace = { head: 'namespace kit;\nfunction disk_free_space($d) { return 1000.0; }\n' };
    const dry = del(v, site, { ...cfg, backup: backupDir(), dryRun: true }, noSpace);
    assert.match(dry, /есть\s+debug\.php[\s\S]*Места для копий не хватит.*настоящий запуск остановится/);
    const real = del(v, site, { ...cfg, backup: backupDir() }, noSpace);
    assert.match(real, /Места для копий не хватит.* — стоп, ничего не удалено/);
    assert.ok(fs.existsSync(path.join(site, 'debug.php')));
  });

  test(`delete-list (PHP ${v}): $dryRun не строго false — сухой прогон; неверные типы и управляющие символы — стоп`, opts, () => {
    const site = writeFiles(tmpDir(), { 'debug.php': 'dbg' });
    const cfg = { base: '/', masks: ['debug.php'], files: ['debug.php'], backup: backupDir(), dryRun: false };
    for (const value of ['0', "'false'", 'null', "''"]) {
      const out = del(v, site, cfg, { edit: (s) => s.replace('$dryRun = false;', '$dryRun = ' + value + ';') });
      assert.match(out, /СУХОЙ ПРОГОН[\s\S]*есть\s+debug\.php/, value);
    }
    for (const [what, edit] of [
      ['$base = null', (s) => s.replace("$base = '/';", '$base = null;')],
      ['$base с NUL', (s) => s.replace("$base = '/';", '$base = "/\\0";')],
      ['$files с NUL', (s) => s.replace("$files = ['debug.php'];", '$files = ["debug.php\\0"];')],
      ['$files — строка', (s) => s.replace("$files = ['debug.php'];", "$files = 'debug.php';")],
      ['$allowedMasks — строка', (s) => s.replace("$allowedMasks = ['debug.php'];", "$allowedMasks = 'debug.php';")],
      ['$backupDir — массив', (s) => s.replace(/^\$backupDir = .*$/m, "$backupDir = ['/tmp'];")],
    ]) {
      const out = del(v, site, cfg, { edit });
      assert.match(out, /стоп/, what);
      assert.doesNotMatch(out, /удалён/, what);
    }
    assert.ok(fs.existsSync(path.join(site, 'debug.php')));
  });

  test(`delete-list (PHP ${v}): папка копий — вне сайта и абсолютная, «~» — домашняя папка; не создать — стоп`, opts, () => {
    const site = writeFiles(tmpDir(), { 'debug.php': 'dbg' });
    const cfg = { base: '/', masks: ['debug.php'], files: ['debug.php'], dryRun: false };
    const blocker = writeFiles(tmpDir(), { file: 'x' });
    for (const backup of [path.join(site, 'kit-backup'), site, 'kit-backup', '',
      tmpDir() + '/a/../b', path.join(blocker, 'file', 'kit-backup')]) {
      for (const dryRun of [true, false]) {
        const out = del(v, site, { ...cfg, backup, dryRun });
        assert.match(out, /стоп/, backup);
        assert.doesNotMatch(out, /удалён|есть/, backup);
      }
    }
    const noHome = del(v, site, { ...cfg, backup: '~/kit-backup' }, { prelude: "putenv('HOME');\n" });
    if (process.platform === 'win32') assert.match(noHome, /домашн.*стоп|стоп[\s\S]*домашн/);
    assert.ok(fs.existsSync(path.join(site, 'debug.php')));
    assert.ok(!fs.existsSync(path.join(site, 'kit-backup')));
    const home = tmpDir();
    const out = del(v, site, { ...cfg, backup: '~/kit-backup' }, { prelude: "putenv('HOME=" + home.replace(/\\/g, '/') + "');\n" });
    assert.match(out, /удалён\s+debug\.php/);
    assert.equal(fs.readFileSync(path.join(backups(path.join(home, 'kit-backup')), 'debug.php'), 'utf8'), 'dbg');
  });
}
