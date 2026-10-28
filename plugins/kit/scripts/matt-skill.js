#!/usr/bin/env node
'use strict';
// Путь к навыку плагина mattpocock-skills, поставленного на проект (система Мэтта, /kit:matt и другие навыки kit).
//   node matt-skill.js <имя>     из корня проекта; печатает абсолютный путь к SKILL.md, код 0
//                                плагин не на проекте — код 2; навыка нет — код 3 и список имён; без имени — код 4
//   node matt-skill.js --status  одна строка: «установлен <версия>, включён|выключен» или «не установлен»; код 0
// Всё — в стандартный вывод: Claude читает его из Bash.
const { mattPlugin, mattSkillFile, mattSkillNames } = require('./lib/matt');

// → { code, out }; deps — подмена зависимостей в тестах (исключение внутри).
function main(args, deps = {}) {
  const find = deps.mattPlugin || mattPlugin;
  try {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const plugin = find(projectDir);
    if (args[0] === '--status') {
      return { code: 0, out: plugin.installed ? `установлен ${plugin.version}, ${plugin.enabled ? 'включён' : 'выключен'}` : 'не установлен' };
    }
    const name = args[0];
    if (!name) return { code: 4, out: 'Не указано имя навыка: node matt-skill.js <имя> | --status' };
    if (!plugin.installed) return { code: 2, out: 'плагин mattpocock-skills на этот проект не поставлен — /kit:project-init' };
    const file = mattSkillFile(plugin.installPath, name);
    if (!file) return { code: 3, out: `Навыка «${name}» в плагине нет. Есть: ${mattSkillNames(plugin.installPath).join(', ') || '—'}` };
    return { code: 0, out: file };
  } catch (e) {
    // --status всегда код 0: при сбое плагин считается не установленным.
    if (args[0] === '--status') return { code: 0, out: 'не установлен' };
    return { code: 2, out: 'Не удалось определить плагин mattpocock-skills: ' + e.message };
  }
}

if (require.main === module) {
  const r = main(process.argv.slice(2));
  console.log(r.out);
  process.exitCode = r.code;
}
module.exports = { main };
