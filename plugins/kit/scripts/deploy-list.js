#!/usr/bin/env node
'use strict';
// Что залить на сервер и что удалить на нём с последней выкладки.
// Запуск в корне проекта: node deploy-list.js [--base <коммит>]
// База: --base → последний «Коммит» в таблице «Залито на прод» плана выкладки → первый коммит репозитория.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { kitInfo, docsInClaude } = require('./lib/project');
const { getSection, parseTable } = require('./lib/md');
const { parseRules, matchRules } = require('./lib/paths');

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

function baseFromPlan(planPath) {
  if (!fs.existsSync(planPath)) return null;
  const section = getSection(fs.readFileSync(planPath, 'utf8'), 'Залито на прод');
  if (!section) return null;
  const rows = parseTable(section);
  for (let i = rows.length - 1; i >= 0; i--) {
    const hashes = (rows[i]['Коммит'] || '').match(/\b[0-9a-f]{7,40}\b/g);
    if (hashes) return hashes[hashes.length - 1];
  }
  return null;
}

function parseNameStatusZ(out) {
  const parts = out.split('\0').filter((s) => s !== '');
  const items = [];
  for (let i = 0; i + 1 < parts.length; i += 2) items.push({ status: parts[i][0], path: parts[i + 1] });
  return items;
}

function main(argv) {
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('deploy-list: здесь нет git-репозитория');
    return 1;
  }
  const info = kitInfo(cwd);
  let base = null;
  let source = '';
  const bi = argv.indexOf('--base');
  if (bi >= 0 && argv[bi + 1]) {
    base = argv[bi + 1];
    source = 'аргумент --base';
  }
  if (!base) {
    base = baseFromPlan(path.resolve(cwd, info.planRel));
    if (base) source = '«Залито на прод» в ' + info.planRel;
  }
  if (!base) {
    const roots = git(cwd, ['rev-list', '--max-parents=0', 'HEAD']).out.trim().split(/\s+/).filter(Boolean);
    base = roots[roots.length - 1];
    source = 'первый коммит репозитория';
  }
  if (!base || !git(cwd, ['rev-parse', '--verify', '--quiet', base + '^{commit}']).ok) {
    console.error('deploy-list: коммит ' + base + ' не найден');
    return 1;
  }
  const rules = skipRules(info);
  const items = parseNameStatusZ(git(cwd, ['diff', '--name-status', '--no-renames', '-z', base + '..HEAD']).out)
    .filter((it) => !matchRules(it.path, rules));
  const upload = items.filter((it) => it.status !== 'D');
  const del = items.filter((it) => it.status === 'D');
  // Только удаления — когда PhpStorm сам заливает на прод: значение начинается с «PhpStorm Always».
  // «вручную; дев — PhpStorm Always» — на прод вручную, нужен полный список.
  const always = /^phpstorm always/i.test(info.params.get('Выкладка', '').trim());
  const lines = ['База: ' + git(cwd, ['rev-parse', '--short', base]).out.trim() + ' (' + source + ')'];
  if (always) {
    lines.push('', 'Выкладка: PhpStorm Always — заливает PhpStorm при сохранении, показаны только удаления.');
  } else {
    lines.push('', 'Залить (' + upload.length + '):');
    upload.forEach((it) => lines.push('  ' + it.status + ' ' + it.path));
  }
  lines.push('', 'Удалить с сервера (' + del.length + '):');
  del.forEach((it) => lines.push('  D ' + it.path));
  const dirty = git(cwd, ['status', '--porcelain']).out.split('\n').filter(Boolean)
    .filter((l) => !matchRules(l.slice(3).replace(/^"|"$/g, ''), rules));
  if (dirty.length) {
    lines.push('', 'Не закоммичено — в список не вошло (' + dirty.length + '):');
    dirty.forEach((l) => lines.push('  ' + l));
  }
  console.log(lines.join('\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { baseFromPlan };
