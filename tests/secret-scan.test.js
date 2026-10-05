'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { gitRepo, git, writeFiles, runScript, makeProject } = require('./helpers');
const { paramsMd, ALPHA } = require('./fixtures');
const { scanLine } = require('../plugins/kit/scripts/secret-scan');

const scan = (dir, ...args) => runScript('secret-scan.js', { args, cwd: dir });

test('--cached: вебхук Б24 в добавленной строке — код 1, значение замаскировано', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'a.php': "<?php\n$hook = 'https://x.bitrix24.ru/rest/1/abcdef123456/';\n" });
  git(dir, 'add', 'a.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /a\.php:2: вебхук Битрикс24 — abc…\(12 симв\.\)/);
  assert.doesNotMatch(r.stdout, /abcdef123456/);
});

test('--cached: пароль с цифрами — находка', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'cfg.php': "<?php\nreturn ['password' => 'Qw3rty!x9'];\n" });
  git(dir, 'add', 'cfg.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /cfg\.php:2: пароль или токен — Qw3…\(9 симв\.\)/);
});

test('--cached: подписи, переменные и ключ из переменной — не секреты', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'lang.php': "<?php\n$MESS['PASSWORD'] = 'Пароль';\n$arr = ['PASSWORD' => 'Пароль', 'token' => $token];\n$url = '?apikey=' . $key;\n" });
  git(dir, 'add', 'lang.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /чисто/);
});

test('--cached: define с паролем — находка; список имён полей через запятую — нет', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, {
    'const.php': "<?php\ndefine('SMTP_PASSWORD', 'Qw3rty!x9');\n",
    'fields.php': "<?php\n$f = array('password', 'login');\n$s = array(\"EMAIL\", \"PASSWORD\", \"CONFIRM_PASSWORD\");\n$t = ['token', 'refresh_token'];\n",
    'ajax.js': "xhr.setRequestHeader('X-Auth-Token', 'application/json');\n",
  });
  git(dir, 'add', 'const.php', 'fields.php', 'ajax.js');
  const r = scan(dir, '--cached', '--', 'const.php');
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /const\.php:2: пароль или токен — Qw3…\(9 симв\.\)/);
  const f = scan(dir, '--cached', '--', 'fields.php', 'ajax.js');
  assert.equal(f.code, 0, f.stdout);
  // Через запятую — секрет только значение с цифрой.
  assert.equal(scanLine("define('DB_PASSWORD', 'long_db_password_2026');", []).length, 1);
  assert.equal(scanLine("define('DB_PASSWORD', 'long_db_password');", []).length, 0);
});

test('=>, =, : — значения из латиницы с `_` остаются находкой (регрессия 6.2а)', () => {
  for (const line of [
    "$DBPassword = 'bitrix_secret_db';",
    "$c = ['password' => 'My_Secret_Password'];",
    "$c = ['password' => 'MySecretPassword'];",
    "token: 'oauth_refresh_token_value'",
  ]) {
    assert.equal(scanLine(line, []).length, 1, line);
  }
  assert.equal(scanLine("$MESS['PASSWORD'] = 'Пароль';", []).length, 0);
  assert.equal(scanLine("xhr.setRequestHeader('X-Auth-Token', 'application/json');", []).length, 0);
  assert.equal(scanLine('$s = array("EMAIL", "PASSWORD", "CONFIRM_PASSWORD");', []).length, 0);
  assert.equal(scanLine("define('SMTP_PASSWORD', 'Qw3rty!x9');", []).length, 1);
});

