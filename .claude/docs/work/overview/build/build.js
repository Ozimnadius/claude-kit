'use strict';
// Сборка обзора плагина kit из одного источника (текст — здесь, схемы — diagrams.js):
//   ../overview.html  страница с навигацией (открывать в браузере)
//   ../img/*.svg      схемы отдельными файлами — для Markdown
//   ../overview.md    Markdown для GitHub
// Запуск из корня репозитория: node .claude/docs/work/overview/build/build.js [--artifact <файл>]
// --artifact — ещё и вариант страницы без <html>/<head> для публикации артефактом Claude.
const fs = require('fs');
const path = require('path');
const D = require('./diagrams');
const { warnings, LIGHT, DARK, DIAGRAM_CSS } = require('./svg');

const OUT = path.resolve(__dirname, '..');
const FIGS = {
  map: '01-karta', cycle: '02-cikl', hooks: '03-huki', stepDone: '04-step-done',
  serverChannel: '05-server', kitExec: '06-kit-exec', visual: '07-visual',
};
const diagrams = Object.fromEntries(Object.keys(FIGS).map((k) => [k, D[k]()]));

const dot = '<span class="dot" aria-label="читает"></span>';

const css = `
/* Схема-чертёж: светлый холодный лист, цвет — только у ролей (хук, команда, агент, пользователь). */
:root{${LIGHT};color-scheme:light;
  --f-display:'Unbounded','Golos Text',system-ui,sans-serif;
  --f-body:'Golos Text',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --f-mono:'JetBrains Mono',ui-monospace,'Cascadia Mono',Consolas,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK};color-scheme:dark}}
:root[data-theme="dark"]{${DARK};color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:15.5px;line-height:1.62}
a{color:var(--skill-ink)}
a:focus-visible{outline:2px solid var(--skill);outline-offset:2px;border-radius:3px}
.page{max-width:1240px;margin:0 auto;padding-inline:20px;padding-block:44px 72px}
.hero{display:grid;gap:18px;padding-bottom:30px}
.eyebrow{font-family:var(--f-mono);font-size:12.5px;color:var(--muted);letter-spacing:.02em}
h1{font-family:var(--f-display);font-weight:600;font-size:clamp(30px,4.6vw,50px);line-height:1.08;letter-spacing:-.02em;margin:0;text-wrap:balance}
.lede{font-size:18px;line-height:1.55;max-width:66ch;margin:0}
.inv{display:flex;flex-wrap:wrap;gap:8px 26px;margin:4px 0 0;padding:0}
.inv div{display:flex;align-items:baseline;gap:8px}
.inv dt{font-family:var(--f-display);font-weight:600;font-size:22px;font-variant-numeric:tabular-nums}
.inv dd{margin:0;color:var(--muted);font-size:14px}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13.5px;color:var(--muted);margin:0;padding:0;list-style:none}
.legend li{display:flex;align-items:center;gap:8px}
.sw{width:22px;height:14px;border-radius:4px;border:1.5px solid;flex:none}
.sw.hook{background:var(--hook-bg);border-color:var(--hook)}
.sw.skill{background:var(--skill-bg);border-color:var(--skill)}
.sw.agent{background:var(--agent-bg);border-color:var(--agent)}
.sw.user{background:var(--user-bg);border-color:var(--user)}
.sw.ext{background:transparent;border-color:var(--muted);border-style:dashed}
.sw.core{background:var(--surface);border-color:var(--ink);border-width:2px}
.gate{border:1px solid var(--rule-strong);background:var(--surface);border-radius:10px;padding:14px 18px;max-width:80ch}
.gate b{font-weight:650}
.layout{display:grid;grid-template-columns:190px minmax(0,1fr);gap:44px;align-items:start}
.toc{position:sticky;top:calc(env(safe-area-inset-top,0px) + 20px);font-size:14px}
.toc p{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0 0 8px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.toc a{display:block;padding:4px 8px;margin-left:-8px;border-radius:6px;color:var(--ink);text-decoration:none}
.toc a:hover{background:var(--surface)}
main{min-width:0}
section{padding-block:34px;border-top:1px solid var(--rule)}
section:first-child{border-top:0;padding-top:0}
h2{font-family:var(--f-display);font-weight:600;font-size:23px;line-height:1.25;letter-spacing:-.01em;margin:0 0 12px;text-wrap:balance}
h2 .cmd{font-family:var(--f-mono);font-weight:600;font-size:.78em;color:var(--skill-ink);letter-spacing:0;white-space:nowrap}
h3{font-size:17px;font-weight:650;margin:30px 0 8px;text-wrap:balance}
p{margin:0 0 12px;max-width:74ch}
ul,ol{margin:0 0 12px;padding-left:22px;max-width:78ch}
li{margin-bottom:6px}
li::marker{color:var(--muted)}
code{font-family:var(--f-mono);font-size:.85em;background:var(--code-bg);padding:.08em .36em;border-radius:4px;overflow-wrap:anywhere}
pre{font-family:var(--f-mono);font-size:12.5px;line-height:1.55;background:var(--code-bg);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:10px 0 16px;max-width:86ch}
figure{margin:18px 0 20px;background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:14px 14px 12px}
.fig-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
figcaption{color:var(--muted);font-size:13.5px;line-height:1.5;margin-top:10px;max-width:84ch}
.tbl{overflow-x:auto;margin:12px 0 18px;border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.45}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid var(--rule)}
tr:last-child td{border-bottom:0}
th{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;background:var(--bg)}
td:first-child{font-weight:500}
.mx{font-size:13.5px}
.mx th,.mx td{text-align:center;padding:8px 4px;white-space:nowrap}
.mx th:first-child,.mx td:first-child{text-align:left;padding-left:12px}
.mx th{font-family:var(--f-mono);text-transform:none;letter-spacing:0;font-size:10.5px}
.mx td.all{text-align:left;color:var(--muted);font-weight:400;white-space:normal}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--skill)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:8px 32px}
.cols > div{min-width:0}
.rule-box{border:1.5px solid var(--user);background:var(--user-bg);border-radius:10px;padding:12px 16px;margin:14px 0 6px;max-width:84ch}
.rule-box strong{color:var(--user)}
.chain{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 16px;padding:0;list-style:none;max-width:none}
.chain li{margin:0;display:flex;align-items:center;gap:8px}
.chain li + li::before{content:"→";color:var(--muted)}
.chain span{border:1px solid var(--rule-strong);background:var(--surface);border-radius:6px;padding:5px 10px;font-size:14px}
.chain span.u{border-color:var(--user);background:var(--user-bg)}
.steps{counter-reset:s;list-style:none;padding:0;max-width:84ch}
.steps > li{counter-increment:s;position:relative;padding-left:40px;margin-bottom:12px}
.steps > li::before{content:counter(s);position:absolute;left:0;top:1px;width:26px;height:26px;border-radius:50%;border:1.5px solid var(--skill);color:var(--skill-ink);font-size:12.5px;font-weight:650;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.tag{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-radius:4px;padding:1px 6px;margin-right:6px;vertical-align:1px}
.tag.u{color:var(--user);background:var(--user-bg)}
footer{border-top:1px solid var(--rule);margin-top:20px;padding-top:18px;color:var(--muted);font-size:13px}
@media (max-width:900px){
  .layout{grid-template-columns:minmax(0,1fr);gap:8px}
  .toc{position:static;border:1px solid var(--rule);border-radius:10px;background:var(--surface);padding:12px 14px}
  .toc ol{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
}
@media (max-width:520px){ body{font-size:15px} .lede{font-size:16.5px} h2{font-size:20px} }
.dg{display:block;width:100%;min-width:820px;height:auto;font-family:var(--f-body);font-size:13px;color:var(--ink)}
${DIAGRAM_CSS}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
`;

