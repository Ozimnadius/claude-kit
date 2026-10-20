<?php
/**
 * План сверки: что поменял вендор и что с этим делать — для каждой области и каждого файла.
 *
 * Считается каждый раз заново от базы сеанса (снимок до обновления) и зафиксированных в сеансе «наших» версий,
 * а не от уже применённых файлов, — поэтому применение идемпотентно и переживает несколько шагов обновления подряд.
 *
 * Режим «копия» (рабочая папка — копия L): база = установленная папка до обновления (из снимка),
 *   их = установленная папка сейчас (её записал обновлятор), наша = копия на начало сеанса. Если в снимке
 *   установленная папка уже отличалась от эталона (её правили напрямую или режим сменился после снимка), база
 *   неоднозначна — такие файлы идут на разбор с базой «эталон до обновления».
 * Режим «на месте» (рабочая папка — установленная V): база = эталон до обновления (из снимка),
 *   наша = файл из снимка (или свежий бэкап обновлятора, если файл правили после снимка), их = файл сейчас.
 *   Изменение файла на сайте приписывается обновлятору, только если с прошлого раза был шаг обновления;
 *   изменение на той же версии — это правка на сайте во время сеанса: она становится «нашей» версией и идёт на
 *   разбор (инструмент её не перезаписывает). Правка, сделанная между шагами и перезаписанная следующим шагом,
 *   восстанавливается из бэкапа этого шага или из снимка предохранителя перед ним.
 */

declare(strict_types=1);

namespace AsproMerge;

final class Planner
{
    public const CAT = [
        'vendor-only' => 'не доработан — новая версия вендора',
        'new-file' => 'новый файл вендора',
        'deleted-clean' => 'вендор удалил файл (не доработан)',
        'deleted-modified' => 'вендор удалил доработанный файл',
        'deleted-ours' => 'файла не было на сайте при снимке (удалили как доработку или не устанавливали), а обновлятор его положил',
        'merge' => 'доработан и изменён вендором — трёхстороннее слияние',
        'ours-ws' => 'наше отличие только в отступах и переводах строк — берём вендора',
        'stale-copy' => 'копия — старый код вендора (совпадает с прежней версией), а не доработка — берём новую версию вендора',
        'theirs-eol' => 'вендор сменил только переводы строк — оставляем нашу',
        'same' => 'наша версия уже совпадает с новой версией вендора',
        'point-edit' => 'обновлятор изменил файл не по эталону (точечная правка) — проверить',
        'not-applied' => 'эталон изменился, но обновлятор этот файл на сайт не переносил',
        'absent-in-copy' => 'в копии нет каталога шаблона компонента — ядро возьмёт файл из установленной папки',
        'absent-no-fallback' => 'в копии файла нет, а из установленной папки ядро его не возьмёт — новая версия вендора кладётся в копию',
        'added-both' => 'новый файл вендора, а у нас уже есть свой с тем же именем',
        'no-base' => 'нет базы для слияния — сравнить вручную',
        'binary' => 'двоичный (или больше 4 МБ) файл доработан и изменён вендором',
        'min' => 'минифицированный файл доработан',
        'changed-outside' => 'файл изменили во время сеанса не инструментом (правка на сайте)',
        'lint' => 'результат слияния не прошёл php -l (или проверить его здесь нечем)',
        'mode-changed' => 'режим области сменился после снимка — автоматически ничего не применяется',
        'base-ambiguous' => 'в снимке установленная папка отличалась от эталона — база для слияния неоднозначна',
    ];

    public const ACT = [
        'none' => 'ничего (уже как надо)',
        'take' => 'взять новую версию вендора',
        'copy' => 'скопировать новый файл вендора',
        'delete' => 'удалить',
        'merge' => 'записать результат слияния',
        'restore' => 'вернуть нашу версию',
        'keep' => 'оставить как есть',
    ];

    /** Что сделано с файлом, если план применён (status = applied) — по действию */
    public const DONE = [
        'none' => 'ничего не нужно',
        'take' => 'записана новая версия вендора',
        'copy' => 'скопирован новый файл вендора',
        'delete' => 'удалён',
        'merge' => 'записан результат слияния',
        'restore' => 'возвращена наша версия',
        'keep' => 'оставлен как есть',
    ];

    /** Что лежит на месте, пока файл ждёт решения (status = conflict/review/error) — по действию */
    public const HOLD = [
        'none' => 'файл не тронут',
        'take' => 'на месте версия вендора',
        'copy' => 'на месте новый файл вендора',
        'delete' => 'файл удалён',
        'merge' => 'на месте результат слияния',
        'restore' => 'на месте наша версия',
        'keep' => 'файл не тронут',
    ];

    /**
     * Слова, которые встречаются в изменениях почти любого файла шаблона или компонента, — не признак того, что
     * изменения в двух файлах связаны (сравнение без учёта регистра).
     */
    private const STOP = ['function', 'return', 'array', 'isset', 'empty', 'unset', 'foreach', 'while', 'false', 'true', 'null',
        'class', 'public', 'private', 'protected', 'static', 'const', 'endif', 'endforeach', 'endwhile', 'endfor', 'elseif', 'break',
        'continue', 'string', 'value', 'values', 'input', 'hidden', 'title', 'style', 'script', 'label', 'button', 'href', 'parent',
        'document', 'window', 'jquery', 'length', 'params', 'arparams', 'arresult', 'aritem', 'aritems', 'application', 'getmessage',
        'htmlspecialcharsbx', 'htmlspecialchars', 'includecomponent', 'includefile', 'site_dir', 'site_template_path', 'document_root',
        '_server', '_request', '_post', '_get', 'bitrix', 'coptimus', 'solution', 'message', 'require', 'include', 'require_once',
        'include_once', 'define', 'defined', 'count', 'strlen', 'intval', 'implode', 'explode', 'in_array', 'array_merge', 'sprintf',
        'header', 'footer', 'block', 'wrapper', 'inner', 'content', 'image', 'images', 'items', 'links', 'result', 'option', 'options',
        'template', 'component', 'templates', 'components', 'default', 'echo', 'print', 'width', 'height', 'event', 'events', 'element',
        'elements', 'section', 'sections', 'catalog', 'iblock', 'module', 'modules', 'object', 'typeof', 'undefined', 'click', 'change',
        'append', 'remove', 'addclass', 'removeclass', 'attr', 'find', 'closest', 'each', 'text', 'html', 'ajax', 'data', 'type', 'name',
        'item', 'list', 'info', 'desc', 'price', 'props', 'property', 'properties', 'local', 'index', 'main', 'this', 'self', 'span',
        'else', 'true', 'action', 'form', 'field', 'fields', 'src', 'alt', 'rel', 'url', 'link', 'icon', 'wrap', 'show', 'hide', 'top',
        'bottom', 'left', 'right', 'first', 'last', 'next', 'prev', 'current', 'active', 'selected', 'checked', 'disabled', 'number',
        'basket', 'product', 'products', 'offer', 'offers', 'detail', 'preview', 'picture', 'pictures', 'document', 'ready', 'arparams'];

    private array $entries = [];
    private array $warnings = [];
    private int $excluded = 0;
    private array $hashCache = [];
    private bool $noBase;
    private ?string $planVersion;
    private string $vNow;
    private int $ticks = 0;
    /** id области => режим в снимке, если он не равен текущему */
    private array $modeChanged = [];
    /** ключ => пометка «правили на сайте во время сеанса» (запись идёт на разбор, действие не меняется) */
    private array $flag = [];
    /** ключ => пояснение к записи (на разбор не переводит) */
    private array $note = [];
    /** снимки прежних версий (кроме базы) — ленивая загрузка */
    private ?array $oldSnaps = null;

    public function __construct(private Config $c, private Session $s, private ?Snapshot $base, private ?float $deadline = null)
    {
        $this->noBase = $base === null;
    }

    /** Пересчитать план; записи сохраняются в сеанс (без сохранения файла сеанса). По сроку — TimeUpException. */
    public function run(): array
    {
        Etalon::reset();
        $from = (string)($this->s->d['from'] ?? '0');
        $since = (int)$this->s->d['backups_since'];
        $this->vNow = (string)$this->s->d['to'];
        // версия, для которой план уже считали целиком: всё, что изменилось после этого на той же версии, — правка на сайте
        $this->planVersion = !empty($this->s->d['plan']['complete']) ? ($this->s->d['plan']['version'] ?? null) : null;
        foreach ($this->c->areas() as $a) {
            $this->tick(true);
            $E1 = Etalon::current($this->c, $a);
            if ($this->base) {
                $E0 = $this->base->etalonFor($a);
                $I0 = $this->base->state($a, 'I');
                $mode0 = $this->base->stateMode($a);
                if ($mode0 !== null && $mode0 !== $a->mode) {
                    $this->modeChanged[$a->id] = $mode0;
                    $this->warnings[] = "{$a->title}: режим сменился после снимка (в снимке — " . ($mode0 === Area::COPY ? '«копия»' : '«на месте»')
                        . ', сейчас — ' . $a->modeTitle() . '): автоматически в этой области ничего не применяется, всё — на разбор; '
                        . 'база для слияния — эталон версии до обновления. Если смена режима задумана, разберите файлы (resolve) по merged.';
                }
            } else {
                $E0 = [];
                $I0 = [];
            }
            $pubRels = null;
            if ($a->kind === 'pub') {
                $pubRels = array_values(array_unique(array_merge(array_keys($E0), $E1->rels(), array_keys($I0))));
                $I1 = FileSet::listed($this->c->abs($a->installed), $pubRels);
            } else {
                $I1 = FileSet::dir($this->c->abs($a->installed));
            }
            $bk = Updater::freshBackups($this->c, $a, $from, $since, $pubRels);
            if ($this->noBase) {
                $I0 = $this->pseudoOld($a, $I1, $bk, $since);
            }
            if ($a->mode === Area::COPY) {
                $this->copyArea($a, $E0, $E1, $I0, $I1, $bk);
            } else {
                $this->inplaceArea($a, $E0, $E1, $I0, $I1, $bk);
            }
        }
        $this->statuses();
        $this->linkRelated();
        $this->vendorFixes();
        ksort($this->entries, SORT_STRING);
        $this->s->d['entries'] = $this->entries;
        $this->s->d['plan'] = ['time' => time(), 'version' => $this->vNow, 'complete' => true, 'excluded' => $this->excluded,
            'warnings' => array_values(array_unique($this->warnings))];
        return $this->entries;
    }

