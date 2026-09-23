#!/usr/bin/env bash
# Contract test for scripts/resolve-ci-wasm-artifact.sh — the step that lets
# CD's first build after an engine merge adopt the four WASM variants the PR's
# own CI run already built, instead of compiling them again (#9525).
#
# WHY THIS SUITE IS MOSTLY NEGATIVE CASES
#
# The two failure directions are not symmetric:
#
#   a false NEGATIVE costs one ~6-minute CD build.
#   a false POSITIVE publishes a WASM engine to the CDN and to production that
#   was built from different sources than the tree being deployed.
#
# So nearly every case below is one way the proof can be absent, and each must
# answer "no reuse" (find: an empty run-id; adopt: reused=false) rather than
# guess. The positive cases are pinned too: a resolver that can only ever say no
# is not safe, it is broken, and it would quietly keep the duplicate build.
#
# The `gh` stub applies the script's REAL --jq filters to canned API payloads
# shaped like GitHub's, so the filters are exercised rather than assumed. It
# strips CR because jq.exe on Windows writes CRLF and the real gh never does.
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so this suite has
# no SC2015 findings — CI's self-defense job shellchecks it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../resolve-ci-wasm-artifact.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "resolver script not found: $SCRIPT"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required to run these tests"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git is required to run these tests"; exit 1; }

ARTIFACT='wasm-binaries-cd-reuse'
KEY_FILE='wasm-ci-reuse-key.txt'
BUILD_JOB='Quality Gates / WASM Build'
PR_HEAD='9a38efb674a781fded5711f6dbeefa748d066f69'
VARIANTS=(pkg-webgl2 pkg-webgpu pkg-webgl2-runtime pkg-webgpu-runtime)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- fixtures ---------------------------------------------------------------

# A throwaway repo carrying every input of the ci-reuse key, committed with the
# given subject so both `find` (which reads the subject) and `adopt` (which
# recomputes the key) run against real git objects.
make_repo() {
  local subject="$1" repo
  repo="$(mktemp -d "$WORK/repo.XXXXXX")"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    mkdir -p engine/src .transform-gizmo-fork/crates .github/workflows scripts
    printf 'fn main() {}\n' > engine/src/lib.rs
    printf 'gizmo source\n' > .transform-gizmo-fork/crates/lib.rs
    printf 'name: CD\n' > .github/workflows/cd.yml
    printf 'name: Quality Gates\n' > .github/workflows/quality-gates.yml
    printf '#!/usr/bin/env bash\n' > scripts/install-wasm-bindgen-cli.sh
    git add -A
    git commit -qm "$subject"
  )
  printf '%s' "$repo"
}

# Canned API payloads, one directory per case. A file whose whole content is
# ERROR makes the stub fail the call like an HTTP 502; a file that does not
# exist fails it like an HTTP 404.
new_fixtures() {
  local fx
  fx="$(mktemp -d "$WORK/fx.XXXXXX")"
  : > "$fx/calls.log"
  printf '%s' "$fx"
}

# $1 = head sha, $2 = head repo, $3 = merge_commit_sha (default @HEAD@, which
# the stub replaces with the checked-out commit), $4 = merged_at as a JSON
# literal (default a timestamp; pass null for an unmerged PR).
pull_json() {
  local merge_sha="${3:-@HEAD@}" merged_at="${4:-}"
  if [ -z "$merged_at" ]; then merged_at='"2026-09-22T00:00:00Z"'; fi
  printf '{"number":123,"state":"closed","merged_at":%s,"merge_commit_sha":"%s","head":{"sha":"%s","repo":{"full_name":"%s"}}}\n' \
    "$merged_at" "$merge_sha" "$1" "$2"
}

# One workflow_runs element. $1 id, $2 path, $3 event, $4 head repo, $5 head sha
run_obj() {
  printf '{"id":%s,"name":"x","path":"%s","event":"%s","head_sha":"%s","head_repository":{"full_name":"%s"},"status":"completed","conclusion":"success"}' \
    "$1" "$2" "$3" "$5" "$4"
}

runs_json() { # args: run objects
  local joined
  joined="$(IFS=,; printf '%s' "$*")"
  printf '{"total_count":%s,"workflow_runs":[%s]}\n' "$#" "$joined"
}

jobs_json() { # $1 = WASM Build conclusion ('absent' leaves the job out, 'null' is JSON null)
  local wasm
  case "$1" in
    absent) wasm='' ;;
    null) wasm="{\"name\":\"${BUILD_JOB}\",\"status\":\"in_progress\",\"conclusion\":null}," ;;
    *) wasm="{\"name\":\"${BUILD_JOB}\",\"status\":\"completed\",\"conclusion\":\"$1\"}," ;;
  esac
  printf '{"total_count":3,"jobs":[%s{"name":"Quality Gates / Lint","conclusion":"success"},{"name":"CI Gate","conclusion":"success"}]}\n' "$wasm"
}

artifacts_json() { # $1 = name, $2 = expired
  printf '{"total_count":1,"artifacts":[{"id":42,"name":"%s","expired":%s,"size_in_bytes":1}]}\n' "$1" "$2"
}

# The happy-path payload set: one same-repo pull_request CI run (222) whose WASM
# Build succeeded and whose reuse artifact is still live. Cases overwrite one
# file to knock out exactly one piece of the proof.
happy_fixtures() {
  local fx
  fx="$(new_fixtures)"
  pull_json "$PR_HEAD" o/r > "$fx/pull.json"
  runs_json \
    "$(run_obj 111 .github/workflows/changeset-check.yml pull_request o/r "$PR_HEAD")" \
    "$(run_obj 222 .github/workflows/ci.yml pull_request o/r "$PR_HEAD")" > "$fx/runs.json"
  jobs_json success > "$fx/jobs-222.json"
  artifacts_json "$ARTIFACT" false > "$fx/artifacts-222.json"
  printf '%s' "$fx"
}

