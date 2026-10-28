#!/usr/bin/env node
'use strict';
// Хук SessionStart (startup|resume|clear|compact): раздел «Сейчас» из журнала и правила процесса в контекст.
// С 3.1.0 — JSON: контекст — в hookSpecificOutput.additionalContext, напоминание о версии kit — пользователю (systemMessage).
// С 3.3.0 в проекте с «Система Мэтта: да» и плагином mattpocock-skills на проекте — правила Мэтта вместо правил superpowers;
// плагина нет — правила superpowers и напоминание о /kit:project-init (в контекст и пользователю).
// Вне kit-проекта молчит. Любая ошибка — тихий выход 0.
const fs = require('fs');
const path = require('path');
const { readStdinJson, resolveProjectDir, kitInfo, serverEnv } = require('./lib/project');
const { getSection } = require('./lib/md');
const { readDeployment } = require('./lib/deployment');
const { oldFormat, oldFormatText } = require('./lib/journal');
const { isMattProject, mattPlugin, bigWorkActive, MATT_VERIFIED } = require('./lib/matt');

const MAX_NOW = 4000;

const RULES = [
  '- Один шаг за раз: следующий — только после проверки предыдущего.',
  '- Выбор за пользователем; вопросы — только через AskUserQuestion.',
  '- После проверенного шага — /kit:step-done (kit-step.js → kit-journal.js → kit-commit.js, один коммит на шаг).',
  '- Git пользователь не трогает, команды git ему не выдаём; коммиты — только через /kit:step-done (скрипт kit-commit.js).',
  '- Переводы строк LF; файлы целиком не переформатировать.',
  '- Грабли: cd в Bash меняет каталог всей сессии — только абсолютные пути или ( cd … ); PHP не править sed (портит \\ неймспейсов) — только Edit; Git Bash переписывает аргументы вида /путь — PowerShell или MSYS_NO_PATHCONV=1.',
];
const ruleAlways = (where) => '- Выкладка: PhpStorm Always — любое сохранение в проекте сразу уходит на ' + where + '. Черновики — только во временной папке сессии; PHP собрать и проверить php -l там, в проект — одной правкой. Удаление локально сервер не трогает.';
const RULE_ALWAYS = ruleAlways('сервер');
const RULE_ALWAYS_ON_DEV = ruleAlways('дев-сервер');
// Проверка страницы — одним пакетным вызовом браузера (с 3.0.0): по замерам браузер — четверть всех ходов модели.
const BATCH = 'страницу проверяй одним пакетным вызовом браузера (browser_batch: открыть, снимок на десктопе, мобильная ширина, снимок), снимки — уменьшенные';
const RULE_CLAUDE = '- Код пишет Claude: после записи проверить результат на сервере (страница, десктоп и мобильная ширина); ' + BATCH + '.';
// «Выкладка: Claude по SSH» (с 2.17.0): на сервер шаг уезжает только из /kit:step-done — после просмотра пользователем.
const RULE_SSH = '- Выкладка: Claude по SSH — правки остаются локально, пока /kit:step-done не зальёт их после просмотра '
  + '(ssh-deploy.js: всё, что изменилось с последней заливки, удаления — тоже); проверка на сервере — после заливки, потом коммит; '
  + 'не прошла — правка и снова просмотр. Вне /kit:step-done на сервер не заливай.';
const RULE_CLAUDE_SSH = '- Код пишет Claude: результат на сервере проверяй после заливки в /kit:step-done (страница, десктоп и мобильная ширина); '
  + 'до неё — php -l и локальные проверки; ' + BATCH + '.';
const WARN_SSH_ALWAYS = '- Внимание: выкладка — Claude по SSH, а в PhpStorm включена автозаливка (.idea/deployment.xml: Always) — '
  + 'файлы уедут на сервер дважды и до просмотра. В первом ответе скажи пользователю выключить: PhpStorm → Tools → Deployment → Automatic Upload.';
// Коммит — только после просмотра пользователем (с 2.15.0; с 3.0.0 — всегда, параметра «Коммит» нет).
const RULE_REVIEW = '- Коммит — после просмотра: /kit:step-done показывает незакоммиченные изменения (панель изменений приложения Claude) '
  + 'и коммитит только после ответа «Коммитить» (в режиме «Claude по SSH» — «Залить на сервер»); вопросы пользователь задаёт комментариями к строкам.';
