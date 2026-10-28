'use strict';
// Система Мэтта (kit 3.3): признак проекта, установленный на проект плагин mattpocock-skills, путь к его навыкам.
// Хуки и навыки kit опираются на эти функции; любое чтение файла — в try/catch: нет файла или битый JSON — как пустой.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MATT_PLUGIN = 'mattpocock-skills@claude-plugins-official';
const SUPERPOWERS_PLUGIN = 'superpowers@claude-plugins-official';
// Версия плагина, на которой проверены правила kit.
const MATT_VERIFIED = '1.3.1';

// Параметр «Система Мэтта: да» (регистр и пробелы по краям не важны).
function isMattProject(params) {
  return /^да$/i.test(String(params.get('Система Мэтта', '')).trim());
}

// Основная папка проекта: из git worktree приложения (<проект>/.claude/worktrees/<имя>) — папка выше .claude/worktrees.
function projectRoot(dir) {
  return String(dir || '').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/i, '');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Путь для сравнения: абсолютный, косые вперёд, без хвостовой косой, без регистра (Windows).
const normPath = (p) => path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Записи плагина из installed_plugins.json (json.plugins || json); значение — массив или один объект.
function pluginRecords(file) {
  const json = readJson(file);
  if (!json || typeof json !== 'object') return [];
  const all = json.plugins || json;
  const v = all && typeof all === 'object' ? all[MATT_PLUGIN] : null;
  return (Array.isArray(v) ? v : [v]).filter((r) => r && typeof r === 'object');
}

// Явное true/false в enabledPlugins[MATT_PLUGIN] — первое по порядку файлов; явного нет — включён.
function pluginEnabled(files) {
  for (const f of files) {
    const json = readJson(f);
    const v = json && json.enabledPlugins && typeof json.enabledPlugins === 'object' ? json.enabledPlugins[MATT_PLUGIN] : undefined;
    if (v === true || v === false) return v;
  }
  return true;
}

// → { installed, enabled, version, installPath }. Запись с scope user годится любому проекту; project и local — своему
// (projectPath совпадает с основной папкой проекта).
function mattPlugin(projectDir) {
  const root = projectRoot(projectDir);
  const home = os.homedir();
  const pluginsFile = process.env.KIT_PLUGINS_FILE || path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const userSettings = process.env.KIT_USER_SETTINGS || path.join(home, '.claude', 'settings.json');
  const want = root ? normPath(root) : '';
  const hit = pluginRecords(pluginsFile).find((r) => {
    if (r.scope === 'user') return true;
    if ((r.scope === 'project' || r.scope === 'local') && r.projectPath && want) return normPath(r.projectPath) === want;
    return false;
  });
  const enabled = pluginEnabled([
    path.join(root, '.claude', 'settings.local.json'),
    path.join(root, '.claude', 'settings.json'),
    userSettings,
  ]);
  if (!hit) return { installed: false, enabled, version: '', installPath: '' };
  return { installed: true, enabled, version: String(hit.version || ''), installPath: String(hit.installPath || '') };
}

// Папки навыков из .claude-plugin/plugin.json плагина: { name: путь к папке навыка }.
function skillDirs(installPath) {
  // Без прототипа: имя навыка constructor, toString или __proto__ не должно находить унаследованное свойство.
  const out = Object.create(null);
  if (!installPath) return out;
  const json = readJson(path.join(installPath, '.claude-plugin', 'plugin.json'));
  const list = json && Array.isArray(json.skills) ? json.skills : [];
  for (const s of list) {
    const p = String(s).replace(/[\\/]+$/, '');
    const name = p.split(/[\\/]/).pop();
    if (name) out[name] = path.join(installPath, p);
  }
  return out;
}

// Имена навыков плагина (для сообщения «навыка нет»).
function mattSkillNames(installPath) {
  return Object.keys(skillDirs(installPath));
}

// SKILL.md навыка по имени (последняя часть пути из skills); нет навыка или файла — null.
function mattSkillFile(installPath, name) {
  const dir = skillDirs(installPath)[name];
  if (!dir) return null;
  const file = path.join(dir, 'SKILL.md');
  return fs.existsSync(file) ? file : null;
}

// Есть большая работа в разработке: хоть одна папка <docs>/work/*/issues/.
function bigWorkActive(projectDir, docsRel) {
  try {
    const work = path.join(projectDir, docsRel, 'work');
    return fs.readdirSync(work, { withFileTypes: true }).some((e) => {
      if (!e.isDirectory()) return false;
      try {
        return fs.statSync(path.join(work, e.name, 'issues')).isDirectory();
      } catch (err) {
        return false;
      }
    });
  } catch (e) {
    return false;
  }
}

module.exports = {
  MATT_PLUGIN, SUPERPOWERS_PLUGIN, MATT_VERIFIED,
  isMattProject, projectRoot, mattPlugin, mattSkillNames, mattSkillFile, bigWorkActive,
};
