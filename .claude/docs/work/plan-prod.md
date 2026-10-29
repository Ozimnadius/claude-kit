# План — прод главный: вход с прода в каждой сессии (этап 48)

> Задача = шаг kit 48.N; после каждой — `/kit:step-done` (просмотр изменений и один коммит), superpowers сам не коммитит. Строки
> чек-листа отмечает закрытие шага. Задачи идут сверху вниз: 48.3–48.7 опираются на `lib/prod.js` из 48.2; 48.4 и 48.5 дописывают
> `prod-entry.js` из 48.3.
>
> Исполнение (решение пользователя 2026-10-29): субагентами — на задачу свежий исполнитель, затем свежий проверяющий
> (`superpowers:subagent-driven-development`), исправления — тем же порядком; исполнитель и проверяющий не коммитят, задачу закрывает
> `/kit:step-done` в общей сессии. Уровень рассуждений (`effort`) — `high`, для задач входа и хуков 48.3–48.6 — `xhigh`.

**Цель:** в начале каждой новой сессии kit забирает в git то, что поменяли на сервере без нас (одним коммитом входа, без вопросов,
одной строкой пользователю), не теряя нашу незалитую работу; до входа файлы сайта не правятся.

**Устройство:** чистые правила — новый `lib/prod.js` (три версии файла, база, что не забирать, строка, отметка входа); вход — новый
`prod-entry.js` (сверка и скачивание по SSH одним сценарием `sh -s`, как `ssh-deploy.js`; без SSH — список для FTP; хук SessionStart
`--hook`); запрет правок — новый `guard-prod.js` (PreToolUse); заливка «Claude по SSH» не льёт обратно файлы входа — `ssh-deploy.js`.

**Стек:** Node.js без зависимостей (скрипты, тесты `node --test`, заглушка `tests/fake-ssh.js`), Markdown (навыки), плагин Claude Code.

**Спек:** `.claude/docs/work/spec-prod.md` (Т-1…Т-19, одобрен 2026-10-29).

## Чек-лист

- [x] 48.1 — спек и план этапа 48
- [x] 48.2 — `lib/prod.js`: три версии файла, база входа, что не забирать, наши доработки, строка, отметка входа (Т-5, Т-7, Т-11)
- [x] 48.3 — `prod-entry.js`: вход по SSH — сверка, забор, коммит входа, отметка; только сверка и worktree (Т-1, Т-4, Т-6, Т-10, Т-12, Т-15)
- [ ] 48.4 — `prod-entry.js`: наши незакоммиченные правки и совмещение, File Watchers, предел за вход (Т-8, Т-11, Т-14)
- [ ] 48.5 — `prod-entry.js`: без SSH, пропуск, хук SessionStart (Т-2, Т-9, Т-10, Т-15)
- [ ] 48.6 — `guard-prod.js` и `hooks.json`: правки сайта только после входа (Т-3)
- [ ] 48.7 — заливка после входа: `ssh-deploy.js` не льёт обратно файлы входа (Т-13)
- [ ] 48.8 — `/kit:project-init`, шаблон `CLAUDE.md`, `/kit:matt` (Т-15, Т-16)
- [ ] 48.9 — выпуск kit 3.4.0: версии, README, обзор (Т-17, Т-18)
- [ ] 48.10 — выпуск kit 3.4.0: отправка, установка и живая проверка; этап закрыт (критерии готовности)

## Общие ограничения

- Текст для пользователя и для Claude — по-русски; имена в коде и команды — как есть.
- Репозиторий публичный: только обезличенно (Т-19); перед закрытием шага — `node tools/kit-denylist.js tree`.
- Файлы — UTF-8 без BOM, LF. Только встроенные модули Node.
- Хук не ломает сессию: любое исключение — тихо, код 0, без вывода (как в `guard-matt.js`).
- Вход действует только в kit-проекте (`kitInfo(dir).isKit`), у которого задан адрес сервера окружения («Прод» / «Дев» по
  `serverEnv`) или «SSH прод» / «SSH дев» (`serverSsh`); иначе всё молчит (Т-1).
