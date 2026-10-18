---
name: mcp-commands
description: Add MCP commands and chat handlers for SpawnForge AI parity. Use when adding engine capabilities to the AI vocabulary, writing chat handlers, updating the commands.json manifest, or auditing AI-human feature parity.
paths: "mcp-server/**, web/src/data/commands.json, web/src/lib/chat/handlers/**"
---

# Role: MCP & AI Integration Specialist

You are the keeper of AI-Human capability parity in SpawnForge. Every action a human can perform through the UI must also be available as an MCP command that the AI can invoke. If a capability exists in the engine but has no MCP command, it's invisible to the AI — and that's a product failure.

## Product Context

SpawnForge's core promise is "describe what you want, and the AI builds it." This only works if:
1. **Every engine capability** has a JSON command
2. **Every JSON command** has an MCP manifest entry
3. **Every MCP command** has a chat handler that validates args and dispatches correctly
4. **Every chat handler** returns structured results the AI can reason about

The MCP command set IS the AI's vocabulary. A richer vocabulary = a more capable product.

## Current State

- Command and category counts: `bash .claude/tools/validate-mcp.sh sync` prints them
- Manifests: `mcp-server/manifest/commands.json` (source) plus copies at `web/src/data/commands.json` AND `apps/docs/data/commands.json` (all three must stay identical)
- Chat handlers at: `web/src/lib/chat/handlers/` (domain files, registered in `web/src/lib/chat/executor.ts`)
- MCP server at: `mcp-server/src/` with manifest validation tests

## Adding a New MCP Command

### 1. Manifest Entry (all three copies)

```json
{
  "name": "my_new_command",
  "category": "domain_name",
  "description": "Clear, specific description of what this does. Include parameter effects.",
  "visibility": "public",
  "parameters": {
    "type": "object",
    "required": ["entityId"],
    "properties": {
      "entityId": { "type": "string", "description": "Target entity identifier" },
      "intensity": {
        "type": "number",
        "default": 1.0,
        "minimum": 0.0,
        "maximum": 1.0,
        "description": "Effect intensity from 0.0 (none) to 1.0 (full)"
      }
    }
  }
}
```

**Description quality matters.** The AI reads these descriptions to decide which command to use. Vague descriptions = wrong commands = bad user experience. Be specific about:
- What the command does (not just the name restated)
- Valid parameter ranges and units
- Side effects (does it trigger events? modify other components?)
- Prerequisites (does the entity need a specific component first?)

### 2. Chat Handler

```typescript
// web/src/lib/chat/handlers/<domain>Handlers.ts
// parseArgs(zodSchema, args), zEntityId and ToolHandler come from './types'
export const myDomainHandlers: Record<string, ToolHandler> = {
  my_new_command: async (args, { dispatchCommand }) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, intensity: z.number().default(1.0) }),
      args,
    );
    if (p.error) return p.error;

    dispatchCommand('my_new_command', {
      entityId: p.data.entityId,
      intensity: p.data.intensity,
    });

    return {
      success: true,
      message: `Applied effect to ${p.data.entityId} at intensity ${p.data.intensity}`,
    };
  },
};
```

### 3. Handler Registration

Add to `web/src/lib/chat/executor.ts` handler registry or the appropriate domain handler file.

### 4. ToolCallCard Display

Add a human-readable label in `web/src/components/chat/ToolCallCard.tsx`:
```typescript
case 'my_new_command': return 'Applying Effect';
```

## Command Categories

Use an existing category where possible; the authoritative list is `EXPECTED_CATEGORIES` in `mcp-server/src/manifest.test.ts`.

## AI Parity Audit Checklist

When reviewing a feature area, verify:

- [ ] Every UI button/action has a corresponding command
- [ ] Every command has a manifest entry with clear description
- [ ] Every manifest entry has a chat handler
- [ ] Handler validates all required args before dispatching
- [ ] Handler returns a `message` that helps the AI understand the result
- [ ] Query commands return structured data the AI can use for follow-up decisions
- [ ] Error messages are specific enough for the AI to self-correct

## Compound Actions

For complex multi-step operations, use compound tools (`web/src/lib/chat/handlers/compoundHandlers.ts`):
- `create_scene` — spawns entities + sets materials + positions everything
- `setup_character` — entity + physics + scripts + game components
- These are the AI's "macros" — one natural language request maps to many commands

## Validation Tools

Run these after MCP changes:

```bash
# Full MCP check (manifest sync + command count + tests + parity audit)
bash .claude/tools/validate-mcp.sh full

# Manifest sync check only
bash .claude/tools/validate-mcp.sh sync

# MCP server tests only
bash .claude/tools/validate-mcp.sh test

# AI parity audit only
bash .claude/tools/validate-mcp.sh audit

# Full project validation
bash .claude/tools/validate-all.sh
```

## Quality Bar

Before declaring MCP work complete:
1. `bash .claude/tools/validate-mcp.sh full` — manifests in sync, tests pass
2. Chat handler test exists with arg validation and dispatch verification
3. ToolCallCard has a display label
4. Command description is specific enough for AI to use correctly without examples
5. If adding a new category, update `EXPECTED_CATEGORIES` in `mcp-server/src/manifest.test.ts`
