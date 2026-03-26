#!/usr/bin/env bash
# SessionStart hook: verify production site is healthy before any code changes.
# If production is broken, alert immediately — don't start backlog work on a broken product.
#
# Lesson #62: NEVER trust green CI as proof the product works.

PROD_URL="${PRODUCTION_URL:-https://www.spawnforge.ai}"

echo "=== Production Health Check ==="

# 1. Landing page loads
STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "$PROD_URL/" 2>/dev/null)
if [ "$STATUS" != "200" ]; then
  echo "CRITICAL: Landing page returns $STATUS (expected 200)"
  echo "  Production may be down or misconfigured."
else
  echo "OK: Landing page returns 200"
fi

# 2. Check for Clerk test keys in HTML
HTML=$(curl -sL "$PROD_URL/" 2>/dev/null)
if echo "$HTML" | grep -q "pk_test_"; then
  echo "CRITICAL: Production HTML contains pk_test_ Clerk key"
  echo "  This breaks auth for all visitors. Update Vercel env vars."
fi

# 3. WASM CDN accessible
WASM_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "https://engine.spawnforge.ai/engine-pkg-webgl2/forge_engine.js" 2>/dev/null)
if [ "$WASM_STATUS" != "200" ]; then
  echo "WARNING: WASM engine JS returns $WASM_STATUS from CDN"
else
  echo "OK: WASM engine accessible on CDN"
fi

# 4. /dashboard should redirect (not 404)
DASH_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "$PROD_URL/dashboard" 2>/dev/null)
if [ "$DASH_STATUS" = "404" ]; then
  echo "CRITICAL: /dashboard returns 404 — production build is broken or stale"
  echo "  Authenticated routes are missing. Check Vercel deployment."
elif [ "$DASH_STATUS" = "307" ] || [ "$DASH_STATUS" = "302" ]; then
  echo "OK: /dashboard redirects to sign-in (auth working)"
else
  echo "INFO: /dashboard returns $DASH_STATUS"
fi

echo "=== End Health Check ==="
