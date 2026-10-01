import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same isolation as sentryConfig.test.ts: the module under test imports
// @sentry/nextjs for fingerprinting, which these cases never exercise.
vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: vi.fn(),
}));

import type * as SentryTypes from '@sentry/nextjs';
import { scrubSentrySpan, scrubStreamedSpan, setSentryDeepRedactor } from '../sentryConfig';
import { redactSecrets, resetSecretEnvCache } from '@/lib/security/redactSecrets';
import { redactShapeText } from '@/lib/security/redactShapes';

/**
 * The span shape `beforeSendSpan` receives under @sentry v11 (span streaming,
 * the default lifecycle). Derived from the installed SDK's own option type, so
 * a shape change upstream breaks these fixtures at `tsc` instead of drifting.
 */
type SpanHook = NonNullable<NonNullable<Parameters<typeof SentryTypes.init>[0]>['beforeSendSpan']>;
type StreamedSpan = Parameters<SpanHook>[0];

// Compile-time pin: the exported hook is a valid `beforeSendSpan` for the
// installed SDK.
const hookCompatibility: SpanHook = scrubSentrySpan;

function makeSpan(overrides: Partial<StreamedSpan> = {}): StreamedSpan {
  return {
    trace_id: '0123456789abcdef0123456789abcdef',
    span_id: '0123456789abcdef',
    name: 'GET /api/generate/model',
    start_timestamp: 1,
    end_timestamp: 2,
    status: 'ok',
    is_segment: true,
    attributes: { 'sentry.op': 'http.server' },
    ...overrides,
  } as StreamedSpan;
}

const ANTHROPIC_KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('scrubSentrySpan (beforeSendSpan, @sentry v11 streamed spans)', () => {
  it('is the same function as the internal scrubber and a valid SDK hook', () => {
    expect(scrubSentrySpan).toBe(scrubStreamedSpan);
    expect(typeof hookCompatibility).toBe('function');
  });

  it('strips a credential-shaped query string from every URL attribute', () => {
    const span = makeSpan({
      attributes: {
        'sentry.op': 'http.client',
        'url.full': 'https://api.example.com/v1/generate?token=abc123secret&id=7#frag',
        'http.url': 'https://api.example.com/v1/chat?access_token=zzz',
        'http.target': '/v1/chat?session=xyz',
        'url.query': 'token=abc123secret&id=7',
        'http.query': 'api_key=qqq',
        'url.fragment': 'access_token=fff',
      },
    });

    const out = scrubSentrySpan(span);
    const serialized = JSON.stringify(out);

    expect(out.attributes['url.full']).toBe('https://api.example.com/v1/generate');
    expect(out.attributes['http.url']).toBe('https://api.example.com/v1/chat');
    expect(out.attributes['http.target']).toBe('/v1/chat');
    expect(out.attributes['url.query']).toBe('[REDACTED]');
    expect(out.attributes['http.query']).toBe('[REDACTED]');
    expect(out.attributes['url.fragment']).toBe('[REDACTED]');
    for (const leaked of ['abc123secret', 'access_token=zzz', 'session=xyz', 'api_key=qqq', 'fff']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('rewrites URL attributes given in attribute-object form ({ value })', () => {
    const span = makeSpan({
      attributes: {
        'url.full': { value: 'https://api.example.com/x?token=abc123secret', type: 'string' },
        'url.query': { value: 'token=abc123secret', type: 'string' },
      } as unknown as StreamedSpan['attributes'],
    });
    const out = scrubSentrySpan(span);
    expect(JSON.stringify(out)).not.toContain('abc123secret');
    expect((out.attributes['url.full'] as { value: string }).value).toBe('https://api.example.com/x');
  });

  it('redacts an sk-ant- key in the name, attribute values and link attributes', () => {
    const span = makeSpan({
      name: `POST /v1/messages ${ANTHROPIC_KEY}`,
      attributes: {
        'sentry.op': 'http.client',
        'error.message': `401 Unauthorized: invalid x-api-key ${ANTHROPIC_KEY}`,
        'gen_ai.request.model': 'claude-sonnet-5',
        nested: { detail: [`key=${ANTHROPIC_KEY}`] },
      } as unknown as StreamedSpan['attributes'],
      links: [
        {
          trace_id: '0123456789abcdef0123456789abcdef',
          span_id: 'fedcba9876543210',
          attributes: { reason: `retry after ${ANTHROPIC_KEY}` },
        },
      ] as StreamedSpan['links'],
    });

    const out = scrubSentrySpan(span);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain(ANTHROPIC_KEY);
    expect(serialized).not.toContain('sk-ant-');
    expect(out.name).toContain('[REDACTED_API_KEY]');
    // Non-secret attributes survive, so the span stays useful.
    expect(out.attributes['gen_ai.request.model']).toBe('claude-sonnet-5');
    expect(out.attributes['sentry.op']).toBe('http.client');
  });

  it('redacts attributes whose KEY is sensitive, whatever the value looks like', () => {
    const span = makeSpan({
      attributes: {
        'http.request.header.authorization': ['Basic dXNlcjpwYXNz'],
        'http.request.header.cookie': ['session=opaque-value'],
        'user.email': 'person@example.com',
        'user.name': 'Some Person',
        'user.username': 'someperson',
        'user.id': 'user_123',
      } as unknown as StreamedSpan['attributes'],
    });
    const out = scrubSentrySpan(span);
    expect(out.attributes['http.request.header.authorization']).toBe('[REDACTED]');
    expect(out.attributes['http.request.header.cookie']).toBe('[REDACTED]');
    expect(out.attributes['user.email']).toBe('[REDACTED]');
    expect(out.attributes['user.name']).toBe('[REDACTED]');
    expect(out.attributes['user.username']).toBe('[REDACTED]');
    // Kept for correlation, as on the event, log and metric paths.
    expect(out.attributes['user.id']).toBe('user_123');
  });

  it('returns a clean span unchanged and as the same object', () => {
    const span = makeSpan({
      name: 'GET /api/projects/[id]',
      attributes: {
        'sentry.op': 'http.server',
        'url.full': 'https://spawnforge.ai/api/projects/abc',
        'url.query': '',
        'http.response.status_code': 200,
        'gen_ai.usage.input_tokens': 1234,
        'http.request.same_origin': true,
      } as unknown as StreamedSpan['attributes'],
      links: [{ trace_id: 't', span_id: 's', attributes: { 'sentry.link.type': 'previous_trace' } }] as StreamedSpan['links'],
    });
    const before = structuredClone(span);

    const out = scrubSentrySpan(span);

    expect(out).toBe(span);
    expect(out).toEqual(before);
  });
});

describe('scrubSentrySpan removes environment secret values (server deep redactor)', () => {
  const SECRET = 'not-a-known-shape-just-a-platform-secret-42';

  beforeEach(() => {
    setSentryDeepRedactor((input: string) => redactSecrets(input) as string);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSecretEnvCache();
    setSentryDeepRedactor(redactShapeText);
  });

  it('removes it from the span name and attributes', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const out = scrubSentrySpan(
      makeSpan({
        name: `meshy status ${SECRET}`,
        attributes: { 'error.message': `upstream said ${SECRET}` },
      }),
    );
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});
