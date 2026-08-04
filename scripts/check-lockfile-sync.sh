#!/usr/bin/env bash
# Lockfile-drift gate — fail a PR when a package.json change was not accompanied
# by a regenerated root package-lock.json.
#
# This is a single-root-lockfile monorepo: ONE package-lock.json at the repo
# root governs web/, mcp-server/ and the root workspace. A Dependabot npm PR
# scoped to `directory: /web` (or a hand-edit) can bump web/package.json without
# touching the root lockfile; the manifest range then no longer matches the
# pinned lockfile version, and every `npm ci` (all of CI + the Quality Gates
# jobs run it) fails with EUSAGE on main. That regression shipped twice
# (#8655, #8658 → #8683) because `npm ci`'s own check only trips AFTER the bad
# state lands. This gate trips BEFORE merge: it regenerates the lockfile from
# the current manifests and fails if the result differs from what is committed.
#
# SECURITY: the regeneration command is overridable via $LOCKFILE_REGEN_CMD and
# run through `eval` purely as a TEST SEAM — the unit test
# (scripts/__tests__/check-lockfile-sync.test.sh) injects a stub so it can run
# hermetically without npm or the network. CI never sets the variable; it uses
# the default real `npm install --package-lock-only`. The value is therefore
# trusted (it originates from this repo's own workflow/test, never from PR
# contents or any untrusted input), so the `eval` carries no injection risk.
# Do NOT wire this variable to anything attacker-controllable.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

LOCKFILE="package-lock.json"
# Single-source the regeneration command so the human remediation hint printed on
# drift can never drift from what the gate actually runs. BASE_REGEN is the bare
# command a developer runs locally to fix drift; the CI default hardens it with
# --ignore-scripts (so a hostile package.json lifecycle script in a PR cannot
# execute during regeneration), --no-audit and --no-fund. $LOCKFILE_REGEN_CMD is a
# TEST-ONLY seam (see header) and is never set in CI, so the default is what runs.
BASE_REGEN='npm install --package-lock-only'
REGEN_CMD="${LOCKFILE_REGEN_CMD:-$BASE_REGEN --ignore-scripts --no-audit --no-fund}"

# Stage 1 command (see the stage-1 block below). $LOCKFILE_CONSISTENCY_CMD is a
# TEST-ONLY seam with the same contract and the same do-not-wire rule as
# $LOCKFILE_REGEN_CMD above; CI never sets it, so the default is what runs.
# --package-lock-only is load-bearing: without it npm ls grades the INSTALLED
# node_modules tree, which on a warm cache satisfies every edge while the
# committed lockfile is still broken — the same false green a warm `npm ci`
# gives ("up to date in 1s"). --json is what makes the output parseable rather
# than scraped.
BASE_CONSISTENCY='npm ls --package-lock-only --all --json'
CONSISTENCY_CMD="${LOCKFILE_CONSISTENCY_CMD:-$BASE_CONSISTENCY}"
MANIFEST="package.json"

if [ ! -f "$LOCKFILE" ]; then
  echo "::error::$LOCKFILE not found at repo root ($ROOT)"
  exit 1
fi

# --- Stage 1: lockfile-internal consistency ----------------------------------
# The regen/diff in stage 2 catches a MISSING relock, but it is blind to an
# internally INCONSISTENT lockfile: one whose workspace entries record the new
# dependency range while the resolved package nodes still carry the old version.
# npm reads those recorded ranges, concludes the manifests are already
# satisfied, and re-resolves nothing — so the regeneration is a no-op and stage
# 2 sees a zero-length diff while `npm ci` (which resolves from the manifests on
# disk) fails with EUSAGE. Shipped live on #9070: web/ and apps/docs/ moved to
# @playwright/test ^1.62.1, the lockfile's workspace entries recorded ^1.62.1,
# but the resolved nodes stayed at 1.62.0. Every gate was green; Vercel's frozen
# `npm ci` was the only thing that caught it. (A local `npm ci` also passes in
# this state whenever node_modules is already populated.)
#
# `npm ls --package-lock-only --all --json` resolves every dependency edge
# against the lockfile's OWN nodes and reports each unsatisfied one in its
# `problems` array. It reads only the lockfile — no network, no node_modules, no
# mutation. Run it BEFORE stage 2 so it inspects the pristine committed file.
#
# DO NOT key on npm's exit code, and do not text-match /invalid/ either:
#
#   * Exit code is unusable here. `overrides` in package.json deliberately force
#     a version outside a declared range, and npm reports every such edge as
#     `invalid` — so this repo's HEALTHY lockfile already yields 8 problems and
#     a permanent exit 1 (postcss, @clerk/shared, sharp, undici, esbuild,
#     dompurify, js-cookie, ws — all of them override entries). A gate that is
#     always red gets deleted, not fixed.
#   * Text-matching is unusable too: `character-reference-invalid` is a real
#     transitive package here, so /invalid/ hits on a clean tree.
#
# The signal is the problem set MINUS the packages that `overrides` forces. That
# subtraction is self-maintaining — it is derived from package.json on every
# run, so removing an override automatically stops excluding it, with no
# baseline file to rot. Its one accepted blind spot: a package that is BOTH
# overridden and genuinely drifted is not reported, which is the semantics of an
# override (you asked for a version outside the declared range).
if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required by the lockfile consistency check but was not found on PATH"
  exit 2
