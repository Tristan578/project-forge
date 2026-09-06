/**
 * POST /api/game/decompose — Decompose a natural language game description
 * into a structured OrchestratorGDD via LLM.
 *
 * This is the ONLY server-side step in the game creation pipeline.
 * All subsequent steps (buildPlan, runPipeline) run client-side because
 * they call dispatchCommand() which requires the WASM engine.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 2)
 *
 * This route predates `createGenerationHandler` and isn't built on it:
 * `decomposeIntoSystems` (via `generateDecomposition` in `decomposerLlm.ts`)
 * resolves its own provider through `resolveBackendWithCircuitBreaker` —
 * platform-routed gateway/direct failover, the same rule the streaming chat
 * path uses — not per-user BYOK, so it can't take an
 * `execute(params, apiKey, ...)` callback the way the `createGenerationHandler`
 * routes do. It still needs the same defense-in-depth every other paid
 * AI-consuming route gets — bot check, tier gate, token metering, provider
 * kill switch — wired by hand below (PR #9672 review, security finding 2).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { assertTier } from '@/lib/auth/api-auth';
import { decomposeIntoSystems, PromptRejectedError } from '@/lib/game-creation/decomposer';
import { captureException } from '@/lib/monitoring/sentry-server';
import { checkBotIdGate } from '@/lib/security/botId';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { getTokenCost } from '@/lib/tokens/pricing';
import { refundTokens } from '@/lib/tokens/service';
import { isProviderKilled } from '@/lib/flags/posthogFlags';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

// One substantial single-shot LLM call producing a full GDD — priced at
// parity with what this route billed under before #9339, when
// decomposeIntoSystems asked /api/chat for prose (see decomposerLlm.ts's
// header comment) and would have been metered as a long chat turn.
const DECOMPOSE_TOKEN_COST = getTokenCost('chat_long');

// Matches /api/chat's budget (API_MAX_DURATION_CHAT_S) rather than the
// default 30s CRUD budget — a decomposition is a comparable single-shot
// generation call, not a database round trip.
export const maxDuration = 120;

const requestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  projectType: z.enum(['2d', '3d']),
});

async function POST_impl(req: NextRequest) {
  // BotID gate (PF-975 / #8948 pattern) — before any rate-limit consumption
  // or token deduction, so a blocked bot never spends either budget.
  const botIdResponse = await checkBotIdGate();
  if (botIdResponse) return botIdResponse;

  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `game-decompose:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;
  const auth = { ctx: mid.authContext! };

  // Tier gate — starter tier has no AI access (parity with /api/chat).
  const tierError = assertTier(auth.ctx.user, ['hobbyist', 'creator', 'pro']);
  if (tierError) return tierError;

  // Provider kill switch (PF-971 / #8952) — checked before token deduction
  // so a killed provider costs the caller nothing. Fails open when flag
  // evaluation is dormant or errors (see posthogFlags.ts).
  if (isProviderKilled('anthropic')) {
    return NextResponse.json(
      { error: 'AI generation is temporarily unavailable. Please try again shortly.' },
      { status: 503 },
    );
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return redactedJson(
      { error: 'validation_error', details: ['Invalid JSON body'] },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'validation_error',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const { prompt, projectType } = parsed.data;

  // Meter the call against the user's token balance. decomposeIntoSystems
  // resolves the provider itself via resolveBackendWithCircuitBreaker
  // (platform-routed, not this key) — resolveApiKey here is billing-only:
  // deduct up front, refund on any failure below (including a content-safety
  // rejection inside decomposeIntoSystems, which runs after this deduction).
  let usageId: string | undefined;
  try {
    const resolved = await resolveApiKey(
      auth.ctx.user.id,
      'anthropic',
      DECOMPOSE_TOKEN_COST,
      'game_decompose',
      { projectType },
    );
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return redactedJson({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  try {
    const gdd = await decomposeIntoSystems(prompt, projectType);

    return NextResponse.json({ gdd });
  } catch (err) {
    if (usageId) {
      await refundTokens(auth.ctx.user.id, usageId).catch((refundErr: unknown) => {
        captureException(refundErr, { route: '/api/game/decompose', phase: 'refund', usageId });
      });
    }

    // Prompt rejection is a 400, not a 500, and its text is OURS — written by
    // `sanitizePrompt` for the user — so it is returned verbatim. Narrowed by
    // type rather than by a message prefix: an upstream error could produce
    // that prefix too, and every other caught error must not reach the client
    // (#9736).
    if (err instanceof PromptRejectedError) {
      return redactedJson(
        { error: 'prompt_rejected', message: err.message },
        { status: 400 },
      );
    }

    const message = err instanceof Error ? err.message : String(err);

    captureException(err instanceof Error ? err : new Error(message), {
      extra: { endpoint: 'POST /api/game/decompose', projectType },
    });

    // Everything else is an internal/provider failure — the real message is
    // already on the Sentry event above; don't forward it to the client,
    // where it could carry backend identifiers or stack fragments.
    return redactedJson(
      { error: 'decomposition_failed', message: 'Failed to generate game design. Please try again.' },
      { status: 500 },
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
