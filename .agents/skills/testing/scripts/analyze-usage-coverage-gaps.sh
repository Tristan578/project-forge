#!/usr/bin/env bash
# analyze-usage-coverage-gaps.sh
#
# Identifies high-value tracked features that lack test coverage.
#
# Usage:
#   bash .claude/skills/testing/scripts/analyze-usage-coverage-gaps.sh
#   bash .claude/skills/testing/scripts/analyze-usage-coverage-gaps.sh --json
#
# Output:
#   A report listing which tracked events do NOT have corresponding tests in
#   the integration and handler test directories.
#
# How it works:
#   1. Reads the canonical list of tracked event names from events.ts
#   2. For each event, checks whether any test file mentions it by name
#   3. Reports coverage gaps with suggested test file locations and priority
#
# Phase 3 (Vercel custom events API):
#   Replace PRIORITY_DATA below with real data fetched from:
#   GET https://api.vercel.com/v1/web-analytics/events?projectId=<id>
#   That returns event_name + count sorted descending.

set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../web" && pwd)"
EVENTS_FILE="$WEB_DIR/src/lib/analytics/events.ts"
INTEGRATION_DIR="$WEB_DIR/src/__integration__"
HANDLER_TESTS_DIR="$WEB_DIR/src/lib/chat/handlers/__tests__"
STORE_TESTS_DIR="$WEB_DIR/src/stores/__tests__"
ANALYTICS_TESTS_DIR="$WEB_DIR/src/lib/analytics/__tests__"

JSON_MODE=false
if [[ "${1:-}" == "--json" ]]; then
  JSON_MODE=true
fi

# ---------------------------------------------------------------------------
# Step 1: Extract tracked event names from events.ts
# Lines like: track('event_name', ...) or track("event_name", ...)
# ---------------------------------------------------------------------------
extract_events() {
  grep -oE "track\(['\"][a-z_]+['\"]" "$EVENTS_FILE" \
    | grep -oE "[a-z_]+" \
    | grep -v "^track$" \
    | sort -u
}

TRACKED_EVENTS=$(extract_events)

# ---------------------------------------------------------------------------
# Step 2: Feature-to-test mapping
# Format: "event_name|priority|suggested_test_file|description"
# Priority: 100 = most critical, 0 = nice to have
# Replace static priorities with Vercel API data in Phase 3.
# ---------------------------------------------------------------------------
PRIORITY_DATA="command_dispatched|100|src/stores/__tests__/editorStore.test.ts|Engine command dispatch analytics tracking
editor_panel_opened|90|src/stores/__tests__/workspaceStore.test.ts|Panel open analytics tracking
ai_asset_generated|85|src/stores/__tests__/generationStore.test.ts|AI asset generation Vercel analytics
ai_chat_message_sent|80|src/lib/chat/handlers/__tests__/compoundHandlers.test.ts|AI chat message tracking
game_exported|75|src/lib/chat/handlers/__tests__/exportAsset2dHandlers.test.ts|Game export analytics
game_published|70|src/stores/__tests__/publishStore.test.ts|Game publish analytics
play_mode_started|65|src/lib/chat/handlers/__tests__/editModeHandlers.test.ts|Play mode start analytics
template_used|60|src/lib/chat/handlers/__tests__/sceneManagementHandlers.test.ts|Template usage tracking
first_entity_spawned|55|src/lib/chat/handlers/__tests__/entityHandlers.test.ts|First entity spawn tracking
first_scene_created|50|src/stores/__tests__/editorStore.test.ts|First scene creation tracking
signup_complete|45|src/stores/__tests__/userStore.test.ts|Signup completion analytics
tutorial_started|40|src/stores/__tests__/userStore.test.ts|Tutorial start tracking
tutorial_completed|35|src/stores/__tests__/userStore.test.ts|Tutorial completion tracking
byok_key_added|30|src/app/__tests__/byok.test.ts|BYOK key add analytics
feature_used|25|src/stores/__tests__/workspaceStore.test.ts|Generic feature usage tracking
project_created|20|src/stores/__tests__/editorStore.test.ts|Project creation tracking"

# ---------------------------------------------------------------------------
# Step 3: Check coverage for each event
# An event is "covered" if any test file in the test directories mentions it.
# ---------------------------------------------------------------------------
has_test_coverage() {
  local event="$1"
  local count
  count=$(grep -rl "\"${event}\"\|'${event}'" \
    "$ANALYTICS_TESTS_DIR" \
    "$INTEGRATION_DIR" \
    "$HANDLER_TESTS_DIR" \
    "$STORE_TESTS_DIR" \
    2>/dev/null | wc -l | tr -d ' ')
  [[ "$count" -gt 0 ]]
}

