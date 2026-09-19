#!/usr/bin/env bash
# triage.sh — Structured diagnostic report for SpawnForge
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/triage.sh"
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

echo "=== SpawnForge Triage Report ==="
echo "Time: $(date)"
echo ""

# --- 1. Git status ---
echo "--- 1. Git Status ---"
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
print_check "Current branch" "${PASS}" "${BRANCH}"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "${UNCOMMITTED}" = "0" ]; then
  print_check "Working tree" "${PASS}" "clean"
else
  print_check "Working tree" "${WARN}" "${UNCOMMITTED} uncommitted change(s) — commit before risky operations"
fi

# Check for stashed changes
STASH_COUNT=$(git stash list 2>/dev/null | wc -l | tr -d ' ')
if [ "${STASH_COUNT}" -gt "0" ]; then
  print_check "Git stash" "${WARN}" "${STASH_COUNT} stashed change(s)"
else
  print_check "Git stash" "${PASS}" "empty"
fi

echo ""
echo "--- 2. Recent Commits ---"
git log --oneline -5 2>/dev/null | while IFS= read -r line; do
  echo "  ${line}"
done

echo ""
echo "--- 3. Environment ---"
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
if echo "${NODE_VERSION}" | grep -qE "^v2[5-9]\."; then
  print_check "Node version" "${WARN}" "${NODE_VERSION} — v25.x has intermittent V8 JIT segfaults"
elif echo "${NODE_VERSION}" | grep -qE "^v"; then
  print_check "Node version" "${PASS}" "${NODE_VERSION}"
else
  print_check "Node version" "${FAIL}" "Node not found — install Node.js"
fi

NPM_VERSION=$(npm --version 2>/dev/null || echo "not found")
print_check "npm version" "${PASS}" "${NPM_VERSION}"

RUST_VERSION=$(rustc --version 2>/dev/null || echo "not found")
if echo "${RUST_VERSION}" | grep -q "rustc"; then
  print_check "Rust" "${PASS}" "${RUST_VERSION}"
else
  print_check "Rust" "${SKIP}" "not installed (required for WASM builds)"
fi

WASM_TARGET=$(rustup target list --installed 2>/dev/null | grep "wasm32-unknown-unknown" || echo "")
if [ -n "${WASM_TARGET}" ]; then
  print_check "wasm32 target" "${PASS}" "installed"
else
  print_check "wasm32 target" "${WARN}" "missing — run: rustup target add wasm32-unknown-unknown"
fi

echo ""
echo "--- 4. Port Availability ---"
for PORT in 3000 1355; do
  if lsof -i ":${PORT}" >/dev/null 2>&1; then
    PROC=$(lsof -i ":${PORT}" -sTCP:LISTEN -n -P 2>/dev/null | tail -1 | awk '{print $1, $2}' || echo "unknown")
    print_check "Port ${PORT}" "${WARN}" "IN USE by ${PROC}"
  else
    print_check "Port ${PORT}" "${PASS}" "available"
  fi
done

echo ""
echo "--- 5. WASM Engine Binaries ---"
for variant in engine-pkg-webgpu engine-pkg-webgl2; do
  WASM_PATH="${REPO_ROOT}/web/public/${variant}/forge_engine_bg.wasm"
  if [ -f "${WASM_PATH}" ]; then
    SIZE=$(du -sh "${WASM_PATH}" 2>/dev/null | cut -f1)
    AGE_SECS=$(python3 -c "import os,time; print(int(time.time()-os.path.getmtime('${WASM_PATH}')))" 2>/dev/null || echo "?")
    AGE_HOURS=$(python3 -c "print('${AGE_SECS}'[:1] != '?' and f'{int(${AGE_SECS})/3600:.1f}h' or '?')" 2>/dev/null || echo "${AGE_SECS}s")
    print_check "  ${variant}" "${PASS}" "${SIZE}, ${AGE_HOURS} old"
  else
    print_check "  ${variant}" "${FAIL}" "missing — run: powershell -File build_wasm.ps1"
  fi
done

echo ""
echo "--- 6. CI Status (last 3 runs) ---"
if command -v gh >/dev/null 2>&1; then
  RUNS=$(gh run list --limit 3 --json status,conclusion,name,createdAt,headBranch 2>/dev/null || echo "[]")
  if [ "${RUNS}" != "[]" ] && [ -n "${RUNS}" ]; then
    echo "${RUNS}" | python3 -c "
import json, sys
runs = json.load(sys.stdin)
for r in runs:
    name = r.get('name','?')[:35]
    status = r.get('status','?')
    conclusion = r.get('conclusion') or status
    branch = r.get('headBranch','?')[:25]
    ts = r.get('createdAt','?')[:16]
    marker = 'PASS' if conclusion in ('success','skipped') else ('PENDING' if status in ('in_progress','queued') else 'FAIL')
    print(f'  [{marker}] {name:<35} {branch:<25} {ts}')
"
  else
    echo "  No CI runs found (gh not authenticated or no runs)"
  fi
else
  echo "  gh CLI not installed"
fi

echo ""
echo "=== Triage Complete ==="
echo ""
echo "Next steps:"
echo "  - Dev server issues: bash \"\${CLAUDE_SKILL_DIR}/scripts/check-dev-server.sh\""
echo "  - CI failures:       bash \"\${CLAUDE_SKILL_DIR}/../babysit-prs/scripts/check-all-prs.sh\""
echo "  - Service health:    bash \"\${CLAUDE_SKILL_DIR}/../infra-services/scripts/check-services.sh\""
exit 0
