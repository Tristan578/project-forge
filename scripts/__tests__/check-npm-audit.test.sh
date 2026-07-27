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
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string (`grep PAT <<<"$var"`),
# never pipe a large variable's `echo` into grep/awk — under pipefail the reader
# closing the pipe on first match SIGPIPEs the writer and misreports a real match
# as a miss (this bit CI on the ~31 KB ci.yml read). The suite-hygiene guard at the
# end fails if the antipattern is reintroduced.

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

# Run the gate inside $REPO against workspace `ws` with a given audit stub command.
# Echoes "<exit>|<output>".
run_gate() {
  local auditcmd="$1" out rc
  out="$(cd "$REPO" && NPM_AUDIT_CMD="$auditcmd" bash "$SCRIPT" ws 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

# Helper: write a fixture file, echo its absolute path.
fixture() { local name="$1"; cat > "$FIX/$name"; echo "$FIX/$name"; }

echo "=== check-npm-audit.sh contract ==="

# --- 1. Clean report → exit 0 -------------------------------------------------
f="$(fixture clean.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{}}
JSON
)"
res="$(run_gate "cat $f")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "clean report passes (exit 0)"; else fail "clean should exit 0, got $rc"; fi

# --- 2. Only allowlisted high advisory → exit 0 -------------------------------
f="$(fixture waived.json <<'JSON'
{"auditReportVersion":2,"vulnerabilities":{
  "brace-expansion":{"name":"brace-expansion","severity":"high","via":[
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"<=5.0.7"}]},
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
    {"source":1,"name":"brace-expansion","title":"brace-expansion unbounded expansion DoS","url":"https://github.com/advisories/GHSA-mh99-v99m-4gvg","severity":"high","range":"*"}]},
  "evil":{"name":"evil","severity":"high","via":[
    {"source":9,"name":"evil","title":"evil RCE","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc","severity":"high","range":"*"}]}}}
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

# --- 10. Missing workspace dir → fail-closed (exit 2) ------------------------
out="$(cd "$REPO" && NPM_AUDIT_CMD="true" bash "$SCRIPT" no_such_ws 2>&1)"; rc=$?
if [ "$rc" = "2" ]; then pass "missing workspace dir fails closed (exit 2)"; else fail "missing workspace should exit 2, got $rc"; fi

# --- 11. No argument → fail-closed (exit 2) ----------------------------------
out="$(cd "$REPO" && bash "$SCRIPT" 2>&1)"; rc=$?
if [ "$rc" = "2" ]; then pass "no workspace argument fails closed (exit 2)"; else fail "no argument should exit 2, got $rc"; fi

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

echo ""
echo "=== quality-gates.yml integration wiring ==="
if [ -f "$QG_YML" ]; then
  qg="$(cat "$QG_YML")"

  # The required security job must keep its name (the required-check surface).
  if grep -qE '^[[:space:]]+name: Rust Security Audit' <<<"$qg"; then
    pass "quality-gates keeps the 'Rust Security Audit' job (required check name stable)"
  else
    fail "the 'Rust Security Audit' job name changed — required-check wiring may break"
  fi

  # The job must invoke the gate for BOTH workspaces.
  if grep -qF 'bash scripts/check-npm-audit.sh web' <<<"$qg"; then
    pass "security job runs the allowlist gate for web"
  else
    fail "security job does not run scripts/check-npm-audit.sh web"
  fi
  if grep -qF 'bash scripts/check-npm-audit.sh mcp-server' <<<"$qg"; then
    pass "security job runs the allowlist gate for mcp-server"
  else
    fail "security job does not run scripts/check-npm-audit.sh mcp-server"
  fi

  # The raw, un-allowlisted gate must be FULLY replaced — if a stray
  # `npm audit --audit-level=high` survives it will fail on the un-relockable
  # esbuild advisory and re-wedge the pipeline. Strip comment lines first: the
  # gate's own rationale comment legitimately names the old command in prose, and
  # only an EXECUTABLE occurrence re-wedges the pipeline.
  if grep -v '^[[:space:]]*#' <<<"$qg" | grep -qF 'npm audit --audit-level=high'; then
    fail "a raw 'npm audit --audit-level=high' still exists in an executable line — it will fail on the un-relockable esbuild advisory"
  else
    pass "no raw 'npm audit --audit-level=high' remains in an executable line (fully replaced by the gate)"
  fi

  # SECURITY: the $NPM_AUDIT_CMD test seam must NEVER be wired into the real job —
  # `env: NPM_AUDIT_CMD: true` would make the gate audit nothing and pass blindly.
  # Strip comment lines first (the rationale comment may name it), then assert no
  # executable line references it.
  if grep -v '^[[:space:]]*#' <<<"$qg" | grep -q 'NPM_AUDIT_CMD'; then
    fail "quality-gates wires the NPM_AUDIT_CMD test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "quality-gates does not wire the NPM_AUDIT_CMD test seam (gate cannot be bypassed via job env)"
  fi

  # SECURITY: `continue-on-error: true` on the audit step would swallow the gate's
  # non-zero exit and pass the job regardless. Scope the check to a window around
  # the invocation so an unrelated continue-on-error elsewhere in the file (there
  # are several legitimate ones) does not false-positive.
  if grep -v '^[[:space:]]*#' <<<"$qg" | grep -B3 -A1 'check-npm-audit' | grep -q 'continue-on-error'; then
    fail "quality-gates npm-audit step has continue-on-error — gate exit code would be ignored"
  else
    pass "quality-gates npm-audit step has no continue-on-error bypass"
  fi
