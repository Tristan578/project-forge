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
# .claude/settings.json also wires (literal text, not expanded here, and
# JSON-escaped). GUARD_BARE ends at the guard's `;`; GUARD is the spelling the
# committed files use, with one space before the command.
# shellcheck disable=SC2016
readonly GUARD_BARE='[ -n \"${COPILOT_AGENT_PROMPT+x}\" ] || exit 0;'
readonly GUARD="$GUARD_BARE "
# A Claude-format .claude/settings.json wiring on-stop.sh to Stop and
# on-session-start.sh to SessionStart, spelled the way the real file is.
# shellcheck disable=SC2016
readonly SETTINGS='{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-stop.sh\""}]}],"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'
# As SETTINGS, but Stop's on-stop.sh reference is commented out: only
# on-session-start.sh is live, so the cross-check still has a script to read.
# shellcheck disable=SC2016
readonly SETTINGS_STOP_COMMENTED='{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"true # bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-stop.sh\""}]}],"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'
# Hook commands, but nothing on Stop: on-stop.sh is not wired at all.
# shellcheck disable=SC2016
readonly SETTINGS_NO_STOP='{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'

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
# sessionEnd fires once per session, not per turn: allowed as an EXTRA run,
# never as the per-turn wiring (#10305 review).
expect_one_fail session-end-only '{"version":1,"hooks":{"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh on sessionEnd alone does not satisfy the per-turn wiring"
expect_one_fail session-end-alias-only '{"version":1,"hooks":{"SessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh on the SessionEnd alias alone does not satisfy the per-turn wiring"
expect_pass session-end-plus-agent-stop \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"sessionEnd":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on sessionEnd as well as agentStop passes"
expect_pass stop-alias '{"version":1,"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh on the documented Stop alias passes"
# Unwired (or renamed along with its hook entry): the wrong-event rule above
# then matches nothing, so the gate must fail on that rather than pass. The
# fixture is otherwise valid, so this rule is the only thing that can report.
expect_one_fail unwired \
  '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"bash .claude/hooks/on-session-start.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh wired to no end-of-turn event fails (unwired or renamed), and is the only error"
# That error names the hooks DIRECTORY, which GitHub cannot annotate: a bare
# `::error::` with no `file=` (the dir is ../hooks from this case's root).
if grep -q '^::error::\.\./hooks: no hook runs on-stop\.sh on an end-of-turn event' <<<"$OUT" \
  && ! grep -qF 'file=' <<<"$OUT"; then
  pass "the unwired error names the directory without a file= annotation"
else
  fail "the unwired error's annotation: $OUT"
fi
# Text that merely CONTAINS the name is not a hook running the script.
expect_one_fail disabled-suffix \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh.disabled"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh.disabled on agentStop does not count as running on-stop.sh"
expect_one_fail commented-out \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"true # bash .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "a commented-out on-stop.sh on agentStop does not count as running it"
# A path that is only NAMED (echo, test, an exec of something else) runs
# nothing, so it is not the wiring (#10305 review).
expect_one_fail echoed \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"echo .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "an echoed on-stop.sh path on agentStop does not count as running it"
expect_one_fail guarded-echo \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}echo .claude/hooks/on-stop.sh\"}]}}" \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "an echoed on-stop.sh after the cloud-only guard does not count as running it"
expect_one_fail test-f \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"test -f .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "test -f on-stop.sh does not count as running it"
expect_one_fail exec-echo \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","exec":"echo","args":[".claude/hooks/on-stop.sh"]}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "exec echo with on-stop.sh as its argument does not count as running it"
expect_one_fail passed-as-argument \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/xon-stop.sh .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "on-stop.sh passed as an argument to another script does not count as running it"
expect_pass test-then-run \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"[ -f .claude/hooks/on-stop.sh ] && bash .claude/hooks/on-stop.sh"}]}}' \
  "a test of on-stop.sh followed by running it passes"
expect_pass exec-bash-args \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","exec":"bash","args":[".claude/hooks/on-stop.sh"]}]}}' \
  "exec bash with on-stop.sh as its argument runs it"
expect_pass direct-run \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"FOO=1 exec ./.claude/hooks/on-stop.sh"}]}}' \
  "on-stop.sh as the command itself (after VAR=value and exec) runs it"
expect_pass bash-flags \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash -eu .claude/hooks/on-stop.sh"}]}}' \
  "bash with flags before on-stop.sh runs it"