test('в строке проверяются все совпадения: отклонённый список полей не прячет секрет дальше', () => {
  for (const line of [
    '{"fields":["password","password_confirm"],"api_key":"AbC123xyz789"}',
    "$req = array('PASSWORD', 'CONFIRM_PASSWORD'); $cfg = array('token' => 'Secr3tValue123');",
    "$f = ['password' => 'Пароль', 'token' => 'abc123def'];",
    "$f = ['password', 'api_key' => 'Abc123456'];",
  ]) {
    const found = scanLine(line, []);
    assert.equal(found.length, 1, line + ' → ' + JSON.stringify(found));
    assert.match(found[0], /^пароль или токен — /);
  }
  assert.deepEqual(scanLine('$s = array("EMAIL", "PASSWORD", "CONFIRM_PASSWORD");', []), []);
  // По одной находке на шаблон и строку.
  assert.equal(scanLine("$a = ['password' => 'Secr3t111', 'token' => 'Secr3t222'];", []).length, 1);
});

// Стандартный шаблон Битрикса bitrix:sale.order.ajax (v1/template.php:675, v2/template.php:644).
const SOA_MAPS = '<script src="<?=$scheme?>://api-maps.yandex.ru/2.1.50/?apikey=<?=$apiKey?>&load=package.full&lang=<?=$locale?>"></script>';
const REAL_KEY = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';

test('ключ в URL: вывод PHP и подстановки шаблонов — не секрет, настоящий ключ — находка', () => {
  for (const line of [
    SOA_MAPS,
    '?apikey=<?echo $apiKey?>',
    '?api_key={{apiKey}}',
    '?apikey={$arParams.API_KEY}',
    '"?apikey={$this->apiKey}"',
    '?apikey=<%=apiKey%>',
    '?apikey=#API_KEY#&lang=ru',
    '`?apikey=${API_KEY}`',
  ]) {
    assert.deepEqual(scanLine(line, []), [], line);
  }
  const real = '<script src="https://api-maps.yandex.ru/2.1/?apikey=' + REAL_KEY + '&lang=ru_RU"></script>';
  assert.deepEqual(scanLine(real, []), ['ключ в URL — 0a1…(36 симв.)']);
  // Настоящий ключ рядом с выводом PHP в той же строке.
  assert.equal(scanLine('<?=$scheme?>://api-maps.yandex.ru/2.1/?apikey=' + REAL_KEY + '&lang=<?=$locale?>', []).length, 1);
  // `%` в URL — не подстановка: ключ бывает закодирован; `#` без макроса — литерал.
  // Значения склеены, чтобы сам тест не был находкой secret-scan при коммите.
  assert.equal(scanLine('?apikey=' + '%2BAbc123def456', []).length, 1);
  assert.equal(scanLine('?apikey=' + '#Abc123def456', []).length, 1);
  // HTML-экранированный URL: перед `apikey` стоит `;` от `&amp;`.
  assert.equal(scanLine('<script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU&amp;apikey=' + REAL_KEY + '"></script>', []).length, 1);
  assert.deepEqual(scanLine('<script src="/2.1/?lang=ru_RU&amp;apikey=<?=$apiKey?>"></script>', []), []);
});

test('пароль или токен: вывод PHP и подстановки шаблонов — не секрет, литерал — находка', () => {
  for (const line of [
    "'token' => '<?=$token?>'",
    '"token" => "{$arParams[\'TOKEN\']}"',
    "password: '<%=password%>'",
    "'api_key' => '{!!$apiKey!!}'",
    "'PASSWORD' => '#PASSWORD#'",
  ]) {
    assert.deepEqual(scanLine(line, []), [], line);
  }
  for (const v of ['#Qw3rty!x9', '#ADMIN#2026']) {
    assert.equal(scanLine("'password' => '" + v + "'", []).length, 1, v);
  }
});

test('--cached: шаблон sale.order.ajax с картами Яндекса — чисто; настоящий ключ в URL — находка', () => {
  const tpl = 'local/templates/t/components/bitrix/sale.order.ajax/.default/template.php';
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { [tpl]: '<?php $apiKey = $arParams["API_KEY"]; ?>\n' + SOA_MAPS + '\n', 'maps.php': '<script src="https://api-maps.yandex.ru/2.1/?apikey=' + REAL_KEY + '"></script>\n' });
  git(dir, 'add', tpl, 'maps.php');
  const ok = scan(dir, '--cached', '--', tpl);
  assert.equal(ok.code, 0, ok.stdout);
  const r = scan(dir, '--cached', '--', 'maps.php');
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /maps\.php:1: ключ в URL — 0a1…\(36 симв\.\)/);
  assert.doesNotMatch(r.stdout, new RegExp(REAL_KEY));
});

