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

# The cloud-agent-only prefix the gate requires on a handler that
# .claude/settings.json also wires (literal text, not expanded here).
# shellcheck disable=SC2016
readonly GUARD='[ -n \"${COPILOT_AGENT_PROMPT+x}\" ] || exit 0; '
# A Claude-format .claude/settings.json wiring on-stop.sh to Stop and
# on-session-start.sh to SessionStart, spelled the way the real file is.
# shellcheck disable=SC2016
readonly SETTINGS='{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-stop.sh\""}]}],"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'

echo "=== check-copilot-hooks.sh tests ==="

# mkcase <name> <json> [settings-json] — a hooks dir holding one file, and a
# repo root with .claude/hooks/{on-stop,on-session-start,xon-stop}.sh and
# scripts/arch-check.sh, plus .claude/settings.json when a third arg is given.
mkcase() {
  local name="$1" json="$2" settings="${3:-}"
  mkdir -p "$TMP/$name/hooks" "$TMP/$name/root/.claude/hooks" "$TMP/$name/root/scripts"
  : > "$TMP/$name/root/.claude/hooks/on-stop.sh"
  : > "$TMP/$name/root/.claude/hooks/on-session-start.sh"
  : > "$TMP/$name/root/.claude/hooks/xon-stop.sh"
  : > "$TMP/$name/root/scripts/arch-check.sh"
  printf '%s\n' "$json" > "$TMP/$name/hooks/hooks.json"
  if [ -n "$settings" ]; then printf '%s\n' "$settings" > "$TMP/$name/root/.claude/settings.json"; fi
}
readonly -f mkcase

# run <name> — runs the gate on a case; sets OUT, RC and ERRORS (error lines).
run() {
  OUT="$(COPILOT_HOOKS_DIR="$TMP/$1/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/$1/root" bash "$GATE" 2>&1)"
  RC=$?
  ERRORS="$(grep -c '^::error' <<<"$OUT")"
}
readonly -f run

# expect_fail <name> <json> <substring> <label> [settings-json]
expect_fail() {
  mkcase "$1" "$2" "${5:-}"
  run "$1"
  if [ "$RC" -eq 1 ] && grep -qF -- "$3" <<<"$OUT"; then pass "$4"; else fail "$4 (rc=$RC): $OUT"; fi
}
readonly -f expect_fail

# expect_one_fail <name> <json> <substring> <label> [settings-json] — as
# expect_fail, and the substring's error is the ONLY error printed.
expect_one_fail() {
  mkcase "$1" "$2" "${5:-}"
  run "$1"
  if [ "$RC" -eq 1 ] && grep -qF -- "$3" <<<"$OUT" && [ "$ERRORS" -eq 1 ]; then
    pass "$4"
  else
    fail "$4 (rc=$RC, $ERRORS error line(s)): $OUT"
  fi
}
readonly -f expect_one_fail

# expect_pass <name> <json> <label> [settings-json]
expect_pass() {
  mkcase "$1" "$2" "${4:-}"
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

# ---- end-of-turn scripts: the defect this gate exists for, through every field.
# Each is reported ONCE: the mis-wiring, not also "no hook runs it".
expect_one_fail per-tool \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'on-stop.sh runs at the end of a turn, but is wired to "postToolUse"' \
  "on-stop.sh on postToolUse fails, with exactly one error"
expect_one_fail per-tool-ps \
  '{"version":1,"hooks":{"preToolUse":[{"type":"command","bash":"true","powershell":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "preToolUse"' \
  "on-stop.sh reached only through powershell fails, with exactly one error"
expect_one_fail per-tool-command \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","command":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "postToolUse"' \
  "on-stop.sh reached through the cross-platform command field fails, with exactly one error"
expect_one_fail per-tool-exec \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","exec":"bash","args":[".claude/hooks/on-stop.sh"]}]}}' \
  'wired to "postToolUse"' \
  "on-stop.sh reached through exec + args fails, with exactly one error"
expect_one_fail per-tool-alias \
  '{"version":1,"hooks":{"PostToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'wired to "PostToolUse"' \
  "on-stop.sh on the PostToolUse alias fails, with exactly one error"
expect_pass session-end '{"version":1,"hooks":{"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on sessionEnd passes"
expect_pass session-end-alias '{"version":1,"hooks":{"SessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on the documented SessionEnd alias passes"
expect_pass stop-alias '{"version":1,"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on the documented Stop alias passes"
# Unwired (or renamed along with its hook entry): the wrong-event rule above
# then matches nothing, so the gate must fail on that rather than pass. The
# fixture is otherwise valid, so this rule is the only thing that can report.
expect_one_fail unwired \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh wired to no end-of-turn event fails (unwired or renamed), and is the only error"
# Text that merely CONTAINS the name is not a hook running the script.
expect_one_fail disabled-suffix \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh.disabled"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh.disabled on agentStop does not count as running on-stop.sh"
expect_one_fail commented-out \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"true # bash .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "a commented-out on-stop.sh on agentStop does not count as running it"
expect_one_fail other-name \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/xon-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "a script whose name only ENDS in on-stop.sh does not count as on-stop.sh"
mkcase gone-on-stop '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}'
rm "$TMP/gone-on-stop/root/.claude/hooks/on-stop.sh"
run gone-on-stop
if [ "$RC" -eq 1 ] && grep -qF '.claude/hooks/on-stop.sh, which does not exist' <<<"$OUT" \
  && grep -qF 'no hook runs on-stop.sh on an end-of-turn event' <<<"$OUT"; then
  pass "an on-stop.sh reference to a missing file does not count as wired"
else
  fail "a missing on-stop.sh counted as wired (rc=$RC): $OUT"
fi

# ---- events
expect_fail unknown-event \
  '{"version":1,"hooks":{"userPromptSubmit":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}]}}' \
  '"userPromptSubmit" is not a documented Copilot hook event or alias' \
  "an undocumented event name (a camelCase/PascalCase mix-up) fails"
expect_pass permission-request-alias \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"PermissionRequest":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}]}}' \
  "the documented PermissionRequest alias passes"