const RULE_NO_PARAMS = '- В .claude/CLAUDE.md нет раздела «Параметры для агентов» — предложи пользователю /kit:project-init (дополнит недостающее).';
const SPEC_TEMPLATE = path.join(__dirname, '..', 'skills', 'project-init', 'templates', 'spec.md');
const RULE_SP_ALWAYS = '- Superpowers при автозаливке: без отдельных веток и worktree (.worktrees, using-git-worktrees) — правки из них не дойдут до сервера.';
const RULE_WORKTREE ='- Сессия работает в git worktree — правки здесь не попадут на сервер автозаливкой основной папки, пока их не сольют в основную ветку; не проверяй результат на сервере сразу после записи.';
// Система Мэтта (с 3.3.0): путь к скрипту навыков — абсолютный, с «/», как у SPEC_TEMPLATE.
const MATT_SKILL_SCRIPT = path.join(__dirname, 'matt-skill.js').replace(/\\/g, '/');
const MATT_REMIND = '- Система Мэтта: да, но плагин mattpocock-skills на этот проект не поставлен или выключен — запустите /kit:project-init (поставит его и выключит superpowers в проекте).';
const MATT_REMIND_USER = '[kit] Система Мэтта: плагин mattpocock-skills на этот проект не поставлен — запустите /kit:project-init.';

// Установленная версия kit — из манифеста плагина, рядом со скриптом.
function installedVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version || '');
  } catch (e) {
    return '';
  }
}

