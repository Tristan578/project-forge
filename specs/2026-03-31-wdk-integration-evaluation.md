# Workflow DevKit Integration Evaluation

> **Status:** APPROVED (evaluation complete)
> **Date:** 2026-03-31
> **Related:** specs/2026-03-25-game-creation-orchestrator-phase2a-v4.md
> **Ticket:** #8078

## Summary

Evaluation of whether the Phase 2A game creation orchestrator should use Vercel
Workflow DevKit (WDK) for durable execution. Conclusion: **ship Phase 2A as
client-side pipeline, design WDK-compatible interfaces for Phase 2B migration.**

## Architecture Mismatch

The Phase 2A spec defines a client-side pipeline runner that:
- Reads from Zustand stores
- Calls `dispatchCommand()` on the WASM engine
- Runs entirely in the browser

WDK runs server-side (Vercel Functions). Adopting WDK requires splitting the
pipeline into server-side orchestration + client-side engine commands.

| Phase 2A Pattern | WDK Equivalent | Gap |
|------------------|----------------|-----|
| `runPipeline()` with topological sort | `'use workflow'` + async/await | Topo sort → linear step sequence |
| `PipelineCallbacks.onGateReached` | `createHook()` + `resumeHook()` | Direct mapping (designed for approval gates) |
| Client-side execution (Zustand + WASM) | Server-side execution (Functions) | **Fundamental split required** |
| Manual retry loop (`maxRetries`) | `'use step'` + `RetryableError` | WDK handles natively |
| `AbortSignal` cancellation | `npx workflow cancel` | Different mechanism |
| No persistence | Durable state, crash recovery | Phase 2A loses progress on refresh |

## Recommendation

### Phase 2A (implement now)
1. Ship `pipelineRunner.ts` and executor registry as the spec defines
2. Extract approval gate callbacks into a `GateProvider` interface:
   ```typescript
   interface GateProvider {
     waitForApproval(gateId: string, context: GateContext): Promise<GateDecision>;
     onGateSkipped(gateId: string, reason: string): void;
   }
   ```
3. Default implementation: client-side modal (current spec behavior)
4. This interface is WDK-compatible — a future `WdkGateProvider` maps directly
   to `createHook()` / `resumeHook()`

### Phase 2B (future ticket)
1. Move LLM calls (decomposer, plan builder) to server-side API routes
2. Wrap orchestration in `'use workflow'` directive
3. Replace `GateProvider` default with `WdkGateProvider` (hook-based)
4. Keep engine commands client-side via WebSocket message channel
5. Use Local World for development, Vercel World for production

### Phase 2B API Sketch

```typescript
// app/api/create-game/route.ts
'use workflow';

export async function POST(req: Request) {
  const { prompt, projectType } = await req.json();

  'use step';
  const gdd = await decompose(prompt, projectType);

  'use step';
  const plan = await buildPlan(gdd);

  // Human-in-the-loop approval via WDK hook
  const approval = await planApprovalHook.wait({ plan });
  if (!approval.approved) return Response.json({ cancelled: true });

  // Execute steps — each step is durable
  for (const step of plan.steps) {
    'use step';
    await executeStep(step, gdd);
  }

  return Response.json({ complete: true });
}
```

## Complexity Estimate

- **Phase 2A** (client-side, as-written): Medium (40 files, ~2 weeks)
- **Phase 2B** (WDK migration): Medium-Large (client-server split, WebSocket channel, ~3 weeks)
- **Total if done as one phase**: Large (architectural redesign, ~5 weeks)

## Decision

Proceed with Phase 2A. The `GateProvider` interface is the bridge — it costs
almost nothing to add now but makes the Phase 2B migration mechanical rather
than architectural.
