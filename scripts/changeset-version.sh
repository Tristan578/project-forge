#!/usr/bin/env bash
#
# Wraps `changeset version` with bounded retries, then relocks the root
# package-lock.json. This is the command behind the `changeset:version` npm
# script, invoked only by the Release workflow's changesets/action step.
#
# Why retries: the changelog generator (@changesets/changelog-github, set in
# .changeset/config.json) makes a GitHub GraphQL request PER changeset to enrich
# each CHANGELOG entry with PR/author links. Under load that request
# intermittently fails with:
#   error Failed to parse data from GitHub
#   error Invalid response body while trying to fetch https://api.github.com/graphql: Premature close
# which aborts `changeset version` (exit 1) and fails the Release run, firing a
# spurious "Run Failed" notification even though the release itself is unaffected.
#
# Why a retry is safe: on that error changesets escapes and applies NO files
# ("We have escaped applying the changesets, and no files should have been
# affected"), so the changeset files are untouched and re-running is idempotent.
# A second attempt almost always succeeds once the transient GraphQL blip clears.
#
# This keeps the GitHub changelog links (vs. dropping changelog-github for the
# network-free default) while making the step resilient to the flake.
#
# ESCAPE HATCH: set CHANGESET_VERSION_ATTEMPTS=N to override the default 4
# attempts — e.g. `CHANGESET_VERSION_ATTEMPTS=1 npm run changeset:version` to
# fail fast when reproducing a non-transient changeset error locally.
set -euo pipefail

# Resolve to the repo root so `./node_modules/.bin/changeset` and the relock
# work regardless of the caller's cwd (npm already runs us from root; this makes
# a manual `bash scripts/changeset-version.sh` from a subdir behave too).
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

attempts="${CHANGESET_VERSION_ATTEMPTS:-4}"
changeset_bin="./node_modules/.bin/changeset"

for attempt in $(seq 1 "$attempts"); do
  if "$changeset_bin" version; then
    break
  fi
  if [ "$attempt" -eq "$attempts" ]; then
    echo "::error::changeset version failed after ${attempts} attempts (see the changesets output above for the underlying error)" >&2
    exit 1
  fi
  delay=$((attempt * 5))
  echo "::warning::changeset version attempt ${attempt}/${attempts} failed (likely a transient GitHub GraphQL flake); retrying in ${delay}s" >&2
  sleep "$delay"
done

npm install --package-lock-only
