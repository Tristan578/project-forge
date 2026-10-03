#!/usr/bin/env bash
# Unit tests for scripts/check-native-bindings.sh — the native binding gate
# (@next/swc for next build / next dev, @rolldown/binding for vitest).
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

# ── workflow structural wiring (self-defense — canonical pattern from
#    check-npm-audit.test.sh's quality-gates/ci.yml/cd.yml sections). The gate
#    is only real if CI actually invokes it; a PR that unwires an invocation,
#    adds continue-on-error, or drops the self-defense registration must fail
#    here. WHICH workflows are read is a glob over .github/workflows/*.yml and
#    *.yaml, not a list: the same rationale that derives the job set applies one level up.
#    The derivation read ci.yml alone (#10200), then a hand list of three
#    (#10222, first cut) — a fourth workflow gaining a vitest job would have
#    sat outside the pin exactly as cd.yml's test-web and test-mcp did.
WORKFLOWS_DIR="$REPO_ROOT/.github/workflows"

# Per-workflow floors: the jobs KNOWN to load a native binding today, one row
# per workflow that has any, written `<workflow>: <job> <job> ...`. A floor is
# a self-test of the derivation (see assert_gate_wired), never the set under
# test, so this is the one place a job name is typed. A workflow with no floor
# is still swept: every job it derives is checked, and only the zero-derived
# vacuity check is waived — schema-drift.yml carries the gate but derives
# nothing (`npm run db:drift` loads no binding) and engine-cdn-test.yml's
# `npm test` is `node --test`.
#   - quality-gates.yml runs no `next build` line of its own: lighthouse-delta
#     builds through web's `npm run build`, test-web and test-mcp run vitest,
#     and editor-boot's Playwright config starts `next dev` (#10200).
#   - cd.yml (the deploy path) has the same shape: test-web and test-mcp run
#     vitest directly, and e2e builds Next.js itself (`npx next build`) before
#     its own Playwright run. e2e already carried the gate; test-web and
#     test-mcp did not (#10222).
# ONE table, read by both floor_jobs and floored_workflows. The floors used to
# be a case statement AND a separate list of floored workflows, typed twice
# with nothing tying them together: deleting cd.yml's case arm left cd.yml
# listed but silently unfloored, and an arm for a workflow that did not exist
# was never evaluated (review board on #10296, lesson 18). A row that does not
# parse, a workflow named twice, or an empty table fails below.
readonly NATIVE_BINDING_FLOORS='
ci.yml: build-nextjs test-e2e-ui test-e2e-api test-e2e-auth test-e2e-journey test-e2e-engine-smoke test-e2e-crossbrowser docs-e2e observatory-tests docs-internal-gate design-internal-gate
quality-gates.yml: test-web test-mcp editor-boot lighthouse-delta
cd.yml: test-web test-mcp e2e
'
FLOOR_ROW_RE='^[A-Za-z0-9._-]+\.ya?ml:([[:space:]]+[a-z][a-z0-9_-]*)+[[:space:]]*$'

# $1 = workflow file name; prints its floor jobs space-separated, or nothing.
floor_jobs() {
  awk -v wf="$1:" '$1 == wf { $1 = ""; sub(/^[[:space:]]+/, ""); print; exit }' <<<"$NATIVE_BINDING_FLOORS"
}
readonly -f floor_jobs

# Prints every workflow a floor table names, one per line, in table order.
# $1 = the table; NATIVE_BINDING_FLOORS when omitted (the fixtures below pass
# their own, so the row and duplicate checks run on a bad table too).
floored_workflows() {
  awk 'NF { w = $1; sub(/:$/, "", w); print w }' <<<"${1-$NATIVE_BINDING_FLOORS}"
}
readonly -f floored_workflows

# $1 = a floor table. Fails once per malformed row, once for any workflow
# named twice, and once for a table with no rows; passes only a well-formed
# table with one row per workflow. It runs on the real table here and, in a
# subshell, on bad fixtures just below, so neutering any of the three checks
# turns a fixture case red.
assert_floor_table() {
  local table="$1" rows row dupes malformed=0
  rows="$(grep -v '^[[:space:]]*$' <<<"$table" || true)"
  if [ -z "$rows" ]; then
    fail "NATIVE_BINDING_FLOORS has no rows — no workflow's derivation is self-tested"
    return
  fi
  while IFS= read -r row; do
    if ! grep -qE "$FLOOR_ROW_RE" <<<"$row"; then
      fail "NATIVE_BINDING_FLOORS row '${row}' is not '<workflow>.yml: <job> [<job> ...]' (or .yaml) — an emptied or mistyped row unfloors its workflow"
      malformed=1
    fi
  done <<<"$rows"
  dupes="$(floored_workflows "$table" | sort | uniq -d)"
  if [ -n "$dupes" ]; then
    fail "NATIVE_BINDING_FLOORS names $(tr '\n' ' ' <<<"$dupes")more than once — floor_jobs reads only the first row"
  elif [ "$malformed" = 0 ]; then
    pass "NATIVE_BINDING_FLOORS: $(grep -c '' <<<"$rows") well-formed row(s), one per workflow"
  fi
}
readonly -f assert_floor_table

assert_floor_table "$NATIVE_BINDING_FLOORS"

# Negative controls for the table checks. Each runs assert_floor_table in a
# subshell, so its expected FAIL is captured rather than counted, and asserts
# its own defect text: an emptied row, a row with no colon, a workflow named
# twice, a table with no rows. The well-formed fixture is the pair. It must
# pass and fail nothing, so a check that fires on every table cannot read as
# a working control. $1 = label, $2 = table, $3 = the expected FAIL text, or
# empty for "must pass".
floor_control() {
  local label="$1" table="$2" want="$3" got
  got="$(assert_floor_table "$table")"
  if [ -z "$want" ]; then
    if grep -q 'FAIL:' <<<"$got" || ! grep -q 'PASS: NATIVE_BINDING_FLOORS' <<<"$got"; then
      fail "floor-table control: $label should pass and fail nothing (got: ${got:-nothing})"
    else
      pass "floor-table control: $label passes"
    fi
  elif grep -qF "FAIL: $want" <<<"$got"; then
    pass "floor-table control: $label is refused"
  else
    fail "floor-table control: $label was not refused with '$want' (got: ${got:-nothing})"
  fi
}
readonly -f floor_control

floor_control "a well-formed two-row table" $'\na.yml: j1 j2\nb.yaml: j3\n' ""
floor_control "an emptied row" $'\na.yml:\nb.yml: j3\n' "NATIVE_BINDING_FLOORS row 'a.yml:' is not"
floor_control "a row with no colon" $'\na.yml j1\n' "NATIVE_BINDING_FLOORS row 'a.yml j1' is not"
floor_control "a workflow named twice" $'\na.yml: j1\nb.yml: j2\na.yml: j3\n' "NATIVE_BINDING_FLOORS names a.yml more than once"
floor_control "a table with no rows" $'\n  \n' "NATIVE_BINDING_FLOORS has no rows"

