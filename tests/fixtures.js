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
  'Код пишет': 'Claude',
  'Окружение': 'прод',
  'Выкладка': 'PhpStorm Always',
  'Прод': 'https://alpha.example.com',
  'Дев': '—',
  'PHP': '`C:\\OSPanel\\modules\\PHP-7.4\\php.exe`',
  'Журнал': 'docs/progress.md',
  'План выкладки': 'docs/deploy-prod.md',
  'ID шага': 'N.M (например 0.3, 2.1)',
  'Не выкладывать': '.idea, .git, .claude/scripts, .claude/settings.local.json',
  'Не коммитить': 'bitrix/, upload/ (кроме upload/docs/), *.back*',
  'Секреты': 'bitrix24.ru/rest/, apikey=, "API_KEY" =>',
};

const GAMMA = {
  'Режим': 'bitrix',
  'Код пишет': 'пользователь',
  'Окружение': 'дев+прод',
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
    '> Ведёт агент docs-keeper после каждого проверенного шага.', '',
    '## Сейчас', '', now, '',
    '## Решения', '', '| Дата | Решение |', '|---|---|', '| 2026-09-23 | Тест |', '',
  ].join('\n');
}

module.exports = { paramsMd, ALPHA, GAMMA, ALPHA_CLAUDE_MD, GAMMA_CLAUDE_MD, progressMd };
