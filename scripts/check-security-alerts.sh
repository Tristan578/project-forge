#!/usr/bin/env bash
# Repo-level GitHub security-alert gate: fails while ANY open Dependabot or
# code-scanning alert sits unremediated.
#
# WHY: 10 Dependabot alerts (9× next, 1× @hono/node-server) and 1 CodeQL alert
# accumulated silently — the npm-audit gate only sees the lockfile at PR time,
# and CodeQL findings on main never block anything. This gate reads the ALERT
# APIs themselves (the same lists the GitHub Security tab shows), so an open
# alert becomes a red scheduled run instead of invisible debt.
#
# It runs on a SCHEDULE (.github/workflows/security-alerts.yml), NOT as a PR
# gate, by design: repo-level alerts only close after the fixing PR merges, so
# blocking PRs on them would deadlock the very PR that fixes them. In CI the
# workflow authenticates with the SECURITY_ALERTS_TOKEN fine-grained PAT — the
# Actions GITHUB_TOKEN cannot read the Dependabot alerts API (no such
# permission exists for the Actions app); locally, a classic `gh auth` token's
# repo scope suffices.
#
# CONTRACT
#   check-security-alerts.sh
#   - Fetches open Dependabot alerts and open code-scanning alerts for
#     $SECURITY_ALERTS_REPO (default: $GITHUB_REPOSITORY, then the hardcoded
#     repo) via `gh api --paginate`.
#   - FAILS (exit 1) if any open Dependabot alert's GHSA id is NOT in
#     $ALLOWED_GHSA, or if ANY open code-scanning alert exists.
#   - PASSES (exit 0) otherwise.
#   - FAILS CLOSED (exit 2) on any tooling error — missing gh/jq, a fetch that
#     produces no parseable JSON, or a payload that is not the expected array
#     shape (e.g. a GitHub API error object). A gate that cannot evaluate must
#     never report "clean".
#
# TEST SEAMS: $GH_DEPENDABOT_CMD / $GH_CODESCAN_CMD override the fetch commands
#   and are run via `eval` PURELY so the hermetic unit test
#   (scripts/__tests__/check-security-alerts.test.sh) can inject fixture JSON
#   without gh or the network. The workflow NEVER sets them (the suite asserts
#   this), so the real `gh api` calls are what run in CI. The values originate
#   only from this repo's own test, never from PR content, so the `eval`
#   carries no injection risk. Do NOT wire them to anything PR-controllable.
set -uo pipefail

# GHSA ids waived for DEPENDABOT alerts only. Mirrors the npm-audit gate's
# allowlist (scripts/check-npm-audit.sh — same advisories, same rationale):
# transitive, dev-only, un-relockable via drizzle-kit's bundled old esbuild,
# non-exploitable in this repo. Keep the two lists in lockstep; every entry is
# a hole in the gate and needs a justification + removal path. Tracking: #8617.
ALLOWED_GHSA=(
  # esbuild: Deno-module binary integrity RCE via NPM_CONFIG_REGISTRY.
  # Dev/install-time only; we never use esbuild's Deno install path.
  "GHSA-gv7w-rqvm-qjhr"
  # esbuild: arbitrary file read from esbuild's dev server on Windows. We never
  # run esbuild's dev server, and CI is Linux.
  "GHSA-g7r4-m6w7-qqqr"
)

REPO="${SECURITY_ALERTS_REPO:-${GITHUB_REPOSITORY:-Tristan578/project-forge}}"

if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required but not installed — failing closed"
  exit 2
fi

DEP_CMD="${GH_DEPENDABOT_CMD:-gh api \"repos/$REPO/dependabot/alerts?state=open&per_page=100\" --paginate}"
CS_CMD="${GH_CODESCAN_CMD:-gh api \"repos/$REPO/code-scanning/alerts?state=open&per_page=100\" --paginate}"

