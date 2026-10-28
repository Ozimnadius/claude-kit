# Журнал работ — плагин kit (маркетплейс claude-kit)

> После каждого проверенного шага обновляется журнал и делается один коммит `ID: …`. После сжатия контекста и в новой сессии читать первым. Общий спек плагина заморожен на 2.18.0 — `.claude/docs/archive/spec-claude-kit.md`; спеки этапов и другие документы — раздел «Документы».

## Сейчас

- **Этап:** 47 — система Мэтта Покока в kit-проектах (начат 2026-10-28); последний шаг 47.8а — исправления по итоговой проверке этапа 47 до публикации 3.3.0: строка «Крупная задача» в шаблоне CLAUDE.md — вариант для системы Мэтта (по /kit:matt, спек и план kit не пишутся), выбор в п. 4.3 и замена в существующем файле при смене ответа в п. 4.6а, страховка в правиле Мэтта session-start.js; /kit:matt — исполнителю нельзя вызывать /kit:step-done, без «Система Мэтта: да» навык не применяется, поле session — в .claude/kit-inbox.jsonl, без пользователя — без --push до разбора; напоминание «не поставлен или выключен», в перечне корня GLOSSARY-MAP.md и CONTEXT-MAP.md; README и обзор
- **Следующий шаг:** 47.9 — выпуск kit 3.3.0: отправка, установка и живая проверка; этап закрыт
- **Блокеры и открытые вопросы:** отложено (решение 2026-10-16, подтверждено этапом 39): короткий контекст — /clear после каждого шага и порог автосжатия autoCompactWindow 400K; это следующее облегчение kit (вариант Г) — вернуться после работы с kit 3.x в нескольких проектах

## Этапы

Части журнала: решения — `journal/decisions.md`, баги — `journal/bugs.md`, справочник и материалы заказчика — `journal/reference.md`, закрытые этапы — `journal/stages/`.

