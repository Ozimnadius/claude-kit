'use strict';
// Готовит временный kit-проект для проверки плагина через claude --plugin-dir.
// Запуск: node tests/integration/make-it-project.js <новая папка> [--old] [--deployment]
//   --old         старая раскладка: журнал и план выкладки в docs/ (без реестра и work/)
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
const now = ['- **Этап:** 0 — подготовка', '- **Следующий шаг:** 0.2 — проверка плагина', '- **Блокеры и открытые вопросы:** —'].join('\n');
const registry = old ? [] : [
  '', '## Документы', '',
  '| Файл | О чём | Статус |', '|---|---|---|',
  '| work/plan-0.md | план подготовки | в работе, этап 0 |',
];
const files = {
  '.claude/CLAUDE.md': paramsMd({
    'Режим': 'bitrix',
    'Код пишет': 'Claude',
    'Окружение': 'прод',
    'Выкладка': 'вручную',
    'Прод': 'https://example.invalid',
    'PHP': 'C:\\OSPanel\\modules\\PHP-7.4\\php.exe',
    'Журнал': docs + '/progress.md',
    'План выкладки': docs + '/deploy-prod.md',
    'Не выкладывать': '.idea, .git, .claude',
  }, '# kit-it — правила работы'),
  [docs + '/progress.md']: progressMd(now) + [
    ...registry,
    '', '## Этап 0 — подготовка', '',
    '| Шаг | Статус | Что сделано | Коммит |', '|---|---|---|---|',
    '| 0.1 | ✅ | исходники | |', '| 0.2 | ⏳ | проверка плагина | |', '',
  ].join('\n'),
  [docs + '/deploy-prod.md']: [
    '# Выкладка на прод — kit-it', '', '## Общие правила', '', '- тест', '',
    '## Залито на прод', '', '| Шаг | Дата | Файлы | Коммит | Проверка |', '|---|---|---|---|---|', '',
    '## Удалить с сервера', '', '| Путь | Почему | Удалён |', '|---|---|---|', '',
  ].join('\n'),
  'index.php': '<?php\necho "ok";\n',
  '.gitignore': '/.idea/\n',
};
if (!old) files[docs + '/work/plan-0.md'] = '# План подготовки\n\n- проверить плагин\n';
if (args.includes('--deployment')) files['.idea/deployment.xml'] = NO_BLOCK;
writeFiles(dir, files);
git(dir, 'init', '-q');
git(dir, 'config', 'core.autocrlf', 'input');
git(dir, 'add', '-A');
git(dir, 'commit', '-q', '-m', '0.1: исходники');
console.log(dir);
