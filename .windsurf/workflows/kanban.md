---
description: Taskboard management workflow. View, create, update, and manage tickets on the project taskboard.
---

# Taskboard / Kanban

The taskboard is the single source of truth for all project work. It uses an MCP server connected to Claude Code at `http://localhost:3010/api` (Project ID: `01KK974VMNC16ZAW7MW1NH3T3M`).

## Ticket Format

Every ticket MUST have:
- **Title**: Concise imperative action
- **User Story**: `As a [persona], I want [goal] so that [benefit]`
- **Description**: Technical context, affected files, root cause
- **Acceptance Criteria**: Given/When/Then format
- **Priority**: urgent, high, medium, low
- **Labels**: bug, feature, refactor, test, docs

## Workflow

1. **Before starting work:** Check the board, pick or create a ticket
2. **During work:** Move ticket to `in_progress`
3. **After completion:** Verify acceptance criteria, move to `done`
4. **Discovering new work:** Create a ticket FIRST, then do the work
