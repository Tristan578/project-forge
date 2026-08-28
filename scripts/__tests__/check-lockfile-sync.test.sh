#!/usr/bin/env bash
# Unit tests for scripts/check-lockfile-sync.sh — the lockfile-drift gate —
# plus structural assertions that the gate is wired into ci.yml's required
# `ci-success` aggregate (a standalone path-filtered workflow can never be a
# safe required check, so the gate has to ride the existing ci-gate/ci-success
# pattern instead).
#
# WHY THIS GATE EXISTS
# --------------------
# This is a single-root-lockfile monorepo: only ONE package-lock.json (repo
# root) governs web/, mcp-server/ and the root workspace. A Dependabot npm PR
# scoped to `directory: /web` (or a hand-edit) can change web/package.json
# WITHOUT regenerating the root lockfile. The manifest range then no longer
# matches the pinned lockfile version, and every `npm ci` (which all of CI and
# the Quality Gates jobs run) fails with EUSAGE on main. This happened twice
# (#8655, #8658 → #8683). `npm ci`'s own EUSAGE check only fires AFTER such a
# change lands; this gate fires BEFORE merge, deterministically.
#
# HERMETIC TESTING
# ----------------
# The gate's real regeneration step (`npm install --package-lock-only`) needs
# the network and is environment-sensitive, so the script reads the regenerate
# command from $LOCKFILE_REGEN_CMD. These tests inject a stub command that
# simulates the outcomes (no-op = in sync, mutate = drift, partial-write+fail,
# hard-fail) in a throwaway git repo. The real npm invocation is exercised by
# CI, not here — these tests pin the branching/exit-code/messaging contract.
set -uo pipefail

# SIGPIPE-safe matching: feed grep/awk from a here-string — `grep PAT <<<"$var"`
# — and never pipe a large variable's `echo` output into grep/awk. Under
# `pipefail`, `grep -q` closes the pipe on its FIRST match; on a payload larger
# than the runner's pipe buffer (e.g. the ~31 KB ci.yml read below) the
# still-writing `echo` then takes SIGPIPE, which `pipefail` turns into a non-zero
# pipeline status — silently converting a real match into a false "missing"
# failure. That bit CI on the integration-wiring assertions. The structural
# guard at the end of this file keeps the antipattern from creeping back in.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-lockfile-sync.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }

# Build a throwaway git repo containing a committed root package-lock.json.
# Echoes the repo path. Caller is responsible for rm -rf.
# $1 (optional) is the JSON value for package.json's "overrides" key; the
# consistency stage derives its exclusion set from it.
make_repo() {
  local repo overrides="${1:-}"
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    printf '{\n  "name": "root",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n' > package-lock.json
    if [ -n "$overrides" ]; then
      printf '{\n  "name": "root",\n  "overrides": %s\n}\n' "$overrides" > package.json
    else
      printf '{\n  "name": "root"\n}\n' > package.json
    fi
    git add -A
    git commit -qm init
  )
  echo "$repo"
}

# Build a throwaway git repo whose committed lockfile carries package nodes with
# platform metadata (os/cpu/libc) — the shape some npm versions rewrite. Echoes
# the repo path; caller is responsible for rm -rf.
make_repo_platform() {
  local repo
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    jq -n '{
      name: "root",
      lockfileVersion: 3,
      packages: {
        "": {name: "root"},
        "node_modules/@img/sharp-linux-x64": {
          version: "0.34.1", resolved: "https://r/a.tgz", integrity: "sha512-a",
          cpu: ["x64"], os: ["linux"], libc: ["glibc"]
        },
        "node_modules/@next/swc-linux-x64-musl": {
          version: "16.0.1", resolved: "https://r/b.tgz", integrity: "sha512-b",
          cpu: ["x64"], os: ["linux"], libc: ["musl"]
        }
      }
    }' > package-lock.json
    printf '{\n  "name": "root"\n}\n' > package.json
    git add -A
    git commit -qm init
  )
  echo "$repo"
}

# Stage a jq filter as a FILE in $1 and echo a regen stub that applies it to the
# lockfile. Staging the program (rather than inlining it in the stub string)
# keeps quoting out of the eval'd command line — same rationale as ls_report.
# Usage: stub="$(jq_regen "$repo" 'del(.packages[].libc)')"
jq_regen() {
  local repo="$1" filter="$2"
  printf '%s\n' "$filter" > "$repo/.filter.jq"
  echo 'jq -f .filter.jq package-lock.json > .regen.json && mv .regen.json package-lock.json'
}

# Write a stub `npm ls --json` report into $1 carrying the given problem
# strings, and echo the consistency-stub command that emits it. Staging the
# JSON as a file (rather than inlining it in the stub string) keeps arbitrary
# problem text out of the eval'd command line.
# Usage: stub="$(ls_report "$repo" 'invalid: foo@1.0.0 /p' 'missing: bar@2.0.0, required by baz')"
ls_report() {
  local repo="$1"; shift
  jq -nc '{name: "root", version: "0.0.0", problems: $ARGS.positional}' --args "$@" > "$repo/.ls-report.json"
  echo 'cat .ls-report.json'
}

