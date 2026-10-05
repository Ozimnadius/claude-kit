# плагин kit (маркетплейс claude-kit) — этап 5

## Этап 5 — скиллы

| Шаг | Статус | Что сделано | Коммит |
|---|---|---|---|
| 5.1 | ✅ | Скиллы `/kit:step-done` (собирает блоки, вызывает docs-keeper → git-keeper, проверяет один коммит и подпись) и `/kit:deploy-list` (обёртка над `deploy-list.js`, запись выкладки через step-done) | `9c51bbd`, `53d3afc` |
| 5.2 | ✅ | `/kit:project-init`: разведка (git, файлы kit, Битрикс, PhpStorm), вопросы через AskUserQuestion, план на согласие, git+`.gitignore`+скан секретов+первый коммит, `.htaccess` для `docs/` и `.claude/`, `.claude/CLAUDE.md` с «Параметрами для агентов», журнал и план выкладки, в режиме bitrix — версия PHP прода, исключения PhpStorm/File Watchers, проверка закрытости снаружи; справки phpstorm.md и bitrix.md | `835431f`, `380e77f`, `ffc3119` |
| 5.3 | ✅ | `/kit:bitrix-console`: своя вкладка Chrome, поиск редактора в `BXCodeEditors` по `pTA.id`, вставка кода и сверка, запуск кнопкой с `__FPHPSubmit`, чтение `<pre>`; изменяющие скрипты — только с согласия пользователя и после сухого прогона | `8a81d4f`, `a73be69` |
