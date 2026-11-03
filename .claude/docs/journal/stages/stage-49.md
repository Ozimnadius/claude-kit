# плагин kit (маркетплейс claude-kit) — этап 49

## Этап 49 — правила kit по опыту проектов: ограничение kit не обходить молча, перезагрузка при проверке страницы, выпуск 3.4.3

| Шаг | Статус | Что сделано | Как проверено |
|---|---|---|---|
| 49.1 | ✅ | проверка страницы — с перезагрузкой после смены ширины (session-start.js, шаблон CLAUDE.md, reference/ssh.md); отказы guard-bash и guard-matt и остановки kit-commit.js на запрещённых путях и секретах — с подсказкой не обходить ограничение kit молча, а описать проблему и дать промт для сессии в репозитории claude-kit (KIT_LIMIT_HINT в lib/project.js); выпуск 3.4.3 (не отправлен): version в plugin.json и marketplace.json, README, «Версия kit» | npm test — 1059 тестов: 1055 прошли, 1 упал (худший случай проекта Мэтта, «Claude по SSH» из worktree — 9 004 символа при пределе 9 000) → из строки проверки страницы убрано «браузера»; повтор затронутых файлов (session-start, guard-bash, guard-matt, kit-commit, templates, content) — 497 из 497, худший случай в пределе; claude plugin validate plugins/kit --strict и claude plugin validate . --strict — пройдены |
| 49.2 | ✅ | выпуск kit 3.4.3 — отправка на GitHub и установка; этап 49 закрыт | перед отправкой node tools/kit-denylist.js tree — чисто (код 0); git push origin master — 74a77c6..3ce38bc, впереди origin/master — 0; claude plugin marketplace update claude-kit — ок; claude plugin update kit@claude-kit — 3.4.2 → 3.4.3; в кэше kit/3.4.3 есть KIT_LIMIT_HINT (lib/project.js, guard-bash.js, kit-commit.js) и «мобильная ширина, перезагрузка, снимок» в session-start.js |

Сверка 2026-11-03 (сверено с: таблица этапа): пунктов 2, сделано 2; расхождения: нет.
