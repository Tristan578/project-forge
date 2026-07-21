#!/usr/bin/env bash
# Tests for .claude/skills/testing/scripts/ratchet-coverage.sh
#
# The ratchet must keep web/vitest.config.ts AND web/vitest.config.node.ts in
# lockstep: the node config documents that its thresholds must match
# vitest.config.ts, but the original script only rewrote vitest.config.ts, so
# the node config drifted further behind on every ratchet cycle (Sentry review
# on #8934, PF-996).
#
# Hermetic via the test-only RATCHET_PROJECT_ROOT seam (never set in CI — the
# workflow assertion below enforces that), so no real coverage run is needed.

set -euo pipefail

for dep in jq bc; do
  if ! command -v "$dep" &>/dev/null; then
    echo "SKIP-FAIL: $dep is required to run this suite" >&2
    exit 1
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/.claude/skills/testing/scripts/ratchet-coverage.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/coverage-ratchet.yml"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc (expected '$expected', got '$actual')"
  fi
}

# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------
write_config() {
  # write_config <path> <statements> <branches> <functions> <lines>
  cat > "$1" <<EOF
export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        statements: $2,
        branches: $3,
        functions: $4,
        lines: $5,
      },
    },
  },
});
EOF
}

write_summary() {
  # write_summary <dir> <statements> <branches> <functions> <lines>
  mkdir -p "$1"
  jq -n --argjson s "$2" --argjson b "$3" --argjson f "$4" --argjson l "$5" \
    '{total: {statements: {pct: $s}, branches: {pct: $b}, functions: {pct: $f}, lines: {pct: $l}}}' \
    > "$1/coverage-summary.json"
}

fresh_root() {
  # fresh_root <main s/b/f/l...> <node s/b/f/l...>
  ROOT="$TMP/case-$((PASS + FAIL))"
  mkdir -p "$ROOT/web"
  write_config "$ROOT/web/vitest.config.ts" "$1" "$2" "$3" "$4"
  write_config "$ROOT/web/vitest.config.node.ts" "$5" "$6" "$7" "$8"
}

read_thresholds() {
  # read_thresholds <config-path> → "s/b/f/l"
  local s b f l
  s=$(sed -nE 's/.*statements:[[:space:]]*([0-9]+).*/\1/p' "$1" | head -1)
  b=$(sed -nE 's/.*branches:[[:space:]]*([0-9]+).*/\1/p' "$1" | head -1)
  f=$(sed -nE 's/.*functions:[[:space:]]*([0-9]+).*/\1/p' "$1" | head -1)
  l=$(sed -nE 's/.*lines:[[:space:]]*([0-9]+).*/\1/p' "$1" | head -1)
  echo "$s/$b/$f/$l"
}

run_ratchet() {
  # run_ratchet <root> [extra env as k=v ...]
  # Hermetic: the suite itself runs under GitHub Actions, where the ambient
  # GITHUB_ACTIONS/GITHUB_REF would flip the script into PR-report mode and
  # silently skip every rewrite — unset both so only explicit k=v args count.
  # Output is captured to $root/ratchet.log for the ::notice:: assertions.
  local root="$1"; shift
  ( cd "$root" && env -u GITHUB_ACTIONS -u GITHUB_REF RATCHET_PROJECT_ROOT="$root" "$@" \
      bash "$SCRIPT" web/coverage >"$root/ratchet.log" 2>&1 )
}

# ---------------------------------------------------------------------------
# 1. Coverage exceeds thresholds → BOTH configs bumped to floored actuals
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  70 60 65 72
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "ratchet exits 0 on bump" 0 "$rc"
check "main config bumped to floored actuals" "80/70/74/81" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "node config bumped in lockstep" "80/70/74/81" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"
main_notice=0
grep -q '::notice::.*vitest.config.ts.*statements=80' "$ROOT/ratchet.log" && main_notice=1
check "bump run emits a main-config notice" 1 "$main_notice"
node_notice=0
grep -q '::notice::.*vitest.config.node.ts.*statements=80' "$ROOT/ratchet.log" && node_notice=1
check "bump run emits a node-config notice" 1 "$node_notice"

# ---------------------------------------------------------------------------
# 2. REGRESSION (#8934): main config already current, node config lagging →
#    node config must still be synced up to match
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  70 60 65 72
write_summary "$ROOT/web/coverage" 75.4 65.1 70.0 77.9
rc=0; run_ratchet "$ROOT" || rc=$?
check "node-drift-only run exits 0" 0 "$rc"
check "main config unchanged when already current" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "lagging node config synced to main thresholds" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"
# Devin review on #8993: the summary notice must not claim a main-config bump
# when only the node config was synced, and must name the node sync instead.
false_bump=0
grep -q '::notice::.*bumped' "$ROOT/ratchet.log" && false_bump=1
check "node-drift-only run emits no main-config bump notice" 0 "$false_bump"
sync_notice=0
grep -q '::notice::.*vitest.config.node.ts.*statements=75' "$ROOT/ratchet.log" && sync_notice=1
check "node-drift-only run emits a node-sync notice" 1 "$sync_notice"

