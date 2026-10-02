'use strict';
// Защита выкладки: снимки из-под админа не должны уехать на сервер (nginx отдаёт картинки мимо .htaccess) и в git.
const fs = require('fs');
const path = require('path');
const { VisualError } = require('./args');
const { parseRules, matchRules } = require('../paths');
const { readDeployment, isExcluded } = require('../deployment');

const EXCLUDE_JS = path.resolve(__dirname, '..', '..', 'phpstorm-exclude.js');
const GITIGNORE = '# Снимки /kit:visual — только локально: в git и на сервер не кладём (снимки из-под админа)\n*\n!.gitignore\n';

// Код 4, если PhpStorm заливает каждое сохранение, а папка снимков (visualRel — от корня проекта) не исключена
// ни сама, ни через предка (.claude, папка документов); иначе — список предупреждений.
function checkDeploy(root, params, visualRel) {
  const warnings = [];
  const file = path.join(root, '.idea', 'deployment.xml');
  if (fs.existsSync(file)) {
    const d = readDeployment(fs.readFileSync(file, 'utf8'));
    // Сервер по умолчанию сопоставлен с подпапкой (dist) — папку снимков он не заливает.
    const def = d.servers.find((s) => s.name === d.server);
    if (d.always && !(def && !def.root) && !isExcluded(d.excluded, visualRel)) {
      const srv = d.server ? `«${d.server}»` : 'по умолчанию';
      throw new VisualError(4, `PhpStorm заливает каждое сохранение на сервер ${srv} (Always), а ${visualRel} не исключён: `
        + 'снимки из-под админа уехали бы на сервер (nginx отдаёт картинки мимо .htaccess).\n'
        + `Запустите node "${EXCLUDE_JS}" из корня проекта или добавьте в Settings → Build, Execution, Deployment → Deployment → сервер ${srv} → Excluded Paths локальный путь .claude (или ${visualRel}) и повторите.`);
    }
  }
  if (params && params.found && !matchRules(visualRel + '/x.png', parseRules(params.list('Не выкладывать')))) {
    warnings.push(`в «Не выкладывать» (.claude/CLAUDE.md) нет ${visualRel} — при ручной выкладке снимки не выкладывать; допишите .claude (или ${visualRel}) в параметр`);
  }
  return warnings;
}

// <папка снимков>/.gitignore — снимки не попадают в git, даже если в .gitignore проекта строки нет.
function ensureGitignore(visualDir) {
  const f = path.join(visualDir, '.gitignore');
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(visualDir, { recursive: true });
  fs.writeFileSync(f, GITIGNORE);
  return true;
}

module.exports = { GITIGNORE, readDeployment, checkDeploy, ensureGitignore };
