# План — облегчение kit (этап 36)

> **Для исполнителя:** работай по задачам через `superpowers:executing-plans`. Задача = шаг kit 36.N; после каждой — `/kit:step-done` и остановка на проверку пользователем. Строки чек-листа отмечает закрытие шага. Коммит — только через `/kit:step-done`, сам superpowers не коммитит.

**Цель:** закрывать шаг kit кратно быстрее и дешевле при том же результате (журнал, один коммит на шаг, просмотр перед коммитом) и убрать из плагина то, чем не пользуются.

**Устройство:** агент docs-keeper заменяет скрипт `kit-journal.js`. Подготовку шага делает `kit-step.js`, проверку коммита, очистку входящих и отправку — `kit-commit.js`. Плагин понимает один формат проекта: старые проекты переводит `/kit:project-init`. step-done — короткое ядро и справки по режимам.

**Технологии:** Node.js без зависимостей, тесты `node:test` (`npm test` = `node --test tests/*.test.js`), помощники `tests/helpers.js` (`makeProject`, `gitRepo`, `runScript`, `git`); markdown-скиллы Claude Code.

**Спек:** `.claude/docs/work/spec-light.md` (Т-1…Т-27) — читать вместе с планом. План ссылается на требования спека по номерам и не повторяет их.

## Чек-лист

- [x] 36.1 — спек и план этапа
- [x] 36.2 — один формат в хуке и библиотеках: `oldFormat`, правила хука, без удалённых режимов и старых значений
- [x] 36.3 — `/kit:project-init` и шаблоны: переезд, вопрос о скиллах Битрикса, без «Коммит» и удалённых параметров
- [x] 36.4 — `kit-journal.js` и `lib/journal.js`
- [x] 36.5 — `kit-step.js` и `kit-commit.js --inbox`, `--push`
- [ ] 36.6 — step-done: ядро и справки, удаление docs-keeper, `/kit:report`
- [ ] 36.7 — удалить `/kit:why` и `/kit:deploy-list`
- [ ] 36.8 — claude-kit: спек заморожен, правила выпуска; выпуск 3.0.0

## Общие ограничения

- Пока идёт этап, установлен kit 2.18.0: шаги закрывает прежний `/kit:step-done` с docs-keeper. Новые `kit-step.js` и `kit-journal.js` в закрытии шагов этого этапа не вызывать — они заработают после установки 3.0.0.
- Файлы — UTF-8 без BOM, LF; файлы целиком не переформатировать.
- Репозиторий публичный: в файлах и сообщениях коммитов — только обезличенно (проекты alpha, beta…; домены `*.example.com`; учётки `user100`; IP `203.0.113.x`; пути `C:\Users\user`).
- Перед закрытием шага: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.
- Тесты — на основные сценарии, без придирок; тест на старое поведение, которое этап убирает, удаляется вместе с ним.
- Тексты для пользователя (сообщения скриптов, скиллы) — по-русски.
- Коды выхода: `kit-journal.js` — 0, 1, 2, 4 (Т-11); `kit-step.js` — 0, 2, 4 (Т-14); `kit-commit.js` — 0–3, как сейчас, плюс 4 (Т-16).
- Ядро `skills/step-done/SKILL.md` — не больше 14 КБ (14336 байт).
- Не трогать: `/kit:server` и файл-канал `kit-exec.php`, `/kit:visual`, `secret-scan.js`, содержимое скиллов Битрикса, хуки кроме правил `session-start.js`.

## На что смотреть при проверке

Случаи, о которых спек не говорит прямо, но на которых пользователь споткнётся первым:
1. Журнал, правленный руками: столбцы выровнены пробелами, в ячейке `\|`, пустая строка перед таблицей. Скрипт находит строку и не портит таблицу — тест в 36.4.
2. Журнал с переводами строк CRLF (правка в редакторе Windows): после `kit-journal.js` переводы остаются CRLF, меняются только тронутые строки — тест в 36.4.
3. Ответ на вопрос пришёл между `kit-step.js` и коммитом: `kit-commit.js --inbox N` убирает только первые N записей, позднее остаётся — тест в 36.5.
4. Последний шаг этапа: в одном вызове `kit-journal.js` план переносится в архив (DOCS «(было …)») и в нём же ставится галочка — тест в 36.4.
5. Текущий этап начат при kit 2.x: в таблице есть столбец «Коммит». Новая строка получает пустую ячейку, столбец не трогается — тест в 36.4.

---

