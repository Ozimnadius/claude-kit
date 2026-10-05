#!/usr/bin/env node
'use strict';
// Исключения PhpStorm (Settings → Deployment → сервер → Excluded Paths) в .idea/deployment.xml:
// .idea, .git, .claude, папка документов вне .claude, простые пути из «Не выкладывать» и служебные папки superpowers — у каждого сервера,
// сопоставленного с корнем проекта. Только добавляет. Внешний процесс: защита путей Claude Code его не касается.
// «Документы на сервере: да» — из .claude на сервер уезжают docs, CLAUDE.md и .htaccess: исключение .claude
// убирается (единственное удаление), остальное в ней исключается поимённо; нет .claude/.htaccess — создаётся.
//   node phpstorm-exclude.js --hook                   хук SessionStart: только в kit-проекте; JSON { systemMessage,
//                                                     hookSpecificOutput.additionalContext } — если что-то добавлено или не вышло
//   node phpstorm-exclude.js [--also a,b]             из корня проекта (project-init): дописать; код 0 / 2
//   node phpstorm-exclude.js --check [--also a,b]     только сверка: 0 — всё на месте, 1 — не хватает, 2 — файл не разобран
// Из git worktree Claude Code (<проект>/.claude/worktrees/<имя>) работает с основной папкой: её .idea и параметры.
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude } = require('./lib/project');
const { splitList } = require('./lib/params');
const { DeploymentError, readDeployment, isExcluded, addExclusions, removeExclusions } = require('./lib/deployment');

const MUST = ['.idea', '.git', '.claude'];
const RELOAD = 'Если PhpStorm открыт и не подхватил — File → Reload All from Disk.';
// «Документы на сервере: да»: что из .claude уезжает; worktrees, settings.local.json и скиллы (bitrix-skills.js)
// исключаются заранее — они появляются посреди сессии, а хук увидит их только на следующем старте.
const KEEP = ['docs', 'CLAUDE.md', '.htaccess'];
const EARLY = ['.claude/worktrees', '.claude/settings.local.json', '.claude/skills', '.claude/kit-inbox.jsonl'];
// Служебные папки superpowers (визуальный помощник, git worktree, спеки и планы по умолчанию) — тоже заранее:
// появляются посреди сессии. specs и .specify не исключаем — так может называться папка сайта.
const TOOLS = ['.superpowers', '.worktrees', 'docs/superpowers'];
const DENY = path.join(__dirname, '..', 'skills', 'project-init', 'templates', 'htaccess-deny');
const OPEN_NOTE = 'На сервер уезжают .claude/docs, .claude/CLAUDE.md и .claude/.htaccess (параметр «Документы на сервере: да») — '
  + 'после заливки проверьте снаружи, что /.claude/ закрыта (check-closed).';

const docsOnServer = (info) => /^да$/i.test(info.params.get('Документы на сервере', ''));

// Простой путь от корня проекта: без масок, без «(кроме …)», не абсолютный и не наружу — иначе null.
function plainPath(item) {
  if (/[*?[]|\(\s*кроме/i.test(item)) return null;
  const p = String(item).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '');
  if (!p || p === '.' || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return null;
  return p;
}

// Папка git worktree внутри проекта (.claude/worktrees/<имя>) → основная папка проекта.
function mainRoot(dir) {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/i.exec(String(dir));
  return m ? m[1] : dir;
}

// Содержимое .claude, кроме того, что уезжает при «Документы на сервере: да».
function claudeRest(dir) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(dir, '.claude'));
  } catch (e) {
    // нет папки — исключать нечего
  }
  const keep = new Set(KEEP.map((k) => k.toLowerCase()));
  return names.filter((n) => !keep.has(n.toLowerCase())).sort().map((n) => `.claude/${n}`);
}

function required(info, also) {
  const open = docsOnServer(info);
  const list = open ? ['.idea', '.git', ...claudeRest(info.dir), ...EARLY, info.visualRel] : [...MUST];
  if (!docsInClaude(info.docsRel)) list.push(info.docsRel);
  for (const item of [...info.params.list('Не выкладывать'), ...also, ...TOOLS]) list.push(item);
  // .claude в «Не выкладывать» — для ручной выкладки; в Excluded Paths при «да» она не возвращается.
  return list.map(plainPath).filter((p) => p && !(open && p.toLowerCase() === '.claude'));
}

// «Exclude items by name» PhpStorm: маски (* и ?) по имени файла или папки на любой глубине.
const maskRe = (mask) => new RegExp('^' + mask.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

// Маски, которые не пустят документы на сервер, — строка-предупреждение или null. Список kit не меняет: он общий для проекта.
function blockedByName(names) {
  const targets = ['.claude', ...KEEP];
  const masks = names.filter((m) => targets.some((n) => maskRe(m).test(n)));
  if (!masks.length) return null;
  const hit = targets.filter((n) => masks.some((m) => maskRe(m).test(n))).map((n) => (n === '.claude' ? n : `.claude/${n}`));
  return `[kit] Документы на сервер не уедут: в «Exclude items by name» PhpStorm (Settings → Build, Execution, Deployment → Deployment → Options) есть ${masks.join(', ')} — `
    + `из-за них не уезжают ${hit.join(', ')}. Уберите эти имена руками: список общий для всего проекта, kit его не меняет.`;
}

const listOf = (added) => Object.entries(added).map(([s, list]) => `«${s}» — ${list.join(', ')}`).join('; ');

// Временный файл рядом → rename; временный файл убирается и при ошибке.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.kit-tmp`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch (e) {
      // не удалось убрать — не важнее исходной ошибки
    }
  }
}

