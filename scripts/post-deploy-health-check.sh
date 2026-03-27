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
#   VERCEL_AUTOMATION_BYPASS_SECRET  Bypass token for Vercel Deployment Protection (optional)
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
BYPASS_SECRET="${VERCEL_AUTOMATION_BYPASS_SECRET:-}"

# Build curl args for Vercel Deployment Protection bypass
BYPASS_ARGS=()
if [[ -n "$BYPASS_SECRET" ]]; then
  BYPASS_ARGS=(--header "x-vercel-protection-bypass: ${BYPASS_SECRET}")
  echo "Using Vercel Deployment Protection bypass token"
fi

# ---------- stabilization wait --------------------------------------------

echo "Waiting ${STABILIZE}s for deployment to stabilize: ${DEPLOY_URL}"
sleep "$STABILIZE"

# ---------- retry loop ----------------------------------------------------

attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$(( attempt + 1 ))
  echo "Health check attempt ${attempt}/${RETRIES}: ${HEALTH_ENDPOINT}"

  HTTP_CODE=$(curl --silent \
    --output /tmp/health_response.json \
    --write-out "%{http_code}" \
    --max-time "$TIMEOUT" \
    "${BYPASS_ARGS[@]}" \
    "$HEALTH_ENDPOINT") || HTTP_CODE="000"

  echo "  HTTP status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" -eq 200 ]; then
    # Validate JSON body
    if python3 -c "import json; d=json.load(open('/tmp/health_response.json')); assert d.get('status') in ('ok','degraded')" 2>/dev/null; then
      echo "Health check passed (attempt ${attempt}/${RETRIES})"
      cat /tmp/health_response.json 2>/dev/null || true
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

echo "::error::Health check failed after ${RETRIES} attempt(s) — deployment at ${DEPLOY_URL} is unhealthy"
exit 1
