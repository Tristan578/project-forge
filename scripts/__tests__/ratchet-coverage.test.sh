#!/usr/bin/env bash
# Exercise the production aggregate ratchet against hermetic root configs.
# Child environment selectors must remain byte-for-byte unchanged.
# The test-only RATCHET_PROJECT_ROOT seam is never wired into CI.

set -euo pipefail

# awk, not bc: ratchet-coverage.sh computes its deltas with awk now, so bc is
# no longer a dependency of the script OR of this suite. Keeping the old guard
# would refuse to run the suite on hosts the script itself supports fine.
for dep in jq awk; do
  if ! command -v "$dep" &>/dev/null; then
    echo "SKIP-FAIL: $dep is required to run this suite" >&2
    exit 1
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/.claude/skills/testing/scripts/ratchet-coverage.sh"

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
  # fresh_root <aggregate statements/branches/functions/lines>
  ROOT="$TMP/case-$((PASS + FAIL))"
  mkdir -p "$ROOT/web"
  write_config "$ROOT/web/vitest.config.ts" "$1" "$2" "$3" "$4"
  printf "export default { test: { environment: 'node' } };\n" > "$ROOT/web/vitest.config.node.ts"
  cp "$ROOT/web/vitest.config.node.ts" "$ROOT/child-before.ts"
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

