# Handler Registry Reference

How MCP command handlers are registered and dispatched in `web/src/lib/chat/`.

## Architecture

```
useChat (AI SDK)
  → /api/chat route handler
    → executor.ts: executeToolCall(toolName, input, store)
      → handler registry lookup
        → domain handler file (e.g., materialHandlers.ts)
          → parseArgs() validation
            → dispatchCommand() → WASM handle_command()
```

## executor.ts — Handler Registry

`web/src/lib/chat/executor.ts` builds `handlerRegistry` by spreading every domain map
listed in `HANDLER_DOMAIN_SOURCES` (e.g. `transformHandlers`, `materialHandlers`,
`physicsJointHandlers`, `handlers2d`). `executeToolCall(toolName, input, store)` builds a
`ToolCallContext`, looks the tool up, and returns `{ success: false, error: 'Unknown tool: …' }`
for unknown names.

## Domain Handler Files

One file per domain in `web/src/lib/chat/handlers/`. `HANDLER_DOMAIN_SOURCES` in
`executor.ts` is the authoritative list — read it rather than a snapshot here.

## ToolHandler Type

```ts
// web/src/lib/chat/handlers/types.ts
export interface ToolCallContext {
  store: EditorState;
  dispatchCommand: (command: string, payload: unknown) => void;
  dispatchCommandBatch?: (commands: Array<{ command: string; payload?: unknown }>) => BatchResult;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolCallContext,
) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  result?: unknown;   // optional — structured query results
  message?: string;   // optional — helps the AI understand the outcome
  error?: string;
}
```

## parseArgs() — Argument Validation

Use `parseArgs(zodSchema, args)` from `./types` (`web/src/lib/chat/handlers/types.ts`). It
returns `{ data }` on success or `{ error }` (an `ExecutionResult`) on failure:

```ts
import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const myDomainHandlers: Record<string, ToolHandler> = {
  my_command: async (args, { dispatchCommand }) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        intensity: z.number().default(1.0),
        mode: z.enum(['add', 'replace']).optional(),
      }),
      args,
    );
    if (p.error) return p.error; // { success: false, error: 'Invalid arguments: …' }

    dispatchCommand('my_command', {
      entityId: p.data.entityId,
      intensity: p.data.intensity,
      mode: p.data.mode ?? 'replace',
    });

    return {
      success: true,
      message: `Applied to ${p.data.entityId}`,
    };
  },
};
```

## Adding a New Handler

1. Add to the domain handler file (or create a new file for a new domain)
2. Export from the file as part of its `<domain>Handlers` map
3. For a new file, import it in `executor.ts` and add it to `HANDLER_DOMAIN_SOURCES` and the registry spread
4. Add display label in `web/src/components/chat/ToolCallCard.tsx`
5. Write a test in the co-located `__tests__/` directory

## ToolCallCard Display Labels

Every command needs a human-readable label in `ToolCallCard.tsx`:

```ts
// web/src/components/chat/ToolCallCard.tsx
case 'my_command': return 'Applying Effect';
case 'my_other_command': return 'Setting Property';
```

Without this, the chat UI shows the raw command name to the user.
