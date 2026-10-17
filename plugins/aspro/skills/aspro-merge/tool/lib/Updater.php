<?php
/**
 * Следы обновлятора Аспро на сайте: журнал bitrix/modules/<модуль>/updaterlog.txt и бэкапы _<файл>.back<версия>.
 *
 * Бэкап обновлятор делает по списку в скрипте версии, только если такого бэкапа ещё нет; при установке через
 * несколько версий у каждого шага свой суффикс. Состояние до сеанса — самый ранний бэкап файла из созданных
 * в этом сеансе (суффикс не ниже базы сеанса, дата — не раньше снимка).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Updater
{
    /**
     * Запуски обновлятора из журнала: [['t' => время, 'from' => версия, 'to' => версия, 'finished' => bool,
     * 'line' => строка START как есть], ...]. Время — в часовом поясе PHP этого процесса (у обновлятора он мог быть
     * другим), поэтому для «был ли новый запуск» сравнивается строка, а не время.
     */
    public static function runs(Config $c): array
    {
        $f = $c->abs("bitrix/modules/{$c->module}/updaterlog.txt");
        $runs = [];
        foreach (is_file($f) ? (file($f, FILE_IGNORE_NEW_LINES) ?: []) : [] as $line) {
            if (preg_match('~^(\d\d)\.(\d\d)\.(\d{4}) (\d\d:\d\d:\d\d) (START|FINISH) UPDATE (\S+) -> (\S+)~', $line, $m)) {
                $t = (int)strtotime("$m[3]-$m[2]-$m[1] $m[4]");
                if ($m[5] === 'START') {
                    $runs[] = ['t' => $t, 'from' => $m[6], 'to' => $m[7], 'finished' => false, 'line' => trim($line)];
                } elseif ($runs && end($runs)['to'] === $m[7]) {
                    $runs[count($runs) - 1]['finished'] = true;
                }
            }
        }
        return $runs;
    }

    /** Начало последней серии запусков (за один клик ставится несколько версий подряд) */
    public static function sessionStart(Config $c): ?int
    {
        $runs = self::runs($c);
        if (!$runs) {
            return null;
        }
        $k = count($runs) - 1;
        while ($k > 0 && $runs[$k]['t'] - $runs[$k - 1]['t'] <= 600) {
            $k--;
        }
        return $runs[$k]['t'];
    }

    /** Последний запуск не дописал FINISH — обновлятор упал посреди шага */
    public static function unfinished(Config $c): ?array
    {
        $runs = self::runs($c);
        $last = $runs ? end($runs) : null;
        return ($last && !$last['finished']) ? $last : null;
    }

    /**
     * Свежие бэкапы области: путь исходного файла (от области) => список ['abs', 'ver', 'mtime'] по возрастанию версии
     * (первый — самый ранний в сеансе). Берутся только с суффиксом не ниже $from и не старше $since.
     * $rels — для публичной части: какие файлы искать.
     */
    public static function freshBackups(Config $c, Area $a, string $from, int $since, ?array $rels = null): array
    {
        $base = $c->abs($a->installed);
        $list = [];
        if ($a->kind === 'pub') {
            $dirs = [];
            foreach ($rels ?? [] as $rel) {
                $dirs[dirname($rel)] = true;
            }
            foreach (array_keys($dirs) as $d) {
                foreach (glob(($d === '.' ? $base : "$base/$d") . '/_*.back*') ?: [] as $f) {
                    $list[($d === '.' ? '' : "$d/") . basename($f)] = Util::norm($f);
                }
            }
        } else {
            $list = Util::walkBackups($base);
        }
        $out = [];
        foreach ($list as $brel => $abs) {
            $p = Util::parseBackup($brel);
            if ($p === null) {
                continue;
            }
            [$orig, $ver] = $p;
            $mt = (int)@filemtime($abs);
            if (version_compare($ver, $from, '<') || $mt < $since) {
                continue;
            }
            $out[$orig][] = ['abs' => $abs, 'ver' => $ver, 'mtime' => $mt];
        }
        foreach ($out as &$l) {
            usort($l, static fn($x, $y) => version_compare($x['ver'], $y['ver']));
        }
        unset($l);
        return $out;
    }

    /**
     * Правила веб-сервера, запрещающие отдачу бэкапов обновлятора _<файл>.back<версия> и _<папка>_back<версия>.zip
     * (в них исходный код вендора и наши доработки): nginx и Apache — для вывода в status, finish и README.
     */
    public static function denyRules(): array
    {
        return [
            'nginx (в server {} сайта, выше других «location ~», например со статикой *.zip — у регулярных location выигрывает первое совпадение): '
                . 'location ~ /_[^/]+(\.back[0-9.]+|_back[0-9.]+\.zip)$ { deny all; }',
            'Apache (в .htaccess корня сайта или в конфигурации): <FilesMatch "^_.+(\.back[0-9.]+|_back[0-9.]+\.zip)$"> Require all denied </FilesMatch> '
                . '(Apache 2.2 — Order allow,deny и Deny from all)',
        ];
    }

    /** Бэкап обновлятора по имени файла: [имя исходного файла или папки, версия, zip?] или null */
    public static function parseName(string $name): ?array
    {
        if (preg_match('/^_(.+)\.back(\d+(?:\.\d+)*)$/', $name, $m)) {
            return [$m[1], $m[2], false];
        }
        if (preg_match('/^_(.+)_back(\d+(?:\.\d+)*)\.zip$/', $name, $m)) {
            return [$m[1], $m[2], true];
        }
        return null;
    }

    /**
     * Все бэкапы обновлятора на сайте (_<файл>.back<версия>, _<папка>_back<версия>.zip) — там, где их делает и чистит
     * обновлятор Аспро: публичная часть (кроме bitrix, local, upload и скрытых папок), шаблоны сайта, компоненты, модуль
     * решения, его js/css/tools/images, мастер и гаджеты партнёра. По HTTP они отдаются как есть (nginx и Apache по
     * умолчанию не закрывают такие имена) — в них исходный код вендора и наши доработки.
     * Возвращает rel от корня => ['abs', 'rel', 'ver', 'mtime', 'size'], по пути.
     */
    public static function siteBackups(Config $c): array
    {
        $out = [];
        $add = static function (string $abs) use (&$out, $c): void {
            $abs = Util::norm($abs);
            $p = self::parseName(basename($abs));
            if ($p === null || !is_file($abs) || !str_starts_with($abs, $c->root . '/')) {
                return;
            }
            $rel = substr($abs, strlen($c->root) + 1);
            $out[$rel] = ['abs' => $abs, 'rel' => $rel, 'ver' => $p[1], 'mtime' => (int)@filemtime($abs), 'size' => (int)@filesize($abs)];
        };
        $whole = [];
        foreach (['bitrix/templates/*', 'bitrix/templates/.default', 'local/templates/*', 'local/templates/.default', "bitrix/components/{$c->partner}*", "local/components/{$c->partner}*",
            "bitrix/modules/{$c->partner}*", "local/modules/{$c->partner}*", "bitrix/js/{$c->module}*", "bitrix/css/{$c->module}*",
            "bitrix/tools/{$c->module}*", "bitrix/images/{$c->module}*", "bitrix/wizards/{$c->partner}*", "local/wizards/{$c->partner}*",
            "bitrix/gadgets/{$c->partner}*"] as $g) {
            foreach (glob($c->abs($g), GLOB_ONLYDIR) ?: [] as $d) {
                $whole[] = $d;
            }
        }
        foreach (array_unique($whole) as $d) {
            foreach (self::scan($d, []) as $f) {
                $add($f);
            }
        }
        $skipTop = ['bitrix', 'local', 'upload', 'cgi-bin', 'cgi', 'webp-copy', 'node_modules', 'vendor'];
        foreach ($c->siteDirs as $sd) {
            foreach (self::scan($c->abs($sd), $sd === '' ? $skipTop : []) as $f) {
                $add($f);
            }
        }
        ksort($out, SORT_STRING);
        return $out;
    }

    /** Бэкапы в папке и вложенных (ссылки на папки и скрытые папки, кроме .default, не обходятся; $skipTop — пропустить на первом уровне) */
    private static function scan(string $dir, array $skipTop): array
    {
        $found = [];
        $stack = [[Util::norm($dir), 0]];
        $n = 0;
        while ($stack && ++$n < 50000) {
            [$d, $depth] = array_pop($stack);
            $items = @scandir($d);
            if ($items === false) {
                continue;
            }
            foreach ($items as $it) {
                if ($it === '.' || $it === '..') {
                    continue;
                }
                $p = "$d/$it";
                if (is_dir($p)) {
                    // скрытые папки (.git, .idea, …) — нет, а .default (шаблоны компонентов) — да
                    if (($it[0] === '.' && $it !== '.default') || is_link($p) || ($depth === 0 && in_array($it, $skipTop, true))) {
                        continue;
                    }
                    $stack[] = [$p, $depth + 1];
                } elseif ($it[0] === '_' && self::parseName($it) !== null) {
                    $found[] = $p;
                }
            }
        }
        return $found;
    }

    /**
     * Отдаются ли бэкапы по HTTP: до $max запросов к сайту (base_url) по бэкапам из разных папок — сначала публичная
     * часть. Отдаётся — код 200 и начало ответа совпадает с началом файла. [['url', 'code', 'served'], ...]
     */
    public static function probeBackups(Config $c, array $backups, int $max = 3): array
    {
        if (!$c->baseUrl || PHP_SAPI !== 'cli' || !$backups) {
            return [];
        }
        $pick = [];
        $dirs = [];
        $list = array_values($backups);
        usort($list, static fn($a, $b) => [str_starts_with($a['rel'], 'bitrix/'), $a['rel']] <=> [str_starts_with($b['rel'], 'bitrix/'), $b['rel']]);
        foreach ($list as $b) {
            $d = dirname($b['rel']);
            if (!isset($dirs[$d]) && $b['size'] > 0) {
                $dirs[$d] = true;
                $pick[] = $b;
            }
            if (count($pick) >= $max) {
                break;
            }
        }
        $res = [];
        foreach ($pick as $b) {
            $url = rtrim($c->baseUrl, '/') . '/' . str_replace('%2F', '/', rawurlencode($b['rel']));
            $ctx = stream_context_create(['http' => ['ignore_errors' => true, 'timeout' => 10, 'follow_location' => 0, 'header' => "User-Agent: aspro-merge-status\r\n"],
                'ssl' => ['verify_peer' => false, 'verify_peer_name' => false]]);
            $http_response_header = [];
            $body = @file_get_contents($url, false, $ctx, 0, 65536);
            $hdrs = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : $http_response_header;
            $code = 0;
            foreach ($hdrs as $h) {
                if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) {
                    $code = (int)$m[1];
                }
            }
            $head = (string)@file_get_contents($b['abs'], false, null, 0, 65536);
            $body = (string)$body;
            $served = $code === 200 && $body !== '' && $head !== '' && str_starts_with($head, substr($body, 0, min(strlen($body), 4096)));
            $res[] = ['url' => $url, 'code' => $code, 'served' => $served];
        }
        return $res;
    }
}
