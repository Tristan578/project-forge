# Taskboard Management

Manage project work via the taskboard REST API at http://localhost:3010/api.

## Quick Reference

```bash
# View the full board
curl -s http://localhost:3010/api/board | python3 -m json.tool

# List tickets (optionally filter by status)
curl -s "http://localhost:3010/api/tickets?project=01KK974VMNC16ZAW7MW1NH3T3M" | python3 -m json.tool
curl -s "http://localhost:3010/api/tickets?project=01KK974VMNC16ZAW7MW1NH3T3M&status=todo" | python3 -m json.tool

# Get a single ticket
curl -s http://localhost:3010/api/tickets/<TICKET_ID> | python3 -m json.tool

# Create a ticket (MUST follow template — see AGENTS.md)
curl -s -X POST http://localhost:3010/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix X in Y",
    "description": "**User Story:**\nAs a developer, I want ... so that ...\n\n**Description:**\n...\n\n**Acceptance Criteria:**\n- Given ..., When ..., Then ...\n- Given ..., When ..., Then ...\n- Given ..., When ..., Then ...",
    "priority": "high",
    "projectId": "01KK974VMNC16ZAW7MW1NH3T3M",
    "teamId": "01KK9751NZ4HM7VQM0AQ5WGME3"
  }'

# Move ticket to in_progress
curl -s -X POST http://localhost:3010/api/tickets/<TICKET_ID>/move \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'

# Move ticket to done
curl -s -X POST http://localhost:3010/api/tickets/<TICKET_ID>/move \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'

# Update ticket fields
curl -s -X PUT http://localhost:3010/api/tickets/<TICKET_ID> \
  -H "Content-Type: application/json" \
  -d '{"description": "updated description", "priority": "high"}'

# Create subtasks
curl -s -X POST http://localhost:3010/api/tickets/<TICKET_ID>/subtasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Step 1: ..."}'

# Toggle subtask completion
curl -s -X PUT http://localhost:3010/api/tickets/<TICKET_ID>/subtasks/<SUBTASK_ID> \
  -H "Content-Type: application/json" \
  -d '{"completed": true}'

# Validate a ticket
cd project-forge && bash -c 'source .claude/hooks/taskboard-state.sh && tb_validate_ticket <TICKET_ID>'
```

## Validation Rules

1. **User Story** — Must match regex `As an?\s+.+,\s+I want\s+.+\s+so that\s+.+` (case-insensitive)
2. **Description** — Technical context (at least 20 chars beyond user story + AC sections)
3. **Acceptance Criteria** — Given/When/Then format, **minimum 3 scenarios** (happy/edge/negative)
4. **Priority** — Must be set: `urgent`, `high`, `medium`, or `low`
5. **Team** — Must be assigned: Engineering (`01KK9751NZ4HM7VQM0AQ5WGME3`), PM (`01KK9751P7GKQYG9TZ96XXQCFN`), or Leadership (`01KK9751PD79RCWY462CYQ06CW`)
6. **Subtasks** — At least 3 implementation steps before work begins

## Workflow

1. Run `get board` to see current state
2. Pick an existing `todo` ticket or create a new one
3. Validate the ticket (all required fields present)
4. Move to `in_progress`
5. Toggle subtasks as you complete them
6. Move to `done` when all acceptance criteria are verified