// -1 / 0 / 1; не версия вида X.Y.Z — null.
function cmpVersion(a, b) {
  const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// Отметка «Версия kit» (с 3.1.0, ставит /kit:project-init) против установленной: любое расхождение — напоминание.
// Раздела параметров нет — молчит (там своё правило про /kit:project-init).
function versionNote(params, installed) {
  if (!params.found || !installed) return '';
  const mark = String(params.get('Версия kit', '')).trim();
  if (!mark) return 'Версия kit в проекте не отмечена (установлен ' + installed + ') — запустите /kit:project-init: он догонит настройку проекта и поставит отметку.';
  const c = cmpVersion(mark, installed);
  if (c === 0) return '';
  if (c === 1) return 'Проект настроен на kit ' + mark + ', а установлен более старый ' + installed + ' — обновите плагин: claude plugin update kit@claude-kit.';
  return 'Проект настроен на kit ' + mark + ', установлен ' + installed + ' — запустите /kit:project-init, чтобы догнать настройку проекта.';
}

// Где лежат документы проекта (старую раскладку docs/ ловит правило старого формата).
function docsRule(docsRel) {
  return '- Документы проекта — в ' + docsRel + '/: планы, спеки, чек-листы, материалы — в work/, готовое — в archive/, '
    + 'реестр — раздел «Документы» журнала; новый документ — строкой DOCS в /kit:step-done.';
}

// Superpowers работает по правилам kit: его скиллы сами пишут в docs/superpowers/ и коммитят — правила проекта важнее.
function superpowersRule(docsRel) {
  const work = docsRel + '/work/';
  return '- Superpowers по правилам kit: спеки и планы — в ' + work + ' (spec-<тема>.md по шаблону ' + SPEC_TEMPLATE.replace(/\\/g, '/')
    + ', plan-<тема>.md с разделом «Чек-лист» в начале: строка на задачу «- [ ] N.M — …», шаги внутри задач — без чекбоксов), '
    + 'не в docs/superpowers/; superpowers сам не коммитит — коммит только через /kit:step-done; '
    + 'задача плана = шаг kit N.M; выбранный подход и отвергнутые — в DECISIONS; TDD — только где в проекте есть тесты.';
}

// Правила проекта с «Система Мэтта: да» (вместо правил superpowers) → { on, lines, user }.
// on — плагин mattpocock-skills на проекте и включён: lines — правила Мэтта; иначе lines — напоминание о /kit:project-init,
// user — то же пользователю (systemMessage). Не проект Мэтта — всё пусто, installed_plugins.json не читается.
function mattRules(info) {
  const off = { on: false, lines: [], user: '' };
  if (!info.isKit || !isMattProject(info.params)) return off;
  let plugin;
  try {
    plugin = mattPlugin(info.dir);
  } catch (e) {
    // не смогли определить — как «не поставлен»
    plugin = { installed: false, enabled: false, version: '' };
  }
  if (!plugin.installed || !plugin.enabled) return { on: false, lines: [MATT_REMIND], user: MATT_REMIND_USER };
  const docs = info.docsRel;
  const lines = [
    '- Система Мэтта (проект Мэтта): навыки mattpocock-skills — всегда с префиксом mattpocock-skills:, superpowers в проекте выключен. '
      + 'Большая работа (не влезет в одну-две сессии) — по навыку /kit:matt: общая сессия, исполнитель на каждый тикет, приёмка через /kit:step-done; '
      + 'без пользователя (он сам разрешил) — коммит без просмотра по /kit:matt, разбор потом. Мелкая задача — сделать и закрыть /kit:step-done. '
      + 'Навыки только по команде (wayfinder, to-spec, to-tickets, implement и др.) читай файлом: node "' + MATT_SKILL_SCRIPT + '" <имя>. '
      + 'implement-spec и setup-matt-pocock-skills не используются; вопросы грилинга — через AskUserQuestion.',
    '- Файлы системы Мэтта — в ' + docs + '/: карта, тикеты-решения и спек — work/<тема>/ (map.md, issues/NN-<slug>.md, spec.md), '
      + 'тикеты реализации — work/<тема>-build/ (issues/NN-<slug>.md, README.md), глоссарий — GLOSSARY.md, ADR — adr/NNNN-<slug>.md, '
      + 'исследования и прочие документы навыков — work/, прототипы prototype — HTML в work/<тема>/ (варианты экранов на сайте — только где правки не уходят на прод сами); '
      + 'трекер задач — эти локальные файлы. В корень проекта (GLOSSARY.md, CONTEXT.md, docs/adr/, docs/agents/, .scratch/) не пиши.',
  ];
  // Версия плагина изменилась — правила kit проверены на другой; важно, пока идёт большая работа.
  if (plugin.version !== MATT_VERIFIED && bigWorkActive(info.dir, docs)) {
    lines.push('- Плагин Мэтта обновился: правила kit проверены на ' + MATT_VERIFIED + ', стоит ' + plugin.version
      + ' — если навык ведёт себя не так, как в /kit:matt (пути, имена навыков, поля тикетов), сверь и скажи пользователю.');
  }
  return { on: true, lines, user: '' };
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

// matt — уже посчитанные mattRules(info) (main считает один раз и для текста, и для напоминания пользователю).
function buildContext(info, matt = mattRules(info)) {
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
  // «PhpStorm Always» — автозаливка на сервер окружения (при «Окружение: дев» — на дев); «Claude по SSH» — заливает /kit:step-done.
  const deploy = p.get('Выкладка', '').trim();
  const always = /^phpstorm always/i.test(deploy);
  const ssh = /^claude по ssh/i.test(deploy);
  if (always) out.push(serverEnv(p) === 'дев' ? RULE_ALWAYS_ON_DEV : RULE_ALWAYS);
  if (ssh) {
    out.push(RULE_SSH);
    if (phpStormAlways(info.dir)) out.push(WARN_SSH_ALWAYS);
  }
  // Проверка на сервере — только если у окружения есть адрес («Прод» при «Окружение: прод», «Дев» при «дев»).
  if (p.get(serverEnv(p) === 'дев' ? 'Дев' : 'Прод', '')) out.push(ssh ? RULE_CLAUDE_SSH : RULE_CLAUDE);
  // После правил автозаливки и проверки на сервере — уточняет их для worktree.
  if (always && inWorktree(info.dir)) out.push(RULE_WORKTREE);
  out.push(RULE_REVIEW);
  const signs = oldFormat(info);
  if (signs.length) out.push('- ' + oldFormatText(signs));
  if (!p.found) out.push(RULE_NO_PARAMS);
  const note = versionNote(p, installedVersion());
  if (note) out.push('- ' + note + ' Пользователь видит это напоминание; запускать или нет — решает он.');
  out.push(docsRule(info.docsRel));
  // Журнал по частям (с 2.13.0): в журнале — только текущее, остальное — в journal/ рядом с ним.
  if (info.hasJournal && fs.existsSync(path.join(path.dirname(info.journalPath), 'journal'))) {
    const parts = info.docsRel + '/journal/';
    out.push('- Журнал по частям: решения — ' + parts + 'decisions.md, баги — ' + parts + 'bugs.md, справочник и материалы заказчика — '
      + parts + 'reference.md, закрытые этапы — ' + parts + 'stages/; ищи и там.');
  }
  // Проект Мэтта с плагином — правила Мэтта вместо правил superpowers; иначе superpowers, а при «да» без плагина — ещё и напоминание.
  if (!matt.on) {
    out.push(superpowersRule(info.docsRel));
    if (always) out.push(RULE_SP_ALWAYS);
  }
  out.push(...matt.lines);
  return out.join('\n') + '\n';
}

function main() {
  try {
    const info = kitInfo(resolveProjectDir(readStdinJson()));
    const matt = mattRules(info);
    const text = buildContext(info, matt);
    if (text) {
      const o = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
      // Пользователю: напоминание о версии kit и напоминание о Мэтте — через перевод строки.
      const note = versionNote(info.params, installedVersion());
      const notes = [];
      if (note) notes.push('[kit] ' + note);
      if (matt.user) notes.push(matt.user);
      if (notes.length) o.systemMessage = notes.join('\n');
      process.stdout.write(JSON.stringify(o) + '\n');
    }
  } catch (e) {
    // хук не должен ломать сессию
  }
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { buildContext, mattRules, inWorktree, docsRule, versionNote, cmpVersion };