| Этап | Название | Файл |
|---|---|---|
| 0 | подготовка | `journal/stages/stage-00.md` |
| 1 | каркас и библиотека | `journal/stages/stage-01.md` |
| 2 | хуки | `journal/stages/stage-02.md` |
| 3 | инструменты | `journal/stages/stage-03.md` |
| 4 | агенты | `journal/stages/stage-04.md` |
| 5 | скиллы | `journal/stages/stage-05.md` |
| 6 | проверка и выпуск | `journal/stages/stage-06.md` |
| 8 | SSH: `/kit:server` (SSH, иначе Командная PHP-строка) | `journal/stages/stage-08.md` |
| 9 | правки после выпуска 2.0 | `journal/stages/stage-09.md` |
| 10 | снимки публичной части: `/kit:visual` | `journal/stages/stage-10.md` |
| 11 | папка документов `.claude/docs` и исключения PhpStorm | `journal/stages/stage-11.md` |
| 12 | файл-канал `kit-exec.php` и баги канала `/kit:server` | `journal/stages/stage-12.md` |
| 13 | разбор открытых багов плагина | `journal/stages/stage-13.md` |
| 14 | исправления по code-review плагина kit (К31–К40) | `journal/stages/stage-14.md` |
| 15 | обзор плагина для GitHub | `journal/stages/stage-15.md` |
| 16 | удалённый репозиторий проекта (работа с другого компьютера) | `journal/stages/stage-16.md` |
| 17 | исправление багов К42–К50 (после этапа 16) | `journal/stages/stage-17.md` |
| 18 | документы проекта и на сервере: параметр «Документы на сервере» | `journal/stages/stage-18.md` |
| 19 | скиллы Битрикса в проекте: `/kit:project-init` ставит их в `.claude/skills` | `journal/stages/stage-19.md` |
| 20 | публичный репозиторий: обезличивание, лицензия MIT, локальная защита от утечек, история одним чистым коммитом, выпуск 2.7.1 | `journal/stages/stage-20.md` |
| 21 | история проекта: что делали, как проверили, почему так решили | `journal/stages/stage-21.md` |
| 22 | автосбор ответов AskUserQuestion | `journal/stages/stage-22.md` |
| 23 | сверка этапа при закрытии | `journal/stages/stage-23.md` |
| 24 | /kit:why, почему так сделано | `journal/stages/stage-24.md` |
| 25 | /kit:report, отчёт для заказчика | `journal/stages/stage-25.md` |
| 26 | чек-лист в планах, журнал по частям, обновлённый обзор | `journal/stages/stage-26.md` |
| 27 | уборка документов | `journal/stages/stage-27.md` |
| 28 | коммит шага скриптом `kit-commit.js` вместо агента git-keeper (К54) | `journal/stages/stage-28.md` |
| 29 | просмотр изменений перед коммитом в `/kit:step-done` (идея 1 из `MyIdeas.md`) | `journal/stages/stage-29.md` |
| 30 | К55: `/kit:project-init` не спрашивал «Документы на сервере» | `journal/stages/stage-30.md` |
| 31 | `/kit:project-init`: вопрос о выкладке после SSH, автозаливка выключена на время настройки, этап 0 — инициализация (идеи 1 и 3 раздела «Новые идеи и замечания» `MyIdeas.md`) | `journal/stages/stage-31.md` |
| 32 | выкладка «Claude по SSH» и один сервер на проект (прод или дев) (идеи 1 и 2 раздела «Новые идеи и замечания» `MyIdeas.md`) | `journal/stages/stage-32.md` |
| 33 | баги К56–К60 режима «Claude по SSH» (после этапа 32), выпуск 2.17.1 | `journal/stages/stage-33.md` |
| 34 | К61: ложная находка secret-scan на склейке строк, ключи SERVER_KEY/PRIVATE_KEY/SECRET_KEY и серверный ключ SmartCaptcha, выпуск 2.17.2 | `journal/stages/stage-34.md` |
| 35 | «Документы на сервере» в режиме «Claude по SSH» (замечание пользователя 2026-10-15: при «Документы на сервере: да» режим SSH не заливал `.claude`, как автозаливка PhpStorm) | `journal/stages/stage-35.md` |
| 36 | облегчение kit: закрытие шага скриптами, один формат, без двойного учёта | `journal/stages/stage-36.md` |
| 37 | плагин aspro: сверка доработок с обновлением решений Аспро | `journal/stages/stage-37.md` |
| 38 | отметка версии kit в проекте | `journal/stages/stage-38.md` |
| 39 | исследование: хранить документацию или хватит git (идея №5) | `journal/stages/stage-39.md` |
| 40 | исправления плагина aspro по проверке на настоящем обновлении | `journal/stages/stage-40.md` |
| 41 | исправления kit и aspro по живой проверке обновления Аспро на стенде | `journal/stages/stage-41.md` |
| 42 | исправления kit и aspro по второму прогону проверки на стенде (kit 3.2.0, aspro 1.2.0) | `journal/stages/stage-42.md` |
| 43 | исправления aspro по третьему прогону проверки на стенде (aspro 1.2.1) | `journal/stages/stage-43.md` |
| 44 | /kit:report: отчёт в задачу от имени пользователя, неформально, общими словами | `journal/stages/stage-44.md` |
| 45 | `.settings.php` модулей D7 в git: сужение запрета secret-scan | `journal/stages/stage-45.md` |
| 46 | ложная находка secret-scan на версии пакета в lock-файлах npm, выпуск kit 3.2.4 | `journal/stages/stage-46.md` |
| 47 | система Мэтта Покока в kit-проектах | ниже |

## Документы

