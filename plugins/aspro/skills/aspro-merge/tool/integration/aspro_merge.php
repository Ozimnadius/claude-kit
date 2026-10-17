<?php
/**
 * Сверка Аспро (local/tools/aspro-merge) — интеграция с сайтом.
 * Подключение — одна строка в local/php_interface/init.php:
 *
 *     require_once __DIR__ . '/include/aspro_merge.php';
 *
 * Что делает:
 *  1) main:OnModuleUpdate для модуля решения — открыть или продолжить сеанс сверки и сразу применить очевидное
 *     (недоработанные файлы — новая версия вендора, чистые слияния, новые файлы); уведомление в админке
 *     (тег ASPRO_MERGE) с итогом и подсказкой «запустите сверку в Claude». Работает внутри запроса установки
 *     обновления: никакого вывода (иначе сломается ответ «STP…» обновлятора), все ошибки перехватываются (в том
 *     числе битый или недозалитый файл библиотеки), время ограничено (time_limit в настройках, по умолчанию 20 с).
 *  2) main:OnBeforeProlog на /bitrix/admin/update_system_partner_call.php — предохранитель. Срабатывает только на
 *     запросе, который устанавливает шаг с решением Аспро: описание шага уже получено от сервера обновлений
 *     (bitrix/updates/update_archive.gz.log) и в нём есть модуль aspro.*, установленный на сайте как решение.
 *     Запрос списка и описания (ответ «STP0») и шаги других модулей не трогаются — даже если настройки сверки
 *     сломаны. Нет снимка текущей версии — снять; не удалось — остановить установку ответом «ERR…», который
 *     страница обновлений покажет как ошибку. Если открыт сеанс сверки — сохранить в него правки на сайте перед шагом.
 *  3) Агент раз в сутки (регистрируется сам: при заходе в админку и после обновления модуля проверяет, есть ли он в
 *     таблице агентов, и добавляет, если нет): снимок текущей версии, если его нет и нет открытого сеанса; если модуль
 *     обновился, а сеанса нет (событие не сработало) — открывает сверку.
 * Если папки local/tools/aspro-merge нет, ничего не делает. Открытый напрямую по URL (без ядра) — тоже.
 * Удаление сверки: php local/tools/aspro-merge/merge.php uninstall --dry (что будет сделано), затем uninstall —
 * снимет уведомление и покажет по шагам, что удалить руками (первой — строку подключения в init.php); агент и опцию
 * снимает, когда строки подключения уже нет (пока она есть, этот файл зарегистрировал бы агент снова).
 *
 * Версия файла — AsproMergeSite::VERSION; она совпадает с версией инструмента (php local/tools/aspro-merge/merge.php
 * version сравнивает их). Файл обновляют вместе с папкой инструмента; в поставке он лежит в integration/aspro_merge.php.
 */

use Bitrix\Main\Config\Option;
use Bitrix\Main\EventManager;

if (!class_exists(EventManager::class)) {
    return; // файл открыли по URL без ядра Битрикса: ничего не делать и ничего не выводить
}