test('.env*: KEY=value без кавычек — «пароль или токен (без кавычек)»', () => {
  assert.deepEqual(scanLine('DB_PASSWORD=Secr3t123', [], '.env.example'), ['пароль или токен (без кавычек) — Sec…(9 симв.)']);
  assert.equal(scanLine('export API_KEY=abc123def456', [], 'local/.env.production').length, 1);
  assert.equal(scanLine('DB_PASSWORD="Secr3t123"', [], '.env.example').length, 1, 'кавычки — одна находка, без дубля');
  for (const line of ['DB_PASSWORD=', 'DB_PASSWORD=changeme', '# DB_PASSWORD=Secr3t123', 'DB_HOST=localhost', 'API_TOKEN=${API_TOKEN_FROM_CI}',
    'OAUTH_TOKEN_URL=https://auth.example.com/oauth/token', 'PASSWORD_RESET_URL=/reset-password']) {
    assert.deepEqual(scanLine(line, [], '.env.example'), [], line);
  }
  // Адрес с учётными данными — остаётся находкой, в том числе под ключом …_URL.
  assert.equal(scanLine('SERVICE_TOKEN=https://user:Secr3t123@example.com/', [], '.env.example').length, 1);
  assert.equal(scanLine('SERVICE_TOKEN_URL=https://user:Secr3t123@example.com/', [], '.env.example').length, 1);
  // Решает имя ключа, а не начало значения: секрет, начинающийся с «/», и секретный URL под обычным ключом — находки.
  assert.equal(scanLine('AWS_SECRET_ACCESS_KEY=' + '/wJalrXUtnFEMI/K7MDENG/bPxRfiCY', [], '.env.example').length, 1);
  assert.equal(scanLine('SLACK_TOKEN=' + 'https://hooks.slack.com/services/T000/B000/XXXXXXXX', [], '.env.example').length, 1);
  assert.deepEqual(scanLine('DB_PASSWORD=Secr3t123', [], 'config.txt'), [], 'вне .env*, YAML, INI, conf, TOML шаблон не действует');
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { '.env.example': 'DB_HOST=localhost\nDB_PASSWORD=Secr3t123\n', 'empty/.env.example': 'DB_PASSWORD=\nDB_PASSWORD=changeme\n' });
  const files = scan(dir, '--files', '.env.example', 'empty/.env.example');
  assert.equal(files.code, 1, files.stdout);
  assert.match(files.stdout, /^ {2}\.env\.example:2: пароль или токен \(без кавычек\) — Sec…\(9 симв\.\)$/m);
  assert.doesNotMatch(files.stdout, /empty\/\.env\.example/);
  git(dir, 'add', '.env.example', 'empty/.env.example');
  const cached = scan(dir, '--cached');
  assert.equal(cached.code, 1, cached.stdout);
  assert.match(cached.stdout, /\.env\.example:2: пароль или токен \(без кавычек\)/);
  assert.match(scan(dir, '--all').stdout, /\.env\.example:2: пароль или токен \(без кавычек\)/);
});