STUB_DIR="$WORK/bin"
mkdir -p "$STUB_DIR"
cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
# Stand-in for `gh api`. Applies the caller's real --jq filter to a canned
# payload chosen by endpoint, and logs every call for the query-shape checks.
set -uo pipefail
fixtures="${GH_STUB_FIXTURES:?}"
printf '%s\n' "$*" >> "$fixtures/calls.log"
if [ "${1:-}" != api ]; then echo "stub gh: only 'api' is supported" >&2; exit 2; fi
shift
endpoint=''
filter=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) shift ;;
    --jq) filter="$2"; shift 2 ;;
    -*) echo "stub gh: unexpected flag $1" >&2; exit 2 ;;
    *) endpoint="$1"; shift ;;
  esac
done
case "$endpoint" in
  */pulls/*) file=pull ;;
  */actions/runs/*/jobs*) id="${endpoint#*/actions/runs/}"; file="jobs-${id%%/*}" ;;
  */actions/runs/*/artifacts*) id="${endpoint#*/actions/runs/}"; file="artifacts-${id%%/*}" ;;
  */actions/runs\?*) file=runs ;;
  *) echo "stub gh: unexpected endpoint $endpoint" >&2; exit 2 ;;
esac
path="$fixtures/$file.json"
if [ ! -f "$path" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
if [ "$(cat "$path")" = ERROR ]; then echo "gh: Server Error (HTTP 502)" >&2; exit 1; fi
# @HEAD@ stands for the commit the caller has checked out: a fixture is written
# before the throwaway repo that commit lives in exists.
head="$(git rev-parse HEAD 2>/dev/null || true)"
if [ -n "$filter" ]; then
  sed "s/@HEAD@/${head}/g" "$path" | jq -r "$filter" | tr -d '\r'
else
  sed "s/@HEAD@/${head}/g" "$path" | tr -d '\r'
fi
STUB
chmod +x "$STUB_DIR/gh"

# run_find <fixtures> [subject] — echoes the script's combined output; the
# GITHUB_OUTPUT file is left at <fixtures>/out.
run_find() {
  local fx="$1" subject="${2:-feat(engine): a change (#123)}" repo
  repo="$(make_repo "$subject")"
  : > "$fx/out"
  ( cd "$repo" && GH_CLI="$STUB_DIR/gh" GH_STUB_FIXTURES="$fx" \
      GITHUB_REPOSITORY=o/r GITHUB_OUTPUT="$fx/out" \
      bash "$SCRIPT" find 2>&1 )
}

assert_run_id() { # $1 label, $2 want ('' = no reuse), $3 output, $4 fixtures dir
  local label="$1" want="$2" out="$3" fx="$4"
  if grep -qx "run-id=${want}" <<<"$out" && grep -qx "run-id=${want}" "$fx/out"; then
    if [ -z "$want" ]; then
      pass "$label -> no reuse (empty run-id on stdout and in GITHUB_OUTPUT)"
    else
      pass "$label -> run-id=${want} (stdout and GITHUB_OUTPUT)"
    fi
  else
    fail "$label -> expected run-id=${want}; output: $(tr '\n' ' ' <<<"$out") | GITHUB_OUTPUT: $(tr '\n' ' ' < "$fx/out")"
  fi
  if [ "$(grep -c '^run-id=' "$fx/out")" -eq 1 ]; then
    pass "$label -> exactly one run-id line reached GITHUB_OUTPUT"
  else
    fail "$label -> GITHUB_OUTPUT carries $(grep -c '^run-id=' "$fx/out") run-id lines (expected 1)"
  fi
}

echo "=== resolve-ci-wasm-artifact.sh find ==="

# --- the positive case --------------------------------------------------------
FX="$(happy_fixtures)"
OUT="$(run_find "$FX")"
assert_run_id "same-repo PR, green WASM Build, live artifact" 222 "$OUT" "$FX"
if grep -qF "#123" <<<"$OUT" && grep -qF "$PR_HEAD" <<<"$OUT"; then
  pass "the positive answer names the PR and the head it came from"
else
  fail "the positive answer does not say which PR/head it resolved: $OUT"
fi
if grep -qF '::notice::' <<<"$OUT"; then
  fail "a found artifact emitted a ::notice:: — notices are reserved for the no-reuse branches"
else
  pass "a found artifact is reported as a plain log line, not as a miss notice"
fi

# The query shapes. None of these is observable from the verdict: an
# unpaginated jobs list (43 jobs on a real CI run, 30 per page by default) or a
# runs query without the event filter still usually answers correctly.
CALLS="$(cat "$FX/calls.log")"
runs_call="$(grep -F '/actions/runs?' <<<"$CALLS" | head -1)"
if grep -qF "head_sha=${PR_HEAD}" <<<"$runs_call" && grep -qF 'event=pull_request' <<<"$runs_call"; then
  pass "the runs query filters on the PR head sha and the pull_request event"
else
  fail "the runs query is not filtered on head_sha + event=pull_request: '$runs_call'"
fi
if grep -qF -- '--paginate' <<<"$runs_call" && grep -qF 'per_page=100' <<<"$runs_call"; then
  pass "the runs query is paginated at 100 per page"
else
  fail "the runs query is not --paginate'd at per_page=100: '$runs_call'"
fi
jobs_call="$(grep -F '/jobs' <<<"$CALLS" | head -1)"
if grep -qF 'filter=latest' <<<"$jobs_call" && grep -qF 'per_page=100' <<<"$jobs_call" && grep -qF -- '--paginate' <<<"$jobs_call"; then
  pass "the jobs query reads the latest attempt, paginated at 100 per page"
else
  fail "the jobs query is missing filter=latest / per_page=100 / --paginate: '$jobs_call'"
fi
artifacts_call="$(grep -F '/artifacts' <<<"$CALLS" | head -1)"
if grep -qF "name=${ARTIFACT}" <<<"$artifacts_call"; then
  pass "the artifacts query asks for ${ARTIFACT} by name"
else
  fail "the artifacts query does not filter on name=${ARTIFACT}: '$artifacts_call'"
fi
if grep -q '/jobs\|/artifacts' <<<"$(grep -F 'runs/111/' <<<"$CALLS")"; then
  fail "the resolver inspected run 111, which is not a ci.yml run"
else
  pass "only ci.yml runs are inspected (the changeset-check run on the same head is ignored)"
fi

# This repo's PR titles often end in their own issue reference, so the squash
# subject carries two: "<title> (#ISSUE) (#PR)". GitHub appends the PR number
# last, and that is the one to resolve. Reading the first would query an issue
# number as a pull request and never reuse anything, silently.
echo ""
echo "--- a title that already ends in an issue reference resolves the PR, not the issue ---"
FX="$(happy_fixtures)"
OUT="$(run_find "$FX" "fix(engine): a change (#9525) (#123)")"
assert_run_id "subject '... (#9525) (#123)'" 222 "$OUT" "$FX"
if grep -qF 'pulls/123' "$FX/calls.log" && ! grep -qF 'pulls/9525' "$FX/calls.log"; then
  pass "only pull request #123 (the trailing reference) was queried"
else
  fail "the wrong reference was resolved: $(tr '\n' ' ' < "$FX/calls.log")"
fi

echo ""
echo "--- a later run on the same head that does not qualify falls through to one that does ---"
FX="$(happy_fixtures)"
runs_json \
  "$(run_obj 333 .github/workflows/ci.yml pull_request o/r "$PR_HEAD")" \
  "$(run_obj 222 .github/workflows/ci.yml pull_request o/r "$PR_HEAD")" > "$FX/runs.json"
jobs_json failure > "$FX/jobs-333.json"
artifacts_json "$ARTIFACT" false > "$FX/artifacts-333.json"
OUT="$(run_find "$FX")"
assert_run_id "newest run's WASM Build failed, older run on the same head qualifies" 222 "$OUT" "$FX"

echo ""
echo "--- every way the proof can be absent must answer no reuse ---"

FX="$(happy_fixtures)"
OUT="$(run_find "$FX" "hotfix: pushed straight to main")"
assert_run_id "no '(#N)' in the subject (direct push)" "" "$OUT" "$FX"
if grep -qF '::notice::' <<<"$OUT"; then
  pass "a no-reuse answer is surfaced as a ::notice:: (never a silent rebuild)"
else
  fail "a no-reuse answer carried no ::notice:: — the fallback build would be silent: $OUT"
fi
if [ -s "$FX/calls.log" ]; then
  fail "a direct push still called the API: $(tr '\n' ' ' < "$FX/calls.log")"
else
  pass "a direct push answers without any API call"
fi

FX="$(happy_fixtures)"; echo ERROR > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the pull-request lookup fails" "" "$OUT" "$FX"

FX="$(happy_fixtures)"; pull_json not-a-sha o/r > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the PR head sha is malformed" "" "$OUT" "$FX"

# A fork's CI run executes code outside this repository's write access, so its
# artifact is never adopted into a production deploy.
FX="$(happy_fixtures)"; pull_json "$PR_HEAD" someone/fork > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the PR comes from a fork" "" "$OUT" "$FX"
if grep -qF 'fork' <<<"$OUT"; then
  pass "the fork refusal says why"
else
  fail "the fork refusal does not mention the fork: $OUT"
fi

# The "(#N)" is text anyone with push access can type. Only the pull request's
# own record proves it produced this commit: merged, with this commit as its
# merge commit. Without that, a subject naming an open or unrelated PR would
# point CD at a run built from code that never reached main.
FX="$(happy_fixtures)"
pull_json "$PR_HEAD" o/r dddddddddddddddddddddddddddddddddddddddd null > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the referenced pull request is not merged" "" "$OUT" "$FX"
if grep -qF 'not merged' <<<"$OUT"; then
  pass "the unmerged refusal says why"
else
  fail "the unmerged refusal does not say the PR is not merged: $OUT"
fi
if grep -qF '/actions/runs' "$FX/calls.log"; then
  fail "an unmerged PR still had its CI runs inspected"
else
  pass "an unmerged PR is refused before any CI run is inspected"
fi

FX="$(happy_fixtures)"
pull_json "$PR_HEAD" o/r cccccccccccccccccccccccccccccccccccccccc > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the referenced PR merged as a different commit than the one checked out" "" "$OUT" "$FX"
if grep -qF 'cccccccccccccccccccccccccccccccccccccccc' <<<"$OUT"; then
  pass "the merge-commit refusal names the commit the PR actually merged as"
else
  fail "the merge-commit refusal does not name the PR's merge commit: $OUT"
fi

FX="$(happy_fixtures)"
printf '{"number":123,"merged_at":"2026-09-22T00:00:00Z","merge_commit_sha":null,"head":{"sha":"%s","repo":{"full_name":"o/r"}}}\n' "$PR_HEAD" > "$FX/pull.json"
OUT="$(run_find "$FX")"
assert_run_id "the referenced PR reports no merge commit at all" "" "$OUT" "$FX"

FX="$(happy_fixtures)"; echo ERROR > "$FX/runs.json"
OUT="$(run_find "$FX")"
assert_run_id "the workflow-runs lookup fails" "" "$OUT" "$FX"

FX="$(happy_fixtures)"
runs_json "$(run_obj 111 .github/workflows/changeset-check.yml pull_request o/r "$PR_HEAD")" > "$FX/runs.json"
OUT="$(run_find "$FX")"
assert_run_id "no ci.yml run exists on the PR head" "" "$OUT" "$FX"

FX="$(happy_fixtures)"
runs_json "$(run_obj 222 .github/workflows/ci.yml push o/r "$PR_HEAD")" \
  "$(run_obj 223 .github/workflows/ci.yml workflow_dispatch o/r "$PR_HEAD")" > "$FX/runs.json"
jobs_json success > "$FX/jobs-223.json"
artifacts_json "$ARTIFACT" false > "$FX/artifacts-223.json"
OUT="$(run_find "$FX")"
assert_run_id "the only ci.yml runs are push / workflow_dispatch, not pull_request" "" "$OUT" "$FX"

FX="$(happy_fixtures)"
runs_json "$(run_obj 222 .github/workflows/ci.yml pull_request someone/fork "$PR_HEAD")" > "$FX/runs.json"
OUT="$(run_find "$FX")"
assert_run_id "the ci.yml run's head repository is a fork" "" "$OUT" "$FX"

FX="$(happy_fixtures)"
runs_json "$(run_obj 222 .github/workflows/ci.yml pull_request o/r bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)" > "$FX/runs.json"
OUT="$(run_find "$FX")"
assert_run_id "the ci.yml run is for a different head sha" "" "$OUT" "$FX"

for state in failure cancelled skipped timed_out null absent; do
  FX="$(happy_fixtures)"; jobs_json "$state" > "$FX/jobs-222.json"
  OUT="$(run_find "$FX")"
  assert_run_id "'${BUILD_JOB}' is '${state}'" "" "$OUT" "$FX"
done

FX="$(happy_fixtures)"; echo ERROR > "$FX/jobs-222.json"
OUT="$(run_find "$FX")"
assert_run_id "the jobs lookup fails" "" "$OUT" "$FX"

FX="$(happy_fixtures)"; artifacts_json "$ARTIFACT" true > "$FX/artifacts-222.json"
OUT="$(run_find "$FX")"
assert_run_id "the reuse artifact has expired" "" "$OUT" "$FX"

# The post-wasm-opt `wasm-binaries` artifact of the same run must never stand
# in: production ships the unoptimised bytes, so those would be a different
# binary from the one CD builds.
FX="$(happy_fixtures)"; artifacts_json wasm-binaries false > "$FX/artifacts-222.json"
OUT="$(run_find "$FX")"
assert_run_id "only the post-wasm-opt 'wasm-binaries' artifact exists" "" "$OUT" "$FX"

FX="$(happy_fixtures)"; echo ERROR > "$FX/artifacts-222.json"
OUT="$(run_find "$FX")"
assert_run_id "the artifacts lookup fails" "" "$OUT" "$FX"

echo ""
echo "--- usage errors are not verdicts ---"
FX="$(new_fixtures)"
REPO_U="$(make_repo "feat: x (#123)")"
OUT="$( ( cd "$REPO_U" && GH_CLI="$STUB_DIR/gh" GH_STUB_FIXTURES="$FX" GITHUB_REPOSITORY='' bash "$SCRIPT" find 2>&1 ) )" && RC=0 || RC=$?
if [ "$RC" -ne 0 ] && ! grep -q '^run-id=' <<<"$OUT"; then
  pass "a missing GITHUB_REPOSITORY exits non-zero (exit $RC) instead of answering"
else
  fail "a missing GITHUB_REPOSITORY produced exit $RC and output: $OUT"
fi
OUT="$(bash "$SCRIPT" bogus 2>&1)" && RC=0 || RC=$?
if [ "$RC" -ne 0 ]; then
  pass "an unknown subcommand exits non-zero (exit $RC)"
else
  fail "an unknown subcommand exited 0: $OUT"
fi

echo ""
echo "=== resolve-ci-wasm-artifact.sh adopt ==="

# A complete, valid four-variant artifact as the download step leaves it: the
# four package directories plus the key file, directly under one directory.
# The bytes are the smallest a real validator accepts: an empty WASM module and
# an ES module glue file.
make_artifact() { # $1 = key to record
  local dir v
  dir="$(mktemp -d "$WORK/artifact.XXXXXX")"
  for v in "${VARIANTS[@]}"; do
    mkdir -p "$dir/$v"
    printf '\000asm\001\000\000\000' > "$dir/$v/forge_engine_bg.wasm"
    printf 'export default function init() {}\n' > "$dir/$v/forge_engine.js"
  done
  printf '%s\n' "$1" > "$dir/$KEY_FILE"
  printf '%s' "$dir"
}

key_of() { ( cd "$1" && bash "$REPO_ROOT/scripts/engine-wasm-cache-key.sh" ci-reuse ); }

# run_adopt <repo> <artifact dir> — echoes combined output; GITHUB_OUTPUT is
# left at <repo>/.out.
run_adopt() {
  : > "$1/.out"
  ( cd "$1" && GITHUB_OUTPUT="$1/.out" bash "$SCRIPT" adopt "$2" 2>&1 )
}

assert_reused() { # $1 label, $2 want, $3 output, $4 repo
  if grep -qx "reused=$2" <<<"$3" && grep -qx "reused=$2" "$4/.out" && [ "$(grep -c '^reused=' "$4/.out")" -eq 1 ]; then
    pass "$1 -> reused=$2"
  else
    fail "$1 -> expected reused=$2; output: $(tr '\n' ' ' <<<"$3") | GITHUB_OUTPUT: $(tr '\n' ' ' < "$4/.out")"
  fi
}

assert_engine_untouched() { # $1 label, $2 repo
  local v leaked=''
  for v in "${VARIANTS[@]}"; do
    if [ -e "$2/engine/$v" ]; then leaked="$leaked $v"; fi
  done
  if [ -z "$leaked" ]; then
    pass "$1 -> nothing was moved into engine/ (the build starts clean)"
  else
    fail "$1 -> engine/ gained${leaked} although the artifact was refused"
  fi
}

# --- the positive case --------------------------------------------------------
REPO_A="$(make_repo "feat(engine): a change (#123)")"
KEY_A="$(key_of "$REPO_A")"
ART="$(make_artifact "$KEY_A")"
OUT="$(run_adopt "$REPO_A" "$ART")"
assert_reused "the artifact's key matches this tree exactly" true "$OUT" "$REPO_A"
all_there=1
for v in "${VARIANTS[@]}"; do
  if ! cmp -s "$REPO_A/engine/$v/forge_engine_bg.wasm" <(printf '\000asm\001\000\000\000') || [ ! -s "$REPO_A/engine/$v/forge_engine.js" ]; then
    all_there=0
  fi
done
if [ "$all_there" -eq 1 ]; then
  pass "all four variants now sit in engine/ with the artifact's exact bytes"
else
  fail "an adopted variant is missing from engine/ or its bytes changed"
fi
if grep -qF "$KEY_A" <<<"$OUT"; then
  pass "the adoption log names the key it matched"
else
  fail "the adoption log does not name the matched key: $OUT"
fi

echo ""
echo "--- every way the artifact can fail to prove itself must answer reused=false ---"

# The safety property. Another engine change landed on main after the PR's CI
# run, so the PR built different sources than the tree being deployed.
REPO_M="$(make_repo "feat(engine): a change (#123)")"
STALE_KEY="$(key_of "$REPO_M")"
printf 'fn landed_in_between() {}\n' >> "$REPO_M/engine/src/lib.rs"
( cd "$REPO_M" && git add -A && git commit -qm "another engine PR (#124)" )
ART="$(make_artifact "$STALE_KEY")"
OUT="$(run_adopt "$REPO_M" "$ART")"
assert_reused "the artifact was built from an engine tree main has since moved past" false "$OUT" "$REPO_M"
assert_engine_untouched "key mismatch" "$REPO_M"
if grep -qF '::notice::' <<<"$OUT" && grep -qF 'mismatch' <<<"$OUT" && grep -qF "$STALE_KEY" <<<"$OUT"; then
  pass "the mismatch is a ::notice:: naming both keys"
else
  fail "the mismatch was not reported as a ::notice:: naming the artifact key: $OUT"
fi

REPO_P="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_P")x")"
OUT="$(run_adopt "$REPO_P" "$ART")"
assert_reused "the artifact key is this tree's key with a suffix (not an exact match)" false "$OUT" "$REPO_P"
assert_engine_untouched "suffixed key" "$REPO_P"

REPO_K="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_K")")"
rm "$ART/$KEY_FILE"
OUT="$(run_adopt "$REPO_K" "$ART")"
assert_reused "the artifact carries no key file" false "$OUT" "$REPO_K"
assert_engine_untouched "no key file" "$REPO_K"

REPO_E="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_E")")"
: > "$ART/$KEY_FILE"
OUT="$(run_adopt "$REPO_E" "$ART")"
assert_reused "the artifact's key file is empty" false "$OUT" "$REPO_E"

REPO_D="$(make_repo "feat(engine): a change (#123)")"
OUT="$(run_adopt "$REPO_D" "$WORK/never-downloaded")"
assert_reused "the download directory does not exist" false "$OUT" "$REPO_D"

REPO_V="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_V")")"
rm -rf "$ART/pkg-webgpu-runtime"
OUT="$(run_adopt "$REPO_V" "$ART")"
assert_reused "one of the four variants is missing" false "$OUT" "$REPO_V"
assert_engine_untouched "missing variant" "$REPO_V"

REPO_C="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_C")")"
printf '\000asm\001\000' > "$ART/pkg-webgpu/forge_engine_bg.wasm"
OUT="$(run_adopt "$REPO_C" "$ART")"
assert_reused "a variant's WASM is truncated" false "$OUT" "$REPO_C"
assert_engine_untouched "truncated WASM" "$REPO_C"

REPO_X="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_X")")"
mkdir -p "$REPO_X/engine/pkg-webgl2"
printf 'already here\n' > "$REPO_X/engine/pkg-webgl2/sentinel"
OUT="$(run_adopt "$REPO_X" "$ART")"
assert_reused "engine/ already holds a variant directory" false "$OUT" "$REPO_X"
if [ -f "$REPO_X/engine/pkg-webgl2/sentinel" ] && [ ! -e "$REPO_X/engine/pkg-webgpu" ]; then
  pass "an existing engine/ package is left exactly as it was and nothing is mixed into it"
