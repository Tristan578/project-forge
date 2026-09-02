#!/usr/bin/env bash
# post-deploy-health-check.sh
#
# Performs a health check against a deployed URL with retries.
# Waits for the deployment to stabilize before the first attempt.
#
# Usage:
#   bash scripts/post-deploy-health-check.sh <base-url>
#
# Arguments:
#   base-url   Base URL to probe (no trailing slash). Either a deployment URL
#              (https://spawnforge-abc123.vercel.app) or the public production
#              domain (https://www.spawnforge.ai) — see HEALTH_CHECK_FORCE_CANARY.
#
# Environment variables (all optional):
#   HEALTH_CHECK_RETRIES        Number of attempts before declaring failure (default: 3)
#   HEALTH_CHECK_INTERVAL_S     Seconds between retry attempts (default: 10)
#   HEALTH_CHECK_STABILIZE_S    Seconds to wait before the first check (default: 30)
#   HEALTH_CHECK_TIMEOUT_S      curl max-time per request in seconds (default: 15)
#   HEALTH_CHECK_FORCE_CANARY   'true' to probe the ROLLING RELEASE CANARY through
#                               the public domain: every attempt carries
#                               `?vcrrForceCanary=true` (idempotent), Vercel answers
#                               with the `_vcrr_*` cookie pinning this client to the
#                               canary, and a cookie jar carries it across retries.
#                               Only set this while a rollout is ACTIVE — with none,
#                               Vercel sets no cookie (cd.yml gates it on
#                               `ensure-canary`'s canary_state output).
#                               This is how CD verifies the build it just made
#                               without any Deployment Protection credential:
#                               the public domain is unprotected, and the cookie
#                               is documented at vercel.com/docs/rolling-releases.
#   HEALTH_CHECK_EXPECT_COMMIT  When set, /api/health's `commit` (first 8 chars of
#                               VERCEL_GIT_COMMIT_SHA) must match this SHA's first
#                               8 chars, or the check fails. This is what proves
#                               the probe reached THIS deploy and not the base.
#   VERCEL_AUTOMATION_BYPASS    Deployment Protection bypass secret. Sent as the
#                               `x-vercel-protection-bypass` HEADER (never a query
#                               parameter — those land in logs). Works for Vercel
#                               Authentication, Password Protection and Trusted
#                               IPs alike (vercel.com/docs/deployment-protection/
#                               methods-to-bypass-deployment-protection/
#                               protection-bypass-automation).
#
# Exit codes:
#   0  All checks passed — deployment is healthy
#   1  Deployment unhealthy, unreachable, or NOT OBSERVABLE after all retries —
#      caller should treat the deploy as unverified and roll back / stop.
#
# There is deliberately no "could not authenticate, exit 0" path. Until #9624
# this script warned and exited 0 whenever Deployment Protection answered the
# probe, which was every production run (the deployment URL is SSO-protected and
# nothing passed a bypass), so the gate had never observed a single deploy it
# reported as healthy. A check that cannot observe the artifact is not a check;
# it must fail, and say why.

set -euo pipefail

# ---------- arguments & defaults ------------------------------------------

DEPLOY_URL="${1:-}"
if [[ -z "$DEPLOY_URL" ]]; then
  echo "::error::Usage: $0 <base-url>"
  exit 1
fi
DEPLOY_URL="${DEPLOY_URL%/}"

RETRIES="${HEALTH_CHECK_RETRIES:-3}"
INTERVAL="${HEALTH_CHECK_INTERVAL_S:-10}"
STABILIZE="${HEALTH_CHECK_STABILIZE_S:-30}"
TIMEOUT="${HEALTH_CHECK_TIMEOUT_S:-15}"
FORCE_CANARY="${HEALTH_CHECK_FORCE_CANARY:-false}"
EXPECT_COMMIT="${HEALTH_CHECK_EXPECT_COMMIT:-}"

HEALTH_ENDPOINT="${DEPLOY_URL}/api/health"
# TEST SEAMS: the suite points these at a scratch directory.
RESPONSE_FILE="${HEALTH_RESPONSE_FILE:-/tmp/health_response.json}"
HEADERS_FILE="${HEALTH_HEADERS_FILE:-/tmp/health_headers.txt}"

