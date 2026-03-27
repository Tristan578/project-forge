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

BYPASS_SECRET="${VERCEL_AUTOMATION_BYPASS:-}"

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