# Run the gate inside $repo with a given regenerate stub; echo "<exit>|<output>".
# $3 stubs the stage-1 consistency command and defaults to a problem-free `npm
# ls --json` report (healthy lockfile) so the stage-2 cases below stay focused
# on regen behaviour. The default must be VALID JSON, not `true`: the gate
# fail-closes (exit 2) on output it cannot parse, so a silent stub would abort
# every stage-2 case before it reached the code under test. Both seams MUST be
# injected on every run — leaving stage 1 unset would fall through to the real
# `npm ls`, which needs npm on PATH and a resolvable dependency graph, and the
# throwaway repo has neither.
CLEAN_LS_REPORT='printf "{\"name\":\"root\",\"problems\":[]}"'
run_gate() {
  local repo="$1" regen="$2" consistency="${3:-$CLEAN_LS_REPORT}" out rc
  out="$(cd "$repo" \
    && LOCKFILE_REGEN_CMD="$regen" LOCKFILE_CONSISTENCY_CMD="$consistency" bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-lockfile-sync.sh tests ==="

# --- 1. In sync: regen is a no-op → exit 0 + success message -----------------
repo="$(make_repo)"
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "in-sync lockfile passes (exit 0)"; else fail "in-sync should exit 0, got $rc"; fi
if grep -qi "in sync" <<<"$out"; then pass "in-sync prints a success message"; else fail "in-sync success message missing"; fi
rm -rf "$repo"

# --- 2. Drift: regen mutates the lockfile → exit 1 + drift message -----------
repo="$(make_repo)"
res="$(run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "drift fails (exit 1)"; else fail "drift should exit 1, got $rc"; fi
if grep -qi "drift detected" <<<"$out"; then pass "drift prints 'drift detected'"; else fail "drift message missing"; fi
if grep -q "npm install --package-lock-only" <<<"$out"; then pass "drift prints the remediation command"; else fail "remediation command missing"; fi
rm -rf "$repo"

# --- 3. Drift is non-destructive: gate exits 1 AND restores the working tree -
# Assert BOTH the exit code and the clean tree — a gate that silently passed on
# drift (rc 0) would still leave a clean tree, so the tree check alone is not
# enough to prove drift was detected.
repo="$(make_repo)"
res="$(run_gate "$repo" 'printf "\n  \"drift\": true\n" >> package-lock.json')"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "drift detection returns exit 1 (non-destructive case)"; else fail "drift should exit 1, got $rc"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "lockfile restored after drift (clean working tree)"
else
  fail "gate left the lockfile mutated"
fi
rm -rf "$repo"

# --- 4. Regen command itself fails → exit 1, clear message, surfaced output,
#        AND a partial write is rolled back ----------------------------------
# The stub writes a partial mutation and THEN fails, so this exercises the
# regen-failure restore branch (git checkout) that a `false`-only stub leaves
# untouched. It also emits a diagnostic on stderr that the gate MUST surface —
# silencing npm's real error turns an actionable failure into a cryptic one.
#
# The marker is ASSEMBLED at runtime ($(printf MARKER)) so the literal command
# string the gate echoes ("regeneration command failed: <cmd>") can never
# contain the resolved "REGEN_DIAG_MARKER" — the assertion below therefore only
# passes if the gate genuinely captured and surfaced the command's own stderr,
# not merely re-printed the command it ran.
repo="$(make_repo)"
# SC2016: the $(printf MARKER) is intentionally NOT expanded by this shell — the
# stub string is passed verbatim to the gate, which evals it. Resolving it here
# would defeat the test (see the marker-assembly note above).
# shellcheck disable=SC2016
res="$(run_gate "$repo" 'printf "\n  \"partial\": true\n" >> package-lock.json; printf "REGEN_DIAG_%s\n" "$(printf MARKER)" >&2; false')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "regen failure fails (exit 1)"; else fail "regen failure should exit 1, got $rc"; fi
if grep -qi "regeneration command failed" <<<"$out"; then pass "regen failure has clear message"; else fail "regen failure message missing"; fi
if grep -q "REGEN_DIAG_MARKER" <<<"$out"; then pass "regen failure surfaces the command's own output"; else fail "regen failure swallowed the underlying diagnostic"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "partial write rolled back on regen failure (clean working tree)"
else
  fail "gate left a partial lockfile write after regen failure"
fi
rm -rf "$repo"

# --- 5. No lockfile present → exit 1 -----------------------------------------
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && printf '{}' > package.json && git add -A && git commit -qm init )
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "missing lockfile fails (exit 1)"; else fail "missing lockfile should exit 1, got $rc"; fi
if grep -qi "not found" <<<"$out"; then pass "missing lockfile has clear message"; else fail "missing lockfile message missing"; fi
rm -rf "$repo"

# --- 6. Stage 1: internally inconsistent lockfile → exit 1 + clear message ----
# THE BLIND SPOT THIS STAGE CLOSES (#9070, PF-1049). Stage 2 regenerates and
# diffs, which catches a MISSING relock but NOT an internally INCONSISTENT
# lockfile: one whose workspace entries record the NEW dependency range while
# the resolved package nodes still carry the OLD version. npm reads the recorded
# ranges, concludes the manifests are already satisfied, and re-resolves
# nothing — so the regeneration is a no-op, `git diff --quiet` passes, and the
# gate reports "in sync" on a lockfile that makes `npm ci` fail with EUSAGE.
# That shipped: web/ and apps/docs/ moved to @playwright/test ^1.62.1, the
# lockfile recorded ^1.62.1, its resolved nodes stayed at 1.62.0, every gate was
# green, and only Vercel's frozen `npm ci` caught it.
#
# The stub reproduces the exact edge that shipped: @playwright/test resolved to
# 1.62.0 while web/ requires ^1.62.1.
repo="$(make_repo)"
stub="$(ls_report "$repo" 'invalid: @playwright/test@1.62.0 /r/web/node_modules/@playwright/test')"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "internally inconsistent lockfile fails (exit 1)"; else fail "inconsistent lockfile should exit 1, got $rc"; fi
if grep -qi "internally inconsistent" <<<"$out"; then pass "inconsistency has a clear, distinct message"; else fail "inconsistency message missing (indistinguishable from plain drift)"; fi
if grep -q "@playwright/test@1.62.0" <<<"$out"; then pass "inconsistency surfaces the offending edge verbatim"; else fail "inconsistency swallowed the underlying diagnostic — un-actionable failure"; fi
# The remediation MUST NOT be a bare `npm install --package-lock-only`: that is
# precisely the command that no-ops against this state (it was tried three ways
# on #9070 and changed nothing). A gate that prints a fix which cannot work
# sends the next person down the same dead end, so pin the honest guidance.
if grep -qi "will NOT repair" <<<"$out"; then pass "inconsistency warns that a plain relock will not fix it"; else fail "inconsistency remediation omits the 'plain relock no-ops' warning"; fi
if grep -q "jq" <<<"$out"; then pass "inconsistency prints the node-deletion remediation that actually works"; else fail "inconsistency remediation missing the drop-stale-nodes recipe"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "consistency check is non-destructive (clean working tree)"
else
  fail "consistency stage mutated the lockfile"