CURL_ARGS=(--silent --show-error --max-time "$TIMEOUT")
if [ -n "${VERCEL_AUTOMATION_BYPASS:-}" ]; then
  CURL_ARGS+=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS}")
  echo "Using the Deployment Protection bypass header"
fi
if [ "$FORCE_CANARY" = "true" ]; then
  COOKIE_JAR="$(mktemp)"
  trap 'rm -f "$COOKIE_JAR"' EXIT
  CURL_ARGS+=(--cookie-jar "$COOKIE_JAR" --cookie "$COOKIE_JAR")
  HEALTH_ENDPOINT="${HEALTH_ENDPOINT}?vcrrForceCanary=true"
  echo "Forcing the rolling-release canary via vcrrForceCanary (cookie jar: ${COOKIE_JAR})"
fi
if [ -n "$EXPECT_COMMIT" ]; then
  echo "Expecting /api/health to report commit ${EXPECT_COMMIT:0:8}"
fi

# ---------- engine reachability -------------------------------------------
#
# /api/health reports "Engine CDN: up" by probing the HOST. That is not the same
# question as "can THIS deploy load its engine", and the gap shipped: cd.yml
# stamps NEXT_PUBLIC_ENGINE_VERSION with the commit SHA on every deploy, while
# the CDN upload only ran when the engine changed -- once in twelve CD runs. So
# eleven deploys in twelve pointed at a prefix that was never written, the
# same-origin fallback was empty too, and the engine 404'd while this check
# stayed green (#9581).
#
# Fetch the EXACT url the deployed bundle will resolve, and fail on anything but
# 200. The CDN is public, so this needs no Vercel auth.
# Fail the deploy when the deployed app reports its engine as unreachable.
#
# WHY THIS READS THE APP'S OWN ANSWER RATHER THAN PROBING A URL ITSELF
#
# The engine url is built from NEXT_PUBLIC_ENGINE_CDN_URL, which lives in the
# Vercel project environment -- not in GitHub. A first cut of this check took
# the base url from `vars.ENGINE_CDN_URL`; no such variable exists, so it
# resolved to empty, took the "same-origin, nothing to check" branch on every
# run, and would have been dead code that read like a gate. Asking the running
# deployment removes the duplicated plumbing entirely: it knows its own config,
# and /api/health now probes the exact prefix useEngine.ts resolves.
#
# Statuses (public vocabulary: healthy is reported as 'up'):
#   up       -- the stamped prefix serves the engine
#   degraded -- no CDN configured; same-origin deployment, legitimate
#   down     -- the prefix 404s or errors: the editor cannot start. Fail.
#   absent   -- the service disappeared from the report. Fail closed rather
#               than treat a missing check as a passing one.
check_engine_health() {
  # TEST SEAM: the suite points this at fixture bodies. Defaults to the file the
  # probe above writes.
  local body="${HEALTH_RESPONSE_FILE:-/tmp/health_response.json}"
  local svc
  svc="$(HEALTH_BODY="$body" python3 - <<'PYEOF' 2>/dev/null
import json, os
try:
    d = json.load(open(os.environ['HEALTH_BODY']))
except Exception:
    print('PARSE_ERROR'); raise SystemExit(0)
for s in d.get('services') or []:
    if s.get('name') == 'Engine CDN':
        print('%s|%s' % (s.get('status', 'unknown'), (s.get('error') or '')))
        break
else:
    print('ABSENT')
PYEOF
)"

  case "$svc" in
    up*)
      echo "Engine check passed (Engine CDN: up)"
      return 0
      ;;
    degraded*)
      echo "Engine check skipped (Engine CDN: degraded — no CDN configured, same-origin deployment)"
      return 0
      ;;
    ABSENT|PARSE_ERROR|"")
      echo "::error::Engine check failed: /api/health did not report an 'Engine CDN' service (${svc:-no output}). Refusing to treat a missing check as a passing one." >&2
      return 1
      ;;
    *)
      echo "::error::Engine check failed: Engine CDN is ${svc%%|*} — ${svc#*|}. The deploy stamped a version whose CDN prefix does not serve the engine, so the editor cannot load it." >&2
      return 1
      ;;
  esac
}

