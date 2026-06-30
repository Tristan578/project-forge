import 'server-only';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Server-side PostHog LLM observability — content-free `$ai_generation` capture
 * (PF-907 / #8817).
 *
 * We deliberately do NOT use `posthog-node` or the OpenTelemetry
 * `PostHogSpanProcessor`. Sentry owns the server OTel provider, and adding a
 * runtime dependency triggers the single-root-lockfile / Node-24-relock pain
 * this repo has hit repeatedly. Server LLM events are low-volume (one per chat
 * step / generate call), so a dependency-free `fetch` to PostHog's public
 * capture endpoint is sufficient, simpler to keep dormant, and private by
 * construction — see specs/2026-06-29-posthog-llm-observability.md.
 *
 * THREE invariants this module enforces:
 *   1. DORMANT unless `POSTHOG_LLM_CAPTURE === 'true'` AND a project key is set.
 *      Enabling client analytics alone does NOT activate server capture.
 *   2. CONSENT-gated (PF-30) — `captureAiGeneration` is a no-op unless the caller
 *      passes `consented: true` (resolve via `hasAnalyticsConsent()`).
 *   3. PRIVATE — the payload NEVER carries `$ai_input` / `$ai_output_choices`
 *      (the only `$ai_*` props that hold prompt/response content). The cost,
 *      token, latency, model, and error dashboards all render without them.
 */

/** PostHog public capture endpoint (US cloud). Project-token authenticated. */
const CAPTURE_URL = 'https://us.i.posthog.com/i/v0/e/';

/**
 * Hard ceiling on each capture POST. A single localize request can schedule up
 * to ~100 `after()` callbacks (per-chunk × per-locale); without a timeout a
 * SLOW (not down) PostHog would hold each callback's serverless compute open
 * until the route's maxDuration. The cap bounds that to 5s per event.
 */
const CAPTURE_TIMEOUT_MS = 5000;

/** Server-readable mirror of the client consent choice (set by CookieConsent). */
const CONSENT_COOKIE = 'forge-cookie-consent';

export interface AiGenerationInput {
  /** Clerk user id — PostHog `distinct_id`. */
  distinctId: string;
  /** Whether the user has consented to analytics (PF-30). Resolve via hasAnalyticsConsent(). */
  consented: boolean;
  /** Groups related generations into one trace (e.g. a per-request id or usageId). */
  traceId: string;
  /** Canonical / resolved model id (e.g. 'claude-haiku-4-5'). */
  model: string;
  /** LLM provider (e.g. 'anthropic'). */
  provider: string;
  /** Prompt token count, if known. */
  inputTokens?: number;
  /** Completion token count, if known. */
  outputTokens?: number;
  /** Wall-clock latency in SECONDS (PostHog `$ai_latency` unit), if measured. */
  latencySeconds?: number;
  /** Whether the generation was streamed. */
  stream?: boolean;
  /** Whether the generation errored. */
  isError?: boolean;
  /** Logical route/path for grouping in insights (custom prop, non-content). */
  route: string;
  /** Anthropic prompt-cache read tokens, if known (chat path). */
  cacheReadInputTokens?: number;
  /** Anthropic prompt-cache creation tokens, if known (chat path). */
  cacheCreationInputTokens?: number;
}

/**
 * True only when the dedicated server flag is exactly `"true"` AND a PostHog
 * project key is present. No code change activates capture — it is env-only.
 */
export function isLlmCaptureEnabled(): boolean {
  return (
    process.env.POSTHOG_LLM_CAPTURE === 'true' &&
    !!process.env.NEXT_PUBLIC_POSTHOG_KEY
  );
}

/**
 * Read the server-readable consent cookie. Returns `true` only when the value is
 * exactly `'true'`. Fails closed (returns `false`) outside a request scope.
 */
export async function hasAnalyticsConsent(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(CONSENT_COOKIE)?.value === 'true';
  } catch {
    // No request scope (e.g. background task) → treat as not consented.
    return false;
  }
}

/**
 * Build the `$ai_generation` capture body, or `null` when dormant / unconsented.
 * Pure and side-effect-free so the privacy + dormancy guarantees are unit-testable.
 *
 * PRIVACY: deliberately omits `$ai_input` and `$ai_output_choices` — the content
 * fields. Only non-content metrics are emitted.
 */
export function buildAiGenerationPayload(
  input: AiGenerationInput,
): Record<string, unknown> | null {
  if (!isLlmCaptureEnabled() || !input.consented) return null;
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;

  const properties: Record<string, unknown> = {
    $ai_trace_id: input.traceId,
    $ai_model: input.model,
    $ai_provider: input.provider,
    route: input.route,
  };
  if (Number.isFinite(input.inputTokens)) properties.$ai_input_tokens = input.inputTokens;
  if (Number.isFinite(input.outputTokens)) properties.$ai_output_tokens = input.outputTokens;
  if (Number.isFinite(input.latencySeconds)) properties.$ai_latency = input.latencySeconds;
  if (typeof input.stream === 'boolean') properties.$ai_stream = input.stream;
  if (typeof input.isError === 'boolean') properties.$ai_is_error = input.isError;
  if (Number.isFinite(input.cacheReadInputTokens)) {
    properties.$ai_cache_read_input_tokens = input.cacheReadInputTokens;
  }
  if (Number.isFinite(input.cacheCreationInputTokens)) {
    properties.$ai_cache_creation_input_tokens = input.cacheCreationInputTokens;
  }

  return {
    api_key: apiKey,
    event: '$ai_generation',
    distinct_id: input.distinctId,
    properties,
  };
}

/**
 * Capture a single `$ai_generation` event. No-op when dormant or unconsented.
 * The POST is fired after the response via `after()` so it never adds request
 * latency and survives serverless freeze. NEVER throws — any failure (including
 * being called outside a request scope) is reported to Sentry and swallowed.
 */
export function captureAiGeneration(input: AiGenerationInput): void {
  const payload = buildAiGenerationPayload(input);
  if (!payload) return;

  try {
    after(async () => {
      try {
        await fetch(CAPTURE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
        });
      } catch (err) {
        captureException(err, { route: 'posthog_ai_capture', phase: 'fetch' });
      }
    });
  } catch (err) {
    // `after()` throws if there is no active request scope — never fail the caller.
    captureException(err, { route: 'posthog_ai_capture', phase: 'schedule' });
  }
}