- Файлы сайта — внутри папки проекта, не в `.claude/`, не под `skipRules(info)` (`lib/deploy.js`).
- Числа и строки из спека: предел файла `FILE_LIMIT = 10 * 1024 * 1024`, за вход `ENTRY_LIMIT = 50 * 1024 * 1024`; отметка —
  `.claude/kit-prod.json`; заголовок коммита входа — `Прод: изменения без kit на ГГГГ-ММ-ДД (N файлов)` (окружение дев — `Дев: …`);
  коды `prod-entry.js` — 0 вход сделан, 1 нужен ответ пользователя, 2 вход не нужен или параметры неверны, 3 нет подключения,
  обрыв, вышло время, 4 аргументы или git.
- Версии файла сравниваются по md5 содержимого без `\r`: CRLF и LF — одна версия (предположение спека о переводах строк).
- Не трогать `session-start.js` (вывод проекта Мэтта — 8 990 символов при тесте ≤ 9 000) и `skills/step-done/SKILL.md` (14 332 байта
  при пределе теста 14 336); ядро `skills/matt/SKILL.md` — не больше 12 288 байт (сейчас 12 285).
- Без `cd` в Bash, команды — из корня проекта.
- Перед закрытием шага: `npm test`, `claude plugin validate plugins/kit --strict`, `claude plugin validate . --strict`.

## На что смотреть при ревью

Случаи, которые спек подразумевает, а прямые тесты задач легко пропустят; у каждого — тест в своей задаче.
1. Путь с пробелом, кириллицей и одинарной кавычкой — сверка, скачивание и коммит входа проходят (48.3).
2. Сервер отдаёт файл с CRLF, в git он с LF — не «изменён без нас» (48.2, 48.3).
3. Файл на сервере не читается (`md5sum` не отдал хеш) — не «удалён без нас» и не забран, назван в строке (48.3).
4. Две сессии одного проекта одновременно — хук и вход одной не сбрасывают отметку другой (48.2, 48.5).
5. Вход оборвался после записи части файлов — повтор забирает их коммитом входа, а не принимает за нашу незакоммиченную правку (48.3).

---

## 48.1 — спек и план этапа 48

**Файлы:** `.claude/docs/work/spec-prod.md` (одобрен 2026-10-29), `.claude/docs/work/plan-prod.md` (этот файл).

Шаг 1. `npm test` — зелёный (кода в шаге нет).

Шаг 2. `node tools/kit-denylist.js tree` — чисто.

Шаг 3. `/kit:step-done 48.1`: `STAGE` — `48 — прод главный: вход с прода в каждой сессии`; `DOCS` — `work/spec-prod.md — спек
этапа 48: прод главный, вход с прода в каждой сессии — в работе, этап 48` и `work/plan-prod.md — план этапа 48 (задачи 48.1–48.10) —
в работе, этап 48`; `DECISIONS` — по строке на решение из разделов спека «Решения пользователя (2026-10-29)» (с отвергнутыми
вариантами) и «Решения агента», и способ исполнения; входящие обсуждения — по смыслу, «не ответил» и процедурные — отбросить;
`NEXT` — 48.2.

## 48.2 — `lib/prod.js`

**Файлы:** создать `plugins/kit/scripts/lib/prod.js`; тест — `tests/prod-lib.test.js`.

**Интерфейсы:** берёт `git`, `baseFromPlan`, `isSsh` (`lib/deploy.js`), `getSection`, `parseTable` (`lib/md.js`), атомарную запись
(`lib/atomic.js`). Даёт:
- `ENTRY_RE = /^(Прод|Дев): изменения без kit /`; `entrySubject(env: 'прод'|'дев', date: string, n: number) → string` —
  `Прод: изменения без kit на 2026-10-29 (3 файла)`, склонение «файл / файла / файлов»;
- `md5NoCr(buf: Buffer) → string`;
- `classify({ base, head, server }) → 'same' | 'take' | 'ours' | 'merge'` — версии: md5 без `\r` или `null` (файла нет); по порядку:
  `server === base` → `same`; `head === base` → `take`; `server === head` → `ours`; иначе `merge` (таблица Т-5);
- `entryBase(cwd, info, env) → { base, source } | { error }` — самый поздний из коммитов: последний коммит с `ENTRY_RE` в заголовке и
  `baseFromPlan(path.resolve(cwd, info.planRel), env, { cwd, byStep: isSsh(info) })`; «поздний» — потомок
  (`git merge-base --is-ancestor`), не связаны — коммит входа; нет обоих — первый коммит репозитория;
