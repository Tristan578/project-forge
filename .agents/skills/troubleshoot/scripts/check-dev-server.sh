#!/usr/bin/env bash
# check-dev-server.sh — Verify dev server status and diagnose common issues
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-dev-server.sh"
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "${REPO_ROOT}"

PASS="PASS"
FAIL="FAIL"
WARN="WARN"
SKIP="SKIP"

print_check() {
  local label="$1"
  local status="$2"
  local detail="${3:-}"
  printf "  %-45s [%s]" "${label}" "${status}"
  if [ -n "${detail}" ]; then
    printf "  %s" "${detail}"
  fi
  printf "\n"
}

echo "=== Dev Server Diagnostics ==="
echo ""

# --- Check if Portless is running ---
echo "--- Portless (reverse proxy) ---"
PORTLESS_OK=0
if curl -s --max-time 2 http://spawnforge.localhost:1355 >/dev/null 2>&1; then
  print_check "Portless proxy" "${PASS}" "http://spawnforge.localhost:1355"
  PORTLESS_OK=1
else
  print_check "Portless proxy" "${SKIP}" "not running (install: npx portless, or use localhost:3000)"
fi

# --- Check fallback port ---
echo ""
echo "--- Direct Dev Server (port 3000) ---"
DIRECT_OK=0
if curl -s --max-time 2 http://localhost:3000 >/dev/null 2>&1; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000 2>/dev/null || echo "000")
  print_check "localhost:3000" "${PASS}" "HTTP ${HTTP_CODE}"
  DIRECT_OK=1
else
  print_check "localhost:3000" "${SKIP}" "not running"
fi

if [ "${PORTLESS_OK}" = "0" ] && [ "${DIRECT_OK}" = "0" ]; then
  echo ""
  echo "  Dev server is NOT running. To start:"
  echo "    cd web && npm run dev"
  echo "  Then access at:"
  echo "    http://spawnforge.localhost:1355 (with Portless)"
  echo "    http://localhost:3000 (fallback)"
fi

# --- Check .env.local ---
echo ""
echo "--- Environment Variables ---"
ENV_FILE="${REPO_ROOT}/web/.env.local"
if [ -f "${ENV_FILE}" ]; then
  print_check ".env.local exists" "${PASS}" "${ENV_FILE}"

  # Check for required vars
  REQUIRED_VARS="DATABASE_URL CLERK_SECRET_KEY STRIPE_SECRET_KEY UPSTASH_REDIS_REST_URL"
  for VAR in ${REQUIRED_VARS}; do
    if grep -q "^${VAR}=" "${ENV_FILE}" 2>/dev/null; then
      print_check "  ${VAR}" "${PASS}" "present"
    else
      print_check "  ${VAR}" "${WARN}" "missing — run: vercel env pull web/.env.local --scope tnolan"
    fi
  done
else
  print_check ".env.local" "${FAIL}" "missing — run: cd web && vercel env pull --scope tnolan"
fi

# --- Check WASM binaries ---
echo ""
echo "--- WASM Engine Binaries ---"
ALL_WASM_OK=1
for variant in engine-pkg-webgpu engine-pkg-webgl2; do
  WASM_PATH="${REPO_ROOT}/web/public/${variant}/forge_engine_bg.wasm"
  if [ -f "${WASM_PATH}" ]; then
    SIZE=$(du -sh "${WASM_PATH}" 2>/dev/null | cut -f1)
    print_check "  ${variant}" "${PASS}" "${SIZE}"
  else
    print_check "  ${variant}" "${FAIL}" "missing"
    ALL_WASM_OK=0
  fi
done
if [ "${ALL_WASM_OK}" = "0" ]; then
  echo "  Fix: powershell -ExecutionPolicy Bypass -File build_wasm.ps1"
fi

# --- Check for common error signatures in process list ---
echo ""
echo "--- Common Issues ---"

# Port conflicts
for PORT in 3000 1355; do
  PID=$(lsof -ti ":${PORT}" -sTCP:LISTEN 2>/dev/null | head -1 || echo "")
  if [ -n "${PID}" ]; then
    PROC=$(ps -p "${PID}" -o comm= 2>/dev/null || echo "unknown")
    print_check "Port ${PORT}" "${WARN}" "occupied by ${PROC} (PID ${PID})"
  fi
done

# Node version check (25.x has segfaults)
NODE_VER=$(node --version 2>/dev/null || echo "?")
if echo "${NODE_VER}" | grep -qE "^v2[5-9]\."; then
  print_check "Node.js ${NODE_VER}" "${WARN}" "v25.x has intermittent segfaults — consider downgrading to v22 LTS"
fi

# Check if Clerk dev bypass route is accessible
if [ "${PORTLESS_OK}" = "1" ]; then
  echo ""
  echo "--- Auth Bypass Route ---"
  DEV_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://spawnforge.localhost:1355/dev 2>/dev/null || echo "000")
  if [ "${DEV_CODE}" = "200" ] || [ "${DEV_CODE}" = "307" ] || [ "${DEV_CODE}" = "302" ]; then
    print_check "/dev route (auth bypass)" "${PASS}" "HTTP ${DEV_CODE} — use for testing without Clerk"
  else
    print_check "/dev route (auth bypass)" "${WARN}" "HTTP ${DEV_CODE} — server may not be ready"
  fi
fi

echo ""
echo "=== Done ==="
echo ""
echo "If server is down, start it:"
echo "  cd web && npm run dev"
echo "  # Access at: http://spawnforge.localhost:1355/dev (no auth required)"
exit 0
