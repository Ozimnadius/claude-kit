# План реализации: этап 10 — снимки публичной части `/kit:visual`

> **Для исполнителя:** обязательный навык — superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans; задачи выполняются по порядку, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** перенести в плагин kit инструмент визуальных снимков публичной части сайта «до/после» из прототипа beta — без потерь и с тем, что показала практика: контрольный прогон и шум, setup при одиночных страницах, статусы и ошибки сети, опасные адреса, защита выкладки; скилл `/kit:visual`, интеграция с `/kit:project-init` и `/kit:step-done`; версия плагина 2.2.0.

**Архитектура:** CLI `plugins/kit/scripts/visual.js` поверх модулей `plugins/kit/scripts/lib/visual/`. Всё, что работает без браузера (`args`, `links`, `config`, `diff`, `report`, `image`, `home`, `guard`), покрыто `node --test`; браузерная часть (`browser.js` — Playwright и системный Chrome) проверяется вживую: на локальном тестовом сайте (задача 10.8) и на beta (10.11). npm-зависимости (`playwright-core`, `pixelmatch`, `pngjs`) — не в плагине, а один раз на машину в `%LOCALAPPDATA%\kit\visual\deps`; модули получают их через `createRequire` (у `pixelmatch` — только ESM, поэтому `import()`).

**Стек:** Node.js ≥ 18 (установлен v24.15.0), `node:test`, playwright-core 1.63.0 (`channel: 'chrome'`), pixelmatch 7.2.0, pngjs 7.0.0, Google Chrome, Claude Code 2.1.278.

**Спек:** `docs/spec-claude-kit.md` — §7.5 `/kit:visual` и подраздел «Снимки: `visual.js`» в §9 (плюс §2, 4, 5, 7.1, 7.3, 10, 11, 13) — читать вместе с планом.

**Как проверен код плана:** весь код и тексты ниже собраны и прогнаны 2026-09-25 в копии репозитория (база — `fca3ee5`, после слияния 9.3–9.4): `npm test` — 247 тестов, 244 ✔, 3 пропущены (симлинки из 9.3, как в `master`); `claude plugin validate --strict` (плагин и маркетплейс) чистый; на локальном тестовом сайте — `deps`, `login`, `discover`, `shoot`, `check`, частичный `shoot`, `compare`, `list` (там найдена и исправлена слабость: строки шума теперь сравниваются с точностью до чисел).

## Общие ограничения

- Node.js ≥ 18. Скрипты — CommonJS, `'use strict'`, первая строка исполняемого `visual.js` — `#!/usr/bin/env node`. Модули `lib/visual/*` сами npm-пакеты не подключают: `image.js` получает `PNG`/`pixelmatch` аргументом, `browser.js` — модуль `playwright-core` аргументом, загрузка — только в `home.js`.
- npm-зависимости — только три, версии точные: `playwright-core` 1.63.0, `pixelmatch` 7.2.0, `pngjs` 7.0.0 (`plugins/kit/scripts/visual-deps/package.json`). Для тестов — devDependencies корня репозитория `pixelmatch` 7.2.0 и `pngjs` 7.0.0. **Любой `npm install` — только контроллер и только после согласия пользователя** (AskUserQuestion); исполнитель npm не запускает.
- **Тесты не запускают браузер и не ходят на сайты.** Живые запуски — только контроллер: локальный тестовый сайт (10.8) и beta с согласия пользователя (10.11).
- Windows 11: PowerShell 5.1 и Git Bash. Файлы — UTF-8 без BOM, переводы строк LF. Тексты для пользователя, комментарии и сообщения — по-русски.
- Тесты: `node --test tests/*.test.js` (или `npm test`) из корня worktree `C:\OSPanel\home\claude-kit\.claude\worktrees\gracious-feynman-b8796e`.
- Bash: без `cd` в основной оболочке (страж kit блокирует) — абсолютные пути, `git -C <путь>`, подоболочка `( cd … && … )`.
- Снимки — `docs/visual/` — никогда не коммитить; в тестах — только временные папки.
- Версия плагина меняется только в задаче 10.10: `2.2.0` одинаково в `plugins/kit/.claude-plugin/plugin.json` и `.claude-plugin/marketplace.json` (2.1.0 занята шагом 9.3).
- **Git и журнал:** исполнитель не коммитит и не правит `docs/progress.md`; из git ему можно только читать (`status`, `diff`, `log`, `show`). Шаг закрывает контроллер после ревью через `/kit:step-done` (docs-keeper → git-keeper, один коммит `10.N: …`); исправления по ревью — отдельными коммитами с тем же ID и буквой (`10.5а`), без amend.
- Если `master` уйдёт вперёд (другая сессия) — контроллер сливает его в ветку так же, как `fca3ee5` (merge-коммит, конфликт журнала — сохранить обе стороны).

## Карта файлов

| Файл | Ответственность | Задача |
|---|---|---|
| `plugins/kit/scripts/lib/visual/args.js` | разбор аргументов, `VisualError`, правка путей Git Bash, метки и имена | 10.3 |
| `plugins/kit/scripts/lib/visual/links.js` | опасные адреса, файлы, чистка ссылок, шаблоны групп | 10.3 |
| `tests/visual-args-links.test.js` | тесты `args` и `links` | 10.3 |
| `plugins/kit/scripts/lib/visual/config.js` | `pages.json`: проверка, умолчания, выбор страниц; адрес сайта и режим из параметров | 10.4 |
| `tests/data/visual-pages-beta.json`, `tests/visual-config.test.js` | копия `pages.json` прототипа, тесты `config` | 10.4 |
| `plugins/kit/scripts/lib/visual/diff.js` | дифф текста, шум, сравнение meta, вердикты, `meta.json` и `noise.json` | 10.5 |
| `plugins/kit/scripts/lib/visual/report.js` | `summary.json`, `report.html`, строки консоли | 10.5 |
| `tests/visual-diff-report.test.js` | тесты `diff` и `report` (паритет дифф-текста с прототипом) | 10.5 |
| `plugins/kit/scripts/lib/visual/image.js` | сравнение PNG | 10.6 |
| `plugins/kit/scripts/lib/visual/home.js` | `<дом>` на машине, зависимости, установка, путь сессии | 10.6 |
| `plugins/kit/scripts/visual-deps/package.json` | закреплённые версии зависимостей | 10.6 |
| `package.json`, `package-lock.json` (корень) | devDependencies `pixelmatch`, `pngjs` для тестов | 10.6 |
| `tests/visual-image-home.test.js` | тесты `image` и `home` | 10.6 |
| `plugins/kit/scripts/lib/visual/guard.js`, `tests/visual-guard.test.js` | защита выкладки | 10.7 |
| `plugins/kit/scripts/secret-scan.js`, `plugins/kit/agents/git-keeper.md`, `tests/secret-scan.test.js` | `docs/visual` в базовых запретах | 10.7 |
| `plugins/kit/scripts/lib/visual/browser.js` | съёмка в Chrome: стабилизация, действия, вход, discover | 10.8 |
| `plugins/kit/scripts/visual.js`, `tests/visual-cli.test.js` | CLI и его тесты без браузера | 10.8 |
| `plugins/kit/skills/visual/SKILL.md`, `plugins/kit/skills/visual/reference/pages.md` | скилл `/kit:visual` и справка | 10.9 |
| `tests/content.test.js` | тест скилла `visual` (10.9); project-init, step-done, шаблоны (10.10) | 10.9, 10.10 |
| `plugins/kit/skills/project-init/SKILL.md`, `reference/phpstorm.md`, `templates/CLAUDE.md`, `templates/gitignore-bitrix`, `templates/gitignore-general` | `docs/visual` в исключениях, `.gitignore`, правилах | 10.10 |
| `plugins/kit/skills/step-done/SKILL.md` | NOTES про снимки | 10.10 |
| `tests/templates.test.js` | шаблоны `.gitignore` с `docs/visual` | 10.10 |
| `README.md`, `plugin.json`, `marketplace.json` | описание, раздел «Снимки», версия 2.2.0 | 10.10 |

## Шаги журнала и остановки

| Часть | Шаги | Кто | Остановка на проверку пользователя |
|---|---|---|---|
| A — библиотека без браузера | 10.3 `args` и `links`, 10.4 `config`, 10.5 `diff` и `report`, 10.6 `image`, `home`, зависимости, 10.7 `guard` и запреты | исполнители (sonnet), ревью по каждой задаче; `npm install` в корне (10.6) — контроллер с согласия | после 10.7 |
| B — CLI, скилл, интеграции | 10.8 `browser.js` и `visual.js` (+ проверка контроллером на локальном тестовом сайте), 10.9 скилл и справка, 10.10 интеграции, README, 2.2.0 | исполнители (sonnet), ревью | после 10.10 |
| C — живая проверка | 10.11 beta: прототип и новый инструмент подряд, контрольный прогон | контроллер с пользователем | после 10.11 |
| D — выпуск | 10.12 финальное ревью (opus), исправления, слияние в `master`, обновление установленного плагина, переезд beta, push с согласия | контроллер | в конце |

---

## Часть A — библиотека без браузера

### Задача 10.3: `args.js` и `links.js`

**Files:**
- Create: `plugins/kit/scripts/lib/visual/args.js`
- Create: `plugins/kit/scripts/lib/visual/links.js`
- Test: `tests/visual-args-links.test.js`

**Interfaces:**
- Consumes: ничего.
- Produces (для 10.4–10.8):
  - `args.js`: `class VisualError extends Error` (`new VisualError(code, message)`, поле `code`: 2 — аргументы или pages.json, 3 — сессия, 4 — защита выкладки, 5 — зависимости или Chrome); `NAME_RE`; `parseArgs(argv) → { cmd, positional: string[], flags: { only?, ctx?, vp?, env?, url?, 'no-setup'? } }`; `fixMsysPath(s) → string`; `seedPath(s) → '/…'`; `parseOnly(s) → string[]`; `checkLabel(label, { reserved }) → label`.
  - `links.js`: `DANGER`; `dangerReason(url, extra: RegExp[] = []) → string | null`; `isFile(url) → boolean`; `cleanLink(href, base) → '/путь?query' | null`; `linkPattern(url) → string`; `collectLinks([{ seed, hrefs }], base, extra) → [{ url, pattern, from, danger?, file? }]`; `groupLinks(links) → [{ pattern, count, example }]`.

- [ ] **Шаг 1: тест**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VisualError, parseArgs, fixMsysPath, seedPath, parseOnly, checkLabel } = require('../plugins/kit/scripts/lib/visual/args');
const { dangerReason, isFile, cleanLink, linkPattern, collectLinks, groupLinks } = require('../plugins/kit/scripts/lib/visual/links');

const BASE = 'https://beta.example.com';

test('parseArgs: команда, позиционные, флаги со значением и без', () => {
  const a = parseArgs(['shoot', 'after-1.1', '--only', 'home,order', '--ctx', 'admin', '--vp', 'mobile', '--no-setup', '--env', 'дев', '--url', 'https://x.ru']);
  assert.equal(a.cmd, 'shoot');
  assert.deepEqual(a.positional, ['after-1.1']);
  assert.deepEqual(a.flags, { only: 'home,order', ctx: 'admin', vp: 'mobile', 'no-setup': true, env: 'дев', url: 'https://x.ru' });
  assert.deepEqual(parseArgs([]), { cmd: '', positional: [], flags: {} });
});

test('parseArgs: неизвестный флаг и флаг без значения — код 2', () => {
  for (const argv of [['shoot', 'a', '--fast'], ['shoot', 'a', '--only'], ['shoot', 'a', '--only', '--ctx', 'x']]) {
    assert.throws(() => parseArgs(argv), (e) => e instanceof VisualError && e.code === 2, argv.join(' '));
  }
});

