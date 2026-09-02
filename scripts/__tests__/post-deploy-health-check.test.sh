#!/usr/bin/env bash
# Contract test for scripts/post-deploy-health-check.sh.
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
# #9624 was the same shape one layer up: the script warned and exited 0
# whenever Deployment Protection answered the probe, and that was EVERY
# production run, so the gate had never observed a deploy it called healthy.
# The second half of this suite runs the whole script against a stubbed `curl`
# and asserts (a) a protected answer FAILS, (b) the canary pin and the commit
# assertion are wired, (c) no fail-open exit survives.
#
# So: most cases below are REFUSAL cases.
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
if awk '/Health check passed/{f=1} f && /check_commit_identity/{found=1} f && /exit 0/{exit} END{exit !found}' "$SCRIPT"; then
  pass "the commit-identity check also runs before the success exit"
else
  fail "check_commit_identity is not evaluated between 'Health check passed' and 'exit 0' — the base deployment's 200 would pass as ours"
fi

# ---------------------------------------------------------------------------
# End-to-end: the whole script against a stubbed curl.
#
# The stub records its argv (so the suite can see the URL, the cookie jar and
# any bypass header the script sent), writes the fixture body to --output, the
# fixture headers to --dump-header, and prints the fixture status for -w.
# ---------------------------------------------------------------------------
echo ""
echo "=== the whole check, against a stubbed curl ==="

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
out=""; hdr=""
printf '%s\n' "$@" > "$STUB_ARGS"
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    --dump-header) hdr="$2"; shift ;;
  esac
  shift
done
[ -n "$out" ] && cat "$STUB_BODY" > "$out"
[ -n "$hdr" ] && cat "$STUB_HEADERS" > "$hdr"
printf '%s' "$STUB_STATUS"
EOF
chmod +x "$TMP/bin/curl"

# e2e <status> <body> [headers]  — remaining env comes from the caller.
e2e() {
  local status="$1" body="$2" headers="${3:-HTTP/2 $1}"
  printf '%s' "$body" > "$TMP/body"
  printf '%s\n' "$headers" > "$TMP/headers"
  : > "$TMP/args"
  (
    PATH="$TMP/bin:$PATH" STUB_STATUS="$status" STUB_BODY="$TMP/body" STUB_HEADERS="$TMP/headers" STUB_ARGS="$TMP/args" \
    HEALTH_RESPONSE_FILE="$TMP/resp.json" HEALTH_HEADERS_FILE="$TMP/resp.headers" \
    HEALTH_CHECK_STABILIZE_S=0 HEALTH_CHECK_INTERVAL_S=0 HEALTH_CHECK_RETRIES="${RETRIES:-2}" \
    bash "$SCRIPT" "${URL:-https://www.example.test}" 2>&1
  )
}

HEALTHY='{"status":"ok","commit":"abcdef12","services":[{"name":"Engine CDN","status":"up"}]}'

# --- accepting ---
OUT="$(e2e 200 "$HEALTHY")"; RC=$?
if [ "$RC" = 0 ]; then
  pass "200 + ok + engine up passes end to end"
else
  fail "the healthy case failed: $OUT"
fi

OUT="$(HEALTH_CHECK_EXPECT_COMMIT=abcdef1234567890 e2e 200 "$HEALTHY")"; RC=$?
if [ "$RC" = 0 ] && grep -q 'Commit check passed' <<<"$OUT"; then
  pass "an expected commit that matches on its first 8 chars passes"
else
  fail "matching commit was rejected: $OUT"
fi

OUT="$(HEALTH_CHECK_FORCE_CANARY=true e2e 200 "$HEALTHY")"; RC=$?
if [ "$RC" = 0 ] && grep -q 'vcrrForceCanary=true' "$TMP/args" && grep -qx -- '--cookie-jar' "$TMP/args" && grep -qx -- '--cookie' "$TMP/args"; then
  pass "force-canary appends vcrrForceCanary=true and carries a cookie jar on the request"
else
  fail "force-canary wiring missing; args=$(tr '\n' ' ' < "$TMP/args") $OUT"
fi

OUT="$(VERCEL_AUTOMATION_BYPASS=s3cret e2e 200 "$HEALTHY")"; RC=$?
if [ "$RC" = 0 ] && grep -qx 'x-vercel-protection-bypass: s3cret' "$TMP/args"; then
  pass "a bypass secret is sent as the x-vercel-protection-bypass HEADER"
else
  fail "bypass header missing; args=$(tr '\n' ' ' < "$TMP/args")"
fi
if ! grep -q 's3cret' <<<"$(grep 'http' "$TMP/args")"; then
  pass "the bypass secret never appears in the URL"
else
  fail "the bypass secret was put into the query string, where it lands in logs"
fi

# --- refusals ---
OUT="$(HEALTH_CHECK_EXPECT_COMMIT=0000000000 e2e 200 "$HEALTHY")"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Commit check failed' <<<"$OUT" && grep -q 'abcdef12' <<<"$OUT"; then
  pass "a healthy 200 from a DIFFERENT commit fails and names both commits (the rolling-release base is not this deploy)"
else
  fail "commit mismatch was accepted or not explained: rc=$RC $OUT"
fi

OUT="$(HEALTH_CHECK_EXPECT_COMMIT=abcdef12 e2e 200 '{"status":"ok","services":[{"name":"Engine CDN","status":"up"}]}')"; RC=$?
if [ "$RC" != 0 ] && grep -q 'reported no commit' <<<"$OUT"; then
  pass "a healthy 200 that reports no commit fails when a commit was expected"
else
  fail "a commit-less body passed a commit assertion: rc=$RC $OUT"
fi

OUT="$(e2e 302 '' $'HTTP/2 302\nlocation: https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app%2Fapi%2Fhealth&nonce=abc')"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Deployment Protection answered the probe' <<<"$OUT"; then
  pass "a 302 to Vercel SSO fails closed and says the deployment cannot be observed (this used to warn and exit 0)"
else
  fail "the SSO redirect did not fail closed: rc=$RC $OUT"
fi

OUT="$(e2e 401 '{"error":"Authentication Required"}')"; RC=$?
if [ "$RC" != 0 ] && grep -q 'Deployment Protection answered the probe' <<<"$OUT"; then
  pass "a 401 fails closed with the same explanation"
else
  fail "401 did not fail closed: rc=$RC $OUT"
fi

OUT="$(e2e 503 '{"status":"error"}')"; RC=$?
if [ "$RC" != 0 ] && grep -q 'failed after' <<<"$OUT"; then
  pass "a 5xx on every attempt fails after the retries"
else
  fail "5xx did not fail: rc=$RC $OUT"
fi

OUT="$(e2e 200 '{"status":"ok","services":[{"name":"Engine CDN","status":"down","error":"404"}]}')"; RC=$?
if [ "$RC" != 0 ]; then
  pass "a 200 whose engine is down fails end to end"
else
  fail "engine-down 200 passed end to end"
fi

# --- no fail-open path may survive ---
if [ "$(grep -c '^  *exit 0' "$SCRIPT")" = "1" ]; then
  pass "exactly one 'exit 0' exists in the script — the success path"
else
  fail "the script has $(grep -c '^  *exit 0' "$SCRIPT") 'exit 0' sites; a second one is a fail-open path (the pre-#9624 script had two)"
fi
if ! grep -qi 'skipping health check' "$SCRIPT" && ! grep -q 'vercel curl' "$SCRIPT"; then
  pass "the 'could not authenticate, skipping' branch and the vercel-curl path are gone"
else
  fail "a warn-and-continue authentication branch is still present"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
