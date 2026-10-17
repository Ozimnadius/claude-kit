<?php
/**
 * Результат команды: текст для человека и Claude (по-русски) + данные для --json + код выхода
 * (0 — всё хорошо или нечего делать, 2 — нужен разбор, 1 — ошибка).
 */

declare(strict_types=1);

namespace AsproMerge;

final class Result
{
    public const OK = 0;
    public const ERROR = 1;
    public const ATTENTION = 2;

    public int $code = self::OK;
    public array $lines = [];
    public array $warnings = [];
    public array $problems = [];
    public array $data = [];
    public array $next = [];

    public function __construct(public string $title = '')
    {
    }

    public function line(string $s = ''): self
    {
        $this->lines[] = $s;
        return $this;
    }

    public function warn(string $s): self
    {
        $this->warnings[] = $s;
        return $this;
    }

    public function problem(string $s): self
    {
        $this->problems[] = $s;
        $this->attention();
        return $this;
    }

    public function attention(): self
    {
        if ($this->code === self::OK) {
            $this->code = self::ATTENTION;
        }
        return $this;
    }

    public function error(string $s): self
    {
        $this->problems[] = $s;
        $this->code = self::ERROR;
        return $this;
    }

    public function next(string $s): self
    {
        $this->next[] = $s;
        return $this;
    }

    public function merge(Result $r): self
    {
        array_push($this->lines, ...$r->lines);
        array_push($this->warnings, ...$r->warnings);
        array_push($this->problems, ...$r->problems);
        $this->code = ($this->code === self::ERROR || $r->code === self::ERROR) ? self::ERROR : max($this->code, $r->code);
        return $this;
    }

    public function text(): string
    {
        $o = [];
        if ($this->title !== '') {
            $o[] = $this->title;
        }
        foreach ($this->lines as $l) {
            $o[] = $l;
        }
        foreach (array_unique($this->warnings) as $w) {
            $o[] = 'ВНИМАНИЕ: ' . $w;
        }
        foreach (array_unique($this->problems) as $p) {
            $o[] = ($this->code === self::ERROR ? 'ОШИБКА: ' : 'ПРОБЛЕМА: ') . $p;
        }
        foreach ($this->next as $i => $n) {
            $o[] = ($i === 0 ? 'Дальше: ' : '        ') . $n;
        }
        return implode("\n", $o) . "\n";
    }

    public function toArray(): array
    {
        return ['code' => $this->code, 'title' => $this->title, 'lines' => $this->lines, 'warnings' => array_values(array_unique($this->warnings)),
            'problems' => array_values(array_unique($this->problems)), 'next' => $this->next, 'data' => $this->data];
    }

    /** Таблица для текстового вывода */
    public static function table(array $rows, array $head): array
    {
        $w = array_map('mb_strlen', $head);
        foreach ($rows as $r) {
            foreach (array_values($r) as $i => $c) {
                $w[$i] = max($w[$i] ?? 0, mb_strlen((string)$c));
            }
        }
        $line = static function (array $r) use ($w): string {
            $o = [];
            foreach (array_values($r) as $i => $c) {
                $c = (string)$c;
                $o[] = $c . str_repeat(' ', max(0, $w[$i] - mb_strlen($c)));
            }
            return rtrim(implode('  ', $o));
        };
        $out = ['  ' . $line($head), '  ' . $line(array_map(static fn($x) => str_repeat('-', $x), $w))];
        foreach ($rows as $r) {
            $out[] = '  ' . $line($r);
        }
        return $out;
    }
}