# Require unchanged child bytes, including non-threshold project settings.
check_child_unchanged() {
  local changed=1
  cmp -s "$ROOT/child-before.ts" "$ROOT/web/vitest.config.node.ts" && changed=0
  check "$1" 0 "$changed"
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
# 1. Coverage exceeds aggregate thresholds → root config is bumped to floored actuals
#    MINUS the 1-point margin (PF: coverage ratchet margin), not flush
#    against the measurement.
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "ratchet exits 0 on bump" 0 "$rc"
check "main config bumped to floored actuals minus margin" "79/69/73/80" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "child project config has no aggregate threshold block" "///" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"
main_notice=0
grep -q '::notice::.*vitest.config.ts.*statements=79' "$ROOT/ratchet.log" && main_notice=1
check "bump run emits a main-config notice" 1 "$main_notice"
node_notice=0
grep -q '::notice::.*vitest.config.node.ts.*statements=79' "$ROOT/ratchet.log" && node_notice=1
check "bump run emits no child-config notice" 0 "$node_notice"

# ---------------------------------------------------------------------------
# 2. A child config cannot trigger a ratchet when aggregate root thresholds are current.
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 75.4 65.1 70.0 77.9
rc=0; run_ratchet "$ROOT" || rc=$?
check "root-current run exits 0" 0 "$rc"
check "main config unchanged when already current" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check "child config remains threshold-free" "///" "$(read_thresholds "$ROOT/web/vitest.config.node.ts")"
# A root-current report must not claim any obsolete child-config synchronization.
false_bump=0
grep -q '::notice::.*bumped' "$ROOT/ratchet.log" && false_bump=1
check "root-current run emits no main-config bump notice" 0 "$false_bump"
sync_notice=0
grep -q '::notice::.*vitest.config.node.ts.*statements=75' "$ROOT/ratchet.log" && sync_notice=1
check "root-current run emits no child-config notice" 0 "$sync_notice"

# ---------------------------------------------------------------------------
# 3. Everything already in sync and current → no modification
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 75.4 65.1 70.0 77.9
before_main="$(read_thresholds "$ROOT/web/vitest.config.ts")"
rc=0; run_ratchet "$ROOT" || rc=$?
check "no-op run exits 0" 0 "$rc"
check "main config untouched on no-op" "$before_main" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "node config untouched on no-op"

# ---------------------------------------------------------------------------
# 4. Never ratchet DOWN: actual below thresholds leaves root and child alone
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 60.0 50.0 55.0 62.0
rc=0; run_ratchet "$ROOT" || rc=$?
check "below-threshold run exits 0" 0 "$rc"
check "main config never decreased" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "node config never decreased"

# ---------------------------------------------------------------------------
# 5. PR mode (CI, non-main ref) → report only, no modification even w/ drift
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" GITHUB_ACTIONS=true GITHUB_REF=refs/heads/feature-x || rc=$?
check "PR mode exits 0" 0 "$rc"
check "PR mode leaves main config alone" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "PR mode leaves node config alone"

# ---------------------------------------------------------------------------
# 6. Missing coverage summary → graceful skip, nothing modified
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
rc=0; run_ratchet "$ROOT" || rc=$?
check "missing summary exits 0" 0 "$rc"
check_child_unchanged "missing summary modifies nothing"

# ---------------------------------------------------------------------------
# 7. Missing child config does not affect the aggregate root ratchet.
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
rm "$ROOT/web/vitest.config.node.ts"
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "missing node config exits 0" 0 "$rc"
check "main config still bumped without node config" "79/69/73/80" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
skip_warned=0
grep -q '::warning::.*vitest.config.node.ts.*node-config lockstep skipped' "$ROOT/ratchet.log" && skip_warned=1
check "missing child config emits no obsolete lockstep warning" 0 "$skip_warned"
node_recreated=0
[ -e "$ROOT/web/vitest.config.node.ts" ] && node_recreated=1
check "missing node config is not recreated" 0 "$node_recreated"
phantom_sync=0
grep -q '::notice::.*vitest.config.node.ts' "$ROOT/ratchet.log" && phantom_sync=1
check "missing node config emits no node-sync notice" 0 "$phantom_sync"

# ---------------------------------------------------------------------------
# 8. Legacy child threshold blocks cannot influence the root aggregate ratchet.
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_config "$ROOT/web/vitest.config.node.ts" 90 80 85 92
cp "$ROOT/web/vitest.config.node.ts" "$ROOT/child-before.ts"
write_summary "$ROOT/web/coverage" 80.5 70.2 74.9 81.3
rc=0; run_ratchet "$ROOT" || rc=$?
check "node-ahead run exits 0" 0 "$rc"
check "main config bumped while node is ahead" "79/69/73/80" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "node config ahead of main is never decreased"
ahead_sync=0
grep -q '::notice::.*vitest.config.node.ts' "$ROOT/ratchet.log" && ahead_sync=1
check "node-ahead run emits no node-sync notice" 0 "$ahead_sync"

# ---------------------------------------------------------------------------
# 9. MARGIN REGRESSION (this fix): a measurement that used to ratchet up now
#    does not, because it doesn't clear the 1-point margin. This is the exact
#    shape of the live break: threshold 75, actual floors to one point above
#    (76.4% -> 76). The old code adopted 76 flush against the measurement;
#    the next run that dipped by half a point would then fail the gate. The
#    margin rule computes 76 - 1 = 75, which is not > current (75), so the
#    threshold is left alone instead of being set with zero headroom.
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 76.4 66.4 71.4 78.4
rc=0; run_ratchet "$ROOT" || rc=$?
check "sub-margin run exits 0" 0 "$rc"
check "sub-margin measurement does NOT bump main config" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "sub-margin measurement does NOT bump node config"
sub_margin_notice=0
grep -q '::notice::.*bumped' "$ROOT/ratchet.log" && sub_margin_notice=1
check "sub-margin run emits no bump notice" 0 "$sub_margin_notice"

# ---------------------------------------------------------------------------
# 10. Margin does not block a real improvement: a measurement that clears the
#     threshold by more than the margin still ratchets up, to the
#     margin-adjusted value (not to the raw floored actual).
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 85.4 75.4 80.4 87.4
rc=0; run_ratchet "$ROOT" || rc=$?
check "clears-margin run exits 0" 0 "$rc"
check "clears-margin measurement bumps main config to actual minus margin" "84/74/79/86" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "clears-margin measurement bumps node config leaves the child unchanged"

# ---------------------------------------------------------------------------
# 11. Never-ratchet-down still holds with the margin in play: a measurement
#     below current thresholds must not be able to pull them down even after
#     the margin subtraction (e.g. current 77, actual 77.4 -> floor 77,
#     margin-adjusted 76, which is BELOW current and must be rejected, not
#     adopted).
# ---------------------------------------------------------------------------
fresh_root 75 65 70 77
write_summary "$ROOT/web/coverage" 75.4 65.4 70.4 77.4
rc=0; run_ratchet "$ROOT" || rc=$?
check "margin-adjusted-below-current run exits 0" 0 "$rc"
check "margin never pulls main config below current" "75/65/70/77" "$(read_thresholds "$ROOT/web/vitest.config.ts")"
check_child_unchanged "margin never pulls node config below current"

# ---------------------------------------------------------------------------
# 12. Workflow gates and commits only aggregate root thresholds, never the test seam
# ---------------------------------------------------------------------------
workflow_contract=0
node "$REPO_ROOT/scripts/__tests__/ratchet-workflow-contract.cjs" || workflow_contract=$?
check "executable workflow gates, staging, triggers and disabled-command controls" 0 "$workflow_contract"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
