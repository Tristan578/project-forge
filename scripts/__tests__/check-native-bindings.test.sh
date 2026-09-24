#!/usr/bin/env bash
# Unit tests for scripts/check-native-bindings.sh — the native swc binding gate.
#
# The bug class this suite locks down (PF-947 / #8920): npm's optional-dependency
# handling can exit 0 from `npm ci` while silently dropping the platform-native
# @next/swc-<platform>-<arch> package (npm/cli#4828 class). The failure then
# surfaces minutes later as an opaque `next build` error ("Failed to load SWC
# binary"), far from its cause. The gate turns the drop into a loud, named
# failure immediately after install.
#
# The suite is hermetic: it builds fake node_modules trees under mktemp and
# drives the gate through its real contract (path arg + exit code). The
# NATIVE_BINDINGS_PLATFORM / NATIVE_BINDINGS_ARCH seams are TEST-ONLY — the
# suite's final case asserts no workflow wires them, so the gate can never be
# no-op'd from CI config.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/../check-native-bindings.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
FAILURES=0
TMPDIR_T="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T"' EXIT

pass() { echo "  PASS: $1"; }
readonly -f pass
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
readonly -f fail

command -v node >/dev/null 2>&1 || { echo "node not on PATH — suite cannot run"; exit 1; }
[ -f "$GATE" ] || { echo "gate script not found: $GATE"; exit 1; }

# Build a fake node_modules tree. Usage: mktree <name> [swc-pkg-dir ...]
# Always creates node_modules/next (the gate's precondition). Each swc-pkg-dir
# is created under node_modules/@next/.
mktree() {
  local name="$1"; shift
  local nm="$TMPDIR_T/$name/node_modules"
  mkdir -p "$nm/next" "$nm/@next"
  local pkg
  for pkg in "$@"; do
    mkdir -p "$nm/@next/$pkg"
  done
  echo "$nm"
}
readonly -f mktree

# Run the gate against a tree with optional platform/arch seam overrides.
# Usage: run_gate <nm_dir> [platform] [arch]
run_gate() {
  NATIVE_BINDINGS_PLATFORM="${2:-}" NATIVE_BINDINGS_ARCH="${3:-}" \
    bash "$GATE" "$1" >/dev/null 2>&1
  echo $?
}
readonly -f run_gate

HOST_PLATFORM="$(node -p process.platform)"
HOST_ARCH="$(node -p process.arch)"

echo "== check-native-bindings.sh =="

# 1. Happy path, NO seam (default host detection): exact-named package with a
#    .node binary → 0. This exercises the real `node -p` platform/arch path the
#    CI run takes (NM_DIR is still passed explicitly — the no-arg NM_DIR
#    default is exercised by case 12).
nm="$(mktree host-ok "swc-${HOST_PLATFORM}-${HOST_ARCH}")"
touch "$nm/@next/swc-${HOST_PLATFORM}-${HOST_ARCH}/next-swc.${HOST_PLATFORM}-${HOST_ARCH}.node"
rc="$(run_gate "$nm")"
if [ "$rc" = "0" ]; then pass "host platform binding + binary → gate 0"; else fail "host platform binding + binary → expected 0, got $rc"; fi

# 2. linux-x64 ships with a libc suffix (-gnu): the CI runner's real shape.
#    Seam pins platform/arch so this is testable from any dev machine.
nm="$(mktree linux-gnu "swc-linux-x64-gnu")"
touch "$nm/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "linux-x64-gnu suffixed binding → gate 0"; else fail "linux-x64-gnu suffixed binding → expected 0, got $rc"; fi

# 3. musl variant is equally valid on linux-x64.
nm="$(mktree linux-musl "swc-linux-x64-musl")"
touch "$nm/@next/swc-linux-x64-musl/next-swc.linux-x64-musl.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "linux-x64-musl suffixed binding → gate 0"; else fail "linux-x64-musl suffixed binding → expected 0, got $rc"; fi

# 4. THE BUG: npm dropped the optional dep — next installed, no @next/swc-* at
#    all → 1. This is the exact silent-drop state the gate exists to catch.
nm="$(mktree dropped)"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "1" ]; then pass "binding package absent → gate 1 (silent drop caught)"; else fail "binding package absent → expected 1, got $rc"; fi

