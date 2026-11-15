#!/usr/bin/env bash
# Tests for .claude/hooks/post-edit-lint.sh — the PostToolUse lint hook every
# AI-tool config wires (#8694).
#
# Every case here exercises an early-exit branch that returns BEFORE the
# `cd "$PROJECT_DIR/web"` + `npx eslint` call, so the real hook is run from
# the repository and no ESLint, npm or network is ever touched. The branch
# that does lint (a real path under web/) needs a full web/ install and is
# deliberately not asserted here.
set -uo pipefail
command -v jq >/dev/null 2>&1 || { echo "FAIL jq is required to run this suite"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../post-edit-lint.sh"
[ -f "$HOOK" ] || { echo "FAIL hook not found: $HOOK"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

# run_path <file_path> — feed the hook the JSON shape Claude Code sends for an
# Edit/Write; prints "<exit>|<output>".
run_path() {
  local out rc
  out="$(jq -nc --arg fp "$1" '{tool_input:{file_path:$fp}}' | bash "$HOOK" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_path

# run_raw <stdin> — feed arbitrary bytes; prints "<exit>|<output>".
run_raw() {
  local out rc
  out="$(printf '%s' "$1" | bash "$HOOK" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_raw

# expect_silent_exit0 <case> <result> — the contract of every skip branch: exit
# 0 and not one byte of output (an eslint run would print at least its summary).
expect_silent_exit0() {
  local desc="$1" rc="${2%%|*}" out="${2#*|}"
  if [ "$rc" -eq 0 ] && [ -z "$out" ]; then
    ok "$desc"
  else
    bad "$desc — expected silent exit 0, got exit $rc: $out"
  fi
}
readonly -f expect_silent_exit0

echo "=== post-edit-lint.sh tests ==="

expect_silent_exit0 "a non-TS/JS file (web/src/foo.py) is skipped" "$(run_path "web/src/foo.py")"
expect_silent_exit0 "a Markdown file under web/ is skipped" "$(run_path "/abs/project/web/README.md")"
expect_silent_exit0 "a test file (web/src/foo.test.ts) is skipped before any lint" "$(run_path "web/src/foo.test.ts")"
expect_silent_exit0 "a .test.tsx file is skipped" "$(run_path "/abs/project/web/src/Foo.test.tsx")"
expect_silent_exit0 "a coverage artifact (web/src/coverage/foo.ts) is skipped" "$(run_path "web/src/coverage/foo.ts")"
expect_silent_exit0 "a node_modules path is skipped" "$(run_path "node_modules/pkg/foo.ts")"
expect_silent_exit0 "a nested node_modules path under web/ is skipped" "$(run_path "/abs/project/web/node_modules/pkg/index.js")"
expect_silent_exit0 "a .ts file outside web/ (packages/ui/src/foo.ts) is skipped" "$(run_path "packages/ui/src/foo.ts")"
expect_silent_exit0 "a .tsx file outside web/ (apps/docs/app/page.tsx) is skipped" "$(run_path "/abs/project/apps/docs/app/page.tsx")"
expect_silent_exit0 "a .js file under mcp-server/ is skipped" "$(run_path "mcp-server/src/index.js")"
expect_silent_exit0 "a Bash tool payload (tool_input.command) that is not a TS path is skipped" \
  "$(run_raw "$(jq -nc '{tool_input:{command:"cat web/src/notes.md"}}')")"
expect_silent_exit0 "a payload with neither file_path nor command is skipped" "$(run_raw '{"tool_input":{}}')"
expect_silent_exit0 "an empty stdin is skipped" "$(run_raw '')"
expect_silent_exit0 "non-JSON stdin is skipped (jq failure falls through to the extension filter)" "$(run_raw 'this is not json')"

# The extension filter is a suffix match: a directory or file merely NAMED
# like an extension must not slip through it into the lint path.
expect_silent_exit0 "a path ending in .ts.bak is not a TypeScript file" "$(run_path "/abs/project/web/src/foo.ts.bak")"

echo
echo "post-edit-lint.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