const toc = [
  ['karta', 'Карта'], ['cikl', 'Цикл работы'], ['huki', 'Хуки'], ['step-done', '/kit:step-done'], ['zhurnal', 'Журнал и планы'],
  ['server', '/kit:server'], ['visual', '/kit:visual'], ['deploy-list', '/kit:deploy-list'], ['why', '/kit:why'], ['report', '/kit:report'], ['udalennyj', 'Удалённый репозиторий'], ['project-init', '/kit:project-init'],
  ['parametry', 'Параметры'], ['grabli', 'Грабли и защита'], ['vypusk', 'Выпуск и обновление'],
];

const lede = 'Плагин Claude Code, который ведёт проект по шагам: журнал с решениями и проверками, один коммит на проверенный шаг, выкладка, работа на сервере, снимки «до/после», ответ «почему так сделано» и отчёт заказчику. Внутри — общий каркас для любых проектов и модуль для сайтов на 1С-Битрикс.';
const gate = '<b>Главное условие.</b> Плагин включается только в kit-проекте — там, где в <code>.claude/CLAUDE.md</code> есть раздел «Параметры для агентов» или лежит журнал (<code>.claude/docs/progress.md</code>, до переезда — <code>docs/progress.md</code>). В остальных папках хуки молчат. Ошибка внутри хука сессию не ломает: любой сбой — тихий выход с кодом 0.';
const footer = 'Собрано по исходникам <code>plugins/kit</code> версии 2.13.0 (скиллы, агенты, хуки и скрипты), 5 октября 2026. Пересборка страницы, схем и Markdown: <code>node .claude/docs/work/overview/build/build.js</code> из корня репозитория.';

