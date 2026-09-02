#!/usr/bin/env bash
# Contract tests for scripts/cd-rolling-release.sh (#9624, #9625).
#
# WHY THIS SUITE EXISTS
#
# The step this script replaces greped `vercel ls` for `READY` while the CLI
# printed `● Ready`, so for its whole life it emitted an EMPTY last-known-good
# URL and the rollback steps guarded on it could never fire. The failure mode
# of a helper like this is not "wrong answer" but "no answer, reported as
# success" — so the refusal cases below outnumber the accepting ones, and every
# accepting case asserts the exact URL that came out, not merely exit 0.
#
# The Vercel API is stubbed with a `curl` on PATH that answers per URL from a
# fixture directory; no network.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../cd-rolling-release.sh"
[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/fx"

# The curl stub: finds the URL among its arguments, strips the query string,
# maps the path to a fixture file, and prints "<body>\n<status>" exactly as
# `curl -w '\n%{http_code}'` does. Every request is appended to a log so the
# suite can assert WHICH calls were made (a stale rollout must be aborted
# before ours is started, and a superseded run must make no mutation at all).
cat > "$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
url=""; method="GET"
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
path="${url#*://*/}"; path="/${path%%\?*}"
key="$(printf '%s %s' "$method" "$path" | tr '/ ' '__')"
echo "$method $path" >> "$CURL_LOG"
fx="$FIXTURES/$key"
if [ -f "$fx" ]; then
  cat "$fx"
else
  printf '{"error":{"code":"not_found"}}\n404'
fi
EOF
chmod +x "$TMP/bin/curl"

# fixture <METHOD> <path> <status> <body>
fixture() {
  local key
  key="$(printf '%s %s' "$1" "$2" | tr '/ ' '__')"
  printf '%s\n%s' "$4" "$3" > "$TMP/fx/$key"
}
reset_fixtures() { rm -f "$TMP/fx"/*; : > "$TMP/log"; }

run() {
  (cd "$TMP" && PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/log" FIXTURES="$TMP/fx" \
    VERCEL_TOKEN=tok VERCEL_TEAM_ID=team_1 VERCEL_PROJECT_ID=prj_1 \
    VERCEL_API_URL=https://api.example.test RR_POLL_ATTEMPTS="${ATTEMPTS:-3}" RR_POLL_INTERVAL_S=0 \
    GITHUB_OUTPUT="$TMP/out" bash "$SCRIPT" "$@" 2>&1)
}

RR=/v1/projects/prj_1/rolling-release
PROJECT=/v9/projects/prj_1

# ---------------------------------------------------------------------------
echo "=== lkg: the rollback target is the rolling-release BASE, never the canary ==="

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 200 '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","url":"spawnforge-base-tnolan.vercel.app"},"canaryDeployment":{"id":"dpl_canary","url":"spawnforge-canary-tnolan.vercel.app"}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-base-tnolan.vercel.app" ] && grep -q '^prev_url=https://spawnforge-base-tnolan.vercel.app$' "$TMP/out"; then
  pass "ACTIVE rollout: lkg is currentDeployment (the base) with an https scheme, and prev_url is written"
else
  fail "ACTIVE rollout: expected the base url; got rc=$RC: $OUT / out=$(cat "$TMP/out")"
fi
if ! grep -q canary "$TMP/out"; then
  pass "ACTIVE rollout: the canary is never offered as a rollback target"
else
  fail "ACTIVE rollout: the canary leaked into prev_url"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 200 '{"state":"COMPLETE","currentDeployment":{"id":"dpl_old","url":"spawnforge-old-tnolan.vercel.app"}}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_live","url":"spawnforge-live-tnolan.vercel.app"}}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-live-tnolan.vercel.app" ]; then
  pass "no active rollout: lkg is the project's production target, not a stale rolling-release record"
else
  fail "no active rollout: expected the production target; got rc=$RC: $OUT"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 404 '{"error":{"code":"not_found","message":"rolling release not enabled"}}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_live","url":"spawnforge-live-tnolan.vercel.app"}}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-live-tnolan.vercel.app" ]; then
  pass "Rolling Releases disabled (404): lkg falls through to the production target"
else
  fail "Rolling Releases disabled: expected the production target; got rc=$RC: $OUT"
fi

# --- refusals: an unanswerable question must not become an empty answer ---
reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "a 5xx from the rolling-release API fails closed and writes NO prev_url"
else
  fail "a 5xx should fail closed; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 200 '{"state":"ACTIVE","canaryDeployment":{"id":"dpl_canary","url":"spawnforge-canary-tnolan.vercel.app"}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "an ACTIVE rollout with no currentDeployment refuses to guess"
else
  fail "ACTIVE without a base should refuse; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 404 '{}'
fixture GET "$PROJECT" 200 '{"targets":{}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "a project with no production target refuses rather than emit an empty url (the exact silent failure this replaces)"
else
  fail "no production target should refuse; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$RR" 200 'this is not json'
fixture GET "$PROJECT" 200 '<html>maintenance</html>'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "non-JSON bodies fail closed"
else
  fail "non-JSON bodies should fail closed; got rc=$RC out=$(cat "$TMP/out")"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== ensure-canary: verification must observe THIS deployment ==="

OURS=spawnforge-ours-tnolan.vercel.app
DEPLOYMENT=/v13/deployments/$OURS
START=$RR/start

reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 200 '{"state":"ACTIVE","currentCanaryPercentage":5,"currentDeployment":{"id":"dpl_base","createdAt":1000},"canaryDeployment":{"id":"dpl_ours","createdAt":2000}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=canary$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "already the canary: succeeds, reports canary_state=canary, mutates nothing"
else
  fail "already the canary: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 200 '{"state":"COMPLETE","currentDeployment":{"id":"dpl_ours","createdAt":2000}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=current$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "already current (rollout completed): succeeds with canary_state=current, mutates nothing"
else
  fail "already current: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 404 '{"error":{"code":"not_found"}}'
fixture GET "$PROJECT" 200 "{\"targets\":{\"production\":{\"id\":\"dpl_ours\",\"url\":\"$OURS\"}}}"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=current$' "$TMP/out"; then
  pass "Rolling Releases disabled: succeeds when the production target is this deployment"
else
  fail "disabled + target is ours: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# The live incident: an OLDER canary is still ramping, so Vercel never started
# ours. The script must abort the stale rollout (rollback to its base — nothing
# is lost, ours is a superset) and then start ours, in that order.
reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 200 '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500}}'
fixture POST "$RR/../rollback/dpl_base" 200 '{}'
fixture POST "/v1/projects/prj_1/rollback/dpl_base" 200 '{}'
fixture POST "$START" 200 '{"state":"ACTIVE","canaryDeployment":{"id":"dpl_ours"}}'
OUT="$(ATTEMPTS=2 run ensure-canary "https://$OURS")"; RC=$?
if grep -q '^POST /v1/projects/prj_1/rollback/dpl_base$' "$TMP/log" && grep -q "^POST $START\$" "$TMP/log"; then
  pass "a stale OLDER canary is aborted (rollback to its base) and this deployment is started"
else
  fail "stale older canary: expected rollback then start; log=$(cat "$TMP/log")"
fi
ROLLBACK_LINE="$(grep -n 'rollback' "$TMP/log" | head -1 | cut -d: -f1)"
START_LINE="$(grep -n 'start' "$TMP/log" | head -1 | cut -d: -f1)"
if [ -n "$ROLLBACK_LINE" ] && [ -n "$START_LINE" ] && [ "$ROLLBACK_LINE" -lt "$START_LINE" ]; then
  pass "the abort happens BEFORE the start"
else
  fail "start was issued before the stale rollout was aborted; log=$(cat "$TMP/log")"
fi
if [ "$RC" != 0 ]; then
  pass "with the fixture never reflecting ours as canary, the wait times out and FAILS rather than reporting success"
else
  fail "the script reported success although the rollout never adopted this deployment"
fi

# A NEWER canary means a later merge owns production: this run is superseded.
reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 200 '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_newer","createdAt":3000}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && grep -qi superseded <<<"$OUT"; then
  pass "a NEWER canary: fails loudly as superseded and issues no mutation"
else
  fail "newer canary: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# Nothing active and ours is not current: start ours, and only report success
# once the API reflects it.
reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 200 '{"state":"COMPLETE","currentDeployment":{"id":"dpl_base","createdAt":500}}'
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=2 run ensure-canary "https://$OURS")"; RC=$?
if grep -q "^POST $START\$" "$TMP/log" && [ "$RC" != 0 ]; then
  pass "idle project, ours not current: start is issued, and success is withheld until the API reflects it"
else
  fail "idle project: rc=$RC log=$(cat "$TMP/log") $OUT"
fi
if [ "$(grep -c "^POST $START\$" "$TMP/log")" = "1" ]; then
  pass "start is issued exactly once across the polling loop"
else
  fail "start was issued $(grep -c "^POST $START\$" "$TMP/log") times"
fi

# --- refusals ---
reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 404 '{"error":{"code":"not_found"}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log"; then
  pass "an unresolvable deployment url fails closed without touching the rollout"
else
  fail "unresolvable url: rc=$RC log=$(cat "$TMP/log")"
fi

reset_fixtures; : > "$TMP/out"
fixture GET "$DEPLOYMENT" 200 '{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ]; then
  pass "a 5xx from the rolling-release API fails closed"
else
  fail "a 5xx should fail closed; got rc=$RC"
fi

OUT="$(run ensure-canary)"; RC=$?
if [ "$RC" = 2 ]; then
  pass "ensure-canary without a url is a usage error (exit 2)"
else
  fail "missing url: expected exit 2, got $RC"
fi

OUT="$(run bogus)"; RC=$?
if [ "$RC" = 2 ]; then
  pass "an unknown subcommand is a usage error (exit 2)"
else
  fail "unknown subcommand: expected exit 2, got $RC"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== wiring ==="
CD="$HERE/../../.github/workflows/cd.yml"
if grep -qF 'run: bash scripts/cd-rolling-release.sh lkg' "$CD"; then
  pass "cd.yml captures last-known-good through the script"
else
  fail "cd.yml does not run 'cd-rolling-release.sh lkg' — the rollback target would be unset again"
fi
# shellcheck disable=SC2016  # the literal $DEPLOY_URL IS the text cd.yml must carry
if grep -qF 'run: bash scripts/cd-rolling-release.sh ensure-canary "$DEPLOY_URL"' "$CD"; then
  pass "cd.yml establishes the canary before verifying the production deploy"
else
  fail "cd.yml does not run 'cd-rolling-release.sh ensure-canary' — verification could grade a different build"
fi
if ! grep -qE "vercel ls .*\| *grep -E 'READY'" "$CD" && ! grep -qF "grep -E 'READY'" "$CD"; then
  pass "the 'grep READY' last-known-good capture is gone from cd.yml"
else
  fail "cd.yml still greps 'READY' out of 'vercel ls' — that never matched ('● Ready')"
fi
# shellcheck disable=SC2016  # the literal $PREV_URL IS the text cd.yml must carry
if ! grep -qF 'vercel promote "$PREV_URL"' "$CD" && grep -qF 'vercel rollback "$PREV_URL" --yes' "$CD"; then
  pass "the automatic rollback uses Instant Rollback, not a promote that would start another rolling release"
else
  fail "cd.yml's automatic rollback still promotes (starts a 40-minute rollout of the old build) instead of vercel rollback"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
