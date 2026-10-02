'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DeploymentError, readDeployment, isExcluded, addExclusions, removeExclusions, collapse } = require('../plugins/kit/scripts/lib/deployment');
const { BETA, GAMMA, DIST, NO_BLOCK, TWO, BROKEN, crlf } = require('./deployment-fixtures');

const MUST = ['.idea', '.git', '.claude'];

test('readDeployment: автозаливка, сервер по умолчанию, локальные исключения, серверы с корнем проекта', () => {
  const d = readDeployment(BETA);
  assert.equal(d.always, true);
  assert.equal(d.server, 'ftp');
  assert.deepEqual(d.excluded, ['.idea', '.git', '.claude/scripts', '.claude/settings.local.json', '.claude/worktrees', 'docs/visual']);
  assert.deepEqual(d.servers, [{ name: 'ftp', root: true, excluded: d.excluded }]);
  assert.equal(readDeployment(NO_BLOCK).always, false);
  assert.deepEqual(readDeployment(DIST).servers, [{ name: 'ftp', root: false, excluded: [] }]);
  const two = readDeployment(TWO);
  assert.equal(two.server, 'dev');
  assert.deepEqual(two.excluded, [], 'по умолчанию — dev, у него пусто');
  assert.deepEqual(two.servers.map((s) => [s.name, s.root]), [['prod', true], ['dev', true], ['static', false]]);
  assert.equal(readDeployment('<component name="PublishConfigData" serverName="x"><option name="myAutoUpload" value="ALWAYS" /></component>').always, true);
  assert.deepEqual(readDeployment(BROKEN).servers.map((s) => s.name), ['ftp'], 'чтение терпит обрезанный файл');
  assert.deepEqual(d.names, [], 'атрибута exclude нет — список PhpStorm по умолчанию');
  const named = GAMMA.replace('autoUpload="Always"', 'exclude=".svn;*.md;docs;" autoUpload="Always"');
  assert.deepEqual(readDeployment(named).names, ['.svn', '*.md', 'docs'], 'Exclude items by name');
});

test('isExcluded: сам путь или предок, регистр не важен, не по началу имени', () => {
  const list = ['.claude', 'local/modules/'];
  assert.equal(isExcluded(list, '.claude'), true);
  assert.equal(isExcluded(list, '.claude/docs/visual'), true);
  assert.equal(isExcluded(list, '.Claude\\docs'), true);
  assert.equal(isExcluded(list, 'local/modules/x'), true);
  assert.equal(isExcluded(list, '.claudex'), false);
  assert.equal(isExcluded(list, 'local'), false);
  assert.equal(isExcluded([''], 'a'), false);
});

test('collapse: без повторов и без путей внутри других', () => {
  assert.deepEqual(collapse(['.idea', '.claude', '.claude/scripts', '/docs/', 'docs', '']), ['.idea', '.claude', 'docs']);
});

test('addExclusions: beta — строки дописаны перед </excludedPaths>, остальной текст байт в байт', () => {
  const r = addExclusions(BETA, [...MUST, 'docs']);
  assert.deepEqual(r.added, { ftp: ['.claude', 'docs'] });
  const lines = [
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/docs" />',
  ];
  assert.equal(r.xml, BETA.replace('          </excludedPaths>', lines.join('\n') + '\n          </excludedPaths>'));
  const again = addExclusions(r.xml, [...MUST, 'docs']);
  assert.deepEqual(again.added, {});
  assert.equal(again.xml, r.xml, 'повторный запуск ничего не меняет');
});

test('addExclusions: gamma — всё уже исключено, файл не меняется', () => {
  const r = addExclusions(GAMMA, [...MUST, '.gitignore', 'local/modules', '.claude/docs']);
  assert.deepEqual(r.added, {});
  assert.equal(r.xml, GAMMA);
});

test('addExclusions: сервер с подпапкой (dist) не трогается', () => {
  const r = addExclusions(DIST, MUST);
  assert.deepEqual(r.added, {});
  assert.equal(r.xml, DIST);
});

test('addExclusions: нет блока excludedPaths — создаётся после </mappings> с отступом соседних строк', () => {
  const r = addExclusions(NO_BLOCK, MUST);
  assert.deepEqual(r.added, { ftp: MUST });
  assert.equal(r.xml, NO_BLOCK.replace('          </mappings>\n', [
    '          </mappings>',
    '          <excludedPaths>',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.git" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '          </excludedPaths>',
  ].join('\n') + '\n'));
});

test('addExclusions: два сервера с корнем — оба; <excludedPaths /> раскрывается; подпапка — нет', () => {
  const r = addExclusions(TWO, MUST);
  assert.deepEqual(r.added, { prod: ['.git', '.claude'], dev: MUST });
  assert.ok(r.xml.includes([
    '          <excludedPaths>',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.idea" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.git" />',
    '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />',
    '          </excludedPaths>',
  ].join('\n')), 'dev: из <excludedPaths /> — блок');
  assert.ok(!r.xml.includes('<excludedPaths />'));
  const d = readDeployment(r.xml);
  assert.deepEqual(d.servers.map((s) => [s.name, s.excluded]), [
    ['prod', ['.idea', '.git', '.claude']], ['dev', MUST], ['static', []],
  ]);
});

