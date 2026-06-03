---
name: kanban
description: "Taskboard management. View, create, update, and manage tickets on the project taskboard via API at localhost:3010."
user-invokable: true
---

# Taskboard Management

API: `http://localhost:3010/api` | Project ID: `01KMM9ZA6SBZ7RKJZJTZS9VR4R`

## Key Endpoints
- `GET /api/board` — Full Kanban view
- `POST /api/tickets` — Create (requires projectId, title)
- `POST /api/tickets/{id}/move` — Move status (`{"status": "done"}`)
- `PUT /api/tickets/{id}` — Update fields

## Ticket Template
Every ticket needs: user story ("As a..."), description, acceptance criteria (Given/When/Then), priority (urgent/high/medium/low), team ID, and 3+ subtasks.

## Teams
- Engineering: `01KMR5E36TP59PRQA8GQEWJVM1`
- PM: `01KMR5E3852BWXAZ219W47CSKS`
