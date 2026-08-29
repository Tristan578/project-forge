#!/usr/bin/env bash
# Unit tests for scripts/check-suite-wiring.sh — the orphan-test-suite gate.
#
# The bug class this suite locks down (PF-9451 / #9451): the CI Self-Defense
# Tests job names each of its suites in an explicit step, so a suite file added
# to scripts/__tests__/ without a matching step exists but never runs. Three
# suites had drifted into exactly that state — two of them guarding
# release/deploy-critical scripts (generate-wasm-manifests.sh feeds the R2 CDN
# manifests consumed at three points in cd.yml; changeset-version.sh is the
# version-script release.yml runs) — while the board stayed green.
#
# The suite is hermetic: it builds throwaway test-dir/workflow-dir trees under
# mktemp and drives the gate through its real contract (the two path seams plus
# the exit code). The SUITE_WIRING_TEST_DIRS / SUITE_WIRING_WORKFLOW_DIR seams
# are TEST-ONLY — the final section asserts no workflow wires either one, so the
# gate can never be pointed at an empty directory from CI config.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-suite-wiring.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

echo "=== check-suite-wiring.sh tests ==="

# Build a fixture tree: mkfixture <name> <suite-basenames...> — creates a tests/
# dir holding each named suite and an empty workflows/ dir. Wiring is added
# separately by wire().
mkfixture() {
  local name="$1"; shift
  mkdir -p "$TMPDIR_T/$name/tests" "$TMPDIR_T/$name/workflows"
  local suite
  for suite in "$@"; do
    printf '#!/usr/bin/env bash\nexit 0\n' >"$TMPDIR_T/$name/tests/$suite"
  done
}

# wire <name> <suite-basenames...> — append a workflow that names each suite.
wire() {
  local name="$1"; shift
  local wf="$TMPDIR_T/$name/workflows/ci.yml"
  {
    echo "jobs:"
    echo "  self-defense:"
    echo "    steps:"
    local suite
    for suite in "$@"; do
      echo "      - run: bash scripts/__tests__/$suite"
    done
  } >>"$wf"
}

# run_gate <name> — invoke the gate against fixture <name>; echoes output,
# returns the gate's exit code.
run_gate() {
  local name="$1"
  SUITE_WIRING_TEST_DIRS="$TMPDIR_T/$name/tests" \
  SUITE_WIRING_WORKFLOW_DIR="$TMPDIR_T/$name/workflows" \
    bash "$GATE" 2>&1
}

# ---- 1. Fully wired tree passes ----
mkfixture wired a.test.sh b.test.sh
wire wired a.test.sh b.test.sh
if out="$(run_gate wired)"; then
  pass "fully wired tree exits 0"
else
  fail "fully wired tree exited non-zero: $out"
fi
if grep -q 'all 2 test suite(s) are referenced' <<<"${out:-}"; then
  pass "success output reports the scanned suite count"
else
  fail "success output does not report the scanned suite count: ${out:-<empty>}"
fi

# ---- 2. An orphan fails, and is named in the output ----
mkfixture orphan a.test.sh orphan.test.sh
wire orphan a.test.sh
if out="$(run_gate orphan)"; then
  fail "an unreferenced suite did NOT fail the gate — the guard is inert"
else
  pass "an unreferenced suite fails the gate"
fi
if grep -q 'orphan.test.sh' <<<"${out:-}"; then
  pass "failure output names the orphan suite"
else
  fail "failure output does not name the orphan suite: ${out:-<empty>}"
fi
# The remediation pointer is what turns a red step into a fixable one; without
# it the next contributor re-derives the lockfile-sync-tests + pin dance.
if grep -q 'check-npm-audit.test.sh' <<<"${out:-}"; then
  pass "failure output points at the line-for-line pin that must be updated too"
else
  fail "failure output omits the check-npm-audit.test.sh pin reminder: ${out:-<empty>}"
fi

# ---- 3. Every orphan is reported, not just the first ----
mkfixture many a.test.sh o1.test.sh o2.test.sh
wire many a.test.sh
out="$(run_gate many)" || true
if grep -q 'o1.test.sh' <<<"$out" && grep -q 'o2.test.sh' <<<"$out"; then
  pass "all orphans are reported, not just the first"
