#!/usr/bin/env bash
# Unit tests for scripts/check-npm-audit.sh — the hardened npm-audit allowlist
# gate — plus structural assertions that it is wired into the Quality Gates
# `security` job (replacing the raw `npm audit --audit-level=high`) and that its
# own decision logic is exercised by a REQUIRED check (the CI Self-Defense Tests
# job that rides ci-success), not an advisory one.
#
# WHY THIS GATE EXISTS
# --------------------
# This tree recurrently carries a transitive, dev-only advisory whose only
# patched release the pinning toolchain cannot take (npm `overrides` do not
# cascade into nested copies; `--omit=dev` does not prune them). Such advisories
# cannot be relocked away and must be WAIVED BY ID while the gate stays hard for
# everything else — a raw `npm audit --audit-level=high` can never pass. The
# current occupant is brace-expansion GHSA-mh99-v99m-4gvg (patched only in 5.0.8,
# no 1.x backport; the root 1.1.x copy is pinned ^1.1.7 by the eslint-9/
# minimatch@3 toolchain). See ALLOWED_ADVISORIES in the gate for the full
# justification and removal path.
#
# HERMETIC TESTING
# ----------------
# The gate reads its audit command from $NPM_AUDIT_CMD (default real
# `npm audit --json`). These tests inject `cat <fixture>` / `printf …` stubs in a
# throwaway git repo so the branching/exit-code contract is pinned without npm or
# the network. CI never sets the seam; the real npm invocation is exercised there.
# Two additional harness pieces: make_gate_variant (sed-swaps ONLY the
# ALLOWED_ADVISORIES entry literal, so allowlist-format validation and
# multi-path pins are exercised without another seam in the shipped gate) and an
# automatic bash-runtime-error sweep (run_gate_script logs any unbound-variable /
# bad-substitution / syntax-error text a gate invocation leaks; the suite fails
# at the end if any accumulated — catching the macOS bash-3.2 empty-array crash
# class even when the exit code coincides with the expected verdict).
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string (`grep PAT <<<"$var"`),
# never pipe a large variable's `echo` into grep/awk — under pipefail the reader
# closing the pipe on first match SIGPIPEs the writer and misreports a real match
# as a miss (this bit CI on the ~31 KB ci.yml read). The same mechanism inverts a
# NEGATIVE assertion into a false PASS: a here-string-fed stage chained into a
# further `grep -q` gets SIGPIPE'd when the reader exits on an EARLY match, the
# pipeline goes non-zero, and the `if` falls through to the pass branch — so a
# wired bypass near the top of a workflow file would be reported as absent.
# Discipline: materialize every intermediate (comment-strip, context window) into
# a variable first, then match with a SINGLE grep against a here-string. The
# suite-hygiene guards at the end fail if either antipattern is reintroduced.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-npm-audit.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }

FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT

# A throwaway git repo with a `ws` subdir the gate can cd into. The gate resolves
# the workspace under `git rev-parse --show-toplevel`, so it needs a real repo.
REPO="$(mktemp -d)"
(
  cd "$REPO" || exit 1
  git init -q
  git config user.email t@t.t
  git config user.name t
  mkdir ws
  git add -A
  git commit -q --allow-empty -m init
)
trap 'rm -rf "$FIX" "$REPO"' EXIT

# Run a gate script inside $REPO against a workspace (default `ws`) with a
# given audit stub command. Echoes "<exit>|<output>".
#
# AUTOMATIC bash-runtime-error detection: any `unbound variable` / `bad
# substitution` / `syntax error` leaking from the gate is appended to
# $FIX/bash-errors.log and failed at the END of the suite — even when the exit
# code coincides with the expected verdict. This is the macOS bash-3.2 trap: an
# empty-array "${arr[@]}" expansion under set -u aborts the subshell INSIDE a
# command substitution, and the crashed substitution's empty capture used to
# read as a WAIVED verdict for the wrong reason, invisibly.
run_gate_script() {
  local script="$1" auditcmd="$2" ws_arg="${3:-ws}" out rc
  out="$(cd "$REPO" && NPM_AUDIT_CMD="$auditcmd" bash "$script" "$ws_arg" 2>&1)"
  rc=$?
  grep -E 'unbound variable|bad substitution|syntax error' <<<"$out" >> "$FIX/bash-errors.log" || true
  printf '%s|%s' "$rc" "$out"
}

# Same, against the real gate under test.
run_gate() {
  run_gate_script "$SCRIPT" "$1"
}

# Same, but invoked with the ROOT workspace arg (`.`) — the invocation shape
# quality-gates.yml/cd.yml use for the repo-root audit (PF-1010 / #9029).
run_gate_root() {
  run_gate_script "$SCRIPT" "$1" .
}

# Helper: write a fixture file, echo its absolute path.
fixture() { local name="$1"; cat > "$FIX/$name"; echo "$FIX/$name"; }

# Build a gate-script VARIANT whose only byte difference from the real gate is
# the ALLOWED_ADVISORIES entry ($2 must include its surrounding double quotes).
# This exercises allowlist-format validation and the comma-separated multi-path
# pin machinery against otherwise-identical gate code, without adding another
# test seam to the shipped script. Both sanity greps fail the whole suite
# loudly if the real entry literal ever drifts — otherwise a variant would
# silently test the unmodified gate.
REAL_ENTRY='"GHSA-mh99-v99m-4gvg:node_modules/brace-expansion"'
make_gate_variant() {
  local name="$1" entry="$2"
  sed "s|$REAL_ENTRY|$entry|" "$SCRIPT" > "$FIX/$name"
  grep -qF "$entry" "$FIX/$name" \
    || { echo "make_gate_variant: sed anchor missed for $name — did the real ALLOWED_ADVISORIES entry change?"; exit 1; }
  if [ "$entry" != "$REAL_ENTRY" ] && grep -qF "$REAL_ENTRY" "$FIX/$name"; then
    echo "make_gate_variant: real entry still present in $name — substitution did not take"; exit 1
  fi
  echo "$FIX/$name"
}

# The bash-runtime-error log run_gate_script appends to; swept at suite end.
: > "$FIX/bash-errors.log"

echo "=== check-npm-audit.sh contract ==="

# --- 1. Clean report → exit 0 -------------------------------------------------
f="$(fixture clean.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "clean report passes (exit 0)"; else fail "clean should exit 0, got $rc"; fi
if grep -qF "✓ no blocking advisory" <<<"$out"; then pass "success line reflects the location-verified contract"; else fail "success line missing/stale — expected '✓ no blocking advisory …'"; fi

