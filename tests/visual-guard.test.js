'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeProject, writeFiles, git } = require('./helpers');
const { makeParams } = require('../plugins/kit/scripts/lib/params');
const { GITIGNORE, checkDeploy, ensureGitignore } = require('../plugins/kit/scripts/lib/visual/guard');

// Как .idea/deployment.xml beta: автозаливка на «ftp», исключения локальные и удалённые.
function deployment({ always = true, server = 'ftp', excluded = ['.idea', '.git', '.claude/scripts', 'docs/visual'], other = [] } = {}) {
  const ex = (list) => list.map((p) => `            <excludedPath local="true" path="$PROJECT_DIR$/${p}" />`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" ${always ? 'autoUpload="Always" ' : ''}serverName="${server}" autoUploadExternalChanges="true">
    <serverData>
      <paths name="${server}">
        <serverdata>
          <mappings><mapping deploy="/" local="$PROJECT_DIR$" web="/" /></mappings>
          <excludedPaths>
            <excludedPath path="/bitrix" />
${ex(excluded)}
          </excludedPaths>
        </serverdata>
      </paths>
      <paths name="dev">
        <serverdata>
          <excludedPaths>
${ex(other)}
          </excludedPaths>
        </serverdata>
      </paths>
    </serverData>
${always ? '    <option name="myAutoUpload" value="ALWAYS" />\n' : ''}  </component>
</project>
`;
}
const project = (xml) => makeProject(xml === undefined ? {} : { '.idea/deployment.xml': xml });
const NO_WARN = makeParams({ 'не выкладывать': '.idea, .git, .claude, docs' });

const VIS = '.claude/docs/visual';

test('checkDeploy: Always, а папка снимков не исключена ни сама, ни через предка — код 4 с путём и подсказкой', () => {
  const dir = project(deployment({ excluded: ['.idea', '.git', '.claude/scripts', 'docs/visual'], other: ['.claude'] }));
  assert.throws(() => checkDeploy(dir, NO_WARN, VIS), (e) => e.code === 4 && /«ftp»/.test(e.message) && /Excluded Paths/.test(e.message)
    && e.message.includes('.claude/docs/visual не исключён') && e.message.includes('phpstorm-exclude.js'));
});

test('checkDeploy: исключены .claude, .claude/docs или сама папка; старая раскладка — docs; On explicit save; нет .idea — можно', () => {
  for (const excluded of [['.claude'], ['.claude/docs'], ['.claude/docs/visual']]) {
    assert.deepEqual(checkDeploy(project(deployment({ excluded })), NO_WARN, VIS), [], excluded[0]);
  }
  assert.deepEqual(checkDeploy(project(deployment({ excluded: ['docs'] })), NO_WARN, 'docs/visual'), []);
  assert.deepEqual(checkDeploy(project(deployment({ always: false, excluded: [] })), NO_WARN, VIS), []);
  assert.deepEqual(checkDeploy(project(), NO_WARN, VIS), []);
  assert.throws(() => checkDeploy(project(deployment({ excluded: ['docs'] })), NO_WARN, VIS), (e) => e.code === 4, 'docs не закрывает .claude/docs/visual');
});

test('checkDeploy: сервер по умолчанию сопоставлен с подпапкой (dist) — папку снимков он не заливает, кода 4 нет', () => {
  const dist = deployment({ excluded: [] }).replace('local="$PROJECT_DIR$"', 'local="$PROJECT_DIR$/dist"');
  assert.deepEqual(checkDeploy(project(dist), NO_WARN, VIS), []);
});

test('checkDeploy: папки снимков нет в «Не выкладывать» — предупреждение; вне kit-проекта — тихо', () => {
  const dir = project();
  const w = checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .git, .claude/scripts' }), VIS);
  assert.equal(w.length, 1);
  assert.match(w[0], /Не выкладывать/);
  assert.ok(w[0].includes('.claude/docs/visual'));
  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, .claude' }), VIS), []);
  assert.deepEqual(checkDeploy(dir, makeParams({ 'не выкладывать': '.idea, docs' }), 'docs/visual'), []);
  assert.deepEqual(checkDeploy(dir, makeParams(null), VIS), []);
});

test('ensureGitignore: создаёт один раз; снимки игнорируются git, сам .gitignore — нет', () => {
  const dir = makeProject({ 'index.php': '<?php\n' });
  const visual = path.join(dir, 'docs', 'visual');
  assert.equal(ensureGitignore(visual), true);
  assert.equal(fs.readFileSync(path.join(visual, '.gitignore'), 'utf8'), GITIGNORE);
  fs.writeFileSync(path.join(visual, '.gitignore'), '# свой\n*\n!.gitignore\n');
  assert.equal(ensureGitignore(visual), false);
  assert.match(fs.readFileSync(path.join(visual, '.gitignore'), 'utf8'), /свой/, 'существующий не перезаписывается');
  writeFiles(dir, { 'docs/visual/before/guest/desktop/home.png': 'x', 'docs/visual/links.json': '{}' });
  git(dir, 'init', '-q');
  const r = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /docs\/visual\/\.gitignore/);
  assert.doesNotMatch(r.stdout, /home\.png|links\.json/);
});
