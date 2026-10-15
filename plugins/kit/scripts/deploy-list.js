#!/usr/bin/env node
'use strict';
// Что залить на сервер и что удалить на нём с последней выкладки.
// Запуск в корне проекта: node deploy-list.js [--base <коммит>] [--env прод|дев]
// Сервер — --env, иначе «Окружение»; база: --base → последний «Коммит» в таблице «Залито на прод» («Залито на дев»)
// плана выкладки → первый коммит репозитория. Общее с ssh-deploy.js — lib/deploy.js.
const { kitInfo, serverEnv } = require('./lib/project');
const { matchRules } = require('./lib/paths');
const { skipRules, git, isSsh, baseFromPlan, resolveBase, changes } = require('./lib/deploy');

function main(argv) {
  const cwd = process.cwd();
  if (!git(cwd, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.error('deploy-list: здесь нет git-репозитория');
    return 1;
  }
  const info = kitInfo(cwd);
  const ei = argv.indexOf('--env');
  const env = ei >= 0 ? argv[ei + 1] : serverEnv(info.params);
  if (env !== 'прод' && env !== 'дев') {
    console.error('deploy-list: --env: прод или дев');
    return 1;
  }
  const bi = argv.indexOf('--base');
  const b = resolveBase(cwd, info, env, bi >= 0 && argv[bi + 1] ? argv[bi + 1] : null);
  if (b.error) {
    console.error('deploy-list: ' + b.error);
    return 1;
  }
  const rules = skipRules(info);
  const { upload, del } = changes(cwd, b.base, rules);
  // Только удаления — когда PhpStorm сам заливает: значение начинается с «PhpStorm Always».
  // «вручную; дев — PhpStorm Always» (до 2.17.0) — на прод вручную, нужен полный список.
  const always = /^phpstorm always/i.test(info.params.get('Выкладка', '').trim());
  const lines = ['База: ' + b.short + ' (' + b.source + ')'];
  if (always) {
    lines.push('', 'Выкладка: PhpStorm Always — заливает PhpStorm при сохранении, показаны только удаления.');
  } else {
    if (isSsh(info)) lines.push('', 'Выкладка: Claude по SSH — заливает /kit:step-done (ssh-deploy.js); здесь — чего ещё нет на сервере.');
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
