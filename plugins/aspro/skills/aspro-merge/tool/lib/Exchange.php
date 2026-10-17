<?php
/**
 * Работа без SSH: export — zip с тройками сеанса и инструкцией; import — zip с решёнными файлами.
 *
 * Формат выгрузки:
 *   README.md     — инструкция (что делать с тройками и что вернуть);
 *   manifest.json — сеанс, версии, для каждого файла — ключ, путь на сайте, хеши base/ours/theirs;
 *   report.md     — отчёт сеанса;
 *   files/<область>/<путь>/ — base, ours, theirs, merged, ours.diff, theirs.diff, info.json.
 * Возвращается тот же zip (или любой zip с manifest.json и файлами files/<область>/<путь>/resolved).
 * Импорт принимает решение, только если хеши base/ours/theirs в manifest.json совпадают с текущим сеансом:
 * решение относится к тем же версиям, что сейчас на сайте.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Exchange
{
    public const MAX_FILE = 16 * 1024 * 1024;

    public function __construct(private Config $c, private Session $s)
    {
    }

    public function export(Result $r, ?string $out, bool $all): void
    {
        $s = $this->s;
        $list = array_filter($s->d['entries'], static fn($e) => $e['files'] !== null
            && ($all || in_array($e['status'], ['conflict', 'review', 'resolved', 'error'], true)));
        $zip = [];
        $man = ['session' => $s->id(), 'module' => $this->c->module, 'template' => $this->c->template, 'from' => $s->d['from'],
            'to' => $s->d['to'], 'created' => date('c'), 'site' => $this->c->root, 'entries' => []];
        foreach ($list as $e) {
            $dir = "{$s->dir}/{$e['files']}";
            foreach (glob("$dir/*") ?: [] as $f) {
                $name = basename($f);
                if (is_file($f) && !str_starts_with($name, 'resolved.stale')) {
                    $zip["{$e['files']}/$name"] = (string)file_get_contents($f);
                }
            }
            $man['entries'][] = ['key' => $e['key'], 'target' => $e['target'], 'status' => $e['status'], 'cat' => $e['cat'],
                'about' => $e['about'], 'note' => $e['note'], 'mode' => $e['mode'], 'files' => $e['files'],
                'triple' => [$e['h']['base'], $e['h']['ours'], $e['h']['theirs']]];
        }
        $zip['manifest.json'] = Util::json($man);
        $zip['README.md'] = $this->readme($man);
        if (is_file("{$s->dir}/report.md")) {
            $zip['report.md'] = (string)file_get_contents("{$s->dir}/report.md");
        }
        $base = $out !== null ? preg_replace('~\.zip$~i', '', $out) : "{$s->dir}/export-" . date('Ymd-His');
        $file = Archive::write($base, $zip);
        $s->event('выгрузка ' . basename($file) . ': файлов ' . count($man['entries']), 'cli');
        $s->save();
        $r->line("Выгрузка: $file");
        $r->line('Файлов для разбора: ' . count($man['entries']) . ($all ? ' (вместе с чисто слившимися)' : ''));
        $r->next('скачать архив, решить конфликты локально (инструкция — README.md внутри), вернуть zip и выполнить '
            . 'php local/tools/aspro-merge/merge.php import <zip>');
        $r->data = ['file' => $file, 'entries' => count($man['entries'])];
    }

    private function readme(array $man): string
    {
        $lines = [];
        foreach ($man['entries'] as $e) {
            $lines[] = "- `{$e['files']}/` → на сайте `{$e['target']}` — {$e['about']}" . ($e['note'] ? " ({$e['note']})" : '');
        }
        $list = implode("\n", $lines);
        return <<<MD
# Сверка Аспро {$man['from']} → {$man['to']}: файлы для разбора

Выгрузка сеанса `{$man['session']}` ({$man['created']}). Сайт на сервере не меняется, пока вы не загрузите решения обратно.

## Что внутри

Для каждого файла — папка `files/<область>/<путь>/`:

- `base` — версия вендора до обновления (общий предок);
- `ours` — наша доработанная версия;
- `theirs` — новая версия вендора;
- `merged` — результат автоматического слияния с маркерами конфликта
  (`<<<<<<< ours` / `||||||| base` / `=======` / `>>>>>>> theirs`), если слияние возможно;
- `ours.diff` — что мы доработали (base → ours), `theirs.diff` — что поменял вендор (base → theirs);
- `info.json` — ключ записи и хеши версий (не менять).

## Что сделать

1. В каждой папке записать итоговый файл `resolved` (рядом с `merged`), без маркеров конфликта.
   Правило: код вендора — основа, наша доработка переносится по смыслу; исправления безопасности вендора
   (экранирование, подпись параметров, проверки `sessid`, `backurl`) не откатывать.
2. Проверить: `php -l resolved` (для PHP-файлов), нет маркеров `<<<<<<<`/`>>>>>>>`, нет BOM в начале PHP-файла.
   Переводы строк можно любые — при загрузке они приводятся к стилю файла вендора.
3. Запаковать обратно в zip: `manifest.json` (без изменений) и папки `files/…` с файлами `resolved`
   (остальные файлы можно оставить или убрать).
4. Загрузить zip на сервер (FTP или файловый менеджер Битрикса) вне публичных папок и выполнить:
   `php local/tools/aspro-merge/merge.php import <zip>` — решения проверяются (хеши версий, маркеры, php -l)
   и записываются на сайт с архивом отката. Затем `php local/tools/aspro-merge/merge.php verify --urls`.

Решение принимается, только если версии base/ours/theirs на сервере не изменились с момента выгрузки.

## Файлы

$list

MD;
    }

    /** Принять решения из zip. $check — проверка содержимого (маркеры, BOM, php -l), бросает MergeException. */
    public function import(Result $r, string $zipFile, callable $check): int
    {
        $s = $this->s;
        $a = Archive::openFile($zipFile);
        $man = json_decode((string)$a->get('manifest.json'), true);
        if (!is_array($man)) {
            Util::fail('В архиве нет manifest.json — загружайте zip, сделанный из выгрузки export');
        }
        if (($man['session'] ?? '') !== $s->id()) {
            Util::fail("Выгрузка сделана для сеанса «" . ($man['session'] ?? '?') . "», а открыт «{$s->id()}» — решения относятся к другим версиям");
        }
        $manBy = [];
        foreach ($man['entries'] ?? [] as $me) {
            $manBy[$me['key']] = $me;
        }
        $byFiles = [];
        $byTarget = [];
        foreach ($s->d['entries'] as $e) {
            if ($e['files']) {
                $byFiles[$e['files']] = $e;
            }
            $byTarget[$e['target']] = $e;
        }
        $n = 0;
        foreach ($a->names() as $name) {
            $name = str_replace('\\', '/', $name);
            if (!Util::safeRel($name)) {
                $r->warn("пропущен небезопасный путь в архиве: $name");
                continue;
            }
            $e = null;
            if (preg_match('~^(files/.+)/resolved$~', $name, $m)) {
                $e = $byFiles[$m[1]] ?? null;
            } elseif (preg_match('~^resolved/(.+)$~', $name, $m)) {
                $e = $byTarget[$m[1]] ?? null;
            } else {
                continue;
            }
            if ($e === null) {
                $r->warn("$name: такого файла нет в плане сеанса — пропущен");
                continue;
            }
            $me = $manBy[$e['key']] ?? null;
            if ($me === null) {
                $r->warn("$name: файла нет в manifest.json выгрузки — пропущен");
                continue;
            }
            if ($me['triple'] !== [$e['h']['base'], $e['h']['ours'], $e['h']['theirs']]) {
                $r->problem("{$e['target']}: версии изменились после выгрузки (новый шаг обновления или правка) — решение устарело, сделайте export заново");
                continue;
            }
            if (($a->size($name) ?? 0) > self::MAX_FILE) {
                $r->problem("$name: слишком большой файл");
                continue;
            }
            $raw = (string)$a->get($name);
            // переводы строк и BOM — как у вендора; двоичное решение принимается побайтно (styleLike его не трогает)
            $content = Util::styleLike($raw, $s->blob($e['h']['theirs']) ?? $s->blob($e['h']['ours']) ?? $raw);
            try {
                $check($e, $content);
            } catch (MergeException $ex) {
                $r->problem($ex->getMessage());
                continue;
            }
            $h = $s->putBlob($content);
            $s->d['resolutions'][$e['key']] = ['h' => $h, 'triple' => $me['triple'], 'source' => 'импорт ' . basename($zipFile), 'time' => time()];
            $s->acceptOurs($e['key']);
            if ($e['files']) {
                Util::put("{$s->dir}/{$e['files']}/resolved", $content);
            }
            $r->line("  принято решение: {$e['target']}");
            $n++;
        }
        $a->close();
        $s->event("импорт " . basename($zipFile) . ": принято решений $n", 'cli');
        $s->save();
        $r->line("Принято решений: $n");
        if (!$n) {
            $r->attention();
        }
        return $n;
    }
}
