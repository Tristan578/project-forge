---
name: kanban
description: "Taskboard management. View, create, update, and manage tickets on the project taskboard via API at localhost:3010."
user-invokable: true
---

# Taskboard Management

API: `http://localhost:3010/api` | Project ID: `01KK974VMNC16ZAW7MW1NH3T3M`

## Key Endpoints
- `GET /api/board` — Full Kanban view
- `POST /api/tickets` — Create (requires projectId, title)
- `POST /api/tickets/{id}/move` — Move status (`{"status": "done"}`)
- `PUT /api/tickets/{id}` — Update fields

## Ticket Template
Every ticket needs: user story ("As a..."), description, acceptance criteria (Given/When/Then), priority (urgent/high/medium/low), team ID, and 3+ subtasks.

## Teams
- Engineering: `01KK9751NZ4HM7VQM0AQ5WGME3`
- PM: `01KK9751P7GKQYG9TZ96XXQCFN`
- Leadership: `01KK9751PD79RCWY462CYQ06CW`
