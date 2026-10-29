#!/usr/bin/env node
'use strict';
// Заглушка ssh для тестов (KIT_SSH): node fake-ssh.js [-o опция]… <хост> <команда>.
// Хост выбирает сценарий: down, denied — не пустил (255, без метки); drop — начал выводить и оборвался (255, без метки);
// empty — команда ничего не вывела (только метка с кодом 0); closed — закрылся, не прочитав stdin (255, без метки,
// лог не пишется).
// hang — прочитал stdin и завис (для проверки таймаута: runSsh убивает процесс).
// sh — сценарий со stdin выполняется локальной оболочкой (FAKE_SH или sh из PATH), затем метка с её кодом (заливка ssh-deploy.js).
// shdrop — как sh, но подключение номер FAKE_SSH_DROP (по умолчанию 2; счётчик — в файле FAKE_SSH_COUNT) начинает вывод и
// обрывается, как drop (вход prod-entry.js: сверка прошла, скачивание оборвалось).
// Иначе: FAKE_SSH_OUT задан — печатает его и метку с кодом FAKE_SSH_EXIT (по умолчанию 0); не задан — в команде
// первый путь в одинарных кавычках ('<php>', в том числе внутри «timeout -k 5 N '<php>'») выполняется локальным PHP:
// stdin → php, затем метка с кодом php (как настоящий сервер).
// FAKE_SSH_LOG — файл для проверок: { opts, host, command, stdin }.
// Выход — через process.exitCode, а не process.exit(): на Windows запись в канал асинхронная и обрезалась бы.
const fs = require('fs');
const { spawnSync } = require('child_process');

const mark = (code) => '\n__KIT_EXIT=' + code + '\n';

function fail(out, err) {
  process.stdout.write(out);
  process.stderr.write(err);
  return 255;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = [];
  let i = 0;
  while (argv[i] === '-o') {
    opts.push(argv[i + 1]);
    i += 2;
  }
  const host = argv[i];
  const command = argv.slice(i + 1).join(' ');
  // До чтения stdin: запись runSsh в закрытый канал должна дать ошибку stdin, а не исключение.
  if (host === 'closed') return fail('', 'Connection closed by 10.0.0.1 port 22\n');
  const stdin = fs.readFileSync(0);
  if (process.env.FAKE_SSH_LOG) {
    fs.writeFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ opts, host, command, stdin: stdin.toString('utf8') }));
  }
  if (host === 'down') return fail('', 'ssh: connect to host down port 22: Connection timed out\n');
  if (host === 'denied') return fail('', 'user100@denied: Permission denied (publickey).\n');
  if (host === 'drop') return fail('начало\n', 'Connection to drop closed by remote host.\n');
  if (host === 'hang') {
    setInterval(() => {}, 1000);
    return 0;
  }
  if (host === 'empty') {
    process.stdout.write(mark(0));
    return 0;
  }
  if (host === 'shdrop') {
    const file = process.env.FAKE_SSH_COUNT;
    const n = (file && fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) || 0 : 0) + 1;
    if (file) fs.writeFileSync(file, String(n));
    if (n === Number(process.env.FAKE_SSH_DROP || 2)) return fail('KIT_F 1\nYWJj\n', 'Connection to shdrop closed by remote host.\n');
  }
  if (host === 'sh' || host === 'shdrop') {
    const r = spawnSync(process.env.FAKE_SH || 'sh', ['-s'], { input: stdin, env: { ...process.env, LC_ALL: process.env.LC_ALL || 'C.UTF-8' } });
    process.stdout.write(Buffer.concat([r.stdout || Buffer.alloc(0), Buffer.from(mark(r.status === null ? 255 : r.status))]));
    process.stderr.write(r.stderr || Buffer.alloc(0));
    return 0;
  }
  if (process.env.FAKE_SSH_OUT !== undefined) {
    process.stdout.write(process.env.FAKE_SSH_OUT + mark(process.env.FAKE_SSH_EXIT || 0));
    return 0;
  }
  const m = /'((?:[^']|'\\'')*)'/.exec(command);
  const bin = m ? m[1].replace(/'\\''/g, "'") : command.split(/\s+/)[0];
  const r = spawnSync(bin, ['-d', 'display_errors=stderr'], { input: stdin });
  process.stdout.write(Buffer.concat([r.stdout || Buffer.alloc(0), Buffer.from(mark(r.status === null ? 255 : r.status))]));
  process.stderr.write(r.stderr || Buffer.alloc(0));
  return 0;
}

process.exitCode = main();
