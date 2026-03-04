---
name: kanban
description: "Taskboard management skill. View, create, update, and manage tickets on the project taskboard. Enforces standard ticket format with user stories and acceptance criteria."
user-invokable: true
---

# Taskboard Management Protocol

Manage project work via the taskboard API at `http://localhost:3010`.

**Project:** SpawnForge (prefix: PF, ID: `01KJEE8R1XXFF0CZT1WCSTGRDP`)

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/board?projectId=...` | View full Kanban board |
| GET | `/api/tickets?project=...&status=...` | List tickets with filters |
| GET | `/api/tickets/{id}` | Get ticket details |
| POST | `/api/tickets` | Create ticket (requires projectId, title) |
| PUT | `/api/tickets/{id}` | Update ticket fields |
| POST | `/api/tickets/{id}/move` | Move ticket (body: `{"status": "done"}`) |
| DELETE | `/api/tickets/{id}` | Delete ticket |
| POST | `/api/tickets/{id}/subtasks` | Add subtask (body: `{"title": "..."}`) |
| POST | `/api/subtasks/{id}/toggle` | Toggle subtask completion |

## Mandatory Ticket Template

Every ticket description MUST include:

```
**User Story:**
As a [persona], I want [specific goal] so that [measurable benefit].

**Description:**
[Technical context, affected files, scope boundaries]

**Acceptance Criteria:**
- Given [precondition], When [action], Then [expected result]
```

## Required Fields
- **Priority**: urgent, high, medium, low
- **Team**: Engineering (`01KJFNHZC49XG9KXRYTMYEEDTS`), PM (`01KJFNJC02QK6F5NSDND7NH5MS`), or Leadership (`01KJFNK35JVPQJESS3RZM0F5HP`)
- **Subtasks**: At least 3 implementation steps before work begins

## Workflow
1. Check board state before starting work
2. Pick or create a ticket
3. Move to `in_progress`
4. Toggle subtasks as you complete them
5. Move to `done` when all acceptance criteria met
