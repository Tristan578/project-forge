#!/bin/bash
# Tests for check-pr-metadata.sh — the PreToolUse Bash hook that requires
# `gh pr create` to carry BOTH a `--milestone` and a `Closes #NNNN` link.
#
# Contract: exit 0 = allow, exit 2 = block (reason on stdout).
#
# The regression this suite exists for: the hook only ever grepped the COMMAND
# STRING for `Closes #NNNN`, so any PR opened with `--body-file` was blocked
# unconditionally — the link lives in the file, which the hook never opened.
# That collides head-on with block-main-commits.sh, which refuses to analyse a
# command over 4000 chars and tells you to pass large content via a file. The
# two together made a substantive PR body impossible to submit: inline was too
# long to allow, and by-file could never satisfy the Closes check.

set -u

HOOK="$(cd "$(dirname "$0")/.." && pwd)/check-pr-metadata.sh"

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 1; }
[ -f "$HOOK" ] || { echo "FAIL: hook not found at $HOOK"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# run_hook <command-string>  → sets HOOK_EXIT, HOOK_OUT (both streams), HOOK_ERR
# (stderr alone). The harness surfaces STDERR on exit 2, so a block whose reason
# went to stdout reaches the caller as "No stderr output" — a mute block.
run_hook() {
  local cmd="$1" payload errfile
  payload=$(jq -nc --arg c "$cmd" '{tool_input: {command: $c}}')
  errfile="$TMP/stderr.$$"
  HOOK_OUT=$(printf '%s' "$payload" | bash "$HOOK" 2>"$errfile")
  HOOK_EXIT=$?
  HOOK_ERR=$(cat "$errfile")
  # Everything the caller must SEE has to be on stderr; fold it in so the
  # existing check_out assertions keep reading the full user-visible text.
  HOOK_OUT="$HOOK_OUT$HOOK_ERR"
  rm -f "$errfile"
}

check() {
  local desc="$1" expected="$2"
  if [ "$HOOK_EXIT" -eq "$expected" ]; then
    PASS=$((PASS + 1))
    echo "ok: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc (expected exit $expected, got $HOOK_EXIT)"
  fi
}

# check_err <desc>  → assert the block reason reached STDERR, not just stdout
check_err() {
  local desc="$1"
  if [ -n "$HOOK_ERR" ]; then
    PASS=$((PASS + 1))
    echo "ok: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc (nothing on stderr — the caller sees a mute block)"
  fi
}

# check_out <desc> <substring>  → assert the hook's output mentions it
check_out() {
  local desc="$1" needle="$2"
  case "$HOOK_OUT" in
    *"$needle"*) PASS=$((PASS + 1)); echo "ok: $desc" ;;
    *) FAIL=$((FAIL + 1)); echo "FAIL: $desc (output lacked '$needle')" ;;
  esac
}

MS="--milestone 'S1: Quality & Reliability'"

# --- fixtures -----------------------------------------------------------------
GOOD_BODY="$TMP/good-body.md"
NOLINK_BODY="$TMP/nolink-body.md"
SPACE_BODY="$TMP/a dir with spaces/body.md"
mkdir -p "$TMP/a dir with spaces"

cat > "$GOOD_BODY" <<'EOF'
## Summary
Fixes the thing.

Closes #9081 (PF-1051)
EOF

cat > "$NOLINK_BODY" <<'EOF'
## Summary
Fixes the thing, but forgot to link an issue.
EOF

cp "$GOOD_BODY" "$SPACE_BODY"

# =============================================================================
# Pass-through: the hook only judges `gh pr create`.
# =============================================================================
run_hook "ls -la"
check "non-gh command allowed" 0

run_hook "gh pr view 123 --comments"
check "gh pr view allowed (not a create)" 0

run_hook "gh pr list"
check "gh pr list allowed" 0

# =============================================================================
# Inline --body (pre-existing behavior — must not regress).
# =============================================================================
run_hook "gh pr create --title t $MS --body 'summary. Closes #123'"
check "inline body with Closes and milestone allowed" 0

run_hook "gh pr create --title t $MS --body 'summary with no link'"
check "inline body missing Closes blocked" 2
check_out "missing-Closes message names the requirement" "Closes #NNNN"

run_hook "gh pr create --title t --body 'summary. Closes #123'"
check "missing --milestone blocked" 2
check_out "missing-milestone message names the flag" "--milestone"

run_hook "gh pr create --title t --body 'no link either'"
check "missing both blocked" 2

# Case-insensitive per the hook's own -i flag.
run_hook "gh pr create --title t $MS --body 'closes #123'"
check "lowercase 'closes #NNNN' accepted (hook greps case-insensitively)" 0

# autoforge bypass preserved.
run_hook "gh pr create --title 'autoforge: batch' --body 'no link'"
check "autoforge: bypass still allowed" 0

# =============================================================================
# --body-file: THE REGRESSION. The link lives in the file, not the command.
# =============================================================================
run_hook "gh pr create --title t $MS --body-file $GOOD_BODY"
check "--body-file whose file contains Closes allowed (REGRESSION)" 0

run_hook "gh pr create --title t $MS --body-file=$GOOD_BODY"
check "--body-file=<path> equals form allowed (REGRESSION)" 0

run_hook "gh pr create --title t $MS -F $GOOD_BODY"
check "-F <path> short alias allowed (REGRESSION)" 0