### Задача 36.1 — спек и план этапа

**Файлы:** `.claude/docs/work/spec-light.md`, `.claude/docs/work/plan-light.md` — написаны и согласованы в сессии этапа.

Шаг 1. Закрыть шаг `/kit:step-done`:
- `STAGE: облегчение kit: закрытие шага скриптами, один формат, без двойного учёта`;
- `DOCS`:
  - `work/spec-light.md — спек этапа 36: облегчение kit — в работе, этап 36`;
  - `work/plan-light.md — план этапа 36 (задачи 36.1–36.8) — в работе, этап 36`;
- `DECISIONS` — решения пользователя из разговора (раздел «Решения пользователя» спека);
- `NEXT: 36.2 — один формат в хуке и библиотеках`.

### Задача 36.2 — один формат в хуке и библиотеках

**Файлы:**
- Создать: `plugins/kit/scripts/lib/journal.js` — пока только `oldFormat`; в 36.4 сюда добавится правка журнала.
- Изменить:
  - `plugins/kit/scripts/lib/project.js` — `JOURNAL_DEFAULTS = ['.claude/docs/progress.md']`, без ветки `docsRel === '.'`;
  - `plugins/kit/scripts/session-start.js` — правила;
  - `plugins/kit/scripts/phpstorm-exclude.js:67`, `plugins/kit/scripts/lib/deploy.js:18`, `plugins/kit/scripts/check-closed.js:107-108` — убрать ветки старой раскладки `docs/`.
- Тесты: `tests/journal-lib.test.js` (новый), `tests/session-start.test.js`, `tests/lib.test.js`, `tests/phpstorm-exclude.test.js` и другие, где проверялась раскладка `docs/` (найти: `grep -rln "docs/progress" tests/`).

**Интерфейсы:**
- Использует: `kitInfo(dir)` из `lib/project.js` (`{ dir, params, journalRel, journalPath, hasJournal, docsRel, planRel, visualRel, isKit }`); `getSection`, `parseTable` из `lib/md.js`.
- Даёт: `oldFormat(info) → string[]` в `lib/journal.js` — признаки Т-2 с подписями `журнал не в .claude/docs`, `журнал одним файлом`, `нет столбца «Как проверено»`, `старая таблица решений`, `Окружение: дев+прод`, `Выкладка: вручную; дев — PhpStorm Always`. Пустой массив — формат текущий. В журнале без раздела `## Этап N` (все этапы перенесены) признака «Как проверено» нет.

Шаг 1. Тесты `tests/journal-lib.test.js` на временных проектах (`makeProject`):
- `текущий формат — []`;
- `журнал в docs/ — «журнал не в .claude/docs»`;
- `нет journal/ — «журнал одним файлом»`;
- `последний этап без «Как проверено» — признак есть`, `этапов в progress.md нет — признака нет`;
- `последняя таблица решений | Дата | Решение | — «старая таблица решений»`;
- `Окружение: дев+прод` и `Выкладка: вручную; дев — PhpStorm Always` — по признаку.

