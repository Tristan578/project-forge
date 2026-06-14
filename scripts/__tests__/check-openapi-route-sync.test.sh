#!/usr/bin/env bash
# Unit tests for scripts/check-openapi-route-sync.sh — the OpenAPI route-drift
# gate — plus structural assertions that the gate is wired into ci.yml's
# required `ci-success` aggregate (a standalone path-filtered workflow can never
# be a safe required check, so the gate has to ride the existing
# ci-gate/ci-success pattern instead).
#
# WHY THIS GATE EXISTS
# --------------------
# Two failure modes, both shipped live:
#
#   1. MALFORMED SPEC. docs/api/openapi.json is served verbatim by
#      web/src/app/api/openapi/route.ts (JSON.parse(raw)) and rendered by
#      Swagger UI at /api-docs. A single trailing comma makes that parse throw —
#      not an ENOENT — so the route falls through to its 500 branch and the
#      entire public API reference 500s in production. This was LIVE on main. A
#      jq-validity check here turns a silent prod 500 into a red PR.
#
#   2. DOC DRIFT. The spec is hand-maintained with no generator. When a new
#      route ships undocumented the published contract silently rots. The gate
#      enumerates every route.ts, normalizes its path the same way OpenAPI keys
#      it ([param] -> {param}, [...rest] -> {rest}, (groups) stripped, prefixed
#      /api), and asserts each is EITHER documented in the spec OR listed in the
#      internal-routes allowlist. A ratchet: pre-existing internal routes are
#      seeded into the allowlist, so it passes today and only fails on NEW drift.
#
# HERMETIC TESTING
# ----------------
# The gate reads its three inputs from $OPENAPI_SPEC / $OPENAPI_ALLOWLIST /
# $OPENAPI_API_DIR (defaulting to the real repo paths). These tests point those
# at a throwaway git repo and assert the branching/exit-code/messaging contract.
# The gate is read-only — no network, no regeneration, no working-tree mutation —
# so unlike the lockfile gate there is no regen-stub or signal-cleanup to drive.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string — `grep PAT <<<"$var"`
# — and never pipe a large variable's `echo` output into grep/awk. Under
# `pipefail`, `grep -q` closes the pipe on its FIRST match; on a payload larger
# than the runner's pipe buffer (the ~33 KB ci.yml read below) the still-writing
# `echo` then takes SIGPIPE, which `pipefail` turns into a non-zero pipeline
# status — silently converting a real match into a false "missing" failure. The
# structural guard at the end of this file keeps the antipattern from creeping
# back in.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-openapi-route-sync.sh"
CI_SUCCESS="$HERE/../check-ci-success.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }
command -v jq  >/dev/null 2>&1 || { echo "jq not found — required to run these tests"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git not found — required to run these tests"; exit 1; }

# Build a throwaway git repo with an empty api/ dir. Echoes the repo path; the
# caller writes spec.json / allowlist.json / route files into it. The gate cd's
# to the git root (`git rev-parse --show-toplevel`) then resolves its inputs
# relative to it, so a bare `git init` (no commit needed) is enough.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  ( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t )
  mkdir -p "$repo/api"
  echo "$repo"
}

# Write the spec / allowlist verbatim.
write_spec()      { printf '%s' "$2" > "$1/spec.json"; }
write_allowlist() { printf '%s' "$2" > "$1/allowlist.json"; }

# add_route <repo> <segments> — create api/<segments>/route.ts. <segments> may
# contain literal [param], [...rest] and (group) dirs (quoted, so no globbing).
add_route() { mkdir -p "$1/api/$2" && : > "$1/api/$2/route.ts"; }

