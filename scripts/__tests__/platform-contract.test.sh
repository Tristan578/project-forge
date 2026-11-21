#!/usr/bin/env bash
# Tests for scripts/__tests__/lib/platform.sh — the shared platform contract
# (#9611) that decides, for every bash suite, whether a capability gap is
# tolerated or is a merge-blocking failure.
#
# It had no coverage of its own while other suites already routed their skip
# policy through it, which is the shape lessons-learned #11 warns about: the
# thing deciding whether other gates can fail was itself ungated. Each
# suppression case below is paired with the negative control that makes it
# capable of failing — a test that only proves a gap is tolerated would stay
# green if suppression became unconditional.
set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/platform.sh"
PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

if [ ! -f "$LIB" ]; then
  echo "FAIL library not found: $LIB"
  exit 1
fi

# Run one snippet in a fresh bash with the library sourced and a recording
# `fail` hook. Every case needs its own process: platform.sh declares a
# `readonly`, so re-sourcing in-process would warn and muddy the output.
# stdout+stderr both come back on stdout; the exit code is the snippet's.
run_case() {
  local ci="$1" snippet="$2"
  CI="$ci" bash -c '
    . "$1"
    fail() { echo "ESCALATED: $*"; }
    shift
    eval "$@"
  ' _ "$LIB" "$snippet" 2>&1
}

# Assert a captured transcript contains (has) or does not contain (lacks) a
# fixed string. Written as if/else rather than `A && B || C`: the chained form
# runs C when B fails, which would mean an `ok` that could also record a `bad`.
has() {
  local desc="$1" needle="$2" text="$3"
  if printf '%s' "$text" | grep -qF -- "$needle"; then
    ok "$desc"
  else
    bad "$desc — no '$needle' in: $text"
  fi
}
lacks() {
  local desc="$1" needle="$2" text="$3"
  if printf '%s' "$text" | grep -qF -- "$needle"; then
    bad "$desc — unexpected '$needle' in: $text"
  else
    ok "$desc"
  fi
}

echo "=== platform_name reports a platform this repo has a policy for ==="
name="$(run_case "" 'platform_name')"
case "$name" in
  linux|macos|windows)
    ok "platform_name returned a known platform ($name)" ;;
  unknown)
    bad "platform_name returned 'unknown' — uname -s is '$(uname -s 2>/dev/null)', so its case list needs extending" ;;
  *)
    bad "platform_name returned an unexpected value: '$name'" ;;
esac

echo
echo "=== probe_skip: a laptop may thin out, the runner may not ==="
out="$(run_case "" 'probe_skip "capability X missing"')"
lacks "probe_skip does not escalate outside CI" "ESCALATED" "$out"
has "probe_skip reports the reason in the open" "SKIP: capability X missing" "$out"

# The control for every suppression case below. If this stops escalating the
# contract is inert, and the suppression tests would still be green.
out="$(run_case true 'probe_skip "capability X missing"')"
has "probe_skip escalates to the suite's fail hook under CI" \
  "ESCALATED: skipped in CI: capability X missing" "$out"

echo
echo "=== probe_skip_absent_on: suppressed on the named platform ONLY ==="
here="$name"
out="$(run_case true "probe_skip_absent_on $here 'host cannot do it here'")"
lacks "probe_skip_absent_on suppresses the CI upgrade on the named platform ($here)" \
  "ESCALATED" "$out"
has "the suppressed skip still names the platform and the reason" \
  "SKIP ($here cannot provide this): host cannot do it here" "$out"

# Negative control: the SAME call naming a platform this run is NOT on must
# still block. Without it, `probe_skip_absent_on` could suppress everywhere and
# every assertion above would remain green.
other=linux
[ "$here" = linux ] && other=windows
out="$(run_case true "probe_skip_absent_on $other 'host cannot do it here'")"
has "probe_skip_absent_on $other still escalates under CI while running on $here" \
  "ESCALATED: skipped in CI: host cannot do it here" "$out"

echo
echo "=== unsupported_on: the reserved exit code the sweep tolerates ==="
run_case "" 'unsupported_on windows "POSIX-only lock"' >/dev/null 2>&1
code=$?
if [ "$code" -eq 3 ]; then
  ok "unsupported_on exits 3 (the code the Windows sweep tolerates)"
else
  bad "unsupported_on exited $code, expected 3 — the sweep would read it as a hard failure"
fi

out="$(run_case "" 'unsupported_on windows "POSIX-only lock"')"
has "unsupported_on prints a greppable marker naming the platform" \
  "UNSUPPORTED on windows: POSIX-only lock" "$out"

echo
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "SUITE FAILED"
  exit 1
fi
echo "All platform-contract tests passed."