fi
rm -rf "$repo"

# --- 7. Stage ORDER: consistency runs before regeneration --------------------
# Order is load-bearing, not cosmetic. Stage 2 mutates package-lock.json in
# place, so a consistency check running after it would inspect the REGENERATED
# file rather than the committed one — measuring npm's own output instead of
# what the PR actually ships, i.e. exactly the no-op that hid the bug. Prove the
# ordering behaviourally: fail stage 1 and assert the regen stub never ran.
repo="$(make_repo)"
stub="$(ls_report "$repo" 'invalid: @playwright/test@1.62.0 /r/web/node_modules/@playwright/test')"
res="$(run_gate "$repo" 'touch REGEN_RAN' "$stub")"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "stage-1 failure short-circuits the gate (exit 1)"; else fail "stage-1 failure should exit 1, got $rc"; fi
if [ -e "$repo/REGEN_RAN" ]; then
  fail "regeneration ran despite a stage-1 failure — consistency is checked against the REGENERATED lockfile, not the committed one"
else
  pass "consistency is checked against the pristine committed lockfile (regen not yet run)"
fi
rm -rf "$repo"

# --- 8. Zero problems → stage 1 passes through to stage 2 --------------------
repo="$(make_repo)"
stub="$(ls_report "$repo")"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "problem-free report passes stage 1 (exit 0)"; else fail "problem-free report should exit 0, got $rc"; fi
if grep -qi "in sync" <<<"$out"; then pass "problem-free report reaches the stage-2 success message"; else fail "problem-free report did not proceed past stage 1"; fi
rm -rf "$repo"

# --- 8b. `overrides` are NOT drift: npm's exit code is unusable here ---------
# THE CALIBRATION THAT MAKES THIS GATE SURVIVABLE. An `overrides` entry
# deliberately forces a version outside a declared range, and npm reports every
# such edge as `invalid` — the real repo's HEALTHY lockfile yields 8 of them
# (postcss, @clerk/shared, sharp, undici, esbuild, dompurify, js-cookie, ws) and
# a permanent `npm ls` exit 1. A gate keyed on that exit code, or on a text
# match for /invalid/, is red on every single PR — and a permanently-red gate
# gets deleted, not fixed. The verdict must be the problem set MINUS the
# override-forced packages. Mutation-provable: key the gate on npm's exit code
# and this case goes red.
repo="$(make_repo '{"postcss": ">=8.5.18", "next": {"sharp": "^0.35.0"}}')"
stub="$(ls_report "$repo" \
  'invalid: postcss@8.5.23 /r/node_modules/postcss' \
  'invalid: sharp@0.35.3 /r/node_modules/sharp')"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "override-forced 'invalid' edges are not reported as drift (exit 0)"; else fail "override-forced edges failed the gate (got $rc) — gate would be red on every PR"; fi
if grep -qi "in sync" <<<"$out"; then pass "override-only problems pass through to stage 2"; else fail "override-only problems did not reach stage 2"; fi
rm -rf "$repo"

# --- 8c. A NESTED override excludes the child, and only the child ------------
# `{"next": {"sharp": "..."}}` forces sharp, NOT next. Excluding the parent key
# would blind the gate to genuine drift on `next` itself. Assert the parent is
# still reportable while the child is excluded.
repo="$(make_repo '{"next": {"sharp": "^0.35.0"}}')"
stub="$(ls_report "$repo" \
  'invalid: sharp@0.35.3 /r/node_modules/sharp' \
  'invalid: next@16.0.1 /r/node_modules/next')"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "nested override does not exempt its PARENT package (exit 1)"; else fail "nested override key exempted the parent too (got $rc) — real drift on 'next' would be invisible"; fi
if grep -q 'next@16.0.1' <<<"$out"; then pass "the parent's offending edge is reported"; else fail "parent edge not reported"; fi
if grep -q 'sharp@0.35.3' <<<"$out"; then fail "nested-override child 'sharp' was reported as drift"; else pass "nested-override child is excluded"; fi
rm -rf "$repo"

# --- 8d. Fail CLOSED on unusable output, and on an unparseable problem -------
# A consistency command that emits no JSON (npm crashed, wrong flags, empty) is
# a TOOLING failure, not a pass. Exit 2 distinguishes it from a real finding so
# a broken runner can't be mistaken for a clean lockfile.
repo="$(make_repo)"
res="$(run_gate "$repo" "true" 'printf "npm error code ENOENT\n"')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "non-JSON consistency output fails closed (exit 2)"; else fail "non-JSON output should exit 2 (tooling error), got $rc"; fi
if grep -qi "parseable JSON" <<<"$out"; then pass "non-JSON output names the tooling failure"; else fail "non-JSON failure message missing"; fi
rm -rf "$repo"

# An unrecognized problem STRING (a future npm format change) must be KEPT as a
# finding, never silently dropped. This is the fail-open trap in the parse: jq's
# `capture(...)?` yields EMPTY, and `(empty) as $x | body` iterates zero times,
# so a bare `?` makes the problem vanish. Mutation-provable: revert the gate's
# `[... capture(...)?] | first` to a bare `capture(...)?` and this case goes red.
repo="$(make_repo '{"postcss": ">=8.5.18"}')"
stub="$(ls_report "$repo" 'SOMETHING NPM HAS NOT INVENTED YET')"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "unparseable problem string is kept as a finding (exit 1, fails closed)"; else fail "unparseable problem was silently dropped (got $rc) — gate fails OPEN on an npm format change"; fi
if grep -q "SOMETHING NPM HAS NOT INVENTED YET" <<<"$out"; then pass "unparseable problem is surfaced verbatim"; else fail "unparseable problem not surfaced"; fi
rm -rf "$repo"

# No root package.json means the overrides exclusion set cannot be derived. The
# tempting shortcut — treat a missing manifest as "no overrides" — silently
# converts every override-forced edge into a false finding, so it must fail
# closed instead.
repo="$(mktemp -d)"
( cd "$repo" && git init -q && git config user.email t@t.t && git config user.name t \
    && printf '{\n  "name": "root",\n  "lockfileVersion": 3,\n  "packages": {}\n}\n' > package-lock.json \
    && git add -A && git commit -qm init )
