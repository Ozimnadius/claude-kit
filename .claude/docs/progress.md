# Журнал работ — плагин kit (маркетплейс claude-kit)

> После каждого проверенного шага обновляется журнал и делается один коммит `ID: …`. После сжатия контекста и в новой сессии читать первым. Спек — `.claude/docs/work/spec-claude-kit.md`, документы — раздел «Документы».

## Сейчас

- **Этап:** 28 — коммит шага скриптом `kit-commit.js` вместо агента git-keeper — закрыт 2026-10-05 (выпуск 2.14.0)
- **Следующий шаг:** нет — этап закрыт, новый начнёт пользователь; после коммита выпуска — `git push origin master` и обновление установленного плагина 2.13.0 → 2.14.0 (`claude plugin marketplace update claude-kit`, `claude plugin update kit@claude-kit`) с согласия пользователя
- **Блокеры и открытые вопросы:** блокеров нет; по этапу 18 остаётся в zeta (в его сессии): строка «- Документы на сервере: да» в «Параметрах для агентов», убрать `*.md` и `docs` из «Exclude items by name» PhpStorm, перезапустить сессию, после заливки — check-closed

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

## Документы

| Файл | О чём | Статус |
|---|---|---|
| work/spec-claude-kit.md | спек плагина kit — все этапы | постоянный |
| archive/plan-docs.md | план этапа 11 — папка документов и исключения PhpStorm | готово, этап 11 (2026-09-28) |
| archive/MyObservations.md | замечания пользователя к плагину: консоль Битрикса, Excluded Paths, хаос в docs, архив устаревших | готово, этапы 11–12 (2026-10-05) |
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
