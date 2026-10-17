<?php
/**
 * Настройки сверки и описание сайта: модуль решения, шаблон, эталоны в модуле, области и их режимы, хранилище.
 *
 * Настройки — необязательный файл local/aspro-merge.config.php (пример — local/tools/aspro-merge/config.example.php).
 * Без него всё определяется само:
 *   модуль  — aspro.* с install/wizards/<партнёр>/<решение>/site/templates;
 *   шаблон  — папка в эталоне W, которая установлена на сайте (bitrix/templates или local/templates);
 *   хранилище — над DOCUMENT_ROOT (вне веб-доступа), если туда можно писать, иначе
 *               /bitrix/backup/aspro-merge-<16 случайных символов>/ с .htaccess (deny) и пустым index.php.
 *
 * Области (каждая — эталон в модуле + установленная папка + необязательная копия; режим — по наличию копии):
 *   tpl        — шаблон сайта: W ↔ bitrix/templates/<шаблон> (V), копия — local/templates/<шаблон> (L);
 *   cmp/<имя>  — компонент Аспро: install/components/<партнёр>/<имя> ↔ bitrix/components/<партнёр>/<имя>,
 *                копия — local/components/<партнёр>/<имя>;
 *   pub        — публичная часть: WP ↔ файлы сайта с теми же путями (всегда «на месте»).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Config
{
    public const TOOL_VERSION = '1.0';
    public const CONFIG_FILE = 'local/aspro-merge.config.php';
    public const STORE_POINTER = 'bitrix/backup/aspro-merge.store.php';
    public const NOTIFY_TAG = 'ASPRO_MERGE';

    /**
     * Сгенерированные сайтом файлы шаблона — не доработки и не изменения вендора. css/custom.css и js/custom.js сюда
     * НЕ входят: это пользовательские файлы (их пишет страница «Разработчикам», в них кладут свои стили и скрипты),
     * и если вендор привезёт свою версию, её надо слить с нашей, а не молча принять.
     */
    public const DEFAULT_EXCLUDE = [
        'themes/*',
        'bg_color/*',
        'css/custom.min.css',
        'js/custom.min.js',
        '.styles.php',
        'description.php',
    ];

    public string $root;
    public string $module;
    public string $partner;
    public string $solution;
    public string $template;
    public string $lang;
    /** Эталоны (от корня): W — шаблон, WP — публичная часть, C — компоненты */
    public array $etalon = [];
    public string $versionFile;
    public array $siteDirs = [''];
    public ?string $baseUrl = null;
    public array $urls = [];
    public array $exclude = [];
    public array $excludeComponents = [];
    public array $excludePublic = [];
    public int $keepVersions = 3;
    public int $timeLimit = 20;
    public ?string $phpCli = null;
    public bool $notify = true;
    public bool $useCore = true;
    /** finish оставляет бэкапы обновлятора на сайте (по умолчанию уносит бэкапы версий сеанса в папку сеанса) */
    public bool $keepBackups = false;
    /**
     * Что лежит «на месте» в файле на разбор (конфликт, двоичный, минифицированный, слияние не прошло php -l) до
     * решения: 'ours' — наша прежняя версия (доработка действует, изменения вендора в файле — нет), 'theirs' — версия
     * вендора, как её оставил обновлятор (исправления вендора действуют, доработки в файле нет). Только режим «на месте»:
     * в режиме «копия» файл копии до решения остаётся прежним всегда.
     */
    public string $conflictKeep = 'ours';
    public ?string $storeConfigured = null;
    /** Файл настроек, из которого прочитаны настройки (null — файла нет) */
    public ?string $configFile = null;
    public array $raw = [];
    private ?string $store = null;
    /** @var Area[]|null */
    private ?array $areas = null;

    /**
     * $over — переопределения из командной строки: root, module, template, store, config (путь к файлу настроек),
     * no-core и т. п.
     */
    public static function load(string $root, array $over = []): self
    {
        $c = new self();
        $c->root = Util::norm(realpath($root) ?: $root);
        if (!is_dir($c->root . '/bitrix')) {
            Util::fail("В {$c->root} нет папки bitrix — это не корень сайта (укажите --root=<корень сайта>)");
        }
        $file = $over['config'] ?? ($c->root . '/' . self::CONFIG_FILE);
        $raw = [];
        if (is_string($file) && is_file($file)) {
            $raw = (static fn(string $f) => include $f)($file);
            if (!is_array($raw)) {
                Util::fail("Файл настроек $file должен возвращать массив (return [...];)");
            }
        }
        // --store= из командной строки — от папки запуска; store в файле настроек — от корня сайта (см. storeBase)
        $cliStore = is_string($over['store'] ?? null) && $over['store'] !== '' ? (string)$over['store'] : null;
        if ($cliStore !== null && !Util::isAbs($cliStore)) {
            $cliStore = Util::norm(getcwd() . '/' . $cliStore);
        }
        $raw = array_replace($raw, array_filter([
            'module' => $over['module'] ?? null,
            'template' => $over['template'] ?? null,
            'store' => $cliStore,
            'base_url' => $over['base-url'] ?? $over['base'] ?? null,
        ], static fn($v) => $v !== null && $v !== true));
        if (is_string($over['urls-file'] ?? null)) {
            $raw['urls_file'] = $over['urls-file'];
            $raw['urls'] = [];
        }
        $c->raw = $raw;
        $c->lang = (string)($raw['lang'] ?? 'ru');
        $c->detect($raw['module'] ?? null, $raw['template'] ?? null);
        $c->siteDirs = array_values(array_map(static fn($d) => trim(str_replace('\\', '/', (string)$d), '/'), (array)($raw['site_dirs'] ?? [''])));
        $c->baseUrl = isset($raw['base_url']) ? rtrim((string)$raw['base_url'], '/') : null;
        $c->urls = self::loadUrls($c->root, $raw);
        $c->exclude = array_values(array_unique(array_merge(self::DEFAULT_EXCLUDE, (array)($raw['exclude'] ?? []))));
        $c->excludeComponents = (array)($raw['exclude_components'] ?? []);
        $c->excludePublic = (array)($raw['exclude_public'] ?? []);
        $c->keepVersions = max(2, (int)($raw['keep_versions'] ?? 3));
        $c->timeLimit = max(5, (int)($raw['time_limit'] ?? 20));
        $c->phpCli = isset($raw['php_cli']) ? (string)$raw['php_cli'] : null;
        $c->notify = (bool)($raw['notify'] ?? true);
        $c->useCore = !isset($over['no-core']) && (bool)($raw['use_core'] ?? true);
        $c->keepBackups = (bool)($raw['keep_backups'] ?? false);
        $keep = strtolower(trim((string)($over['conflict-keep'] ?? $raw['conflict_keep'] ?? 'ours')));
        if (!in_array($keep, ['ours', 'theirs'], true)) {
            Util::fail("conflict_keep в настройках — 'ours' или 'theirs', а не «{$keep}»");
        }
        $c->conflictKeep = $keep;
        $c->storeConfigured = isset($raw['store']) ? (string)$raw['store'] : null;
        $c->configFile = is_string($file) && is_file($file) ? Util::norm($file) : null;
        return $c;
    }

    /** Страницы для --urls: urls из настроек и/или файл urls_file (по одной на строку, # — комментарий) */
    private static function loadUrls(string $root, array $raw): array
    {
        $urls = (array)($raw['urls'] ?? []);
        $file = $raw['urls_file'] ?? null;
        if ($file !== null) {
            $f = Util::isAbs((string)$file) ? (string)$file : "$root/$file";
            foreach (is_file($f) ? (file($f, FILE_IGNORE_NEW_LINES) ?: []) : [] as $l) {
                $l = trim($l);
                if ($l !== '' && $l[0] !== '#') {
                    $urls[] = $l;
                }
            }
        }
        return array_values(array_unique($urls));
    }

    /** Модуль решения и шаблон: из настроек или автоматически */
    private function detect(?string $module, ?string $template): void
    {
        $cands = [];
        $mods = $module !== null ? [$module] : array_map('basename', glob($this->root . '/bitrix/modules/aspro.*', GLOB_ONLYDIR) ?: []);
        foreach ($mods as $m) {
            foreach (glob($this->root . "/bitrix/modules/$m/install/wizards/*/*/site/templates/*", GLOB_ONLYDIR) ?: [] as $t) {
                $name = basename($t);
                if ($name === '.default' || str_contains($name, 'mail') || ($template !== null && $name !== $template)) {
                    continue;
                }
                $installed = is_dir("{$this->root}/bitrix/templates/$name") || is_dir("{$this->root}/local/templates/$name");
                $cands[] = ['module' => $m, 'template' => $name, 'wiz' => Util::norm(dirname($t, 3)), 'installed' => $installed];
            }
        }
        if (!$cands) {
            Util::fail($module !== null
                ? "Не найден эталон шаблона в bitrix/modules/$module/install/wizards/*/*/site/templates/ — проверьте module в настройках"
                : 'Не найден модуль решения Аспро (bitrix/modules/aspro.*/install/wizards/...): укажите module и template в ' . self::CONFIG_FILE);
        }
        usort($cands, static fn($a, $b) => [$b['installed'], $a['module'], $a['template']] <=> [$a['installed'], $b['module'], $b['template']]);
        $pick = $cands[0];
        $this->module = $pick['module'];
        $this->template = $pick['template'];
        // .../install/wizards/<партнёр>/<решение>
        $this->solution = basename($pick['wiz']);
        $this->partner = basename(dirname($pick['wiz']));
        $wizRel = substr($pick['wiz'], strlen($this->root) + 1);
        $this->etalon = [
            'W' => "$wizRel/site/templates/{$this->template}",
            'WP' => "$wizRel/site/public/{$this->lang}",
            'C' => "bitrix/modules/{$this->module}/install/components/{$this->partner}",
        ];
        $this->versionFile = "bitrix/modules/{$this->module}/install/version.php";
    }

    public function version(): ?string
    {
        return Util::versionFromFile("{$this->root}/{$this->versionFile}");
    }

    public function abs(string $rel): string
    {
        return $rel === '' ? $this->root : $this->root . '/' . ltrim($rel, '/');
    }

    /** @return Area[] id => Area */
    public function areas(): array
    {
        if ($this->areas !== null) {
            return $this->areas;
        }
        $a = [];
        $a['tpl'] = new Area('tpl', 'tpl', "шаблон {$this->template}", 'W', '',
            "bitrix/templates/{$this->template}", "local/templates/{$this->template}", $this->exclude);
        $names = [];
        foreach (glob($this->abs($this->etalon['C']) . '/*', GLOB_ONLYDIR) ?: [] as $d) {
            $names[] = basename($d);
        }
        sort($names, SORT_STRING);
        foreach ($names as $n) {
            $a["cmp/$n"] = new Area("cmp/$n", 'cmp', "компонент {$this->partner}:$n", 'C', "$n/",
                "bitrix/components/{$this->partner}/$n", "local/components/{$this->partner}/$n", $this->excludeComponents);
        }
        foreach ($this->siteDirs as $sd) {
            $id = $sd === '' ? 'pub' : "pub/$sd";
            $a[$id] = new Area($id, 'pub', $sd === '' ? 'публичная часть' : "публичная часть $sd/", 'WP', '',
                $sd, null, $this->excludePublic);
        }
        foreach ($a as $area) {
            $area->mode = ($area->copy !== null && is_dir($this->abs($area->copy))) ? Area::COPY : Area::INPLACE;
        }
        return $this->areas = $a;
    }

    public function area(string $id): ?Area
    {
        return $this->areas()[$id] ?? null;
    }

    /**
     * Папка хранилища модуля (<хранилище>/<модуль>). $create — создать, если её нет (иначе только вычислить).
     * Порядок: настройки → запомненный выбор (bitrix/backup/aspro-merge.store.php) → над DOCUMENT_ROOT →
     * /bitrix/backup/aspro-merge-<случайные символы>/.
     */
    public function store(bool $create = false): string
    {
        if ($this->store !== null && is_dir($this->store)) {
            return $this->store;
        }
        $this->store = $this->storeBase($create) . '/' . $this->module;
        if ($create) {
            Util::mkdir($this->store, 0750);
        }
        return $this->store;
    }

    private function storeBase(bool $create): string
    {
        if ($this->storeConfigured !== null) {
            // относительный путь в настройках — от корня сайта (а не от папки запуска: в веб-запросе это /bitrix/admin)
            $base = Util::isAbs($this->storeConfigured) ? Util::norm($this->storeConfigured) : Util::norm($this->root . '/' . $this->storeConfigured);
            if ($create) {
                self::protect($base);
            }
            return $base;
        }
        $pointer = $this->abs(self::STORE_POINTER);
        if (is_file($pointer)) {
            $p = (static fn(string $f) => include $f)($pointer);
            if (is_string($p) && $p !== '') {
                return Util::isAbs($p) ? Util::norm($p) : $this->abs($p);
            }
        }
        $parent = Util::norm(dirname($this->root));
        $outside = "$parent/aspro-merge/" . basename($this->root);
        if (!self::looksLikeWebRoot($parent) && is_dir($outside) && is_writable($outside)) {
            return $outside;
        }
        if (!$create) {
            return $outside; // ещё не создано — показываем, где будет
        }
        if (self::looksLikeWebRoot($parent)) {
            // над корнем — корень другого сайта (addon-домены, /var/www/html/<сайт>): предсказуемое имя отдавалось бы по URL
            $outside = "$parent/aspro-merge-" . Util::randomName(16) . '/' . basename($this->root);
        }
        if (@is_writable($parent) && (@is_dir(dirname($outside)) || @mkdir(dirname($outside), 0750))
            && (@is_dir($outside) || @mkdir($outside, 0750)) && is_writable($outside)) {
            $base = $outside;
            Util::own(dirname($outside));
            Util::own($outside);
            self::protect(dirname($outside));
        } else {
            $base = $this->abs('bitrix/backup/aspro-merge-' . Util::randomName(16));
            Util::mkdir($base, 0750);
        }
        self::protect($base);
        $this->rememberStore($base);
        return $base;
    }

    /** Запрет отдачи папки через веб: .htaccess (Apache) и пустой index.php (листинг); для nginx — правило в README */
    public static function protect(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
            return;
        }
        try {
            if (!is_file("$dir/.htaccess")) {
                Util::put("$dir/.htaccess", "# Снимки сверки Аспро — не отдавать через веб (для nginx — правило deny в конфигурации сервера)\n"
                    . "<IfModule mod_authz_core.c>\n    Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n</IfModule>\n");
            }
            if (!is_file("$dir/index.php")) {
                Util::put("$dir/index.php", '');
            }
        } catch (MergeException) {
        }
    }

    /** Похожа ли папка на корень сайта (тогда то, что в ней лежит, может отдаваться по HTTP) */
    public static function looksLikeWebRoot(string $dir): bool
    {
        foreach (['index.php', 'index.html', 'index.htm', '.htaccess', 'bitrix', 'wp-config.php', 'public_html'] as $f) {
            if (file_exists("$dir/$f")) {
                return true;
            }
        }
        return false;
    }

    /** Предупреждения о месте хранилища (для снимка и status) */
    public function storeWarnings(): array
    {
        $w = [];
        $store = $this->store();
        if ($this->isStoreInsideRoot()) {
            $w[] = 'Хранилище снимков внутри корня сайта (' . $store . '): над DOCUMENT_ROOT писать нельзя. В нём платный код вендора и наши доработки — '
                . 'убедитесь, что веб-сервер его не отдаёт: в Apache действует .htaccess, в nginx нужно правило location ^~ /bitrix/backup/ { deny all; } '
                . '(проверка — merge.php status с base_url в настройках).';
        } else {
            // первая общая с корнем сайта папка над хранилищем: если она сама похожа на корень сайта, хранилище может отдаваться
            $d = Util::norm(dirname($store));
            while (dirname($d) !== $d && !str_starts_with($this->root . '/', $d . '/')) {
                $d = Util::norm(dirname($d));
            }
            if (dirname($d) !== $d && self::looksLikeWebRoot($d)) {
                $w[] = "Хранилище снимков ($store) лежит в папке $d, похожей на корень другого сайта: убедитесь, что веб-сервер её не отдаёт "
                    . '(или задайте store в local/aspro-merge.config.php вне веб-доступа).';
            }
        }
        return $w;
    }

    /** Запомнить выбор хранилища в PHP-файле (через веб он ничего не выводит) */
    private function rememberStore(string $base): void
    {
        $pointer = $this->abs(self::STORE_POINTER);
        $rel = str_starts_with($base, $this->root . '/') ? substr($base, strlen($this->root) + 1) : $base;
        if (is_dir(dirname($pointer)) || @mkdir(dirname($pointer), 0755, true)) {
            @file_put_contents($pointer, "<?php\n// Где сверка Аспро (local/tools/aspro-merge) хранит снимки. Не удалять: без снимков сверка не найдёт базу.\nreturn " . var_export($rel, true) . ";\n");
        }
    }

    public function isStoreInsideRoot(): bool
    {
        return str_starts_with($this->store() . '/', $this->root . '/');
    }

    public function summary(): array
    {
        $areas = [];
        foreach ($this->areas() as $a) {
            $areas[$a->id] = $a->describe();
        }
        return [
            'root' => $this->root, 'module' => $this->module, 'template' => $this->template,
            'partner' => $this->partner, 'solution' => $this->solution, 'version' => $this->version(),
            'etalon' => $this->etalon, 'areas' => $areas, 'store' => $this->store(),
        ];
    }
}

