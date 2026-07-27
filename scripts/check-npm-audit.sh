#!/usr/bin/env bash
# npm-audit gate with a documented, per-advisory allowlist.
#
# Replaces a raw `npm audit --audit-level=high` in the Quality Gates `security`
# job. DO NOT revert to the raw command — this tree recurrently carries a
# transitive, dev-only advisory whose only patched release is a major the pinning
# toolchain cannot take (npm `overrides` provably do not cascade into such nested
# copies, and `--omit=dev` does not prune them). Such an advisory cannot be
# relocked away and must be explicitly WAIVED by id — while the gate stays HARD
# for every other advisory at or above the fail threshold.
#
# History: the original occupants were two esbuild advisories under drizzle-kit's
# deprecated @esbuild-kit/* chain (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr),
# pruned once the gate's anti-rot note reported them gone from every workspace.
# The current occupant is brace-expansion (see ALLOWED_ADVISORIES below).
#
# Tracking issue: #8617 (F25) — re-evaluate every entry when its removal path
# (documented alongside the id) becomes available.
#
# CONTRACT
#   check-npm-audit.sh <workspace-dir>
#   - Runs `npm audit --json` in <workspace-dir> (resolved under the repo root).
#   - Collects every SOURCE advisory (the object-valued `via` entries; string
#     `via` entries are pure propagation of another package's advisory and carry
#     no id of their own, so they are covered transitively by waiving the source).
#   - FAILS (exit 1) if any source advisory whose severity is in $FAIL_SEVERITIES
#     has an id NOT in $ALLOWED_ADVISORIES. PASSES (exit 0) otherwise.
#   - FAILS CLOSED (exit 2) on any tooling error — missing jq, npm emitting no
#     parseable JSON, or output that is not a recognized audit report. A gate that
#     cannot evaluate must never report "clean".
#
# TEST SEAM: $NPM_AUDIT_CMD overrides the audit command and is run via `eval`
#   PURELY so the hermetic unit test (scripts/__tests__/check-npm-audit.test.sh)
#   can inject fixture JSON (e.g. `cat fixture.json`) without npm or the network.
#   CI NEVER sets it, so the default real `npm audit --json` is what runs. The
#   value originates only from this repo's own test, never from PR content, so the
#   `eval` carries no injection risk. Do NOT wire it to anything PR-controllable.
set -uo pipefail

# Advisory ids that are explicitly waived. Keep this list MINIMAL and DOCUMENTED —
# every entry is a hole in the gate, so each needs a one-line justification and a
# path to removal. Add an id here ONLY for a transitive, dev-only, un-relockable
# advisory that is non-exploitable in this repo's usage.
ALLOWED_ADVISORIES=(
  # brace-expansion: unbounded expansion -> OOM DoS. Patched ONLY in 5.0.8 (no
  # 1.x/2.x backport exists). The 5.0.x copies relock to 5.0.8, but the root
  # brace-expansion@1.1.x (lockfile dev:true) sits under the minimatch@3 /
  # eslint-9 lint toolchain, which pins "^1.1.7" — un-relockable without an
  # eslint-major migration. Non-exploitable here: input is our own lint globs,
  # never attacker-controlled. Remove when the eslint/minimatch@3 cohort exits
  # the tree (eslint 10) or a 1.x backport ships.
  "GHSA-mh99-v99m-4gvg"
)

# Severities that BLOCK when not allowlisted — mirrors the prior gate's
# `--audit-level=high` (high + critical block; moderate/low do not).
FAIL_SEVERITIES="high critical"

WORKSPACE="${1:-}"
if [ -z "$WORKSPACE" ]; then
  echo "::error::usage: check-npm-audit.sh <workspace-dir>"
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required but not installed — failing closed"
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TARGET="$ROOT/$WORKSPACE"
if [ ! -d "$TARGET" ]; then
  echo "::error::workspace directory not found: $TARGET"
  exit 2
fi
cd "$TARGET" || { echo "::error::could not cd to $TARGET"; exit 2; }

# `npm audit` exits non-zero whenever advisories exist, so its exit code is NOT a
# pass/fail signal here — capture stdout and evaluate the JSON ourselves. A real
# npm failure (no lockfile, registry down) yields no parseable JSON and is caught
# by the validation below as a fail-closed.
AUDIT_CMD="${NPM_AUDIT_CMD:-npm audit --json}"
audit_json="$(eval "$AUDIT_CMD" 2>/dev/null)"

if [ -z "$audit_json" ] || ! jq -e . >/dev/null 2>&1 <<<"$audit_json"; then
  echo "::error::npm audit produced no parseable JSON in $WORKSPACE — failing closed"
  exit 2
fi
if [ "$(jq -r '.auditReportVersion // empty' <<<"$audit_json")" = "" ]; then
  echo "::error::npm audit output is not a recognized audit report (no auditReportVersion) — failing closed"
  exit 2
fi

is_allowed() {
  local id="$1" a
  for a in "${ALLOWED_ADVISORIES[@]}"; do
    [ "$a" = "$id" ] && return 0
  done
  return 1
}

is_fail_severity() {
  case " $FAIL_SEVERITIES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "=== npm audit gate ($WORKSPACE) ==="
violations=0
seen_allowed=""

# Emit one line per SOURCE advisory: "<severity>\t<url>\t<title>". The string-typed
# `via` entries (bare propagation, e.g. "esbuild") are dropped by select(type==…).
while IFS=$'\t' read -r severity url title; do
  [ -z "$severity" ] && continue
  id="${url##*/}"        # GHSA id (or numeric advisory id) from the advisory url
  [ -z "$id" ] && id="(unidentified advisory)"
  # Record an allowlisted id as seen at ANY severity so the anti-rot note below
  # only fires when the advisory is genuinely absent — not merely below threshold.
  is_allowed "$id" && seen_allowed="$seen_allowed $id"
  if is_fail_severity "$severity"; then
    if is_allowed "$id"; then
      echo "  WAIVED  [$severity] $id — $title"
    else
      echo "  BLOCK   [$severity] $id — $title"
      violations=$((violations + 1))
    fi
  else
    echo "  ignore  [$severity] $id — $title"
  fi
done < <(jq -r '
  .vulnerabilities[]?.via[]?
  | select(type == "object")
  | [(.severity // "unknown"), (.url // ""), (.title // "")]
  | @tsv
' <<<"$audit_json" | sort -u)

# Anti-rot: a waived id that no longer appears is dead weight (the advisory was
# fixed/relocked). Informational only — never fail on absence, or a future cleanup
# that removes the vuln would be blocked by its own stale allowlist entry.
for a in "${ALLOWED_ADVISORIES[@]}"; do
  case " $seen_allowed " in
    *" $a "*) ;;
    *) echo "  note    allowlisted advisory $a not present in $WORKSPACE (safe to prune once gone from every workspace)" ;;
  esac
done

echo ""
if [ "$violations" -gt 0 ]; then
  echo "::error::$violations non-allowlisted advisory(ies) at or above [$FAIL_SEVERITIES] in $WORKSPACE."
  echo "Fix the dependency (upgrade/relock) — do NOT add it to the allowlist unless it is"
  echo "transitive, dev-only, un-relockable AND non-exploitable in this repo (see header)."
  exit 1
fi

echo "✓ no non-allowlisted advisory at or above [$FAIL_SEVERITIES] in $WORKSPACE."
exit 0
