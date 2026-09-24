#!/usr/bin/env bash
# Tests for post-edit-lint.sh (PostToolUse hook, all AI tools) — #8694.
#
# Contract under test: every early-exit branch that returns BEFORE the
# `cd "$PROJECT_DIR/web"` + `npx eslint` call. Those branches are pure path
# filtering, so they are fully hermetic: no ESLint, no install, no network.
#
#   exit 0, no output   for a non-TS/JS file
#   exit 0, no output   for a *.test.* file (never lint tests per edit)
#   exit 0, no output   for anything under /coverage/ or node_modules
#   exit 0, no output   for a TS file that is not under /web/ (the eslint
#                       config is web-specific)
#   exit 0, no output   for malformed / empty stdin (jq yields empty, which
#                       is "not a TS file")
#
# The branch that actually shells out to eslint (a real web/src/*.ts path)
# is deliberately NOT exercised here — it needs a full web/ install and is
# the job of the quality gate, not a hook unit test.
#
# Run: bash .claude/hooks/__tests__/post-edit-lint.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../post-edit-lint.sh"

pass=0
fail=0

# run_hook <file_path> -> prints "<exit code>|<stdout+stderr>"
run_hook() {
  local out rc
  out="$(jq -nc --arg fp "$1" '{tool_input:{file_path:$fp}}' | bash "$HOOK" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# run_hook_raw <stdin bytes> -> same shape, feeding stdin verbatim
run_hook_raw() {
  local out rc
  out="$(printf '%s' "$1" | bash "$HOOK" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

assert_silent_exit0() {
  local desc="$1" res="$2"
  local rc="${res%%|*}" out="${res#*|}"
  if [ "$rc" = "0" ] && [ -z "$out" ]; then
    pass=$((pass + 1))
    printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL %s (expected exit 0 with no output, got exit %s, output: %s)\n' "$desc" "$rc" "$out"
  fi
}

echo "post-edit-lint.sh"

assert_silent_exit0 "a non-TS/JS file is ignored" \
  "$(run_hook "web/src/foo.py")"
assert_silent_exit0 "a Markdown file is ignored" \
  "$(run_hook "docs/guides/foo.md")"
assert_silent_exit0 "a *.test.ts file under web/ is skipped before any lint attempt" \
  "$(run_hook "web/src/foo.test.ts")"
assert_silent_exit0 "a *.test.tsx file under web/ is skipped before any lint attempt" \
  "$(run_hook "web/src/components/Foo.test.tsx")"
assert_silent_exit0 "a file under /coverage/ is skipped" \
  "$(run_hook "web/coverage/foo.ts")"
assert_silent_exit0 "a file under node_modules is skipped" \
  "$(run_hook "node_modules/pkg/foo.ts")"
assert_silent_exit0 "a TS file outside /web/ is skipped (eslint config is web-only)" \
  "$(run_hook "packages/ui/src/foo.ts")"
assert_silent_exit0 "a JS file outside /web/ is skipped" \
  "$(run_hook "mcp-server/src/foo.js")"
assert_silent_exit0 "empty stdin is a no-op" \
  "$(run_hook_raw "")"
assert_silent_exit0 "non-JSON stdin is a no-op" \
  "$(run_hook_raw "not json at all")"
assert_silent_exit0 "JSON without tool_input is a no-op" \
  "$(run_hook_raw '{"tool_name":"Edit"}')"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ] || exit 1
