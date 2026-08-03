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
# History: THE ALLOWLIST IS CURRENTLY EMPTY — every advisory ever waived here was
# eventually relocked away, and each waiver was pruned once the gate's anti-rot
# note reported it gone. First went two esbuild advisories under drizzle-kit's
# deprecated @esbuild-kit/* chain (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr,
# pruned in PF-1002/#9007 when that cohort left the tree). Then brace-expansion
# (GHSA-mh99-v99m-4gvg), waived on the premise that it was "patched ONLY in 5.0.8,
# no 1.x backport exists" — which made the root copy under the minimatch@3 /
# eslint-9 lint toolchain un-relockable. Upstream then shipped 1.1.17; PF-1045
# relocked the root copy to 1.1.18 inside its existing "^1.1.7" range with no
# eslint-major migration, and PF-1046 pruned the entry.
#
# The lesson that generalizes: "un-relockable" is a claim about a moment, not a
# property of the dependency. It expires silently the day upstream backports, and
# nothing re-checks it — the gate keeps waiving and stays green. So ALWAYS try a
# relock before adding an entry, and re-check the premise of any entry that is
# still here (the anti-rot note only fires once the advisory is gone entirely,
# which is strictly later than the moment it became fixable).
#
# LOCATION PINNING (PF-1009 / #9026): an id-only allowlist is a hole wider than
# it looks. PF-1002/#9007 relocked the two NESTED brace-expansion copies (under
# glob/ and @typescript-eslint/typescript-estree/) to the patched 5.0.8, leaving
# only the un-relockable root copy waived. Dependabot PR #9016 then did a full
# relock that silently reverted BOTH nested copies back to the unpatched 5.0.7 —
# a production-reachable regression (the glob/ copy is prod-reachable) — and the
# id-only gate stayed GREEN throughout, because it never looked at WHERE the id
# occurred. PF-1008/#9023 (PR #9027) had to re-fix it ~24h later with nothing having caught
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
#     — or is not a recognized npm severity at all (missing/empty severities are
#     projected to the "unknown" sentinel; a row that cannot be classified below
#     threshold is blocking-eligible, never silently ignored) — either (a) has an
#     id NOT in $ALLOWED_ADVISORIES, or (b) has an id that IS
#     allowlisted but occurs at a node_modules path outside that id's pinned
#     set — naming the unexpected location(s) — or (c) has an allowlisted id but
#     the report carries no usable location data (`nodes` missing, empty,
#     non-array, or containing no non-empty strings) — a waiver that cannot be
#     location-verified is not a waiver.
#     PASSES (exit 0) otherwise.
#   - FAILS CLOSED (exit 2) on any tooling error — missing jq, npm emitting no
#     parseable JSON, output that is not a recognized v2 audit report
#     (auditReportVersion != 2), a jq extraction failure mid-report (including a
#     non-string severity/url/title, which the projection rejects via error()),
#     a malformed extracted row (an empty TSV field that the sentinel projection
#     should have made impossible), or a
#     malformed $ALLOWED_ADVISORIES entry (an id without a pinned path). A gate
#     that cannot evaluate must never report "clean".
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
# EMPTY IS THE CORRECT STEADY STATE — see the History note above for why the
# three former occupants were pruned rather than carried. Do NOT add an entry
# back "to get the pipeline green": try relocking FIRST (`npm view <pkg>
# versions` against the advisory's patched range). Every waiver ever added here
# was justified as un-relockable and every one of them stopped being so; that is
# the base rate. An entry is warranted only once a relock is proven impossible.
#
# The empty array is expanded through the `${ARR[@]+"${ARR[@]}"}` guard at all
# three read sites below: under `set -u`, bash 3.2 (the macOS system bash, which
# `#!/usr/bin/env bash` resolves to) aborts on a plain `"${ARR[@]}"` expansion of
# an empty array. Unguarded, the abort happens INSIDE a command substitution, so
# the crashed capture reads as an empty result — which the caller scores as
# WAIVED. A crash that fails OPEN is exactly what this gate must not do; the
# suite greps every gate run for `unbound variable` to keep it that way.
#
# Keep the declaration's `(` and `)` at column 0 on their own lines: the suite
# cuts the array body with a column-0-anchored awk range to scope its
# pruned-waiver assertions to entries rather than prose, and fails closed if the
# cut reads nothing.
ALLOWED_ADVISORIES=(
  # (no waivers in effect)
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

# Every allowlist entry MUST carry a pinned path — a bare id (or an empty path)
# would silently degrade this back to the id-only gate that missed the #9016
# regression, so a malformed entry is a config error, not a wider waiver.
for entry in ${ALLOWED_ADVISORIES[@]+"${ALLOWED_ADVISORIES[@]}"}; do
  case "$entry" in
    ?*:?*) ;;
    *)
      echo "::error::malformed ALLOWED_ADVISORIES entry '$entry' — expected \"<GHSA-id>:<pinned-path>[,<pinned-path>...]\" — failing closed"
      exit 2
      ;;
  esac
