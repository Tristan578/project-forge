#!/usr/bin/env bash
# Cross-provider agentic-config drift gate — fail a PR when an AI-assistant
# onboarding file (AGENTS.md, .github/copilot-instructions.md, .codex/AGENTS.md,
# .cursorrules) drifts from the single source of truth in
# tools/agentic-sync/canonical.json.
#
# These files hand-mirrored the same volatile facts (taskboard project/team IDs,
# pinned versions, coverage thresholds) and drifted — shipping a STALE Project ID
# and a dead team ID to every non-Claude contributor. The generator injects those
# facts from one source between AGENTIC-SYNC markers; this gate runs it in
# --check mode so divergence is caught BEFORE merge, deterministically, instead of
# being noticed when a contributor is onboarded against wrong IDs.
#
# Mirrors scripts/check-lockfile-sync.sh: a self-contained ~5s check, gated on its
# own ci-gate output, wired into the required ci-success aggregate, and unit-tested
# by scripts/__tests__/check-agentic-sync.test.sh. It is a CHECK, not a fix — the
# generator's --check mode never writes, so the gate leaves no mutation behind.
#
# $AGENTIC_SYNC_NODE is a TEST-ONLY override of the node binary, honoured only
# OUTSIDE CI. In CI we force the default `node` so an injected env var can never
# redirect the invocation to a rogue binary; the hermetic suite that uses the
# override runs with CI unset.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || { echo "::error::could not cd to repo root"; exit 1; }

GEN="tools/agentic-sync/sync.mjs"
if [ "${CI:-}" = "true" ]; then
  NODE_BIN="node"
else
  NODE_BIN="${AGENTIC_SYNC_NODE:-node}"
fi

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "::error::'$NODE_BIN' not found — cannot run the agentic-sync drift check"
  exit 1
fi
if [ ! -f "$GEN" ]; then
  echo "::error::$GEN not found at repo root ($ROOT)"
  exit 1
fi

if "$NODE_BIN" "$GEN" --check; then
  echo "✓ Cross-provider agentic config is in sync with tools/agentic-sync/canonical.json."
  exit 0
fi

echo ""
echo "Agentic-config drift detected — a provider instruction file no longer matches"
echo "the single source of truth (tools/agentic-sync/canonical.json)."
echo ""
echo "Fix: from the repo root, run"
echo "    node tools/agentic-sync/sync.mjs --write"
echo "then commit the regenerated instruction files."
exit 1
