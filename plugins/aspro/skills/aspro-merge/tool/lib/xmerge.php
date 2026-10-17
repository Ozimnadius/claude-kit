<?php
// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Файл — перевод на PHP части библиотеки xdiff из git. Ниже — уведомления об авторских правах и лицензии исходных
// файлов git ДОСЛОВНО: каждый блок /* … */ — байт в байт шапка указанного файла (git, xdiff/), как требует лицензия.
// Перевод их смысла, что изменено и описание движка — в блоке после них.

// ---- git: xdiff/xmerge.c
/*
 *  LibXDiff by Davide Libenzi ( File Differential Library )
 *  Copyright (C) 2003-2006 Davide Libenzi, Johannes E. Schindelin
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2.1 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, see
 *  <http://www.gnu.org/licenses/>.
 *
 *  Davide Libenzi <davidel@xmailserver.org>
 *
 */

// ---- git: xdiff/xdiffi.c
/*
 *  LibXDiff by Davide Libenzi ( File Differential Library )
 *  Copyright (C) 2003	Davide Libenzi
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2.1 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, see
 *  <http://www.gnu.org/licenses/>.
 *
 *  Davide Libenzi <davidel@xmailserver.org>
 *
 */

// ---- git: xdiff/xprepare.c
/*
 *  LibXDiff by Davide Libenzi ( File Differential Library )
 *  Copyright (C) 2003  Davide Libenzi
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2.1 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, see
 *  <http://www.gnu.org/licenses/>.
 *
 *  Davide Libenzi <davidel@xmailserver.org>
 *
 */

// ---- git: xdiff/xutils.c
/*
 *  LibXDiff by Davide Libenzi ( File Differential Library )
 *  Copyright (C) 2003	Davide Libenzi
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2.1 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, see
 *  <http://www.gnu.org/licenses/>.
 *
 *  Davide Libenzi <davidel@xmailserver.org>
 *
 */

/**
 * Лицензия этого файла — GNU LGPL версии 2.1 или (на выбор) любой более поздней (LGPL-2.1-or-later), а не MIT, как у
 * остального кода инструмента. Условия, где лежит полный текст лицензии и что изменено — LICENSE-xmerge.md рядом.
 *
 * Перевод смысла уведомлений выше (справочно; юридическую силу имеет английский текст): LibXDiff Давиде Либенци —
 * библиотека построчных различий файлов; авторские права — Davide Libenzi (2003), у xmerge.c — Davide Libenzi и
 * Johannes E. Schindelin (2003–2006). Библиотека свободная: её можно распространять и изменять на условиях GNU Lesser
 * General Public License, опубликованной Free Software Foundation, версии 2.1 или (на выбор) любой более поздней.
 * Распространяется в надежде, что будет полезной, но БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ — даже подразумеваемых гарантий товарной
 * пригодности или пригодности для определённой цели (подробнее — в тексте LGPL). Вместе с библиотекой должна быть копия
 * лицензии; если её нет — см. <http://www.gnu.org/licenses/>. Автор LibXDiff — Давиде Либенци, адрес — в уведомлении.
 *
 * Изменено (2026, авторы aspro-merge): перевод с C на PHP 8.1 — записи хранятся строками PHP, классы одинаковых строк —
 * массивами PHP вместо хеш-таблиц xdiff; оставлено только то, что нужно для `git merge-file` с настройками по умолчанию
 * (алгоритм Myers без patience/histogram и indent heuristic, без флагов игнорирования пробелов; уровень слияния EAGER
 * для diff3 и ZEALOUS_ALNUM для merge); добавлены свои функции am_split, am_merge, am_to_lf, am_is_crlf и am_unified
 * (вывод унифицированного diff поверх am_xdiff — не порт xemit.c) и пространство имён AsproMerge.
 *
 * Трёхстороннее слияние без git. Цель — получать тот же результат, что `git merge-file`, на сервере, где git нет:
 *  - построчный diff Myers с эвристиками xdiff (обрезка общих краёв, отбрасывание строк без пары,
 *    ограничение стоимости, «змейки»), сдвиг групп изменений (xdl_change_compact);
 *  - слияние: непересекающиеся изменения сторон принимаются, совпадающие — тоже (уровень EAGER),
 *    касающиеся и пересекающиеся — конфликт; для стиля merge — уточнение конфликтов (ZEALOUS_ALNUM);
 *  - маркеры как у git: <<<<<<< ours / ||||||| base / ======= / >>>>>>> theirs.
 *
 * Строка = запись вместе с "\n" (последняя может быть без него), как в xdiff.
 * Переводы строк (CRLF) движок не трогает — нормализуйте до вызова (см. am_to_lf).
 *
 * Результат сверяется с git merge-file 2.54 (случайные тройки — тесты репозитория разработки, эталонные случаи —
 * selftest-cases.json); пространство имён — чтобы функции не пересекались с кодом сайта при подключении из ядра.
 */