test('fixMsysPath и seedPath: путь, переписанный Git Bash, возвращается как был', () => {
  assert.equal(fixMsysPath('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(fixMsysPath('C:\\Program Files\\Git\\personal\\orders\\'), '/personal/orders/');
  assert.equal(fixMsysPath('D:/Tools/PortableGit/catalog/'), '/catalog/');
  assert.equal(fixMsysPath('/catalog/'), '/catalog/');
  assert.equal(seedPath('C:/Program Files/Git/catalog/'), '/catalog/');
  assert.equal(seedPath('catalog/'), '/catalog/');
  assert.equal(seedPath('/'), '/');
  assert.equal(seedPath('https://beta.example.com/catalog/?q=1'), '/catalog/?q=1');
});

test('parseOnly: список через запятую', () => {
  assert.deepEqual(parseOnly('home, order,,basket'), ['home', 'order', 'basket']);
  assert.deepEqual(parseOnly(undefined), []);
});

test('checkLabel: допустимые, недопустимые и зарезервированные метки', () => {
  for (const l of ['before', 'after-1.1', 'main-25.200', 'A_1']) assert.equal(checkLabel(l, { reserved: true }), l);
  for (const l of ['', '-x', '.x', 'a b', 'a/b', '../x', 'пример']) {
    assert.throws(() => checkLabel(l), (e) => e.code === 2, JSON.stringify(l));
  }
  assert.throws(() => checkLabel('before-check', { reserved: true }), /check/);
  assert.throws(() => checkLabel('compare-a-vs-b', { reserved: true }), /compare/);
  assert.equal(checkLabel('before-check'), 'before-check');
});

test('dangerReason: опасные адреса с причиной, обычные — null', () => {
  const bad = {
    '/auth/?logout=yes': 'выход',
    '/personal/cancel/109/?CANCEL=Y': 'отмена заказа',
    '/personal/order/?ID=5&CANCEL=Y': 'отмена заказа',
    '/personal/orders/?COPY_ORDER=Y&ID=109': 'повтор заказа',
    '/catalog/x/1/?action=ADD2BASKET&id=1': 'действие через GET',
    '/basket/?del=5': 'удаление',
    '/basket/?delete_id=5': 'удаление',
    '/items/remove/5/': 'удаление',
    '/news/?sessid=abc': 'sessid',
    '/subscribe/?unsubscribe=1': 'отписка',
    '/?clear_cache=Y': 'сброс кеша',
    '/bitrix/admin/': 'служебное',
  };
  for (const [url, why] of Object.entries(bad)) assert.match(dangerReason(url) || '', new RegExp(why), url);
  for (const url of ['/', '/catalog/', '/personal/order/1/', '/order/?delivery=2', '/catalog/?q=%D0%B1', '/local/bitrix/x/', '/auth/?forgot_password=yes']) {
    assert.equal(dangerReason(url), null, url);
  }
  assert.match(dangerReason('/my-action/1/', [/\/my-action\//i]), /pages\.json/);
});

test('isFile: документы и картинки — файлы', () => {
  assert.ok(isFile('/upload/docs/price.PDF'));
  assert.ok(isFile('/img/a.jpg?v=2'));
  assert.ok(!isFile('/catalog/'));
});

test('cleanLink: свой сайт, без #, без меток рекламы; чужое — null', () => {
  assert.equal(cleanLink('https://beta.example.com/catalog/#top', BASE), '/catalog/');
  assert.equal(cleanLink('https://beta.example.com/catalog/?utm_source=x&q=1&gclid=2', BASE), '/catalog/?q=1');
  assert.equal(cleanLink('https://beta.example.com/auth/?backurl=/', BASE), '/auth/?backurl=/');
  assert.equal(cleanLink('http://beta.example.com/company/', BASE), '/company/');
  assert.equal(cleanLink('https://beta.example.com', BASE), '/');
  for (const h of ['https://vk.com/beta', 'mailto:a@b.ru', 'tel:+7900', 'javascript:void(0)', 'https://www.beta.example.com/']) {
    assert.equal(cleanLink(h, BASE), null, h);
  }
  assert.equal(cleanLink('https://x.ru/shop/catalog/', 'https://x.ru/shop'), '/catalog/');
  assert.equal(cleanLink('https://x.ru/blog/', 'https://x.ru/shop'), null);
});

test('linkPattern: числа → {n}, у query — имена', () => {
  assert.equal(linkPattern('/catalog/section_a/1001/'), '/catalog/section_a/{n}/');
  assert.equal(linkPattern('/news/?PAGEN_1=2'), '/news/?PAGEN_1');
  assert.equal(linkPattern('/catalog/?q=a&sort=b&q=c'), '/catalog/?q&sort');
});

test('collectLinks и groupLinks: откуда найдено, пометки, группы без опасных и файлов', () => {
  const links = collectLinks([
    { seed: '/', hrefs: [BASE + '/catalog/a/1/', BASE + '/catalog/a/2/', BASE + '/personal/cancel/1/?CANCEL=Y', BASE + '/price.pdf', 'https://vk.com/x'] },
    { seed: '/personal/', hrefs: [BASE + '/catalog/a/1/', BASE + '/personal/orders/'] },
  ], BASE);
  assert.deepEqual(links.map((l) => l.url), ['/catalog/a/1/', '/catalog/a/2/', '/personal/cancel/1/?CANCEL=Y', '/personal/orders/', '/price.pdf']);
  assert.deepEqual(links[0].from, ['/', '/personal/']);
  assert.equal(links[2].danger, 'отмена заказа');
  assert.equal(links[4].file, true);
  assert.deepEqual(groupLinks(links), [
    { pattern: '/catalog/a/{n}/', count: 2, example: '/catalog/a/1/' },
    { pattern: '/personal/orders/', count: 1, example: '/personal/orders/' },
  ]);
});
```

- [ ] **Шаг 2: запустить — падает**

Run: `node --test tests/visual-args-links.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/lib/visual/args'`.

- [ ] **Шаг 3: `args.js`**

```js
'use strict';
// Аргументы visual.js: команда, позиционные, флаги; пути, переписанные Git Bash; имена и метки.

// Ошибка с кодом выхода: 2 — аргументы или pages.json, 3 — сессия, 4 — защита выкладки, 5 — зависимости или Chrome.
class VisualError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Имя страницы, контекста и метка: латиница, цифры, . _ -, первый символ — буква или цифра.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALUE_FLAGS = ['only', 'ctx', 'vp', 'env', 'url'];
const BOOL_FLAGS = ['no-setup'];

function parseArgs(argv) {
  const out = { cmd: argv[0] || '', positional: [], flags: {} };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && VALUE_FLAGS.includes(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new VisualError(2, `флагу ${a} нужно значение`);
      out.flags[name] = v;
      i++;
    } else if (name && BOOL_FLAGS.includes(name)) out.flags[name] = true;
    else if (name !== null) throw new VisualError(2, `неизвестный флаг ${a}`);
    else out.positional.push(a);
  }
  return out;
}

// Git Bash (MSYS) переписывает «/catalog/» в «C:/Program Files/Git/catalog/» — возвращаем как было.
function fixMsysPath(a) {
  return String(a).replace(/^[A-Za-z]:[\\/].*?Git[\\/]/i, '/').replace(/\\/g, '/');
}

// Адрес-затравка discover: путь от корня сайта (полный адрес — берётся путь и query).
function seedPath(a) {
  let s = fixMsysPath(a);
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    s = u.pathname + u.search;
  }
  return s.startsWith('/') ? s : '/' + s;
}

function parseOnly(v) {
  return v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [];
}

// Метка прогона; reserved — метки, которые делают только сами команды (compare-…, …-check).
function checkLabel(label, { reserved = false } = {}) {
  if (!label) throw new VisualError(2, 'нужна метка, например before или after-1.1');
  if (!NAME_RE.test(label)) throw new VisualError(2, `метка «${label}»: латиница, цифры, . _ -, первый символ — буква или цифра`);
  if (reserved && (label.startsWith('compare-') || label.endsWith('-check'))) {
    throw new VisualError(2, `метка «${label}»: compare-… и …-check делают сами команды compare и check`);
  }
  return label;
}

module.exports = { VisualError, NAME_RE, parseArgs, fixMsysPath, seedPath, parseOnly, checkLabel };
```

- [ ] **Шаг 4: `links.js`**

```js
'use strict';
// Ссылки для discover и проверка адресов: опасные (меняют данные или сессию), файлы, группы похожих ссылок.

// Проверяется путь с query, без учёта регистра. Порядок важен: причина — первое совпадение.
const DANGER = [
  [/logout/i, 'выход — сессия пропадёт'],
  [/\/cancel\/|[?&]cancel=y/i, 'отмена заказа'],
  [/copy_order=/i, 'повтор заказа'],
  [/[?&]action=/i, 'действие через GET (корзина, сравнение, удаление)'],
  [/[?&](del|delete|remove)(_[a-z0-9]+)?=|\/(delete|remove)\//i, 'удаление'],
  [/sessid=/i, 'ссылка с sessid — что-то меняет'],
  [/unsubscribe/i, 'отписка'],
  [/clear_cache/i, 'сброс кеша'],
  [/^\/bitrix\//i, 'служебное (/bitrix/)'],
];
const FILE_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|svg|mp4|webm|mp3|csv|xml|txt)$/i;
const TRACKING_RE = /^(utm_.*|yclid|gclid|fbclid)$/i;

// Причина, по которой адрес опасно открывать, или null; extra — RegExp из «danger» в pages.json.
function dangerReason(url, extra = []) {
  for (const [re, why] of DANGER) if (re.test(url)) return why;
  for (const re of extra) if (re.test(url)) return `опасно по pages.json (${re.source})`;
  return null;
}

function isFile(url) {
  return FILE_RE.test(String(url).split('?')[0]);
}

// Ссылка своего сайта → путь от корня сайта с query (без #, без меток рекламы); чужая или не http(s) → null.
function cleanLink(href, base) {
  let u;
  try {
    u = new URL(href, base + '/');
  } catch (e) {
    return null;
  }
  const b = new URL(base);
  if (!/^https?:$/.test(u.protocol) || u.host !== b.host) return null;
  const prefix = b.pathname.replace(/\/+$/, '');
  if (prefix && u.pathname !== prefix && !u.pathname.startsWith(prefix + '/')) return null;
  let search = u.search;
  if ([...u.searchParams.keys()].some((k) => TRACKING_RE.test(k))) {
    for (const k of [...u.searchParams.keys()]) if (TRACKING_RE.test(k)) u.searchParams.delete(k);
    const q = u.searchParams.toString();
    search = q ? '?' + q : '';
  }
  return (u.pathname.slice(prefix.length) || '/') + search;
}

// Шаблон группы: сегменты из цифр → {n}, у query — только имена параметров.
function linkPattern(url) {
  const [p, q] = String(url).split('?');
  const segs = p.split('/').map((s) => (/^\d+$/.test(s) ? '{n}' : s)).join('/');
  if (!q) return segs;
  const names = [...new Set(q.split('&').map((kv) => kv.split('=')[0]).filter(Boolean))].sort();
  return segs + '?' + names.join('&');
}

// pages: [{ seed, hrefs }] → [{ url, pattern, from, danger?, file? }], без повторов, по алфавиту.
function collectLinks(pages, base, extra = []) {
  const map = new Map();
  for (const { seed, hrefs } of pages) {
    for (const h of hrefs || []) {
      const url = cleanLink(h, base);
      if (!url) continue;
      let rec = map.get(url);
      if (!rec) {
        rec = { url, pattern: linkPattern(url), from: [] };
        const d = dangerReason(url, extra);
        if (d) rec.danger = d;
        else if (isFile(url)) rec.file = true;
        map.set(url, rec);
      }
      if (!rec.from.includes(seed)) rec.from.push(seed);
    }
  }
  return [...map.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

// Группы страниц (без опасных и файлов): [{ pattern, count, example }].
function groupLinks(links) {
  const groups = new Map();
  for (const l of links) {
    if (l.danger || l.file) continue;
    const g = groups.get(l.pattern);
    if (g) g.count++;
    else groups.set(l.pattern, { pattern: l.pattern, count: 1, example: l.url });
  }
  return [...groups.values()].sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
}

module.exports = { DANGER, dangerReason, isFile, cleanLink, linkPattern, collectLinks, groupLinks };
```

- [ ] **Шаг 5: запустить — проходит**

Run: `node --test tests/visual-args-links.test.js` → 10/10. Затем `npm test` — всё прежнее зелёное.

- [ ] **Шаг 6: закрыть шаг (контроллер)** — ревью задачи, затем `/kit:step-done 10.3` (FILES — три файла задачи).

### Задача 10.4: `config.js` — pages.json, выбор страниц, адрес сайта

**Files:**
- Create: `plugins/kit/scripts/lib/visual/config.js`
- Create: `tests/data/visual-pages-beta.json` — копия `C:\OSPanel\home\beta.server\.claude\scripts\visual\pages.json` (коммит 0.3 проекта beta) как есть, байт в байт (содержимое ниже)
- Test: `tests/visual-config.test.js`

**Interfaces:**
- Consumes: `args.js` — `VisualError`, `NAME_RE`; `links.js` — `dangerReason`; `lib/params.js` — `readParams`, `makeParams`, у объекта параметров — `get(key, def)`, `list(key)`, `found`.
- Produces (для 10.8):
  - `CONFIG_REL = '.claude/scripts/visual/pages.json'`, `VIEWPORTS = ['desktop', 'mobile']`, `BITRIX_CHECK`;
  - `siteMode(params) → 'bitrix' | 'общий' | null`; `siteBase(params, { env, url }) → 'https://…'` (без `/` в конце);
  - `loginSettings(raw, mode) → { url, check | null }`;
  - `validateConfig(raw, mode) → cfg` — `{ login, hide: string[], mask: string[], danger: RegExp[], contexts: [{ name, auth, viewports, hide, mask, setup, teardown, pages: [{ name, url, actions, viewports | null, fullPage, hide, mask }] }] }`;
  - `readConfigFile(root) → raw | null`; `loadConfig(root, mode) → cfg`;
  - `selectGroups(cfg, { only, ctx, vp }) → { groups: [{ ctx, vp, pages }], full, filters: { only, ctx, vp } }`.

- [ ] **Шаг 1: фикстура `tests/data/visual-pages-beta.json`**

```json
{
  "contexts": {
    "guest": {
      "auth": false,
      "pages": [
        {
          "name": "home",
          "url": "/"
        },
        {
          "name": "auth",
          "url": "/auth/"
        },
        {
          "name": "registration",
          "url": "/auth/registration/?register=yes&backurl=/"
        },
        {
          "name": "forgot-password",
          "url": "/auth/?forgot_password=yes"
        },
        {
          "name": "catalog-redirect",
          "url": "/catalog/"
        },
        {
          "name": "company",
          "url": "/company/"
        },
        {
          "name": "contacts",
          "url": "/contacts/"
        },
        {
          "name": "partners",
          "url": "/partners/"
        },
        {
          "name": "basket-empty",
          "url": "/basket/"
        },
        {
          "name": "404",
          "url": "/net-takoj-stranicy-visual/"
        }
      ]
    },
    "admin": {
      "auth": true,
      "setup": [
        {
          "goto": "/basket/"
        },
        {
          "clickAccept": ".remove_all_basket",
          "optional": true
        },
        {
          "wait": 1500
        },
        {
          "goto": "/catalog/section_a/1001/"
        },
        {
          "fill": ".buy_block-input",
          "nth": 0,
          "value": "1"
        },
        {
          "fill": ".buy_block-input",
          "nth": 1,
          "value": "1"
        },
        {
          "click": ".buy_block-submit"
        },
        {
          "wait": 2500
        },
        {
          "goto": "/catalog/section_a/1002/"
        },
        {
          "fill": ".buy_block-input",
          "nth": 0,
          "value": "1"
        },
        {
          "click": ".buy_block-submit"
        },
        {
          "wait": 2500
        }
      ],
      "pages": [
        {
          "name": "home",
          "url": "/"
        },
        {
          "name": "catalog-popup",
          "url": "/",
          "fullPage": false,
          "viewports": [
            "desktop"
          ],
          "actions": [
            {
              "hover": "header a.dropdown-toggle[href='/catalog/']"
            },
            {
              "wait": 1200
            }
          ]
        },
        {
          "name": "catalog",
          "url": "/catalog/"
        },
        {
          "name": "section-a",
          "url": "/catalog/section_a/"
        },
        {
          "name": "section-b",
          "url": "/catalog/section_b/"
        },
        {
          "name": "section-c",
          "url": "/catalog/section_c/"
        },
        {
          "name": "product-1001",
          "url": "/catalog/section_a/1001/"
        },
        {
          "name": "product-1002",
          "url": "/catalog/section_a/1002/"
        },
        {
          "name": "search",
          "url": "/catalog/?q=%D1%82%D0%BE%D0%B2%D0%B0%D1%80"
        },
        {
          "name": "basket",
          "url": "/basket/"
        },
        {
          "name": "order",
          "url": "/order/"
        },
        {
          "name": "personal",
          "url": "/personal/"
        },
        {
          "name": "personal-orders",
          "url": "/personal/orders/"
        },
        {
          "name": "personal-order-109",
          "url": "/personal/order/1/"
        },
        {
          "name": "personal-private",
          "url": "/personal/private/"
        },
        {
          "name": "personal-favorite",
          "url": "/personal/favorite/"
        },
        {
          "name": "personal-change-password",
          "url": "/personal/change-password/"
        },
        {
          "name": "company",
          "url": "/company/"
        },
        {
          "name": "contacts",
          "url": "/contacts/"
        },
        {
          "name": "partners",
          "url": "/partners/"
        },
        {
          "name": "404",
          "url": "/net-takoj-stranicy-visual/"
        }
      ],
      "teardown": [
        {
          "goto": "/basket/"
        },
        {
          "clickAccept": ".remove_all_basket",
          "optional": true
        },
        {
          "wait": 2000
        }
      ]
    }
  }
}
```

- [ ] **Шаг 2: тест**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject } = require('./helpers');
const { makeParams } = require('../plugins/kit/scripts/lib/params');
const {
  CONFIG_REL, BITRIX_CHECK, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups,
} = require('../plugins/kit/scripts/lib/visual/config');

const BETA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'visual-pages-beta.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const code2 = (re) => (e) => e.code === 2 && re.test(e.message);
const minimal = (extra = {}) => ({ contexts: { guest: { pages: [{ name: 'home', url: '/' }] } }, ...extra });

test('pages.json прототипа beta проходит проверку без правок', () => {
  const cfg = validateConfig(BETA, 'bitrix');
  assert.deepEqual(cfg.contexts.map((c) => c.name), ['guest', 'admin']);
  const admin = cfg.contexts[1];
  assert.equal(admin.auth, true);
  assert.deepEqual(admin.viewports, ['desktop', 'mobile']);
  assert.equal(admin.setup.length, 12);
  assert.equal(admin.teardown.length, 3);
  const popup = admin.pages.find((p) => p.name === 'catalog-popup');
  assert.equal(popup.fullPage, false);
  assert.deepEqual(popup.viewports, ['desktop']);
  assert.equal(popup.actions[0].hover, "header a.dropdown-toggle[href='/catalog/']");
  assert.equal(admin.pages.find((p) => p.name === 'home').fullPage, true);
  assert.deepEqual(cfg.login, { url: '/auth/', check: BITRIX_CHECK });
});

test('login: из pages.json, по умолчанию Битрикс; в общем режиме без check — null', () => {
  assert.deepEqual(loginSettings(undefined, 'bitrix'), { url: '/auth/', check: BITRIX_CHECK });
  assert.deepEqual(loginSettings(undefined, null), { url: '/auth/', check: BITRIX_CHECK });
  assert.deepEqual(loginSettings(undefined, 'общий'), { url: '/auth/', check: null });
  assert.deepEqual(loginSettings({ url: '/login/', check: 'window.uid' }, 'общий'), { url: '/login/', check: 'window.uid' });
  const auth = { contexts: { admin: { auth: true, pages: [{ name: 'home', url: '/' }] } } };
  assert.throws(() => validateConfig(auth, 'общий'), code2(/login\.check/));
  assert.equal(validateConfig({ ...auth, login: { check: 'window.uid' } }, 'общий').login.check, 'window.uid');
  assert.equal(validateConfig(auth, 'bitrix').login.check, BITRIX_CHECK);
});

test('опечатка в ключе, повтор имени, url без /, неверная ширина — код 2 со всеми ошибками сразу', () => {
  const raw = clone(BETA);
  raw.contexts.admin.pages[2].fullpage = false;
  raw.contexts.admin.pages[3].name = raw.contexts.admin.pages[4].name;
  raw.contexts.guest.pages[0].url = 'catalog/';
  raw.contexts.guest.viewports = ['tablet'];
  raw.contexts.admin.setup[0].gotoo = '/x/';
  assert.throws(() => validateConfig(raw, 'bitrix'), (e) => e.code === 2
    && /неизвестный ключ contexts\.admin\.pages\[2\]\.fullpage/.test(e.message)
    && /pages\[4\]\.name: повтор «section-b»/.test(e.message)
    && /contexts\.guest\.pages\[0\]\.url/.test(e.message)
    && /contexts\.guest\.viewports/.test(e.message)
    && /неизвестный ключ contexts\.admin\.setup\[0\]\.gotoo/.test(e.message));
});

test('ключи с _ — комментарии; действие без глагола — ошибка', () => {
  assert.ok(validateConfig(minimal({ _comment: 'x' }), 'bitrix'));
  const raw = minimal();
  raw.contexts.guest.pages[0].actions = [{ optional: true }];
  assert.throws(() => validateConfig(raw, 'bitrix'), code2(/нет действия/));
});

test('опасный адрес страницы или goto без unsafe — код 2; с unsafe — можно', () => {
  const page = minimal();
  page.contexts.guest.pages.push({ name: 'cancel', url: '/personal/cancel/109/?CANCEL=Y' });
  assert.throws(() => validateConfig(page, 'bitrix'), code2(/cancel.*опасный адрес .*отмена заказа/));
  page.contexts.guest.pages[1].unsafe = true;
  assert.ok(validateConfig(page, 'bitrix'));
  const go = minimal();
  go.contexts.guest.setup = [{ goto: '/auth/?logout=yes' }];
  assert.throws(() => validateConfig(go, 'bitrix'), code2(/setup\[0\]\.goto: опасный адрес/));
  go.contexts.guest.setup[0].unsafe = true;
  assert.ok(validateConfig(go, 'bitrix'));
  const own = minimal({ danger: ['/my-action/'] });
  own.contexts.guest.pages.push({ name: 'act', url: '/my-action/1/' });
  assert.throws(() => validateConfig(own, 'bitrix'), code2(/опасно по pages\.json/));
  assert.throws(() => validateConfig(minimal({ danger: ['('] }), 'bitrix'), code2(/неверное регулярное выражение/));
});

test('loadConfig: нет файла или испорченный JSON — код 2', () => {
  const dir = makeProject();
  assert.equal(readConfigFile(dir), null);
  assert.throws(() => loadConfig(dir, 'bitrix'), code2(/сначала discover/));
  fs.mkdirSync(path.dirname(path.join(dir, CONFIG_REL)), { recursive: true });
  fs.writeFileSync(path.join(dir, CONFIG_REL), '{ "contexts": ');
  assert.throws(() => loadConfig(dir, 'bitrix'), code2(/pages\.json/));
  fs.writeFileSync(path.join(dir, CONFIG_REL), '﻿' + JSON.stringify(minimal()));
  assert.equal(loadConfig(dir, 'bitrix').contexts[0].pages[0].name, 'home');
});

test('selectGroups: все, --only (setup остаётся за группой), --ctx, --vp, ошибки фильтров', () => {
  const cfg = validateConfig(BETA, 'bitrix');
  const all = selectGroups(cfg);
  assert.equal(all.full, true);
  assert.deepEqual(all.groups.map((g) => `${g.ctx.name}/${g.vp}/${g.pages.length}`), ['guest/desktop/10', 'guest/mobile/10', 'admin/desktop/21', 'admin/mobile/20']);
  const only = selectGroups(cfg, { only: ['home', 'catalog-popup'] });
  assert.equal(only.full, false);
  assert.deepEqual(only.groups.map((g) => `${g.ctx.name}/${g.vp}/${g.pages.map((p) => p.name).join('+')}`),
    ['guest/desktop/home', 'guest/mobile/home', 'admin/desktop/home+catalog-popup', 'admin/mobile/home']);
  assert.equal(only.groups[2].ctx.setup.length, 12);
  assert.deepEqual(selectGroups(cfg, { ctx: 'admin', vp: 'mobile' }).groups.map((g) => g.ctx.name + '/' + g.vp), ['admin/mobile']);
  assert.deepEqual(selectGroups(cfg, { ctx: 'admin', vp: 'mobile' }).filters, { only: [], ctx: 'admin', vp: 'mobile' });
  assert.throws(() => selectGroups(cfg, { ctx: 'root' }), code2(/нет контекста root/));
  assert.throws(() => selectGroups(cfg, { vp: 'tablet' }), code2(/--vp/));
  assert.throws(() => selectGroups(cfg, { only: ['nope'] }), code2(/нет страниц nope/));
  assert.throws(() => selectGroups(cfg, { only: ['catalog-popup'], vp: 'mobile' }), code2(/нет страниц catalog-popup/));
});

test('siteBase и siteMode: адрес из параметров, --env дев, --url, ошибки', () => {
  const params = makeParams({ 'режим': 'bitrix', 'прод': 'https://beta.example.com/', 'дев': '—' });
  assert.equal(siteMode(params), 'bitrix');
  assert.equal(siteMode(makeParams(null)), null);
  assert.equal(siteBase(params), 'https://beta.example.com');
  assert.equal(siteBase(params, { url: 'https://dev.x.ru/' }), 'https://dev.x.ru');
  assert.throws(() => siteBase(params, { env: 'дев' }), code2(/«Дев»/));
  assert.throws(() => siteBase(params, { env: 'test' }), code2(/--env/));
  assert.throws(() => siteBase(makeParams(null)), code2(/«Прод»/));
  assert.throws(() => siteBase(params, { url: 'beta.example' }), code2(/http/));
});
```

- [ ] **Шаг 3: запустить — падает**

Run: `node --test tests/visual-config.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/lib/visual/config'`.

- [ ] **Шаг 4: `config.js`**

```js
'use strict';
// pages.json проекта: чтение, проверка, умолчания, выбор страниц; адрес сайта из параметров проекта.
const fs = require('fs');
const path = require('path');
const { VisualError, NAME_RE } = require('./args');
const { dangerReason } = require('./links');

const CONFIG_REL = '.claude/scripts/visual/pages.json';
const VIEWPORTS = ['desktop', 'mobile'];
const BITRIX_CHECK = "window.BX && BX.message && BX.message('USER_ID')";
const TOP_KEYS = ['login', 'hide', 'mask', 'danger', 'contexts'];
const LOGIN_KEYS = ['url', 'check'];
const CTX_KEYS = ['auth', 'viewports', 'setup', 'teardown', 'pages', 'hide', 'mask'];
const PAGE_KEYS = ['name', 'url', 'actions', 'viewports', 'fullPage', 'hide', 'mask', 'unsafe'];
const ACTION_VERBS = ['goto', 'click', 'clickAccept', 'clickText', 'hover', 'fill', 'eval', 'wait', 'waitFor'];
const ACTION_KEYS = [...ACTION_VERBS, 'nth', 'value', 'optional', 'unsafe'];
const STRING_VERBS = ['click', 'clickAccept', 'clickText', 'hover', 'fill', 'eval', 'waitFor'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Режим проекта из параметров: 'bitrix', 'общий' или null (не kit-проект).
function siteMode(params) {
  const m = params.get('Режим', null);
  return m ? m.toLowerCase() : null;
}

// Адрес сайта: --url, иначе «Прод» (с --env дев — «Дев»); без завершающего /.
function siteBase(params, { env, url } = {}) {
  if (env && env !== 'прод' && env !== 'дев') throw new VisualError(2, '--env: прод или дев');
  const key = env === 'дев' ? 'Дев' : 'Прод';
  const base = url || params.get(key, null);
  if (!base) throw new VisualError(2, `адрес сайта не задан: параметр «${key}» в .claude/CLAUDE.md или --url`);
  if (!/^https?:\/\/[^/]+/i.test(base)) throw new VisualError(2, `адрес сайта должен начинаться с http:// или https://: ${base}`);
  return base.replace(/\/+$/, '');
}

// Вход: url страницы входа и выражение JS, которое у вошедшего пользователя возвращает его ID.
// Проверка Битрикса — по умолчанию в режиме bitrix и вне kit-проекта; в общем режиме — только из pages.json.
function loginSettings(raw, mode) {
  const l = isObj(raw) ? raw : {};
  return { url: l.url || '/auth/', check: l.check || (mode === 'общий' ? null : BITRIX_CHECK) };
}

function validateConfig(raw, mode) {
  if (!isObj(raw)) throw new VisualError(2, 'pages.json: нужен объект');
  const errs = [];
  const keysOk = (obj, allowed, at) => {
    for (const k of Object.keys(obj)) {
      if (!k.startsWith('_') && !allowed.includes(k)) errs.push(`неизвестный ключ ${at ? at + '.' : ''}${k}`);
    }
  };
  const strList = (v, at) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
      errs.push(`${at}: нужен список строк`);
      return [];
    }
    return v;
  };
  const vpList = (v, at, def) => {
    if (v === undefined) return def;
    if (!Array.isArray(v) || !v.length || v.some((x) => !VIEWPORTS.includes(x))) {
      errs.push(`${at}: список из ${VIEWPORTS.join(', ')}`);
      return def;
    }
    return v;
  };
  const unsafeHint = '; уберите адрес или добавьте "unsafe": true (только с согласия пользователя)';
  const actionList = (v, at, danger) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errs.push(`${at}: нужен список действий`);
      return [];
    }
    v.forEach((a, i) => {
      const aat = `${at}[${i}]`;
      if (!isObj(a)) return errs.push(`${aat}: нужен объект`);
      keysOk(a, ACTION_KEYS, aat);
      if (!ACTION_VERBS.some((k) => a[k] !== undefined)) errs.push(`${aat}: нет действия (${ACTION_VERBS.join(', ')})`);
      if (a.goto !== undefined) {
        if (typeof a.goto !== 'string' || !a.goto.startsWith('/')) errs.push(`${aat}.goto: адрес от корня сайта, с / в начале`);
        else if (a.unsafe !== true) {
          const d = dangerReason(a.goto, danger);
          if (d) errs.push(`${aat}.goto: опасный адрес ${a.goto} — ${d}${unsafeHint}`);
        }
      }
      for (const k of STRING_VERBS) if (a[k] !== undefined && typeof a[k] !== 'string') errs.push(`${aat}.${k}: нужна строка`);
      if (a.wait !== undefined && !(Number.isFinite(a.wait) && a.wait >= 0)) errs.push(`${aat}.wait: число миллисекунд`);
      if (a.nth !== undefined && !(Number.isInteger(a.nth) && a.nth >= 0)) errs.push(`${aat}.nth: целое число ≥ 0`);
      if (a.value !== undefined && typeof a.value !== 'string' && typeof a.value !== 'number') errs.push(`${aat}.value: строка или число`);
      for (const k of ['optional', 'unsafe']) if (a[k] !== undefined && typeof a[k] !== 'boolean') errs.push(`${aat}.${k}: true или false`);
    });
    return v;
  };

  keysOk(raw, TOP_KEYS, '');
  if (raw.login !== undefined) {
    if (!isObj(raw.login)) errs.push('login: нужен объект');
    else {
      keysOk(raw.login, LOGIN_KEYS, 'login');
      for (const k of LOGIN_KEYS) if (raw.login[k] !== undefined && typeof raw.login[k] !== 'string') errs.push(`login.${k}: нужна строка`);
    }
  }
  const danger = [];
  for (const s of strList(raw.danger, 'danger')) {
    try {
      danger.push(new RegExp(s, 'i'));
    } catch (e) {
      errs.push(`danger: неверное регулярное выражение ${s}`);
    }
  }
  const cfg = {
    login: loginSettings(raw.login, mode),
    hide: strList(raw.hide, 'hide'),
    mask: strList(raw.mask, 'mask'),
    danger,
    contexts: [],
  };
  if (!isObj(raw.contexts) || !Object.keys(raw.contexts).length) errs.push('contexts: нужен хотя бы один контекст');
  else {
    for (const [name, c] of Object.entries(raw.contexts)) {
      const at = `contexts.${name}`;
      if (!NAME_RE.test(name)) errs.push(`${at}: имя — латиница, цифры, . _ -`);
      if (!isObj(c)) {
        errs.push(`${at}: нужен объект`);
        continue;
      }
      keysOk(c, CTX_KEYS, at);
      if (c.auth !== undefined && typeof c.auth !== 'boolean') errs.push(`${at}.auth: true или false`);
      const ctx = {
        name,
        auth: c.auth === true,
        viewports: vpList(c.viewports, at + '.viewports', VIEWPORTS),
        hide: strList(c.hide, at + '.hide'),
        mask: strList(c.mask, at + '.mask'),
        setup: actionList(c.setup, at + '.setup', danger),
        teardown: actionList(c.teardown, at + '.teardown', danger),
        pages: [],
      };
      if (!Array.isArray(c.pages) || !c.pages.length) errs.push(`${at}.pages: нужен непустой список страниц`);
      else {
        c.pages.forEach((pg, i) => {
          const pat = `${at}.pages[${i}]`;
          if (!isObj(pg)) return errs.push(`${pat}: нужен объект`);
          keysOk(pg, PAGE_KEYS, pat);
          const nm = typeof pg.name === 'string' ? pg.name : '';
          if (!NAME_RE.test(nm)) errs.push(`${pat}.name: латиница, цифры, . _ -, первый символ — буква или цифра`);
          else if (ctx.pages.some((x) => x.name === nm)) errs.push(`${pat}.name: повтор «${nm}» в контексте ${name}`);
          if (typeof pg.url !== 'string' || !pg.url.startsWith('/')) errs.push(`${pat}.url: адрес от корня сайта, с / в начале`);
          else if (pg.unsafe !== true) {
            const d = dangerReason(pg.url, danger);
            if (d) errs.push(`${pat} (${nm}): опасный адрес ${pg.url} — ${d}${unsafeHint}`);
          }
          for (const k of ['fullPage', 'unsafe']) if (pg[k] !== undefined && typeof pg[k] !== 'boolean') errs.push(`${pat}.${k}: true или false`);
          ctx.pages.push({
            name: nm,
            url: pg.url,
            actions: actionList(pg.actions, pat + '.actions', danger),
            viewports: pg.viewports === undefined ? null : vpList(pg.viewports, pat + '.viewports', null),
            fullPage: pg.fullPage !== false,
            hide: strList(pg.hide, pat + '.hide'),
            mask: strList(pg.mask, pat + '.mask'),
          });
        });
      }
      cfg.contexts.push(ctx);
    }
  }
  if (cfg.contexts.some((c) => c.auth) && !cfg.login.check) {
    errs.push('контекст с "auth": true — в общем режиме нужен login.check (выражение JS, которое у вошедшего пользователя возвращает его ID)');
  }
  if (errs.length) throw new VisualError(2, `${CONFIG_REL}:\n  ` + errs.join('\n  '));
  return cfg;
}

// Сырое содержимое pages.json или null, если файла нет.
function readConfigFile(root) {
  const file = path.join(root, CONFIG_REL);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new VisualError(2, `${CONFIG_REL}: ${e.message}`);
  }
}

function loadConfig(root, mode) {
  const raw = readConfigFile(root);
  if (raw === null) throw new VisualError(2, `нет ${CONFIG_REL} — сначала discover и список страниц (/kit:visual)`);
  return validateConfig(raw, mode);
}

// Что снимать: группы «контекст × ширина» со своими страницами.
function selectGroups(cfg, { only = [], ctx, vp } = {}) {
  if (ctx && !cfg.contexts.some((c) => c.name === ctx)) {
    throw new VisualError(2, `нет контекста ${ctx} (есть: ${cfg.contexts.map((c) => c.name).join(', ')})`);
  }
  if (vp && !VIEWPORTS.includes(vp)) throw new VisualError(2, `--vp: ${VIEWPORTS.join(' или ')}`);
  const groups = [];
  const seen = new Set();
  for (const c of cfg.contexts) {
    if (ctx && c.name !== ctx) continue;
    for (const v of c.viewports) {
      if (vp && v !== vp) continue;
      const pages = c.pages.filter((p) => (!only.length || only.includes(p.name)) && (!p.viewports || p.viewports.includes(v)));
      pages.forEach((p) => seen.add(p.name));
      if (pages.length) groups.push({ ctx: c, vp: v, pages });
    }
  }
  const unknown = only.filter((n) => !seen.has(n));
  if (unknown.length) throw new VisualError(2, `--only: нет страниц ${unknown.join(', ')} в выбранных контекстах и ширинах`);
  if (!groups.length) throw new VisualError(2, 'нечего снимать: фильтры не оставили ни одной страницы');
  return { groups, full: !only.length && !ctx && !vp, filters: { only, ctx: ctx || null, vp: vp || null } };
}

