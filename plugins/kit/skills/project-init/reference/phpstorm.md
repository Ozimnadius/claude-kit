# PhpStorm: деплой, исключения, File Watchers

## Где настройки

- **Исключения деплоя:** Settings → Build, Execution, Deployment → Deployment → сервер (например `ftp`) → вкладка **Excluded Paths**. С 2.3.0 руками туда не ходить: исключения дописывает хук kit `phpstorm-exclude.js` (ниже); руками — только если хук сообщил, что `deployment.xml` не разобран.
- **Автозаливка:** Settings → Build, Execution, Deployment → Deployment → **Options** → «Upload changed files automatically to the default server»: `Always` / `On explicit save action (Ctrl+S)` / `Never`. Флажок «Upload external changes» — заливать и правки, сделанные вне IDE (правки Claude).
- **File Watchers:** Settings → Tools → **File Watchers** — снять флажок у вотчера или удалить его.

## Что лежит в `.idea` (только читать; `excludedPath` дописывает только `phpstorm-exclude.js`)

- `.idea/deployment.xml`, компонент `PublishConfigData`:
  - `autoUpload="Always"` и `<option name="myAutoUpload" value="ALWAYS" />` — автозаливка при каждом сохранении;
  - `autoUploadExternalChanges="true"` — внешние правки тоже уезжают;
  - `serverName` — сервер по умолчанию;
  - `<excludedPath local="true" path="$PROJECT_DIR$/.claude/scripts" />` — исключения.
- `.idea/webServers.xml` — серверы: `url`, `rootFolder` (часто содержит домен, например `/www/alpha.example.com`), хост FTP. Пароли не читать и не выводить.
- `.idea/watcherTasks.xml` — вотчеры: `<TaskOptions isEnabled="true">`, `name`, `fileExtension`, `output`.

## Что исключать — хук `phpstorm-exclude.js`

Хук SessionStart плагина kit в kit-проекте при каждом старте сессии сверяет `.idea/deployment.xml` и дописывает недостающее каждому серверу, сопоставленному с корнем проекта (`local="$PROJECT_DIR$"`; сервер с подпапкой, например `dist`, не трогается). Только добавляет — ничего не удаляет и не меняет (кроме «Документы на сервере: да», ниже); сообщает строкой `[kit] Исключения PhpStorm: добавлено «ftp» — …` (её видят и пользователь, и Claude), а если записать не вышло или файл не разобран — просит добавить руками. Из git worktree (`.claude/worktrees/<имя>`) правит `.idea` основной папки. Руками: `node "${CLAUDE_PLUGIN_ROOT}/scripts/phpstorm-exclude.js" [--also a,b]` из корня проекта, сверка — `--check` (0 — всё на месте, 1 — не хватает, 2 — файл не разобран).

- Всегда: `.idea`, `.git`, `.claude` — вся служебная папка: правила `CLAUDE.md`, документы `.claude/docs` (журнал, план выкладки, `work/`, `archive/`, снимки `visual/` из-под админа), скрипты `/kit:server` `.claude/scripts`, `settings.local.json` и `.claude/worktrees` — git worktree Claude Code (десктоп) с полной копией сайта.
- Проект ещё не переехал (журнал в `docs/`) — и `docs`.
- Параметр «Документы на сервере: да» (с 2.6.0) — документы держат и на сервере, например чтобы открывать их по FTP: из `.claude` автозаливкой уезжают только `docs`, `CLAUDE.md` и `.htaccess`. Хук убирает исключение `.claude` целиком (единственное, что он удаляет) и исключает поимённо всё остальное в ней, а также заранее `.claude/worktrees`, `.claude/settings.local.json` (появляются посреди сессии) и снимки `.claude/docs/visual`; новое в `.claude` исключит на следующем старте — до того его закрывает `.htaccess`. Нет `.claude/.htaccess` — создаёт из шаблона `htaccess-deny` (свой не трогает). Если «Exclude items by name» (Settings → Build, Execution, Deployment → Deployment → Options) отсекает документы (`*.md`, `docs`), хук предупреждает при каждом старте — этот список общий для проекта, его правит пользователь. После первой заливки — проверка снаружи `check-closed`: `/.claude/` должна отдавать 403 или 404. Ручная выкладка (`/kit:deploy-list`) `.claude` по-прежнему не включает.
- Простые пути из «Не выкладывать» (`.gitignore`, `local/modules` — если модули лежат в проекте только для чтения, `bitrix`…); маски (`*.back*`) и `(кроме …)` PhpStorm не понимает — их учитывает только `/kit:deploy-list`.
- Если PhpStorm открыт и правку файла не подхватил (в Excluded Paths новых строк нет) — File → Reload All from Disk или перезапуск PhpStorm.

## Грабли

- Автозаливка работает, только пока PhpStorm открыт с этим проектом. После правки проверять, что изменение дошло до сервера.
- Удаление файла локально на сервере его **не удаляет** — удалять отдельно (Remote Host или `delete-list.php`), список — в «Удалить с сервера».
- Файл, открытый в редакторе PhpStorm с несохранёнными правками, при сохранении затрёт правку Claude.
- File Watchers срабатывают и на внешние правки (правки Claude), с задержкой 10–15 с: SCSS пересоберёт CSS, минификатор перезапишет `.min`. SCSS-исходники в проектах часто расходятся с CSS, правленым руками, — пересборка сотрёт ручные правки.
- MCP-сервер PhpStorm (встроенный) даёт инспекции, поиск, `git_status`, IDE-действия, но удалять файлы на сервере не умеет.
