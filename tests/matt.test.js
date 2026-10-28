'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeProject, tmpDir, runScript } = require('./helpers');
const { paramsMd } = require('./fixtures');
const { kitInfo } = require('../plugins/kit/scripts/lib/project');
const { main } = require('../plugins/kit/scripts/matt-skill');
const {
  MATT_PLUGIN, SUPERPOWERS_PLUGIN, MATT_VERIFIED, isMattProject, projectRoot, mattPlugin, mattSkillFile, bigWorkActive,
} = require('../plugins/kit/scripts/lib/matt');

// Настройки пользователя тесты не читают: файл, которого нет.
const NO_SETTINGS = path.join(tmpDir('kit-matt-nosettings-'), 'нет.json');
process.env.KIT_USER_SETTINGS = NO_SETTINGS;

const paramsOf = (v) => kitInfo(makeProject({ '.claude/CLAUDE.md': paramsMd(v) })).params;
const json = (v) => JSON.stringify(v);

// Подставной плагин: .claude-plugin/plugin.json с двумя навыками и их SKILL.md.
function fakePlugin() {
  return makeProject({
    '.claude-plugin/plugin.json': json({ name: 'mattpocock-skills', skills: ['./skills/engineering/implement', './skills/productivity/grilling'] }),
    'skills/engineering/implement/SKILL.md': '---\nname: implement\n---\nРеализация',
    'skills/productivity/grilling/SKILL.md': '---\nname: grilling\n---\nДопрос',
  });
}

// Файл installed_plugins.json во временной папке; записи — как в Claude Code: { version, plugins: { id: [записи] } }.
function pluginsFile(entries, wrap = true) {
  const dir = tmpDir('kit-matt-plugins-');
  const file = path.join(dir, 'installed_plugins.json');
  const body = { [MATT_PLUGIN]: entries };
  fs.writeFileSync(file, json(wrap ? { version: 2, plugins: body } : body));
  return file;
}

// Выполнить f с подменой переменных окружения; после — вернуть как было.
function withEnv(env, f) {
  const old = {};
  for (const k of Object.keys(env)) old[k] = process.env[k];
  Object.assign(process.env, env);
  try { return f(); } finally {
    for (const k of Object.keys(env)) {
      if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
    }
  }
}

const rec = (over) => ({ scope: 'project', installPath: '/x', version: '1.3.1', ...over });

test('константы: плагины и проверенная версия', () => {
  assert.equal(MATT_PLUGIN, 'mattpocock-skills@claude-plugins-official');
  assert.equal(SUPERPOWERS_PLUGIN, 'superpowers@claude-plugins-official');
  assert.equal(MATT_VERIFIED, '1.3.1');
});

test('isMattProject: « Да » — да; «нет» и нет строки — нет', () => {
  assert.equal(isMattProject(paramsOf({ 'Система Мэтта': ' Да ' })), true);
  assert.equal(isMattProject(paramsOf({ 'Система Мэтта': 'нет' })), false);
  assert.equal(isMattProject(paramsOf({ 'Режим': 'общий' })), false);
});

test('projectRoot: отрезает хвост .claude/worktrees/<имя> (обе косые), остальное не трогает', () => {
  assert.equal(projectRoot('C:\\p\\alpha\\.claude\\worktrees\\wt-1'), 'C:\\p\\alpha');
  assert.equal(projectRoot('C:/p/alpha/.claude/worktrees/wt-1/sub'), 'C:/p/alpha');
  assert.equal(projectRoot('C:/p/alpha'), 'C:/p/alpha');
});

