#!/usr/bin/env bash
# PreToolUse hook: fires on `gh api` commands that post PR comment replies.
# BLOCKS any reply containing deferred-fix language (Boy Scout Rule enforcement).
#
# Deferred-fix phrases like "will add", "filed for follow-up", "will monitor",
# "good point", "will consider", "next batch", "acknowledged" are BLOCKED
# unless the reply also contains a commit SHA (evidence of an actual fix).
#
# Legitimate non-fix replies ("by design", "false positive") are allowed.
# Replies with commit SHAs (7+ hex chars) are allowed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/hook-utils.sh"

COMMAND=$(get_bash_command)

# Only check gh api calls that post replies to PR comments
if [[ "$COMMAND" != *"gh api"* ]]; then
  exit 0
fi

# Must be a POST to a replies or comments endpoint
if ! echo "$COMMAND" | grep -qiE '(replies|comments)'; then
  exit 0
fi

# Must have a body field (-f body= or --field body=)
if ! echo "$COMMAND" | grep -qiE '(-f|--field)\s+body='; then
  exit 0
fi

# Extract the body content from the command (-f body= or --field body=)
BODY=$(echo "$COMMAND" | sed -En 's/.*(-f|--field)[[:space:]]+body="([^"]*)".*/\2/p')
if [ -z "$BODY" ]; then
  BODY=$(echo "$COMMAND" | sed -En "s/.*(-f|--field)[[:space:]]+body='([^']*)'.*/\2/p")
fi
if [ -z "$BODY" ]; then
  # Try without quotes (single-word bodies or heredoc-style)
  BODY=$(echo "$COMMAND" | sed -En 's/.*(-f|--field)[[:space:]]+body=([^ ]*).*/\2/p')
fi

# If we couldn't extract the body, let it through (don't block on parse failure)
if [ -z "$BODY" ]; then
  exit 0
fi

BODY_LOWER=$(echo "$BODY" | tr '[:upper:]' '[:lower:]')

# Allow legitimate non-fix replies
if echo "$BODY_LOWER" | grep -qiE '(by design|false positive|not applicable|n/a|duplicate of)'; then
  exit 0
fi

# Check for deferred-fix phrases
DEFERRED_PATTERNS=(
  "will add"
  "will monitor"
  "will consider"
  "will fix"
  "will address"
  "will update"
  "will implement"
  "will track"
  "will file"
  "will create"
  "filed for"
  "follow-up"
  "follow up"
  "next commit"
  "next batch"
  "next push"
  "next pr"
  "next sprint"
  "tracked in"
  "tracking in"
  "pre-existing"
  "preexisting"
  "good point"
  "valid point"
  "valid finding"
  "acknowledged"
  "noted"
  "makes sense"
  "agree with"
  "fair point"
  "good catch"
  "nice catch"
  "will look into"
  "looking into"
  "todo"
  "to-do"
)

FOUND_PHRASES=()
for pattern in "${DEFERRED_PATTERNS[@]}"; do
  if echo "$BODY_LOWER" | grep -qi "$pattern"; then
    FOUND_PHRASES+=("$pattern")
  fi
done

# No deferred phrases found — allow
if [ ${#FOUND_PHRASES[@]} -eq 0 ]; then
  exit 0
fi

# Check if the reply contains a commit SHA (evidence of actual fix)
# 7+ consecutive hex chars, typical of git short SHAs
if echo "$BODY" | grep -qE '[0-9a-f]{7,40}'; then
  exit 0
fi

# Check for "Fixed in" or "Addressed in" patterns (even without SHA in body)
if echo "$BODY_LOWER" | grep -qiE '(fixed in|addressed in|resolved in|implemented in|added in)'; then
  exit 0
fi

# BLOCK: deferred-fix language without evidence of an actual fix
echo "================================================================"
echo "  BOY SCOUT RULE VIOLATION — DEFERRED FIX DETECTED"
echo "================================================================"
echo ""
echo "  Your PR comment reply contains deferred-fix language:"
for phrase in "${FOUND_PHRASES[@]}"; do
  echo "    - \"$phrase\""
done
echo ""
echo "  The Boy Scout Rule requires IMMEDIATE action:"
echo "    1. Fix the issue NOW (edit code, write test)"
echo "    2. Commit with a descriptive message"
echo "    3. Include the commit SHA in your reply"
echo ""
echo "  Allowed reply patterns:"
echo "    - \"Fixed in \`abc1234\`. <description>\""
echo "    - \"By design. <technical reason>\""
echo "    - \"False positive — <explanation>\""
echo "    - \"Already addressed in \`abc1234\`.\""
echo ""
echo "  BLOCKED phrases: ${FOUND_PHRASES[*]}"
echo "================================================================"
exit 1
