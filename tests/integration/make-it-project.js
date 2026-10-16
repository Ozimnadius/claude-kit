'use strict';
// Готовит временный kit-проект для проверки плагина через claude --plugin-dir.
// Запуск: node tests/integration/make-it-project.js <новая папка> [--old] [--deployment]
//   без флагов    формат kit 3.0: .claude/docs, журнал по частям, этап 0 со столбцом «Как проверено», план с чек-листом
//   --old         старый формат — для проверки переезда (/kit:project-init): журнал одним файлом в docs/, «Код пишет»
//   --deployment  .idea/deployment.xml без исключений (сервер ftp, автозаливка) — для хука phpstorm-exclude.js
const fs = require('fs');
const path = require('path');
const { git, writeFiles } = require('../helpers');
const { paramsMd, progressMd } = require('../fixtures');
const { NO_BLOCK } = require('../deployment-fixtures');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target || fs.existsSync(target)) {
  console.error('Нужна новая папка: node tests/integration/make-it-project.js <папка> [--old] [--deployment]');
  process.exit(1);
}
const old = args.includes('--old');
const docs = old ? 'docs' : '.claude/docs';
const dir = path.resolve(target);
const now = ['- **Этап:** 0 — подготовка (начат 2026-10-16)', '- **Следующий шаг:** 0.2 — проверка плагина', '- **Блокеры и открытые вопросы:** —'].join('\n');
const params = {
  'Режим': 'bitrix',
  'Окружение': 'прод',
  'Выкладка': 'вручную',
  'Прод': 'https://example.invalid',
  'PHP': 'C:\\OSPanel\\modules\\PHP-7.4\\php.exe',
  'Журнал': docs + '/progress.md',
  'План выкладки': docs + '/deploy-prod.md',
  'Не выкладывать': '.idea, .git, .claude',
};
const journal = old ? {
  [docs + '/progress.md']: progressMd(now) + [
    '', '## Этап 0 — подготовка', '',
    '| Шаг | Статус | Что сделано | Коммит |', '|---|---|---|---|',
    '| 0.1 | ✅ | исходники | |', '| 0.2 | ⏳ | проверка плагина | |', '',
  ].join('\n'),
} : {
  [docs + '/progress.md']: [
    '# Журнал работ — kit-it', '', '## Сейчас', '', now, '',
    '## Этапы', '', '| Этап | Название | Файл |', '|---|---|---|', '| 0 | подготовка | ниже |', '',
    '## Документы', '', '| Файл | О чём | Статус |', '|---|---|---|', '| work/plan-0.md | план подготовки | в работе, этап 0 |', '',
    '## Прод: не забыть', '', '- (пока пусто)', '',
    '## Этап 0 — подготовка', '',
    '| Шаг | Статус | Что сделано | Как проверено |', '|---|---|---|---|',
    '| 0.1 | ✅ | исходники | `git status` — чисто |', '| 0.2 | ⏳ | проверка плагина | |', '',
  ].join('\n'),
  [docs + '/journal/decisions.md']: ['# kit-it — решения', '', '## Решения', '',
    '| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |', '|---|---|---|---|---|---|---|', ''].join('\n'),
  [docs + '/journal/bugs.md']: ['# kit-it — баги', '', '## Баги на потом', '', '| № | Баг | Где | Статус |', '|---|---|---|---|', ''].join('\n'),
  [docs + '/journal/reference.md']: ['# kit-it — справочник и материалы заказчика', '',
    '## Материалы заказчика', '', '- (пока пусто)', '', '## Справочник', '', '- (пока пусто)', ''].join('\n'),
  [docs + '/work/plan-0.md']: '# План подготовки\n\n## Чек-лист\n\n- [x] 0.1 — исходники\n- [ ] 0.2 — проверка плагина\n',
};
const files = {
  '.claude/CLAUDE.md': paramsMd(old ? { 'Код пишет': 'Claude', ...params } : params, '# kit-it — правила работы'),
  ...journal,
  [docs + '/deploy-prod.md']: [
    '# Выкладка на прод — kit-it', '', '## Общие правила', '', '- тест', '',
    '## Залито на прод', '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|', '',
    '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', '',
  ].join('\n'),
  'index.php': '<?php\necho "ok";\n',
  '.gitignore': '/.idea/\n',
};
if (args.includes('--deployment')) files['.idea/deployment.xml'] = NO_BLOCK;
writeFiles(dir, files);
git(dir, 'init', '-q');
git(dir, 'config', 'core.autocrlf', 'input');
git(dir, 'add', '-A');
git(dir, 'commit', '-q', '-m', '0.1: исходники');
console.log(dir);
