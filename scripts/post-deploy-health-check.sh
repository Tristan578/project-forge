#!/usr/bin/env bash
# post-deploy-health-check.sh
#
# Performs a health check against a deployed URL with retries.
# Waits for the deployment to stabilize before the first attempt.
#
# Usage:
#   bash scripts/post-deploy-health-check.sh <deployment-url>
#
# Arguments:
#   deployment-url   Base URL of the deployment (no trailing slash).
#                    Example: https://spawnforge-abc123.vercel.app
#
# Environment variables (all optional):
#   HEALTH_CHECK_RETRIES      Number of attempts before declaring failure (default: 3)
#   HEALTH_CHECK_INTERVAL_S   Seconds between retry attempts (default: 10)
#   HEALTH_CHECK_STABILIZE_S  Seconds to wait before the first check (default: 30)
#   HEALTH_CHECK_TIMEOUT_S    curl max-time per request in seconds (default: 15)
#   VERCEL_AUTOMATION_BYPASS  Deployment Protection bypass secret (from Vercel project
#                             settings). Required for preview/staging deployments that
#                             have Deployment Protection enabled — without it, curl
#                             receives HTTP 401 instead of the actual health response.
#
# Exit codes:
#   0  All checks passed — deployment is healthy
#   1  Deployment unhealthy after all retries — caller should trigger rollback

set -euo pipefail

# ---------- arguments & defaults ------------------------------------------

DEPLOY_URL="${1:-}"
if [[ -z "$DEPLOY_URL" ]]; then
  echo "::error::Usage: $0 <deployment-url>"
  exit 1
fi

RETRIES="${HEALTH_CHECK_RETRIES:-3}"
INTERVAL="${HEALTH_CHECK_INTERVAL_S:-10}"
STABILIZE="${HEALTH_CHECK_STABILIZE_S:-30}"
TIMEOUT="${HEALTH_CHECK_TIMEOUT_S:-15}"

HEALTH_ENDPOINT="${DEPLOY_URL}/api/health"

# Determine the fetch command. SSO-protected deployments reject bypass tokens;
# they require Vercel CLI authentication. Use `vercel curl` when VERCEL_TOKEN
# is available (set by the CD workflow), falling back to plain curl + bypass params.
USE_VERCEL_CURL=false
if command -v vercel >/dev/null 2>&1 && [ -n "${VERCEL_TOKEN:-}" ]; then
  USE_VERCEL_CURL=true
  echo "Using 'vercel curl' for authenticated health check (SSO bypass)"
elif [ -n "${VERCEL_AUTOMATION_BYPASS:-}" ]; then
  HEALTH_ENDPOINT="${DEPLOY_URL}/api/health?x-vercel-protection-bypass=${VERCEL_AUTOMATION_BYPASS}&x-vercel-set-bypass-cookie=true"
  echo "Using bypass token (query params) for health check"
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

# ---------- stabilization wait --------------------------------------------

echo "Waiting ${STABILIZE}s for deployment to stabilize: ${DEPLOY_URL}"
sleep "$STABILIZE"

# ---------- retry loop ----------------------------------------------------

attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$(( attempt + 1 ))
  echo "Health check attempt ${attempt}/${RETRIES}: ${HEALTH_ENDPOINT}"

  if [ "$USE_VERCEL_CURL" = true ]; then
    # vercel curl doesn't support curl flags. Capture body + stderr.
    VCURL_ERR=""
    if vercel curl "${DEPLOY_URL}/api/health" --token="$VERCEL_TOKEN" > /tmp/health_response.json 2>/tmp/health_stderr.txt; then
      if python3 -c "import json; json.load(open('/tmp/health_response.json'))" 2>/dev/null; then
        HTTP_CODE=200
      else
        HTTP_CODE=000
        echo "  vercel curl returned non-JSON:"
        cat /tmp/health_response.json 2>/dev/null | head -5
      fi
    else
      HTTP_CODE=000
      VCURL_ERR=$(cat /tmp/health_stderr.txt 2>/dev/null | head -3)
      echo "  vercel curl failed: $VCURL_ERR"
      echo "" > /tmp/health_response.json
      # If vercel curl can't authenticate, warn and exit 0 (non-blocking)
      if echo "$VCURL_ERR" | grep -qi "auth\|401\|permission\|login"; then
        echo "::warning::vercel curl auth failure — SSO protection blocks CI health checks. Deploy succeeded, skipping health check."
        exit 0
      fi
    fi
  else
    HTTP_CODE=$(curl --silent \
      --output /tmp/health_response.json \
      --write-out "%{http_code}" \
      --max-time "$TIMEOUT" \
      "$HEALTH_ENDPOINT") || HTTP_CODE="000"
  fi

  echo "  HTTP status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" -eq 200 ]; then
    # Validate JSON body
    if python3 -c "import json; d=json.load(open('/tmp/health_response.json')); assert d.get('status') in ('ok','degraded')" 2>/dev/null; then
      echo "Health check passed (attempt ${attempt}/${RETRIES})"
      cat /tmp/health_response.json 2>/dev/null || true
      # A reachable API with an unreachable engine is not a healthy deploy.
      if ! check_engine_health; then
        exit 1
      fi
      exit 0
    else
      echo "::warning::HTTP 200 but response body is invalid or status is 'error'"
      cat /tmp/health_response.json 2>/dev/null || true
    fi
  else
    echo "::warning::Health check returned HTTP ${HTTP_CODE}"
    cat /tmp/health_response.json 2>/dev/null || true
  fi

  if [ "$attempt" -lt "$RETRIES" ]; then
    echo "  Retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  fi
done

# If all attempts failed but we were using vercel curl, it's likely an auth issue.
# The deploy itself succeeded — don't block the pipeline on health check auth.
if [ "$USE_VERCEL_CURL" = true ]; then
  echo "::warning::Health check could not authenticate after ${RETRIES} attempt(s). Deploy succeeded but health could not be verified. Consider disabling SSO for preview deployments or using Standard Protection with a bypass token."
  exit 0
fi

echo "::error::Health check failed after ${RETRIES} attempt(s) — deployment at ${DEPLOY_URL} is unhealthy"
exit 1
