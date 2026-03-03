---
description: Use this workflow when the user requests a new feature, a complex refactor, or asks "how should we build X?". Enforces a specification-driven approach.
---

# Architect Flow

Spec-first workflow for new features and complex refactors.

## Steps

1. **Understand the request**: Gather requirements from the user. Ask clarifying questions.

2. **Check existing architecture**: Review relevant files in `.windsurf/rules/` and the file map to understand current patterns.

3. **Draft a spec**: Create a detailed specification covering:
   - Problem statement
   - Proposed solution
   - Files to modify (reference the file map)
   - New components/commands needed (follow the New Component Checklist in CLAUDE.md)
   - Test plan
   - Risk assessment

4. **Get approval**: Present the spec to the user before writing any implementation code.

5. **Implement**: Follow the spec. Run tests after each phase.

6. **Validate**: Run the full test suite (`/test` workflow) and architecture validator.

## New Component Checklist

When adding a new ECS component, update:

### Rust Engine (4 required files)
1. `engine/src/core/<component>.rs` — Component struct
2. `engine/src/core/pending/<domain>.rs` — Request structs + queue
3. `engine/src/core/commands/<domain>.rs` — Dispatch + handler
4. `engine/src/bridge/<domain>.rs` — Apply system + selection emit

### Web Layer (4 required files)
5. `web/src/stores/slices/<domain>Slice.ts` — State + actions
6. `web/src/hooks/events/<domain>Events.ts` — Event handler
7. `web/src/lib/chat/handlers/<domain>Handlers.ts` — Tool call handler
8. `web/src/components/editor/<Inspector>.tsx` — Inspector panel

### Integration (5 required files)
9. `web/src/components/editor/InspectorPanel.tsx` — Import + render
10. `web/src/components/chat/ToolCallCard.tsx` — Display labels
11. `mcp-server/manifest/commands.json` — MCP commands
12. `web/src/data/commands.json` — Copy of above (keep in sync)
13. Tests for all new code
