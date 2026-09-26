#!/usr/bin/env bash
# Tests for inject-post-compact.sh (PostCompact rule digest).
#
# Contract under test:
#   * exits 0 and prints a digest plus a pointer table of every file under
#     .claude/rules/;
#   * EVERY listed rule file carries a real one-line summary. The table is a
#     hand-maintained `case` block, so a new rule file falls through to
#     "(no summary)" unless someone remembers to add a hint — and nothing failed
#     when the one file every agent is told is MANDATORY (lessons-learned.md)
#     sat in that fall-through;
#   * the output stays under Claude Code's 10,000-character hook-stdout cap,
#     past which it is truncated silently and the tail is lost.
#
# Runs against the REAL rules directory on purpose: the property is about the
# files this repository actually has. No fixture seam, so nothing to defend.
#
# Run: bash .claude/hooks/__tests__/inject-post-compact.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../inject-post-compact.sh"
RULES_DIR="$HERE/../../rules"

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ok    $1"; }
readonly -f ok
bad() { fail=$((fail + 1)); echo "  FAIL  $1"; }
readonly -f bad

OUT="$(bash "$HOOK" 2>/dev/null)"
RC=$?

if [ "$RC" -eq 0 ]; then ok "the hook exits 0"; else bad "the hook exited $RC"; fi

# The walk must be non-empty, or "no line lacks a summary" is true of nothing.
LISTED="$(grep -cE '^- \.claude/rules/[^ ]+\.md — ' <<<"$OUT")"
ON_DISK="$(find "$RULES_DIR" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
if [ "$ON_DISK" -ge 1 ] && [ "$LISTED" -eq "$ON_DISK" ]; then
  ok "the pointer table lists every rule file on disk ($LISTED of $ON_DISK)"
else
  bad "the pointer table lists $LISTED rule file(s); .claude/rules/ holds $ON_DISK"
fi

MISSING="$(grep -E '^- \.claude/rules/.*\(no summary\)$' <<<"$OUT" || true)"
if [ -z "$MISSING" ]; then
  ok "no rule file falls through to '(no summary)'"
else
  bad "rule file(s) with no hint in the case block of inject-post-compact.sh: $MISSING"
fi

if grep -qE '^- \.claude/rules/lessons-learned\.md — .*[A-Za-z]' <<<"$OUT" \
   && ! grep -qE '^- \.claude/rules/lessons-learned\.md — \(no summary\)$' <<<"$OUT"; then
  ok "lessons-learned.md — the file every agent must read — has a summary"
else
  bad "lessons-learned.md has no summary line"
fi

CHARS="${#OUT}"
if [ "$CHARS" -gt 0 ] && [ "$CHARS" -lt 10000 ]; then
  ok "output is $CHARS characters — under the 10,000-character hook-stdout cap"
else
  bad "output is $CHARS characters (must be 1..9999: past the cap it is truncated silently)"
fi

echo ""
echo "  PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
