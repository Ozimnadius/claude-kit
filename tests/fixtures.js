'use strict';
// Тексты проектных файлов для тестов.

function paramsMd(values, title = '# Тестовый проект — правила работы') {
  const lines = Object.entries(values).map(([k, v]) => `- ${k}: ${v}`);
  return [
    title, '', '## Проект', '', '- Тест.', '',
    '## Параметры для агентов', '',
    'Читают агенты, хуки и скиллы плагина kit. Формат строк не менять: `- Ключ: значение`, списки через запятую.', '',
    ...lines, '',
  ].join('\n');
}

const ALPHA = {
  'Режим': 'bitrix',
  'Окружение': 'прод',
  'Выкладка': 'PhpStorm Always',
  'Прод': 'https://alpha.example.com',
  'Дев': '—',
  'PHP': '`C:\\OSPanel\\modules\\PHP-7.4\\php.exe`',
  'Журнал': '.claude/docs/progress.md',
  'План выкладки': '.claude/docs/deploy-prod.md',
  'ID шага': 'N.M (например 0.3, 2.1)',
  'Не выкладывать': '.idea, .git, .claude/scripts, .claude/settings.local.json',
  'Не коммитить': 'bitrix/, upload/ (кроме upload/docs/), *.back*',
  'Секреты': 'bitrix24.ru/rest/, apikey=, "API_KEY" =>',
};

const GAMMA = {
  'Режим': 'bitrix',
  'Окружение': 'прод',
  'Выкладка': 'вручную',
  'Прод': 'https://gamma.example.com',
  'Дев': 'http://user200.hosting.example',
  'PHP': 'C:\\OSPanel\\modules\\PHP-8.2\\php.exe',
  'Не выкладывать': '.idea, .claude, .git, .gitignore, local/modules',
};

const ALPHA_CLAUDE_MD = paramsMd(ALPHA, '# alpha.example.com — правила работы');
const GAMMA_CLAUDE_MD = paramsMd(GAMMA, '# gamma.example.com — правила работы');

const DEFAULT_NOW = [
  '- **Этап:** 1 — изучение',
  '- **Следующий шаг:** 1.2 — инвентаризация на проде',
  '- **Блокеры и открытые вопросы:** —',
].join('\n');

function progressMd(now = DEFAULT_NOW) {
  return [
    '# Журнал работ — тест', '',
    '> Ведёт /kit:step-done после каждого проверенного шага.', '',
    '## Сейчас', '', now, '',
    '## Решения', '', '| Дата | Решение |', '|---|---|', '| 2026-09-23 | Тест |', '',
  ].join('\n');
}

// Журнал формата kit 3.0 по частям: progress.md с таблицей этапа «… | Как проверено |» и journal/decisions.md
// с таблицей решений «| № | … | Почему | Что отвергли | Кто |». docs — папка журнала (для старой раскладки — 'docs').
function journalFiles(now = DEFAULT_NOW, docs = '.claude/docs') {
  return {
    [docs + '/progress.md']: [
      '# Журнал работ — тест', '',
      '## Сейчас', '', now, '',
      '## Этапы', '', '| Этап | Название | Файл |', '|---|---|---|', '| 1 | изучение | ниже |', '',
      '## Этап 1 — изучение', '',
      '| Шаг | Статус | Что сделано | Как проверено |', '|---|---|---|---|',
      '| 1.1 | ✅ | инвентаризация | тест |', '| 1.2 | ⏳ | инвентаризация на проде | |', '',
    ].join('\n'),
    [docs + '/journal/decisions.md']: [
      '# Решения', '',
      '| № | Дата | Шаг | Решение | Почему | Что отвергли | Кто |', '|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | 1.1 | тест | проверка | — | пользователь |', '',
    ].join('\n'),
  };
}

// Рабочие папки в bitrix/ (с 3.2.0): исключения .gitignore и «Не коммитить» по справке project-init/reference/bitrix.md;
// файлы — две рабочие папки и два файла ядра (их .gitignore не пускает).
const WORK_GITIGNORE = ['/bitrix/*', '!/bitrix/templates/', '/bitrix/templates/*', '!/bitrix/templates/theme/',
  '!/bitrix/php_interface/', '/bitrix/php_interface/*', '!/bitrix/php_interface/init.php', ''].join('\n');
const WORK_RULE = 'bitrix/ (кроме bitrix/templates/theme, bitrix/php_interface/init.php), *.back*';
const WORK_FILES = { 'bitrix/templates/theme/a.php': 'a', 'bitrix/php_interface/init.php': '<?php', 'bitrix/php_interface/dbconn.php': '<?php', 'bitrix/modules/main/x.php': 'x' };

module.exports = { paramsMd, ALPHA, GAMMA, ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, progressMd, journalFiles, WORK_GITIGNORE, WORK_RULE, WORK_FILES };
