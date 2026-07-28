#!/usr/bin/env bash
# npm-audit gate with a documented, per-advisory, per-location allowlist.
#
# Replaces a raw `npm audit --audit-level=high` in the Quality Gates `security`
# job. DO NOT revert to the raw command — this tree recurrently carries a
# transitive, dev-only advisory whose only patched release is a major the pinning
# toolchain cannot take (npm `overrides` provably do not cascade into such nested
# copies, and `--omit=dev` does not prune them). Such an advisory cannot be
# relocked away and must be explicitly WAIVED by id — while the gate stays HARD
# for every other advisory at or above the fail threshold, AND hard for the same
# id reappearing at a node_modules path it was never waived for.
#
# History: the original occupants were two esbuild advisories under drizzle-kit's
# deprecated @esbuild-kit/* chain (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr),
# pruned once the gate's anti-rot note reported them gone from every workspace.
# The current occupant is brace-expansion (see ALLOWED_ADVISORIES below).
#
# LOCATION PINNING (PF-1009 / #9026): an id-only allowlist is a hole wider than
# it looks. PF-1002/#9007 relocked the two NESTED brace-expansion copies (under
# glob/ and @typescript-eslint/typescript-estree/) to the patched 5.0.8, leaving
# only the un-relockable root copy waived. Dependabot PR #9016 then did a full
# relock that silently reverted BOTH nested copies back to the unpatched 5.0.7 —
# a production-reachable regression (the glob/ copy is prod-reachable) — and the
# id-only gate stayed GREEN throughout, because it never looked at WHERE the id
# occurred. PF-1008/#9023 had to re-fix it ~24h later with nothing having caught
# the regression in between. Each ALLOWED_ADVISORIES entry now pins the id to its
# EXPECTED node_modules path(s); the id showing up anywhere else is a BLOCK, not
# a WAIVE, naming the unexpected location(s) so the next regression is loud.
#
# Tracking issue: #8617 (F25) — re-evaluate every entry when its removal path
# (documented alongside the id) becomes available.
#
# CONTRACT
#   check-npm-audit.sh <workspace-dir>
#   - Runs `npm audit --json` in <workspace-dir> (resolved under the repo root).
#   - Collects every SOURCE advisory (the object-valued `via` entries; string
#     `via` entries are pure propagation of another package's advisory and carry
#     no id of their own, so they are covered transitively by waiving the source)
#     together with its vulnerability's `nodes` (the node_modules paths it was
#     found at).
#   - FAILS (exit 1) if any source advisory whose severity is in $FAIL_SEVERITIES
#     either (a) has an id NOT in $ALLOWED_ADVISORIES, or (b) has an id that IS
#     allowlisted but occurs at a node_modules path outside that id's pinned
#     set — naming the unexpected location(s). PASSES (exit 0) otherwise.
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