- `FILE_LIMIT`, `ENTRY_LIMIT`; `skipTake(rel: string, size: number) → null | 'архив' | 'больше 10 МБ'` — маски без регистра:
  `_*.back*`, `*_back*.zip`, `*.tar.gz*`, `*.zip`, `*.rar`, `*.7z`, `*.tar`, `*.gz`, `*.sql`, `*.bak`;
- `oursPaths(cwd) → Set<string>` — пути, которые менял хотя бы один коммит, кроме первого и коммитов входа (Т-7);
- `pendingDelete(cwd, info) → Set<string>` — пути, которых нет в HEAD и которые удалил коммит шага (не входа), плюс пути незакрытых
  пунктов раздела «Удалить с сервера» плана выкладки (Т-5, «ждёт удаления с сервера»);
- `summaryLine({ env, changed, added, removed, ours, skipped, waiting }) → string` — одна строка с `[kit] Вход с прода:`; нечего —
  `[kit] Вход с прода: прод совпадает с git.`; `ours`, `skipped` (`{ path, why }`), `waiting` — отдельными частями строки;
- отметка `MARK_FILE = '.claude/kit-prod.json'`: `readMark(dir) → { sessions: { [id]: { at, result, commit } }, named: string[],
  pending: string[] }` (нет или битый файл — пустая отметка); `writeMark(dir, mark)` — атомарно, записи сессий старше 7 дней
  убираются; `markSession(dir, id, result: 'need'|'done'|'skipped'|'checked', commit?)`; `sessionDone(dir, id) → boolean` — `done`,
  `skipped` или `checked`; `lastNeed(dir) → string | null` — сессия последней записи `need`.

Шаг 1. Тесты:

```js
test('classify: таблица Т-5 и отсутствие файла', () => {
  assert.equal(classify({ base: 'a', head: 'b', server: 'a' }), 'same');   // наше незалитое
  assert.equal(classify({ base: 'a', head: 'a', server: 'c' }), 'take');   // изменили без нас
  assert.equal(classify({ base: 'a', head: 'b', server: 'b' }), 'ours');   // наше уже на сервере
  assert.equal(classify({ base: 'a', head: 'b', server: 'c' }), 'merge');
  assert.equal(classify({ base: null, head: null, server: 'c' }), 'take'); // новый без нас
  assert.equal(classify({ base: 'a', head: 'a', server: null }), 'take');  // удалён без нас
  assert.equal(classify({ base: 'a', head: null, server: 'a' }), 'same');  // наше незалитое удаление
  assert.equal(classify({ base: null, head: 'b', server: null }), 'same'); // наш новый, ещё не залит
});
test('md5NoCr: CRLF и LF — один хеш', ...);
test('entryBase: коммит входа после заливки — он; заливка после входа — она; ничего — первый коммит', ...); // gitRepo, план с «Залито на прод»
test('skipTake: архивы и бэкапы без регистра, предел 10 МБ — включительно проходит, на байт больше — нет', ...);
test('oursPaths и pendingDelete: первый коммит и коммиты входа не считаются, «Удалить с сервера» — незакрытые пункты', ...);
test('entrySubject и summaryLine: склонение; нечего — «прод совпадает с git»; доработки, не забранное и ждущее удаления — отдельно', ...);
test('отметка: две сессии не мешают друг другу, битый файл — пустая, старше 7 дней убираются, lastNeed — последняя need', ...); // ревью 4
```

Шаг 2. `node --test tests/prod-lib.test.js` — FAIL (модуля нет).

Шаг 3. Написать `lib/prod.js`.

Шаг 4. `node --test tests/prod-lib.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 48.2`.

## 48.3 — `prod-entry.js`: вход по SSH

**Файлы:** создать `plugins/kit/scripts/prod-entry.js`; тест — `tests/prod-entry.test.js`.

**Интерфейсы:** берёт `lib/prod.js` (48.2); `runSsh`, `shq`, `serverSsh`, `lastLine` (`lib/ssh.js`); `kitInfo`, `serverEnv`
(`lib/project.js`); `skipRules`, `git` (`lib/deploy.js`); `matchRules` (`lib/paths.js`); `projectRoot` (`lib/matt.js`);
`kit-commit.js` — дочерним процессом `node kit-commit.js [--push <имя>] -- <пути>` с сообщением на stdin. Даёт:
- `parseArgs(argv) → { check, ftpDone, skip, hook, watchersOk, bigOk, timeout }` — сразу все флаги этапа (`--check`, `--ftp-done`,
  `--skip`, `--hook`, `--watchers-ok`, `--big-ok`, `--timeout сек`, по умолчанию 100); неверное — исключение → код 4;