Шаг 2. Тесты `tests/session-start.test.js` (через `buildContext`):
- старый формат — строка с «в старом формате (» и «/kit:project-init: переезд на формат kit 3.0»;
- нет правила «Код пишет пользователь» ни при каком параметре;
- правило «Коммит — после просмотра» есть всегда, в том числе при `Коммит: сразу`;
- «Код пишет: Claude» без «Прод» и «Дев» — правила о проверке на сервере нет; с `Прод: shop.example.com` — есть и содержит `browser_batch`;
- нет текста «Переезд в .claude/docs».

Шаг 3. Запуск `node --test tests/journal-lib.test.js tests/session-start.test.js` — падает.

Шаг 4. Реализовать:
- `oldFormat` в `lib/journal.js`;
- правила `session-start.js`:
  - правило старого формата — текст Т-3, признаки через «; »;
  - удалить `RULE_USER`, `RULE_ALWAYS_DEV` и ветку `who`;
  - `RULE_REVIEW` — без условия;
  - `RULE_CLAUDE` и `RULE_CLAUDE_SSH` — только при адресе сервера окружения (`serverEnv(p)` → `Прод` или `Дев`), к ним дописать: «страницу проверяй одним пакетным вызовом браузера (browser_batch: открыть, снимок на десктопе, мобильная ширина, снимок), снимки — уменьшенные»;
  - `docsRule` и `superpowersRule` — без ветки `docsRel === '.'`;
- убрать ветки `docs/` в `lib/project.js`, `phpstorm-exclude.js`, `lib/deploy.js`, `check-closed.js`; в `serverEnv` — без упоминания старого `дев+прод` (оно ловится `oldFormat`).

Шаг 5. `npm test` — проходит. Старые тесты, проверявшие удалённое (раскладка `docs/`, «Код пишет пользователь», «Коммит: сразу», `вручную; дев — PhpStorm Always`), удалены.

Шаг 6. Закрыть шаг `/kit:step-done`.

### Задача 36.3 — `/kit:project-init` и шаблоны

**Файлы:**
- Изменить: `plugins/kit/skills/project-init/SKILL.md` — разделы «2. Вопросы», «4.3», «4.4», «4.6», «4.7», «4.8»;
- Изменить шаблоны: `plugins/kit/skills/project-init/templates/CLAUDE.md`, `templates/progress.md`, `templates/deploy-prod.md`;
- Тесты: `tests/templates.test.js`, `tests/content.test.js`.

**Интерфейсы:** признаки старого формата `/kit:project-init` берёт из правила хука в контексте (36.2): строка «…в старом формате (<признаки>)…»; правила нет — формат текущий. Отдельный скрипт не нужен.

Шаг 1. Тесты:
- `templates/progress.md` — шапка таблицы этапа 0 `| Шаг | Статус | Что сделано | Как проверено |`, без `{{ХЕШ}}`;
- `templates/CLAUDE.md`:
  - нет строк параметров `- Код пишет:` и `- Коммит:` и варианта «Код пишет пользователь»;
  - правило проверки страницы содержит `browser_batch`;
- `project-init/SKILL.md`:
  - есть вопрос `Ставить скиллы Битрикса?` с вариантами «Да» и «Нет»;
  - есть «переезд на формат kit 3.0», пункты переезда Т-4 и «переезд на kit 3.0» в п. 4.8;
  - нет вопроса о том, кто пишет код, и указаний о параметре «Коммит».

Шаг 2. `node --test tests/templates.test.js tests/content.test.js` — падает.

Шаг 3. Править тексты:
- переезд — обязательные пункты плана на согласие (Т-4), включая `journal-split.js --migrate` без отдельного вопроса;
- старые значения параметров — Т-4;
- шаг переезда в п. 4.8 — очередной шаг текущего этапа, а если открытого этапа нет — первый шаг нового этапа «переезд на kit 3.0» (`STAGE`), NEXT — из «Сейчас» или `—`;
- вопрос «Ставить скиллы Битрикса?» в разделе 2 вместо строки плана в п. 4.6 (Т-23): «Да» (Рекомендую) — `bitrix-skills.js` (свежие; уже поставленные обновляются), «Нет» — не ставить, поставленные не трогать;
- удалить вопрос и параметры «Код пишет», «Коммит» (Т-5);
- этап 0 — без столбца «Коммит» (Т-15);
- в шаблоне `deploy-prod.md` при «PhpStorm Always» — строка «Залито» не ведётся (Т-8), раздел «Удалить с сервера» остаётся.

Шаг 4. `npm test` — проходит.

Шаг 5. Закрыть шаг `/kit:step-done`.

### Задача 36.4 — `kit-journal.js` и `lib/journal.js`

**Файлы:**
- Создать: `plugins/kit/scripts/kit-journal.js` — разбор аргументов и stdin, вывод, коды;
- Изменить: `plugins/kit/scripts/lib/journal.js` — разбор блоков и правки;
- Тест: `tests/kit-journal.test.js`.

**Интерфейсы:**
- Использует: `oldFormat(info)` (36.2), `kitInfo`, `getSection`, `parseTable`, `normalize` (`lib/md.js`).
- Даёт (`lib/journal.js`):
  - `parseBlocks(text) → { blocks, error }`. В `blocks` — `STEP`, `STATUS`, `SUMMARY`, `CHECK`, `NEXT`, `STAGE`, `BLOCKERS`, `RECONCILE` (строки) и `DECISIONS`, `DOCS`, `BUGS`, `PROD_TODO`, `NOTES` (массивы строк без `- `). `DEPLOY` — объект: `{ Файлы, Коммит, Проверка }` — строки, `Удалить` и `Чек-лист` — массивы; это строки `- Поле: значение`, `Удалить` и `Чек-лист` повторяются. `error` — текст для кода 4;
  - `applyBlocks(info, blocks, { today }) → { files: Map<путь от корня, новый текст>, warnings: string[], now: string }` — ничего не пишет; ошибки Т-10 — исключение `JournalError`;
  - `writeAll(dir, files)` — временные файлы, журнал последним.
- CLI: `node kit-journal.js <<'KIT_BLOCKS' … KIT_BLOCKS`; дата — локальная `ГГГГ-ММ-ДД`, в тестах — из `KIT_TODAY`. Вывод:
  ```
  ## Сейчас
  <раздел после правки>

  Изменены файлы:
  <путь>
  …
  Предупреждения:
  <строка>
  ```

Шаг 1. Тесты `tests/kit-journal.test.js` (журнал этапа 36 во временном проекте, `KIT_TODAY=2026-10-20`):
- `строка шага: 36.2 встаёт между 36.1 и 36.3; 36.3 ✅ правится на месте; у NEXT 36.4 — ⏳`;
- `Сейчас: «36 — … (начат 2026-10-16); последний шаг 36.3 — …», следующий — NEXT; BLOCKERS заменяет пункт, без BLOCKERS — прежний; NEXT — → «нет — этап закрыт» и «— закрыт 2026-10-20»`;
- `STAGE 37: раздел «## Этап 37 — …» в конце и «| 37 | … | ниже |» в оглавлении`;
- `DECISIONS: после №50 — №51 и №52, «Шаг» = STEP; «Заменяет №29» — в №29 « → заменено №51»`;
- `DOCS: обновление статуса; «archive/plan-x.md (было work/plan-x.md)» меняет путь; новая строка — в конец`;
- `галочка: «- [ ] 36.3 —» → «- [x] 36.3 —» в плане «в работе, этап 36»; строки нет — предупреждение и код 1`;
- `BUGS: «| К62 |» добавлен без номера (после К61); К61 — новый статус`;
- `NOTES: в «Справочник»; «Заказчик: …» — в «Материалы заказчика» без приставки`;
- `RECONCILE: строка «Сверка 2026-10-20 (сверено с: …)» под таблицей; «на следующий этап» — в конец «Блокеров»`;
- `DEPLOY: «вручную» — строка в «Залито на прод»; «PhpStorm Always» — строки нет, предупреждение`;
- `повтор тех же блоков — файлы те же`;
- `старый формат — код 2, файлы не изменились; неизвестный ключ — код 4`;
- `этап 35 уже в journal/stages — код 2`;
- из «На что смотреть»: `выровненная таблица и \| в ячейке`, `CRLF сохраняется`, `перенос в архив и галочка в одном вызове`, `таблица с «Коммит» — ячейка пустая`.

Шаг 2. `node --test tests/kit-journal.test.js` — падает (модуля нет).

Шаг 3. Реализовать `parseBlocks`, `applyBlocks` (по функции на блок, Т-8), `writeAll` и CLI `kit-journal.js` (коды Т-11). Перевод строк файла определяется по файлу и сохраняется.

Шаг 4. `node --test tests/kit-journal.test.js`, затем `npm test` — проходят.

Шаг 5. Закрыть шаг `/kit:step-done`.

### Задача 36.5 — `kit-step.js` и `kit-commit.js --inbox`, `--push`

**Файлы:**
- Создать: `plugins/kit/scripts/kit-step.js`;
- Изменить: `plugins/kit/scripts/kit-commit.js` (`parseArgs`, хвост `main`);
- Тесты: `tests/kit-step.test.js` (новый), `tests/kit-commit.test.js`.

**Интерфейсы:**
- Использует:
  - `oldFormat` (36.2), `kitInfo`, `docsOnServer`;
  - `readInbox`, `clearFirst`, `INBOX` (`decision-inbox.js`);
  - `parseRules`, `matchRules` (`lib/paths.js`), `isSsh` (`lib/deploy.js`);
  - `secret-scan.js --paths` и `--history`, `ssh-deploy.js` без `--go` — процессами.
- Даёт:
  - `inboxAsDecisions(entries) → { decisions: string[], notes: string[] }` из `kit-step.js` — строки формата Т-14;
  - вывод `kit-step.js` — разделы `Файлы шага (N):`, `Не пойдут в коммит:`, `Входящие:`, строка `входящих: N`, `Режим:` (строки `выкладка: …`, `документы на сервере: да|нет`, `удалённый репозиторий: <имя>|—` с пометкой `первая отправка`), строка-напоминание о `reference/stage-close.md`;
  - `kit-commit.js`: `parseArgs(argv) → { paths, inbox, push, error }`; код 4 и строка `kit-commit: не отправлено — <причина>` (причины — Т-16).

Шаг 1. Тесты `tests/kit-step.test.js` (`gitRepo`, `runScript`):
- `файлы шага: кириллица и переименование — в кавычках, оба пути`;
- `путь из «Не коммитить» — в «Не пойдут в коммит»`;
- `входящие:`
  - `выбранный вариант с описанием → «почему» = описание, «что отвергли» = другие через «; »`;
  - `свой ответ — «(свой ответ)»`;
  - `заметка → NOTES`;
  - `входящих: 3`;
- `Claude по SSH — итог сухого прогона через fake-ssh.js и указание reference/ssh.md`;
- `удалённый без ветки — «первая отправка»`;
- `старый формат — код 2`.

Шаг 2. Тесты `tests/kit-commit.test.js`:
- `--inbox 2 при трёх записях — после коммита одна` (это и случай 3 из «На что смотреть»);
- `стоп по секрету (код 1) — входящие не тронуты`;
- `после коммита переданных путей в git status нет`;
- `--push origin в локальный пустой bare-репозиторий — история проверена, коммит на удалённом`;
- `секрет в истории — код 4, «в истории секреты», коммит на месте, удалённый пуст`;
- `на удалённом лишний коммит — код 4, «на удалённом есть коммиты, которых здесь нет»`.

Шаг 3. `node --test tests/kit-step.test.js tests/kit-commit.test.js` — падает.

Шаг 4. Реализовать `kit-step.js` и аргументы `kit-commit.js`. `git push` — с ограничением по времени (120 с) и без окон ввода в терминале (`GIT_TERMINAL_PROMPT=0`); окно Git Credential Manager не отключать.

Шаг 5. `npm test` — проходит.

Шаг 6. Закрыть шаг `/kit:step-done`.

### Задача 36.6 — step-done: ядро и справки, удаление docs-keeper, `/kit:report`

**Файлы:**
- Переписать: `plugins/kit/skills/step-done/SKILL.md` — ядро (Т-18);
- Создать: `plugins/kit/skills/step-done/reference/ssh.md`, `reference/stage-close.md`, `reference/push.md` (Т-19);
- Удалить: `plugins/kit/agents/docs-keeper.md`;
- Изменить упоминания docs-keeper (найти: `grep -rn docs-keeper plugins/ tests/ README.md`):
  - скиллы: `skills/project-init/SKILL.md`, `skills/report/SKILL.md`, `skills/visual/SKILL.md`;
  - шаблоны: `templates/CLAUDE.md`, `templates/progress.md` (строка «Ведёт агент docs-keeper»);
  - скрипты: `scripts/session-start.js` (правило про `/kit:step-done`), `scripts/ssh-deploy.js`;
  - описания плагина: `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`;
  - `README.md`;
- `/kit:report` (`skills/report/SKILL.md`) — коммит шага по ID в заголовке; при «PhpStorm Always» «Выложено на сайт» — шаги, закоммиченные в периоде (Т-15);
- Тесты: `tests/content.test.js`, `tests/templates.test.js`, `tests/fixtures.js`, `tests/journal-split.test.js` (там есть упоминание docs-keeper).

**Интерфейсы:** ядро вызывает `kit-step.js [<STEP>]`, `kit-journal.js <<'KIT_BLOCKS'`, `kit-commit.js --inbox N [--push <имя>] -- <пути> <<'KIT_MSG'` (36.4, 36.5) и отсылает к справкам по выводу `kit-step.js` и коду 4 `kit-commit.js`.

Шаг 1. Тесты `tests/content.test.js`:
- размер `SKILL.md` не больше 14336 байт;
- в ядре есть `kit-step.js`, `kit-journal.js`, `kit-commit.js --inbox`, `reference/ssh.md`, `reference/stage-close.md`, `reference/push.md`;
- справки есть и не пусты;
- нет `docs-keeper` ни в одном файле `plugins/`;
- варианты просмотра «Коммитить» / «Есть вопросы — оставлю комментарии» / «Не коммитить пока»; в `ssh.md` — «Залить на сервер» / «Не заливать пока»;
- в `report/SKILL.md` — поиск коммита по ID и правило «Выложено» при автозаливке.

Шаг 2. `node --test tests/content.test.js` — падает.

Шаг 3. Переписать ядро и разложить ветки по справкам почти дословно, без удалённого (docs-keeper, COMMITS, «Коммит: сразу», «Работает / Не работает»). Сохраняются дословно:
- правило строки `Co-Authored-By` (из системных инструкций агента);
- heredoc `<<'KIT_MSG'` для `kit-commit.js`;
- требование «только Bash, не PowerShell» для коммита;
- ответ пользователю — Т-18 п. 6 и решения агента «можно возразить».

Новое в тексте ядра:
- решения из входящих — по Т-20: «почему» — описание выбранного варианта, без отдельного вопроса пользователю;
- правило проекта (бывший блок RULES) Claude правит в `.claude/CLAUDE.md` сам и передаёт строку DECISIONS «Правило: …» (Т-12).

Шаг 4. Удалить агента, поправить упоминания и `/kit:report`.

Шаг 5. `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict` — без ошибок.

Шаг 6. Закрыть шаг `/kit:step-done` (ещё прежним, из 2.18.0).

### Задача 36.7 — удалить `/kit:why` и `/kit:deploy-list`

**Файлы:**
- Удалить: `plugins/kit/skills/why/`, `plugins/kit/skills/deploy-list/`, `plugins/kit/scripts/deploy-list.js`, `tests/deploy-list.test.js`;
- Изменить: `plugins/kit/scripts/lib/deploy.js` — убрать то, чем пользовался только `deploy-list.js` (найти по `require` в `ssh-deploy.js`; `resolveBase`, `baseFromPlan`, `commitOfStep`, `changes` нужны `ssh-deploy.js` и остаются);
- Изменить упоминания `/kit:deploy-list`: `skills/project-init/SKILL.md`, `skills/project-init/reference/phpstorm.md`, `templates/CLAUDE.md`, `templates/deploy-prod.md`, `scripts/ssh-deploy.js`, README;
- Тесты: `tests/deploy-lib.test.js` (тесты удалённых функций), `tests/content.test.js`.

Шаг 1. Тест `tests/content.test.js`: нет `deploy-list` и `kit:why` ни в одном файле `plugins/`.

Шаг 2. `node --test tests/content.test.js` — падает.

Шаг 3. Удалить и поправить; при ручной выкладке строку «Залито» пишет шаг, на котором пользователь сообщил о выкладке, без хеша (Т-15).

Шаг 4. `npm test`, обе проверки плагина — без ошибок.

Шаг 5. Закрыть шаг `/kit:step-done`.

### Задача 36.8 — claude-kit: спек заморожен, правила выпуска; выпуск 3.0.0

**Файлы:**
- Перенести: `.claude/docs/work/spec-claude-kit.md` → `.claude/docs/archive/spec-claude-kit.md`, в начале — строка Т-25;
- Изменить: `.claude/CLAUDE.md` (правила выпуска Т-26; путь спека), строка о спеке в шапке `.claude/docs/progress.md`;
- Выпуск: `version` `3.0.0` в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json`; README — что изменилось и как перейти (`/kit:project-init` в каждом проекте); обзор — правки в `.claude/docs/work/overview/build/` (без docs-keeper, `/kit:why`, `/kit:deploy-list`; схема step-done), затем `node .claude/docs/work/overview/build/build.js`;
- Тесты: `tests/manifest.test.js`.

Шаг 1. Перенести спек (обычное перемещение, без git) и дописать строку Т-25.

Шаг 2. Правила выпуска в `.claude/CLAUDE.md`: общий спек не дописывается; обзор — только при мажорном выпуске или когда добавляется или убирается команда, агент, хук, скрипт либо режим; остальное — версии, README и журнал.

Шаг 3. Версии, README, обзор; `node .claude/docs/work/overview/build/build.js`.

Шаг 4. `npm test`, обе проверки плагина — без ошибок.

Шаг 5. Закрыть шаг `/kit:step-done`:
- `DOCS: archive/spec-claude-kit.md (было work/spec-claude-kit.md) — спек плагина kit до 2.18.0 — готово — заморожен на 2.18.0`;
- в FILES — старый и новый пути спека;
- это последний шаг этапа: сверка и архив — по прежнему step-done.

Шаг 6. С согласия пользователя: `git push origin master`, затем `claude plugin marketplace update claude-kit` и `claude plugin update kit@claude-kit`.

Шаг 7 — по желанию пользователя. Живая проверка: первое закрытие шага в claude-kit и в одном проекте после `/kit:project-init`. Мерить по записи сессии: не больше 8 ходов модели, без субагентов, прирост контекста — не больше 10K.