module.exports = {
  CONFIG_REL, VIEWPORTS, BITRIX_CHECK, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups,
};
```

- [ ] **Шаг 5: запустить — проходит**

Run: `node --test tests/visual-config.test.js` → 8/8; `npm test` — зелёное.

- [ ] **Шаг 6: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.4`.

### Задача 10.5: `diff.js` и `report.js` — сравнение без картинок, отчёт

**Files:**
- Create: `plugins/kit/scripts/lib/visual/diff.js`
- Create: `plugins/kit/scripts/lib/visual/report.js`
- Test: `tests/visual-diff-report.test.js`

**Interfaces:**
- Consumes: ничего из новых модулей.
- Produces (для 10.8):
  - `diff.js`: `PIXEL_MARGIN = 0.1`; `pageKey(rec) → 'ctx/vp/name'`; `textLines`, `textDiff(a, b) → { removed, added }` (как в прототипе); `applyTextNoise(td, noise) → { removed, added, noiseRemoved, noiseAdded }` (шум — с точностью до чисел); `metaChanges(a, b, noise) → [{ kind: 'status'|'final'|'uid'|'js'|'net', key?, text, noise }]`; `setupChanges(metaA, metaB) → string[]`; `verdictOf({ pct, text, changes, noise }) → 'same'|'noise'|'diff'`; `presence({ hasA, hasB, a, b, fullB }) → 'missing'|'skipped'|'new'|'nobefore'|null`; `metaIndex(meta) → Map`; `isFull(meta)`; `mergeMeta(old, run)` (run: `{ base, env, date, full, filters, groups: ['ctx/vp'], setup, pages }`); `noiseFromRows(rows)`; `mergeNoise(old, snapshots, check, date)`.
  - `report.js`: `VERDICTS`; `esc(s)`; `buildSummary({ before, after, base, dateBefore, dateAfter, rows, setup, noiseHint, date }) → summary` (`counts`, `problems`, отсортированные `rows`); `consoleLines(summary) → string[]`; `buildHtml(summary) → string`.
  - Строка сравнения (`rows[i]`): `{ key, verdict, pct?, size?, text?, changes?, noise?: { pct }, reason? }`.

- [ ] **Шаг 1: тест**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence, metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
} = require('../plugins/kit/scripts/lib/visual/diff');
const { buildSummary, consoleLines, buildHtml } = require('../plugins/kit/scripts/lib/visual/report');

// textDiff прототипа beta (.claude/scripts/visual/visual.mjs, коммит 0.3) — дословно.
function prototypeTextDiff(a, b) {
  const A = a.split('\n').map((s) => s.trim()).filter(Boolean);
  const B = b.split('\n').map((s) => s.trim()).filter(Boolean);
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
  const ca = count(A), cb = count(B);
  const removed = [...ca].filter(([s, n]) => (cb.get(s) || 0) < n).map(([s]) => s);
  const added = [...cb].filter(([s, n]) => (ca.get(s) || 0) < n).map(([s]) => s);
  return { removed, added };
}

const page = (over = {}) => ({ ctx: 'admin', vp: 'desktop', name: 'order', url: '/order/', status: 200, final: '/order/', uid: '1', errors: [], bad: [], failed: [], ...over });

test('textDiff совпадает с прототипом, в том числе с повторами строк и \\r\\n', () => {
  const cases = [
    ['a\nb\nc', 'a\nc\nd'],
    ['  Корзина (3)  \n\nИтого', 'Корзина (0)\nИтого\nИтого'],
    ['x\nx\ny', 'x\ny\ny'],
    ['', 'новое'],
    ['строка\r\nещё', 'строка\nещё'],
  ];
  for (const [a, b] of cases) assert.deepEqual(textDiff(a, b), prototypeTextDiff(a, b), JSON.stringify([a, b]));
  assert.deepEqual(textDiff('Корзина (3)\nИтого', 'Корзина (0)\nИтого'), { removed: ['Корзина (3)'], added: ['Корзина (0)'] });
});

test('applyTextNoise: строки шума (с точностью до чисел) уходят в отдельные списки', () => {
  const td = { removed: ['Найдено: 12', 'Цена 100'], added: ['Найдено: 13', 'Цена 120'] };
  assert.deepEqual(applyTextNoise(td, { removed: ['Найдено: 13'], added: ['Найдено: 12'] }),
    { removed: ['Цена 100'], added: ['Цена 120'], noiseRemoved: ['Найдено: 12'], noiseAdded: ['Найдено: 13'] });
  assert.deepEqual(applyTextNoise(td, null), { ...td, noiseRemoved: [], noiseAdded: [] });
  const timer = applyTextNoise({ removed: ['1790338514967'], added: ['1790338600000', 'Новая строка'] }, { removed: ['1790338514967'], added: ['1790338537147'] });
  assert.deepEqual(timer, { removed: [], added: ['Новая строка'], noiseRemoved: ['1790338514967'], noiseAdded: ['1790338600000'] }, 'таймер с третьим значением — тоже шум');
  assert.deepEqual(applyTextNoise({ removed: ['Цена 100'], added: ['Цена 120'] }, { removed: ['Найдено 12'], added: [] }).removed, ['Цена 100'], 'другая строка с числом — не шум');
});

test('metaChanges: статус, адрес, USER_ID, JS и сеть (ключ без query), шум помечен', () => {
  const a = page({ errors: ['old err', 'flaky 1'], bad: [{ status: 404, url: '/img/a.png?v=1', type: 'image' }] });
  const b = page({ status: 500, final: '/order/?x=1', uid: '', errors: ['old err', 'flaky 2', 'new err'],
    bad: [{ status: 404, url: '/img/a.png?v=2', type: 'image' }, { status: 500, url: '/order/ajax.php?t=1', type: 'xhr' }],
    failed: [{ url: 'https://mc.yandex.ru/watch', error: 'net::ERR_ABORTED', type: 'script' }] });
  const ch = metaChanges(a, b, { errors: ['flaky 1', 'flaky 2'], net: [] });
  assert.deepEqual(ch.map((c) => [c.kind, c.text, c.noise]), [
    ['status', 'статус 200 → 500', false],
    ['final', 'адрес /order/ → /order/?x=1', false],
    ['uid', 'USER_ID 1 → (пусто)', false],
    ['js', 'JS: + flaky 2', true],
    ['js', 'JS: + new err', false],
    ['js', 'JS: − flaky 1', true],
    ['net', 'ответ: + 500 /order/ajax.php', false],
    ['net', 'запрос: + net::ERR_ABORTED https://mc.yandex.ru/watch', false],
  ]);
  const proto = { ...page(), bad: undefined, failed: undefined };
  assert.deepEqual(metaChanges(proto, b, null).filter((c) => c.kind === 'net'), [], 'у метки прототипа сети нет — не сравниваем');
  assert.deepEqual(metaChanges(null, b), []);
});

test('setupChanges: только новые или изменившиеся ошибки setup', () => {
  assert.deepEqual(setupChanges({ setup: { 'admin/desktop': 'x' } }, { setup: { 'admin/desktop': 'x', 'admin/mobile': 'Timeout' } }), ['setup admin/mobile: Timeout']);
  assert.deepEqual(setupChanges({}, {}), []);
});

test('verdictOf: совпадает, в пределах шума, отличается', () => {
  const r = (o) => ({ pct: 0, text: { removed: [], added: [] }, changes: [], noise: null, ...o });
  assert.equal(verdictOf(r()), 'same');
  assert.equal(verdictOf(r({ text: null })), 'same');
  assert.equal(verdictOf(r({ pct: 0.01 })), 'diff', 'без шума любое отличие — отличается');
  assert.equal(verdictOf(r({ pct: 0.9, noise: { pct: 0.5 } })), 'noise');
  assert.equal(verdictOf(r({ pct: 1.2, noise: { pct: 0.5 } })), 'diff');
  assert.equal(verdictOf(r({ pct: 0.05, noise: { pct: 0 } })), 'noise', 'текстовый шум даёт запас 0,1%');
  assert.equal(verdictOf(r({ pct: 0.2, noise: { pct: 0.5 }, text: { removed: ['Цена 100'], added: [] } })), 'diff');
  assert.equal(verdictOf(r({ changes: [{ noise: false }] })), 'diff', 'отличие meta — всегда отличается');
  assert.equal(verdictOf(r({ changes: [{ noise: true }] })), 'same');
});

test('presence: не снято, не снимали, новый, нет «до»', () => {
  assert.equal(presence({ hasA: true, hasB: true }), null);
  assert.equal(presence({ hasA: true, hasB: false, fullB: true }), 'missing');
  assert.equal(presence({ hasA: true, hasB: false, fullB: false }), 'skipped');
  assert.equal(presence({ hasA: true, hasB: false, fullB: false, b: { fail: 'Timeout' } }), 'missing');
  assert.equal(presence({ hasA: false, hasB: true }), 'new');
  assert.equal(presence({ hasA: false, hasB: true, a: { fail: 'x' } }), 'nobefore');
  assert.equal(presence({ hasA: false, hasB: false, b: { fail: 'x' } }), 'missing');
  assert.equal(presence({ hasA: false, hasB: false }), null);
});

test('mergeMeta: частичный прогон заменяет только свои страницы и ошибки setup своих групп', () => {
  const old = { base: 'https://x.ru', full: true, runs: [{ date: 'd1', filters: {} }], setup: { 'admin/desktop': 'old', 'admin/mobile': 'keep' },
    pages: [page({ name: 'home' }), page({ name: 'order', status: 500 })] };
  const m = mergeMeta(old, { base: 'https://x.ru', env: 'прод', date: 'd2', full: false, filters: { only: ['order'] },
    groups: ['admin/desktop'], setup: {}, pages: [page({ name: 'order', status: 200 })] });
  assert.equal(m.full, true);
  assert.deepEqual(m.pages.map((p) => `${p.name}:${p.status}`), ['home:200', 'order:200']);
  assert.deepEqual(m.setup, { 'admin/mobile': 'keep' });
  assert.equal(m.runs.length, 2);
  const fresh = mergeMeta(null, { base: 'b', env: 'прод', date: 'd', full: false, filters: {}, groups: [], setup: {}, pages: [] });
  assert.equal(fresh.full, false);
  assert.equal(isFull({ pages: [] }), true, 'метка прототипа — полная');
  assert.equal(metaIndex(m).get('admin/desktop/home').name, 'home');
});

test('noiseFromRows и mergeNoise: шум копится по контрольным прогонам', () => {
  const rows = [
    { key: 'admin/mobile/search', verdict: 'diff', pct: 0.5, text: { removed: ['Найдено 12'], added: ['Найдено 13'] }, changes: [{ kind: 'js', key: 'e1' }] },
    { key: 'guest/desktop/home', verdict: 'same', pct: 0, text: { removed: [], added: [] }, changes: [] },
    { key: 'guest/desktop/x', verdict: 'missing', changes: [] },
  ];
  const s1 = noiseFromRows(rows);
  assert.deepEqual(Object.keys(s1), ['admin/mobile/search']);
  const n1 = mergeNoise(null, s1, 'before-check', 'd1');
  const n2 = mergeNoise(n1, { 'admin/mobile/search': { pct: 0.3, removed: ['Найдено 13'], added: ['Найдено 11'], errors: [], net: ['500 /x'] } }, 'before-check', 'd2');
  assert.equal(n2.runs, 2);
  assert.deepEqual(n2.checks, ['before-check', 'before-check']);
  assert.deepEqual(n2.snapshots['admin/mobile/search'], { pct: 0.5, removed: ['Найдено 12', 'Найдено 13'], added: ['Найдено 13', 'Найдено 11'], errors: ['e1'], net: ['500 /x'] });
});

const ROWS = [
  { key: 'guest/desktop/home', verdict: 'same', pct: 0, size: '1920×3000 → 1920×3000', text: { removed: [], added: [] }, changes: [] },
  { key: 'admin/desktop/order', verdict: 'diff', pct: 2.345, size: '1920×2000 → 1920×2100', text: { removed: ['<b>Итого</b>'], added: ['Итого & скидка'], noiseRemoved: ['Найдено 12'], noiseAdded: [] },
    changes: [{ kind: 'status', text: 'статус 200 → 500', noise: false }, { kind: 'js', key: 'x', text: 'JS: + flaky', noise: true }] },
  { key: 'admin/mobile/search', verdict: 'noise', pct: 0.4, noise: { pct: 0.5 }, text: { removed: [], added: [] }, changes: [] },
  { key: 'admin/mobile/order', verdict: 'missing', reason: 'Timeout 90000ms' },
];

test('buildSummary и consoleLines: порядок, счётчики, статусы первыми, подсказка про check', () => {
  const s = buildSummary({ before: 'before', after: 'after-1.1', base: 'https://x.ru', rows: ROWS, setup: ['setup admin/mobile: Timeout'], noiseHint: true, date: 'd' });
  assert.deepEqual(s.rows.map((r) => r.verdict), ['diff', 'missing', 'noise', 'same']);
  assert.equal(s.counts.diff, 1);
  assert.equal(s.problems, 3);
  const out = consoleLines(s).join('\n');
  assert.ok(out.indexOf('Статусы и ошибки:') < out.indexOf('Отличается:'));
  assert.match(out, /admin\/desktop\/order {2}статус 200 → 500\n/, 'шумная JS-ошибка в консоль не идёт');
  assert.match(out, /2\.345% {2}admin\/desktop\/order {2}текст −1\/\+1/);
  assert.match(out, /Не снято:\n {2}admin\/mobile\/order {2}Timeout 90000ms/);
  assert.match(out, /\(шум 0\.5%\) {2}admin\/mobile\/search/);
  assert.match(out, /Итого: совпадает 1, в пределах шума 1, отличается 1, не снято 1 \(из 4\)/);
  assert.match(out, /node visual\.js check before/);
  assert.doesNotMatch(consoleLines({ ...s, noiseHint: false }).join('\n'), /check before/);
});

test('buildHtml: всё экранировано, картинки относительно папки сравнения, шум серым', () => {
  const html = buildHtml(buildSummary({ before: 'before', after: 'after-1.1', base: 'https://x.ru', rows: ROWS, setup: [] }));
  assert.ok(html.includes('&lt;b&gt;Итого&lt;/b&gt;'));
  assert.ok(html.includes('Итого &amp; скидка'));
  assert.ok(!html.includes('<b>Итого</b>'));
  assert.ok(html.includes('src="../before/admin/desktop/order.png"'));
  assert.ok(html.includes('src="../after-1.1/admin/desktop/order.png"'));
  assert.ok(html.includes('src="admin/desktop/order.png"'));
  assert.ok(html.includes('<li class="nz">Найдено 12</li>'));
  assert.ok(html.includes('<span class="nz">JS: + flaky</span>'));
  assert.match(html, /<details id="admin\/desktop\/order" open>/);
  assert.ok(!html.includes('<details id="guest/desktop/home"'), 'у совпавших подробностей нет');
});
```

- [ ] **Шаг 2: запустить — падает**

Run: `node --test tests/visual-diff-report.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/lib/visual/diff'`.

- [ ] **Шаг 3: `diff.js`**

```js
'use strict';
// Сравнение прогонов без картинок: дифф текста, шум контрольного прогона, статусы и ошибки из meta.json, вердикт.
// Здесь же — ведение meta.json (дописывание частичного прогона) и noise.json (шум по контрольным прогонам).

// Доля пикселей сверх двойного шума, которая ещё считается шумом (в процентах).
const PIXEL_MARGIN = 0.1;

const pageKey = (r) => `${r.ctx}/${r.vp}/${r.name}`;
const stripQuery = (u) => String(u).split('?')[0];

function textLines(s) {
  return String(s).split('\n').map((x) => x.trim()).filter(Boolean);
}

// Как в прототипе: пропало / появилось с учётом числа повторов строки.
function textDiff(a, b) {
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) || 0) + 1), new Map());
  const ca = count(textLines(a));
  const cb = count(textLines(b));
  const removed = [...ca].filter(([s, n]) => (cb.get(s) || 0) < n).map(([s]) => s);
  const added = [...cb].filter(([s, n]) => (ca.get(s) || 0) < n).map(([s]) => s);
  return { removed, added };
}

// Строка с точностью до чисел: «Найдено 12» и «Найдено 13», таймер 1790338514967 и 1790338537147 — одно и то же.
const numless = (l) => l.replace(/\d+/g, '#');

// Строки, разошедшиеся в контрольном прогоне (в любую сторону), — шум с точностью до чисел:
// уходят в noiseRemoved/noiseAdded и на вердикт не влияют.
function applyTextNoise(td, noise) {
  const nz = new Set([...((noise && noise.removed) || []), ...((noise && noise.added) || [])].map(numless));
  const isNoise = (l) => nz.has(numless(l));
  return {
    removed: td.removed.filter((l) => !isNoise(l)),
    added: td.added.filter((l) => !isNoise(l)),
    noiseRemoved: td.removed.filter(isNoise),
    noiseAdded: td.added.filter(isNoise),
  };
}

// Отличия meta страницы: [{ kind: status|final|uid|js|net, key?, text, noise }].
// Сеть сравнивается, только если записана в обоих прогонах (у меток прототипа её нет).
function metaChanges(a, b, noise) {
  const out = [];
  if (!a || !b) return out;
  const nErr = new Set((noise && noise.errors) || []);
  const nNet = new Set((noise && noise.net) || []);
  if (a.status !== b.status) out.push({ kind: 'status', text: `статус ${a.status} → ${b.status}`, noise: false });
  if (a.final !== b.final) out.push({ kind: 'final', text: `адрес ${a.final} → ${b.final}`, noise: false });
  if ((a.uid || '') !== (b.uid || '')) out.push({ kind: 'uid', text: `USER_ID ${a.uid || '(пусто)'} → ${b.uid || '(пусто)'}`, noise: false });
  const sets = (xs, ys, key, kind, label, nz) => {
    const ka = new Set((xs || []).map(key));
    const kb = new Set((ys || []).map(key));
    for (const k of kb) if (!ka.has(k)) out.push({ kind, key: k, text: `${label}: + ${k}`, noise: nz.has(k) });
    for (const k of ka) if (!kb.has(k)) out.push({ kind, key: k, text: `${label}: − ${k}`, noise: nz.has(k) });
  };
  sets(a.errors, b.errors, (x) => String(x), 'js', 'JS', nErr);
  if (Array.isArray(a.bad) && Array.isArray(b.bad)) sets(a.bad, b.bad, (r) => `${r.status} ${stripQuery(r.url)}`, 'net', 'ответ', nNet);
  if (Array.isArray(a.failed) && Array.isArray(b.failed)) sets(a.failed, b.failed, (r) => `${r.error} ${stripQuery(r.url)}`, 'net', 'запрос', nNet);
  return out;
}

// Ошибки setup, которых не было «до»: ['setup admin/desktop: …'].
function setupChanges(ma, mb) {
  const a = (ma && ma.setup) || {};
  const b = (mb && mb.setup) || {};
  return Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `setup ${k}: ${b[k]}`);
}

// Вердикт сравнённого снимка: same | noise | diff.
// row: { pct, text: { removed, added } | null, changes, noise: { pct } | null }.
function verdictOf(row) {
  const textChanged = !!(row.text && (row.text.removed.length || row.text.added.length));
  if (row.changes.some((c) => !c.noise)) return 'diff';
  if (row.pct === 0 && !textChanged) return 'same';
  if (row.noise && !textChanged && row.pct <= 2 * row.noise.pct + PIXEL_MARGIN) return 'noise';
  return 'diff';
}

// Снимок, которого нет в одном из прогонов: missing | skipped | new | nobefore | null (есть в обоих).
function presence({ hasA, hasB, a, b, fullB }) {
  if (hasA && hasB) return null;
  if (hasA) return (b && b.fail) || fullB ? 'missing' : 'skipped';
  if (hasB) return a && a.fail ? 'nobefore' : 'new';
  return b && b.fail ? 'missing' : null;
}

function metaIndex(meta) {
  return new Map(((meta && meta.pages) || []).map((r) => [pageKey(r), r]));
}

// Полный ли прогон; у меток прототипа поля full нет — они полные (частичные писали meta-<имя>.json).
function isFull(meta) {
  return !meta || meta.full !== false;
}

// Дописать прогон в meta.json метки: снятые страницы заменяются, остальные остаются.
// run: { base, env, date, full, filters, groups: ['ctx/vp'], setup: { 'ctx/vp': ошибка }, pages }.
function mergeMeta(old, run) {
  const fresh = new Set(run.pages.map(pageKey));
  const pages = [...((old && old.pages) || []).filter((r) => !fresh.has(pageKey(r))), ...run.pages];
  const setup = { ...((old && old.setup) || {}) };
  for (const g of run.groups) delete setup[g];
  Object.assign(setup, run.setup);
  return {
    base: run.base,
    env: run.env,
    date: run.date,
    full: !!run.full || (!!old && isFull(old)),
    runs: [...((old && old.runs) || []), { date: run.date, filters: run.filters }],
    setup,
    pages,
  };
}

// Шум из сравнения «метка ↔ метка-check» (без учёта прежнего шума).
function noiseFromRows(rows) {
  const snapshots = {};
  for (const r of rows) {
    if (!['same', 'noise', 'diff'].includes(r.verdict)) continue;
    const errors = r.changes.filter((c) => c.kind === 'js').map((c) => c.key);
    const net = r.changes.filter((c) => c.kind === 'net').map((c) => c.key);
    const removed = r.text ? r.text.removed : [];
    const added = r.text ? r.text.added : [];
    if (r.pct > 0 || removed.length || added.length || errors.length || net.length) {
      snapshots[r.key] = { pct: r.pct, removed, added, errors, net };
    }
  }
  return snapshots;
}

// Дополнить noise.json новым контрольным прогоном: % — максимум, строки и ошибки — объединение.
function mergeNoise(old, snapshots, check, date) {
  const uni = (a = [], b = []) => [...new Set([...a, ...b])];
  const out = {
    runs: ((old && old.runs) || 0) + 1,
    date,
    checks: [...((old && old.checks) || []), check],
    snapshots: { ...((old && old.snapshots) || {}) },
  };
  for (const [k, s] of Object.entries(snapshots)) {
    const o = out.snapshots[k];
    out.snapshots[k] = !o ? s : {
      pct: Math.max(o.pct || 0, s.pct || 0),
      removed: uni(o.removed, s.removed),
      added: uni(o.added, s.added),
      errors: uni(o.errors, s.errors),
      net: uni(o.net, s.net),
    };
  }
  return out;
}

module.exports = {
  PIXEL_MARGIN, pageKey, textLines, textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence,
  metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
};
```

- [ ] **Шаг 4: `report.js`**

