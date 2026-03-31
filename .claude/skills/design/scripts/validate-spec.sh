#!/usr/bin/env bash
# design: Validate that a spec file has all required sections.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/validate-spec.sh" <spec-file>

set -euo pipefail

SPEC_FILE="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

if [ -z "$SPEC_FILE" ]; then
  echo "Usage: bash validate-spec.sh <path-to-spec-file>"
  echo "Example: bash validate-spec.sh specs/2026-03-25-my-feature.md"
  exit 1
fi

if [ ! -f "$SPEC_FILE" ]; then
  echo -e "${RED}ERROR: File not found: ${SPEC_FILE}${NC}"
  exit 1
fi

echo "=============================================="
echo "  SpawnForge Spec Validator"
echo "  File: ${SPEC_FILE}"
echo "=============================================="

CONTENT=$(cat "$SPEC_FILE")

# ---------------------------------------------------------------------------
# 1. Required sections
# ---------------------------------------------------------------------------
section "Required Sections"

check_section() {
  local label="$1"
  shift
  local found=false
  for pattern in "$@"; do
    if echo "$CONTENT" | grep -qiE "$pattern"; then
      found=true
      break
    fi
  done
  if [ "$found" = true ]; then
    pass "Section found: ${label}"
  else
    fail "Section missing: ${label} (expected heading matching: $*)"
  fi
}

# Summary / Problem / Solution
check_section "Summary or Problem statement" \
  "^##?\s*(Summary|Problem|Overview|Background)" \
  "^##?\s*(What|Why|Context)"

# Solution / Design / Approach
check_section "Solution or Design section" \
  "^##?\s*(Solution|Design|Approach|Implementation|Technical Design)" \
  "^##?\s*(How|Architecture)"

# Acceptance Criteria
check_section "Acceptance Criteria" \
  "^##?\s*Acceptance Criteria" \
  "^##?\s*(Criteria|AC|Acceptance Tests|Success Criteria)"

# Test Plan
check_section "Test Plan" \
  "^##?\s*(Test Plan|Testing|How to Test|Verification|Test Strategy)"

# ---------------------------------------------------------------------------
# 2. Acceptance Criteria format (Given/When/Then)
# ---------------------------------------------------------------------------
section "Acceptance Criteria Format"

AC_SECTION=$(echo "$CONTENT" | awk '/^##?\s*Acceptance Criteria/,/^##/' | head -50)

if echo "$AC_SECTION" | grep -qiE "(Given|When|Then)"; then
  pass "Acceptance criteria use Given/When/Then format"
else
  warn "Acceptance criteria should use Given/When/Then format for testability"
fi

# Count number of criteria
AC_COUNT=$(echo "$AC_SECTION" | grep -cE "^-\s*(Given|When|Then)" 2>/dev/null || echo "0")
if [ "$AC_COUNT" -ge 2 ]; then
  pass "Has ${AC_COUNT} Given/When/Then criteria"
elif [ "$AC_COUNT" -eq 1 ]; then
  warn "Only 1 Given/When/Then criterion — complex features need more coverage"
else
  warn "No Given/When/Then bullet points found in Acceptance Criteria section"
fi

# ---------------------------------------------------------------------------
# 3. File path references
# ---------------------------------------------------------------------------
section "File Path References"

# Check for code block with file paths or backtick references
FILE_REF_COUNT=$(echo "$CONTENT" | grep -cE '`[a-z_/]+\.[a-z]+`|engine/src/|web/src/' 2>/dev/null || echo "0")
if [ "$FILE_REF_COUNT" -ge 2 ]; then
  pass "Contains ${FILE_REF_COUNT} file path reference(s)"
else
  warn "Few or no file path references — specs should reference specific files being changed"
fi

# ---------------------------------------------------------------------------
# 4. Sequence/flow description
# ---------------------------------------------------------------------------
section "Sequence or Flow Description"

# Look for flow indicators: arrows, numbered steps, code blocks, ASCII diagrams
if echo "$CONTENT" | grep -qE '→|->|=>|^\s*[0-9]+\.\s+[A-Z]|```'; then
  pass "Contains flow description (arrows, numbered steps, or code blocks)"
else
  warn "No obvious flow/sequence description found — consider adding a data flow diagram or numbered steps"
fi

# ---------------------------------------------------------------------------
# 5. Status header
# ---------------------------------------------------------------------------
section "Spec Metadata"

if echo "$CONTENT" | grep -qiE "^>\s*\*\*(Status|Ticket|Date)"; then
  pass "Has metadata header (Status/Ticket/Date)"
else
  warn "Missing metadata header — add: > **Status:** DRAFT | **Ticket:** PF-NNN | **Date:** YYYY-MM-DD"
fi

# Check for ticket reference
if echo "$CONTENT" | grep -qE "PF-[0-9]+"; then
  pass "References a PF ticket"
else
  warn "No PF-XXXX ticket reference found"
fi

# ---------------------------------------------------------------------------
# 6. Architecture compliance hints
# ---------------------------------------------------------------------------
section "Architecture Compliance"

# Check that it doesn't mention bypassing the command pattern
if echo "$CONTENT" | grep -qiE "direct.*ecs|bypass.*command|mutation.*js|js.*mutation"; then
  fail "Spec mentions direct ECS mutation from JS — this violates the sandwich architecture"
fi

# If it touches Rust, it should mention bridge isolation
if echo "$CONTENT" | grep -qiE "rust|engine|bevy|ecs"; then
  if echo "$CONTENT" | grep -qiE "bridge|core/|pending"; then
    pass "Mentions bridge/core separation (engine changes look architecture-aware)"
  else
    warn "Spec touches engine/Rust but doesn't mention bridge isolation — verify it won't add browser deps to core/"
  fi
fi

# Check for AI parity mention
if echo "$CONTENT" | grep -qiE "mcp|chat handler|ai parity|command.*json"; then
  pass "Mentions AI parity / MCP commands"
else
  warn "No AI parity mention — every UI feature needs MCP commands"
fi

# Check for undo mention
if echo "$CONTENT" | grep -qiE "undo|redo|UndoableAction|history"; then
  pass "Mentions undo/redo support"
else
  warn "No undo/redo mention — every user-visible state change should be undoable"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
if [ "$ISSUES" -gt 0 ]; then
  echo -e "  ${RED}RESULT: FAIL — ${ISSUES} missing required section(s)${NC}"
  echo ""
  echo "  See: .claude/skills/design/references/spec-template.md"
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}RESULT: PASS WITH ${WARNINGS} WARNING(S) — review above${NC}"
else
  echo -e "  ${GREEN}RESULT: PASS — spec looks complete${NC}"
fi
echo "=============================================="

exit "$ISSUES"