// Основной текст. fig(ключ, подпись) — схема: на странице — встроенный SVG, в Markdown — картинка из img/.
const main = (fig) => `
<section id="karta">
  <h2>Карта</h2>
  <p>Команды Claude вызывает сам, когда подходит ситуация, или по вашей команде <code>/kit:…</code>. Хуки не вызывает никто: Claude Code запускает их на событиях сессии. Вся тяжёлая логика — в node-скриптах, чтобы поведение было одинаковым и проверялось тестами, а не зависело от того, как модель поймёт текст скилла.</p>
  ${fig('map', 'Каждая команда — своя колонка: какие скрипты и агенты она запускает и что в итоге меняется. Параметры проекта читает не только Claude: хуки, скрипты и агенты берут их сами (таблица «Параметры» ниже).')}
</section>

<section id="cikl">
  <h2>Цикл работы</h2>
  ${fig('cycle', 'Петля в центре — обычный рабочий день: шаг, проверка, закрытие шага, следующий. Справа — команды, которые подключаются по ситуации. Выкладка возвращается в журнал: что и каким коммитом залито, пишется через /kit:step-done блоком DEPLOY.')}
  <div class="cols">
    <div>
      <ul>
        <li><b>Один шаг за раз.</b> Следующий начинается только после проверки предыдущего. ID шага — <code>N.M</code>, исправления после ревью — <code>N.Mа</code>, <code>N.Mб</code> отдельными коммитами, без amend.</li>
        <li><b>Автозаливка.</b> При «Выкладка: PhpStorm Always» любое сохранение сразу уезжает на сервер. Поэтому черновики живут во временной папке сессии, PHP проверяется там же, а в проект попадает одной правкой. Удаление локального файла сервер не трогает — такие файлы записываются в «Удалить с сервера».</li>
      </ul>
    </div>
    <div>
      <ul>
        <li><b>Кто пишет код.</b> Если пользователь, Claude даёт один маленький шаг и ждёт ответа; «сделай сам» относится только к текущему шагу. Если Claude — после записи он сам проверяет результат на сервере на десктопной и мобильной ширине.</li>
        <li><b>Worktree.</b> Сессия в <code>.claude/worktrees/…</code> при автозаливке: правки не попадут на сервер, пока их не сольют, так что сразу проверять на сервере бессмысленно.</li>
        <li><b>Git — не ваша забота.</b> Команды git пользователю не выдаются, коммиты делает только git-keeper.</li>
      </ul>
    </div>
  </div>
</section>

<section id="huki">
  <h2>Хуки</h2>
  <p>Это часть плагина, которая работает без участия Claude. Все хуки сначала проверяют, kit-проект ли это, и только потом что-то делают.</p>
  ${fig('hooks', 'SessionStart готовит сессию, PreToolUse может отказать команде оболочки ещё до запуска, PostToolUse проверяет только что записанный PHP и записывает ваши ответы на вопросы во входящие. Отказ и ошибка приходят Claude как обычный ответ инструмента — он переписывает команду или чинит код.')}
  <h3>Что SessionStart кладёт в контекст</h3>
  <p>Хук срабатывает при старте, <code>resume</code>, <code>/clear</code> и после сжатия контекста — поэтому Claude не теряет текущий шаг даже в длинной сессии. Так начинается сессия в этом репозитории (сокращено):</p>
<pre>[kit] Проект ведётся по журналу .claude/docs/progress.md.

## Сейчас (из .claude/docs/progress.md)
- Этап: 26 — чек-лист в планах, журнал по частям, обновлённый обзор (начат 2026-10-05); сделан шаг 26.5
- Следующий шаг: 26.6 — обновлённый обзор
- Блокеры и открытые вопросы: блокеров нет

## Правила процесса (плагин kit)
- Один шаг за раз: следующий — только после проверки предыдущего.
- После проверенного шага — /kit:step-done (docs-keeper → git-keeper, один коммит на шаг).
- Документы проекта — в .claude/docs/: планы, спеки, чек-листы, материалы — в work/, готовое — в archive/ …
- Superpowers по правилам kit: спеки и планы — в .claude/docs/work/ …
- Журнал по частям: решения — .claude/docs/journal/decisions.md, баги — …/bugs.md, …
…</pre>
  <p>Шесть правил процесса добавляются всегда, остальное — по параметрам проекта:</p>
  <div class="tbl"><table>
    <thead><tr><th>Условие</th><th>Что добавляется</th></tr></thead>
    <tbody>
      <tr><td>всегда</td><td>раздел «Сейчас» из журнала (до 4000 знаков) и шесть правил: шаг за разом, вопросы через AskUserQuestion, /kit:step-done, git только через git-keeper, LF, грабли cd / sed / Git Bash</td></tr>
      <tr><td>Выкладка: PhpStorm Always</td><td>любое сохранение уходит на прод — черновики только во временной папке</td></tr>
      <tr><td>Выкладка: вручную; дев — PhpStorm Always</td><td>то же для дев-сервера</td></tr>
      <tr><td>Код пишет: пользователь</td><td>один маленький шаг и ожидание ответа</td></tr>
      <tr><td>Код пишет: Claude</td><td>после записи — проверка на сервере, десктоп и мобильная ширина</td></tr>
      <tr><td>автозаливка + сессия в worktree</td><td>правки не уедут на сервер до слияния — не проверять сразу</td></tr>
      <tr><td>нет «Параметров для агентов»</td><td>предложить /kit:project-init</td></tr>
      <tr><td>всегда; журнал в <code>docs/</code></td><td>где лежат документы (<code>work/</code>, <code>archive/</code>, реестр); для старой раскладки — подсказка о переезде в <code>.claude/docs</code></td></tr>
      <tr><td>всегда (с 2.8.0)</td><td>superpowers по правилам kit: спеки и планы — в <code>work/</code> по шаблону <code>spec.md</code>, в плане — чек-лист задач (с 2.13.0), сам superpowers не коммитит, задача плана = шаг kit</td></tr>
      <tr><td>журнал по частям (с 2.13.0)</td><td>где лежат части: решения, баги, справочник, закрытые этапы — искать и там</td></tr>
      <tr><td>автозаливка (с 2.8.0)</td><td>superpowers — без отдельных веток и worktree</td></tr>
    </tbody>
  </table></div>
  <p>Второй скрипт SessionStart, <code>phpstorm-exclude.js</code>, дописывает в <code>.idea/deployment.xml</code> исключения <code>.idea</code>, <code>.git</code>, <code>.claude</code>, простые пути из «Не выкладывать» и служебные папки superpowers (<code>.superpowers</code>, <code>.worktrees</code>, <code>docs/superpowers</code>, с 2.8.0) — каждому серверу, сопоставленному с корнем проекта. Он только добавляет и ничего не удаляет; из worktree работает с основной папкой проекта. Исключение — параметр «Документы на сервере: да» (с 2.6.0): тогда хук убирает исключение <code>.claude</code> целиком и исключает всё в ней поимённо, кроме <code>docs</code>, <code>CLAUDE.md</code> и <code>.htaccess</code> (нет <code>.htaccess</code> — создаёт), — документы уезжают на сервер автозаливкой, папка закрыта из веба.</p>
  <p>Третий скрипт SessionStart, <code>remote-check.js</code> (с 2.5.0), работает, только если задан параметр «Удалённый репозиторий». Он делает <code>git fetch</code> не дольше 8 секунд и без окон входа и сравнивает ветку с удалённой: новые коммиты там — Claude до любой правки выполняет <code>git pull --ff-only</code>; неотправленные здесь — отправляет; разошлись — останавливается и спрашивает. Нет сети или входа — строка «не удалось проверить», работа идёт дальше.</p>
  <h3>Страж команд и php -l</h3>
  <ul>
    <li><code>guard-bash.js</code> разбирает команду как оболочка: вырезает heredoc, here-string и комментарии, делит на команды по <code>;</code>, <code>&amp;&amp;</code>, <code>|</code>. <code>cd</code> в Bash разрешён только внутри подоболочки <code>( cd … &amp;&amp; … )</code>; в PowerShell <code>cd</code> и <code>Set-Location</code> запрещены везде — скобки там не помогают. Например, при подготовке этого обзора страж остановил команду Claude с <code>cd</code>, и её пришлось переписать через подоболочку.</li>
    <li><code>php-lint.js</code> берёт <code>php.exe</code> из параметра «PHP» — только абсолютный путь к существующему файлу, иначе молчит. Скрипты для сервера (<code>.claude/scripts/</code>, библиотека <code>/kit:server</code>) пишутся без <code>&lt;?php</code>: хук проверяет их через временную копию с этой приставкой и сдвигает номера строк обратно.</li>
    <li><code>decision-inbox.js</code> (с 2.9.0) — PostToolUse на <code>AskUserQuestion</code>: каждый ответ пользователя (вопрос, варианты с описаниями, выбор или свой текст) дописывается в локальный <code>.claude/kit-inbox.jsonl</code> — не в git и не на сервер. <code>/kit:step-done</code> берёт оттуда решения для «Решений», процедурные вопросы пропускает и после коммита убирает разобранное — решения переживают сжатие контекста.</li>
  </ul>
</section>

<section id="step-done">
  <h2>Закрытие шага <span class="cmd">/kit:step-done</span></h2>
  <p>Claude вызывает команду сам, как только результат шага проверен. Работа с документами и git вынесена в двух агентов на моделях попроще: docs-keeper (sonnet) пишет журнал, git-keeper (haiku) делает коммит. Claude собирает для них данные и проверяет обоих, не веря отчётам на слово.</p>
  <p>С 2.8.0 журнал отвечает и на «как проверено», и на «почему так решили»: SUMMARY — что сделано, CHECK — как проверено (отдельная колонка в таблице этапа и тело коммита); решения пишутся с обоснованием и отвергнутыми вариантами (<code>№ | Дата | Шаг | Решение | Почему | Что отвергли | Кто</code>), значимые решения агента Claude показывает отдельным списком — можно возразить. Старые таблицы остаются как есть: формат docs-keeper определяет по заголовку.</p>
  <p>С 2.10.0 закрытие этапа (новый STAGE, другой номер этапа в NEXT или NEXT «—») начинается со сверки: Claude сравнивает задуманное — требования спека и задачи плана этапа из <code>work/</code>, а без них шаги этапа — со сделанным и показывает таблицу «пункт → шаги → итог». Расхождения — одним вопросом: в «Баги на потом», на следующий этап или «не делаем» с причиной в «Решениях»; итог — строка «Сверка …» под таблицей этапа. Коммит git-keeper делает всегда из Bash: в PowerShell обратная кавычка — символ экранирования, и тело коммита теряло её.</p>
  ${fig('stepDone', 'Время идёт сверху вниз. Сплошная стрелка — вызов, пунктир — ответ. secret-scan проверяет дважды: пути до git add (чтобы запрещённый файл даже не попал в индекс) и добавленные строки после. Код 1 на любой из проверок — git-keeper останавливается без коммита. Если задан удалённый репозиторий, после проверки коммит отправляется (git push -u); в первый раз — только после проверки всей истории на секреты.')}
  <div class="cols">
    <div>
      <h3>Если что-то не так</h3>
      <ul>
        <li>Отчёт docs-keeper не сошёлся с файлом — повторный вызов только с недостающим. К git-keeper Claude не переходит, пока журнал не совпадёт с блоками.</li>
        <li>Найден секрет или запрещённый путь — стоп до коммита; значения в выводе замаскированы.</li>
        <li>Новых коммитов 0 или 2, заголовок не совпал, чужая подпись — Claude сообщает, что показали команды, и останавливается. Никаких <code>reset</code>, <code>amend</code>, <code>rebase</code>, и сам в обход git-keeper не коммитит.</li>
        <li>Агенты <code>kit:…</code> не подхватились — запускается general-purpose с полным текстом файла агента и той же моделью.</li>
      </ul>
    </div>
    <div>
      <h3>Особенности</h3>
      <ul>
        <li><b>Отправка</b> (с 2.5.0) — после проверки коммита, если задан «Удалённый репозиторий»: <code>git push -u &lt;имя&gt; HEAD</code>. Отклонено — стоп и вопрос; нет сети или входа — коммит остаётся и уйдёт со следующим шагом. <code>--force</code> — никогда без согласия.</li>
        <li>Хеши прошлых шагов берутся из <code>git log</code> по префиксу <code>ID:</code> — помнить их между сессиями не нужно.</li>
        <li>Подпись <code>Co-Authored-By</code> приходит блоком COAUTHOR от основного агента и пишется дословно — не устаревает при смене модели.</li>
        <li>Сообщение коммита — только в одинарных кавычках: в двойных <code>$arResult</code> стал бы пустой строкой. Заголовок сверяется символ в символ.</li>
        <li><code>core.quotepath=false</code> во всех командах git: иначе кириллические пути приходят escape-последовательностями и <code>git add</code> их не находит.</li>
        <li>Конец этапа: документы <code>work/…</code> «в работе, этап N» предлагаются в <code>archive/</code>. Перенос — обычным <code>Move-Item</code>, в коммит идут оба пути, и git видит переименование.</li>
        <li>git-keeper не делает <code>push</code>, <code>pull</code>, <code>reset</code>, <code>checkout</code>, <code>stash</code>, <code>rebase</code>, <code>git add .</code> и второй коммит.</li>
      </ul>
    </div>
  </div>
</section>

<section id="zhurnal">
  <h2>Журнал, решения и планы</h2>
  <p>Журнал отвечает на три вопроса: что делали, как проверили и почему так решили. С 2.13.0 он разложен по частям: в главном файле — только текущее, остальное рядом.</p>
<pre>.claude/docs/
  progress.md          «Сейчас», оглавление «Этапы», «Документы», «Прод: не забыть», текущий этап
  journal/
    decisions.md       «Решения»: № · дата · шаг · решение · почему · что отвергли · кто
    bugs.md            «Баги на потом»
    reference.md       «Справочник», «Материалы заказчика», «Отчёт заказчику: …»
    stages/stage-NN.md закрытые этапы: шаги, «Как проверено», коммиты, строка «Сверка …»
  work/                текущие планы и спеки, archive/ — готовое</pre>
  <div class="cols">
    <div>
      <ul>
        <li><b>«Сейчас» — снимок, не история.</b> docs-keeper переписывает его целиком: текущий этап, следующий шаг, блокеры. Хук SessionStart показывает его в начале каждой сессии.</li>
        <li><b>Решения.</b> Ваши ответы на вопросы Claude хук складывает во входящие; <code>/kit:step-done</code> берёт оттуда решения, процедурное («закрывать?») пропускает. Значимые решения агента — туда же, со списком «можно возразить».</li>
        <li><b>Закрытие этапа.</b> Сверка «задумано ↔ сделано» с планом или таблицей этапа, расхождения — одним вопросом; затем <code>journal-split.js --stage N</code> переносит этап в <code>journal/stages/</code> строка в строку.</li>
      </ul>
    </div>
    <div>
      <ul>
        <li><b>Чек-лист в плане.</b> В начале плана этапа — строка на задачу <code>- [ ] N.M — …</code>; закрывая шаг, docs-keeper ставит <code>[x]</code>. Подробные шаги внутри задач — без чекбоксов.</li>
        <li><b>Старые журналы.</b> Одним файлом продолжают работать; перевести на части предлагает <code>/kit:project-init</code> (<code>journal-split.js --migrate</code>, с проверкой, что ни одна строка не потерялась).</li>
        <li><b>Что из этого читают.</b> <code>/kit:why</code> идёт от git к шагам и решениям, <code>/kit:report</code> — собирает отчёт заказчику за период.</li>
      </ul>
    </div>
  </div>
</section>

<section id="server">
  <h2>Работа на сервере <span class="cmd">/kit:server</span></h2>
  <div class="rule-box"><strong>Правило согласия.</strong> Чтение — сразу: <code>ls</code>, <code>md5sum</code>, логи, SELECT, <code>inventory.php</code>. Любое изменение — только после вопроса с точной командой или кодом и явного «да». Одно согласие — одно действие. Пароли вводит только пользователь: SSH — по ключу (<code>BatchMode=yes</code> пароль не спросит), в админку сайта он входит сам.</div>
  ${fig('serverChannel', 'Канал выбирается по параметрам проекта. Код 3 по SSH разбирается по причине: отказ во входе можно обойти файл-каналом, смену отпечатка сервера — нельзя (это может быть подмена), а обрыв во время изменяющего кода означает, что изменение могло пройти, — повторять его нельзя, только проверить чтением и спросить.')}
  <h3>Файл-канал kit-exec.php</h3>
  <p>Нужен для Битрикса без SSH. Это не консоль: код одной задачи вшит в файл при сборке, из запроса файл ничего не выполняет. Номер запуска <code>?run=</code> — не секрет, а сверка «тот ли это файл»: старый файл, который ещё не заменили, при открытии нового адреса называет свой номер и ничего не делает. Без проверки <code>php -l</code> файл не собирается: ошибку компиляции на сервере увидел бы любой посетитель раньше, чем PHP дошёл бы до проверки прав.</p>
  ${fig('kitExec', 'Верхний ряд — как файл попадает на сервер, нижний — что он делает при открытии. Проверка администратора стоит после ядра Битрикса, поэтому права настоящие. В конце работы файл удаляет себя сам — тоже изменяющим запуском, с согласия.')}
  <h3>Как читать ответ страницы</h3>
  <div class="tbl"><table>
    <thead><tr><th>На странице</th><th>Что это значит</th><th>Что делать</th></tr></thead>
    <tbody>
      <tr><td><code>KIT-RUN &lt;свой номер&gt;</code> без «код не выполнялся»</td><td>код выполнен</td><td>вывод — результат; адрес больше не открывать</td></tr>
      <tr><td>«kit: только для администратора» (403)</td><td>администратор не вошёл</td><td>вкладку вперёд, пользователь входит в <code>/bitrix/admin/</code>, открыть снова</td></tr>
      <tr><td><code>KIT-RUN</code> с чужим номером, 404 или страница сайта</td><td>новый файл ещё не доехал</td><td>ждать 5–10 секунд, до 6 попыток, потом просить проверить заливку</td></tr>
      <tr><td>«код не выполнялся»</td><td>адрес без верного <code>?run</code></td><td>открыть адрес из вывода <code>kit-exec.js</code></td></tr>
      <tr><td>Parse error, сбой <code>init.php</code> без <code>KIT-RUN</code></td><td>упало до проверки прав</td><td>искать причину; повтор не поможет</td></tr>
      <tr><td>пусто, 500/502/504, обрыв</td><td>неизвестно: <code>KIT-RUN</code> мог застрять в буфере</td><td>чтение — повторить можно; изменение — не открывать, проверить чтением и спросить</td></tr>
      <tr><td>«headers already sent»</td><td>сайт что-то вывел раньше заголовков</td><td>на этом сайте канал не заработает — нужен SSH</td></tr>
    </tbody>
  </table></div>
  <p>Остаточный риск оставлен сознательно: пока файл с изменяющим кодом лежит на сервере, тот же адрес выполнит код ещё раз. Поэтому такую страницу открывают один раз, вкладку не перезагружают и по истории на неё не возвращаются. При автозаливке файл уезжает и на тот сервер, куда льёт PhpStorm, — удалять его в конце нужно на каждом.</p>
  <h3>Удаление файлов — delete-list.php</h3>
  <ol class="chain">
    <li><span><code>$dryRun = true</code>: список и куда лягут копии</span></li>
    <li><span class="u">«Выполнить по-настоящему?» — «да»</span></li>
    <li><span>копия в <code>~/kit-backup/&lt;дата&gt;/…</code>, сверка md5, затем <code>unlink</code></span></li>
    <li><span>снаружи 404, отметка ✅ в плане выкладки</span></li>
  </ol>
  <p>Каждый путь проверяется через <code>realpath</code>: внутри <code>$base</code>, файл, не симлинк, под узкую маску (<code>*.php.back*</code>, а не <code>*.back*</code> — под неё попал бы <code>jquery.backstretch.js</code>); маски <code>*</code> и <code>*.*</code> не принимаются. Стоп-лист не удаляется никогда: <code>.htaccess</code>, <code>.settings.php</code>, <code>dbconn.php</code>, <code>.env</code>, а в корне ещё <code>index.php</code>, <code>urlrewrite.php</code>, <code>robots.txt</code>, <code>sitemap*.xml</code>. Копия не удалась — файл остаётся; места меньше, чем копии плюс 100 МБ, — стоп.</p>
  <h3>Чем каналы отличаются</h3>
  <div class="tbl"><table>
    <thead><tr><th></th><th>SSH</th><th>Файл-канал</th></tr></thead>
    <tbody>
      <tr><td>Где работает код</td><td>PHP CLI на сервере, код идёт через stdin</td><td>веб-запрос к сайту</td></tr>
      <tr><td>Режимы проекта</td><td>любой; bitrix — с ядром Битрикса</td><td>только bitrix</td></tr>
      <tr><td>Кто такой <code>$USER</code></td><td>никто, права снимает <code>NOT_CHECK_PERMISSIONS</code></td><td>вошедший администратор</td></tr>
      <tr><td>Предел времени</td><td><code>--timeout</code> 90 с + 10 с запаса — меньше лимита Bash в 120 с</td><td><code>max_execution_time</code> и таймаут веб-сервера</td></tr>
      <tr><td>Владелец созданных файлов</td><td>пользователь SSH (BitrixVM — входить под <code>bitrix</code>)</td><td>пользователь веб-сервера</td></tr>
      <tr><td>Обрыв при изменении</td><td>код 3 — результат неизвестен</td><td>пустая страница или 5xx — результат неизвестен</td></tr>
    </tbody>
  </table></div>
  <p>Библиотека скриптов работает в обоих каналах: <code>inventory.php</code> — окружение, сайты и шаблоны, модули, инфоблоки, HL-блоки, файлы <code>b_file</code>; <code>check-files.php</code> — сверка файлов с локальными по md5 (код готовит <code>md5-check.js</code>); <code>delete-list.php</code> — удаление строгим списком. Проектные копии с конкретными путями лежат в <code>.claude/scripts/NN-имя.php</code>: в git есть, на сервер не уезжают.</p>
</section>

<section id="visual">
  <h2>Снимки «до/после» <span class="cmd">/kit:visual</span></h2>
  <p>Нужны перед обновлением ядра, модулей или шаблона и после каждого шага, который может задеть вид страниц. Снимаются гость и администратор, ширины 1920 и 390.</p>
  ${fig('visual', 'Контрольный прогон check снимает эталон второй раз теми же настройками: всё, что разошлось между двумя одинаковыми прогонами, — шум, и дальше он не считается отличием.')}
  <div class="cols">
    <div>
      <h3>Порядок разбора сравнения</h3>
      <ol>
        <li><b>Статусы и ошибки</b> — смена статуса (200 → 500), редирект, USER_ID, новые JS-ошибки и ответы ≥ 400. Это главное.</li>
        <li><b>Отличается</b> — Claude открывает дифф-картинку и оба снимка и смотрит сам, плюс пропавшие и новые строки текста.</li>
        <li><b>В пределах шума</b> и «не снимали» — только упоминание.</li>
      </ol>
    </div>
    <div>
      <h3>Особенности</h3>
      <ul>
        <li>Текст сравнивается с точностью до чисел (цифры → <code>#</code>): таймер или «Найдено 12» шумом и останутся. Смена статуса между одинаковыми прогонами шумом не бывает.</li>
        <li>Снимки из-под админа — только локально: <code>.claude/docs/visual</code> не коммитится и не выкладывается, инструмент сам кладёт туда <code>.gitignore</code>.</li>
        <li>Опасные адреса (выход, <code>action=</code>, <code>sessid=</code>, удаление, <code>/bitrix/</code>) не снимаются; <code>"unsafe": true</code> — с согласия на конкретный адрес.</li>
        <li>Нужен установленный Google Chrome. Метки — латиницей: <code>after-10.5a</code>.</li>
      </ul>
    </div>
  </div>
  <div class="tbl"><table>
    <thead><tr><th>Код</th><th>Что</th></tr></thead>
    <tbody>
      <tr><td>0</td><td>норма</td></tr>
      <tr><td>1</td><td>страницы не снялись, или в сравнении отличия сверх шума</td></tr>
      <tr><td>2</td><td>аргументы или <code>pages.json</code>: опасный адрес, опечатка, метка с другого адреса</td></tr>
      <tr><td>3</td><td>нет сессии входа или она истекла — снова <code>login</code></td></tr>
      <tr><td>4</td><td>защита выкладки: PhpStorm зальёт снимки на сервер</td></tr>
      <tr><td>5</td><td>нет зависимостей или Chrome</td></tr>
    </tbody>
  </table></div>
</section>

<section id="deploy-list">
  <h2>Список на выкладку <span class="cmd">/kit:deploy-list</span></h2>
  <p>Показывает, что залить и что удалить на сервере с последней выкладки. Откуда считать:</p>
  <ol class="chain">
    <li><span><code>--base &lt;коммит&gt;</code></span></li>
    <li><span>иначе последний «Коммит» в таблице «Залито на прод»</span></li>
    <li><span>иначе первый коммит репозитория</span></li>
  </ol>
  <div class="tbl"><table>
    <thead><tr><th>Выкладка</th><th>Что показывает</th></tr></thead>
    <tbody>
      <tr><td>вручную</td><td>«Залить» и «Удалить с сервера» целиком</td></tr>
      <tr><td>PhpStorm Always</td><td>только «Удалить»: заливает PhpStorm сам, а удаление локально сервер не трогает</td></tr>
      <tr><td>вручную; дев — PhpStorm Always</td><td>полный список для прода</td></tr>
    </tbody>
  </table></div>
  <p>Из списка всегда выпадают <code>.claude</code>, папка журнала вне <code>.claude</code>, <code>/kit-exec.php</code> и всё из «Не выкладывать». Незакоммиченные изменения в список не входят — сначала нужно закрыть шаг. Удаления делает пользователь (PhpStorm → Remote Host) или Claude через <code>/kit:server</code>. Когда выложено — запись через <code>/kit:step-done</code> блоком DEPLOY: файлы, коммит, что осталось удалить, что проверено.</p>
</section>

<section id="why">
  <h2>Почему так сделано <span class="cmd">/kit:why</span></h2>
  <p>С 2.11.0. Отвечает, почему в проекте что-то сделано так, — по файлу, функции, строкам или теме. Только чтение, без скрипта: Claude сам идёт по цепочке и у каждого вывода ставит ссылку.</p>
  <ol class="chain">
    <li><span>файл, функция, строки → <code>git log --follow</code> / <code>git log -L</code></span></li>
    <li><span>ID шагов из заголовков коммитов (<code>23.2: …</code>)</span></li>
    <li><span>журнал: строка шага, «Решения» (почему, что отвергли), баги, «Сверка …»</span></li>
    <li><span>документы этапа: план, спек</span></li>
  </ol>
  <p>Тема («почему коммит только из Bash») — сразу «Решения», журнал и документы, затем поиск по коммитам. Ответ — 2–5 фраз со ссылками (шаг, коммит, решение №N), список источников и «не нашёл»: чего в истории нет, то не додумывается.</p>
</section>

<section id="report">
  <h2>Отчёт для заказчика <span class="cmd">/kit:report</span></h2>
  <p>С 2.12.0. Собирает из журнала, git и плана выкладки текст для задачи Битрикс24 или письма: что сделано, что выложено на сайт, что нужно подтвердить, открытые вопросы и что дальше. Пишет для заказчика: без хешей, путей, имён файлов, внутренних названий и подробностей разработки; пустые разделы не выводит.</p>
  <ol class="chain">
    <li><span>период: дата из аргумента, иначе с прошлого отчёта, иначе с начала текущего этапа</span></li>
    <li><span>сделано — шаги из коммитов за период и их строки в журнале</span></li>
    <li><span>подтвердить — решения за период, которые касаются заказчика</span></li>
    <li><span>дата отчёта — заметкой во входящие; следующий /kit:step-done пишет её в «Справочник»</span></li>
  </ol>
</section>

<section id="udalennyj">
  <h2>Удалённый репозиторий и работа с другого компьютера</h2>
  <p>С 2.5.0 git проекта можно держать в закрытом удалённом репозитории (GitHub, GitLab, корпоративный сервер). Тогда заболели или работаете из дома — достаточно <code>git clone</code>: вместе с кодом придут журнал, решения, план выкладки, правила и скрипты. Репозиторий создаёте вы — закрытым и пустым, вход тоже ваш; подключает его <code>/kit:project-init</code> (параметр «Удалённый репозиторий: origin»).</p>
  <ol class="chain">
    <li><span>шаг проверен</span></li>
    <li><span>один коммит (git-keeper)</span></li>
    <li><span>первый раз: <code>secret-scan --history</code></span></li>
    <li><span><code>git push -u origin HEAD</code></span></li>
  </ol>
  <ul>
    <li>На другой машине: плагин, <code>git clone</code> в ту же папку (параметр «PHP» — путь на машине, и он в git), сервер выкладки в PhpStorm (<code>.idea</code> не в git), свой SSH-ключ, зависимости снимков заново, скиллы Битрикса — через <code>/kit:project-init</code>.</li>
    <li>Работать с одного компьютера за раз: при старте хук сверит ветку с удалённой, и Claude подтянет чужие коммиты, <code>/kit:step-done</code> отправит свои; разошлись — Claude остановится и спросит.</li>
    <li>Адрес с логином или токеном внутри не принимается; перед первой отправкой проверяется вся история — секрет из старых коммитов остановит отправку.</li>
  </ul>
</section>

<section id="project-init">
  <h2>Подготовка проекта <span class="cmd">/kit:project-init</span></h2>
  <p>Запускается только командой. В существующем проекте дополняет недостающее и ничего не перезаписывает. Порядок важен — особенно пункт 6.</p>
  <ol class="steps">
    <li><b>Разведка, только чтение.</b> git и его настройки, файлы kit, старая раскладка <code>docs/</code>, признаки Битрикса (<code>bitrix/</code>, <code>local/</code>, <code>urlrewrite.php</code>), <code>.idea</code>: автозаливка, серверы, домен из <code>webServers.xml</code>, File Watchers.</li>
    <li><b>Вопросы</b> — не больше четырёх за раз, найденное разведкой — первым с пометкой «(Рекомендую)»: режим, окружение, кто пишет код, как файлы попадают на сервер; затем адрес прода, задача, исключения, вотчеры. Ответ разошёлся с настройками <code>.idea</code> — отдельный вопрос.</li>
    <li><b>Версия PHP.</b> <code>site-probe.js</code> читает <code>X-Powered-By</code> прода и находит такой же <code>php.exe</code> в OSPanel — для хука <code>php -l</code>.</li>
    <li><b>SSH.</b> Псевдонимы из <code>~/.ssh/config</code> (с <code>Include</code>, только строки <code>Host</code>/<code>HostName</code>/<code>User</code>, ключи не открываются), затем <code>ssh-probe.js</code> — одно подключение: папка сайта и PHP CLI нужной версии. <span class="tag u">ветка</span>Новый хост — пользователь один раз входит сам; сменился отпечаток — стоп.</li>
    <li><b>План на согласие</b> — таблица «что есть / что сделаю / что пропущу». Без согласия ничего не пишется.</li>
    <li><b>Исключения PhpStorm — до любой записи.</b> Иначе <code>git init</code> и <code>settings.local.json</code> уехали бы на сервер автозаливкой. Затем сверка <code>--check</code>; при автозаливке — <code>.htaccess</code> и проверка снаружи.</li>
    <li><b>Git, если его нет.</b> <code>autocrlf=input</code>, <code>quotepath=false</code>, <code>.gitignore</code> по шаблону режима, <code>secret-scan --all</code> по всему, что попадёт в коммит, первый коммит <code>0.1</code> через git-keeper. <span class="tag u">ветка</span>Нашёлся секрет — исключить путь или убрать секрет; варианта «это не секрет» нет.</li>
    <li><b>Файлы kit.</b> <code>.claude/.htaccess</code>, <code>.claude/CLAUDE.md</code> из шаблона (или дописать только раздел параметров), журнал и план выкладки в <code>.claude/docs</code>. Шаблоны собираются во временной папке и пишутся одной записью, когда не осталось ни одного <code>{{…}}</code>.</li>
    <li><b>Проверка снаружи.</b> <code>check-closed.js</code> запрашивает каждый файл <code>.claude</code> по каждому адресу: 404, 403 и 401 — норма, «ОТКРЫТ» или редирект — стоп и разбор.</li>
    <li><b>Битрикс: скиллы</b> (с 2.7.0). <code>bitrix-skills.js</code> ставит в <code>.claude/skills</code> скиллы из bxmaximum/bitrix-framework-skills (без <code>bitrix24-*</code>) и bitrix-tools/best-practice — 46 штук; в правила проекта — строка «код на Битриксе — по этим скиллам». В git и на сервер они не попадают; уже стоят — пункт обновляет их до последних версий.</li>
    <li><b>Переезд</b> <code>docs/</code> → <code>.claude/docs</code>, если проект на старой раскладке: исключения, <code>.gitignore</code>, старые копии на сервере, таблица «файл → куда», перенос.</li>
    <li><b>Закрытие</b> через <code>/kit:step-done</code> — шаг <code>0.2</code>.</li>
  </ol>
</section>

<section id="parametry">
  <h2>Параметры: кто что читает</h2>
  <p>Раздел «Параметры для агентов» в <code>.claude/CLAUDE.md</code> — единственная настройка проекта. Строки вида <code>- Ключ: значение</code>, списки через запятую; формат менять нельзя, его разбирают скрипты.</p>
  <div class="tbl"><table class="mx">
    <thead><tr><th>Параметр</th><th>session-start</th><th>php-lint</th><th>phpstorm-exclude</th><th>remote-check</th><th>secret-scan</th><th>deploy-list</th><th>check-closed</th><th>remote-php</th><th>kit-exec</th><th>visual</th><th>docs-keeper</th></tr></thead>
    <tbody>
      <tr><td>Режим</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td>${dot}</td><td>${dot}</td><td></td></tr>
      <tr><td>Код пишет</td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Выкладка</td><td>${dot}</td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Прод, Дев</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td>${dot}</td><td>${dot}</td><td></td></tr>
      <tr><td>SSH прод, SSH дев</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td></tr>
      <tr><td>PHP на сервере</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td></tr>
      <tr><td>PHP</td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td></tr>
      <tr><td>Журнал</td><td class="all" colspan="11">все: по нему определяются kit-проект и папка документов</td></tr>
      <tr><td>План выкладки</td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td>${dot}</td></tr>
      <tr><td>ID шага</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>${dot}</td></tr>
      <tr><td>Не выкладывать</td><td></td><td></td><td>${dot}</td><td></td><td></td><td>${dot}</td><td>${dot}</td><td></td><td></td><td>${dot}</td><td></td></tr>
      <tr><td>Документы на сервере</td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Не коммитить</td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Секреты</td><td></td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>Удалённый репозиторий</td><td></td><td></td><td></td><td>${dot}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table></div>
  <p>«Окружение» скрипты не читают: оно нужно <code>/kit:project-init</code> для вопросов и <code>/kit:server</code>, чтобы понять, спрашивать ли, на каком сервере выполнять. «Удалённый репозиторий» читает ещё <code>/kit:step-done</code> — чтобы отправить коммит; «Журнал» и «План выкладки» — ещё <code>/kit:why</code> и <code>/kit:report</code>, «Журнал» — <code>journal-split.js</code> и <code>decision-inbox.js</code>. Пути в «Не выкладывать» и «Не коммитить»: со <code>/</code> — от корня проекта (<code>bitrix/</code> не задевает копии шаблонов в <code>local/templates/…/bitrix/</code>), без <code>/</code> — имя в любом месте пути; <code>X (кроме Y)</code> — исключение из правила.</p>
</section>

<section id="grabli">
  <h2>Грабли и чем они закрыты</h2>
  <div class="tbl"><table>
    <thead><tr><th>Грабля</th><th>Что делает kit</th></tr></thead>
    <tbody>
      <tr><td><code>cd</code> меняет каталог всей сессии</td><td>guard-bash запрещает; в Bash можно <code>( cd … &amp;&amp; … )</code>, в PowerShell — только абсолютные пути</td></tr>
      <tr><td><code>sed -i</code> портит <code>\\</code> в неймспейсах PHP</td><td>guard-bash запрещает; PHP правится только через Edit</td></tr>
      <tr><td>ошибка синтаксиса PHP уезжает на прод автозаливкой</td><td>php-lint после каждой правки; при Always черновик — во временной папке</td></tr>
      <tr><td>журнал, скрипты, снимки или <code>.git</code> уезжают на сервер</td><td>Excluded Paths при каждом старте, <code>.claude</code> в «Не выкладывать», <code>.htaccess</code>, проверка снаружи <code>check-closed</code></td></tr>
      <tr><td>nginx отдаёт статику мимо <code>.htaccess</code></td><td><code>.claude</code> исключена целиком; снимки только локально, visual при риске — код 4</td></tr>
      <tr><td>секрет попадает в коммит</td><td>secret-scan до и после <code>git add</code>, значения маскируются; подстановки шаблонов (<code>$key</code>, <code>{{…}}</code>, <code>#API_KEY#</code>) не считаются секретом</td></tr>
      <tr><td>кириллица в путях git</td><td><code>core.quotepath=false</code> во всех командах</td></tr>
      <tr><td><code>$arResult</code> исчезает из сообщения коммита</td><td>только одинарные кавычки; заголовок проверяется символ в символ</td></tr>
      <tr><td>Git Bash превращает <code>/путь</code> в <code>C:/Program Files/Git/…</code></td><td><code>MSYS_NO_PATHCONV=1</code> или PowerShell; <code>remote-php.js</code> ловит переписанный путь (код 4)</td></tr>
      <tr><td>чужая подпись в коммите</td><td>COAUTHOR дословно от основного агента, git-keeper свою не подставляет</td></tr>
      <tr><td>изменяющий код выполнился дважды</td><td>SSH: код 3 = неизвестно, без повтора; файл-канал: <code>?run=</code>, одно открытие, вкладку не перезагружать</td></tr>
      <tr><td>удалили не тот файл</td><td>строгий список, узкие маски, стоп-лист, сухой прогон, копия с md5</td></tr>
      <tr><td>зависший PHP обрывает вызов</td><td>90 с + 10 с запаса меньше 120 с лимита Bash — приходит код 3, а не обрыв</td></tr>
      <tr><td>подмена сервера</td><td>«REMOTE HOST IDENTIFICATION HAS CHANGED» — стоп; <code>StrictHostKeyChecking=no</code> и <code>accept-new</code> не используются</td></tr>
      <tr><td>параметр <code>SSH прод</code> вида <code>-oProxyCommand=…</code></td><td>хост только <code>^[A-Za-z0-9_][A-Za-z0-9_.@-]*$</code>, без <code>-</code> в начале</td></tr>
      <tr><td>пароль в руках Claude</td><td>SSH только по ключу; в Chrome для снимков и в админку сайта входит пользователь</td></tr>
      <tr><td>заболел — продолжить работу не с чего</td><td>удалённый репозиторий: коммит уходит после каждого шага, при старте сессии — сверка; дома — <code>git clone</code></td></tr>
    </tbody>
  </table></div>
</section>

<section id="vypusk">
  <h2>Выпуск и обновление</h2>
  <ul>
    <li>Установленный плагин — копия в кэше <code>~/.claude/plugins/cache/claude-kit/kit/&lt;версия&gt;</code>. Claude Code работает с копией, а не с папкой репозитория.</li>
    <li>Без повышения <code>version</code> в <code>plugin.json</code> и <code>marketplace.json</code> обновления не будет: <code>claude plugin update</code> ответит, что версия последняя.</li>
    <li>Порядок выпуска: версия → слияние в <code>master</code> → <code>claude plugin marketplace update claude-kit</code> → <code>claude plugin update kit@claude-kit</code> → перезапуск сессий. Push на GitHub — только с согласия.</li>
    <li>Зависимости снимков и сессии входа лежат в <code>%LOCALAPPDATA%\\kit\\visual</code> — вне кэша, поэтому обновления плагина их не трогают.</li>
    <li>Проверить правки без выпуска: <code>claude --plugin-dir C:\\OSPanel\\home\\claude-kit\\plugins\\kit</code>.</li>
  </ul>
</section>
`;