done

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
report_version="$(jq -r '.auditReportVersion // empty' <<<"$audit_json")"
if [ "$report_version" != "2" ]; then
  echo "::error::npm audit output is not a recognized audit report (auditReportVersion '${report_version:-absent}' != 2) — failing closed"
  exit 2
fi

# pinned_paths_for: echoes the comma-separated pinned node_modules path list for
# an allowlisted id, or returns 1 (nothing echoed) if the id is not allowlisted.
pinned_paths_for() {
  local id="$1" entry
  for entry in ${ALLOWED_ADVISORIES[@]+"${ALLOWED_ADVISORIES[@]}"}; do
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
  local id="$1" nodes_csv="$2" pinned_csv unexpected_found=0 pinned_arr observed_arr
  pinned_csv="$(pinned_paths_for "$id")" || return 0
  local IFS=','
  read -r -a pinned_arr <<<"$pinned_csv"
  read -r -a observed_arr <<<"$nodes_csv"
  local observed pinned matched
  # ${arr[@]+"${arr[@]}"} — bash-3.2 (macOS default): expanding an EMPTY array
  # with a bare "${arr[@]}" under `set -u` aborts the subshell, which a caller
  # reading $(paths_within_pin …) sees as empty output → a silent waive. The
  # +-guard expands to nothing when the array is empty instead of erroring.
  for observed in ${observed_arr[@]+"${observed_arr[@]}"}; do
    [ -z "$observed" ] && continue
    matched=0
    for pinned in ${pinned_arr[@]+"${pinned_arr[@]}"}; do
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

# Severities npm can legitimately emit. Anything else — including the "unknown"
# sentinel the extraction substitutes for a missing/empty severity — cannot be
# proven below threshold, so the loop treats it as blocking-eligible instead of
# silently `ignore`-ing it. Exact-match branches, NOT a substring scan of a
# space-joined list: the substring form accepts any adjacent run of the words
# ("info low") as known, and a run below threshold would then be silently
# ignored. (is_fail_severity keeps the substring form — there a spurious run
# match can only over-block, never under-block.)
is_known_severity() {
  case "$1" in
    info|low|moderate|high|critical) return 0 ;;
    *) return 1 ;;
  esac
}

echo "=== npm audit gate ($WORKSPACE) ==="

# Emit one line per SOURCE advisory: "<severity>\t<url>\t<title>\t<nodes_csv>".
# The string-typed `via` entries (bare propagation, e.g. "esbuild") are dropped
# by select(type==…). `nodes` lives on the VULNERABILITY (a sibling of `via`,
# not per-via-entry) — capture it once per vulnerability via `as $vuln` before
# flat-mapping into its `via[]` objects, so each row still carries the node
# paths that vulnerability was found at. `nodes` is filtered to its non-empty
# STRING entries; if none survive (missing/empty/non-array `nodes`, or an array
# of empty strings) the row gets the "(no-nodes)" sentinel (unambiguous — a
# real node path always starts with node_modules/), which the loop below treats
# as a blocking violation for allowlisted ids: a waiver that cannot be
# location-verified is not a waiver.
#
# EVERY TSV FIELD IS GUARANTEED NON-EMPTY via nz(). This is load-bearing, not
# cosmetic: tab is IFS-whitespace, so the `read` loop below COLLAPSES a run of
# tabs around an empty field (and strips leading tabs), sliding every later
# field left — a missing `title` once shifted the node list into $title and
# emptied $nodes_csv, flipping a BLOCK into a WAIVED exit 0 (fail-open;
# security review, PF-1009). jq's `//` alternative does NOT fire on "" — only
# on null/false — so nz() checks null and "" explicitly. A NON-STRING field
# value (e.g. an object-valued title) aborts the projection via error() →
# jq_rc != 0 → fail-closed exit 2. @tsv escapes any embedded tab/newline as
# \t/\n, so a field can never contain a raw delimiter — empty fields were the
# only field-shift vector, and nz() closes it.
#
# Captured into a variable (NOT a `done < <(jq …)` process
# substitution, whose exit status is discarded) so a mid-report jq failure
# fails closed instead of silently evaluating a truncated advisory list;
# pipefail (set above, inherited by the command substitution) carries jq's
# exit status through `sort -u`.
rows="$(jq -r '
  def nz(alt):
    if . == null or . == "" then alt
    elif type == "string" then .
    else error("non-string advisory field") end;
  .vulnerabilities[]?
  | . as $vuln
  | ([$vuln.nodes[]? | select(type == "string" and . != "")]) as $usable
  | (if ($usable | length) > 0 then $usable else ["(no-nodes)"] end) as $nodes
  | $vuln.via[]?
  | select(type == "object")
  | [(.severity | nz("unknown")), (.url | nz("(no-url)")), (.title | nz("(untitled)")), ($nodes | join(","))]
  | @tsv
' <<<"$audit_json" | sort -u)"
jq_rc=$?
if [ "$jq_rc" -ne 0 ]; then
  echo "::error::jq failed (exit $jq_rc) extracting advisories from the npm audit report in $WORKSPACE — failing closed"
  exit 2
fi

unlisted_violations=0
pin_violations=0
seen_allowed=""

