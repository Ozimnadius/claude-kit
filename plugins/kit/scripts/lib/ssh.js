'use strict';
// SSH для kit: адрес сервера из «SSH прод» / «SSH дев», запуск ssh без пароля и метка завершения удалённой команды.
// Метка нужна, потому что ssh возвращает 255 и когда не пустил, и когда 255 вернула сама команда (фатальная ошибка PHP).
const { spawn } = require('child_process');

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4'];
const MARK_RE = /\n__KIT_EXIT=(\d+)\s*$/;
const KEYS = { 'прод': 'SSH прод', 'дев': 'SSH дев' };

// Строка для удалённой оболочки POSIX в одинарных кавычках.
function shq(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// Псевдоним из ~/.ssh/config или user@host. Без «-» в начале: иначе значение стало бы опцией ssh (-oProxyCommand=…).
function validHost(host) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(String(host || ''));
}

// Символы, которых не может быть в папке сайта: папку подставляют в команду «ssh <хост> '… <папка> …'».
const BAD_ROOT_RE = /[\x00-\x1f\x7f'"`$\\]/;

// «хост:/папка» → { host, root }; нет значения, нет «:», недопустимый хост, папка не абсолютная, «/»
// или с кавычками, `, $, \ и управляющими символами → null.
function parseTarget(value) {
  const v = String(value || '').trim();
  const i = v.indexOf(':');
  if (i <= 0) return null;
  const host = v.slice(0, i).trim();
  const root = v.slice(i + 1).trim().replace(/\/+$/, '');
  if (!validHost(host) || !root.startsWith('/') || BAD_ROOT_RE.test(root)) return null;
  return { host, root };
}

// Параметр «SSH прод» / «SSH дев» (env — 'прод' или 'дев').
function serverSsh(params, env = 'прод') {
  const key = KEYS[env];
  return key ? parseTarget(params.get(key)) : null;
}

// Что запускать: KIT_SSH (заглушка тестов *.js — через node) или ssh из PATH.
function sshBinary() {
  const bin = process.env.KIT_SSH || 'ssh';
  return /\.js$/i.test(bin) ? { cmd: process.execPath, pre: [bin] } : { cmd: bin, pre: [] };
}

// Последняя непустая строка — причина отказа ssh для сообщения пользователю.
function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// Выполнить remoteCmd на host, stdin — строка или Buffer; timeoutMs — общий таймаут (нет — без ограничения).
// → { connected, exitCode, stdout, stderr }; connected: false — метки нет (не пустил, соединение оборвалось
// или вышло время — тогда ещё timedOut: true; текста о таймауте в stderr нет — о нём говорит вызывающий).
function runSsh(host, remoteCmd, stdin, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    const { cmd, pre } = sshBinary();
    const args = [...pre, ...SSH_OPTS, host, remoteCmd + '; printf "\\n__KIT_EXIT=%s\\n" "$?"'];
    const out = [];
    const err = [];
    let done = false;
    let timedOut = false;
    let timer = null;
    const finish = (extraErr) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8') + (extraErr || '');
      const m = MARK_RE.exec(stdout);
      if (m) resolve({ connected: true, exitCode: Number(m[1]), stdout: stdout.slice(0, m.index), stderr });
      else if (timedOut) resolve({ connected: false, exitCode: null, stdout, stderr, timedOut: true });
      else resolve({ connected: false, exitCode: null, stdout, stderr });
    };
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      finish('не удалось запустить ssh: ' + e.message + '\n');
      return;
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch (e) { /* уже завершился */ }
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => finish('не удалось запустить ssh: ' + e.message + '\n'));
    child.on('close', () => finish());
    child.stdin.on('error', () => {});
    child.stdin.end(stdin == null ? '' : stdin);
  });
}

module.exports = { SSH_OPTS, shq, validHost, parseTarget, serverSsh, runSsh, lastLine };
