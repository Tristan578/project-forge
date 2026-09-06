#!/usr/bin/env bash
# Fail when a tracked file hardcodes a machine-local absolute path.
#
# WHY. An absolute path in a version-controlled file resolves to nothing on
# every other machine, and it fails SILENTLY. lessons-learned #9605 is exactly
# this: the lessons hook read a path containing one contributor's username, so
# on every other checkout it took its `exit 0` branch and enforcement was off
# for entire sessions with nothing saying so. This repo is open source; assuming
# one machine's layout is assuming one contributor.
#
# Found by review on 2026-09-06: `.codex/config.toml` registered an MCP server
# pinned to one contributor's Windows checkout, and two skills told the reader to
# `cd` into one contributor's home directory before running a sync script. None
# of it would work for anyone else, and none of it announced that.
#
# The forbidden shapes are spelled out ONCE, in PATTERN below, and nowhere else
# in the tree: a file that quotes an example is a file this gate then fails on.
# That is why the workflow step carries a pointer here rather than a copy.
#
# bash 3.2 compatible on purpose — macOS ships 3.2 as /bin/bash and the rest of
# the CI self-defense scripts hold that floor (check-skills.sh,
# check-changeset-packages.sh, .claude/rules/gotchas-build-ci.md).
#
# ONE grep pass over the whole tracked set, not a per-file loop: the loop form
# took minutes on this repo's ~3,500 files, and a gate slow enough to be
# annoying is a gate someone eventually stops running.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

# Absolute forms that name one machine: a Windows drive-letter path into a user
# or repo directory, or a POSIX home directory. Deliberately NOT anchored to a
# username, so a different contributor's path is caught too.
PATTERN='([A-Za-z]:[\\/](Users|repos)[\\/]|/Users/[A-Za-z0-9._-]+/|/home/[A-Za-z0-9._-]+/)'

# Files where such a string is legitimate. Each entry states why.
#   docs/audits, docs/reviews, docs/coverage — dated records of what a tool
#     printed at the time; rewriting them would falsify the record.
#   provision-billing-meter, mockOnceGuard, generate-wasm-manifests,
#     reaperBridge — code and tests ABOUT path handling, where the literal is
#     the subject under test (reaperBridge asserts a traversal attempt is
#     refused) rather than a path anyone is meant to follow.
#   check-vitest-exit / db-migration-guard tests, sentry-to-test-stub — they
#     quote real CI output verbatim as a fixture.
#   this script and its test — they carry the pattern by definition.
#
# Matched against the FILE PATH ALONE, never the `path:line:content` string that
# grep emits. Against the whole string every `$`-anchored entry here is
# unreachable — `...\.sh$` cannot match when `:12:# ...` follows the name — so
# this gate used to fail on its own header comment, while every UNanchored entry
# leaked the other way and exempted any line whose CONTENT merely said
# `mockOnceGuard`. Both directions are pinned by the suite.
ALLOW_RE='^docs/(audits|reviews|coverage)/|^scripts/check-portable-paths\.sh$|^scripts/__tests__/check-portable-paths\.test\.sh$|^\.gitignore$|provision-billing-meter|mockOnceGuard|generate-wasm-manifests|reaperBridge|check-vitest-exit|db-migration-guard|sentry-to-test-stub'

tracked_count="$(git ls-files | wc -l | tr -d ' ')"

# `/home/runner/` is the GitHub Actions HOME — identical on every runner, so it
# is portable by construction. Workflows set cache dirs under it and several
# suites quote CI output containing it. Filtered by LINE rather than removed
# from PATTERN, so a genuine `/home/<someone>/` in the same file still fails.
raw="$(git ls-files -z \
  | xargs -0 grep -InE "$PATTERN" 2>/dev/null \
  | grep -v '/home/runner/' || true)"

# The allowlist is applied per hit, to the path grep prefixed onto the line, so
# an entry can be anchored to a whole path without also having to survive the
# `:<lineno>:<content>` grep appends. Hits are few by construction, so the loop
# costs nothing next to the single grep pass above. A here-string, not a pipe:
# `grep -q` exits on first match and SIGPIPEs its writer, which under pipefail
# inverts the verdict.
hits=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  file="${line%%:*}"
  grep -qE "$ALLOW_RE" <<<"$file" && continue
  hits="${hits}${line}"$'\n'
done <<<"$raw"
hits="${hits%$'\n'}"

# A gate that scans nothing passes vacuously and reads as coverage
# (lessons-learned #9). This repo tracks thousands of files; if the walk ever
# sees a handful, the walk broke rather than the repo shrinking.
#
# PORTABLE_PATHS_MIN_FILES is a TEST-ONLY seam, so the suite can run the gate
# against a small throwaway repo. It is never set in CI, and the suite asserts
# no workflow sets it — wiring it would let a broken walk pass as a clean one.
MIN_FILES="${PORTABLE_PATHS_MIN_FILES:-500}"
if [ "$tracked_count" -lt "$MIN_FILES" ]; then
  echo "::error::check-portable-paths saw only ${tracked_count} tracked file(s), floor ${MIN_FILES} — the walk is broken, not the repo"
  exit 2
fi

if [ -n "$hits" ]; then
  echo "$hits" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    file="${line%%:*}"
    echo "::error file=${file}::machine-local absolute path: ${line}"
  done
  count="$(printf '%s\n' "$hits" | grep -c . || true)"
  echo "::error::${count} machine-local absolute path(s) in tracked files."
  echo "Use a repo-relative path, \$(git rev-parse --show-toplevel), or an environment"
  echo "variable. A tool that genuinely needs a machine-local path belongs in a personal"
  echo "config that is not checked in — see .codex/config.toml for the convention."
  exit 1
fi

echo "check-portable-paths: ${tracked_count} tracked file(s), no machine-local absolute paths"