```js
'use strict';
// Итог сравнения: summary.json (для Claude), report.html (для человека), строки для консоли.

const VERDICTS = {
  diff: 'отличается',
  missing: 'не снято',
  noise: 'в пределах шума',
  new: 'новый',
  nobefore: 'нет «до»',
  skipped: 'не снимали',
  same: 'совпадает',
};
const ORDER = Object.keys(VERDICTS);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const realChanges = (r) => (r.changes || []).filter((c) => !c.noise);
const textStat = (r) => (r.text && (r.text.removed.length || r.text.added.length) ? `  текст −${r.text.removed.length}/+${r.text.added.length}` : '');

// rows: [{ key, verdict, pct?, size?, text?, changes?, noise?, reason? }]; setup: ['setup ctx/vp: …'].
function buildSummary({ before, after, base, dateBefore, dateAfter, rows, setup = [], noiseHint = false, date = new Date().toISOString() }) {
  const counts = Object.fromEntries(ORDER.map((v) => [v, 0]));
  for (const r of rows) counts[r.verdict]++;
  const sorted = [...rows].sort((x, y) => ORDER.indexOf(x.verdict) - ORDER.indexOf(y.verdict)
    || (y.pct || 0) - (x.pct || 0) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return {
    before, after, base, dateBefore, dateAfter, date, noiseHint, counts, setup,
    problems: counts.diff + counts.missing + setup.length,
    rows: sorted,
  };
}

function consoleLines(s) {
  const lines = [`Сравнение ${s.before} → ${s.after}${s.base ? ` (${s.base})` : ''}`];
  const meta = s.rows.filter((r) => realChanges(r).length);
  if (meta.length || s.setup.length) {
    lines.push('Статусы и ошибки:');
    for (const t of s.setup) lines.push('  ' + t);
    for (const r of meta) lines.push(`  ${r.key}  ${realChanges(r).map((c) => c.text).join('; ')}`);
  }
  const pick = (v) => s.rows.filter((r) => r.verdict === v);
  if (pick('diff').length) {
    lines.push('Отличается:');
    for (const r of pick('diff')) lines.push(`  ${String(r.pct === undefined ? '' : r.pct).padStart(7)}%  ${r.key}${textStat(r)}`);
  }
  if (pick('missing').length) {
    lines.push('Не снято:');
    for (const r of pick('missing')) lines.push(`  ${r.key}${r.reason ? '  ' + r.reason : ''}`);
  }
  if (pick('noise').length) {
    lines.push('В пределах шума:');
    for (const r of pick('noise')) lines.push(`  ${String(r.pct).padStart(7)}%  (шум ${r.noise.pct}%)  ${r.key}`);
  }
  const c = s.counts;
  const extra = [['new', 'новых'], ['nobefore', 'нет «до»'], ['skipped', 'не снимали']].filter(([k]) => c[k]).map(([k, t]) => `, ${t} ${c[k]}`).join('');
  lines.push(`Итого: совпадает ${c.same}, в пределах шума ${c.noise}, отличается ${c.diff}, не снято ${c.missing}${extra} (из ${s.rows.length})`);
  if (s.noiseHint) lines.push(`Шум не измерен: node visual.js check ${s.before}`);
  return lines;
}

// Картинки — относительно папки сравнения docs/visual/compare-<до>-vs-<после>/.
function buildHtml(s) {
  const img = (label, key) => `../${encodeURI(label)}/${encodeURI(key)}.png`;
  const fig = (src, cap) => `<figure><figcaption>${cap}</figcaption><img loading="lazy" src="${esc(src)}" alt="${cap}"></figure>`;
  const li = (arr, cls) => arr.map((l) => `<li${cls ? ` class="${cls}"` : ''}>${esc(l)}</li>`).join('');
  const detail = (r) => {
    const ch = r.changes && r.changes.length ? `<ul>${r.changes.map((c) => `<li${c.noise ? ' class="nz"' : ''}>${esc(c.text)}</li>`).join('')}</ul>` : '';
    const t = r.text && (r.text.removed.length || r.text.added.length || (r.text.noiseRemoved || []).length || (r.text.noiseAdded || []).length)
      ? `<p><b>Пропало:</b></p><ul>${li(r.text.removed)}${li(r.text.noiseRemoved || [], 'nz')}</ul><p><b>Появилось:</b></p><ul>${li(r.text.added)}${li(r.text.noiseAdded || [], 'nz')}</ul>`
      : '';
    let imgs = '';
    if (['diff', 'noise'].includes(r.verdict)) imgs = fig(img(s.before, r.key), 'до') + fig(img(s.after, r.key), 'после') + fig(`${encodeURI(r.key)}.png`, 'дифф');
    else if (r.verdict === 'missing') imgs = fig(img(s.before, r.key), 'до');
    else if (['new', 'nobefore'].includes(r.verdict)) imgs = fig(img(s.after, r.key), 'после');
    const head = `${esc(r.key)} — ${VERDICTS[r.verdict]}${r.pct !== undefined ? `, ${r.pct}%` : ''}${r.reason ? ` — ${esc(r.reason)}` : ''}`;
    return `<details id="${esc(r.key)}"${r.verdict === 'diff' ? ' open' : ''}><summary>${head}</summary>${ch}${t}<div class="imgs">${imgs}</div></details>`;
  };
  const withDetail = (r) => ['diff', 'noise', 'missing', 'new', 'nobefore'].includes(r.verdict);
  const metaRows = s.rows.filter((r) => r.changes && r.changes.length);
  const c = s.counts;
  return `<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>Сравнение ${esc(s.before)} → ${esc(s.after)}</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top;text-align:left}
tr.diff,tr.missing{background:#fee}tr.noise{background:#ffd}.nz{color:#999}.imgs{display:flex;gap:8px}figure{margin:0}.imgs img{width:32vw;border:1px solid #999}details{margin:6px 0}</style>
<h1>Сравнение «${esc(s.before)}» → «${esc(s.after)}»</h1>
<p>${esc(s.base || '')} · до: ${esc(s.dateBefore || '—')} · после: ${esc(s.dateAfter || '—')}</p>
<p>Итого: совпадает ${c.same}, в пределах шума ${c.noise}, отличается ${c.diff}, не снято ${c.missing}, новых ${c.new}, нет «до» ${c.nobefore}, не снимали ${c.skipped}.</p>
${s.noiseHint ? `<p>Шум не измерен: <code>node visual.js check ${esc(s.before)}</code></p>` : ''}
<h2>Статусы и ошибки</h2>
${metaRows.length || s.setup.length ? `<table><tr><th>Снимок</th><th>Что изменилось</th></tr>
${s.setup.map((t) => `<tr class="diff"><td>setup</td><td>${esc(t)}</td></tr>`).join('\n')}
${metaRows.map((r) => `<tr><td><a href="#${esc(r.key)}">${esc(r.key)}</a></td><td>${r.changes.map((ch) => `<span${ch.noise ? ' class="nz"' : ''}>${esc(ch.text)}</span>`).join('<br>')}</td></tr>`).join('\n')}
</table>` : '<p>Без изменений.</p>'}
<h2>Снимки</h2>
<table><tr><th>Снимок</th><th>Вердикт</th><th>% пикселей (шум)</th><th>Размер</th><th>Текст: пропало / появилось</th></tr>
${s.rows.map((r) => `<tr class="${r.verdict}"><td>${withDetail(r) ? `<a href="#${esc(r.key)}">${esc(r.key)}</a>` : esc(r.key)}</td><td>${VERDICTS[r.verdict]}</td><td>${r.pct === undefined ? '' : r.pct + (r.noise ? ` (${r.noise.pct})` : '')}</td><td>${esc(r.size || '')}</td><td>${r.text ? `${r.text.removed.length} / ${r.text.added.length}` : ''}</td></tr>`).join('\n')}
</table>
${s.rows.filter(withDetail).map(detail).join('\n')}
</html>
`;
}

module.exports = { VERDICTS, esc, buildSummary, consoleLines, buildHtml };
```

- [ ] **Шаг 5: запустить — проходит**

Run: `node --test tests/visual-diff-report.test.js` → 10/10; `npm test` — зелёное.

- [ ] **Шаг 6: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.5`.

### Задача 10.6: `image.js`, `home.js`, закреплённые зависимости

**Files:**
- Create: `plugins/kit/scripts/lib/visual/image.js`
- Create: `plugins/kit/scripts/lib/visual/home.js`
- Create: `plugins/kit/scripts/visual-deps/package.json`
- Modify: `package.json` (корень) — devDependencies; Create: `package-lock.json` (корень, создаёт `npm install`)
- Test: `tests/visual-image-home.test.js`

**Interfaces:**
- Consumes: `args.js` — `VisualError`.
- Produces (для 10.8):
  - `image.js`: `padTo(PNG, img, w, h)`; `diffPng(bufA, bufB, { PNG, pixelmatch }) → { pct, size, changed, diff: Buffer }`.
  - `home.js`: `MANIFEST`, `IMAGE_DEPS = ['pixelmatch', 'pngjs']`; `homeDir(env)`; `depsDir(env)` (`KIT_VISUAL_DEPS` или `<дом>/deps`); `pinned() → { имя: версия }`; `missingDeps(dir, names?) → [{ name, want, have }]`; `requireDeps(dir, names?)` (код 5); `loadImageLibs(dir) → Promise<{ PNG, pixelmatch }>`; `loadPlaywright(dir) → модуль playwright-core`; `installDeps(env) → папка`; `authFile(root, base, env) → путь`.

- [ ] **Шаг 1 (контроллер): согласие и зависимости корня**

AskUserQuestion: «Для тестов сравнения снимков поставить в корне репозитория devDependencies `pixelmatch` 7.2.0 и `pngjs` 7.0.0 (~0,7 МБ, `npm install`; `node_modules/` в `.gitignore`, в коммит войдут `package.json` и `package-lock.json`)?» После «да» — правка корневого `package.json`:

```diff
--- a/package.json
+++ b/package.json
@@ -4,5 +4,9 @@
   "description": "Маркетплейс claude-kit с плагином kit для Claude Code",
   "scripts": {
     "test": "node --test tests/*.test.js"
+  },
+  "devDependencies": {
+    "pixelmatch": "7.2.0",
+    "pngjs": "7.0.0"
   }
 }
```

и из корня worktree:
```
npm install --no-audit --no-fund
```
Проверка: `node -e "console.log(require('pngjs/package.json').version, require('pixelmatch/package.json').version)"` → `7.0.0 7.2.0`.

- [ ] **Шаг 2: манифест зависимостей `plugins/kit/scripts/visual-deps/package.json`**

```json
{
  "name": "kit-visual-deps",
  "private": true,
  "description": "Зависимости снимков /kit:visual: ставятся один раз на машину командой node visual.js install в %LOCALAPPDATA%\\kit\\visual\\deps",
  "dependencies": {
    "pixelmatch": "7.2.0",
    "playwright-core": "1.63.0",
    "pngjs": "7.0.0"
  }
}
```

- [ ] **Шаг 3: тест**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpDir, writeFiles } = require('./helpers');
const { diffPng } = require('../plugins/kit/scripts/lib/visual/image');
const home = require('../plugins/kit/scripts/lib/visual/home');

// pngjs и pixelmatch — devDependencies корня репозитория (npm ci в корне).
async function libs() {
  let PNG;
  let pixelmatch;
  try {
    ({ PNG } = require('pngjs'));
    pixelmatch = (await import('pixelmatch')).default;
  } catch (e) {
    assert.fail('нет pngjs/pixelmatch — выполните npm ci в корне репозитория: ' + e.message);
  }
  return { PNG, pixelmatch };
}

// Белая картинка w×h; dots — [[x, y, [r, g, b]]].
function png(PNG, w, h, dots = []) {
  const img = new PNG({ width: w, height: h });
  img.data.fill(255);
  for (const [x, y, [r, g, b]] of dots) {
    const i = (w * y + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
  }
  return PNG.sync.write(img);
}

test('diffPng: одинаковые — 0 %, один пиксель из 100 — 1 %, дифф — PNG того же размера', async () => {
  const L = await libs();
  const a = png(L.PNG, 10, 10);
  const same = diffPng(a, png(L.PNG, 10, 10), L);
  assert.equal(same.pct, 0);
  assert.equal(same.changed, 0);
  assert.equal(same.size, '10×10 → 10×10');
  const one = diffPng(a, png(L.PNG, 10, 10, [[3, 4, [0, 0, 0]]]), L);
  assert.equal(one.changed, 1);
  assert.equal(one.pct, 1);
  const d = L.PNG.sync.read(one.diff);
  assert.deepEqual([d.width, d.height], [10, 10]);
});

test('diffPng: разная высота — добивается белым, отличие — только в полосе снизу', async () => {
  const L = await libs();
  const a = png(L.PNG, 10, 10);
  const taller = png(L.PNG, 10, 12, [[0, 11, [0, 0, 0]], [5, 11, [0, 0, 0]]]);
  const r = diffPng(a, taller, L);
  assert.equal(r.size, '10×10 → 10×12');
  assert.equal(r.changed, 2);
  assert.equal(r.pct, +((100 * 2) / 120).toFixed(3));
  assert.equal(diffPng(a, png(L.PNG, 10, 12), L).pct, 0, 'белая добивка на белом фоне — не отличие');
});

test('homeDir и depsDir: KIT_VISUAL_HOME, LOCALAPPDATA, KIT_VISUAL_DEPS', () => {
  assert.equal(home.homeDir({ KIT_VISUAL_HOME: 'X:\\h' }), 'X:\\h');
  if (process.platform === 'win32') assert.equal(home.homeDir({ LOCALAPPDATA: 'C:\\L' }), path.join('C:\\L', 'kit', 'visual'));
  assert.equal(home.depsDir({ KIT_VISUAL_HOME: 'X:\\h' }), path.join('X:\\h', 'deps'));
  assert.equal(home.depsDir({ KIT_VISUAL_HOME: 'X:\\h', KIT_VISUAL_DEPS: 'Y:\\d' }), 'Y:\\d');
});

test('pinned: точные версии как в прототипе, совпадают с devDependencies корня', () => {
  assert.deepEqual(home.pinned(), { pixelmatch: '7.2.0', 'playwright-core': '1.63.0', pngjs: '7.0.0' });
  const dev = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies;
  assert.equal(dev.pixelmatch, home.pinned().pixelmatch);
  assert.equal(dev.pngjs, home.pinned().pngjs);
});

test('missingDeps и requireDeps: пусто — всё стоит; нет или другая версия — код 5 с командой установки', () => {
  const dir = tmpDir('kit-visual-deps-');
  assert.deepEqual(home.missingDeps(dir).map((m) => m.name), ['pixelmatch', 'playwright-core', 'pngjs']);
  writeFiles(dir, {
    'node_modules/pixelmatch/package.json': '{"version":"7.2.0"}',
    'node_modules/pngjs/package.json': '{"version":"6.0.0"}',
  });
  assert.deepEqual(home.missingDeps(dir, home.IMAGE_DEPS), [{ name: 'pngjs', want: '7.0.0', have: '6.0.0' }]);
  assert.throws(() => home.requireDeps(dir), (e) => e.code === 5 && /pngjs 7\.0\.0 \(стоит 6\.0\.0\)/.test(e.message)
    && /playwright-core 1\.63\.0/.test(e.message) && /node visual\.js install/.test(e.message));
  assert.deepEqual(home.missingDeps(ROOT, home.IMAGE_DEPS), [], 'в корне репозитория стоят devDependencies');
});

test('loadImageLibs: из папки с node_modules — PNG и pixelmatch (ESM)', async () => {
  const L = await home.loadImageLibs(ROOT);
  assert.equal(typeof L.PNG, 'function');
  assert.equal(typeof L.pixelmatch, 'function');
  await assert.rejects(home.loadImageLibs(tmpDir('kit-visual-empty-')), (e) => e.code === 5);
});

test('authFile: вне проекта, свой на проект и на хост', () => {
  const env = { KIT_VISUAL_HOME: 'X:\\h' };
  const a = home.authFile('C:\\OSPanel\\home\\beta.server', 'https://beta.example.com', env);
  assert.match(a, /^X:\\h[\\/]auth[\\/]beta\.server-[0-9a-f]{8}@beta\.example\.com\.json$/);
  assert.equal(home.authFile('c:/ospanel/home/beta.server/', 'https://beta.example.com/', env), a, 'регистр и слеши пути не важны');
  assert.notEqual(home.authFile('C:\\OSPanel\\home\\other.server', 'https://beta.example.com', env), a);
  assert.notEqual(home.authFile('C:\\OSPanel\\home\\beta.server', 'https://dev.beta.example.com', env), a);
  assert.match(home.authFile('C:\\p\\my site', 'http://localhost:8080', env), /my_site-[0-9a-f]{8}@localhost_8080\.json$/);
});
```

- [ ] **Шаг 4: запустить — падает**

Run: `node --test tests/visual-image-home.test.js`
Expected: FAIL — `Cannot find module '../plugins/kit/scripts/lib/visual/image'`.

- [ ] **Шаг 5: `image.js`**

```js
'use strict';
// Сравнение PNG как в прототипе: разный размер добивается белым до общего, pixelmatch с threshold 0.1 без AA.
// Библиотеки передаются аргументом: рабочие — из <дом>/deps (home.loadImageLibs), в тестах — из node_modules репозитория.

function padTo(PNG, img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0);
  return out;
}

// → { pct: доля отличающихся пикселей в %, 3 знака; size: 'ш×в → ш×в'; changed: число пикселей; diff: PNG-буфер }.
function diffPng(bufA, bufB, { PNG, pixelmatch }) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pa = padTo(PNG, a, w, h);
  const pb = padTo(PNG, b, w, h);
  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(pa.data, pb.data, diff.data, w, h, { threshold: 0.1, includeAA: false });
  return {
    pct: +((100 * changed) / (w * h)).toFixed(3),
    size: `${a.width}×${a.height} → ${b.width}×${b.height}`,
    changed,
    diff: PNG.sync.write(diff),
  };
}

module.exports = { padTo, diffPng };
```

- [ ] **Шаг 6: `home.js`**

```js
'use strict';
// Папка снимков на машине (<дом>): зависимости deps/ и сессии входа auth/ — вне проекта и вне кэша плагина.
// <дом> = KIT_VISUAL_HOME или %LOCALAPPDATA%\kit\visual (вне Windows — ~/.cache/kit/visual).
// KIT_VISUAL_DEPS — другая папка с node_modules (только для тестов: корень репозитория с devDependencies).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { VisualError } = require('./args');

const MANIFEST = path.join(__dirname, '..', '..', 'visual-deps', 'package.json');
const IMAGE_DEPS = ['pixelmatch', 'pngjs'];

function homeDir(env = process.env) {
  if (env.KIT_VISUAL_HOME) return env.KIT_VISUAL_HOME;
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'kit', 'visual');
  return path.join(os.homedir(), '.cache', 'kit', 'visual');
}

function depsDir(env = process.env) {
  return env.KIT_VISUAL_DEPS || path.join(homeDir(env), 'deps');
}

// Закреплённые версии: { имя: версия }.
function pinned() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).dependencies;
}

// Чего не хватает в dir/node_modules: [{ name, want, have }]; пусто — всё стоит ровно тех версий.
function missingDeps(dir, names = Object.keys(pinned())) {
  const want = pinned();
  const out = [];
  for (const name of names) {
    let have = null;
    try {
      have = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch (e) {
      have = null;
    }
    if (have !== want[name]) out.push({ name, want: want[name], have });
  }
  return out;
}

function requireDeps(dir, names) {
  const miss = missingDeps(dir, names);
  if (!miss.length) return;
  const list = miss.map((m) => `${m.name} ${m.want}${m.have ? ` (стоит ${m.have})` : ''}`).join(', ');
  throw new VisualError(5, `нет зависимостей снимков в ${dir}: ${list}\nУстановка — только с согласия пользователя: node visual.js install`);
}

async function loadImageLibs(dir) {
  requireDeps(dir, IMAGE_DEPS);
  const req = createRequire(path.join(dir, 'package.json'));
  const { PNG } = req('pngjs');
  const pixelmatch = (await import(pathToFileURL(req.resolve('pixelmatch')).href)).default;
  return { PNG, pixelmatch };
}

function loadPlaywright(dir) {
  requireDeps(dir);
  return createRequire(path.join(dir, 'package.json'))('playwright-core');
}

// Поставить зависимости в <дом>/deps (не в KIT_VISUAL_DEPS): копия манифеста плагина и npm install.
function installDeps(env = process.env) {
  const dir = path.join(homeDir(env), 'deps');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(MANIFEST, path.join(dir, 'package.json'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
    cwd: dir, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (r.error || r.status !== 0) throw new VisualError(5, `npm install не отработал${r.error ? ': ' + r.error.message : ` (код ${r.status})`}`);
  requireDeps(dir);
  return dir;
}

// Файл сессии входа: свой на проект (имя папки + хеш полного пути) и на хост сайта.
function authFile(root, base, env = process.env) {
  const abs = path.resolve(root);
  const name = path.basename(abs).replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
  const hash = crypto.createHash('sha1').update(abs.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 8);
  const host = new URL(base).host.replace(/:/g, '_');
  return path.join(homeDir(env), 'auth', `${name}-${hash}@${host}.json`);
}

module.exports = { MANIFEST, IMAGE_DEPS, homeDir, depsDir, pinned, missingDeps, requireDeps, loadImageLibs, loadPlaywright, installDeps, authFile };
```

- [ ] **Шаг 7: запустить — проходит**

Run: `node --test tests/visual-image-home.test.js` → 7/7; `npm test` — зелёное. `installDeps` тестами не вызывается (сеть и согласие) — он проверяется в 10.11.

- [ ] **Шаг 8: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.6` (FILES — в том числе `package.json` и `package-lock.json`).

### Задача 10.7: `guard.js`; `docs/visual` в базовых запретах

**Files:**
- Create: `plugins/kit/scripts/lib/visual/guard.js`
- Test: `tests/visual-guard.test.js`
- Modify: `plugins/kit/scripts/secret-scan.js` (`BASE_FORBIDDEN`), `plugins/kit/agents/git-keeper.md` (п. 2), `tests/secret-scan.test.js`

**Interfaces:**
- Consumes: `args.js` — `VisualError`; `lib/paths.js` — `parseRules(items)`, `matchRules(path, rules)`; объект параметров (`found`, `list`).
- Produces (для 10.8): `GITIGNORE`; `readDeployment(xml) → { always, server, excluded: string[] }`; `checkDeploy(root, params) → string[]` (предупреждения; код 4 — исключением); `ensureGitignore(visualDir) → boolean` (создан ли).

- [ ] **Шаг 1: тест `guard`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeProject, writeFiles, git } = require('./helpers');
const { makeParams } = require('../plugins/kit/scripts/lib/params');
const { GITIGNORE, readDeployment, checkDeploy, ensureGitignore } = require('../plugins/kit/scripts/lib/visual/guard');

// Как .idea/deployment.xml beta: автозаливка на «ftp», исключения локальные и удалённые.
function deployment({ always = true, server = 'ftp', excluded = ['.idea', '.git', '.claude/scripts', 'docs/visual'], other = [] } = {}) {
  const ex = (list) => list.map((p) => `            <excludedPath local="true" path="$PROJECT_DIR$/${p}" />`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" ${always ? 'autoUpload="Always" ' : ''}serverName="${server}" autoUploadExternalChanges="true">
    <serverData>
      <paths name="${server}">
        <serverdata>
          <mappings><mapping deploy="/" local="$PROJECT_DIR$" web="/" /></mappings>
          <excludedPaths>
            <excludedPath path="/bitrix" />
${ex(excluded)}
          </excludedPaths>
        </serverdata>
      </paths>
      <paths name="dev">
        <serverdata>
          <excludedPaths>
${ex(other)}
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
${always ? '    <option name="myAutoUpload" value="ALWAYS" />\n' : ''}  </component>
</project>
`;
}
const project = (xml) => makeProject(xml === undefined ? {} : { '.idea/deployment.xml': xml });
const NO_WARN = makeParams({ 'не выкладывать': '.idea, .git, docs/visual' });

test('readDeployment: автозаливка, сервер по умолчанию, локальные исключения только его блока', () => {
  assert.deepEqual(readDeployment(deployment({ other: ['docs'] })),
    { always: true, server: 'ftp', excluded: ['.idea', '.git', '.claude/scripts', 'docs/visual'] });
  assert.equal(readDeployment(deployment({ always: false })).always, false);
  assert.equal(readDeployment('<component name="PublishConfigData" serverName="x"><option name="myAutoUpload" value="ALWAYS" /></component>').always, true);
});

test('checkDeploy: Always без исключения docs/visual — код 4 с подсказкой', () => {
  const dir = project(deployment({ excluded: ['.idea', '.git'], other: ['docs/visual'] }));
  assert.throws(() => checkDeploy(dir, NO_WARN), (e) => e.code === 4 && /«ftp»/.test(e.message) && /Excluded Paths/.test(e.message) && /docs\/visual/.test(e.message));
});

test('checkDeploy: исключён docs/visual или docs целиком; On explicit save; нет .idea — можно', () => {
  for (const dir of [project(deployment()), project(deployment({ excluded: ['docs'] })), project(deployment({ always: false, excluded: [] })), project()]) {
    assert.deepEqual(checkDeploy(dir, NO_WARN), []);
  }
});

test('checkDeploy: docs/visual нет в «Не выкладывать» — предупреждение; вне kit-проекта — тихо', () => {
  const dir = project();
  const w = checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .git, .claude/scripts' }));
  assert.equal(w.length, 1);
  assert.match(w[0], /Не выкладывать/);
  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, docs' })), []);
  assert.deepEqual(checkDeploy(dir, makeParams(null)), []);
});

test('ensureGitignore: создаёт один раз; снимки игнорируются git, сам .gitignore — нет', () => {
  const dir = makeProject({ 'index.php': '<?php\n' });
  const visual = path.join(dir, 'docs', 'visual');
  assert.equal(ensureGitignore(visual), true);
  assert.equal(fs.readFileSync(path.join(visual, '.gitignore'), 'utf8'), GITIGNORE);
  fs.writeFileSync(path.join(visual, '.gitignore'), '# свой\n*\n!.gitignore\n');
  assert.equal(ensureGitignore(visual), false);
  assert.match(fs.readFileSync(path.join(visual, '.gitignore'), 'utf8'), /свой/, 'существующий не перезаписывается');
  writeFiles(dir, { 'docs/visual/before/guest/desktop/home.png': 'x', 'docs/visual/links.json': '{}' });
  git(dir, 'init', '-q');
  const r = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /docs\/visual\/\.gitignore/);
  assert.doesNotMatch(r.stdout, /home\.png|links\.json/);
});
```

- [ ] **Шаг 2: тест базового запрета в `tests/secret-scan.test.js`**

```diff
--- a/tests/secret-scan.test.js
+++ b/tests/secret-scan.test.js
@@ -190,6 +190,15 @@
   assert.doesNotMatch(r.stdout, /upload\/docs\/a\.txt/);
 });
 