# A comment ends at its newline: one on an earlier line of a multi-line
# command does not comment out a script on a later line.
expect_pass comment-on-earlier-line \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"# commit and sync\nbash .claude/hooks/on-stop.sh"}]}}' \
  "a # comment on an earlier line does not comment out on-stop.sh"
expect_one_fail comment-same-line-after-newline \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"true\ntrue # bash .claude/hooks/on-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "a # earlier on on-stop.sh's own line still comments it out"
# A path that runs nothing is not required to exist.
expect_pass commented-missing \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh # was: bash scripts/gone.sh"}]}}' \
  "a commented-out reference to a missing script does not fail the existence check"
expect_pass echoed-missing \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"echo scripts/gone.sh; bash .claude/hooks/on-stop.sh"}]}}' \
  "an echoed path to a missing script does not fail the existence check"
expect_one_fail other-name \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/xon-stop.sh"}]}}' \
  'no hook runs on-stop.sh on an end-of-turn event' \
  "a script whose name only ENDS in on-stop.sh does not count as on-stop.sh"
expect_pass other-name-elsewhere \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"command","bash":"bash .claude/hooks/xon-stop.sh"}]}}' \
  "a script whose name only ENDS in on-stop.sh may run on a per-tool event"
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
# Each problem is printed once: bash and powershell naming the same missing
# script are one problem, not two.
expect_one_fail missing-script-twice \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"sessionStart":[{"type":"command","bash":"bash .claude/hooks/gone.sh","powershell":"bash .claude/hooks/gone.sh"}]}}' \
  '"sessionStart" runs .claude/hooks/gone.sh, which does not exist' \
  "a missing script named by both bash and powershell is reported once"
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
# A null handler is valid JSON; it is reported, not a crash (#10305 review).
mkcase null-handler '{"version":1,"hooks":{"agentStop":[null,{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}'
run null-handler
if [ "$RC" -eq 1 ] && [ "$ERRORS" -eq 1 ] && grep -qF 'handler names nothing to run' <<<"$OUT"; then
  pass "a null handler is reported as naming nothing to run, without crashing the gate"
else
  fail "a null handler (rc=$RC, $ERRORS error line(s)): $OUT"
fi
expect_pass http-handler \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"http","url":"https://example.com/hook"}]}}' \
  "a documented http handler (a url, no script) passes"
expect_pass prompt-handler \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}],"postToolUse":[{"type":"prompt","prompt":"Check the last tool call."}]}}' \
  "a documented prompt handler (a prompt, no script) passes"

# ---- double run: Copilot CLI also runs .claude/settings.json's hooks
expect_one_fail dup-unguarded \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  "a script wired to the same event in .github/hooks and .claude/settings.json fails (Stop = agentStop)" \
  "$SETTINGS"
# The message's own advice, taken literally, must pass: derive the guard from
# what the gate printed (not from GUARD), JSON-escape it, and put the command
# straight after it with no space.
PRINTED_GUARD="$(sed -n 's/.*that starts with: //p' <<<"$OUT")"
if [ -z "$PRINTED_GUARD" ]; then
  fail "the double-run message names the guard to start with: $OUT"
else
  expect_pass dup-guard-from-message \
    "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${PRINTED_GUARD//\"/\\\"}bash .claude/hooks/on-stop.sh\"}]}}" \
    "a handler that starts with exactly the guard the message prints passes" \
    "$SETTINGS"
fi
expect_pass dup-guarded \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}]}}" \
  "the same handler made cloud-agent-only (guard prefix, bash field only) passes" \
  "$SETTINGS"
# The guard ends at its `;`: no space, or a newline, before the command is the
# same shell program and must pass too.
expect_pass dup-guarded-no-space \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD_BARE}bash .claude/hooks/on-stop.sh\"}]}}" \
  "a guard followed by the command with no space passes" \
  "$SETTINGS"
expect_pass dup-guarded-newline \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD_BARE}\\nbash .claude/hooks/on-stop.sh\"}]}}" \
  "a guard followed by a newline and then the command passes" \
  "$SETTINGS"
# A pipe is not a separator: `[ … ] || exit 0 | bash x` parses as
# `[ … ] || (exit 0 | bash x)`, so the script runs exactly when the guard fails.
expect_one_fail dup-guard-pipe \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD_BARE%;} | bash .claude/hooks/on-stop.sh\"}]}}" \
  'also runs on "Stop"' \
  "a guard joined to the command by a pipe instead of a ';' fails" \
  "$SETTINGS"
