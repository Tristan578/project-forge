/**
 * Unified AI client for SpawnForge feature modules.
 *
 * Replaces the pattern of each AI module calling fetch('/api/chat') directly
 * with SSE parsing duplicated in every file. All modules should import
 * `fetchAI` or `streamAI` from here instead.
 */

import { streamChat, type StreamCallbacks } from './streaming';
import { aiQueue, type Priority } from './requestQueue';
import { aiResponseCache } from './promptCache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIClientOptions {
  /** AI model identifier. Defaults to the server-side default model. */
  model?: string;
  /** Override the system prompt for this request. */
  systemOverride?: string;
  /** Serialised scene context injected into the system prompt. */
  sceneContext?: string;
  /** Enable extended thinking mode (Claude 3.7+). */
  thinking?: boolean;
  /** AbortSignal to cancel the in-flight request. */
  signal?: AbortSignal;
  /**
   * Request priority for the shared AI queue.
   *   1 — user-initiated (default for fetchAI/streamAI)
   *   2 — panel/feature triggered
   *   3 — background analysis
   * Lower number = dispatched first.
   */
  priority?: Priority;
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

/**
 * Map HTTP status codes and known error strings to user-friendly messages.
 * This keeps error messages consistent across all feature modules.
 */
function mapError(err: unknown): Error {
  if (err instanceof Error) {
    const msg = err.message;

    // Re-map known server-side error strings
    if (
      msg.includes('429') ||
      msg.toLowerCase().includes('rate limit') ||
      msg.toLowerCase().includes('too many requests')
    ) {
      return new Error('Rate limit reached — please wait a moment and try again.');
    }
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return new Error('Authentication required — please sign in and try again.');
    }
    if (msg.includes('402') || msg.toLowerCase().includes('insufficient credits')) {
      return new Error('Insufficient credits — please top up your balance to continue.');
    }
    if (msg.includes('500') || msg.toLowerCase().includes('internal server')) {
      return new Error('AI service error — the request failed on the server. Please try again.');
    }
    if (msg.includes('503') || msg.toLowerCase().includes('service unavailable')) {
      return new Error('AI service temporarily unavailable — please try again in a few seconds.');
    }
    if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('abort')) {
      return new Error('Request cancelled.');
    }

    return err;
  }
  return new Error('An unexpected error occurred. Please try again.');
}

// ---------------------------------------------------------------------------
// fetchAI — non-streaming, returns the complete response text
// ---------------------------------------------------------------------------

/**
 * Send a prompt to /api/chat and return the full response text.
 *
 * Non-signal requests are eligible for response caching and in-flight
 * deduplication via AIResponseCache. All requests are routed through the
 * shared `aiQueue` so concurrent AI module calls are capped and dispatched
 * in priority order.
 *
 * Use this for short one-shot requests where streaming is not needed
 * (e.g. generating a JSON blob, validating a design, classifying content).
 *
 * @throws {Error} On HTTP error, stream error, abort, or queue backpressure.
 */
export async function fetchAI(prompt: string, options?: AIClientOptions): Promise<string> {
  const {
    model = 'claude-sonnet-4-5',
    systemOverride,
    sceneContext = '',
    signal,
  } = options ?? {};

  // Non-streaming requests are eligible for caching.
  // Streaming requests (streamAI) are intentionally excluded because callers
  // expect incremental callbacks, not a single cached string.
  //
  // AbortSignal-controlled requests skip the cache so that a cancelled
  // request cannot poison the cache with a partial result.
  if (!signal) {
    const cacheKey = await aiResponseCache.computeKey(
      model,
      systemOverride ?? '',
      `${sceneContext}\x00${prompt}`,
    );
    return aiResponseCache.dedup(cacheKey, () => fetchAIUncached(prompt, options));
  }

  return fetchAIUncached(prompt, options);
}

async function fetchAIUncached(prompt: string, options?: AIClientOptions): Promise<string> {
  const {
    model = 'claude-sonnet-4-5',
    systemOverride,
    sceneContext = '',
    thinking = false,
    signal,
    priority = 1,
  } = options ?? {};

  return aiQueue.enqueue(async () => {
    // Attach abort to the fetch call so cancellation propagates
    const fetchOptions: RequestInit = { signal };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model,
          sceneContext,
          thinking,
          ...(systemOverride !== undefined ? { systemOverride } : {}),
        }),
        ...fetchOptions,
      });

      if (!response.ok) {
        let errorMsg = `Chat request failed: ${response.status}`;
        try {
          const errorData = (await response.json()) as Record<string, unknown>;
          if (typeof errorData.error === 'string') errorMsg = errorData.error;
        } catch {
          /* non-JSON body */
        }
        throw new Error(errorMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body from /api/chat');

      // Reuse the canonical stream reader — handles both legacy and AI SDK formats
      const { readSSEStream, readAiSdkStream, isAiSdkStream } = await import('./streaming');
      if (isAiSdkStream(response)) {
        return await readAiSdkStream(reader);
      }
      return await readSSEStream(reader);
    } catch (err) {
      throw mapError(err);
    }
  }, priority, signal);
}

// ---------------------------------------------------------------------------
// streamAI — streaming, fires callbacks for each chunk
// ---------------------------------------------------------------------------

/**
 * Send a prompt to /api/chat and stream the response text as it arrives.
 *
 * Requests are routed through the shared `aiQueue` so concurrent AI module
 * calls are capped and dispatched in priority order.
 *
 * Use this for long-form generation where the UI should update progressively
 * (e.g. GDD generation, narrative arcs, level descriptions).
 *
 * Returns the complete accumulated text when the stream finishes.
 *
 * @throws {Error} On HTTP error, stream error, abort, or queue backpressure.
 */
export async function streamAI(
  prompt: string,
  options?: AIClientOptions,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const {
    model = 'claude-sonnet-4-5',
    systemOverride,
    sceneContext = '',
    thinking = false,
    signal,
    priority = 1,
  } = options ?? {};

  return aiQueue.enqueue(async () => {
    try {
      return await streamChat({
        messages: [{ role: 'user', content: prompt }],
        model,
        sceneContext,
        thinking,
        ...(systemOverride !== undefined ? { systemOverride } : {}),
        callbacks,
        // Note: streamChat does not yet accept signal — callers can cancel via
        // the shared AbortController and the stream reader will throw on abort.
        // Future: thread signal through streamChat when the API supports it.
      });
    } catch (err) {
      // Ignore abort errors silently — the caller already knows they cancelled
      if (err instanceof Error && (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'))) {
        return '';
      }
      throw mapError(err);
    }
  }, priority, signal);
}