# Run the gate inside $repo with the three inputs pointed at the throwaway tree;
# echo "<exit>|<output>". $2 overrides the api dir (default 'api') for the
# missing-dir case.
run_gate() {
  local repo="$1" apidir="${2:-api}" out rc
  out="$(cd "$repo" \
    && OPENAPI_SPEC=spec.json OPENAPI_ALLOWLIST=allowlist.json OPENAPI_API_DIR="$apidir" \
       bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

EMPTY_ALLOWLIST='{"categories":{},"routes":{}}'

echo "=== check-openapi-route-sync.sh tests ==="

# --- 1. Documented route, empty allowlist -> exit 0 + success message --------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{"/api/foo":{"get":{}}}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "documented route passes (exit 0)"; else fail "documented route should exit 0, got $rc"; fi
if grep -qi "documented or allowlisted" <<<"$out"; then pass "success message names the verdict"; else fail "success message missing"; fi
rm -rf "$repo"

# --- 2. Allowlisted (not documented) route -> exit 0 -------------------------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" '{"categories":{"admin":"Admin-only."},"routes":{"/api/admin/x":"admin"}}'
add_route "$repo" "admin/x"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "allowlisted route passes (exit 0)"; else fail "allowlisted route should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 3. Undocumented AND un-allowlisted route -> exit 1 + names the route -----
# The core ratchet: a brand-new public route nobody documented must fail.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "newthing"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "undocumented route fails (exit 1)"; else fail "undocumented route should exit 1, got $rc"; fi
if grep -qi "undocumented API route" <<<"$out"; then pass "failure message says 'undocumented'"; else fail "undocumented message missing"; fi
if grep -qF '/api/newthing' <<<"$out"; then pass "failure names the offending route (/api/newthing)"; else fail "failure does not name the route"; fi
rm -rf "$repo"

# --- 4. NORMALIZATION: [param] route documented as {param} -> exit 0 ----------
# The gate is only correct if it keys a route the SAME way OpenAPI keys it. If
# the [id]->{id} rewrite broke, /api/users/[id] would not match the documented
# /api/users/{id} and this would (wrongly) fail. This case pins the rewrite.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{"/api/users/{id}":{"get":{}}}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "users/[id]"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "dynamic [id] normalizes to {id} and matches the spec (exit 0)"; else fail "[id]->{id} normalization broken, got $rc"; fi
rm -rf "$repo"

# --- 5. NORMALIZATION: catch-all [...rest] -> {rest} -> exit 0 ----------------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" '{"categories":{"published-game":"Runtime."},"routes":{"/api/files/{path}":"published-game"}}'
add_route "$repo" "files/[...path]"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "catch-all [...path] normalizes to {path} (exit 0)"; else fail "[...rest]->{rest} normalization broken, got $rc"; fi
rm -rf "$repo"

# --- 5b. NORMALIZATION: optional catch-all [[...rest]] -> {rest} -> exit 0 -----
# The double-bracket optional catch-all is the trap case: the inner [...rest]
# rule matches first, so run alone it leaves /api/assets/[{path}] -> {{path}},
# which matches nothing in the spec. The dedicated [[...]] rule MUST run before
# the plain catch-all rule. This pins that ordering (was latently broken).
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" '{"categories":{"published-game":"Runtime."},"routes":{"/api/assets/{path}":"published-game"}}'
add_route "$repo" "assets/[[...path]]"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "optional catch-all [[...path]] normalizes to {path} (exit 0)"; else fail "[[...rest]]->{rest} normalization broken, got $rc (double-bracket likely produced {{path}})"; fi
rm -rf "$repo"

# --- 6. NORMALIZATION: route group (group) is stripped -> exit 0 -------------
# Route groups are organizational dirs, NOT URL segments — Next.js drops them
# from the path. /api/(internal)/health is served at /api/health.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{"/api/health":{"get":{}}}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "(internal)/health"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "route group (internal) is stripped from the path (exit 0)"; else fail "route-group strip broken, got $rc"; fi
rm -rf "$repo"

# --- 7. MALFORMED SPEC (trailing comma) -> exit 1 + prod-500 message ----------
# The live-bug class. jq must reject it and the gate must explain the blast radius.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{},}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "malformed spec fails (exit 1)"; else fail "malformed spec should exit 1, got $rc"; fi
if grep -qi "not valid JSON" <<<"$out"; then pass "malformed-spec message flags invalid JSON"; else fail "malformed-spec message missing"; fi
if grep -qi "500" <<<"$out"; then pass "malformed-spec message names the prod-500 blast radius"; else fail "malformed-spec message does not warn about the 500"; fi
rm -rf "$repo"

# --- 8. MISSING SPEC -> exit 1 -----------------------------------------------
repo="$(make_repo)"
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing spec fails (exit 1)"; else fail "missing spec should exit 1, got $rc"; fi
if grep -qi "spec not found" <<<"$out"; then pass "missing-spec message is clear"; else fail "missing-spec message missing"; fi
rm -rf "$repo"

# --- 9. MALFORMED ALLOWLIST -> exit 1 ----------------------------------------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" '{"routes":{,}}'
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "malformed allowlist fails (exit 1)"; else fail "malformed allowlist should exit 1, got $rc"; fi
if grep -qi "allowlist.*not valid JSON" <<<"$out"; then pass "malformed-allowlist message is clear"; else fail "malformed-allowlist message missing"; fi
rm -rf "$repo"

# --- 10. MISSING ALLOWLIST -> exit 1 -----------------------------------------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing allowlist fails (exit 1)"; else fail "missing allowlist should exit 1, got $rc"; fi
if grep -qi "allowlist not found" <<<"$out"; then pass "missing-allowlist message is clear"; else fail "missing-allowlist message missing"; fi
rm -rf "$repo"

# --- 11. UNKNOWN CATEGORY: allowlist names an undefined category -> exit 1 ----
# Keeps the allowlist's WHY-column honest — every entry must name a real category.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" '{"categories":{"admin":"Admin-only."},"routes":{"/api/admin/x":"nope"}}'
add_route "$repo" "admin/x"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "unknown category fails (exit 1)"; else fail "unknown category should exit 1, got $rc"; fi
if grep -qi "undefined category" <<<"$out"; then pass "unknown-category message is clear"; else fail "unknown-category message missing"; fi
rm -rf "$repo"

# --- 12. STALE ALLOWLIST: entry with no matching route file -> exit 1 ---------
# A documented+present route keeps the violation check quiet so the STALE branch
# is what trips: /api/ghost is allowlisted but no route.ts maps to it.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{"/api/foo":{"get":{}}}}'
write_allowlist "$repo" '{"categories":{"admin":"Admin-only."},"routes":{"/api/ghost":"admin"}}'
add_route "$repo" "foo"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "stale allowlist entry fails (exit 1)"; else fail "stale entry should exit 1, got $rc"; fi
if grep -qi "stale allowlist" <<<"$out"; then pass "stale message is clear"; else fail "stale message missing"; fi
if grep -qF '/api/ghost' <<<"$out"; then pass "stale message names the dead entry (/api/ghost)"; else fail "stale message does not name the entry"; fi
rm -rf "$repo"

# --- 13. REDUNDANT ALLOWLIST: entry ALSO documented in the spec -> exit 1 -----
# A route that became public (documented) must be removed from the allowlist.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{"/api/admin/x":{"get":{}}}}'
write_allowlist "$repo" '{"categories":{"admin":"Admin-only."},"routes":{"/api/admin/x":"admin"}}'
add_route "$repo" "admin/x"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "redundant allowlist entry fails (exit 1)"; else fail "redundant entry should exit 1, got $rc"; fi
if grep -qi "also documented" <<<"$out"; then pass "redundant message is clear"; else fail "redundant message missing"; fi
if grep -qF '/api/admin/x' <<<"$out"; then pass "redundant message names the redundant entry (/api/admin/x)"; else fail "redundant message does not name the entry"; fi
rm -rf "$repo"

# --- 14. MISSING API DIR -> exit 1 -------------------------------------------
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
res="$(run_gate "$repo" "no-such-dir")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing API dir fails (exit 1)"; else fail "missing API dir should exit 1, got $rc"; fi
if grep -qi "directory not found" <<<"$out"; then pass "missing-API-dir message is clear"; else fail "missing-API-dir message missing"; fi
rm -rf "$repo"

# --- 15. Multiple undocumented routes are ALL reported -----------------------
# A single-route find would hide siblings; assert both names appear so a reader
# fixes the whole batch, not one at a time.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
add_route "$repo" "alpha"
add_route "$repo" "beta"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "multiple undocumented routes fail (exit 1)"; else fail "multiple undocumented should exit 1, got $rc"; fi
if grep -qF '/api/alpha' <<<"$out" && grep -qF '/api/beta' <<<"$out"; then pass "both undocumented routes are reported"; else fail "not all undocumented routes reported"; fi
rm -rf "$repo"

# --- 16. EMPTY API DIR (exists, zero route.ts) -> exit 1 (fail closed) --------
# make_repo creates api/ but we add NO route. A mis-pointed-but-existing path
# (the classic OPENAPI_API_DIR=/tmp vacuous-pass) enumerates zero routes, so
# every set-difference below is empty and the gate would pass without checking
# anything. It must instead REFUSE to pass vacuously.
repo="$(make_repo)"
write_spec "$repo" '{"paths":{}}'
write_allowlist "$repo" "$EMPTY_ALLOWLIST"
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "empty API dir fails closed (exit 1)"; else fail "empty API dir should exit 1, got $rc"; fi
if grep -qi "vacuously" <<<"$out"; then pass "empty-dir message explains the vacuous-pass refusal"; else fail "empty-dir message missing"; fi
rm -rf "$repo"

echo ""
echo "=== ci.yml integration wiring ==="
# A standalone path-filtered workflow cannot be a SAFE required check: a PR that
# touches none of its paths never starts it, so GitHub reports 'Expected'
# forever and the PR is blocked indefinitely. The only safe way to enforce a
# path-sensitive gate in this repo is to ride the ci-gate -> ci-success pattern:
# a job skipped (not failed) on irrelevant PRs, and in ci-success's `needs:` so
# it is required when it DOES run. These assertions pin that wiring so a future
# edit cannot silently demote the gate to advisory-only.
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"

  if grep -qE '^  openapi-route-sync:' <<<"$ci"; then
    pass "ci.yml defines an openapi-route-sync job"
  else
    fail "ci.yml has no openapi-route-sync job (gate is not in the required pipeline)"
  fi

  if grep -qE 'needs-api:' <<<"$ci"; then
    pass "ci-gate exposes a needs-api output"
  else
    fail "ci-gate has no needs-api output to gate the job on"
  fi

  # The api detector must key on the route tree, the published spec, the
  # allowlist, and the gate/its test — NOT merely contain 'api=true' somewhere.
  # Assert against the LITERAL detection line (the one that sets api=true).
  api_line="$(grep -F 'api=true' <<<"$ci")"
  if grep -qF '^web/src/app/api/' <<<"$api_line" \
     && grep -qF 'docs/api/openapi\.json' <<<"$api_line" \
     && grep -qF 'docs/api/openapi-internal-routes\.json' <<<"$api_line" \
     && grep -qF 'scripts/check-openapi-route-sync\.sh' <<<"$api_line"; then
    pass "ci-gate api detection regex keys on the route tree + spec + allowlist + gate"
  else
    fail "ci-gate api=true line does not key on the route tree/spec/allowlist/gate"
  fi

  # The "No relevant changes" diagnostic must account for `api`: a spec- or
  # allowlist-only PR sets any_code/hooks/deps independently, but the gate DOES
  # run. If the guard ignores api it can print "downstream jobs will be skipped"
  # on exactly the PRs the gate catches. (The `if:` precedes the echo.)
  norel_if="$(awk '/No relevant changes — downstream jobs/{print prev} {prev=$0}' <<<"$ci")"
  if grep -qF 'api' <<<"$norel_if"; then
    pass "ci-gate 'no relevant changes' diagnostic accounts for api (spec/allowlist-only PRs)"
  else
    fail "ci-gate 'no relevant changes' guard ignores api — mislabels spec-only PRs as no-op"
  fi

  # Extract the whole openapi-route-sync job block (header -> next 2-space job
  # header). The start condition requires ':' immediately after the job id so it
  # fires only on the exact header; the block terminates at the first following
  # 2-space job header that is not itself.
  oa_block="$(awk '/^  openapi-route-sync:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  openapi-route-sync:/{exit}' <<<"$ci")"

  # Defense-in-depth against a constant-false unwiring. The job's `if:` MUST key
  # on `needs-api == 'true'`. This is a SEPARATE check from the ci-success
  # anti-tamper: the anti-tamper only fires when needs-api=true AND the gate is
  # skipped, so it catches an `if: false` the moment a real API-change PR
  # arrives, but NOT the PR that INTRODUCES the `if: false` if that PR touches no
  # API surface. That introducing PR edits ci.yml (sets needs-ci=true) and runs
  # THIS suite — so this assertion catches the constant-false at introduction
  # time, closing the window the anti-tamper alone leaves open.
  oa_if="$(grep -E '^[[:space:]]+if:' <<<"$oa_block")"
  if grep -qF 'needs-api' <<<"$oa_if" && grep -qF "== 'true'" <<<"$oa_if"; then
    pass "openapi-route-sync job if: keys on needs-api == 'true' (a constant if:false is caught here)"
  else
    fail "openapi-route-sync job if: is not gated on needs-api == 'true' (possible constant-false unwiring)"
  fi

  # Scope the run-step check to the EXTRACTED block: the script name also appears
  # in the self-defense job's shellcheck list, so a broad match would still PASS
  # if the real `run: bash ...` line were deleted from THIS job.
  if grep -qF 'run: bash scripts/check-openapi-route-sync.sh' <<<"$oa_block"; then
    pass "openapi-route-sync job runs scripts/check-openapi-route-sync.sh"
  else
    fail "openapi-route-sync job block never invokes the gate script via run:"
  fi

  # SECURITY: $OPENAPI_SPEC / $OPENAPI_ALLOWLIST / $OPENAPI_API_DIR are TEST-ONLY
  # seams (the hermetic suite injects them via run_gate). None may appear in an
  # EXECUTABLE line of the real job. A PR that wired `env: OPENAPI_API_DIR: /tmp`
  # (an empty dir) would make the gate enumerate zero routes — every check passes
  # vacuously while real drift slips through. The ci-success anti-tamper cannot
  # catch this (job result is success, not skipped). But a wiring PR edits ci.yml
  # -> needs-ci=true -> runs THIS suite, so this fails the required check at
  # introduction time. Strip full-comment lines first (the gate's doc comment in
  # ci.yml legitimately names the seams); an attacker's `env:` wiring is a
  # non-comment line and is still caught.
  if grep -v '^[[:space:]]*#' <<<"$oa_block" | grep -qE 'OPENAPI_SPEC|OPENAPI_ALLOWLIST|OPENAPI_API_DIR'; then
    fail "openapi-route-sync job exposes an OPENAPI_* test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "openapi-route-sync job does not wire the OPENAPI_* test seams (gate cannot be bypassed via job env)"
  fi

  # ci-success's needs: list is the required-check surface. Anchor the match to
  # the whole list entry ($) so '- openapi-route-sync' cannot be satisfied by a
  # longer substring entry and vice-versa.
  cisuccess_needs="$(awk '/^  ci-success:/{f=1} f{print} /^    steps:/{if(f)exit}' <<<"$ci")"
  if grep -qE '^      - openapi-route-sync$' <<<"$cisuccess_needs"; then
    pass "ci-success requires the openapi-route-sync job"
  else
    fail "openapi-route-sync is not in ci-success needs — gate is not required"
  fi

  # The gate's OWN decision logic must be unit-tested by a REQUIRED check. Pin the
  # self-tests as a run step in the lockfile-sync-tests job (the repo's shared
  # "CI Self-Defense Tests" job, which rides ci-success) so unwiring the gate
  # fails a REQUIRED check rather than an advisory one.
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"
  if grep -qF 'bash scripts/__tests__/check-openapi-route-sync.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests job runs the OpenAPI gate's bash suite"
  else
    fail "lockfile-sync-tests job does not run the OpenAPI gate bash suite (self-tests not required)"
  fi

  # Riding lockfile-sync-tests only makes the OpenAPI self-tests REQUIRED if that
  # host job (a) actually runs when this gate's files change and (b) is itself in
  # ci-success's needs. Without (a) the suite never starts on a gate-script edit;
  # without (b) it runs in a job nothing requires — advisory-only. Pin both so the
  # full "tested -> required" chain is mutation-proof, not just its last link.
  if grep -qF 'needs-ci' <<<"$lst_block"; then
    pass "lockfile-sync-tests job is gated on needs-ci (runs when scripts/ change)"
  else
    fail "lockfile-sync-tests if: does not key on needs-ci — the OpenAPI suite may not run on gate edits"
  fi
  if grep -qE '^      - lockfile-sync-tests$' <<<"$cisuccess_needs"; then
    pass "ci-success requires the lockfile-sync-tests job (the OpenAPI suite's host is required)"
  else
    fail "lockfile-sync-tests is not in ci-success needs — the OpenAPI self-tests would be advisory-only"
  fi

  # The ci-success anti-tamper enforces THIS gate's skip-while-triggered entry, so
  # it must actually execute in ci-success AND be unit-tested — otherwise the
  # anti-tamper map entry asserted further below is inert. Pin both.
  cisuccess_block="$(awk '/^  ci-success:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  ci-success:/{exit}' <<<"$ci")"
  if grep -qF 'check-ci-success.sh' <<<"$cisuccess_block"; then
    pass "ci-success runs scripts/check-ci-success.sh (the anti-tamper actually executes)"
  else
    fail "ci-success never invokes check-ci-success.sh — the anti-tamper entry for this gate is inert"
  fi
  if grep -qF 'bash scripts/__tests__/check-ci-success.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests unit-tests check-ci-success.sh (anti-tamper logic is verified)"
  else
    fail "check-ci-success.test.sh is not run — the anti-tamper logic this gate relies on is untested"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== ci-success anti-tamper wiring ==="
# The skip-while-triggered anti-tamper in check-ci-success.sh must map this gate
# to its trigger. Without the entry, an `if: false` on the job would skip it on a
# real API-change PR with no required check failing. Pin the map entry.
if [ -f "$CI_SUCCESS" ]; then
  if grep -qE 'check_triggered[[:space:]]+"openapi-route-sync"[[:space:]]+"needs-api"' "$CI_SUCCESS"; then
    pass "check-ci-success.sh maps openapi-route-sync -> needs-api (skip-while-triggered is caught)"
  else
    fail "check-ci-success.sh has no anti-tamper entry for openapi-route-sync — an if:false skip would go unnoticed"
  fi
else
  fail "check-ci-success.sh not found at $CI_SUCCESS"
fi

echo ""
echo "=== gate script hardening (structural) ==="
# Lock properties of check-openapi-route-sync.sh that the behavior tests above
# exercise only indirectly. Each is mutation-provable: gut the property and the
# matching case fails.

# The three inputs MUST default to the REAL repo paths so the seam cannot
# silently point production at a throwaway tree. (Behavior tests always override
# the seam, so the default is otherwise unobserved.)
if grep -qF 'OPENAPI_SPEC:-docs/api/openapi.json' "$SCRIPT"; then
  pass "spec input defaults to docs/api/openapi.json"
else
  fail "spec input does not default to docs/api/openapi.json"
fi
if grep -qF 'OPENAPI_ALLOWLIST:-docs/api/openapi-internal-routes.json' "$SCRIPT"; then
  pass "allowlist input defaults to docs/api/openapi-internal-routes.json"
else
  fail "allowlist input does not default to docs/api/openapi-internal-routes.json"
fi
if grep -qF 'OPENAPI_API_DIR:-web/src/app/api' "$SCRIPT"; then
  pass "API dir input defaults to web/src/app/api"
else
  fail "API dir input does not default to web/src/app/api"
fi

# The spec-validity check is the prod-500 guard. Assert the gate runs jq against
# the spec — without it a malformed spec would only be caught downstream (by the
# /api/openapi 500 in production), which is the exact failure this gate exists to
# move left. The literal "$SPEC" in the needle is the gate's own code, not a var
# to expand here — hence the disable.
# shellcheck disable=SC2016
if grep -qE 'jq empty "\$SPEC"' "$SCRIPT"; then
  pass "gate validates the spec with jq (the prod-500 guard)"
else
  fail "gate does not jq-validate the spec — the malformed-spec 500 class is not caught"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure documented at the
# top of this file. Piping a large variable into grep/awk (via `echo`) lets the
# reader close the pipe on an early match and SIGPIPE the upstream writer;
# pipefail then reports the whole pipeline as failed — a real match misreported
# as a miss. The fix is here-strings (`grep PAT <<<"$var"`). This guard fails if
# the antipattern is reintroduced anywhere in this suite. The needle glues `echo`
# to `[[:space:]]` (no space between) so this guard line can never match itself.
SELF="${BASH_SOURCE[0]}"
if grep -nE 'echo[[:space:]]+"\$[A-Za-z_][A-Za-z0-9_]*"[[:space:]]*\|[[:space:]]*(grep|awk)' "$SELF" >/dev/null; then
  fail "a variable's echo output is piped into grep/awk — feed it via a here-string (see the SIGPIPE-safe note at the top) to stay correct under pipefail"
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