# 5. Package dir exists but contains NO .node binary (truncated/corrupt
#    install) → 1. Directory presence alone is not proof.
nm="$(mktree empty-pkg "swc-linux-x64-gnu")"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "1" ]; then pass "binding dir without .node binary → gate 1"; else fail "binding dir without .node binary → expected 1, got $rc"; fi

# 6. Wrong-platform binding only: a darwin binding does not satisfy a linux
#    runner → 1.
nm="$(mktree wrong-plat "swc-darwin-arm64")"
touch "$nm/@next/swc-darwin-arm64/next-swc.darwin-arm64.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "1" ]; then pass "wrong-platform binding only → gate 1"; else fail "wrong-platform binding only → expected 1, got $rc"; fi

# 7. Near-miss prefix: arch 'arm' must NOT be satisfied by an 'arm64' package.
#    A naive `swc-<plat>-<arch>*` glob would prefix-match it — the gate must
#    only accept the exact arch or a hyphen-separated libc suffix.
nm="$(mktree arm-nearmiss "swc-linux-arm64-gnu")"
touch "$nm/@next/swc-linux-arm64-gnu/next-swc.linux-arm64-gnu.node"
rc="$(run_gate "$nm" linux arm)"
if [ "$rc" = "1" ]; then pass "arch 'arm' vs arm64 package → gate 1 (no prefix match)"; else fail "arch 'arm' vs arm64 package → expected 1, got $rc (prefix collision)"; fi

# 8. Multiple candidates: first is empty, second carries the binary → 0. The
#    gate must scan all matching packages, not just the first.
nm="$(mktree multi "swc-linux-x64-gnu" "swc-linux-x64-musl")"
touch "$nm/@next/swc-linux-x64-musl/next-swc.linux-x64-musl.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "second candidate carries binary → gate 0"; else fail "second candidate carries binary → expected 0, got $rc"; fi

# 9. Fail closed: node_modules dir does not exist → 2 (tooling/order error —
#    the gate ran before npm ci, never a pass).
rc="$(run_gate "$TMPDIR_T/no-such-tree/node_modules" linux x64)"
if [ "$rc" = "2" ]; then pass "missing node_modules → exit 2 (fail closed)"; else fail "missing node_modules → expected 2, got $rc"; fi

# 10. Fail closed: node_modules exists but next itself is absent — the gate is
#     wired into next-build jobs, so a next-less tree means a mis-pointed path,
#     not a pass → 2.
nm_dir="$TMPDIR_T/no-next/node_modules"
mkdir -p "$nm_dir/@next"
rc="$(run_gate "$nm_dir" linux x64)"
if [ "$rc" = "2" ]; then pass "next absent from tree → exit 2 (mis-pointed path refused)"; else fail "next absent from tree → expected 2, got $rc"; fi

# 11. The seams are TEST-ONLY: no workflow may set NATIVE_BINDINGS_PLATFORM or
#     NATIVE_BINDINGS_ARCH — wiring them in CI would let a config edit no-op
#     the gate (same self-defense rule as $NPM_AUDIT_CMD / $OPENAPI_API_DIR).
#     Comment lines are stripped first (canonical pattern from
#     check-npm-audit.test.sh) so a doc comment naming the seam does not
#     false-positive — only an EXECUTABLE reference can no-op the gate.
#     Composite actions under .github/actions/ are included (guarded — the
#     dir does not exist today; an existence test keeps pipefail from
#     poisoning the pipeline exit if grep sees a missing path).
seam_dirs=("$REPO_ROOT/.github/workflows")
[ -d "$REPO_ROOT/.github/actions" ] && seam_dirs+=("$REPO_ROOT/.github/actions")
native_seam_hits="$(grep -rh "NATIVE_BINDINGS_" "${seam_dirs[@]}" 2>/dev/null || true)"
native_seam_executable="$(grep -v '^[[:space:]]*#' <<<"$native_seam_hits" || true)"
if grep -q "NATIVE_BINDINGS_" <<<"$native_seam_executable"; then
  fail "a workflow or composite action references NATIVE_BINDINGS_* in an executable line — the test-only seam must never be wired in CI"
else
  pass "no workflow or composite action wires the NATIVE_BINDINGS_* test seams in an executable line"
fi