declare(strict_types=1);

namespace AsproMerge;

const AM_SNAKE_CNT = 20;
const AM_HEUR_MIN_COST = 256;
const AM_MAX_COST_MIN = 256;
const AM_K_HEUR = 4;
const AM_MAX_EQLIMIT = 1024;
const AM_SIMSCAN_WINDOW = 100;
const AM_KPDIS_RUN = 4;

const AM_STYLE_MERGE = 'merge';
const AM_STYLE_DIFF3 = 'diff3';

/** Разбить текст на записи xdiff (каждая с "\n", кроме, возможно, последней). */
function am_split(string $s): array
{
    if ($s === '') {
        return [];
    }
    $parts = explode("\n", $s);
    $last = array_pop($parts);
    $recs = [];
    foreach ($parts as $p) {
        $recs[] = $p . "\n";
    }
    if ($last !== '') {
        $recs[] = $last;
    }
    return $recs;
}

function am_bogosqrt(int $n): int
{
    for ($i = 1; $n > 0; $n >>= 2) {
        $i <<= 1;
    }
    return $i;
}

/** xdl_clean_mmatch: отбрасывать ли строку с многими совпадениями внутри серии строк без пары. */
function am_clean_mmatch(array $dis, int $i, int $s, int $e): bool
{
    if ($i - $s > AM_SIMSCAN_WINDOW) {
        $s = $i - AM_SIMSCAN_WINDOW;
    }
    if ($e - $i > AM_SIMSCAN_WINDOW) {
        $e = $i + AM_SIMSCAN_WINDOW;
    }
    $rdis0 = 0;
    $rpdis0 = 1;
    for ($r = 1; ($i - $r) >= $s; $r++) {
        $d = $dis[$i - $r];
        if ($d === 0) {
            $rdis0++;
        } elseif ($d === 2) {
            $rpdis0++;
        } else {
            break;
        }
    }
    if ($rdis0 === 0) {
        return false;
    }
    $rdis1 = 0;
    $rpdis1 = 1;
    for ($r = 1; ($i + $r) <= $e; $r++) {
        $d = $dis[$i + $r];
        if ($d === 0) {
            $rdis1++;
        } elseif ($d === 2) {
            $rpdis1++;
        } else {
            break;
        }
    }
    if ($rdis1 === 0) {
        return false;
    }
    $rdis1 += $rdis0;
    $rpdis1 += $rpdis0;
    return $rpdis1 * AM_KPDIS_RUN < ($rpdis1 + $rdis1);
}

/**
 * xdl_split: поиск средней «змейки» Myers с эвристиками xdiff.
 * Возвращает [i1, i2, min_lo, min_hi].
 */