# ---------- commit identity -----------------------------------------------
#
# Under Rolling Releases the public domain serves TWO builds at once. A 200 with
# a healthy body proves that SOMETHING is healthy; only the commit field proves
# it is the build this run deployed. Prefix-compare on 8 chars, which is what
# /api/health emits.
check_commit_identity() {
  [ -n "$EXPECT_COMMIT" ] || return 0
  local body="${HEALTH_RESPONSE_FILE:-/tmp/health_response.json}"
  local reported
  reported="$(HEALTH_BODY="$body" python3 - <<'PYEOF' 2>/dev/null
import json, os
try:
    d = json.load(open(os.environ['HEALTH_BODY']))
    print(str(d.get('commit') or ''))
except Exception:
    print('')
PYEOF
)"
  if [ -z "$reported" ]; then
    echo "::error::Commit check failed: /api/health reported no commit, so this probe cannot be tied to the deploy under test." >&2
    return 1
  fi
  if [ "${reported:0:8}" != "${EXPECT_COMMIT:0:8}" ]; then
    echo "::error::Commit check failed: /api/health reports ${reported:0:8}, expected ${EXPECT_COMMIT:0:8}. The probe reached a DIFFERENT build (the rolling-release base, or a newer canary) — this deploy is not what was verified." >&2
    return 1
  fi
  echo "Commit check passed (/api/health reports ${reported:0:8})"
}

# ---------- stabilization wait --------------------------------------------

echo "Waiting ${STABILIZE}s for deployment to stabilize: ${DEPLOY_URL}"
sleep "$STABILIZE"

# ---------- retry loop ----------------------------------------------------

attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$(( attempt + 1 ))
  echo "Health check attempt ${attempt}/${RETRIES}: ${HEALTH_ENDPOINT}"

  HTTP_CODE=$(curl "${CURL_ARGS[@]}" \
    --output "$RESPONSE_FILE" \
    --dump-header "$HEADERS_FILE" \
    --write-out "%{http_code}" \
    "$HEALTH_ENDPOINT") || HTTP_CODE="000"

  echo "  HTTP status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" -eq 200 ]; then
    # Validate JSON body
    if HEALTH_BODY="$RESPONSE_FILE" python3 -c "import json, os; d=json.load(open(os.environ['HEALTH_BODY'])); assert d.get('status') in ('ok','degraded')" 2>/dev/null; then
      echo "Health check passed (attempt ${attempt}/${RETRIES})"
      cat "$RESPONSE_FILE" 2>/dev/null || true
      # The right build, and a reachable engine: both are required before the
      # success exit. Either failing means the deploy is not verified.
      if ! check_commit_identity; then
        exit 1
      fi
      if ! check_engine_health; then
        exit 1
      fi
      exit 0
    else
      echo "::warning::HTTP 200 but response body is invalid or status is 'error'"
      cat "$RESPONSE_FILE" 2>/dev/null || true
    fi
  elif [ "$HTTP_CODE" -eq 401 ] || [ "$HTTP_CODE" -eq 403 ] || { [ "$HTTP_CODE" -eq 302 ] && grep -qi '^location: .*vercel\.com/sso' "$HEADERS_FILE" 2>/dev/null; }; then
    echo "::error::Deployment Protection answered the probe (HTTP ${HTTP_CODE}). The deployment cannot be observed from here: probe it through the public domain with HEALTH_CHECK_FORCE_CANARY=true, or pass the project's bypass secret as VERCEL_AUTOMATION_BYPASS." >&2
    exit 1
  else
    echo "::warning::Health check returned HTTP ${HTTP_CODE}"
    cat "$RESPONSE_FILE" 2>/dev/null || true
  fi

  if [ "$attempt" -lt "$RETRIES" ]; then
    echo "  Retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  fi
done

echo "::error::Health check failed after ${RETRIES} attempt(s) — deployment at ${DEPLOY_URL} is unhealthy or unreachable"
exit 1
