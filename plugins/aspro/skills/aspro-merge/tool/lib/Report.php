<?php
/**
 * Краткий отчёт сеанса для человека: report.md в папке сеанса (пересобирается после каждой команды открытого сеанса;
 * завершённый сеанс команды не перезаписывают — verify у него только читает).
 * По каждому файлу — итог (что с ним сделано или что на месте сейчас), а не первоначальное действие плана.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Report
{
    public static function write(Config $c, Session $s): void
    {
        $d = $s->d;
        $o = [];
        $o[] = "# Сверка Аспро {$d['from']} → {$d['to']}";
        $o[] = '';
        $o[] = "- Сайт: `{$c->root}`, модуль `{$c->module}`, шаблон `{$c->template}`";
        $o[] = '- Инструмент: aspro-merge ' . Tool::VERSION;
        $o[] = '- Сеанс: `' . $s->id() . '`, ' . ($s->isOpen() ? 'открыт' : 'завершён ' . Util::date((int)($d['finished'] ?? 0)))
            . ', открыт ' . Util::date((int)$d['opened']);
        $o[] = '- Шаги обновления: ' . implode(', ', array_map(static fn($x) => $x['to'] . ' (' . Util::date((int)$x['time']) . ', ' . $x['via'] . ')', $d['steps']));
        $o[] = '- База: ' . ($d['base'] ? "снимок {$d['base']['version']} (список доработок от " . Util::date((int)$d['base']['state_time']) . ')' : 'нет снимка — сверка по бэкапам обновлятора');
        $o[] = '- Режимы: ' . implode('; ', array_map(static fn($a) => "{$a['id']} — " . ($a['mode'] === Area::COPY ? "копия `{$a['copy']}`" : 'на месте `' . ($a['installed'] ?: '/') . '`'),
                array_filter($d['areas'], static fn($a) => $a['kind'] !== 'cmp' || $a['mode'] === Area::COPY)))
            . (count(array_filter($d['areas'], static fn($a) => $a['kind'] === 'cmp' && $a['mode'] !== Area::COPY)) ? '; компоненты Аспро — на месте' : '');
        $o[] = '- Хеши (в `session.json`, папках троек `info.json`, `blobs/`) — git blob sha1, как `git hash-object <файл>`: '
            . '`sha1("blob <длина>\0<содержимое>")`';
        $o[] = '';
        $counts = $s->counts();
        $o[] = '## Итог';
        $o[] = '';
        foreach (Tool::STATUS as $k => $t) {
            if (!empty($counts[$k])) {
                $o[] = "- $t: {$counts[$k]}";
            }
        }
        $o[] = '- сгенерированных сайтом файлов пропущено: ' . (int)($d['plan']['excluded'] ?? 0);
        $win = Planner::window($d['entries']);
        $o[] = '- записано инструментом новых версий вендора и слияний: ' . count($win['written'])
            . ($win['updater'] ? '; версию вендора в недоработанные файлы записал сам обновлятор: ' . count($win['updater']) : '');
        $held = array_merge($win['held_ours'], $win['held_theirs']);
        if ($held || $s->isOpen()) {
            $o[] = '- сейчас до решения на месте наша прежняя версия: ' . count($win['held_ours'])
                . ($win['held_theirs'] ? '; версия вендора без доработки (conflict_keep = theirs): ' . count($win['held_theirs']) : '');
        }
        $open = array_filter($d['entries'], static fn($e) => in_array($e['status'], ['conflict', 'review', 'error'], true));
        if ($open && $s->isOpen()) {
            $o[] = '';
            foreach (Planner::windowText($win, 8) as $line) {
                $o[] = "**$line**";
                $o[] = '';
            }
            if ($win['held_ours'] || $win['other']) {
                $o[] = '**До сверки сайт работает на смеси версий**: в файлах на разбор — прежняя (наша) версия или файл не тронут, '
                    . 'а остальные файлы вендора уже новые. Если вендор поменял формат данных сразу в нескольких файлах, связанная '
                    . 'функция не работает до решения — решите конфликты сразу, начиная с тех, у кого есть «связанные изменения вендора».';
            }
        }
        $groups = ['Требуют решения' => ['conflict', 'review', 'error', 'resolved'], 'Решено и применено' => ['done'],
            'Применено автоматически' => ['applied'], 'Ждёт apply' => ['auto']];
        foreach ($groups as $title => $sts) {
            $list = array_filter($d['entries'], static fn($e) => in_array($e['status'], $sts, true));
            if (!$list) {
                continue;
            }
            $o[] = '';
            $o[] = "## $title";
            $o[] = '';
            foreach ($list as $e) {
                $o[] = "- `{$e['target']}` — {$e['about']}; итог: " . Planner::outcome($e)
                    . ($e['note'] ? " ({$e['note']})" : '')
                    . ($e['files'] && in_array($e['status'], ['conflict', 'review', 'error', 'resolved', 'done'], true) ? "; тройка: `{$e['files']}/`" : '');
                if (!empty($e['related'])) {
                    $o[] = '  - связанные изменения вендора (возможно, общий формат данных — проверить вместе): '
                        . implode('; ', array_map(static fn($x) => "`{$x['target']}` (" . implode(', ', $x['tokens']) . ')', $e['related']));
                }
                if (!empty($e['vendor_fix']['text'])) {
                    $o[] = '  - вендор, похоже, исправил безопасность / формат (подсказка по словам в theirs.diff, не вывод): ' . $e['vendor_fix']['text'];
                }
            }
        }
        array_push($o, ...self::windowSection($s));
        $info = array_filter($d['entries'], static fn($e) => $e['status'] === 'ok');
        if ($info) {
            $o[] = '';
            $o[] = '## Ничего делать не нужно';
            $o[] = '';
            $by = [];
            foreach ($info as $e) {
                $by[$e['about'] . ' → ' . Planner::outcome($e)][] = $e['target'];
            }
            foreach ($by as $about => $ts) {
                $o[] = "- $about: " . count($ts) . ' — ' . implode(', ', array_map(static fn($t) => "`$t`", array_slice($ts, 0, 8))) . (count($ts) > 8 ? ' …' : '');
            }
        }
        if ($d['warnings']) {
            $o[] = '';
            $o[] = '## Предупреждения';
            $o[] = '';
            foreach ($d['warnings'] as $w) {
                $o[] = "- $w";
            }
        }
        if (!empty($d['verify'])) {
            $v = $d['verify'];
            $o[] = '';
            $o[] = '## Последняя проверка (' . Util::date((int)$v['time']) . ')';
            $o[] = '';
            $o[] = $v['problems'] ? '- проблемы: ' . implode('; ', $v['problems']) : '- проблем нет';
            $pg = $v['pages'] ?? null;
            if (!empty($pg['checked'])) {
                $o[] = "- страницы: проверено {$pg['checked']} ({$pg['base_url']})" . (!empty($pg['bad']) ? ", с ошибками: {$pg['bad']}" : ', ошибок нет');
            } elseif (!empty($pg['requested'])) {
                $o[] = '- страницы не проверены: ' . ($pg['why'] ?? 'нет адреса сайта или списка страниц');
            } else {
                $o[] = '- страницы не проверялись (verify без --urls)';
            }
            $notes = $v['notes'] ?? [];
            if ($notes) {
                $o[] = '';
                $o[] = '### Посмотреть (' . count($notes) . ')';
                $o[] = '';
                $o[] = 'Не ошибки, а места для проверки глазами: изменение доработки или вендора не нашлось в итоговом файле (сравнение '
                    . 'по словам: объединённая строка, где есть обе части, не помечается; строки показаны целиком), признаков исправления '
                    . 'вендора (экранирование, подпись параметров, sessid) в итоге меньше, чем у вендора, наша версия откатывает '
                    . 'исправления вендора, бывшие уже до обновления (копия отстала: `count((array)…)`, Secure logout, `.live()`), '
                    . 'файл не равен эталону или решению, файл изменили после записи инструмента, размер страницы изменился больше чем на 20%.';
                $o[] = '';
                foreach ($notes as $n) {
                    array_push($o, ...self::noteMd((string)$n));
                }
            }
        }
        if (!empty($d['backups'])) {
            $b = $d['backups'];
            $o[] = '';
            $o[] = '## Бэкапы обновлятора';
            $o[] = '';
            $o[] = "- унесены с сайта: {$b['moved']} (версии " . implode(', ', $b['versions']) . ") — `" . basename((string)$b['zip']) . '` в папке сеанса'
                . ' (пути в архиве — от корня сайта; вернуть — распаковать в корень)';
        }
        $o[] = '';
        $o[] = '## Записи и откат';
        $o[] = '';
        foreach ($d['batches'] as $b) {
            $done = count(array_filter($b['writes'], static fn($w) => !empty($w['done'])));
            $o[] = "- пачка {$b['n']} ({$b['label']}, " . Util::date((int)$b['time']) . ", {$b['via']}): файлов $done, архив `rollback/{$b['archive']}`" . (!empty($b['reverted']) ? ' — откачена' : '');
        }
        if (!$d['batches']) {
            $o[] = '- записей на сайт не было';
        }
        $o[] = '- откат всех записей: `php local/tools/aspro-merge/merge.php rollback`';
        $o[] = '';
        $o[] = '## Журнал';
        $o[] = '';
        foreach (array_slice($d['events'], -30) as $ev) {
            $o[] = '- ' . Util::date((int)$ev['time']) . " ({$ev['via']}): {$ev['what']}";
        }
        Util::put("{$s->dir}/report.md", implode("\n", $o) . "\n");
    }

    /**
     * Пометка verify в Markdown: первая строка — пункт списка, остальные (строки кода, с отступом 4 пробела) —
     * блок кода под ним (строки целиком, как в файле).
     */
    public static function noteMd(string $note): array
    {
        $lines = explode("\n", $note);
        $out = ['- ' . array_shift($lines)];
        if ($lines) {
            $out[] = '';
            $out[] = '  ~~~text';
            foreach ($lines as $l) {
                $out[] = '  ' . (str_starts_with($l, '    ') ? substr($l, 4) : $l);
            }
            $out[] = '  ~~~';
        }
        return $out;
    }

    /**
     * «Окно между установкой и решением»: что было на месте в каждом файле на разбор от установки шага до записи
     * решения и сколько это длилось; что вендор, похоже, исправил в этих файлах; связанные изменения вендора (с 1.2.0) —
     * где смесь версий могла сломать связку файлов. Для отчёта команде.
     */
    public static function windowSection(Session $s): array
    {
        return self::windowLines($s->d, $s->isOpen());
    }

    /** Раздел «Окно…» по данным сеанса ($d — session.json, $open — сеанс открыт); отдельно от Session — для selftest */
    public static function windowLines(array $d, bool $open): array
    {
        $list = array_filter($d['entries'], static fn($e) => $e['needs'] !== null && $e['cat'] !== 'not-applied');
        if (!$list) {
            return [];
        }
        $o = ['', '## Окно между установкой и решением', '',
            'Что было на сайте в файлах на разбор от установки шага обновления до записи решения. Пока на месте наша прежняя '
            . 'версия, изменения вендора в файле (в том числе исправления безопасности) не действуют; пока на месте версия вендора '
            . '(conflict_keep = theirs) — не действует наша доработка.', ''];
        foreach ($list as $e) {
            [$start, $end] = self::windowTimes($d, $e);
            $act = (string)$e['action'];
            $held = match (true) {
                $act === 'restore' && ($e['mode'] ?? '') === Area::COPY => 'в копии прежняя версия — изменения вендора не действовали',
                $act === 'restore' => 'на месте наша прежняя версия — изменения вендора не действовали',
                $act === 'take' => 'на месте версия вендора — нашей доработки не было',
                $act === 'delete' => 'файл удалён',
                default => 'файл как оставил обновлятор',
            };
            $when = $end !== null
                ? 'с ' . Util::date($start) . ' до ' . Util::date($end) . ' (' . self::minutes($end - $start) . "): $held; решение записано"
                    . (!empty($e['resolution']['source']) ? " ({$e['resolution']['source']})" : '')
                : 'с ' . Util::date($start) . ": $held — решения ещё нет" . ($open ? '' : ' (сеанс завершён без решения)');
            $o[] = "- `{$e['target']}` — $when"
                . (!empty($e['vendor_fix']['text']) ? "; вендор, похоже, исправил: {$e['vendor_fix']['text']}" : '')
                . (!empty($e['related']) ? '; связанные изменения вендора: ' . implode(', ', array_map(static fn($x) => "`{$x['target']}`", $e['related']))
                    . ' — если у них общий формат данных, в окне не работала и функция, которая их связывает' : '');
        }
        if (array_filter($list, static fn($e) => !empty($e['related']))) {
            $o[] = '';
            $o[] = '**Смесь версий.** Пока решения не было, файлы выше стояли в прежней версии, а связанные файлы вендора — уже в '
                . 'новой: один отдавал данные в старом формате, другой ждал новый (1.7.21: быстрый заказ — `PROPERTIES` через '
                . '`serialize` против `Json::decode` в компоненте; склады — неподписанные `params` против `unsignParameters` в '
                . '`ajax/productStoreAmount.php`). Совпадение имён — подсказка, а не вывод: что из этого не работало у посетителей и '
                . 'сколько времени, проверьте по контрактам и напишите в отчёте команде.';
        }
        return $o;
    }

    /** Начало окна (запись «нашей» версии после установки или появление файла в сеансе) и конец (запись решения или null) */
    private static function windowTimes(array $d, array $e): array
    {
        $start = (int)($d['ours'][$e['key']]['time'] ?? $d['opened']);
        $end = null;
        $resH = $e['resolution']['h'] ?? null;
        foreach ($d['batches'] as $b) {
            if (!empty($b['reverted'])) {
                continue;
            }
            foreach ($b['writes'] as $w) {
                if ($w['target'] !== $e['target'] || empty($w['done']) || !empty($w['reverted'])) {
                    continue;
                }
                $t = (int)$b['time'];
                if ($resH !== null && ($w['after'] ?? '-') === $resH && $end === null) {
                    $end = $t;
                } elseif ($end === null) {
                    $start = min($start, $t);
                }
            }
        }
        if ($end === null && $e['status'] === 'done' && isset($e['resolution']['time'])) {
            $end = (int)$e['resolution']['time']; // решение «как есть на сайте» — записывать было нечего
        }
        return [$start, $end];
    }

    private static function minutes(int $sec): string
    {
        return $sec < 90 ? max(0, $sec) . ' с' : (int)round($sec / 60) . ' мин';
    }
}