# --- 2. Only allowlisted high advisory → exit 0 -------------------------------
# Post-PF-1009 the gate verifies WHERE a waived id sits, so fixtures carry
# `nodes` at the pinned path (absent/empty nodes is its own BLOCK case — 6g/6h).
f="$(fixture waived.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion"]},
  "minimatch":{"name":"minimatch","severity":"high","via":["brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "allowlisted-only high advisory passes (exit 0)"; else fail "allowlisted-only should exit 0, got $rc"; fi
if grep -qF "WAIVED" <<<"$out"; then pass "allowlisted advisory is reported as WAIVED"; else fail "WAIVED marker missing"; fi
if ! grep -qiF "not present" <<<"$out"; then pass "no false anti-rot note when allowlisted advisory IS present"; else fail "false 'not present' note for a present advisory"; fi

# --- 3. Non-allowlisted HIGH advisory → exit 1 (BLOCK) ------------------------
f="$(fixture block-high.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "evil":{"name":"evil","severity":"high","via":[
    {"source":9,"name":"evil","title":"evil RCE","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","severity":"high","range":"*"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "non-allowlisted high advisory blocks (exit 1)"; else fail "non-allowlisted high should exit 1, got $rc"; fi
if grep -qF "BLOCK" <<<"$out"; then pass "non-allowlisted advisory is reported as BLOCK"; else fail "BLOCK marker missing"; fi
if grep -qF "::error::non-allowlisted advisory GHSA-aaaa-bbbb-cccc" <<<"$out"; then pass "per-advisory ::error:: names the blocking id"; else fail "per-advisory ::error:: annotation missing for GHSA-aaaa-bbbb-cccc"; fi

# --- 4. Non-allowlisted CRITICAL advisory → exit 1 ---------------------------
f="$(fixture block-crit.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "evil":{"name":"evil","severity":"critical","via":[
    {"source":9,"name":"evil","title":"evil critical","url":"https://github.com/advisories/GHSA-dddd-eeee-ffff","severity":"critical","range":"*"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "non-allowlisted critical advisory blocks (exit 1)"; else fail "non-allowlisted critical should exit 1, got $rc"; fi

# --- 5. Allowlisted + non-allowlisted mixed → exit 1 (the real one still blocks)
f="$(fixture mixed.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"*"}],
    "nodes":["node_modules/brace-expansion"]},
  "evil":{"name":"evil","severity":"high","via":[
    {"source":9,"name":"evil","title":"evil RCE","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","severity":"high","range":"*"}],
    "nodes":["node_modules/evil"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "mixed (allowlisted + real high) blocks (exit 1)"; else fail "mixed should exit 1, got $rc"; fi
if grep -qF "WAIVED" <<<"$out" && grep -qF "BLOCK" <<<"$out"; then pass "mixed report shows both WAIVED and BLOCK"; else fail "mixed report missing WAIVED or BLOCK"; fi

# --- 6. Non-allowlisted LOW advisory → exit 0 (below fail threshold) ----------
f="$(fixture low.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "minor":{"name":"minor","severity":"low","via":[
    {"source":9,"name":"minor","title":"minor","url":"https://github.com/advisories/GHSA-1111-2222-3333","severity":"low","range":"*"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "non-allowlisted low advisory does NOT block (exit 0, matches --audit-level=high)"; else fail "low advisory should exit 0, got $rc"; fi

# --- 6b. Non-allowlisted MODERATE advisory → exit 0 (below fail threshold) -----
# Pins FAIL_SEVERITIES to exactly {high, critical}. Without this, a contributor
# widening the threshold to include `moderate` (or the gate silently treating an
# unknown severity as failing) would go uncaught — moderate must pass like low.
f="$(fixture moderate.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "mid":{"name":"mid","severity":"moderate","via":[
    {"source":9,"name":"mid","title":"mid sev","url":"https://github.com/advisories/GHSA-4444-5555-6666","severity":"moderate","range":"*"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "non-allowlisted moderate advisory does NOT block (exit 0 — threshold is high+critical only)"; else fail "moderate advisory should exit 0, got $rc"; fi
if grep -qF "ignore" <<<"$out"; then pass "moderate advisory is reported as ignore (below threshold), not BLOCK"; else fail "moderate advisory should be marked ignore"; fi

# --- 6c. String-typed `via` entry must be SKIPPED, not evaluated --------------
# A bare-string `via` is pure propagation of another package's advisory; it carries
# no id and must be dropped by `select(type == "object")`. The danger if that
# select is ever removed: `.severity` on a string aborts the jq stream, so any
# OBJECT advisory iterated AFTER the offending string is silently dropped — a real
# high could stop blocking. This fixture puts the string-`via` package FIRST and a
# non-allowlisted HIGH object advisory SECOND, so a regression that drops the
# select would exit 0 here instead of 1. Correct behaviour: the string is skipped
# and the high still BLOCKs.
f="$(fixture string-via.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "propagated":{"name":"propagated","severity":"high","via":["evilpkg"]},
  "evilpkg":{"name":"evilpkg","severity":"high","via":[
    {"source":42,"name":"evilpkg","title":"evilpkg RCE","url":"https://github.com/advisories/GHSA-7777-8888-9999","severity":"high","range":"*"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "string-via before a real high still blocks (exit 1 — select(type==object) intact)"; else fail "string-via fixture should exit 1 (regression drops select → exit 0), got $rc"; fi
if grep -qF "GHSA-7777-8888-9999" <<<"$out"; then pass "the object advisory after the string-via is still evaluated"; else fail "object advisory dropped — string-via aborted the jq stream"; fi
block_count="$(grep -cF "BLOCK" <<<"$out")"
if [ "$block_count" = "1" ]; then pass "string-via produces no spurious finding (exactly one BLOCK)"; else fail "expected exactly one BLOCK, got $block_count (string-via mis-counted?)"; fi

# --- 6d. Allowed advisory ONLY at its pinned node path → WAIVED, exit 0 ------
# Location pinning (PF-1009/#9026): an id-only allowlist is a hole wider than it
# looks. PF-1002/#9007 relocked the two NESTED brace-expansion copies (under
# glob/ and @typescript-eslint/typescript-estree/) to the patched 5.0.8, leaving
# only the un-relockable root copy waived; Dependabot PR #9016 then did a full
# relock that silently reverted both nested copies back to 5.0.7 — a
# production-reachable regression (the glob/ copy is prod-reachable) — and the
# id-only gate stayed GREEN throughout because it never looked at WHERE the id
# occurred. This fixture is the correct, un-regressed shape: the id present only
# at its pinned root copy.
f="$(fixture pinned-only.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "advisory confined to its pinned node path passes (exit 0)"; else fail "pinned-only location should exit 0, got $rc"; fi
if grep -qF "WAIVED" <<<"$out"; then pass "pinned-only location is reported as WAIVED"; else fail "WAIVED marker missing for pinned-only location"; fi

# --- 6e. Allowed advisory ALSO at an unpinned node path → BLOCK, exit 1 -------
# Mirrors the real regression exactly: brace-expansion present at its pinned
# root copy PLUS the two nested copies that should have stayed patched. This is
# the case the id-only gate could never catch — it must now BLOCK and name the
# unexpected locations.
f="$(fixture unpinned-location.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/glob/node_modules/brace-expansion","node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "advisory at an unpinned node path blocks (exit 1)"; else fail "unpinned location should exit 1, got $rc"; fi
if grep -qF "node_modules/glob/node_modules/brace-expansion" <<<"$out"; then pass "output names the unexpected glob/ location"; else fail "output does not name the unexpected glob/ location"; fi
if grep -qF "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion" <<<"$out"; then pass "output names the unexpected typescript-estree/ location"; else fail "output does not name the unexpected typescript-estree/ location"; fi
if grep -qF "GHSA-mh99-v99m-4gvg" <<<"$out"; then pass "output names the advisory id for the unpinned-location block"; else fail "output does not name the advisory id"; fi
# The pinned root copy is NOT an unexpected location — it must never be listed
# as one. Detail lines use the fixed "            - <path>" format (12 spaces,
# hyphen, space), so an anchored whole-line match is exact.
if ! grep -qxF '            - node_modules/brace-expansion' <<<"$out"; then pass "pinned root copy is not listed among the unexpected locations"; else fail "pinned root copy wrongly listed as an unexpected location"; fi
block_count="$(grep -cF "BLOCK" <<<"$out")"
if [ "$block_count" = "1" ]; then pass "unexpected locations grouped under exactly one BLOCK"; else fail "expected exactly one BLOCK for the unpinned-location case, got $block_count"; fi
if grep -qF "pinned location(s) for GHSA-mh99-v99m-4gvg: node_modules/brace-expansion" <<<"$out"; then pass "output names the pinned location(s) alongside the unexpected ones"; else fail "pinned-location display line missing"; fi
if grep -qF "::error::allowlisted advisory GHSA-mh99-v99m-4gvg found outside its pinned location(s)" <<<"$out"; then pass "::error:: annotation fires for the pin violation"; else fail "::error:: pin-violation annotation missing"; fi
if grep -qF "outside their pinned location(s)" <<<"$out"; then pass "summary counts the failure in the pin-violation bucket"; else fail "pin-violation summary bucket missing"; fi
if ! grep -qF "non-allowlisted advisory(ies) at or above" <<<"$out"; then pass "pin violation is not miscounted as a non-allowlisted advisory"; else fail "pin violation miscounted in the non-allowlisted summary bucket"; fi

# --- 6f. Anti-rot note fires when a waived id is fully absent (exit 0) -------
f="$(fixture clean-note.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "advisory fully absent still passes (exit 0)"; else fail "fully-absent advisory should exit 0, got $rc"; fi
if grep -qiF "not present" <<<"$out"; then pass "anti-rot note fires when the waived advisory is absent"; else fail "anti-rot note missing for fully-absent advisory"; fi

# --- 6g. Allowlisted id with NO nodes data → BLOCK, exit 1 -------------------
# The silent-waive hole: pre-PF-1009 an allowlisted id whose vulnerability had
# no `nodes` key produced an empty locations csv, which read as "nothing
# unexpected" → WAIVED, exit 0. Absent location data cannot verify the pin, so
# it must BLOCK with a distinct message, not waive.
f="$(fixture no-nodes.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "allowlisted id with no nodes data blocks (exit 1)"; else fail "missing nodes should exit 1 (silent-waive hole), got $rc"; fi
if grep -qF "no location data" <<<"$out"; then pass "missing-nodes block prints the no-location-data message"; else fail "no-location-data message missing"; fi

# --- 6h. Allowlisted id with EMPTY nodes array → BLOCK, exit 1 ---------------
f="$(fixture empty-nodes.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":[]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "allowlisted id with empty nodes array blocks (exit 1)"; else fail "empty nodes should exit 1 (silent-waive hole), got $rc"; fi

# --- 6i. Allowlisted id with STRING nodes → BLOCK, exit 1 --------------------
# A string `nodes` used to abort jq mid-stream (`join` on a string), the loop
# then saw zero rows, and the gate exited 0 — clean-by-crash. The type guard
# must route any non-array nodes into the no-location-data BLOCK instead.
f="$(fixture string-nodes.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":"node_modules/brace-expansion"}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "allowlisted id with string (non-array) nodes blocks (exit 1)"; else fail "string nodes should exit 1 (clean-by-crash hole), got $rc"; fi

# --- 6j. Sibling-prefix path → BLOCK (kills a prefix-match rewrite) ----------
# node_modules/brace-expansion-extra shares the pinned path as a string PREFIX.
# Exact-match containment must reject it; a future "optimization" to prefix or
# substring matching would wrongly waive it — this case pins that down.
f="$(fixture sibling-prefix.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion-extra"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "sibling-prefix path (brace-expansion-extra) blocks (exit 1 — exact match, not prefix)"; else fail "sibling-prefix path should exit 1, got $rc"; fi
if grep -qF -- "- node_modules/brace-expansion-extra" <<<"$out"; then pass "output names the sibling-prefix path as unexpected"; else fail "sibling-prefix path not named as unexpected"; fi

# --- 6k. MISSING title on waived id at an unpinned path → BLOCK, exit 1 ------
# The field-shift bypass (security review, PF-1009): `title` is field 3 of the
# TSV row, and tab is IFS-whitespace — bash collapses the doubled tab an empty
# field leaves behind, sliding the node list into $title and emptying
# $nodes_csv. Pre-fix that turned this exact report (waived id at the unpinned
# glob/ copy, no title key) into WAIVED exit 0. The nz() sentinel projection
# must keep the columns aligned so the pin violation still blocks.
f="$(fixture missing-title.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/glob/node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing title with waived id at unpinned path blocks (exit 1 — field-shift bypass)"; else fail "missing title should exit 1 (field-shift bypass), got $rc"; fi
if grep -qF "node_modules/glob/node_modules/brace-expansion" <<<"$out"; then pass "missing-title block still names the unexpected glob/ location"; else fail "missing-title block does not name the unexpected location"; fi
if grep -qF "(untitled)" <<<"$out"; then pass "missing title is rendered as the (untitled) sentinel"; else fail "(untitled) sentinel missing from output"; fi

# --- 6l. EMPTY-STRING title on waived id at an unpinned path → BLOCK, exit 1 --
# Same bypass, different trigger: jq's `//` does NOT fire on "" (only
# null/false), so a `"title": ""` also emitted an empty TSV field pre-fix.
f="$(fixture empty-title.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/glob/node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "empty-string title with waived id at unpinned path blocks (exit 1)"; else fail "empty title should exit 1 (field-shift bypass), got $rc"; fi
if grep -qF "::error::allowlisted advisory GHSA-mh99-v99m-4gvg found outside its pinned location(s)" <<<"$out"; then pass "empty-title case takes the pin-violation path"; else fail "empty-title case did not take the pin-violation path"; fi

# --- 6m. MISSING severity on a non-allowlisted advisory → BLOCK, exit 1 -------
# Leading-position shift: severity is field 1, and bash strips LEADING
# IFS-whitespace, so an absent severity slid the URL into $severity pre-fix —
# is_fail_severity never matched and a non-allowlisted advisory was silently
# `ignore`d (exit 0). The "unknown" sentinel cannot be proven below threshold,
# so it must be blocking-eligible.
f="$(fixture missing-severity.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "evil-pkg":{"name":"evil-pkg","via":[
    {"source":2,"name":"evil-pkg","title":"evil-pkg RCE","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","range":"*"}],
    "nodes":["node_modules/evil-pkg"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing severity on non-allowlisted advisory blocks (exit 1 — unknown is blocking-eligible)"; else fail "missing severity should exit 1, got $rc"; fi
if grep -qF "[unknown]" <<<"$out"; then pass "missing severity is rendered as the [unknown] sentinel"; else fail "[unknown] sentinel missing from output"; fi

# --- 6n. EMPTY-STRING severity on a non-allowlisted advisory → BLOCK, exit 1 --
f="$(fixture empty-severity.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "evil-pkg":{"name":"evil-pkg","severity":"critical","via":[
    {"source":2,"name":"evil-pkg","title":"evil-pkg RCE","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","severity":"","range":"*"}],
    "nodes":["node_modules/evil-pkg"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "empty-string severity on non-allowlisted advisory blocks (exit 1)"; else fail "empty severity should exit 1, got $rc"; fi
if grep -qF "[unknown]" <<<"$out"; then pass "empty severity is rendered as the [unknown] sentinel"; else fail "[unknown] sentinel missing for empty severity"; fi

# --- 6o. Nodes array of EMPTY STRINGS → no-location-data BLOCK, exit 1 --------
# ["",""] survives an `if nodes empty` length check but yields zero usable
# paths — the projection must filter to non-empty strings BEFORE deciding
# between real locations and the (no-nodes) sentinel, else join(",") emits ","
# and field 4 becomes garbage that is neither a path nor the sentinel.
f="$(fixture empty-string-nodes.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["",""]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "nodes array of empty strings blocks (exit 1 — no usable location data)"; else fail "empty-string nodes should exit 1, got $rc"; fi
if grep -qF "no location data" <<<"$out"; then pass "empty-string nodes route to the no-location-data block"; else fail "empty-string nodes did not route to the no-location-data block"; fi

# --- 6p. BOTH title and severity absent on waived id at unpinned path → exit 1
# Compound sentinel case: two empty fields at once shifted the row by two
# positions pre-fix. Both sentinels must project and the pin violation must
# still block.
f="$(fixture missing-title-and-severity.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/glob/node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing title AND severity with waived id at unpinned path blocks (exit 1)"; else fail "compound missing fields should exit 1, got $rc"; fi
if grep -qF "[unknown]" <<<"$out" && grep -qF "(untitled)" <<<"$out"; then pass "both sentinels project in the compound case"; else fail "compound case missing a sentinel in output"; fi

# --- 6q. ADJACENT-RUN severity ("info low") on non-allowlisted advisory → exit 1
# is_known_severity must exact-match each severity word: a substring scan of
# the space-joined known list accepts any adjacent run ("info low",
# "low moderate", …) as known, and a run below the fail threshold was then
# silently `ignore`d (exit 0) — the exact class the unknown-severity fix
# exists to make blocking-eligible.
f="$(fixture adjacent-run-severity.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "evil-pkg":{"name":"evil-pkg","severity":"critical","via":[
    {"source":2,"name":"evil-pkg","title":"evil-pkg RCE","url":"https://github.com/advisories/GHSA-bbbb-cccc-dddd","severity":"info low","range":"*"}],
    "nodes":["node_modules/evil-pkg"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "adjacent-run severity (info low) on non-allowlisted advisory blocks (exit 1)"; else fail "adjacent-run severity should exit 1 (unknown, blocking-eligible), got $rc"; fi
if grep -qE '^ *BLOCK +\[info low\]' <<<"$out"; then pass "adjacent-run severity is rendered verbatim in the BLOCK line"; else fail "adjacent-run severity not on a BLOCK line (an ignore line rendering [info low] must not satisfy this)"; fi

# --- 6r. ROOT-workspace invocation (`.`): blocking advisory blocks (exit 1) ---
# PF-1010 / #9029: npm audit scopes advisories to the INVOKING workspace's
# dependency subtree, so the workflows also run the gate from the repo root
# (`check-npm-audit.sh .`) to cover root devDeps and the packages*/apps*
# workspaces. These cases pin the gate's contract for that `.` arg — TARGET
# resolves to "$ROOT/.", which must behave identically to a named workspace,
# not trip the missing-dir fail-closed path.
res="$(run_gate_root "cat $FIX/block-high.json")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "root invocation (.): non-allowlisted high blocks (exit 1)"; else fail "root invocation with blocking advisory should exit 1, got $rc"; fi
if grep -qF "npm audit gate (.)" <<<"$out"; then pass "root invocation (.): header names the root workspace"; else fail "root invocation header missing '(.)'— the workspace arg did not flow through"; fi

# --- 6s. ROOT-workspace invocation (`.`): waived-at-pin passes (exit 0) -------
# waived.json is the real root-audit shape: the pinned source advisory plus a
# string-`via` propagation row (minimatch) — propagation must stay covered by
# the source waiver when invoked via `.` too.
res="$(run_gate_root "cat $FIX/waived.json")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "root invocation (.): allowlisted-at-pin advisory passes (exit 0)"; else fail "root invocation with waived-at-pin advisory should exit 0, got $rc"; fi
if grep -qF "WAIVED" <<<"$out"; then pass "root invocation (.): allowlisted advisory reported as WAIVED"; else fail "root invocation WAIVED marker missing"; fi

# --- 6t. ROOT-workspace invocation (`.`): empty output fails closed (exit 2) --
res="$(run_gate_root "true")"; rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "root invocation (.): empty audit output fails closed (exit 2)"; else fail "root invocation with empty output should exit 2, got $rc"; fi

# --- 7. Malformed JSON → fail-closed (exit 2) --------------------------------
res="$(run_gate "printf 'not json{{{'")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "malformed audit JSON fails closed (exit 2)"; else fail "malformed JSON should exit 2, got $rc"; fi
if grep -qiF "failing closed" <<<"$out"; then pass "malformed JSON prints a fail-closed message"; else fail "fail-closed message missing"; fi

# --- 8. Empty audit output → fail-closed (exit 2) ----------------------------
res="$(run_gate "true")"; rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "empty audit output fails closed (exit 2)"; else fail "empty output should exit 2, got $rc"; fi

# --- 9. Valid JSON but NOT an audit report → fail-closed (exit 2) -------------
# A bare {} is parseable but has no auditReportVersion — must not be mistaken for
# a clean report, or an npm error object would read as "no vulnerabilities".
res="$(run_gate "printf '{}'")"; rc="${res%%|*}"
if [ "$rc" = "2" ]; then pass "non-audit JSON ({} with no auditReportVersion) fails closed (exit 2)"; else fail "non-audit JSON should exit 2, got $rc"; fi

# --- 9b. jq aborts mid-extraction → fail-closed (exit 2) ----------------------
# Pre-PF-1009 the jq feed ran inside a process substitution, so a jq failure's
# exit status was discarded — the loop saw zero rows and the gate exited 0
# (clean-by-crash). An object-valued `title` makes @tsv throw (jq exit 5); the
# captured-rows rewrite must surface that as a fail-closed exit 2.
f="$(fixture jq-abort.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "weird":{"name":"weird","severity":"high","via":[
    {"source":7,"name":"weird","title":{"not":"a string"},"url":"https://github.com/advisories/GHSA-jjjj-kkkk-llll","severity":"high","range":"*"}],
    "nodes":["node_modules/weird"]}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "jq abort mid-extraction fails closed (exit 2, not clean-by-crash exit 0)"; else fail "jq abort should exit 2, got $rc"; fi
if grep -qiF "failing closed" <<<"$out"; then pass "jq abort prints a fail-closed message"; else fail "jq-abort fail-closed message missing"; fi

# --- 9c. auditReportVersion 1 → fail-closed (exit 2) --------------------------
# npm 6-era reports use `advisories`, not `vulnerabilities` — evaluating one
# with the v2 extraction yields zero rows and a silent pass. Only version 2 is
# recognized. (Fixture file, not inline printf: the audit command goes through
# `eval` inside the gate, which makes inline-quoted JSON fragile.)
f="$(fixture v1-report.json <<'JSON'
{"auditReportVersion":1,"advisories":{"1":{"severity":"high"}}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "auditReportVersion 1 fails closed (exit 2)"; else fail "v1 report should exit 2, got $rc"; fi
if grep -qF "not a recognized audit report" <<<"$out"; then pass "v1 report prints the not-recognized message"; else fail "not-recognized message missing for v1 report"; fi

# --- 10. Missing workspace dir → fail-closed (exit 2) ------------------------
out="$(cd "$REPO" && NPM_AUDIT_CMD="true" bash "$SCRIPT" no_such_ws 2>&1)"; rc=$?
if [ "$rc" = "2" ]; then pass "missing workspace dir fails closed (exit 2)"; else fail "missing workspace should exit 2, got $rc"; fi

# --- 11. No argument → fail-closed (exit 2) ----------------------------------
out="$(cd "$REPO" && bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" = "2" ]; then pass "no workspace argument fails closed (exit 2)"; else fail "no argument should exit 2, got $rc"; fi

echo ""
echo "=== allowlist entry format + multi-path pins (gate variants) ==="
# --- 12. Bare-id allowlist entry (no colon) → fail-closed (exit 2) ------------
# The pre-PF-1009 entry format. A bare id would silently mean "no pinned paths"
# — every location unexpected, or worse, format-dependent behavior. Malformed
# entries are a config error: fail closed, never guess.
v="$(make_gate_variant gate-bare-id.sh '"GHSA-mh99-v99m-4gvg"')"
res="$(run_gate_script "$v" "cat $FIX/clean.json")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "bare-id allowlist entry fails closed (exit 2)"; else fail "bare-id entry should exit 2, got $rc"; fi
if grep -qF "malformed ALLOWED_ADVISORIES" <<<"$out"; then pass "bare-id entry names the malformed-allowlist error"; else fail "malformed-allowlist message missing for bare-id entry"; fi

# --- 13. Empty-path allowlist entry ("id:") → fail-closed (exit 2) ------------
v="$(make_gate_variant gate-empty-path.sh '"GHSA-mh99-v99m-4gvg:"')"
res="$(run_gate_script "$v" "cat $FIX/clean.json")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "empty-path allowlist entry fails closed (exit 2)"; else fail "empty-path entry should exit 2, got $rc"; fi
if grep -qF "malformed ALLOWED_ADVISORIES" <<<"$out"; then pass "empty-path entry names the malformed-allowlist error"; else fail "malformed-allowlist message missing for empty-path entry"; fi

# --- 14. Multi-path pin, id at exactly those paths → WAIVED, exit 0 -----------
v="$(make_gate_variant gate-multi.sh '"GHSA-mh99-v99m-4gvg:node_modules/brace-expansion,node_modules/vendored/brace-expansion"')"
f="$(fixture multi-pinned.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/vendored/brace-expansion"]}}}
JSON
)"
res="$(run_gate_script "$v" "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "multi-path pin waives the id at exactly its pinned paths (exit 0)"; else fail "multi-path pinned-only should exit 0, got $rc"; fi
if grep -qF "WAIVED" <<<"$out"; then pass "multi-path pinned-only is reported as WAIVED"; else fail "WAIVED marker missing for multi-path pin"; fi

# --- 15. Multi-path pin + a third unpinned path → BLOCK, exit 1 ---------------
f="$(fixture multi-third.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}],
    "nodes":["node_modules/brace-expansion","node_modules/vendored/brace-expansion","node_modules/extra/node_modules/brace-expansion"]}}}