+test('снимки docs/visual — базовый запрет (от корня проекта)', () => {
+  const dir = gitRepo({ 'x.txt': '' });
+  writeFiles(dir, { 'docs/visual/before/admin/desktop/home.txt': 'x', 'docs/visualize.md': 'x', 'local/docs/visual/a.txt': 'x' });
+  const r = scan(dir, '--files', 'docs/visual/before/admin/desktop/home.txt', 'docs/visualize.md', 'local/docs/visual/a.txt');
+  assert.equal(r.code, 1);
+  assert.match(r.stdout, /docs\/visual\/before\/admin\/desktop\/home\.txt: запрещённый путь \(docs\/visual\)/);
+  assert.doesNotMatch(r.stdout, /visualize|local\/docs/);
+});
+
 test('.env.example — не запрещённый путь, .env и .env.local — запрещённые', () => {
   const dir = gitRepo({ 'x.txt': '' });
   writeFiles(dir, { '.env.example': 'DB_PASSWORD=\n', '.env.local': 'X=1\n', '.env': 'X=1\n' });
```

- [ ] **Шаг 3: запустить — падает**

Run: `node --test tests/visual-guard.test.js tests/secret-scan.test.js`
Expected: FAIL — нет модуля `guard`; «снимки docs/visual — базовый запрет» — `docs/visual/…` не запрещён.

- [ ] **Шаг 4: `guard.js`**

```js
'use strict';
// Защита выкладки: снимки из-под админа не должны уехать на сервер (nginx отдаёт картинки мимо .htaccess) и в git.
const fs = require('fs');
const path = require('path');
const { VisualError } = require('./args');
const { parseRules, matchRules } = require('../paths');

const GITIGNORE = '# Снимки /kit:visual — только локально: в git и на сервер не кладём (снимки из-под админа)\n*\n!.gitignore\n';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// .idea/deployment.xml → { always, server, excluded: [локальные исключения от корня проекта] }.
// Исключения — у сервера по умолчанию (serverName → <paths name="…">); блок не найден — по всему файлу.
function readDeployment(xml) {
  const comp = /<component\s+name="PublishConfigData"([^>]*)>/.exec(xml);
  const attrs = comp ? comp[1] : '';
  const always = /\bautoUpload="Always"/i.test(attrs) || /<option\s+name="myAutoUpload"\s+value="ALWAYS"/i.test(xml);
  const sm = /\bserverName="([^"]*)"/.exec(attrs);
  const server = sm ? sm[1] : null;
  let scope = xml;
  if (server) {
    const block = new RegExp(`<paths\\s+name="${escapeRe(server)}"[^>]*>([\\s\\S]*?)</paths>`).exec(xml);
    if (block) scope = block[1];
  }
  const excluded = [];
  for (const m of scope.matchAll(/<excludedPath\b([^>]*?)\/?>/g)) {
    if (!/\blocal="true"/.test(m[1])) continue;
    const p = /\bpath="([^"]*)"/.exec(m[1]);
    if (p) excluded.push(p[1].replace(/^\$PROJECT_DIR\$\/?/, '').replace(/\\/g, '/').replace(/\/+$/, ''));
  }
  return { always, server, excluded };
}

// Код 4, если PhpStorm заливает каждое сохранение, а docs/visual не исключён; иначе — список предупреждений.
function checkDeploy(root, params) {
  const warnings = [];
  const file = path.join(root, '.idea', 'deployment.xml');
  if (fs.existsSync(file)) {
    const d = readDeployment(fs.readFileSync(file, 'utf8'));
    if (d.always && !d.excluded.some((p) => /^docs(\/visual)?$/i.test(p))) {
      const srv = d.server ? `«${d.server}»` : 'по умолчанию';
      throw new VisualError(4, `PhpStorm заливает каждое сохранение на сервер ${srv} (Always), а docs/visual не исключён: `
        + 'снимки из-под админа уехали бы на сервер (nginx отдаёт картинки мимо .htaccess).\n'
        + `Добавьте в Settings → Build, Execution, Deployment → Deployment → сервер ${srv} → Excluded Paths локальный путь docs/visual и повторите.`);
    }
  }
  if (params && params.found && !matchRules('docs/visual/x.png', parseRules(params.list('Не выкладывать')))) {
    warnings.push('в «Не выкладывать» (.claude/CLAUDE.md) нет docs/visual — при ручной выкладке снимки не выкладывать; допишите docs/visual в параметр');
  }
  return warnings;
}

// docs/visual/.gitignore — снимки не попадают в git, даже если в .gitignore проекта строки нет.
function ensureGitignore(visualDir) {
  const f = path.join(visualDir, '.gitignore');
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(visualDir, { recursive: true });
  fs.writeFileSync(f, GITIGNORE);
  return true;
}

module.exports = { GITIGNORE, readDeployment, checkDeploy, ensureGitignore };
```

- [ ] **Шаг 5: базовые запреты**

```diff
--- a/plugins/kit/scripts/secret-scan.js
+++ b/plugins/kit/scripts/secret-scan.js
@@ -14,7 +14,7 @@
 
 const BASE_FORBIDDEN = [
   '.idea', '*.back*', '.settings.php', '.settings_extra.php', 'dbconn.php', '.env', '.env.* (кроме .env.example)',
-  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees',
+  '*.pem', '*.key', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual',
 ];
 const MAX_SIZE = 2 * 1024 * 1024;
 const PARAM_LINE = /^\s*[-*]\s+Секреты\s*:/i;
```

```diff
--- a/plugins/kit/agents/git-keeper.md
+++ b/plugins/kit/agents/git-keeper.md
@@ -26,7 +26,7 @@
    `-c core.quotepath=false` — во всех командах, которые выводят пути: иначе кириллические имена приходят восьмеричными escape-последовательностями (`"\320\277…"`), и `git add` по ним файл не находит.
    Корень репозитория должен совпадать с текущей папкой. Файлы, которые уже лежат в индексе, но не входят в FILES, в коммит не попадут — это обеспечивает п. 5.
 2. Запрещённые пути. Прочитай параметр «Не коммитить» в разделе «Параметры для агентов» файла `.claude/CLAUDE.md`. Остановись и ничего не коммить, если среди FILES есть:
-   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`;
+   - `.idea/`, любой `*.back*`, `.settings.php`, `.settings_extra.php`, `dbconn.php`, `.env*` (кроме `.env.example` — пример настроек коммитят), `*.pem`, `*.key`, `.claude/settings.local.json`, `.claude/worktrees/`, `docs/visual/` (снимки `/kit:visual` из-под админа);
    - пути из параметра «Не коммитить» (запись `X (кроме Y)`: X запрещён, Y разрешён).
 
    Правило со `/` в любом месте (`bitrix/`, `/bitrix`, `local/modules`) — путь от корня репозитория и всё внутри: `bitrix/` запрещает `bitrix/.settings.php`, но **не** `local/templates/…/components/bitrix/…` (копии шаблонов компонентов — обычная работа, их коммитят). Правило без `/` (`.idea`, `*.back*`) — имя в любом месте пути.
```

- [ ] **Шаг 6: запустить — проходит**

Run: `node --test tests/visual-guard.test.js tests/secret-scan.test.js` — всё ✔; `npm test` — зелёное.

- [ ] **Шаг 7: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.7`. **Остановка на проверку пользователя (часть A).**

---

## Часть B — CLI, скилл, интеграции

### Задача 10.8: `browser.js` и `visual.js`

**Files:**
- Create: `plugins/kit/scripts/lib/visual/browser.js`
- Create: `plugins/kit/scripts/visual.js`
- Test: `tests/visual-cli.test.js`

**Interfaces:**
- Consumes: всё из 10.3–10.7; `lib/params.js` — `readParams(root)`; `tests/helpers.js` — `ROOT`, `tmpDir`, `makeProject`, `writeFiles`, `runScript(name, { args, cwd, env })`; `tests/fixtures.js` — `paramsMd(values)`.
- Produces: команда `node visual.js deps | install | login | discover [адрес…] [--ctx guest] | shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup] | check <метка> [фильтры] | compare <до> <после> | list` с флагами `--env прод|дев`, `--url адрес`; коды 0–5 (§9 спека). `browser.js`: `BASE_HIDE`, `stableCss(hide)`, `relUrl(url, base)`, `viewports(devices)`, `userId(page, check)`, `shoot({ pw, base, cfg, groups, outDir, authFile, noSetup, log }) → { pages, setup, noSession }`, `login({ pw, base, loginCfg, file, log, timeoutMs })`, `discover({ pw, base, seeds, storage, check })`.

Порядок проверок у `shoot`/`check` — до запуска Chrome: аргументы и метка (2) → адрес сайта (2) → `pages.json` и фильтры (2) → защита выкладки (4), затем `docs/visual/.gitignore` → зависимости (5) → файл сессии для контекста с `auth` (3). Отличия `browser.js` от прототипа — только перечисленные в спеке: setup/teardown и при `--only` (`--no-setup` — пропустить), проверка входа до setup, сеть по странице (`bad`, `failed`), `hide`/`mask` из `pages.json`, удаление устаревшего снимка при сбое; стабилизация, действия и таймауты — как в `visual.mjs`.

- [ ] **Шаг 1: тест CLI без браузера**

```js
'use strict';
// visual.js целиком без браузера: compare, list, check-метки, коды 2/3/4/5 до запуска Chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, tmpDir, makeProject, writeFiles, runScript } = require('./helpers');
const { paramsMd } = require('./fixtures');

const { PNG } = require('pngjs');

const PARAMS = { 'Режим': 'bitrix', 'Прод': 'https://beta.example.com', 'Не выкладывать': '.idea, .git, .claude/scripts, docs/visual' };
const PAGES = { contexts: { guest: { pages: [{ name: 'home', url: '/' }] }, admin: { auth: true, pages: [{ name: 'order', url: '/order/' }] } } };

function png(w, h, dots = []) {
  const img = new PNG({ width: w, height: h });
  img.data.fill(255);
  for (const [x, y] of dots) img.data.fill(0, (w * y + x) * 4, (w * y + x) * 4 + 3);
  return PNG.sync.write(img);
}

const rec = (ctx, vp, name, over = {}) => ({ ctx, vp, name, url: '/' + name + '/', status: 200, final: '/' + name + '/', title: name, uid: ctx === 'admin' ? '1' : '', errors: [], bad: [], failed: [], ...over });

// Проект с параметрами и метками; label: { meta?, files: { 'ctx/vp/name': { png, txt } } }.
function project({ labels = {}, pages = PAGES, params = PARAMS, extra = {} } = {}) {
  const files = { '.claude/CLAUDE.md': paramsMd(params), '.claude/scripts/visual/pages.json': JSON.stringify(pages), ...extra };
  const dir = makeProject(files);
  for (const [label, l] of Object.entries(labels)) {
    for (const [key, f] of Object.entries(l.files || {})) {
      const base = path.join(dir, 'docs', 'visual', label, key);
      fs.mkdirSync(path.dirname(base), { recursive: true });
      if (f.png) fs.writeFileSync(base + '.png', f.png);
      if (f.txt !== undefined) fs.writeFileSync(base + '.txt', f.txt);
    }
    if (l.meta) fs.writeFileSync(path.join(dir, 'docs', 'visual', label, 'meta.json'), JSON.stringify(l.meta));
  }
  return dir;
}

// Зависимости сравнения — из корня репозитория (devDependencies); <дом> — пустая временная папка.
const ENV = () => ({ KIT_VISUAL_HOME: tmpDir('kit-visual-home-'), KIT_VISUAL_DEPS: ROOT });
const visual = (dir, args, env = ENV()) => runScript('visual.js', { args, cwd: dir, env });

const BEFORE = {
  meta: { base: 'https://beta.example.com', date: '2026-09-25T09:00:00Z', full: true, pages: [rec('guest', 'desktop', 'home'), rec('admin', 'desktop', 'order')] },
  files: { 'guest/desktop/home': { png: png(20, 20), txt: 'Главная\nКорзина (3)' }, 'admin/desktop/order': { png: png(20, 20), txt: 'Оформление' } },
};

test('compare: одинаковые метки — код 0, «совпадает», отчёт и summary.json', () => {
  const dir = project({ labels: { before: BEFORE, after: BEFORE } });
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Итого: совпадает 2, в пределах шума 0, отличается 0, не снято 0 \(из 2\)/);
  assert.match(r.stdout, /Шум не измерен: node visual\.js check before/);
  const out = path.join(dir, 'docs', 'visual', 'compare-before-vs-after');
  assert.ok(fs.existsSync(path.join(out, 'report.html')));
  assert.ok(fs.existsSync(path.join(out, 'guest', 'desktop', 'home.png')), 'дифф-картинка');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).counts.same, 2);
});

test('compare: пиксели, текст, статус 500 и новый ответ ≥400 — код 1, статусы первыми', () => {
  const after = {
    meta: { ...BEFORE.meta, date: '2026-09-25T12:00:00Z', pages: [rec('guest', 'desktop', 'home'),
      rec('admin', 'desktop', 'order', { status: 500, bad: [{ status: 500, url: '/order/ajax.php?x=1', type: 'xhr' }] })] },
    files: { 'guest/desktop/home': { png: png(20, 20, [[1, 1], [2, 2]]), txt: 'Главная\nКорзина (0)' }, 'admin/desktop/order': { png: png(20, 20), txt: 'Оформление' } },
  };
  const dir = project({ labels: { before: BEFORE, after } });
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.indexOf('Статусы и ошибки:') < r.stdout.indexOf('Отличается:'));
  assert.match(r.stdout, /admin\/desktop\/order {2}статус 200 → 500; ответ: \+ 500 \/order\/ajax\.php/);
  assert.match(r.stdout, /0\.5% {2}guest\/desktop\/home {2}текст −1\/\+1/);
  const html = fs.readFileSync(path.join(dir, 'docs', 'visual', 'compare-before-vs-after', 'report.html'), 'utf8');
  assert.ok(html.includes('Корзина (3)') && html.includes('Корзина (0)'));
});

test('compare: шум из noise.json — «в пределах шума», код 0', () => {
  const after = { meta: BEFORE.meta, files: { ...BEFORE.files, 'guest/desktop/home': { png: png(20, 20, [[1, 1]]), txt: 'Главная\nКорзина (4)' } } };
  const dir = project({ labels: { before: BEFORE, after } });
  fs.writeFileSync(path.join(dir, 'docs', 'visual', 'before', 'noise.json'), JSON.stringify({ runs: 1, snapshots: {
    'guest/desktop/home': { pct: 0.5, removed: ['Корзина (3)'], added: ['Корзина (4)'], errors: [], net: [] } } }));
  const r = visual(dir, ['compare', 'before', 'after']);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /В пределах шума:\n {5}0\.25% {2}\(шум 0\.5%\) {2}guest\/desktop\/home/);
  assert.doesNotMatch(r.stdout, /Шум не измерен/);
});

test('compare: полный «после» без снимка — «не снято» (код 1); частичный — «не снимали» (код 0); сбой снимка — «не снято» с причиной', () => {
  const partial = { meta: { ...BEFORE.meta, full: false, pages: [rec('guest', 'desktop', 'home')] }, files: { 'guest/desktop/home': BEFORE.files['guest/desktop/home'] } };
  const full = { ...partial, meta: { ...partial.meta, full: true } };
  const failed = { meta: { ...partial.meta, pages: [rec('guest', 'desktop', 'home'), { ...rec('admin', 'desktop', 'order'), fail: 'Timeout 60000ms' }] },
    files: { ...BEFORE.files } };
  const dir = project({ labels: { before: BEFORE, partial, full, failed } });
  const p = visual(dir, ['compare', 'before', 'partial']);
  assert.equal(p.code, 0);
  assert.match(p.stdout, /не снимали 1/);
  const f = visual(dir, ['compare', 'before', 'full']);
  assert.equal(f.code, 1);
  assert.match(f.stdout, /Не снято:\n {2}admin\/desktop\/order {2}нет снимка «после»/);
  const x = visual(dir, ['compare', 'before', 'failed']);
  assert.equal(x.code, 1);
  assert.match(x.stdout, /admin\/desktop\/order {2}Timeout 60000ms/, 'устаревший снимок при сбое не сравнивается');
});

test('compare: метка прототипа (meta без сети и без full) сравнивается с новой', () => {
  const proto = { meta: { base: 'https://beta.example.com', date: 'd', pages: BEFORE.meta.pages.map(({ bad, failed, ...r }) => r) }, files: BEFORE.files };
  const dir = project({ labels: { 'proto-now': proto, 'kit-now': BEFORE } });
  const r = visual(dir, ['compare', 'proto-now', 'kit-now']);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /совпадает 2/);
});

