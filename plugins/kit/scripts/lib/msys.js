'use strict';
// Путь, переписанный MSYS: Git Bash превращает аргумент «/путь» в «C:/Program Files/Git/путь», MSYS2 — в «C:/msys64/путь».
// Общее для remote-php.js (код 4 с подсказкой) и visual/args.js (возвращает путь как был).
// Git / PortableGit / msys32 / msys64 — целое имя папки (legit, digit, MyGit — обычные папки); обрезается по первой такой.
const MSYS_RE = /^[A-Za-z]:[\\/](?:.*?[\\/])?(?:(?:Portable)?Git|msys(?:32|64)?)[\\/]/i;

const isMsysRewritten = (p) => MSYS_RE.test(String(p));

// «C:/Program Files/Git/catalog/» → «/catalog/»; остальные пути — без изменений.
const undoMsys = (p) => String(p).replace(MSYS_RE, '/');

module.exports = { isMsysRewritten, undoMsys };
