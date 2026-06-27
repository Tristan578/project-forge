#!/usr/bin/env bash
# Unit tests for scripts/changeset-version.sh — the retry wrapper behind the
# `changeset:version` npm script invoked by the Release workflow.
#
# The wrapper retries `changeset version` (which intermittently aborts on a
# transient GitHub GraphQL flake during @changesets/changelog-github changelog
# generation) before relocking the root lockfile. The boundary logic this suite
# pins — exact attempt count, exit NON-ZERO after exhaustion, and crucially NOT
# relocking when `changeset version` never succeeds — is exactly the kind of
# silent exit-code bug the repo's "every scripts/ entry gets a co-located
# *.test.sh" convention exists to catch.
#
# It drives the REAL script in a throwaway sandbox: a stub
# ./node_modules/.bin/changeset that fails a configurable number of times then
# succeeds, a stub `npm` on PATH that records whether (and how) the relock ran,
# and a stub `sleep` so the backoff is instant. Then it asserts on the exit
# code, the changeset call count, and the relock invocation.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../changeset-version.sh"
NPM_ARGS_OUT="$(mktemp)"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# Assert actual == expected without the `A && B || C` footgun (SC2015).
check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc"
  else
    fail "$desc — expected '$expected', got '$actual'"
  fi
}

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

# Run the real script in a sandbox. Args: <fail_count> <attempts>.
# The changeset stub exits 1 for its first <fail_count> calls, then 0.
# Echoes one line: "<exit_code> <changeset_calls> <npm_called: yes|no>" and
# copies the npm stub's recorded args to $NPM_ARGS_OUT for inspection.
run_case() {
  local fail_count="$1" attempts="$2"
  local dir; dir="$(mktemp -d)"
  mkdir -p "$dir/node_modules/.bin" "$dir/fakebin"

  cat > "$dir/node_modules/.bin/changeset" <<EOF
#!/usr/bin/env bash
calls_file="$dir/changeset.calls"
n=\$(( \$(cat "\$calls_file" 2>/dev/null || echo 0) + 1 ))
echo "\$n" > "\$calls_file"
if [ "\$n" -le $fail_count ]; then
  echo "stub changeset: simulated GraphQL flake (attempt \$n)" >&2
  exit 1
fi
exit 0
EOF
  chmod +x "$dir/node_modules/.bin/changeset"

  cat > "$dir/fakebin/npm" <<EOF
#!/usr/bin/env bash
echo "\$*" > "$dir/npm.args"
exit 0
EOF
  chmod +x "$dir/fakebin/npm"

  # Instant backoff so the suite does not actually wait 5/10/15s.
  cat > "$dir/fakebin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$dir/fakebin/sleep"

  local exit_code
  ( cd "$dir" && PATH="$dir/fakebin:$PATH" CHANGESET_VERSION_ATTEMPTS="$attempts" \
      bash "$SCRIPT" >/dev/null 2>&1 )
  exit_code=$?

  local calls npm_called
  calls="$(cat "$dir/changeset.calls" 2>/dev/null || echo 0)"
  if [ -f "$dir/npm.args" ]; then npm_called="yes"; else npm_called="no"; fi
  cp "$dir/npm.args" "$NPM_ARGS_OUT" 2>/dev/null || : > "$NPM_ARGS_OUT"

  echo "$exit_code $calls $npm_called"
  rm -rf "$dir"
}

echo "=== changeset-version.sh retry-wrapper tests ==="

# 1. Every attempt fails → exit non-zero, called exactly $attempts times, and
#    the relock must NOT run (we never produced a valid version bump).
read -r ec calls npm_called <<< "$(run_case 9 2)"
check "all-fail: exits non-zero" "1" "$ec"
check "all-fail: retried exactly 2 times" "2" "$calls"
check "all-fail: relock NOT run on failure" "no" "$npm_called"

# 2. Succeeds on the first attempt → exit 0, called once (no needless retry),
#    relock run with --package-lock-only.
read -r ec calls npm_called <<< "$(run_case 0 4)"
check "success: exits 0" "0" "$ec"
check "success: called once" "1" "$calls"
check "success: relock run" "yes" "$npm_called"
if grep -q -- "--package-lock-only" "$NPM_ARGS_OUT"; then
  pass "success: relock used --package-lock-only"
else
  fail "success: relock missing --package-lock-only (got: $(cat "$NPM_ARGS_OUT"))"
fi

# 3. Fails once, then succeeds → exit 0, called twice, relock run. Proves the
#    retry actually recovers the transient flake rather than just masking it.
read -r ec calls npm_called <<< "$(run_case 1 4)"
check "retry-then-succeed: exits 0" "0" "$ec"
check "retry-then-succeed: called twice" "2" "$calls"
check "retry-then-succeed: relock run" "yes" "$npm_called"

rm -f "$NPM_ARGS_OUT"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