JSON
)"
res="$(run_gate_script "$v" "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "third path outside a multi-path pin blocks (exit 1)"; else fail "unpinned third path should exit 1, got $rc"; fi
if grep -qF "node_modules/extra/node_modules/brace-expansion" <<<"$out"; then pass "output names the unpinned third path"; else fail "unpinned third path not named"; fi

echo ""
echo "=== gate script hardening (structural) ==="
# The allowlist must contain exactly the one documented advisory — a structural
# pin so a future edit cannot silently broaden it (a too-wide allowlist is a
# silent gate-disable, the F25/#8617 failure mode).
if grep -qF 'GHSA-mh99-v99m-4gvg' "$SCRIPT"; then
  pass "allowlist documents the brace-expansion advisory by id"
else
  fail "allowlist is missing the documented brace-expansion advisory id"
fi
# The pruned esbuild waivers must STAY pruned from ALLOWED_ADVISORIES — their
# advisories left every workspace, and a lingering entry is dead-weight gate
# surface. The ids may appear in prose (the gate's History note), so scope the
# check to the array body between `ALLOWED_ADVISORIES=(` and its closing `)`.
allowlist_body="$(awk '/^ALLOWED_ADVISORIES=\(/{f=1;next} f && /^\)/{exit} f' "$SCRIPT")"
if grep -qF 'GHSA-gv7w-rqvm-qjhr' <<<"$allowlist_body" || grep -qF 'GHSA-g7r4-m6w7-qqqr' <<<"$allowlist_body"; then
  fail "pruned esbuild waiver still present in ALLOWED_ADVISORIES (advisories are gone from every workspace)"
else
  pass "stale esbuild waivers stay pruned from ALLOWED_ADVISORIES"
fi
# The gate must FAIL CLOSED — `exit 2` on tooling error must exist in the script.
if grep -qE 'exit 2' "$SCRIPT"; then
  pass "gate has fail-closed exit-2 paths"
else
  fail "gate has no exit-2 fail-closed path"
fi
# It must validate the report shape (auditReportVersion), not just JSON-parse, so
# an npm error object can't read as a clean report.
if grep -qF 'auditReportVersion' "$SCRIPT"; then
  pass "gate validates auditReportVersion (rejects non-audit JSON)"
else
  fail "gate does not validate auditReportVersion — npm error JSON could read as clean"
fi

