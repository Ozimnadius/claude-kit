#!/usr/bin/env node
'use strict';
// Поиск секретов и запрещённых путей перед коммитом. Значения в выводе маскируются.
// Запуск в корне проекта:
//   node secret-scan.js --cached [-- пути…]   добавленные строки из индекса
//   node secret-scan.js --all                 всё, что попадёт в git (tracked + untracked без ignored)
//   node secret-scan.js --files пути…         указанные файлы
//   node secret-scan.js --paths [--] пути…    только запрещённые пути: файлы не читаются и могут не существовать
//                                             (kit-commit.js проверяет пути до `git add`)
//   node secret-scan.js --history             все коммиты текущей ветки (с 2.5.0, перед первой отправкой в удалённый
//                                             репозиторий): добавленные строки каждого коммита и пути, бывшие в истории
// Код 0 — чисто, 1 — есть находки, 2 — ошибка запуска.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readParams } = require('./lib/params');
const { parseRules, matchRules, norm } = require('./lib/paths');

const BASE_FORBIDDEN = [
  '.idea', '*.back*', '.settings.php', '.settings_extra.php', 'dbconn.php', '.env', '.env.* (кроме .env.example)',
  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual', '.claude/docs/visual',
  '.claude/kit-inbox.jsonl', // входящие ответы для /kit:step-done — только локально
  '/kit-exec.php', // файл-канал /kit:server (только корень): на сервере на время работы, в git не нужен
];
const MAX_SIZE = 2 * 1024 * 1024;
const PARAM_LINE = /^\s*[-*]\s+Секреты\s*:/i;

