#!/usr/bin/env bash
# sentry-to-test-stub.sh — Generate regression test stubs from Sentry issues
# Used by: testing skill, developer workflow
# Compatible with bash 3+ (macOS system bash)
#
# Usage:
#   bash .claude/skills/testing/scripts/sentry-to-test-stub.sh <sentry-issue-url-or-id>
#   bash .claude/skills/testing/scripts/sentry-to-test-stub.sh --help
#
# Examples:
#   bash .claude/skills/testing/scripts/sentry-to-test-stub.sh 1234567890
#   bash .claude/skills/testing/scripts/sentry-to-test-stub.sh https://tristan-nolan.sentry.io/issues/1234567890/
#
# Environment:
#   SENTRY_AUTH_TOKEN — required, Sentry API auth token
#   SENTRY_ORG       — optional, defaults to tristan-nolan

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

SENTRY_ORG="${SENTRY_ORG:-tristan-nolan}"
SENTRY_API_BASE="https://us.sentry.io/api/0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1" >&2; exit 1; }
warn() { echo -e "${YELLOW}WARN${NC}: $1" >&2; }
info() { echo -e "${CYAN}INFO${NC}: $1"; }

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
if [ $# -eq 0 ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "sentry-to-test-stub.sh — Generate regression test stubs from Sentry issues"
  echo ""
  echo "Usage:"
  echo "  bash .claude/skills/testing/scripts/sentry-to-test-stub.sh <sentry-issue-url-or-id>"
  echo ""
  echo "Arguments:"
  echo "  sentry-issue-url-or-id  Sentry issue ID (numeric) or full Sentry issue URL"
  echo ""
  echo "Environment variables:"
  echo "  SENTRY_AUTH_TOKEN  (required) Your Sentry API authentication token"
  echo "                     Generate at: https://sentry.io/settings/account/api/auth-tokens/"
  echo "                     Required scopes: event:read, project:read, org:read"
  echo "  SENTRY_ORG         (optional) Sentry organization slug (default: tristan-nolan)"
  echo ""
  echo "Examples:"
  echo "  SENTRY_AUTH_TOKEN=sntrys_xxx bash .claude/skills/testing/scripts/sentry-to-test-stub.sh 1234567890"
  echo "  bash .claude/skills/testing/scripts/sentry-to-test-stub.sh https://tristan-nolan.sentry.io/issues/1234567890/"
  echo ""
  echo "Output:"
  echo "  Creates web/src/lib/__tests__/<filename>.regression.test.ts"
  exit 0
fi

# ---------------------------------------------------------------------------
# Token check
# ---------------------------------------------------------------------------
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo -e "${RED}ERROR${NC}: SENTRY_AUTH_TOKEN environment variable is not set." >&2
  echo "" >&2
  echo "To fix this:" >&2
  echo "  1. Go to https://sentry.io/settings/account/api/auth-tokens/" >&2
  echo "  2. Create a token with scopes: event:read, project:read, org:read" >&2
  echo "  3. Export it: export SENTRY_AUTH_TOKEN=sntrys_your_token_here" >&2
  echo "  4. Re-run this script" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse argument — accept URL or bare numeric ID
# ---------------------------------------------------------------------------
INPUT="$1"

# Extract numeric ID from URL patterns:
#   https://tristan-nolan.sentry.io/issues/1234567890/
#   https://sentry.io/organizations/tristan-nolan/issues/1234567890/
ISSUE_ID=""
if echo "$INPUT" | grep -qE '^https?://'; then
  ISSUE_ID="$(echo "$INPUT" | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+')"
  if [ -z "$ISSUE_ID" ]; then
    fail "Could not extract a numeric issue ID from URL: $INPUT"
  fi
elif echo "$INPUT" | grep -qE '^[0-9]+$'; then
  ISSUE_ID="$INPUT"
else
  fail "Argument must be a numeric Sentry issue ID or a Sentry issue URL. Got: $INPUT"
fi

info "Fetching Sentry issue: $ISSUE_ID (org: $SENTRY_ORG)"

# ---------------------------------------------------------------------------
# Fetch issue from Sentry API
# ---------------------------------------------------------------------------
ISSUE_JSON="$(curl -sf \
  -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  "${SENTRY_API_BASE}/organizations/${SENTRY_ORG}/issues/${ISSUE_ID}/" 2>&1)" || {
  echo -e "${RED}ERROR${NC}: Failed to fetch Sentry issue ${ISSUE_ID}." >&2
  echo "Possible causes:" >&2
  echo "  - Invalid SENTRY_AUTH_TOKEN" >&2
  echo "  - Issue ID does not exist or is not accessible" >&2
  echo "  - Wrong org slug (SENTRY_ORG=${SENTRY_ORG})" >&2
  echo "  - Network connectivity issue" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Extract fields using python3 (bash 3 compatible, no jq dependency assumed)
# ---------------------------------------------------------------------------
EXTRACTED="$(python3 - "$ISSUE_JSON" <<'PYEOF'
import json, sys, re

raw = sys.argv[1]
try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    sys.stderr.write("ERROR: Could not parse Sentry API response as JSON: " + str(e) + "\n")
    sys.exit(1)

# Error message
error_message = data.get("title", "Unknown error")

# Error type (exception class)
error_type = "Error"
culprit = data.get("culprit", "")
metadata = data.get("metadata", {})
if "type" in metadata:
    error_type = metadata["type"]
elif metadata.get("filename"):
    error_type = "Error"

# Tags
tags = {}
for tag in data.get("tags", []):
    tags[tag.get("key", "")] = tag.get("value", "")

# Source file and line from the latest event's stack trace
source_file = culprit if culprit else "unknown"
source_line = "?"

# Try to get from the first entry in the latest event
try:
    latest_event = data.get("latestEvent", {})
    if not latest_event:
        # Some Sentry responses embed entries directly
        latest_event = data

    entries = latest_event.get("entries", [])
    for entry in entries:
        if entry.get("type") == "exception":
            exception_data = entry.get("data", {})
            values = exception_data.get("values", [])
            if values:
                exc = values[-1]
                # Update error type from exception
                if exc.get("type"):
                    error_type = exc["type"]
                # Get stack trace
                stacktrace = exc.get("stacktrace", {})
                frames = stacktrace.get("frames", [])
                if frames:
                    # Last non-library frame
                    for frame in reversed(frames):
                        filename = frame.get("filename", "") or frame.get("absPath", "")
                        if filename and "node_modules" not in filename:
                            source_file = filename
                            source_line = str(frame.get("lineNo", "?"))
                            break
            break
except Exception:
    pass

# Derive a safe filename from the source file
# e.g. "src/lib/chat/executor.ts" -> "executor"
basename = source_file.split("/")[-1] if "/" in source_file else source_file
# Remove extension
basename = re.sub(r'\.[^.]+$', '', basename)
# Sanitize to identifier characters
basename = re.sub(r'[^a-zA-Z0-9_-]', '_', basename)
if not basename or basename == "unknown":
    basename = "sentry_" + sys.argv[0].split("_")[-1] if "_" in sys.argv[0] else "sentry_unknown"

# Sanitize error_message for use in describe() — strip backticks and newlines
safe_message = error_message.replace("`", "'").replace("\n", " ").replace("\r", "")[:120]

print(json.dumps({
    "issue_id": data.get("id", "unknown"),
    "error_message": safe_message,
    "error_type": error_type,
    "source_file": source_file,
    "source_line": source_line,
    "basename": basename,
    "culprit": culprit,
}))
PYEOF
)"

if [ -z "$EXTRACTED" ]; then
  fail "Failed to extract issue data from Sentry response"
fi

# Parse the extracted JSON fields into shell variables
ISSUE_ID_ACTUAL="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['issue_id'])")"
ERROR_MESSAGE="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error_message'])")"
ERROR_TYPE="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['error_type'])")"

