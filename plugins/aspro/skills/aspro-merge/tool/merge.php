<?php
/**
 * merge.php — сверка доработок с обновлением решения Аспро (единая консоль; справка — без аргументов).
 *
 *   php local/tools/aspro-merge/merge.php <команда> [параметры] [--json]
 *
 * Ядро Битрикса для работы не нужно (подключается в отдельном процессе только для сброса кеша, уведомлений, журнала
 * событий и агентов).
 * Коды выхода: 0 — всё хорошо или нечего делать, 2 — нужен разбор (конфликты, предупреждения), 1 — ошибка.
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}

require __DIR__ . '/lib/bootstrap.php';

use AsproMerge\Bitrix;
use AsproMerge\Config;
use AsproMerge\MergeException;
use AsproMerge\Result;
use AsproMerge\SelfTest;
use AsproMerge\Tool;
use AsproMerge\Util;

const AM_HELP = <<<'TXT'
Сверка Аспро (aspro-merge {version}) — перенос доработок через обновления решения (без git и Node).

  php local/tools/aspro-merge/merge.php <команда> [параметры]

Команды:
  status                 состояние: режимы, снимки, открытый сеанс, что требует решения; чужие уведомления
                         и посторонние агенты сверки (через ядро)
  snapshot [--urls] [--force] [--rebuild]
                         снять снимок текущей версии (эталон + список доработанных файлов; --urls — страницы «до»);
                         --force — снять, даже если модуль обновлён без сверки (только если обновление уже сверено
                         вручную); --rebuild — пересоздать эталон версии заново (иначе обновляется только список доработок)
  changes [--no-snapshot]
                         что поменял вендор и что с этим делать (открывает сеанс, сайт не меняет);
                         --no-snapshot — снимка версии до обновления нет: база — бэкапы обновлятора (как у apply)
  apply [--no-snapshot]  применить очевидное: новые версии вендора в недоработанные файлы, чистые слияния,
                         новые файлы; конфликты — оставить нашу версию и подготовить тройки;
                         --no-snapshot — снимка версии до обновления нет: аварийная сверка по бэкапам обновлятора
  resolve <файл> [<решение>]
                         принять решение по конфликту/разбору: путь к файлу с итогом, ours, theirs,
                         keep (оставить как есть на сайте), delete; без решения — файл resolved в папке тройки
  apply-resolved         записать принятые решения на сайт
  rollback [--force]     вернуть все файлы, записанные в сеансе, к состоянию до записи
  verify [--urls] [--no-scan]
                         проверка: нерешённое, маркеры, BOM, php -l, изменения обеих сторон в итоге (по словам),
                         файлы с версией вендора равны эталону, решения на месте; --urls — страницы сайта
                         (base_url и urls в настройках; не заданы — проблема «страницы не проверены»);
                         --no-scan — не искать маркеры конфликта по всем рабочим папкам (файлы сеанса проверяются всё равно);
                         у завершённого сеанса — только чтение (session.json и report.md не меняются)
  diff <файл> [--against=theirs,ours,base,etalon,resolved]
                         итог на сайте против новой версии вендора и против нашей версии (по умолчанию — обе);
                         открытый или последний сеанс, только чтение
  finish [--force] [--keep-backups] [--urls]
                         завершить сеанс (после verify) и снять снимок новой версии; страницы «после» из
                         verify --urls кладутся в снимок (--urls — снять их сейчас); бэкапы обновлятора версий
                         сеанса уносятся с сайта в папку сеанса (--keep-backups — оставить); своё уведомление
                         снимается, в журнал событий — «сверка завершена»; прежний --archive-backups принимается
                         и ничего не меняет
  archive-backups        после сверки, с согласия человека: унести с сайта все бэкапы обновлятора _*.back*
                         (они отдаются по HTTP)
  notices [--drop=<тег>] уведомления в админке (похожие на обновление/сверку — помечены); --drop — снять с этим тегом
  agents [--drop-foreign]
                         агент сверки и посторонние агенты сверки (имя похоже на AsproMerge / aspro_merge, но не
                         AsproMergeSite::agent(); — например, от прежних версий); --drop-foreign — снять посторонние
                         (с согласия человека; свой агент не трогается)
  export [--out=<zip>] [--all]
                         zip с тройками и инструкцией для работы без SSH; --all — вместе с чисто слившимися файлами
  import <zip> [--no-apply]
                         принять решения из zip (сверка хешей версий) и записать их (как apply-resolved);
                         --no-apply — только принять, не записывая на сайт
  uninstall [--dry] [--delete-store --yes] [--force] [--remove-foreign-agents]
                         удалить сверку: снять своё уведомление, агент и опцию-кеш (агент и опцию — когда строки
                         подключения в init.php уже нет), показать по шагам, что удалить руками; --dry — только
                         показать; хранилище — только с --delete-store --yes; при открытом сеансе — только показ
                         (--force — всё равно); --remove-foreign-agents — снять и посторонние агенты сверки
  selftest [--demo=<папка>] [--seed=<n>] [--n=<число>]
                         быстрая проверка движка слияния, архивов и окружения (без git); --demo — ещё и свои
                         тройки с известным ответом (подпапки с base.php, ours.php, theirs.php, merged-with-markers.php);
                         --seed, --n — зерно и число случайных проверок свойств слияния (по умолчанию 1 и 300)
  version                версия инструмента и файлов подключения (на сайте и в поставке); сайт не нужен
  help                   эта справка (то же — без команды, --help или -h)

Для проверки и ручного запуска действий сайта:
  hook-update [--modules=<модули>] [--time-limit=<с>]
                         то же, что событие main:OnModuleUpdate; --modules — список модулей через запятую
                         (по умолчанию модуль решения), --time-limit — срок в секундах (иначе time_limit настроек)
  hook-guard             то же, что предохранитель перед установкой
  hook-agent             то же, что агент раз в сутки
  --via=<источник>       подпись источника в журнале сеанса (по умолчанию cli; например, --via=OnModuleUpdate —
                         как событие сайта); работает с любой командой

Общие параметры:
  --root=<корень сайта>  по умолчанию — три уровня выше этой папки
  --store=<папка>        хранилище снимков (иначе — из local/aspro-merge.config.php или автоматически;
                         относительный путь — от папки запуска)
  --module=, --template= модуль решения и шаблон (иначе — автоматически)
  --base-url=<адрес>     адрес сайта для --urls и проверки отдачи по HTTP; --urls-file=<файл> — список страниц
                         (иначе — base_url и urls из local/aspro-merge.config.php)
  --config=<файл>        другой файл настроек
  --no-core              не подключать ядро Битрикса даже для кеша, уведомлений и агентов
  --json                 вывод в JSON
  --allow-other-user     работать не от владельца файлов сайта (по умолчанию — отказ; от root — с передачей
                         новых файлов владельцу сайта)
  --no-php-l             для проверки: вести себя как веб-запрос без PHP CLI (слияния PHP откладываются)
  --conflict-keep=ours|theirs
                         разово: что лежит «на месте» в файлах на разбор до решения (иначе conflict_keep в настройках)

Запускать от владельца файлов сайта: sudo -u <владелец> php local/tools/aspro-merge/merge.php …

Коды выхода: 0 — всё хорошо/нечего делать, 2 — нужен разбор, 1 — ошибка.
Подробно — local/tools/aspro-merge/README.md.
TXT;

$opt = [];
$pos = [];
foreach (array_slice($argv, 1) as $a) {
    if (preg_match('/^--([a-z0-9-]+)(?:=(.*))?$/i', $a, $m)) {
        $opt[$m[1]] = $m[2] ?? true;
    } elseif ($a === '-h') {
        $opt['help'] = true;
    } else {
        $pos[] = $a;
    }
}
$cmd = $pos[0] ?? null;
if ($cmd === null || $cmd === 'help' || isset($opt['help'])) {
    echo str_replace('{version}', Tool::VERSION, AM_HELP), "\n";
    exit(0);
}
$root = is_string($opt['root'] ?? null) ? $opt['root'] : dirname(__DIR__, 3);
$json = isset($opt['json']);
if (isset($opt['no-php-l'])) {
    Util::$noPhpL = true; // для проверки: как веб-запрос, где нет PHP CLI для php -l
}

// консоль должна работать от владельца файлов сайта: иначе хранилище, блокировка и новые файлы будут чужими,
// и предохранитель (от пользователя веб-сервера) не сможет их открыть — установка обновлений встанет
if (!in_array($cmd, ['selftest', 'version', 'core'], true) && function_exists('posix_geteuid')) {
    [$ownAction, $ownMsg] = Util::ownerCheck(posix_geteuid(), @fileowner($root) === false ? null : (int)fileowner($root), isset($opt['allow-other-user']));
    if ($ownAction === 'chown') {
        Util::$owner = [(int)fileowner($root), (int)@filegroup($root)];
    }
    if ($ownMsg !== null) {
        fwrite(STDERR, ($ownAction === 'stop' ? 'ОШИБКА: ' : 'ВНИМАНИЕ: ') . $ownMsg . "\n");
    }
    if ($ownAction === 'stop') {
        exit(1);
    }
}

if ($cmd === 'core') {
    // внутренний вызов: ядро Битрикса в отдельном процессе (сброс кеша, уведомление)
    $payload = is_string($opt['payload'] ?? null) ? (json_decode((string)@file_get_contents($opt['payload']), true) ?: []) : [];
    $host = null;
    try {
        $c = Config::load($root, $opt);
        $host = $c->baseUrl ? parse_url($c->baseUrl, PHP_URL_HOST) : null;
    } catch (\Throwable) {
    }
    exit(Bitrix::coreMain(str_replace('\\', '/', realpath($root) ?: $root), (string)($pos[1] ?? ''), $payload, $host));
}

try {
    if ($cmd === 'selftest') {
        $r = SelfTest::run($root, $opt);
    } elseif ($cmd === 'version') {
        $r = Tool::versionCmd($root);
    } else {
        $c = Config::load($root, $opt);
        $t = new Tool($c, is_string($opt['via'] ?? null) ? $opt['via'] : 'cli');
        $need = static function (int $i, string $what) use ($pos): string {
            if (!isset($pos[$i])) {
                throw new MergeException("Не указан $what (справка: php merge.php help)");
            }
            return $pos[$i];
        };
        $r = match ($cmd) {
            'status' => $t->status(),
            'snapshot' => $t->snapshot(isset($opt['force']), isset($opt['urls']), isset($opt['rebuild'])),
            'changes' => $t->changes(isset($opt['no-snapshot'])),
            'apply' => $t->apply(null, isset($opt['no-snapshot'])),
            'resolve' => $t->resolve($need(1, 'файл'), $pos[2] ?? null),
            'apply-resolved' => $t->applyResolved(),
            'rollback' => $t->rollback(isset($opt['force'])),
            'verify' => $t->verify(isset($opt['urls']), !isset($opt['no-scan'])),
            // --archive-backups (прежний параметр) — теперь поведение по умолчанию
            'finish' => $t->finish(isset($opt['force']), isset($opt['keep-backups']), isset($opt['urls'])),
            'diff' => $t->diff($need(1, 'файл'), is_string($opt['against'] ?? null) ? $opt['against'] : null),
            'uninstall' => $t->uninstall(isset($opt['dry']), isset($opt['delete-store']), isset($opt['yes']), isset($opt['force']),
                isset($opt['remove-foreign-agents'])),
            'archive-backups' => $t->archiveBackupsCmd(),
            'notices' => $t->notices(is_string($opt['drop'] ?? null) ? $opt['drop'] : null),
            'agents' => $t->agents(isset($opt['drop-foreign'])),
            'export' => $t->export(is_string($opt['out'] ?? null) ? $opt['out'] : null, isset($opt['all'])),
            'import' => $t->import($need(1, 'zip-файл'), isset($opt['no-apply'])),
            'hook-update' => $t->afterUpdate(
                array_map('trim', explode(',', is_string($opt['modules'] ?? null) ? $opt['modules'] : $c->module)),
                isset($opt['time-limit']) ? (int)$opt['time-limit'] : null
            ),
            'hook-guard' => (static function () use ($t): Result {
                $g = $t->guard();
                $r = new Result('Предохранитель перед установкой');
                $g['ok'] ? $r->line('Установку можно продолжать: ' . $g['message']) : $r->error('Установка была бы остановлена: ' . $g['message']);
                return $r;
            })(),
            'hook-agent' => $t->agent(),
            default => throw new MergeException("Неизвестная команда «{$cmd}» (справка: php merge.php help)"),
        };
    }
} catch (MergeException $e) {
    $r = (new Result('Сверка Аспро'))->error($e->getMessage());
} catch (\Throwable $e) {
    $r = (new Result('Сверка Аспро'))->error('сбой: ' . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')');
}
echo $json ? json_encode($r->toArray(), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n" : $r->text();
exit($r->code);
