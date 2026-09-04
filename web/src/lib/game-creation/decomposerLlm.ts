/**
 * Structured-output seam for the game-creation decomposer.
 *
 * `decomposer.ts` used to ask `/api/chat` for prose, strip markdown fences off
 * the answer and `JSON.parse` it. Two problems with that, both fixed here
 * (PF-1216 / #9339):
 *
 *   1. It was a text channel carrying JSON, so every malformed-fence or
 *      trailing-prose response burned a full retry.
 *   2. `fetchAI` posts to the RELATIVE url `/api/chat`
 *      (`web/src/lib/ai/streaming.ts`), and `decomposeIntoSystems` runs
 *      SERVER-side inside `POST /api/game/decompose`. Node's `fetch` rejects a
 *      relative URL, so that call could not have succeeded in production.
 *
 * The model is now asked for a typed object via `Output.object`, and the
 * provider is chosen by the same registry rule the streaming path uses
 * (`resolveModelInstance`) so the two cannot drift.
 *
 * This module is deliberately separate from `decomposer.ts`: it is the only
 * part that touches the AI SDK directly (`generateText`, `Output`,
 * `resolveModelInstance`). The AI provider packages are still reachable from
 * the `@/lib/game-creation` barrel — `index.ts` exports `decomposeIntoSystems`,
 * which imports `decomposer.ts`, which imports this file — so the split is
 * NOT a module-graph boundary. What it buys instead: `decomposer.test.ts`
 * mocks this one function rather than the AI SDK's `generateText`/`Output`
 * surface directly, and a provider-shape change (a new SDK major, a
 * different `Output` API) touches one file instead of being interleaved
 * with the retry/validation logic in `decomposer.ts`.
 */

import { generateText, Output } from 'ai';
import type { z } from 'zod';
import { AI_MODEL_PRIMARY } from '@/lib/ai/models';
import { resolveModelInstance } from '@/lib/ai/aiSdkAdapter';
import { resolveBackendWithCircuitBreaker } from '@/lib/providers/registry';
import { DEFAULT_MAX_TOKENS } from '@/lib/constants';

/**
 * Ask the primary model for one decomposition, validated by the provider
 * against `schema` before it is returned.
 *
 * Throws when no chat backend is configured, when the provider call fails, or
 * when the model could not produce output matching the schema — the caller's
 * retry loop treats all three the same way it treated a parse failure before.
 *
 * @param userMessage  The user-facing turn (already sanitized by the caller).
 * @param systemPrompt The decomposition system prompt.
 * @param schema       Zod schema describing the object to return.
 */
export async function generateDecomposition<T>(
  userMessage: string,
  systemPrompt: string,
  schema: z.ZodType<T>,
): Promise<T> {
  // resolveBackendWithCircuitBreaker (not the plain resolveChatRoute) so a
  // backend an in-flight breaker has tripped on is skipped the same way the
  // streaming chat path skips it, instead of routing the decomposer straight
  // into a backend already known to be failing.
  const route = resolveBackendWithCircuitBreaker('chat', AI_MODEL_PRIMARY);
  if (!route) {
    throw new Error(
      'No chat backend is configured. Set AI_GATEWAY_API_KEY, OPENROUTER_API_KEY, GITHUB_MODELS_PAT, or ANTHROPIC_API_KEY.',
    );
  }

  const result = await generateText({
    model: resolveModelInstance(route, AI_MODEL_PRIMARY),
    system: systemPrompt,
    prompt: userMessage,
    // Parity with the previous `/api/chat` path, which capped non-thinking
    // turns at DEFAULT_MAX_TOKENS. Not a new budget.
    maxOutputTokens: DEFAULT_MAX_TOKENS,
    output: Output.object({ schema }),
    experimental_telemetry: { isEnabled: true },
  });

  return result.output;
}