function am_split_box(array $ha1, int $off1, int $lim1, array $ha2, int $off2, int $lim2, bool $needMin, array $env): array
{
    $dmin = $off1 - $lim2;
    $dmax = $lim1 - $off2;
    $fmid = $off1 - $off2;
    $bmid = $lim1 - $lim2;
    $odd = (($fmid - $bmid) & 1) !== 0;
    $fmin = $fmax = $fmid;
    $bmin = $bmax = $bmid;
    $kvdf = [$fmid => $off1];
    $kvdb = [$bmid => $lim1];
    $LINE_MAX = PHP_INT_MAX;

    for ($ec = 1;; $ec++) {
        $gotSnake = false;

        if ($fmin > $dmin) {
            $kvdf[--$fmin - 1] = -1;
        } else {
            ++$fmin;
        }
        if ($fmax < $dmax) {
            $kvdf[++$fmax + 1] = -1;
        } else {
            --$fmax;
        }
        for ($d = $fmax; $d >= $fmin; $d -= 2) {
            if ($kvdf[$d - 1] >= $kvdf[$d + 1]) {
                $i1 = $kvdf[$d - 1] + 1;
            } else {
                $i1 = $kvdf[$d + 1];
            }
            $prev1 = $i1;
            $i2 = $i1 - $d;
            while ($i1 < $lim1 && $i2 < $lim2 && $ha1[$i1] === $ha2[$i2]) {
                $i1++;
                $i2++;
            }
            if ($i1 - $prev1 > $env['snake_cnt']) {
                $gotSnake = true;
            }
            $kvdf[$d] = $i1;
            if ($odd && $bmin <= $d && $d <= $bmax && $kvdb[$d] <= $i1) {
                return [$i1, $i2, true, true];
            }
        }

        if ($bmin > $dmin) {
            $kvdb[--$bmin - 1] = $LINE_MAX;
        } else {
            ++$bmin;
        }
        if ($bmax < $dmax) {
            $kvdb[++$bmax + 1] = $LINE_MAX;
        } else {
            --$bmax;
        }
        for ($d = $bmax; $d >= $bmin; $d -= 2) {
            if ($kvdb[$d - 1] < $kvdb[$d + 1]) {
                $i1 = $kvdb[$d - 1];
            } else {
                $i1 = $kvdb[$d + 1] - 1;
            }
            $prev1 = $i1;
            $i2 = $i1 - $d;
            while ($i1 > $off1 && $i2 > $off2 && $ha1[$i1 - 1] === $ha2[$i2 - 1]) {
                $i1--;
                $i2--;
            }
            if ($prev1 - $i1 > $env['snake_cnt']) {
                $gotSnake = true;
            }
            $kvdb[$d] = $i1;
            if (!$odd && $fmin <= $d && $d <= $fmax && $i1 <= $kvdf[$d]) {
                return [$i1, $i2, true, true];
            }
        }

        if ($needMin) {
            continue;
        }

        if ($gotSnake && $ec > $env['heur_min']) {
            $best = 0;
            $res = null;
            for ($d = $fmax; $d >= $fmin; $d -= 2) {
                $dd = $d > $fmid ? $d - $fmid : $fmid - $d;
                $i1 = $kvdf[$d];
                $i2 = $i1 - $d;
                $v = ($i1 - $off1) + ($i2 - $off2) - $dd;
                if ($v > AM_K_HEUR * $ec && $v > $best
                    && $off1 + $env['snake_cnt'] <= $i1 && $i1 < $lim1
                    && $off2 + $env['snake_cnt'] <= $i2 && $i2 < $lim2) {
                    for ($k = 1; $ha1[$i1 - $k] === $ha2[$i2 - $k]; $k++) {
                        if ($k === $env['snake_cnt']) {
                            $best = $v;
                            $res = [$i1, $i2];
                            break;
                        }
                    }
                }
            }
            if ($best > 0) {
                return [$res[0], $res[1], true, false];
            }
            $best = 0;
            for ($d = $bmax; $d >= $bmin; $d -= 2) {
                $dd = $d > $bmid ? $d - $bmid : $bmid - $d;
                $i1 = $kvdb[$d];
                $i2 = $i1 - $d;
                $v = ($lim1 - $i1) + ($lim2 - $i2) - $dd;
                if ($v > AM_K_HEUR * $ec && $v > $best
                    && $off1 < $i1 && $i1 <= $lim1 - $env['snake_cnt']
                    && $off2 < $i2 && $i2 <= $lim2 - $env['snake_cnt']) {
                    for ($k = 0; $ha1[$i1 + $k] === $ha2[$i2 + $k]; $k++) {
                        if ($k === $env['snake_cnt'] - 1) {
                            $best = $v;
                            $res = [$i1, $i2];
                            break;
                        }
                    }
                }
            }
            if ($best > 0) {
                return [$res[0], $res[1], false, true];
            }
        }

        if ($ec >= $env['mxcost']) {
            $fbest = $fbest1 = -1;
            for ($d = $fmax; $d >= $fmin; $d -= 2) {
                $i1 = min($kvdf[$d], $lim1);
                $i2 = $i1 - $d;
                if ($lim2 < $i2) {
                    $i1 = $lim2 + $d;
                    $i2 = $lim2;
                }
                if ($fbest < $i1 + $i2) {
                    $fbest = $i1 + $i2;
                    $fbest1 = $i1;
                }
            }
            $bbest = $bbest1 = $LINE_MAX;
            for ($d = $bmax; $d >= $bmin; $d -= 2) {
                $i1 = max($off1, $kvdb[$d]);
                $i2 = $i1 - $d;
                if ($i2 < $off2) {
                    $i1 = $off2 + $d;
                    $i2 = $off2;
                }
                if ($i1 + $i2 < $bbest) {
                    $bbest = $i1 + $i2;
                    $bbest1 = $i1;
                }
            }
            if (($lim1 + $lim2) - $bbest < $fbest - ($off1 + $off2)) {
                return [$fbest1, $fbest - $fbest1, true, false];
            }
            return [$bbest1, $bbest - $bbest1, false, true];
        }
    }
}

