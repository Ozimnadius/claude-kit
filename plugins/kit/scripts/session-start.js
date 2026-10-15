#!/usr/bin/env node
'use strict';
// Хук SessionStart (startup|resume|clear|compact): раздел «Сейчас» из журнала и правила процесса в контекст.
// Вне kit-проекта молчит. Любая ошибка — тихий выход 0.
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo, docsInClaude, serverEnv } = require('./lib/project');
const { getSection } = require('./lib/md');
const { readDeployment } = require('./lib/deployment');

const MAX_NOW = 4000;

const RULES = [
  '- Один шаг за раз: следующий — только после проверки предыдущего.',
  '- Выбор за пользователем; вопросы — только через AskUserQuestion.',
  '- После проверенного шага — /kit:step-done (docs-keeper → kit-commit.js, один коммит на шаг).',
  '- Git пользователь не трогает, команды git ему не выдаём; коммиты — только через /kit:step-done (скрипт kit-commit.js).',
  '- Переводы строк LF; файлы целиком не переформатировать.',
  '- Грабли: cd в Bash меняет каталог всей сессии — только абсолютные пути или ( cd … ); PHP не править sed (портит \\ неймспейсов) — только Edit; Git Bash переписывает аргументы вида /путь — PowerShell или MSYS_NO_PATHCONV=1.',
];
const ruleAlways = (where) => '- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на ' + where + '. Черновики — только во временной папке сессии; PHP собрать и проверить php -l там, в проект — одной правкой. Удаление локально сервер не трогает.';
const RULE_ALWAYS = ruleAlways('сервер');
const RULE_ALWAYS_ON_DEV = ruleAlways('дев-сервер');
const RULE_ALWAYS_DEV = '- Автозаливка на дев: любое сохранение в проекте сразу уходит на дев-сервер (на прод — вручную). Черновики — только во временной папке сессии; PHP собрать и проверить php -l там, в проект — одной правкой. Удаление локально дев-сервер не трогает.';
const RULE_USER = '- Код пишет пользователь: Claude даёт один маленький шаг и ждёт ответа; «сделай сам» относится только к текущему шагу.';
const RULE_CLAUDE = '- Код пишет Claude: после записи проверить результат на сервере (страница, десктоп и мобильная ширина).';
// «Выкладка: Claude по SSH» (с 2.17.0): на сервер шаг уезжает только из /kit:step-done — после просмотра пользователем.
const RULE_SSH = '- Выкладка: Claude по SSH — правки остаются локально, пока /kit:step-done не зальёт их после просмотра '
  + '(ssh-deploy.js: всё, что изменилось с последней заливки, удаления — тоже); проверка на сервере — после заливки, потом коммит; '
  + 'не прошла — правка и снова просмотр. Вне /kit:step-done на сервер не заливай.';
const RULE_CLAUDE_SSH = '- Код пишет Claude: результат на сервере проверяй после заливки в /kit:step-done (страница, десктоп и мобильная ширина); '
  + 'до неё — php -l и локальные проверки.';
const WARN_SSH_ALWAYS = '- Внимание: выкладка — Claude по SSH, а в PhpStorm включена автозаливка (.idea/deployment.xml: Always) — '
  + 'файлы уедут на сервер дважды и до просмотра. В первом ответе скажи пользователю выключить: PhpStorm → Tools → Deployment → Automatic Upload.';
// С 2.15.0: без параметра «Коммит» или с любым значением, кроме «сразу», коммит — только после просмотра пользователем.
const RULE_REVIEW = '- Коммит — после просмотра: /kit:step-done показывает незакоммиченные изменения (панель изменений приложения Claude) '
  + 'и коммитит только после ответа «Коммитить» (в режиме «Claude по SSH» — «Залить на сервер»); вопросы пользователь задаёт комментариями к строкам.';
const RULE_NO_PARAMS = '- В .claude/CLAUDE.md нет раздела «Параметры для агентов» — предложи пользователю /kit:project-init (дополнит недостающее).';
const SPEC_TEMPLATE = path.join(__dirname, '..', 'skills', 'project-init', 'templates', 'spec.md');
const RULE_SP_ALWAYS = '- Superpowers при автозаливке: без отдельных веток и worktree (.worktrees, using-git-worktrees) — правки из них не дойдут до сервера.';
const RULE_WORKTREE ='- Сессия работает в git worktree — правки здесь не попадут на сервер автозаливкой основной папки, пока их не сольют в основную ветку; не проверяй результат на сервере сразу после записи.';

// Где лежат документы проекта; старая раскладка (docs/) — подсказка о переезде.
function docsRule(docsRel) {
  const where = docsRel === '.' ? 'корне проекта' : docsRel + '/';
  const rule = '- Документы проекта — в ' + where + ': планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.';
  return docsInClaude(docsRel) ? rule : rule + ' Переезд в .claude/docs — через /kit:project-init.';
}