test('mattPlugin: запись на проект с другим регистром и слешами — установлен, включён, версия 1.3.1', () => {
  const dir = makeProject({});
  const other = dir.replace(/\//g, '\\').toUpperCase();
  const file = pluginsFile([rec({ projectPath: other, installPath: 'C:\\plug' })]);
  const r = withEnv({ KIT_PLUGINS_FILE: file }, () => mattPlugin(dir.replace(/\\/g, '/').toLowerCase()));
  assert.deepEqual(r, { installed: true, enabled: true, version: '1.3.1', installPath: 'C:\\plug' });
});

test('mattPlugin: запись на другой проект — не установлен; scope user — установлен; local — как project', () => {
  const dir = makeProject({});
  const elsewhere = makeProject({});
  const f1 = pluginsFile([rec({ projectPath: elsewhere })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f1 }, () => mattPlugin(dir)).installed, false);
  const f2 = pluginsFile([rec({ scope: 'user', projectPath: undefined })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f2 }, () => mattPlugin(dir)).installed, true);
  const f3 = pluginsFile([rec({ scope: 'local', projectPath: dir })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f3 }, () => mattPlugin(dir)).installed, true);
  // значение — один объект, а не массив; формат без обёртки plugins
  const f4 = pluginsFile(rec({ projectPath: dir }), false);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f4 }, () => mattPlugin(dir)).installed, true);
});

test('mattPlugin: false в .claude/settings.json — выключен; true в settings.local.json сильнее', () => {
  const settings = (v) => json({ enabledPlugins: { [MATT_PLUGIN]: v } });
  const dir = makeProject({ '.claude/settings.json': settings(false) });
  const file = pluginsFile([rec({ projectPath: dir })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: file }, () => mattPlugin(dir)).enabled, false);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), settings(true));
  assert.equal(withEnv({ KIT_PLUGINS_FILE: file }, () => mattPlugin(dir)).enabled, true);
  // настройки пользователя — последние по приоритету
  const user = path.join(tmpDir('kit-matt-user-'), 'settings.json');
  fs.writeFileSync(user, settings(false));
  const bare = makeProject({});
  const f2 = pluginsFile([rec({ projectPath: bare })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f2, KIT_USER_SETTINGS: user }, () => mattPlugin(bare)).enabled, false);
  // явного значения нигде нет — включён
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f2 }, () => mattPlugin(bare)).enabled, true);
});

test('mattPlugin: нет файла, битый JSON, формат без ключа plugins — не установлен, без исключения', () => {
  const dir = makeProject({});
  const none = { installed: false, enabled: true, version: '', installPath: '' };
  const missing = path.join(tmpDir('kit-matt-missing-'), 'нет.json');
  assert.deepEqual(withEnv({ KIT_PLUGINS_FILE: missing }, () => mattPlugin(dir)), none);
  const broken = path.join(tmpDir('kit-matt-broken-'), 'installed_plugins.json');
  fs.writeFileSync(broken, '{ не json');
  assert.deepEqual(withEnv({ KIT_PLUGINS_FILE: broken }, () => mattPlugin(dir)), none);
  const noKey = path.join(tmpDir('kit-matt-nokey-'), 'installed_plugins.json');
  fs.writeFileSync(noKey, json({ version: 2 }));
  assert.deepEqual(withEnv({ KIT_PLUGINS_FILE: noKey }, () => mattPlugin(dir)), none);
  fs.writeFileSync(noKey, 'null');
  assert.deepEqual(withEnv({ KIT_PLUGINS_FILE: noKey }, () => mattPlugin(dir)), none);
  // битые настройки проекта — как пустые: включён
  const bad = makeProject({ '.claude/settings.json': '{ битый' });
  const f = pluginsFile([rec({ projectPath: bad })]);
  assert.equal(withEnv({ KIT_PLUGINS_FILE: f }, () => mattPlugin(bad)).enabled, true);
});

test('mattPlugin: папка <проект>/.claude/worktrees/<имя> — ищет по основной папке', () => {
  const dir = makeProject({ '.claude/settings.json': json({ enabledPlugins: { [MATT_PLUGIN]: false } }) });
  const wt = path.join(dir, '.claude', 'worktrees', 'wt-1');
  fs.mkdirSync(wt, { recursive: true });
  const file = pluginsFile([rec({ projectPath: dir })]);
  const r = withEnv({ KIT_PLUGINS_FILE: file }, () => mattPlugin(wt));
  assert.equal(r.installed, true);
  assert.equal(r.enabled, false, 'настройки читаются тоже из основной папки');
});