expect_one_fail dup-guarded-powershell \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\",\"powershell\":\"bash .claude/hooks/on-stop.sh\"}]}}" \
  'also runs on "Stop"' \
  "a guarded handler that keeps a powershell field (CLI-only on Windows) still fails" \
  "$SETTINGS"
# The other two fields the cloud-agent-only definition excludes, each alone:
# `command` is copied to PowerShell on Windows and `exec` is CLI-only, so either
# one beside a guarded `bash` runs the script unguarded under Copilot CLI.
expect_one_fail dup-guarded-command \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\",\"command\":\"bash .claude/hooks/on-stop.sh\"}]}}" \
  'also runs on "Stop"' \
  "a guarded handler that keeps a command field (the cross-platform fallback) still fails" \
  "$SETTINGS"
expect_one_fail dup-guarded-exec \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\",\"exec\":\"bash\",\"args\":[\".claude/hooks/on-stop.sh\"]}]}}" \
  'also runs on "Stop"' \
  "a guarded handler that keeps an exec field (CLI-only) still fails" \
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
# Aliases fold on the .github/hooks side too: `Stop` there is the `Stop` that
# .claude/settings.json wires, whatever spelling either side uses.
expect_one_fail dup-alias-hooks-side \
  '{"version":1,"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"Stop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  "an unguarded handler on the Stop alias in .github/hooks is a double run too" \
  "$SETTINGS"
# A commented-out reference in .claude/settings.json does not run the script,
# so the unguarded .github/hooks handler is the only one Copilot CLI runs.
expect_pass settings-commented-ref \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  "a commented-out script in .claude/settings.json is not a double run" \
  "$SETTINGS_STOP_COMMENTED"
# The other direction: a guarded handler whose script .claude/settings.json
# does not run on that event never runs under Copilot CLI. It is the only
# error: rule 3 is satisfied (the handler is on agentStop), and settings.json
# has a readable script, so only the new check can report.
expect_one_fail guarded-not-in-settings \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}]}}" \
  '"agentStop" handler is cloud-agent-only, but .claude/settings.json does not run .claude/hooks/on-stop.sh on that event' \
  "a guarded handler for a script .claude/settings.json does not wire to that event fails" \
  "$SETTINGS_NO_STOP"
expect_one_fail guarded-other-event \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}],\"sessionEnd\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}]}}" \
  '"sessionEnd" handler is cloud-agent-only, but .claude/settings.json does not run .claude/hooks/on-stop.sh on that event' \
  "a guarded handler whose script .claude/settings.json wires to a DIFFERENT event (Stop, not sessionEnd) fails" \
  "$SETTINGS"
# Every root prefix SETTINGS_ROOT_PREFIXES strips is read. The real file uses
# only `$(git rev-parse --show-toplevel)/`, so each other spelling gets a case
# of its own. SessionStart stays live in the git-rev-parse spelling: if a prefix
# stopped being read, the cross-check would still have a script, the Stop
# double run would go unseen, and the case would pass instead of failing here.
# shellcheck disable=SC2016
expect_one_fail settings-prefix-braced \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  'a .claude/settings.json script anchored with ${CLAUDE_PROJECT_DIR}/ is cross-checked' \
  '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"${CLAUDE_PROJECT_DIR}/.claude/hooks/on-stop.sh\""}]}],"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'
# shellcheck disable=SC2016
expect_one_fail settings-prefix-bare \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  'a .claude/settings.json script anchored with $CLAUDE_PROJECT_DIR/ is cross-checked' \
  '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/on-stop.sh\""}]}],"SessionStart":[{"hooks":[{"type":"command","command":"bash \"$(git rev-parse --show-toplevel)/.claude/hooks/on-session-start.sh\""}]}]}}'
# The gate reads a .claude/settings.json handler in either shape: nested under
# `hooks` (Claude format, what the real file uses) or listed directly in the
# event's array (Copilot format). A flat Stop handler is a double run too.
expect_one_fail settings-copilot-format \
  '{"version":1,"hooks":{"agentStop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' \
  "a Copilot-format (un-nested) handler in .claude/settings.json is cross-checked" \
  '{"hooks":{"Stop":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}'