    public function warnings(): array
    {
        return array_values(array_unique($this->warnings));
    }

    /** Проверка срока (в событии время ограничено): каждые 50 файлов или сразу ($now) */
    private function tick(bool $now = false): void
    {
        if ($this->deadline !== null && ($now || ++$this->ticks % 50 === 0) && microtime(true) > $this->deadline) {
            throw new TimeUpException('не хватило времени на расчёт плана сверки');
        }
    }

    // --- без снимка: старое состояние установленной папки восстанавливается из бэкапов обновлятора ---

    private array $pseudoContent = [];

    private function pseudoOld(Area $a, FileSet $I1, array $bk, int $since): array
    {
        $old = [];
        foreach ($I1->rels() as $rel) {
            if (isset($bk[$rel])) {
                $abs = $bk[$rel][0]['abs'];
                $c = Util::readSmall($abs);
                if ($c !== null) {
                    $old[$rel] = Util::hashes($c);
                    $this->pseudoContent[$a->id][$rel] = $c;
                } elseif (($h = Util::hashesFile($abs)) !== null) {
                    $old[$rel] = $h;
                }
            } elseif ((int)@filemtime($I1->abs[$rel]) < $since) {
                $old[$rel] = $I1->hash($rel); // не трогался обновлятором
            }
            // иначе — файл появился в этом обновлении (новый файл вендора)
        }
        return $old;
    }

    private function oldContent(Area $a, string $rel): ?string
    {
        if ($this->noBase) {
            return $this->pseudoContent[$a->id][$rel] ?? null;
        }
        return $this->base->stateContent($a, 'I', $rel);
    }

    // --- режим «копия» ---