/** xdl_recs_cmp: «разделяй и властвуй», помечает изменённые записи в rchg (индекс со сдвигом +1). */
function am_recs_cmp(array $ha1, int $off1, int $lim1, array $rindex1, array &$rchg1,
                     array $ha2, int $off2, int $lim2, array $rindex2, array &$rchg2,
                     bool $needMin, array $env): void
{
    while ($off1 < $lim1 && $off2 < $lim2 && $ha1[$off1] === $ha2[$off2]) {
        $off1++;
        $off2++;
    }
    while ($off1 < $lim1 && $off2 < $lim2 && $ha1[$lim1 - 1] === $ha2[$lim2 - 1]) {
        $lim1--;
        $lim2--;
    }
    if ($off1 === $lim1) {
        for (; $off2 < $lim2; $off2++) {
            $rchg2[$rindex2[$off2] + 1] = 1;
        }
    } elseif ($off2 === $lim2) {
        for (; $off1 < $lim1; $off1++) {
            $rchg1[$rindex1[$off1] + 1] = 1;
        }
    } else {
        [$s1, $s2, $minLo, $minHi] = am_split_box($ha1, $off1, $lim1, $ha2, $off2, $lim2, $needMin, $env);
        am_recs_cmp($ha1, $off1, $s1, $rindex1, $rchg1, $ha2, $off2, $s2, $rindex2, $rchg2, $minLo, $env);
        am_recs_cmp($ha1, $s1, $lim1, $rindex1, $rchg1, $ha2, $s2, $lim2, $rindex2, $rchg2, $minHi, $env);
    }
}

// --- сдвиг групп изменений (xdl_change_compact) ---

function am_g_init(array $rchg): array
{
    $e = 0;
    while ($rchg[$e + 1]) {
        $e++;
    }
    return [0, $e];
}

function am_g_next(array $rchg, int $nrec, array &$g): bool
{
    if ($g[1] === $nrec) {
        return false;
    }
    $g[0] = $g[1] + 1;
    for ($g[1] = $g[0]; $rchg[$g[1] + 1]; $g[1]++) {
    }
    return true;
}

function am_g_prev(array $rchg, array &$g): bool
{
    if ($g[0] === 0) {
        return false;
    }
    $g[1] = $g[0] - 1;
    for ($g[0] = $g[1]; $rchg[$g[0]]; $g[0]--) { // rchg[start-1] со сдвигом +1 = $rchg[start]
    }
    return true;
}

function am_g_slide_down(array &$rchg, array $ha, int $nrec, array &$g): bool
{
    if ($g[1] < $nrec && $ha[$g[0]] === $ha[$g[1]]) {
        $rchg[$g[0] + 1] = 0;
        $g[0]++;
        $rchg[$g[1] + 1] = 1;
        $g[1]++;
        while ($rchg[$g[1] + 1]) {
            $g[1]++;
        }
        return true;
    }
    return false;
}

function am_g_slide_up(array &$rchg, array $ha, array &$g): bool
{
    if ($g[0] > 0 && $ha[$g[0] - 1] === $ha[$g[1] - 1]) {
        $g[0]--;
        $rchg[$g[0] + 1] = 1;
        $g[1]--;
        $rchg[$g[1] + 1] = 0;
        while ($rchg[$g[0]]) { // rchg[start-1]
            $g[0]--;
        }
        return true;
    }
    return false;
}

