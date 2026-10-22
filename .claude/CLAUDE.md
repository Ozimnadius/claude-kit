# claude-kit — правила работы

**После новой сессии или сжатия контекста первым делом прочитай `.claude/docs/progress.md`**: там текущий шаг, решения и баги.

## Проект

- Личный маркетплейс Claude Code `claude-kit` с плагином `kit` (`plugins/kit/`): агенты, скиллы, хуки и node-скрипты для проектов пользователя.
- Документы — в `.claude/docs/`: журнал `progress.md` и его части в `journal/`; текущее — в `work/` (спек и план этапа, замечания и идеи пользователя `MyIdeas.md`, обзор `overview/`); готовое — в `archive/` (спеки и планы завершённых этапов; общий спек плагина `spec-claude-kit.md` — заморожен на 2.18.0); реестр — раздел «Документы» журнала. `.claude` — защищённая папка Claude Code: в режимах Manual/acceptEdits запись просит подтверждения.
- Перед коммитом: `npm test` (`node --test tests/*.test.js`), `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Один проверенный шаг — один коммит `ID: …`; исправления после ревью — отдельными коммитами с тем же ID и буквой (`6.2а`, `6.2б`), без amend.
- Установленный плагин — копия в кэше `~/.claude/plugins/cache/claude-kit/kit/<версия>`. Выпуск: поднять `version` в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json` → слить в `master` основного checkout `C:\OSPanel\home\claude-kit` → `claude plugin marketplace update claude-kit` и `claude plugin update kit@claude-kit`. Без повышения версии обновление не происходит.
- Что трогает выпуск: версии в `plugin.json` и `marketplace.json`, README (если меняется то, что видит пользователь) и журнал. Обзор `work/overview/` (правки — в `build/`, затем `node .claude/docs/work/overview/build/build.js`) — только при мажорном выпуске или при выпуске, который добавляет или убирает команду, агента, хук, скрипт либо режим. Общий спек `archive/spec-claude-kit.md` не дописывается: новое — спеки этапов и README.
- Удалённый репозиторий — https://github.com/Ozimnadius/claude-kit (публичный с этапа 20, лицензия MIT), `origin`; после выпуска (слияние в `master`) отправлять `master`: `git push origin master` — только с согласия пользователя.
- **Репозиторий публичный:** в файлы (журнал, планы, спек, тесты, плагин) и в сообщения коммитов не писать имена проектов пользователя и их клиентов, домены, учётки хостинга, IP, личные пути — только обезличенно: проекты — alpha, beta, gamma…, домены — `*.example.com`, учётки — `user100`, IP — `203.0.113.x`, пути — `C:\Users\user`. То же — в блоках шага для `kit-journal.js`. Страховка — хуки git `pre-commit` и `commit-msg` (`node tools/kit-denylist.js install`): не пропускают слова из локального списка `.git/info/kit-denylist` (на GitHub не уходит; на новом компьютере — список у пользователя, хуки поставить заново); перед `push` — `node tools/kit-denylist.js tree`.
- Файлы — UTF-8 без BOM, LF; `.superpowers/` — рабочие материалы, в git не кладём.

## Параметры для агентов

Читают агенты, хуки и скиллы плагина kit. Формат строк не менять: `- Ключ: значение`, списки через запятую.

- Режим: общий
- Окружение: —
- Выкладка: вручную
- Прод: —
- Дев: —
- PHP: —
- Журнал: .claude/docs/progress.md
- План выкладки: —
- ID шага: N.M (исправления после ревью — N.Mа, N.Mб)
- Не выкладывать: —
- Не коммитить: .superpowers
- Секреты: —
- Версия kit: 3.2.3