# Cut one named step's OWN key block from a comment-stripped job block: from
# its `- name:` line up to (not including) the next step's `- ` line. Every
# tamper-relevant key a step can carry (`if:`, `continue-on-error:`, `env:`)
# lives inside this block, so scanning the WHOLE block closes the
# window-evasion class: a `continue-on-error: true` separated from the run:
# line by a multi-line env: block escapes a fixed `grep -B3 -A1` window, and a
# step-level `if: false` (step skipped, run: line still greps as present) sits
# entirely outside any run:-anchored window. Empty output = the named step is
# gone — callers fail closed on it, never skip.
# Terminator for every job-level block cut below. Quote-tolerant, and colonless
# on purpose.
#
# QUOTE-TOLERANT: YAML accepts a job key in either quote style, so a bare-only
# class (`^  [A-Za-z_][A-Za-z0-9_-]*:`) does not terminate on `  'zz-decoy':`.
# When the target job is the LAST one in the file — ci-success is — the cut then
# runs to EOF and every pin beneath it reads a FOLLOWING job's keys. That is
# strictly worse than a false positive: it lets the suite print an affirmative
# PASS about a property the target does not have. Found by review at round 13's
# ci-success `needs:` pin, where deleting that key and appending a single-quoted
# decoy job carrying `- quality-gates` produced a GREEN suite and the line
# "ci-success still lists quality-gates in its needs: aggregate" while
# ci-success listed nothing at all. The bare-key form of the same mutation was
# already caught, so the quote was the whole ingredient — the same spelling
# class rounds 12-13 swept out of the 29 key MATCHERS, missed on the
# terminators those rounds introduced.
#
# COLON-REQUIRING: round 14 dropped the `:` on the theory that inside `jobs:`,
# any 2-space-indented line starting with a letter/underscore/quote IS a job key
# because properties sit at 4 spaces. That theory is FALSE, and dropping the
# colon was a regression the parent commit did not have. YAML indentation bounds
# BLOCK structure, not scalars: a multi-line quoted scalar continues at ANY
# indentation, including *less* than its own key's. So
#
#     name: "trunc
#   decoy"
#     steps:
#       - run: echo "all audits removed"
#
# puts a 2-space, letter-initial, colonless line INSIDE the job. The colonless
# class matched it, truncating the cut while the job continued — and every pin
# below the truncation point then read a block that no longer contained the keys
# it was pinning. That fails OPEN, not closed: count pins ("exactly one steps:")
# and absence pins ("no continue-on-error:") are satisfied by evidence that has
# been cut away, so the appended duplicate `steps:` wins under last-key-wins,
# every audit is replaced, and the job still reports SUCCESS — which is strictly
# worse than round 13's finding, where the mutation at least made the required
# check red. On cd.yml it additionally makes `needs.security.result == 'success'`
# genuinely true, satisfying both deploy clause pins on their own terms.
# Found independently by two review seats; measured green at 143/0 with the
# colonless class, red with the colon restored.
#
# The key-level cuts elsewhere in this file stay colonless SAFELY, and the
# asymmetry is the reason the precedent did not transfer: those host positive
# containment pins, where truncation removes the needle and fails CLOSED. Only
# the job-level cuts host count/absence pins, where truncation removes the
# evidence instead.
#
# A quoted spelling of a cut's OWN header is safe by construction: every cut
# anchors its start on the bare form, so a quoted target header yields an empty
# block, and every caller fails closed on empty rather than passing vacuously.
job_key_re="^  [\"']?[A-Za-z_][A-Za-z0-9_-]*[\"']?[[:space:]]*:"

# The colon alone is necessary but NOT sufficient. A continuation line can carry
# a colon (`  B: 2}`, closing a flow mapping opened above) or be spelled exactly
# like a bare job key (`  decoy:`), and the scalar that emits it can be opened in
# ways no `key: "..."` test sees — behind a backslash-escaped quote (`"grp\"`),
# as a bare sequence item (`- "a`), or behind a YAML anchor or tag
# (`&a "trunc`, `!!str "trunc`). Every one of those was measured live against an
# earlier revision of this file: suite green, PyYAML confirming a gutted job.
#
# The lesson is that "does this line LOOK like a job key?" is the wrong question.
# Three successive rounds of widening the charset each traded one spelling for
# the next, because the question is a blacklist and YAML has unbounded spellings.
#
# So ask a question with a finite answer instead: the cut's premise is that the
# ONLY 2-space lines inside `jobs:` are the job keys themselves. Enumerate them
# and pin the exact set. That is spelling-independent by construction — a
# continuation, however it is opened or spelled, is a 2-space line that is not in
# the list, and goes red. It also covers the reverse direction the shape tests
# never did: respelling a REAL job key (`  "security":`) so the terminator stops
# matching it, which would make a cut over-run into the following job.
#
# Consequences, stated rather than discovered later: adding, renaming or removing
# a job turns this suite red until the list below is updated. That is a one-line,
# obviously-correct edit, and for a self-defense suite the prompt is the point.
# It fails closed in every direction — an anchor that stops matching, a section
# that ends early, a workflow that grows a key all produce a mismatch, never a
# vacuous pass, and an empty enumeration is refused outright.
#
# Scope, honestly: this makes the cuts' premise VERIFIED rather than assumed for
# these three files. It does not make line-based cutting sound in general, and
# like every pin here it is defeated by a coordinated edit of both the workflow
# and this suite — it raises the cost of tampering, it is not a proof.
assert_job_key_lines() { # $1 = comment-stripped workflow, $2 = label, $3 = expected job-key lines
  local actual delta
  actual="$(awk '
    /^["'"'"']?jobs["'"'"']?[[:space:]]*:/ {j=1; next}
    j && /^[^[:space:]]/ {j=0}
    j && /^  [^ ]/ {print}
  ' <<<"$1")"
  if [ -z "$actual" ]; then
    fail "$2: found no 2-space lines inside jobs: — every block cut below would read an empty block and every count/absence pin would pass vacuously"
    return
  fi
  if [ "$actual" != "$3" ]; then
    delta="$(diff <(printf '%s\n' "$3") <(printf '%s\n' "$actual") | grep '^[<>]' | tr '\n' ' ')"
    fail "$2: the 2-space lines inside jobs: are not exactly the expected job keys — a block cut terminates on every one of them, so an unexpected line truncates a job block and the count/absence pins below it read evidence that was cut away ('<' expected-but-absent, '>' present-but-unexpected): $delta"
    return
  fi
  pass "$2: the 2-space lines inside jobs: are exactly the $(grep -c '' <<<"$actual") expected job keys (nothing can truncate or over-run a block cut)"
}

step_block() { # $1 = comment-stripped job block, $2 = step-name needle (fixed string)
  awk -v needle="$2" '
    !f && /^      - name:/ && index($0, needle) {f=1; print; next}
    f && /^      - /{exit}
    f {print}
  ' <<<"$1"
}

# The three workspace invocations every security job must carry, by EXACT step
# name — anchoring on the name both scopes the tamper checks and forces the
# steps to stay named (a bare `- run:` step would read as a missing step).
# Parallel arrays bind each step to ITS workspace's invocation (index-matched;
# the _RE form is the regex-escaped argument).
AUDIT_STEP_NAMES=('npm audit (web) — allowlist gate' 'npm audit (mcp-server) — allowlist gate' 'npm audit (root) — allowlist gate')
AUDIT_STEP_WS=('web' 'mcp-server' '.')
AUDIT_STEP_WS_RE=('web' 'mcp-server' '\.')

# Step-scoped tamper assertions for one security job block ($2), labeled $1:
# each gate step must exist by name, carry no step-level `if:` (a skipped
# step's run: line still greps as present — and a skipped required check reads
# as satisfied under branch protection; `["']?if["']?[[:space:]]*:` because
# YAML also accepts a space before the colon and a key in EITHER quote style —
# `"if": false` and `'if': false` are both the same key as `if:` to the parser
# but invisible to an unquoted-only grep. Every count and absence pin in this
# suite uses that same `["']?` class for exactly this reason; a double-quote-
# only class left single-quoted duplicates of every pinned key green. RESIDUAL:
# this closes the quoting vector, not the general same-key-different-spelling
# class — a double-quoted key admits escapes, so an escape-spelled `"security":`
# is still the same key and would still slip the pin. Resisting that means
# resolving YAML rather than grepping it, which is out of register here: these
# pins raise the cost of textual tampering, they do not decide key identity),
# no `continue-on-error:` anywhere in its
# block (not just inside a fixed grep window around the run: line), and
# exactly ONE run: key whose whole line is its own workspace's invocation —
# YAML keeps only the LAST duplicate key, so a second run: merged into a
# sibling step would silently drop an audit, and a trailing `# comment` after
# a neutered `run: true` would still satisfy a substring match.
assert_audit_steps_untampered() {
  local wf="$1" job_block="$2" i needle ws ws_re blk run_count
  for i in "${!AUDIT_STEP_NAMES[@]}"; do
    needle="${AUDIT_STEP_NAMES[$i]}"
    ws="${AUDIT_STEP_WS[$i]}"
    ws_re="${AUDIT_STEP_WS_RE[$i]}"
    blk="$(step_block "$job_block" "$needle")"
    if [ -z "$blk" ]; then
      fail "$wf security job has no step named '$needle' — step-scoped tamper checks cannot run (fail closed)"
      continue
    fi
    if grep -qE "^[[:space:]]*[\"']?if[\"']?[[:space:]]*:" <<<"$blk"; then
      fail "$wf step '$needle' carries a step-level if: — the gate can be skipped while its run: line still greps as present"
    else
      pass "$wf step '$needle' has no step-level if:"
    fi
    if grep -q 'continue-on-error' <<<"$blk"; then
      fail "$wf step '$needle' carries continue-on-error — the gate's exit code would be ignored"
    else
      pass "$wf step '$needle' has no continue-on-error anywhere in its step block"
    fi
    run_count="$(grep -cE "^[[:space:]]*[\"']?run[\"']?[[:space:]]*:" <<<"$blk" || true)"
    if [ "$run_count" -ne 1 ]; then
      fail "$wf step '$needle' has $run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps only the last duplicate key, so an audit can be silently dropped)"
    elif grep -qE "^[[:space:]]*run: bash scripts/check-npm-audit\\.sh ${ws_re}[[:space:]]*\$" <<<"$blk"; then
      pass "$wf step '$needle' runs its own workspace's gate ($ws) as its single run: line"
    else
      fail "$wf step '$needle' does not run 'bash scripts/check-npm-audit.sh $ws' as its whole run: line — neutered, rewritten, or comment-suffixed"
    fi
  done
}

