#!/usr/bin/env bash
# PostCompact hook: re-inject .claude/rules/*.md after auto-compaction so the
# agent doesn't drift into deprecated patterns. CLAUDE.md/.claude/CLAUDE.md only
# load on SessionStart — without this hook, all rule context is lost mid-session.
#
# Stays well under the 5s hook timeout: ~46KB of markdown, single cat per file.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.claude/rules" ]; then
  exit 0
fi

shopt -s nullglob
RULES=("$REPO_ROOT"/.claude/rules/*.md)
if [ ${#RULES[@]} -eq 0 ]; then
  exit 0
fi

echo "=== Project Rules Re-Injected After Compaction ==="
echo "These rules normally load via SessionStart. Re-injecting because compaction"
echo "drops them from context. Treat them with the same authority as CLAUDE.md."
echo ""

for rule in "${RULES[@]}"; do
  rel="${rule#$REPO_ROOT/}"
  echo "--- BEGIN $rel ---"
  cat "$rule"
  echo ""
  echo "--- END $rel ---"
  echo ""
done

exit 0