| Файл | О чём | Статус |
|---|---|---|
| archive/spec-claude-kit.md | спек плагина kit до 2.18.0 | готово — заморожен на 2.18.0 |
| work/MyIdeas.md | замечания и идеи пользователя к плагину: замечания 1–4 закрыты (этапы 11–12), идея 1 — просмотр перед коммитом сделана (этап 29, 2.15.0), идея 2 — `.agents` вместо `.claude` закрыта решением №25; «Новые идеи и замечания» (2026-10-15): 3 (этап 0 = инициализация) сделана (этап 31, 2.16.0), 1 (выкладка в `/kit:project-init`, вариант «Claude по SSH») — частично этапом 31 (2.16.0), полностью этапом 32 (2.17.0), 2 сделана (этап 32, 2.17.0), 4 (отметка версии kit) сделана (этап 38, 3.1.0), 5 (документы или git) исследована (этап 39): пока kit 3.1, в будущем короткий контекст | постоянный |
| archive/plan-docs.md | план этапа 11 — папка документов и исключения PhpStorm | готово, этап 11 (2026-09-28) |
| archive/plan-claude-kit.md | план этапов 0–6 — каркас плагина | готово, этапы 0–6 (2026-09-24) |
| archive/plan-ssh.md | план этапа 8 — SSH, `/kit:server` | готово, этап 8 (2026-09-24) |
| archive/plan-visual.md | план этапа 10 — `/kit:visual` | готово, этап 10 (2026-09-28) |
| archive/plan-console.md | план этапа 12: файл-канал `kit-exec.php` для Битрикса без SSH и баги канала `/kit:server` (К13, К14, К16, К20), версия 2.4.0 | готово, этап 12 (2026-09-30) |
| work/overview/ | обзор устройства плагина kit со схемами: overview.md для GitHub, overview.html для браузера, схемы img/*.svg, генератор build/ (правки — в build/, собранные файлы не править) | постоянный |
| archive/plan-remote.md | план этапа 16: удалённый репозиторий проекта (задачи 16.3–16.9) | готово, этап 16 (2026-09-30) |
| archive/plan-history.md | план этапа 21: история проекта (задачи 21.1–21.4) | готово, этап 21 (2026-10-05) |
| archive/plan-journal.md | план этапа 26: чек-лист в планах, журнал по частям, обзор (задачи 26.1–26.7) | готово, этап 26 (2026-10-05) |
| archive/spec-commit.md | спек этапа 28: коммит шага скриптом `kit-commit.js` вместо агента git-keeper (К54) | готово, этап 28 (2026-10-05) |
| archive/plan-commit.md | план этапа 28 (задачи 28.1–28.4) | готово, этап 28 (2026-10-05) |
| archive/spec-claude-ssh.md | спек этапа 32: выкладка «Claude по SSH», один сервер на проект (прод или дев) | готово, этап 32 (2026-10-15) |
| archive/plan-claude-ssh.md | план этапа 32 (задачи 32.1–32.7) | готово, этап 32 (2026-10-15) |
| archive/spec-ssh-docs.md | спек этапа 35: «Документы на сервере» в режиме «Claude по SSH» (`ssh-deploy.js --docs`, п. 3в `/kit:step-done`, вопрос в `/kit:project-init`) | готово, этап 35 (2026-10-16) |
| archive/plan-ssh-docs.md | план этапа 35 (задачи 35.1–35.3) | готово, этап 35 (2026-10-16) |
| archive/spec-light.md | спек этапа 36: облегчение kit — закрытие шага скриптами, один формат, без двойного учёта | готово, этап 36 (2026-10-16) |
| archive/plan-light.md | план этапа 36 (задачи 36.1–36.8) | готово, этап 36 (2026-10-16) |
| archive/spec-aspro.md | спек этапа 37: плагин aspro (Т-1…Т-9) | готово, этап 37 (2026-10-18) |
| archive/plan-aspro.md | план этапа 37 | готово, этап 37 (2026-10-18) |
| archive/research-docs.md | исследование идеи №5: хранить документацию проекта или хватит git — лучшие практики 2025–2026, замер по записям сессий kit-проектов, варианты А–Г, решение пользователя (пока kit 3.1, в будущем короткий контекст) | готово, этап 39 (2026-10-19) |
| work/spec-matt.md | спек этапа 47: система Мэтта Покока в kit-проектах (выбор в /kit:project-init, общая сессия и исполнитель на тикет, режим без пользователя, хуки) | в работе, этап 47 |
| work/plan-matt.md | план этапа 47 (задачи 47.1–47.9; исполнение субагентами, effort high, для хуков xhigh) | в работе, этап 47 |

## Этап 47 — система Мэтта Покока в kit-проектах

| Шаг | Статус | Что сделано | Как проверено |
|---|---|---|---|
| 47.1 | ✅ | спек и план этапа 47 — система Мэтта Покока в kit-проектах: выбор в /kit:project-init, плагин на проект и superpowers выключен, общая сессия и исполнитель на тикет, приёмка через /kit:step-done, режим без пользователя, подстраховка хуками | npm test — 484 прошли, 3 пропущены, 0 упало; node tools/kit-denylist.js tree — код 0; спек проверен свежим агентом (один вопрос — папка тикетов реализации, решён по образцу alpha); спек одобрен пользователем 2026-10-27 |
| 47.2 | ✅ | lib/matt.js и matt-skill.js: признак проекта Мэтта (isMattProject), основная папка без хвоста worktree (projectRoot), плагин mattpocock-skills на проект — установлен, включён, версия, папка (mattPlugin по installed_plugins.json и enabledPlugins), путь к SKILL.md навыка по plugin.json (mattSkillFile), признак большой работы (bigWorkActive); скрипт matt-skill.js <имя> и --status | node --test tests/matt.test.js — 12 из 12; npm test — 499 тестов, 496 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; свежий проверяющий — две находки (имя навыка constructor ломало mattSkillFile, --status при сбое давал код 2), исправлены, повторная проверка — все исправлены; на настоящем installed_plugins.json matt-skill.js --status — «установлен 1.3.1, включён» |
| 47.3 | ✅ | session-start.js: в проекте Мэтта с плагином на проекте — правила Мэтта и места файлов вместо правил superpowers, при большой работе и другой версии плагина — строка о версии только для Claude; «да» без плагина на проекте или с выключенным — правила superpowers и напоминание о /kit:project-init в контексте и пользователю; mattRules(info) в module.exports | node --test tests/session-start.test.js — 26 из 26 (7 новых сначала падали); npm test — 507 тестов, 504 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; свежий проверяющий — одобрено: тексты строк дословно по плану, обычные проекты installed_plugins.json не читают, тесты не зависят от настроек этого компьютера |
| 47.4 | ✅ | guard-bash.js: в проекте Мэтта checkGit не пускает git commit в обход /kit:step-done (опции до подкоманды, цепочки && \|\| ; \|, блоки PowerShell if/{}), а при выкладке PhpStorm Always — создание веток и worktree (checkout -b, switch -c, branch <имя>, worktree add); просмотр, удаление и настройка веток проходят, запуск kit-commit.js с heredoc проходит; разбор на сегменты общий с checkCommand (segmentsOf) | node --test tests/guard-bash.test.js — 119 из 119 (новые сначала падали); npm test — 578 тестов, 575 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; свежий проверяющий — одобрено, около 90 команд без ложных отказов; раунд исправлений (коммит в блоке PowerShell if ($?) { git commit }, ложный отказ git branch --sort/-u/--format) — повторная проверка: исправлено |
| 47.5 | ✅ | guard-matt.js — новый хук PreToolUse (hooks.json, после Bash\|PowerShell): в проекте Мэтта не пускает Write/Edit/MultiEdit/NotebookEdit файлов Мэтта в корень проекта (GLOSSARY.md, CONTEXT.md и их карты, docs/adr/, docs/agents/, .scratch/), а при выкладке PhpStorm Always — Agent/Task с isolation worktree и start_session с use_worktree; checkTool(input, ctx) — чистая функция | node --test tests/guard-matt.test.js — 8 из 8 (сначала падали — модуля нет); npm test — 586 тестов, 583 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; свежий проверяющий — одобрено: тексты и запись hooks.json дословно по плану, ложных отказов на .claude/docs, .claude/CLAUDE.md, коде проекта и временных файлах нет, неполный ввод не ломает хук |
| 47.6 | ✅ | навык /kit:matt (skills/matt/SKILL.md, 12 277 байт из 12 288): маршрут большой работы, папки и документы, этапы подготовки и реализации, общая сессия и фронт тикетов, задание исполнителю по шаблону, приёмка через /kit:step-done, режим без пользователя, разбор, края; тест в content.test.js | node --test tests/content.test.js — 23 из 23 (новый сначала падал — навыка нет); npm test — 587 тестов, 584 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; свежий проверяющий сверил навык со спеком, с /kit:step-done и с файлами mattpocock-skills 1.3.1 — 7 важных находок (ветки research/ и push у wayfinder, code-review до коммита, коммит карты, правки тикета на вопросе, счёт --inbox, Blocked by и **Status:**, спек без карты); два раунда исправлений, повторные проверки — все исправлены, шаблон задания исполнителю дословно |
| 47.7 | ✅ | /kit:project-init: в разведке — параметр «Система Мэтта» и matt-skill.js --status; в третьем вызове вопрос «Вести проект по системе Мэтта Покока?» (каждый запуск, любой режим, без «Рекомендую»); п. 4.3 — параметр; новый п. 4.6а — «да»: плагин mattpocock-skills на проект (install или enable), superpowers выключен, сверка --status; «нет» после «да» — обратно; ошибки CLI «не установлен» — не сбой; в итоге — перезапуск сессии; шаблон CLAUDE.md — строка «- Система Мэтта: {{да \| нет}}» | node --test tests/templates.test.js tests/content.test.js — 36 из 36 (новые сначала падали); npm test — 588 тестов, 585 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; --scope project у claude plugin install/enable/disable — по --help; свежий проверяющий — одобрено (порядок п. 4.6а до 4.8, не больше 3 вопросов в вызове, все ветки установки); раунд правки формулировок 4.6а — повторная проверка: исправлено; живая установка — в 47.9 |
| 47.8 | ✅ | выпуск kit 3.3.0 — версии 3.3.0 в plugin.json, marketplace.json и «Версия kit» в .claude/CLAUDE.md; README — раздел «Система Мэтта Покока для больших проектов (с 3.3.0)», «Что внутри» (/kit:matt, guard-matt.js, matt-skill.js, отказы guard-bash.js), параметр «Система Мэтта»; обзор — раздел /kit:matt, guard-matt.js в хуках и на схемах, параметр, шапка 3.3.0 (6 команд, 5 хуков, 22 скрипта), пересобран | npm test — 588 тестов, 585 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; обзор пересобран build.js, повторная сборка ничего не меняет; свежий проверяющий сверил README и обзор с кодом и навыками — одобрено, одна неточность (matt-skill.js в читателях параметра) и четыре формулировки исправлены, повторная проверка — исправлено |
| 47.8а | ✅ | исправления по итоговой проверке этапа 47 до публикации 3.3.0: строка «Крупная задача» в шаблоне CLAUDE.md — вариант для системы Мэтта (по /kit:matt, спек и план kit не пишутся), выбор в п. 4.3 и замена в существующем файле при смене ответа в п. 4.6а, страховка в правиле Мэтта session-start.js; /kit:matt — исполнителю нельзя вызывать /kit:step-done, без «Система Мэтта: да» навык не применяется, поле session — в .claude/kit-inbox.jsonl, без пользователя — без --push до разбора; напоминание «не поставлен или выключен», в перечне корня GLOSSARY-MAP.md и CONTEXT-MAP.md; README и обзор | итоговая проверка этапа (88fa524..9b48abf) свежим проверяющим — стыки lib/matt.js, хуков и навыков согласованы, обычные проекты не затронуты, утечек нет; одна важная (строка «Крупная задача» про superpowers) и мелкие; после исправлений повторная проверка — все 7 исправлены, готово к публикации; npm test — 588 тестов, 585 прошли, 3 пропущены, 0 упало; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — прошли; node tools/kit-denylist.js tree — код 0; matt/SKILL.md — 12 282 байта из 12 288 |
| 47.9 | ⏳ | выпуск kit 3.3.0: отправка, установка и живая проверка; этап закрыт | |