# Regression for PF-1005: this exceeds Linux's typical 64 KiB pipe buffer.
# Capture-then-test must keep the executable wiring visible; a comment-strip |
# grep -q pipeline can SIGPIPE its producer and invert this verdict under
# `set -o pipefail`.
large_seam_hits="$(awk 'BEGIN { for (i=0; i<5000; i++) print "env: NATIVE_BINDINGS_PLATFORM=linux" }')"
large_seam_executable="$(grep -v '^[[:space:]]*#' <<<"$large_seam_hits" || true)"
if [ "${#large_seam_executable}" -gt 65536 ] && grep -q 'NATIVE_BINDINGS_' <<<"$large_seam_executable"; then
  pass "over-64KiB executable seam input remains wired under pipefail"
else
  fail "over-64KiB executable seam input was lost or misclassified"
fi

# 12. Default NM_DIR (no-arg invocation — the exact form the CI steps use):
#     from a non-repo cwd the gate must resolve ./node_modules and pass on a
#     good tree. The fixture is POSITIVE on purpose: if root-resolution ever
#     escaped the cwd to the real repo, the linux binding would be absent
#     there and this case would fail instead of passing for the wrong reason.
noargs_dir="$TMPDIR_T/noargs"
mkdir -p "$noargs_dir/node_modules/next" "$noargs_dir/node_modules/@next/swc-linux-x64-gnu"
touch "$noargs_dir/node_modules/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node"
rc="$( (cd "$noargs_dir" && NATIVE_BINDINGS_PLATFORM=linux NATIVE_BINDINGS_ARCH=x64 bash "$GATE" >/dev/null 2>&1); echo $? )"
if [ "$rc" = "0" ]; then pass "no-arg default NM_DIR resolves cwd node_modules → gate 0"; else fail "no-arg default NM_DIR → expected 0, got $rc"; fi

# 13. node missing from PATH → exit 2 (fail closed), never a pass-through.
#     /bin/bash is invoked by absolute path so only the gate's own `command -v
#     node` lookup is starved; the suite's own node preamble already ran.
nm="$(mktree path-no-node "swc-linux-x64-gnu")"
touch "$nm/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node"
rc="$(PATH="/nonexistent" /bin/bash "$GATE" "$nm" >/dev/null 2>&1; echo $?)"
if [ "$rc" = "2" ]; then pass "node absent from PATH → exit 2 (fail closed)"; else fail "node absent from PATH → expected 2, got $rc"; fi

# 17. Multiple .node files in one binding dir (real @next/swc packages can
#     ship platform variants side by side) → still 0; the scan must not choke
#     on or require exactly one binary.
nm="$(mktree multi-node "swc-linux-x64-gnu")"
touch "$nm/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node" \
      "$nm/@next/swc-linux-x64-gnu/next-swc.alt.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "multiple .node files in binding dir → gate 0"; else fail "multiple .node files in binding dir → expected 0, got $rc"; fi

# 18. Spaces in the node_modules path — every expansion in the gate must be
#     quoted; an unquoted one would split on the space and misreport.
space_nm="$TMPDIR_T/space dir/node_modules"
mkdir -p "$space_nm/next" "$space_nm/@next/swc-linux-x64-gnu"
touch "$space_nm/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node"
rc="$(run_gate "$space_nm" linux x64)"
if [ "$rc" = "0" ]; then pass "path with spaces → gate 0 (quoting holds)"; else fail "path with spaces → expected 0, got $rc"; fi

# ── ci.yml structural wiring (self-defense — canonical pattern from
#    check-npm-audit.test.sh's quality-gates/ci.yml sections). The gate is only
#    real if CI actually invokes it; a PR that unwires an invocation, adds
#    continue-on-error, or drops the self-defense registration must fail here.
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"