/** Область сверки: эталон + установленная папка + необязательная копия */
final class Area
{
    public const COPY = 'copy';
    public const INPLACE = 'inplace';

    public string $mode = self::INPLACE;

    public function __construct(
        public readonly string $id,
        public readonly string $kind,      // tpl | cmp | pub
        public readonly string $title,
        public readonly string $etalonKey, // W | WP | C
        public readonly string $etalonPrefix,
        public readonly string $installed, // от корня ('' — корень сайта)
        public readonly ?string $copy,
        public readonly array $exclude,
    ) {
    }

    /** Рабочая папка: где лежат доработки (копия в режиме «копия», иначе установленная) */
    public function work(): string
    {
        return $this->mode === self::COPY ? (string)$this->copy : $this->installed;
    }

    public function target(string $rel): string
    {
        $w = $this->work();
        return $w === '' ? $rel : "$w/$rel";
    }

    public function installedPath(string $rel): string
    {
        return $this->installed === '' ? $rel : "{$this->installed}/$rel";
    }

    public function isExcluded(string $rel): bool
    {
        foreach ($this->exclude as $p) {
            if ($p !== '' && ($p[0] === '~' ? preg_match($p, $rel) : fnmatch($p, $rel))) {
                return true;
            }
        }
        return false;
    }

    public function modeTitle(): string
    {
        return $this->mode === self::COPY ? "«копия» ({$this->copy})" : '«на месте» (' . ($this->installed === '' ? 'корень сайта' : $this->installed) . ')';
    }

    public function describe(): array
    {
        return ['id' => $this->id, 'kind' => $this->kind, 'title' => $this->title, 'mode' => $this->mode,
            'etalon' => $this->etalonKey . ($this->etalonPrefix !== '' ? ':' . rtrim($this->etalonPrefix, '/') : ''),
            'installed' => $this->installed, 'copy' => $this->copy, 'work' => $this->work()];
    }
}
