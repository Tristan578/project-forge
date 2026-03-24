# Spec: Vercel AI SDK + Gateway Migration

> **Status:** DRAFT — Awaiting Approval
> **Date:** 2026-03-22
> **Scope:** Replace direct `@anthropic-ai/sdk` usage with Vercel AI SDK (`ai` + `@ai-sdk/react` + `@ai-sdk/gateway`) across all AI-consuming routes and the client chat UI.

## User Workflow

**Persona:** SpawnForge user chatting with the AI assistant to build a game.

1. The user opens the editor and types "create a platformer level with moving platforms and a collectible coin at the end."
2. The AI chat panel begins streaming a response. Under the hood, the Next.js route calls `streamText()` from the Vercel AI SDK, routing through the gateway with OIDC auth — no API key required for deployed instances.
3. As the AI responds with tool calls (`spawn_entity`, `set_material`, `apply_physics`), the `useChat` hook accumulates parts natively — no manual SSE parsing. The tool calls dispatch to the WASM engine via the browser-side tool execution loop.
4. When thinking mode is active, the AI's reasoning appears as a collapsible block. The `@ai-sdk/anthropic` provider passes the thinking budget to Anthropic transparently.
5. An approval-mode tool call (e.g. `delete_entity`) pauses with a confirmation dialog. The `needsApproval` flag on the tool triggers AI SDK's deferred execution path, preserving the existing UX.
6. The full conversation is visible in Sentry with per-call AI spans: model name, token count, latency — powered by `vercelAIIntegration()`. The team can triage slow responses without reading logs.
7. The engineer maintaining the codebase has zero custom SSE parsers to maintain. Provider failover, circuit breaking, and health monitoring continue to work — the AI SDK only replaced the transport layer.

**Expected outcome:** Users experience faster, more reliable AI responses. Engineers maintain less custom streaming code. The team gains AI-specific observability in Sentry without any instrumentation work.

---

## Problem

SpawnForge currently uses a hand-rolled streaming infrastructure built around the `@anthropic-ai/sdk` package:

1. **Server-side** (`resolveChat.ts`): A custom `streamAnthropicDirect()` async generator manually parses Anthropic SSE events (`content_block_start`, `content_block_delta`, etc.) and converts them to an internal `ResolveChatStreamEvent` envelope. A parallel `streamOpenAICompat()` generator handles gateway/OpenRouter paths by parsing OpenAI-format SSE via raw `fetch`.

2. **Client-side** (`chatStore.ts`): A custom `streamOneTurn()` function manually reads `ReadableStream` chunks, parses `data:` SSE lines, reconstructs tool call inputs from `tool_input_delta` fragments, and drives an agentic tool-use loop (up to 10 iterations).

3. **Type coupling**: The Anthropic SDK types (`Anthropic.TextBlockParam`, `Anthropic.Tool`, `Anthropic.ContentBlockParam`) are referenced in 3 files and baked into the system prompt construction, tool definition, and message serialization.

4. **No Sentry AI observability**: The Sentry config has no `vercelAIIntegration()`, so we get zero AI-specific telemetry (token usage, model latency, tool call traces).

5. **Tool definition format mismatch**: Tools are defined in `commands.json` as `{ input_schema }` (Anthropic format) and passed directly. The AI SDK uses `{ inputSchema }` with Zod validation.

This creates maintenance burden (two streaming parsers, manual SSE reconstruction), blocks AI SDK ecosystem features (structured output, multi-step agents, telemetry), and prevents a clean path to multi-provider tool calling.

## Current State Analysis

### Files that import `@anthropic-ai/sdk`

| File | Usage |
|------|-------|
| `web/src/lib/providers/resolveChat.ts` | `import Anthropic from '@anthropic-ai/sdk'` — SDK client + all type references |
| `web/src/app/api/chat/route.ts` | `import Anthropic from '@anthropic-ai/sdk'` — `Anthropic.TextBlockParam` for system blocks |
| `web/package.json` | `"@anthropic-ai/sdk": "^0.78.0"` |

### Provider Registry (keep intact)

The existing provider registry (`registry.ts`, `circuitBreaker.ts`, `types.ts`, 4 backend files) handles backend selection, health monitoring, and circuit breaking. This infrastructure is **orthogonal** to the AI SDK migration and will be preserved. The AI SDK Gateway replaces only the *streaming transport* layer, not the routing/health layer.

### Client Chat Architecture

The client uses a custom Zustand store (`chatStore.ts`) with:
- `sendMessage()` → `streamOneTurn()` → `fetch('/api/chat')` → manual SSE parsing
- Tool call accumulation via `toolInputBuffers` map
- Agentic loop: up to `MAX_LOOP_ITERATIONS = 10` turns when `stop_reason === 'tool_use'`
- Approval mode: deferred tool execution with user confirm/reject
- Conversation persistence to localStorage