// Подстановка, а не литерал: переменная (`$key`, `${KEY}`), вывод PHP (`<?=$key?>`, `<?echo …`),
// ERB/EJS/ASP (`<%=key%>`), Twig/Blade/Vue (`{{key}}`, `{!!$key!!}`), Smarty и PHP в строке (`{$key}`),
// макрос Битрикса целиком (`#API_KEY#`). Литерал с `#` в начале (`#Qw3rty`) — не подстановка.
const PLACEHOLDER = /^(?:\$|<\?|<%|\{\{|\{!!|\{\$)|^#[A-Z][A-Z0-9_]*#$/;

// Слова вроде «Пароль» или «password_field» — подписи, а не секреты; `%s`, `%PASSWORD%` — формат.
function looksSecret(v) {
  if (/^[\p{L}_ -]+$/u.test(v) && v.length < 16) return false;
  if (PLACEHOLDER.test(v) || v.startsWith('%')) return false;
  return true;
}

// После запятой (`define('SMTP_PASSWORD', '…')`) — секрет, только если в значении есть цифра:
// так не ловятся списки имён полей («PASSWORD», «CONFIRM_PASSWORD», «refresh_token» — идентификаторы
// без цифр) и соседние аргументы вызова (`setRequestHeader('X-Auth-Token', 'application/json')`).
function listItemSecret(v) {
  return /\d/.test(v) && looksSecret(v);
}

// Ключ-указатель — адрес, путь или имя, а не секрет: `OAUTH_TOKEN_URL=https://…`, `PASSWORD_RESET_URL=/reset-password`,
// `DB_PASSWORD_FILE=/run/secrets/db` (docker secrets), `secretName: tls-secret-2024` (Kubernetes).
// Значение с `@` (учётные данные в адресе) остаётся находкой. Решает имя ключа, а не начало значения:
// AWS_SECRET_ACCESS_KEY=/… или SLACK_TOKEN=https://hooks… — настоящие секреты.
const isPointerKey = (key) => /(?:_(?:URL|URI|ENDPOINT|PATH|FILE)|name)$/i.test(key);

// В YAML значение бывает не литералом: тег `!vault`, якорь `&x`, псевдоним `*x`, блок `|`/`>`, список `[…]`/`{…}`.
const isStructural = (v) => /^[!&*|>[{]/.test(v);

// Файлы, где секрет пишут без кавычек: .env* (`KEY=value`; .env.example тоже коммитится), YAML (`key: value`,
// `- KEY=value` в compose), INI, conf, TOML, properties (`key = value`).
const isKeyValueFile = (file) => {
  const name = path.posix.basename(norm(file || ''));
  return /^\.env/i.test(name) || /\.(?:ya?ml|ini|conf|cfg|toml|properties)$/i.test(name);
};

// Все шаблоны — с флагом g: перебираются все совпадения в строке (см. scanLine).
const PATTERNS = [
  { kind: 'вебхук Битрикс24', re: /bitrix24\.[a-z.]+\/rest\/\d+\/([a-z0-9]{6,})/gi },
  { kind: 'приватный ключ', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----()/g },
  {
    kind: 'пароль или токен',
    // Разделитель после ключа: `=>`, `=`, `:` — обычная проверка; `,` — строже (listItemSecret).
    re: /(?:password|passwd|secret|token|api_?key)['"]?\s*(?<sep>=>|=|:|,)\s*['"](?<v>[^'"\s]{6,})['"]/gi,
    check: (v, m) => (m.groups.sep === ',' ? listItemSecret(v) : looksSecret(v)),
  },
  // `%` в URL — не формат: ключ бывает закодирован (`%2B…`). `;` — конец `&amp;` в HTML-экранированном URL.
  { kind: 'ключ в URL', re: /[?&;]api_?key=([^&\s'"]{6,})/gi, check: (v) => !PLACEHOLDER.test(v) },
  {
    kind: 'пароль или токен (без кавычек)',
    // Только в .env*, YAML, INI, conf, TOML; строка с кавычками уже найдена шаблоном «пароль или токен» — без дубля.
    re: /^\s*(?:export\s+|-\s+)?["']?(?<key>[\w.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[\w.-]*)["']?\s*[=:]\s*['"]?(?<v>[^'"\s#]{6,})/gi,
    onlyIf: (file, found) => isKeyValueFile(file) && !found.some((f) => f.startsWith('пароль или токен —')),
    check: (v, m) => looksSecret(v) && !isStructural(v) && !(isPointerKey(m.groups.key) && !v.includes('@')),
  },
];

function mask(v) {
  return v ? v.slice(0, 3) + '…(' + v.length + ' симв.)' : '';
}

// Первое совпадение шаблона, прошедшее проверку, или null. После отклонённого совпадения поиск
// продолжается со следующего символа (не с конца совпадения): в `['password', 'api_key' => '…']`
// отклонённое `password', 'api_key'` не должно проглотить ключ `api_key`.
function firstHit(p, line) {
  p.re.lastIndex = 0;
  let m;
  while ((m = p.re.exec(line)) !== null) {
    const v = m.groups && m.groups.v !== undefined ? m.groups.v : m[1];
    if (!p.check || p.check(v, m)) return { v };
    p.re.lastIndex = m.index + 1;
  }
  return null;
}

function scanLine(line, extra, file = '') {
  if (PARAM_LINE.test(line)) return [];
  const found = [];
  for (const p of PATTERNS) {
    if (p.onlyIf && !p.onlyIf(file, found)) continue;
    const hit = firstHit(p, line);
    if (hit) found.push(p.kind + (hit.v ? ' — ' + mask(hit.v) : ''));
  }
  for (const s of extra) {
    const i = line.indexOf(s);
    if (i >= 0) found.push('шаблон «' + s + '» — ' + mask(line.slice(i + s.length).trim()));
  }
  return found;
}

// Вывод `git show` одного коммита в --history; KIT_SCAN_SHOW_MAX_BUFFER — только для тестов (огромный коммит).
const SHOW_MAX_BUFFER = Number(process.env.KIT_SCAN_SHOW_MAX_BUFFER) || 512 * 1024 * 1024;

function git(args, maxBuffer = 512 * 1024 * 1024) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || '').trim());
  return r.stdout;
}

function scanDiff(diff, extra, out) {
  let file = null;
  let lineNo = 0;
  // «+++ » — заголовок файла только до первой @@-строки: добавленная строка «++ x» в самом диффе тоже выглядит как «+++ x».
  let inHeader = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true;
      continue;
    }
    if (inHeader && line.startsWith('+++ ')) {
      file = line.slice(4).replace(/\t.*$/, '').replace(/^b\//, '').trim();
      continue;
    }
    if (line.startsWith('@@')) {
      inHeader = false;
      const m = /\+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith('+') && file && file !== '/dev/null') {
      for (const f of scanLine(line.slice(1).replace(/\r$/, ''), extra, file)) out.push(file + ':' + lineNo + ': ' + f);
      lineNo++;
    }
  }
}

function scanFile(root, rel, extra, out) {
  let st;
  try {
    st = fs.statSync(path.join(root, rel));
  } catch (e) {
    return;
  }
  if (!st.isFile() || st.size > MAX_SIZE) return;
  const buf = fs.readFileSync(path.join(root, rel));
  if (buf.subarray(0, 8000).includes(0)) return;
  buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
    for (const f of scanLine(line, extra, rel)) out.push(norm(rel) + ':' + (i + 1) + ': ' + f);
  });
}

function main(argv) {
  const root = process.cwd();
  const params = readParams(root);
  const extra = params.list('Секреты');
  const rules = parseRules([...BASE_FORBIDDEN, ...params.list('Не коммитить')]);
  const findings = [];
  let files;
  let commits = null;
  if (argv[0] === '--cached') {
    const sep = argv.indexOf('--');
    const paths = sep >= 0 ? argv.slice(sep + 1) : [];
    const spec = paths.length ? ['--', ...paths] : [];
    files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT', ...spec]).split('\0').filter(Boolean);
    scanDiff(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', ...spec]), extra, findings);
  } else if (argv[0] === '--all') {
    files = git(['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    files.forEach((f) => scanFile(root, f, extra, findings));
  } else if (argv[0] === '--files' && argv.length > 1) {
    files = argv.slice(1).map(norm);
    files.forEach((f) => scanFile(root, f, extra, findings));
  } else if (argv[0] === '--paths' && argv.slice(argv[1] === '--' ? 2 : 1).length) {
    files = argv.slice(argv[1] === '--' ? 2 : 1).map(norm);
  } else if (argv[0] === '--history') {
    // По коммиту за раз: первый коммит проекта — копия сайта, одним `git log -p` он упёрся бы в память.
    commits = git(['rev-list', '--reverse', 'HEAD']).split(/\s+/).filter(Boolean);
    for (const c of commits) {
      const found = [];
      let diff;
      try {
        diff = git(['show', '--format=', '-U0', '--no-color', '--no-ext-diff', '--no-renames', '--diff-merges=first-parent', c], SHOW_MAX_BUFFER);
      } catch (e) {
        // Коммит на сотни мегабайт (копия сайта с ядром) не влезает в строку — содержимое не проверено, это находка (К45).
        findings.push(c.slice(0, 7) + ': коммит слишком большой для проверки (' + String(e.code || e.message).split('\n')[0] + ') — содержимое не проверено');
        continue;
      }
      scanDiff(diff, extra, found);
      for (const f of found) findings.push(c.slice(0, 7) + ': ' + f);
    }
    files = [...new Set(git(['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', 'HEAD'])
      .split(/[\0\n]/).filter(Boolean))];
  } else {
    console.error('Использование: node secret-scan.js --cached [-- пути…] | --all | --files пути… | --paths [--] пути… | --history');
    return 2;
  }
  const pathHits = [];
  for (const f of files) {
    const r = matchRules(f, rules);
    if (r) pathHits.push(norm(f) + ': запрещённый путь (' + r.pattern + ')');
  }
  const all = [...pathHits, ...findings];
  if (!all.length) {
    console.log('secret-scan: чисто (' + (commits ? 'коммитов: ' + commits.length + ', ' : '') + 'файлов: ' + files.length + ')');
    return 0;
  }
  console.log('secret-scan: найдено ' + all.length + ':');
  all.forEach((l) => console.log('  ' + l));
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error('secret-scan: ' + e.message);
    process.exitCode = 2;
  }
}
module.exports = { scanLine, looksSecret, listItemSecret };
