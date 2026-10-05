# плагин kit (маркетплейс claude-kit) — этап 2

## Этап 2 — хуки

| Шаг | Статус | Что сделано | Коммит |
|---|---|---|---|
| 2.1 | ✅ | Хук SessionStart: раздел «Сейчас» и правила процесса в контекст | `e09620d` |
| 2.2 | ✅ | Хук PostToolUse (Write\|Edit\|MultiEdit): `php -l` версией PHP проекта; скрипты консоли (`.claude/scripts/`, `skills/bitrix-console/scripts/` без `<?php`) — через временный файл в `os.tmpdir()` с приставкой `<?php\n` | `2542e4e` |
| 2.3 | ✅ | Хук PreToolUse (Bash\|PowerShell): запрет cd вне подоболочки (в PowerShell — везде) и sed -i по PHP | `a08b725`, `ea38c69`, `524b483` |