### AI Generation Modules (no Anthropic imports)

The 20+ AI generation modules in `web/src/lib/ai/` (gddGenerator, levelGenerator, gameReviewer, etc.) are **client-side** and call `/api/chat` via fetch. They do NOT import `@anthropic-ai/sdk` directly. They will benefit from the migration but require no direct changes in Phase 2-3.

### Non-Chat Generation Routes

The routes in `web/src/app/api/generate/` (model, texture, sprite, music, sfx, voice, skybox, etc.) call **third-party APIs** (Meshy, ElevenLabs, Suno, Replicate) via their own clients, NOT the Anthropic SDK. These routes are out of scope for this migration.

## Target State

After migration:

```
Client (React)                         Server (Next.js Route Handler)
------------------------------         ----------------------------------------
useChat({                              import { streamText, convertToModelMessages } from 'ai';
  transport: new DefaultChat            import { gateway } from '@ai-sdk/gateway';
    Transport({                         import { tool } from 'ai';
    api: '/api/chat'
  })                                    const result = streamText({
})                                        model: gateway('anthropic/claude-sonnet-4.6'),
                                          system: SYSTEM_PROMPT,
  messages, sendMessage,                  messages: convertToModelMessages(messages),
  status, stop                            tools: { ...mcpTools },
                                          experimental_telemetry: { isEnabled: true },
                                        });
                                        return result.toUIMessageStreamResponse();
```

### Key Properties of Target State

1. **Single streaming protocol**: AI SDK's UI message stream replaces both custom SSE parsers
2. **Gateway-native**: `gateway('anthropic/claude-sonnet-4.6')` uses OIDC auth on Vercel, falls back to API key
3. **Zod-validated tools**: Tool `inputSchema` validates LLM output before `execute` runs
4. **Sentry telemetry**: `vercelAIIntegration()` + `experimental_telemetry` gives per-call AI spans
5. **Provider registry preserved**: Circuit breaker, health monitoring, and backend selection remain
6. **Approval mode preserved**: AI SDK's `needsApproval` on tools replaces the custom deferred execution path

## Migration Phases

### Phase 1: Install AI SDK Packages, Adapter Layer (Non-Breaking)

**Goal**: Install packages and create an adapter that maps the AI SDK streaming format to the existing `ResolveChatStreamEvent` envelope. Existing client code continues working unchanged.

**Packages to install**:
```bash
cd web && npm install ai @ai-sdk/react @ai-sdk/gateway @ai-sdk/anthropic zod
```

Note: `zod` is already installed (`^4.3.6` in package.json). The `@ai-sdk/anthropic` provider is needed as a fallback for the direct path (non-gateway) which requires prompt caching and extended thinking features not yet available through the gateway.

**New files**:

1. `web/src/lib/ai/aiSdkAdapter.ts` — Adapter that wraps `streamText` and yields `ResolveChatStreamEvent` objects, so `resolveChat.ts` can swap its internals without changing its public API.

```
// Pseudocode — NOT implementation code
export async function* streamViaSdk(options): AsyncGenerator<ResolveChatStreamEvent>
  - Create gateway or anthropic model based on resolved backend
  - Convert system blocks to AI SDK system format
  - Convert Anthropic tool format to AI SDK tool() with Zod inputSchema
  - Call streamText() with experimental_telemetry enabled
  - Iterate over AI SDK stream events
  - Yield ResolveChatStreamEvent objects matching existing envelope
```

2. `web/src/lib/ai/toolAdapter.ts` — Converts MCP command manifest tools from `{ input_schema }` format to AI SDK `tool()` definitions with Zod schemas.

```
// Pseudocode — NOT implementation code
export function convertManifestToolsToSdkTools(manifestTools): Record<string, CoreTool>
  - For each manifest tool:
    - Convert JSON Schema input_schema to Zod schema (using zod's JSON Schema inference)
    - Create tool({ description, inputSchema, execute: undefined })
    - execute is undefined because tools are forwarded to client for execution
```

**Changes to existing files**:

- `web/src/lib/providers/resolveChat.ts`: Add a feature flag `USE_AI_SDK` (env var). When off, existing code runs. When on, route through `streamViaSdk()`. Public API (`resolveChat`, `ResolveChatStreamEvent`) unchanged.

**Test plan**:
- Existing `resolveChat.test.ts` and `route.test.ts` pass unchanged
- New unit tests for `aiSdkAdapter.ts` and `toolAdapter.ts`
- Manual test: set `USE_AI_SDK=true`, verify chat works end-to-end in dev

