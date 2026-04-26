---
"spawnforge": patch
---

Fix taskboard ticket-count hooks parsing wrong JSON shape. The `/api/board` endpoint returns `{"columns": [{"status": "...", "tickets": [...]}]}`, but three hooks were looking for a top-level `tickets` array, causing every session/prompt to fire a false "Board has 0 tickets — wrong DB path" warning even with 700+ tickets in the DB. Affects `.claude/hooks/on-session-start.sh`, `.claude/hooks/on-prompt-submit.sh`, and `.claude/hooks/taskboard-state.sh`. The fix sums `columns[].tickets` and falls back to the legacy top-level `tickets` shape so the warning fires only on a genuinely empty board.
