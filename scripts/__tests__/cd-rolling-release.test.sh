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
# THE SHAPE IS PINNED TO THE API, NOT TO THE SCRIPT
#
# The first cut of this suite fed the script flat `{ "state": ... }` bodies —
# the shape the CLI prints after destructuring — and certified 25/25 PASS for
# a script that would have read empty fields against the real endpoint on
# every production deploy. Every fixture below therefore carries the wrapper
# documented at openapi.vercel.sh (`{ "rollingRelease": {...} | null }`), and
# LIVE_ACTIVE below is the document a real GET returned on 2026-09-02, trimmed
# to the fields the script reads. If the API shape changes, change it HERE from
# a live read, never to match the script.
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
mkdir -p "$TMP/bin" "$TMP/fx" "$TMP/cnt"

# The curl stub: finds the URL among its arguments, strips the query string,
# maps the path to a fixture file, and prints "<body>\n<status>" exactly as
# `curl -w '\n%{http_code}'` does. Every request is appended to a log so the
# suite can assert WHICH calls were made and HOW MANY TIMES. It is sequence-
# aware: the Nth call for a key answers from `<key>.N` when that fixture
# exists, else from `<key>` — so a case can say "first read: a stale canary;
# second read: ours is the canary".
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
n=$(( $(cat "$COUNTS/$key" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$COUNTS/$key"
fx="$FIXTURES/$key.$n"
[ -f "$fx" ] || fx="$FIXTURES/$key"
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
# fixture_nth <N> <METHOD> <path> <status> <body>: the answer for the Nth call only.
fixture_nth() {
  local key
  key="$(printf '%s %s' "$2" "$3" | tr '/ ' '__')"
  printf '%s\n%s' "$5" "$4" > "$TMP/fx/$key.$1"
}
reset_fixtures() { rm -f "$TMP/fx"/* "$TMP/cnt"/*; : > "$TMP/log"; : > "$TMP/out"; }
count() { grep -c "^$1\$" "$TMP/log" || true; }
# The LAST disposition written is the one cd.yml reads.
last_disposition() { grep '^disposition=' "$TMP/out" | tail -1; }

run() {
  (cd "$TMP" && PATH="$TMP/bin:$PATH" CURL_LOG="$TMP/log" FIXTURES="$TMP/fx" COUNTS="$TMP/cnt" \
    VERCEL_TOKEN=tok VERCEL_TEAM_ID=team_1 VERCEL_PROJECT_ID=prj_1 \
    VERCEL_API_URL=https://api.example.test RR_POLL_ATTEMPTS="${ATTEMPTS:-3}" RR_POLL_INTERVAL_S=0 \
    GITHUB_OUTPUT="$TMP/out" bash "$SCRIPT" "$@" 2>&1)
}

RR=/v1/projects/prj_1/rolling-release
PROJECT=/v9/projects/prj_1
OURS=spawnforge-ours-tnolan.vercel.app
DEPLOYMENT=/v13/deployments/$OURS
START=$RR/start
ROLLBACK_BASE=/v1/projects/prj_1/rollback/dpl_base

# A live GET on 2026-09-02 04:50 UTC (project spawnforge), trimmed to the fields
# the script reads. Note the wrapper and the nesting.
LIVE_ACTIVE='{"rollingRelease":{"state":"ACTIVE","substate":null,"currentDeployment":{"id":"dpl_4ReF3BPyrssnUfUQC7f4aB7wH9jt","url":"spawnforge-75vgr46qg-tnolan.vercel.app","target":"production","createdAt":1788320738792,"readyState":"READY"},"canaryDeployment":{"id":"dpl_B6Ug75PArByBjN76t2EtanXNmBhj","url":"spawnforge-ia2589c6u-tnolan.vercel.app","target":"production","createdAt":1788323657956,"readyState":"READY"},"queuedDeploymentId":null,"currentCanaryPercentage":5,"activeStage":{"index":0,"isFinalStage":false,"targetPercentage":5,"requireApproval":false,"duration":10,"linearShift":true}}}'
wrap() { printf '{"rollingRelease":%s}' "$1"; }

# ---------------------------------------------------------------------------
echo "=== lkg: the rollback target is the rolling-release BASE, never the canary ==="

reset_fixtures
fixture GET "$RR" 200 "$LIVE_ACTIVE"
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-75vgr46qg-tnolan.vercel.app" ] && grep -q '^prev_url=https://spawnforge-75vgr46qg-tnolan.vercel.app$' "$TMP/out"; then
  pass "ACTIVE rollout (live shape): lkg is rollingRelease.currentDeployment (the base) with an https scheme, and prev_url is written"
else
  fail "ACTIVE rollout: expected the base url; got rc=$RC: $OUT / out=$(cat "$TMP/out")"
fi
if ! grep -q ia2589c6u "$TMP/out"; then
  pass "ACTIVE rollout: the canary is never offered as a rollback target"
else
  fail "ACTIVE rollout: the canary leaked into prev_url"
fi

reset_fixtures
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_old","url":"spawnforge-old-tnolan.vercel.app"}}')"
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_live","url":"spawnforge-live-tnolan.vercel.app"}}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-live-tnolan.vercel.app" ]; then
  pass "no active rollout (COMPLETE): lkg is the project's production target, not a stale rolling-release record"
else
  fail "no active rollout: expected the production target; got rc=$RC: $OUT"
fi

reset_fixtures
fixture GET "$RR" 200 '{"rollingRelease":null}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_live","url":"spawnforge-live-tnolan.vercel.app"}}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-live-tnolan.vercel.app" ]; then
  pass "rollingRelease: null (enabled, nothing rolled out yet): lkg falls through to the production target"
else
  fail "rollingRelease null: expected the production target; got rc=$RC: $OUT"
fi

reset_fixtures
fixture GET "$RR" 404 '{"error":{"code":"not_found","message":"rolling release not enabled"}}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_live","url":"spawnforge-live-tnolan.vercel.app"}}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" = 0 ] && [ "$(tail -1 <<<"$OUT")" = "https://spawnforge-live-tnolan.vercel.app" ]; then
  pass "Rolling Releases disabled (404): lkg falls through to the production target"
else
  fail "Rolling Releases disabled: expected the production target; got rc=$RC: $OUT"
fi

# --- refusals: an unanswerable question must not become an empty answer ---
reset_fixtures
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "a 5xx from the rolling-release API fails closed and writes NO prev_url"
else
  fail "a 5xx should fail closed; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","canaryDeployment":{"id":"dpl_canary","url":"spawnforge-canary-tnolan.vercel.app"}}')"
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "an ACTIVE rollout with no currentDeployment refuses to guess"
else
  fail "ACTIVE without a base should refuse; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures
fixture GET "$RR" 200 '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","url":"spawnforge-base-tnolan.vercel.app"}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "a 200 WITHOUT the rollingRelease wrapper (the shape the first cut expected) is refused, not misread as idle"
else
  fail "an unwrapped body should fail closed; got rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$RR" 200 '{"rollingRelease":null}'
fixture GET "$PROJECT" 200 '{"targets":{}}'
OUT="$(run lkg)"; RC=$?
if [ "$RC" != 0 ] && [ ! -s "$TMP/out" ]; then
  pass "a project with no production target refuses rather than emit an empty url (the exact silent failure this replaces)"
else
  fail "no production target should refuse; got rc=$RC out=$(cat "$TMP/out")"
fi

reset_fixtures
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

OURS_DOC='{"id":"dpl_ours","createdAt":2000,"readyState":"READY"}'

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentCanaryPercentage":5,"currentDeployment":{"id":"dpl_base","createdAt":1000},"canaryDeployment":{"id":"dpl_ours","createdAt":2000}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=canary$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "already the canary: succeeds, reports canary_state=canary, mutates nothing"
else
  fail "already the canary: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_ours","createdAt":2000}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=current$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "already current (rollout completed): succeeds with canary_state=current, mutates nothing"
else
  fail "already current: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 '{"rollingRelease":null}'
fixture GET "$PROJECT" 200 "{\"targets\":{\"production\":{\"id\":\"dpl_ours\",\"url\":\"$OURS\"}}}"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=current$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "rollingRelease: null and the production target is ours: succeeds with canary_state=current, no start issued"
else
  fail "null + target is ours: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 404 '{"error":{"code":"not_found"}}'
fixture GET "$PROJECT" 200 "{\"targets\":{\"production\":{\"id\":\"dpl_ours\",\"url\":\"$OURS\"}}}"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=current$' "$TMP/out"; then
  pass "Rolling Releases disabled (404): succeeds when the production target is this deployment"
else
  fail "disabled + target is ours: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# The live incident: an OLDER canary is still ramping, so Vercel never started
# ours. The script must abort the stale rollout (rollback to its base — nothing
# is lost, ours is a superset) and then start ours — each EXACTLY ONCE, however
# many polls still show the old canary afterwards.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500}}')"
fixture POST "$ROLLBACK_BASE" 200 '{}'
fixture POST "$START" 200 "$(wrap '{"state":"ACTIVE","canaryDeployment":{"id":"dpl_ours"}}')"
OUT="$(ATTEMPTS=4 run ensure-canary "https://$OURS")"; RC=$?
if [ "$(count "POST $ROLLBACK_BASE")" = "1" ] && [ "$(count "POST $START")" = "1" ]; then
  pass "a stale OLDER canary is aborted (rollback to its base) and this deployment is started — each exactly once across 4 polls"
else
  fail "stale older canary: expected 1 rollback + 1 start; log=$(cat "$TMP/log")"
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

# The same path, adopted: the second read reflects our start. This is the
# headline fix for #9625 succeeding, and the only case that proves the
# abort+start branch can ever exit 0.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture_nth 1 GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500}}')"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentCanaryPercentage":5,"currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_ours","createdAt":2000}}')"
fixture POST "$ROLLBACK_BASE" 200 '{}'
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=4 run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=canary$' "$TMP/out" && [ "$(last_disposition)" = "disposition=mutated" ] && [ "$(count "POST $ROLLBACK_BASE")" = "1" ] && [ "$(count "POST $START")" = "1" ] && [ "$(count "GET $RR")" = "2" ]; then
  pass "stale older canary, then the API reflects ours: exit 0 with canary_state=canary after exactly one rollback and one start (disposition=mutated)"
else
  fail "abort+start adopted: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

# Queued behind an older active canary: the queue drains only when that rollout
# resolves (up to 40 minutes), so this must take the same abort+start path, not
# wait out the poll budget.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500},"queuedDeploymentId":"dpl_ours"}')"
fixture POST "$ROLLBACK_BASE" 200 '{}'
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=2 run ensure-canary "https://$OURS")"; RC=$?
if [ "$(count "POST $ROLLBACK_BASE")" = "1" ] && [ "$(count "POST $START")" = "1" ] && grep -q 'queued behind the older canary' <<<"$OUT"; then
  pass "queued behind an OLDER canary: the stale rollout is aborted and ours started, not waited out"
else
  fail "queued behind older: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# A NEWER canary means a later merge owns production: this run is superseded.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_newer","createdAt":3000}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && grep -qi superseded <<<"$OUT"; then
  pass "a NEWER canary: fails loudly as superseded and issues no mutation"
else
  fail "newer canary: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_newer","createdAt":3000},"queuedDeploymentId":"dpl_ours"}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && grep -qi superseded <<<"$OUT"; then
  pass "queued behind a NEWER canary: superseded, no mutation"
else
  fail "queued behind newer: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# ACTIVE with a canary but no base: there is no rollback target, so abort must
# be refused (a rollback to an empty id is a malformed mutation).
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","canaryDeployment":{"id":"dpl_stale","createdAt":1500}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && grep -q 'no currentDeployment' <<<"$OUT"; then
  pass "an ACTIVE stale canary with no currentDeployment is refused without any mutation"
else
  fail "active without base: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# Idle document and ours is not current: start ours, and only report success
# once the API reflects it.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_base","createdAt":500}}')"
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=3 run ensure-canary "https://$OURS")"; RC=$?
if [ "$(count "POST $START")" = "1" ] && [ "$RC" != 0 ]; then
  pass "idle project, ours not current: start is issued exactly once across the polling loop, and success is withheld until the API reflects it"
else
  fail "idle project: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 '{"rollingRelease":null}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_other","url":"spawnforge-other-tnolan.vercel.app"}}}'
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=3 run ensure-canary "https://$OURS")"; RC=$?
if [ "$(count "POST $START")" = "1" ] && [ "$RC" != 0 ]; then
  pass "rollingRelease: null and the target is another deployment: start is issued once, success withheld"
else
  fail "null + other target: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# A canary whose age cannot be read: older or newer is the whole decision, so
# the script must refuse — a guess of "older" would abort a NEWER build.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_unknown_age"}}')"
fixture POST "$ROLLBACK_BASE" 200 '{}'
fixture POST "$START" 200 '{}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && grep -q 'createdAt' <<<"$OUT" && [ "$(last_disposition)" = "disposition=untouched" ]; then
  pass "a foreign ACTIVE canary with no createdAt is refused without any mutation (never guessed 'older'; disposition=untouched)"
else
  fail "canary without createdAt: rc=$RC log=$(cat "$TMP/log") out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_odd","createdAt":"yesterday"}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log"; then
  pass "a non-numeric canary createdAt is refused the same way"
else
  fail "non-numeric createdAt: rc=$RC log=$(cat "$TMP/log") $OUT"
fi

# The abort succeeded and the start was refused: production is now the base
# with auto-assignment off, and nothing will change that by itself. That is a
# hard error naming the base, not a warning followed by a generic timeout.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500}}')"
fixture POST "$ROLLBACK_BASE" 200 '{}'
fixture POST "$START" 403 '{"error":{"code":"forbidden"}}'
OUT="$(ATTEMPTS=4 run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && [ "$(count "POST $ROLLBACK_BASE")" = "1" ] && [ "$(count "POST $START")" = "1" ] && grep -q 'NOT started' <<<"$OUT" && grep -q 'dpl_base' <<<"$OUT" && [ "$(last_disposition)" = "disposition=mutated" ]; then
  pass "a refused start AFTER an abort fails at once, names the base now serving, and reports disposition=mutated"
else
  fail "refused start after abort: rc=$RC log=$(cat "$TMP/log") out=$(cat "$TMP/out") $OUT"
fi
if [ "$(count "GET $RR")" = "1" ]; then
  pass "and it does not burn the poll budget after that error"
else
  fail "the loop kept polling after the fatal start error: $(count "GET $RR") reads"
fi

# disposition is what lets cd.yml tell 'refused, untouched' from every exit
# on which this build may be live. Superseded: a foreign canary is active, so
# ours is provably not serving.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_newer","createdAt":3000}}')"
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$(last_disposition)" = "disposition=untouched" ]; then
  pass "a superseded exit reports disposition=untouched (cd.yml must not roll back a run that touched nothing)"
else
  fail "superseded exit: out=$(cat "$TMP/out")"
fi

# Our start was accepted, then the API went away: the unverified canary may
# be ramping. That must reach cd.yml's rollback path, so the disposition is
# 'started', never 'untouched'.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture_nth 1 GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_base","createdAt":500}}')"
fixture GET "$RR" 500 '{"error":"boom"}'
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=3 run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && [ "$(count "POST $START")" = "1" ] && [ "$(last_disposition)" = "disposition=started" ]; then
  pass "a transport error AFTER an accepted start fails with disposition=started — the canary may be ramping, so cd.yml rolls back"
else
  fail "transport error after start: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

# Before anything is known, the build may already be live via auto-assign
# (Vercel starts a rollout the moment a production deployment is READY), so
# a lookup that fails at once must not read as 'untouched'.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && [ "$(last_disposition)" = "disposition=unknown" ]; then
  pass "a rolling-release lookup that fails on the first read exits with disposition=unknown (may be live — roll back)"
else
  fail "first-read failure: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# Idle project, start accepted, second read shows ours as the canary.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture_nth 1 GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_base","createdAt":500}}')"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentCanaryPercentage":5,"currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_ours","createdAt":2000}}')"
fixture POST "$START" 200 '{}'
OUT="$(ATTEMPTS=3 run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^canary_state=canary$' "$TMP/out" && [ "$(count "POST $START")" = "1" ] && ! grep -q rollback "$TMP/log" && [ "$(last_disposition)" = "disposition=started" ]; then
  pass "idle project, then the API reflects our start: exit 0 with canary_state=canary, one start, no rollback"
else
  fail "idle start adopted: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

# --- refusals ---
reset_fixtures
fixture GET "$DEPLOYMENT" 404 '{"error":{"code":"not_found"}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log" && [ "$(last_disposition)" = "disposition=unknown" ]; then
  pass "an unresolvable deployment url fails closed without touching the rollout, with disposition=unknown (the build may be live via auto-assign)"
else
  fail "unresolvable url: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log")"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log"; then
  pass "a 5xx from the rolling-release API fails closed without any mutation"
else
  fail "a 5xx should fail closed; got rc=$RC log=$(cat "$TMP/log")"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 '{"state":"COMPLETE","currentDeployment":{"id":"dpl_ours"}}'
OUT="$(run ensure-canary "https://$OURS")"; RC=$?
if [ "$RC" != 0 ] && ! grep -q POST "$TMP/log"; then
  pass "an unwrapped 200 body is refused before any mutation — never misread as 'ours is current'"
else
  fail "unwrapped body: rc=$RC log=$(cat "$TMP/log") $OUT"
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
echo "=== superseded: a probe that failed because a later merge took over is not an unhealthy build ==="

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_newer","createdAt":3000}}')"
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=true$' "$TMP/out" && grep -q '^owner=dpl_newer$' "$TMP/out" && ! grep -q POST "$TMP/log"; then
  pass "a NEWER active canary owns production: superseded=true, owner named, nothing mutated"
else
  fail "newer canary: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_ours","createdAt":2000}}')"
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out"; then
  pass "this deployment is the active canary: superseded=false (the failed probe is about THIS build)"
else
  fail "ours is canary: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# No rollout active: the owner is the project's production target — the same
# source lkg uses — never the idle rolling-release record, which is history.
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_newer","createdAt":3000}}')"
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_newer","createdAt":3000,"url":"spawnforge-newer-tnolan.vercel.app"}}}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=true$' "$TMP/out" && grep -q '^owner=dpl_newer$' "$TMP/out" && [ "$(count "GET $PROJECT")" = "1" ]; then
  pass "a NEWER deployment already completed its rollout: superseded=true, read from the production target"
else
  fail "newer completed: rc=$RC out=$(cat "$TMP/out") log=$(cat "$TMP/log") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_ours","createdAt":2000}}')"
fixture GET "$PROJECT" 200 "{\"targets\":{\"production\":{\"id\":\"dpl_ours\",\"createdAt\":2000,\"url\":\"$OURS\"}}}"
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out"; then
  pass "this deployment is current: superseded=false"
else
  fail "ours is current: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# The idle record says a newer build completed, but a hand promote since then
# made an OLDER build the production target: the target wins (superseded=false
# — and lkg would have named that same target).
reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_newer","createdAt":3000}}')"
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_old","createdAt":100,"url":"spawnforge-old-tnolan.vercel.app"}}}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out" && grep -q '^owner=dpl_old$' "$TMP/out"; then
  pass "an idle rolling-release record never outranks the production target: superseded and lkg share one source of truth"
else
  fail "idle record vs target: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"ACTIVE","currentDeployment":{"id":"dpl_base","createdAt":500},"canaryDeployment":{"id":"dpl_stale","createdAt":1500}}')"
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out"; then
  pass "an OLDER canary owns production: superseded=false — this build never took over, roll back"
else
  fail "older canary: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 '{"rollingRelease":null}'
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_newer","createdAt":3000,"url":"spawnforge-newer-tnolan.vercel.app"}}}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=true$' "$TMP/out"; then
  pass "no rolling release and a NEWER production target: superseded=true"
else
  fail "null + newer target: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 200 "$(wrap '{"state":"COMPLETE","currentDeployment":{"id":"dpl_undated"}}')"
fixture GET "$PROJECT" 200 '{"targets":{"production":{"id":"dpl_undated","url":"spawnforge-undated-tnolan.vercel.app"}}}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out"; then
  pass "an owner whose age is unknown answers false — a failure whose cause cannot be established is still rolled back"
else
  fail "undated owner: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

reset_fixtures
fixture GET "$DEPLOYMENT" 200 "$OURS_DOC"
fixture GET "$RR" 500 '{"error":"boom"}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out" && grep -q '::warning::' <<<"$OUT"; then
  pass "a 5xx answers superseded=false with a warning, so the rollback still proceeds"
else
  fail "5xx: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

# The step is red with no superseded= output if this ever mirrors
# ensure-canary's `|| exit 1`; the rollback and the incident, gated on
# superseded == 'false', would then be silently skipped.
reset_fixtures
fixture GET "$DEPLOYMENT" 404 '{"error":{"code":"not_found"}}'
OUT="$(run superseded "https://$OURS")"; RC=$?
if [ "$RC" = 0 ] && grep -q '^superseded=false$' "$TMP/out" && grep -q '::warning::' <<<"$OUT" && ! grep -q POST "$TMP/log"; then
  pass "an unresolvable deployment url answers superseded=false with a warning and exit 0 — the rollback it gates still proceeds"
else
  fail "superseded unresolvable url: rc=$RC out=$(cat "$TMP/out") $OUT"
fi

OUT="$(run superseded)"; RC=$?
if [ "$RC" = 2 ]; then
  pass "superseded without a url is a usage error (exit 2)"
else
  fail "superseded without url: expected exit 2, got $RC"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== wiring ==="
CD="$HERE/../../.github/workflows/cd.yml"
WEB_FILTER="$(grep -F 'if echo "$CHANGED" | grep -qE' "$CD" | grep -F '^web/' | sed -E "s/.*grep -qE '([^']+)'.*/\1/")"
if printf '%s\n' 'web/src/app/page.tsx' | grep -qE "$WEB_FILTER" \
  && printf '%s\n' 'package.json' | grep -qE "$WEB_FILTER" \
  && ! printf '%s\n' '.github/workflows/ci.yml' | grep -qE "$WEB_FILTER"; then
  pass "web deploy filter includes app/package changes but excludes workflow-only changes"
else
  fail "web deploy filter must deploy web/package changes without deploying .github-only pushes (filter: $WEB_FILTER)"
fi
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
if grep -qF "steps.canary.outputs.canary_state == 'canary'" "$CD"; then
  pass "cd.yml gates the canary pin (force-canary) on the script's canary_state output"
else
  fail "cd.yml forces the canary cookie unconditionally — with no active rollout Vercel sets no cookie and the smoke suite fails a healthy deploy"
fi
# shellcheck disable=SC2016  # the literal ${{ github.sha }} IS the text cd.yml must carry
if grep -qF 'HEALTH_CHECK_EXPECT_COMMIT: ${{ github.sha }}' "$CD" && grep -qF 'SMOKE_EXPECT_COMMIT: ${{ github.sha }}' "$CD"; then
  pass "both probes are told which commit to expect — the only proof they reached THIS deploy"
else
  fail "an EXPECT_COMMIT env line is missing from cd.yml; without it check_commit_identity returns 0 and the smoke identity test skips, and 'some healthy build answered' passes again"
fi
# shellcheck disable=SC2016  # the literal $DEPLOY_URL IS the text cd.yml must carry
if grep -qF 'run: bash scripts/cd-rolling-release.sh superseded "$DEPLOY_URL"' "$CD"; then
  pass "cd.yml asks whether a later merge took over before rolling back"
else
  fail "cd.yml does not run 'cd-rolling-release.sh superseded' — a superseded run would Instant-Rollback the newer build's rollout"
fi
if [ "$(grep -cF "steps.superseded.outputs.superseded == 'false'" "$CD")" -ge 2 ]; then
  pass "both the automatic rollback and the incident issue are gated on superseded == 'false'"
else
  fail "the rollback / incident steps are not both gated on the superseded answer ($(grep -cF "steps.superseded.outputs.superseded == 'false'" "$CD") gates)"
fi
if grep -qF "steps.canary.outputs.disposition != 'untouched'" "$CD"; then
  pass "every canary-step failure except a provably untouched one reaches the rollback path"
else
  fail "cd.yml does not gate on ensure-canary's disposition — an accepted start followed by a transport error, or an abort followed by a refused start, would leave an unverified build live with no rollback record"
fi
if grep -qF 'cancel-in-progress: false' "$CD" && ! grep -qF 'cancel-in-progress: true' "$CD"; then
  pass "cd.yml serialises production deploys: a running deploy is never cancelled by the next push (a cancelled run's canary would keep ramping unverified with every failure()-gated step skipped)"
else
  fail "cd.yml cancels a running deploy when the next push arrives — the cancelled run's unverified canary keeps ramping and nothing rolls it back or records it"
fi
# shellcheck disable=SC2016  # the literal ${{ cancelled() ... }} IS the text cd.yml must carry
if grep -qF 'if: ${{ cancelled() && steps.deploy.outputs.url != '"'"''"'"' }}' "$CD"; then
  pass "a run cancelled by hand after the production deploy is recorded (cancelled() is not failure())"
else
  fail "cd.yml has no cancelled()-gated record after the production deploy"
fi
if ! grep -qF "grep -E 'READY'" "$CD"; then
  pass "the 'grep READY' last-known-good capture is gone from cd.yml"
else
  fail "cd.yml still greps 'READY' out of 'vercel ls' — that never matched ('● Ready')"
fi
if ! grep -qE '^\s*vercel promote ' "$CD" && [ "$(grep -cE '^\s*vercel rollback "\$[A-Z_]+" --yes' "$CD")" -ge 2 ]; then
  pass "no rollback path in cd.yml promotes: both the automatic and the manual rollback use Instant Rollback"
else
  fail "cd.yml still has a 'vercel promote' rollback path (promote starts a staged rollout of the old build, or no-ops mid-rollout) — automatic AND manual must use vercel rollback"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
