#!/usr/bin/env bash
# board-summary.sh — Fetch and print a summary of the taskboard
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/board-summary.sh"
# Exit 0 always (informational)

set -uo pipefail

# Try Portless URL first, fall back to direct port
BASE_URL="http://taskboard.localhost:1355/api"
if ! curl -s --max-time 2 "${BASE_URL}/board" >/dev/null 2>&1; then
  BASE_URL="http://localhost:3010/api"
fi

echo "=== Taskboard Summary ==="
echo "URL: ${BASE_URL}"
echo ""

BOARD_JSON=$(curl -s --max-time 5 "${BASE_URL}/board" 2>/dev/null || echo "")

if [ -z "${BOARD_JSON}" ] || echo "${BOARD_JSON}" | grep -q '"error"'; then
  echo "ERROR: Could not reach taskboard."
  echo "  Start with: taskboard start --port 3010  (NO --db flag)"
  echo "  Verify:     curl -s ${BASE_URL}/board | python3 -c \"import json,sys; d=json.load(sys.stdin); print(len(d.get('tickets',[])), 'tickets')\""
  exit 0
fi

echo "${BOARD_JSON}" | python3 << 'PYEOF'
import json, sys
from datetime import datetime, timezone

data = json.load(sys.stdin)

# Handle both response shapes: { tickets: [...] } or { columns: [...] }
tickets = []
if "tickets" in data:
    tickets = data["tickets"]
elif "columns" in data:
    for col in data["columns"]:
        tickets.extend(col.get("tickets", []))

if not tickets:
    print("Board is empty (0 tickets).")
    print("If you expected tickets, the taskboard may be using the wrong database.")
    print("Never use --db flag; the OS default path is the source of truth.")
    sys.exit(0)

# Count by status
status_counts = {}
for t in tickets:
    s = t.get("status", "unknown")
    status_counts[s] = status_counts.get(s, 0) + 1

print(f"Total tickets: {len(tickets)}")
print("")

# Status summary
print("--- By Status ---")
for status in ["todo", "in_progress", "done"]:
    count = status_counts.get(status, 0)
    bar = "#" * min(count, 40)
    print(f"  {status:<15} {count:>4}  {bar}")

other_statuses = {k: v for k, v in status_counts.items() if k not in ("todo", "in_progress", "done")}
for status, count in sorted(other_statuses.items()):
    print(f"  {status:<15} {count:>4}")

print("")

# In-progress tickets (most actionable)
in_progress = [t for t in tickets if t.get("status") == "in_progress"]
if in_progress:
    print(f"--- In Progress ({len(in_progress)}) ---")
    for t in sorted(in_progress, key=lambda x: x.get("updatedAt", ""), reverse=True):
        tid = t.get("id", "?")[:12]
        title = t.get("title", "?")[:55]
        priority = t.get("priority", "?")
        updated = (t.get("updatedAt") or "?")[:16].replace("T", " ")
        subtasks = t.get("subtasks") or []
        done_subs = sum(1 for s in subtasks if s.get("completed"))
        sub_str = f"{done_subs}/{len(subtasks)} subtasks" if subtasks else "no subtasks"
        print(f"  [{priority:<6}] {title:<55} ({sub_str})")
        print(f"           id={tid}  updated={updated}")
    print("")

# Recently completed (last 5)
done_tickets = [t for t in tickets if t.get("status") == "done"]
done_tickets.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
if done_tickets:
    print(f"--- Recently Completed (last 5 of {len(done_tickets)}) ---")
    for t in done_tickets[:5]:
        title = t.get("title", "?")[:60]
        updated = (t.get("updatedAt") or "?")[:16].replace("T", " ")
        print(f"  {title:<60} {updated}")
    print("")

# High-priority todo tickets
urgent_todo = [t for t in tickets if t.get("status") == "todo" and t.get("priority") in ("urgent", "high")]
if urgent_todo:
    print(f"--- High Priority Todo ({len(urgent_todo)}) ---")
    for t in sorted(urgent_todo, key=lambda x: ("urgent", "high").index(x.get("priority", "high")) if x.get("priority") in ("urgent", "high") else 99):
        title = t.get("title", "?")[:60]
        priority = t.get("priority", "?")
        tid = t.get("id", "?")[:12]
        print(f"  [{priority:<6}] {title:<60}")
    print("")

# Staleness warning (in_progress > 4 hours without update)
now = datetime.now(timezone.utc)
stale = []
for t in in_progress:
    updated_str = t.get("updatedAt")
    if updated_str:
        try:
            updated_dt = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
            age_hours = (now - updated_dt).total_seconds() / 3600
            if age_hours > 4:
                stale.append((t, age_hours))
        except (ValueError, AttributeError):
            pass

if stale:
    print(f"--- Staleness Warnings ---")
    for t, hours in stale:
        title = t.get("title", "?")[:55]
        print(f"  STALE ({hours:.1f}h): {title}")
    print("  Stale in_progress tickets should be completed or updated.")
    print("")
PYEOF

exit 0
