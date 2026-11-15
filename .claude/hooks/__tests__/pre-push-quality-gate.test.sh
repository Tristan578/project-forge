#!/bin/bash
# Tests for pre-push-quality-gate.sh — the PreToolUse Bash hook that runs tsc
# and eslint over the files a branch changed before a `git push` is allowed.
#
# Contract: exit 0 = allow, exit 2 = block (stderr carries the reason).
#
# The hook runs under `set -euo pipefail`, and the two defects #8676 fixed were
# both invisible to a manual run on a dirty tree:
#   - on a CLEAN tsc run the `___TSC_RC___` marker is the only line of output,
#     so `grep -v` matched nothing and exited 1 — `set -e` then killed the hook
#     (exit 1, not 0 and not 2) before eslint, the panelRegistry test and the
#     lockfile check ever ran. The pusher saw nothing.
#   - the changed-file list was a space-joined string handed to eslint
#     unquoted, so a path containing a space became two arguments.
# Every case here runs the REAL hook against a fixture repo whose
# `web/node_modules/.bin/{tsc,eslint}` are stubs that record how they were
# invoked, so the assertions are on the hook's control flow, not on a re-typed
# copy of it (lessons-learned #18).

set -u

HOOK="$(cd "$(dirname "$0")/.." && pwd)/pre-push-quality-gate.sh"

command -v jq >/dev/null 2>&1 || { echo "FAIL: jq not installed"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "FAIL: git not installed"; exit 1; }
[ -f "$HOOK" ] || { echo "FAIL: hook not found at $HOOK"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
readonly -f ok
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1"; }
readonly -f bad

# --- fixture: a repo with an origin/main ref, a feature branch, and stub tools ---
REPO="$TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email t@example.com
git -C "$REPO" config user.name t
mkdir -p "$REPO/web/src" "$REPO/web/node_modules/.bin"
printf 'export const a = 1;\n' > "$REPO/web/src/a.ts"
printf 'export const gone = 1;\n' > "$REPO/web/src/gone.ts"
git -C "$REPO" add -A
git -C "$REPO" commit -qm base
# `origin/main` is what the hook diffs against; a local remote-tracking ref is enough.
git -C "$REPO" update-ref refs/remotes/origin/main HEAD
git -C "$REPO" checkout -qb feat/work

# Stub tsc: prints $TSC_STUB_OUTPUT (may be empty) and exits $TSC_STUB_RC.
cat > "$REPO/web/node_modules/.bin/tsc" <<'STUB'
#!/bin/bash
printf '%s' "${TSC_STUB_OUTPUT:-}"
exit "${TSC_STUB_RC:-0}"
STUB
# Stub eslint: records argc and each argv line to $ESLINT_LOG, exits $ESLINT_STUB_RC.
cat > "$REPO/web/node_modules/.bin/eslint" <<'STUB'
#!/bin/bash
{
  echo "argc=$#"
  for a in "$@"; do echo "arg=$a"; done
} > "${ESLINT_LOG:?}"
if [ "${ESLINT_STUB_RC:-0}" != "0" ]; then echo "src/a.ts: 1:1 error no-unused-vars"; fi
exit "${ESLINT_STUB_RC:-0}"
STUB
chmod +x "$REPO/web/node_modules/.bin/tsc" "$REPO/web/node_modules/.bin/eslint"

# run_hook <cwd> <command> [ENV=val ...] → HOOK_EXIT, HOOK_STDERR, HOOK_STDOUT
run_hook() {
  local cwd="$1" cmd="$2"
  shift 2
  local payload
  payload=$(printf '%s' "$cmd" | jq -Rsc '{tool_input: {command: .}}')
  : > "$TMP/eslint.log"
  HOOK_STDOUT=$(cd "$cwd" && printf '%s' "$payload" | env ESLINT_LOG="$TMP/eslint.log" "$@" bash "$HOOK" 2>"$TMP/stderr")
  HOOK_EXIT=$?
  HOOK_STDERR=$(cat "$TMP/stderr")
}
readonly -f run_hook

check_exit() {
  local desc="$1" expected="$2"
  if [ "$HOOK_EXIT" -eq "$expected" ]; then ok "$desc"; else bad "$desc (expected exit $expected, got $HOOK_EXIT; stderr: $HOOK_STDERR)"; fi
}
readonly -f check_exit

check_err() {
  local desc="$1" needle="$2"
  case "$HOOK_STDERR" in
    *"$needle"*) ok "$desc" ;;
    *) bad "$desc (stderr lacks '$needle'; got: $HOOK_STDERR)" ;;
  esac
}
readonly -f check_err