- `listScript(root, tracked: string[], prune: string[]) → string` — сценарий `sh -s`: `cd`, проверка `md5sum` и `base64`, md5 без
  `\r` по отслеживаемым (`tr -d '\r' < f | md5sum`), `find` остальных обычных файлов (`-type f`, ссылки и каталоги — нет) с размером;
  `prune` — `/bitrix`, `/upload` и другие корневые записи `.gitignore` вида `/<папка>/*` или `/<папка>/`; пути в выводе — base64
  (переводы строк в именах не ломают разбор); нечитаемый файл — признак, а не пустой хеш;
- `parseList(stdout) → { err, md5: Map<string, string|null>, extra: Map<string, number>, unreadable: Set<string> }`;
- `fetchScript(root, paths) → string`, `parseFetch(stdout) → Map<string, Buffer>` — файлы в base64 одним подключением, порциями
  при большом объёме;
- `entry(dir, { check, env, timeoutMs, sessionId, watchersOk, bigOk }) → Promise<{ code, out: string[], commit? }>` — для тестов;
  `main` печатает `out` (последняя строка — `summaryLine`) и ставит код.

> **Уточнено при исполнении 48.3** (решения — в `journal/decisions.md` строками шага 48.3). База входа — по путям: `entryBase` →
> `{ base, source, overlay, entries }`, помощник `baseTree` (`lib/prod.js`): дерево последней заливки, поверх — пути из коммитов входа
> своего окружения после неё (дерево коммита входа целиком базой не служит — в нём наши незалитые шаги). Отрезание на сервере — по
> `.gitignore` с учётом отрицаний (`pruneRules`, `findPrune`), а не `/bitrix` целиком. md5 на сервере — пачкой, как есть: `parseList` →
> `{ err, bad, state, md5, files, findFailed }`, CRLF и LF сравниваются у нас, неясное — скачивается; `parseFetch` →
> `{ err, bad, data, failed }`. При многих путях — несколько коммитов входа подряд (`argLimit`; решение пользователя).

Поведение:
- нет сервера (Т-1) — код 2, «вход не нужен»; SSH окружения нет — здесь код 2 «без SSH — 48.5» (48.5 заменит);
- база — `entryBase`; три версии каждого пути — `classify`; новые на сервере — из `extra` после фильтра: `git check-ignore --stdin`,
  `skipRules`, `.claude/`; `skipTake` — не забирать, назвать (уже названные — `named` отметки — не называть снова);
  `pendingDelete` — не возвращать, «ждёт удаления с сервера»; `unreadable` — не трогать, назвать;
- рабочая копия: путь к забору с незакоммиченной правкой — здесь код 1 «совмещение — 48.4» (48.4 заменит);
- `--check` или сессия в worktree (`projectRoot(dir) !== dir`): только сверка, ничего не пишет; забирать нечего — отметка `checked`,
  код 0; есть что — код 1: «есть изменения без kit — вход делает общая сессия в основной папке»;
- забор: до записи — `pending` в отметке (пути забора); запись через `<путь>.kit-tmp` и переименование, сверка md5 записанного;
  удалённые без нас — удалить локально; затем `kit-commit.js` с сообщением `entrySubject(...)`, пустая строка, пути с пометкой
  (изменён / добавлен / удалён); «Удалённый репозиторий» задан — `--push <имя>`; код 1 `kit-commit.js` (секрет) — вход код 1, вывод
  скрипта коммита — пользователю; после коммита — `pending` пуст, отметка `done` с коммитом;
- повтор: пути из `pending` — к забору, даже если рабочая копия уже равна серверу (ревью 5);
- нет подключения, обрыв, вышло время — код 3 и строка «спроси пользователя: Повторить / Работать без входа (`prod-entry.js --skip`)»;
- сессия: `process.env.KIT_SESSION_ID`, нет — `lastNeed(dir)`, нет и её — отметку не ставить, строка «отметка не поставлена:
  хук не пустит правки — перезапусти сессию».

