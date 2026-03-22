#!/bin/bash
# =============================================================================
# AutoForge nightly scheduler for macOS/Linux.
#
# Usage:
#   # Register cron job (Mon-Sat at 11 PM):
#   bash autoforge/scripts/schedule-nightly.sh --register
#
#   # Run manually:
#   bash autoforge/scripts/schedule-nightly.sh
#
#   # Unregister cron job:
#   bash autoforge/scripts/schedule-nightly.sh --unregister
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || realpath "$SCRIPT_DIR/../..")"

# ---------------------------------------------------------------------------
# Load .env into environment (same vars as autoforge.config.ts)
# ---------------------------------------------------------------------------
ENV_FILE="$PROJECT_ROOT/autoforge/.env"
if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -z "$line" ] && continue
        [[ "$line" =~ ^# ]] && continue
        key="${line%%=*}"
        val="${line#*=}"
        # Strip surrounding quotes
        val="${val#\"}" ; val="${val%\"}"
        val="${val#\'}" ; val="${val%\'}"
        # Only set if not already present (env vars take precedence)
        if [ -z "${!key:-}" ]; then
            export "$key=$val"
        fi
    done < "$ENV_FILE"
    echo "Loaded .env from $ENV_FILE"
else
    echo "WARNING: No .env file found at $ENV_FILE — using defaults"
    echo "  Copy .env.example to .env and configure your API keys"
fi

# ---------------------------------------------------------------------------
# Register / Unregister cron (Mon-Sat only: days 1-6)
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--register" ]; then
    CRON_LINE="0 23 * * 1-6 cd $PROJECT_ROOT && bash autoforge/scripts/schedule-nightly.sh >> autoforge/results/cron.log 2>&1"
    (crontab -l 2>/dev/null | grep -v "schedule-nightly.sh"; echo "$CRON_LINE") | crontab -
    echo "Registered cron job: Mon-Sat at 11 PM"
    echo "Project root: $PROJECT_ROOT"
    exit 0
fi

if [ "${1:-}" = "--unregister" ]; then
    crontab -l 2>/dev/null | grep -v "schedule-nightly.sh" | crontab -
    echo "Unregistered cron job"
    exit 0
fi

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
LOG_DIR="$PROJECT_ROOT/autoforge/results"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/nightly-$(date +%Y-%m-%d).log"

log() { echo "$(date +%H:%M:%S) $1" | tee -a "$LOG_FILE"; }

log "=== AutoForge Nightly Run ==="
log "Project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# Pull latest main
log "Pulling latest main..."
git checkout main
git pull origin main

# Create experiment branch
BRANCH_NAME="autoforge/nightly-$(date +%Y-%m-%d)"
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
log "On branch: $BRANCH_NAME"

# Install deps if needed
log "Checking dependencies..."
(cd web && [ -d node_modules ] || npm install)
(cd autoforge && [ -d node_modules ] || npm install)

# Start dev server in background
log "Starting dev server..."
(cd web && npm run dev &)
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT
sleep "${DEV_SERVER_WAIT:-30}"

# Configure AI Gateway routing for Claude Code (if key is set)
if [ -n "${AI_GATEWAY_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    export ANTHROPIC_BASE_URL="${AI_GATEWAY_URL:-https://ai-gateway.vercel.sh}"
    export ANTHROPIC_API_KEY="$AI_GATEWAY_API_KEY"
    log "Routing Claude Code through AI Gateway"
else
    log "Using Claude Code with default auth (Max subscription or ANTHROPIC_API_KEY)"
fi

# Run via Claude Code (-p = non-interactive print mode)
log "Starting AutoForge experiment loop..."
MAX_EXP="${MAX_EXPERIMENTS:-20}"
MAX_HRS="${MAX_HOURS:-6}"

claude -p "You are running the AutoForge nightly experiment loop for SpawnForge.

Read autoforge/program.md for your directives.
Read autoforge/results/loop-state.json for prior state (if exists).

Your task:
1. Run baseline evaluation: cd autoforge && npx tsx scripts/run-eval.ts --vision
2. Record the baseline score
3. For each experiment (up to $MAX_EXP):
   a. Form a hypothesis based on program.md directives
   b. Make ONE change to the editable surface files
   c. Verify: cd web && npx tsc --noEmit && npx eslint --max-warnings 0
   d. Run evaluation: cd autoforge && npx tsx scripts/run-eval.ts --vision
   e. If score improved: git add -A && git commit with 'autoforge: <hypothesis>'
   f. If score did not improve: git checkout -- web/src/lib/chat/handlers/ web/src/lib/chat/context.ts
   g. Update program.md 'Successful Patterns' or 'Anti-Patterns' sections
4. After all experiments, generate a summary and push to the branch.

Stop after $MAX_EXP experiments or $MAX_HRS hours." 2>&1 | tee -a "$LOG_FILE"

# Push results
log "Pushing results..."
git add autoforge/results/ autoforge/program.md
git commit -m "autoforge: nightly results $(date +%Y-%m-%d)" --allow-empty
git push -u origin "$BRANCH_NAME"

# Create PR if improvements exist
KEPT_COUNT=$(git log main.."$BRANCH_NAME" --oneline | grep -c "autoforge:" || true)
if [ "$KEPT_COUNT" -gt 0 ]; then
    log "Creating PR with $KEPT_COUNT improvements..."
    gh pr create \
        --title "autoforge: nightly improvements $(date +%Y-%m-%d)" \
        --body "## AutoForge Nightly Run

$KEPT_COUNT experiments kept. See autoforge/results/ for details.

Generated by AutoForge nightly loop." \
        --base main \
        --head "$BRANCH_NAME"
fi

# Cleanup
log "Stopping dev server..."
kill "$DEV_PID" 2>/dev/null || true

log "=== AutoForge Nightly Complete ==="