echo ""
echo "=== quality-gates.yml integration wiring ==="
if [ -f "$QG_YML" ]; then
  qg="$(cat "$QG_YML")"

  # Materialize the comment-stripped text ONCE, then match with single greps
  # against here-strings. Chaining the strip into `grep -q` false-PASSES under
  # pipefail: the reader exits at the first (early) match, the strip stage takes
  # SIGPIPE, the pipeline goes non-zero, and the `if` falls through to the pass
  # branch — reporting a wired bypass as absent. Fail closed if the strip
  # produced nothing: an empty result means these assertions cannot see the file.
  qg_exec="$(grep -v '^[[:space:]]*#' <<<"$qg" || true)"
  if [ -z "$qg_exec" ]; then
    fail "comment-strip of quality-gates.yml produced no output — self-defense assertions cannot be verified"
  fi
  assert_job_key_lines "$qg_exec" "quality-gates.yml" "  lint:
  typecheck:
  test-web:
  coverage-ratchet:
  test-mcp:
  build-wasm:
  editor-boot:
  security:
  lighthouse-delta:
  storybook-internal-gate:
  chromatic:"

  # Top of the duplicate-key hierarchy: the top-level jobs: key itself is
  # COUNT-pinned. An appended second jobs: mapping at end of file replaces
  # EVERY job under YAML last-key-wins; if the replacement re-declares the
  # jobs it wants (renamed or gutted), each job-key pin below still reads
  # the dead first mapping and stays green. A "collapses every job so it
  # fails closed on its own" argument was tested and rejected: it only
  # holds if the replacement OMITS a required/deploy job, and what the
  # replacement contains is the attacker's choice, not a property of YAML.
  # Same pin on cd.yml and ci.yml below.
  qg_jobs_count="$(grep -cE "^[\"']?jobs[\"']?[[:space:]]*:" <<<"$qg_exec" || true)"
  if [ "$qg_jobs_count" -ne 1 ]; then
    fail "quality-gates.yml has $qg_jobs_count top-level jobs: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended second jobs: mapping replaces every job in the workflow while all job-key pins below read the dead first mapping)"
  else
    pass "quality-gates.yml has exactly 1 top-level jobs: key"
  fi

  # Job-scope every invocation assertion: cut the `security` job block (same
  # awk anchor idiom as the lockfile-sync-tests extraction below — 2-space
  # keys are job ids, which no comment or step line can match; the terminator
  # charset covers the full job-id alphabet incl. digits/underscores, else a
  # following job renamed to e.g. `lh2-delta` would extend the cut and weaken
  # relocation detection). A FILE-scoped grep cannot tell "the security job
  # runs the gate" from "the invocation was relocated into an unrelated job"
  # (e.g. lighthouse-delta) — the required 'Rust Security Audit' check would
  # then go green without ever auditing.
  # The JOB key itself is COUNT-pinned first — the level above every pin
  # below. The block cut anchors on the FIRST `^  security:` match, so an
  # appended second security: job at end of file replaces the whole job
  # under YAML last-key-wins while every pin below keeps reading the dead
  # first block, and the job reports SUCCESS under the original display
  # name (actionlint would flag the duplicate job key, but it is not wired
  # into this repo's CI). The level above THIS — a duplicated top-level
  # jobs: key — is count-pinned above rather than argued away: the
  # rationale (and why "fails closed on its own" was rejected) lives at
  # that pin.
  qg_sec_job_count="$(grep -cE "^  [\"']?security[\"']?[[:space:]]*:" <<<"$qg_exec" || true)"
  if [ "$qg_sec_job_count" -ne 1 ]; then
    fail "quality-gates defines the security job $qg_sec_job_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second security: job replaces the whole job while the block cut below only ever sees the first)"
  else
    pass "quality-gates defines the security job exactly once"
  fi

  # Fail closed on an empty cut: nothing below may pass vacuously.
  qg_sec="$(awk -v re="$job_key_re" '/^  security:/{f=1} f{print} f && $0 ~ re && !/^  security:/{exit}' <<<"$qg_exec")"
  if [ -z "$qg_sec" ]; then
    fail "security job block is empty after comment-strip — job missing, renamed, or fully commented out"
  fi

  # The job's steps: key is COUNT-pinned: YAML keeps the last duplicate key,
  # so a second `steps:` appended at the end of the job replaces the ENTIRE
  # step list — all three npm audits plus the cargo audit — while the job
  # still exits 0 and reports SUCCESS (not skipped, so the CI Success
  # anti-tamper never fires). The step-scoped assertions below are textual
  # and cannot tell which steps: key owns the steps they match; with exactly
  # one steps: key, the scanned steps ARE the effective steps. Same
  # duplicate-key class as the run:/if:/needs: count pins.
  qg_sec_steps_count="$(grep -cE "^    [\"']?steps[\"']?[[:space:]]*:" <<<"$qg_sec" || true)"
  if [ "$qg_sec_steps_count" -ne 1 ]; then
    fail "quality-gates security job has $qg_sec_steps_count job-level steps: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so a second steps: silently replaces every audit step while the job still reports success)"
  else
    pass "quality-gates security job has exactly 1 job-level steps: key"
  fi

  # The required security job must keep its display name (the required-check
  # surface) — asserted inside the job block on an executable line, so neither
  # a commented-out `# name:` nor the same name on a different job satisfies it.
  if grep -qE '^    name: Rust Security Audit' <<<"$qg_sec"; then
    pass "security job keeps the 'Rust Security Audit' display name (required check name stable)"
  else
    fail "the security job's 'Rust Security Audit' name changed — required-check wiring may break"
  fi

  # A job-level `if:` would skip the security job wholesale — and a skipped
  # required check reads as satisfied under branch protection, so this is the
  # one-line edit that unwires all three npm audits AND the cargo audit at
  # once. The job carries no `if:` today; pin that. (4-space indent = job-level
  # key; step-level `if:` is covered per step block below. The
  # `["']?if["']?[[:space:]]*:` shape is the suite-wide key-matching class —
  # YAML accepts a space before the colon AND either quote style, so
  # `if : false`, `"if": false` and `'if': false` are all the same key as
  # `if:`. Rationale + the escape-spelling residual: see the note at
  # assert_audit_steps_untampered above.)
  if grep -qE "^    [\"']?if[\"']?[[:space:]]*:" <<<"$qg_sec"; then
    fail "quality-gates security job carries a job-level if: — the required check could be skipped wholesale"
  else
    pass "quality-gates security job has no job-level if: (cannot be skipped wholesale)"
  fi

  # A job-level `continue-on-error:` has the identical blast radius through the
  # other door: every audit inside the job can fail while the job still reports
  # success, so the required check goes green and cd.yml's deploy jobs (which
  # `needs: security`) proceed past a red gate. The step-scoped scan below only
  # sees step blocks — a 4-space job key never enters one. Pin absence here.
  if grep -qE "^    [\"']?continue-on-error[\"']?[[:space:]]*:" <<<"$qg_sec"; then
    fail "quality-gates security job carries a job-level continue-on-error — a failing gate would report success"
  else
    pass "quality-gates security job has no job-level continue-on-error"
  fi

  # A job-level `needs:` is the third door: the security job has none today
  # and must stay that way — `editor-boot` (and others) carry conditional
  # `if:`s, so `needs: [editor-boot]` would cascade-SKIP the security job on
  # any run where the dependency skips, and a skipped required check reads as
  # satisfied under branch protection. Pin absence, mirroring the if: pin.
  if grep -qE "^    [\"']?needs[\"']?[[:space:]]*:" <<<"$qg_sec"; then
    fail "quality-gates security job carries a job-level needs: — a skipped dependency would cascade-skip the audit, and a skipped required check reads as satisfied"
  else
    pass "quality-gates security job has no job-level needs: (cannot be cascade-skipped via a conditional dependency)"
  fi

  # The job must invoke the gate for BOTH workspaces — asserted against the
  # comment-stripped SECURITY JOB block, key-anchored to the WHOLE run: line.
  # A raw-text grep cannot tell "the gate runs" from "the gate is commented
  # out" (a `# ` prefix is a two-character unwire), and an UNANCHORED
  # executable-line grep is still satisfied by a trailing-comment neuter —
  # `run: true # bash scripts/check-npm-audit.sh web` executes `true` while
  # the needle matches inside the YAML comment, which line-level stripping
  # cannot remove. Anchoring `^[[:space:]]*run: ...$` closes that (and fails
  # closed if the step is refactored to a block scalar — flag, don't guess).
  if grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh web[[:space:]]*$' <<<"$qg_sec"; then
    pass "security job runs the allowlist gate for web (whole run: line, in-job)"
  else
    fail "security job does not run scripts/check-npm-audit.sh web as a whole run: line of its own block"
  fi
  if grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh mcp-server[[:space:]]*$' <<<"$qg_sec"; then
    pass "security job runs the allowlist gate for mcp-server (whole run: line, in-job)"
  else
    fail "security job does not run scripts/check-npm-audit.sh mcp-server as a whole run: line of its own block"
  fi
  # PF-1010 / #9029: npm audit scopes advisories to the INVOKING workspace's
  # dependency subtree — the web and mcp-server runs never evaluate the ROOT
  # workspace's own devDeps, nor the packages/* and apps/* workspaces. The job
  # must ALSO invoke the gate for the repo root. End-anchored -E match: a -F
  # substring needle ending in `.` would also be satisfied by a `.something`
  # path argument.
  if grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh \.[[:space:]]*$' <<<"$qg_sec"; then
    pass "security job runs the allowlist gate for the root workspace (.) (whole run: line, in-job)"
  else
    fail "security job does not run scripts/check-npm-audit.sh . (root workspace) in any executable line of its own block — root devDeps and packages*/apps* go unaudited"
  fi

  # The raw, un-allowlisted gate must be FULLY replaced — if a stray
  # `npm audit --audit-level=high` survives it will fail on the un-relockable
  # brace-expansion advisory (GHSA-mh99-v99m-4gvg, the gate's sole live
  # waiver) and re-wedge the pipeline. Comments are stripped: the gate's own
  # rationale comment legitimately names the old command in prose, and only
  # an EXECUTABLE occurrence re-wedges the pipeline.
  if grep -qF 'npm audit --audit-level=high' <<<"$qg_exec"; then
    fail "a raw 'npm audit --audit-level=high' still exists in an executable line — it will fail on the un-relockable brace-expansion advisory"
  else
    pass "no raw 'npm audit --audit-level=high' remains in an executable line (fully replaced by the gate)"
  fi

  # SECURITY: the $NPM_AUDIT_CMD test seam must NEVER be wired into the real job —
  # `env: NPM_AUDIT_CMD: true` would make the gate audit nothing and pass blindly.
  # Comments are stripped (the rationale comment may name it); assert no
  # executable line references it.
  if grep -q 'NPM_AUDIT_CMD' <<<"$qg_exec"; then
    fail "quality-gates wires the NPM_AUDIT_CMD test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "quality-gates does not wire the NPM_AUDIT_CMD test seam (gate cannot be bypassed via job env)"
  fi

  # SECURITY: step-scoped tamper checks. `if:` and `continue-on-error:` are
  # asserted absent across each gate step's WHOLE key block, not a fixed grep
  # window: a continue-on-error separated from the run: line by a multi-line
  # env: block escapes a -B3/-A1 window, and a step-level `if: false` (step
  # skipped, run: line still greps as present) sits outside any run:-anchored
  # window entirely. Unrelated continue-on-error elsewhere in the file (there
  # are several legitimate ones) cannot false-positive a per-step scan.
  assert_audit_steps_untampered "quality-gates" "$qg_sec"
else
  fail "quality-gates.yml not found at $QG_YML"
fi