# WHICH jobs build Next.js is DERIVED from the workflow text, never typed out.
# This list was hand-maintained twice and wrong both times: first "all four"
# while test-e2e-api carried the step unpinned, then "every next-build job"
# naming six while test-e2e-crossbrowser (which already carried the step) and
# docs-e2e (which did not) both ran `next build` outside it (#8632). A typed
# list records which jobs someone remembered; this records which jobs build.
#
# A job is a next-build job when an executable line runs `next build` itself,
# or when a step runs `npm run build` in a workspace whose package.json `build`
# script runs `next build` (build-nextjs → web, docs-e2e → apps/docs). The
# workspace is the line's own `cd <dir> &&`, else the step's working-directory:,
# else the job's defaults, else the repo root. Comment lines and name: values
# never count. Emits `D<TAB>job` (direct) and `W<TAB>job<TAB>dir` (via a
# workspace build script) rows; next_build_jobs() below resolves the W rows.
# shellcheck disable=SC2016  # an awk program, not a shell string: $0/$1 are
# awk fields and must NOT expand here. shellcheck suppresses SC2016 for a
# literal `awk '...'` but cannot see through the variable it is passed in.
NEXT_BUILD_JOBS_AWK='
function flush() {
  if (nb_step) print "W\t" job "\t" (wd != "" ? wd : (job_wd != "" ? job_wd : "."))
  nb_step = 0; wd = ""
}
/^jobs:[[:space:]]*$/ { in_jobs = 1; next }
!in_jobs { next }
/^[[:space:]]*#/ { next }
/^  [a-z][a-z0-9_-]*:[[:space:]]*$/ { flush(); job = $1; sub(/:$/, "", job); job_wd = ""; in_steps = 0; next }
/^    steps:[[:space:]]*$/ { in_steps = 1; next }
/^      - / { flush() }
/^[[:space:]]*(- )?working-directory:/ {
  v = $0
  sub(/^[[:space:]]*(- )?working-directory:[[:space:]]*/, "", v)
  sub(/[[:space:]]+#.*$/, "", v)
  gsub(/["\047]/, "", v)
  sub(/[[:space:]]+$/, "", v)
  if (in_steps) wd = v; else job_wd = v
  next
}
/^[[:space:]]*(- )?name:/ { next }
/(^|[^[:alnum:]_-])next build([^[:alnum:]_-]|$)/ { print "D\t" job }
/npm run build([^[:alnum:]_:-]|$)/ {
  if (match($0, /cd [^[:space:];&|]+[[:space:]]*&&[[:space:]]*npm run build/)) {
    d = substr($0, RSTART + 3, RLENGTH - 3)
    sub(/[[:space:]]*&&.*$/, "", d)
    print "W\t" job "\t" d
  } else nb_step = 1
}
END { flush() }
'

# Reads workflow text on stdin; prints each next-build job once, sorted. An
# `npm run build` whose workspace has no package.json prints `?<TAB>job<TAB>dir`
# instead: the caller FAILS on it, because an unresolvable build is an unknown,
# and an unknown silently read as "not a next build" is how a job falls out of
# the pin.
next_build_jobs() {
  local rows kind job dir pkg
  local -A is_next=()
  rows="$(awk "$NEXT_BUILD_JOBS_AWK")"
  while IFS=$'\t' read -r kind job dir; do
    case "$kind" in
      D) printf '%s\n' "$job" ;;
      W)
        pkg="$REPO_ROOT/${dir#./}/package.json"
        if [ ! -f "$pkg" ]; then
          printf '?\t%s\t%s\n' "$job" "$dir"
          continue
        fi
        if [ -z "${is_next[$dir]:-}" ]; then
          # stdin, not a path argument: node.exe cannot open an MSYS /d/... path.
          if node -e 'const s=(JSON.parse(require("fs").readFileSync(0,"utf8")).scripts||{}).build||"";process.exit(/(^|[^\w-])next build(\W|$)/.test(s)?0:1)' <"$pkg"; then
            is_next[$dir]=yes
          else
            is_next[$dir]=no
          fi
        fi
        if [ "${is_next[$dir]}" = yes ]; then printf '%s\n' "$job"; fi ;;
    esac
  done <<<"$rows" | sort -u
}
readonly -f next_build_jobs

# Reads workflow text on stdin; prints one line per way <job> fails to run the
# gate, and nothing when it is wired. Job blocks are extracted individually so
# an invocation moving to the wrong job (or a job losing its invocation while
# another keeps two) cannot cancel out in a whole-file count.
job_wiring_defects() {
  local job="$1" text job_block job_executable step_block run_count
  text="$(cat)"
  job_block="$(awk -v j="  ${job}:" '$0==j{f=1} f{print} f && /^  [a-z][a-z0-9-]*:[[:space:]]*$/ && $0!=j{exit}' <<<"$text")"
  if [ -z "$job_block" ]; then
    echo "no job named ${job} — nothing to check"
    return
  fi
  job_executable="$(grep -v '^[[:space:]]*#' <<<"$job_block" || true)"
  if ! grep -qF 'bash scripts/check-native-bindings.sh' <<<"$job_executable"; then
    echo "does not invoke scripts/check-native-bindings.sh — gate unwired"
  fi

  # Containment alone is NOT enough, and it fails green. GitHub's YAML parser
  # keeps the LAST of two duplicate keys, so APPENDING a second `run:` to this
  # step replaces the command under last-key-wins while the ORIGINAL
  # `run: bash scripts/check-native-bindings.sh` line stays byte-present and
  # still satisfies the containment grep above — the gate is dead and the pin
  # reads green. Measured live against ci.yml's build-nextjs step (#9031). On
  # the `pull_request` path GitHub runs the PR's OWN workflow file, so the
  # mutation takes effect in the very run that should have caught it.
  # actionlint flags duplicate keys, but it is not wired into this repo's CI —
  # this count is the backstop. Scope it to the gate's STEP block so a
  # legitimate `run:` in a sibling step is not counted.
  step_block="$(awk '
    !f && /^      - name:/ && index($0, "Assert native swc binding survived npm ci") {f=1; print; next}
    f && /^      - /{exit}
    f && !/^        / && !/^[[:space:]]*$/{exit}
    f {print}
  ' <<<"$job_block")"
  if [ -z "$step_block" ]; then
    echo "has no step named 'Assert native swc binding survived npm ci' — the step cut read nothing, so a run: count would pass vacuously"
    return
  fi
  run_count="$(grep -cE '^[[:space:]]*["'"'"']?run["'"'"']?[[:space:]]*:' <<<"$step_block" || true)"
  if [ "$run_count" -ne 1 ]; then
    echo "native-bindings step has $run_count run: keys (expected exactly 1) — missing or duplicated (YAML keeps the last duplicate key, so an appended run: silently replaces the gate invocation while the original run: line still greps as present)"
  fi
  if ! grep -qE '^[[:space:]]*run: bash scripts/check-native-bindings\.sh[[:space:]]*$' <<<"$step_block"; then
    echo "native-bindings step does not run 'bash scripts/check-native-bindings.sh' as its whole run: line — neutered, rewritten, or comment-suffixed"
  fi
}
readonly -f job_wiring_defects

if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"

  # 14. EVERY next-build job must invoke the gate, where "every" is the derived
  #     set above rather than a list someone keeps in step with ci.yml.
  derived="$(next_build_jobs <<<"$ci")"
  unresolved="$(grep '^?' <<<"$derived" || true)"
  derived_jobs="$(grep -v '^?' <<<"$derived" || true)"
  if [ -n "$unresolved" ]; then
    while IFS=$'\t' read -r _ job dir; do
      fail "ci.yml job ${job} runs \`npm run build\` in '${dir}', which has no package.json — cannot tell whether it builds Next.js, so it cannot be left out of the pin"
    done <<<"$unresolved"
  fi

  # The derivation must find SOMETHING (lesson 9 — a sweep over zero jobs reads
  # as zero defects) and must still recognise every job known to build Next.js
  # today. This floor is a self-test of the derivation, NOT the set under test:
  # a new next-build job is checked below without being added here, and a job
  # missing from this list is still checked if it builds.
  if [ -z "$derived_jobs" ]; then
    fail "the derivation found ZERO next-build jobs in ci.yml — the sweep below would check nothing and pass"
  fi
  floor_ok=1
  for job in build-nextjs test-e2e-ui test-e2e-api test-e2e-auth test-e2e-journey test-e2e-engine-smoke test-e2e-crossbrowser docs-e2e; do
    if ! grep -qxF "$job" <<<"$derived_jobs"; then
      fail "the derivation does not recognise ci.yml job ${job} as a next-build job — either it stopped building Next.js (drop it from this floor) or the derivation regressed and 'every next-build job' no longer holds"
      floor_ok=0
    fi
  done
  if [ "$floor_ok" = 1 ]; then
    pass "the derivation recognises all 8 known next-build jobs ($(wc -l <<<"$derived_jobs" | tr -d ' ') derived)"
  fi

  while IFS= read -r job; do
    [ -n "$job" ] || continue
    defects="$(job_wiring_defects "$job" <<<"$ci")"
    if [ -z "$defects" ]; then
      pass "ci.yml job ${job} builds Next.js and runs the gate as its step's single, whole run: line"
    else
      while IFS= read -r defect; do
        fail "ci.yml job ${job} builds Next.js but ${defect}"
      done <<<"$defects"
    fi
  done <<<"$derived_jobs"

  # 14a. Negative controls. Each mutates the REAL ci.yml text (so the
  #      derivation is exercised on the file it will actually read) and asserts
  #      the pin goes red. A negative control whose mutation changed nothing
  #      fails too — otherwise it passes by testing the unmutated file.
  #
  #      The regression from #8632: test-e2e-crossbrowser loses its gate. The
  #      hand-typed list did not contain that job, so this exact mutation left
  #      the whole suite green.
  unwired_xb="$(awk '
    /^  [a-z][a-z0-9-]*:[[:space:]]*$/ { in_job = ($0 == "  test-e2e-crossbrowser:") }
    in_job && /^[[:space:]]*run: bash scripts\/check-native-bindings\.sh[[:space:]]*$/ { sub(/run: .*/, "run: echo skipped") }
    { print }
  ' <<<"$ci")"
  if [ "$unwired_xb" = "$ci" ]; then
    fail "negative control: unwiring test-e2e-crossbrowser's gate changed nothing — the control would test the unmutated file"
  elif ! grep -qxF test-e2e-crossbrowser <<<"$(next_build_jobs <<<"$unwired_xb")"; then
    fail "negative control: test-e2e-crossbrowser is not derived as a next-build job, so unwiring its gate goes unnoticed"
  elif [ -z "$(job_wiring_defects test-e2e-crossbrowser <<<"$unwired_xb")" ]; then
    fail "negative control: test-e2e-crossbrowser with its gate replaced by 'echo skipped' reads as wired"
  else
    pass "negative control: unwiring test-e2e-crossbrowser's gate is caught"
  fi

  # A NEW job appended to ci.yml. $1 = job name, $2 = its steps after npm ci.
  with_job() {
    printf '%s\n  %s:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n%s\n' "$ci" "$1" "$2"
  }
  # Asserts <job> in the text on stdin is (want=yes) or is not (want=no) derived.
  expect_derived() {
    local want="$1" job="$2" label="$3" got
    got="$(next_build_jobs)"
    if grep -qxF "$job" <<<"$got"; then
      if [ "$want" = yes ]; then pass "derivation: $label → counted as a next-build job"; else fail "derivation: $label → counted as a next-build job, but it builds no Next app"; fi
    else
      if [ "$want" = no ]; then pass "derivation: $label → not counted"; else fail "derivation: $label → NOT counted, so a job doing this could drop the gate unseen"; fi
    fi
  }

  direct="$(with_job nc-direct $'      - name: Build\n        working-directory: web\n        run: npx next build')"
  expect_derived yes nc-direct "a new job running \`npx next build\`" <<<"$direct"
  if [ -n "$(job_wiring_defects nc-direct <<<"$direct")" ]; then
    pass "negative control: a NEW next-build job without the gate is caught without editing any list"
  else
    fail "negative control: a NEW next-build job without the gate reads as wired"
  fi
  expect_derived yes nc-wd "\`npm run build\` with working-directory: apps/docs" \
    <<<"$(with_job nc-wd $'      - name: Build docs\n        working-directory: apps/docs\n        run: npm run build')"
  expect_derived yes nc-cd "\`cd web && npm run build\`" \
    <<<"$(with_job nc-cd $'      - run: cd web && npm run build')"
  expect_derived yes nc-defaults "\`npm run build\` under a job-level defaults working-directory: web" \
    <<<"$(printf '%s\n  nc-defaults:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: web\n    steps:\n      - run: npm run build\n' "$ci")"
  expect_derived no nc-ui "\`cd packages/ui && npm run build\` (a tsc build)" \
    <<<"$(with_job nc-ui $'      - run: cd packages/ui && npm run build')"
  expect_derived no nc-storybook "\`npm run build-storybook\` (a different script)" \
    <<<"$(with_job nc-storybook $'      - run: cd apps/design && npm run build-storybook')"
  expect_derived no nc-comment "a commented-out \`npx next build\`" \
    <<<"$(with_job nc-comment $'      # - run: npx next build\n      - run: echo hi')"
  expect_derived no nc-name "a step NAMED 'next build' that runs something else" \
    <<<"$(with_job nc-name $'      - name: next build smoke\n        run: echo hi')"
  unresolvable="$(next_build_jobs <<<"$(with_job nc-missing $'      - working-directory: no/such/dir\n        run: npm run build')")"
  if grep -q $'^?\tnc-missing\tno/such/dir$' <<<"$unresolvable"; then
    pass "derivation: \`npm run build\` in a dir with no package.json → reported unresolvable, not skipped"
  else
    fail "derivation: \`npm run build\` in a dir with no package.json was not reported unresolvable (got: ${unresolvable:-nothing})"
  fi

  # 15. No continue-on-error may shadow any gate invocation — it would swallow
  #     the non-zero exit and pass the job on a dropped binding. Windowed to
  #     the invocation lines so legitimate continue-on-error elsewhere in
  #     ci.yml does not false-positive.
  native_windows="$(grep -v '^[[:space:]]*#' <<<"$ci" | grep -B3 -A1 'bash scripts/check-native-bindings.sh' || true)"
  if grep -q 'continue-on-error' <<<"$native_windows"; then
    fail "a ci.yml native-bindings gate step has continue-on-error — gate exit code would be ignored"
  else
    pass "no continue-on-error shadows any native-bindings gate invocation"
  fi

  # 16. Self-defense registration: the lockfile-sync-tests (CI Self-Defense
  #     Tests) job must shellcheck the gate + this suite AND run this suite,
  #     so a PR that neuters either fails a required check.
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z0-9-]*:[[:space:]]*$/ && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"
  if grep -qF 'scripts/check-native-bindings.sh scripts/__tests__/check-native-bindings.test.sh' <<<"$lst_block"; then
    pass "self-defense job shellchecks the native-bindings gate + its suite"
  else
    fail "self-defense job does not shellcheck the native-bindings gate + its suite"
  fi
  if grep -qF 'bash scripts/__tests__/check-native-bindings.test.sh' <<<"$lst_block"; then
    pass "self-defense job runs this suite"
  else
    fail "self-defense job does not run scripts/__tests__/check-native-bindings.test.sh"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