function am_change_compact(array &$rchg, array $ha, int $nrec, array &$rchgo, int $nreco): void
{
    $g = am_g_init($rchg);
    $go = am_g_init($rchgo);
    while (true) {
        if ($g[1] !== $g[0]) {
            do {
                $groupsize = $g[1] - $g[0];
                $endMatchingOther = -1;
                while (am_g_slide_up($rchg, $ha, $g)) {
                    if (!am_g_prev($rchgo, $go)) {
                        throw new \RuntimeException('group sync broken sliding up');
                    }
                }
                $earliestEnd = $g[1];
                if ($go[1] > $go[0]) {
                    $endMatchingOther = $g[1];
                }
                while (true) {
                    if (!am_g_slide_down($rchg, $ha, $nrec, $g)) {
                        break;
                    }
                    if (!am_g_next($rchgo, $nreco, $go)) {
                        throw new \RuntimeException('group sync broken sliding down');
                    }
                    if ($go[1] > $go[0]) {
                        $endMatchingOther = $g[1];
                    }
                }
            } while ($groupsize !== $g[1] - $g[0]);

            if ($g[1] === $earliestEnd) {
                // сдвиг невозможен
            } elseif ($endMatchingOther !== -1) {
                while ($go[1] === $go[0]) {
                    if (!am_g_slide_up($rchg, $ha, $g)) {
                        throw new \RuntimeException('match disappeared');
                    }
                    if (!am_g_prev($rchgo, $go)) {
                        throw new \RuntimeException('group sync broken sliding to match');
                    }
                }
            }
        }
        if (!am_g_next($rchg, $nrec, $g)) {
            break;
        }
        if (!am_g_next($rchgo, $nreco, $go)) {
            throw new \RuntimeException('group sync broken moving to next group');
        }
    }
}

/**
 * Построчный diff как в xdiff. Возвращает список изменений [i1, i2, chg1, chg2] по возрастанию
 * (i1/chg1 — в первом файле, i2/chg2 — во втором).
 */
function am_xdiff(array $r1, array $r2): array
{
    $cls = [];
    $len1 = [];
    $len2 = [];
    $ha1 = [];
    $ha2 = [];
    foreach ($r1 as $i => $l) {
        $c = $cls[$l] ??= count($cls);
        $ha1[$i] = $c;
        $len1[$c] = ($len1[$c] ?? 0) + 1;
    }
    foreach ($r2 as $i => $l) {
        $c = $cls[$l] ??= count($cls);
        $ha2[$i] = $c;
        $len2[$c] = ($len2[$c] ?? 0) + 1;
    }
    $n1 = count($r1);
    $n2 = count($r2);
    $rchg1 = array_fill(0, $n1 + 2, 0);
    $rchg2 = array_fill(0, $n2 + 2, 0);

    // xdl_trim_ends
    $lim = min($n1, $n2);
    for ($i = 0; $i < $lim; $i++) {
        if ($ha1[$i] !== $ha2[$i]) {
            break;
        }
    }
    $dstart = $i;
    for ($lim -= $i, $i = 0; $i < $lim; $i++) {
        if ($ha1[$n1 - 1 - $i] !== $ha2[$n2 - 1 - $i]) {
            break;
        }
    }
    $dend1 = $n1 - $i - 1;
    $dend2 = $n2 - $i - 1;

    // xdl_cleanup_records
    $dis1 = [];
    $dis2 = [];
    $mlim = min(am_bogosqrt($n1), AM_MAX_EQLIMIT);
    for ($i = $dstart; $i <= $dend1; $i++) {
        $nm = $len2[$ha1[$i]] ?? 0;
        $dis1[$i] = $nm === 0 ? 0 : ($nm >= $mlim ? 2 : 1);
    }
    $mlim = min(am_bogosqrt($n2), AM_MAX_EQLIMIT);
    for ($i = $dstart; $i <= $dend2; $i++) {
        $nm = $len1[$ha2[$i]] ?? 0;
        $dis2[$i] = $nm === 0 ? 0 : ($nm >= $mlim ? 2 : 1);
    }
    $rindex1 = $rha1 = $rindex2 = $rha2 = [];
    for ($i = $dstart; $i <= $dend1; $i++) {
        if ($dis1[$i] === 1 || ($dis1[$i] === 2 && !am_clean_mmatch($dis1, $i, $dstart, $dend1))) {
            $rindex1[] = $i;
            $rha1[] = $ha1[$i];
        } else {
            $rchg1[$i + 1] = 1;
        }
    }
    for ($i = $dstart; $i <= $dend2; $i++) {
        if ($dis2[$i] === 1 || ($dis2[$i] === 2 && !am_clean_mmatch($dis2, $i, $dstart, $dend2))) {
            $rindex2[] = $i;
            $rha2[] = $ha2[$i];
        } else {
            $rchg2[$i + 1] = 1;
        }
    }

    $nreff1 = count($rha1);
    $nreff2 = count($rha2);
    $ndiags = $nreff1 + $nreff2 + 3;
    $env = [
        'mxcost' => max(am_bogosqrt($ndiags), AM_MAX_COST_MIN),
        'snake_cnt' => AM_SNAKE_CNT,
        'heur_min' => AM_HEUR_MIN_COST,
    ];
    am_recs_cmp($rha1, 0, $nreff1, $rindex1, $rchg1, $rha2, 0, $nreff2, $rindex2, $rchg2, false, $env);

    am_change_compact($rchg1, $ha1, $n1, $rchg2, $n2);
    am_change_compact($rchg2, $ha2, $n2, $rchg1, $n1);

    // xdl_build_script
    $script = [];
    for ($i1 = $n1, $i2 = $n2; $i1 >= 0 || $i2 >= 0; $i1--, $i2--) {
        if (($rchg1[$i1] ?? 0) || ($rchg2[$i2] ?? 0)) { // rchg[i-1] со сдвигом +1
            $l1 = $i1;
            while ($rchg1[$i1] ?? 0) {
                $i1--;
            }
            $l2 = $i2;
            while ($rchg2[$i2] ?? 0) {
                $i2--;
            }
            $script[] = [$i1, $i2, $l1 - $i1, $l2 - $i2];
        }
    }
    return array_reverse($script);
}

