#!/usr/bin/env bash
# check-suite-wiring.sh — fail when a bash test suite exists on disk but is
# named in no GitHub Actions workflow, i.e. a silently dead test.
#
# Why this gate exists (PF-9451 / #9451). The self-defense runner
# (.github/workflows/ci.yml, job `lockfile-sync-tests`) invokes its suites by
# NAME, one explicit step each, rather than looping a glob. That is deliberate —
# per-suite step names are what make a red suite identifiable in the Actions UI
# and what let check-npm-audit.test.sh pin each step's `run:` line-for-line
# against a `run: true` swap. The cost of naming is that adding a suite file is
# not the same as running it: three suites (generate-wasm-manifests,
# changeset-version, pr-workitem-check) sat unrun in the repo, two of them
# guarding release/deploy-critical scripts, while the board stayed green.
#
# This gate closes that gap without giving up the named steps: it asserts that
# every `*.test.sh` under the scanned directories is REFERENCED somewhere under
# .github/workflows/. Reference — not execution — is what a static check can
# honestly claim; the referencing step's own `run:` line is pinned separately by
# check-npm-audit.test.sh, so the two together cover name-present-but-neutered.
#
# Scanned directories (space-separated, override with SUITE_WIRING_TEST_DIRS):
#   scripts/__tests__        — the CI gate suites
#   .claude/tools/__tests__  — the cross-provider DX-audit contract test
# .claude/hooks/__tests__ is deliberately NOT scanned: the `hook-tests` job
# already runs it via a nullglob loop, so its members are wired WITHOUT their
# basenames appearing in any workflow and this gate would flag every one.
#
# Seams (test-only, both relative-or-absolute paths):
#   SUITE_WIRING_TEST_DIRS  — space-separated dirs to scan for *.test.sh
#   SUITE_WIRING_WORKFLOW_DIR — dir to scan for workflow files
# The suite asserts no workflow wires either seam, so the gate cannot be
# no-op'd from CI config.
#
# Exit codes: 0 = every suite is referenced; 1 = at least one orphan, or the
# scan itself could not be performed (fail closed — an empty scan must never
# pass vacuously).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

TEST_DIRS="${SUITE_WIRING_TEST_DIRS:-scripts/__tests__ .claude/tools/__tests__}"
WORKFLOW_DIR="${SUITE_WIRING_WORKFLOW_DIR:-.github/workflows}"

# Resolve a possibly-relative path against the repo root.
resolve() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$REPO_ROOT/$1" ;;
  esac
}

wf_dir="$(resolve "$WORKFLOW_DIR")"
if [ ! -d "$wf_dir" ]; then
  echo "::error::check-suite-wiring: workflow directory not found: $wf_dir"
  exit 1
fi

shopt -s nullglob
workflows=("$wf_dir"/*.yml "$wf_dir"/*.yaml)
if [ ${#workflows[@]} -eq 0 ]; then
  echo "::error::check-suite-wiring: no workflow files under $wf_dir — cannot verify suite wiring (fail closed)"
  exit 1
fi

# Concatenate every workflow once; the reference check is a fixed-string search
# over that blob. Reading each file once keeps the gate O(suites + workflows)
# instead of O(suites x workflows).
#
# COMMENTS ARE STRIPPED FIRST (#9576). The search is a plain fixed-string match,
# so before this ANY mention of a filename satisfied it -- including one inside a
# YAML comment. A suite added with no `run:` step anywhere, but named in a
# comment explaining what it guards, was reported as wired:
#
#   check-suite-wiring: all 29 test suite(s) are referenced by a workflow
#
# A suite that never executes passed the gate whose entire purpose is finding
# suites that never execute. This gate's own error text says such a suite means
# "a regression in what they guard ships on a green board", so it has to read
# what a workflow RUNS, not what it merely mentions.
#
# The strip is deliberately naive (everything from `#` to end of line). A `#`
# inside a quoted string on an executable line truncates that line early, which
# can only ever HIDE a reference and report an EXTRA orphan. That direction is
# safe: this gate already fails closed, and a false orphan is loud and trivially
# fixed, whereas a false pass is precisely the defect being closed here.
wf_blob="$(cat "${workflows[@]}" | awk '{ sub(/[[:space:]]*#.*/, ""); print }')"

suite_count=0
orphans=()
for dir in $TEST_DIRS; do
  scan_dir="$(resolve "$dir")"
  if [ ! -d "$scan_dir" ]; then
    echo "::error::check-suite-wiring: scanned test directory not found: $scan_dir"
    exit 1
  fi
  suites=("$scan_dir"/*.test.sh)
  if [ ${#suites[@]} -eq 0 ]; then
    echo "::error::check-suite-wiring: no *.test.sh files under $scan_dir — the glob matched nothing, so every wiring assertion would pass vacuously (fail closed)"
    exit 1
  fi
  for suite in "${suites[@]}"; do
    suite_count=$((suite_count + 1))
    base="$(basename "$suite")"
    if ! grep -qF -- "$base" <<<"$wf_blob"; then
      # Report the path as it appears in the repo, not the absolute temp path.
      orphans+=("${dir%/}/$base")
    fi
  done
done
shopt -u nullglob

if [ ${#orphans[@]} -ne 0 ]; then
  echo "::error::check-suite-wiring: ${#orphans[@]} test suite(s) exist on disk but are named in no workflow under ${WORKFLOW_DIR} — they never run, so a regression in what they guard ships on a green board:"
  for orphan in "${orphans[@]}"; do
    echo "  - $orphan"
  done
  echo ""
  echo "Fix: add a named step that runs the suite (self-defense suites go in the"
  echo "lockfile-sync-tests job of .github/workflows/ci.yml, alongside a shellcheck"
  echo "entry for the suite and its subject script), then update the line-for-line"
  echo "pin of that job in scripts/__tests__/check-npm-audit.test.sh in the SAME commit."
  exit 1
fi

echo "check-suite-wiring: all $suite_count test suite(s) are referenced by a workflow under ${WORKFLOW_DIR}"
exit 0