# Escape single quotes for safe JS string interpolation
ERROR_MESSAGE_JS="${ERROR_MESSAGE//\'/\\\'}"
ERROR_TYPE_JS="${ERROR_TYPE//\'/\\\'}"
SOURCE_FILE="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['source_file'])")"
SOURCE_LINE="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['source_line'])")"
BASENAME="$(echo "$EXTRACTED" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['basename'])")"

info "Issue ID:      $ISSUE_ID_ACTUAL"
info "Error:         $ERROR_MESSAGE"
info "Type:          $ERROR_TYPE"
info "Source:        $SOURCE_FILE:$SOURCE_LINE"

# ---------------------------------------------------------------------------
# Determine output path
# ---------------------------------------------------------------------------
OUTPUT_DIR="$PROJECT_ROOT/web/src/lib/__tests__"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/${BASENAME}.regression.test.ts"

# Avoid clobbering an existing file — append issue ID suffix
if [ -f "$OUTPUT_FILE" ]; then
  OUTPUT_FILE="$OUTPUT_DIR/${BASENAME}.${ISSUE_ID_ACTUAL}.regression.test.ts"
  warn "Output file already exists, writing to: $OUTPUT_FILE"
fi

# ---------------------------------------------------------------------------
# Write the test stub
# ---------------------------------------------------------------------------
cat > "$OUTPUT_FILE" <<'STUBEOF'
/**
 * Regression test for Sentry issue #__ISSUE_ID__
 * Error: __ERROR_MESSAGE__
 * File: __SOURCE_FILE__:__SOURCE_LINE__
 *
 * TODO: Fill in the reproduction steps and assertions
 */
