# плагин kit (маркетплейс claude-kit) — этап 30

## Этап 30 — К55: `/kit:project-init` не спрашивал «Документы на сервере»

| Шаг | Статус | Что сделано | Как проверено | Коммит |
|---|---|---|---|---|
| 30.1 | ✅ | К55 — `/kit:project-init` при автозаливке (PhpStorm Always) спрашивает «Документы на сервере» третьим вызовом вопросов, без автозаливки — `нет` без вопроса; шаблон `CLAUDE.md` — `- Документы на сервере: {{да \| нет}}` и вариант строки про `.claude/` в пункте «Выкладка»; п. 4.3 — после записи «да» или смены значения снова `phpstorm-exclude.js --also …` и `--check`; п. 4.5 — документы при «да» дают 403 или 404; спек (§5, §7.3, строка «Дополнен»), README, справка `phpstorm.md`; выпуск 2.15.2 (версия в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json`) | новая проверка в `tests/content.test.js` (К55) до правки падала, после — ✔; прогон `phpstorm-exclude.js` на временном проекте в scratchpad: до раздела параметров `.claude` исключена целиком, после записи «Документы на сервере: да» исключение `.claude` снято, `.claude/skills`, `.claude/kit-inbox.jsonl`, `.claude/worktrees`, `.claude/settings.local.json`, `.claude/docs/visual` исключены поимённо, `--check` — код 0; `npm test` — 390 тестов, 387 ✔, 3 пропущены, 0 упали; `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict` — пройдены; `node tools/kit-denylist.js tree` — код 0 | `e47e2fd` |

Сверка 2026-10-13 (сверено с: таблица этапа): пунктов 1, сделано 1; расхождения: нет.
