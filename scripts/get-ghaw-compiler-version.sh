#!/usr/bin/env bash
# Emit the gh-aw compiler version the CI gate should pin to, derived from the
# committed compiled locks so the toolchain can never silently skew from the
# compiler that produced them.
#
# Each .github/workflows/*.lock.yml carries a
#   # gh-aw-metadata: {"compiler_version":"vX.Y.Z"}
# header recording the gh-aw version that compiled it. This helper extracts those
# versions and emits the HIGHEST in semantic-version order, so the gate installs a
# compiler at least as new as the one that produced any committed lock. If the
# locks disagree the gate's own recompile then surfaces that disagreement as
# drift — picking the highest here keeps the bootstrap deterministic without
# masking the drift. If no lock records a version (or there are no locks at all),
# it emits a single known-good fallback.
#
# WHY A STANDALONE SCRIPT: this logic was originally inline in the ci.yml
# `ghaw-lock-sync` install step, where the gate-family bash suite could not reach
# it — a regression in the regex, the sort order, or the fallback would have
# shipped green. Extracting it (the same testability move the eval-seam guards
# make) lets scripts/__tests__/check-ghaw-lock-sync.test.sh exercise it directly.
#
# SEMVER SORT, NOT LEXICOGRAPHIC: `sort -Vu | tail -1`, never `sort -u | head -1`.
# A plain lexicographic sort orders v0.53.1 BEFORE v0.51.0 only by character
# compare, so `head -1` over {v0.51.0, v0.53.1} returns v0.51.0 — the OLDER
# compiler — and the gate would false-fail by recompiling with the wrong version.
# `sort -V` (GNU coreutils on ubuntu-latest; also supported by macOS sort) orders
# semantically; `tail -1` takes the highest. The multi-version case is covered by
# the helper's unit tests.
set -uo pipefail
shopt -s nullglob

# Single-sourced fallback: the version known-good at authoring time, emitted ONLY
# when no committed lock records a compiler_version.
FALLBACK_VERSION='v0.53.1'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" 2>/dev/null || { echo "$FALLBACK_VERSION"; exit 0; }

locks=(.github/workflows/*.lock.yml)
if [ ${#locks[@]} -eq 0 ]; then
  echo "$FALLBACK_VERSION"
  exit 0
fi

ver="$(grep -hoE '"compiler_version" *: *"v[0-9.]+"' "${locks[@]}" 2>/dev/null \
         | grep -oE 'v[0-9.]+' | sort -Vu | tail -1)"
echo "${ver:-$FALLBACK_VERSION}"
