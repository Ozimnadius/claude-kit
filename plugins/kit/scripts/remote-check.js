#!/usr/bin/env node
'use strict';
// Хук SessionStart (с 2.5.0): сверка ветки с удалённым репозиторием из параметра «Удалённый репозиторий».
// git fetch — не дольше 8 с и без окон входа; в контекст Claude — строка состояния и правило отправки,
// пользователю (systemMessage) — только то, что требует действия. Вне kit-проекта, без параметра, не в git,
// с отсоединённым HEAD — тишина. Любая внутренняя ошибка — тихий выход 0.
const { spawnSync } = require('child_process');
const { readStdinJson, resolveProjectDir, kitInfo } = require('./lib/project');

const FETCH_MS = 8000;

function git(dir, args, opts = {}) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, ...opts });
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    timedOut: Boolean(r.error && r.error.code === 'ETIMEDOUT'),
  };
}

// Ни вопросов в терминале, ни окна Git Credential Manager, ни ожидания пароля ssh: нет входа — просто ошибка.
function fetchEnv(env) {
  const e = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  if (!e.GIT_SSH_COMMAND) e.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=5';
  return e;
}

const lastLine = (s) => String(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';

// → { context, user } — строки в контекст Claude и пользователю; null — молчать.
function check(dir, env = process.env) {
  const info = kitInfo(dir);
  if (!info.isKit) return null;
  const name = info.params.get('Удалённый репозиторий', '');
  if (!name) return null;
  if (!git(dir, ['rev-parse', '--is-inside-work-tree']).ok) return null;
  const head = git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!head.ok) return null;
  const branch = head.out;
  if (!git(dir, ['remote']).out.split(/\r?\n/).includes(name)) {
    const s = `[kit] Параметр «Удалённый репозиторий: ${name}», но remote ${name} в git нет — подключить через /kit:project-init.`;
    return { context: [s], user: [s] };
  }
  const rule = `[kit] Удалённый репозиторий ${name}: после каждого шага /kit:step-done отправляет коммит (git push -u ${name} HEAD); --force, rebase и слияния — только с согласия пользователя.`;
  const f = git(dir, ['fetch', '--quiet', name], { env: fetchEnv(env), timeout: FETCH_MS });
  if (!f.ok) {
    const why = f.timedOut ? `вышло время (${FETCH_MS / 1000} с)` : lastLine(f.err) || 'git fetch завершился с ошибкой';
    const s = `[kit] Не удалось проверить ${name}: ${why} — работа идёт дальше, отправка — в /kit:step-done.`;
    return { context: [s, rule], user: [s] };
  }
  // Удалённая ветка — та, куда отправляет `git push -u <имя> HEAD`; upstream не берём: он может смотреть в другой remote.
  const remoteRef = `refs/remotes/${name}/${branch}`;
  if (!git(dir, ['rev-parse', '--verify', '--quiet', remoteRef]).ok) {
    const s = `[kit] Ветка ${branch} ещё не отправлена в ${name} — отправит /kit:step-done (первый раз — после проверки истории на секреты).`;
    return { context: [s, rule], user: [] };
  }
  const [ahead, behind] = git(dir, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]).out.split(/\s+/).map(Number);
  let s;
  if (ahead && behind) {
    s = `[kit] Ветка ${branch} разошлась с ${name}: здесь ${ahead}, там ${behind} — стоп, спроси пользователя; --force, rebase и слияния — только с его согласия.`;
  } else if (behind) {
    // «Сейчас» в контексте положил session-start.js до pull — после pull журнал другой.
    s = `[kit] На ${name} новых коммитов: ${behind} (работали с другого компьютера) — до любой правки выполни git pull --ff-only ${name} ${branch}, затем перечитай раздел «Сейчас» в ${info.journalRel}: в контексте он из журнала до pull; мешают незакоммиченные изменения — стоп и вопрос пользователю.`;
  } else if (ahead) {
    s = `[kit] Не отправлено в ${name} коммитов: ${ahead} — отправь: git push -u ${name} HEAD.`;
  } else {
    return { context: [`[kit] В синхроне с ${name}.`, rule], user: [] };
  }
  return { context: [s, rule], user: [s] };
}

function main() {
  try {
    const r = check(resolveProjectDir(readStdinJson()));
    if (r) {
      const o = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: r.context.join('\n') } };
      if (r.user.length) o.systemMessage = r.user.join('\n');
      process.stdout.write(JSON.stringify(o) + '\n');
    }
  } catch (e) {
    // хук не должен ломать сессию
  }
  process.exitCode = 0;
}

if (require.main === module) main();
module.exports = { check };
