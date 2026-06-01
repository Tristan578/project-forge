#!/usr/bin/env bash
# SubagentStop hook: if a reviewer/guardian subagent stops without posting a
# PASS/FAIL verdict, exit 2 to send it back to finish the review.
#
# WHY THIS IS HARDENED (loop-bug fix):
# A background subagent's SubagentStop `.output` is only a short terse "tail" of
# its run (e.g. "Acknowledged.", "Hook validated. End."), NOT the full review
# body it already returned to the orchestrator. Treating that absence-of-verdict
# as a failure made this hook re-activate the agent forever:
#   exit 2 -> agent stops with the same terse tail -> exit 2 -> ...
# We now only loop-block when the output is SUBSTANTIVE — long enough to be a
# real review body (>= MIN_REVIEW_CHARS) — and still lacks a verdict. Anything
# unverifiable (empty, whitespace-only, a JSON error object, or a short tail)
# exits 0: there is no review body to send back to, so blocking would only loop.
#
# The MIN_REVIEW_CHARS heuristic is deliberately a LENGTH check on an inherently
# truncated payload, not a content classifier: keyword/error-sniffing was removed
# because case-insensitive prose openers (e.g. "fatal: ...") let real reviews slip
# the gate. The authoritative full-output verdict gate is review-quality-gate.sh,
# which runs on the Stop event where the complete review IS present. Here, when in
# doubt we err toward exit 0 (allow) — the safe, non-looping direction for a tail.
#
# Exit code 2 = block (Claude Code re-activates the agent with the message below).
# Any other path exits 0 (allow). Malformed input fails safe to allow.

set -euo pipefail

# Minimum trimmed length for output to count as a real, verifiable review body.
# Terse subagent completion tails are far shorter than this; a genuine review
# that omits only its verdict is well above it.
MIN_REVIEW_CHARS=200

INPUT=$(cat)

# Fail safe: malformed / non-JSON input must never propagate a jq error through
# `set -e` (an undefined hook exit code) — default to a non-reviewer/empty payload
# so the hook allows the stop rather than blocking on garbage it cannot parse.
AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null || echo "unknown")
OUTPUT=$(printf '%s' "$INPUT" | jq -r '.output // ""' 2>/dev/null || echo "")

# Only enforce on reviewer/guardian agents.
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
  echo "[reject-incomplete-review] empty output — allowing stop (no review body)" >&2
  exit 0
fi

# A JSON object (platform/runtime error blob, not review prose). Review bodies
# never begin with '{'; this is the one structural shape we treat as non-review
# regardless of length, so a long error object cannot loop the agent.
if [ "${TRIMMED:0:1}" = "{" ]; then
  echo "[reject-incomplete-review] output is a JSON object, not a review — allowing stop" >&2
  exit 0
fi

# Terse subagent completion tail (not the full review body) -> unverifiable.
if [ "${#TRIMMED}" -lt "$MIN_REVIEW_CHARS" ]; then
  echo "[reject-incomplete-review] output is ${#TRIMMED} chars (< $MIN_REVIEW_CHARS) — terse tail, allowing stop" >&2
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