get_priority() {
  local event="$1"
  local line
  line=$(echo "$PRIORITY_DATA" | grep "^${event}|" || true)
  if [[ -n "$line" ]]; then
    echo "$line" | cut -d'|' -f2
  else
    echo "0"
  fi
}

get_suggested_file() {
  local event="$1"
  local line
  line=$(echo "$PRIORITY_DATA" | grep "^${event}|" || true)
  if [[ -n "$line" ]]; then
    echo "$line" | cut -d'|' -f3
  else
    echo "src/lib/analytics/__tests__/events.test.ts"
  fi
}

get_description() {
  local event="$1"
  local line
  line=$(echo "$PRIORITY_DATA" | grep "^${event}|" || true)
  if [[ -n "$line" ]]; then
    echo "$line" | cut -d'|' -f4
  else
    echo "No description"
  fi
}

# ---------------------------------------------------------------------------
# Step 4: Build covered/gap lists
# ---------------------------------------------------------------------------
covered_list=""
gap_list=""

while IFS= read -r event; do
  if has_test_coverage "$event"; then
    covered_list="${covered_list}${event}"$'\n'
  else
    priority=$(get_priority "$event")
    suggested=$(get_suggested_file "$event")
    desc=$(get_description "$event")
    gap_list="${gap_list}${priority}|${event}|${suggested}|${desc}"$'\n'
  fi
done <<< "$TRACKED_EVENTS"

# Sort gaps by priority descending (numeric); handle empty list safely
sorted_gaps=$(echo "$gap_list" | { grep -v '^$' || true; } | sort -t'|' -k1 -rn || true)

covered_count=$(echo "$covered_list" | grep -c '[a-z]' || true)
gap_count=$(echo "$sorted_gaps" | grep -c '[a-z]' || true)
total_events=$((covered_count + gap_count))

# ---------------------------------------------------------------------------
# Step 5: Output report
# ---------------------------------------------------------------------------
if $JSON_MODE; then
  echo "{"
  echo "  \"summary\": { \"total\": $total_events, \"covered\": $covered_count, \"gaps\": $gap_count },"
  echo "  \"covered\": ["
  first=true
  while IFS= read -r event; do
    [[ -z "$event" ]] && continue
    $first || echo -n ","
    first=false
    echo "    \"$event\""
  done <<< "$covered_list"
  echo "  ],"
  echo "  \"gaps\": ["
  first=true
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    priority=$(echo "$line" | cut -d'|' -f1)
    event=$(echo "$line" | cut -d'|' -f2)
    suggested=$(echo "$line" | cut -d'|' -f3)
    desc=$(echo "$line" | cut -d'|' -f4)
    $first || echo -n ","
    first=false
    echo "    { \"event\": \"$event\", \"priority\": $priority, \"suggestedTestFile\": \"$suggested\", \"description\": \"$desc\" }"
  done <<< "$sorted_gaps"
  echo "  ]"
  echo "}"
else
  echo ""
  echo "SpawnForge Usage Coverage Gap Analysis"
  echo "======================================"
  echo "Total tracked events : $total_events"
  echo "Covered              : $covered_count"
  echo "Gaps                 : $gap_count"
  echo ""

  if [[ $gap_count -eq 0 ]]; then
    echo "All tracked events have test coverage."
  else
    echo "Coverage gaps (sorted by priority — highest first):"
    echo ""
    printf "  %-38s  %6s  %s\n" "Event Name" "Pri." "Suggested Test File"
    printf "  %-38s  %6s  %s\n" "----------" "----" "-------------------"
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      priority=$(echo "$line" | cut -d'|' -f1)
      event=$(echo "$line" | cut -d'|' -f2)
      suggested=$(echo "$line" | cut -d'|' -f3)
      desc=$(echo "$line" | cut -d'|' -f4)
      printf "  %-38s  %6s  %s\n" "$event" "$priority" "$suggested"
      printf "  %-38s  %6s  -> %s\n" "" "" "$desc"
    done <<< "$sorted_gaps"
  fi

  echo ""
  if [[ $covered_count -gt 0 ]]; then
    echo "Covered events:"
    while IFS= read -r event; do
      [[ -z "$event" ]] && continue
      echo "  $event"
    done <<< "$covered_list"
    echo ""
  fi

  echo "Note: Priority weights above are static placeholders."
  echo "In Phase 3, replace with real usage data from the Vercel Analytics API:"
  echo "  GET https://api.vercel.com/v1/web-analytics/events?projectId=<id>"
  echo "  Map event_name -> usage count, higher count = higher priority."
  echo ""
fi