res="$(run_gate "$repo" "true")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "missing root package.json fails closed (exit 2)"; else fail "missing manifest should exit 2, got $rc"; fi
if grep -qi "overrides" <<<"$out"; then pass "missing manifest names the exclusion set it could not derive"; else fail "missing-manifest message does not explain why the manifest is needed"; fi
rm -rf "$repo"

# --- 9. Consistency stage failure is distinguishable from regen failure -------
# The three failure classes (inconsistent lockfile / stale lockfile / npm broke)
# need different fixes, so they must not collapse into one message. Assert the
# stage-1 failure does NOT claim drift and does NOT claim the command failed.
repo="$(make_repo)"
stub="$(ls_report "$repo" 'invalid: @playwright/test@1.62.0 /r/web/node_modules/@playwright/test')"
res="$(run_gate "$repo" "true" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "stage-1 failure exits 1"; else fail "stage-1 failure should exit 1, got $rc"; fi
if grep -qi "drift detected" <<<"$out"; then
  fail "stage-1 failure is mislabelled as lockfile drift — sends the reader to the wrong fix"
else
  pass "stage-1 failure is not mislabelled as drift"
fi
if grep -qi "regeneration command failed" <<<"$out"; then
  fail "stage-1 failure is mislabelled as a regeneration failure"
else
  pass "stage-1 failure is not mislabelled as a regen-command failure"
fi
rm -rf "$repo"

# --- 10. Toolchain artifact: platform-metadata-only rewrite is NOT drift ------
# THE FALSE ACCUSATION THIS CLOSES. `npm install --package-lock-only` rewrites
# platform metadata on the Linux-only optional native bindings on SOME npm
# versions: npm 11.10.0 (bundled with Node 25) drops the "libc" field from 34
# nodes in this repo's lockfile, while npm 11.16.0 (bundled with Node 24, which
# .node-version pins) preserves it. Measured three ways on one macOS host — and
# npm 11.16.0 run under Node 25 produces ZERO drift — so the variable is the npm
# VERSION, not the OS and not the Node version.
#
# Reported as drift, that is a false accusation with an unactionable remedy: the
# printed fix ("npm install --package-lock-only") is the very command that
# produced it, so re-running reproduces the identical diff forever. It must be
# classified as a tooling error (exit 2, the house fail-closed convention) and
# name the real cause.
repo="$(make_repo_platform)"
stub="$(jq_regen "$repo" 'del(.packages[].libc)')"
res="$(run_gate "$repo" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "2" ]; then pass "platform-metadata-only rewrite fails closed as a tooling error (exit 2)"; else fail "metadata-only rewrite should exit 2 (tooling error), got $rc"; fi
if grep -qi "artifact" <<<"$out"; then pass "artifact case names itself as a toolchain artifact"; else fail "artifact case does not identify itself as a toolchain artifact"; fi
# The whole point is that this must NOT read as contributor drift. Pin the
# absence of the accusation, not just the presence of the new message: a gate
# that printed both would still send the reader to the wrong fix first.
if grep -qi "drift detected" <<<"$out"; then
  fail "artifact case is mislabelled as lockfile drift — blames the contributor for a toolchain rewrite"
else
  pass "artifact case is not mislabelled as contributor drift"
fi
if grep -qi "package.json was changed without regenerating" <<<"$out"; then
  fail "artifact case prints the false 'you forgot to relock' accusation"
else
  pass "artifact case omits the false 'you forgot to relock' accusation"
fi
if grep -q "npm running here" <<<"$out"; then pass "artifact case reports the npm version actually running"; else fail "artifact case does not name the running npm version — the one variable that matters"; fi
if grep -qF ".node-version" <<<"$out"; then pass "artifact case points at the .node-version pin"; else fail "artifact case does not reference .node-version"; fi
if (cd "$repo" && git diff --quiet -- package-lock.json); then
  pass "artifact case is non-destructive (lockfile restored)"
else
  fail "artifact case left the lockfile mutated"
fi
rm -rf "$repo"

# --- 10b. The classifier must NOT swallow real drift -------------------------
# Each of these mutations survives stripping os/cpu/libc, so each must still take
# the exit-1 contributor-drift path. This is the mutation-provable guard on the
# classifier: widen it to ignore anything else (e.g. `version`) and these go red.
#
# `integrity` pins the tarball, so a given version can never legitimately change
# its own platform metadata — which is exactly why stripping those three keys is
# safe and why every real resolution change shows up here.
for spec in \
  'version bump|.packages["node_modules/@img/sharp-linux-x64"].version = "0.34.2"' \
  'resolved-URL change|.packages["node_modules/@img/sharp-linux-x64"].resolved = "https://r/c.tgz"' \
  'integrity change|.packages["node_modules/@img/sharp-linux-x64"].integrity = "sha512-c"' \
  'node added|.packages["node_modules/brand-new"] = {version: "1.0.0"}' \
  'node removed|del(.packages["node_modules/@next/swc-linux-x64-musl"])' \
  'top-level field change|.lockfileVersion = 2'
do
  label="${spec%%|*}"; filter="${spec#*|}"
  repo="$(make_repo_platform)"
  stub="$(jq_regen "$repo" "$filter")"
  res="$(run_gate "$repo" "$stub")"
  rc="${res%%|*}"; out="${res#*|}"
  if [ "$rc" = "1" ]; then pass "real drift ($label) still fails as drift (exit 1)"; else fail "real drift ($label) should exit 1, got $rc — classifier is swallowing genuine drift"; fi
  if grep -qi "drift detected" <<<"$out"; then pass "real drift ($label) is reported as drift"; else fail "real drift ($label) not reported as drift"; fi
  rm -rf "$repo"
done