# ── @rolldown: the second native binding, and the reason this gate is a list ──
#
# `@next/swc` was the only package this gate knew about. `@rolldown/binding-*`
# arrived with vitest 5 and is now equally load-bearing: it is what makes
# `npx vitest run` work at all, and npm drops it through exactly the same
# npm/cli#4828 path.
#
# OBSERVED, not hypothesised (#9966): during #9962 an `npm ci` exited 0 with the
# binding absent, and all four workspace suites produced NO TEST OUTPUT AT ALL —
# not a failure summary, silence. A downstream check asking "did the suite report
# failures?" sees nothing and concludes nothing, which is the whole reason the
# swc guard exists for the other package.
#
# `mkrolldown` mirrors `mktree` but seeds node_modules/rolldown (the sentinel
# that makes the rolldown entry applicable) and packages under @rolldown/.
# Usage: mkrolldown <name> <platform> <arch> [rolldown-pkg-dir ...]
#
# The swc side is seeded FOR THE PLATFORM UNDER TEST. A fixture that hardcodes
# one swc package makes every other-platform case fail for an swc reason, and
# every same-platform case pass for one — the assertion would then be about the
# wrong package entirely.
mkrolldown() {
  local name="$1" plat="$2" arch="$3"; shift 3
  local nm="$TMPDIR_T/$name/node_modules"
  mkdir -p "$nm/next" "$nm/@next" "$nm/rolldown" "$nm/@rolldown"
  mkdir -p "$nm/@next/swc-${plat}-${arch}"
  touch "$nm/@next/swc-${plat}-${arch}/next-swc.${plat}-${arch}.node"
  local pkg
  for pkg in "$@"; do
    mkdir -p "$nm/@rolldown/$pkg"
  done
  echo "$nm"
}
readonly -f mkrolldown