test('YAML, INI, conf, TOML: ключ и значение без кавычек — находка (К33)', () => {
  // Значение склеено, чтобы сам тест не был находкой secret-scan при коммите.
  const val = 'hunter' + '2hunter2';
  for (const [file, line] of [
    ['docker-compose.yml', '    POSTGRES_PASSWORD: ' + val],
    ['docker-compose.yml', '      - MYSQL_ROOT_PASSWORD=' + val],
    ['config/app.yaml', 'api_key: ' + val],
    ['php.ini', 'password = ' + val],
    ['db.conf', 'db.secret=' + val],
    ['app.properties', 'auth.token = ' + val],
    ['app.cfg', 'TOKEN=' + val],
    ['config.yml', 'token_url: https://user:' + val + '@db/app'],
  ]) {
    assert.equal(scanLine(line, [], file).length, 1, file + ': ' + line);
  }
  for (const [file, line] of [
    ['docker-compose.yml', '    POSTGRES_PASSWORD: ${DB_PASSWORD}'],
    ['docker-compose.yml', '    POSTGRES_PASSWORD_FILE: /run/secrets/db_password'],
    ['config.yml', 'password: password'],
    ['config.yml', 'password: changeme'],
    ['config.yml', 'token: null'],
    ['config.yml', 'token: !vault |'],
    ['config.yml', 'password: *default'],
    ['config.yml', 'secret: {{ vault_secret }}'],
    ['config.yml', 'password:'],
    ['config.yml', '# password: ' + val],
    ['k8s.yaml', '  secretName: tls-secret-2024'],
    ['notes.txt', 'password: ' + val],
  ]) {
    assert.deepEqual(scanLine(line, [], file), [], file + ': ' + line);
  }
});

test('--cached: добавленная строка «++ …» не подменяет имя файла в диффе (К36)', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { '.env.example': '++ x\nDB_PASSWORD=Secr3t123\n', 'plain.md': '++ item\nтекст\n' });
  git(dir, 'add', '.env.example', 'plain.md');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /\.env\.example:2: пароль или токен \(без кавычек\)/);
  assert.doesNotMatch(r.stdout, /^ {2}(item|x):/m);
});

test('--cached -- пути: проверяются только переданные', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'a.php': "<?php $p = ['password' => 'Secr3tValue'];\n", 'b.php': '<?php echo 1;\n' });
  git(dir, 'add', 'a.php', 'b.php');
  assert.equal(scan(dir, '--cached', '--', 'b.php').code, 0);
  assert.equal(scan(dir, '--cached', '--', 'a.php').code, 1);
});

test('шаблоны из параметра «Секреты»; строка параметров в CLAUDE.md не считается', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  writeFiles(dir, { 'api.php': '<?php\n$c = ["API_KEY" => "k-123456"];\n' });
  git(dir, 'add', 'api.php');
  const r = scan(dir, '--cached');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /api\.php:2: шаблон «"API_KEY" =>»/);
  const all = scan(dir, '--all');
  assert.doesNotMatch(all.stdout, /CLAUDE\.md/);
});

test('запрещённые пути: базовые и из параметра «Не коммитить» с исключением', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  writeFiles(dir, { 'bitrix/.settings.php': '<?php return [];\n', 'local/x.php.back1': 'x', 'upload/docs/a.txt': 'ok', 'upload/iblock/b.txt': 'b' });
  const r = scan(dir, '--files', 'bitrix/.settings.php', 'local/x.php.back1', 'upload/docs/a.txt', 'upload/iblock/b.txt');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /bitrix\/\.settings\.php: запрещённый путь/);
  assert.match(r.stdout, /local\/x\.php\.back1: запрещённый путь \(\*\.back\*\)/);
  assert.match(r.stdout, /upload\/iblock\/b\.txt: запрещённый путь \(upload\/ \(кроме upload\/docs\/\)\)/);
  assert.doesNotMatch(r.stdout, /upload\/docs\/a\.txt/);
});

