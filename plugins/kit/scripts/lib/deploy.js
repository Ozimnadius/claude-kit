'use strict';
// Выкладка: что не выкладывать, база («что уже на сервере») и список изменений — для ssh-deploy.js.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDocOnServer } = require('./project');
const { getSection, parseTable } = require('./md');
const { parseRules, matchRules } = require('./paths');

// Как у хука исключений PhpStorm (phpstorm-exclude.js): .claude в корне (правила, документы, скрипты)
// на сервер не выкладывается никогда. Файл-канал /kit:server
// (/kit-exec.php, только в корне) — служебный: его кладёт и удаляет Claude, в списки выкладки он не входит.
// Служебные папки superpowers — как у хука исключений: в них спеки, планы и макеты, а не сайт.
const ALWAYS_SKIP = ['.git', '.idea', '/.claude', '/kit-exec.php', '/.superpowers', '/.worktrees', '/docs/superpowers'];

function skipRules(info) {
  return parseRules([...ALWAYS_SKIP, ...info.params.list('Не выкладывать')]);
}

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || '', err: (r.stderr || '').trim() };
}

// Таблица отметок о заливке в плане выкладки — по окружению (с 2.17.0).
const sectionOf = (env) => 'Залито на ' + (env === 'дев' ? 'дев' : 'прод');

// «Выкладка: Claude по SSH» — шаг заливает /kit:step-done (ssh-deploy.js).
const isSsh = (info) => /^claude по ssh/i.test(info.params.get('Выкладка', '').trim());

// Последний коммит шага: заголовок «<id>: …» (точно до «: » — 32.1 не находит 32.10).
function commitOfStep(cwd, id) {
  if (!id) return null;
  for (const line of git(cwd, ['log', '--format=%h%x09%s']).out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0 && line.slice(tab + 1).startsWith(id + ': ')) return line.slice(0, tab);
  }
  return null;
}

// База из плана: последняя строка таблицы «Залито на …» с хешем в «Коммит». byStep (режим «Claude по SSH») — пустой
// «Коммит» ищется по ID из «Шаг»: строку пишет тот же шаг, что делает коммит, и его дерево — ровно залитое. При ручной
// выкладке строку без хеша могут записать позже самой заливки — там она пропускается, как раньше.
function baseFromPlan(planPath, env = 'прод', { cwd, byStep = false } = {}) {
  if (!fs.existsSync(planPath)) return null;
  const section = getSection(fs.readFileSync(planPath, 'utf8'), sectionOf(env));
  if (!section) return null;
  const rows = parseTable(section);
  for (let i = rows.length - 1; i >= 0; i--) {
    const hashes = (rows[i]['Коммит'] || '').match(/\b[0-9a-f]{7,40}\b/g);
    if (hashes) return hashes[hashes.length - 1];
    if (byStep && cwd) {
      const c = commitOfStep(cwd, (rows[i]['Шаг'] || '').trim());
      if (c) return c;
    }
  }
  return null;
}

// Откуда считать изменения: --base → план (таблица по окружению) → первый коммит репозитория.
function resolveBase(cwd, info, env, baseArg) {
  let base = baseArg || null;
  let source = base ? 'аргумент --base' : '';
  if (!base) {
    base = baseFromPlan(path.resolve(cwd, info.planRel), env, { cwd, byStep: isSsh(info) });
    if (base) source = '«' + sectionOf(env) + '» в ' + info.planRel;
  }
  if (!base) {
    const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).out.trim().split(/\s+/).filter(Boolean);
    base = roots[roots.length - 1];
    source = 'первый коммит репозитория';
  }
  if (!base || !git(cwd, ['rev-parse', '--verify', '--quiet', base + '^{commit}']).ok) return { error: 'коммит ' + base + ' не найден' };
  return { base, short: git(cwd, ['rev-parse', '--short', base]).out.trim(), source };
}

function parseNameStatusZ(out) {
  const parts = out.split('\0').filter((s) => s !== '');
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) items.push({ status: parts[i][0], path: parts[i + 1] });
  return items;
}

// Изменения от базы до папки проекта: и незакоммиченное, и новые неигнорируемые файлы. Пути под правилами исключений убираются.
// С 48.10 их считает вызывающий (ssh-deploy.js — entryDeploy из lib/prod.js; сюда lib/prod.js не берётся): include — пути
// [{ status, path }], которые заливаются (M) или удаляются (D), даже если от базы разницы нет, — заменяют свою запись из диффа
// или добавляются в конец; exclude — пути, которые не заливаются, убранные им — в excluded. Правила исключений — ко всем.
function changes(cwd, base, rules, exclude = new Set(), include = []) {
  let items = parseNameStatusZ(git(cwd, ['diff', '--name-status', '--no-renames', '-z', base]).out);
  const extra = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).out.split('\0').filter(Boolean);
  items = items.concat(extra.map((p) => ({ status: 'A', path: p })));
  if (include.length) {
    const inc = new Map(include.map((it) => [it.path, it]));
    items = items.map((it) => inc.get(it.path) || it);
    const have = new Set(items.map((it) => it.path));
    items = items.concat(include.filter((it) => !have.has(it.path)));
  }
  items = items.filter((it) => !matchRules(it.path, rules));
  const excluded = items.filter((it) => exclude.has(it.path));
  items = items.filter((it) => !exclude.has(it.path));
  return { upload: items.filter((it) => it.status !== 'D'), del: items.filter((it) => it.status === 'D'), excluded };
}

// Документы на сервер («Документы на сервере: да», ssh-deploy.js --docs, с 2.18.0). Записи «Не выкладывать», которые
// закрывают .claude целиком, — для ручной выкладки; документам они не мешают (как у хука PhpStorm). Остальные — действуют.
function docsRules(info) {
  return parseRules(info.params.list('Не выкладывать').filter((r) => !/^\/?\.claude\/?$/i.test(String(r).trim())));
}

const HTACCESS = '.claude/.htaccess';

// all — все документы на диске (отслеживаемые и новые неигнорируемые), без удалений; иначе — изменения от base до папки
// проекта. Есть что залить или удалить — .claude/.htaccess (если он на диске) первым: папка закрыта раньше, чем на сервер
// попадёт первый документ, а удалённый на сервере .htaccess восстанавливается.
function docsChanges(cwd, info, { base = null, all = false } = {}) {
  const rules = docsRules(info);
  const keep = (p) => isDocOnServer(p, info) && !matchRules(p, rules);
  let upload;
  let del = [];
  if (all) {
    const listed = (extra) => git(cwd, ['ls-files', '-z', ...extra, '--', '.claude']).out.split('\0').filter(Boolean);
    upload = [...listed([]), ...listed(['--others', '--exclude-standard'])]
      .filter((p) => keep(p) && fs.existsSync(path.join(cwd, p)))
      .map((p) => ({ status: 'M', path: p }));
  } else {
    const ch = changes(cwd, base, rules);
    upload = ch.upload.filter((it) => keep(it.path));
    del = ch.del.filter((it) => keep(it.path));
  }
  upload = upload.filter((it) => it.path.toLowerCase() !== HTACCESS);
  if ((upload.length || del.length) && fs.existsSync(path.join(cwd, HTACCESS))) upload.unshift({ status: 'M', path: HTACCESS });
  return { upload, del };
}

module.exports = { ALWAYS_SKIP, skipRules, git, sectionOf, isSsh, commitOfStep, baseFromPlan, resolveBase, changes, docsRules, docsChanges };