    private function copyArea(Area $a, array $E0, FileSet $E1, array $I0, FileSet $I1, array $bk): void
    {
        $s = $this->s;
        $L1 = FileSet::dir($this->c->abs((string)$a->copy));
        $paths = array_unique(array_merge(array_keys($I0), $I1->rels()));
        sort($paths, SORT_STRING);
        foreach ($paths as $rel) {
            $this->tick();
            $i0 = $I0[$rel] ?? null;
            $i1 = $I1->hash($rel);
            if (($i0['h'] ?? null) === ($i1['h'] ?? null)) {
                $this->notApplied($a, $rel, $E0, $E1, $i1);
                continue;
            }
            if ($a->isExcluded($rel)) {
                $this->excluded++;
                continue;
            }
            $key = "{$a->id}:$rel";
            $target = $a->target($rel);
            if ($i0 !== null && isset($bk[$rel]) && !$this->noBase) {
                $bh = Util::gitHashFile($bk[$rel][0]['abs']);
                if ($bh !== $i0['h']) {
                    $this->warnings[] = "{$a->installedPath($rel)}: бэкап обновлятора не совпадает со снимком — установленную папку правили после снимка? База взята из снимка.";
                }
            }
            $lh = $L1->hash($rel);
            $ours = $s->ours($key) ?? $s->setOurs($key, $L1->content($rel), 'копия на начало сеанса', $lh['h'] ?? null);
            $curH = $lh['h'] ?? null;
            $h = ['base' => $i0['h'] ?? null, 'ours' => $ours['h'], 'theirs' => $i1['h'] ?? null, 'current' => $curH];
            if ($curH !== $ours['h'] && !in_array($curH ?? '-', $s->writtenStates($target), true)) {
                $this->add($a, $rel, 'changed-outside', 'keep', $h, ['needs' => 'review',
                    'note' => 'копию правили после начала сеанса — инструмент её не перезапишет; решите вручную (resolve)']);
                continue;
            }
            $oursC = $s->blob($ours['h']);
            $theirsC = $i1 !== null ? $I1->content($rel) : null;
            $big = ($i1['big'] ?? 0) || ($lh['big'] ?? 0);
            if ($ours['h'] === null) {
                if ($i0 === null && $i1 !== null) {
                    if ($theirsC === null) {
                        $this->add($a, $rel, 'binary', 'keep', $h, ['needs' => 'review', 'note' => 'новый файл вендора больше 4 МБ — скопируйте его в копию вручную']);
                    } else {
                        $this->add($a, $rel, 'new-file', 'copy', $h, ['auto' => $s->putBlob($theirsC), 'perms' => $i1['p'] ?? null]);
                    }
                } elseif ($i1 !== null) {
                    if ($this->copyFallback($a, $rel)) {
                        $this->add($a, $rel, 'absent-in-copy', 'none', $h);
                    } elseif ($theirsC === null) {
                        $this->add($a, $rel, 'binary', 'keep', $h, ['needs' => 'review',
                            'note' => 'в копии файла нет, а ядро возьмёт его только из копии; файл вендора больше 4 МБ — скопируйте его в копию вручную']);
                    } else {
                        // файл шаблона сайта вне components/ (js/, css/, lang/…) ядро ищет только по SITE_TEMPLATE_PATH, файл шаблона
                        // компонента — только в выбранном каталоге шаблона: без новой версии в копии её не увидит никто (1.7.21: js/app.js)
                        $this->add($a, $rel, 'absent-no-fallback', 'copy', $h, ['auto' => $s->putBlob($theirsC), 'perms' => $i1['p'] ?? null]);
                    }
                }
                continue;
            }
            $e0 = $E0[$rel] ?? null;
            if (isset($this->modeChanged[$a->id])) {
                $baseE = $e0 !== null ? $this->base->etalonContent($a, $rel) : null;
                $this->add($a, $rel, 'mode-changed', 'keep', $h, ['needs' => 'review',
                    'note' => 'в снимке область была «на месте» (доработки — в установленной папке), сейчас — «копия»: база — эталон до обновления; '
                        . 'на месте копия как есть; см. merged (слияние с базой «эталон»)']
                    + $this->triple($a, $rel, ['base' => $e0['h'] ?? null] + $h, $baseE, $oursC, $theirsC, $this->suggest($baseE, $oursC, $theirsC)));
                continue;
            }
            $oH = $oursC !== null ? $this->h($oursC) : null;
            $baseC = $i0 !== null ? $this->oldContent($a, $rel) : null;
            if ($i0 !== null && $e0 !== null && $i0['n'] !== $e0['n'] && !$this->noBase) {
                $e0C = $this->base->etalonContent($a, $rel);
                if (!Util::wsSame($baseC, $e0C)) {
                    // установленную папку правили напрямую (или обновлятор не переносил в неё изменения): что из её
                    // отличий от эталона — наше, а что — отставание от вендора, по файлам не понять
                    $this->add($a, $rel, 'base-ambiguous', 'keep', $h, ['needs' => 'review',
                        'note' => 'в снимке ' . $a->installedPath($rel) . ' отличался от эталона (правили напрямую?) — изменение вендора не применено; '
                            . 'base — эталон до обновления, installed-old — установленный файл до обновления, merged — слияние с базой «эталон»']
                        + $this->triple($a, $rel, ['base' => $e0['h']] + $h, $e0C, $oursC, $theirsC,
                            ['installed-old' => $baseC] + $this->suggest($e0C, $oursC, $theirsC)));
                    continue;
                }
            }
            if ($i0 === null) {
                if ($oH && $i1 && $oH['n'] === $i1['n']) {
                    $this->add($a, $rel, 'same', 'none', $h);
                } else {
                    $this->add($a, $rel, 'added-both', 'keep', $h, ['needs' => 'review'] + $this->triple($a, $rel, $h, null, $oursC, $theirsC));
                }
                continue;
            }
            if ($i1 === null) {
                if ($oH && $oH['n'] === $i0['n']) {
                    $this->add($a, $rel, 'deleted-clean', 'delete', $h, ['auto' => '-']);
                } else {
                    $this->add($a, $rel, 'deleted-modified', 'keep', $h, ['needs' => 'review', 'note' => 'файл в копии оставлен'] + $this->triple($a, $rel, $h, $baseC, $oursC, null));
                }
                continue;
            }
            if ($oH === null || !$oH['t'] || !$i1['t'] || !$i0['t'] || $big) {
                if ($ours['h'] === $i0['h'] && $theirsC !== null) {
                    $this->add($a, $rel, 'vendor-only', 'take', $h, ['auto' => $s->putBlob($theirsC)]);
                } elseif ($ours['h'] === $i0['h']) {
                    $this->add($a, $rel, 'binary', 'keep', $h, ['needs' => 'review', 'note' => 'файл больше 4 МБ: новую версию вендора перенесите в копию вручную']);
                } else {
                    $this->add($a, $rel, 'binary', 'keep', $h, ['needs' => 'review', 'note' => 'двоичный или большой файл: выберите нашу (ours) или вендорскую (theirs) версию']);
                }
                continue;
            }
            if ($oH['n'] === $i1['n']) {
                $this->add($a, $rel, 'same', 'none', $h);
                continue;
            }
            if ($baseC === null) {
                $this->add($a, $rel, 'no-base', 'keep', $h, ['needs' => 'review'] + $this->triple($a, $rel, $h, null, $oursC, $theirsC));
                continue;
            }
            if ($oH['n'] === $i0['n']) {
                $this->add($a, $rel, 'vendor-only', 'take', $h, ['auto' => $s->putBlob((string)$theirsC)]);
                continue;
            }
            if (Util::wsSame($oursC, $baseC)) {
                $this->add($a, $rel, 'ours-ws', 'take', $h, ['auto' => $s->putBlob((string)$theirsC)]);
                continue;
            }
            if ($i0['n'] === $i1['n']) {
                $this->add($a, $rel, 'theirs-eol', 'none', $h);
                continue;
            }
            // копия старше базы: её «доработкой» стал бы откат исправлений вендора между старой версией и базой
            $old = $this->closestOldVendor($a, $rel, $oursC, $baseC);
            if ($old !== null && $old['same']) {
                $this->add($a, $rel, 'stale-copy', 'take', $h, ['auto' => $s->putBlob((string)$theirsC),
                    'note' => "наша версия — старый код вендора ({$old['label']}), а не доработка: в копию кладётся новая версия вендора"]);
                continue;
            }
            if (Util::isMin($rel)) {
                $this->add($a, $rel, 'min', 'keep', $h, ['needs' => 'review', 'auto' => $ours['h'], 'note' => $this->minNote($rel)]
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC));
                continue;
            }
            if ($old !== null) {
                $this->note[$key] = "база слияния — {$old['label']}: копия ближе к ней, чем к версии до обновления (копия отстала), — "
                    . 'исправления вендора между ними тоже перенесены; base в тройке — эта версия';
                $this->mergeEntry($a, $rel, ['base' => Util::gitHash($old['content'])] + $h, $old['content'], $oursC, (string)$theirsC, $ours['h']);
                continue;
            }
            $this->mergeEntry($a, $rel, $h, $baseC, $oursC, (string)$theirsC, $ours['h']);
        }
    }

    /**
     * Режим «копия»: старая версия вендора, от которой копия файла на самом деле произошла, — если копия к ней ближе,
     * чем к версии до обновления. Кандидаты: бэкапы обновлятора рядом с файлом (_<файл>.back<версия> в установленной
     * папке и в копии) и эталоны прежних снимков. ['label', 'content', 'same' — копия с ней совпадает без учёта пробелов]
     * или null (копия ближе к версии до обновления — обычное слияние).
     */
    private function closestOldVendor(Area $a, string $rel, string $oursC, string $baseC): ?array
    {
        $cands = Updater::oldVersions($this->c, $a, $rel);
        foreach ($this->oldSnapshots() as $ver => $snap) {
            $c = $snap->etalonContent($a, $rel);
            if ($c !== null) {
                $cands["эталон снимка $ver"] ??= $c;
            }
        }
        $best = null;
        $baseD = self::distance($baseC, $oursC);
        foreach ($cands as $label => $c) {
            if (Util::wsSame($c, $baseC)) {
                continue; // та же версия, что база
            }
            if (Util::wsSame($c, $oursC)) {
                return ['label' => $label, 'content' => $c, 'same' => true];
            }
            $d = self::distance($c, $oursC);
            if ($d < $baseD && ($best === null || $d < $best['d'])) {
                $best = ['label' => $label, 'content' => $c, 'same' => false, 'd' => $d];
            }
        }
        // заметно ближе, а не на пару строк: иначе обычное слияние от базы надёжнее
        return $best !== null && $best['d'] * 2 <= $baseD ? $best : null;
    }

    /** Снимки прежних версий, кроме базы сеанса (для поиска старых версий вендора) */
    private function oldSnapshots(): array
    {
        if ($this->oldSnaps === null) {
            $this->oldSnaps = [];
            $baseVer = $this->base?->version;
            foreach (Snapshot::versions($this->c) as $v) {
                if ($v !== $baseVer && version_compare($v, $this->vNow, '<') && ($snap = Snapshot::load($this->c, $v))) {
                    $this->oldSnaps[$v] = $snap;
                }
            }
        }
        return $this->oldSnaps;
    }

    /** Число различающихся строк (без учёта переводов строк, BOM и пробелов) */
    private static function distance(string $x, string $y): int
    {
        $n = static fn(string $c) => implode("\n", array_map(static fn($l) => preg_replace('/\s+/', ' ', trim($l)),
            explode("\n", Util::stripBom(am_to_lf($c))))) . "\n";
        $d = 0;
        foreach (am_xdiff(am_split($n($x)), am_split($n($y))) as [, , $c1, $c2]) {
            $d += $c1 + $c2;
        }
        return $d;
    }

    /**
     * Режим «копия»: возьмёт ли ядро файл, которого нет в копии, из установленной папки. Шаблон компонента ядро ищет по
     * папкам по очереди (local/templates/<шаблон>/components/…, затем bitrix/templates/<шаблон>/components/…) и берёт
     * первый найденный каталог шаблона целиком; остальные файлы шаблона сайта (js/, css/, lang/, header.php) подключаются
     * по SITE_TEMPLATE_PATH — только из копии. Поэтому подмена есть, лишь когда в копии нет каталога шаблона компонента,
     * к которому относится файл (для вложенных шаблонов комплексного компонента — самого глубокого из них).
     */
    private function copyFallback(Area $a, string $rel): bool
    {
        if ($a->kind !== 'tpl' || !str_starts_with($rel, 'components/')) {
            return false;
        }
        $seg = explode('/', $rel);
        $dir = null;
        // группы <пространство>/<компонент>/<шаблон>, за которыми есть ещё хотя бы имя файла; вложенная группа — только
        // если такой компонент есть на сайте (иначе это просто подпапка шаблона: lang/ru, page_blocks…)
        for ($i = 1; $i + 3 < count($seg); $i += 3) {
            if ($i > 1 && !is_dir($this->c->abs("bitrix/components/{$seg[$i]}/{$seg[$i + 1]}"))
                && !is_dir($this->c->abs("local/components/{$seg[$i]}/{$seg[$i + 1]}"))) {
                break;
            }
            $dir = implode('/', array_slice($seg, 0, $i + 3));
        }
        return $dir !== null && !is_dir($this->c->abs($a->copy . '/' . $dir));
    }

    /** Подсказка для разбора: результат слияния с маркерами (если все три версии — текст) */
    private function suggest(?string $base, ?string $ours, ?string $theirs): array
    {
        if ($base === null || $ours === null || $theirs === null || !Util::isText($base) || !Util::isText($ours) || !Util::isText($theirs)) {
            return [];
        }
        return ['merged' => self::merge3($base, $ours, $theirs)['lf']];
    }

    // --- режим «на месте» ---

    private function inplaceArea(Area $a, array $E0, FileSet $E1, array $I0, FileSet $I1, array $bk): void
    {
        $s = $this->s;
        $preRels = [];
        $prefix = $a->id . ':';
        foreach (array_keys($s->d['pre'] ?? []) as $k) {
            if (str_starts_with($k, $prefix)) {
                $preRels[] = substr($k, strlen($prefix));
            }
        }
        $paths = array_unique(array_merge(array_keys($I0), $I1->rels(), array_keys($E0), $E1->rels(), array_keys($bk), $preRels));
        sort($paths, SORT_STRING);
        foreach ($paths as $rel) {
            $this->tick();
            $i0 = $I0[$rel] ?? null;
            $i1 = $I1->hash($rel);
            $target = $a->target($rel);
            $key = "{$a->id}:$rel";
            $writes = $s->writesFor($target);
            $last = $writes ? end($writes) : null;
            $cands = $bk[$rel] ?? [];
            $pre = $s->d['pre'][$key] ?? [];
            $changed = ($i0['h'] ?? null) !== ($i1['h'] ?? null) || $cands || $last || $s->ours($key) || $pre;
            if (!$changed) {
                $this->notApplied($a, $rel, $E0, $E1, $i1);
                continue;
            }
            if ($a->isExcluded($rel)) {
                $this->excluded++;
                continue;
            }
            $curH = $i1['h'] ?? null;
            [$ours, $th] = $this->inplaceVersions($a, $rel, $key, $i0, $i1, $I1, $cands, $pre, $last);
            $oursC = $s->blob($ours['h']);
            $theirsC = $s->blob($th['h']);
            $e0 = $E0[$rel] ?? null;
            $e1 = $E1->hash($rel);
            $baseC = $e0 !== null ? $this->base?->etalonContent($a, $rel) : null;
            $h = ['base' => $e0['h'] ?? null, 'ours' => $ours['h'], 'theirs' => $th['h'], 'current' => $curH];
            if (!empty($ours['outside']) && ($ours['accepted'] ?? null) !== $ours['h']) {
                $this->flag[$key] = 'файл правили на сайте во время сеанса (версия ' . $ours['outside'] . '): эта правка — теперь «наша» версия; проверьте результат и примите (resolve <файл> keep)';
            }
            if (isset($this->modeChanged[$a->id])) {
                $oursL = $this->base->stateContent($a, 'L', $rel) ?? $oursC;
                $this->add($a, $rel, 'mode-changed', 'keep', $h, ['needs' => 'review',
                    'note' => 'в снимке область была «копией», сейчас — «на месте»: ours — копия на момент снимка; на месте файл как оставил обновлятор']
                    + $this->triple($a, $rel, $h, $baseC, $oursL, $theirsC, $this->suggest($baseC, $oursL, $theirsC)));
                continue;
            }
            if (($ours['outside'] ?? null) === $this->vNow && $ours['h'] !== $th['h']) {
                // правка на сайте на этой же версии: шага обновления с тех пор не было — инструмент файл не трогает
                unset($this->flag[$key]);
                $this->add($a, $rel, 'changed-outside', 'keep', $h, ['needs' => 'review',
                    'note' => 'файл правили на сайте во время открытого сеанса (обновлятор после этого его не менял) — инструмент его не перезапишет; '
                        . 'ours — как сейчас на сайте, theirs — как было до правки; если так и задумано — resolve <файл> keep']
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $this->suggest($baseC, $oursC, $theirsC)));
                continue;
            }
            if ($ours['h'] === null) {
                if ($th['h'] !== null) {
                    if (!$this->noBase && $e0 !== null && $i0 === null) {
                        // у вендора файл был, а на сайте при снимке — нет: удалили как доработку (или не устанавливали)
                        $pub = $a->kind === 'pub';
                        $this->add($a, $rel, 'deleted-ours', $pub ? 'keep' : 'delete', $h, ['needs' => 'review', 'auto' => $pub ? null : '-',
                            'note' => $pub ? 'файл оставлен; если удаление было доработкой — resolve <файл> delete'
                                : 'файл снова удалён (как было на сайте до обновления); если он нужен — resolve <файл> theirs']
                            + $this->triple($a, $rel, $h, $baseC, null, $theirsC));
                    } else {
                        $this->add($a, $rel, 'new-file', 'none', $h);
                    }
                }
                continue;
            }
            $oH = $oursC !== null ? $this->h($oursC) : ($i0 ?? null);
            if ($th['h'] === null) {
                if ($e0 !== null && $oH && $oH['n'] === $e0['n']) {
                    $this->add($a, $rel, 'deleted-clean', 'none', $h);
                } else {
                    $this->add($a, $rel, 'deleted-modified', $oursC !== null ? 'restore' : 'keep', $h, ['needs' => 'review',
                        'auto' => $oursC !== null ? $ours['h'] : null, 'note' => $oursC !== null ? 'наша версия возвращена на место до решения' : 'нашей версии нет в сеансе (большой файл?)']
                        + $this->triple($a, $rel, $h, $baseC, $oursC, null));
                }
                continue;
            }
            $tH = $theirsC !== null ? $this->h($theirsC) : $i1;
            if ($this->noBase) {
                if ($oH && $tH && $oH['n'] === $tH['n']) {
                    $this->add($a, $rel, 'same', 'none', $h);
                } else {
                    $this->add($a, $rel, 'no-base', 'keep', $h, ['needs' => 'review', 'note' => 'нет снимка версии до обновления: на сайте версия вендора, наша — в бэкапе']
                        + $this->triple($a, $rel, $h, null, $oursC, $theirsC));
                }
                continue;
            }
            if ($e0 === null) {
                if ($oH && $tH && $oH['n'] === $tH['n']) {
                    $this->add($a, $rel, 'same', 'none', $h);
                } else {
                    $this->add($a, $rel, 'added-both', $oursC !== null ? 'restore' : 'keep', $h, ['needs' => 'review',
                        'auto' => $oursC !== null ? $ours['h'] : null, 'note' => 'вендор положил файл с тем же именем, что наш; наш возвращён на место до решения']
                        + $this->triple($a, $rel, $h, null, $oursC, $theirsC));
                }
                continue;
            }
            if ($oH['n'] === $e0['n']) {
                $this->add($a, $rel, 'vendor-only', 'none', $h);
                continue;
            }
            if ($tH && $oH['n'] === $tH['n']) {
                $this->add($a, $rel, 'same', 'none', $h);
                continue;
            }
            if (!$oH['t'] || !($tH['t'] ?? 0) || !$e0['t'] || ($i1['big'] ?? 0)) {
                if ($oursC === null) {
                    $this->add($a, $rel, 'binary', 'keep', $h, ['needs' => 'review',
                        'note' => 'двоичный или большой файл: на сайте версия вендора, нашей версии в сеансе нет (только хеш в снимке) — сравните с бэкапом обновлятора']);
                    continue;
                }
                [$act, $auto, $hold] = $this->hold($a, $ours['h'], $th['h']);
                $this->add($a, $rel, 'binary', $act, $h, ['needs' => 'review', 'auto' => $auto,
                    'note' => "двоичный файл: $hold; выберите ours или theirs (resolve)"]);
                continue;
            }
            if (Util::wsSame($oursC, $baseC)) {
                $this->add($a, $rel, 'ours-ws', 'none', $h);
                continue;
            }
            if ($e1 === null || $tH['n'] !== $e1['n']) {
                $extra = $e1 !== null ? ['vendor-new' => (string)$E1->content($rel)] : [];
                $this->add($a, $rel, 'point-edit', 'keep', $h, ['needs' => 'review',
                    'note' => 'файл на сайте не равен новому эталону: его поправил сам обновлятор; см. vendor-new и updater.diff']
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $extra));
                continue;
            }
            if ($e0['n'] === $tH['n']) {
                $this->add($a, $rel, 'theirs-eol', 'restore', $h, ['auto' => $ours['h']]);
                continue;
            }
            if ($oursC === null || $baseC === null) {
                $this->add($a, $rel, 'no-base', 'keep', $h, ['needs' => 'review', 'note' => 'нет содержимого базы или нашей версии в снимке']
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC));
                continue;
            }
            if (Util::isMin($rel)) {
                [$act, $auto, $hold] = $this->hold($a, $ours['h'], $th['h']);
                $this->add($a, $rel, 'min', $act, $h, ['needs' => 'review', 'auto' => $auto, 'note' => $this->minNote($rel) . "; $hold"]
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC));
                continue;
            }
            // правку на сайте во время сеанса делали поверх файла, каким он был тогда (а не поверх эталона до обновления)
            $ontoC = !empty($ours['outside']) && !empty($ours['onto']) && $ours['onto'] !== ($e0['h'] ?? null) ? $s->blob($ours['onto']) : null;
            $this->mergeEntry($a, $rel, $h, $baseC, $oursC, (string)$theirsC, $ours['h'], $ontoC);
        }
    }

    /**
     * «Наша» и «их» версии файла в режиме «на месте» — с учётом того, кто изменил файл на сайте:
     *  - текущее содержимое уже известно (его записал инструмент, оставил обновлятор или это принятая правка) — ничего;
     *  - с прошлого раза был шаг обновления (версия модуля сменилась) — изменение обновлятора: «их» = как сейчас;
     *    до этого проверяется, не правили ли файл на сайте перед шагом (бэкап шага или снимок предохранителя
     *    отличается от всего известного) — тогда эта правка становится «нашей» версией;
     *  - шага не было — правка на сайте во время сеанса: она становится «нашей» версией (outside), «их» не меняется.
     * Возвращает [ours, theirs] (записи сеанса).
     */
    private function inplaceVersions(Area $a, string $rel, string $key, ?array $i0, ?array $i1, FileSet $I1, array $cands, array $pre, ?array $last): array
    {
        $s = $this->s;
        $target = $a->target($rel);
        $curH = $i1['h'] ?? null;
        $curC = $i1 !== null ? $I1->content($rel) : null;
        $th = $s->theirs($key);
        $ours = $s->ours($key);
        $written = $s->writtenHashes($target);
        $vNow = $this->vNow;
        $known = ($last !== null && $curH === $last['after']) || ($th !== null && $curH === $th['h'])
            || ($ours !== null && !empty($ours['outside']) && $curH === $ours['h']);
        $cs = $this->candidates($cands, $pre);
        if ($ours === null) {
            if ($th === null && $last === null && !$this->noBase && $this->planVersion === $vNow) {
                // файла не было в плане этой версии, а теперь он изменён — после расчёта плана: правка на сайте
                $prevC = $i0 !== null ? $this->oldContent($a, $rel) : null;
                $th = $s->setTheirs($key, $prevC, $i0['h'] ?? null, $vNow);
                $ours = $s->setOurs($key, $curC, 'правка на сайте во время сеанса', $curH,
                    ['outside' => $vNow, 'prev' => $i0 ? [$i0['h']] : [], 'onto' => $i0['h'] ?? null]);
                $this->warnings[] = "$target: файл правили на сайте во время открытого сеанса — инструмент его не перезаписывает, он идёт на разбор.";
                $s->seenTheirs($key, $vNow);
                return [$ours, $th];
            }
            if (!($last !== null && $curH === $last['after'] && $th !== null) && ($th === null || $th['h'] !== $curH)) {
                $th = $s->setTheirs($key, $curC, $curH, $vNow);
            }
            $ours = $this->firstOurs($a, $rel, $key, $i0, $I1, $cs, $written);
        } elseif (!$known) {
            $seenV = $th['seen'] ?? null;
            $onto = $this->prevKnown($th, $last);
            if ($th !== null && $seenV === $vNow) {
                $ours = $s->setOurs($key, $curC, 'правка на сайте во время сеанса', $curH, ['outside' => $vNow, 'onto' => $onto]);
                $this->warnings[] = "$target: файл правили на сайте во время открытого сеанса — инструмент его не перезаписывает, он идёт на разбор.";
            } else {
                if ($th !== null && $seenV !== null) {
                    $ev = $this->outsideEvidence($th, $ours, $written, $cs, $seenV);
                    if ($ev !== null) {
                        $ours = $s->setOurs($key, $ev['c'], 'правка на сайте во время сеанса (' . $ev['src'] . ')', $ev['h'], ['outside' => $ev['ver'], 'onto' => $onto]);
                        $this->warnings[] = "$target: файл правили на сайте между шагами обновления (" . $ev['src'] . ') — правка сохранена как «наша» версия, файл идёт на разбор.';
                    }
                }
                $th = $s->setTheirs($key, $curC, $curH, $vNow);
            }
        }
        if ($th === null) {
            $th = $s->setTheirs($key, $curC, $curH, $vNow);
        }
        // «наша» зафиксирована только хешем (большой или двоичный файл не попал в снимок) — содержимое из бэкапа
        if ($ours['h'] !== null && empty($ours['content'])) {
            foreach ($cs as $cnd) {
                if ($cnd['h'] === $ours['h'] && ($c = $cnd['c']()) !== null) {
                    $s->fillOurs($key, $c, $cnd['src']);
                    $ours = $s->ours($key);
                    break;
                }
            }
        }
        $s->seenTheirs($key, $vNow);
        return [$ours, $th];
    }

    /** Каким файл был на сайте до правки: последняя запись инструмента, если она новее «их» версии, иначе «их» версия */
    private function prevKnown(?array $th, ?array $last): ?string
    {
        if ($last !== null) {
            $bt = (int)($this->s->d['batches'][(int)$last['batch'] - 1]['time'] ?? 0);
            if ($th === null || $bt >= (int)($th['time'] ?? 0)) {
                return $last['after'];
            }
        }
        return $th['h'] ?? null;
    }

    /** Бэкапы обновлятора и снимки предохранителя по возрастанию версии: хеш сразу, содержимое — лениво ('c') */
    private function candidates(array $cands, array $pre): array
    {
        $out = [];
        foreach ($cands as $c) {
            $abs = $c['abs'];
            $out[] = ['ver' => (string)$c['ver'], 'mtime' => (int)$c['mtime'], 'src' => 'бэкап ' . basename($abs), 'o' => 0,
                'h' => Util::gitHashFile($abs), 'c' => static fn() => Util::readSmall($abs)];
        }
        foreach ($pre as $ver => $p) {
            $ph = $p['h'];
            $out[] = ['ver' => (string)$ver, 'mtime' => (int)$p['time'], 'src' => 'снято предохранителем перед шагом с ' . $ver, 'o' => 1,
                'h' => $ph, 'c' => fn() => $this->s->blob($ph)];
        }
        usort($out, static fn($x, $y) => version_compare($x['ver'], $y['ver']) ?: $x['o'] <=> $y['o']);
        return $out;
    }

    /** «Наша» версия при первом появлении файла в сеансе */
    private function firstOurs(Area $a, string $rel, string $key, ?array $i0, FileSet $I1, array $cs, array $written): array
    {
        $s = $this->s;
        $target = $a->target($rel);
        $pick = null;
        foreach ($cs as $cnd) {
            if ($cnd['h'] !== null && !in_array($cnd['h'], $written, true)) {
                $pick = $cnd;
                break;
            }
        }
        if ($this->noBase) {
            if ($pick) {
                return $s->setOurs($key, $pick['c'](), $pick['src'], $pick['h']);
            }
            return $i0 ? $s->setOurs($key, $this->oldContent($a, $rel) ?? $I1->content($rel), 'файл до обновления', $i0['h']) : $s->setOurs($key, null, 'файла не было');
        }
        if ($pick && ($i0 === null || $pick['h'] !== $i0['h'])) {
            // во время сеанса (снято перед вторым и следующими шагами) — правка на сайте, на разбор; сделана она
            // поверх файла как в снимке (до этого шага файл в плане не был — значит, не менялся)
            $during = version_compare($pick['ver'], (string)$s->d['from'], '>');
            if ($during && $i0 !== null && ($snap = $this->oldContent($a, $rel)) !== null) {
                $s->putBlob($snap);
            }
            $ours = $s->setOurs($key, $pick['c'](), $pick['src'], $pick['h'], $during ? ['outside' => $pick['ver'], 'onto' => $i0['h'] ?? null] : []);
            $this->warnings[] = "$target: " . ($pick['o'] ? 'снимок предохранителя' : 'бэкап обновлятора') . ' отличается от снимка — файл ' . ($i0 === null ? 'появился' : 'правили')
                . ' после снимка, «наша» версия взята из ' . $pick['src'];
            return $ours;
        }
        if ($i0 !== null) {
            $snapC = $this->base->stateContent($a, 'I', $rel);
            if ($snapC !== null) {
                return $s->setOurs($key, $snapC, 'снимок ' . $this->base->version);
            }
            $pc = $pick && $pick['h'] === $i0['h'] ? $pick['c']() : null;
            return $pc !== null ? $s->setOurs($key, $pc, 'снимок ' . $this->base->version . ' (содержимое — ' . $pick['src'] . ')')
                : $s->setOurs($key, null, 'снимок (без содержимого)', $i0['h']);
        }
        return $s->setOurs($key, null, 'файла не было');
    }

    /**
     * Правка на сайте перед шагом обновления: бэкап этого шага (суффикс — версия, на которой файл видели в последний
     * раз, или новее) или снимок предохранителя, который не совпадает ни с чем известным: «их» версией, «нашей» (и
     * прежними «нашими»), записями инструмента. Возвращает самую позднюю такую правку или null.
     */
    private function outsideEvidence(array $th, array $ours, array $written, array $cs, string $seenV): ?array
    {
        $legit = array_values(array_filter(array_merge([$th['h'], $ours['h']], $ours['prev'] ?? [], $written), static fn($x) => $x !== null));
        $seenT = (int)($th['seen_t'] ?? $th['time'] ?? 0);
        $found = null;
        foreach ($cs as $cnd) {
            if (version_compare($cnd['ver'], $seenV, '<') || version_compare($cnd['ver'], $this->vNow, '>=')
                || ($cnd['o'] === 0 && $cnd['mtime'] < $seenT - 1)) {
                continue;
            }
            $hh = $cnd['h'];
            if ($hh === null || in_array($hh, $legit, true)) {
                continue;
            }
            $found = ['h' => $hh, 'c' => $cnd['c'](), 'ver' => $cnd['ver'], 'src' => $cnd['src']];
            $legit[] = $hh;
        }
        return $found;
    }

    // --- общее ---

    private function notApplied(Area $a, string $rel, array $E0, FileSet $E1, ?array $i1): void
    {
        if ($this->noBase || $i1 === null || $a->isExcluded($rel)) {
            return;
        }
        $e0 = $E0[$rel] ?? null;
        $e1 = $E1->hash($rel);
        if ($e0 !== null && $e1 !== null && $e0['h'] !== $e1['h'] && $i1['n'] !== $e1['n'] && $e0['n'] !== $e1['n']) {
            $this->add($a, $rel, 'not-applied', 'none', ['base' => $e0['h'], 'ours' => null, 'theirs' => $e1['h'], 'current' => $i1['h']],
                ['note' => 'для справки: изменение вендора в эталоне до сайта не дошло']);
        }
    }

    private function minNote(string $rel): string
    {
        $src = preg_replace('/\.min\.(js|css)$/', '.$1', $rel);
        return "минифицированный файл (одна строка — построчное слияние бессмысленно): слейте исходник $src, затем min пересоберите из него или возьмите min вендора (при use_minified_assets=Y Битрикс отдаёт из пары более свежий файл)";
    }

    /**
     * Трёхстороннее слияние записи. $ontoC — запасная база для правки на сайте во время сеанса (каким файл был на сайте
     * до правки): если от эталона до обновления слияние конфликтует, а от этой базы — нет, берётся оно.
     */
    private function mergeEntry(Area $a, string $rel, array $h, string $baseC, string $oursC, string $theirsC, string $oursH, ?string $ontoC = null): void
    {
        $r = self::merge3($baseC, $oursC, $theirsC);
        $key = "{$a->id}:$rel";
        $alt = false;
        if ($r['conflicts'] > 0 && $ontoC !== null && Util::isText($ontoC)) {
            $r2 = self::merge3($ontoC, $oursC, $theirsC);
            if ($r2['conflicts'] === 0) {
                $r = $r2;
                $alt = true;
                $this->flag[$key] = trim(($this->flag[$key] ?? '') . '; слито с базой «как было на сайте до правки» (от эталона до обновления — конфликт)', '; ');
            }
        }
        $share = Util::changedShare(Util::stripBom(am_to_lf($baseC)), Util::stripBom(am_to_lf($theirsC)));
        $extra = ['merged' => $r['lf']];
        [$act, $auto, $hold] = $this->hold($a, $oursH, $h['theirs']);
        if ($r['conflicts'] === 0) {
            $mh = $this->s->putBlob($r['text']);
            // чистое слияние, которое сохраняет старый код отставшей копии (с 1.2.1): видно уже в status и уведомлении
            $rb = Verifier::rollbackNotes($a->target($rel), $baseC, $oursC, $theirsC, $r['text'], 'merge.php')[0] ?? null;
            if (($this->s->d['lint'][$key]['h'] ?? null) === $mh) {
                $this->add($a, $rel, 'lint', $act, $h, ['needs' => 'review', 'auto' => $auto, 'rollback' => $rb,
                    'note' => 'слилось без конфликтов, но php -l: ' . $this->s->d['lint'][$key]['error'] . "; $hold"]
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $extra));
                return;
            }
            if (($this->s->d['lint_defer'][$key] ?? null) === $mh) {
                $this->add($a, $rel, 'lint', $act, $h, ['needs' => 'review', 'auto' => $auto, 'rollback' => $rb,
                    'note' => 'слилось без конфликтов, но проверить php -l в веб-запросе было нечем (нет PHP CLI): разбор token_get_all не ловит ошибки '
                        . "компиляции — результат не записан; $hold; выполните в консоли merge.php apply (там php -l есть)"]
                    + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $extra));
                return;
            }
            // fallback — что положить на место, если результат слияния не пройдёт php -l при записи (как у конфликта)
            $this->add($a, $rel, 'merge', 'merge', $h, ['auto' => $mh, 'conflicts' => 0, 'share' => $share, 'fallback' => $auto, 'rollback' => $rb]
                + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $extra));
            return;
        }
        $lines = implode(', ', array_map(static fn($hk) => "{$hk['line']}–{$hk['end']}", $r['hunks']));
        $note = "конфликтных участков: {$r['conflicts']} (строки merged: $lines)";
        if ($share >= 60) {
            $note .= "; вендор переписал $share% файла — проще взять theirs и заново внести доработку по ours.diff";
        }
        $this->add($a, $rel, 'merge', $act, $h, ['needs' => 'conflict', 'auto' => $auto, 'conflicts' => $r['conflicts'],
            'hunks' => $r['hunks'], 'share' => $share, 'note' => "$note; $hold"]
            + $this->triple($a, $rel, $h, $baseC, $oursC, $theirsC, $extra));
    }

    /**
     * Что лежит на месте до решения у файла, который и мы доработали, и вендор изменил (конфликт, двоичный,
     * минифицированный, слияние не прошло php -l): [действие, хеш для записи, пояснение]. Режим «на месте» —
     * по настройке conflict_keep: 'ours' — наша прежняя версия (доработка действует, изменения вендора в файле — нет),
     * 'theirs' — версия вендора, как её оставил обновлятор (исправления вендора действуют, доработки в файле нет).
     * Режим «копия» — всегда прежний файл копии: копия перекрывает установленную папку, обновлятор её не трогает.
     */
    private function hold(Area $a, ?string $oursH, ?string $theirsH): array
    {
        if ($a->mode === Area::INPLACE && $this->c->conflictKeep === 'theirs' && $theirsH !== null) {
            return ['take', $theirsH, 'до решения на месте версия вендора (conflict_keep = theirs): изменения вендора действуют, нашей доработки в файле нет'];
        }
        if ($a->mode === Area::INPLACE) {
            return ['restore', $oursH, 'до решения на месте наша прежняя версия: изменения вендора в файле (в том числе исправления безопасности) не действуют'];
        }
        return ['restore', $oursH, 'до решения в копии прежняя версия (так устроен режим «копия»): изменения вендора в файле не действуют'];
    }

    /**
     * Трёхстороннее слияние с нормализацией: CRLF→LF и без BOM у всех трёх, стиль diff3 (в конфликте видна база);
     * результат для записи — в стиле файла вендора (переводы строк и BOM как у theirs).
     */
    public static function merge3(string $base, string $ours, string $theirs, array $labels = ['ours', 'base', 'theirs']): array
    {
        $n = static fn(string $x) => Util::stripBom(am_to_lf($x));
        $r = am_merge($n($ours), $n($base), $n($theirs), AM_STYLE_DIFF3, $labels);
        return ['lf' => $r['text'], 'text' => Util::styleLike($r['text'], $theirs), 'conflicts' => $r['conflicts'], 'hunks' => $r['hunks']];
    }

    private function h(string $content): array
    {
        $k = Util::gitHash($content);
        return $this->hashCache[$k] ??= Util::hashes($content);
    }

    private function add(Area $a, string $rel, string $cat, string $action, array $h, array $more = []): void
    {
        $key = "{$a->id}:$rel";
        $needs = $more['needs'] ?? null;
        $note = $more['note'] ?? null;
        if (isset($this->note[$key])) {
            $note = trim(($note ?? '') . '; ' . $this->note[$key], '; ');
        }
        if (isset($this->flag[$key]) && $cat !== 'not-applied') {
            $needs ??= 'review';
            $note = trim(($note ?? '') . '; ' . $this->flag[$key], '; ');
        }
        $this->entries[$key] = [
            'key' => $key, 'area' => $a->id, 'kind' => $a->kind, 'mode' => $a->mode, 'rel' => $rel, 'target' => $a->target($rel),
            'cat' => $cat, 'about' => self::CAT[$cat], 'action' => $action, 'auto' => $more['auto'] ?? null,
            'perms' => $more['perms'] ?? null, 'needs' => $needs, 'h' => $h,
            'conflicts' => $more['conflicts'] ?? null, 'hunks' => $more['hunks'] ?? null, 'share' => $more['share'] ?? null,
            'note' => $note, 'files' => $more['files'] ?? null, 'fallback' => $more['fallback'] ?? null, 'rollback' => $more['rollback'] ?? null,
            'status' => null,
        ];
    }

    /**
     * Папка тройки для разбора: base, ours, theirs (как есть), merged (LF, маркеры diff3), ours.diff (что мы доработали),
     * theirs.diff (что поменял вендор), info.json. Если тройка изменилась (новый шаг обновления), прежний resolved
     * переименовывается в resolved.stale-<время>: решение относилось к другим версиям.
     */
    private function triple(Area $a, string $rel, array $h, ?string $base, ?string $ours, ?string $theirs, array $extra = []): array
    {
        // содержимое всех трёх версий — в сеанс: по нему решения приводятся к стилю вендора и проверяется смысл слияния
        foreach ([$base, $ours, $theirs] as $c) {
            if ($c !== null) {
                $this->s->putBlob($c);
            }
        }
        $extra = array_filter($extra, static fn($c) => $c !== null);
        $dir = $this->s->filesDir($a->id, $rel);
        $info = ['key' => "{$a->id}:$rel", 'target' => $a->target($rel), 'mode' => $a->mode, 'triple' => [$h['base'], $h['ours'], $h['theirs']]];
        $old = Util::jsonRead("$dir/info.json");
        if ($old !== null && ($old['triple'] ?? null) === $info['triple'] && is_file("$dir/info.json")) {
            return ['files' => $this->s->relToSession($dir)];
        }
        if ($old !== null && is_file("$dir/resolved")) {
            @rename("$dir/resolved", "$dir/resolved.stale-" . date('Ymd-His'));
        }
        foreach (['base', 'ours', 'theirs', 'merged', 'vendor-new', 'installed-old', 'ours.diff', 'theirs.diff', 'ours-vs-theirs.diff', 'updater.diff'] as $f) {
            @unlink("$dir/$f");
        }
        Util::mkdir($dir);
        $n = static fn(?string $x) => $x === null ? null : Util::stripBom(am_to_lf($x));
        foreach (['base' => $base, 'ours' => $ours, 'theirs' => $theirs] + $extra as $f => $c) {
            if ($c !== null) {
                Util::put("$dir/$f", $c);
            }
        }
        $text = static fn(?string $x) => $x !== null && Util::isText($x);
        if ($text($base) && $text($ours)) {
            Util::put("$dir/ours.diff", am_unified($n($base), $n($ours), 'base', 'ours'));
        }
        if ($text($base) && $text($theirs)) {
            Util::put("$dir/theirs.diff", am_unified($n($base), $n($theirs), 'base', 'theirs'));
        }
        if ($base === null && $text($ours) && $text($theirs)) {
            Util::put("$dir/ours-vs-theirs.diff", am_unified($n($ours), $n($theirs), 'ours', 'theirs'));
        }
        if (isset($extra['vendor-new']) && $text($theirs) && $text($extra['vendor-new'])) {
            Util::put("$dir/updater.diff", am_unified($n($extra['vendor-new']), $n($theirs), 'эталон-новый', 'на-сайте'));
        }
        Util::jsonWrite("$dir/info.json", $info + ['time' => date('c')]);
        return ['files' => $this->s->relToSession($dir)];
    }

    /** Итоговые статусы с учётом решений и того, что уже лежит на диске */
    private function statuses(): void
    {
        $s = $this->s;
        foreach ($this->entries as $key => &$e) {
            $res = $s->d['resolutions'][$key] ?? null;
            $triple = [$e['h']['base'], $e['h']['ours'], $e['h']['theirs']];
            if ($res !== null && $res['triple'] !== $triple) {
                if ($this->sameUpToEol($res['triple'], $triple)) {
                    // вендор сменил только переводы строк (или BOM): решение то же, приводим его к новому стилю
                    $c = $res['h'] === '-' ? null : $s->blob($res['h']);
                    if ($c !== null) {
                        $res['h'] = $s->putBlob(Util::styleLike($c, $s->blob($e['h']['theirs']) ?? $s->blob($e['h']['ours']) ?? $c));
                    }
                    $res['triple'] = $triple;
                    $res['restyled'] = time();
                    $s->d['resolutions'][$key] = $res;
                } else {
                    $this->carry($e, $res);
                    $res = null;
                }
            }
            if ($res !== null && ($e['h']['current'] === ($res['h'] === '-' ? null : $res['h']))) {
                $s->d['resolutions'][$key]['applied'] = true;
                $res['applied'] = true;
            }
            $e['status'] = self::statusOf($e, $res, $s);
            if ($res !== null) {
                $e['resolution'] = $res;
            }
        }
        unset($e);
    }

    /**
     * Итог по файлу для status и report.md — что с ним сделано или что на месте сейчас (а не первоначальное действие
     * плана: у решённого конфликта действие плана — «вернуть нашу версию», а итог — «записано решение»).
     */
    public static function outcome(array $e): string
    {
        $act = (string)$e['action'];
        $src = (string)($e['resolution']['source'] ?? '');
        return match ($e['status']) {
            'done' => 'записано решение' . ($src !== '' ? " ($src)" : ''),
            'resolved' => 'решение принято' . ($src !== '' ? " ($src)" : '') . ', ждёт apply-resolved',
            'applied' => self::DONE[$act] ?? $act,
            'auto' => 'ждёт apply: ' . (self::ACT[$act] ?? $act),
            'conflict', 'review', 'error' => 'на разбор; до решения ' . match (true) {
                $act === 'restore' && ($e['mode'] ?? '') === Area::COPY => 'в копии прежняя версия (изменения вендора в файле не действуют)',
                $act === 'restore' => 'на месте наша прежняя версия (изменения вендора в файле не действуют)',
                $act === 'take' && ($e['h']['ours'] ?? null) !== null && ($e['h']['base'] ?? null) !== ($e['h']['ours'] ?? null)
                    => 'на месте версия вендора (нашей доработки в файле нет)',
                default => self::HOLD[$act] ?? $act,
            },
            default => match (true) {
                // слияние совпало с новой версией вендора: вендор сделал ту же правку, что и мы, — записывать нечего
                $act === 'merge' && $e['h']['current'] !== null && $e['h']['current'] === $e['h']['theirs'] => 'слилось в новую версию вендора: наша правка уже есть у вендора, записывать нечего',
                $act === 'merge' => 'результат слияния уже на месте',
                $act === 'take' || $act === 'copy' => 'уже версия вендора',
                $act === 'delete' => 'уже удалён',
                $act === 'restore' => 'на месте наша версия',
                default => 'ничего не нужно',
            },
        };
    }

    /**
     * Что сейчас на сайте по записям плана — для уведомления, status и report.md (вместо одного «применено N»):
     *  written     — записал инструмент: новые версии вендора, результаты слияний, новые файлы, удаления;
     *  updater     — версию вендора в недоработанный файл записал сам обновлятор («на месте»), делать нечего;
     *  held_ours   — на разбор, а до решения на месте наша прежняя версия («на месте» — возвращена после установки,
     *                «копия» — файл копии не тронут): изменения вендора в этих файлах не действуют;
     *  held_theirs — на разбор, а до решения на месте версия вендора (conflict_keep = theirs): доработки в файле нет;
     *  other       — на разбор, файл не тронут, удалён или нашей версии нет.
     * Каждый элемент — ['target', 'mode', 'fix' => текст подсказки об исправлении вендора или null].
     */
    public static function window(array $entries): array
    {
        $w = ['written' => [], 'updater' => [], 'held_ours' => [], 'held_theirs' => [], 'other' => []];
        foreach ($entries as $e) {
            $st = (string)$e['status'];
            $act = (string)$e['action'];
            $item = ['target' => $e['target'], 'mode' => $e['mode'] ?? Area::INPLACE, 'fix' => $e['vendor_fix']['text'] ?? null];
            if ($st === 'applied' && in_array($act, ['take', 'copy', 'merge', 'delete'], true)) {
                $w['written'][] = $item;
            } elseif ($st === 'ok' && $item['mode'] === Area::INPLACE && in_array($e['cat'], ['vendor-only', 'new-file', 'deleted-clean', 'ours-ws'], true)
                && $e['h']['theirs'] !== $e['h']['base']) {
                $w['updater'][] = $item;
            } elseif (in_array($st, ['conflict', 'review', 'error'], true)) {
                $ours = $e['h']['ours'] ?? null;
                if ($act === 'restore') {
                    $w['held_ours'][] = $item;
                } elseif ($act === 'take' && $ours !== null && $ours !== ($e['h']['base'] ?? null)) {
                    $w['held_theirs'][] = $item;
                } else {
                    $w['other'][] = $item;
                }
            }
        }
        return $w;
    }

    /**
     * Автослияния, которые сохранили старый код отставшей копии (поле rollback записи, с 1.2.1): слияние на месте или ждёт
     * apply, решения поверх него нет. Слияние всё равно лучше прежней версии (в нём есть изменения вендора этого
     * обновления), поэтому применяется, но в status, уведомлении и report.md оно — «разобрать вместе с конфликтами».
     */
    public static function rollbacks(array $entries): array
    {
        return array_values(array_filter($entries, static fn($e) => !empty($e['rollback'])
            && in_array($e['status'], ['applied', 'auto', 'ok'], true) && ($e['action'] ?? '') === 'merge'));
    }

    /**
     * Строки о том, что до решения на месте в файлах на разбор и что из-за этого не действует (простой текст).
     * $max — сколько файлов назвать в строке; $fix — добавить подсказки «вендор, похоже, исправил безопасность / формат».
     */
    public static function windowText(array $w, int $max = 5, bool $fix = true): array
    {
        $names = static function (array $items) use ($max): string {
            $t = array_column($items, 'target');
            return implode(', ', array_slice($t, 0, $max)) . (count($t) > $max ? ' …' : '');
        };
        $out = [];
        $inpl = array_values(array_filter($w['held_ours'], static fn($x) => $x['mode'] !== Area::COPY));
        $copy = array_values(array_filter($w['held_ours'], static fn($x) => $x['mode'] === Area::COPY));
        if ($inpl) {
            $out[] = 'Возвращена наша прежняя версия до решения: ' . count($inpl) . ' — ' . $names($inpl)
                . '. В этих файлах изменения вендора (в том числе исправления безопасности) НЕ действуют до сверки: решите их сразу.';
        }
        if ($copy) {
            $out[] = 'В копии до решения прежняя версия: ' . count($copy) . ' — ' . $names($copy)
                . '. Изменения вендора в этих файлах не действуют до сверки (так устроен режим «копия»: копия перекрывает установленную папку).';
        }
        if ($w['held_theirs']) {
            $out[] = 'До решения на месте версия вендора (conflict_keep = theirs): ' . count($w['held_theirs']) . ' — ' . $names($w['held_theirs'])
                . '. Исправления вендора действуют, но наших доработок в этих файлах до сверки нет.';
        }
        if ($fix) {
            $fx = array_values(array_filter(array_merge($w['held_ours'], $w['held_theirs'], $w['other']), static fn($x) => $x['fix'] !== null));
            if ($fx) {
                $out[] = 'Вендор, похоже, исправил безопасность или формат (подсказка по словам в theirs.diff, не вывод): '
                    . implode('; ', array_map(static fn($x) => "{$x['target']} — {$x['fix']}", array_slice($fx, 0, $max))) . (count($fx) > $max ? ' …' : '') . '.';
            }
        }
        return $out;
    }

    /**
     * Связанные изменения вендора: для каждого файла на разбор — другие файлы этого обновления, в изменениях вендора
     * которых встречаются те же редкие имена (классы, функции, переменные, ключи), что и в изменении вендора в этом файле.
     * Так видно межфайловый «контракт»: в 1.7.21 вендор перевёл параметры корзины на подпись ParameterSigner сразу в
     * шаблоне корзины и в ajax/show_basket_popup.php — пока конфликт в шаблоне не решён, попап корзины не работал.
     * Это подсказка, а не вывод: совпадение имён не доказывает связь, отсутствие — не доказывает её отсутствие.
     * Пропускается, если в событии мало времени. Результат — поле related записи: [['key', 'target', 'tokens'], ...].
     */
    private function linkRelated(): void
    {
        if ($this->deadline !== null && microtime(true) > $this->deadline - 3) {
            return;
        }
        $need = array_filter($this->entries, static fn($e) => $e['needs'] !== null && $e['h']['theirs'] !== null && $e['h']['theirs'] !== $e['h']['base']);
        if (!$need) {
            return;
        }
        $tok = [];
        foreach ($this->entries as $key => $e) {
            if ($e['cat'] === 'not-applied' || $e['h']['theirs'] === null || $e['h']['theirs'] === $e['h']['base']) {
                continue;
            }
            if ($this->deadline !== null && microtime(true) > $this->deadline - 1) {
                return;
            }
            $t = $this->changedTokens($e);
            if ($t) {
                $tok[$key] = $t;
            }
        }
        $df = [];
        foreach ($tok as $set) {
            foreach ($set as $w => $_) {
                $df[$w] = ($df[$w] ?? 0) + 1;
            }
        }
        // имя, которое вендор менял в слишком многих файлах (больше 8 или 10% изменённых), — общее место, не признак связи;
        // вес общего имени — 1/(число других файлов с ним): имя только из двух файлов весит 1, из восьми — 1/7
        $limit = max(8, (int)ceil(count($tok) * 0.1));
        foreach ($need as $key => $e) {
            if (empty($tok[$key])) {
                continue;
            }
            $mine = array_values(array_filter(array_keys($tok[$key]), static fn($w) => $df[$w] >= 2 && $df[$w] <= $limit));
            if (!$mine) {
                continue;
            }
            $rel = [];
            foreach ($tok as $k2 => $set) {
                if ($k2 === $key) {
                    continue;
                }
                $shared = array_values(array_filter($mine, static fn($w) => isset($set[$w])));
                $score = array_sum(array_map(static fn($w) => 1 / ($df[$w] - 1), $shared));
                if ($score >= 0.6) {
                    usort($shared, static fn($a, $b) => $df[$a] <=> $df[$b] ?: strlen($b) <=> strlen($a));
                    $rel[] = ['key' => $k2, 'target' => $this->entries[$k2]['target'], 'score' => round($score, 2),
                        'tokens' => array_map(static fn($w) => $tok[$key][$w], array_slice($shared, 0, 4))];
                }
            }
            usort($rel, static fn($a, $b) => $b['score'] <=> $a['score'] ?: strcmp($a['target'], $b['target']));
            if ($rel) {
                $this->entries[$key]['related'] = array_slice($rel, 0, 4);
            }
        }
    }

    /**
     * Признаки исправлений безопасности и смены формата в изменении вендора (theirs против base): слово => [метка,
     * регулярное выражение]. Счёт ведётся по строкам, которые вендор добавил и удалил (как в theirs.diff).
     */
    public const FIX_MARKERS = [
        'htmlspecialcharsbx' => ['экранирование', '~\bhtmlspecialcharsbx\s*\(~i'],
        'htmlspecialchars' => ['экранирование', '~\bhtmlspecialchars\s*\(~i'],
        'CUtil::JSEscape' => ['экранирование', '~\bCUtil::JSEscape\s*\(~i'],
        'preg_quote' => ['экранирование', '~\bpreg_quote\s*\(~i'],
        'escapeshellarg' => ['экранирование', '~\bescapeshellarg\s*\(~i'],
        'ParameterSigner' => ['подпись параметров (формат данных между файлами)', '~\bParameterSigner\b~'],
        'signParameters' => ['подпись параметров (формат данных между файлами)', '~\bsignParameters\s*\(~'],
        'check_bitrix_sessid' => ['проверка сессии (sessid)', '~\bcheck_bitrix_sessid\s*\(~i'],
        'bitrix_sessid' => ['проверка сессии (sessid)', '~\bbitrix_sessid(?:_post|_get)?\s*\(~i'],
        'sessid' => ['проверка сессии (sessid)', '~\bsessid\b~i'],
        'backurl' => ['обработка backurl (адрес возврата)', '~backurl~i'],
        '(int)' => ['приведение типов и проверка ввода', '~\(\s*int\s*\)~i'],
        '(array)' => ['приведение типов и проверка ввода', '~\(\s*array\s*\)~i'],
        'intval' => ['приведение типов и проверка ввода', '~\bintval\s*\(~i'],
        'filter_var' => ['приведение типов и проверка ввода', '~\bfilter_var\s*\(~i'],
    ];

    /**
     * Признаки старого кода, которого у вендора больше нет (с 1.2.0): если наша версия добавляет их к базе, это скорее
     * откат (копия отстала), чем доработка. Слово => [метка, регулярное выражение].
     */
    public const OLD_CODE = [
        '.live(' => ['устаревший jQuery: .live() убран в jQuery 1.9', '~\.live\s*\(~'],
        '.die(' => ['устаревший jQuery: .die() убран в jQuery 1.9', '~\.die\s*\(~'],
    ];

    /**
     * Подсказка «вендор исправил безопасность / формат» по изменению вендора: признаки из FIX_MARKERS, которых в
     * добавленных вендором строках больше, чем в удалённых (backurl и sessid — если они вообще есть в изменённых строках).
     * [['marker', 'label', 'added', 'removed'], ...]. Это совпадение слов, а не вывод: признака может не быть у
     * настоящего исправления, и наоборот.
     */
    public static function fixHints(string $base, string $theirs): array
    {
        $n = static fn(string $x) => Util::stripBom(am_to_lf($x));
        $added = implode("\n", Util::addedLines($n($base), $n($theirs)));
        $removed = implode("\n", Util::addedLines($n($theirs), $n($base)));
        $out = [];
        foreach (self::FIX_MARKERS as $marker => [$label, $re]) {
            $ad = preg_match_all($re, $added);
            $rm = preg_match_all($re, $removed);
            if ($ad > $rm || ($ad > 0 && in_array($marker, ['backurl', 'sessid'], true))) {
                $out[] = ['marker' => $marker, 'label' => $label, 'added' => (int)$ad, 'removed' => (int)$rm];
            }
        }
        return $out;
    }

    /** Текст подсказки: «экранирование (htmlspecialcharsbx +12); обработка backurl (адрес возврата) (backurl: строк вендора 4)» */
    public static function fixText(array $hints): string
    {
        $by = [];
        foreach ($hints as $x) {
            $d = $x['added'] - $x['removed'];
            $by[$x['label']][] = $d > 0 ? "{$x['marker']} +$d" : "{$x['marker']} в изменённых строках";
        }
        return implode('; ', array_map(static fn($l, $m) => "$l (" . implode(', ', $m) . ')', array_keys($by), $by));
    }

    /** Подсказки об исправлениях вендора — для файлов на разбор (поле vendor_fix записи: hints, text) */
    private function vendorFixes(): void
    {
        foreach ($this->entries as $key => $e) {
            if ($e['needs'] === null || $e['h']['theirs'] === null || $e['h']['base'] === null || $e['h']['theirs'] === $e['h']['base']) {
                continue;
            }
            if ($this->deadline !== null && microtime(true) > $this->deadline - 1) {
                return;
            }
            $theirs = $this->contentOf($e, $e['h']['theirs'], true);
            $base = $this->contentOf($e, $e['h']['base'], false);
            if ($theirs === null || $base === null || !Util::isText($theirs) || !Util::isText($base) || strlen($theirs) > Util::MAX_READ) {
                continue;
            }
            $hints = self::fixHints($base, $theirs);
            if ($hints) {
                $this->entries[$key]['vendor_fix'] = ['hints' => $hints, 'text' => self::fixText($hints)];
            }
        }
    }

    /**
     * Имена из строк, которые поменял вендор (добавленные и удалённые, без строк, где поменялись только пробелы):
     * нижний регистр => как в коде. Идентификаторы — латиница, цифры и «_», от 5 символов, без слов из STOP;
     * строковые литералы без пробелов от 6 символов (имя компонента 'bitrix:sale.basket.basket.line', ключ, адрес) —
     * в кавычках, как в коде.
     */
    private function changedTokens(array $e): array
    {
        $theirs = $this->contentOf($e, $e['h']['theirs'], true);
        if ($theirs === null || !Util::isText($theirs) || strlen($theirs) > Util::MAX_READ) {
            return [];
        }
        $base = $e['h']['base'] === null ? '' : $this->contentOf($e, $e['h']['base'], false);
        if ($base === null || !Util::isText($base)) {
            return [];
        }
        $n = static fn(string $x) => Util::stripBom(am_to_lf($x));
        $added = Util::addedLines($n($base), $n($theirs));
        $removed = $base === '' ? [] : Util::addedLines($n($theirs), $n($base));
        $sq = static fn(string $l) => (string)preg_replace('~\s+~', '', $l);
        $addedSq = array_flip(array_map($sq, $added));
        $removedSq = array_flip(array_map($sq, $removed));
        $out = [];
        foreach ([[$added, $removedSq], [$removed, $addedSq]] as [$lines, $other]) {
            foreach ($lines as $l) {
                if (isset($other[$sq($l)])) {
                    continue; // поменялись только пробелы
                }
                if (preg_match_all('~[A-Za-z_][A-Za-z0-9_]{4,}~', $l, $m)) {
                    foreach ($m[0] as $w) {
                        $lw = strtolower($w);
                        if (!in_array($lw, self::STOP, true) && !isset($out[$lw])) {
                            $out[$lw] = $w;
                        }
                    }
                }
                if (preg_match_all('~([\'"])([A-Za-z_][A-Za-z0-9_.:/\-]{5,})\1~', $l, $m)) {
                    foreach ($m[2] as $w) {
                        $lw = "'" . strtolower($w) . "'";
                        if (!in_array(strtolower($w), self::STOP, true) && !isset($out[$lw])) {
                            $out[$lw] = "'$w'";
                        }
                    }
                }
            }
        }
        return $out;
    }

    /** Содержимое версии файла по хешу: из сеанса, снимка базы (установленная папка или эталон) или с диска */
    private function contentOf(array $e, string $h, bool $theirs): ?string
    {
        $c = $this->s->blob($h);
        if ($c !== null) {
            return $c;
        }
        $a = $this->c->area($e['area']);
        if ($a === null) {
            return null;
        }
        $cands = [];
        if ($theirs) {
            $cands[] = fn() => Util::readSmall($this->c->abs($a->installedPath($e['rel'])));
            $cands[] = fn() => Util::readSmall($this->c->abs($e['target']));
        } elseif ($this->base !== null) {
            $cands[] = fn() => $this->base->stateContent($a, 'I', $e['rel']);
            $cands[] = fn() => $this->base->etalonContent($a, $e['rel']);
        } else {
            $cands[] = fn() => $this->pseudoContent[$a->id][$e['rel']] ?? null;
        }
        foreach ($cands as $f) {
            $x = $f();
            if ($x !== null && Util::gitHash($x) === $h) {
                return $x;
            }
        }
        return null;
    }

    /** Статус записи по текущему хешу файла и решению */
    public static function statusOf(array $e, ?array $res, Session $s): string
    {
        $cur = $e['h']['current'];
        if ($res !== null) {
            return $cur === ($res['h'] === '-' ? null : $res['h']) ? 'done' : 'resolved';
        }
        if ($e['needs'] !== null) {
            return $e['needs'];
        }
        if ($e['auto'] !== null) {
            $want = $e['auto'] === '-' ? null : $e['auto'];
            return $cur === $want ? ($s->lastWrite($e['target']) ? 'applied' : 'ok') : 'auto';
        }
        return 'ok';
    }

    /** Пересчитать статусы записей после записи файлов (без полного расчёта плана): текущие хеши — с диска */
    public static function refresh(Session $s, Config $c): void
    {
        foreach ($s->d['entries'] as $key => &$e) {
            $abs = $c->abs($e['target']);
            $e['h']['current'] = is_file($abs) ? Util::gitHashFile($abs) : null;
            $res = $s->d['resolutions'][$key] ?? null;
            if ($res !== null && $res['triple'] !== [$e['h']['base'], $e['h']['ours'], $e['h']['theirs']]) {
                $res = null;
            }
            if ($res !== null && $e['h']['current'] === ($res['h'] === '-' ? null : $res['h'])) {
                $s->d['resolutions'][$key]['applied'] = true;
                $res['applied'] = true;
            }
            $e['status'] = self::statusOf($e, $res, $s);
            if ($res !== null) {
                $e['resolution'] = $res;
            }
        }
        unset($e);
    }

    /** Тройки совпадают с точностью до переводов строк и BOM */
    private function sameUpToEol(array $t1, array $t2): bool
    {
        foreach ([0, 1, 2] as $i) {
            if (($t1[$i] ?? null) === $t2[$i]) {
                continue;
            }
            $a = $this->s->blob($t1[$i] ?? null);
            $b = $this->s->blob($t2[$i]);
            if ($a === null || $b === null || $this->h($a)['n'] !== $this->h($b)['n']) {
                return false;
            }
        }
        return true;
    }

    /**
     * Решение устарело (файл снова изменился — новый шаг обновления). Если решение уже было на сайте, оно не
     * откатывается на «нашу» версию: прежнее решение переносится на новую версию вендора трёхсторонним слиянием
     * (база — прежняя версия вендора), а если не сливается — остаётся на месте прежнее решение. В обоих случаях — на разбор.
     */
    private function carry(array &$e, array $res): void
    {
        $s = $this->s;
        $key = $e['key'];
        unset($s->d['resolutions'][$key]);
        $s->d['resolutions_stale'][$key][] = $res + ['stale' => time()];
        $note = 'прежнее решение устарело (файл снова изменился)';
        $old = $res['h'] !== '-' ? $s->blob($res['h']) : null;
        // записи, где инструмент не должен писать сам (правка на сайте, смена режима, неоднозначная база, точечная
        // правка обновлятора, нет базы), только снова идут на разбор
        $hands = in_array($e['cat'], ['changed-outside', 'mode-changed', 'base-ambiguous', 'point-edit', 'no-base'], true);
        if (!empty($res['applied']) && $old !== null && !$hands) {
            $oldTheirs = $s->blob($res['triple'][2] ?? null);
            $newTheirs = $s->blob($e['h']['theirs']);
            $auto = $res['h'];
            $action = 'restore';
            if ($oldTheirs !== null && $newTheirs !== null && Util::isText($old) && Util::isText($oldTheirs) && Util::isText($newTheirs)) {
                $m = self::merge3($oldTheirs, $old, $newTheirs);
                $mh = $m['conflicts'] === 0 ? $s->putBlob($m['text']) : null;
                if ($mh !== null && ($s->d['lint'][$key]['h'] ?? null) !== $mh && ($s->d['lint_defer'][$key] ?? null) !== $mh) {
                    $auto = $mh;
                    $action = 'merge';
                    $e['needs'] = 'review'; // конфликта на сайте нет: решение перенесено чисто, осталось проверить
                    $note .= ' — оно перенесено на новую версию вендора слиянием (база — прежняя версия вендора); проверьте и примите (resolve <файл> keep)';
                } elseif ($mh !== null) {
                    $note .= ' — перенос слиянием не прошёл проверку php -l; на месте прежнее решение';
                } else {
                    $note .= ' — на месте прежнее решение: перенести его на новую версию вендора без конфликта не удалось';
                }
            } else {
                $note .= ' — на месте прежнее решение';
            }
            $e['action'] = $action;
            $e['auto'] = $auto;
            $e['fallback'] = $res['h'];
        } else {
            $note .= ' — разберите заново';
        }
        $e['note'] = trim(($e['note'] ?? '') . '; ' . $note, '; ');
        if ($e['needs'] === null) {
            $e['needs'] = 'review';
        }
    }
}