expect_pass dup-other-event \
  "{\"version\":1,\"hooks\":{\"agentStop\":[{\"type\":\"command\",\"bash\":\"${GUARD}bash .claude/hooks/on-stop.sh\"}],\"sessionEnd\":[{\"type\":\"command\",\"bash\":\"bash .claude/hooks/on-stop.sh\"}]}}" \
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
# Exactly two errors: the string itself, and (since nothing then runs
# on-stop.sh) the unwired rule. Read character by character, each character
# would also be "a handler that names nothing to run".
mkcase handler-string '{"version":1,"hooks":{"agentStop":"bash .claude/hooks/on-stop.sh"}}'
run handler-string
if [ "$RC" -eq 1 ] && grep -qF '"agentStop" must be an array of handlers' <<<"$OUT" \
  && ! grep -qF 'names nothing to run' <<<"$OUT" && [ "$ERRORS" -eq 2 ]; then
  pass "a handler list that is a string fails instead of being read character by character"
else
  fail "a handler list that is a string (rc=$RC, $ERRORS error line(s)): $OUT"
fi

# ---- output: a repository-relative path, annotated on the file
mkdir -p "$TMP/labels/root/.github/hooks" "$TMP/labels/root/.claude/hooks"
: > "$TMP/labels/root/.claude/hooks/on-stop.sh"
printf '%s\n' '{"version":1,"hooks":{"postToolUse":[{"type":"command","bash":"bash .claude/hooks/on-stop.sh"}]}}' \
  > "$TMP/labels/root/.github/hooks/hooks.json"
# Node on Windows answers path.relative with `\`. WINGATE is the gate with
# Windows path.relative/path.sep, so Linux CI sees the separator the Windows
# job sees (#8769: it failed there on `.github\hooks\hooks.json`). The rest of
# its fs work stays native, so it runs on every platform.
WINGATE="$TMP/check-copilot-hooks.win32.sh"
sed "s|^const path = require('path');\$|const path = Object.assign({}, require('path'), { relative: require('path').win32.relative, sep: require('path').win32.sep });|" \
  "$GATE" > "$WINGATE"
if [ "$(grep -c 'win32.relative' "$WINGATE")" -ne 1 ]; then
  fail "could not build the Windows-separator gate: the gate no longer declares 'const path = require('path');' on its own line"
fi
for gate in "$GATE" "$WINGATE"; do
  OUT="$(COPILOT_HOOKS_DIR="$TMP/labels/root/.github/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/labels/root" bash "$gate" 2>&1)"; RC=$?
  if [ "$RC" -eq 1 ] && grep -qxF '::error file=.github/hooks/hooks.json::.github/hooks/hooks.json: on-stop.sh runs at the end of a turn, but is wired to "postToolUse" — use one of: agentStop, Stop' <<<"$OUT"; then
    pass "errors name the file repository-relative, with '/', as a GitHub file annotation ($(basename "$gate"))"
  else
    fail "error label, $(basename "$gate") (rc=$RC): $OUT"
  fi
  OUT="$(COPILOT_HOOKS_DIR="$TMP/dup-unguarded/hooks" COPILOT_HOOKS_REPO_ROOT="$TMP/dup-unguarded/root" bash "$gate" 2>&1)"; RC=$?
  if [ "$RC" -eq 1 ] && grep -qF '"agentStop" runs .claude/hooks/on-stop.sh, which .claude/settings.json also runs on "Stop"' <<<"$OUT" \
    && ! grep -qF "\\" <<<"$OUT"; then
    pass "the double-run message names the script with '/' ($(basename "$gate"))"
  else
    fail "double-run script path, $(basename "$gate") (rc=$RC): $OUT"
  fi
done

# ---- running on nothing, or without node
mkdir -p "$TMP/empty/hooks" "$TMP/empty/root"
run empty
if [ "$RC" -eq 1 ] && grep -q '^::error::.*no hook files found' <<<"$OUT" && ! grep -qF 'file=' <<<"$OUT"; then
  pass "an empty hooks dir fails instead of passing vacuously (no file= on a directory)"
else
  fail "an empty hooks dir (rc=$RC): $OUT"
fi
OUT="$(COPILOT_HOOKS_DIR="$TMP/does-not-exist" COPILOT_HOOKS_REPO_ROOT="$TMP/empty/root" bash "$GATE" 2>&1)"; RC=$?
if [ "$RC" -eq 1 ] && grep -q '^::error::.*cannot read the hook directory' <<<"$OUT" && ! grep -qF 'file=' <<<"$OUT"; then
  pass "a hooks dir that does not exist fails (no file= on a directory)"
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