### Phase 2: Migrate `/api/chat` Route to AI SDK (Server-Side)

**Goal**: Replace the manual SSE construction in `route.ts` with AI SDK `streamText` + `toUIMessageStreamResponse()`. The route now returns the AI SDK's native streaming format. Client still uses custom SSE parser (compatibility shim).

**Changes to `web/src/app/api/chat/route.ts`**:

- Remove `import Anthropic from '@anthropic-ai/sdk'`
- Remove manual `ReadableStream` + `TextEncoder` construction
- Remove `send()` SSE helper
- Import `streamText`, `convertToModelMessages`, `UIMessage` from `'ai'`
- Import `gateway` from `'@ai-sdk/gateway'` and `anthropic` from `'@ai-sdk/anthropic'`
- Import converted tools from `toolAdapter.ts`
- System prompt: plain string (AI SDK handles caching automatically for supported providers)
- Scene context: append to system prompt string
- Thinking mode: use provider-specific `providerOptions` for Anthropic thinking
- Return `result.toUIMessageStreamResponse()` instead of manual SSE Response

**Message format bridge**: The current client sends messages as `{ role, content }` in Anthropic format. The route will need to convert these to AI SDK `UIMessage` format before calling `convertToModelMessages()`. This is a server-side conversion only.

**Changes to `web/src/lib/providers/resolveChat.ts`**:

- Remove `streamAnthropicDirect()` and `streamOpenAICompat()` async generators
- Remove `import Anthropic from '@anthropic-ai/sdk'`
- Remove all Anthropic type exports (`AnthropicContentBlock`, etc.)
- The `resolveChat()` function is no longer needed for the chat route (route calls AI SDK directly)
- Keep `resolveChatRoute()` and `resolveBackend()` for provider selection and billing logic

**Provider selection**: The route still calls `resolveChatRoute()` to determine which backend to use and whether token deduction is needed. It then creates the appropriate AI SDK model:
- Gateway backend: `gateway('anthropic/claude-sonnet-4.6')`
- Direct backend: `anthropic('claude-sonnet-4.5')` with API key from registry
- OpenRouter backend: `gateway('anthropic/claude-sonnet-4.6')` with custom base URL

**Prompt caching**: The `@ai-sdk/anthropic` provider supports Anthropic prompt caching via `providerOptions`. System prompt blocks with `cache_control` translate to the provider's caching mechanism. The gateway path relies on Anthropic's server-side caching (automatic for repeated prefixes).

**SSE compatibility shim**: During Phase 2, the client still expects the old `ResolveChatStreamEvent` envelope. Option A: add a thin adapter on the client to parse UI message stream format. Option B (preferred): use `toUIMessageStreamResponse()` which the AI SDK client (`useChat`) natively understands, and add a temporary client-side adapter until Phase 3 completes.

**Test plan**:
- Update `route.test.ts` to mock AI SDK `streamText` instead of Anthropic SDK
- Update `negative-cases.test.ts` for new error paths
- Manual E2E: full chat with tool calling, thinking mode, approval mode

### Phase 3: Migrate Client to `useChat` with `DefaultChatTransport`

**Goal**: Replace the custom `streamOneTurn()` + manual SSE parser in `chatStore.ts` with the AI SDK's `useChat` hook.

**New file**: `web/src/hooks/useAiChat.ts` — A wrapper around `useChat` that bridges to the existing chatStore.

**Architecture decision**: The `useChat` hook manages its own message state. SpawnForge's chatStore has significant additional state (tool call status tracking, approval mode, entity refs, conversation persistence, agentic loop, batch undo). Two approaches:

**Option A (Recommended): useChat as transport, chatStore as authority**
- `useChat` handles streaming and message protocol
- On each message update, sync to chatStore for tool execution, approval mode, and persistence
- chatStore remains the single source of truth for UI
- useChat's internal state is treated as ephemeral transport state

**Option B: Full useChat migration**
- Move all message state into useChat
- Extend with custom middleware for tool execution, approval, persistence
- Higher risk: requires rewriting all chatStore consumers

**Key mappings for Option A**:

| Current (chatStore) | Target (useChat + chatStore) |
|---------------------|------------------------------|
| `streamOneTurn()` fetch + SSE parse | `useChat` with `DefaultChatTransport` |
| `toolInputBuffers` accumulation | AI SDK handles tool call parts natively |
| Agentic loop (`MAX_LOOP_ITERATIONS`) | Server-side `maxSteps` or `stopWhen: stepCountIs(10)` |
| `deferToolExecution` (approval mode) | `needsApproval` on tool definitions |
| `ToolCallStatus` tracking | Map from AI SDK `tool-<toolName>` parts (e.g. `tool-spawn_entity`) |
| Manual `AbortController` | `useChat().stop()` |