# gh with --paginate emits one JSON array PER PAGE, concatenated. jq applies a
# filter to each input document in turn, so `.[]` iterates every page's items;
# for whole-stream validation we slurp (-s) the documents first.
fetch_json() {
  local label="$1" cmd="$2" body
  body="$(eval "$cmd" 2>/dev/null)"
  if [ -z "$body" ] || ! jq -e . >/dev/null 2>&1 <<<"$body"; then
    echo "::error::$label fetch produced no parseable JSON — failing closed" >&2
    return 1
  fi
  if [ "$(jq -s '[.[] | type == "array"] | all' <<<"$body")" != "true" ]; then
    # A GitHub API error body is an object with .message (e.g. "Resource not
    # accessible by integration" when the token lacks the Dependabot-alerts
    # permission — see the PAT note in security-alerts.yml). Surface it so the
    # run log names the cause instead of just the shape mismatch.
    local api_msg
    api_msg="$(jq -rs '[.[] | objects | .message // empty] | first // empty' <<<"$body")"
    echo "::error::$label payload is not the expected array shape — failing closed${api_msg:+ (API said: $api_msg)}" >&2
    return 1
  fi
  printf '%s' "$body"
}

dep_json="$(fetch_json "dependabot alerts" "$DEP_CMD")" || exit 2
cs_json="$(fetch_json "code-scanning alerts" "$CS_CMD")" || exit 2

is_allowed() {
  local id="$1" a
  for a in "${ALLOWED_GHSA[@]}"; do
    [ "$a" = "$id" ] && return 0
  done
  return 1
}

echo "=== GitHub security-alert gate ($REPO) ==="
violations=0
seen_allowed=""

echo "-- Dependabot alerts --"
# One line per OPEN alert: "<number>\t<ghsa>\t<severity>\t<package>\t<summary>".
# The state filter is defensive: the query already asks for state=open, but a
# drifted URL must not silently widen what the gate waves through.
while IFS=$'\t' read -r number ghsa severity pkg summary; do
  [ -z "$number" ] && continue
  is_allowed "$ghsa" || { echo "  BLOCK   [$severity] $ghsa ($pkg, alert #$number) — $summary"; violations=$((violations + 1)); continue; }
  seen_allowed="$seen_allowed $ghsa"
  echo "  WAIVED  [$severity] $ghsa ($pkg, alert #$number) — $summary"
done < <(jq -r '
  .[]
  | select(.state == "open")
  | [(.number | tostring),
     (.security_advisory.ghsa_id // "(no ghsa id)"),
     (.security_advisory.severity // "unknown"),
     (.dependency.package.name // "(unknown package)"),
     (.security_advisory.summary // "")]
  | @tsv
' <<<"$dep_json")

echo "-- Code-scanning alerts --"
# No allowlist here: a code-scanning finding is OUR code, so it is either fixed
# or dismissed with a reason IN GITHUB (which removes it from state=open).
while IFS=$'\t' read -r number rule severity path line; do
  [ -z "$number" ] && continue
  echo "  BLOCK   [$severity] #$number $rule — $path:$line"
  violations=$((violations + 1))
done < <(jq -r '
  .[]
  | select(.state == "open")
  | [(.number | tostring),
     (.rule.id // "(no rule id)"),
     (.rule.security_severity_level // .rule.severity // "unknown"),
     (.most_recent_instance.location.path // "?"),
     ((.most_recent_instance.location.start_line // 0) | tostring)]
  | @tsv
' <<<"$cs_json")

# Anti-rot: a waived GHSA id with no open alert is dead weight (Dependabot
# never raised it, or it was fixed). Informational only — never fail on
# absence, or removing the vuln would be blocked by its own stale entry.
for a in "${ALLOWED_GHSA[@]}"; do
  case " $seen_allowed " in
    *" $a "*) ;;
    *) echo "  note    allowlisted $a has no open Dependabot alert (safe to prune here once also gone from check-npm-audit.sh)" ;;
  esac
done

echo ""
if [ "$violations" -gt 0 ]; then
  echo "::error::$violations open non-allowlisted security alert(s) on $REPO."
  echo "Remediate each alert (upgrade/relock the dependency, or fix the flagged code),"
  echo "or dismiss it in GitHub with a documented reason. Do NOT extend the allowlist"
  echo "unless the advisory is transitive, dev-only, un-relockable AND non-exploitable."
  exit 1
fi

echo "✓ no open non-allowlisted security alerts on $REPO."
exit 0