test('addExclusions: CRLF сохраняется, одиночных \\n нет', () => {
  for (const src of [crlf(BETA), crlf(NO_BLOCK), crlf(TWO)]) {
    const r = addExclusions(src, MUST);
    assert.ok(Object.keys(r.added).length > 0);
    assert.doesNotMatch(r.xml, /[^\r]\n/);
  }
});

test('addExclusions: блок в одну строку и XML-экранирование пути', () => {
  const inline = NO_BLOCK.replace('          </mappings>\n', '          </mappings>\n          <excludedPaths><excludedPath local="true" path="$PROJECT_DIR$/.idea" /></excludedPaths>\n');
  const r = addExclusions(inline, ['.idea', 'a&b', 'x"y']);
  assert.deepEqual(r.added, { ftp: ['a&b', 'x"y'] });
  assert.ok(r.xml.includes('path="$PROJECT_DIR$/a&amp;b"'));
  assert.ok(r.xml.includes('path="$PROJECT_DIR$/x&quot;y"'));
  assert.deepEqual(readDeployment(r.xml).servers[0].excluded, ['.idea', 'a&b', 'x"y']);
});

test('addExclusions: сопоставление с корнем вне распознанного блока или не-UTF-8 — DeploymentError, а не «всё в порядке»', () => {
  const odd = NO_BLOCK.replace('<paths name="ftp">', '<paths foo="1" name="ftp">');
  assert.deepEqual(readDeployment(odd).servers, [], 'чтение такой блок не узнаёт');
  assert.throws(() => addExclusions(odd, MUST), (e) => e instanceof DeploymentError && /вне распознанного блока/.test(e.message));
  const bad = NO_BLOCK.replace('ftp', 'f' + String.fromCharCode(0xFFFD) + 'p');
  assert.throws(() => addExclusions(bad, MUST), (e) => e instanceof DeploymentError && /UTF-8/.test(e.message));
});

test('removeExclusions: только точный локальный путь (регистр и «/» в конце не важны), строка уходит целиком; подпапки не трогаются', () => {
  const line = '            <excludedPath local="true" path="$PROJECT_DIR$/.claude" />\n';
  const r = removeExclusions(GAMMA, ['.claude']);
  assert.deepEqual(r.removed, { ftp: ['.claude'] });
  assert.equal(r.xml, GAMMA.replace(line, ''));
  const again = removeExclusions(r.xml, ['.claude']);
  assert.deepEqual(again.removed, {});
  assert.equal(again.xml, r.xml, 'повторный запуск ничего не меняет');
  assert.deepEqual(removeExclusions(BETA, ['.claude']).removed, {}, '.claude/scripts и другие подпапки — не .claude');
  const odd = GAMMA.replace('$PROJECT_DIR$/.claude"', '$PROJECT_DIR$/.Claude/"');
  assert.deepEqual(removeExclusions(odd, ['.claude']).removed, { ftp: ['.Claude'] });
  assert.equal(removeExclusions(crlf(GAMMA), ['.claude']).xml, crlf(GAMMA.replace(line, '')), 'CRLF');
  const remote = GAMMA.replace('local="true" path="$PROJECT_DIR$/.claude"', 'path="/.claude"');
  assert.deepEqual(removeExclusions(remote, ['.claude']).removed, {}, 'исключение на сервере (без local) не трогается');
});

test('removeExclusions: оба сервера с корнем; блок в одну строку; обрезанный файл — DeploymentError', () => {
  const r = removeExclusions(addExclusions(TWO, MUST).xml, ['.claude']);
  assert.deepEqual(r.removed, { prod: ['.claude'], dev: ['.claude'] });
  assert.deepEqual(readDeployment(r.xml).servers.map((s) => s.excluded), [['.idea', '.git'], ['.idea', '.git'], []]);
  const inline = NO_BLOCK.replace('          </mappings>\n', '          </mappings>\n          <excludedPaths><excludedPath local="true" path="$PROJECT_DIR$/.claude" /></excludedPaths>\n');
  const one = removeExclusions(inline, ['.claude']);
  assert.ok(one.xml.includes('          <excludedPaths></excludedPaths>\n'));
  assert.deepEqual(readDeployment(one.xml).servers[0].excluded, []);
  assert.throws(() => removeExclusions(BROKEN, ['.claude']), DeploymentError);
});

test('addExclusions: обрезанный файл или сервер без </mappings> — DeploymentError, ничего не пишется', () => {
  assert.throws(() => addExclusions(BROKEN, MUST), (e) => e instanceof DeploymentError && /«ftp»/.test(e.message) && /<\/paths>/.test(e.message));
  const noMappings = NO_BLOCK.replace(/<mappings>[\s\S]*<\/mappings>/, '<mapping deploy="/" local="$PROJECT_DIR$" web="/" />');
  assert.throws(() => addExclusions(noMappings, MUST), (e) => e instanceof DeploymentError && /<\/mappings>/.test(e.message));
});
