/**
 * Regression guard for the AI SDK v7 → Sentry telemetry bridge (#8855).
 *
 * v7 stopped building OpenTelemetry spans itself, but it STILL publishes
 * AI-generation telemetry to a Node `diagnostics_channel.tracingChannel` named
 * `ai:telemetry` whenever `experimental_telemetry.isEnabled` is set AND the
 * channel already has a subscriber. `@sentry/nextjs`'s version-agnostic
 * `vercel-ai` diagnostics-channel subscriber consumes exactly that channel —
 * which is why this migration deliberately does NOT add `@ai-sdk/otel` (that
 * would double-emit).
 *
 * This test pins that contract against the REAL `ai` package (NO vi.mock, unlike
 * aiSdkAdapter.test.ts): enabling telemetry publishes to `ai:telemetry`;
 * disabling it stays silent. If a future `ai` bump renamed the channel or
 * dropped the diagnostics_channel path, Sentry AI spans would silently stop —
 * and this test fails first, instead of us discovering blank AI traces in prod.
 *
 * IMPORTANT: ai@7 early-returns from the publish path unless the channel already
 * has a subscriber (the `hasSubscribers` gate), so the subscription MUST be in
 * place BEFORE streamText is called.
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import diagnostics_channel from 'node:diagnostics_channel';
import { streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';

// Constant is `AI_SDK_TELEMETRY_TRACING_CHANNEL` inside `ai`; kept literal here
// so a rename upstream trips this test rather than silently tracking the export.
const AI_SDK_TELEMETRY_CHANNEL = 'ai:telemetry';

/** A model that streams a single "Hello" turn over a mock readable stream. */
function makeMockModel(): MockLanguageModelV4 {
  // Typed as the v4 provider stream-part union so tsc validates the finish
  // part's rich `usage`/`finishReason` object shapes (not the v6 flat form).
  const chunks: LanguageModelV4StreamPart[] = [
    { type: 'text-start', id: '1' },
    { type: 'text-delta', id: '1', delta: 'Hello' },
    { type: 'text-end', id: '1' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
    },
  ];
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

describe('AI SDK v7 telemetry diagnostics_channel bridge (#8855)', () => {
  it('publishes AI-generation spans to `ai:telemetry` when telemetry is enabled', async () => {
    const channel = diagnostics_channel.tracingChannel(AI_SDK_TELEMETRY_CHANNEL);
    const seen = { start: 0, end: 0, asyncStart: 0, asyncEnd: 0, error: 0 };
    const handlers = {
      start: () => { seen.start++; },
      end: () => { seen.end++; },
      asyncStart: () => { seen.asyncStart++; },
      asyncEnd: () => { seen.asyncEnd++; },
      error: () => { seen.error++; },
    };
    channel.subscribe(handlers);
    try {
      // The subscriber must exist BEFORE the call — ai@7 gates publishing on
      // `tracingChannel.<sub>.hasSubscribers`.
      expect(channel.start.hasSubscribers).toBe(true);

      const result = streamText({
        model: makeMockModel(),
        prompt: 'hi',
        experimental_telemetry: { isEnabled: true },
      });

      let text = '';
      for await (const delta of result.textStream) text += delta;
      await result.finishReason;

      expect(text).toBe('Hello');
      // The bridge fired: at least one span opened and closed on the channel.
      expect(seen.start).toBeGreaterThan(0);
      expect(seen.end).toBeGreaterThan(0);
      expect(seen.error).toBe(0);
    } finally {
      channel.unsubscribe(handlers);
    }
  });

  it('stays silent on `ai:telemetry` when telemetry is disabled', async () => {
    const channel = diagnostics_channel.tracingChannel(AI_SDK_TELEMETRY_CHANNEL);
    const seen = { start: 0, end: 0, asyncStart: 0, asyncEnd: 0, error: 0 };
    const handlers = {
      start: () => { seen.start++; },
      end: () => { seen.end++; },
      asyncStart: () => { seen.asyncStart++; },
      asyncEnd: () => { seen.asyncEnd++; },
      error: () => { seen.error++; },
    };
    channel.subscribe(handlers);
    try {
      const result = streamText({
        model: makeMockModel(),
        prompt: 'hi',
        experimental_telemetry: { isEnabled: false },
      });

      let text = '';
      for await (const delta of result.textStream) text += delta;
      await result.finishReason;

      // Generation still works; it just does not emit telemetry.
      expect(text).toBe('Hello');
      expect(seen.start).toBe(0);
      expect(seen.end).toBe(0);
    } finally {
      channel.unsubscribe(handlers);
    }
  });
});