# R1. Happy path: the host's rolldown binding present with a .node binary → 0.
nm="$(mkrolldown r-ok linux x64 binding-linux-x64-gnu)"
touch "$nm/@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "rolldown binding present with .node → 0"; else fail "rolldown binding present → expected 0, got $rc"; fi

# R2. THE BUG. rolldown installed, every @rolldown/binding-* dropped by npm → 1.
#     This is the state that produced the silent suites in #9962.
nm="$(mkrolldown r-dropped linux x64)"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "1" ]; then pass "rolldown installed but binding dropped → 1 (npm/cli#4828 caught)"; else fail "rolldown binding dropped → expected 1, got $rc"; fi

# R3. Package dir present but EMPTY — an incomplete install is not a pass.
nm="$(mkrolldown r-empty linux x64 binding-linux-x64-gnu)"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "1" ]; then pass "rolldown binding dir without a .node → 1"; else fail "rolldown binding dir without .node → expected 1, got $rc"; fi

# R4. Suffix variants. rolldown ships -gnu/-musl/-msvc alongside bare names, so
#     the same exact-or-hyphen-suffix rule the swc side uses must apply here.
nm="$(mkrolldown r-musl linux x64 binding-linux-x64-musl)"
touch "$nm/@rolldown/binding-linux-x64-musl/rolldown-binding.linux-x64-musl.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "rolldown -musl suffix accepted for linux-x64"; else fail "rolldown -musl → expected 0, got $rc"; fi