// ---------- страница ----------
const figHtml = (key, cap) => `<figure><div class="fig-scroll">${diagrams[key].render()}</div><figcaption>${cap}</figcaption></figure>`;

const head = `<title>Устройство плагина kit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Unbounded:wght@600&display=swap">
<style>${css}</style>`;

const body = `<div class="page">
<header class="hero">
  <div class="eyebrow">claude-kit · плагин kit 2.13.0</div>
  <h1>Как устроен kit</h1>
  <p class="lede">${lede}</p>
  <dl class="inv">
    <div><dt>7</dt><dd>команд /kit:</dd></div>
    <div><dt>2</dt><dd>агента</dd></div>
    <div><dt>4</dt><dd>хука</dd></div>
    <div><dt>17</dt><dd>node-скриптов</dd></div>
    <div><dt>3</dt><dd>PHP-скрипта для сервера</dd></div>
  </dl>
  <ul class="legend" aria-label="Условные обозначения на схемах">
    <li><span class="sw hook"></span>хук — срабатывает сам</li>
    <li><span class="sw skill"></span>команда /kit:</li>
    <li><span class="sw agent"></span>агент</li>
    <li><span class="sw user"></span>пользователь, согласие или стоп</li>
    <li><span class="sw core"></span>Claude и ключевые узлы</li>
    <li><span class="sw ext"></span>внешнее: git, сервер, сайт, PhpStorm</li>
  </ul>
  <div class="gate">${gate}</div>
</header>
<div class="layout">
<nav class="toc" aria-label="Разделы">
  <p>Разделы</p>
  <ol>${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ol>
</nav>
<main>
${main(figHtml)}
</main>
</div>
<footer>${footer}</footer>
</div>
`;