# --- 10c. Artifact noise must not MASK co-occurring real drift ----------------
# The realistic case on a contributor's machine: a genuine manifest bump AND the
# local npm's metadata rewrite land in the same regeneration. The verdict must be
# exit 1 (there is real drift to fix); the artifact branch only fires when there
# is nothing else. A classifier that checked "did any platform metadata change?"
# instead of "is anything left after stripping it?" would fail open right here.
repo="$(make_repo_platform)"
stub="$(jq_regen "$repo" 'del(.packages[].libc) | .packages["node_modules/@img/sharp-linux-x64"].version = "0.34.2"')"
res="$(run_gate "$repo" "$stub")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "metadata noise does not mask co-occurring real drift (exit 1)"; else fail "real drift was masked by platform-metadata noise (got $rc) — gate fails OPEN"; fi
if grep -qi "drift detected" <<<"$out"; then pass "mixed case is reported as drift"; else fail "mixed case not reported as drift"; fi
# Diagnosability: the reader is staring at a diff whose bulk is toolchain noise,
# so the report has to say which part is signal or they will chase the wrong one.
if grep -qi "platform metadata" <<<"$out"; then pass "mixed case flags the toolchain noise inside the diff"; else fail "mixed case does not warn that part of the diff is toolchain noise"; fi
rm -rf "$repo"

# --- 10d. A pure reformat is not drift either --------------------------------
# Semantically identical output that merely serializes differently is the same
# class of non-signal: nothing about the manifests changed. It must not be
# reported as contributor drift.
# `jq -c` re-serializes compactly: every byte of the file changes while not one
# value does. (A plain `jq .` would be byte-identical to the fixture and prove
# nothing — the gate would never even reach the diff branch.)
repo="$(make_repo_platform)"
res="$(run_gate "$repo" 'jq -c . package-lock.json > .regen.json && mv .regen.json package-lock.json')"
rc="${res%%|*}"; out="${res#*|}"
# Vacuity guard: exit 0 means the gate reported "in sync", i.e. the stub left no
# textual diff and the classifier was never reached. That would make the
# assertion below pass for the wrong reason, so catch it explicitly.
if [ "$rc" = "0" ]; then
  fail "reformat stub produced no textual diff — this case never exercised the classifier"
elif [ "$rc" != "1" ]; then
  pass "a semantics-preserving reformat is not reported as contributor drift"
else
  fail "a semantics-preserving reformat was reported as drift (exit 1)"
fi
if grep -qi "drift detected" <<<"$out"; then fail "reformat mislabelled as drift"; else pass "reformat is not mislabelled as drift"; fi
rm -rf "$repo"

# --- 10e. Unclassifiable input falls back to the conservative drift report ----
# If the regenerated file is not parseable JSON, the classifier cannot prove the
# difference is benign — so it must NOT reach the artifact branch. Falling back
# to exit 1 keeps the pre-existing conservative behaviour rather than inventing a
# third verdict for a case that is a genuine problem either way.
repo="$(make_repo_platform)"
res="$(run_gate "$repo" 'printf "not json at all\n" > package-lock.json')"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "unparseable regenerated lockfile falls back to the drift report (exit 1)"; else fail "unparseable regenerated lockfile should exit 1, got $rc — classifier must not pass it as an artifact"; fi
rm -rf "$repo"