# WHICH jobs need a native binding is DERIVED from the workflow text, never
# typed out. This list was hand-maintained twice and wrong both times: first
# "all four" while test-e2e-api carried the step unpinned, then "every
# next-build job" naming six while test-e2e-crossbrowser (which already carried
# the step) and docs-e2e (which did not) both ran `next build` outside it
# (#8632). Then the derivation itself was too narrow: it knew only `next build`
# and read only ci.yml, so quality-gates.yml — where no job runs `next build`
# directly but four depend on the bindings — had no invocation at all, and
# three ci.yml jobs that only run vitest (which loads @rolldown/binding-*) sat
# outside the pin (#10200). A typed list records which jobs someone remembered;
# this records which jobs load a binding.
#
# A job needs the gate when an executable line, in any step:
#   - runs `next build` or `next dev` itself, or runs vitest as a command
#     (`npx vitest run`, `vitest run`)                          → D row
#   - runs `npm run build`, `npm test` / `npm run test`, or `npm run dev[:x]`
#     in a workspace whose package.json script does one of the above
#     (build-nextjs → web, docs-e2e → apps/docs, design-internal-gate →
#     packages/ui's "vitest run")                               → W row
#   - runs `playwright test` in a workspace whose config's webServer command
#     does one of the above, directly or via `npm run <script>` (editor-boot:
#     web/playwright.config.ts starts `npm run dev:raw`, i.e. `next dev`)
#                                                               → P row
# The workspace is the line's own `cd <dir> &&`, else the step's
# working-directory:, else the job's defaults, else the repo root. Comment
# lines and name: values never count. vitest must appear as a command word —
# `scripts/check-vitest-exit.sh` and `/tmp/vitest-output.txt` are paths, not
# invocations. Rows are `D<TAB>job<TAB>why`, `W<TAB>job<TAB>dir<TAB>script`
# and `P<TAB>job<TAB>dir<TAB>config`; native_binding_jobs() below resolves
# the W and P rows against the files they name.
# shellcheck disable=SC2016  # an awk program, not a shell string: $0/$1 are
# awk fields and must NOT expand here. shellcheck suppresses SC2016 for a
# literal `awk '...'` but cannot see through the variable it is passed in.
NATIVE_JOBS_AWK='
function flush(   i, n, parts, dir) {
  if (pend != "") {
    dir = (wd != "" ? wd : (job_wd != "" ? job_wd : "."))
    n = split(pend, parts, "\n")
    for (i = 1; i <= n; i++) {
      split(parts[i], kv, "\t")
      print kv[1] "\t" job "\t" dir "\t" kv[2]
    }
  }
  pend = ""; wd = ""
}
function cd_dir(line,   d) {
  if (match(line, /(^|[[:space:]|&;(])cd [^[:space:];&|]+[[:space:]]*&&/)) {
    d = substr(line, RSTART, RLENGTH)
    sub(/^.*cd /, "", d); sub(/[[:space:]]*&&$/, "", d)
    return d
  }
  return ""
}
function emit(kind, value,   d) {
  d = cd_dir($0)
  if (d != "") print kind "\t" job "\t" d "\t" value
  else pend = pend (pend != "" ? "\n" : "") kind "\t" value
}
/^jobs:[[:space:]]*$/ { in_jobs = 1; next }
!in_jobs { next }
/^[[:space:]]*#/ { next }
$0 ~ hdr { flush(); job = $1; sub(/:$/, "", job); job_wd = ""; in_steps = 0; next }
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
/(^|[^[:alnum:]_-])next build([^[:alnum:]_-]|$)/ { print "D\t" job "\tnext build" }
/(^|[^[:alnum:]_-])next dev([^[:alnum:]_-]|$)/ { print "D\t" job "\tnext dev" }
/(^|[[:space:];&|(])vitest([[:space:]]|$)/ { print "D\t" job "\tvitest" }
/npm run build([^[:alnum:]_:-]|$)/ { emit("W", "build") }
/npm (run )?test([^[:alnum:]_:-]|$)/ { emit("W", "test") }
/npm run dev(:[[:alnum:]_-]+)?([^[:alnum:]_:-]|$)/ {
  s = $0
  match(s, /npm run dev(:[[:alnum:]_-]+)?/)
  emit("W", substr(s, RSTART + 8, RLENGTH - 8))
}
/(^|[^[:alnum:]_-])playwright test([^[:alnum:]_-]|$)/ {
  c = ""
  if (match($0, /--config[= ][^[:space:]]+/)) c = substr($0, RSTART + 9, RLENGTH - 9)
  emit("P", c)
}
END { flush() }
'

# A job key under `jobs:` — two-space indent, then a GitHub Actions job id
# (letters, digits, `-` and `_`). ONE definition, passed to every awk here that
# cuts a job block: when the derivation accepted `_` and the block extractors did
# not, an unwired job followed by an underscored gated one absorbed that job's
# steps and read as wired (Sentry review on #10221).
JOB_HEADER_RE='^  [a-z][a-z0-9_-]*:[[:space:]]*$'

# Classifies one shell command string, as a workflow line, a package.json
# script or a Playwright webServer command would carry it. Returns 0 when it
# loads a native binding, 1 when it does not, 2 when that cannot be told (a
# missing package.json, script or config). $1 = command, $2 = workspace dir
# (repo-relative), $3 = resolution depth — `npm run e2e` → `playwright test`
# → config → `npm run dev` is three hops; anything deeper is reported as
# unresolvable rather than followed forever.
command_needs_bindings() {
  local cmd="$1" dir="$2" depth="${3:-0}" cfg script
  [ "$depth" -le 3 ] || return 2
  if grep -qE '(^|[^[:alnum:]_-])next (build|dev)([^[:alnum:]_-]|$)|(^|[[:space:];&|(])vitest([[:space:]]|$)' <<<"$cmd"; then
    return 0
  fi
  if grep -qE '(^|[^[:alnum:]_-])playwright test([^[:alnum:]_-]|$)' <<<"$cmd"; then
    cfg="$(grep -oE -- '--config[= ][^[:space:]]+' <<<"$cmd" | head -1 | sed -E 's/^--config[= ]//')"
    config_needs_bindings "$dir" "$cfg" "$((depth + 1))"
    return $?
  fi
  if grep -qE 'npm (run )?test([^[:alnum:]_:-]|$)|npm run (build|dev)(:[[:alnum:]_-]+)?([^[:alnum:]_:-]|$)' <<<"$cmd"; then
    script="$(grep -oE 'npm (run )?(test|build|dev)(:[[:alnum:]_-]+)?' <<<"$cmd" | head -1 | sed -E 's/^npm (run )?//')"
    script_needs_bindings "$dir" "$script" "$((depth + 1))"
    return $?
  fi
  return 1
}
readonly -f command_needs_bindings

# $1 = workspace dir, $2 = package.json script name, $3 = depth. A workspace
# with no package.json, or a script it does not declare, is UNRESOLVABLE (2),
# never "not a binding": an unknown read as "no" is how a job falls out of
# the pin.
script_needs_bindings() {
  local dir="$1" script="$2" depth="$3" pkg text
  pkg="$REPO_ROOT/${dir#./}/package.json"
  [ -f "$pkg" ] || return 2
  # stdin, not a path argument: node.exe cannot open an MSYS /d/... path.
  text="$(node -e 'const s=(JSON.parse(require("fs").readFileSync(0,"utf8")).scripts||{})[process.argv[1]];if(s===undefined)process.exit(3);process.stdout.write(String(s))' "$script" <"$pkg")" || return 2
  command_needs_bindings "$text" "$dir" "$depth"
}
readonly -f script_needs_bindings

# $1 = workspace dir, $2 = --config path (empty → playwright.config.*), $3 =
# depth. Reads every `command: '...'` string in the config (the webServer
# command; `//` comments stripped first) and grades each. A config that names
# a webServer but whose command cannot be read as a plain string is
# unresolvable; a config with no webServer starts no server of its own.
config_needs_bindings() {
  local dir="$1" cfg="$2" depth="$3" base file="" cand stripped cmds c rc verdict=1
  base="$REPO_ROOT/${dir#./}"
  if [ -n "$cfg" ]; then
    file="$base/$cfg"
  else
    for cand in playwright.config.ts playwright.config.mts playwright.config.js playwright.config.mjs playwright.config.cjs; do
      if [ -f "$base/$cand" ]; then file="$base/$cand"; break; fi
    done
  fi
  [ -n "$file" ] && [ -f "$file" ] || return 2
  # Materialise the comment-stripped text once and grep here-strings: a strip
  # piped into `grep -q` can SIGPIPE its producer under pipefail and invert
  # the verdict (the check-npm-audit.test.sh discipline).
  stripped="$(sed -E 's#//.*$##' "$file")"
  cmds="$(grep -oE "command:[[:space:]]*['\"][^'\"]*['\"]" <<<"$stripped" | sed -E "s/^command:[[:space:]]*['\"]//; s/['\"]$//" || true)"
  if [ -z "$cmds" ]; then
    if grep -q 'webServer' <<<"$stripped"; then return 2; fi
    return 1
  fi
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    command_needs_bindings "$c" "$dir" "$depth"
    rc=$?
    [ "$rc" = 0 ] && return 0
    [ "$rc" = 2 ] && verdict=2
  done <<<"$cmds"
  return "$verdict"
}
readonly -f config_needs_bindings

# Reads workflow text on stdin; prints each job that loads a native binding
# once, sorted. A W or P row that cannot be resolved prints
# `?<TAB>job<TAB>dir<TAB>what` instead: the caller FAILS on it, because an
# unresolvable build, test or server command is an unknown, and an unknown
# silently read as "no binding" is how a job falls out of the pin.
native_binding_jobs() {
  local rows kind job dir val rc
  rows="$(awk -v hdr="$JOB_HEADER_RE" "$NATIVE_JOBS_AWK")"
  while IFS=$'\t' read -r kind job dir val; do
    case "$kind" in
      D) printf '%s\n' "$job" ;;
      W)
        script_needs_bindings "$dir" "$val" 0; rc=$?
        if [ "$rc" = 0 ]; then printf '%s\n' "$job"
        elif [ "$rc" = 2 ]; then printf '?\t%s\t%s\tnpm script "%s"\n' "$job" "$dir" "$val"; fi ;;
      P)
        config_needs_bindings "$dir" "$val" 0; rc=$?
        if [ "$rc" = 0 ]; then printf '%s\n' "$job"
        elif [ "$rc" = 2 ]; then printf '?\t%s\t%s\tplaywright config "%s"\n' "$job" "$dir" "${val:-playwright.config.*}"; fi ;;
    esac
  done <<<"$rows" | sort -u
}
readonly -f native_binding_jobs