import { describe, it, expect } from 'vitest';

describe('Regression: __ERROR_MESSAGE_JS__', () => {
  it('should not throw __ERROR_TYPE_JS__', () => {
    // TODO: Set up the conditions that triggered the bug
    // Source: __SOURCE_FILE__:__SOURCE_LINE__

    // TODO: Add assertion
    expect(true).toBe(true); // placeholder
  });
});
STUBEOF

# Escape sed special characters in replacement strings:
#   & = backreference to matched pattern
#   | = our delimiter
#   \ = escape character
escape_sed() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

SED_ISSUE_ID="$(escape_sed "$ISSUE_ID_ACTUAL")"
SED_ERROR_MSG_JS="$(escape_sed "$ERROR_MESSAGE_JS")"
SED_ERROR_TYPE_JS="$(escape_sed "$ERROR_TYPE_JS")"
SED_ERROR_MSG="$(escape_sed "$ERROR_MESSAGE")"
SED_SOURCE_FILE="$(escape_sed "$SOURCE_FILE")"
SED_SOURCE_LINE="$(escape_sed "$SOURCE_LINE")"

# Replace placeholders with escaped values
sed -i.bak \
  -e "s|__ISSUE_ID__|${SED_ISSUE_ID}|g" \
  -e "s|__ERROR_MESSAGE_JS__|${SED_ERROR_MSG_JS}|g" \
  -e "s|__ERROR_TYPE_JS__|${SED_ERROR_TYPE_JS}|g" \
  -e "s|__ERROR_MESSAGE__|${SED_ERROR_MSG}|g" \
  -e "s|__SOURCE_FILE__|${SED_SOURCE_FILE}|g" \
  -e "s|__SOURCE_LINE__|${SED_SOURCE_LINE}|g" \
  "$OUTPUT_FILE"
rm -f "${OUTPUT_FILE}.bak"

pass "Test stub written to: $OUTPUT_FILE"
echo ""
echo "Next steps:"
echo "  1. Open $OUTPUT_FILE"
echo "  2. Import the module that contains the bug"
echo "  3. Reproduce the conditions from the Sentry stack trace"
echo "  4. Replace the placeholder assertion with one that fails before the fix"
echo "  5. Run: cd web && npx vitest run $(basename "$OUTPUT_FILE" .ts)"
