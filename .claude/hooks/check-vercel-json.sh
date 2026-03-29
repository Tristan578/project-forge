#!/usr/bin/env bash
# PreToolUse hook (Edit|Write): validate vercel.json edits
# Catches invalid properties that Vercel silently rejects at deploy time.
# See CLAUDE.md gotcha: "nodeVersion is invalid in vercel.json"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only check vercel.json files
[[ "$FILE_PATH" == *vercel.json ]] || exit 0

# Properties that Vercel rejects as "should NOT have additional property"
INVALID_PROPS=("nodeVersion" "engines" "node" "runtime")

for prop in "${INVALID_PROPS[@]}"; do
  NEW_STRING=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null)
  if echo "$NEW_STRING" | grep -q "\"$prop\""; then
    echo "WARNING: '$prop' is not a valid vercel.json property."
    echo "  Vercel will reject the deploy with: 'should NOT have additional property'."
    echo "  Configure Node version in Vercel project settings instead."
    echo "  See: CLAUDE.md Gotchas"
  fi
done

exit 0