# The gate step's keys are a CLOSED set: `name` and `run`, which is exactly
# what all 19 gate steps under .github/workflows carry today. Any other key
# can disarm the gate without touching its run: line — `shell: echo {0}`
# makes the runner echo the script's path and exit 0, `working-directory:`
# points it at a tree with no node_modules — and enumerating the disarming
# keys one at a time is the unwinnable list lessons 18 and 21 describe
# (security seat on #10296). So every key is read and anything outside the
# set is refused, by name. One awk function, included in both cuts below
# (the derived-job rule and the every-invocation sweep), so the two cannot
# disagree about what a key is: for a step at the repository's indent (the
# `      - ` line opens it, its own keys sit at eight spaces), it returns the
# key on that line with any quotes stripped, or the whole text of an
# eight-space line that has no colon, and "" for any deeper line (an env:
# entry, a block scalar's body). Comment lines are skipped by the callers.
readonly STEP_KEY_AWK='
function step_key(line,   k) {
  if (line ~ /^      - / || line ~ /^        [^[:space:]]/) k = substr(line, 9)
  else return ""
  sub(/[[:space:]]*:.*$/, "", k)
  gsub(/["\047]/, "", k)
  return k
}'

# Reads workflow text on stdin; prints one line per way <job> fails to run the
# gate, and nothing when it is wired. Job blocks are extracted individually so
# an invocation moving to the wrong job (or a job losing its invocation while
# another keeps two) cannot cancel out in a whole-file count.
job_wiring_defects() {
  local job="$1" text job_block job_executable step_block run_count job_before_gate extra_key
  text="$(cat)"
  job_block="$(awk -v j="  ${job}:" -v hdr="$JOB_HEADER_RE" '$0==j{f=1} f{print} f && $0 ~ hdr && $0!=j{exit}' <<<"$text")"
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
  # actionlint (the `actionlint` job, #8719) flags duplicate keys, but it runs
  # from this same PR-controlled file — this count is the independent backstop. Scope it to the gate's STEP block so a
  # legitimate `run:` in a sibling step is not counted. A comment line, at any
  # indent, neither ends the cut nor enters it: YAML ignores it, so a
  # `      # note` between two of the step's keys does not end the step, and
  # ending the cut there would hide every key after it from the checks below.
  step_block="$(awk '
    !f && /^      - name:/ && index($0, "Assert native swc binding survived npm ci") {f=1; print; next}
    f && /^[[:space:]]*#/ {next}
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

  # A gate that runs is still useless in three more shapes, all of which
  # passed every check above (test and security seats on #10296). An `if:` on
  # the step can skip it (`if: false`, or any condition that comes out false)
  # while the job goes on to load the binding — no gate step has a reason to
  # be conditional, so any `if:` is refused. A step-level `continue-on-error`
  # lets the job go on past a red gate. It is checked over the WHOLE step cut,
  # not a few lines around the run: line: YAML key order is free, so the key
  # can sit after an env: block or before one, any distance from run:. Any
  # value is refused, `false` included, for the same reason as `if:`. And a
  # gate placed AFTER the first step that loads a
  # binding runs too late: the drop has already surfaced there as the opaque
  # SWC error or the silent vitest run the gate exists to replace. "Loads a
  # binding" is the derivation itself, run over the job cut off just before
  # the gate step, so the two cannot disagree about what a binding step is.
  if grep -qE '^[[:space:]]*(- )?["'"'"']?if["'"'"']?[[:space:]]*:' <<<"$step_block"; then
    echo "native-bindings step carries an if: — a condition can skip the gate while the job still loads the binding"
  fi
  if grep -qE '^[[:space:]]*(- )?["'"'"']?continue-on-error["'"'"']?[[:space:]]*:' <<<"$step_block"; then
    echo "native-bindings step carries a step-level continue-on-error — the job goes on past a red gate and loads the binding anyway"
  fi
  # The closed set (STEP_KEY_AWK above): every key other than name and run is
  # refused by name. if: and continue-on-error keep their own, more specific
  # messages just above, so they are not reported a second time here.
  while IFS= read -r extra_key; do
    [ -n "$extra_key" ] || continue
    echo "native-bindings step carries the key ${extra_key}: — the gate step may carry only name and run, and any other key (shell:, working-directory:, env: ...) can change what runs or whether its exit counts"
  done <<<"$(awk "$STEP_KEY_AWK"'
    { k = step_key($0) }
    k != "" && k != "name" && k != "run" && k != "if" && k != "continue-on-error" { print k }
  ' <<<"$step_block" | sort -u)"
  job_before_gate="$(awk '/^      - name:/ && index($0, "Assert native swc binding survived npm ci") {exit} {print}' <<<"$job_block")"
  if grep -qxF "$job" <<<"$(native_binding_jobs <<<"$(printf 'jobs:\n%s\n' "$job_before_gate")")"; then
    echo "native-bindings step runs AFTER a step that already loads a native binding — the drop surfaces there first, as the opaque failure the gate exists to replace"
  fi
}
readonly -f job_wiring_defects

# 14. EVERY job that loads a native binding must invoke the gate, where
#     "every" is the derived set above rather than a list someone keeps in
#     step with the workflow. $1 = workflow text, $2 = its label, $3.. = the
#     jobs known to need the gate today (may be none). That floor is a
#     self-test of the derivation, NOT the set under test (lesson 9 — a sweep
#     over zero jobs reads as zero defects): a new job is checked without
#     being added here, and a job missing from it is still checked if it
#     loads a binding. The zero-derived vacuity check applies only when a
#     floor is given: a floored workflow deriving nothing means the
#     derivation broke, while an unfloored one deriving nothing is simply a
#     workflow that loads no binding (schema-drift.yml, engine-cdn-test.yml).
#     Unresolvable rows fail in either case — an unknown is never "no".
assert_gate_wired() {
  local text="$1" label="$2" derived unresolved derived_jobs floor_ok job defects defect
  shift 2
  derived="$(native_binding_jobs <<<"$text")"
  unresolved="$(grep '^?' <<<"$derived" || true)"
  derived_jobs="$(grep -v '^?' <<<"$derived" || true)"
  if [ -n "$unresolved" ]; then
    while IFS=$'\t' read -r _ job dir what; do
      fail "$label job ${job} runs ${what} in '${dir}', which cannot be resolved — cannot tell whether it loads a native binding, so it cannot be left out of the pin"
    done <<<"$unresolved"
  fi
  if [ "$#" -eq 0 ]; then
    if [ -n "$derived_jobs" ]; then
      pass "$label: $(grep -c '' <<<"$derived_jobs") native-binding job(s) derived with no floor declared — each is checked below"
    fi
  else
    if [ -z "$derived_jobs" ]; then
      fail "the derivation found ZERO native-binding jobs in $label, which has a floor of $# — the sweep below would check nothing and pass"
    fi
    floor_ok=1
    for job in "$@"; do
      if ! grep -qxF "$job" <<<"$derived_jobs"; then
        fail "the derivation does not recognise $label job ${job} as loading a native binding — either it stopped building, testing or serving Next.js/vitest (drop it from this floor) or the derivation regressed and 'every such job' no longer holds"
        floor_ok=0
      fi
    done
    if [ "$floor_ok" = 1 ]; then
      pass "$label: the derivation recognises all $# known native-binding jobs ($(grep -c '' <<<"$derived_jobs") derived)"
    fi
  fi
  while IFS= read -r job; do
    [ -n "$job" ] || continue
    defects="$(job_wiring_defects "$job" <<<"$text")"
    if [ -z "$defects" ]; then
      pass "$label job ${job} loads a native binding and runs the gate as its step's single, whole run: line"
    else
      while IFS= read -r defect; do
        fail "$label job ${job} loads a native binding but ${defect}"
      done <<<"$defects"
    fi
  done <<<"$derived_jobs"
}
readonly -f assert_gate_wired

# 14a. Negative control: replace <job>'s gate invocation in the text on stdin
#      with `echo skipped` and assert the pin goes red. Each mutates the REAL
#      workflow text (so the derivation is exercised on the file it will
#      actually read). A control whose mutation changed nothing fails too —
#      otherwise it passes by testing the unmutated file. $1 = job, $2 = label.
assert_unwiring_caught() {
  local job="$1" label="$2" text mutated
  text="$(cat)"
  mutated="$(awk -v j="  ${job}:" -v hdr="$JOB_HEADER_RE" '
    $0 ~ hdr { in_job = ($0 == j) }
    in_job && /^[[:space:]]*run: bash scripts\/check-native-bindings\.sh[[:space:]]*$/ { sub(/run: .*/, "run: echo skipped") }
    { print }
  ' <<<"$text")"
  if [ "$mutated" = "$text" ]; then
    fail "negative control: unwiring $label ${job}'s gate changed nothing — the control would test the unmutated file"
  elif ! grep -qxF "$job" <<<"$(native_binding_jobs <<<"$mutated")"; then
    fail "negative control: $label ${job} is not derived as a native-binding job, so unwiring its gate goes unnoticed"
  elif [ -z "$(job_wiring_defects "$job" <<<"$mutated")" ]; then
    fail "negative control: $label ${job} with its gate replaced by 'echo skipped' reads as wired"
  else
    pass "negative control: unwiring $label ${job}'s gate is caught"
  fi
}
readonly -f assert_unwiring_caught

# Reads workflow text on stdin; prints one `job<TAB>value` line per job under
# `jobs:` that invokes the gate in an executable line. value is that job's
# JOB-LEVEL continue-on-error (quotes and a trailing comment stripped), or
# empty when it has none. A job-level `continue-on-error: true` lets the job
# pass with any step failing, the gate step included. It is a key of the JOB,
# not of any step, so the step-level check in 15 does not read it (review
# board on #10296).
gate_job_continue_on_error() {
  awk -v hdr="$JOB_HEADER_RE" '
    function flush() { if (job != "" && invokes) print job "\t" coe }
    /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
    !in_jobs { next }
    /^[[:space:]]*#/ { next }
    $0 ~ hdr { flush(); job = $1; sub(/:$/, "", job); invokes = 0; coe = ""; next }
    /^[^[:space:]]/ { flush(); job = ""; in_jobs = 0; next }
    /bash scripts\/check-native-bindings\.sh/ { invokes = 1 }
    /^    ["\047]?continue-on-error["\047]?[[:space:]]*:/ {
      v = $0
      sub(/^[^:]*:[[:space:]]*/, "", v)
      sub(/[[:space:]]+#.*$/, "", v)
      gsub(/["\047]/, "", v)
      sub(/[[:space:]]+$/, "", v)
      coe = (v == "" ? "(empty)" : v)
    }
    END { flush() }
  '
}
readonly -f gate_job_continue_on_error

# The one job allowed a job-level continue-on-error while invoking the gate,
# as `<workflow>:<job>` rows. ci.yml's test-e2e-crossbrowser is non-blocking as
# a WHOLE job for its first landing (its own comment: the firefox/webkit pass
# rate is unmeasured, and it sits outside ci-success.needs), so its gate is
# exactly as blocking as the rest of that job. The exemption is checked in both
# directions: a row whose job no longer invokes the gate with a job-level
# continue-on-error fails as stale, so flipping crossbrowser to blocking (which
# drops the key) has to delete this row too, and the row cannot outlive the
# reason for it (assert_coe_exemption_live, with its own negative controls).
readonly GATE_COE_EXEMPT='
ci.yml:test-e2e-crossbrowser
'

# Reads workflow text on stdin; prints one `job<TAB>flag<TAB>keys` line per
# STEP under `jobs:` whose executable lines invoke the gate, whatever the step
# is named and whether or not its job is derived (schema-drift.yml's gate step
# is named differently and sits in a job that loads no binding). flag is 1
# when the step carries a continue-on-error key anywhere in the step, any
# value, and 0 otherwise. keys lists, space-separated, every key of the step
# outside the closed set (STEP_KEY_AWK: name and run; continue-on-error is
# reported by flag instead), so an if:, shell: or working-directory: on a
# gate step outside any derived job is refused as well. A step runs from its `      - ` line to the next one, or to
# the first job-level (4-space) or job (2-space) key. Comment lines are
# skipped, so they neither end a step nor count inside it. This reads the
# whole step, where the check it replaces read a `grep -B3 -A1` window around
# the run: line and missed a key placed after an env: block (security and
# test seats on #10296).
gate_step_continue_on_error() {
  awk -v hdr="$JOB_HEADER_RE" "$STEP_KEY_AWK"'
    function flush() { if (in_step && inv) print job "\t" coe "\t" extra; in_step = 0 }
    /^jobs:[[:space:]]*$/ { in_jobs = 1; next }
    !in_jobs { next }
    /^[[:space:]]*#/ { next }
    $0 ~ hdr { flush(); job = $1; sub(/:$/, "", job); in_steps = 0; next }
    /^[^[:space:]]/ { flush(); job = ""; in_jobs = 0; in_steps = 0; next }
    /^    steps:[[:space:]]*$/ { flush(); in_steps = 1; next }
    /^    [^[:space:]]/ { flush(); in_steps = 0; next }
    in_steps && /^      - / { flush(); in_step = 1; inv = 0; coe = 0; extra = "" }
    !in_step { next }
    /bash scripts\/check-native-bindings\.sh/ { inv = 1 }
    /^[[:space:]]*(- )?["\047]?continue-on-error["\047]?[[:space:]]*:/ { coe = 1 }
    { k = step_key($0) }
    k != "" && k != "name" && k != "run" && k != "continue-on-error" { extra = extra (extra == "" ? "" : " ") k }
    END { flush() }
  '
}
readonly -f gate_step_continue_on_error

# 15. No continue-on-error may shadow any gate invocation: it would swallow the
#     non-zero exit and pass the job on a dropped binding. Reads workflow text
#     on stdin. $1 = its label, $2 = the job-level exemption table
#     (GATE_COE_EXEMPT, or a fixture's). Returns 3, checking nothing, when no
#     executable line invokes the gate; otherwise checks two places and
#     returns 0. On the STEP: every step that invokes the gate, read whole,
#     must carry no continue-on-error at all, and no key outside the closed
#     set of name and run (STEP_KEY_AWK). On the JOB: every job that
#     invokes the gate must have no job-level continue-on-error other than
#     `false`, unless the exemption table names it. Each half fails when its
#     cut found nothing, so neither can pass over zero items. It runs on every
#     workflow in the sweep and, in a subshell, on the fixtures below, so a
#     neutered check turns a fixture case red.
assert_gate_continue_on_error() {
  local label="$1" exempt="$2" text executable steps jobs job coe flag extra extra_keys key step_clean=1 job_clean=1 exempted=0
  text="$(cat)"
  executable="$(grep -v '^[[:space:]]*#' <<<"$text" || true)"
  grep -qF 'bash scripts/check-native-bindings.sh' <<<"$executable" || return 3
  steps="$(gate_step_continue_on_error <<<"$text")"
  if [ -z "$steps" ]; then
    fail "$label invokes the gate, but no step under jobs: was found invoking it — the step-level continue-on-error check would run over nothing"
  else
    while IFS=$'\t' read -r job flag extra; do
      if [ "$flag" = 1 ]; then
        fail "$label job ${job}: a step that invokes the native-bindings gate carries a step-level continue-on-error — gate exit code would be ignored"
        step_clean=0
      fi
      read -r -a extra_keys <<<"$extra"
      for key in ${extra_keys[@]+"${extra_keys[@]}"}; do
        fail "$label job ${job}: a step that invokes the native-bindings gate carries the key ${key}: — a gate step may carry only name and run, and any other key can change what runs or whether its exit counts"
        step_clean=0
      done
    done <<<"$steps"
    if [ "$step_clean" = 1 ]; then
      pass "$label: none of the $(grep -c '' <<<"$steps") step(s) invoking the gate carries a step-level continue-on-error or a key other than name and run"
    fi
  fi
  jobs="$(gate_job_continue_on_error <<<"$text")"
  if [ -z "$jobs" ]; then
    fail "$label invokes the gate, but no job under jobs: was found invoking it — the job-level continue-on-error check would run over nothing"
    return 0
  fi
  while IFS=$'\t' read -r job coe; do
    if [ -n "$coe" ] && [ "$coe" != "false" ]; then
      if grep -qxF "${label}:${job}" <<<"$exempt"; then
        exempted=$((exempted + 1))
      else
        fail "$label job ${job} invokes the native-bindings gate but has job-level continue-on-error: ${coe} — the job passes with the gate red"
        job_clean=0
      fi
    fi
  done <<<"$jobs"
  if [ "$job_clean" = 1 ]; then
    pass "$label: none of the $(grep -c '' <<<"$jobs") job(s) invoking the gate has a non-exempt job-level continue-on-error ($exempted exempt)"
  fi
  return 0
}
readonly -f assert_gate_continue_on_error

# The other direction of the job-level exemption. $1 = one GATE_COE_EXEMPT row
# (`<workflow>:<job>`); reads the text of the workflow that row names on stdin
# (empty when that file is missing). Passes when the row's job invokes the gate
# under a job-level continue-on-error other than `false`, read through the same
# cut assert_gate_continue_on_error uses; otherwise fails as stale, so the row
# cannot outlive the reason for it. The sweep calls it once per row and, in a
# subshell, the fixtures below call it, so a neutered staleness check turns a
# fixture case red (architect seat on #10296).
assert_coe_exemption_live() {
  local row="$1" text live
  text="$(cat)"
  live="$(gate_job_continue_on_error <<<"$text" \
    | awk -F'\t' -v j="${row#*:}" '$1 == j && $2 != "" && $2 != "false" { print $1 }')"
  if [ -n "$live" ]; then
    pass "continue-on-error exemption ${row} still matches a gate-invoking job with a job-level continue-on-error"
  else
    fail "continue-on-error exemption ${row} is stale — that job no longer invokes the gate under a job-level continue-on-error; delete the row from GATE_COE_EXEMPT"
  fi
}
readonly -f assert_coe_exemption_live

# $1 = a workflow the negative controls below mutate, $2 = the variable to load
# its text into. The workflow must have a NATIVE_BINDING_FLOORS row: a control
# is only meaningful where the floor has proven the derivation reads that file,
# and with the controls as the consumer, deleting a row from the table goes
# red here instead of unflooring the workflow in silence.
load_controlled_workflow() {
  local wf="$1" var="$2"
  if ! grep -qxF "$wf" <<<"$(floored_workflows)"; then
    fail "the negative controls mutate $wf, but NATIVE_BINDING_FLOORS has no row for it — its derivation would run unfloored"
  fi
  printf -v "$var" '%s' "$(cat "$WORKFLOWS_DIR/$wf")"
}
readonly -f load_controlled_workflow

# $1 = a workflows directory; prints every workflow file GitHub would run from
# it, one path per line: *.yml AND *.yaml. GitHub reads both extensions, and
# a *.yml-only glob let an ungated vitest job saved as zz-new.yaml sweep green
# while the same job as zz-new.yml went red (test seat on #10296; precedent:
# scripts/check-suite-wiring.sh).
list_workflow_files() {
  local dir="$1" f
  for f in "$dir"/*.yml "$dir"/*.yaml; do
    if [ -f "$f" ]; then printf '%s\n' "$f"; fi
  done
}
readonly -f list_workflow_files

# Hermetic: a .yaml workflow is enumerated, and an ungated vitest job in it is
# graded red by the same assert_gate_wired the sweep uses (run in a subshell
# so its expected FAIL is captured rather than counted).
yaml_dir="$TMPDIR_T/yaml-workflows"
mkdir -p "$yaml_dir"
printf 'on: push\njobs:\n  gated:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - name: Assert native swc binding survived npm ci\n        run: bash scripts/check-native-bindings.sh\n      - run: npx vitest run\n' >"$yaml_dir/gated.yml"
printf 'on: push\njobs:\n  zz-vitest:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npx vitest run\n' >"$yaml_dir/zz-new.yaml"
yaml_listed="$(list_workflow_files "$yaml_dir")"
if grep -qxF "$yaml_dir/zz-new.yaml" <<<"$yaml_listed" && grep -qxF "$yaml_dir/gated.yml" <<<"$yaml_listed"; then
  pass "workflow enumeration lists both *.yml and *.yaml"
else
  fail "workflow enumeration missed a file (got: ${yaml_listed:-nothing}) — a workflow GitHub runs would sit outside the sweep"
fi
yaml_graded=""
while IFS= read -r wf_path; do
  [ -n "$wf_path" ] || continue
  yaml_graded="${yaml_graded}$(assert_gate_wired "$(cat "$wf_path")" "${wf_path##*/}")"$'\n'
done <<<"$yaml_listed"
if grep -qF 'FAIL: zz-new.yaml job zz-vitest loads a native binding but does not invoke' <<<"$yaml_graded"; then
  pass "an ungated vitest job in a .yaml workflow is graded red"
else
  fail "an ungated vitest job in a .yaml workflow was not graded red (got: ${yaml_graded:-nothing})"
fi
if grep -qF 'FAIL: gated.yml' <<<"$yaml_graded"; then
  fail "fixture: the gated .yml control was graded red — the .yaml case may be red for the wrong reason"
fi

# Negative controls for the step and job rules: the gate step's if:, its
# position, step-level continue-on-error read over the whole step, and
# job-level continue-on-error with its exemption. Each fixture is a hermetic
# one-job workflow graded by the same two functions the sweep calls,
# assert_gate_wired and assert_gate_continue_on_error, in a subshell so the
# expected FAIL is captured rather than counted. Each asserts its own defect
# text. The correctly wired fixture is the pair: it must fail nothing and
# pass both functions, so a rule that fires on every job cannot read as a
# working control.
# $1 = label, $2 = job-level exemption table, $3 = job name, $4 = the job's
# lines from `continue-on-error`/`steps:` on, $5 = expected FAIL text, or
# empty for "must pass".
wiring_control() {
  local label="$1" exempt="$2" job="$3" body="$4" want="$5" fixture got
  fixture="$(printf 'on: push\njobs:\n  %s:\n    runs-on: ubuntu-latest\n%s\n' "$job" "$body")"
  got="$(assert_gate_wired "$fixture" fixture.yml; assert_gate_continue_on_error fixture.yml "$exempt" <<<"$fixture")"
  if [ -z "$want" ]; then
    if grep -q 'FAIL:' <<<"$got" \
       || ! grep -qF "PASS: fixture.yml job ${job} loads a native binding and runs the gate" <<<"$got" \
       || ! grep -qF 'PASS: fixture.yml: none of the 1 step(s) invoking the gate' <<<"$got" \
       || ! grep -qF 'PASS: fixture.yml: none of the 1 job(s) invoking the gate' <<<"$got"; then
      fail "wiring control: $label should pass every check and fail none (got: ${got:-nothing})"
    else
      pass "wiring control: $label passes"
    fi
  elif grep -qF "FAIL: $want" <<<"$got"; then
    pass "wiring control: $label is refused"
  else
    fail "wiring control: $label was not refused with '$want' (got: ${got:-nothing})"
  fi
}
readonly -f wiring_control

gate_name=$'      - name: Assert native swc binding survived npm ci'
gate_run=$'        run: bash scripts/check-native-bindings.sh'
wired_steps="    steps:
      - run: npm ci
${gate_name}
${gate_run}
      - run: npx vitest run"
wiring_control "a correctly wired gate step" "" nc-ok "$wired_steps" ""
wiring_control "a gate step carrying if: false" "" nc-if "    steps:
      - run: npm ci
${gate_name}
        if: false
${gate_run}
      - run: npx vitest run" \
  "fixture.yml job nc-if loads a native binding but native-bindings step carries an if:"
wiring_control "a gate step placed after npx vitest run" "" nc-late "    steps:
      - run: npm ci
      - run: npx vitest run
${gate_name}
${gate_run}" \
  "fixture.yml job nc-late loads a native binding but native-bindings step runs AFTER a step that already loads a native binding"
# Step-level continue-on-error, placed where a window around run: cannot see
# it: after a two-key env: block (the security seat's measured placement),
# and right after name: with a four-key env: block before run: (the test
# seat's). Both must be refused by the derived-job rule AND by the
# every-invocation sweep, so each half is controlled on its own text.
coe_after_env="    steps:
      - run: npm ci
${gate_name}
${gate_run}
        env:
          A: \"1\"
          B: \"2\"
        continue-on-error: true
      - run: npx vitest run"
wiring_control "step continue-on-error after an env: block (derived-job rule)" "" nc-coe-env "$coe_after_env" \
  "fixture.yml job nc-coe-env loads a native binding but native-bindings step carries a step-level continue-on-error"
wiring_control "step continue-on-error after an env: block (every-invocation sweep)" "" nc-coe-env "$coe_after_env" \
  "fixture.yml job nc-coe-env: a step that invokes the native-bindings gate carries a step-level continue-on-error"
coe_before_env="    steps:
      - run: npm ci
${gate_name}
        continue-on-error: true
        env:
          A: \"1\"
          B: \"2\"
          C: \"3\"
          D: \"4\"
${gate_run}
      - run: npx vitest run"
wiring_control "step continue-on-error before a four-key env: block (derived-job rule)" "" nc-coe-far "$coe_before_env" \
  "fixture.yml job nc-coe-far loads a native binding but native-bindings step carries a step-level continue-on-error"
wiring_control "step continue-on-error before a four-key env: block (every-invocation sweep)" "" nc-coe-far "$coe_before_env" \
  "fixture.yml job nc-coe-far: a step that invokes the native-bindings gate carries a step-level continue-on-error"
# A comment line at the step-list indent inside the step: YAML ignores it, so
# the key after it is still the gate step's.
wiring_control "step continue-on-error after a comment line (derived-job rule)" "" nc-coe-cmt "    steps:
      - run: npm ci
${gate_name}
${gate_run}
      # a note between two keys of the same step
        continue-on-error: true
      - run: npx vitest run" \
  "fixture.yml job nc-coe-cmt loads a native binding but native-bindings step carries a step-level continue-on-error"
# schema-drift.yml's shape: a differently named gate step in a job that loads
# no binding, so only the every-invocation sweep reads it.
wiring_control "step continue-on-error on a gate step outside any derived job" "" nc-coe-nd "    steps:
      - run: npm ci
      - name: Assert native bindings survived the install
        run: bash scripts/check-native-bindings.sh
        env:
          A: \"1\"
        continue-on-error: true
      - run: npm run db:drift" \
  "fixture.yml job nc-coe-nd: a step that invokes the native-bindings gate carries a step-level continue-on-error"
# The closed set of step keys (name and run). `shell: echo {0}` after run:
# makes the runner echo the script's path and exit 0 (the security seat's
# measured disarm on cd.yml test-web), and `working-directory:` points the
# gate at a tree that is not the one the job loads. Each is refused by name,
# by the derived-job rule and by the every-invocation sweep; the correctly
# wired fixture above (nc-ok) is the pair that must pass both.
shell_steps="    steps:
      - run: npm ci
${gate_name}
${gate_run}
        shell: echo {0}
      - run: npx vitest run"
wiring_control "a gate step carrying shell: after run: (derived-job rule)" "" nc-shell "$shell_steps" \
  "fixture.yml job nc-shell loads a native binding but native-bindings step carries the key shell:"
wiring_control "a gate step carrying shell: after run: (every-invocation sweep)" "" nc-shell "$shell_steps" \
  "fixture.yml job nc-shell: a step that invokes the native-bindings gate carries the key shell:"
wd_steps="    steps:
      - run: npm ci
${gate_name}
        \"working-directory\": apps/docs
${gate_run}
      - run: npx vitest run"
wiring_control "a gate step carrying a quoted \"working-directory\": (derived-job rule)" "" nc-wd-key "$wd_steps" \
  "fixture.yml job nc-wd-key loads a native binding but native-bindings step carries the key working-directory:"
wiring_control "a gate step carrying a quoted \"working-directory\": (every-invocation sweep)" "" nc-wd-key "$wd_steps" \
  "fixture.yml job nc-wd-key: a step that invokes the native-bindings gate carries the key working-directory:"
# schema-drift.yml's shape again: only the sweep reads this step, so it must
# refuse shell: and if: there itself, including a key on the step's `- ` line.
wiring_control "shell: on a gate step outside any derived job" "" nc-shell-nd "    steps:
      - run: npm ci
      - name: Assert native bindings survived the install
        run: bash scripts/check-native-bindings.sh
        shell: echo {0}
      - run: npm run db:drift" \
  "fixture.yml job nc-shell-nd: a step that invokes the native-bindings gate carries the key shell:"
wiring_control "if: on the - line of a gate step outside any derived job" "" nc-if-nd "    steps:
      - run: npm ci
      - if: false
        name: Assert native bindings survived the install
        run: bash scripts/check-native-bindings.sh
      - run: npm run db:drift" \
  "fixture.yml job nc-if-nd: a step that invokes the native-bindings gate carries the key if:"
# A comment line at the JOB-key indent (four spaces) inside a gate step. YAML
# ignores it, so the keys after it are still the step's. The sweep's cut ends
# a step at any four-space line, so without its comment skip this line ends
# the step early and hides every key after it; nc-coe-cmt's six-space comment
# cannot reach that branch (test seat on #10296). One fixture, graded for the
# continue-on-error flag and for the closed key set, which read the same cut;
# and a derived-job twin for the derived rule's cut.
cmt4_nd="    steps:
      - run: npm ci
      - name: Assert native bindings survived the install
        run: bash scripts/check-native-bindings.sh
    # a note at the job-key indent, inside the step
        continue-on-error: true
        shell: echo {0}
      - run: npm run db:drift"
wiring_control "step continue-on-error after a four-space comment line (every-invocation sweep)" "" nc-coe-cmt4 "$cmt4_nd" \
  "fixture.yml job nc-coe-cmt4: a step that invokes the native-bindings gate carries a step-level continue-on-error"
wiring_control "shell: after a four-space comment line (every-invocation sweep)" "" nc-coe-cmt4 "$cmt4_nd" \
  "fixture.yml job nc-coe-cmt4: a step that invokes the native-bindings gate carries the key shell:"
wiring_control "shell: after a four-space comment line (derived-job rule)" "" nc-shell-cmt4 "    steps:
      - run: npm ci
${gate_name}
${gate_run}
    # a note at the job-key indent, inside the step
        shell: echo {0}
      - run: npx vitest run" \
  "fixture.yml job nc-shell-cmt4 loads a native binding but native-bindings step carries the key shell:"
wiring_control "job-level continue-on-error on a gate-invoking job" "" nc-jcoe "    continue-on-error: true
$wired_steps" \
  "fixture.yml job nc-jcoe invokes the native-bindings gate but has job-level continue-on-error: true"
wiring_control "job-level continue-on-error: \${{ true }} on a gate-invoking job" "" nc-jexpr "    \"continue-on-error\": \${{ true }}
$wired_steps" \
  "fixture.yml job nc-jexpr invokes the native-bindings gate but has job-level continue-on-error: \${{ true }}"
# A column-0 comment line before the job-level key: YAML ignores it, but the
# job-level cut leaves jobs: at any column-0 line, so without its comment skip
# the key after it would never be read.
wiring_control "job-level continue-on-error after a column-0 comment line" "" nc-jcmt "# a note at column 0, inside the job
    continue-on-error: true
$wired_steps" \
  "fixture.yml job nc-jcmt invokes the native-bindings gate but has job-level continue-on-error: true"
wiring_control "job-level continue-on-error: false" "" nc-ok "    continue-on-error: false
$wired_steps" ""
# The exemption: the same job-level key, with the job named in the table,
# is passed and counted as exempt, and only that exact row exempts it.
wiring_control "job-level continue-on-error on an exempted job" $'\nfixture.yml:nc-jcoe\n' nc-jcoe "    continue-on-error: true
$wired_steps" ""
jcoe_graded="$(printf 'on: push\njobs:\n  nc-jcoe:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n%s\n' "$wired_steps" \
  | assert_gate_continue_on_error fixture.yml $'\nfixture.yml:nc-jcoe\n')"
if grep -qF 'PASS: fixture.yml: none of the 1 job(s) invoking the gate has a non-exempt job-level continue-on-error (1 exempt)' <<<"$jcoe_graded"; then
  pass "wiring control: the exempted job-level continue-on-error is counted as exempt"
else
  fail "wiring control: the exempted job-level continue-on-error was not counted as exempt (got: ${jcoe_graded:-nothing})"
fi
wiring_control "job-level continue-on-error exempted for a DIFFERENT job" $'\nfixture.yml:nc-other\nother.yml:nc-jcoe\n' nc-jcoe "    continue-on-error: true
$wired_steps" \
  "fixture.yml job nc-jcoe invokes the native-bindings gate but has job-level continue-on-error: true"

# Negative controls for the stale-exemption rule, the other direction of the
# exemption above. Each grades one exemption row against a hermetic workflow
# with assert_coe_exemption_live, the function the sweep calls, in a subshell
# so the expected FAIL is captured rather than counted, and asserts its own
# defect text. The live row is the pair: a job that keeps the key must pass
# and fail nothing, so a check that calls every row stale cannot read as a
# working control. $1 = label, $2 = exemption row, $3 = workflow text (empty
# for a missing file), $4 = expected FAIL text, or empty for "must pass".
exemption_control() {
  local label="$1" row="$2" text="$3" want="$4" got
  got="$(assert_coe_exemption_live "$row" <<<"$text")"
  if [ -z "$want" ]; then
    if grep -q 'FAIL:' <<<"$got" \
       || ! grep -qF "PASS: continue-on-error exemption ${row} still matches" <<<"$got"; then
      fail "exemption control: $label should pass and fail nothing (got: ${got:-nothing})"
    else
      pass "exemption control: $label passes"
    fi
  elif grep -qF "FAIL: $want" <<<"$got"; then
    pass "exemption control: $label is refused"
  else
    fail "exemption control: $label was not refused with '$want' (got: ${got:-nothing})"
  fi
}
readonly -f exemption_control

jcoe_live="$(printf 'on: push\njobs:\n  nc-jcoe:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n%s\n' "$wired_steps")"
exemption_control "a row whose job keeps the job-level key" fixture.yml:nc-jcoe "$jcoe_live" ""
exemption_control "a row whose job dropped the job-level key" fixture.yml:nc-jstale \
  "$(printf 'on: push\njobs:\n  nc-jstale:\n    runs-on: ubuntu-latest\n%s\n' "$wired_steps")" \
  "continue-on-error exemption fixture.yml:nc-jstale is stale"
exemption_control "a row whose job set the key to false" fixture.yml:nc-jfalse \
  "$(printf 'on: push\njobs:\n  nc-jfalse:\n    runs-on: ubuntu-latest\n    continue-on-error: false\n%s\n' "$wired_steps")" \
  "continue-on-error exemption fixture.yml:nc-jfalse is stale"
exemption_control "a row whose job keeps the key but no longer invokes the gate" fixture.yml:nc-jnogate \
  "$(printf 'on: push\njobs:\n  nc-jnogate:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n    steps:\n      - run: npm ci\n      - run: npx vitest run\n')" \
  "continue-on-error exemption fixture.yml:nc-jnogate is stale"
exemption_control "a row naming a job the workflow does not have" fixture.yml:nc-other "$jcoe_live" \
  "continue-on-error exemption fixture.yml:nc-other is stale"
exemption_control "a row naming a missing workflow" gone.yml:nc-jcoe "" \
  "continue-on-error exemption gone.yml:nc-jcoe is stale"

# The sweep itself. Every *.yml and *.yaml under .github/workflows/ is read —
# the gh-aw *.lock.yml compilations included, since they are workflows GitHub
# runs — and each is graded against its floor (if any). Every floored workflow
# must be present: a floor whose file is missing would otherwise never be
# evaluated, and the derivation's self-test would vanish without a FAIL
# (lesson 9).
workflow_files=()
while IFS= read -r wf_path; do
  if [ -n "$wf_path" ]; then workflow_files+=("$wf_path"); fi
done <<<"$(list_workflow_files "$WORKFLOWS_DIR")"
floored_missing=0
for wf_label in $(floored_workflows); do
  if [ ! -f "$WORKFLOWS_DIR/$wf_label" ]; then
    fail "floored workflow $wf_label not found under $WORKFLOWS_DIR — its floor cannot be evaluated"
    floored_missing=1
  fi
done

if [ "${#workflow_files[@]}" -gt 0 ] && [ "$floored_missing" = 0 ]; then
  # Declared before load_controlled_workflow fills them through printf -v. The
  # linter cannot see an indirect assignment, so without these it reports every
  # later "$ci"/"$qg"/"$cdwf" as SC2154 and the CI shellcheck step fails.
  ci="" qg="" cdwf=""
  load_controlled_workflow ci.yml ci
  load_controlled_workflow quality-gates.yml qg
  load_controlled_workflow cd.yml cdwf

  # 15 rides along (assert_gate_continue_on_error, above). It runs wherever an
  #    invocation exists (schema-drift.yml carries one outside any derived
  #    job, so this is broader than the derived set), and the count of such
  #    workflows must be non-zero or the check ran over nothing.
  invoking_workflows=0
  for wf_path in "${workflow_files[@]}"; do
    wf_label="${wf_path##*/}"
    wf_text="$(cat "$wf_path")"
    read -r -a floor <<<"$(floor_jobs "$wf_label")"
    assert_gate_wired "$wf_text" "$wf_label" ${floor[@]+"${floor[@]}"}
    if assert_gate_continue_on_error "$wf_label" "$GATE_COE_EXEMPT" <<<"$wf_text"; then
      invoking_workflows=$((invoking_workflows + 1))
    fi
  done
  # The other direction: every exemption must still describe a job that
  # invokes the gate under a job-level continue-on-error, or it is stale
  # (assert_coe_exemption_live, controlled by the stale-exemption fixtures
  # above). A row naming a missing workflow is graded on empty text: stale.
  while IFS= read -r coe_exempt; do
    [ -n "$coe_exempt" ] || continue
    exempt_text=""
    if [ -f "$WORKFLOWS_DIR/${coe_exempt%%:*}" ]; then
      exempt_text="$(cat "$WORKFLOWS_DIR/${coe_exempt%%:*}")"
    fi
    assert_coe_exemption_live "$coe_exempt" <<<"$exempt_text"
  done <<<"$GATE_COE_EXEMPT"
  if [ "$invoking_workflows" -gt 0 ]; then
    pass "swept ${#workflow_files[@]} workflow file(s) under .github/workflows; $invoking_workflows invoke the gate"
  else
    fail "swept ${#workflow_files[@]} workflow file(s) and none invokes scripts/check-native-bindings.sh — the continue-on-error check ran over nothing"
  fi

  # The regression from #8632: test-e2e-crossbrowser loses its gate. The
  # hand-typed list did not contain that job, so this exact mutation left the
  # whole suite green. And the three shapes #10200 added, one per detection
  # path: a vitest-only job, a job that builds through `npm run build`, and a
  # job whose only Next.js process is a Playwright webServer.
  assert_unwiring_caught test-e2e-crossbrowser ci.yml <<<"$ci"
  assert_unwiring_caught observatory-tests ci.yml <<<"$ci"
  assert_unwiring_caught test-mcp quality-gates.yml <<<"$qg"
  assert_unwiring_caught lighthouse-delta quality-gates.yml <<<"$qg"
  assert_unwiring_caught editor-boot quality-gates.yml <<<"$qg"
  # #10222: cd.yml's own regression shape — test-web/test-mcp losing the gate
  # they were just given, and e2e (which always had it) losing it too, so a
  # future edit to any of the three is caught the same way.
  assert_unwiring_caught test-web cd.yml <<<"$cdwf"
  assert_unwiring_caught test-mcp cd.yml <<<"$cdwf"
  assert_unwiring_caught e2e cd.yml <<<"$cdwf"

  # A NEW job appended to ci.yml. $1 = job name, $2 = its steps after npm ci.
  with_job() {
    printf '%s\n  %s:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n%s\n' "$ci" "$1" "$2"
  }
  # Asserts <job> in the text on stdin is (want=yes) or is not (want=no) derived.
  expect_derived() {
    local want="$1" job="$2" label="$3" got
    got="$(native_binding_jobs)"
    if grep -qxF "$job" <<<"$got"; then
      if [ "$want" = yes ]; then pass "derivation: $label → counted as a native-binding job"; else fail "derivation: $label → counted as a native-binding job, but it loads none"; fi
    else
      if [ "$want" = no ]; then pass "derivation: $label → not counted"; else fail "derivation: $label → NOT counted, so a job doing this could drop the gate unseen"; fi
    fi
  }

  direct="$(with_job nc-direct $'      - name: Build\n        working-directory: web\n        run: npx next build')"
  expect_derived yes nc-direct "a new job running \`npx next build\`" <<<"$direct"
  if [ -n "$(job_wiring_defects nc-direct <<<"$direct")" ]; then
    pass "negative control: a NEW native-binding job without the gate is caught without editing any list"
  else
    fail "negative control: a NEW native-binding job without the gate reads as wired"
  fi
  # The same unwired job, now followed by a GATED job whose key has an
  # underscore. If the block extractor stops only at hyphenated keys, nc-direct
  # runs on into nc_gated, borrows its gate step and reads as wired.
  gated_step=$'      - name: Assert native swc binding survived npm ci\n        run: bash scripts/check-native-bindings.sh\n      - run: cd web && npx next build'
  followed="$(printf '%s\n  nc_gated:\n    runs-on: ubuntu-latest\n    steps:\n%s\n' "$direct" "$gated_step")"
  if [ -z "$(job_wiring_defects nc_gated <<<"$followed")" ]; then
    pass "fixture: the underscored job nc_gated reads as wired on its own"
  else
    fail "fixture: nc_gated should read as wired — the next case would pass for the wrong reason"
  fi
  if [ -n "$(job_wiring_defects nc-direct <<<"$followed")" ]; then
    pass "negative control: an unwired job followed by an underscored gated job is still caught"
  else
    fail "negative control: nc-direct borrowed the gate of the underscored job after it and reads as wired"
  fi
  # And an underscored native-binding job is derived AND its unwiring caught.
  assert_unwiring_caught nc_gated "an appended underscored job" <<<"$(with_job nc_gated "$gated_step")"
  expect_derived yes nc-wd "\`npm run build\` with working-directory: apps/docs" \
    <<<"$(with_job nc-wd $'      - name: Build docs\n        working-directory: apps/docs\n        run: npm run build')"
  expect_derived yes nc-cd "\`cd web && npm run build\`" \
    <<<"$(with_job nc-cd $'      - run: cd web && npm run build')"
  expect_derived yes nc-defaults "\`npm run build\` under a job-level defaults working-directory: web" \
    <<<"$(printf '%s\n  nc-defaults:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: web\n    steps:\n      - run: npm run build\n' "$ci")"
  expect_derived yes nc-vitest "\`npx vitest run\` piped through tee (test-web's shape)" \
    <<<"$(with_job nc-vitest $'      - run: |\n          timeout 600 npx vitest run --coverage 2>&1 | tee /tmp/vitest-output.txt')"
  expect_derived yes nc-npm-test "\`cd packages/ui && npm test\` (a \"vitest run\" script)" \
    <<<"$(with_job nc-npm-test $'      - run: cd packages/ui && npm test')"
  expect_derived yes nc-next-dev "a step running \`npx next dev\`" \
    <<<"$(with_job nc-next-dev $'      - run: cd web && npx next dev')"
  expect_derived yes nc-dev-script "\`npm run dev:raw\` in web (a \"next dev\" script)" \
    <<<"$(with_job nc-dev-script $'      - working-directory: web\n        run: npm run dev:raw')"
  expect_derived yes nc-pw-dev "\`playwright test\` in web with no --config (playwright.config.ts starts \`npm run dev:raw\`, editor-boot's shape)" \
    <<<"$(with_job nc-pw-dev $'      - working-directory: web\n        run: npx playwright test --grep "@smoke" e2e/tests/editor-boot.spec.ts')"
  expect_derived no nc-pw-start "\`playwright test --config playwright.ci.config.ts\` alone (its webServer runs \`npx next start\`, which loads no binding)" \
    <<<"$(with_job nc-pw-start $'      - working-directory: web\n        run: npx playwright test --config playwright.ci.config.ts')"
  expect_derived no nc-ui "\`cd packages/ui && npm run build\` (a tsc build)" \
    <<<"$(with_job nc-ui $'      - run: cd packages/ui && npm run build')"
  expect_derived no nc-storybook "\`npm run build-storybook\` (a different script)" \
    <<<"$(with_job nc-storybook $'      - run: cd apps/design && npm run build-storybook')"
  expect_derived no nc-vitest-path "vitest named only in paths (\`bash scripts/check-vitest-exit.sh 1 /tmp/vitest-output.txt\`)" \
    <<<"$(with_job nc-vitest-path $'      - run: bash scripts/check-vitest-exit.sh 1 /tmp/vitest-output.txt')"
  expect_derived no nc-comment "a commented-out \`npx next build\`" \
    <<<"$(with_job nc-comment $'      # - run: npx next build\n      - run: echo hi')"
  expect_derived no nc-name "a step NAMED 'next build' that runs something else" \
    <<<"$(with_job nc-name $'      - name: next build smoke\n        run: echo hi')"
  unresolvable="$(native_binding_jobs <<<"$(with_job nc-missing $'      - working-directory: no/such/dir\n        run: npm run build')")"
  if grep -q $'^?\tnc-missing\tno/such/dir\t' <<<"$unresolvable"; then
    pass "derivation: \`npm run build\` in a dir with no package.json → reported unresolvable, not skipped"
  else
    fail "derivation: \`npm run build\` in a dir with no package.json was not reported unresolvable (got: ${unresolvable:-nothing})"
  fi
  unresolvable="$(native_binding_jobs <<<"$(with_job nc-no-config $'      - working-directory: web\n        run: npx playwright test --config no-such.config.ts')")"
  if grep -q $'^?\tnc-no-config\tweb\t' <<<"$unresolvable"; then
    pass "derivation: \`playwright test --config <missing file>\` → reported unresolvable, not skipped"
  else
    fail "derivation: \`playwright test\` against a missing config was not reported unresolvable (got: ${unresolvable:-nothing})"
  fi

  # 16. Self-defense registration: the lockfile-sync-tests (CI Self-Defense
  #     Tests) job must shellcheck the gate + this suite AND run this suite,
  #     so a PR that neuters either fails a required check.
  lst_block="$(awk -v hdr="$JOB_HEADER_RE" '/^  lockfile-sync-tests:/{f=1} f{print} f && $0 ~ hdr && !/^  lockfile-sync-tests:/{exit}' <<<"$ci")"
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
  fail "no workflow files under $WORKFLOWS_DIR, or a floored workflow is missing — structural assertions cannot run"
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