// --- слияние (xdl_merge) ---

function am_append_merge(array &$changes, int $mode, int $i0, int $chg0, int $i1, int $chg1, int $i2, int $chg2): void
{
    $n = count($changes);
    if ($n > 0) {
        $m = &$changes[$n - 1];
        if ($i1 <= $m['i1'] + $m['chg1'] || $i2 <= $m['i2'] + $m['chg2']) {
            if ($mode !== $m['mode']) {
                $m['mode'] = 0;
            }
            $m['chg0'] = $i0 + $chg0 - $m['i0'];
            $m['chg1'] = $i1 + $chg1 - $m['i1'];
            $m['chg2'] = $i2 + $chg2 - $m['i2'];
            return;
        }
        unset($m);
    }
    $changes[] = ['mode' => $mode, 'i0' => $i0, 'chg0' => $chg0, 'i1' => $i1, 'chg1' => $chg1, 'i2' => $i2, 'chg2' => $chg2];
}

function am_lines_contain_alnum(array $recs, int $i, int $chg): bool
{
    for (; $chg > 0; $chg--, $i++) {
        if (preg_match('/[A-Za-z0-9]/', $recs[$i])) {
            return true;
        }
    }
    return false;
}

/**
 * Слить три текста. $o — база, $a — ours, $b — theirs (массивы записей am_split).
 * Возвращает ['text' => string, 'conflicts' => int, 'hunks' => [...]].
 */