else
  fail "adopt mixed artifact bytes into an existing engine/ package set"
fi

# Unable to compute this tree's key is a broken input set, not an answer: the
# same failure breaks the all4 key step before it, and it must be seen.
REPO_B="$(make_repo "feat(engine): a change (#123)")"
ART="$(make_artifact "$(key_of "$REPO_B")")"
( cd "$REPO_B" && git rm -q .github/workflows/quality-gates.yml && git commit -qm "drop an input" )
OUT="$(run_adopt "$REPO_B" "$ART")" && RC=0 || RC=$?
if [ "$RC" -ne 0 ] && ! grep -qx 'reused=true' <<<"$OUT"; then
  pass "an uncomputable key fails the step (exit $RC) rather than adopting or quietly building"
else
  fail "an uncomputable key produced exit $RC and output: $OUT"
fi
assert_engine_untouched "uncomputable key" "$REPO_B"

OUT="$(cd "$REPO_A" && bash "$SCRIPT" adopt 2>&1)" && RC=0 || RC=$?
if [ "$RC" -ne 0 ]; then
  pass "adopt without a directory argument is a usage error (exit $RC)"
else
  fail "adopt without a directory argument exited 0: $OUT"
fi

echo ""
echo "=== quality-gates.yml publishes the artifact CD adopts ==="
# Extract one job block (its key line through the line before the next job).
job_block() { awk -v j="  $2:" '$0 == j {f=1; print; next} f && /^  [a-z][a-z0-9-]*:$/ {exit} f' "$1"; }
# Extract one step block from a job block, by a substring of its opening line.
step_block() { awk -v id="$2" '/^      - / { instep = (index($0, id) > 0) } instep { print }' <<<"$1"; }
# The 1-based line of a step's opening line inside a job block, or empty.
step_line() { awk -v id="$2" '/^      - / && index($0, id) > 0 { print NR; exit }' <<<"$1"; }
# A step as a recipe: its lines minus the `if:` guard (CD gates its builds,
# quality-gates does not), comments and blank lines. A step block runs up to
# the next step, so it also carries the explanatory comment above that next
# step, which differs between the two files and decides nothing.
recipe_step() { step_block "$1" "$2" | grep -vE '^        if:|^[[:space:]]*(#.*)?$'; }

QG_BW="$(job_block "$QG_YML" build-wasm)"
CD_BW="$(job_block "$CD_YML" build-wasm)"
if [ -z "$QG_BW" ] || [ -z "$CD_BW" ]; then
  fail "could not extract build-wasm from quality-gates.yml and cd.yml — every wiring check below would pass vacuously"
else
  pass "extracted build-wasm from both workflows"

  key_step="$(step_block "$QG_BW" 'Record the CD reuse key')"
  if grep -qE "^          bash scripts/engine-wasm-cache-key[.]sh ci-reuse > engine/${KEY_FILE//./[.]}$" <<<"$key_step"; then
    pass "quality-gates records the ci-reuse key into engine/${KEY_FILE}, the file adopt reads"
  else
    fail "quality-gates has no 'Record the CD reuse key' step writing 'engine-wasm-cache-key.sh ci-reuse > engine/${KEY_FILE}'"
  fi

  upload="$(step_block "$QG_BW" 'Upload pre-optimisation WASM for CD reuse')"
  if grep -qE "^          name: ${ARTIFACT}$" <<<"$upload" && grep -qE '^        uses: actions/upload-artifact@[0-9a-f]{40} ' <<<"$upload"; then
    pass "quality-gates uploads '${ARTIFACT}', the name the resolver and cd.yml look for"
  else
    fail "quality-gates does not upload an artifact named '${ARTIFACT}' with a pinned upload-artifact"
  fi
  for p in "${VARIANTS[@]/#/engine/}" "engine/${KEY_FILE}"; do
    if grep -qE "^            ${p}/?$" <<<"$upload"; then
      pass "the reuse upload includes ${p}"
    else
      fail "the reuse upload does not include ${p}"
    fi
  done
  # if-no-files-found only fails when NOTHING matches. Completeness of the four
  # packages is the verify step's job, asserted next, and adopt re-verifies.
  if grep -qE '^          if-no-files-found: error$' <<<"$upload"; then
    pass "an upload that matches no files fails instead of publishing an empty artifact"
  else
    fail "the reuse upload does not set if-no-files-found: error"
  fi

  verify_pre="$(step_block "$QG_BW" 'Verify the pre-optimisation WASM variants for CD reuse')"
  if grep -qE '^        run: node scripts/verify-engine-wasm[.]mjs engine$' <<<"$verify_pre"; then
    pass "quality-gates validates all four packages before publishing them for reuse"
  else
    fail "quality-gates does not run verify-engine-wasm.mjs before the reuse upload"
  fi

  # UNCONDITIONAL, on every event that runs build-wasm. The resolver reads only
  # pull_request runs, so a push or dispatch upload is never adopted. Gating
  # these steps on the event instead is refused by resolve-ci-diff-range.test.sh
  # for all of quality-gates.yml (#9161): a step that skips on the dispatch path
  # makes CI Success mean something different there than on a human PR. Any
  # `if:` is refused here, so an event gate, or an input standing in for one,
  # cannot come back on these three steps under another name.
  unguarded=0
  for s in 'Verify the pre-optimisation WASM variants for CD reuse' 'Record the CD reuse key' 'Upload pre-optimisation WASM for CD reuse'; do
    blk="$(step_block "$QG_BW" "$s")"
    if [ -z "$blk" ]; then
      fail "'$s' not found in quality-gates.yml build-wasm, so its guard cannot be checked"
    elif grep -qE '^        if:' <<<"$blk"; then
      fail "'$s' carries an if: ($(grep -E '^        if:' <<<"$blk" | sed 's/^ *//')); it must run on every event that runs build-wasm (#9161)"
    else
      pass "'$s' has no if:, so it runs on every event that runs build-wasm"
      unguarded=$((unguarded + 1))
    fi
  done
  if [ "$unguarded" -eq 3 ]; then
    pass "all three reuse steps checked for an if: (a scan of zero steps cannot pass)"
  else
    fail "only $unguarded of 3 reuse steps were found without an if:"
  fi

  # BINARY FIDELITY. Production ships what cd.yml builds, and cd.yml runs no
  # wasm-opt, so the artifact must be captured BEFORE quality-gates optimises
  # the packages in place. After the last bindgen step, so all four exist.
  last_build="$(step_line "$QG_BW" 'Run wasm-bindgen (WebGPU Runtime)')"
  ln_verify="$(step_line "$QG_BW" 'Verify the pre-optimisation WASM variants for CD reuse')"
  ln_key="$(step_line "$QG_BW" 'Record the CD reuse key')"
  ln_upload="$(step_line "$QG_BW" 'Upload pre-optimisation WASM for CD reuse')"
  ln_opt="$(step_line "$QG_BW" 'Run wasm-opt')"
  if [ -z "$last_build" ] || [ -z "$ln_verify" ] || [ -z "$ln_key" ] || [ -z "$ln_upload" ] || [ -z "$ln_opt" ]; then
    fail "could not locate every step needed for the ordering check (build=$last_build verify=$ln_verify key=$ln_key upload=$ln_upload wasm-opt=$ln_opt)"
  elif [ "$last_build" -lt "$ln_verify" ] && [ "$ln_verify" -lt "$ln_key" ] && [ "$ln_key" -lt "$ln_upload" ] && [ "$ln_upload" -lt "$ln_opt" ]; then
    pass "last bindgen < verify < record key < upload < wasm-opt (the adopted bytes are the unoptimised ones production ships)"
  else
    fail "reuse steps are out of order (build=$last_build verify=$ln_verify key=$ln_key upload=$ln_upload wasm-opt=$ln_opt) — the artifact could hold optimised bytes CD would never have built"
  fi
fi

echo ""
echo "=== the two recipes build the same bytes ==="
# The key proves the INPUTS match. It cannot prove that quality-gates.yml and
# cd.yml turn those inputs into the same binary: both workflow blobs are in the
# key, so a PR that changed cd.yml's cargo features but not quality-gates.yml's
# would still match itself after the merge and ship the old features. What
# closes that gap is keeping the two build recipes identical, pinned here.
if [ -n "${QG_BW:-}" ] && [ -n "${CD_BW:-}" ]; then
  compared=0
  for s in 'Build WebGL2 + wasm-bindgen' 'Build WebGPU + wasm-bindgen' \
           'Build WebGL2 Runtime (stripped editor)' 'Run wasm-bindgen (WebGL2 Runtime)' \
           'Build WebGPU Runtime (stripped editor)' 'Run wasm-bindgen (WebGPU Runtime)'; do
    qg_step="$(recipe_step "$QG_BW" "$s")"
    cd_step="$(recipe_step "$CD_BW" "$s")"
    if [ -z "$qg_step" ] || [ -z "$cd_step" ]; then
      fail "step '$s' is missing from one recipe (quality-gates: ${#qg_step} bytes, cd: ${#cd_step} bytes)"
    elif [ "$qg_step" = "$cd_step" ]; then
      pass "'$s' is byte-identical in both recipes (ignoring its if:)"
      compared=$((compared + 1))
    else
      fail "'$s' differs between quality-gates.yml and cd.yml — CD would adopt bytes its own recipe does not produce: $(diff <(printf '%s\n' "$qg_step") <(printf '%s\n' "$cd_step") | tr '\n' ' ')"
    fi
  done
  if [ "$compared" -eq 6 ]; then
    pass "all six build/bindgen steps compared (a vacuous comparison cannot pass)"
  else
    fail "only $compared of 6 build/bindgen steps compared equal"
  fi

  qg_tc="$(recipe_step "$QG_BW" 'dtolnay/rust-toolchain')"
  cd_tc="$(recipe_step "$CD_BW" 'dtolnay/rust-toolchain')"
  if [ -n "$qg_tc" ] && [ "$qg_tc" = "$cd_tc" ]; then
    pass "both recipes install the same Rust toolchain (action pin, channel and target)"
  else
    fail "the toolchain steps differ: quality-gates='$(tr '\n' ' ' <<<"$qg_tc")' cd='$(tr '\n' ' ' <<<"$cd_tc")'"
  fi

  qg_flags="$(grep -E '^  RUSTFLAGS:' "$QG_YML")"
  cd_flags="$(grep -E '^  RUSTFLAGS:' "$CD_YML")"
  if [ -n "$qg_flags" ] && [ "$qg_flags" = "$cd_flags" ]; then
    pass "both workflows set the same workflow-level RUSTFLAGS ($qg_flags)"
  else
    fail "workflow-level RUSTFLAGS differ: quality-gates='$qg_flags' cd='$cd_flags'"
  fi

  for spec in "quality-gates.yml:$QG_BW" "cd.yml:$CD_BW"; do
    if grep -qE '^    env:' <<<"${spec#*:}"; then
      fail "${spec%%:*} build-wasm has a job-level env: — it applies to one recipe only and can change the bytes without touching the pinned steps"
    else
      pass "${spec%%:*} build-wasm has no job-level env: to diverge the recipes"
    fi
  done

  # The artifact is captured before wasm-opt BECAUSE cd.yml runs none. If CD
  # ever starts optimising, the capture point above has to move with it.
  if grep -vE '^[[:space:]]*#' <<<"$CD_BW" | grep -q 'wasm-opt'; then
    fail "cd.yml build-wasm now runs wasm-opt — the pre-optimisation reuse artifact no longer matches what CD would build"
  else
    pass "cd.yml build-wasm runs no wasm-opt, so the pre-optimisation bytes are what production would ship"
  fi
fi

echo ""
echo "=== cd.yml adopts the artifact only after proving it ==="
if [ -n "${CD_BW:-}" ]; then
  miss="steps.engine-cache-all4.outputs.cache-hit != 'true'"

  # The job token's scopes, read from the job's own permissions: block with
  # comments and blank lines stripped, so a commented-out scope counts as gone.
  # Every scope the reuse path needs is tied to the call that needs it, and a
  # missing one fails SAFE (no_reuse, then a full build), which is exactly why
  # nothing else would ever notice it: CD stays green and rebuilds forever.
  cd_perms="$(awk '/^    permissions:$/ {f=1; next} f && /^    [^ ]/ {exit} f' <<<"$CD_BW" \
    | grep -vE '^[[:space:]]*(#.*)?$' || true)"
  resolver_code="$(grep -vE '^[[:space:]]*#' "$SCRIPT")"
  if [ -z "$cd_perms" ]; then
    fail "could not extract build-wasm's permissions: block from cd.yml — every scope check below would pass vacuously"
  else
    # shellcheck disable=SC2016  # the literal ${repo} IS the text the resolver carries
    if grep -qF '"$gh" api "repos/${repo}/pulls/${pr_number}"' <<<"$resolver_code"; then
      if grep -qx '      pull-requests: read' <<<"$cd_perms"; then
        pass "build-wasm's token can read the merged PR the resolver looks up (pull-requests: read)"
      else
        fail "build-wasm lacks 'pull-requests: read' — the resolver's GET repos/{repo}/pulls/{n} would 403, answer no_reuse, and CD would rebuild on every run with nothing going red"
      fi
    else
      fail "the resolver no longer calls repos/\${repo}/pulls/\${pr_number} — re-derive the scopes build-wasm needs before trusting this pin"
    fi

    # shellcheck disable=SC2016  # the literal ${repo} IS the text the resolver carries
    if grep -qF '"$gh" api "repos/${repo}/actions/runs/${run_id}/artifacts?' <<<"$resolver_code"; then
      if grep -qx '      actions: read' <<<"$cd_perms"; then
        pass "build-wasm's token can list and download another run's artifacts (actions: read)"
      else
        fail "build-wasm lacks 'actions: read' — the resolver's run/artifact lookups and the cross-run download would fail on every run"
      fi
    else
      fail "the resolver no longer lists repos/\${repo}/actions/runs/\${run_id}/artifacts — re-derive the scopes build-wasm needs before trusting this pin"
    fi

    # The whole set, exactly: a dropped scope and an escalated one (a write, or
    # a new scope nobody justified) are both a change someone must look at.
    expected_perms="$(printf '      %s\n' 'actions: read' 'contents: read' 'pull-requests: read')"
    if [ "$(LC_ALL=C sort <<<"$cd_perms")" = "$expected_perms" ]; then
      pass "build-wasm's token scopes are exactly actions/contents/pull-requests: read"
    else
      fail "build-wasm's token scopes changed: expected [$(tr '\n' ' ' <<<"$expected_perms")] got [$(LC_ALL=C sort <<<"$cd_perms" | tr '\n' ' ')]"
    fi
  fi

  find_step="$(step_block "$CD_BW" 'Find the PR CI run that built this engine tree')"
  # shellcheck disable=SC2016  # the literal ${{ github.token }} IS the text cd.yml must carry
  if grep -qxF '        run: bash scripts/resolve-ci-wasm-artifact.sh find' <<<"$find_step" \
     && grep -qxF '        id: ci-artifact' <<<"$find_step" \
     && grep -qxF "        if: ${miss}" <<<"$find_step" \
     && grep -qxF '          GH_TOKEN: ${{ github.token }}' <<<"$find_step"; then
    pass "the find step runs the resolver on an all4 miss, with a token, as id ci-artifact"
  else
    fail "the find step is missing or mis-wired: $(tr '\n' ' ' <<<"$find_step")"
  fi

  both="        if: ${miss} && steps.ci-artifact.outputs.run-id != ''"
  dl_step="$(step_block "$CD_BW" "Download the PR's pre-optimisation WASM")"
  dl_ok=1
  # shellcheck disable=SC2016  # the literal ${{ ... }} expressions ARE the text cd.yml must carry
  for line in \
    "$both" \
    "          name: ${ARTIFACT}" \
    '          path: ${{ runner.temp }}/ci-wasm' \
    '          run-id: ${{ steps.ci-artifact.outputs.run-id }}' \
    '          github-token: ${{ github.token }}'; do
    if ! grep -qxF "$line" <<<"$dl_step"; then
      dl_ok=0
      fail "the download step lacks '${line#"${line%%[![:space:]]*}"}'"
    fi
  done
  if ! grep -qE '^        uses: actions/download-artifact@[0-9a-f]{40} ' <<<"$dl_step"; then
    dl_ok=0
    fail "the download step does not use a pinned actions/download-artifact"
  fi
  if grep -qE '^[[:space:]]*continue-on-error:' <<<"$dl_step"; then
    dl_ok=0
    fail "the download step carries continue-on-error — the exact mask #9525 removed"
  fi
  if [ "$dl_ok" -eq 1 ]; then
    pass "the download step fetches ${ARTIFACT} from the resolved run with run-id + github-token, unmasked"
  fi

  adopt_step="$(step_block "$CD_BW" "Adopt the PR's WASM only on an exact key match")"
  # shellcheck disable=SC2016  # the literal $RUNNER_TEMP IS the text cd.yml must carry
  if grep -qxF '        run: bash scripts/resolve-ci-wasm-artifact.sh adopt "$RUNNER_TEMP/ci-wasm"' <<<"$adopt_step" \
     && grep -qxF '        id: ci-reuse' <<<"$adopt_step" \
     && grep -qxF "$both" <<<"$adopt_step"; then
    pass "the adopt step verifies the download directory as id ci-reuse, under the same condition"
  else
    fail "the adopt step is missing or mis-wired: $(tr '\n' ' ' <<<"$adopt_step")"
  fi

  ln_restore="$(step_line "$CD_BW" 'Restore all 4 WASM variants')"
  ln_find="$(step_line "$CD_BW" 'Find the PR CI run that built this engine tree')"
  ln_dl="$(step_line "$CD_BW" "Download the PR's pre-optimisation WASM")"
  ln_adopt="$(step_line "$CD_BW" "Adopt the PR's WASM only on an exact key match")"
  ln_first_build="$(step_line "$CD_BW" 'dtolnay/rust-toolchain')"
  ln_verify="$(step_line "$CD_BW" 'Verify all 4 WASM variants')"
  if [ -n "$ln_restore" ] && [ -n "$ln_find" ] && [ -n "$ln_dl" ] && [ -n "$ln_adopt" ] && [ -n "$ln_first_build" ] && [ -n "$ln_verify" ] \
     && [ "$ln_restore" -lt "$ln_find" ] && [ "$ln_find" -lt "$ln_dl" ] && [ "$ln_dl" -lt "$ln_adopt" ] \
     && [ "$ln_adopt" -lt "$ln_first_build" ] && [ "$ln_first_build" -lt "$ln_verify" ]; then
    pass "restore < find < download < adopt < toolchain/build < verify"
  else
    fail "cd.yml reuse steps are out of order (restore=$ln_restore find=$ln_find download=$ln_dl adopt=$ln_adopt build=$ln_first_build verify=$ln_verify)"
  fi

  # The names the three parties agree on. A rename on one side alone is a
  # reuse that never happens, with nothing going red.
  if grep -qE "^ARTIFACT_NAME='${ARTIFACT}'$" "$SCRIPT" && grep -qE "^KEY_FILE_NAME='${KEY_FILE//./[.]}'$" "$SCRIPT" && grep -qE "^BUILD_JOB='${BUILD_JOB}'$" "$SCRIPT"; then
    pass "the resolver searches for '${ARTIFACT}' from '${BUILD_JOB}' and reads ${KEY_FILE}"
  else
    fail "the resolver's ARTIFACT_NAME / KEY_FILE_NAME / BUILD_JOB constants differ from what the workflows use"
  fi
  qg_job_name="$(awk '/^  build-wasm:/{f=1} f && /^    name:/{sub(/^    name: /, ""); print; exit}' "$QG_YML")"
  ci_caller_name="$(awk '/^  quality-gates:/{f=1} f && /^    name:/{sub(/^    name: /, ""); print; exit}' "$REPO_ROOT/.github/workflows/ci.yml")"
  if [ "${ci_caller_name} / ${qg_job_name}" = "$BUILD_JOB" ]; then
    pass "'${BUILD_JOB}' is the name GitHub gives quality-gates' build-wasm when ci.yml calls it"
  else
    fail "ci.yml caller '${ci_caller_name}' + quality-gates job '${qg_job_name}' no longer produce '${BUILD_JOB}'"
  fi
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