Шаг 1. Тесты (заглушка `fake-ssh.js`, хост `sh`, «сервер» — временная папка, как в `tests/ssh-deploy.test.js`; без `sh` —
пропуск):

```js
test('изменён, добавлен, удалён без нас → один коммит входа с ENTRY_RE, строка с тремя числами, отметка done', ...);
test('ничего не поменялось → коммита нет, «прод совпадает с git», отметка done', ...);
test('закоммиченный, но не залитый шаг (база — заливка до него) — не откатан, коммита входа нет', ...);
test('файл с историей шагов изменён без нас → в строке доработки с путём', ...);
test('удалённый нашим шагом файл лежит на сервере → не возвращён, «ждёт удаления с сервера»', ...);
test('архив и файл больше 10 МБ — не забраны и названы; второй вход их не называет', ...);
test('CRLF на сервере, LF в git — не изменение', ...);                                   // ревью 2
test("путь с пробелом, кириллицей и ' — забран и закоммичен", ...);                        // ревью 1
test('нечитаемый файл на сервере — не удалён, не забран, назван', ...);                    // ревью 3
test('каталог и ссылка вместо файла — не забираются, вход не падает', ...);
test('нет подключения — код 3; обрыв при скачивании — повтор доводит до коммита с файлами из pending', ...); // Т-12, ревью 5
test('--check и worktree: только сверка, есть что забрать — код 1, ничего не записано', ...);
test('«Прод: —» и не kit-проект — код 2, файлов не пишет', ...);
test('секрет в скачанном файле — код 1, коммита нет, вывод kit-commit.js в out', ...);
```

Шаг 2. `node --test tests/prod-entry.test.js` — FAIL.

Шаг 3. Написать `prod-entry.js`.

Шаг 4. `node --test tests/prod-entry.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 48.3`.

## 48.4 — незакоммиченные правки, совмещение, File Watchers, предел за вход

**Файлы:** изменить `plugins/kit/scripts/prod-entry.js` (и `lib/prod.js`, если нужен общий помощник); тест — `tests/prod-entry.test.js`.

**Интерфейсы:** берёт `entry` и разбор из 48.3; даёт `watcherExts(dir) → Set<string>` — расширения включённых задач
`.idea/watcherTasks.xml` (нет файла — пусто).

Поведение (заменяет временный код 1 «совмещение — 48.4»):
- путь с незакоммиченной правкой (рабочая копия ≠ HEAD): сервер = рабочая копия — наше, не трогать, в строку не включать; сервер ≠
  базе — совместить `git merge-file -p <рабочая копия> <база> <сервер>` во временной папке: сошлось — результат в рабочую копию, в
  коммит входа путь не идёт (Т-8: совмещённое остаётся незакоммиченным); конфликт — рабочую копию не трогать, версию сервера
  положить во временный файл вне проекта, код 1 со списком путей и путями временных файлов;
- то же для `merge` без незакоммиченной правки: наша версия — HEAD, результат — в рабочую копию, в коммит входа не идёт;
- «PhpStorm Always» и среди забираемых или совмещаемых — файлы с расширениями `watcherExts` → до скачивания код 1: какие файлы и
  что пересборка перезапишет результат и PhpStorm зальёт его на сервер; `--watchers-ok` — забирать;
- сумма размеров забираемого больше `ENTRY_LIMIT` → до скачивания код 1 с самыми тяжёлыми папками; `--big-ok` — забирать.

Шаг 1. Тесты:

```js
test('незакоммиченная правка уже на сервере — не тронута, в строке и коммите входа её нет', ...);
test('незакоммиченная правка и изменение без нас — совмещено в рабочей копии, в коммите входа пути нет', ...);
test('merge закоммиченного незалитого с изменением без нас — совмещено, коммит входа без этого пути', ...);
test('конфликт совмещения — код 1, рабочая копия не тронута, версия сервера — во временном файле', ...);
test('Always и .scss среди забираемых — код 1 до скачивания; --watchers-ok — забрано', ...);
test('больше 50 МБ за вход — код 1 до скачивания; --big-ok — забрано', ...);
```

Шаг 2. `node --test tests/prod-entry.test.js` — новые FAIL.

Шаг 3. Дописать `prod-entry.js`.