else
  fail "quality-gates.yml not found at $QG_YML"
fi

echo ""
echo "=== cd.yml integration wiring ==="
# The deploy pipeline's security step mirrors quality-gates and is subject to the
# same un-relockable esbuild wedge — pin the gate here too so a future revert to a
# raw audit silently re-wedges CD instead of slipping through.
if [ -f "$CD_YML" ]; then
  cd_yml="$(cat "$CD_YML")"
  if grep -qF 'bash scripts/check-npm-audit.sh web' <<<"$cd_yml" \
     && grep -qF 'bash scripts/check-npm-audit.sh mcp-server' <<<"$cd_yml"; then
    pass "cd.yml security step runs the allowlist gate for both workspaces"
  else
    fail "cd.yml security step does not run scripts/check-npm-audit.sh for both workspaces"
  fi
  if grep -v '^[[:space:]]*#' <<<"$cd_yml" | grep -qF 'npm audit --audit-level=high'; then
    fail "cd.yml still has a raw 'npm audit --audit-level=high' in an executable line — it will wedge the deploy pipeline"
  else
    pass "cd.yml has no raw 'npm audit --audit-level=high' in an executable line"
  fi

  # SECURITY: same seam guard as quality-gates — `env: NPM_AUDIT_CMD: <clean json>`
  # on the CD step would no-op the audit into a blind pass. cd.yml is editable
  # independently of quality-gates, so it needs its own assertion (the deploy
  # pipeline's audit is the last gate before artifacts ship).
  if grep -v '^[[:space:]]*#' <<<"$cd_yml" | grep -q 'NPM_AUDIT_CMD'; then
    fail "cd.yml wires the NPM_AUDIT_CMD test seam in an executable line — CD audit can be no-op'd into a false pass"
  else
    pass "cd.yml does not wire the NPM_AUDIT_CMD test seam"
  fi

  # SECURITY: `continue-on-error: true` on the audit step would swallow the gate's
  # non-zero exit and let the deploy proceed past a real advisory. Scope the check
  # to a window around the invocation so an unrelated continue-on-error elsewhere in
  # cd.yml does not false-positive.
  if grep -v '^[[:space:]]*#' <<<"$cd_yml" | grep -B3 -A1 'check-npm-audit' | grep -q 'continue-on-error'; then
    fail "cd.yml npm-audit step has continue-on-error — a real advisory would not fail the deploy"
  else
    pass "cd.yml npm-audit step has no continue-on-error bypass"
  fi
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
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"

  if grep -qF 'scripts/check-npm-audit.sh scripts/__tests__/check-npm-audit.test.sh' <<<"$lst_block"; then
    pass "self-defense job shellchecks the npm-audit gate + its suite"
  else
    fail "self-defense job does not shellcheck scripts/check-npm-audit.sh and its suite"
  fi

  if grep -qF 'bash scripts/__tests__/check-npm-audit.test.sh' <<<"$lst_block"; then
    pass "self-defense job runs the npm-audit gate bash suite"
  else
    fail "self-defense job does not run scripts/__tests__/check-npm-audit.test.sh"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure (see the note at the
# top). The needle glues `echo` to `[[:space:]]` so this guard line cannot match
# itself.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string to stay correct under pipefail"
else
  pass "suite feeds grep/awk via here-strings, not variable pipes (SIGPIPE-safe under pipefail)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