**Changes to client components**:
- `ChatPanel.tsx`: Use `useChat` messages for rendering, bridge to chatStore for tool status
- `ChatInput.tsx`: Use `useChat().sendMessage()` instead of `chatStore.sendMessage()`
- `ChatMessage.tsx`: Adapt to AI SDK message parts format (`part.type === 'text'`, `part.type === 'tool-<toolName>'` e.g. `tool-spawn_entity`)

**Conversation persistence**: The current localStorage persistence in chatStore saves/loads `ChatMessage[]`. After migration, we need to serialize AI SDK `UIMessage` format to localStorage. Add a conversion layer in the persistence functions.

**Entity @-mentions**: Currently injected into the message content string. This continues to work unchanged since `useChat().sendMessage()` accepts text content.

**Test plan**:
- Update all chatStore tests to work with new message flow
- Update ChatPanel, ChatInput, ChatMessage component tests
- Manual E2E: full chat flow, tool calling, approval mode, thinking, conversation switching, entity mentions

### Phase 4: Migrate AI Generation Routes (Server-Side Consumers)

**Goal**: Migrate the 20+ AI generation modules in `web/src/lib/ai/` that call `/api/chat` via fetch to use the AI SDK directly on the server, or to use the new `useChat`-powered client flow.

**Analysis**: These modules (gddGenerator, levelGenerator, gameReviewer, worldBuilder, tutorialGenerator, etc.) are **client-side** modules that:
1. Construct a custom system prompt
2. Call `fetch('/api/chat')` with that prompt
3. Parse the SSE response via `streaming.ts` helpers
4. Extract structured data from the text response

**Two sub-approaches**:

**4A: Keep as client-side, use useChat (minimal change)**
- These modules already call `/api/chat` — they automatically benefit from Phase 2's server migration
- Update their SSE parsing to handle the new AI SDK stream format (or use a compatibility adapter)
- Replace manual `fetch` + `readSSEStream()` with a shared helper that uses the same transport

**4B: Move to server-side API routes (better architecture)**
- Create dedicated routes: `/api/ai/gdd`, `/api/ai/review`, `/api/ai/level`, etc.
- Each route uses `generateText` (not `streamText`) since most return structured JSON
- Use AI SDK's `output: 'object'` + `outputSchema` for typed responses
- Client calls are simple `fetch` + `await response.json()`
- Enables proper cost tracking per generation type

**Recommendation**: Phase 4A first (compatibility), 4B as a follow-up spec. The generation modules work today and changing their architecture is a separate concern.

**Changes for 4A**:
- `web/src/lib/ai/streaming.ts`: Update `readSSEStream()` to handle AI SDK UI message stream format alongside the legacy format
- No changes to individual generation modules if the adapter handles format differences

**Test plan**:
- Existing generation module tests should pass (they mock fetch)
- Manual test: GDD generation, game review, level generation end-to-end

### Phase 5: Remove `@anthropic-ai/sdk`, Add Sentry AI Telemetry

**Goal**: Clean up the migration. Remove the old SDK, enable AI observability.

**Package removal**:
```bash
cd web && npm uninstall @anthropic-ai/sdk
```

**Sentry changes**:

1. `web/sentry.server.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: DSN,
  // ...existing config...
  integrations: [Sentry.vercelAIIntegration()],
});
```

