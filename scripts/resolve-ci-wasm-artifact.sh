#!/usr/bin/env bash
# Find, prove and adopt the four WASM variants a pull request's own CI run
# already built, so CD's first build after an engine merge does not compile the
# same engine again (#9525).
#
#   resolve-ci-wasm-artifact.sh find
#       Resolve HEAD's squash subject "(#N)" to that PR's head commit, and find
#       the ci.yml pull_request run on it whose 'Quality Gates / WASM Build' job
#       succeeded and whose wasm-binaries-cd-reuse artifact has not expired.
#       Prints and writes `run-id=<id>`, or `run-id=` when there is none.
#
#   resolve-ci-wasm-artifact.sh adopt <download-dir>
#       Compare the key recorded in the downloaded artifact with this tree's own
#       `scripts/engine-wasm-cache-key.sh ci-reuse` key. Only on an EXACT match,
#       and only when all four packages validate, move them into engine/.
#       Prints and writes `reused=true` or `reused=false`.
#
# WHY NOT "THE CI RUN FOR THIS SHA"
#
# The repo is squash-only, so the commit CD deploys is new: no CI run has ever
# seen its SHA. The PR's run built refs/pull/N/merge, which is the same engine
# only if nothing that feeds the build landed on main between that run and the
# merge. So the artifact is found by PR and ACCEPTED by content: quality-gates
# records the ci-reuse key of the tree it built, and adopt recomputes it here.
# A different key is a different binary, whatever the PR number says.
#
# WHY THE UNOPTIMISED BYTES
#
# quality-gates.yml runs wasm-opt -Oz on its packages; cd.yml does not, and
# production ships what cd.yml builds. The artifact is therefore captured before
# wasm-opt (a separate artifact from the optimised `wasm-binaries`), and this
# script never looks at `wasm-binaries`.
#
# FAIL CLOSED, VISIBLY
#
# Every path that is not positive proof answers "no reuse" with a ::notice::
# naming the reason, and CD builds. A lookup error, a fork, a run whose build
# did not succeed, an expired artifact, a key that differs by one character, a
# package that fails validation: none of them is a reason to guess. The cost of
# a false negative is one ~6-minute build; the cost of a false positive is a CDN
# engine built from different sources than the deploy. They are not symmetric.
#
# It exits non-zero only when it cannot give an answer at all: a usage error,
# this tree's key being uncomputable (a build input moved; the all4 key step
# fails on the same input, and it has to be fixed rather than bypassed), or a
# move into engine/ failing after the artifact was verified.
#
# TEST SEAM: $GH_CLI overrides the `gh` binary so the suite drives every branch
# against a stub (scripts/__tests__/resolve-ci-wasm-artifact.test.sh).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The names all three parties must agree on. quality-gates.yml uploads the
# artifact and key file under these names, cd.yml downloads by the artifact
# name, and ci.yml calling quality-gates.yml as "Quality Gates" is what makes
# its build-wasm job report as BUILD_JOB. The suite pins each pairing.
ARTIFACT_NAME='wasm-binaries-cd-reuse'
KEY_FILE_NAME='wasm-ci-reuse-key.txt'
BUILD_JOB='Quality Gates / WASM Build'
CI_WORKFLOW_PATH='.github/workflows/ci.yml'
VARIANTS=(pkg-webgl2 pkg-webgpu pkg-webgl2-runtime pkg-webgpu-runtime)

# Print a key=value answer and, inside Actions, record it as a step output.
emit() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

usage() {
  echo "::error::usage: resolve-ci-wasm-artifact.sh find | adopt <download-dir>" >&2
  exit 64
}