echo ""
echo "=== ci.yml integration wiring ==="
# A standalone path-filtered workflow cannot be a SAFE required check: a PR that
# touches none of its paths never starts it, so GitHub reports 'Expected'
# forever and the PR is blocked indefinitely. The only safe way to enforce a
# path-sensitive gate in this repo is to ride the ci-gate → ci-success pattern:
# a job that is skipped (not failed) on irrelevant PRs, and is in ci-success's
# `needs:` so it is required when it DOES run. These assertions pin that wiring
# so a future edit cannot silently demote the gate back to advisory-only.
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"

  if grep -qE '^  lockfile-sync:' <<<"$ci"; then
    pass "ci.yml defines a lockfile-sync job"
  else
    fail "ci.yml has no lockfile-sync job (gate is not in the required pipeline)"
  fi

  if grep -qE 'needs-deps:' <<<"$ci"; then
    pass "ci-gate exposes a needs-deps output"
  else
    fail "ci-gate has no needs-deps output to gate the lockfile job on"
  fi

  # The deps detector must match a package.json at ANY depth (apps/*, packages/*,
  # web/, mcp-server/) — not just the root — AND the root lockfile. Assert against
  # the LITERAL detection line (the one that sets deps=true), not the mere
  # presence of the tokens somewhere in the file: 'package.json' and 'deps=true'
  # both appear in dozens of unrelated places, so the old two-token check was a
  # tautology that would still pass even if the detection regex were gutted.
  deps_line="$(grep -F 'deps=true' <<<"$ci")"
  if grep -qF '(^|/)package\.json$' <<<"$deps_line" \
     && grep -qF '^package-lock\.json$' <<<"$deps_line"; then
    pass "ci-gate deps detection regex keys on package.json (any depth) + root lockfile"
  else
    fail "ci-gate deps=true line does not key on package.json/lockfile changes"
  fi

  # The gate's OWN script must be in the trigger (same convention as the agentic,
  # ghaw and api gates). Without it a PR that edits check-lockfile-sync.sh changes
  # the gate without ever running it, so a regression in the gate ships green and
  # surfaces only on the next unrelated manifest PR.
  if grep -qF '^scripts/check-lockfile-sync\.sh$' <<<"$deps_line"; then
    pass "ci-gate deps trigger includes the gate script itself (a gate edit exercises the gate)"
  else
    fail "ci-gate deps=true line omits scripts/check-lockfile-sync.sh — the gate is not run by PRs that modify it"
  fi

  # The ci-gate "No relevant changes — downstream jobs will be skipped" diagnostic
  # must account for `deps`. A manifest-only PR (e.g. a Dependabot web/ bump) sets
  # any_code=false, hooks=false, but deps=true — the lockfile-sync gate DOES run.
  # If the diagnostic's guard ignores deps it prints "downstream jobs will be
  # skipped" on exactly the PRs the gate is meant to catch, a misleading log that
  # invites a reader to assume nothing ran. Assert the guard keys on deps too. The
  # `if:` precedes the echo, so pull the line before the message.
  norel_if="$(awk '/No relevant changes — downstream jobs/{print prev} {prev=$0}' <<<"$ci")"
  if grep -qF 'deps' <<<"$norel_if"; then
    pass "ci-gate 'no relevant changes' diagnostic accounts for deps (manifest-only PRs)"
  else
    fail "ci-gate 'no relevant changes' guard ignores deps — mislabels manifest-only PRs as no-op"
  fi

  # Extract the whole lockfile-sync job block (header → next 2-space job header).
  # The awk start-condition '/^  lockfile-sync:/' requires ':' immediately after
  # 'lockfile-sync', so it fires ONLY on the exact '  lockfile-sync:' header — the
  # later '  lockfile-sync-tests:' header (a '-' sits where the ':' would be) does
  # NOT start a second block. The block then terminates at the exit guard, which
  # fires on the first following 2-space job header that is NOT '  lockfile-sync:'
  # — i.e. '  lockfile-sync-tests:'. (That header line is printed before the guard
  # exits, so it is ls_block's last line; the lockfile-sync-tests job body — incl.
  # its own if: — is not part of the block.)
  ls_block="$(awk '/^  lockfile-sync:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync:/{exit}' <<<"$ci")"

  # Defense-in-depth against a constant-false unwiring. The job's `if:` MUST key
  # on `needs-deps == 'true'`. Why this matters as a SEPARATE check from the
  # ci-success anti-tamper: the anti-tamper only fires when needs-deps=true AND
  # the gate is skipped — it catches an `if: false` the moment a real drift PR
  # (which changes a manifest → needs-deps=true) arrives, but NOT the PR that
  # *introduces* the `if: false` if that PR touches no manifest (needs-deps=false
  # → the gate legitimately skips → anti-tamper stays quiet). That introducing PR
  # does edit ci.yml, though, so it sets needs-ci=true and runs THIS suite — and
  # this assertion catches the constant-false at introduction time, closing the
  # window the anti-tamper alone leaves open.
  #
  # Containment alone is NOT enough, and it is not enough in a way that reads
  # green. GitHub's YAML parser keeps the LAST of two duplicate keys, so
  # APPENDING a second job-level `if: false` leaves the original needs-deps line
  # byte-identical and still matching the greps below, while the job that
  # actually runs is gated on a constant false. On the `pull_request` path
  # GitHub runs the PR's OWN workflow file, so the mutation takes effect in the
  # very run that should have caught it. Count the key at ITS OWN indent level
  # first (4 spaces = job level; a deeper-indented step `if:` is legitimate and
  # must not be counted) and require exactly one. actionlint flags duplicate
  # keys, but it is not wired into this repo's CI — this pin is the backstop
  # (#9031).
  ls_if_count="$(grep -cE '^    ["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$ls_block" || true)"
  if [ "$ls_if_count" -ne 1 ]; then
    fail "lockfile-sync job has $ls_if_count job-level if: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended constant-false if: unwires the gate while the original if: line still greps as present)"
  else
    pass "lockfile-sync job has exactly 1 job-level if: key (a duplicate cannot shadow the pin below)"
  fi
  ls_if="$(grep -E '^    ["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$ls_block")"
  if grep -qF 'needs-deps' <<<"$ls_if" && grep -qF "== 'true'" <<<"$ls_if"; then
    pass "lockfile-sync job if: keys on needs-deps == 'true' (a constant if:false is caught here)"
  else
    fail "lockfile-sync job if: is not gated on needs-deps == 'true' (possible constant-false unwiring)"
  fi

  # Scope this to the EXTRACTED job block, not the whole ci.yml: the script name
  # also appears in the self-defense job's comment + shellcheck list, so a broad
  # `<<<"$ci"` match would still PASS if the actual `run: bash …` line were deleted
  # from THIS job while a comment/shellcheck-list mention elsewhere kept the token
  # alive — a false green with the gate no longer invoked.
  #
  # …and scope the invocation pin to the gate's own STEP block, with the same
  # duplicate-key count as the job-level `if:` above. Appending a second `run:`
  # to this step replaces the command under last-key-wins while the original
  # `run: bash scripts/check-lockfile-sync.sh` line stays present and satisfies
  # a containment grep — the step is dead and every pin on it reads green.
  ls_step="$(awk '
    !f && /^      - name:/ && index($0, "Check root lockfile is in sync with the manifests") {f=1; print; next}
    f && /^      - /{exit}
    f && !/^        / && !/^[[:space:]]*$/{exit}
    f {print}
  ' <<<"$ls_block")"
  if [ -z "$ls_step" ]; then
    fail "lockfile-sync job has no step named 'Check root lockfile is in sync with the manifests' — the step cut read nothing, so the run: count and invocation pins below would pass vacuously"
  else
    ls_run_count="$(grep -cE '^[[:space:]]*["'"'"']?run["'"'"']?[[:space:]]*:' <<<"$ls_step" || true)"
    if [ "$ls_run_count" -ne 1 ]; then
      fail "lockfile-sync gate step has $ls_run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended run: silently replaces the gate invocation while the original run: line still greps as present)"
    else
      pass "lockfile-sync gate step has exactly 1 run: key"
    fi
    if grep -qE '^[[:space:]]*run: bash scripts/check-lockfile-sync\.sh[[:space:]]*$' <<<"$ls_step"; then
      pass "lockfile-sync job runs scripts/check-lockfile-sync.sh as that step's whole run: line"
    else
      fail "lockfile-sync gate step does not run 'bash scripts/check-lockfile-sync.sh' as its whole run: line — neutered, rewritten, or comment-suffixed"
    fi
  fi
  if grep -qF 'run: bash scripts/check-lockfile-sync.sh' <<<"$ls_block"; then
    pass "lockfile-sync job runs scripts/check-lockfile-sync.sh"
  else
    fail "lockfile-sync job block never invokes the gate script via run:"
  fi

  # SECURITY: $LOCKFILE_REGEN_CMD is a TEST-ONLY seam (the hermetic suite injects it
  # via run_gate). It must NEVER appear in an EXECUTABLE line of the real lockfile-sync
  # job. A PR that wired `env: LOCKFILE_REGEN_CMD: 'true'` into the job would make the
  # gate `eval 'true'` — a no-op: it regenerates nothing, `git diff --quiet` passes, and
  # the gate exits 0 "in sync" while real drift slips through. The ci-success anti-tamper
  # cannot catch this (the job result is `success`, not `skipped`, so the
  # skip-while-triggered check stays quiet). But a wiring PR edits ci.yml → needs-ci=true
  # → runs THIS suite, so this assertion fails that required check at introduction time,
  # closing the gap that otherwise leaves human review as the only defense.
  #
  # COMMENT-STRIP: the naive ls_block (job header → next job header) also captures the
  # doc-comment block that PRECEDES the lockfile-sync-tests: header — and that prose
  # legitimately names $LOCKFILE_REGEN_CMD ("injects a stub ..."). Strip full-comment
  # lines first so the check keys on real YAML/shell, not documentation; an attacker's
  # `env:` wiring is a non-comment line and is still caught. ls_block is one job block
  # Capture before testing so `grep -q` cannot SIGPIPE the comment stripper.
  ls_executable="$(grep -v '^[[:space:]]*#' <<<"$ls_block" || true)"
  if grep -q 'LOCKFILE_REGEN_CMD' <<<"$ls_executable"; then
    fail "lockfile-sync job exposes the LOCKFILE_REGEN_CMD test seam in an executable line — gate can be no-op'd into a false pass"
  else
    pass "lockfile-sync job does not wire the LOCKFILE_REGEN_CMD test seam (gate cannot be bypassed via job env)"
  fi

  # SECURITY: identical rule for stage 1's seam. `env: LOCKFILE_CONSISTENCY_CMD:
  # 'true'` would make the gate skip the consistency check entirely and fall
  # straight through to the stage-2 diff — restoring the exact blind spot that
  # let #9070 ship green. Same comment-strip rationale as above (the prose in
  # this suite and the job's doc comment legitimately name the variable).
  if grep -q 'LOCKFILE_CONSISTENCY_CMD' <<<"$ls_executable"; then
    fail "lockfile-sync job exposes the LOCKFILE_CONSISTENCY_CMD test seam in an executable line — the consistency stage can be no-op'd into a false pass"
  else
    pass "lockfile-sync job does not wire the LOCKFILE_CONSISTENCY_CMD test seam (consistency stage cannot be bypassed via job env)"
  fi

  # ci-success's needs: list is the required-check surface. Pull the block from
  # 'ci-success:' to its steps: and assert lockfile-sync is one of its needs.
  # Anchor each match to the whole list entry ($) so '- lockfile-sync' cannot be
  # satisfied by the '- lockfile-sync-tests' entry (substring) and vice-versa.
  cisuccess_needs="$(awk '/^  ci-success:/{f=1} f{print} /^    steps:/{if(f)exit}' <<<"$ci")"
  if grep -qE '^      - lockfile-sync$' <<<"$cisuccess_needs"; then
    pass "ci-success requires the lockfile-sync job"
  else
    fail "lockfile-sync is not in ci-success needs — gate is not required"
  fi

  # The gate's OWN decision logic must be unit-tested by a REQUIRED check, not an
  # advisory one. A standalone path-filtered workflow can be left out of ci-success
  # (advisory), so a PR that neuters check-lockfile-sync.sh could merge even though
  # the suite fails. Pin the self-tests as a ci.yml job that rides ci-success — the
  # same pattern hook-tests uses — so unwiring the gate fails a REQUIRED check.
  if grep -qE '^  lockfile-sync-tests:' <<<"$ci"; then
    pass "ci.yml defines a lockfile-sync-tests job (gate self-tests are in the pipeline)"
  else
    fail "ci.yml has no lockfile-sync-tests job (gate self-tests are not in the required pipeline)"
  fi

  # Extract the whole lockfile-sync-tests job block (header → next job header) so
  # step assertions don't depend on a fixed grep -A window as steps are added.
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"

  if grep -qF 'bash scripts/__tests__/check-lockfile-sync.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests job runs the lockfile gate's bash suite"
  else
    fail "lockfile-sync-tests job does not run the lockfile gate bash suite"
  fi

  # The self-tests job must be gated on a REAL trigger (needs-ci fires on scripts/
  # and .github/workflows/ changes), not pinned to a constant. A future `if: false`
  # would permanently skip the job; because ci-success tolerates skips, the LAST
  # line of defense is the anti-tamper check in check-ci-success.sh (pinned by its
  # own suite). Here we assert today's wiring keys on needs-ci.
  if grep -qE 'needs-ci|needs\.ci-gate\.outputs' <<<"$lst_block"; then
    pass "lockfile-sync-tests job is gated on needs-ci (a real path trigger, not a constant)"
  else
    fail "lockfile-sync-tests job is not gated on needs-ci"
  fi

  # The same job also runs the ci-success verifier's own suite — that is what pins
  # the anti-tamper logic. Assert the run step is present so it can't be dropped.
  if grep -qF 'bash scripts/__tests__/check-ci-success.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests job also runs the ci-success verifier suite"
  else
    fail "lockfile-sync-tests job does not run the ci-success verifier suite"
  fi

  if grep -qE '^      - lockfile-sync-tests$' <<<"$cisuccess_needs"; then
    pass "ci-success requires the lockfile-sync-tests job"
  else
    fail "lockfile-sync-tests is not in ci-success needs — gate self-tests are not required"
  fi

  # The ci-success verify step must call the EXTRACTED, unit-tested verifier
  # (check-ci-success.sh), not an inline jq. The script carries the anti-tamper
  # check; a skip-tolerant inline jq would silently re-open the `if: false`
  # unwiring vector. Pin the call site.
  cisuccess_block="$(awk '/^  ci-success:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  ci-success:/{exit}' <<<"$ci")"
  if grep -qF 'bash scripts/check-ci-success.sh' <<<"$cisuccess_block"; then
    pass "ci-success runs the extracted, unit-tested verifier (check-ci-success.sh)"
  else
    fail "ci-success no longer calls check-ci-success.sh — anti-tamper logic may be bypassed"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
