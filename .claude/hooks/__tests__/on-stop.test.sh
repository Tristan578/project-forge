#!/usr/bin/env bash
# Tests for on-stop.sh (Stop hook, all AI tools) — #8694.
#
# Contract under test:
#   - runs worktree-safety-commit.sh synchronously, then backgrounds
#     sync-to-github.sh, and ALWAYS exits 0 — a failing sub-script must never
#     turn the AI's stop event into a hook error (their exit codes and output
#     are deliberately discarded).
#   - the hook resolves both sub-scripts from its OWN directory, so copying the
#     hook into a temp dir next to stub scripts makes the run hermetic: the
#     real sync-to-github.sh (git + gh + network) is never reached.
#
# Run: bash .claude/hooks/__tests__/on-stop.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-stop.sh"

pass=0
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# stage <commit_exit> <sync_exit> -> copies the hook next to two stub
# sub-scripts that record they ran and exit with the given codes.
stage() {
  cp "$HOOK" "$TMP/on-stop.sh"
  rm -f "$TMP/commit.ran" "$TMP/sync.ran"
  printf '#!/usr/bin/env bash\ntouch "%s/commit.ran"\nexit %s\n' "$TMP" "$1" > "$TMP/worktree-safety-commit.sh"
  printf '#!/usr/bin/env bash\ntouch "%s/sync.ran"\nexit %s\n' "$TMP" "$2" > "$TMP/sync-to-github.sh"
  chmod +x "$TMP/worktree-safety-commit.sh" "$TMP/sync-to-github.sh" "$TMP/on-stop.sh"
}

# run_staged -> prints "<exit code>|<stdout+stderr>"
run_staged() {
  local out rc
  out="$(bash "$TMP/on-stop.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# wait_for <file> -> waits up to ~2 s for the backgrounded stub to touch it.
wait_for() {
  local _tick
  for _tick in $(seq 1 20); do
    [ -e "$1" ] && return 0
    sleep 0.1
  done
  return 1
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL %s (expected %s, got %s)\n' "$desc" "$expected" "$actual"
  fi
}

echo "on-stop.sh"

# --- both sub-scripts succeed ---------------------------------------------
stage 0 0
res="$(run_staged)"
assert_eq "exits 0 when both sub-scripts succeed" "0" "${res%%|*}"
assert_eq "prints nothing on the happy path" "" "${res#*|}"
assert_eq "ran the synchronous safety commit" "yes" "$([ -e "$TMP/commit.ran" ] && echo yes || echo no)"
assert_eq "fired the background GitHub sync" "yes" "$(wait_for "$TMP/sync.ran" && echo yes || echo no)"

# --- both sub-scripts fail -------------------------------------------------
stage 1 1
res="$(run_staged)"
assert_eq "exits 0 even when both sub-scripts fail (their codes are discarded)" "0" "${res%%|*}"
assert_eq "prints nothing when both sub-scripts fail (output discarded)" "" "${res#*|}"
assert_eq "still attempted the safety commit" "yes" "$([ -e "$TMP/commit.ran" ] && echo yes || echo no)"

# --- the safety commit failing must not stop the sync from being fired ----
stage 1 0
res="$(run_staged)"
assert_eq "exits 0 when only the safety commit fails" "0" "${res%%|*}"
assert_eq "still fires the GitHub sync after a failed safety commit" "yes" "$(wait_for "$TMP/sync.ran" && echo yes || echo no)"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ] || exit 1
