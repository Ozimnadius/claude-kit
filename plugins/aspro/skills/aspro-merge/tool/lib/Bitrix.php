<?php
/**
 * Связь с ядром Битрикса — только там, где без него нельзя: сброс кеша, уведомления в админке (своё — создать или
 * снять, чужие — перечислить и снять по тегу), журнал событий, агенты (свой и посторонние агенты сверки — найти и снять).
 *
 * Если код уже работает внутри ядра (события OnModuleUpdate/OnBeforeProlog, агент) — вызывается API напрямую.
 * Из консоли ядро подключается в ОТДЕЛЬНОМ процессе (merge.php core <clear-cache|notify|log|notices|drop-notice|
 * agents|drop-foreign-agents|uninstall>): если ядро не поднимется (нет базы, ошибка в init.php), основная команда всё
 * равно завершится; кеш тогда чистится удалением папок, а об уведомлениях, журнале и агентах сказано, что они не сделаны.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Bitrix
{
    public static function inCore(): bool
    {
        return defined('B_PROLOG_INCLUDED') && class_exists('\CMain', false);
    }

    /** Ядро есть на диске и его можно поднять в отдельном процессе */
    public static function coreAvailable(Config $c): bool
    {
        return $c->useCore && PHP_SAPI === 'cli' && Util::canRun()
            && is_file($c->abs('bitrix/modules/main/include/prolog_before.php'))
            && (is_file($c->abs('bitrix/.settings.php')) || is_file($c->abs('bitrix/php_interface/dbconn.php')));
    }

    /** Сбросить кеш Битрикса. Возвращает текст «что сделано». */
    public static function clearCache(Config $c): string
    {
        if (self::inCore()) {
            return self::clearCacheInCore();
        }
        if (self::coreAvailable($c)) {
            [$ok, $out] = self::callCore($c, 'clear-cache', []);
            if ($ok) {
                return $out;
            }
        }
        return self::clearCacheFiles($c);
    }

    public static function clearCacheInCore(): string
    {
        $done = [];
        try {
            if (function_exists('BXClearCache')) {
                \BXClearCache(true);
                $done[] = 'кеш компонентов (bitrix/cache)';
            }
        } catch (\Throwable) {
        }
        try {
            \Bitrix\Main\Application::getInstance()->getManagedCache()->cleanAll();
            $done[] = 'управляемый кеш';
        } catch (\Throwable) {
        }
        try {
            if (isset($GLOBALS['stackCacheManager']) && is_object($GLOBALS['stackCacheManager'])) {
                $GLOBALS['stackCacheManager']->CleanAll();
            }
        } catch (\Throwable) {
        }
        try {
            if (class_exists('\Bitrix\Main\Data\StaticHtmlCache')) {
                \Bitrix\Main\Data\StaticHtmlCache::getInstance()->deleteAll();
                $done[] = 'композитный кеш';
            }
        } catch (\Throwable) {
        }
        return 'сброшен через ядро: ' . ($done ? implode(', ', $done) : 'ничего');
    }

    /** Без ядра: удалить содержимое bitrix/cache, bitrix/managed_cache, bitrix/stack_cache, страницы композита */
    public static function clearCacheFiles(Config $c): string
    {
        $done = [];
        foreach (['bitrix/cache', 'bitrix/managed_cache', 'bitrix/stack_cache'] as $d) {
            $abs = $c->abs($d);
            if (!is_dir($abs)) {
                continue;
            }
            foreach (scandir($abs) ?: [] as $f) {
                if ($f === '.' || $f === '..') {
                    continue;
                }
                is_dir("$abs/$f") ? Util::rrmdir("$abs/$f") : @unlink("$abs/$f");
            }
            $done[] = $d;
        }
        $hp = $c->abs('bitrix/html_pages');
        if (is_dir($hp)) {
            // настройки композита (.config.php, .enabled) не трогаем
            foreach (scandir($hp) ?: [] as $f) {
                if ($f === '.' || $f === '..' || $f[0] === '.') {
                    continue;
                }
                is_dir("$hp/$f") ? Util::rrmdir("$hp/$f") : @unlink("$hp/$f");
            }
            $done[] = 'bitrix/html_pages';
        }
        return 'сброшен удалением папок: ' . ($done ? implode(', ', $done) : 'папок кеша нет');
    }

    /** Уведомление в админке (тег ASPRO_MERGE); $text === null — снять уведомление */
    public static function notify(Config $c, ?string $text): string
    {
        if (!$c->notify) {
            return 'уведомления выключены в настройках';
        }
        if (self::inCore()) {
            return self::notifyInCore($text);
        }
        if (self::coreAvailable($c)) {
            [$ok, $out] = self::callCore($c, 'notify', ['text' => $text]);
            return $ok ? $out : 'уведомление не создано: ядро не подключилось (' . mb_substr(trim($out), 0, 200) . ')';
        }
        return 'уведомление в админке не создано: ядро Битрикса недоступно из консоли';
    }

    public static function notifyInCore(?string $text): string
    {
        if (!class_exists('\CAdminNotify')) {
            return 'нет CAdminNotify';
        }
        \CAdminNotify::DeleteByTag(Config::NOTIFY_TAG);
        if ($text === null) {
            return 'уведомление снято';
        }
        \CAdminNotify::Add(['MESSAGE' => $text, 'TAG' => Config::NOTIFY_TAG, 'MODULE_ID' => 'main', 'ENABLE_CLOSE' => 'Y']);
        return 'уведомление в админке обновлено';
    }

    /**
     * Запись в журнал событий (Настройки → Инструменты → Журнал событий, тип ASPRO_MERGE). Внутри ядра — сразу;
     * из консоли (если передан $c) — через ядро в отдельном процессе, как уведомление. Возвращает «что сделано».
     */
    public static function log(string $severity, string $item, string $text, ?Config $c = null): string
    {
        if (self::inCore()) {
            return self::logInCore($severity, $item, $text);
        }
        if ($c !== null && self::coreAvailable($c)) {
            [$ok, $out] = self::callCore($c, 'log', ['severity' => $severity, 'item' => $item, 'text' => $text]);
            return $ok ? $out : 'запись в журнал событий не сделана: ядро не подключилось (' . mb_substr(trim($out), 0, 200) . ')';
        }
        return 'журнал событий недоступен: ядро Битрикса из консоли не подключается' . ($c !== null && !$c->useCore ? ' (--no-core или use_core => false)' : '');
    }

    public static function logInCore(string $severity, string $item, string $text): string
    {
        if (!class_exists('\CEventLog')) {
            return 'нет CEventLog';
        }
        try {
            \CEventLog::Add(['SEVERITY' => $severity, 'AUDIT_TYPE_ID' => 'ASPRO_MERGE', 'MODULE_ID' => 'main', 'ITEM_ID' => $item, 'DESCRIPTION' => $text]);
            return 'записано в журнал событий';
        } catch (\Throwable $e) {
            return 'запись в журнал событий не удалась: ' . $e->getMessage();
        }
    }

    /**
     * Все уведомления в админке: [['id', 'tag', 'module', 'message' (без разметки)], ...] или null — ядро недоступно.
     */
    public static function notices(Config $c): ?array
    {
        if (self::inCore()) {
            return self::noticesInCore();
        }
        if (!self::coreAvailable($c)) {
            return null;
        }
        [$ok, $out] = self::callCore($c, 'notices', []);
        // не \R: без флага u он режет по байту 0x85, который бывает внутри русских букв в UTF-8
        $lines = preg_split('~\r\n|\n|\r~', trim($out)) ?: [];
        $d = $ok ? json_decode((string)end($lines), true) : null;
        return is_array($d) ? $d : null;
    }

    public static function noticesInCore(): array
    {
        $out = [];
        if (!class_exists('\CAdminNotify') || !method_exists('\CAdminNotify', 'GetList')) {
            return $out;
        }
        try {
            // пустые LID и PUBLIC_SECTION — без отбора: все уведомления, и в админке, и в публичной части
            $res = \CAdminNotify::GetList(['ID' => 'ASC'], ['LID' => '', 'PUBLIC_SECTION' => '']);
            while ($res && ($n = $res->Fetch())) {
                $msg = trim((string)preg_replace('~\s+~u', ' ', html_entity_decode(strip_tags((string)($n['MESSAGE'] ?? '')), ENT_QUOTES, 'UTF-8')));
                $out[] = ['id' => (int)($n['ID'] ?? 0), 'tag' => (string)($n['TAG'] ?? ''), 'module' => (string)($n['MODULE_ID'] ?? ''), 'message' => $msg];
            }
        } catch (\Throwable) {
        }
        return $out;
    }

    /**
     * Снять уведомления в админке с ТОЧНО таким тегом (CAdminNotify::DeleteByTag удаляет по подстроке — им не пользуемся,
     * чтобы не задеть чужие уведомления с похожим тегом). Возвращает «что сделано».
     */
    public static function dropNotice(Config $c, string $tag): string
    {
        if (self::inCore()) {
            return self::dropNoticeInCore($tag);
        }
        if (!self::coreAvailable($c)) {
            return 'уведомление не снято: ядро Битрикса из консоли не подключается';
        }
        [$ok, $out] = self::callCore($c, 'drop-notice', ['tag' => $tag]);
        return $ok ? $out : 'уведомление не снято: ядро не подключилось (' . mb_substr(trim($out), 0, 200) . ')';
    }

    public static function dropNoticeInCore(string $tag): string
    {
        $n = 0;
        foreach (self::noticesInCore() as $x) {
            if ($x['tag'] === $tag && $x['id'] > 0) {
                \CAdminNotify::Delete($x['id']);
                $n++;
            }
        }
        return $n ? "снято уведомлений с тегом $tag: $n" : "уведомлений с тегом $tag нет";
    }

    /**
     * Уведомления, похожие на сообщения об обновлении Аспро или сверке доработок, кроме своего ($own): по тегу, модулю
     * или тексту (Аспро, aspro, обновлен…, update, sync, merge, сверк…). Такие могли остаться от прежних схем
     * доработок (например, MYSITE_ASPRO_SYNC от самописной схемы обновления) и сбивать с толку.
     */
    public static function relevantNotices(array $rows, string $own = Config::NOTIFY_TAG): array
    {
        $re = '~aspro|аспро|обновл|update|sync|merge|сверк~iu';
        return array_values(array_filter($rows, static fn(array $n) => strcasecmp((string)$n['tag'], $own) !== 0
            && (preg_match($re, (string)$n['tag']) || preg_match($re, (string)$n['module']) || preg_match($re, (string)$n['message']))));
    }

    /**
     * Агент сверки (его регистрирует local/php_interface/include/aspro_merge.php) и опция main:aspro_merge_agent — кеш
     * проверки «агент на месте» (время последней проверки; «Y» — от прежних версий). Сам признак агента — запись в
     * таблице агентов: файл подключения проверяет её и добавляет агент заново, если его нет.
     */
    public const AGENT = 'AsproMergeSite::agent();';
    public const AGENT_OPTION = 'aspro_merge_agent';
    /** «Похож на агент сверки»: как NAME LIKE '%AsproMerge%' или '%aspro_merge%' («_» — любой символ), без учёта регистра */
    public const AGENT_LIKE = '~aspro.?merge~is';

    /**
     * Строки агентов (['id', 'name', 'module', 'active', 'next']) → ['own' => с точно нашим именем, 'foreign' => похожие
     * на агент сверки, но с другим именем — например, агенты прежних версий сверки или самописных схем]. Чистая функция.
     */
    public static function splitAgents(array $rows): array
    {
        $out = ['own' => [], 'foreign' => []];
        foreach ($rows as $a) {
            $name = (string)($a['name'] ?? '');
            if ($name === self::AGENT) {
                $out['own'][] = $a;
            } elseif (preg_match(self::AGENT_LIKE . 'u', $name) || preg_match(self::AGENT_LIKE, $name)) {
                $out['foreign'][] = $a;
            }
        }
        return $out;
    }

    /** Агенты сверки — свои и посторонние (см. splitAgents); null — ядро недоступно, ['error' => …] — ошибка ядра */
    public static function agents(Config $c): ?array
    {
        if (self::inCore()) {
            return self::agentsInCore();
        }
        if (!self::coreAvailable($c)) {
            return null;
        }
        return self::coreJson($c, 'agents', []);
    }

    /**
     * Все агенты сайта просматриваются целиком и отбираются здесь (а не LIKE в базе): в PostgreSQL LIKE учитывает регистр,
     * а в MySQL «=» — нет. Агентов на сайте обычно десятки–сотни.
     */
    public static function agentsInCore(): array
    {
        $rows = [];
        try {
            if (!class_exists('\CAgent')) {
                return ['own' => [], 'foreign' => [], 'error' => 'нет CAgent'];
            }
            $res = \CAgent::GetList(['ID' => 'ASC'], []);
            while ($res && ($a = $res->Fetch())) {
                $rows[] = ['id' => (int)($a['ID'] ?? 0), 'name' => (string)($a['NAME'] ?? ''), 'module' => (string)($a['MODULE_ID'] ?? ''),
                    'active' => (string)($a['ACTIVE'] ?? ''), 'next' => (string)($a['NEXT_EXEC'] ?? '')];
            }
        } catch (\Throwable $e) {
            return ['own' => [], 'foreign' => [], 'error' => $e->getMessage()];
        }
        return self::splitAgents($rows);
    }

    /** Снять посторонние агенты сверки (ищутся заново тем же правилом); $dry — только найти. ['found' => […], 'removed' => n] */
    public static function dropForeignAgents(Config $c, bool $dry): ?array
    {
        if (self::inCore()) {
            return self::dropForeignAgentsInCore($dry);
        }
        if (!self::coreAvailable($c)) {
            return null;
        }
        return self::coreJson($c, 'drop-foreign-agents', ['dry' => $dry]);
    }

    public static function dropForeignAgentsInCore(bool $dry): array
    {
        $a = self::agentsInCore();
        $out = ['found' => $a['foreign'], 'removed' => 0, 'dry' => $dry];
        if (isset($a['error'])) {
            $out['error'] = $a['error'];
            return $out;
        }
        foreach ($a['foreign'] as $f) {
            try {
                if (!$dry && $f['id'] > 0 && \CAgent::Delete($f['id'])) {
                    $out['removed']++;
                }
            } catch (\Throwable $e) {
                $out['error'] = $e->getMessage();
            }
        }
        return $out;
    }

    /**
     * Для uninstall: найти и (если не $dry) снять свой агент, уведомления с тегом ASPRO_MERGE (точно таким) и опцию
     * main:aspro_merge_agent. $connected — интеграция ещё подключена в init.php: агент и опцию тогда не трогать (файл
     * подключения при заходе в админку нашёл бы, что агента нет, и добавил его снова). Посторонние агенты сверки
     * перечисляются всегда, снимаются — только с $removeForeign. Через ядро (из консоли — в отдельном процессе).
     * ['agents' => [...], 'foreign' => [...], 'notices' => [...], 'option' => значение, 'removed' => [...]] или null — ядро недоступно.
     */
    public static function uninstall(Config $c, bool $dry, bool $connected, bool $removeForeign = false): ?array
    {
        if (self::inCore()) {
            return self::uninstallInCore($dry, $connected, $removeForeign);
        }
        if (!self::coreAvailable($c)) {
            return null;
        }
        return self::coreJson($c, 'uninstall', ['dry' => $dry, 'connected' => $connected, 'remove_foreign' => $removeForeign]);
    }

    public static function uninstallInCore(bool $dry, bool $connected, bool $removeForeign = false): array
    {
        $out = ['agents' => [], 'foreign' => [], 'notices' => [], 'option' => null, 'connected' => $connected,
            'removed' => ['agents' => 0, 'foreign' => 0, 'notices' => 0, 'option' => false], 'dry' => $dry];
        try {
            if (class_exists('\CAgent')) {
                $a = self::agentsInCore();
                if (isset($a['error'])) {
                    throw new \RuntimeException($a['error']);
                }
                $out['agents'] = $a['own'];
                $out['foreign'] = $a['foreign'];
                foreach ($a['own'] as $x) {
                    if (!$dry && !$connected && \CAgent::Delete($x['id'])) {
                        $out['removed']['agents']++;
                    }
                }
                foreach ($a['foreign'] as $x) {
                    if (!$dry && $removeForeign && \CAgent::Delete($x['id'])) {
                        $out['removed']['foreign']++;
                    }
                }
            }
            foreach (self::noticesInCore() as $n) {
                if ($n['tag'] === Config::NOTIFY_TAG && $n['id'] > 0) {
                    $out['notices'][] = $n;
                    if (!$dry) {
                        \CAdminNotify::Delete($n['id']);
                        $out['removed']['notices']++;
                    }
                }
            }
            if (class_exists('\Bitrix\Main\Config\Option')) {
                $v = (string)\Bitrix\Main\Config\Option::get('main', self::AGENT_OPTION, '');
                $out['option'] = $v;
                if (!$dry && !$connected && $v !== '') {
                    \Bitrix\Main\Config\Option::delete('main', ['name' => self::AGENT_OPTION]);
                    $out['removed']['option'] = true;
                }
            }
        } catch (\Throwable $e) {
            $out['error'] = $e->getMessage();
        }
        return $out;
    }

    /** Действие ядра в отдельном процессе с ответом JSON в последней строке; не JSON — ['error' => …] */
    private static function coreJson(Config $c, string $action, array $payload): array
    {
        [$ok, $out] = self::callCore($c, $action, $payload);
        $lines = preg_split('~\r\n|\n|\r~', trim($out)) ?: [];
        $d = $ok ? json_decode((string)end($lines), true) : null;
        return is_array($d) ? $d : ['error' => mb_substr(trim($out), 0, 300)];
    }

    /** Действие с ядром в отдельном процессе: [успех, вывод] */
    public static function callCore(Config $c, string $action, array $payload): array
    {
        $tmp = tempnam(sys_get_temp_dir(), 'amc');
        file_put_contents($tmp, json_encode($payload, JSON_UNESCAPED_UNICODE));
        $cmd = [PHP_BINARY, dirname(__DIR__) . '/merge.php', 'core', $action, '--payload=' . $tmp, '--root=' . $c->root];
        [$rc, $out, $err] = Util::run($cmd, $c->root, null, 120);
        @unlink($tmp);
        $out = trim($out);
        return [$rc === 0 && $out !== '', $rc === 0 ? $out : trim($out . ' ' . $err)];
    }

    /** Точка входа отдельного процесса: подключить ядро и выполнить действие */
    public static function coreMain(string $root, string $action, array $payload, ?string $host): int
    {
        $_SERVER['DOCUMENT_ROOT'] = $root;
        $_SERVER['HTTP_HOST'] = $_SERVER['SERVER_NAME'] = $host ?: 'localhost';
        foreach (['NO_KEEP_STATISTIC', 'NOT_CHECK_PERMISSIONS', 'BX_NO_ACCELERATOR_RESET', 'BX_CRONTAB', 'STOP_STATISTICS', 'NO_AGENT_CHECK', 'DisableEventsCheck'] as $k) {
            if (!defined($k)) {
                define($k, true);
            }
        }
        define('ASPRO_MERGE_CORE_CALL', true);
        ob_start();
        require $root . '/bitrix/modules/main/include/prolog_before.php';
        ob_end_clean();
        $out = match ($action) {
            'clear-cache' => self::clearCacheInCore(),
            'notify' => self::notifyInCore($payload['text'] ?? null),
            'log' => self::logInCore((string)($payload['severity'] ?? 'INFO'), (string)($payload['item'] ?? 'aspro_merge'), (string)($payload['text'] ?? '')),
            'notices' => json_encode(self::noticesInCore(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE),
            'drop-notice' => self::dropNoticeInCore((string)($payload['tag'] ?? '')),
            'uninstall' => json_encode(self::uninstallInCore(!empty($payload['dry']), !empty($payload['connected']), !empty($payload['remove_foreign'])),
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE),
            'agents' => json_encode(self::agentsInCore(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE),
            'drop-foreign-agents' => json_encode(self::dropForeignAgentsInCore(!empty($payload['dry'])),
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE),
            default => 'неизвестное действие ' . $action,
        };
        echo $out, "\n";
        return 0;
    }
}