// → { code, lines }; файл меняется только без --check.
function run(start, { hook = false, check = false, also = [] } = {}) {
  const dir = mainRoot(start);
  const info = kitInfo(dir);
  if (hook && !info.isKit) return { code: 0, lines: [] };
  const file = path.join(dir, '.idea', 'deployment.xml');
  const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (!/<component\s+name="PublishConfigData"/.test(xml)) {
    return { code: 0, lines: hook ? [] : ['Настроек выкладки PhpStorm нет (.idea/deployment.xml) — исключать нечего.'] };
  }
  const open = docsOnServer(info);
  const deployment = readDeployment(xml);
  const live = open && deployment.servers.some((s) => s.root);
  const notes = live ? [blockedByName(deployment.names)].filter(Boolean) : [];
  const deny = path.join(dir, '.claude', '.htaccess');
  const needDeny = live && !fs.existsSync(deny);
  let res;
  let rem = { xml, removed: {} };
  try {
    if (open) rem = removeExclusions(xml, ['.claude']);
    res = addExclusions(rem.xml, required(info, also));
  } catch (e) {
    if (!(e instanceof DeploymentError)) throw e;
    return { code: 2, lines: [`[kit] Исключения PhpStorm: .idea/deployment.xml не разобран (${e.message}) — исключения не проверены, добавьте ${MUST.join(', ')} в Excluded Paths руками.`, ...notes] };
  }
  const added = Object.keys(res.added).length > 0;
  const removed = Object.keys(rem.removed).length > 0;
  if (!added && !removed && !needDeny) {
    const roots = deployment.servers.filter((s) => s.root).map((s) => s.name);
    return { code: 0, lines: hook ? notes : [roots.length ? `Исключения PhpStorm на месте: ${roots.join(', ')}.` : 'Серверов, сопоставленных с корнем проекта, нет — исключать нечего.', ...notes] };
  }
  if (check) {
    const parts = [needDeny && 'нет .claude/.htaccess', removed && `убрать — ${listOf(rem.removed)}`, added && `не хватает — ${listOf(res.added)}`];
    return { code: 1, lines: [`Исключения PhpStorm: ${parts.filter(Boolean).join('; ')}.`, ...notes] };
  }
  const done = [];
  if (needDeny) {
    // .htaccess — раньше, чем .claude откроется для выкладки; не вышло — deployment.xml не трогаем.
    try {
      fs.writeFileSync(deny, fs.readFileSync(DENY), { flag: 'wx' });
      done.push('создан .claude/.htaccess (Require all denied)');
    } catch (e) {
      return { code: 2, lines: [`[kit] Исключения PhpStorm: не удалось создать .claude/.htaccess (${e.code || e.message}) — .claude не открыта для выкладки; создайте файл руками (Require all denied).`, ...notes] };
    }
  }
  if (!added && !removed) return { code: 0, lines: [`[kit] Исключения PhpStorm: ${done.join('; ')}.`, ...notes] };
  const manual = [added && `добавьте в Excluded Paths руками: ${listOf(res.added)}`, removed && `уберите: ${listOf(rem.removed)}`].filter(Boolean).join('; ');
  try {
    writeAtomic(file, res.xml);
  } catch (e) {
    return { code: 2, lines: [`[kit] Исключения PhpStorm: не удалось записать .idea/deployment.xml (${e.code || e.message}) — ${manual}.`, ...notes] };
  }
  let back = null;
  try {
    back = readDeployment(fs.readFileSync(file, 'utf8')).servers;
  } catch (e) {
    // не перечитался — считаем, что проверка не прошла
  }
  const ok = back && Object.entries(res.added).every(([name, list]) => {
    const s = back.find((x) => x.name === name);
    return s && list.every((p) => isExcluded(s.excluded, p));
  }) && Object.keys(rem.removed).every((name) => {
    const s = back.find((x) => x.name === name);
    return s && !s.excluded.some((e) => e.toLowerCase() === '.claude');
  });
  if (!ok) {
    let restored = true;
    try {
      fs.writeFileSync(file, xml);
    } catch (e) {
      restored = false;
    }
    return { code: 2, lines: [restored
      ? '[kit] Исключения PhpStorm: запись не прошла проверку — .idea/deployment.xml возвращён как был; добавьте исключения руками.'
      : '[kit] Исключения PhpStorm: запись не прошла проверку, вернуть .idea/deployment.xml не удалось — проверьте файл и добавьте исключения руками.', ...notes] };
  }
  if (removed) done.push(`убрано ${listOf(rem.removed)}`);
  if (added) done.push(`добавлено ${listOf(res.added)}`);
  return { code: 0, lines: [`[kit] Исключения PhpStorm: ${done.join('; ')}.${removed ? ' ' + OPEN_NOTE : ''} ${RELOAD}`, ...notes] };
}

function main(argv) {
  const hook = argv.includes('--hook');
  const ai = argv.indexOf('--also');
  const v = ai >= 0 ? argv[ai + 1] : undefined;
  const opts = { hook, check: argv.includes('--check'), also: v && !v.startsWith('--') ? splitList(v) : [] };
  if (hook) {
    // Хук сессию не ломает: код всегда 0. Сообщение — JSON: systemMessage — пользователю,
    // hookSpecificOutput.additionalContext — в контекст Claude (у SessionStart это разные каналы).
    let text = '';
    try {
      text = run(resolveProjectDir(readStdinJson()), opts).lines.join('\n');
    } catch (e) {
      text = `[kit] Исключения PhpStorm: хук не отработал (${e.message}) — проверьте Excluded Paths руками.`;
    }
    if (text) {
      process.stdout.write(JSON.stringify({
        systemMessage: text,
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
      }) + '\n');
    }
    return 0;
  }
  const r = run(process.cwd(), opts);
  if (r.lines.length) console.log(r.lines.join('\n'));
  return r.code;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { run, required, plainPath, mainRoot, MUST };