fi
if [ ! -f "$MANIFEST" ]; then
  echo "::error::$MANIFEST not found at repo root ($ROOT) — cannot derive the overrides exclusion set"
  exit 2
fi

consistency_log="$(mktemp)"
trap 'rm -f "$consistency_log"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# npm ls exits non-zero whenever ANY problem exists, including the expected
# override ones, so its status is captured for diagnostics only and deliberately
# not used as the verdict. A command that produces no parseable JSON at all is a
# separate, fail-closed case handled just below.
eval "$CONSISTENCY_CMD" >"$consistency_log" 2>/dev/null
if ! jq -e 'type == "object"' "$consistency_log" >/dev/null 2>&1; then
  echo "::error::lockfile consistency check produced no parseable JSON (command: $CONSISTENCY_CMD)"
  echo "--- consistency command output (first 40 lines) ---"
  head -40 "$consistency_log"
  echo "--- end consistency command output ---"
  exit 2
fi

# Problems whose package is NOT override-forced. An unparseable problem string
# (a future npm format change) is kept as a finding rather than dropped, so the
# gate degrades to a false ALARM, never to a silent pass.
#
# The parse is wrapped as `[ ... capture(...)? ] | first` rather than a bare
# `capture(...)?`: jq's `?` yields EMPTY on error, and `(empty) as $x | body`
# iterates zero times, so a bare `?` would make an unparseable problem vanish —
# fail-OPEN, the exact opposite of the intent. Collecting into an array first
# turns that empty into a null the `select` below can actually test.
# jq's stderr is deliberately NOT suppressed: on a malformed report its message
# names the offending construct, and losing that leaves only a bare exit code.
findings="$(jq -r --slurpfile manifest "$MANIFEST" '
  def forced:
    to_entries
    | map(
        if (.value | type) == "string" then [.key]
        elif (.value | type) == "object"
          then ((.value | forced) + (if (.value | has(".")) then [.key] else [] end))
        else [] end)
    | flatten;
  (($manifest[0].overrides // {}) | forced | unique) as $forced
  | (.problems // [])[]
  | . as $problem
  | ([$problem | capture("^(?<kind>[a-z ]+): (?<spec>[^ ,]+)")?] | first) as $parsed
  | select($parsed == null
           or (($parsed.spec | sub("@[^@]*$"; "")) as $name | ($forced | index($name)) == null))
  | $problem
' "$consistency_log")"
jq_status=$?
if [ "$jq_status" -ne 0 ]; then
  echo "::error::failed to evaluate the lockfile consistency report (jq exit $jq_status)"
  exit 2
fi

if [ -n "$findings" ]; then
  echo "::error::Lockfile is internally inconsistent — a resolved version does not satisfy the range that requires it."
  echo ""
  echo "$LOCKFILE records a dependency range that its own resolved package nodes"
  echo "do not satisfy. 'npm ci' resolves from the manifests and will fail with"
  echo "EUSAGE (\"Missing: <pkg>@<version> from lock file\"), breaking every job"
  echo "that installs — including the Vercel preview and production builds."
  echo ""
  echo "Offending edges (override-forced resolutions already excluded):"
  # Assign-then-slice rather than piping into head: under `pipefail` head's early
  # close would SIGPIPE the writer and poison the status of a successful read.
  head -40 <<<"$findings"
  echo ""
  echo "Fix: '$BASE_REGEN' will NOT repair this class — the lockfile's recorded"
  echo "ranges already match the manifests, so npm re-resolves nothing. Drop the"
  echo "stale nodes and renormalize, from the repo root:"
  echo ""
  echo "    jq '.packages |= with_entries(select(.key | test(\"(^|/)node_modules/<pkg>(/|\$)\") | not))' \\"
  echo "      $LOCKFILE > /tmp/lock.json && mv /tmp/lock.json $LOCKFILE"
  echo "    $BASE_REGEN"
  echo ""
  echo "then verify with 'npm ci' and commit the updated $LOCKFILE."
  exit 1
fi
rm -f "$consistency_log"

# Regenerate the lockfile from the manifests only (no node_modules writes).
# Capture the command's own output so a real npm failure (registry 404, bad
# engines floor, malformed manifest) is surfaced in the gate log instead of
# being swallowed — a silent "regeneration command failed" is un-actionable.
regen_log="$(mktemp)"
# Declared before the trap below so the single EXIT handler covers both tmpfiles.
# It stays empty unless the classifier further down actually creates it; `rm -f`
# on an empty operand is a silent no-op, so the trap is safe either way.
committed_lock=""
# Clean up the tmpfile on EVERY exit path. The explicit TERM/INT handlers are not
# redundant with the EXIT trap: the regeneration is a multi-second `npm install`,
# and if CI cancels the job it sends SIGTERM mid-eval. On the Linux runner (bash
# 5.x) an EXIT trap does NOT run for an *untrapped* terminating signal, so without
# the TERM/INT handlers the tmpfile would leak exactly on cancellation; the
# handler's `exit` is what triggers the EXIT trap. (check-ci-success.sh uses an
# EXIT-only trap by contrast — its work is sub-second, so its signal window is
# negligible; here the long npm window makes the signal handlers worth the lines.)
trap 'rm -f "$regen_log" "$committed_lock"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if ! eval "$REGEN_CMD" >"$regen_log" 2>&1; then
  echo "::error::lockfile regeneration command failed: $REGEN_CMD"
  echo "--- regeneration command output ---"
  cat "$regen_log"
  echo "--- end regeneration command output ---"
  git checkout -- "$LOCKFILE" 2>/dev/null || true
  exit 1
fi

if git diff --quiet -- "$LOCKFILE"; then
  echo "✓ $LOCKFILE is in sync with the package manifests."
  exit 0
fi

# --- Stage 3: classify the difference ----------------------------------------
# The regenerated lockfile differs from the committed one. Before blaming the
# contributor, rule out a TOOLCHAIN artifact: some npm versions rewrite platform
# metadata on the Linux-only optional native bindings. Measured on one macOS host
# against this repo's clean main:
#
#   npm 11.10.0 (bundled with Node 25.6.1)  -> 34 nodes lose their "libc" field
#   npm 11.16.0 (bundled with Node 24.18.0) -> zero drift
#   npm 11.16.0 run UNDER Node 25.6.1       -> zero drift
#
# The third row is the control that isolates the variable: same OS, same Node,
# only npm swapped, drift gone. So this is npm-VERSION skew — not a macOS
# artifact and not a Node-version artifact. CI resolves npm from .node-version
# (Node 24) and never sees it; a contributor on a newer Node does, on every run.
#
# Reported as drift that is a false accusation with an unactionable remedy: the
# printed fix IS the command that produced it, so re-running reproduces the
# identical diff forever.
#
# WHY THIS CANNOT MASK REAL DRIFT. A manifest change makes npm re-resolve, which
# adds or removes package nodes or changes version/resolved/integrity — all of
# which survive stripping os/cpu/libc. And `integrity` pins the exact tarball, so
# a given version can never legitimately change its own platform metadata. A
# difference that vanishes under the strip therefore carries no information about
# whether the lockfile matches the manifests. The classifier is also strictly
# additive: everything it does not positively prove benign takes the pre-existing
# exit-1 path, including any input it cannot parse.
#
# `git show :$LOCKFILE` (the INDEX, not HEAD) is the right baseline because
# `git diff -- $LOCKFILE` above compares worktree against index.
classification=""
committed_lock="$(mktemp)"
if git show ":$LOCKFILE" >"$committed_lock" 2>/dev/null && [ -s "$committed_lock" ]; then
  classification="$(jq -rn --slurpfile a "$committed_lock" --slurpfile b "$LOCKFILE" '
    def strip_platform:
      if (.packages | type) == "object"
      then .packages |= with_entries(
             .value |= (if type == "object" then del(.os, .cpu, .libc) else . end))
      else . end;
    def platform_view:
      [ (.packages // {}) | to_entries[]
        | {k: .key, os: (.value.os? // null), cpu: (.value.cpu? // null), libc: (.value.libc? // null)} ];
    ($a[0] | strip_platform) as $na
    | ($b[0] | strip_platform) as $nb
    | if $na == $nb then "artifact"
      elif ($a[0] | platform_view) != ($b[0] | platform_view) then "drift-with-platform-noise"
      else "drift"
      end
  ' 2>/dev/null)" || classification=""
fi

if [ "$classification" = "artifact" ]; then
  npm_version="$(npm --version 2>/dev/null)"
  [ -n "$npm_version" ] || npm_version="unknown"
  pinned_node="$(tr -d '[:space:]' < .node-version 2>/dev/null)"
  [ -n "$pinned_node" ] || pinned_node="unknown"

  echo "::error::Lockfile regeneration produced a TOOLCHAIN artifact — this run cannot judge the lockfile."
  echo ""
  echo "The regenerated $LOCKFILE is identical to the committed one except for"
  echo "platform metadata (os / cpu / libc) on optional native bindings. No package"
  echo "node was added, removed or re-resolved, and no version, resolved URL or"
  echo "integrity hash changed — so this difference says nothing about whether the"
  echo "lockfile matches the manifests. It is the local npm rewriting fields that a"
  echo "different npm preserves."
  echo ""
  echo "    npm running here:             $npm_version"
  echo "    Node pinned by .node-version: $pinned_node"
  echo ""
  echo "Measured: npm 11.10.0 (bundled with Node 25) drops the \"libc\" field from the"
  echo "Linux-only native bindings; npm 11.16.0 (bundled with Node 24) preserves it."
  echo "Re-running '$BASE_REGEN' under the same npm"
  echo "reproduces this forever, which is why it must not be reported as drift."
  echo ""
  echo "Fix: regenerate under the Node/npm this repo pins, from the repo root —"
  echo ""
  echo "    nvm use          # or fnm use / volta pin — anything honouring .node-version"
  echo "    $BASE_REGEN"
  echo ""
  echo "If this fired in CI, the runner's npm no longer matches .node-version: fix"
  echo "the pin. Never commit the rewritten lockfile to silence it."
  echo ""
  echo "Platform-metadata difference (first 40 lines):"
  git --no-pager diff -- "$LOCKFILE" | head -40
  git checkout -- "$LOCKFILE" 2>/dev/null || true
  exit 2
fi

# Drift: report with remediation, then restore the committed lockfile so the
# gate leaves no mutation behind (it is a check, not a fix).
echo "::error::Lockfile drift detected — $LOCKFILE does not match the package manifests."
echo ""
echo "A package.json was changed without regenerating the root lockfile. In this"
echo "single-root-lockfile monorepo a bump under web/ or mcp-server/ must also"
echo "update the root package-lock.json, or 'npm ci' breaks on main."
echo ""
echo "Fix: from the repo root, run"
echo "    $BASE_REGEN"
echo "then commit the updated package-lock.json."
if [ "$classification" = "drift-with-platform-noise" ]; then
  # Real drift AND the toolchain rewrite landed in the same regeneration. Say so:
  # the reader is about to scan a diff whose bulk may be noise, and without this
  # they will chase the wrong lines.
  echo ""
  echo "Note: part of the diff below is platform metadata (os / cpu / libc) rewritten"
  echo "by the local npm, which is NOT drift — see .node-version. The substantive"
  echo "changes (added/removed nodes, version, resolved, integrity) are the real ones."
fi
echo ""
echo "Drift (first 40 lines):"
git --no-pager diff -- "$LOCKFILE" | head -40
git checkout -- "$LOCKFILE" 2>/dev/null || true
exit 1