cmd_find() {
  local repo gh subject pr_number pr_info pr_head pr_head_repo run_ids run_id conclusions artifact_ids

  repo="${GITHUB_REPOSITORY:-}"
  if [ -z "$repo" ]; then
    echo "::error::resolve-ci-wasm-artifact: GITHUB_REPOSITORY is not set" >&2
    exit 64
  fi
  gh="${GH_CLI:-gh}"

  no_reuse() {
    echo "::notice::CD engine WASM: no reusable PR CI artifact -- $1. Building all four variants instead."
    emit "run-id="
    exit 0
  }

  # --- 1. Which PR produced this commit? -------------------------------------
  # GitHub's squash merge writes the subject as "<title> (#N)". A direct push
  # has no such reference, which is exactly the case that must build.
  subject="$(git log -1 --format=%s 2>/dev/null || true)"
  pr_number="$(sed -n 's/.*(#\([0-9][0-9]*\))[[:space:]]*$/\1/p' <<<"$subject")"
  if [ -z "$pr_number" ]; then
    no_reuse "HEAD's subject carries no '(#N)' pull-request reference (a direct push)"
  fi

  # --- 2. Its head commit, from this repository -------------------------------
  # A fork's pull_request run executes code nobody with write access has
  # approved, and CD would publish its bytes with production credentials. The
  # key check cannot tell that apart, so forks are refused before it.
  if ! pr_info="$("$gh" api "repos/${repo}/pulls/${pr_number}" --jq '[.head.sha, (.head.repo.full_name // "")] | @tsv' 2>/dev/null)"; then
    no_reuse "could not read pull request #${pr_number}"
  fi
  pr_head="${pr_info%%$'\t'*}"
  pr_head_repo="${pr_info#*$'\t'}"
  if [[ ! "$pr_head" =~ ^[0-9a-f]{40}$ ]]; then
    no_reuse "pull request #${pr_number} gave head sha '${pr_head}'"
  fi
  if [ "$pr_head_repo" != "$repo" ]; then
    no_reuse "pull request #${pr_number} comes from the fork '${pr_head_repo:-deleted}', whose CI run is built by code outside this repository's write access"
  fi

  # --- 3. The ci.yml pull_request runs on that head ---------------------------
  # Filtered in the query AND in jq: the query keeps the page small, and the jq
  # conditions are what the answer actually rests on.
  if ! run_ids="$("$gh" api --paginate "repos/${repo}/actions/runs?head_sha=${pr_head}&event=pull_request&per_page=100" \
        --jq ".workflow_runs[] | select(.path == \"${CI_WORKFLOW_PATH}\" and .event == \"pull_request\" and .head_sha == \"${pr_head}\" and .head_repository.full_name == \"${repo}\") | .id" 2>/dev/null)"; then
    no_reuse "could not list workflow runs for #${pr_number} head ${pr_head}"
  fi
  if [ -z "$run_ids" ]; then
    no_reuse "no ${CI_WORKFLOW_PATH} pull_request run exists for #${pr_number} head ${pr_head}"
  fi

  # --- 4. One whose WASM Build succeeded and whose artifact is still live -----
  # Newest first, as the API lists them. Every run here is on the same head, so
  # any qualifying one is as good as another: adopt decides on content anyway.
  for run_id in $run_ids; do
    if [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
      no_reuse "the workflow-runs lookup returned a malformed run id '${run_id}'"
    fi
    # --paginate with per_page=100 and filter=latest: a CI run here carries 40+
    # jobs (30 per page by default), and a re-run's earlier attempt must not
    # vouch for the current one.
    if ! conclusions="$("$gh" api --paginate "repos/${repo}/actions/runs/${run_id}/jobs?filter=latest&per_page=100" \
          --jq ".jobs[] | select(.name == \"${BUILD_JOB}\") | .conclusion" 2>/dev/null)"; then
      no_reuse "could not read the jobs of CI run ${run_id}"
    fi
    if ! grep -qx 'success' <<<"$conclusions"; then
      echo "CI run ${run_id}: '${BUILD_JOB}' is not success (saw: $(tr '\n' ' ' <<<"${conclusions:-absent}")); trying the next run"
      continue
    fi
    # By name, so the optimised `wasm-binaries` of the same run can never stand in.
    if ! artifact_ids="$("$gh" api "repos/${repo}/actions/runs/${run_id}/artifacts?name=${ARTIFACT_NAME}&per_page=100" \
          --jq ".artifacts[] | select(.name == \"${ARTIFACT_NAME}\" and .expired == false) | .id" 2>/dev/null)"; then
      no_reuse "could not list the artifacts of CI run ${run_id}"
    fi
    if [ -z "$artifact_ids" ]; then
      echo "CI run ${run_id}: no unexpired ${ARTIFACT_NAME} artifact; trying the next run"
      continue
    fi
    echo "Found: CI run ${run_id} built #${pr_number} (head ${pr_head}) with a successful '${BUILD_JOB}' and an unexpired ${ARTIFACT_NAME}. It is adopted only if its key matches this tree exactly."
    emit "run-id=${run_id}"
    exit 0
  done

  no_reuse "no ${CI_WORKFLOW_PATH} run on #${pr_number} head ${pr_head} has a successful '${BUILD_JOB}' with an unexpired ${ARTIFACT_NAME} artifact"
}

cmd_adopt() {
  local dir="${1:-}" expected_key artifact_key verify_out v
  if [ -z "$dir" ]; then
    usage
  fi

  not_adopted() {
    echo "::notice::CD engine WASM: the PR CI artifact was not adopted -- $1. Building all four variants instead."
    emit "reused=false"
    exit 0
  }

  # This tree's key first. Not being able to compute it is not an answer.
  if ! expected_key="$(bash "$HERE/engine-wasm-cache-key.sh" ci-reuse)"; then
    echo "::error::resolve-ci-wasm-artifact: cannot compute this tree's ci-reuse key. A build input moved; fix scripts/engine-wasm-cache-key.sh rather than bypassing the reuse check." >&2
    exit 1
  fi

  if [ ! -d "$dir" ]; then
    not_adopted "the download directory '${dir}' does not exist"
  fi
  if [ ! -f "$dir/$KEY_FILE_NAME" ]; then
    not_adopted "the artifact carries no ${KEY_FILE_NAME}"
  fi
  # $(...) drops only trailing newlines. Anything else that differs, a CR
  # included, is a mismatch: this comparison is the whole safety argument.
  artifact_key="$(cat "$dir/$KEY_FILE_NAME")"
  if [ -z "$artifact_key" ]; then
    not_adopted "the artifact's ${KEY_FILE_NAME} is empty"
  fi
  if [ "$artifact_key" != "$expected_key" ]; then
    not_adopted "key mismatch: the PR's CI run built '${artifact_key}' but this tree is '${expected_key}', so a build input changed between that run and the merge"
  fi

  for v in "${VARIANTS[@]}"; do
    if [ ! -d "$dir/$v" ]; then
      not_adopted "the artifact has no ${v} package"
    fi
    if [ -e "engine/$v" ]; then
      not_adopted "engine/${v} already exists, and the artifact is never mixed into another package set"
    fi
  done

  # Validate in the download directory, BEFORE anything reaches engine/, so a
  # corrupt artifact falls back to a clean build instead of failing the deploy.
  if ! verify_out="$(node "$HERE/verify-engine-wasm.mjs" "$dir" 2>&1)"; then
    verify_out="${verify_out//::error::/}"
    not_adopted "the artifact failed validation ($(tr '\n' ' ' <<<"$verify_out"))"
  fi

  for v in "${VARIANTS[@]}"; do
    if ! mv "$dir/$v" "engine/$v"; then
      echo "::error::resolve-ci-wasm-artifact: moving the verified ${v} into engine/ failed" >&2
      exit 1
    fi
  done
  echo "Adopted: all four variants from the PR's CI run, whose ${KEY_FILE_NAME} matched this tree exactly (${expected_key})."
  emit "reused=true"
}

case "${1:-}" in
  find) shift; cmd_find "$@" ;;
  adopt) shift; cmd_adopt "$@" ;;
  *) usage ;;
esac