test('compare: нет метки или одной метки — код 2', () => {
  const dir = project({ labels: { before: BEFORE } });
  assert.equal(visual(dir, ['compare', 'before']).code, 2);
  const r = visual(dir, ['compare', 'before', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /нет метки nope/);
});

test('list: метки и сравнения', () => {
  const dir = project({ labels: { before: BEFORE, after: BEFORE } });
  visual(dir, ['compare', 'before', 'after']);
  const r = visual(dir, ['list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /метка {2}before {2}2026-09-25 09:00 {2}снимков 2 {2}полный {2}https:\/\/beta\.example\.com/);
  assert.match(r.stdout, /сравнение {2}compare-before-vs-after {2}совпадает 2/);
});

test('shoot: опасный адрес, опечатка, неверная или зарезервированная метка, нет адреса — код 2 до браузера', () => {
  const bad = { contexts: { guest: { pages: [{ name: 'cancel', url: '/personal/cancel/1/?CANCEL=Y' }] } } };
  let r = visual(project({ pages: bad }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /опасный адрес .*отмена заказа/);
  r = visual(project({ pages: { contexts: { guest: { pages: [{ name: 'home', url: '/', fullpage: false }] } } } }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /неизвестный ключ .*fullpage/);
  for (const l of ['before-check', 'compare-x', '../x']) assert.equal(visual(project(), ['shoot', l]).code, 2, l);
  assert.equal(visual(project(), ['shoot']).code, 2);
  r = visual(project({ params: { 'Режим': 'bitrix' } }), ['shoot', 'before']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /«Прод»/);
  assert.equal(visual(project(), ['shoot', 'before', '--only', 'nope']).code, 2);
  assert.equal(visual(project(), ['frobnicate']).code, 2);
});

test('shoot: автозаливка PhpStorm без исключения docs/visual — код 4, docs/visual не создан', () => {
  const xml = '<project><component name="PublishConfigData" autoUpload="Always" serverName="ftp"><serverData><paths name="ftp"><serverdata><excludedPaths>'
    + '<excludedPath local="true" path="$PROJECT_DIR$/.idea" /></excludedPaths></serverdata></paths></serverData></component></project>';
  const dir = project({ extra: { '.idea/deployment.xml': xml } });
  const r = visual(dir, ['shoot', 'before']);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /Excluded Paths/);
  assert.ok(!fs.existsSync(path.join(dir, 'docs', 'visual')));
});

test('shoot без зависимостей — код 5 с командой установки; docs/visual/.gitignore уже создан', () => {
  const dir = project();
  const r = visual(dir, ['shoot', 'before'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-') });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /playwright-core 1\.63\.0/);
  assert.match(r.stderr, /node visual\.js install/);
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'visual', '.gitignore')));
});

test('shoot без сессии для контекста с auth — код 3 (зависимости есть)', () => {
  const fakeDeps = tmpDir('kit-visual-deps-');
  writeFiles(fakeDeps, {
    'node_modules/pixelmatch/package.json': '{"version":"7.2.0"}',
    'node_modules/pngjs/package.json': '{"version":"7.0.0"}',
    'node_modules/playwright-core/package.json': '{"name":"playwright-core","version":"1.63.0","main":"index.js"}',
    'node_modules/playwright-core/index.js': 'module.exports = {};',
  });
  const r = visual(project(), ['shoot', 'before'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-'), KIT_VISUAL_DEPS: fakeDeps });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /нет сессии входа .*node visual\.js login/);
});

test('deps: пусто — 5; check без эталона — 2; discover с опасной затравкой — 2', () => {
  const dir = project();
  assert.equal(visual(dir, ['deps'], { KIT_VISUAL_HOME: tmpDir('kit-visual-home-') }).code, 5);
  const c = visual(dir, ['check', 'before']);
  assert.equal(c.code, 2);
  assert.match(c.stderr, /сначала shoot before/);
  const d = visual(dir, ['discover', 'C:/Program Files/Git/auth/', '/personal/cancel/1/']);
  assert.equal(d.code, 2);
  assert.match(d.stderr, /\/personal\/cancel\/1\/: опасный/);
});
```

- [ ] **Шаг 2: запустить — падает**

Run: `node --test tests/visual-cli.test.js`
Expected: FAIL — все тесты: `Cannot find module …visual.js` (код 1 вместо ожидаемых).

- [ ] **Шаг 3: `browser.js`**

```js
'use strict';
// Съёмка в системном Chrome через Playwright (channel: 'chrome' — браузеры Playwright не скачиваются).
// Перенос прототипа beta (visual.mjs, коммит 0.3): стабилизация, действия, снимок во всю высоту и innerText.
// Проверяется только вживую (/kit:visual на сайте); pw — модуль playwright-core из home.loadPlaywright.
const fs = require('fs');
const path = require('path');
const { VisualError } = require('./args');

// Панель админа Битрикса, ожидание Битрикса, переключатель тем Аспро, чат jivo.
const BASE_HIDE = ['#bx-panel', '#bx-panel-back', '#bx-admin-prefix', '.bx-core-waitwindow', '.style-switcher', '#jivo-iframe-container', 'jdiv'];
const firstLine = (s) => String(s || '').split('\n')[0];

function viewports(devices) {
  return {
    desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    mobile: { ...devices['iPhone 13'], deviceScaleFactor: 1 },
  };
}

// Без анимаций, transition и курсора; свои hide — отдельным правилом (ошибка в селекторе не ломает базовое).
function stableCss(hide = []) {
  return '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}\n'
    + 'html{scroll-behavior:auto!important}\n'
    + `${BASE_HIDE.join(',')}{display:none!important}\n`
    + (hide.length ? `${hide.join(',')}{display:none!important}\n` : '');
}

// Адрес от корня сайта, если это свой сайт; иначе целиком.
function relUrl(url, base) {
  return url.startsWith(base) ? url.slice(base.length) || '/' : url;
}

async function launch(pw, headless = true) {
  try {
    return await pw.chromium.launch({ channel: 'chrome', headless });
  } catch (e) {
    throw new VisualError(5, 'не удалось запустить Chrome — нужен установленный Google Chrome (браузеры Playwright не скачиваются): ' + firstLine(e.message));
  }
}

async function newContext(browser, pw, vp, storage) {
  const opts = { ...viewports(pw.devices)[vp], ignoreHTTPSErrors: true, locale: 'ru-RU', timezoneId: 'Europe/Moscow' };
  if (storage) opts.storageState = storage;
  return browser.newContext(opts);
}

// ID вошедшего пользователя по выражению login.check; ошибка или нет входа — ''.
async function userId(page, check) {
  if (!check) return '';
  return page.evaluate(`(() => { try { const v = (${check}); return v ? String(v) : ''; } catch (e) { return ''; } })()`).catch(() => '');
}

// Видео — на первый кадр, слайдеры — на первый слайд без автопрокрутки. Выполняется в странице.
function freezeMotion() {
  document.querySelectorAll('video').forEach((v) => {
    try {
      v.pause();
      v.currentTime = 0;
      v.removeAttribute('autoplay');
    } catch (e) {
      // видео без данных
    }
  });
  document.querySelectorAll('*').forEach((el) => {
    const s = el.swiper;
    if (!s) return;
    try {
      if (s.autoplay) s.autoplay.stop();
      // Swiper в режиме loop: slideTo(0) попадает на клон — нужен slideToLoop.
      if (s.params && s.params.loop) s.slideToLoop(0, 0, false);
      else s.slideTo(0, 0, false);
    } catch (e) {
      // чужой объект swiper
    }
  });
  if (window.jQuery) {
    try {
      window.jQuery('.owl-carousel').trigger('stop.owl.autoplay');
      window.jQuery('.flexslider').each(function () {
        const f = window.jQuery(this).data('flexslider');
        if (f) {
          f.pause();
          f.flexAnimate(0);
        }
      });
    } catch (e) {
      // старые версии плагинов
    }
  }
}

async function stabilize(page, hide) {
  await page.addStyleTag({ content: stableCss(hide) }).catch(() => {});
  await page.evaluate(freezeMotion).catch(() => {});
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const h = () => document.documentElement.scrollHeight;
    for (let y = 0; y < h() && y < 40000; y += 700) {
      window.scrollTo(0, y);
      await sleep(120);
    }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.evaluate(freezeMotion).catch(() => {});
  await page.waitForTimeout(700);
}

// Как в прототипе: ключи действия выполняются в этом порядке; у click/clickAccept с optional таймаут 3 с.
async function runAction(page, base, a) {
  const t = a.optional ? 3000 : 15000;
  if (a.goto) await page.goto(base + a.goto, { waitUntil: 'load', timeout: 60000 });
  if (a.click) await page.locator(a.click).first().click({ timeout: t });
  // Клик с подтверждением окна confirm() — только там, где это явно задано в pages.json.
  if (a.clickAccept) {
    page.once('dialog', (d) => d.accept());
    await page.locator(a.clickAccept).first().click({ timeout: t });
  }
  if (a.clickText) await page.getByText(a.clickText, { exact: false }).first().click({ timeout: 15000 });
  if (a.hover) await page.locator(a.hover).first().hover({ timeout: 15000 });
  if (a.fill) await page.locator(a.fill).nth(a.nth || 0).fill(String(a.value ?? '1'), { timeout: 15000 });
  if (a.eval) await page.evaluate(a.eval);
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.waitFor) await page.locator(a.waitFor).first().waitFor({ timeout: 15000 });
}

async function runActions(page, base, actions = []) {
  for (const a of actions) {
    try {
      await runAction(page, base, a);
    } catch (e) {
      if (!a.optional) throw e;
    }
  }
}

// Одна группа «контекст × ширина»: проверка входа, setup, страницы, teardown.
async function shootGroup({ browser, pw, base, cfg, group, outDir, authFile, noSetup, log, result }) {
  const { ctx, vp } = group;
  const key = `${ctx.name}/${vp}`;
  const context = await newContext(browser, pw, vp, ctx.auth ? authFile : null);
  const page = await context.newPage();
  const net = { errors: [], bad: [], failed: [] };
  page.on('pageerror', (e) => net.errors.push(String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') net.errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) net.bad.push({ status: r.status(), url: relUrl(r.url(), base), type: r.request().resourceType() });
  });
  page.on('requestfailed', (r) => {
    net.failed.push({ url: relUrl(r.url(), base), error: (r.failure() || {}).errorText || '', type: r.resourceType() });
  });
  const fail = (p, why) => result.pages.push({ ctx: ctx.name, vp, name: p.name, url: p.url, fail: why });
  let started = false;
  try {
    if (ctx.auth) {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const uid = await userId(page, cfg.login.check);
      if (!uid || uid === '0') {
        result.noSession.push(key);
        log(`ERR ${key}  нет входа (сессия истекла или не та) — node visual.js login`);
        group.pages.forEach((p) => fail(p, 'нет входа'));
        return;
      }
    }
    started = true;
    if (!noSetup && ctx.setup.length) {
      try {
        await runActions(page, base, ctx.setup);
      } catch (e) {
        result.setup[key] = firstLine(e.message);
        log(`[${key}] setup: ${result.setup[key]}`);
      }
    }
    for (const p of group.pages) {
      const rec = { ctx: ctx.name, vp, name: p.name, url: p.url };
      const dir = path.join(outDir, ctx.name, vp);
      const png = path.join(dir, p.name + '.png');
      const txt = path.join(dir, p.name + '.txt');
      net.errors.length = 0;
      net.bad.length = 0;
      net.failed.length = 0;
      try {
        const resp = await page.goto(base + p.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
        await stabilize(page, [...cfg.hide, ...ctx.hide, ...p.hide]);
        if (p.actions.length) {
          await runActions(page, base, p.actions);
          await page.waitForTimeout(500);
        }
        rec.final = relUrl(page.url(), base);
        rec.title = await page.title();
        rec.uid = await userId(page, cfg.login.check);
        fs.mkdirSync(dir, { recursive: true });
        const mask = [...cfg.mask, ...ctx.mask, ...p.mask].map((s) => page.locator(s));
        await page.screenshot({ path: png, fullPage: p.fullPage, mask, timeout: 90000 });
        fs.writeFileSync(txt, await page.evaluate(() => (document.body ? document.body.innerText : '')));
        rec.errors = [...net.errors];
        rec.bad = [...net.bad];
        rec.failed = [...net.failed];
        log(`ok  ${key}/${p.name}  ${rec.status} ${rec.final}${rec.errors.length ? '  js-ошибок: ' + rec.errors.length : ''}${rec.bad.length ? '  ответов ≥400: ' + rec.bad.length : ''}`);
      } catch (e) {
        rec.fail = firstLine(e.message);
        // Снимок прежнего прогона этой метки устарел — убрать, чтобы сравнение его не взяло.
        for (const f of [png, txt]) fs.rmSync(f, { force: true });
        log(`ERR ${key}/${p.name}  ${rec.fail}`);
      }
      result.pages.push(rec);
    }
  } finally {
    if (started && !noSetup && ctx.teardown.length) {
      try {
        await runActions(page, base, ctx.teardown);
      } catch (e) {
        log(`[${key}] teardown: ${firstLine(e.message)}`);
      }
    }
    await context.close().catch(() => {});
  }
}

// → { pages: [meta страниц], setup: { 'ctx/vp': ошибка }, noSession: ['ctx/vp'] }.
async function shoot({ pw, base, cfg, groups, outDir, authFile, noSetup, log }) {
  const browser = await launch(pw);
  const result = { pages: [], setup: {}, noSession: [] };
  try {
    for (const group of groups) await shootGroup({ browser, pw, base, cfg, group, outDir, authFile, noSetup, log, result });
  } finally {
    await browser.close().catch(() => {});
  }
  return result;
}

// Окно Chrome: пользователь входит сам; вход — когда login.check вернул ID (не пусто и не 0) → storageState.
async function login({ pw, base, loginCfg, file, log, timeoutMs = 15 * 60 * 1000 }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const browser = await launch(pw, false);
  try {
    const context = await browser.newContext({ viewport: null, locale: 'ru-RU' });
    const page = await context.newPage();
    await page.goto(base + loginCfg.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    log('Войдите на сайт в открывшемся окне Chrome. Жду до 15 минут…');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!browser.isConnected()) throw new VisualError(3, 'окно Chrome закрыто до входа');
      for (const p of context.pages()) {
        const uid = await userId(p, loginCfg.check);
        if (uid && uid !== '0') {
          await context.storageState({ path: file });
          return uid;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new VisualError(3, 'вход не обнаружен за 15 минут');
  } finally {
    await browser.close().catch(() => {});
  }
}

// Затравки discover: статус, финальный адрес, title, USER_ID и все ссылки страницы.
async function discover({ pw, base, seeds, storage, check }) {
  const browser = await launch(pw);
  try {
    const context = await newContext(browser, pw, 'desktop', storage);
    const page = await context.newPage();
    const out = [];
    for (const url of seeds) {
      const rec = { url, hrefs: [] };
      try {
        const resp = await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        rec.status = resp ? resp.status() : null;
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        rec.final = relUrl(page.url(), base);
        rec.title = await page.title();
        rec.uid = await userId(page, check);
        rec.hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
      } catch (e) {
        rec.fail = firstLine(e.message);
      }
      out.push(rec);
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { BASE_HIDE, stableCss, relUrl, viewports, userId, shoot, login, discover };
```

- [ ] **Шаг 4: `visual.js`**

```js
#!/usr/bin/env node
'use strict';
// Снимки публичной части сайта «до/после» и их сравнение (/kit:visual). Запуск — из корня проекта:
//   node visual.js deps | install | login | discover [адрес…] [--ctx guest] | list
//   node visual.js shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup]
//   node visual.js check <метка> [те же фильтры]   — контрольный прогон <метка>-check и шум
//   node visual.js compare <до> <после>
// Общие флаги: --env прод|дев, --url адрес. Коды: 0 норма; 1 есть проблемы; 2 аргументы или pages.json;
// 3 сессия; 4 защита выкладки; 5 нет зависимостей или Chrome.
const fs = require('fs');
const path = require('path');
const { VisualError, parseArgs, seedPath, parseOnly, checkLabel } = require('./lib/visual/args');
const { CONFIG_REL, siteMode, siteBase, loginSettings, validateConfig, readConfigFile, loadConfig, selectGroups } = require('./lib/visual/config');
const { dangerReason, collectLinks, groupLinks } = require('./lib/visual/links');
const {
  pageKey, textDiff, applyTextNoise, metaChanges, setupChanges, verdictOf, presence, metaIndex, isFull, mergeMeta, noiseFromRows, mergeNoise,
} = require('./lib/visual/diff');
const { buildSummary, consoleLines, buildHtml } = require('./lib/visual/report');
const { diffPng } = require('./lib/visual/image');
const home = require('./lib/visual/home');
const { checkDeploy, ensureGitignore } = require('./lib/visual/guard');
const { readParams } = require('./lib/params');

const USAGE = 'Команды: deps | install | login | discover [адрес…] [--ctx guest] | shoot <метка> [--only a,b] [--ctx имя] [--vp desktop|mobile] [--no-setup]'
  + ' | check <метка> [фильтры] | compare <до> <после> | list; флаги --env прод|дев, --url адрес';

function project() {
  const root = process.cwd();
  const params = readParams(root);
  return { root, params, mode: siteMode(params), visual: path.join(root, 'docs', 'visual') };
}

const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const writeJson = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 1));
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/');

function makeLog(file) {
  return (line) => {
    console.log(line);
    if (file) fs.appendFileSync(file, line + '\n');
  };
}

// Перед записью в docs/visual: защита выкладки (код 4), затем docs/visual/.gitignore.
function guard(p) {
  for (const w of checkDeploy(p.root, p.params)) console.log('Внимание: ' + w);
  if (ensureGitignore(p.visual)) console.log('Создан docs/visual/.gitignore — снимки только локально');
}

// Ключи снимков метки: 'ctx/vp/name' по файлам *.png.
function listPngs(dir) {
  const out = new Set();
  const walk = (d, prefix) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), prefix + e.name + '/');
      else if (e.name.endsWith('.png')) out.add(prefix + e.name.slice(0, -4));
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

function cmdDeps() {
  const dir = home.depsDir();
  home.requireDeps(dir);
  console.log('Зависимости снимков на месте: ' + dir);
  return 0;
}

function cmdInstall() {
  console.log('Установлено: ' + home.installDeps());
  return 0;
}

async function cmdLogin(a) {
  const p = project();
  const base = siteBase(p.params, a.flags);
  const raw = readConfigFile(p.root);
  const login = raw ? validateConfig(raw, p.mode).login : loginSettings(undefined, p.mode);
  if (!login.check) throw new VisualError(2, `в общем режиме нужен login.check в ${CONFIG_REL}`);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  const uid = await require('./lib/visual/browser').login({ pw, base, loginCfg: login, file, log: console.log });
  console.log(`Вход обнаружен (USER_ID=${uid}). Сессия сохранена: ${file}`);
  return 0;
}

async function cmdDiscover(a) {
  const p = project();
  const base = siteBase(p.params, a.flags);
  if (a.flags.ctx && a.flags.ctx !== 'guest') throw new VisualError(2, '--ctx у discover: только guest');
  const raw = readConfigFile(p.root);
  const cfg = raw ? validateConfig(raw, p.mode) : null;
  const extra = cfg ? cfg.danger : [];
  const seeds = a.positional.length ? a.positional.map(seedPath) : ['/'];
  for (const s of seeds) {
    const d = dangerReason(s, extra);
    if (d) throw new VisualError(2, `адрес ${s}: опасный — ${d}`);
  }
  guard(p);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  const storage = a.flags.ctx === 'guest' || !fs.existsSync(file) ? null : file;
  const check = (cfg ? cfg.login : loginSettings(undefined, p.mode)).check;
  const pages = await require('./lib/visual/browser').discover({ pw, base, seeds, storage, check });
  const links = collectLinks(pages.map((x) => ({ seed: x.url, hrefs: x.hrefs })), base, extra);
  const out = { base, date: new Date().toISOString(), ctx: storage ? 'auth' : 'guest', seeds: pages.map(({ hrefs, ...r }) => r), links };
  const target = path.join(p.visual, 'links.json');
  writeJson(target, out);
  console.log(storage ? `С сессией: ${storage}` : 'Гостем');
  for (const s of out.seeds) {
    console.log(s.fail ? `ERR ${s.url}  ${s.fail}` : `${s.url} → ${s.final} | ${s.title} | USER_ID=${s.uid || '—'} | ${s.status}`);
  }
  console.log('Группы страниц (число, шаблон, пример):');
  for (const g of groupLinks(links)) console.log(`  ${String(g.count).padStart(4)}  ${g.pattern}${g.count > 1 ? '   напр. ' + g.example : ''}`);
  const danger = links.filter((l) => l.danger);
  if (danger.length) {
    console.log('Опасные — не снимать:');
    for (const l of danger) console.log(`  ${l.url} — ${l.danger}`);
  }
  const files = links.filter((l) => l.file).length;
  if (files) console.log(`Файлы (не страницы): ${files}`);
  console.log(`Записано: ${rel(target)} (ссылок ${links.length})`);
  return 0;
}

// Съёмка в метку: общий путь shoot и check.
async function runShoot(p, flags, label) {
  const base = siteBase(p.params, flags);
  const cfg = loadConfig(p.root, p.mode);
  const sel = selectGroups(cfg, { only: parseOnly(flags.only), ctx: flags.ctx, vp: flags.vp });
  guard(p);
  const pw = home.loadPlaywright(home.depsDir());
  const file = home.authFile(p.root, base);
  if (sel.groups.some((g) => g.ctx.auth) && !fs.existsSync(file)) {
    throw new VisualError(3, `нет сессии входа (${file}) — node visual.js login`);
  }
  const outDir = path.join(p.visual, label);
  fs.mkdirSync(outDir, { recursive: true });
  const log = makeLog(path.join(outDir, 'shoot.log'));
  const date = new Date().toISOString();
  log(`— ${date} shoot ${label} ${base}${sel.full ? '' : ' ' + JSON.stringify(sel.filters)}`);
  const res = await require('./lib/visual/browser').shoot({
    pw, base, cfg, groups: sel.groups, outDir, authFile: file, noSetup: !!flags['no-setup'], log,
  });
  const metaFile = path.join(outDir, 'meta.json');
  writeJson(metaFile, mergeMeta(readJson(metaFile), {
    base, env: flags.env || 'прод', date, full: sel.full, filters: sel.filters,
    groups: sel.groups.map((g) => `${g.ctx.name}/${g.vp}`), setup: res.setup, pages: res.pages,
  }));
  const failed = res.pages.filter((r) => r.fail);
  const s5xx = res.pages.filter((r) => r.status >= 500);
  log(`Готово: ${res.pages.length - failed.length}/${res.pages.length} снимков → ${rel(outDir)}`);
  if (s5xx.length) log('Статус ≥ 500: ' + s5xx.map((r) => `${pageKey(r)} ${r.status}`).join(', '));
  if (failed.length) log('Не снялись: ' + failed.map((r) => `${pageKey(r)} (${r.fail})`).join(', '));
  if (res.noSession.length) return 3;
  return failed.length ? 1 : 0;
}

async function cmdShoot(a) {
  const label = checkLabel(a.positional[0], { reserved: true });
  return runShoot(project(), a.flags, label);
}

// Сравнение двух меток → папка compare-<до>-vs-<после> и сводка; useNoise — учитывать <до>/noise.json.
async function compareLabels(p, before, after, { useNoise = true } = {}) {
  const dirA = path.join(p.visual, before);
  const dirB = path.join(p.visual, after);
  for (const [l, d] of [[before, dirA], [after, dirB]]) if (!fs.existsSync(d)) throw new VisualError(2, `нет метки ${l} (${rel(d)})`);
  const libs = await home.loadImageLibs(home.depsDir());
  const metaA = readJson(path.join(dirA, 'meta.json'));
  const metaB = readJson(path.join(dirB, 'meta.json'));
  const noise = useNoise ? readJson(path.join(dirA, 'noise.json')) : null;
  const outDir = path.join(p.visual, `compare-${before}-vs-${after}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const ia = metaIndex(metaA);
  const ib = metaIndex(metaB);
  const pa = listPngs(dirA);
  const pb = listPngs(dirB);
  const rows = [];
  for (const key of [...new Set([...pa, ...pb, ...ia.keys(), ...ib.keys()])].sort()) {
    const a = ia.get(key);
    const b = ib.get(key);
    const hasA = pa.has(key) && !(a && a.fail);
    const hasB = pb.has(key) && !(b && b.fail);
    const v = presence({ hasA, hasB, a, b, fullB: isFull(metaB) });
    if (v) {
      rows.push({ key, verdict: v, reason: v === 'missing' ? (b && b.fail) || 'нет снимка «после»' : v === 'nobefore' ? a.fail : undefined });
      continue;
    }
    if (!hasA) continue;
    const img = diffPng(fs.readFileSync(path.join(dirA, key + '.png')), fs.readFileSync(path.join(dirB, key + '.png')), libs);
    fs.mkdirSync(path.dirname(path.join(outDir, key + '.png')), { recursive: true });
    fs.writeFileSync(path.join(outDir, key + '.png'), img.diff);
    const ta = path.join(dirA, key + '.txt');
    const tb = path.join(dirB, key + '.txt');
    const nz = (noise && noise.snapshots && noise.snapshots[key]) || null;
    const text = fs.existsSync(ta) && fs.existsSync(tb) ? applyTextNoise(textDiff(fs.readFileSync(ta, 'utf8'), fs.readFileSync(tb, 'utf8')), nz) : null;
    const row = { key, pct: img.pct, size: img.size, text, changes: metaChanges(a, b, nz), noise: nz ? { pct: nz.pct || 0 } : null };
    row.verdict = verdictOf(row);
    rows.push(row);
  }
  const summary = buildSummary({
    before, after, base: (metaB && metaB.base) || (metaA && metaA.base), dateBefore: metaA && metaA.date, dateAfter: metaB && metaB.date,
    rows, setup: setupChanges(metaA, metaB), noiseHint: useNoise && !noise,
  });
  writeJson(path.join(outDir, 'summary.json'), summary);
  fs.writeFileSync(path.join(outDir, 'report.html'), buildHtml(summary));
  return { summary, outDir };
}

async function cmdCompare(a) {
  const [before, after] = a.positional;
  if (!before || !after) throw new VisualError(2, 'нужны две метки: compare <до> <после>');
  checkLabel(before);
  checkLabel(after);
  const { summary, outDir } = await compareLabels(project(), before, after);
  for (const line of consoleLines(summary)) console.log(line);
  console.log('Отчёт: ' + rel(path.join(outDir, 'report.html')));
  return summary.problems ? 1 : 0;
}

async function cmdCheck(a) {
  const label = checkLabel(a.positional[0], { reserved: true });
  const p = project();
  if (!fs.existsSync(path.join(p.visual, label, 'meta.json'))) throw new VisualError(2, `нет метки ${label} — сначала shoot ${label}`);
  const check = label + '-check';
  const code = await runShoot(p, a.flags, check);
  if (code === 3) return 3;
  const { summary, outDir } = await compareLabels(p, label, check, { useNoise: false });
  const noiseFile = path.join(p.visual, label, 'noise.json');
  const fresh = noiseFromRows(summary.rows);
  writeJson(noiseFile, mergeNoise(readJson(noiseFile), fresh, check, summary.date));
  const compared = summary.rows.filter((r) => ['same', 'noise', 'diff'].includes(r.verdict));
  const zero = compared.filter((r) => r.pct === 0 && !(fresh[r.key] && (fresh[r.key].removed.length || fresh[r.key].added.length)));
  console.log(`Контрольный прогон ${check}: совпали на 0 % — ${zero.length} из ${compared.length}`);
  for (const [k, s] of Object.entries(fresh)) {
    const parts = [`${s.pct}%`];
    if (s.removed.length || s.added.length) parts.push(`текст: ${s.removed.length + s.added.length} строк`);
    if (s.errors.length) parts.push(`JS: ${s.errors.length}`);
    if (s.net.length) parts.push(`сеть: ${s.net.length}`);
    console.log(`  шум ${k}  ${parts.join('  ')}`);
  }
  for (const r of summary.rows.filter((x) => x.verdict === 'missing')) console.log(`  не снято ${r.key}  ${r.reason || ''}`);
  const statusFlaps = compared.filter((r) => r.changes.some((c) => ['status', 'final', 'uid'].includes(c.kind)));
  for (const r of statusFlaps) console.log(`  внимание ${r.key}: ${r.changes.filter((c) => ['status', 'final', 'uid'].includes(c.kind)).map((c) => c.text).join('; ')} — это не шум, разобрать`);
  console.log(`Шум: ${rel(noiseFile)}; отчёт: ${rel(path.join(outDir, 'report.html'))}`);
  return code;
}

function cmdList() {
  const p = project();
  if (!fs.existsSync(p.visual)) {
    console.log('Снимков нет: docs/visual не создан');
    return 0;
  }
  const dirs = fs.readdirSync(p.visual, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const d of dirs) {
    if (d.startsWith('compare-')) {
      const s = readJson(path.join(p.visual, d, 'summary.json'));
      if (s) console.log(`сравнение  ${d}  совпадает ${s.counts.same}, шум ${s.counts.noise}, отличается ${s.counts.diff}, не снято ${s.counts.missing}`);
      continue;
    }
    const m = readJson(path.join(p.visual, d, 'meta.json'));
    if (!m) continue;
    const ok = m.pages.filter((r) => !r.fail).length;
    const noise = fs.existsSync(path.join(p.visual, d, 'noise.json')) ? '  шум измерен' : '';
    console.log(`метка  ${d}  ${String(m.date || '').slice(0, 16).replace('T', ' ')}  снимков ${ok}  ${isFull(m) ? 'полный' : 'частичный'}  ${m.base || ''}${noise}`);
  }
  return 0;
}

const COMMANDS = { deps: cmdDeps, install: cmdInstall, login: cmdLogin, discover: cmdDiscover, shoot: cmdShoot, check: cmdCheck, compare: cmdCompare, list: cmdList };

async function main(argv) {
  const a = parseArgs(argv);
  const run = COMMANDS[a.cmd];
  if (!run) {
    console.error(USAGE);
    return 2;
  }
  return run(a);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code || 0;
  },
  (e) => {
    console.error('Ошибка: ' + (e instanceof VisualError ? e.message : (e && e.stack) || e));
    process.exitCode = e instanceof VisualError ? e.code : 1;
  },
);
```

- [ ] **Шаг 5: запустить — проходит**

Run: `node --test tests/visual-cli.test.js` → 12/12; `npm test` — зелёное.

- [ ] **Шаг 6 (контроллер): живая проверка на локальном тестовом сайте**

Без внешних сайтов и установок: мини-сайт на `localhost`, `playwright-core` — из прототипа beta (`KIT_VISUAL_DEPS`), `<дом>` — папка сессии Claude. Файлы — во временной папке сессии, в репозиторий не кладутся.

`smoke-server.js`:

```js
'use strict';
// Мини-сайт для проверки browser.js: главная со ссылками, ошибка JS, битая картинка, 500 на /order/, «вход» по cookie.
const http = require('http');
const port = Number(process.argv[2] || 8765);
const page = (title, body, uid) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<script>window.BX={message:function(k){return k==='USER_ID'?'${uid}':''}};</script></head>
<body><header><a href="/">Главная</a> <a href="/catalog/1/">Товар 1</a> <a href="/catalog/2/">Товар 2</a>
<a href="/auth/?logout=yes">Выйти</a> <a href="/price.pdf">Прайс</a> <a href="https://vk.com/x">VK</a></header>
<main>${body}</main><img src="/missing.png"><div class="timer">${Date.now()}</div></body></html>`;
http.createServer((req, res) => {
  const uid = /kituid=1/.test(req.headers.cookie || '') ? '1' : '';
  const send = (code, html) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
  if (req.url === '/missing.png') return send(404, 'no');
  if (req.url === '/order/') return send(500, page('Ошибка', '<h1>500</h1>', uid));
  if (req.url === '/login-now/') { res.writeHead(302, { 'set-cookie': 'kituid=1; Path=/', location: '/' }); return res.end(); }
  if (req.url.startsWith('/js-error/')) return send(200, page('JS', '<h1>JS</h1><script>undefinedFn()</script>', uid));
  send(200, page('Сайт ' + req.url, `<h1>Страница ${req.url}</h1><p>Строка текста</p><p style="height:3000px">Длинная</p>`, uid));
}).listen(port, () => console.log('listening ' + port));
```

Проект `smoke-proj/`: `.claude/CLAUDE.md` —
```markdown
# smoke

## Параметры для агентов

- Режим: bitrix
- Прод: http://localhost:8765
- Не выкладывать: .idea, docs/visual
```
`.claude/scripts/visual/pages.json` —
```json
{
  "mask": [".timer"],
  "contexts": {
    "guest": { "pages": [
      { "name": "home", "url": "/" },
      { "name": "js-error", "url": "/js-error/", "viewports": ["desktop"] },
      { "name": "order", "url": "/order/", "viewports": ["desktop"] }
    ] },
    "admin": { "auth": true, "viewports": ["desktop"],
      "setup": [ { "goto": "/catalog/1/" }, { "click": ".nope", "optional": true } ],
      "teardown": [ { "goto": "/catalog/2/" } ],
      "pages": [ { "name": "home", "url": "/" }, { "name": "item", "url": "/catalog/1/", "actions": [ { "hover": "header a" }, { "wait": 100 } ] } ] }
  }
}
```
Сервер — `node smoke-server.js 8765` в фоне; переменные: `KIT_VISUAL_HOME=<папка сессии>\smoke-home`, `KIT_VISUAL_DEPS=C:\OSPanel\home\beta.server\.claude\scripts\visual`; из `smoke-proj` (подоболочкой): `node <worktree>\plugins\kit\scripts\visual.js …`. Ожидаемое (проверено 2026-09-25):
- `deps` — 0; `shoot before` без сессии — 3 («нет сессии входа»);
- второй проект `smoke-login` с `"login": { "url": "/login-now/" }` и контекстом `admin` — `login` — 0 («Вход обнаружен (USER_ID=1)»: сайт сам ставит cookie, окно Chrome открывается на секунды), затем `shoot s1` — снимок с сессией; для `smoke-proj` сессию можно положить руками: `<дом>\auth\smoke-proj-<хеш>@localhost_8765.json` = `{"cookies":[{"name":"kituid","value":"1","domain":"localhost","path":"/","expires":-1,"httpOnly":false,"secure":false,"sameSite":"Lax"}],"origins":[]}` (имя файла печатает код 3);
- `discover / catalog/1/` — «С сессией», группы `/` и `/catalog/{n}/`, опасная `/auth/?logout=yes — выход`, «Файлы: 1»;
- `shoot before` — 6/6, `guest/desktop/order 500` в «Статус ≥ 500», у страниц — «ответов ≥400»;
- `check before` — шум: строка таймера во всех снимках (0 %, «текст: 2 строк»), `noise.json` записан;
- `shoot after --only item,js-error` — 2/2, частичный; `compare before after` — «совпадает 2 … не снимали 4», код 0 (таймер — шум с точностью до чисел); `compare before before-check` — «совпадает 6»;
- `list` — метки `after` (частичный), `before` (полный, «шум измерен»), `before-check` и два сравнения.

Сервер остановить (процесс `node … smoke-server.js`).

- [ ] **Шаг 7: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.8` (в NOTES — итог проверки на локальном сайте).

### Задача 10.9: скилл `/kit:visual` и справка `pages.md`

**Files:**
- Create: `plugins/kit/skills/visual/SKILL.md`
- Create: `plugins/kit/skills/visual/reference/pages.md`
- Modify: `tests/content.test.js` — новый тест перед тестом «в плагине и шаблонах нет старого имени bitrix-console»

**Interfaces:**
- Consumes: команды и коды `visual.js` (10.8); `config.js` — `validateConfig` (тест проверяет пример справки); `tests/content.test.js` — `skill(name) → { fm, body }`.
- Produces: скилл `visual` (Claude вызывает сам; `argument-hint` — `[discover | login | before | after <метка> | compare <до> <после>]`).

- [ ] **Шаг 1: тест — вставить в `tests/content.test.js` перед `test('в плагине и шаблонах нет старого имени bitrix-console', …)`**

````js
test('visual: сценарий, коды, согласие на установку, вход пользователем, фон, NOTES; пример справки проходит проверку', () => {
  const { fm, body } = skill('visual');
  assert.equal(fm.name, 'visual');
  assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
  assert.ok(fm.description.length > 40);
  for (const s of ['${CLAUDE_PLUGIN_ROOT}/scripts/visual.js', '.claude/scripts/visual/pages.json', 'docs/visual', '%LOCALAPPDATA%\\kit\\visual\\deps',
    'deps', 'install', 'login', 'discover / catalog/ personal/', 'shoot before', 'check before', 'compare before after-', '--only', '--no-setup', '--env дев',
    'AskUserQuestion', 'run_in_background', 'Пароли вводит только пользователь', '"unsafe": true', 'Excluded Paths', 'noise.json', 'report.html',
    'summary.json', 'Статусы и ошибки', 'через Read', '/kit:step-done', 'NOTES', 'не коммитить и не выкладывать', 'Git Bash', '`.idea` не править']) {
    assert.ok(body.includes(s), s);
  }
  for (const code of ['| 0 |', '| 1 |', '| 2 |', '| 3 |', '| 4 |', '| 5 |']) assert.ok(body.includes(code), 'код ' + code);
  const ref = fs.readFileSync(path.join(PLUGIN, 'skills', 'visual', 'reference', 'pages.md'), 'utf8');
  for (const s of ['clickAccept', 'fullPage', 'viewports', 'setup', 'teardown', 'unsafe', 'login', 'hide', 'mask', 'danger', 'COPY_ORDER', 'sessid']) {
    assert.ok(ref.includes(s), 'pages.md: ' + s);
  }
  const { validateConfig } = require('../plugins/kit/scripts/lib/visual/config');
  const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(ref)[1]);
  assert.deepEqual(validateConfig(example, 'bitrix').contexts.map((c) => c.name), ['guest', 'admin']);
});
````

- [ ] **Шаг 2: запустить — падает**

Run: `node --test tests/content.test.js`
Expected: FAIL — «нет frontmatter: …skills\visual\SKILL.md» (файла нет).

- [ ] **Шаг 3: `plugins/kit/skills/visual/SKILL.md`**

````markdown
---
name: visual
description: Снимки публичной части сайта «до/после» и их сравнение — перед обновлением ядра, модулей или шаблона и после каждого шага, который может задеть вид страниц. Список страниц проекта, вход администратора (входит пользователь), эталон, контрольный прогон для замера шума, снимки «после», сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт. Снимки — только локально в docs/visual.
argument-hint: "[discover | login | before | after <метка> | compare <до> <после>]"
---

# Снимки «до/после» и сравнение

Инструмент — `node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" <команда>`; все команды — из корня проекта, без `cd`. Дальше `visual.js` — сокращение этой команды.

| Что | Где |
|---|---|
| Список страниц проекта | `.claude/scripts/visual/pages.json` — в git; формат и рецепты — `${CLAUDE_PLUGIN_ROOT}/skills/visual/reference/pages.md` |
| Снимки, сравнения, `links.json` | `docs/visual/…` — **только локально**: не коммитить и не выкладывать (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`) |
| Зависимости (playwright-core, pixelmatch, pngjs) | `%LOCALAPPDATA%\kit\visual\deps` — одни на все проекты |
| Сессия входа | `%LOCALAPPDATA%\kit\visual\auth\…` — вне проекта, своя на проект и хост |

Адрес сайта — параметр «Прод»; для дева — `--env дев` («Дев»); вне kit-проекта — `--url https://…`.

## Правила

- Пароли вводит только пользователь: `login` открывает окно Chrome, вход — его руками. Claude в это окно ничего не вводит.
- Опасные адреса (выход, отмена и повтор заказа, `action=`, `sessid=`, удаление, `/bitrix/`) не снимать. `"unsafe": true` в `pages.json` — только с согласия пользователя на конкретный адрес (AskUserQuestion).
- `docs/visual` не коммитить и не выкладывать; снимки и метки не удалять без согласия пользователя.
- `.idea` не править: код 4 — пользователь сам добавляет исключение в PhpStorm.
- Установка зависимостей — только после согласия пользователя (п. 1).
- Долгие команды — `login`, полный `shoot`, `check` — запускай в фоне (Bash с `run_in_background`) и жди уведомления о завершении: окно входа ждёт до 15 минут, полный прогон — минуты, это дольше лимита одного вызова. Вывод `shoot` дублируется в `docs/visual/<метка>/shoot.log`.
- Git Bash переписывает аргументы, начинающиеся с `/` (`discover /catalog/` → `C:/Program Files/Git/catalog/`). Инструмент это исправляет, но надёжнее передавать адреса без ведущего `/`: `discover catalog/ personal/`.

## 1. Подготовка

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" deps
```
- Код 0 — дальше.
- Код 5 — зависимостей нет или версии другие. Спроси через AskUserQuestion: «Поставить зависимости снимков (~15 МБ: playwright-core, pixelmatch, pngjs) в `%LOCALAPPDATA%\kit\visual\deps` командой `npm install`? Один раз на машину для всех проектов». Варианты «Поставить» / «Не сейчас». После «Поставить»:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" install
  ```
- Код 5 при съёмке с причиной «не удалось запустить Chrome» — нужен установленный Google Chrome (браузеры Playwright не скачиваются): скажи пользователю.

## 2. Страницы — один раз на проект

`pages.json` уже есть — пропусти. Иначе:
1. Если на сайте есть вход (личный кабинет, корзина, админка) — сначала п. 3 (`login`): с сессией `discover` видит ссылки личного кабинета.
2. Собери ссылки — главная и разделы меню (разделы — без ведущего `/`):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" discover / catalog/ personal/
   ```
   `/` — главная; без аргументов — только главная. Вывод: затравки (статус, заголовок, USER_ID), группы похожих ссылок с числом и примером, опасные, файлы. Всё — в `docs/visual/links.json`.
3. Составь список: по одной странице на группу (одна карточка товара, один раздел каталога, одна новость), главная, 404 (`/net-takoj-stranicy-visual/`), поиск с запросом. Контексты: `guest` — гость; `admin` (`"auth": true`) — страницы под входом. Для магазина — `setup`/`teardown` корзины, чтобы у админа корзина и оформление снимались с товарами (рецепт в справке). Опасные адреса не бери.
4. Покажи список пользователю (контекст, имя, адрес) — AskUserQuestion «Снимаем эти страницы?» с вариантами «Да» / «Поправлю» (правки — через «Другое»). После «Да» запиши `.claude/scripts/visual/pages.json` (Write). Файл войдёт в коммит шага.

## 3. Вход

Нужен, если в `pages.json` есть контекст с `"auth": true`.
1. Запусти в фоне:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" login
   ```
2. Сразу скажи пользователю: «Открылось окно Chrome — войдите на сайт под администратором. Окно закроется само, как только вход будет обнаружен (до 15 минут)».
3. Дождись завершения: код 0 — сессия сохранена; код 3 — вход не обнаружен или окно закрыто. Повтор — по просьбе пользователя.

Сессия истекла (код 3 у `shoot`/`check`: «нет входа») — снова `login`.

## 4. Эталон и контрольный прогон

Перед изменением (обновлением, правкой шаблона):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" shoot before
node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" check before
```
Обе — в фоне, по очереди. `check` снимает `before-check` теми же настройками и сравнивает с `before`: что разошлось между двумя одинаковыми прогонами — шум (строки текста — с точностью до чисел, JS-ошибки, ответы), он пишется в `docs/visual/before/noise.json` и дальше не считается отличием. Скажи пользователю: сколько совпало на 0 %, какие страницы шумят и насколько, какие страницы не снялись. Строки «внимание … статус …» в выводе `check` — не шум: статус страницы скачет, разберись.

Эталон уже есть — не переснимай без просьбы пользователя: метку (`before`, `main-25.200`) выбери вместе с ним.

## 5. После изменения

1. Сними метку по ID шага:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" shoot after-<ID шага>
   ```
   Целиком — после обновления ядра, модулей, шаблона. Точечно — `--only имя1,имя2` (страницы, которые шаг затрагивает); `setup` контекста выполняется и тогда (иначе в шапке меняется счётчик корзины); пропустить его — `--no-setup`, только если пользователь просит. Фильтры `--ctx admin`, `--vp mobile`. Частичный прогон в существующую метку дописывает её.
2. Сравни с эталоном:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/visual.js" compare before after-<ID шага>
   ```
3. Разбор — в таком порядке:
   - **«Статусы и ошибки»** — смена статуса (200 → 500), редирект, USER_ID, новые JS-ошибки, новые ответы ≥ 400: это главное, разбери каждую строку;
   - **«Отличается»** — открой дифф-картинку `docs/visual/compare-<до>-vs-<после>/<контекст>/<ширина>/<имя>.png` и оба снимка (`docs/visual/<метка>/…png`) через Read и посмотри сам, что изменилось; текст — пропавшие и появившиеся строки в выводе и в `summary.json` той же папки;
   - «В пределах шума» и «не снимали» — только упомянуть.
4. Доклад пользователю: что отличается и почему (ожидаемо или поломка), что в пределах шума, путь к отчёту `docs/visual/compare-<до>-vs-<после>/report.html` (открыть в браузере).

## 6. Коды

| Код | Что | Действие |
|---|---|---|
| 0 | норма | дальше |
| 1 | `shoot`/`check` — страницы не снялись; `compare` — отличия сверх шума | разобрать: причина в выводе |
| 2 | аргументы или `pages.json`: опасный адрес без `unsafe`, опечатка в ключе, нет страницы, нет адреса сайта, нет метки | исправить |
| 3 | нет сессии, истекла, вход не обнаружен | п. 3 |
| 4 | PhpStorm заливает каждое сохранение (Always), а `docs/visual` не исключён | сказать пользователю: Settings → Build, Execution, Deployment → Deployment → сервер → Excluded Paths → локальный путь `docs/visual` (справка `${CLAUDE_PLUGIN_ROOT}/skills/project-init/reference/phpstorm.md`); повторить после его «готово» |
| 5 | нет зависимостей или Chrome | п. 1 |

Предупреждение «в «Не выкладывать» нет docs/visual» — предложи пользователю дописать `docs/visual` в параметр «Не выкладывать» `.claude/CLAUDE.md` (через `/kit:step-done`, блок RULES).

## 7. Закрытие шага

В `/kit:step-done` — NOTES: метки и сравнение (`compare before after-1.1`), итог (совпадает / в пределах шума / что отличается, статусы и ошибки), путь к `report.html`. Снимки в FILES не входят; изменённый `.claude/scripts/visual/pages.json` — входит.

Прочее: `visual.js list` — метки (дата, число снимков, полный или частичный прогон, измерен ли шум) и сравнения.
````

- [ ] **Шаг 4: `plugins/kit/skills/visual/reference/pages.md`**

````markdown
# pages.json — список страниц для снимков

Файл проекта: `.claude/scripts/visual/pages.json` (в git). Проверяется до запуска браузера: опечатка в ключе, повтор имени, адрес без `/`, опасный адрес — код 2 со списком всех ошибок. Ключи, начинающиеся с `_`, — комментарии.

## Пример (магазин на Битриксе + Аспро)

```json
{
  "_comment": "Гость и администратор; у администратора корзина с двумя товарами",
  "contexts": {
    "guest": {
      "pages": [
        { "name": "home", "url": "/" },
        { "name": "catalog", "url": "/catalog/" },
        { "name": "product", "url": "/catalog/section_a/1001/" },
        { "name": "search", "url": "/catalog/?q=%D1%82%D0%BE%D0%B2%D0%B0%D1%80" },
        { "name": "basket-empty", "url": "/basket/" },
        { "name": "404", "url": "/net-takoj-stranicy-visual/" }
      ]
    },
    "admin": {
      "auth": true,
      "setup": [
        { "goto": "/basket/" },
        { "clickAccept": ".remove_all_basket", "optional": true },
        { "wait": 1500 },
        { "goto": "/catalog/section_a/1001/" },
        { "fill": ".buy_block-input", "nth": 0, "value": "1" },
        { "click": ".buy_block-submit" },
        { "wait": 2500 }
      ],
      "pages": [
        { "name": "home", "url": "/" },
        { "name": "catalog-popup", "url": "/", "fullPage": false, "viewports": ["desktop"],
          "actions": [ { "hover": "header a.dropdown-toggle[href='/catalog/']" }, { "wait": 1200 } ] },
        { "name": "basket", "url": "/basket/" },
        { "name": "order", "url": "/order/" },
        { "name": "personal-orders", "url": "/personal/orders/" }
      ],
      "teardown": [
        { "goto": "/basket/" },
        { "clickAccept": ".remove_all_basket", "optional": true },
        { "wait": 2000 }
      ]
    }
  }
}
```

## Ключи

**Верхний уровень:**
- `contexts` — обязательно: `{ имя: контекст }`. Имя — латиница, цифры, `.`, `_`, `-`; папка снимков — `docs/visual/<метка>/<контекст>/<ширина>/<имя страницы>.png`.
- `login` — `{ "url": "/auth/", "check": "…" }`: страница входа и выражение JS, которое у вошедшего пользователя возвращает его ID (пусто или `0` — не вошёл). По умолчанию (режим `bitrix` и вне kit-проекта) — `window.BX && BX.message && BX.message('USER_ID')`. В общем режиме для контекста с `auth` — обязательно, например `document.querySelector('.user-menu [data-id]')?.dataset.id`.
- `hide` — селекторы, которые скрыть на всех страницах (`display:none`): баннеры, чаты, cookie-плашки. Панель Битрикса, `.style-switcher` Аспро и jivo скрыты всегда.
- `mask` — селекторы, которые закрасить (элемент остаётся на месте, размер страницы тот же): таймеры, счётчики, случайные блоки.
- `danger` — свои опасные адреса (регулярные выражения без учёта регистра), в дополнение к встроенным.

**Контекст:**
- `auth` — `true`: снимать с сессией входа (`visual.js login`). Без сессии или с истёкшей — код 3, под этим контекстом ничего не снимается.
- `viewports` — `["desktop", "mobile"]` по умолчанию: 1920×1080 и iPhone 13 (390, dsf 1).
- `setup` / `teardown` — действия до и после страниц контекста — для каждой ширины; выполняются и при `--only`; пропустить — `--no-setup`.
- `pages` — страницы; `hide`, `mask` — для всех страниц контекста.

**Страница:**
- `name` — имя файла (уникально в контексте); `url` — от корня сайта, с `/`.
- `fullPage` — `false`: только первый экран (для выпадающих меню и попапов); по умолчанию — вся высота.
- `viewports` — только эти ширины.
- `actions` — действия после загрузки и стабилизации, перед снимком (пауза 500 мс после них).
- `hide`, `mask` — только для этой страницы.
- `unsafe` — `true`: снимать опасный адрес. Только с согласия пользователя.

**Действие** — объект с одним или несколькими ключами; выполняются в порядке: `goto` (адрес от корня; опасный — только с `"unsafe": true`), `click`, `clickAccept` (клик и подтверждение окна `confirm()` — «Очистить корзину?»), `clickText` (по тексту), `hover`, `fill` (+ `nth` — какой по счёту, с 0; `value` — по умолчанию `"1"`), `eval` (JS в странице), `wait` (мс), `waitFor` (селектор). `"optional": true` — ошибка не прерывает (клик ждёт 3 с вместо 15).

## Опасные адреса (встроенные)

Выход (`logout`), отмена заказа (`/cancel/`, `CANCEL=Y`), повтор заказа (`COPY_ORDER=`), действие через GET (`action=`: в корзину, в сравнение, удалить), удаление (`del=`, `delete=`, `remove=`, `/delete/`, `/remove/`), ссылки с `sessid=` (токен Битрикса — ссылка что-то меняет), `unsubscribe`, `clear_cache`, служебное `/bitrix/`. `discover` их помечает; `shoot` и `check` с таким адресом в `url` или `goto` не запускаются.

## Рецепты

- **Корзина у администратора** (Аспро): в `setup` — очистить (`clickAccept` на `.remove_all_basket`, `optional`), открыть карточку, `fill` количества и `click` кнопки «В корзину», `wait` 2–3 с; в `teardown` — очистить. Без этого корзина, оформление и счётчик в шапке зависят от того, что лежало в корзине. Селекторы другого шаблона — посмотреть на странице.
- **Выпадающее меню каталога** — страница `/` с `"fullPage": false`, `"viewports": ["desktop"]`, `actions`: `hover` на пункт меню и `wait` 1200.
- **Вкладки, аккордеоны, попапы** — `click` по заголовку и `wait`; попап — `fullPage: false`.
- **404** — адрес, которого точно нет: `/net-takoj-stranicy-visual/`.
- **Поиск** — адрес с запросом (`/catalog/?q=…`, `/search/?q=…`); порядок результатов бывает случайным — контрольный прогон это покажет, дальше такие строки считаются шумом.
- **Заказ в личном кабинете** — адрес просмотра (`/personal/order/1/`), не отмены и не повтора.
- **Меняющийся блок** (таймер акции, «сейчас на сайте N») — в `mask`; случайный баннер — в `hide`.
````

- [ ] **Шаг 5: запустить — проходит**

Run: `node --test tests/content.test.js` — всё ✔ (в том числе «ссылки `${CLAUDE_PLUGIN_ROOT}/…` ведут на существующие файлы»); `npm test` — зелёное.

- [ ] **Шаг 6: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.9`.

### Задача 10.10: интеграции, README, версия 2.2.0

**Files:**
- Modify: `plugins/kit/skills/project-init/SKILL.md`, `plugins/kit/skills/project-init/reference/phpstorm.md`, `plugins/kit/skills/project-init/templates/CLAUDE.md`, `plugins/kit/skills/project-init/templates/gitignore-bitrix`, `plugins/kit/skills/project-init/templates/gitignore-general`
- Modify: `plugins/kit/skills/step-done/SKILL.md`
- Modify: `tests/content.test.js`, `tests/templates.test.js`
- Modify: `README.md`, `plugins/kit/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: скилл `visual` (10.9), защита выкладки (10.7).
- Produces: `docs/visual` в исключениях выкладки project-init (вариант вопроса 3), в шаблонах `.gitignore` и `CLAUDE.md`, в справке PhpStorm; NOTES про снимки в step-done; версия 2.2.0.

- [ ] **Шаг 1: тесты — `tests/content.test.js` (step-done, project-init, шаблон и справка PhpStorm) и `tests/templates.test.js`**

```diff
--- a/tests/content.test.js
+++ b/tests/content.test.js
@@ -74,7 +74,8 @@
   assert.notEqual(fm['disable-model-invocation'], 'true', 'Claude вызывает сам');
   for (const s of ['kit:docs-keeper', 'kit:git-keeper', 'rev-list --count', 'COAUTHOR', 'COMMITS', 'KIT_ROOT',
     'AskUserQuestion', 'general-purpose', '/kit:project-init', 'Сам коммит не делай',
-    'git log -1 --format=%s', 'совпадает с MESSAGE целиком', 'git -c core.quotepath=false status --porcelain=v1']) {
+    'git log -1 --format=%s', 'совпадает с MESSAGE целиком', 'git -c core.quotepath=false status --porcelain=v1',
+    '/kit:visual', 'docs/visual/', '.claude/scripts/visual/pages.json']) {
     assert.ok(body.includes(s), s);
   }
   assert.doesNotMatch(body, /^\s*git status/m, 'пути — только с core.quotepath=false');
@@ -96,7 +97,7 @@
     'webServers.xml', '0.1: Исходники с прода (копия прода)', 'kit:git-keeper', '/kit:step-done', 'core.autocrlf', 'core.quotepath',
     'Варианта «это не секрет» нет', '4.0', 'сам не коммить', 'не больше 4 вопросов', 'Grep с `-o` по `rootFolder=',
     '403 на папку ещё не доказывает',
-    '`.claude/scripts`, `.claude/settings.local.json` и `.claude/worktrees` (Рекомендую)', 'сервера автозаливки',
+    '`.claude/scripts`, `.claude/settings.local.json`, `.claude/worktrees` и `docs/visual` (Рекомендую)', 'сервера автозаливки',
     'Always только на дев — дев', 'вопрос 3 (исключения; всегда `.idea` и `.git`)',
     '4.5 Проверки выкладки — любой режим, если известен адрес сервера (прод, дев или адрес из п. 4.0)', 'по обоим',
     'после 2–3 повторов — как в п. 4.0',
@@ -123,7 +124,8 @@
     assert.ok(body.includes(s), s);
   }
   assert.ok(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8').includes('`.claude/worktrees`'));
-  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: .*\.claude\/worktrees/);
+  assert.match(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', 'CLAUDE.md'), 'utf8'), /- Не выкладывать: .*\.claude\/worktrees, docs\/visual/);
+  assert.ok(fs.readFileSync(path.join(PLUGIN, 'skills', 'project-init', 'reference', 'phpstorm.md'), 'utf8').includes('`docs/visual`'));
   for (const t of ['CLAUDE.md', 'progress.md', 'deploy-prod.md', 'gitignore-bitrix', 'gitignore-general', 'htaccess-deny']) {
     assert.ok(body.includes('`' + t + '`'), 'скилл не называет шаблон ' + t);
     assert.ok(fs.existsSync(path.join(PLUGIN, 'skills', 'project-init', 'templates', t)), 'нет шаблона ' + t);
```

```diff
--- a/tests/templates.test.js
+++ b/tests/templates.test.js
@@ -21,10 +21,10 @@
 }
 
 test('gitignore-bitrix: служебное, ядро и секреты игнорируются, правила, скрипты и материалы — в git', () => {
-  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php',
+  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.claude/agents/docs-keeper.md', '.claude/worktrees/x/index.php', 'docs/visual/before/admin/desktop/home.png',
     'bitrix/.settings.php', 'upload/iblock/a.jpg', 'local/x.php.back1',
     '.env', '.env.local', 'local/.env.production', 'cert/site.pem', 'local/ssl/private.key'];
-  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', 'upload/docs/a.png', 'local/templates/x/a.php',
+  const no = ['.claude/CLAUDE.md', '.claude/.htaccess', '.claude/scripts/01-inventory.php', '.claude/scripts/visual/pages.json', 'upload/docs/a.png', 'local/templates/x/a.php',
     'local/templates/x/components/bitrix/news.list/.default/template.php', 'docs/progress.md', 'local/php_interface/env.php',
     '.env.example', 'local/.env.example'];
   const set = ignored(read('gitignore-bitrix'), [...yes, ...no]);
@@ -33,8 +33,8 @@
 });
 
 test('gitignore-general: служебное и секреты игнорируются', () => {
-  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1'];
-  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', 'src/a.php', 'docs/progress.md', '.env.example'];
+  const yes = ['.idea/workspace.xml', '.claude/settings.local.json', '.env', '.env.local', 'node_modules/a/b.js', 'x.php.back1', 'docs/visual/links.json'];
+  const no = ['.claude/CLAUDE.md', '.claude/scripts/a.php', '.claude/scripts/visual/pages.json', 'src/a.php', 'docs/progress.md', '.env.example'];
   const set = ignored(read('gitignore-general'), [...yes, ...no]);
   for (const p of yes) assert.ok(set.has(p), 'должен игнорироваться: ' + p);
   for (const p of no) assert.ok(!set.has(p), 'не должен игнорироваться: ' + p);
```

- [ ] **Шаг 2: запустить — падает**

Run: `node --test tests/content.test.js tests/templates.test.js`
Expected: FAIL — step-done: `/kit:visual`; project-init: строка варианта с `docs/visual`; шаблон `CLAUDE.md`: «Не выкладывать» без `docs/visual`; gitignore: `docs/visual/…` не игнорируется.

- [ ] **Шаг 3: project-init, справка PhpStorm, шаблоны**

```diff
--- a/plugins/kit/skills/project-init/SKILL.md
+++ b/plugins/kit/skills/project-init/SKILL.md
@@ -33,7 +33,7 @@
 Второй вызов — не больше 4 вопросов, в каждом 2–4 варианта:
 1. Адрес прода: `https://<домен из rootFolder>` (Рекомендую) и `https://www.<домен>`; догадки нет — «Прода пока нет» / «Введу адрес в «Другое»».
 2. Задача: «Без задачи» / «Есть — номер и название в «Другое»».
-3. Исключения деплоя (мультивыбор, 4 варианта): «`.idea` и `.git` (Рекомендую)», «`.claude/scripts`, `.claude/settings.local.json` и `.claude/worktrees` (Рекомендую)», «`.gitignore`», «`local/modules`»; уже исключённые в `deployment.xml` перечисли в тексте вопроса. `.claude/worktrees` — git worktree, которые Claude Code (десктоп) создаёт внутри проекта: полная копия сайта, при автозаливке уехала бы на сервер.
+3. Исключения деплоя (мультивыбор, 4 варианта): «`.idea` и `.git` (Рекомендую)», «`.claude/scripts`, `.claude/settings.local.json`, `.claude/worktrees` и `docs/visual` (Рекомендую)», «`.gitignore`», «`local/modules`»; уже исключённые в `deployment.xml` перечисли в тексте вопроса. `.claude/worktrees` — git worktree, которые Claude Code (десктоп) создаёт внутри проекта: полная копия сайта, при автозаливке уехала бы на сервер. `docs/visual` — снимки `/kit:visual` из-под админа: nginx отдаёт картинки мимо `.htaccess`.
 4. Только режим «bitrix» и если в `watcherTasks.xml` есть включённые вотчеры: оставить / убрать (вотчеры срабатывают и на правки Claude — см. справку phpstorm.md).
 
 Адрес дева (при «дев + прод») — третьим вызовом.
```

```diff
--- a/plugins/kit/skills/project-init/reference/phpstorm.md
+++ b/plugins/kit/skills/project-init/reference/phpstorm.md
@@ -22,6 +22,7 @@
 - `.claude/scripts` — скрипты Командной PHP-строки: в git есть, на сервере не нужны.
 - Служебные файлы Claude Code в `.claude`: `settings.local.json` и любые новые — Claude Code может завести их позже; при появлении добавлять в исключения.
 - `.claude/worktrees` — git worktree, которые Claude Code (десктоп) создаёт внутри проекта: в каждом полная копия сайта. Без исключения при автозаливке она уедет на сервер; правки в worktree попадают на сервер только после слияния в основную ветку основной папки.
+- `docs/visual` — снимки `/kit:visual`, сделанные из-под администратора: на сервер нельзя (nginx отдаёт картинки мимо `.htaccess`). При автозаливке без этого исключения `visual.js` не снимает (код 4).
 - `.claude/CLAUDE.md` и `docs/` можно выкладывать: папки закрыты `.htaccess`, проверка — `check-closed.js`. Или исключить `.claude` целиком — решает пользователь.
 - `local/modules/` — если модули лежат в проекте только для чтения.
 
```

```diff
--- a/plugins/kit/skills/project-init/templates/CLAUDE.md
+++ b/plugins/kit/skills/project-init/templates/CLAUDE.md
@@ -24,6 +24,7 @@
 
 - {{Что нельзя сломать: живые страницы, формы в CRM, оплата, почта — и чем это защищено}}
 - Секреты — только в {{/bitrix/.settings_extra.php | .env (в git не попадает)}}, в git не класть.
+- Снимки публичной части (`/kit:visual`) — в `docs/visual/`, только локально: в git и на сервер не попадают (снимки из-под админа; nginx отдаёт картинки мимо `.htaccess`).
 
 ## Как работаем
 
@@ -54,6 +55,6 @@
 - Журнал: docs/progress.md
 - План выкладки: docs/deploy-prod.md
 - ID шага: N.M (например 0.3, 2.1)
-- Не выкладывать: {{ИСКЛЮЧЕНИЯ — через запятую: всегда .idea, .git; обычно .claude/scripts, .claude/settings.local.json, .claude/worktrees}}
+- Не выкладывать: {{ИСКЛЮЧЕНИЯ — через запятую: всегда .idea, .git; обычно .claude/scripts, .claude/settings.local.json, .claude/worktrees, docs/visual}}
 - Не коммитить: {{bitrix/, upload/ (кроме upload/docs/), *.back* | *.back*}}
 - Секреты: {{подстроки секретов проекта | —}}
```

```diff
--- a/plugins/kit/skills/project-init/templates/gitignore-bitrix
+++ b/plugins/kit/skills/project-init/templates/gitignore-bitrix
@@ -6,6 +6,9 @@
 !/.claude/scripts/
 !/.claude/scripts/**
 
+# Снимки /kit:visual — только локально (из-под админа)
+/docs/visual/
+
 # Ядро и загрузки Битрикса (секреты — в bitrix/.settings_extra.php); материалы задачи — в upload/docs/
 /bitrix/
 /upload/*
```

```diff
--- a/plugins/kit/skills/project-init/templates/gitignore-general
+++ b/plugins/kit/skills/project-init/templates/gitignore-general
@@ -6,6 +6,9 @@
 !/.claude/scripts/
 !/.claude/scripts/**
 
+# Снимки /kit:visual — только локально (из-под админа)
+/docs/visual/
+
 # Секреты и зависимости
 .env
 .env.*
```

- [ ] **Шаг 4: step-done**

````diff
--- a/plugins/kit/skills/step-done/SKILL.md
+++ b/plugins/kit/skills/step-done/SKILL.md
@@ -30,6 +30,8 @@
 - `STEP` — ID шага (аргумент команды, если передан), `STATUS`, `SUMMARY` (одна строка: что сделано и как проверено), `NEXT` (ID и одна строка);
 - по необходимости `STAGE`, `DECISIONS` (дата `YYYY-MM-DD` и текст), `BUGS`, `PROD_TODO`, `DEPLOY` (`Файлы`, `Коммит`, `Удалить`, `Проверка`, `Чек-лист`), `NOTES`, `RULES`.
 
+На шаге снимали или сравнивали снимки (`/kit:visual`) — в NOTES: метки, какое сравнение и итог (совпадает / в пределах шума / что отличается, статусы и ошибки), путь к `report.html`. Снимки `docs/visual/` в FILES не включай (только локально, git-keeper их не пропустит); изменённый `.claude/scripts/visual/pages.json` — включай.
+
 `COMMITS` — хеши прошлых шагов из истории git:
 ```
 git log --format="%h %s" -50
````

- [ ] **Шаг 5: README и версия 2.2.0**

```diff
--- a/README.md
+++ b/README.md
@@ -1,6 +1,6 @@
 # claude-kit
 
-Личный маркетплейс Claude Code с плагином **kit**: каркас работы над проектами (журнал, агенты журнала и git, закрытие шага, хуки правил процесса и `php -l`) и модуль для сайтов на 1С-Битрикс (инициализация проекта, работа на сервере по SSH или через Командную PHP-строку, проверки выкладки).
+Личный маркетплейс Claude Code с плагином **kit**: каркас работы над проектами (журнал, агенты журнала и git, закрытие шага, хуки правил процесса и `php -l`) и модуль для сайтов на 1С-Битрикс (инициализация проекта, работа на сервере по SSH или через Командную PHP-строку, проверки выкладки, снимки публичной части «до/после»).
 
 ## Установка
 
@@ -43,6 +43,7 @@
 | `/kit:step-done` | Claude сам после проверенного шага или командой | журнал (docs-keeper) → один коммит (git-keeper) → проверка |
 | `/kit:deploy-list` | командой или Claude | что залить и что удалить на сервере с последней выкладки |
 | `/kit:server` | Claude при необходимости | работа на сервере: сначала SSH (команды оболочки, PHP через `remote-php.js`), иначе Командная PHP-строка в Chrome; чтение — сразу, изменения — с согласия |
+| `/kit:visual` | Claude перед изменением и после или командой | снимки публичной части «до/после» (гость и админ, 1920 и 390), контрольный прогон для замера шума, сравнение пикселей, текста, статусов, JS-ошибок и ответов 4xx/5xx, отчёт `report.html` |
 | `kit:docs-keeper` (sonnet) | из `/kit:step-done` | журнал, план выкладки, правила проекта |
 | `kit:git-keeper` (haiku) | из `/kit:step-done` | один коммит, проверка путей и секретов, подпись дословно |
 | хук SessionStart | сам | раздел «Сейчас» и правила процесса в контекст — при старте, после `/clear` и после сжатия |
@@ -85,6 +86,13 @@
 
 Полное описание ключей — `docs/spec-claude-kit.md`, раздел 5.
 
+## Снимки «до/после» (`/kit:visual`, с 2.2.0)
+
+- Нужен установленный Google Chrome (браузеры Playwright не скачиваются) и один раз на машину — зависимости: Claude спросит и выполнит `node visual.js install` — `npm install` playwright-core, pixelmatch, pngjs (~15 МБ) в `%LOCALAPPDATA%\kit\visual\deps`. Обновления плагина их не трогают.
+- Список страниц проекта — `.claude/scripts/visual/pages.json` (в git); снимки — `docs/visual/`, **только локально**: инструмент сам кладёт туда `.gitignore` и не снимает, если PhpStorm с автозаливкой Always не исключает `docs/visual` (снимки из-под админа, nginx отдаёт картинки мимо `.htaccess`).
+- Вход администратора — окно Chrome, входите вы сами; сессия хранится в `%LOCALAPPDATA%\kit\visual\auth`, своя на каждый проект.
+- В проектах, созданных до 2.2.0: дописать `docs/visual` в «Не выкладывать» и в исключения PhpStorm (или `/kit:project-init` предложит это сам).
+
 ## Переход с 1.x на 2.0
 
 - Команда `/kit:bitrix-console` переименована в `/kit:server`: сначала SSH, иначе прежняя Командная PHP-строка. В `docs/deploy-prod.md` и `.claude/CLAUDE.md` проектов заменить `/kit:bitrix-console` на `/kit:server`.
@@ -99,7 +107,8 @@
 
 ## Разработка
 
-- Тесты: `npm test` (`node --test tests/*.test.js`); PHP-тесты используют `C:\OSPanel\modules\PHP-7.2`, `PHP-7.4`, `PHP-8.3` и пропускаются, если их нет.
+- Тесты: `npm ci` один раз (devDependencies `pngjs` и `pixelmatch` — для тестов сравнения снимков), затем `npm test` (`node --test tests/*.test.js`); PHP-тесты используют `C:\OSPanel\modules\PHP-7.2`, `PHP-7.4`, `PHP-8.3` и пропускаются, если их нет.
 - Проверка манифестов: `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict`.
 - Запуск без установки: `claude --plugin-dir C:\OSPanel\home\claude-kit\plugins\kit`.
-- Журнал разработки — `docs/progress.md`, спек — `docs/spec-claude-kit.md`, планы — `docs/plan-claude-kit.md` (этапы 0–6) и `docs/plan-ssh.md` (этап 8).
+- Журнал разработки — `docs/progress.md`, спек — `docs/spec-claude-kit.md`, планы — `docs/plan-claude-kit.md` (этапы 0–6) `docs/plan-ssh.md` (этап 8) и `docs/plan-visual.md` (этап 10).
+- Снимки вживую (Chrome и сайт) тестами не проверяются: `node plugins/kit/scripts/visual.js …` из корня проекта; `KIT_VISUAL_HOME` — другая папка на машине вместо `%LOCALAPPDATA%\kit\visual`, `KIT_VISUAL_DEPS` — папка с `node_modules` (так тесты берут зависимости из корня репозитория).
```

```diff
--- a/plugins/kit/.claude-plugin/plugin.json
+++ b/plugins/kit/.claude-plugin/plugin.json
@@ -1,7 +1,7 @@
 {
   "name": "kit",
-  "version": "2.1.0",
-  "description": "Каркас работы над проектами: журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку.",
+  "version": "2.2.0",
+  "description": "Каркас работы над проектами: журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, хуки правил процесса и php -l; модуль для сайтов на 1С-Битрикс; работа на сервере по SSH или через Командную PHP-строку; снимки публичной части «до/после» и их сравнение.",
   "author": { "name": "Mikle Seregin" },
-  "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh"]
+  "keywords": ["bitrix", "workflow", "journal", "git", "phpstorm", "ssh", "screenshots"]
 }
```

```diff
--- a/.claude-plugin/marketplace.json
+++ b/.claude-plugin/marketplace.json
@@ -8,8 +8,8 @@
     {
       "name": "kit",
       "source": "./plugins/kit",
-      "description": "Журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, хуки правил и php -l.",
-      "version": "2.1.0",
+      "description": "Журнал docs/progress.md, агенты docs-keeper и git-keeper, закрытие шага, инициализация проекта, работа на сервере по SSH или через Командную PHP-строку Битрикса, снимки «до/после» и сравнение, хуки правил и php -l.",
+      "version": "2.2.0",
       "author": { "name": "Mikle Seregin" }
     }
   ]
```

- [ ] **Шаг 6: запустить — проходит; манифесты**

Run: `npm test` — 247 тестов: 244 ✔, 3 пропущены (симлинки, как в `master`), 0 ✖.
Run: `claude plugin validate plugins/kit --strict` и `claude plugin validate . --strict` — без ошибок и предупреждений.
Run: `claude --plugin-dir C:\OSPanel\home\claude-kit\.claude\worktrees\gracious-feynman-b8796e\plugins\kit plugin details kit` — 2.2.0, скиллы deploy-list, project-init, server, step-done, visual.

- [ ] **Шаг 7: закрыть шаг (контроллер)** — ревью, `/kit:step-done 10.10`. **Остановка на проверку пользователя (часть B).**

---

## Часть C — живая проверка

### Задача 10.11: beta (контроллер с пользователем)

Проект: `C:\OSPanel\home\beta.server` (kit-проект: «Прод: https://beta.example.com», PhpStorm Always с исключением `docs/visual`, прототип — `.claude/scripts/visual/visual.mjs`, эталон прототипа — `docs/visual/before`). Инструмент — из worktree: `V=C:\OSPanel\home\claude-kit\.claude\worktrees\gracious-feynman-b8796e\plugins\kit\scripts\visual.js`; все команды — подоболочкой из корня beta (`( cd /c/OSPanel/home/beta.server && node "$V" … )`) или PowerShell с `-WorkingDirectory`.

- [ ] **Шаг 1: согласие** — AskUserQuestion одним вопросом с перечнем:
  1. `npm install` зависимостей снимков (~15 МБ) в `%LOCALAPPDATA%\kit\visual\deps`;
  2. съёмка прода https://beta.example.com в Chrome: только открытие страниц, кроме setup/teardown контекста `admin` (как у прототипа: в корзину администратора кладутся два тестовых товара, в конце корзина очищается);
  3. вход — окно Chrome, входит пользователь;
  4. новые метки `proto-now`, `kit-now`, `kit-now-check` и `links.json` в `docs/visual` beta (только локально; прежний `links.json` прототипа сохраняется как `links-proto.json`).
- [ ] **Шаг 2: зависимости** — `node "$V" deps` → 5 → `node "$V" install` → `node "$V" deps` → 0.
- [ ] **Шаг 3: защита выкладки** — в `docs/visual` уже есть `.gitignore` beta: инструмент его не трогает; `.idea/deployment.xml` исключает `docs/visual` — кода 4 нет.
- [ ] **Шаг 4: вход** — `node "$V" login` в фоне; пользователю — «войдите в открывшемся окне Chrome под администратором»; код 0, путь сессии `%LOCALAPPDATA%\kit\visual\auth\beta.server-<хеш>@beta.example.com.json`.
- [ ] **Шаг 5: discover** — `cp docs/visual/links.json docs/visual/links-proto.json`, затем `node "$V" discover / catalog/ personal/`: «С сессией», у затравок USER_ID не пустой, группы; `/personal/cancel/…` (если есть ссылка) — в «Опасные».
- [ ] **Шаг 6: паритет с прототипом** — оба прогона по одному `pages.json` и одной сессии, подряд, в фоне:
  - PowerShell из корня beta: `$env:VISUAL_AUTH='<файл сессии из шага 4>'; node .claude/scripts/visual/visual.mjs shoot proto-now` (прототип читает сессию из `VISUAL_AUTH`);
  - `node "$V" shoot kit-now`;
  - `node "$V" compare proto-now kit-now` — ожидание: «совпадает» почти всё (61 снимок), отличия — только известный шум (поиск ~0,5 %); сеть у метки прототипа не записана — не сравнивается; каждое иное отличие — разобрать по дифф-картинке (Read) и записать.
- [ ] **Шаг 7: контрольный прогон** — `node "$V" check kit-now`: ожидание — около 60 из 61 на 0 %, шум поиска; строк «внимание … статус» нет.
- [ ] **Шаг 8: сведения** — `node "$V" compare before kit-now` (эталон до обновлений — отличия ожидаемы: ожившее избранное и т. п.), `node "$V" list`; посмотреть `docs/visual/kit-now/admin/desktop/basket.png` (Read): в корзине два товара — setup сработал; `docs/visual/compare-proto-now-vs-kit-now/report.html` — пользователю.
- [ ] **Шаг 9: закрыть шаг** — `/kit:step-done 10.11` в claude-kit: NOTES — итоги паритета и контрольного прогона, путь отчёта; найденные расхождения — в BUGS (К21 и дальше) или исправления отдельной задачей `10.11а` (исполнитель, ревью). **Остановка на проверку пользователя (часть C).**

---

## Часть D — выпуск

### Задача 10.12: финальное ревью, слияние, обновление установленного плагина, переезд beta

- [ ] **Шаг 1: финальное ревью ветки** — агент (opus) по `git diff master...HEAD` против спека §7.5, §9 и этого плана: корректность, паритет с прототипом `visual.mjs`, безопасность (опасные адреса, защита выкладки, пароли, `docs/visual` вне git), тексты скиллов. Находки — исправления отдельными коммитами `10.12а`, `10.12б` (исполнитель, повторное ревью).
- [ ] **Шаг 2: `master` не ушёл вперёд** — `git -C C:/OSPanel/home/claude-kit log --oneline -1 master` = база ветки; иначе — слить `master` в ветку (как `fca3ee5`), `npm test`.
- [ ] **Шаг 3: слияние** — основной checkout чистый и на `master`: `git -C C:/OSPanel/home/claude-kit status --short` пусто; `git -C C:/OSPanel/home/claude-kit merge --ff-only claude/gracious-feynman-b8796e`.
- [ ] **Шаг 4: обновление установленного плагина (как 9.2 и 9.4)**:
  ```
  claude plugin marketplace update claude-kit
  claude plugin update kit@claude-kit
  ```
  Ожидание: «updated from 2.1.0 to 2.2.0»; в `~/.claude/plugins/cache/claude-kit/kit/2.2.0/` есть `skills/visual/SKILL.md`, `skills/visual/reference/pages.md`, `scripts/visual.js`, `scripts/lib/visual/`, `scripts/visual-deps/package.json`; `node ~/.claude/plugins/cache/claude-kit/kit/2.2.0/scripts/visual.js deps` → 0 (зависимости общие); из корня beta `node …/2.2.0/scripts/visual.js list` — метки на месте. Сессии Claude Code перезапустить, чтобы появился `/kit:visual`.
- [ ] **Шаг 5: переезд beta** — в проекте beta, по его правилам (журнал beta, свой ID шага, `/kit:step-done` beta), с согласия пользователя (AskUserQuestion с перечнем):
  - удалить прототип: `.claude/scripts/visual/visual.mjs`, `package.json`, `package-lock.json`, `.gitignore` (строка `node_modules/`) и папку `node_modules/`; `pages.json` остаётся — его читает `/kit:visual`;
  - в `.claude/CLAUDE.md` beta строку «Снимки публичной части» заменить: `/kit:visual` (эталон — `docs/visual/before`, список страниц — `.claude/scripts/visual/pages.json`, сессия — `%LOCALAPPDATA%\kit\visual\auth\…`);
  - старую сессию прототипа `%TEMP%\beta-visual\` удалить;
  - проверка: `node ~/.claude/plugins/cache/claude-kit/kit/2.2.0/scripts/visual.js compare proto-now kit-now` из корня beta — тот же итог, что в 10.11.
- [ ] **Шаг 6: закрыть шаг** — `/kit:step-done 10.12` в worktree (NOTES: слияние, обновление, итог переезда beta с хешем его коммита), затем снова `git -C C:/OSPanel/home/claude-kit merge --ff-only claude/gracious-feynman-b8796e` — журнал в `master`.
- [ ] **Шаг 7: push** — AskUserQuestion: отправить `master` на GitHub (`git -C C:/OSPanel/home/claude-kit push origin master`, вместе с 9.1–9.4 — шаг 8.10г)? Только после «да». Уборка worktree `gracious-feynman-b8796e` и ветки — из следующей сессии, как и прежних.