2. `web/sentry.edge.config.ts`:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: DSN,
  // ...existing config...
  integrations: [Sentry.vercelAIIntegration()],
});
```

3. All `streamText` / `generateText` calls already have `experimental_telemetry: { isEnabled: true }` from Phase 2.

**Feature flag removal**: Remove `USE_AI_SDK` env var and all conditional paths from Phase 1.

**Dead code removal**:
- Delete `streamAnthropicDirect()` remnants (if any remain from Phase 2)
- Delete `streamOpenAICompat()` (replaced by AI SDK gateway transport)
- Clean up `AnthropicContentBlock` type export and all consumers
- Remove Phase 1 adapter shim (`aiSdkAdapter.ts`) if no longer used

**Test plan**:
- `grep -r '@anthropic-ai/sdk' web/src/` returns zero results
- All existing tests pass
- Sentry dashboard shows AI spans (model, tokens, latency)
- Full regression: chat, tool calling, thinking, approval, generation modules

## Files to Modify (Complete List)

### Phase 1 (New Files)
| File | Change |
|------|--------|
| `web/src/lib/ai/aiSdkAdapter.ts` | NEW — AI SDK streaming adapter |
| `web/src/lib/ai/toolAdapter.ts` | NEW — MCP manifest to AI SDK tool converter |
| `web/src/lib/ai/__tests__/aiSdkAdapter.test.ts` | NEW — Adapter tests |
| `web/src/lib/ai/__tests__/toolAdapter.test.ts` | NEW — Tool converter tests |
| `web/src/lib/providers/resolveChat.ts` | ADD feature flag path |
| `web/package.json` | ADD `ai`, `@ai-sdk/react`, `@ai-sdk/gateway`, `@ai-sdk/anthropic` |

### Phase 2 (Server Route)
| File | Change |
|------|--------|
| `web/src/app/api/chat/route.ts` | REWRITE — AI SDK `streamText` + `toUIMessageStreamResponse()` |
| `web/src/lib/providers/resolveChat.ts` | REMOVE streaming generators, keep `resolveChatRoute()` |
| `web/src/lib/chat/tools.ts` | MODIFY — Add AI SDK tool format export alongside existing |
| `web/src/app/api/chat/__tests__/route.test.ts` | UPDATE — Mock AI SDK instead of Anthropic SDK |
| `web/src/app/api/chat/__tests__/negative-cases.test.ts` | UPDATE — New error paths |
| `web/src/lib/providers/__tests__/resolveChat.test.ts` | UPDATE — Streaming generators removed |

### Phase 3 (Client)
| File | Change |
|------|--------|
| `web/src/hooks/useAiChat.ts` | NEW — useChat wrapper bridging to chatStore |
| `web/src/stores/chatStore.ts` | MODIFY — Replace `streamOneTurn()`, update message types |
| `web/src/components/chat/ChatPanel.tsx` | MODIFY — Use useChat for streaming |
| `web/src/components/chat/ChatInput.tsx` | MODIFY — Use useChat sendMessage |
| `web/src/components/chat/ChatMessage.tsx` | MODIFY — Render AI SDK message parts |
| `web/src/stores/__tests__/chatStore.test.ts` | UPDATE |
| `web/src/stores/__tests__/chatStore.deep.test.ts` | UPDATE |
| `web/src/stores/__tests__/chatStore.advanced.test.ts` | UPDATE |
| `web/src/stores/__tests__/chatStore.conversations.test.ts` | UPDATE |
| `web/src/components/chat/__tests__/ChatPanel.test.ts` | UPDATE |
| `web/src/components/chat/__tests__/ChatInput.test.ts` | UPDATE |
| `web/src/components/chat/__tests__/ChatMessage.test.ts` | UPDATE |

### Phase 4 (Generation Modules)
| File | Change |
|------|--------|
| `web/src/lib/ai/streaming.ts` | MODIFY — Handle AI SDK stream format |

### Phase 5 (Cleanup)
| File | Change |
|------|--------|
| `web/package.json` | REMOVE `@anthropic-ai/sdk` |
| `web/sentry.server.config.ts` | ADD `vercelAIIntegration()` |
| `web/sentry.edge.config.ts` | ADD `vercelAIIntegration()` |
| `web/src/lib/ai/aiSdkAdapter.ts` | DELETE (if superseded) |
| `web/src/lib/providers/resolveChat.ts` | REMOVE feature flag, dead code |

## Acceptance Criteria

- Given the chat route receives a user message, When it processes the request, Then it uses `streamText` from the `ai` package with a `gateway()` or `anthropic()` model (not `new Anthropic()`)
- Given a user sends a message in the chat panel, When streaming begins, Then the `useChat` hook from `@ai-sdk/react` manages the stream (not a manual `ReadableStream` reader)
- Given the AI responds with tool calls, When tools are defined, Then they use `tool()` from `ai` with `inputSchema` (Zod) and the tool results are properly returned to the model
- Given thinking mode is enabled, When the user sends a message, Then extended thinking works via `@ai-sdk/anthropic` provider options
- Given approval mode is enabled, When a tool call arrives, Then the tool has `needsApproval: true` and execution is deferred until user confirms
- Given the system is deployed on Vercel, When `/api/chat` processes a request, Then Sentry captures an AI span with model name, token usage, and latency via `vercelAIIntegration()`
- Given a search for `@anthropic-ai/sdk` in the codebase, When Phase 5 is complete, Then zero results are found
- Given the provider registry resolves to the gateway backend, When a chat request is made, Then the AI SDK uses `gateway('anthropic/claude-sonnet-4.6')` with OIDC auth
- Given the provider registry resolves to the direct backend, When a chat request is made, Then the AI SDK uses `anthropic('claude-sonnet-4.5')` with the platform API key
- Given the circuit breaker is OPEN for a backend, When chat is attempted, Then the existing failover logic in `registry.ts` still routes to the next available backend

## Risk Assessment

### High Risk

**Client-side tool execution loop**: The current agentic loop in `chatStore.ts` executes tools client-side and sends results back to the model across multiple turns. The AI SDK's `maxSteps` executes tools **server-side**. Since SpawnForge's tools dispatch commands to the WASM engine running in the browser, they MUST execute client-side. Mitigation: Use AI SDK tools with `execute: undefined` (forward to client), and handle the multi-turn loop on the client using `useChat`'s `addToolResult` API. This is the most architecturally complex part of the migration.

**Message format compatibility**: The transition from Anthropic-format messages (`{ role, content: string | ContentBlock[] }`) to AI SDK UIMessage format (`{ role, parts: Part[] }`) touches every component that renders messages. Mitigation: Phase 3 adapter layer that maps between formats, allowing incremental component migration.

### Medium Risk

**Prompt caching regression**: The current implementation uses `cache_control: { type: 'ephemeral' }` on system blocks and the last tool definition. The AI SDK's Anthropic provider supports this via `providerOptions`, but gateway-routed requests may not. Mitigation: When routing through direct Anthropic backend, use `@ai-sdk/anthropic` provider (not gateway) to preserve caching. Monitor cache hit rates in Sentry after migration.

**Extended thinking**: Anthropic's thinking mode uses `thinking: { type: 'enabled', budget_tokens: 10000 }`. The AI SDK supports this via `@ai-sdk/anthropic` provider options. Gateway support is unclear. Mitigation: Always use `@ai-sdk/anthropic` provider for thinking-mode requests, even when gateway is the default.

**Test churn**: 12+ test files need updates across chatStore, route, and component tests. Mitigation: Phase 1 adapter layer minimizes test changes in early phases. Phase 3 is the big test update.

### Low Risk

**Generation module compatibility** (Phase 4): Client-side AI modules call `/api/chat` via fetch. The response format changes from custom SSE to AI SDK UI message stream. Mitigation: Compatibility adapter in `streaming.ts` handles both formats during transition.

**Bundle size**: Adding `ai` + `@ai-sdk/react` + `@ai-sdk/gateway` + `@ai-sdk/anthropic` increases the client bundle. The `ai` core is tree-shakeable. `@ai-sdk/react` replaces custom streaming code that is roughly equivalent in size. Net impact should be near-neutral or slight increase. Mitigation: Measure with `next experimental-analyze` before and after.

## Rollback Plan

### Per-Phase Rollback

Each phase is independently deployable and reversible:

1. **Phase 1**: Remove packages, delete new files, revert `resolveChat.ts` feature flag. Zero impact on production.
2. **Phase 2**: Revert `route.ts` to Anthropic SDK version. Feature flag in Phase 1 makes this instant.
3. **Phase 3**: Revert chatStore and components to custom SSE parser. Phase 2 server route works with both old and new clients.
4. **Phase 4**: Revert `streaming.ts` format adapter. Generation modules fall back to legacy parsing.
5. **Phase 5**: Re-install `@anthropic-ai/sdk` if any phase needs rollback.

### Emergency Rollback

If the AI SDK has a critical bug in production:
1. Set `USE_AI_SDK=false` environment variable (Phase 1-2 feature flag)
2. Deploy — instantly reverts to `@anthropic-ai/sdk` code path
3. No code changes needed for immediate mitigation

## Performance Targets

These quantified targets apply to this migration and must not regress:

| Metric | Target | Measurement method |
|--------|--------|--------------------|
| LCP (Largest Contentful Paint) | < 2.5s | Vercel Speed Insights / Lighthouse |
| CLS (Cumulative Layout Shift) | < 0.1 | Lighthouse |
| INP (Interaction to Next Paint) | < 200ms | Lighthouse / field data |
| WASM engine load time | < 3s on fast 3G | `performance.mark` around WASM init |
| Initial JS bundle (gzipped) | < 500KB | `next experimental-analyze` |
| AI SDK addition to bundle | < 50KB gzipped | `next experimental-analyze` diff |
| Streaming first-byte latency | < 2s | Server timing header |
| Command dispatch latency | < 1ms | `performance.now()` around `dispatchCommand()` |

Measure baseline before Phase 1 and after Phase 5. Flag any regression as a blocker.

## Constraints

- **Vercel AI SDK version**: Use `ai@^4.0.0` (latest stable). Do NOT use canary/preview versions.
- **Zod version**: Already at `^4.3.6`. AI SDK tool schemas require Zod 4+.
- **Bundle budget**: WASM binaries are ~15MB each. The AI SDK addition must not push total page weight beyond acceptable limits. Target: < 50KB gzipped addition to client bundle.
- **Sentry SDK version**: `@sentry/nextjs@^10.42.0` — already supports `vercelAIIntegration()` (requires 10.6.0+).
- **No breaking changes to MCP commands**: The `commands.json` manifest format remains unchanged. Tool adapter converts at runtime.
- **Agentic loop must remain client-side**: Tool execution happens in the browser (WASM engine commands). Server-side `maxSteps` with `execute` functions cannot reach the browser. Use client-side tool result forwarding.
- **Performance budget**: See Performance Targets table above.

## Alternatives Considered

### 1. Keep @anthropic-ai/sdk, add AI SDK only for telemetry
**Rejected**: Would require maintaining two SDK integrations. The streaming code is the main maintenance burden, and keeping it defeats the purpose.

### 2. Use AI SDK without gateway (direct @ai-sdk/anthropic only)
**Rejected**: Loses the multi-provider routing benefit. The gateway gives us OIDC auth, automatic provider switching, and a path to non-Anthropic models without code changes.

### 3. Full server-side tool execution via maxSteps
**Rejected**: SpawnForge's tools dispatch commands to the WASM engine in the browser. Server-side execution is architecturally impossible for scene manipulation commands. Tools must be forwarded to the client.

### 4. Replace chatStore entirely with useChat state
**Rejected**: chatStore has too much SpawnForge-specific state (approval mode, batch undo, entity refs, conversation persistence, editor store integration) to replace with useChat's simpler message model. The bridge approach (Option A) preserves existing functionality.

### 5. Build a custom streaming adapter without AI SDK
**Rejected**: Reinventing what the AI SDK already provides. The ecosystem benefits (telemetry, multi-provider, structured output) justify the dependency.

## Error Handling

| Error Condition | User Experience | Recovery Path |
|-----------------|-----------------|---------------|
| AI provider rate limit (HTTP 429) from gateway or direct Anthropic | Chat shows inline error message: "Rate limit reached. Please wait a moment." Streaming stops cleanly. | Existing circuit breaker in `registry.ts` trips after threshold; failover routes to next available backend. `USE_AI_SDK` feature flag allows instant rollback if AI SDK rate limit handling differs from current behavior. |
| AI provider auth error (HTTP 401) — gateway OIDC token expired or API key invalid | Chat shows: "AI authentication failed. The team has been notified." Request does not retry automatically. | Sentry captures the auth error via `vercelAIIntegration()` span. Ops rotates the key or refreshes OIDC token. Existing `resolveBackend()` can fall back to a backup key if configured. |
| Network disconnection mid-stream during `streamText` | AI SDK's `ReadableStream` reader receives `AbortError`. Chat shows: "Connection interrupted. Your message was not completed." Partial text is preserved in the message. | User can resend the message. `useChat().stop()` is called on unmount to clean up dangling stream. No orphaned server processes — `streamText` aborts on the server when the client disconnects. |
| Token depletion detected before streaming completes | Route handler calls `resolveChatRoute()` which checks token balance before dispatching. Returns HTTP 402 with `{ error: 'insufficient_tokens' }`. Chat shows upgrade prompt. | `useChat` receives a non-2xx response and surfaces the error. `chatStore` handles `402` as a special case showing the token purchase dialog. No partial message is saved. |
| Database connection failure in `resolveChatRoute()` (Neon timeout) | Route returns HTTP 503. Chat shows: "Couldn't reach the server. Please try again." | Neon connection pool is retried once (existing behavior in `db/index.ts`). If still failing, the 503 surfaces. Circuit breaker prevents cascading failures. Sentry alert fires on elevated 503 rate. |
| WASM engine panic during tool execution (command dispatch fails) | Tool call result returned to AI SDK as `{ error: 'Engine command failed: <message>' }`. The model receives the error as a tool result and can attempt recovery or inform the user. | AI SDK's `addToolResult` path sends the error back to the model. The model typically responds with a diagnostic message or suggests an alternative command. No client crash — error is caught in the tool execution wrapper. |
| `streamText` timeout (Vercel function maxDuration exceeded) | Vercel terminates the response with a 504. AI SDK surfaces this as a stream error. Chat shows: "Response timed out. Try a shorter request." | Set `maxDuration: 60` in the route config. Long-running agentic loops should use `maxSteps` to avoid single-request timeouts. Rollback option: revert to `@anthropic-ai/sdk` path via `USE_AI_SDK=false`. |
| Tool schema validation failure (`inputSchema` Zod parse error) | AI SDK rejects the tool call before `execute` runs. The model receives a validation error as the tool result. | Model typically self-corrects by reformulating the tool call with valid parameters. Zod error message is forwarded as the tool result so the model can understand what went wrong. |

## Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| AI SDK stream returns a `finish_reason: 'length'` (max tokens hit mid-generation) | The partial response is displayed up to the cut-off point. `useChat` surfaces this as a completed message (AI SDK normalizes length truncation to a normal finish). The user sees the partial text and can follow up asking the model to continue. No data loss. |
| Tool call arrives with an empty `input` object `{}` when the schema has required fields | Zod validation in `toolAdapter.ts` fails on the required fields. The validation error is returned as the tool result. The model receives the Zod error message (e.g. `"entityId: Required"`) and typically retries with correct inputs. |
| Same tool is called twice in a single AI response (parallel tool calls) | AI SDK supports parallel tool calls natively. Both tool results are sent back together in a single `addToolResult` batch. Both WASM commands dispatch correctly. No ordering guarantee — callers must not assume sequential execution. |
| User sends a new message while a previous streaming response is still in progress | `useChat().stop()` is called before the new message is sent (same behavior as the current custom abort logic). The in-progress stream is cleanly cancelled. The partial server response is discarded. The new message starts a fresh turn. |
| Gateway OIDC token expires exactly mid-stream (token TTL boundary during a long response) | The gateway renews the token before the request, not mid-stream. Anthropic's API uses the token at request time; a TTL expiry after streaming begins does not interrupt the stream. If the token is already expired at request time, the route returns a 401 handled by the auth error case in the Error Handling table above. |
| `convertToModelMessages()` receives a conversation history with a `tool` role message that has no matching `tool_use` in the preceding `assistant` message | AI SDK's message converter skips orphaned tool results and logs a warning. The conversation continues from the last valid message pair. The skipped tool result is lost from context. |
| `USE_AI_SDK` feature flag is `true` in one Vercel region but `false` in another due to a partial env var rollout | Both paths produce valid responses (the flag is a transport switch, not a behavioral change). Users in different regions may see different SSE formats during transition — the compatibility shim in `streaming.ts` handles both. Feature flags should be consistent across regions; this is a deployment anti-pattern to avoid. |
| Zod schema generated from a JSON Schema `anyOf` or `oneOf` construct in `commands.json` | `toolAdapter.ts` uses `z.union()` for `anyOf` and `z.union()` for `oneOf`. Discriminated unions from `oneOf` with a discriminant field use `z.discriminatedUnion()`. JSON Schema `not` constraints are dropped (not representable in Zod) with a console warning in development. |
| The circuit breaker is in `HALF_OPEN` state when a chat request arrives mid-Phase 2 migration | `resolveChatRoute()` still handles the circuit breaker logic. The AI SDK path is only entered after the backend has been selected. A `HALF_OPEN` backend receives exactly one probe request; if it succeeds, the breaker closes and subsequent requests proceed normally. If it fails, the breaker opens and the existing failover logic selects the next backend. |
| AI SDK generates a `tool-<name>` message part type where `<name>` contains hyphens (e.g. `spawn-entity` instead of `spawn_entity`) | MCP command names use underscores (`spawn_entity`). AI SDK tool part types are derived from the tool key passed to `streamText`. The tool key must match the command name exactly. `toolAdapter.ts` must use the command name as the object key without transformation. Hyphens in tool names would break this mapping — enforce underscore-only names in `commands.json`. |
| User is offline when Phase 3 `useChat` tries to resume a pending conversation from localStorage | `useChat` attempts to re-send the pending message on mount. The fetch fails with a network error. `useChat` surfaces the error via `status: 'error'`. The user sees the connection error state. The pending message remains in localStorage and is re-attempted on the next load when connectivity is restored. |

## Estimated Effort

| Phase | Effort | Risk | Can Ship Independently |
|-------|--------|------|----------------------|
| Phase 1: Install + Adapter | 1 day | Low | Yes (feature-flagged) |
| Phase 2: Server Route | 2 days | Medium | Yes (client adapter) |
| Phase 3: Client useChat | 3-4 days | High | Yes (requires Phase 2) |
| Phase 4: Generation Modules | 1 day | Low | Yes (requires Phase 2) |
| Phase 5: Cleanup + Sentry | 0.5 day | Low | Yes (requires Phases 2 through 4) |
| **Total** | **7-8 days** | | |

Phase 2 is the critical path. Phase 3 is the highest effort due to test updates. Phases 4 and 5 are mechanical cleanup.