echo "=== gate script hardening (structural) ==="
# These pin properties of check-lockfile-sync.sh that are NOT observable as a
# portable runtime RED on this dev host, so we lock them structurally (each is
# mutation-provable: gut the property in the script and the matching case fails).
#
# WHY STRUCTURAL, NOT A SIGNAL RACE (regen_log cleanup): the gate captures npm's
# output to a mktemp file during a multi-second regeneration. If the job is
# cancelled (CI sends SIGTERM) mid-regen, that tmpfile must still be removed.
# macOS bash 3.2 (this host) DEFERS SIGTERM while waiting on a foreground child
# and then runs the fail-branch cleanup, so the leak simply does not reproduce
# here — only Linux bash 5.x (the CI runner), which does NOT run an EXIT trap on
# an *untrapped* SIGTERM, leaks. A behavioural signal test would therefore pass
# on macOS regardless of the fix (a fake green). We instead require the cleanup
# to be wired as an EXIT trap PLUS an explicit TERM/INT handler (the handler's
# `exit` is what makes the EXIT trap fire under Linux's signal semantics).

# #3 — regen_log is cleaned via an EXIT trap, not only an explicit happy-path rm.
if grep -Eq "trap .*rm -f .*regen_log.* EXIT" "$SCRIPT"; then
  pass "gate cleans up regen_log via an EXIT trap (covers early-exit / signal paths)"
