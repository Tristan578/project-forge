#!/usr/bin/env bash
# SubagentStop hook: if a reviewer subagent stops without posting a PASS/FAIL
# verdict, exit 2 to send it back to finish the review.
#
# HARDENING: a background subagent's SubagentStop `.output` is only a short
# terse "tail" of its run (e.g. "Acknowledged.", "Hook validated. End."), not
# the full review body it already returned to the orchestrator. Treating that
# absence-of-verdict as a failure made this hook re-activate the agent forever
# (exit 2 -> agent stops with the same terse tail -> exit 2 -> ...). We now only
# loop-block when the output is SUBSTANTIVE — long enough to be a real review
# body — and still lacks a verdict. Empty, whitespace-only, terse-tail, or
# visibly errored output exits 0: there is no review body to send back to.
#
# Exit code 2 = block (Claude Code re-activates the agent with the message).

set -euo pipefail

# Minimum trimmed length for output to count as a real, verifiable review body.
# Terse subagent completion tails are far shorter than this; a genuine review
# that omits only its verdict is well above it.
MIN_REVIEW_CHARS=200

INPUT=$(cat)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)
OUTPUT=$(echo "$INPUT" | jq -r '.output // ""' 2>/dev/null)

# Only enforce on reviewer/guardian agents
if ! echo "$AGENT_TYPE" | grep -qiE "reviewer|guardian"; then
  exit 0
fi

# A clear PASS or FAIL verdict is all we require — accept and move on.
if echo "$OUTPUT" | grep -qiE '\bPASS\b|\bFAIL\b'; then
  exit 0
fi

# --- Hardening: never loop-block on unverifiable output ---

# Trim surrounding whitespace so we measure real content.
TRIMMED=$(printf '%s' "$OUTPUT" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

# Empty / whitespace-only -> nothing to send back to.
if [ -z "$TRIMMED" ]; then
  exit 0
fi

# Errored/interrupted run that dumped a stack trace instead of a review. The
# markers are anchored to the start and use formats (colon/paren-delimited) that
# do not occur at the head of normal review prose, so review content that merely
# discusses errors, timeouts, or rate limits is NOT matched here.
if printf '%s' "$TRIMMED" | grep -qiE \
  '^(Traceback \(most recent call last\)|Error: |Uncaught |Unhandled |panic:|fatal:|Aborted|Killed|Segmentation fault)'; then
  exit 0
fi

# Terse subagent completion tail (not the full review body) -> unverifiable.
if [ "${#TRIMMED}" -lt "$MIN_REVIEW_CHARS" ]; then
  exit 0
fi

# Substantive review body that genuinely omits a verdict — send it back.
echo "REVIEW INCOMPLETE: You have not posted a clear PASS or FAIL verdict."
echo ""
echo "You MUST end your review with one of:"
echo "  VERDICT: PASS — followed by a summary of what was checked."
echo "  VERDICT: FAIL — followed by specific, actionable findings with file references."
echo ""
echo "Partial analysis without a verdict is not acceptable. Continue your review."

exit 2
