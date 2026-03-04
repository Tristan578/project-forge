#!/bin/bash
# ============================================================================
# on-session-start.sh — SessionStart hook (all AI tools)
# ============================================================================
# 1. Verify taskboard is installed
# 2. Auto-start taskboard if not running
# 3. Pull remote changes from GitHub Project
# 4. Display board status with prioritized work suggestions
# 5. Enforce planning-before-development workflow

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/taskboard-state.sh"

# ── Step 1: Check taskboard installation ──────────────────────────────────

if ! tb_check_installed; then
    cat <<'EOF'
╔══════════════════════════════════════════════════════════════╗
║  TASKBOARD NOT INSTALLED                                     ║
╠══════════════════════════════════════════════════════════════╣
║  The taskboard binary (tcarac/taskboard) is required.        ║
║                                                              ║
║  Install:                                                    ║
║    go install github.com/tcarac/taskboard@latest             ║
║                                                              ║
║  Or download the binary from:                                ║
║    https://github.com/tcarac/taskboard/releases              ║
║                                                              ║
║  Place it in one of:                                         ║
║    - ../taskboard/taskboard[.exe]  (sibling to project-forge)║
║    - ~/.local/bin/taskboard                                  ║
║    - /usr/local/bin/taskboard                                ║
║    - Anywhere on your PATH                                   ║
║                                                              ║
║  ALL work MUST be tracked. You CANNOT proceed without it.    ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo ""
    echo "MANDATORY: Install taskboard before doing any development work."
    echo "No code changes should be made without a tracked ticket."
    exit 0
fi

# ── Step 2: Auto-start taskboard if not running ───────────────────────────

if ! tb_api_available; then
    echo "[TASKBOARD] Server not running — starting automatically..."
    if tb_auto_start; then
        echo "[TASKBOARD] Server started on http://localhost:3010"
    else
        cat <<'EOF'
╔══════════════════════════════════════════════════════════════╗
║  TASKBOARD FAILED TO START                                   ║
╠══════════════════════════════════════════════════════════════╣
║  Could not auto-start the taskboard server.                  ║
║                                                              ║
║  Start manually:                                             ║
║    cd project-forge                                          ║
║    taskboard start --port 3010 --db .claude/taskboard.db     ║
║                                                              ║
║  ALL work MUST be tracked. You CANNOT proceed without it.    ║
╚══════════════════════════════════════════════════════════════╝
EOF
        exit 0
    fi
fi

# ── Step 3: Pull remote changes from GitHub Project ───────────────────────

echo ""
bash "$SCRIPT_DIR/sync-from-github.sh"

# ── Step 4: Board status + work suggestions ───────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " TASKBOARD STATUS (http://localhost:3010)"
echo "═══════════════════════════════════════════════════════════════"
tb_board_summary
echo ""

# Stale tickets
STALE=$(tb_check_stale)
if echo "$STALE" | grep -q "STALE_TICKETS_FOUND"; then
    echo "!! STALE IN-PROGRESS TICKETS:"
    echo "$STALE" | grep "^  "
    echo ""
    echo "ACTION REQUIRED: Update or complete stale tickets FIRST."
    echo ""
fi

# Active ticket
ACTIVE=$(tb_get_active_ticket_id)
if [ -n "$ACTIVE" ]; then
    echo "Active ticket: $ACTIVE"
    VALID=$(tb_validate_ticket "$ACTIVE")
    if echo "$VALID" | grep -q "VALIDATION_FAILED"; then
        echo "!! Active ticket has documentation issues:"
        echo "$VALID" | grep "^  "
    fi
    echo ""
fi

# Consistency issues
CONSISTENCY=$(tb_check_consistency)
if echo "$CONSISTENCY" | grep -q "CONSISTENCY_ISSUES_FOUND"; then
    echo "!! TICKET CONSISTENCY ISSUES (open tickets):"
    echo "$CONSISTENCY" | grep "^  "
    echo ""
fi

# Suggested work
tb_suggest_work
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo " WORKFLOW RULES (enforced for all contributors)"
echo "═══════════════════════════════════════════════════════════════"
cat <<'EOF'

  1. PLAN BEFORE CODE: Select or create a ticket BEFORE writing any code.
     Every ticket MUST have: user story, acceptance criteria, priority,
     team assignment, and subtasks (implementation plan).

  2. NO UNTRACKED WORK: Do not write, modify, or refactor code without
     an active ticket. If you discover new work during development,
     create a ticket for it first.

  3. PICK FROM THE BOARD: Review the suggestions above. Resume
     in-progress tickets before starting new ones. Pick the highest
     priority todo ticket if nothing is in progress.

  4. MOVE TICKETS: Move to in_progress when starting, done when complete.
     Toggle subtasks as you finish each step.

  5. SYNC IS AUTOMATIC: Changes push to GitHub Project after each
     response and pull at session start. All contributors see the
     same board.

EOF
echo "═══════════════════════════════════════════════════════════════"

exit 0