else
  fail "not every orphan was reported: $out"
fi

# ---- 4. A partial-name match must NOT count as wiring ----
# `foo.test.sh` referenced in a workflow does not wire `foo-extra.test.sh`, but
# the reverse — a workflow naming `check-foo-extra.test.sh` — must not be read
# as wiring the shorter `foo-extra.test.sh`… it legitimately IS a substring, so
# the case that matters is the one the gate can get wrong in the UNSAFE
# direction: a suite whose basename is a PREFIX of a referenced one.
mkfixture prefix a.test.sh check.test.sh
wire prefix check-extended.test.sh
out="$(run_gate prefix)" || true
if grep -q 'a.test.sh' <<<"$out"; then
  pass "a suite named nowhere is still an orphan when other names are present"
else
  fail "orphan a.test.sh was not reported alongside an unrelated reference: $out"
fi

# ---- 5. Fail closed: empty test dir must not pass vacuously ----
mkdir -p "$TMPDIR_T/empty/tests" "$TMPDIR_T/empty/workflows"
printf 'jobs: {}\n' >"$TMPDIR_T/empty/workflows/ci.yml"
if out="$(run_gate empty)"; then
  fail "an EMPTY test directory passed — every wiring assertion would pass vacuously"
else
  pass "an empty test directory fails closed"
fi

# ---- 6. Fail closed: missing test dir ----
mkdir -p "$TMPDIR_T/nodir/workflows"
printf 'jobs: {}\n' >"$TMPDIR_T/nodir/workflows/ci.yml"
if SUITE_WIRING_TEST_DIRS="$TMPDIR_T/nodir/tests" \
   SUITE_WIRING_WORKFLOW_DIR="$TMPDIR_T/nodir/workflows" \
   bash "$GATE" >/dev/null 2>&1; then
  fail "a MISSING test directory passed — a renamed dir would silently disable the gate"
else
  pass "a missing test directory fails closed"
fi

# ---- 7. Fail closed: missing / empty workflow dir ----
mkfixture nowf a.test.sh
rm -rf "$TMPDIR_T/nowf/workflows"
if run_gate nowf >/dev/null 2>&1; then
  fail "a MISSING workflow directory passed — the gate would report every suite orphaned or none"
else
  pass "a missing workflow directory fails closed"
fi
mkfixture emptywf a.test.sh
if run_gate emptywf >/dev/null 2>&1; then
  fail "an EMPTY workflow directory passed — nothing could have been referenced"
else
  pass "an empty workflow directory fails closed"
fi

# ---- 8. Multiple scan dirs are all covered ----
mkdir -p "$TMPDIR_T/multi/tests1" "$TMPDIR_T/multi/tests2" "$TMPDIR_T/multi/workflows"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMPDIR_T/multi/tests1/a.test.sh"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMPDIR_T/multi/tests2/b.test.sh"
printf 'jobs:\n  x:\n    steps:\n      - run: bash a.test.sh\n' >"$TMPDIR_T/multi/workflows/ci.yml"
if out="$(SUITE_WIRING_TEST_DIRS="$TMPDIR_T/multi/tests1 $TMPDIR_T/multi/tests2" \
          SUITE_WIRING_WORKFLOW_DIR="$TMPDIR_T/multi/workflows" bash "$GATE" 2>&1)"; then
  fail "an orphan in the SECOND scan dir passed — only the first dir is scanned"
else
  pass "an orphan in the second scan dir is caught"
fi
if grep -q 'b.test.sh' <<<"$out"; then
  pass "the second scan dir's orphan is named in the output"
else
  fail "the second scan dir's orphan is not named: $out"
fi

# ---- 9. .yaml workflow files count as wiring ----
mkfixture yamlext a.test.sh
printf 'jobs:\n  x:\n    steps:\n      - run: bash a.test.sh\n' >"$TMPDIR_T/yamlext/workflows/ci.yaml"
if run_gate yamlext >/dev/null 2>&1; then
  pass ".yaml workflow files are scanned, not only .yml"