run_hook "gh pr create --title t $MS --body-file \"$SPACE_BODY\""
check "--body-file \"<path with spaces>\" allowed" 0

run_hook "gh pr create --title t $MS --body-file '$SPACE_BODY'"
check "--body-file '<path with spaces>' single-quoted allowed" 0

# The file is genuinely consulted — a file with no link must still block.
run_hook "gh pr create --title t $MS --body-file $NOLINK_BODY"
check "--body-file whose file lacks Closes blocked (file is really read)" 2
check_out "body-file missing-Closes message names the requirement" "Closes #NNNN"

# --milestone is still required independently of where the body came from.
run_hook "gh pr create --title t --body-file $GOOD_BODY"
check "--body-file with a valid link but no --milestone blocked" 2
check_out "body-file path still enforces milestone" "--milestone"

# --- fail closed: an unreadable body file must never be treated as satisfied ---
run_hook "gh pr create --title t $MS --body-file $TMP/does-not-exist.md"
check "--body-file pointing at a nonexistent path blocked (fail closed)" 2
check_out "unreadable-file message names the path" "does-not-exist.md"

UNREADABLE="$TMP/unreadable.md"
cp "$GOOD_BODY" "$UNREADABLE"
chmod 000 "$UNREADABLE"
if [ -r "$UNREADABLE" ]; then
  # Running as root (or an OS ignoring the mode) — the case cannot be staged.
  echo "ok: SKIP unreadable-file case (mode 000 still readable here)"
  PASS=$((PASS + 1))
else
  run_hook "gh pr create --title t $MS --body-file $UNREADABLE"
  check "--body-file pointing at an unreadable file blocked (fail closed)" 2
fi
chmod 644 "$UNREADABLE" 2>/dev/null || true

# A directory is not a body file.
run_hook "gh pr create --title t $MS --body-file $TMP"
check "--body-file pointing at a directory blocked (fail closed)" 2

# --body-file with no value at all: nothing to read, and the command string
# carries no link either.
run_hook "gh pr create --title t $MS --body-file"
check "--body-file with a missing value blocked" 2

# =============================================================================
# Precedence: when BOTH a body file and an inline Closes appear, the FILE is
# what gh actually sends, so the file must decide. A link that exists only in
# the command string (e.g. in the --title) must not launder a linkless file.
# =============================================================================
run_hook "gh pr create --title 'Closes #123 in title' $MS --body-file $NOLINK_BODY"
check "inline 'Closes #NNNN' elsewhere in the command does not satisfy a linkless body file" 2

# =============================================================================
# A --title that MENTIONS the flag must not be mistaken for the flag itself.
# Found live: this hook's own PR was titled "read --body-file so the PR metadata
# check is satisfiable", and first-occurrence extraction pulled the path 'so'
# out of the title, then blocked on it. Scan every occurrence and take the first
# one that names a readable file; fall back to the first occurrence so a command
# with NO usable path still fails closed.
# =============================================================================
run_hook "gh pr create --title 'read --body-file so the check is satisfiable' $MS --body-file $GOOD_BODY"
check "--body-file mentioned in --title does not shadow the real flag" 0

run_hook "gh pr create --title 'read --body-file so the check is satisfiable' $MS --body-file $NOLINK_BODY"
check "title mention + linkless real body file still blocks" 2
check_out "title-mention case names the REAL file, not the title word" "nolink-body.md"

run_hook "gh pr create --title 'about --body-file handling' $MS --body 'inline. Closes #123'"
check "title mention with NO real --body-file falls back to fail-closed" 2

# =============================================================================
# A block the caller cannot see is a block with no stated reason. The harness
# surfaces STDERR on exit 2; a reason written only to stdout arrives as
# "No stderr output". Hit live on this hook's own PR.
# =============================================================================
run_hook "gh pr create --title t $MS --body 'summary with no link'"
check "mute-block guard: missing-Closes still blocks" 2
check_err "block reason is written to stderr, not just stdout"

run_hook "gh pr create --title t --body-file $GOOD_BODY"
check "mute-block guard: missing-milestone still blocks" 2
check_err "missing-milestone reason is written to stderr"

# =============================================================================
# Fail-safe on malformed stdin: the hook must not propagate a jq error.
# With no command to inspect, there is no `gh pr create` to judge → allow.
# =============================================================================
HOOK_OUT=$(printf 'not json at all' | bash "$HOOK" 2>&1)
HOOK_EXIT=$?
check "malformed stdin fails safe (no jq error propagation)" 0

# =============================================================================
# Suite hygiene: the hook must not feed a large variable into `grep -q` through
# a pipe. Under `set -o pipefail`, grep -q exits on first match, SIGPIPEs the
# writer, and the pipeline reports failure — inverting the verdict of an
# `if ! ... | grep -q` test. Here-strings have no such failure mode.
# =============================================================================
echo "=== suite hygiene (structural) ==="
if grep -nE '(echo|printf)[^|]*\|[[:space:]]*grep[[:space:]]+-[a-zA-Z]*q' "$HOOK" >/dev/null 2>&1; then
  FAIL=$((FAIL + 1))
  echo "FAIL: hook pipes a variable into 'grep -q' (SIGPIPE-unsafe under pipefail):"
  grep -nE '(echo|printf)[^|]*\|[[:space:]]*grep[[:space:]]+-[a-zA-Z]*q' "$HOOK"
else
  PASS=$((PASS + 1))
  echo "  PASS: hook feeds grep via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
echo "All tests passed."
