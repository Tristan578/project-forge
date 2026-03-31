#!/usr/bin/env bash
# validate-ticket.sh — Validate a taskboard ticket meets the mandatory format
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/validate-ticket.sh" <TICKET_ID>
# Exit 0 always (informational — failures are printed, not blocking)

set -uo pipefail

TICKET_ID="${1:-}"
if [ -z "${TICKET_ID}" ]; then
  echo "Usage: $0 <TICKET_ID>"
  echo "Example: $0 01KK974VMNC16ZAW7MW1NH3T3M"
  exit 0
fi

# Try Portless URL first, fall back to direct port
BASE_URL="http://taskboard.localhost:1355/api"
if ! curl -s --max-time 2 "${BASE_URL}/board" >/dev/null 2>&1; then
  BASE_URL="http://localhost:3010/api"
fi

echo "=== Ticket Validation: ${TICKET_ID} ==="
echo "Taskboard: ${BASE_URL}"
echo ""

TICKET_JSON=$(curl -s --max-time 5 "${BASE_URL}/tickets/${TICKET_ID}" 2>/dev/null || echo "")

if [ -z "${TICKET_JSON}" ] || echo "${TICKET_JSON}" | grep -q '"error"\|"not found"\|404'; then
  echo "ERROR: Could not fetch ticket '${TICKET_ID}' — check the ID and ensure taskboard is running."
  echo "  Start taskboard: taskboard start --port 3010"
  exit 0
fi

# Run validation in Python (more reliable string matching)
echo "${TICKET_JSON}" | python3 << 'PYEOF'
import json, sys, re

data = json.load(sys.stdin)

title = data.get("title", "")
description = data.get("description", "") or ""
priority = data.get("priority") or ""
labels = data.get("labels") or []
team = data.get("teamId") or data.get("team") or ""
subtasks = data.get("subtasks") or []
status = data.get("status", "?")

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"

def check(label, passed, detail=""):
    marker = PASS if passed else FAIL
    detail_str = f"  {detail}" if detail else ""
    print(f"  {label:<45} [{marker}]{detail_str}")

print(f"Title:       {title}")
print(f"Status:      {status}")
print(f"Priority:    {priority or '(not set)'}")
print(f"Labels:      {', '.join(labels) if labels else '(none)'}")
print(f"Team:        {team or '(not set)'}")
print(f"Subtasks:    {len(subtasks)}")
print("")
print("--- Validation Checks ---")

# 1. Title exists and is meaningful
check("Title present and meaningful",
      bool(title) and len(title) > 10,
      f"'{title[:60]}'" if title else "MISSING")

# 2. User story
has_user_story = bool(re.search(r'As an?\s+.+,\s*I want\s+.+\s+so that\s+.+', description, re.IGNORECASE))
check("User story (As a... I want... so that...)",
      has_user_story,
      "present" if has_user_story else "MISSING — add 'As a [persona], I want [goal] so that [benefit]'")

# 3. Description length beyond template
has_description = len(description.strip()) > 100
check("Description has technical context (>100 chars)",
      has_description,
      f"{len(description)} chars" if description else "EMPTY")

# 4. Given/When/Then acceptance criteria (at least 2 occurrences of "Given")
gwt_count = len(re.findall(r'\bGiven\b', description, re.IGNORECASE))
check("Acceptance Criteria (min 2 Given/When/Then scenarios)",
      gwt_count >= 2,
      f"{gwt_count} 'Given' scenarios found (need at least 2)")

# 5. Priority set
valid_priorities = {"urgent", "high", "medium", "low"}
check("Priority set",
      priority.lower() in valid_priorities if priority else False,
      f"'{priority}'" if priority else "MISSING — set to: urgent/high/medium/low")

# 6. Team assigned
check("Team assigned",
      bool(team),
      f"'{team}'" if team else "MISSING — set teamId to Engineering/PM/Leadership")

# 7. Labels set
check("Labels set",
      bool(labels),
      f"{labels}" if labels else "MISSING — add: bug/feature/refactor/test/docs")

# 8. Subtasks (at least 3 for complex work)
check("Subtasks defined (min 3 for complex work)",
      len(subtasks) >= 3,
      f"{len(subtasks)} subtask(s)" if subtasks else "0 subtasks — add implementation steps")

print("")

failures = []
if not has_user_story: failures.append("user story")
if not has_description: failures.append("description")
if gwt_count < 2: failures.append("acceptance criteria")
if not priority: failures.append("priority")
if not team: failures.append("team")

if failures:
    print(f"RESULT: FAIL — missing: {', '.join(failures)}")
    print("Fix these before moving ticket to in_progress.")
else:
    print("RESULT: PASS — ticket meets mandatory format.")
PYEOF

exit 0
