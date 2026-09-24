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
#    check-npm-audit.test.sh's quality-gates/ci.yml sections). The gate is only
#    real if CI actually invokes it; a PR that unwires an invocation, adds
#    continue-on-error, or drops the self-defense registration must fail here.
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"

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
readonly -f next_build_jobs

# Reads workflow text on stdin; prints one line per way <job> fails to run the
# gate, and nothing when it is wired. Job blocks are extracted individually so
# an invocation moving to the wrong job (or a job losing its invocation while
# another keeps two) cannot cancel out in a whole-file count.
job_wiring_defects() {
  local job="$1" text job_block job_executable step_block run_count
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

# 14. EVERY job that loads a native binding must invoke the gate, where
#     "every" is the derived set above rather than a list someone keeps in
#     step with the workflow. $1 = workflow text, $2 = its label, $3.. = the
#     jobs known to need the gate today. That floor is a self-test of the
#     derivation, NOT the set under test (lesson 9 — a sweep over zero jobs
#     reads as zero defects): a new job is checked without being added here,
#     and a job missing from it is still checked if it loads a binding.
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
  if [ -z "$derived_jobs" ]; then
    fail "the derivation found ZERO native-binding jobs in $label — the sweep below would check nothing and pass"
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

if [ -f "$CI_YML" ] && [ -f "$QG_YML" ]; then
  ci="$(cat "$CI_YML")"
  qg="$(cat "$QG_YML")"

  assert_gate_wired "$ci" ci.yml \
    build-nextjs test-e2e-ui test-e2e-api test-e2e-auth test-e2e-journey test-e2e-engine-smoke test-e2e-crossbrowser docs-e2e \
    observatory-tests docs-internal-gate design-internal-gate
  # quality-gates.yml runs no `next build` line of its own: lighthouse-delta
  # builds through web's `npm run build`, test-web and test-mcp run vitest,
  # and editor-boot's Playwright config starts `next dev` (#10200).
  assert_gate_wired "$qg" quality-gates.yml \
    test-web test-mcp editor-boot lighthouse-delta

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

  # 15. No continue-on-error may shadow any gate invocation — it would swallow
  #     the non-zero exit and pass the job on a dropped binding. Windowed to
  #     the invocation lines so legitimate continue-on-error elsewhere in a
  #     workflow does not false-positive.
  for wf_label in ci.yml quality-gates.yml; do
    if [ "$wf_label" = ci.yml ]; then wf_text="$ci"; else wf_text="$qg"; fi
    native_windows="$(grep -v '^[[:space:]]*#' <<<"$wf_text" | grep -B3 -A1 'bash scripts/check-native-bindings.sh' || true)"
    if grep -q 'continue-on-error' <<<"$native_windows"; then
      fail "a $wf_label native-bindings gate step has continue-on-error — gate exit code would be ignored"
    else
      pass "$wf_label: no continue-on-error shadows any native-bindings gate invocation"
    fi
  done

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
  fail "workflow files not found at $CI_YML / $QG_YML — structural assertions cannot run"
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