Шаг 4. `node --test tests/prod-entry.test.js` — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 48.4`.

## 48.5 — без SSH, пропуск, хук SessionStart

**Файлы:** изменить `plugins/kit/scripts/prod-entry.js`, `plugins/kit/hooks/hooks.json`; тест — `tests/prod-entry.test.js`.

**Интерфейсы:** берёт `markSession`, `lastNeed`, `classify`, `entryBase` (48.2), `entry` (48.3–48.4); даёт `hookLine(info, { ssh,
matt }) → string` — строка в контекст.

Поведение (заменяет временный код 2 «без SSH — 48.5»):
- без SSH: рабочая копия с правками файлов сайта — код 1: скачивание затрёт их, сначала спросить; иначе код 1 со списком корней
  (первые части путей `git ls-files`, которые сверяет Т-4) и подсказкой, как скачать их в PhpStorm с сервера автозаливки, —
  Claude спрашивает «Скачал / Не буду скачивать»;
- `--ftp-done`: «сервер» — рабочая копия после скачивания; `take` — в коммит входа; наше незалитое, вернувшееся к базе
  (HEAD ≠ база, скачанное = база), — восстановить из HEAD (`git show HEAD:<путь>` в файл); `merge` — как в 48.4 (наша — HEAD); новые
  неотслеживаемые — через `skipTake`; дальше — коммит, строка, отметка, как в 48.3;
- `--skip` — отметка `skipped` для сессии, строка `[kit] Вход с прода пропущен по решению пользователя: до конца сессии правки без
  входа.`, код 0;
- `--hook` (SessionStart, ввод хука — `session_id`, `source`): не kit-проект или нет сервера — тишина; `source === 'compact'` —
  тишина, отметка остаётся; иначе `markSession(dir, session_id, 'need')` и, если задан `CLAUDE_ENV_FILE`, дописать туда
  `export KIT_SESSION_ID='<id>'`; `additionalContext` — `hookLine`: с SSH — первым делом вход `node "<путь>/prod-entry.js"` (после
  `git pull`, если его требует строка выше), до входа правки сайта не пройдут, сервер недоступен — вопрос «Повторить / Работать
  без входа»; без SSH — вход по FTP перед первой правкой файлов сайта; проект Мэтта — исполнитель и сессия в worktree запускают
  с `--check`; пользователю (`systemMessage`) — ничего;
- `hooks.json`, `SessionStart`, после записи `remote-check.js`: `{ "type": "command", "command": "node", "args":
  ["${CLAUDE_PLUGIN_ROOT}/scripts/prod-entry.js", "--hook"], "timeout": 10 }`.

Шаг 1. Тесты:

```js
test('без SSH: список корней для FTP; правки файлов сайта в рабочей копии — сначала предупреждение', ...);
test('--ftp-done: скачанное без нас — в коммите входа; наше незалитое, вернувшееся к базе, — восстановлено из HEAD', ...);
test('--skip: отметка skipped для KIT_SESSION_ID, код 0', ...);
test('--hook: startup, resume, clear, fork — need и KIT_SESSION_ID в CLAUDE_ENV_FILE; compact — тишина; запись другой сессии цела', ...); // ревью 4
test('--hook: нет сервера, не kit-проект, битый ввод — тишина и код 0', ...);
test('--hook: проект Мэтта — строка с --check; без SSH — строка про FTP', ...);
test('hooks.json: prod-entry.js --hook в SessionStart после remote-check.js', ...);
```

Шаг 2. `node --test tests/prod-entry.test.js` — новые FAIL.

Шаг 3. Дописать `prod-entry.js` и `hooks.json`.

Шаг 4. `node --test tests/prod-entry.test.js` — PASS; `npm test` — PASS; `claude plugin validate plugins/kit --strict` — без ошибок.

Шаг 5. `/kit:step-done 48.5`.

## 48.6 — `guard-prod.js` и `hooks.json`

**Файлы:** создать `plugins/kit/scripts/guard-prod.js`; изменить `plugins/kit/hooks/hooks.json`, `plugins/kit/scripts/guard-matt.js`
(экспорт `relInRoot`); тест — `tests/guard-prod.test.js`.

**Интерфейсы:** берёт `sessionDone` (48.2), `kitInfo`, `serverEnv`, `serverSsh`, `skipRules`, `matchRules`, `relInRoot`
(`guard-matt.js`); даёт `checkEdit(input, ctx: { root: string, rules, done: boolean, ssh: boolean }) → string | null`.

Правила:
- `Write`, `Edit`, `MultiEdit`, `NotebookEdit`; путь — `tool_input.file_path || tool_input.notebook_path`; вне проекта, в
  `.claude/`, под `rules` или `done` — `null`; иначе причина: с SSH — «Сначала вход с прода: `node "<путь>/prod-entry.js"` —
  копия обновится с сервера, чужие правки не затрутся. Сервер недоступен — спроси пользователя: повторить или работать без входа
  (`prod-entry.js --skip`).»; без SSH — то же про вход по FTP;
- `main` — kit-проект с сервером (Т-1), `done` — `sessionDone(dir, input.session_id)`; отказ — как в `guard-matt.js`
  (`permissionDecision: 'deny'`, причина с `[kit] `); исключение — тихо;
- `hooks.json`, `PreToolUse` — отдельная запись: `{ "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [ { "type": "command",
  "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/guard-prod.js"], "timeout": 10 } ] }`.

Шаг 1. Тесты:

```js
const CASES = [ // корень C:\proj, «Не выкладывать: tests»; [ввод, вход сделан, ожидание]
  [{ tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\local\\a.php' } }, false, 'deny'],
  [{ tool_name: 'Edit', tool_input: { file_path: 'c:/PROJ/local/a.php' } }, true, null],
  [{ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\.claude\\docs\\progress.md' } }, false, null],
  [{ tool_name: 'Write', tool_input: { file_path: 'C:\\Temp\\x.php' } }, false, null],
  [{ tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\tests\\a.test.js' } }, false, null],
  [{ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:\\proj\\a.ipynb' } }, false, 'deny'],
  [{ tool_name: 'Read', tool_input: { file_path: 'C:\\proj\\a.php' } }, false, null],
];
test('checkEdit: файлы сайта до входа — отказ, после — пропуск; .claude, «Не выкладывать», вне проекта — пропуск', ...);
test('guard-prod: проект без сервера и не kit-проект — пропуск; вход другой сессии не в счёт; skipped и checked — пропуск', ...);
test('hooks.json: guard-prod.js в PreToolUse на Write|Edit|MultiEdit|NotebookEdit', ...);
```

Шаг 2. `node --test tests/guard-prod.test.js` — FAIL.

Шаг 3. Написать `guard-prod.js`, экспортировать `relInRoot`, дописать `hooks.json`.

Шаг 4. `node --test tests/guard-prod.test.js tests/guard-matt.test.js` — PASS; `npm test` — PASS; `claude plugin validate plugins/kit --strict` — без ошибок.

Шаг 5. `/kit:step-done 48.6`.

## 48.7 — заливка после входа

**Файлы:** изменить `plugins/kit/scripts/lib/deploy.js` (`changes`), `plugins/kit/scripts/ssh-deploy.js`, `plugins/kit/scripts/lib/prod.js`;
тесты — `tests/deploy-lib.test.js`, `tests/ssh-deploy.test.js`.

**Интерфейсы:** даёт `entryOnly(cwd, base) → Set<string>` (`lib/prod.js`) — пути, которые после `base` меняли только коммиты входа и
которые в рабочей копии не отличаются от HEAD; `changes(cwd, base, rules, exclude = new Set())` — пути из `exclude` убираются.
`lib/deploy.js` не берёт `lib/prod.js` (нет круговой зависимости): `exclude` считает `ssh-deploy.js`.

Поведение: список и `--go` файлов шага — `exclude = entryOnly(cwd, base)`; `--docs` и `-- <пути>` (откат) — как прежде.

Шаг 1. Тесты:

```js
test('changes с exclude: файл только из коммита входа после базы — не в списке; тот же файл, изменённый потом шагом, — в списке', ...);
test('ssh-deploy.js (список): после входа — файлы шага есть, файлов входа нет; --docs — как прежде', ...);
```

Шаг 2. `node --test tests/deploy-lib.test.js tests/ssh-deploy.test.js` — новые FAIL.

Шаг 3. Дописать `entryOnly`, `changes`, `ssh-deploy.js`.

Шаг 4. Те же тесты — PASS; `npm test` — PASS.

Шаг 5. `/kit:step-done 48.7`.

## 48.8 — `/kit:project-init`, шаблон `CLAUDE.md`, `/kit:matt`

**Файлы:** изменить `plugins/kit/skills/project-init/SKILL.md`, `plugins/kit/skills/project-init/templates/CLAUDE.md`,
`plugins/kit/skills/matt/SKILL.md`, `plugins/kit/skills/matt/reference/edges.md`; тесты — `tests/content.test.js`,
`tests/templates.test.js`.

Правки:
- `/kit:project-init`, п. 0 (исходники с сервера в пустую папку): после первого коммита `0.1` — вход `node
  "${CLAUDE_PLUGIN_ROOT}/scripts/prod-entry.js"` (прод совпадает с git — отметка этой сессии); в итоге запуска — одна строка о входе
  в каждой сессии;
- шаблон `CLAUDE.md`, раздел «Как работаем», после строки «Код пишет Claude»: `- **Прод главный.** В начале каждой сессии Claude
  сам забирает в git то, что поменяли на сервере без нас (коммит входа, одна строка вам); до входа файлы сайта не правятся{{; без SSH
  — перед первой правкой Claude скажет, что скачать по FTP | }}.`; без сервера («Прод: —») строки нет;
- `/kit:matt`, шаблон задания исполнителю (п. 5), строка после «Возьми тикет…»: `Вход с прода — только сверкой: node
  <путь prod-entry.js> --check; есть что забрать — стоп, сообщи (вход — в общей сессии).`; ядро — не больше 12 288 байт: освободить
  место выносом абзаца вне шаблона задания в `reference/edges.md` (со ссылкой из ядра).

Шаг 1. Тесты:

```js
test('шаблон CLAUDE.md: строка «Прод главный» в «Как работаем»', ...);
test('/kit:project-init: после 0.1 — вход prod-entry.js', ...);
test('/kit:matt: задание исполнителю — prod-entry.js --check', ...); // и прежняя проверка: ядро ≤ 12 288 байт
```

Шаг 2. `node --test tests/content.test.js tests/templates.test.js` — новые FAIL.

Шаг 3. Правки навыков и шаблона.

Шаг 4. Те же тесты — PASS; `npm test` — PASS; `claude plugin validate plugins/kit --strict` — без ошибок.

Шаг 5. `/kit:step-done 48.8`.

## 48.9 — выпуск kit 3.4.0: версии, README, обзор

**Файлы:** `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.claude/CLAUDE.md` («Версия kit: 3.4.0»),
`README.md`, `.claude/docs/work/overview/build/` (затем `node .claude/docs/work/overview/build/build.js`).

Шаг 1. Версии — 3.4.0.

Шаг 2. README — раздел «Прод главный: вход с прода (с 3.4.0)»: зачем, что делает вход, три версии файла простыми словами, что не
забирается, без SSH, «Работать без входа», проекты Мэтта; «Что внутри» — `prod-entry.js`, `guard-prod.js`, `lib/prod.js`.

Шаг 3. Обзор — хук SessionStart `prod-entry.js --hook`, PreToolUse `guard-prod.js`, скрипт входа, схемы хуков; пересобрать;
повторная сборка ничего не меняет; схему хуков посмотреть в браузере — без наложений.

Шаг 4. `npm test` — PASS; `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict` — без ошибок;
`node tools/kit-denylist.js tree` — чисто; свежий проверяющий сверяет README и обзор с кодом.

Шаг 5. `/kit:step-done 48.9`.

## 48.10 — выпуск kit 3.4.0: отправка, установка и живая проверка

Шаг 1. С согласия пользователя — `node tools/kit-denylist.js tree`, `git push origin master`; затем
`claude plugin marketplace update claude-kit` и `claude plugin update kit@claude-kit`; перезапуск сессии; `claude plugin list` —
kit 3.4.0.

Шаг 2. Стенд выбирает пользователь (AskUserQuestion): дев-стенд или копия сайта, не прод клиента. Сценарий — «Критерии готовности»
спека; заодно проверить предположения: `CLAUDE_ENV_FILE` передаёт `KIT_SESSION_ID` в команды Bash; субагенты вызывают инструменты с
`session_id` своей сессии.

Шаг 3. Найденное — исправления шагами `48.10а`, `48.10б` и выпуск 3.4.1, если понадобится.

Шаг 4. `/kit:step-done 48.10` — этап закрыт (`NEXT` — `—`), спек и план уходят в `archive/`.