while IFS=$'\t' read -r severity url title nodes_csv; do
  # A fully-blank line is the here-string's trailing newline on a zero-row
  # extraction, not an advisory — skip it.
  if [ -z "$severity" ] && [ -z "$url" ] && [ -z "$title" ] && [ -z "$nodes_csv" ]; then
    continue
  fi
  # Defense-in-depth: the jq projection guarantees all four fields non-empty
  # (nz() sentinels), so an empty field here means field-splitting shifted and
  # this row cannot be trusted to classify — refuse, fail closed. (This exit
  # works because the loop is fed by a here-string, not a pipeline subshell.)
  if [ -z "$severity" ] || [ -z "$url" ] || [ -z "$title" ] || [ -z "$nodes_csv" ]; then
    echo "::error::malformed advisory row (empty field after sentinel projection) in $WORKSPACE — failing closed"
    exit 2
  fi
  id="${url##*/}"        # GHSA id (or numeric advisory id) from the advisory url
  [ -z "$id" ] && id="(unidentified advisory)"
  # Record an allowlisted id as seen at ANY severity so the anti-rot note below
  # only fires when the advisory is genuinely absent — not merely below threshold.
  is_allowed "$id" && seen_allowed="$seen_allowed $id"
  # An unrecognized severity (incl. the "unknown" sentinel for missing/empty)
  # cannot be proven below threshold — blocking-eligible, never `ignore`d.
  if is_fail_severity "$severity" || ! is_known_severity "$severity"; then
    if is_allowed "$id"; then
      pinned_display="$(pinned_paths_for "$id")"
      if [ "$nodes_csv" = "(no-nodes)" ]; then
        echo "  BLOCK   [$severity] $id — $title"
        echo "          no location data (nodes) in the audit report for $id — cannot verify it sits at its pinned location(s) [$pinned_display]"
        echo "::error::allowlisted advisory $id has no location data (nodes) in the npm audit report for $WORKSPACE — cannot verify its pinned location(s) [$pinned_display]; treating as a blocking violation"
        pin_violations=$((pin_violations + 1))
      else
        unexpected="$(paths_within_pin "$id" "$nodes_csv")"
        if [ -z "$unexpected" ]; then
          echo "  WAIVED  [$severity] $id — $title (at pinned location(s): $pinned_display)"
        else
          echo "  BLOCK   [$severity] $id — $title"
          echo "          unexpected location(s) outside the pinned allowlist for $id:"
          unexpected_csv=""
          while IFS= read -r loc; do
            [ -z "$loc" ] && continue
            echo "            - $loc"
            unexpected_csv="${unexpected_csv:+$unexpected_csv,}$loc"
          done <<<"$unexpected"
          echo "          pinned location(s) for $id: $pinned_display"
          echo "::error::allowlisted advisory $id found outside its pinned location(s) in $WORKSPACE — unexpected: $unexpected_csv; pinned: $pinned_display. This is the #9016 regression class: a relock likely reverted a patched nested copy. Re-relock the nested copy; do NOT widen the pin."
          pin_violations=$((pin_violations + 1))
        fi
      fi
    else
      echo "  BLOCK   [$severity] $id — $title"
      echo "::error::non-allowlisted advisory $id ([$severity] $title) in $WORKSPACE — fix the dependency (upgrade/relock); the allowlist is only for transitive, dev-only, un-relockable, non-exploitable advisories"
      unlisted_violations=$((unlisted_violations + 1))
    fi
  else
    echo "  ignore  [$severity] $id — $title"
  fi
done <<<"$rows"

# Anti-rot: a waived id that no longer appears is dead weight (the advisory was
# fixed/relocked). Informational only — never fail on absence, or a future cleanup
# that removes the vuln would be blocked by its own stale allowlist entry.
for entry in ${ALLOWED_ADVISORIES[@]+"${ALLOWED_ADVISORIES[@]}"}; do
  a="${entry%%:*}"
  case " $seen_allowed " in
    *" $a "*) ;;
    *) echo "  note    allowlisted advisory $a not present in $WORKSPACE (safe to prune once gone from every workspace)" ;;
  esac
done

echo ""
total_violations=$((unlisted_violations + pin_violations))
if [ "$unlisted_violations" -gt 0 ]; then
  echo "::error::$unlisted_violations non-allowlisted advisory(ies) at or above [$FAIL_SEVERITIES] (or with unrecognized severity) in $WORKSPACE."
  echo "Fix the dependency (upgrade/relock) — do NOT add it to the allowlist unless it is"
  echo "transitive, dev-only, un-relockable AND non-exploitable in this repo (see header)."
fi
if [ "$pin_violations" -gt 0 ]; then
  echo "::error::$pin_violations allowlisted advisory(ies) outside their pinned location(s) (or with no location data) in $WORKSPACE."
  echo "A relock likely reverted a patched nested copy (the #9016 regression class)."
  echo "Re-relock the nested copy; widen the pin ONLY if the new location is genuinely un-relockable."
fi
if [ "$total_violations" -gt 0 ]; then
  exit 1
fi

echo "✓ no blocking advisory at or above [$FAIL_SEVERITIES] in $WORKSPACE (allowlisted waivers verified at their pinned locations)."
exit 0