echo ""
echo "=== cd.yml integration wiring ==="
# The deploy pipeline's security step mirrors quality-gates and is subject to the
# same un-relockable-advisory wedge — pin the gate here too so a future revert to
# a raw audit silently re-wedges CD instead of slipping through.
if [ -f "$CD_YML" ]; then
  cd_yml="$(cat "$CD_YML")"
  # Same materialize-then-match discipline as the quality-gates block above:
  # chaining the comment-strip into `grep -q` false-PASSES under pipefail on an
  # early match (SIGPIPE), so a wired bypass would be reported as absent.
  cd_exec="$(grep -v '^[[:space:]]*#' <<<"$cd_yml" || true)"
  if [ -z "$cd_exec" ]; then
    fail "comment-strip of cd.yml produced no output — self-defense assertions cannot be verified"
  fi
  assert_job_key_lines "$cd_exec" "cd.yml" "  rollback-production-manual:
  lint:
  typecheck:
  test-web:
  test-mcp:
  check-changes:
  build-wasm:
  e2e:
  security:
  upload-wasm-cdn:
  deploy-staging:
  deploy-production:
  deploy-docs:
  deploy-design:"

  # Same top-level jobs: key count pin as quality-gates (rationale there) —
  # on cd.yml a duplicate jobs: mapping that re-declares its own deploy jobs
  # replaces the entire pipeline, gating included, while every job-key pin
  # below reads the dead first mapping.
  cd_jobs_count="$(grep -cE "^[\"']?jobs[\"']?[[:space:]]*:" <<<"$cd_exec" || true)"
  if [ "$cd_jobs_count" -ne 1 ]; then
    fail "cd.yml has $cd_jobs_count top-level jobs: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended second jobs: mapping replaces every job in the workflow while all job-key pins below read the dead first mapping)"
  else
    pass "cd.yml has exactly 1 top-level jobs: key"
  fi

  # Job-scope the cd.yml assertions too — same relocation blind spot as
  # quality-gates: a file-scoped grep is satisfied by the invocation living in
  # ANY job (e.g. deploy-docs), not the security job that must gate the deploy.
  # Same JOB-key count pin as quality-gates (rationale there) — on cd.yml a
  # replaced security job additionally makes needs.security.result ==
  # 'success' genuinely TRUE, so every deploy-side clause pin passes on its
  # own terms while both deploys proceed unaudited.
  cd_sec_job_count="$(grep -cE "^  [\"']?security[\"']?[[:space:]]*:" <<<"$cd_exec" || true)"
  if [ "$cd_sec_job_count" -ne 1 ]; then
    fail "cd.yml defines the security job $cd_sec_job_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second security: job replaces the whole job and makes needs.security.result == 'success' genuinely true for both deploys, while the block cut below only ever sees the first)"
  else
    pass "cd.yml defines the security job exactly once"
  fi

  cd_sec="$(awk -v re="$job_key_re" '/^  security:/{f=1} f{print} f && $0 ~ re && !/^  security:/{exit}' <<<"$cd_exec")"
  if [ -z "$cd_sec" ]; then
    fail "cd.yml security job block is empty after comment-strip — job missing, renamed, or fully commented out"
  fi

  # Same steps: count pin as quality-gates (rationale there) — on cd.yml a
  # replaced step list additionally makes needs.security.result == 'success'
  # genuinely TRUE, so every deploy-side clause pin passes on its own terms
  # while both deploys proceed unaudited.
  cd_sec_steps_count="$(grep -cE "^    [\"']?steps[\"']?[[:space:]]*:" <<<"$cd_sec" || true)"
  if [ "$cd_sec_steps_count" -ne 1 ]; then
    fail "cd.yml security job has $cd_sec_steps_count job-level steps: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so a second steps: silently replaces every audit step while the job still reports success and both deploys proceed)"
  else
    pass "cd.yml security job has exactly 1 job-level steps: key"
  fi

  # cd.yml's security job legitimately carries a job-level `if:` (main +
  # workflow_dispatch only) — so unlike quality-gates, absence cannot be
  # pinned. Pin its INTENT instead: exactly ONE job-level if: line (YAML keeps
  # the LAST duplicate key, so a second `if : false` appended after the
  # legitimate condition would win while a containment-only grep still saw the
  # original), and that line must still reference refs/heads/main. Mutating it
  # to `if: false` (or dropping the ref check) is the cd-side analogue of
  # skipping the job wholesale. Containment, not equality — this raises the
  # cost of a silent one-line disable; it does not claim to be airtight
  # against a crafted compound condition.
  cd_if_lines="$(grep -cE "^    [\"']?if[\"']?[[:space:]]*:" <<<"$cd_sec" || true)"
  # The containment must run on a TRAILING-comment-stripped copy of the
  # condition line: `if: false # refs/heads/main` keeps the needle alive
  # inside a YAML comment (whitespace-then-#), which the line-level strip
  # above cannot remove — and a skipped security job still deploys: deploy-
  # staging's if: accepts `needs.security.result == 'skipped'`, and deploy-
  # production inherits that exposure on the push path (its push branch gates
  # only on deploy-staging's success; only the workflow_dispatch promote
  # branch requires `security == 'success'` strictly), making this one line
  # a deploy-through, not a deploy-block.
  # Two materialized steps (no here-string-fed chain into grep); an over-
  # truncated legitimate quoted `#` turns the pin red, never green.
  cd_if_line="$(grep -E "^    [\"']?if[\"']?[[:space:]]*:" <<<"$cd_sec" || true)"
  cd_if_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$cd_if_line")"
  if [ "$cd_if_lines" -ne 1 ]; then
    fail "cd.yml security job has $cd_if_lines job-level if: lines (expected exactly 1) — missing or duplicated condition (YAML keeps the last duplicate key)"
  elif grep -qE "^    [\"']?if[\"']?[[:space:]]*:.*refs/heads/main" <<<"$cd_if_scan"; then
    pass "cd.yml security job-level if: still gates on refs/heads/main (exactly one condition line)"
  else
    fail "cd.yml security job-level if: no longer references refs/heads/main — condition removed or rewritten (deploy audits may be disabled)"
  fi

  # Job-level continue-on-error — same blast radius as on quality-gates: the
  # deploy jobs' `needs: security` would see success on a red gate.
  if grep -qE "^    [\"']?continue-on-error[\"']?[[:space:]]*:" <<<"$cd_sec"; then
    fail "cd.yml security job carries a job-level continue-on-error — deploys would proceed past a failing gate"
  else
    pass "cd.yml security job has no job-level continue-on-error"
  fi

  # A job-level `needs:` on THIS job is a deploy-through: a skipped
  # dependency (e.g. build-wasm, which skips on any main push that doesn't
  # touch the engine) cascade-skips the audit — the job's if: has no
  # always() to rescue it — and deploy-staging's if: accepts
  # `needs.security.result == 'skipped'`, with deploy-production inheriting
  # that exposure on the push path. Pin absence, mirroring the
  # quality-gates pin.
  if grep -qE "^    [\"']?needs[\"']?[[:space:]]*:" <<<"$cd_sec"; then
    fail "cd.yml security job carries a job-level needs: — a skipped dependency would cascade-skip the audit, and deploy-staging's if: accepts needs.security.result == 'skipped', so deploys would proceed with no audit having run"
  else
    pass "cd.yml security job has no job-level needs: (cannot be cascade-skipped into a deploy-through)"
  fi

  # The `needs:` edge: `security` in deploy-staging's and deploy-production's
  # needs: lists is what makes `needs.security` RESOLVABLE in their if:
  # bodies — necessary but NOT sufficient. Both deploy if: blocks start
  # `always() &&`, and under always() a FAILED dependency does not skip the
  # dependent job, so needs: membership alone blocks nothing; the explicit
  # `needs.security.result == 'success'` clause in each if: body (pinned
  # below) is what actually stops a deploy on a red audit. Dropping
  # `security` from a needs: list fails SAFE today (the clause becomes
  # unresolvable-false and the deploy skips loudly) but is still tampering
  # with the wiring this suite exists to pin. (The if:-count/containment
  # pins above — which keep the security job itself un-skippable — stay
  # load-bearing too: deploy-staging's if: accepts
  # `needs.security.result == 'skipped'`, and deploy-production inherits that
  # exposure on the push path — its push branch gates only on deploy-staging's
  # success, with a strict `security == 'success'` check only in the
  # workflow_dispatch promote branch. deploy-docs/deploy-design carry no
  # audit gating at all: pre-existing gap, tracked in PF-1011/#9030.)
  # Cut each deploy job's block (same awk anchor idiom), assert exactly ONE
  # needs: line (YAML keeps the last duplicate key), and assert `security`
  # appears as a flow-list ELEMENT on a trailing-comment-stripped copy of
  # that line — `(\[|,) security (,|\])` bounds it so a look-alike like
  # `security-scan` cannot satisfy it, and the strip (whitespace OPTIONAL
  # before `#` — in YAML flow context `]#` still opens a comment, so the
  # no-space form must not walk past it) stops a smuggled `# [security]`
  # from satisfying it. The element grep intentionally fails on a
  # block-style rewrite: flag it and keep the flow list rather than guess
  # at a new shape. Then pin the success clause itself on a
  # comment-stripped copy of the WHOLE job block.
  for cd_dj in deploy-staging deploy-production; do
    # Same JOB-key count pin as the security jobs (rationale at the
    # quality-gates security pin) — the cut below stops at the first
    # following job key, so it only ever sees the FIRST definition. An
    # appended duplicate deploy job at end of file is the effective one
    # under last-key-wins and deploys with NONE of the gating pinned
    # below (no needs:, no success clause), while the Actions UI still
    # shows a job under the same key — nothing looks missing, and cd.yml
    # runs on push to main so no required-check absence backstops it.
    cd_dj_job_count="$(grep -cE "^  [\"']?${cd_dj}[\"']?[[:space:]]*:" <<<"$cd_exec" || true)"
    if [ "$cd_dj_job_count" -ne 1 ]; then
      fail "cd.yml defines the ${cd_dj} job $cd_dj_job_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second ${cd_dj}: job deploys with none of the gating this suite pins while the block cut below only ever sees the first)"
    else
      pass "cd.yml defines the ${cd_dj} job exactly once"
    fi
    cd_dj_block="$(awk -v hdr="  ${cd_dj}:" -v re="$job_key_re" '$0 == hdr {f=1} f{print} f && $0 ~ re && $0 != hdr {exit}' <<<"$cd_exec")"
    if [ -z "$cd_dj_block" ]; then
      fail "cd.yml ${cd_dj} job block is empty after comment-strip — job missing, renamed, or fully commented out (deploy gating cannot be verified)"
      continue
    fi
    cd_dj_needs_count="$(grep -cE "^    [\"']?needs[\"']?[[:space:]]*:" <<<"$cd_dj_block" || true)"
    cd_dj_needs_line="$(grep -E "^    [\"']?needs[\"']?[[:space:]]*:" <<<"$cd_dj_block" || true)"
    cd_dj_needs_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$cd_dj_needs_line")"
    if [ "$cd_dj_needs_count" -ne 1 ]; then
      fail "cd.yml ${cd_dj} job has $cd_dj_needs_count job-level needs: lines (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key)"
    elif grep -qE '(\[|,)[[:space:]]*security[[:space:]]*(,|\])' <<<"$cd_dj_needs_scan"; then
      pass "cd.yml ${cd_dj} needs: still lists security as a flow-list element (keeps needs.security resolvable for the if: clause)"
    else
      fail "cd.yml ${cd_dj} needs: no longer lists security as a flow-list element — the if: clause's needs.security.result becomes unresolvable (deploy gating rewired; fails safe today, but the wiring this suite pins is tampered)"
    fi
    # The load-bearing half of the edge (see comment above): the explicit
    # success clause in the if: body. Containment on a comment-stripped copy
    # of the job-level if: BLOCK ONLY — cut from the if: key through the next
    # job-level key so multi-line expression continuations are included. NOT
    # the whole job block: a needle occurrence anywhere else in the job (an
    # env: value, a step name, a run: echo) has no gating effect and must not
    # satisfy this pin, or deleting the real clause goes green the moment any
    # innocent mention of it exists. deploy-staging carries the clause
    # directly (alongside its skipped-acceptance), deploy-production in its
    # workflow_dispatch promote branch. Deleting the clause leaves needs:
    # intact and the workflow valid while a red audit no longer stops the
    # deploy — the exact one-line unaudited-deploy shape this pin exists to
    # catch. A missing if: block entirely yields an empty scan and FAILs
    # (fail-closed). The if: key is COUNT-pinned first: YAML keeps the last
    # duplicate key, so an appended second `if: always()` overrides the
    # clause at runtime while the containment match below still passes — a
    # duplicate if: line re-matches the cut's start pattern (its rule ends
    # in `next`, so it never hits the exit rule), meaning EVERY if: block
    # concatenates into one scan and the pin cannot tell which key is
    # effective. Count first closes that: with exactly one if: key, the
    # scanned body IS the effective body. Same duplicate-key class already
    # pinned on the cd security job's if: and these jobs' needs:.
    # Scope note: the containment pin proves the clause
    # is PRESENT in the if: body, not that it is EFFECTIVE — a vacuous
    # rewrite like `(needs.security.result == 'success' || true)` still
    # passes; resisting that would require parsing GitHub Actions
    # expressions, which is out of scope for containment pins (same register
    # as the anti-tamper caveats in gotchas.md: raises cost, doesn't claim
    # to be airtight).
    cd_dj_if_count="$(grep -cE "^    [\"']?if[\"']?[[:space:]]*:" <<<"$cd_dj_block" || true)"
    cd_dj_ifblk="$(awk "/^    [\"']?if[\"']?[[:space:]]*:/{f=1;print;next} f && /^    [A-Za-z_\"']/{exit} f{print}" <<<"$cd_dj_block")"
    cd_dj_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$cd_dj_ifblk")"
    if [ "$cd_dj_if_count" -ne 1 ]; then
      fail "cd.yml ${cd_dj} job has $cd_dj_if_count job-level if: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so a second if: overrides the needs.security.result clause at runtime while the original block still matches)"
    elif grep -qE "needs\.security\.result[[:space:]]*==[[:space:]]*'success'" <<<"$cd_dj_scan"; then
      pass "cd.yml ${cd_dj} if: still requires needs.security.result == 'success' — the clause that stops this deploy on a red audit (exactly 1 if: key)"
    else
      fail "cd.yml ${cd_dj} if: no longer contains needs.security.result == 'success' — under always(), needs: membership alone blocks nothing, so a red audit would not stop this deploy"
    fi
  done

  # Invocations asserted against the comment-stripped SECURITY JOB block,
  # key-anchored to the whole run: line — a commented-out run: still satisfies
  # a raw-text grep, a relocated one satisfies a file-scoped grep, and a
  # trailing-comment neuter (`run: true # bash ...`) satisfies any unanchored
  # substring match (see the quality-gates block).
  if grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh web[[:space:]]*$' <<<"$cd_sec" \
     && grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh mcp-server[[:space:]]*$' <<<"$cd_sec"; then
    pass "cd.yml security job runs the allowlist gate for both workspaces (whole run: lines, in-job)"
  else
    fail "cd.yml security job does not run scripts/check-npm-audit.sh for both workspaces as whole run: lines of its own block"
  fi
  # Root-workspace invocation, mirroring the quality-gates assertion above —
  # cd.yml is editable independently, so it needs its own pin (PF-1010 / #9029).
  if grep -qE '^[[:space:]]*run: bash scripts/check-npm-audit\.sh \.[[:space:]]*$' <<<"$cd_sec"; then
    pass "cd.yml security job runs the allowlist gate for the root workspace (.) (whole run: line, in-job)"
  else
    fail "cd.yml security job does not run scripts/check-npm-audit.sh . (root workspace) in any executable line of its own block"
  fi

  if grep -qF 'npm audit --audit-level=high' <<<"$cd_exec"; then
    fail "cd.yml still has a raw 'npm audit --audit-level=high' in an executable line — it will wedge the deploy pipeline"
  else
    pass "cd.yml has no raw 'npm audit --audit-level=high' in an executable line"
  fi

  # SECURITY: same seam guard as quality-gates — `env: NPM_AUDIT_CMD: <clean json>`
  # on the CD step would no-op the audit into a blind pass. cd.yml is editable
  # independently of quality-gates, so it needs its own assertion (the deploy
  # pipeline's audit is the last gate before artifacts ship).
  if grep -q 'NPM_AUDIT_CMD' <<<"$cd_exec"; then
    fail "cd.yml wires the NPM_AUDIT_CMD test seam in an executable line — CD audit can be no-op'd into a false pass"
  else
    pass "cd.yml does not wire the NPM_AUDIT_CMD test seam"
  fi

  # SECURITY: step-scoped tamper checks, mirroring the quality-gates block —
  # whole-step-block scan for `if:` and `continue-on-error:`, closing the
  # env:-block window evasion and the never-checked step-level `if:` for the
  # deploy pipeline's audits too.
  assert_audit_steps_untampered "cd.yml" "$cd_sec"
