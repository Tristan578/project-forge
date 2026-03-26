#!/usr/bin/env bash
# PreToolUse hook: warn when editing files that use db.transaction()
# The neon-http driver throws "No transactions support" when db.transaction()
# is called. Use getNeonSql().transaction([...]) instead. (Lesson #59)
#
# Only triggers on web/src/lib/ files (where Drizzle ORM is used).
# Ignores indexedDB (browser API), test files, and comments.

FILE_PATH="${TOOL_INPUT_file_path:-}"

# Only check TypeScript files in the server-side lib directory
[[ "$FILE_PATH" == */web/src/lib/*.ts ]] || exit 0
[[ "$FILE_PATH" != *__tests__* ]] || exit 0
[[ "$FILE_PATH" != *.test.* ]] || exit 0

# Check for Drizzle db.transaction() calls (not IndexedDB, not comments)
if grep -n 'db\.transaction(' "$FILE_PATH" 2>/dev/null | grep -v '//' | grep -v 'indexedDB\|IndexedDB\|STORE_NAME' | grep -qv '^\s*\*'; then
  echo "WARNING: db.transaction() detected in $FILE_PATH"
  echo "  neon-http driver does NOT support db.transaction() — it throws at runtime."
  echo "  Use: const neonSql = getNeonSql(); await neonSql.transaction([...statements]);"
  echo "  See: CLAUDE.md Gotchas, Lesson #59"
fi