# Advisory ids that are explicitly waived, EACH PINNED to its expected
# node_modules path(s). Keep this list MINIMAL and DOCUMENTED — every entry is a
# hole in the gate, so each needs a one-line justification and a path to removal.
# Add an id here ONLY for a transitive, dev-only, un-relockable advisory that is
# non-exploitable in this repo's usage.
#
# Format: "<GHSA-id>:<pinned-path>[,<pinned-path>...]" — a single colon
# separates the id from its pinned path list; multiple pinned paths (if an
# advisory is legitimately un-relockable at more than one location) are
# comma-separated. GHSA ids and node_modules paths never contain `:` or `,`.
ALLOWED_ADVISORIES=(
  # brace-expansion: unbounded expansion -> OOM DoS. Patched ONLY in 5.0.8 (no
  # 1.x/2.x backport exists). The 5.0.x copies relock to 5.0.8, but the root
  # brace-expansion@1.1.x (lockfile dev:true) sits under the minimatch@3 /
  # eslint-9 lint toolchain, which pins "^1.1.7" — un-relockable without an
  # eslint-major migration. Non-exploitable here: input is our own lint globs,
  # never attacker-controlled. Remove when the eslint/minimatch@3 cohort exits
  # the tree (eslint 10) or a 1.x backport ships. PINNED to the root copy ONLY —
  # the two nested 5.0.x copies (under glob/, @typescript-eslint/typescript-estree/)
  # are expected to stay patched; either reappearing there is a regression (see
  # LOCATION PINNING above), not this waiver.
  "GHSA-mh99-v99m-4gvg:node_modules/brace-expansion"
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

# pinned_paths_for: echoes the comma-separated pinned node_modules path list for
# an allowlisted id, or returns 1 (nothing echoed) if the id is not allowlisted.
pinned_paths_for() {
  local id="$1" entry
  for entry in "${ALLOWED_ADVISORIES[@]}"; do
    if [ "${entry%%:*}" = "$id" ]; then
      printf '%s' "${entry#*:}"
      return 0
    fi
  done
  return 1
}

is_allowed() {
  pinned_paths_for "$1" >/dev/null
}

# paths_within_pin: given an id and its observed comma-separated node paths
# (from the vulnerability's `nodes` array), echoes any OBSERVED path that is NOT
# in the id's pinned set — one per line. Silent + returns 0 if every observed
# path is pinned (or there are none to check). Exact-match containment, not
# substring, so "node_modules/brace-expansion" never accidentally matches
# "node_modules/glob/node_modules/brace-expansion".
paths_within_pin() {
  local id="$1" nodes_csv="$2" pinned_csv unexpected_found=0
  pinned_csv="$(pinned_paths_for "$id")" || return 0
  local IFS=','
  read -r -a pinned_arr <<<"$pinned_csv"
  read -r -a observed_arr <<<"$nodes_csv"
  local observed pinned matched
  for observed in "${observed_arr[@]}"; do
    [ -z "$observed" ] && continue
    matched=0
    for pinned in "${pinned_arr[@]}"; do
      [ "$observed" = "$pinned" ] && { matched=1; break; }
    done
    if [ "$matched" -eq 0 ]; then
      echo "$observed"
      unexpected_found=1
    fi
  done
  [ "$unexpected_found" -eq 0 ]
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

# Emit one line per SOURCE advisory: "<severity>\t<url>\t<title>\t<nodes_csv>".
# The string-typed `via` entries (bare propagation, e.g. "esbuild") are dropped
# by select(type==…). `nodes` lives on the VULNERABILITY (a sibling of `via`,
# not per-via-entry) — capture it once per vulnerability via `as $vuln` before
# flat-mapping into its `via[]` objects, so each row still carries the node
# paths that vulnerability was found at.
while IFS=$'\t' read -r severity url title nodes_csv; do
  [ -z "$severity" ] && continue
  id="${url##*/}"        # GHSA id (or numeric advisory id) from the advisory url
  [ -z "$id" ] && id="(unidentified advisory)"
  # Record an allowlisted id as seen at ANY severity so the anti-rot note below
  # only fires when the advisory is genuinely absent — not merely below threshold.
  is_allowed "$id" && seen_allowed="$seen_allowed $id"
  if is_fail_severity "$severity"; then
    if is_allowed "$id"; then
      unexpected="$(paths_within_pin "$id" "$nodes_csv")"
      if [ -z "$unexpected" ]; then
        echo "  WAIVED  [$severity] $id — $title"
      else
        echo "  BLOCK   [$severity] $id — $title"
        echo "          unexpected location(s) outside the pinned allowlist for $id:"
        while IFS= read -r loc; do
          [ -z "$loc" ] && continue
          echo "            - $loc"
        done <<<"$unexpected"
        violations=$((violations + 1))
      fi
    else
      echo "  BLOCK   [$severity] $id — $title"
      violations=$((violations + 1))
    fi
  else
    echo "  ignore  [$severity] $id — $title"
  fi
done < <(jq -r '
  .vulnerabilities[]?
  | . as $vuln
  | ($vuln.nodes // []) as $nodes
  | $vuln.via[]?
  | select(type == "object")
  | [(.severity // "unknown"), (.url // ""), (.title // ""), ($nodes | join(","))]
  | @tsv
' <<<"$audit_json" | sort -u)

# Anti-rot: a waived id that no longer appears is dead weight (the advisory was
# fixed/relocked). Informational only — never fail on absence, or a future cleanup
# that removes the vuln would be blocked by its own stale allowlist entry.
for entry in "${ALLOWED_ADVISORIES[@]}"; do
  a="${entry%%:*}"
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