else
  fail "gate has no EXIT trap for regen_log — a signal/early-exit between mktemp and cleanup leaks it"
fi

# #3 — the TERM (and INT) handler that forces the EXIT trap to run under Linux
# bash on CI cancellation. Without it the EXIT-only trap does NOT fire on an
# untrapped SIGTERM on the CI runner, so the tmpfile leaks exactly when it matters.
if grep -qF "trap 'exit 143' TERM" "$SCRIPT"; then
  pass "gate installs a TERM handler so the EXIT trap fires on CI cancellation (Linux bash)"
else
  fail "gate has no TERM handler — Linux bash won't run the EXIT trap on SIGTERM, leaking regen_log"
fi

# #3 — the matching INT (SIGINT / Ctrl-C) handler. The comment above and the gate
# itself treat TERM and INT as a pair (both force the EXIT trap to run under Linux's
# untrapped-signal semantics); assert INT too so a future edit cannot drop it while
# the TERM assertion alone stays green. Mutation-provable like the TERM check.
if grep -qF "trap 'exit 130' INT" "$SCRIPT"; then
  pass "gate installs an INT handler so the EXIT trap fires on interactive cancellation"
else
  fail "gate has no INT handler — the EXIT trap won't fire on an untrapped SIGINT, leaking regen_log"
fi

# #4 — SECURITY invariant: the DEFAULT regeneration command runs with
# --ignore-scripts so a hostile package.json lifecycle script in a PR cannot
# execute during CI lockfile regeneration. ($LOCKFILE_REGEN_CMD is a test-only
# seam, never set in CI, so the default is what actually runs.)
if grep -E '^(REGEN_CMD|BASE_REGEN)=' "$SCRIPT" | grep -q -- '--ignore-scripts'; then
  pass "default regen command runs with --ignore-scripts (no PR lifecycle scripts in CI)"
else
  fail "default regen command is missing --ignore-scripts — a PR package.json script could run in CI"
fi

# #6 — the DEFAULT consistency command must resolve from the lockfile ALONE.
# Without --package-lock-only, `npm ls` reads node_modules and reports the
# INSTALLED tree — which on a warm CI cache can satisfy every edge while the
# committed lockfile is still inconsistent (the same false green a warm local
# `npm ci` gives: "up to date in 1s"). The flag is what makes stage 1 measure
# the artifact under review rather than the runner's disk, and it is also what
# keeps the stage offline and free of node_modules writes.
if grep -E '^(CONSISTENCY_CMD|BASE_CONSISTENCY)=' "$SCRIPT" | grep -q -- '--package-lock-only'; then
  pass "default consistency command runs with --package-lock-only (resolves from the lockfile, not node_modules)"
else
  fail "default consistency command is missing --package-lock-only — it would grade the installed tree, not the committed lockfile"
fi

# #6 — the consistency stage must be single-sourced through BASE_CONSISTENCY for
# the same reason as BASE_REGEN: so what the gate runs and what it reports can
# never drift apart, and so the seam has exactly one default to audit.
if grep -qE '^BASE_CONSISTENCY=' "$SCRIPT"; then
  pass "gate defines a single-sourced BASE_CONSISTENCY"
else
  fail "gate has no BASE_CONSISTENCY — the consistency command has no single source"
fi

# #5 — the human remediation hint and the actual regen command single-source from
# $BASE_REGEN, so the "Fix: run ..." line printed to a developer cannot drift from
# the command the gate itself runs.
if grep -qE '^BASE_REGEN=' "$SCRIPT"; then
  pass "gate defines a single-sourced BASE_REGEN"
else
  fail "gate has no BASE_REGEN — remediation hint and regen command can drift apart"
fi
# SC2016: the single quotes are intentional — we assert the LITERAL token
# '$BASE_REGEN' appears in the script source (i.e. the echo references the
# variable rather than hardcoding the command), so it must NOT be expanded here.
# shellcheck disable=SC2016
if grep -A2 'Fix: from the repo root' "$SCRIPT" | grep -qF '$BASE_REGEN'; then
  pass "remediation hint echoes \$BASE_REGEN (single-sourced, cannot drift)"
else
  fail "remediation hint hardcodes the command instead of \$BASE_REGEN"
fi

echo ""
echo "=== suite hygiene (structural) ==="
# Regression lock for the SIGPIPE-under-pipefail false failure documented at the
# top of this file. Piping a large variable into grep/awk (via `echo`) lets the
# reader close the pipe on an early match and SIGPIPE the upstream writer;
# pipefail then reports the whole pipeline as failed — a real match misreported
# as a miss (this hit CI on the ~31 KB ci.yml). The fix is here-strings
# (`grep PAT <<<"$var"`). This guard fails if the antipattern is reintroduced
# anywhere in this suite. The needle below glues `echo` to `[[:space:]]` (no
# space between them), so this guard line can never match itself.
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
