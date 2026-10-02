#!/usr/bin/env node
'use strict';
// Скиллы Битрикса в проект (/kit:project-init, режим bitrix): skills/<имя>/ с SKILL.md из двух открытых репозиториев GitHub
// → .claude/skills/<имя>/. Из bitrix-framework-skills — без bitrix24-* (портал Битрикс24, не сайты). Папка скилла с тем же
// именем заменяется целиком — повторный запуск обновляет скиллы до последних версий; другие скиллы проекта не трогаются.
// В git проекта скиллы не кладутся (.gitignore kit не берёт /.claude/*), на сервер не уезжают (исключение .claude).
//   node bitrix-skills.js                 из корня проекта; код 0 — всё поставлено, 2 — какой-то репозиторий не скачался
// KIT_BITRIX_SKILLS_URLS=a,b — свои адреса вместо GitHub (тесты; по порядку SOURCES).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCES = [
  { repo: 'bxmaximum/bitrix-framework-skills', url: 'https://github.com/bxmaximum/bitrix-framework-skills.git', skip: /^bitrix24-/, note: ' (без bitrix24-*)' },
  { repo: 'bitrix-tools/best-practice', url: 'https://github.com/bitrix-tools/best-practice.git' },
];
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Без окон и вопросов входа: репозитории открытые, спросить пароль — значит, адрес неверный.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', env: GIT_ENV, timeout: 120000, windowsHide: true });
  if (r.error || r.status !== 0) {
    const last = String(r.stderr || '').trim().split(/\r?\n/).pop();
    throw new Error(r.error ? (r.error.code === 'ETIMEDOUT' ? 'вышло время' : r.error.message) : last || `git: код ${r.status}`);
  }
  return r.stdout.trim();
}

// Один репозиторий → { commit, names }; ошибка скачивания — исключение с причиной.
function installFrom(source, url, target) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-skills-'));
  try {
    const dir = path.join(tmp, 'repo');
    // core.autocrlf=false — файлы как в репозитории (LF), без CRLF от глобальной настройки Windows.
    git(['-c', 'core.autocrlf=false', 'clone', '-q', '--depth', '1', url, dir]);
    const commit = git(['-C', dir, 'rev-parse', '--short', 'HEAD']);
    const skills = path.join(dir, 'skills');
    const names = (fs.existsSync(skills) ? fs.readdirSync(skills) : [])
      .filter((n) => NAME.test(n) && !(source.skip && source.skip.test(n)) && fs.existsSync(path.join(skills, n, 'SKILL.md')))
      .sort();
    for (const n of names) {
      const dest = path.join(target, n);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(skills, n), dest, { recursive: true });
    }
    return { commit, names };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      // временная папка осталась — не важнее результата
    }
  }
}

// → { code, lines }
function install(projectDir, urls = []) {
  const target = path.join(projectDir, '.claude', 'skills');
  fs.mkdirSync(target, { recursive: true });
  const done = [];
  const failed = [];
  SOURCES.forEach((s, i) => {
    try {
      const r = installFrom(s, urls[i] || s.url, target);
      done.push(`${s.repo}@${r.commit} — ${r.names.length}${s.note || ''}`);
    } catch (e) {
      failed.push(`${s.repo}: не скачался (${e.message}) — скиллы из него не поставлены; повторите позже.`);
    }
  });
  const lines = done.length ? [`Скиллы Битрикса → .claude/skills: ${done.join(', ')}. Если Claude их не видит — перезапустить сессию.`] : [];
  return { code: failed.length ? 2 : 0, lines: [...lines, ...failed] };
}

if (require.main === module) {
  const urls = (process.env.KIT_BITRIX_SKILLS_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = install(process.cwd(), urls);
  console.log(r.lines.join('\n'));
  process.exitCode = r.code;
}
module.exports = { SOURCES, install };
