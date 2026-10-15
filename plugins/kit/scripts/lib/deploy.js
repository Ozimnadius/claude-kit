'use strict';
// Выкладка: что не выкладывать, база («что уже на сервере») и список изменений — для deploy-list.js и ssh-deploy.js.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { docsInClaude } = require('./project');
const { getSection, parseTable } = require('./md');
const { parseRules, matchRules } = require('./paths');

// Как у хука исключений PhpStorm (phpstorm-exclude.js): .claude в корне (правила, документы, скрипты)
// и папка журнала вне .claude (старая docs/) на сервер не выкладываются никогда. Файл-канал /kit:server
// (/kit-exec.php, только в корне) — служебный: его кладёт и удаляет Claude, в списки выкладки он не входит.
const ALWAYS_SKIP = ['.git', '.idea', '/.claude', '/kit-exec.php'];

function skipRules(info) {
  const d = info.docsRel;
  const own = d !== '.' && !docsInClaude(d) && !path.isAbsolute(d) && !d.split('/').includes('..') ? ['/' + d] : [];
  return parseRules([...ALWAYS_SKIP, ...own, ...info.params.list('Не выкладывать')]);
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

// Изменения от базы: без worktree — до HEAD (закоммиченное, как deploy-list); с worktree — до папки проекта:
// и незакоммиченное, и новые неигнорируемые файлы (ssh-deploy.js). Пути под правилами исключений убираются.
function changes(cwd, base, rules, { worktree = false } = {}) {
  let items = parseNameStatusZ(git(cwd, ['diff', '--name-status', '--no-renames', '-z', worktree ? base : base + '..HEAD']).out);
  if (worktree) {
    const extra = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).out.split('\0').filter(Boolean);
    items = items.concat(extra.map((p) => ({ status: 'A', path: p })));
  }
  items = items.filter((it) => !matchRules(it.path, rules));
  return { upload: items.filter((it) => it.status !== 'D'), del: items.filter((it) => it.status === 'D') };
}

module.exports = { ALWAYS_SKIP, skipRules, git, sectionOf, isSsh, commitOfStep, baseFromPlan, resolveBase, changes };
