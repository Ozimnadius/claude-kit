'use strict';
// .idea/deployment.xml PhpStorm: чтение настроек выкладки и дописывание исключений (Excluded Paths).
// Файл не пересобирается как XML: новые строки вставляются в текст, всё остальное остаётся байт в байт.

class DeploymentError extends Error {}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

// Блоки серверов <paths name="…">…</paths> по порядку. strict — нет </paths> → DeploymentError (для записи).
function serverBlocks(xml, strict) {
  const out = [];
  const re = /<paths\s+name="([^"]*)"[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = unescapeXml(m[1]);
    if (m[2] === '/') continue;
    const bodyStart = re.lastIndex;
    let bodyEnd = xml.indexOf('</paths>', bodyStart);
    if (bodyEnd < 0) {
      if (strict) throw new DeploymentError(`нет </paths> у сервера «${name}»`);
      bodyEnd = xml.length;
    }
    out.push({ name, bodyStart, bodyEnd, body: xml.slice(bodyStart, bodyEnd) });
    re.lastIndex = bodyEnd;
  }
  return out;
}

// Локальные исключения (local="true") — пути от корня проекта.
function excludedIn(text) {
  const out = [];
  for (const m of text.matchAll(/<excludedPath\b([^>]*?)\/?>/g)) {
    if (!/\blocal="true"/.test(m[1])) continue;
    const p = /\bpath="([^"]*)"/.exec(m[1]);
    if (p) out.push(normPath(unescapeXml(p[1]).replace(/^\$PROJECT_DIR\$/, '')));
  }
  return out;
}

// Сервер сопоставлен с корнем проекта: <mapping … local="$PROJECT_DIR$" …/>.
const ROOT_MAPPING = /<mapping\b[^>]*\blocal="\$PROJECT_DIR\$\/?"/g;
const rootMapped = (body) => new RegExp(ROOT_MAPPING.source).test(body);
const rootMappings = (text) => (text.match(ROOT_MAPPING) || []).length;

// .idea/deployment.xml → { always, server, excluded, servers, names }. excluded — у сервера по умолчанию
// (serverName → блок <paths name="…">; блок не найден — по всему файлу); servers — [{ name, root, excluded }];
// names — «Exclude items by name» (атрибут exclude, маски через «;»; нет атрибута — список PhpStorm по умолчанию, []).
function readDeployment(xml) {
  const comp = /<component\s+name="PublishConfigData"([^>]*)>/.exec(xml);
  const attrs = comp ? comp[1] : '';
  const always = /\bautoUpload="Always"/i.test(attrs) || /<option\s+name="myAutoUpload"\s+value="ALWAYS"/i.test(xml);
  const sm = /\bserverName="([^"]*)"/.exec(attrs);
  const server = sm ? unescapeXml(sm[1]) : null;
  const em = /\bexclude="([^"]*)"/.exec(attrs);
  const blocks = serverBlocks(xml, false);
  const def = server === null ? null : blocks.find((b) => b.name === server);
  return {
    always,
    server,
    excluded: excludedIn(def ? def.body : xml),
    servers: blocks.map((b) => ({ name: b.name, root: rootMapped(b.body), excluded: excludedIn(b.body) })),
    names: em ? unescapeXml(em[1]).split(';').map((s) => s.trim()).filter(Boolean) : [],
  };
}

// Путь исключён сам или через папку-предка (регистр не важен: Windows).
function isExcluded(list, p) {
  const q = normPath(p).toLowerCase();
  return list.some((e) => {
    const x = normPath(e).toLowerCase();
    return x !== '' && (q === x || q.startsWith(x + '/'));
  });
}

// Пути без повторов и без тех, что лежат внутри другого пути из списка.
function collapse(paths) {
  const list = [...new Set(paths.map(normPath).filter(Boolean))];
  return list.filter((p) => !list.some((o) => o !== p && isExcluded([o], p)));
}

const lineStartOf = (xml, pos) => xml.lastIndexOf('\n', pos - 1) + 1;
const indentOf = (xml, pos) => /^[ \t]*/.exec(xml.slice(lineStartOf(xml, pos)))[0];
const entry = (p) => `<excludedPath local="true" path="$PROJECT_DIR$/${escapeXml(p)}" />`;