// Superpowers работает по правилам kit: его скиллы сами пишут в docs/superpowers/ и коммитят — правила проекта важнее.
function superpowersRule(docsRel) {
  const work = (docsRel === '.' ? '' : docsRel + '/') + 'work/';
  return '- Superpowers по правилам kit: спеки и планы — в ' + work + ' (spec-<тема>.md по шаблону ' + SPEC_TEMPLATE.replace(/\\/g, '/')
    + ', plan-<тема>.md с разделом «Чек-лист» в начале: строка на задачу «- [ ] N.M — …», шаги внутри задач — без чекбоксов), '
    + 'не в docs/superpowers/; superpowers сам не коммитит — коммит только через /kit:step-done; '
    + 'задача плана = шаг kit N.M; выбранный подход и отвергнутые — в DECISIONS; TDD — только где в проекте есть тесты.';
}

// Автозаливка PhpStorm включена — .idea основной папки (из git worktree — папка выше .claude/worktrees). Нет файла — нет.
function phpStormAlways(dir) {
  const root = String(dir || '').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '');
  try {
    return readDeployment(fs.readFileSync(path.join(root, '.idea', 'deployment.xml'), 'utf8')).always;
  } catch (e) {
    return false;
  }
}

// Папка проекта — git worktree, который Claude Code (десктоп) создаёт внутри проекта в .claude/worktrees/.
function inWorktree(dir) {
  return String(dir || '').replace(/\\/g, '/').toLowerCase().includes('/.claude/worktrees/');
}

function buildContext(info) {
  if (!info.isKit) return '';
  const out = ['[kit] Проект ведётся по журналу ' + info.journalRel + '.'];
  if (info.hasJournal) {
    let now = getSection(fs.readFileSync(info.journalPath, 'utf8'), 'Сейчас');
    if (now) {
      if (now.length > MAX_NOW) now = now.slice(0, MAX_NOW) + '\n… (обрезано — полностью в ' + info.journalRel + ')';
      out.push('', '## Сейчас (из ' + info.journalRel + ')', now);
    } else {
      out.push('', 'В журнале нет раздела «Сейчас».');
    }
  } else {
    out.push('', 'Журнала ' + info.journalRel + ' нет — его создаёт /kit:project-init.');
  }
  out.push('', '## Правила процесса (плагин kit)', ...RULES);
  const p = info.params;
  // «PhpStorm Always» — автозаливка на сервер окружения (при «Окружение: дев» — на дев); «вручную; дев — PhpStorm Always»
  // (до 2.17.0) — только на дев; «Claude по SSH» — заливает /kit:step-done.
  const deploy = p.get('Выкладка', '').trim();
  const always = /always/i.test(deploy);
  const ssh = /^claude по ssh/i.test(deploy);
  if (always) out.push(/^phpstorm always/i.test(deploy) ? (serverEnv(p) === 'дев' ? RULE_ALWAYS_ON_DEV : RULE_ALWAYS) : RULE_ALWAYS_DEV);
  if (ssh) {
    out.push(RULE_SSH);
    if (phpStormAlways(info.dir)) out.push(WARN_SSH_ALWAYS);
  }
  const who = p.get('Код пишет', '').toLowerCase();
  if (who.startsWith('пользов')) out.push(RULE_USER);
  else if (who.startsWith('claude')) out.push(ssh ? RULE_CLAUDE_SSH : RULE_CLAUDE);
  // После правил автозаливки и «Код пишет» — уточняет их для worktree.
  if (always && inWorktree(info.dir)) out.push(RULE_WORKTREE);
  if (!/^сразу/i.test(p.get('Коммит', '').trim())) out.push(RULE_REVIEW);
  if (!p.found) out.push(RULE_NO_PARAMS);
  out.push(docsRule(info.docsRel));
  // Журнал по частям (с 2.13.0): в журнале — только текущее, остальное — в journal/ рядом с ним.
  if (info.hasJournal && fs.existsSync(path.join(path.dirname(info.journalPath), 'journal'))) {
    const parts = (info.docsRel === '.' ? '' : info.docsRel + '/') + 'journal/';
    out.push('- Журнал по частям: решения — ' + parts + 'decisions.md, баги — ' + parts + 'bugs.md, справочник и материалы заказчика — '
      + parts + 'reference.md, закрытые этапы — ' + parts + 'stages/; ищи и там.');
  }
  out.push(superpowersRule(info.docsRel));
  if (always) out.push(RULE_SP_ALWAYS);
  return out.join('\n') + '\n';
}

function main() {
  try {
    const input = readStdinJson();
    const text = buildContext(kitInfo(resolveProjectDir(input)));
    if (text) process.stdout.write(text);
  } catch (e) {
    // хук не должен ломать сессию
  }
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { buildContext, inWorktree, docsRule };