// ---------- Markdown для GitHub ----------
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Строчная разметка: code, b/strong, метки — в Markdown; код прячется на время, чтобы «<…>» внутри него не сочли тегом.
function inline(h) {
  const codes = [];
  const keep = (t) => {
    const v = decode(t);
    codes.push(v.includes('`') ? '`` ' + v + ' ``' : '`' + v + '`');
    return '\u0000' + (codes.length - 1) + '\u0000';
  };
  let s = h;
  s = s.replace(/<span class="tag u">([^<]*)<\/span>/g, (m, t) => '**' + t[0].toUpperCase() + t.slice(1) + ':** ');
  s = s.replace(/<span class="dot"[^>]*><\/span>/g, '●');
  s = s.replace(/<span class="cmd">([^<]*)<\/span>/g, (m, t) => keep(t));
  s = s.replace(/<code>([\s\S]*?)<\/code>/g, (m, t) => keep(t));
  s = s.replace(/<\/?(b|strong)>/g, '**');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[+i]);
}

function table(inner) {
  const rows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => {
    const cells = [];
    for (const c of r[1].matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/g)) {
      cells.push(inline(c[3]).replace(/\|/g, '\\|') || ' ');
      const span = /colspan="(\d+)"/.exec(c[2]);
      for (let i = 1; span && i < +span[1]; i++) cells.push(' ');
    }
    return '| ' + cells.join(' | ') + ' |';
  });
  const n = (rows[0].match(/ \| /g) || []).length + 1;
  return [rows[0], '|' + ' --- |'.repeat(n), ...rows.slice(1)].join('\n');
}