# ---------------------------------------------------------------------------
# 3. Everything already in sync and current → no modification
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  75 65 70 77
write_summary "$ROOT/web/coverage" 75.4 65.1 70.0 77.9
before_main="$(read_thresholds "$ROOT/web/vitest.config.ts")"
rc=0; run_ratchet "$ROOT" || rc=$?
check "no-op run exits 0" 0 "$rc"
check "main config untouched on no-op" "$before_main" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "node config untouched on no-op" "$before_main" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"

# ---------------------------------------------------------------------------
# 4. Never ratchet DOWN: actual below thresholds leaves both configs alone
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  75 65 70 77
write_summary "$ROOT/web/coverage" 60.0 50.0 55.0 62.0
rc=0; run_ratchet "$ROOT" || rc=$?
check "below-threshold run exits 0" 0 "$rc"
check "main config never decreased" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "node config never decreased" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"

# ---------------------------------------------------------------------------
# 5. PR mode (CI, non-main ref) → report only, no modification even w/ drift
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  70 60 65 72
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" GITHUB_ACTIONS=true GITHUB_REF=refs/heads/feature-x || rc=$?
check "PR mode exits 0" 0 "$rc"
check "PR mode leaves main config alone" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "PR mode leaves node config alone" "70/60/65/72" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"

# ---------------------------------------------------------------------------
# 6. Missing coverage summary → graceful skip, nothing modified
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  70 60 65 72
rc=0; run_ratchet "$ROOT" || rc=$?
check "missing summary exits 0" 0 "$rc"
check "missing summary modifies nothing" "70/60/65/72" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"

# ---------------------------------------------------------------------------
# 7. Missing node config → warn, skip lockstep, main config still ratchets
#    (the HAS_NODE_CONFIG=false fallback must not crash or block the ratchet)
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  70 60 65 72
rm "$ROOT/web/vitest.config.node.ts"
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "missing node config exits 0" 0 "$rc"
check "main config still bumped without node config" "80/70/74/81" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
skip_warned=0
grep -q '::warning::.*vitest.config.node.ts.*node-config lockstep skipped' "$ROOT/ratchet.log" && skip_warned=1
check "missing node config emits a lockstep-skipped warning" 1 "$skip_warned"
node_recreated=0
[ -e "$ROOT/web/vitest.config.node.ts" ] && node_recreated=1
check "missing node config is not recreated" 0 "$node_recreated"
phantom_sync=0
grep -q '::notice::.*vitest.config.node.ts' "$ROOT/ratchet.log" && phantom_sync=1
check "missing node config emits no node-sync notice" 0 "$phantom_sync"

# ---------------------------------------------------------------------------
# 8. Node config AHEAD of main's new value → never decreased, no sync notice
#    (node_target keeps the higher current value per metric)
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77  90 80 85 92
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "node-ahead run exits 0" 0 "$rc"
check "main config bumped while node is ahead" "80/70/74/81" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "node config ahead of main is never decreased" "90/80/85/92" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"
ahead_sync=0
grep -q '::notice::.*vitest.config.node.ts' "$ROOT/ratchet.log" && ahead_sync=1
check "node-ahead run emits no node-sync notice" 0 "$ahead_sync"

# ---------------------------------------------------------------------------
# 9. Workflow contract: coverage-ratchet.yml must gate AND commit the node
#    config alongside vitest.config.ts, and must never wire the test seam
# ---------------------------------------------------------------------------
diff_gates=$(grep -c 'git diff --quiet web/vitest.config.ts web/vitest.config.node.ts' "$WORKFLOW" || true)
check "both workflow diff gates include the node config" 2 "$diff_gates"

git_add_has_node=0
grep -A2 'git add web/vitest.config.ts' "$WORKFLOW" | grep -q 'web/vitest.config.node.ts' && git_add_has_node=1
check "workflow git add includes the node config" 1 "$git_add_has_node"

seam_wired=0
grep -v '^\s*#' "$WORKFLOW" | grep -q 'RATCHET_PROJECT_ROOT' && seam_wired=1
check "RATCHET_PROJECT_ROOT seam is not wired in the workflow" 0 "$seam_wired"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