if (!class_exists('AsproMergeSite', false)) {
    final class AsproMergeSite
    {
        /** Версия файла подключения — та же, что у инструмента (AsproMerge\Tool::VERSION) */
        public const VERSION = '1.0.0';
        public const AGENT = 'AsproMergeSite::agent();';
        /** Кеш проверки агента: время (unix), когда агент последний раз был найден в базе */
        public const OPTION_AGENT = 'aspro_merge_agent';
        /** Сколько секунд верить кешу: чаще база на хитах админки не опрашивается */
        public const AGENT_CHECK_TTL = 3600;
        public const INSTALL_SCRIPT = '/bitrix/admin/update_system_partner_call.php';

        private static ?\AsproMerge\Config $config = null;

        /** Подключить библиотеку: false — её нет (инструмент не установлен); битый файл — исключение (ловят вызывающие) */
        private static function load(): bool
        {
            if (class_exists(\AsproMerge\Tool::class, false)) {
                return true;
            }
            $f = $_SERVER['DOCUMENT_ROOT'] . '/local/tools/aspro-merge/lib/bootstrap.php';
            if (!is_file($f) || PHP_VERSION_ID < 80100) {
                return false;
            }
            require_once $f;
            if (!class_exists(\AsproMerge\Tool::class, false)) {
                throw new \RuntimeException('библиотека сверки загружена не полностью (файлы недозалиты?)');
            }
            return true;
        }

        private static function config(): \AsproMerge\Config
        {
            return self::$config ??= \AsproMerge\Config::load($_SERVER['DOCUMENT_ROOT']);
        }

        private static function describe(\Throwable $e): string
        {
            return $e->getMessage() . ($e instanceof \AsproMerge\MergeException ? '' : ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')');
        }

        /** 1. После установки шага обновления */
        public static function onModuleUpdate($modules): void
        {
            $modules = array_map('strval', (array)$modules);
            if (!preg_grep('/^aspro\./', $modules)) {
                return;
            }
            $level = ob_get_level();
            ob_start(); // любой вывод превратит ответ шага в «ошибку», и установка следующих шагов остановится
            try {
                if (!self::load()) {
                    return;
                }
                self::$config = null; // настройки и эталон, прочитанные предохранителем до установки, устарели
                $c = self::config();
                if (in_array($c->module, $modules, true)) {
                    self::registerAgent(true);
                    (new \AsproMerge\Tool($c, 'OnModuleUpdate'))->afterUpdate($modules);
                }
            } catch (\Throwable $e) {
                self::fault('Сверка Аспро после обновления не выполнена: ' . self::describe($e));
            } finally {
                while (ob_get_level() > $level) {
                    ob_end_clean();
                }
            }
        }

        /** Модули решений Аспро из описания шага, которые установлены на сайте как решения (есть мастер) */
        private static function stepSolutions(): array
        {
            $log = $_SERVER['DOCUMENT_ROOT'] . '/bitrix/updates/update_archive.gz.log';
            $desc = is_file($log) ? (string)@file_get_contents($log) : '';
            if ($desc === '' || !preg_match_all('/aspro\.[a-z0-9_]+/i', $desc, $m)) {
                return [];
            }
            $out = [];
            foreach (array_unique(array_map('strtolower', $m[0])) as $mod) {
                if (is_dir($_SERVER['DOCUMENT_ROOT'] . "/bitrix/modules/$mod/install/wizards")) {
                    $out[] = $mod;
                }
            }
            return $out;
        }

        /** 2. Предохранитель на шаге установки + регистрация агента */
        public static function onBeforeProlog(): void
        {
            if (defined('ADMIN_SECTION') && ADMIN_SECTION === true && !self::isInstallRequest()) {
                self::registerAgentSafe();
                return;
            }
            if (!self::isInstallRequest()) {
                return;
            }
            global $USER;
            if (!is_object($USER) || !$USER->CanDoOperation('install_updates') || !check_bitrix_sessid()) {
                return; // без прав ядро само ответит «*»
            }
            // описания шага ещё нет (этот запрос только получает его — ответ STP0) или в шаге нет решения Аспро —
            // установку не трогаем, настройки сверки даже не читаем
            $mods = self::stepSolutions();
            if (!$mods) {
                return;
            }
            $guard = null;
            $level = ob_get_level();
            ob_start();
            try {
                if (!self::load()) {
                    return;
                }
                $c = self::config();
                if (in_array($c->module, $mods, true)) {
                    @set_time_limit(300);
                    $guard = (new \AsproMerge\Tool($c, 'предохранитель'))->guard();
                }
            } catch (\Throwable $e) {
                $guard = ['ok' => false, 'message' => 'сверка не загрузилась — ' . self::describe($e)];
            } finally {
                while (ob_get_level() > $level) {
                    ob_end_clean();
                }
            }
            if ($guard !== null && !$guard['ok']) {
                self::fault('Установка обновления остановлена: не удалось сохранить снимок для сверки — ' . $guard['message']);
                while (ob_get_level() > 0) {
                    ob_end_clean();
                }
                echo 'ERR', htmlspecialcharsbx('Сверка Аспро: не удалось сохранить снимок текущей версии перед обновлением ('
                    . $guard['message'] . '). Установка остановлена, сайт не изменён. Обратитесь к ответственному за доработки: '
                    . 'php local/tools/aspro-merge/merge.php status');
                die();
            }
        }

        private static function isInstallRequest(): bool
        {
            foreach (['SCRIPT_NAME', 'PHP_SELF'] as $k) {
                $p = str_replace('\\', '/', (string)($_SERVER[$k] ?? ''));
                if ($p === self::INSTALL_SCRIPT) {
                    return true;
                }
            }
            return false;
        }

        /** 3. Агент раз в сутки */
        public static function agent(): string
        {
            $level = ob_get_level();
            ob_start();
            try {
                if (self::load()) {
                    self::$config = null;
                    (new \AsproMerge\Tool(self::config(), 'агент'))->agent();
                }
            } catch (\Throwable $e) {
                self::fault('Агент сверки Аспро: ' . self::describe($e));
            } finally {
                while (ob_get_level() > $level) {
                    ob_end_clean();
                }
            }
            return self::AGENT;
        }

        private static function registerAgentSafe(): void
        {
            try {
                self::registerAgent();
            } catch (\Throwable $e) {
            }
        }

        /**
         * Зарегистрировать агент, если его нет в базе. Наличие проверяется в таблице агентов (CAgent::GetList по точному
         * имени); опция main:aspro_merge_agent — только кеш этой проверки (время, когда агент последний раз был на месте):
         * пока ей меньше AGENT_CHECK_TTL, база на хитах админки не опрашивается. Агента нет (удалили, база восстановлена
         * из копии, опцию перенесли с другого сайта) — кеш сбрасывается, агент добавляется заново. $force — проверить
         * базу, не глядя на кеш (после обновления модуля). Значение «Y» прежних версий кешем не считается.
         */
        public static function registerAgent(bool $force = false): void
        {
            if (!class_exists('\CAgent')) {
                return;
            }
            $now = time();
            $checked = (int)Option::get('main', self::OPTION_AGENT, '');
            if (!$force && $checked > 0 && $checked <= $now && $now - $checked < self::AGENT_CHECK_TTL) {
                return;
            }
            if (!self::agentExists()) {
                Option::delete('main', ['name' => self::OPTION_AGENT]); // кеш устарел: агента в базе нет
                \CAgent::AddAgent(self::AGENT, 'main', 'N', 86400);
                if (!self::agentExists()) {
                    return; // не добавился — кеш не ставим, проверим на следующем хите
                }
            }
            Option::set('main', self::OPTION_AGENT, (string)$now);
        }

        /** Агент с точно таким именем есть в базе (=NAME в MySQL без учёта регистра — поэтому имя сверяется ещё и здесь) */
        private static function agentExists(): bool
        {
            $res = \CAgent::GetList(['ID' => 'ASC'], ['=NAME' => self::AGENT]);
            while ($res && ($a = $res->Fetch())) {
                if ((string)($a['NAME'] ?? '') === self::AGENT) {
                    return true;
                }
            }
            return false;
        }

        private static function fault(string $text): void
        {
            try {
                if (class_exists('\CEventLog')) {
                    \CEventLog::Add(['SEVERITY' => 'ERROR', 'AUDIT_TYPE_ID' => 'ASPRO_MERGE', 'MODULE_ID' => 'main', 'ITEM_ID' => 'aspro_merge', 'DESCRIPTION' => $text]);
                }
                if (class_exists('\CAdminNotify')) {
                    \CAdminNotify::DeleteByTag('ASPRO_MERGE');
                    \CAdminNotify::Add(['MESSAGE' => htmlspecialcharsbx($text) . '. Запустите сверку в Claude Code: <code>php local/tools/aspro-merge/merge.php status</code>.',
                        'TAG' => 'ASPRO_MERGE', 'MODULE_ID' => 'main', 'ENABLE_CLOSE' => 'Y']);
                }
            } catch (\Throwable $e) {
            }
        }
    }

    $em = EventManager::getInstance();
    $em->addEventHandlerCompatible('main', 'OnModuleUpdate', [AsproMergeSite::class, 'onModuleUpdate']);
    $em->addEventHandlerCompatible('main', 'OnBeforeProlog', [AsproMergeSite::class, 'onBeforeProlog']);
}