# eslint_called → 0 when the stub ran (log non-empty), 1 otherwise
eslint_called() { [ -s "$TMP/eslint.log" ]; }
readonly -f eslint_called

PUSH="git push -u origin feat/work"

# --- 1. non-push commands and force-pushes pass straight through ---
run_hook "$REPO" "git status"
check_exit "non-push command allowed" 0
if eslint_called; then bad "non-push command must not run eslint"; else ok "non-push command runs nothing"; fi

run_hook "$REPO" "git push --force-with-lease origin feat/work"
check_exit "force-with-lease push skips the gate" 0

# --- 2. no changed files → allow, nothing runs ---
run_hook "$REPO" "$PUSH"
check_exit "no diff vs origin/main allows the push" 0
if eslint_called; then bad "no-diff push must not run eslint"; else ok "no-diff push runs nothing"; fi

# --- 3. THE #8676 REGRESSION: a clean tsc run must reach eslint and exit 0 ---
# Change a .ts file so the tsc stage runs. The stub prints NOTHING, so the
# `___TSC_RC___:0` marker is the only line and `grep -v` matches nothing.
printf 'export const a = 2;\n' > "$REPO/web/src/a.ts"
git -C "$REPO" commit -qam "edit a"
run_hook "$REPO" "$PUSH" TSC_STUB_RC=0 TSC_STUB_OUTPUT=
check_exit "clean tsc (marker is the only output line) still allows the push" 0
if eslint_called; then
  ok "clean tsc run reaches the eslint stage (hook was not killed by set -e)"
else
  bad "clean tsc run never reached eslint — the grep -v exit-1 defect is back"
fi
if [ "$HOOK_EXIT" -ne 1 ]; then ok "clean tsc never yields the impossible exit 1"; else bad "hook exited 1 (neither allow nor block)"; fi

# --- 4. tsc errors in a CHANGED file block; errors only in other files do not ---
run_hook "$REPO" "$PUSH" TSC_STUB_RC=2 TSC_STUB_OUTPUT="src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
"
check_exit "tsc error in a changed file blocks" 2
check_err "block reason names TypeScript" "TypeScript errors found in changed files"
check_err "the offending tsc line is surfaced" "src/a.ts(1,14)"

run_hook "$REPO" "$PUSH" TSC_STUB_RC=2 TSC_STUB_OUTPUT="src/elsewhere.ts(3,1): error TS1005: ';' expected.
"
check_exit "tsc error only in an unchanged file (pre-existing on main) does not block" 0
if eslint_called; then ok "unchanged-file tsc error still runs eslint"; else bad "eslint skipped after unchanged-file tsc error"; fi

# --- 5. eslint failure blocks with its own reason ---
run_hook "$REPO" "$PUSH" ESLINT_STUB_RC=1
check_exit "eslint failure blocks" 2
check_err "block reason names ESLint" "ESLint warnings/errors found"

# --- 6. THE #8676 ARGV REGRESSION: a path with a space is ONE eslint argument ---
printf 'export const s = 1;\n' > "$REPO/web/src/with space.tsx"
git -C "$REPO" add "web/src/with space.tsx"
git -C "$REPO" commit -qm "spaced file"
run_hook "$REPO" "$PUSH"
check_exit "push with a spaced path allowed when tools are clean" 0
# argv is `--max-warnings 0 <file> <file>`: 4 arguments for two files.
if grep -qx 'argc=4' "$TMP/eslint.log" \
   && grep -qx 'arg=src/a.ts' "$TMP/eslint.log" \
   && grep -qx 'arg=src/with space.tsx' "$TMP/eslint.log"; then
  ok "eslint receives 'src/with space.tsx' as one argument (argc=4 for two files)"
else
  bad "eslint argv was word-split or incomplete: $(tr '\n' '|' < "$TMP/eslint.log")"
fi

# --- 7. a file deleted on the branch is in the diff but not handed to eslint ---
git -C "$REPO" rm -q web/src/gone.ts
git -C "$REPO" commit -qm "delete gone"
run_hook "$REPO" "$PUSH"
check_exit "push after a deletion allowed" 0
if grep -q 'arg=src/gone.ts' "$TMP/eslint.log"; then
  bad "deleted file src/gone.ts was passed to eslint"
else
  ok "deleted file is filtered out of the eslint argument list"
fi

# --- 8. hook never writes to stdout (a PreToolUse hook's stdout is not shown) ---
if [ -z "$HOOK_STDOUT" ]; then ok "nothing written to stdout"; else bad "stdout not empty: $HOOK_STDOUT"; fi

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