test('mattSkillFile: implement и grilling находятся, нет навыка — null', () => {
  const plug = fakePlugin();
  assert.equal(mattSkillFile(plug, 'implement'), path.join(plug, 'skills', 'engineering', 'implement', 'SKILL.md'));
  assert.equal(mattSkillFile(plug, 'grilling'), path.join(plug, 'skills', 'productivity', 'grilling', 'SKILL.md'));
  assert.equal(mattSkillFile(plug, 'zoom-out'), null);
  for (const n of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.equal(mattSkillFile(plug, n), null, n);
  assert.equal(mattSkillFile(path.join(plug, 'нет'), 'implement'), null);
  assert.equal(mattSkillFile('', 'implement'), null);
  // навык есть в plugin.json, а SKILL.md нет
  fs.rmSync(path.join(plug, 'skills', 'productivity', 'grilling', 'SKILL.md'));
  assert.equal(mattSkillFile(plug, 'grilling'), null);
});

test('bigWorkActive: <docs>/work/x/issues/ — да; только <docs>/archive/x/issues/ — нет', () => {
  const yes = makeProject({ '.claude/docs/work/x/issues/01-a.md': 'з' });
  assert.equal(bigWorkActive(yes, '.claude/docs'), true);
  const no = makeProject({ '.claude/docs/archive/x/issues/01-a.md': 'з', '.claude/docs/work/y/spec.md': 'с' });
  assert.equal(bigWorkActive(no, '.claude/docs'), false);
  assert.equal(bigWorkActive(makeProject({}), '.claude/docs'), false);
});

test('matt-skill.js: путь к implement/SKILL.md; --status; коды 2, 3, 4', () => {
  const plug = fakePlugin();
  const dir = makeProject({});
  const file = pluginsFile([rec({ projectPath: dir, installPath: plug })]);
  const env = { KIT_PLUGINS_FILE: file, KIT_USER_SETTINGS: NO_SETTINGS };
  const run = (...args) => runScript('matt-skill.js', { args, cwd: dir, env });

  const ok = run('implement');
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(ok.stdout.trim(), path.join(plug, 'skills', 'engineering', 'implement', 'SKILL.md'));

  const st = run('--status');
  assert.equal(st.code, 0);
  assert.equal(st.stdout.trim(), 'установлен 1.3.1, включён');

  const missing = run('zoom-out');
  assert.equal(missing.code, 3);
  assert.match(missing.stdout, /implement/);
  assert.match(missing.stdout, /grilling/);

  // имена из прототипа Object — не навыки: код 3, а не сбой
  const proto = run('constructor');
  assert.equal(proto.code, 3, proto.stdout);
  assert.match(proto.stdout, /implement/);

  assert.equal(run().code, 4);

  // выключен — статус «выключен»
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), json({ enabledPlugins: { [MATT_PLUGIN]: false } }));
  assert.equal(run('--status').stdout.trim(), 'установлен 1.3.1, выключен');

  // плагин на другом проекте
  const other = makeProject({});
  const env2 = { KIT_PLUGINS_FILE: pluginsFile([rec({ projectPath: other, installPath: plug })]), KIT_USER_SETTINGS: NO_SETTINGS };
  const no = runScript('matt-skill.js', { args: ['implement'], cwd: dir, env: env2 });
  assert.equal(no.code, 2);
  assert.equal(no.stdout.trim(), 'плагин mattpocock-skills на этот проект не поставлен — /kit:project-init');
  const st2 = runScript('matt-skill.js', { args: ['--status'], cwd: dir, env: env2 });
  assert.equal(st2.code, 0);
  assert.equal(st2.stdout.trim(), 'не установлен');
});

test('matt-skill.js main: исключение при --status — «не установлен», код 0; для имени навыка — код 2', () => {
  const boom = () => { throw new Error('сбой'); };
  assert.deepEqual(main(['--status'], { mattPlugin: boom }), { code: 0, out: 'не установлен' });
  const r = main(['implement'], { mattPlugin: boom });
  assert.equal(r.code, 2);
  assert.match(r.out, /сбой/);
});
