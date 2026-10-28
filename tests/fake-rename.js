'use strict';
// Подмена fs.renameSync для скриптов плагина в тестах (NODE_OPTIONS=--require …): сбой переименования, как на Windows,
// когда файл держит другой процесс (читатель журнала, соседняя сессия).
// KIT_FAKE_RENAME — «<n>:<часть пути>»: первые n переименований в файлы, путь которых (с «/») содержит часть, падают EPERM;
// n = all — падают всегда; часть пустая — любой файл.
const fs = require('fs');

const spec = String(process.env.KIT_FAKE_RENAME || '');
const at = spec.indexOf(':');
if (at > 0) {
  const limit = spec.slice(0, at) === 'all' ? Infinity : Number(spec.slice(0, at));
  const part = spec.slice(at + 1);
  const real = fs.renameSync;
  let failed = 0;
  fs.renameSync = function renameSync(from, to) {
    if (failed < limit && String(to).replace(/\\/g, '/').includes(part)) {
      failed++;
      const e = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`);
      Object.assign(e, { code: 'EPERM', errno: -4048, syscall: 'rename', path: String(from), dest: String(to) });
      throw e;
    }
    return real.apply(this, arguments);
  };
}

// Окружение для runScript: подмена и её настройка.
const fakeRenameEnv = (value) => ({ NODE_OPTIONS: `--require ${JSON.stringify(__filename)}`, KIT_FAKE_RENAME: value });

module.exports = { fakeRenameEnv };
