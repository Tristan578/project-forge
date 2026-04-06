#!/usr/bin/env bash
# PreToolUse hook: fires on `gh api` commands that post PR comment replies.
# BLOCKS any reply containing deferred-fix language (Boy Scout Rule enforcement).
#
# Deferred-fix phrases like "will add", "filed for follow-up", "will monitor",
# "good point", "known limitation", "out of scope" are BLOCKED unless the reply
# contains BOTH a commit SHA AND a "Fixed in"/"Addressed in" pattern, OR
# references a GitHub issue ticket (#NNNN).
#
# Legitimate non-fix replies ("by design", "false positive") are allowed.
#
# FAIL-CLOSED: if body extraction fails, the command is BLOCKED (not allowed).
# This prevents parse-failure bypasses.

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

# Must have a body field (-f body= or --field body= or -F body=)
if ! echo "$COMMAND" | grep -qiE '(-[fF]|--field)\s+body='; then
  exit 0
fi

# Extract the body content — try multiple quoting styles
# 1. Double-quoted: -f body="..."
BODY=$(echo "$COMMAND" | sed -En 's/.*(-[fF]|--field)[[:space:]]+body="([^"]*)".*/\2/p')
# 2. Single-quoted: -f body='...'
if [ -z "$BODY" ]; then
  BODY=$(echo "$COMMAND" | sed -En "s/.*(-[fF]|--field)[[:space:]]+body='([^']*)'.*/\2/p")
fi
# 3. Unquoted: -f body=word
if [ -z "$BODY" ]; then
  BODY=$(echo "$COMMAND" | sed -En 's/.*(-[fF]|--field)[[:space:]]+body=([^ ]*).*/\2/p')
fi
# 4. Heredoc via $(cat <<'EOF'...EOF): extract everything after body=
if [ -z "$BODY" ]; then
  BODY=$(echo "$COMMAND" | sed -En 's/.*body="\$\(cat <<[^)]*\)".*/HEREDOC_DETECTED/p')
  if [ "$BODY" = "HEREDOC_DETECTED" ]; then
    BODY=$(echo "$COMMAND" | sed -En 's/.*body="([^"]+)".*/\1/p')
  fi
fi

# FAIL-CLOSED: if we can't extract the body, BLOCK the command.
# Previous behavior (exit 0) allowed any unparseable reply through silently.
if [ -z "$BODY" ]; then
  echo "================================================================"
  echo "  BOY SCOUT RULE HOOK — BODY EXTRACTION FAILED"
  echo "================================================================"
  echo ""
  echo "  Could not extract the reply body from the gh api command."
  echo "  This hook fails closed to prevent bypass via unusual quoting."
  echo ""
  echo "  Use standard quoting: -f body=\"your reply text here\""
  echo "================================================================"
  exit 2
fi

BODY_LOWER=$(echo "$BODY" | tr '[:upper:]' '[:lower:]')

# Allow legitimate non-fix replies
if echo "$BODY_LOWER" | grep -qiE '(by design|false positive|not applicable|n/a|duplicate of|intentional)'; then
  exit 0
fi

# Check for deferred-fix phrases — comprehensive list from real violations
DEFERRED_PATTERNS=(
  # "will do X later" family
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
  "will look into"
  "will refactor"
  "will clean"
  "will revisit"
  "will handle"
  # "deferred to future" family
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
  "looking into"
  "defer to"
  "deferred to"
  "punt to"
  "separate pr"
  "separate issue"
  "future refactor"
  "future improvement"
  "future work"
  # "pre-existing / not my problem" family
  "pre-existing"
  "preexisting"
  "out of scope"
  "not addressing"
  "not in scope"
  # "soft acknowledgment without action" family
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
  # "minimizing / dismissing" family
  "known limitation"
  "known issue"
  "low-priority"
  "low priority"
  "acceptable tradeoff"
  "acceptable trade-off"
  "keep scope tight"
  "scope tight"
  "maybe later"
  "minor enough"
  "not critical"
  "cosmetic"
  "non-blocking"
  "nice to have"
  "stretch goal"
  "if this becomes"
  "if it becomes"
  # task tracking without immediate action
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

# Allow if reply references a GitHub issue ticket (#NNNN pattern)
# This means "deferred but tracked" — acceptable with a real ticket number
if echo "$BODY" | grep -qE '#[0-9]{3,}'; then
  exit 0
fi

# Allow if reply contains BOTH a commit SHA AND an action verb
# Just a bare SHA is NOT enough — it must say what was fixed
HAS_SHA=false
HAS_ACTION=false
if echo "$BODY" | grep -qE '[0-9a-f]{7,40}'; then
  HAS_SHA=true
fi
if echo "$BODY_LOWER" | grep -qiE '(fixed in|addressed in|resolved in|implemented in|added in|committed in|patched in)'; then
  HAS_ACTION=true
fi
if $HAS_SHA && $HAS_ACTION; then
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
echo "    - \"Tracked in #NNNN. <description>\"  (with real GH issue)"
echo ""
echo "  BLOCKED phrases: ${FOUND_PHRASES[*]}"
echo "================================================================"
exit 2