function am_merge_recs(array $o, array $a, array $b, string $style = AM_STYLE_DIFF3, array $labels = ['ours', 'base', 'theirs'], int $markerSize = 7): array
{
    $x1 = am_xdiff($o, $a);
    $x2 = am_xdiff($o, $b);
    if (!$x1) {
        return ['text' => implode('', $b), 'conflicts' => 0, 'hunks' => []];
    }
    if (!$x2) {
        return ['text' => implode('', $a), 'conflicts' => 0, 'hunks' => []];
    }
    $level = $style === AM_STYLE_DIFF3 ? 1 : 3; // EAGER для diff3, ZEALOUS_ALNUM для merge (по умолчанию в git merge-file)
    $nO = count($o);
    $nA = count($a);
    $nB = count($b);

    $changes = [];
    $p1 = 0;
    $p2 = 0;
    $c1 = count($x1);
    $c2 = count($x2);
    while ($p1 < $c1 && $p2 < $c2) {
        [$s1i1, $s1i2, $s1c1, $s1c2] = $x1[$p1];
        [$s2i1, $s2i2, $s2c1, $s2c2] = $x2[$p2];
        if ($s1i1 + $s1c1 < $s2i1) {
            am_append_merge($changes, 1, $s1i1, $s1c1, $s1i2, $s1c2, $s2i2 - $s2i1 + $s1i1, $s1c1);
            $p1++;
            continue;
        }
        if ($s2i1 + $s2c1 < $s1i1) {
            am_append_merge($changes, 2, $s2i1, $s2c1, $s1i2 - $s1i1 + $s2i1, $s2c1, $s2i2, $s2c2);
            $p2++;
            continue;
        }
        $identical = $s1i1 === $s2i1 && $s1c1 === $s2c1 && $s1c2 === $s2c2
            && array_slice($a, $s1i2, $s1c2) === array_slice($b, $s2i2, $s2c2);
        if ($level === 0 || !$identical) {
            $off = $s1i1 - $s2i1;
            $ffo = $off + $s1c1 - $s2c1;
            $i0 = $s1i1;
            $i1 = $s1i2;
            $i2 = $s2i2;
            if ($off > 0) {
                $i0 -= $off;
                $i1 -= $off;
            } else {
                $i2 += $off;
            }
            $chg0 = $s1i1 + $s1c1 - $i0;
            $chg1 = $s1i2 + $s1c2 - $i1;
            $chg2 = $s2i2 + $s2c2 - $i2;
            if ($ffo < 0) {
                $chg0 -= $ffo;
                $chg1 -= $ffo;
            } else {
                $chg2 += $ffo;
            }
            am_append_merge($changes, 0, $i0, $chg0, $i1, $chg1, $i2, $chg2);
        }
        $e1 = $s1i1 + $s1c1;
        $e2 = $s2i1 + $s2c1;
        if ($e1 >= $e2) {
            $p2++;
        }
        if ($e2 >= $e1) {
            $p1++;
        }
    }
    for (; $p1 < $c1; $p1++) {
        [$s1i1, $s1i2, $s1c1, $s1c2] = $x1[$p1];
        am_append_merge($changes, 1, $s1i1, $s1c1, $s1i2, $s1c2, $s1i1 + $nB - $nO, $s1c1);
    }
    for (; $p2 < $c2; $p2++) {
        [$s2i1, $s2i2, $s2c1, $s2c2] = $x2[$p2];
        am_append_merge($changes, 2, $s2i1, $s2c1, $s2i1 + $nA - $nO, $s2c1, $s2i2, $s2c2);
    }

    if ($level >= 2) {
        // xdl_refine_conflicts
        $refined = [];
        foreach ($changes as $m) {
            if ($m['mode'] !== 0 || $m['chg1'] === 0 || $m['chg2'] === 0) {
                $refined[] = $m;
                continue;
            }
            $t1 = array_slice($a, $m['i1'], $m['chg1']);
            $t2 = array_slice($b, $m['i2'], $m['chg2']);
            $xs = am_xdiff($t1, $t2);
            if (!$xs) {
                $m['mode'] = 4;
                $refined[] = $m;
                continue;
            }
            $bi1 = $m['i1'];
            $bi2 = $m['i2'];
            foreach ($xs as [$xi1, $xi2, $xc1, $xc2]) {
                $refined[] = ['mode' => 0, 'i0' => $m['i0'], 'chg0' => $m['chg0'], 'i1' => $xi1 + $bi1, 'chg1' => $xc1, 'i2' => $xi2 + $bi2, 'chg2' => $xc2];
            }
        }
        $changes = $refined;
        // xdl_simplify_non_conflicts (ZEALOUS_ALNUM)
        $k = 0;
        while ($k < count($changes) - 1) {
            $m = $changes[$k];
            $n = $changes[$k + 1];
            $begin = $m['i1'] + $m['chg1'];
            $end = $n['i1'];
            if ($m['mode'] !== 0 || $n['mode'] !== 0
                || ($end - $begin > 3 && ($level < 3 || am_lines_contain_alnum($a, $begin, $end - $begin)))) {
                $k++;
            } else {
                $changes[$k]['chg1'] = $n['i1'] + $n['chg1'] - $m['i1'];
                $changes[$k]['chg2'] = $n['i2'] + $n['chg2'] - $m['i2'];
                array_splice($changes, $k + 1, 1);
            }
        }
    }

    // xdl_fill_merge_buffer
    $out = '';
    $i = 0;
    $conflicts = 0;
    $hunks = [];
    $line = 0; // номер строки результата (для отчёта)
    $copy = static function (array $recs, int $from, int $cnt, bool $addNl) use (&$out, &$line): void {
        if ($cnt <= 0) {
            return;
        }
        $s = implode('', array_slice($recs, $from, $cnt));
        if ($addNl && substr($s, -1) !== "\n") {
            $s .= "\n";
        }
        $out .= $s;
        $line += $cnt;
    };
    [$l1, $l0, $l2] = $labels;
    $mk = static fn(string $ch, string $label) => str_repeat($ch, $markerSize) . ($label !== '' ? ' ' . $label : '') . "\n";
    foreach ($changes as $m) {
        if ($m['mode'] === 0) {
            $copy($a, $i, $m['i1'] - $i, false);
            $start = $line + 1;
            $out .= $mk('<', $l1);
            $line++;
            $copy($a, $m['i1'], $m['chg1'], true);
            if ($style === AM_STYLE_DIFF3) {
                $out .= $mk('|', $l0);
                $line++;
                $copy($o, $m['i0'], $m['chg0'], true);
            }
            $out .= str_repeat('=', $markerSize) . "\n";
            $line++;
            $copy($b, $m['i2'], $m['chg2'], true);
            $out .= $mk('>', $l2);
            $line++;
            $conflicts++;
            $hunks[] = ['line' => $start, 'end' => $line, 'base_line' => $m['i0'] + 1, 'ours' => $m['chg1'], 'base' => $m['chg0'], 'theirs' => $m['chg2']];
        } elseif ($m['mode'] & 3) {
            $copy($a, $i, $m['i1'] - $i, false);
            if ($m['mode'] & 1) {
                $copy($a, $m['i1'], $m['chg1'], (bool) ($m['mode'] & 2));
            }
            if ($m['mode'] & 2) {
                $copy($b, $m['i2'], $m['chg2'], false);
            }
        } else {
            continue;
        }
        $i = $m['i1'] + $m['chg1'];
    }
    $copy($a, $i, $nA - $i, false);
    return ['text' => $out, 'conflicts' => $conflicts, 'hunks' => $hunks];
}

