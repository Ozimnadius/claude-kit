#!/usr/bin/env node
'use strict';
// Защита публичного репозитория от утечек: слова из локального списка .git/info/kit-denylist не должны попасть ни в файлы,
// ни в сообщения коммитов. Список — только на этой машине (папка .git на GitHub не уходит); в репозитории — только проверка.
// Формат списка: по слову в строке, без учёта регистра; «w:слово» — только целым словом; «#» — комментарий.
// «\.» и «\\.» в тексте (регулярные выражения тестов) считаются точкой.
//   node tools/kit-denylist.js install       поставить хуки git pre-commit и commit-msg (чужие не трогает — код 2)
//   node tools/kit-denylist.js tree          все файлы git, в том числе новые не игнорируемые: имена и содержимое
//   node tools/kit-denylist.js staged        имена и добавленные строки индекса (хук pre-commit)
//   node tools/kit-denylist.js msg <файл>    сообщение коммита (хук commit-msg); строки «#» не считаются
// Код 0 — чисто, 1 — найдено, 2 — ошибка. Списка нет — предупреждение, код 0.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARK = '# kit-denylist';
const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => s.replace(/\\+\./g, '.');

function readList(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const word = l.startsWith('w:');
    const t = word ? l.slice(2) : l;
    return { t, re: new RegExp(word ? `(?<![\\p{L}\\p{N}_])${esc(t)}(?![\\p{L}\\p{N}_])` : esc(t), 'iu') };
  });
}

function scanLines(text, where, list, out) {
  norm(text).split(/\r?\n/).forEach((line, i) => {
    for (const r of list) if (r.re.test(line)) out.push(`${where}${i + 1}: «${r.t}»`);
  });
}
function scanPath(rel, list, out) {
  for (const r of list) if (r.re.test(norm(rel))) out.push(`путь ${rel}: «${r.t}»`);
}

function install(top, toolPath) {
  const hooksDir = path.resolve(top, git('rev-parse', '--git-path', 'hooks').trim());
  const rel = path.relative(top, toolPath);
  const tool = (rel.startsWith('..') || path.isAbsolute(rel) ? toolPath : rel).split(path.sep).join('/');
  const hooks = { 'pre-commit': `exec node "${tool}" staged`, 'commit-msg': `exec node "${tool}" msg "$1"` };
  for (const [name, cmd] of Object.entries(hooks)) {
    const f = path.join(hooksDir, name);
    if (fs.existsSync(f) && !fs.readFileSync(f, 'utf8').includes(MARK)) {
      console.error(`[kit-denylist] хук ${name} уже есть и он не наш — допишите в него вызов руками: ${cmd}`);
      return 2;
    }
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const [name, cmd] of Object.entries(hooks)) {
    fs.writeFileSync(path.join(hooksDir, name), `#!/bin/sh\n${MARK}: проверка по .git/info/kit-denylist\n${cmd}\n`, { mode: 0o755 });
  }
  console.log(`[kit-denylist] хуки pre-commit и commit-msg поставлены (${hooksDir}).`);
  return 0;
}

function main(argv) {
  const mode = argv[0];
  const top = git('rev-parse', '--show-toplevel').trim();
  if (mode === 'install') return install(top, __filename);
  const listFile = path.join(git('rev-parse', '--absolute-git-dir').trim(), 'info', 'kit-denylist');
  const list = readList(listFile);
  if (!list) {
    console.error(`[kit-denylist] нет списка ${listFile} — проверка не выполнена.`);
    return 0;
  }
  const hits = [];
  if (mode === 'tree') {
    for (const rel of git('-C', top, 'ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
      scanPath(rel, list, hits);
      const abs = path.join(top, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
      const buf = fs.readFileSync(abs);
      if (!buf.includes(0)) scanLines(buf.toString('utf8'), `${rel}:`, list, hits);
    }
  } else if (mode === 'staged') {
    for (const rel of git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean)) scanPath(rel, list, hits);
    let file = '';
    let ln = 0;
    for (const line of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff').split('\n')) {
      if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
      const h = /^@@ -\S+ \+(\d+)/.exec(line);
      if (h) { ln = Number(h[1]); continue; }
      if (line.startsWith('+')) {
        const one = [];
        scanLines(line.slice(1), '', list, one);
        for (const x of one) hits.push(`${file}:${ln}: ${x.replace(/^1: /, '')}`);
        ln++;
      }
    }
  } else if (mode === 'msg' && argv[1]) {
    const text = fs.readFileSync(argv[1], 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
    scanLines(text, 'сообщение коммита, строка ', list, hits);
  } else {
    console.error('Использование: node tools/kit-denylist.js install | tree | staged | msg <файл>');
    return 2;
  }
  if (!hits.length) return 0;
  console.error(`[kit-denylist] репозиторий публичный — найдены слова из локального списка (${hits.length}):\n  ${hits.slice(0, 40).join('\n  ')}`
    + (hits.length > 40 ? `\n  … и ещё ${hits.length - 40}` : '') + '\nОбезличьте их и повторите.');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
