#!/usr/bin/env bash
# Tests for .claude/hooks/on-stop.sh — the Stop hook every AI-tool config wires
# (#8694). The hook has two jobs and one contract: run the worktree safety
# commit synchronously, fire the GitHub sync in the background, and ALWAYS
# exit 0 so a failing sub-script can never wedge the CLI.
#
# Hermetic: the hook is copied into a temp dir beside stub sub-scripts, so
# SCRIPT_DIR resolves to the temp dir and the real sync-to-github.sh (network,
# gh) and worktree-safety-commit.sh (git) are never run. Each stub records a
# marker file, which is how the suite proves the sub-script was invoked at all
# rather than only that the hook exited 0 (lesson #11).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-stop.sh"
[ -f "$HOOK" ] || { echo "FAIL hook not found: $HOOK"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# mkfixture <safety-exit> <sync-exit> [<sync-delay-seconds>] — a fresh hook
# copy with stub sub-scripts that exit with the given codes after touching a
# marker. The sync stub can sleep first, so the suite can tell a backgrounded
# call from a synchronous one. BOTH stubs write to stdout AND stderr on every
# path: the "nothing leaks" assertion below is only a test if the sub-scripts
# are capable of leaking (the real safety commit prints git's commit summary on
# stdout; a stub that stayed silent made that assertion unfalsifiable).
mkfixture() {
  local dir="$TMP/fx-$RANDOM$RANDOM"
  mkdir -p "$dir"
  cp "$HOOK" "$dir/on-stop.sh"
  printf '#!/usr/bin/env bash\necho "SAFETY-STDOUT-LEAK"\necho "SAFETY-STDERR-LEAK" >&2\ntouch "%s/safety.ran"\nexit %s\n' "$dir" "$1" > "$dir/worktree-safety-commit.sh"
  printf '#!/usr/bin/env bash\necho "SYNC-STDOUT-LEAK"\necho "SYNC-STDERR-LEAK" >&2\nsleep %s\ntouch "%s/sync.ran"\nexit %s\n' "${3:-0}" "$dir" "$2" > "$dir/sync-to-github.sh"
  chmod +x "$dir"/*.sh
  echo "$dir"
}
readonly -f mkfixture

# wait_for <file> — poll up to ~5s for a marker the background stub writes.
wait_for() {
  for _ in $(seq 1 50); do
    [ -e "$1" ] && return 0
    sleep 0.1
  done
  return 1
}
readonly -f wait_for

echo "=== on-stop.sh tests ==="

# ---- 1. both sub-scripts succeed -> exit 0, both invoked, nothing printed ---
d="$(mkfixture 0 0)"
out="$(bash "$d/on-stop.sh" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then ok "exit 0 when both sub-scripts succeed"; else bad "expected exit 0, got $rc: $out"; fi
case "$out" in
  *SAFETY-STDOUT-LEAK*) bad "the safety commit's stdout (git's commit summary in production) leaks through the hook" ;;
  *SAFETY-STDERR-LEAK*) bad "the safety commit's stderr leaks through the hook" ;;
  *SYNC-*) bad "the backgrounded sync's output leaks through the hook: $out" ;;
  "") ok "a successful safety commit prints nothing through the hook (stdout and stderr both dropped)" ;;
  *) bad "hook printed something unexpected: $out" ;;
esac
if [ -e "$d/safety.ran" ]; then ok "worktree-safety-commit.sh was invoked"; else bad "worktree-safety-commit.sh never ran"; fi
if wait_for "$d/sync.ran"; then ok "sync-to-github.sh was invoked"; else bad "sync-to-github.sh never ran"; fi

# ---- 2. both sub-scripts fail -> still exit 0, and nothing leaks to output ---
d="$(mkfixture 1 1)"
out="$(bash "$d/on-stop.sh" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then ok "exit 0 when both sub-scripts fail (their exit codes are not propagated)"; else bad "expected exit 0 with failing sub-scripts, got $rc: $out"; fi
if [ -z "$out" ]; then ok "a failing sub-script prints nothing through the hook"; else bad "hook leaked output: $out"; fi
if [ -e "$d/safety.ran" ]; then ok "worktree-safety-commit.sh still ran"; else bad "worktree-safety-commit.sh did not run"; fi
if wait_for "$d/sync.ran"; then ok "sync-to-github.sh still ran"; else bad "sync-to-github.sh did not run"; fi

# ---- 3. the safety commit is synchronous, the sync is backgrounded -----------
# The sync stub sleeps 3s before writing its marker; the hook must return well
# before that (it does not wait), while the safety marker must already exist
# when the hook returns (it does wait for that one).
d="$(mkfixture 0 0 3)"
start=$SECONDS
bash "$d/on-stop.sh" >/dev/null 2>&1; rc=$?
elapsed=$((SECONDS - start))
if [ "$rc" -eq 0 ] && [ "$elapsed" -lt 3 ]; then
  ok "the hook returns without waiting for sync-to-github.sh (${elapsed}s)"
else
  bad "the hook blocked on the backgrounded sync (rc=$rc, ${elapsed}s)"
fi
if [ -e "$d/safety.ran" ]; then ok "worktree-safety-commit.sh had completed before the hook returned"; else bad "the safety commit was not awaited"; fi
if [ ! -e "$d/sync.ran" ]; then ok "sync-to-github.sh was still running when the hook returned (backgrounded)"; else bad "sync marker present immediately — the sync ran synchronously"; fi
wait_for "$d/sync.ran" >/dev/null || true

# ---- 4. a missing sub-script does not break the hook -------------------------
d="$(mkfixture 0 0)"
rm -f "$d/sync-to-github.sh"
out="$(bash "$d/on-stop.sh" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then ok "exit 0 even when sync-to-github.sh is missing"; else bad "expected exit 0 with a missing sub-script, got $rc: $out"; fi

echo
echo "on-stop.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