// Правка одного блока сервера: { at, remove, text } — вставить text на место [at, at + remove).
function blockEdit(xml, b, add, eol) {
  const close = b.body.search(/<\/excludedPaths\s*>/);
  if (close >= 0) {
    const pos = b.bodyStart + close;
    const start = lineStartOf(xml, pos);
    const closeIndent = indentOf(xml, pos);
    const sample = /\n([ \t]*)<excludedPath\b/.exec(b.body);
    const ind = sample ? sample[1] : closeIndent + '  ';
    if (/^[ \t]*$/.test(xml.slice(start, pos))) {
      return { at: start, remove: 0, text: add.map((p) => ind + entry(p) + eol).join('') };
    }
    return { at: pos, remove: 0, text: add.map((p) => eol + ind + entry(p)).join('') + eol + closeIndent };
  }
  const selfClosed = /<excludedPaths\s*\/>/.exec(b.body);
  if (selfClosed) {
    const pos = b.bodyStart + selfClosed.index;
    const ind = indentOf(xml, pos);
    return {
      at: pos,
      remove: selfClosed[0].length,
      text: '<excludedPaths>' + add.map((p) => eol + ind + '  ' + entry(p)).join('') + eol + ind + '</excludedPaths>',
    };
  }
  const mappings = b.body.search(/<\/mappings\s*>/);
  if (mappings < 0) throw new DeploymentError(`у сервера «${b.name}» нет </mappings>`);
  const pos = b.bodyStart + mappings;
  const after = pos + /<\/mappings\s*>/.exec(b.body.slice(mappings))[0].length;
  const ind = indentOf(xml, pos);
  return {
    at: after,
    remove: 0,
    text: eol + ind + '<excludedPaths>' + add.map((p) => eol + ind + '  ' + entry(p)).join('') + eol + ind + '</excludedPaths>',
  };
}

// Блоки серверов для записи; неразобранный файл — DeploymentError.
function writableBlocks(xml) {
  // Байты не UTF-8 при чтении стали U+FFFD — запись испортила бы файл.
  if (xml.includes(String.fromCharCode(0xFFFD))) throw new DeploymentError('в файле есть байты не в UTF-8');
  const blocks = serverBlocks(xml, true);
  // Незнакомая разметка (<paths foo="…" name="…">) — не «серверов с корнем нет», а «не разобран».
  if (blocks.reduce((n, b) => n + rootMappings(b.body), 0) !== rootMappings(xml)) {
    throw new DeploymentError('сопоставление с корнем проекта вне распознанного блока сервера');
  }
  return blocks;
}

const applyEdits = (xml, edits) => edits.sort((a, b) => b.at - a.at)
  .reduce((out, e) => out.slice(0, e.at) + e.text + out.slice(e.at + e.remove), xml);

// Дописать исключения paths каждому серверу, сопоставленному с корнем проекта.
// → { xml, added: { сервер: [пути] } }; added пуст — xml тот же. Неразобранный файл — DeploymentError.
function addExclusions(xml, paths) {
  const blocks = writableBlocks(xml);
  const want = collapse(paths);
  const eol = xml.includes('\r\n') ? '\r\n' : '\n';
  const added = {};
  const edits = [];
  for (const b of blocks) {
    if (!rootMapped(b.body)) continue;
    const have = excludedIn(b.body);
    const add = want.filter((p) => !isExcluded(have, p));
    if (!add.length) continue;
    added[b.name] = add;
    edits.push(blockEdit(xml, b, add, eol));
  }
  const out = applyEdits(xml, edits);
  // Самопроверка: всё добавленное читается обратно.
  const back = readDeployment(out).servers;
  for (const [name, list] of Object.entries(added)) {
    const s = back.find((x) => x.name === name);
    if (!s || !list.every((p) => isExcluded(s.excluded, p))) throw new DeploymentError(`не удалось дописать исключения серверу «${name}»`);
  }
  return { xml: out, added };
}

// Убрать локальные исключения ровно paths (не подпапки; регистр не важен) у серверов, сопоставленных с корнем проекта;
// строка, где элемент один, уходит целиком. → { xml, removed: { сервер: [пути] } }; removed пуст — xml тот же.
function removeExclusions(xml, paths) {
  const blocks = writableBlocks(xml);
  const drop = new Set(paths.map((p) => normPath(p).toLowerCase()));
  const removed = {};
  const edits = [];
  for (const b of blocks) {
    if (!rootMapped(b.body)) continue;
    for (const m of b.body.matchAll(/<excludedPath\b([^>]*?)\/?>/g)) {
      const p = /\bpath="([^"]*)"/.exec(m[1]);
      if (!/\blocal="true"/.test(m[1]) || !p) continue;
      const rel = normPath(unescapeXml(p[1]).replace(/^\$PROJECT_DIR\$/, ''));
      if (!drop.has(rel.toLowerCase())) continue;
      (removed[b.name] = removed[b.name] || []).push(rel);
      let at = b.bodyStart + m.index;
      let end = at + m[0].length;
      const start = lineStartOf(xml, at);
      const nl = xml.indexOf('\n', end);
      const rest = xml.slice(end, nl < 0 ? xml.length : nl);
      if (/^[ \t]*$/.test(xml.slice(start, at)) && /^[ \t]*\r?$/.test(rest)) {
        at = start;
        end = nl < 0 ? xml.length : nl + 1;
      }
      edits.push({ at, remove: end - at, text: '' });
    }
  }
  const out = applyEdits(xml, edits);
  // Самопроверка: убранное больше не читается.
  const back = readDeployment(out).servers;
  for (const name of Object.keys(removed)) {
    const s = back.find((x) => x.name === name);
    if (!s || s.excluded.some((e) => drop.has(e.toLowerCase()))) throw new DeploymentError(`не удалось убрать исключения у сервера «${name}»`);
  }
  return { xml: out, removed };
}

module.exports = { DeploymentError, readDeployment, isExcluded, addExclusions, removeExclusions, collapse, normPath };
