'use strict';
// Запись через временный файл рядом и переименование (журнал — kit-journal.js и journal-split.js, .idea/deployment.xml —
// phpstorm-exclude.js). С 3.3.0 переименование повторяется: на Windows renameSync падает EPERM/EBUSY/EACCES, пока файл
// открыт другим процессом — журнал читает соседняя сессия, deployment.xml пишет хук соседней сессии.
const fs = require('fs');
const path = require('path');

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRIES = 5;
const RENAME_PAUSE_MS = 100;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// fs.renameSync с повтором до 5 раз по 100 мс; другая ошибка или последняя неудача — исключение как есть.
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || i >= RENAME_RETRIES) throw e;
      sleep(RENAME_PAUSE_MS);
    }
  }
}

// Часть файлов уже переименована, остальные — нет: written и failed — подписи файлов по порядку, cause — ошибка.
class PartialWriteError extends Error {
  constructor(written, failed, cause) {
    super(`записано частично: ${written.join(', ')}; не записано: ${failed.join(', ')} (${cause.code || cause.message})`);
    Object.assign(this, { written, failed, cause });
  }
}

// Ничего не записано (rollbackNew): переименование упало, уже переименованные новые файлы и созданные папки убраны.
class NothingWrittenError extends Error {
  constructor(label, cause) {
    super(`${label} ${RETRY_CODES.has(cause.code) ? 'занят' : 'не записан'}: ${cause.code || cause.message}`);
    Object.assign(this, { label, cause });
  }
}

// Папки, которых нет, от dir вверх до первой существующей.
function missingDirs(dir) {
  const out = [];
  for (let d = dir; !fs.existsSync(d) && path.dirname(d) !== d; d = path.dirname(d)) out.push(d);
  return out;
}

// [{ file, text, label }] → временные файлы рядом, затем переименование по порядку (важный файл — последним);
// временные файлы убираются и при ошибке. Ничего не переименовано — исходная ошибка; часть — PartialWriteError.
// rollbackNew (с 3.3.0, journal-split.js): при сбое переименованные файлы, которых до записи не было, удаляются вместе
// с созданными папками (бывшие файлы не трогаются) — тогда NothingWrittenError и повтор безопасен; что убрать не вышло
// или файл был и раньше — PartialWriteError с этими файлами.
function writeFilesAtomic(entries, { mkdir = false, rollbackNew = false } = {}) {
  const tmps = [];
  const existed = entries.map(({ file }) => fs.existsSync(file));
  const made = new Set();
  let dropDirs = false;
  let done = 0;
  try {
    for (const { file, text } of entries) {
      if (mkdir) {
        for (const d of missingDirs(path.dirname(file))) made.add(d);
        fs.mkdirSync(path.dirname(file), { recursive: true });
      }
      const tmp = `${file}.${process.pid}.kit-tmp`;
      fs.writeFileSync(tmp, text);
      tmps.push(tmp);
    }
    for (; done < entries.length; done++) {
      try {
        renameRetry(tmps[done], entries[done].file);
      } catch (e) {
        const label = (x) => x.label || x.file;
        if (!rollbackNew) {
          if (!done) throw e;
          throw new PartialWriteError(entries.slice(0, done).map(label), entries.slice(done).map(label), e);
        }
        const left = entries.slice(0, done).filter((x, i) => {
          if (existed[i]) return true;
          try {
            fs.rmSync(x.file);
            return false;
          } catch (e2) {
            return true;
          }
        });
        dropDirs = true; // пустые созданные папки убираются в обоих случаях
        if (left.length) throw new PartialWriteError(left.map(label), entries.slice(done).map(label), e);
        throw new NothingWrittenError(label(entries[done]), e);
      }
    }
  } finally {
    for (const tmp of tmps) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch (e) {
        // не удалось убрать — не важнее исходной ошибки
      }
    }
    // Откат: созданные папки — после временных файлов в них, глубокие первыми; непустую (чужой файл) rmdir не тронет.
    if (dropDirs) {
      for (const d of [...made].sort((a, b) => b.length - a.length)) {
        try {
          fs.rmdirSync(d);
        } catch (e) {
          // папка не пуста или занята — оставляем
        }
      }
    }
  }
}

module.exports = { renameRetry, writeFilesAtomic, PartialWriteError, NothingWrittenError, RENAME_RETRIES, RENAME_PAUSE_MS };