nm="$(mkrolldown r-msvc win32 x64 binding-win32-x64-msvc)"
touch "$nm/@rolldown/binding-win32-x64-msvc/rolldown-binding.win32-x64-msvc.node"
rc="$(run_gate "$nm" win32 x64)"
if [ "$rc" = "0" ]; then pass "rolldown -msvc suffix accepted for win32-x64"; else fail "rolldown -msvc → expected 0, got $rc"; fi

# R5. ARCH PRECISION. rolldown really ships `binding-linux-arm-gnueabihf` AND
#     `binding-linux-arm64-gnu`, so a prefix glob would let arch 'arm' match the
#     'arm64' package and report a binding the runtime cannot load.
nm="$(mkrolldown r-arm linux arm binding-linux-arm64-gnu)"
touch "$nm/@rolldown/binding-linux-arm64-gnu/rolldown-binding.linux-arm64-gnu.node"
rc="$(run_gate "$nm" linux arm)"
if [ "$rc" = "1" ]; then pass "arch arm does not match the arm64 rolldown package"; else fail "arch arm matched arm64 → expected 1, got $rc"; fi

# R6. NOT APPLICABLE is not the same as PASSING. A tree that installs next but
#     not rolldown must still be graded on swc alone — the docs app and the
#     engine build are trees like this.
nm="$(mktree r-no-rolldown swc-linux-x64-gnu)"
touch "$nm/@next/swc-linux-x64-gnu/next-swc.linux-x64-gnu.node"
rc="$(run_gate "$nm" linux x64)"
if [ "$rc" = "0" ]; then pass "tree without rolldown is graded on swc alone → 0"; else fail "tree without rolldown → expected 0, got $rc"; fi

# R7. And the vacuity guard: a tree that installs NEITHER sentinel has nothing to
#     assert, so the gate must refuse rather than report success over zero
#     checks (lesson 9 — a check that scans nothing is not a passing check).
nm_dir="$TMPDIR_T/r-neither/node_modules"
mkdir -p "$nm_dir/@next" "$nm_dir/@rolldown"
rc="$(run_gate "$nm_dir" linux x64)"
if [ "$rc" = "2" ]; then pass "neither next nor rolldown present → exit 2 (nothing to assert, refuse)"; else fail "neither sentinel present → expected 2, got $rc"; fi

# R8. The declared list itself must be non-empty and must contain both entries.
#     Deleting an entry is how this gate would silently stop covering a package.
if grep -qE '^\s*NATIVE_BINDINGS=\(' "$GATE" \
   && grep -q '@next/swc' "$GATE" \
   && grep -q '@rolldown/binding' "$GATE"; then
  pass "the gate declares a NATIVE_BINDINGS list covering both @next/swc and @rolldown/binding"
else
  fail "the gate must declare a NATIVE_BINDINGS list covering @next/swc and @rolldown/binding"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-native-bindings.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
