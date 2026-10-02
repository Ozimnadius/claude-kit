'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject, writeFiles, runScript, git, gitRepo } = require('./helpers');
const { SOURCES } = require('../plugins/kit/scripts/bitrix-skills');

// Вместо GitHub — локальные репозитории той же формы (в сети тесты не ходят).
const framework = () => gitRepo({
  'README.md': '# Bitrix Framework Skills',
  'skills/bitrix-framework/SKILL.md': '---\nname: bitrix-framework\n---\nКаноны',
  'skills/bitrix-orm/SKILL.md': '---\nname: bitrix-orm\n---\nORM',
  'skills/bitrix-orm/rules/reading.md': 'Чтение',
  'skills/bitrix24-crm/SKILL.md': '---\nname: bitrix24-crm\n---\nCRM портала',
  'skills/notes.md': 'не скилл — файл, а не папка',
  'tools/verify-skills.php': '<?php',
});
const practice = () => gitRepo({
  'skills/bitrix-best-practice-core/SKILL.md': '---\nname: bitrix-best-practice-core\n---\nCore',
  'skills/drafts/readme.md': 'папка без SKILL.md — не скилл',
  '.ai/skills/add-rule-to-best-practice/SKILL.md': 'для авторов репозитория',
});
const run = (dir, urls) => runScript('bitrix-skills.js', { cwd: dir, env: { KIT_BITRIX_SKILLS_URLS: urls.join(',') } });
const skillsOf = (dir) => fs.readdirSync(path.join(dir, '.claude', 'skills')).sort();
const short = (repo) => git(repo, 'rev-parse', '--short', 'HEAD').trim();

test('SOURCES: два репозитория GitHub; из bitrix-framework-skills не ставятся скиллы Битрикс24', () => {
  assert.deepEqual(SOURCES.map((s) => s.repo), ['bxmaximum/bitrix-framework-skills', 'bitrix-tools/best-practice']);
  assert.deepEqual(SOURCES.map((s) => s.url), ['https://github.com/bxmaximum/bitrix-framework-skills.git', 'https://github.com/bitrix-tools/best-practice.git']);
  assert.equal(SOURCES[0].skip.test('bitrix24-crm'), true);
  assert.equal(SOURCES[0].skip.test('bitrix-orm'), false);
  assert.equal(SOURCES[1].skip, undefined);
});

test('ставит skills/<имя> с SKILL.md в .claude/skills — без bitrix24-*, без .ai/skills и прочего; называет коммиты', () => {
  const a = framework();
  const b = practice();
  const dir = makeProject({ '.claude/CLAUDE.md': '# правила' });
  const r = run(dir, [a, b]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.deepEqual(skillsOf(dir), ['bitrix-best-practice-core', 'bitrix-framework', 'bitrix-orm']);
  assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/bitrix-orm/rules/reading.md'), 'utf8'), 'Чтение');
  assert.equal(r.stdout, `Скиллы Битрикса → .claude/skills: bxmaximum/bitrix-framework-skills@${short(a)} — 2 (без bitrix24-*), `
    + `bitrix-tools/best-practice@${short(b)} — 1. Если Claude их не видит — перезапустить сессию.\n`);
});

test('повторный запуск — обновление: папки скиллов заменяются целиком, чужие скиллы проекта не трогаются', () => {
  const a = framework();
  const b = practice();
  const dir = makeProject({ '.claude/skills/my-skill/SKILL.md': 'свой скилл проекта' });
  assert.equal(run(dir, [a, b]).code, 0);
  writeFiles(dir, { '.claude/skills/bitrix-orm/rules/old.md': 'устаревшее правило' });
  writeFiles(a, { 'skills/bitrix-orm/SKILL.md': '---\nname: bitrix-orm\n---\nORM, новая версия' });
  git(a, 'commit', '-q', '-am', 'обновление');
  const r = run(dir, [a, b]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, new RegExp(`bitrix-framework-skills@${short(a)} — 2`));
  assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/bitrix-orm/SKILL.md'), 'utf8'), '---\nname: bitrix-orm\n---\nORM, новая версия');
  assert.equal(fs.existsSync(path.join(dir, '.claude/skills/bitrix-orm/rules/old.md')), false, 'папка заменена целиком');
  assert.equal(fs.readFileSync(path.join(dir, '.claude/skills/my-skill/SKILL.md'), 'utf8'), 'свой скилл проекта');
});

test('репозиторий не скачался — второй всё равно ставится, код 2 и причина', () => {
  const b = practice();
  const dir = makeProject({});
  const missing = path.join(makeProject({}), 'нет-такого');
  const r = run(dir, [missing, b]);
  assert.equal(r.code, 2);
  assert.deepEqual(skillsOf(dir), ['bitrix-best-practice-core']);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^Скиллы Битрикса → \.claude\/skills: bitrix-tools\/best-practice@[0-9a-f]+ — 1\./);
  assert.match(lines[1], /^bxmaximum\/bitrix-framework-skills: не скачался \(.+\) — скиллы из него не поставлены; повторите позже\.$/);
});
