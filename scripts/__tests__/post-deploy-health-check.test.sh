#!/usr/bin/env bash
# Contract test for the engine gate in scripts/post-deploy-health-check.sh.
#
# WHY THIS SUITE EXISTS
#
# #9581 shipped because a green post-deploy check sat in front of a broken
# engine. /api/health reported "Engine CDN: up" while every versioned prefix on
# the CDN 404'd, and the deploy gate believed it. The fix only means something
# if the gate actually fails on the reported failure -- and a gate is very easy
# to write so that it passes on everything, which is what the first cut of this
# one did (it read a GitHub variable that does not exist, so it always took the
# "nothing to check" branch).
#
# So: every case below except two is a REFUSAL case.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../post-deploy-health-check.sh"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

# Pull just the function under test out of the script, which otherwise runs a
# deploy probe on load. Extraction is asserted rather than assumed: a silently
# empty extraction would make every case below pass vacuously.
FN="$(awk '/^check_engine_health\(\) \{/{f=1} f{print} f&&/^\}$/{exit}' "$SCRIPT")"
if [ -z "$FN" ] || ! grep -q 'case ' <<<"$FN"; then
  echo "  FAIL: could not extract check_engine_health from $SCRIPT — the tests below would pass vacuously"
  echo "SUITE FAILED"
  exit 1
fi

# Run the function against a given /api/health body.
run_with() {
  local body="$1" tmp out rc
  tmp="$(mktemp -d)"
  printf '%s' "$body" > "$tmp/health_response.json"
  out="$(
    eval "$FN"
    HEALTH_RESPONSE_FILE="$tmp/health_response.json" check_engine_health 2>&1
  )" && rc=0 || rc=$?
  rm -rf "$tmp"
  printf '%s\n---RC---%s' "$out" "$rc"
}

rc_of() { local r="${1#*---RC---}"; printf '%s' "$r"; }

echo "=== the engine gate must fail on a reported engine failure ==="

# --- the two accepting cases ---
RES="$(run_with '{"status":"ok","services":[{"name":"Engine CDN","status":"up"}]}')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "Engine CDN 'up' passes"
else
  fail "'up' was rejected: $RES"
fi

RES="$(run_with '{"status":"degraded","services":[{"name":"Engine CDN","status":"degraded","error":"NEXT_PUBLIC_ENGINE_CDN_URL not configured"}]}')"
if [ "$(rc_of "$RES")" = "0" ]; then
  pass "Engine CDN 'degraded' passes (same-origin deployment is legitimate)"
else
  fail "'degraded' was rejected — same-origin deploys would be blocked: $RES"
fi

# --- refusals ---
# The exact shape of #9581: API healthy overall, engine unreachable.
RES="$(run_with '{"status":"ok","services":[{"name":"Database (Neon)","status":"up"},{"name":"Engine CDN","status":"down","error":"engine asset returned 404"}]}')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "Engine CDN 'down' fails the deploy even though overall status is 'ok' (#9581's exact shape)"
else
  fail "a down engine passed while the top-level status was ok — this IS the bug"
fi
if grep -q "404" <<<"$RES"; then
  pass "the refusal surfaces the underlying error"
else
  fail "the refusal did not include the reported error: $RES"
fi

# A missing service must not read as a passing one.
RES="$(run_with '{"status":"ok","services":[{"name":"Clerk","status":"up"}]}')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an absent Engine CDN service fails closed"
else
  fail "a report with no Engine CDN entry passed — a deleted check would read as a green one"
fi

RES="$(run_with '{"status":"ok"}')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "a report with no services array fails closed"
else
  fail "a report with no services array passed"
fi

RES="$(run_with 'not json at all')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an unparseable body fails closed"
else
  fail "an unparseable body passed"
fi

RES="$(run_with '')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an empty body fails closed"
else
  fail "an empty body passed"
fi

# An unknown future status must not be silently accepted.
RES="$(run_with '{"status":"ok","services":[{"name":"Engine CDN","status":"weird-new-state"}]}')"
if [ "$(rc_of "$RES")" != "0" ]; then
  pass "an unrecognised status fails closed rather than defaulting to pass"
else
  fail "an unrecognised status was treated as healthy"
fi

# --- wiring ---
echo ""
echo "=== the gate is actually called on the success path ==="
if grep -q 'check_engine_health' "$SCRIPT" && [ "$(grep -c 'check_engine_health' "$SCRIPT")" -ge 2 ]; then
  pass "post-deploy-health-check.sh defines and calls check_engine_health"
else
  fail "check_engine_health is defined but never called — the gate would never run"
fi
# It must gate the SUCCESS path: a check that only runs after a failure is
# decorative, since the deploy has already been rejected by then.
if awk '/Health check passed/{f=1} f && /check_engine_health/{found=1} f && /exit 0/{exit} END{exit !found}' "$SCRIPT"; then
  pass "the gate runs before the success exit, not after a failure"
else
  fail "check_engine_health is not evaluated between 'Health check passed' and 'exit 0' — a passing API would exit 0 without it"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
