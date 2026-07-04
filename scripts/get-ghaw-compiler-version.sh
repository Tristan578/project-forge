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
# SEMVER SORT, NOT LEXICOGRAPHIC: rank with `sort -Vu | tail -1`, never
# `sort -u | head -1`. A plain lexicographic sort orders v0.51.0 BEFORE v0.53.1
# by character compare ('1' < '3' at the minor-version digit), so `head -1` over
# {v0.51.0, v0.53.1} returns v0.51.0 — the OLDER compiler — and the gate would
# false-fail by recompiling with the wrong version. `sort -V` orders semantically and is supported by GNU coreutils
# (ubuntu-latest, where CI runs this) AND by modern BSD/macOS sort (Apple sort
# 2.3+).
#
# SELECTION IS SEPARATE FROM EXTRACTION: the recorded versions are extracted first,
# then ranked in a second step. Folding both into one `grep | grep | sort | tail`
# pipeline let a `sort` failure (e.g. an ancient build without -V that exits
# non-zero) collapse to an empty result indistinguishable from "no lock records a
# version" — so the helper would SILENTLY emit the fallback, pinning the toolchain
# to the wrong compiler while reporting success and masking exactly the skew this
# gate exists to catch. With the steps split, a sort that cannot rank present
# versions FAILS LOUDLY (exit 1) instead. The fallback now fires ONLY when there
# is genuinely no recorded version. The multi-version and sort-failure cases are
# both covered by the helper's unit tests.
set -uo pipefail
shopt -s nullglob

# Single-sourced fallback: the version known-good at authoring time, emitted ONLY
# when no committed lock records a compiler_version.
FALLBACK_VERSION='v0.81.6'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" 2>/dev/null || { echo "$FALLBACK_VERSION"; exit 0; }

locks=(.github/workflows/*.lock.yml)
if [ ${#locks[@]} -eq 0 ]; then
  echo "$FALLBACK_VERSION"
  exit 0
fi

# Step 1 — extract every recorded compiler_version (no ranking yet).
versions="$(grep -hoE '"compiler_version" *: *"v[0-9.]+"' "${locks[@]}" 2>/dev/null \
              | grep -oE 'v[0-9.]+')"
if [ -z "$versions" ]; then
  # No lock records a version → the only legitimate fallback.
  echo "$FALLBACK_VERSION"
  exit 0
fi

# Step 2 — rank the extracted versions and take the highest. A sort that cannot
# rank them must fail loudly, never silently fall back (see header).
ver="$(printf '%s\n' "$versions" | sort -Vu 2>/dev/null | tail -1)"
if [ -z "$ver" ]; then
  echo "::error::get-ghaw-compiler-version: lock(s) record a compiler_version but this 'sort' could not rank them — refusing to silently fall back (use a sort that supports -V, e.g. GNU coreutils)." >&2
  exit 1
fi
echo "$ver"