else
  fail "cd.yml not found at $CD_YML"
fi

echo ""
echo "=== ci.yml self-defense wiring ==="
# The gate's own decision logic must be unit-tested by a REQUIRED check. The CI
# Self-Defense Tests job (id lockfile-sync-tests) rides ci-success; pin that it
# lints this script + suite (shellcheck) and runs the suite, so a PR that neuters
# the gate fails a required check.
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"
  # Same comment-strip discipline as the qg/cd blocks above: cut the job block
  # from EXECUTABLE lines only, else `# `-prefixing the shellcheck line or the
  # suite invocation inside lockfile-sync-tests satisfies both raw-text greps
  # while the self-defense job silently stops covering this gate. The awk job
  # anchors match `^  <job>:` lines, which no comment line can, so stripping
  # cannot change which block is cut. Fail closed on an empty strip or an
  # empty block: neither assertion below may pass vacuously.
  ci_exec="$(grep -v '^[[:space:]]*#' <<<"$ci" || true)"
  if [ -z "$ci_exec" ]; then
    fail "comment-strip of ci.yml produced no output — self-defense assertions cannot be verified"
  fi
  assert_job_key_lines "$ci_exec" "ci.yml" "  ci-gate:
  quality-gates:
  command-parity:
  build-nextjs:
  docs-internal-gate:
  design-internal-gate:
  hook-tests:
  skills-lint:
  lockfile-sync:
  openapi-route-sync:
  agentic-sync:
  taskboard-onboarding-guard:
  codex-config-guard:
  ghaw-lock-sync:
  actions-pin-check:
  lockfile-sync-tests:
  preview-deploy:
  test-e2e-ui:
  test-e2e-journey:
  test-e2e-engine-smoke:
  merge-e2e-reports:
  ci-success:"

  # Same top-level jobs: key count pin as quality-gates (rationale there).
  ci_jobs_count="$(grep -cE "^[\"']?jobs[\"']?[[:space:]]*:" <<<"$ci_exec" || true)"
  if [ "$ci_jobs_count" -ne 1 ]; then
    fail "ci.yml has $ci_jobs_count top-level jobs: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended second jobs: mapping replaces every job in the workflow while all job-key pins below read the dead first mapping)"
  else
    pass "ci.yml has exactly 1 top-level jobs: key"
  fi

  # Every pin above covers the INSIDE of the gating job; this one pins that the
  # workflow CONTAINING it is still invoked. quality-gates.yml is
  # `workflow_call`-only and is called from exactly one place — ci.yml's
  # `quality-gates:` job. cd.yml does not run on `pull_request` at all and its
  # security job is gated to main-push/workflow_dispatch, so on the PR path
  # that caller is the SOLE execution site for all three npm audits (including
  # the root invocation this suite pins) plus the cargo audit. Two one-line
  # unwires left every other pin in this suite green:
  #   (a) `if: false` on the caller — the job still EXISTS, so ci-success's
  #       `needs:` list still resolves (there is no dangling-needs backstop)
  #       and the job is merely SKIPPED. That skip USED to be certified green
  #       (check-ci-success.sh fails only on failure/cancelled); it is now also
  #       caught externally by the `check_triggered "quality-gates"
  #       "needs-any-code"` map entry added in the same round as this comment.
  #       Both layers are kept deliberately: the map entry lives in a different
  #       file, and this pin is what still catches the `if: false` mutation if
  #       that entry is ever dropped. Note the narrower claim — dropping the map
  #       entry ALONE leaves this suite green (nothing has been unwired yet, the
  #       caller still runs); what this pin guarantees is that the mutation the
  #       entry was added for cannot then land unseen.
  #   (b) `uses:` repointed away from quality-gates.yml — the file stays on
  #       disk with every pin intact and audits nothing.
  # Deleting the caller job outright is caught by the JOB-key count pin below.
  # It is NOT caught by "ci-success still lists it in `needs:`, so deletion is a
  # workflow validation error" — that reasoning was WRONG, and it is exactly the
  # sentence a future reviewer would have relied on to skip a pin. The
  # membership is itself one deletable list item: dropping `- quality-gates`
  # from ci-success's `needs:` leaves the workflow valid, leaves no dangling
  # reference, leaves the caller running, and stops the required aggregate from
  # ever observing the audit. That membership is now pinned explicitly below.
  # Same count-plus-containment shape as the cd.yml deploy clause: JOB key
  # count-pinned, `uses:` target pinned, and exactly ONE if: whose trailing-
  # comment-stripped body still references the ci-gate output that legitimately
  # gates it. Containment, not equality — same raises-cost-not-airtight register.
  qg_caller_count="$(grep -cE "^  [\"']?quality-gates[\"']?[[:space:]]*:" <<<"$ci_exec" || true)"
  if [ "$qg_caller_count" -ne 1 ]; then
    fail "ci.yml defines the quality-gates caller job $qg_caller_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second quality-gates: job replaces the sole PR-path execution site of all three npm audits while the block cut below only ever sees the first)"
  else
    pass "ci.yml defines the quality-gates caller job exactly once"
  fi

  qg_caller_block="$(awk -v re="$job_key_re" '/^  quality-gates:/{f=1} f{print} f && $0 ~ re && !/^  quality-gates:/{exit}' <<<"$ci_exec")"
  if [ -z "$qg_caller_block" ]; then
    fail "ci.yml quality-gates caller job block is empty after comment-strip — the sole PR-path invocation of quality-gates.yml is missing or fully commented out"
  fi

  # Two materialized steps per pin (never a here-string-fed pipeline into
  # grep -q: SIGPIPE under pipefail would read as a false PASS).
  qg_caller_uses_count="$(grep -cE "^    [\"']?uses[\"']?[[:space:]]*:" <<<"$qg_caller_block" || true)"
  qg_caller_uses_line="$(grep -E "^    [\"']?uses[\"']?[[:space:]]*:" <<<"$qg_caller_block" || true)"
  qg_caller_uses_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$qg_caller_uses_line")"
  if [ "$qg_caller_uses_count" -ne 1 ]; then
    fail "ci.yml quality-gates caller has $qg_caller_uses_count uses: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so a second uses: repoints the call while a containment-only grep still sees the original)"
  elif grep -qE "^    [\"']?uses[\"']?[[:space:]]*:[[:space:]]*[\"']?\./\.github/workflows/quality-gates\.yml[\"']?[[:space:]]*$" <<<"$qg_caller_uses_scan"; then
    pass "ci.yml quality-gates caller still invokes ./.github/workflows/quality-gates.yml"
  else
    fail "ci.yml quality-gates caller does not invoke ./.github/workflows/quality-gates.yml — repointing uses: leaves quality-gates.yml on disk with every pin intact while no npm audit runs on the PR path"
  fi

  qg_caller_if_count="$(grep -cE "^    [\"']?if[\"']?[[:space:]]*:" <<<"$qg_caller_block" || true)"
  qg_caller_if_line="$(grep -E "^    [\"']?if[\"']?[[:space:]]*:" <<<"$qg_caller_block" || true)"
  qg_caller_if_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$qg_caller_if_line")"
  if [ "$qg_caller_if_count" -ne 1 ]; then
    fail "ci.yml quality-gates caller has $qg_caller_if_count job-level if: lines (expected exactly 1) — missing or duplicated condition (YAML keeps the last duplicate key, so an appended 'if: false' wins while a containment-only grep still sees the original)"
  elif grep -q 'needs-any-code' <<<"$qg_caller_if_scan"; then
    pass "ci.yml quality-gates caller if: still gates on the ci-gate needs-any-code output"
  else
    fail "ci.yml quality-gates caller if: no longer gates on needs-any-code — the trigger named here is the one check-ci-success.sh maps quality-gates to, so degating it both stops every npm audit on the PR path and desynchronizes the anti-tamper arm that catches the resulting skip"
  fi

  # ci-success's `needs:` MEMBERSHIP. Everything above pins that the caller job
  # exists, invokes the right workflow, and is gated on the right trigger — none
  # of it pins that the required aggregate still WAITS for it. Deleting the one
  # line `- quality-gates` from ci-success's `needs:` is valid YAML with no
  # dangling reference: the caller keeps running, and the required "CI Success"
  # check stops aggregating it, so a red audit (including the root-workspace
  # invocation this suite exists for) no longer blocks the merge. Same property
  # the cd.yml deploy pins enforce for `security` one workflow over; this is the
  # ci.yml side of it, and the PR path is the only path where the root audit runs
  # at all (cd.yml does not run on `pull_request`).
  # Externally, check-ci-success.sh's `check_triggered "quality-gates"
  # "needs-any-code"` entry also catches the drop (an absent job resolves to
  # result="absent", which the map flags as tamper). This pin is what keeps that
  # entry honest from inside the suite.
  cs_job_count="$(grep -cE "^  [\"']?ci-success[\"']?[[:space:]]*:" <<<"$ci_exec" || true)"
  if [ "$cs_job_count" -ne 1 ]; then
    fail "ci.yml defines the ci-success job $cs_job_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second ci-success: job replaces the required aggregate wholesale while the block cut below only ever sees the first)"
  else
    pass "ci.yml defines the ci-success job exactly once"
  fi

  ci_success_block="$(awk -v re="$job_key_re" '/^  ci-success:/{f=1} f{print} f && $0 ~ re && !/^  ci-success:/{exit}' <<<"$ci_exec")"
  if [ -z "$ci_success_block" ]; then
    fail "ci.yml ci-success job block is empty after comment-strip — the required aggregate is missing or fully commented out"
  fi

  # Count-pin `needs:` first: a duplicate needs: key replaces the ENTIRE list
  # under last-key-wins, so a containment grep against the dead first block
  # would still find quality-gates while the effective aggregate waits for
  # nothing. Same ordering rationale as every count-first fold in this suite.
  cs_needs_count="$(grep -cE "^    [\"']?needs[\"']?[[:space:]]*:" <<<"$ci_success_block" || true)"
  cs_needs_block="$(awk "/^    [\"']?needs[\"']?[[:space:]]*:/{f=1;print;next} f && /^    [A-Za-z_\"']/{exit} f{print}" <<<"$ci_success_block")"
  cs_needs_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$cs_needs_block")"
  if [ "$cs_needs_count" -ne 1 ]; then
    fail "ci.yml ci-success has $cs_needs_count needs: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended second needs: replaces the whole aggregate list while a containment-only grep still sees the original)"
  elif grep -qE "^      -[[:space:]]+[\"']?quality-gates[\"']?[[:space:]]*$" <<<"$cs_needs_scan"; then
    pass "ci.yml ci-success still lists quality-gates in its needs: aggregate"
  else
    fail "ci.yml ci-success no longer lists quality-gates in its needs: — the required CI Success check stops waiting on and aggregating the workflow that runs all three npm audits, so a red audit leaves the required check green (one-line list-item deletion, valid YAML, no dangling reference)"
  fi

  # Same JOB-key count pin (rationale at the quality-gates security pin) —
  # an appended second lockfile-sync-tests: job replaces this suite's own
  # CI execution wholesale while the check reports SUCCESS under the
  # original display name.
  lst_job_count="$(grep -cE "^  [\"']?lockfile-sync-tests[\"']?[[:space:]]*:" <<<"$ci_exec" || true)"
  if [ "$lst_job_count" -ne 1 ]; then
    fail "ci.yml defines the lockfile-sync-tests job $lst_job_count times (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate JOB key, so an appended second lockfile-sync-tests: job replaces this suite's own CI execution while the block cut below only ever sees the first)"
  else
    pass "ci.yml defines the lockfile-sync-tests job exactly once"
  fi

  lst_block="$(awk -v re="$job_key_re" '/^  lockfile-sync-tests:/{f=1} f{print} f && $0 ~ re && !/^  lockfile-sync-tests:/{exit}' <<<"$ci_exec")"
  if [ -z "$lst_block" ]; then
    fail "lockfile-sync-tests job block is empty after comment-strip — self-defense job missing or fully commented out"
  fi

  # The auditing job's own JOB-level surface: the step-scoped pins below
  # cannot see 4-space job keys, and both of these one-line neuters leave
  # the job reporting SUCCESS — not skipped — so the CI Success skip-based
  # anti-tamper never fires either. A job-level continue-on-error lets a
  # red suite pass the job; an appended second job-level steps: replaces
  # the ENTIRE step list under YAML last-key-wins while every step-scoped
  # pin still matches the dead original text. The job's legitimate
  # job-level if: (the ci-gate trigger) is deliberately NOT count-pinned:
  # an appended if: false SKIPS the job, which check-ci-success.sh's
  # check_triggered anti-tamper genuinely catches, and an appended
  # if: true only widens when the job runs — the harmful direction of a
  # duplicated if: is covered externally, unlike these two.
  lst_steps_count="$(grep -cE "^    [\"']?steps[\"']?[[:space:]]*:" <<<"$lst_block" || true)"
  if [ "$lst_steps_count" -ne 1 ]; then
    fail "self-defense lockfile-sync-tests job has $lst_steps_count job-level steps: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so a second steps: silently replaces this suite's own CI execution while the job still reports success)"
  else
    pass "self-defense lockfile-sync-tests job has exactly 1 job-level steps: key"
  fi
  if grep -qE "^    [\"']?continue-on-error[\"']?[[:space:]]*:" <<<"$lst_block"; then
    fail "self-defense lockfile-sync-tests job carries a job-level continue-on-error — a failing suite would report success"
  else
    pass "self-defense lockfile-sync-tests job has no job-level continue-on-error"
  fi

  # Both pins are STEP-scoped via step_block (same helper as the audit
  # steps): a job-block-wide grep cannot tell which run: key owns the needle
  # it matches — an appended `run: true` after either step wins under YAML
  # last-key-wins while the job-wide grep still matches the dead line,
  # silently disabling this suite's own CI execution. That is the one pin
  # whose failure makes every other green here prove nothing: for
  # pull_request events GitHub runs the PR's workflow file, so the mutated
  # step takes effect in the same run that should have caught it, and the
  # job still reports SUCCESS (not skipped — the CI Success anti-tamper
  # never fires). Each step: fail closed on a missing/empty cut, no
  # step-level if: (skipped step, needle still greps as present), no
  # continue-on-error, and exactly ONE run: key — count FIRST, containment
  # only after (with one run: key the scanned body IS the effective body).
  # Containment runs on a trailing-comment-stripped copy: a needle alive
  # only inside a YAML comment (`run: true # bash scripts/...`) is
  # tampering, not wiring; an over-truncated legitimate quoted `#` turns a
  # pin red, never green.
  lst_suite_blk="$(step_block "$lst_block" 'Run npm-audit allowlist gate test suite')"
  if [ -z "$lst_suite_blk" ]; then
    fail "self-defense job has no step named 'Run npm-audit allowlist gate test suite' — the suite's own CI execution cannot be verified (fail closed)"
  else
    if grep -qE "^[[:space:]]*[\"']?if[\"']?[[:space:]]*:" <<<"$lst_suite_blk"; then
      fail "self-defense suite-run step carries a step-level if: — the suite can be skipped while its run: line still greps as present"
    else
      pass "self-defense suite-run step has no step-level if:"
    fi
    if grep -q 'continue-on-error' <<<"$lst_suite_blk"; then
      fail "self-defense suite-run step carries continue-on-error — a red suite would be ignored"
    else
      pass "self-defense suite-run step has no continue-on-error"
    fi
    lst_suite_run_count="$(grep -cE "^[[:space:]]*[\"']?run[\"']?[[:space:]]*:" <<<"$lst_suite_blk" || true)"
    lst_suite_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$lst_suite_blk")"
    if [ "$lst_suite_run_count" -ne 1 ]; then
      fail "self-defense suite-run step has $lst_suite_run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended run: true executes instead of the suite while the original line still greps as present)"
    elif grep -qE '^[[:space:]]*run: bash scripts/__tests__/check-npm-audit\.test\.sh[[:space:]]*$' <<<"$lst_suite_scan"; then
      pass "self-defense job runs the npm-audit gate bash suite as the step's single run: line"
    else
      fail "self-defense suite-run step's run: line is not 'bash scripts/__tests__/check-npm-audit.test.sh' — neutered, rewritten, or comment-suffixed"
    fi
  fi

  lst_shck_blk="$(step_block "$lst_block" 'Shellcheck the gate scripts and their suites')"
  if [ -z "$lst_shck_blk" ]; then
    fail "self-defense job has no step named 'Shellcheck the gate scripts and their suites' — lint coverage of this gate cannot be verified (fail closed)"
  else
    if grep -qE "^[[:space:]]*[\"']?if[\"']?[[:space:]]*:" <<<"$lst_shck_blk"; then
      fail "self-defense shellcheck step carries a step-level if: — lint coverage can be skipped while its needle still greps as present"
    else
      pass "self-defense shellcheck step has no step-level if:"
    fi
    if grep -q 'continue-on-error' <<<"$lst_shck_blk"; then
      fail "self-defense shellcheck step carries continue-on-error — shellcheck findings would be ignored"
    else
      pass "self-defense shellcheck step has no continue-on-error"
    fi
    # The gate+suite needle sits MID-LINE in a run: | block scalar, so
    # whole-line anchoring is unavailable. Scope the needle to the run:
    # SCALAR, not the step block — else it survives in an env: value inside
    # the same step while `run: true` executes (the needle-satisfiable-from-
    # elsewhere failure shape). The scalar cut starts at the run: line and
    # stops at the next 8-space step key; block-scalar content is indented
    # deeper, so it passes through. This proves the needle sits in the
    # single run: scalar of the named step — NOT that shellcheck
    # semantically lints it (same present-not-effective residual register
    # as the deploy clause pin).
    lst_shck_run_count="$(grep -cE "^[[:space:]]*[\"']?run[\"']?[[:space:]]*:" <<<"$lst_shck_blk" || true)"
    lst_shck_scan="$(awk '{sub(/[[:space:]]*#.*/, ""); print}' <<<"$lst_shck_blk")"
    lst_shck_scalar="$(awk "/^[[:space:]]*[\"']?run[\"']?[[:space:]]*:/{f=1;print;next} f && /^        [A-Za-z_\"'-]/{exit} f{print}" <<<"$lst_shck_scan")"
    if [ "$lst_shck_run_count" -ne 1 ]; then
      fail "self-defense shellcheck step has $lst_shck_run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended run: true executes instead of shellcheck while the needle still greps as present)"
    elif grep -qF 'scripts/check-npm-audit.sh scripts/__tests__/check-npm-audit.test.sh' <<<"$lst_shck_scalar"; then
      pass "self-defense job shellchecks the npm-audit gate + its suite inside the step's single run: scalar"
    else
      fail "self-defense shellcheck step's run: scalar no longer covers scripts/check-npm-audit.sh + its suite — coverage dropped or relocated outside the executable scalar"
    fi
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression locks for the two SIGPIPE-under-pipefail failure modes (see the note
# at the top). Each needle is constructed so the guard line cannot match itself:
# the first glues `echo` to `[[:space:]]`; the second's literal redirection token
# is followed in-pattern by a bracket class, never by a real quoted variable.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string to stay correct under pipefail"
else
  pass "suite feeds grep/awk via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

# Second failure mode: a here-string-fed stage CHAINED into a further grep/awk.
# On an early match the reader exits, SIGPIPEs the upstream stage, and a negative
# assertion's `if` falls through to its pass branch — a false PASS, the inverse of
# the false FAIL above. Materialize the intermediate text into a variable and
# match with a single grep instead.
if grep -nE '<<<[[:space:]]*"\$[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a here-string-fed pipeline stage pipes into grep/awk — materialize the intermediate text first (false-PASS risk under pipefail)"
else
  pass "suite has no here-string-fed pipeline chains (no false-PASS SIGPIPE risk under pipefail)"
fi

echo ""
echo "=== bash runtime-error sweep (whole suite) ==="
# Any `unbound variable` / `bad substitution` / `syntax error` the gate emitted
# during ANY invocation above was captured by run_gate_script into
# $FIX/bash-errors.log. A crash inside a command substitution can read as an
# empty capture (→ silent WAIVE on bash 3.2), so leaked runtime errors are a
# suite failure even when every exit-code assertion passed.
if [ -s "$FIX/bash-errors.log" ]; then
  fail "bash runtime error(s) leaked from the gate during the suite:"
  sed 's/^/    /' "$FIX/bash-errors.log"
else
  pass "no bash runtime errors leaked from any gate invocation"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
