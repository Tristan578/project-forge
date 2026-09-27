#!/usr/bin/env bash
# Unit tests for scripts/check-copilot-hooks.sh (#8769).
#
# Hermetic: each case builds a throwaway hooks dir and repo root under mktemp
# and drives the gate through its two seams, then the last case runs it against
# the real .github/hooks so a drifted committed file fails this suite too.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-copilot-hooks.sh"
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { echo "  PASS: $1"; }
readonly -f pass
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
readonly -f fail

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

echo "=== check-copilot-hooks.sh tests ==="

# mkcase <name> <json> — a hooks dir holding one file, and a repo root with
# .claude/hooks/{on-stop,on-session-start}.sh and scripts/arch-check.sh.
mkcase() {
  local name="$1" json="$2"
  mkdir -p "$TMP/$name/hooks" "$TMP/$name/root/.claude/hooks" "$TMP/$name/root/scripts"
  : > "$TMP/$name/root/.claude/hooks/on-stop.sh"
  : > "$TMP/$name/root/.claude/hooks/on-session-start.sh"
  : > "$TMP/$name/root/scripts/arch-check.sh"
  printf '%s\n' "$json" > "$TMP/$name/hooks/hooks.json"
}
readonly -f mkcase

# run <name> — runs the gate on a case; sets OUT and RC.
run() {
  OUT="$(COPILOT_HOOKS_DIR="$TMP/$1/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/$1/root" bash "$GATE" 2>&1)"
  RC=$?
}
readonly -f run

# expect_fail <name> <json> <substring> <label>
expect_fail() {
  mkcase "$1" "$2"
  run "$1"
  if [ "$RC" -eq 1 ] && grep -qF -- "$3" <<<"$OUT"; then pass "$4"; else fail "$4 (rc=$RC): $OUT"; fi
}
readonly -f expect_fail

# expect_pass <name> <json> <label>
expect_pass() {
  mkcase "$1" "$2"
  run "$1"
  if [ "$RC" -eq 0 ]; then pass "$3"; else fail "$3 (rc=$RC): $OUT"; fi
}
readonly -f expect_pass

mkcase good '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}],"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh","powershell":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"command","bash":"./scripts/arch-check.sh"}]}}'
run good
if [ "$RC" -eq 0 ] && grep -qF "1 file(s), 3 handler(s)" <<<"$OUT"; then
  pass "a correct file passes and reports what it scanned"
else
  fail "a correct file passes (rc=$RC): $OUT"
fi

# ---- end-of-turn scripts: the defect this gate exists for, through every field
expect_fail per-tool \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'on-stop.sh runs at the end of a turn, but is wired to "postToolUse"' \
  "on-stop.sh on postToolUse fails"
expect_fail per-tool-ps \
  '{"version":1,"hooks":{"preToolUse":[{"type":"command","bash":"true","powershell":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "preToolUse"' \
  "on-stop.sh reached only through powershell fails"
expect_fail per-tool-command \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","command":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "postToolUse"' \
  "on-stop.sh reached through the cross-platform command field fails"
expect_fail per-tool-exec \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","exec":"bash","args":[".claude/hooks/on-stop.sh"]}]}}' \
  'wired to "postToolUse"' \
  "on-stop.sh reached through exec + args fails"
expect_pass session-end '{"version":1,"hooks":{"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on sessionEnd passes"
expect_pass stop-alias '{"version":1,"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on the documented Stop alias passes"
expect_fail per-tool-alias \
  '{"version":1,"hooks":{"PostToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "PostToolUse"' \
  "on-stop.sh on the PostToolUse alias fails"

# ---- events
expect_fail unknown-event \
  '{"version":1,"hooks":{"userPromptSubmit":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}]}}' \
  '"userPromptSubmit" is not a documented Copilot hook event or alias' \
  "an undocumented event name (a camelCase/PascalCase mix-up) fails"

# ---- referenced scripts
expect_fail missing-hook-script \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/gone.sh"}]}}' \
  '.claude/hooks/gone.sh, which does not exist' \
  "a missing .claude/hooks script fails"
expect_fail missing-repo-script \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"./scripts/arch-check-renamed.sh"}]}}' \
  './scripts/arch-check-renamed.sh, which does not exist' \
  "a missing ./scripts script fails"
expect_fail nothing-to-run \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command"}]}}' \
  'handler names nothing to run' \
  "a handler with no bash/powershell/command/exec fails"

# ---- file shape
expect_fail bad-json '{"version":1,"hooks":{' 'not valid JSON' "invalid JSON fails"
expect_fail no-version '{"hooks":{}}' '"version" must be 1' "a missing version fails"
expect_fail hooks-array '{"version":1,"hooks":[]}' 'missing a "hooks" object' "a hooks array fails"
expect_fail handler-string \
  '{"version":1,"hooks":{"agentStop":"bash .claude/hooks/on-stop.sh"}}' \
  '"agentStop" must be an array of handlers' \
  "a handler list that is a string fails instead of being read character by character"

# ---- running on nothing, or without node
mkdir -p "$TMP/empty/hooks" "$TMP/empty/root"
run empty
if [ "$RC" -eq 1 ] && grep -qF "no hook files found" <<<"$OUT"; then
  pass "an empty hooks dir fails instead of passing vacuously"
else
  fail "an empty hooks dir (rc=$RC): $OUT"
fi
OUT="$(COPILOT_HOOKS_DIR="$TMP/does-not-exist" COPILOT_HOOKS_REPO_ROOT="$TMP/empty/root" bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && grep -qF "cannot read the hook directory" <<<"$OUT"; then
  pass "a hooks dir that does not exist fails"
else
  fail "a missing hooks dir (rc=$RC): $OUT"
fi
mkdir -p "$TMP/nobin"
BASH_BIN="$(command -v bash)"
OUT="$(PATH="$TMP/nobin" COPILOT_HOOKS_DIR="$TMP/good/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/good/root" "$BASH_BIN" "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 2 ] && grep -qF "node not found" <<<"$OUT"; then
  pass "no node on PATH is exit 2 (could not run), never a pass"
else
  fail "no node on PATH (rc=$RC): $OUT"
fi

# ---- the committed files, through the production path (no seams)
OUT="$(bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then pass "the committed .github/hooks files pass"; else fail "committed .github/hooks (rc=$RC): $OUT"; fi

echo ""
if [ "$FAILURES" -eq 0 ]; then echo "All check-copilot-hooks tests passed."; exit 0; fi
echo "$FAILURES test(s) failed."
exit 1