/** Удобная обёртка над строками. */
function am_merge(string $ours, string $base, string $theirs, string $style = AM_STYLE_DIFF3, array $labels = ['ours', 'base', 'theirs']): array
{
    return am_merge_recs(am_split($base), am_split($ours), am_split($theirs), $style, $labels);
}

/** CRLF → LF. */
function am_to_lf(string $s): string
{
    return str_replace("\r\n", "\n", $s);
}

/** Файл в основном с CRLF? (стиль вендора для записи результата) */
function am_is_crlf(string $s): bool
{
    return substr_count($s, "\r\n") * 2 > substr_count($s, "\n");
}

/** Унифицированный diff (для отчётов). Возвращает текст с контекстом $ctx строк. */
function am_unified(string $from, string $to, string $la = 'a', string $lb = 'b', int $ctx = 3): string
{
    $r1 = am_split($from);
    $r2 = am_split($to);
    $script = am_xdiff($r1, $r2);
    if (!$script) {
        return '';
    }
    $out = "--- $la\n+++ $lb\n";
    // группируем изменения с контекстом
    $groups = [];
    foreach ($script as $ch) {
        if ($groups && $ch[0] - ($groups[count($groups) - 1][count($groups[count($groups) - 1]) - 1][0] + $groups[count($groups) - 1][count($groups[count($groups) - 1]) - 1][2]) <= 2 * $ctx) {
            $groups[count($groups) - 1][] = $ch;
        } else {
            $groups[] = [$ch];
        }
    }
    foreach ($groups as $g) {
        $first = $g[0];
        $last = $g[count($g) - 1];
        $s1 = max(0, $first[0] - $ctx);
        $e1 = min(count($r1), $last[0] + $last[2] + $ctx);
        $s2 = max(0, $first[1] - $ctx);
        $e2 = min(count($r2), $last[1] + $last[3] + $ctx);
        $out .= sprintf("@@ -%d,%d +%d,%d @@\n", $s1 + 1, $e1 - $s1, $s2 + 1, $e2 - $s2);
        $p1 = $s1;
        foreach ($g as [$i1, $i2, $c1, $c2]) {
            for (; $p1 < $i1; $p1++) {
                $out .= ' ' . rtrim($r1[$p1], "\n") . "\n";
            }
            for ($k = 0; $k < $c1; $k++) {
                $out .= '-' . rtrim($r1[$i1 + $k], "\n") . "\n";
            }
            for ($k = 0; $k < $c2; $k++) {
                $out .= '+' . rtrim($r2[$i2 + $k], "\n") . "\n";
            }
            $p1 = $i1 + $c1;
        }
        for (; $p1 < $e1; $p1++) {
            $out .= ' ' . rtrim($r1[$p1], "\n") . "\n";
        }
    }
    return $out;
}