function htmlToMd(html) {
  const out = [];
  const BLOCK = /<(h2|h3|p|pre|ul|ol|table)\b([^>]*)>([\s\S]*?)<\/\1>|@@FIG (\w+)@@|<div class="rule-box">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(BLOCK)) {
    const [, tag, attrs, inner, figKey, rule] = m;
    if (figKey) {
      const d = diagrams[figKey];
      out.push(`![${d.alt}](img/${FIGS[figKey]}.svg)\n\n*${figCaps[figKey]}*`);
    } else if (rule !== undefined) {
      out.push('> ' + inline(rule));
    } else if (tag === 'h2') {
      out.push('## ' + inline(inner));
    } else if (tag === 'h3') {
      out.push('### ' + inline(inner));
    } else if (tag === 'p') {
      out.push(inline(inner));
    } else if (tag === 'pre') {
      out.push('```text\n' + decode(inner).replace(/^\n/, '') + '\n```');
    } else if (tag === 'table') {
      out.push(table(inner));
    } else {
      const items = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => inline(x[1]));
      if (attrs.includes('chain')) out.push(items.join(' → '));
      else out.push(items.map((t, i) => (tag === 'ol' ? (i + 1) + '. ' : '- ') + t).join('\n'));
    }
  }
  return out.join('\n\n');
}