test('--paths: только запрещённые пути — файлы не читаются и могут не существовать (К40)', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  // Ни одного из этих файлов на диске нет: режим смотрит только на пути.
  const bad = scan(dir, '--paths', '--', '.env', 'local/x.php.back1', 'upload/iblock/b.txt', 'kit-exec.php', '.claude/docs/visual/a.png', '.claude/kit-inbox.jsonl', 'ok.php');
  assert.equal(bad.code, 1, bad.stdout);
  for (const p of ['\\.env', 'local\\/x\\.php\\.back1', 'upload\\/iblock\\/b\\.txt', 'kit-exec\\.php', '\\.claude\\/docs\\/visual\\/a\\.png', '\\.claude\\/kit-inbox\\.jsonl']) {
    assert.match(bad.stdout, new RegExp('^ {2}' + p + ': запрещённый путь', 'm'), p);
  }
  assert.doesNotMatch(bad.stdout, /ok\.php/);
  const ok = scan(dir, '--paths', '.env.example', 'local/templates/t/components/bitrix/a.php', 'upload/docs/a.txt', 'sub/kit-exec.php');
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /чисто \(файлов: 4\)/);
  // Содержимое не проверяется: строка с паролем в существующем файле — не находка режима --paths.
  writeFiles(dir, { 'cfg.php': "<?php return ['password' => '" + 'Qw3rty' + "!x9'];\n" });
  assert.equal(scan(dir, '--paths', 'cfg.php').code, 0);
  assert.equal(scan(dir, '--paths').code, 2, 'без путей — код 2');
  assert.equal(scan(dir, '--paths', '--').code, 2, 'только «--» — код 2');
});

test('снимки docs/visual — базовый запрет (от корня проекта)', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'docs/visual/before/admin/desktop/home.txt': 'x', 'docs/visualize.md': 'x', 'local/docs/visual/a.txt': 'x' });
  const r = scan(dir, '--files', 'docs/visual/before/admin/desktop/home.txt', 'docs/visualize.md', 'local/docs/visual/a.txt');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /docs\/visual\/before\/admin\/desktop\/home\.txt: запрещённый путь \(docs\/visual\)/);
  assert.doesNotMatch(r.stdout, /visualize|local\/docs/);
});

test('снимки .claude/docs/visual — базовый запрет; остальная .claude/docs — нет', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { '.claude/docs/visual/before/admin/desktop/home.txt': 'x', '.claude/docs/progress.md': '# журнал', '.claude/docs/work/plan.md': 'план' });
  const r = scan(dir, '--files', '.claude/docs/visual/before/admin/desktop/home.txt', '.claude/docs/progress.md', '.claude/docs/work/plan.md');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\.claude\/docs\/visual\/before\/admin\/desktop\/home\.txt: запрещённый путь \(\.claude\/docs\/visual\)/);
  assert.doesNotMatch(r.stdout, /progress\.md|plan\.md/);
});

test('kit-exec.php (файл-канал /kit:server) — базовый запрет только в корне проекта', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'kit-exec.php': '<?php\n', 'local/kit-exec.php': '<?php\n', 'kit-exec.php.md': 'x', 'my-kit-exec.php': '<?php\n' });
  const r = scan(dir, '--files', 'kit-exec.php', 'local/kit-exec.php', 'kit-exec.php.md', 'my-kit-exec.php');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^\s+kit-exec\.php: запрещённый путь \(\/kit-exec\.php\)/m);
  assert.doesNotMatch(r.stdout, /local\/kit-exec|kit-exec\.php\.md|my-kit-exec/);
});

test('.env.example — не запрещённый путь, .env и .env.local — запрещённые', () => {
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { '.env.example': 'DB_PASSWORD=\n', '.env.local': 'X=1\n', '.env': 'X=1\n' });
  const r = scan(dir, '--files', '.env.example', '.env.local', '.env');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\.env\.local: запрещённый путь/);
  assert.match(r.stdout, /\n  \.env: запрещённый путь/);
  assert.doesNotMatch(r.stdout, /^ {2}\.env\.example:/m);
  assert.equal(scan(dir, '--files', '.env.example').code, 0);
});

