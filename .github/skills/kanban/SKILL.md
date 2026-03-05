---
name: kanban
description: "Taskboard management. View, create, update, and manage tickets on the project taskboard via API at localhost:3010."
user-invokable: true
---

# Taskboard Management

API: `http://localhost:3010/api` | Project ID: `01KJEE8R1XXFF0CZT1WCSTGRDP`

## Key Endpoints
- `GET /api/board` — Full Kanban view
- `POST /api/tickets` — Create (requires projectId, title)
- `POST /api/tickets/{id}/move` — Move status (`{"status": "done"}`)
- `PUT /api/tickets/{id}` — Update fields

## Ticket Template
Every ticket needs: user story ("As a..."), description, acceptance criteria (Given/When/Then), priority (urgent/high/medium/low), team ID, and 3+ subtasks.

## Teams
- Engineering: `01KJFNHZC49XG9KXRYTMYEEDTS`
- PM: `01KJFNJC02QK6F5NSDND7NH5MS`
- Leadership: `01KJFNK35JVPQJESS3RZM0F5HP`
