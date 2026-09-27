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
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

echo "=== check-copilot-hooks.sh tests ==="

# mkcase <name> <json> — a hooks dir holding one file, and a repo root whose
# .claude/hooks has on-stop.sh and on-session-start.sh.
mkcase() {
  local name="$1" json="$2"
  mkdir -p "$TMP/$name/hooks" "$TMP/$name/root/.claude/hooks"
  : > "$TMP/$name/root/.claude/hooks/on-stop.sh"
  : > "$TMP/$name/root/.claude/hooks/on-session-start.sh"
  printf '%s\n' "$json" > "$TMP/$name/hooks/hooks.json"
}

# run <name> — runs the gate on a case; sets OUT and RC.
run() {
  OUT="$(COPILOT_HOOKS_DIR="$TMP/$1/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/$1/root" bash "$GATE" 2>&1)"
  RC=$?
}

# expect_fail <name> <json> <substring> <label>
expect_fail() {
  mkcase "$1" "$2"
  run "$1"
  if [ "$RC" -eq 1 ] && grep -qF -- "$3" <<<"$OUT"; then pass "$4"; else fail "$4 (rc=$RC): $OUT"; fi
}

mkcase good '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}],"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh","powershell":"bash .claude/hooks/on-stop.sh"}]}}'
run good
if [ "$RC" -eq 0 ] && grep -qF "1 file(s), 2 handler(s)" <<<"$OUT"; then
  pass "a correct file passes and reports what it scanned"
else
  fail "a correct file passes (rc=$RC): $OUT"
fi

# The defect this gate exists for.
expect_fail per-tool \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'on-stop.sh runs at the end of a turn, but is wired to "postToolUse"' \
  "on-stop.sh on postToolUse fails"

# The powershell variant must be checked too, not only bash.
expect_fail per-tool-ps \
  '{"version":1,"hooks":{"preToolUse":[{"type":"command","bash":"true","powershell":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "preToolUse"' \
  "on-stop.sh reached only through powershell still fails"

mkcase session-end '{"version":1,"hooks":{"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}'
run session-end
if [ "$RC" -eq 0 ]; then pass "on-stop.sh on sessionEnd passes"; else fail "on-stop.sh on sessionEnd (rc=$RC): $OUT"; fi

expect_fail claude-event \
  '{"version":1,"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"Stop" is not a documented Copilot hook event' \
  "a Claude event name fails"

expect_fail missing-script \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/gone.sh"}]}}' \
  '.claude/hooks/gone.sh, which does not exist' \
  "a missing referenced script fails"

expect_fail bad-json '{"version":1,"hooks":{' 'not valid JSON' "invalid JSON fails"

expect_fail no-version '{"hooks":{}}' '"version" must be 1' "a missing version fails"

expect_fail hooks-array '{"version":1,"hooks":[]}' 'missing a "hooks" object' "a hooks array fails"

mkdir -p "$TMP/empty/hooks" "$TMP/empty/root"
run empty
if [ "$RC" -eq 1 ] && grep -qF "no hook files found" <<<"$OUT"; then
  pass "an empty hooks dir fails instead of passing vacuously"
else
  fail "an empty hooks dir (rc=$RC): $OUT"
fi

# The committed files, through the production path (no seams).
OUT="$(bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ]; then pass "the committed .github/hooks files pass"; else fail "committed .github/hooks (rc=$RC): $OUT"; fi

echo ""
if [ "$FAILURES" -eq 0 ]; then echo "All check-copilot-hooks tests passed."; exit 0; fi
echo "$FAILURES test(s) failed."
exit 1