test('«Не коммитить: bitrix/» не ловит копии шаблонов в local/templates/…/components/bitrix/', () => {
  const tpl = 'local/templates/t/components/bitrix/news.list/.default/template.php';
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd(ALPHA) });
  writeFiles(dir, { [tpl]: '<?php echo $arResult["NAME"];\n', 'local/components/my/upload/class.php': '<?php\n' });
  const r = scan(dir, '--files', tpl, 'local/components/my/upload/class.php');
  assert.equal(r.code, 0, r.stdout);
  git(dir, 'add', 'local');
  const cached = scan(dir, '--cached', '--', tpl);
  assert.equal(cached.code, 0, cached.stdout);
});

test('--all: чистый репозиторий — код 0; приватный ключ найден, бинарный файл пропущен', () => {
  const clean = gitRepo({ 'a.php': '<?php echo 1;\n' });
  const ok = scan(clean, '--all');
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /чисто \(файлов: 1\)/);
  const dir = gitRepo({ 'x.txt': '' });
  writeFiles(dir, { 'k.pem.txt': '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n', 'img.bin': Buffer.from([0, 1, 2, 45, 45, 45]) });
  const r = scan(dir, '--all');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /k\.pem\.txt:1: приватный ключ/);
  assert.doesNotMatch(r.stdout, /img\.bin/);
});

test('без режима — код 2 и подсказка', () => {
  const r = scan(gitRepo({ 'a.txt': '' }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Использование/);
});

test('--history: секрет удалён из файлов, но остался в истории — находка с хешем; путь из «Не коммитить» в истории — находка', () => {
  const dir = gitRepo({ '.claude/CLAUDE.md': paramsMd({ 'Не коммитить': 'bitrix/' }), 'a.php': '<?php\n' });
  // Вебхук собирается из двух частей: целиком в исходнике теста его нашёл бы secret-scan при коммите шага.
  writeFiles(dir, {
    'a.php': "<?php\n$hook = 'https://x.bitrix24.ru/rest/1/" + "abcdef123456/';\n",
    'bitrix/php_interface/init.php': '<?php\n',
  });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1: секрет');
  const bad = git(dir, 'rev-parse', 'HEAD').trim().slice(0, 7);
  writeFiles(dir, { 'a.php': '<?php\n' });
  git(dir, 'rm', '-q', '-r', 'bitrix');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.2: убрал');
  assert.equal(scan(dir, '--all').code, 0, 'в текущих файлах секрета уже нет');
  const r = scan(dir, '--history');
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(bad + ': a.php:2: вебхук Битрикс24 — abc…(12 симв.)'), r.stdout);
  assert.match(r.stdout, /bitrix\/php_interface\/init\.php: запрещённый путь \(bitrix\/\)/);
  assert.doesNotMatch(r.stdout, /abcdef123456/);
});

test('--history: чистая история — код 0 и число коммитов; не git — код 2', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' });
  writeFiles(dir, { 'b.php': '<?php\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', '1.1');
  const r = scan(dir, '--history');
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /secret-scan: чисто \(коммитов: 2, файлов: 2\)/);
  // GIT_CEILING_DIRECTORIES — чтобы временная папка не оказалась «внутри» чужого репозитория выше по дереву.
  const notGit = makeProject({ 'a.php': '' });
  const n = runScript('secret-scan.js', { args: ['--history'], cwd: notGit, env: { GIT_CEILING_DIRECTORIES: path.dirname(notGit) } });
  assert.equal(n.code, 2, n.stdout + n.stderr);
});

test('--history: коммит, который не удалось прочитать (огромный), — находка с хешем, а не ошибка запуска (К45)', () => {
  const dir = gitRepo({ 'a.php': '<?php\n' + 'echo 1;\n'.repeat(50) });
  const first = git(dir, 'rev-parse', 'HEAD').trim().slice(0, 7);
  // Настоящий случай — первый коммит «копия сайта с ядром» на сотни мегабайт; в тесте вывод git show урезан.
  const r = runScript('secret-scan.js', { args: ['--history'], cwd: dir, env: { KIT_SCAN_SHOW_MAX_BUFFER: '100' } });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(first + ': коммит слишком большой для проверки'));
});