# ---- referenced scripts
expect_fail missing-hook-script \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/gone.sh"}]}}' \
  '.claude/hooks/gone.sh, which does not exist' \
  "a missing .claude/hooks script fails"
expect_fail missing-repo-script \
  '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"./scripts/arch-check-renamed.sh"}]}}' \
  './scripts/arch-check-renamed.sh, which does not exist' \
  "a missing ./scripts script fails"
# A handler's command runs in its `cwd`: resolve the script there, not at the
# root. Both directions, so neither a root-only nor a cwd-only lookup passes.
expect_fail cwd-miss \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"command","bash":"./scripts/arch-check.sh","cwd":"web"}]}}' \
  './scripts/arch-check.sh, which does not exist' \
  "a script that exists at the root but not under the handler's cwd fails"
expect_pass cwd-hit \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"command","bash":"./arch-check.sh","cwd":"scripts"}]}}' \
  "a script resolved under the handler's cwd passes"
expect_fail nothing-to-run \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command"}]}}' \
  'handler names nothing to run' \
  "a handler with no bash/powershell/command/exec fails"

# ---- double run: Copilot CLI also runs .claude/settings.json's hooks
expect_one_fail dup-unguarded \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  "a script wired to the same event in .github/hooks and .claude/settings.json fails (Stop = agentStop)" \
  "$SETTINGS"
expect_pass dup-guarded \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}]}}" \
  "the same handler made cloud-agent-only (guard prefix, bash field only) passes" \
  "$SETTINGS"
expect_one_fail dup-guarded-powershell \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\",\"powershell\":\"bash .claude/hooks/on-stop.sh\"}]}}" \
  'also runs on "Stop"' \
  "a guarded handler that keeps a powershell field (CLI-only on Windows) still fails" \
  "$SETTINGS"
expect_one_fail dup-guard-late \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"bash .claude/hooks/on-stop.sh; ${GUARD}true\"}]}}" \
  'also runs on "Stop"' \
  "a guard that does not start the command (the script already ran) fails" \
  "$SETTINGS"
expect_one_fail dup-alias-folded \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}],\"sessionStart\":[{\"type\":\"command\",\"bash\":\"bash .claude/hooks/on-session-start.sh\"}]}}" \
  '"sessionStart" runs .claude/hooks/on-session-start.sh, which .claude/settings.json also runs on "SessionStart"' \
  "sessionStart and its SessionStart alias count as the same event" \
  "$SETTINGS"
expect_pass dup-other-event \
  '{"version":1,"hooks":{"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "the same script on a DIFFERENT event than .claude/settings.json wires it is not a double run" \
  "$SETTINGS"
expect_one_fail settings-unreadable-scripts \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'no script path could be read from any of them' \
  "a .claude/settings.json whose hook commands yield no script fails instead of cross-checking nothing" \
  '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node /opt/hooks/stop.js"}]}]}}'
expect_one_fail settings-bad-json \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '.claude/settings.json: not valid JSON' \
  "an invalid .claude/settings.json fails" \
  '{"hooks":{'

# ---- file shape
expect_fail bad-json '{"version":1,"hooks":{' 'not valid JSON' "invalid JSON fails"
expect_fail no-version '{"hooks":{}}' '"version" must be 1' "a missing version fails"
expect_fail hooks-array '{"version":1,"hooks":[]}' 'missing a "hooks" object' "a hooks array fails"
expect_fail handler-string \
  '{"version":1,"hooks":{"agentStop":"bash .claude/hooks/on-stop.sh"}}' \
  '"agentStop" must be an array of handlers' \
  "a handler list that is a string fails instead of being read character by character"

# ---- output: a repository-relative path, annotated on the file
mkdir -p "$TMP/labels/root/.github/hooks" "$TMP/labels/root/.claude/hooks"
: > "$TMP/labels/root/.claude/hooks/on-stop.sh"
printf '%s\n' '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  > "$TMP/labels/root/.github/hooks/hooks.json"
OUT="$(COPILOT_HOOKS_DIR="$TMP/labels/root/.github/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/labels/root" bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && grep -qxF '::error file=.github/hooks/hooks.json::.github/hooks/hooks.json: on-stop.sh runs at the end of a turn, but is wired to "postToolUse" — use one of: agentStop, Stop, sessionEnd, SessionEnd' <<<"$OUT"; then
  pass "errors name the file repository-relative and as a GitHub file annotation"
else
  fail "error label (rc=$RC): $OUT"
fi

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

# ---- the committed files, through the production path (no seams). The
# double-run cross-check must have read the real .claude/settings.json: a
# count of 0 means it compared against nothing.
OUT="$(bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && grep -qE 'cross-checked against [1-9][0-9]* script hook\(s\) in \.claude/settings\.json' <<<"$OUT"; then
  pass "the committed .github/hooks files pass, cross-checked against the real .claude/settings.json"
else
  fail "committed .github/hooks (rc=$RC): $OUT"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then echo "All check-copilot-hooks tests passed."; exit 0; fi
echo "$FAILURES test(s) failed."
exit 1
