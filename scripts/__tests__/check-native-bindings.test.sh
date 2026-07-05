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
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

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

# Run the gate against a tree with optional platform/arch seam overrides.
# Usage: run_gate <nm_dir> [platform] [arch]
run_gate() {
  NATIVE_BINDINGS_PLATFORM="${2:-}" NATIVE_BINDINGS_ARCH="${3:-}" \
    bash "$GATE" "$1" >/dev/null 2>&1
  echo $?
}

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
if grep -rh "NATIVE_BINDINGS_" "${seam_dirs[@]}" 2>/dev/null \
    | grep -v '^[[:space:]]*#' | grep -q "NATIVE_BINDINGS_"; then
  fail "a workflow or composite action references NATIVE_BINDINGS_* in an executable line — the test-only seam must never be wired in CI"
else
  pass "no workflow or composite action wires the NATIVE_BINDINGS_* test seams in an executable line"
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

# ── ci.yml structural wiring (self-defense — canonical pattern from
#    check-npm-audit.test.sh's quality-gates/ci.yml sections). The gate is only
#    real if CI actually invokes it; a PR that unwires an invocation, adds
#    continue-on-error, or drops the self-defense registration must fail here.
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
if [ -f "$CI_YML" ]; then
  ci="$(cat "$CI_YML")"

  # 14. All FOUR next-build jobs must invoke the gate — build-nextjs (runs
  #     `npm run build` = `next build` directly) plus the three E2E jobs.
  #     Job blocks are extracted individually so an invocation moving to the
  #     wrong job (or a job losing its invocation while another keeps two)
  #     cannot cancel out in a whole-file count.
  for job in build-nextjs test-e2e-ui test-e2e-journey test-e2e-engine-smoke; do
    job_block="$(awk -v j="  ${job}:" '$0==j{f=1} f{print} f && /^  [a-z][a-z0-9-]*:[[:space:]]*$/ && $0!=j{exit}' <<<"$ci")"
    if grep -v '^[[:space:]]*#' <<<"$job_block" | grep -qF 'bash scripts/check-native-bindings.sh'; then
      pass "ci.yml job ${job} invokes the native-bindings gate"
    else
      fail "ci.yml job ${job} does not invoke scripts/check-native-bindings.sh — gate unwired"
    fi
  done

  # 15. No continue-on-error may shadow any gate invocation — it would swallow
  #     the non-zero exit and pass the job on a dropped binding. Windowed to
  #     the invocation lines so legitimate continue-on-error elsewhere in
  #     ci.yml does not false-positive.
  if grep -v '^[[:space:]]*#' <<<"$ci" | grep -B3 -A1 'bash scripts/check-native-bindings.sh' | grep -q 'continue-on-error'; then
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

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All check-native-bindings.sh tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