// Якоря заголовков, как их делает GitHub: строчные, без знаков, пробелы — дефисы.
const slug = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

const figCaps = {};
const figMd = (key, cap) => { figCaps[key] = cap; return `\n@@FIG ${key}@@\n`; };
const mainMd = main(figMd);
const h2 = Object.fromEntries([...mainMd.matchAll(/<section id="([^"]+)">\s*<h2>([\s\S]*?)<\/h2>/g)].map((m) => [m[1], inline(m[2])]));

const md = `# Как устроен kit

<!-- Файл собирается командой node .claude/docs/work/overview/build/build.js — правьте build.js и diagrams.js, а не этот файл. -->

${lede}

**7** команд \`/kit:\` · **2** агента · **4** хука · **17** node-скриптов · **3** PHP-скрипта для сервера

**Цвета на схемах:** оранжевый — хук, срабатывает сам; синий — команда \`/kit:\`; зелёный — агент; красный — пользователь, согласие или стоп; жирная рамка — Claude и ключевые узлы; пунктир — внешнее: git, сервер, сайт, PhpStorm.

> ${inline(gate)}

Та же страница с навигацией — [overview.html](overview.html): скачать и открыть в браузере.

**Разделы:** ${toc.map(([id, t]) => `[${t}](#${slug(h2[id])})`).join(' · ')}

${htmlToMd(mainMd)}

---

${inline(footer)}
`;

// ---------- запись ----------
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
for (const [key, file] of Object.entries(FIGS)) {
  fs.writeFileSync(path.join(OUT, 'img', file + '.svg'), diagrams[key].render({ standalone: true }));
}
fs.writeFileSync(path.join(OUT, 'overview.html'),
  '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  + head + '\n</head>\n<body>\n' + body + '</body>\n</html>\n');
fs.writeFileSync(path.join(OUT, 'overview.md'), md.replace(/\n{3,}/g, '\n\n'));

const ai = process.argv.indexOf('--artifact');
if (ai > 0 && process.argv[ai + 1]) fs.writeFileSync(process.argv[ai + 1], head + '\n' + body);

console.log('Собрано: overview.html, overview.md, img/*.svg (' + Object.keys(FIGS).length + ')');
if (warnings.length) console.log('Текст может не влезть в блок:\n' + warnings.join('\n'));