else
  fail ".yaml workflow files are ignored — a suite wired from one reads as an orphan"
fi

echo ""
echo "=== live repository state ==="

# ---- 10. The real repo must be orphan-free ----
if out="$(cd "$REPO_ROOT" && bash "$GATE" 2>&1)"; then
  pass "the live repository has no orphan test suites"
else
  fail "the live repository has orphan test suites: $out"
fi

echo ""
echo "=== ci.yml wiring (anti-unwiring) ==="

if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"
  # Cut the self-defense job block the same way the sibling suites do: from the
  # job key to the next 2-space job key.
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z0-9-]*:[[:space:]]*$/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"
  if [ -z "$lst_block" ]; then
    fail "ci.yml has no lockfile-sync-tests job block — the cut read nothing, so every assertion below would pass vacuously"
  else
    if grep -qF 'scripts/check-suite-wiring.sh scripts/__tests__/check-suite-wiring.test.sh' <<<"$lst_block"; then
      pass "self-defense job shellchecks the suite-wiring gate + this suite"
    else
      fail "self-defense job does not shellcheck the suite-wiring gate + this suite"
    fi
    if grep -qE '^[[:space:]]*run: bash scripts/__tests__/check-suite-wiring\.test\.sh[[:space:]]*$' <<<"$lst_block"; then
      pass "self-defense job runs this suite as a whole run: line"
    else
      fail "self-defense job does not run scripts/__tests__/check-suite-wiring.test.sh as a whole run: line"
    fi
    # The GATE itself — not just its unit suite — must run in CI, else a new
    # orphan is only caught by whoever happens to run the gate locally.
    if grep -qE '^[[:space:]]*run: bash scripts/check-suite-wiring\.sh[[:space:]]*$' <<<"$lst_block"; then
      pass "self-defense job runs the suite-wiring gate itself as a whole run: line"
    else
      fail "self-defense job does not run 'bash scripts/check-suite-wiring.sh' as a whole run: line — neutered, rewritten, or comment-suffixed"
    fi
    # The three suites this ticket un-orphaned must stay wired by name; a
    # revert of any one of them is exactly the regression PF-9451 fixed.
    for suite in generate-wasm-manifests.test.sh changeset-version.test.sh pr-workitem-check.test.sh; do
      if grep -qE "^[[:space:]]*run: bash scripts/__tests__/${suite//./\\.}[[:space:]]*\$" <<<"$lst_block"; then
        pass "self-defense job runs $suite"
      else
        fail "self-defense job no longer runs $suite — it is orphaned again (PF-9451 regression)"
      fi
    done
    if grep -q 'continue-on-error' <<<"$lst_block"; then
      fail "the self-defense job carries a continue-on-error — a red suite would be ignored"
    else
      pass "no continue-on-error shadows the self-defense job"
    fi
  fi

  # ---- 11. The test-only seams must not be wired from any workflow ----
  wf_all="$(cat "$REPO_ROOT"/.github/workflows/*.yml "$REPO_ROOT"/.github/workflows/*.yaml 2>/dev/null)"
  seam_hits=0
  for seam in SUITE_WIRING_TEST_DIRS SUITE_WIRING_WORKFLOW_DIR; do
    if grep -q "$seam" <<<"$wf_all"; then
      fail "workflow config sets $seam — the gate can be pointed at an empty tree and pass"
      seam_hits=$((seam_hits + 1))
    fi
  done
  if [ "$seam_hits" -eq 0 ]; then
    pass "no workflow wires the test-only SUITE_WIRING_* seams"
  fi

  # ---- 12. ci-gate's `ci` path filter must fire on the newly wired subjects ----
  # Without this, a change to generate-wasm-manifests.sh or changeset-version.sh
  # would not trigger the job that runs their suites.
  if grep -qF "grep -qE '^\\.github/workflows/|^scripts/" <<<"$ci"; then
    pass "ci-gate's needs-ci filter covers ^scripts/ (fires on the newly wired subject scripts)"
  else
    fail "ci-gate's needs-ci filter no longer covers ^scripts/ — suite subjects can change without running their suites"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-suite-wiring.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
