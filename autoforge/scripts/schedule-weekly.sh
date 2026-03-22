#!/bin/bash
# =============================================================================
# AutoForge weekly validation for macOS/Linux.
# Runs every Sunday — tests with real provider APIs to catch overfitting.
#
# The nightly loop optimizes scene composition using heuristics + vision
# scoring. This weekly run validates that improvements generalize to real
# provider outputs (Meshy 3D, ElevenLabs audio, Suno music).
#
# Usage:
#   # Register (Sundays at 2 AM):
#   bash autoforge/scripts/schedule-weekly.sh --register
#
#   # Run manually:
#   bash autoforge/scripts/schedule-weekly.sh
#
#   # Unregister:
#   bash autoforge/scripts/schedule-weekly.sh --unregister
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || realpath "$SCRIPT_DIR/../..")"

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
ENV_FILE="$PROJECT_ROOT/autoforge/.env"
if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -z "$line" ] && continue
        [[ "$line" =~ ^# ]] && continue
        key="${line%%=*}"
        val="${line#*=}"
        if [ -z "${!key:-}" ]; then
            export "$key=$val"
        fi
    done < "$ENV_FILE"
    echo "Loaded .env from $ENV_FILE"
else
    echo "WARNING: No .env file found at $ENV_FILE"
fi

# ---------------------------------------------------------------------------
# Register / Unregister cron
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--register" ]; then
    CRON_LINE="0 2 * * 0 cd $PROJECT_ROOT && bash autoforge/scripts/schedule-weekly.sh >> autoforge/results/cron-weekly.log 2>&1"
    (crontab -l 2>/dev/null | grep -v "schedule-weekly.sh"; echo "$CRON_LINE") | crontab -
    echo "Registered cron job: Sundays at 2 AM"
    echo "Project root: $PROJECT_ROOT"
    exit 0
fi

if [ "${1:-}" = "--unregister" ]; then
    crontab -l 2>/dev/null | grep -v "schedule-weekly.sh" | crontab -
    echo "Unregistered cron job"
    exit 0
fi

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
LOG_DIR="$PROJECT_ROOT/autoforge/results"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/weekly-$(date +%Y-%m-%d).log"

log() { echo "$(date +%H:%M:%S) $1" | tee -a "$LOG_FILE"; }

log "=== AutoForge Weekly Validation ==="
log "Project root: $PROJECT_ROOT"

# Check provider keys
HAS_MESHY=$( [ -n "${MESHY_API_KEY:-}" ] && echo "true" || echo "false" )
HAS_ELEVENLABS=$( [ -n "${ELEVENLABS_API_KEY:-}" ] && echo "true" || echo "false" )
HAS_SUNO=$( [ -n "${SUNO_API_KEY:-}" ] && echo "true" || echo "false" )
log "Providers: Meshy=$HAS_MESHY, ElevenLabs=$HAS_ELEVENLABS, Suno=$HAS_SUNO"

if [ "$HAS_MESHY" = "false" ] && [ "$HAS_ELEVENLABS" = "false" ] && [ "$HAS_SUNO" = "false" ]; then
    log "WARNING: No provider API keys set. Running vision-only validation."
    log "  Set MESHY_API_KEY, ELEVENLABS_API_KEY, SUNO_API_KEY for full validation."
fi

cd "$PROJECT_ROOT"

# Pull latest main
log "Pulling latest main..."
git checkout main
git pull origin main

# Create validation branch
BRANCH_NAME="autoforge/weekly-$(date +%Y-%m-%d)"
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
log "On branch: $BRANCH_NAME"

# Install deps
log "Checking dependencies..."
(cd web && [ -d node_modules ] || npm install)
(cd autoforge && [ -d node_modules ] || npm install)

# Start dev server
log "Starting dev server..."
(cd web && npm run dev &)
DEV_PID=$!
sleep "${DEV_SERVER_WAIT:-30}"

# Configure AI Gateway routing
if [ -n "${AI_GATEWAY_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    export ANTHROPIC_BASE_URL="${AI_GATEWAY_URL:-https://ai-gateway.vercel.sh}"
    export ANTHROPIC_AUTH_TOKEN="$AI_GATEWAY_API_KEY"
    export ANTHROPIC_API_KEY=""
    log "Routing Claude Code through AI Gateway"
fi

# Run validation via Claude Code (-p = non-interactive print mode)
log "Starting weekly validation..."

DATE_STR="$(date +%Y-%m-%d)"

claude -p "You are running the AutoForge WEEKLY VALIDATION for SpawnForge.
This is different from the nightly experiment loop — you are NOT making changes.
You are TESTING the current state of the compound handlers against real providers.

Your task:
1. Run the full evaluation suite with vision scoring:
   cd autoforge && npx tsx scripts/run-eval.ts --vision

2. Record the scores in autoforge/results/weekly-validation.json with this format:
   {
     \"date\": \"$DATE_STR\",
     \"scores\": { <per-prompt scores from the eval> },
     \"totalScore\": <number>,
     \"providers\": { \"meshy\": $HAS_MESHY, \"elevenlabs\": $HAS_ELEVENLABS, \"suno\": $HAS_SUNO },
     \"comparison\": {
       \"vs_nightly_baseline\": <difference from last nightly loop-state.json best score>,
       \"drift_detected\": <true if weekly score is >10% lower than nightly>
     }
   }

3. Read autoforge/results/loop-state.json (if exists) to get the latest nightly
   baseline score for comparison.

4. If drift_detected is true, add a note to autoforge/program.md under
   '## Weekly Validation Flags' explaining which prompts scored lower and why.

5. Generate a summary of the validation results." 2>&1 | tee -a "$LOG_FILE"

# Push results
log "Pushing validation results..."
git add autoforge/results/ autoforge/program.md
git commit -m "autoforge: weekly validation $(date +%Y-%m-%d)" --allow-empty
git push -u origin "$BRANCH_NAME"

# Create PR
log "Creating validation PR..."
gh pr create \
    --title "autoforge: weekly validation $(date +%Y-%m-%d)" \
    --body "## AutoForge Weekly Validation

Validation run against current main with real provider APIs.
See autoforge/results/weekly-validation.json for detailed scores.

Generated by AutoForge weekly scheduler." \
    --base main \
    --head "$BRANCH_NAME"

# Cleanup
log "Stopping dev server..."
kill "$DEV_PID" 2>/dev/null || true

log "=== AutoForge Weekly Validation Complete ==="
