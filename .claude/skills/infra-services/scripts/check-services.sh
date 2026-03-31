#!/usr/bin/env bash
# check-services.sh — Health check all SpawnForge services
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-services.sh"
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "${REPO_ROOT}"

PASS="PASS"
FAIL="FAIL"
SKIP="SKIP"

print_result() {
  local label="$1"
  local status="$2"
  local detail="${3:-}"
  printf "%-40s [%s]" "${label}" "${status}"
  if [ -n "${detail}" ]; then
    printf "  %s" "${detail}"
  fi
  printf "\n"
}

echo "=== SpawnForge Service Health Check ==="
echo ""

# --- Git remote connectivity ---
echo "--- Source Control ---"
if git ls-remote origin HEAD >/dev/null 2>&1; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "unknown")
  print_result "GitHub remote" "${PASS}" "${REMOTE_URL}"
else
  print_result "GitHub remote" "${FAIL}" "Cannot reach origin — check network or credentials"
fi

# --- GitHub Actions CI ---
echo ""
echo "--- CI/CD ---"
if command -v gh >/dev/null 2>&1; then
  RECENT_RUNS=$(gh run list --limit 3 --json status,conclusion,name,createdAt 2>/dev/null || echo "[]")
  if [ "${RECENT_RUNS}" = "[]" ]; then
    print_result "GitHub Actions (recent runs)" "${SKIP}" "No runs found or gh not authenticated"
  else
    echo "${RECENT_RUNS}" | python3 -c "
import json, sys
runs = json.load(sys.stdin)
for r in runs:
    name = r.get('name','?')[:30]
    status = r.get('status','?')
    conclusion = r.get('conclusion') or status
    ts = r.get('createdAt','?')[:16]
    marker = 'PASS' if conclusion in ('success','skipped') else ('PENDING' if status in ('in_progress','queued') else 'FAIL')
    print(f'  {name:<32} [{marker}]  {ts}')
"
  fi
else
  print_result "GitHub Actions" "${SKIP}" "gh CLI not installed"
fi

# --- Vercel ---
echo ""
echo "--- Vercel ---"
if command -v vercel >/dev/null 2>&1; then
  VERCEL_OUTPUT=$(vercel ls --scope tnolan 2>/dev/null | head -8 || echo "")
  if [ -n "${VERCEL_OUTPUT}" ]; then
    print_result "Vercel CLI (scope: tnolan)" "${PASS}" ""
    echo "${VERCEL_OUTPUT}" | head -6 | while IFS= read -r line; do
      echo "  ${line}"
    done
  else
    print_result "Vercel CLI" "${FAIL}" "Could not list projects — run 'vercel login --scope tnolan'"
  fi
else
  print_result "Vercel CLI" "${SKIP}" "vercel not installed — run 'npm i -g vercel'"
fi

# --- Local dev server / Portless ---
echo ""
echo "--- Local Development ---"
if curl -s --max-time 3 http://spawnforge.localhost:1355 >/dev/null 2>&1; then
  print_result "Dev server (Portless)" "${PASS}" "http://spawnforge.localhost:1355"
elif curl -s --max-time 3 http://localhost:3000 >/dev/null 2>&1; then
  print_result "Dev server (fallback)" "${PASS}" "http://localhost:3000"
else
  print_result "Dev server" "${SKIP}" "Not running (start with: cd web && npm run dev)"
fi

# --- Health API endpoint ---
if curl -s --max-time 3 http://spawnforge.localhost:1355/api/health >/dev/null 2>&1; then
  HEALTH=$(curl -s --max-time 3 http://spawnforge.localhost:1355/api/health 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
  print_result "Health API endpoint" "${PASS}" "status=${HEALTH}"
else
  print_result "Health API endpoint" "${SKIP}" "Server not running"
fi

# --- WASM binaries ---
echo ""
echo "--- Engine Binaries ---"
WASM_FOUND=0
for variant in engine-pkg-webgpu engine-pkg-webgl2; do
  WASM_PATH="${REPO_ROOT}/web/public/${variant}/forge_engine_bg.wasm"
  if [ -f "${WASM_PATH}" ]; then
    SIZE=$(du -sh "${WASM_PATH}" 2>/dev/null | cut -f1)
    AGE=$(python3 -c "import os,time; mt=os.path.getmtime('${WASM_PATH}'); print(f'{int((time.time()-mt)/3600)}h ago')" 2>/dev/null || echo "?")
    print_result "  ${variant}" "${PASS}" "${SIZE}, modified ${AGE}"
    WASM_FOUND=$((WASM_FOUND+1))
  else
    print_result "  ${variant}" "${FAIL}" "Missing — run: powershell -File build_wasm.ps1"
  fi
done

echo ""
echo "=== Done ==="
exit 0
