import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/nextjs before importing the module under test so that
// addEventProcessor is captured without running any real Sentry init.
vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';

import {
  configureSentryFingerprinting,
  fingerprintEvent,
  extractProvider,
  extractWasmCommand,
  extractGenerationType,
  extractAuthCode,
  isTimeoutError,
  isRateLimitError,
  isAuthError,
  isWasmError,
  isGenerationError,
  scrubEvent,
  scrubSentryLog,
  scrubString,
  deepScrub,
} from '../sentryConfig';
import type { Event } from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    exception: undefined,
    message: undefined,
    transaction: undefined,
    request: undefined,
    tags: {},
    fingerprint: undefined,
    ...overrides,
  };
}

function makeExceptionEvent(message: string, type = 'Error'): Event {
  return makeEvent({
    exception: {
      values: [{ value: message, type }],
    },
  });
}

// ---------------------------------------------------------------------------
// configureSentryFingerprinting — wiring
// ---------------------------------------------------------------------------

describe('configureSentryFingerprinting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers an event processor with Sentry', () => {
    configureSentryFingerprinting();
    expect(Sentry.addEventProcessor).toHaveBeenCalledOnce();
    expect(typeof (Sentry.addEventProcessor as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Helper predicates
// ---------------------------------------------------------------------------

describe('isTimeoutError', () => {
  it('matches "timeout"', () => expect(isTimeoutError('Request timeout')).toBe(true));
  it('matches "timed out"', () => expect(isTimeoutError('Operation timed out')).toBe(true));
  it('matches "ECONNRESET"', () => expect(isTimeoutError('ECONNRESET')).toBe(true));
  it('matches "socket hang"', () => expect(isTimeoutError('socket hang up')).toBe(true));
  it('does not match unrelated error', () => expect(isTimeoutError('Internal Server Error')).toBe(false));
});

describe('isRateLimitError', () => {
  it('matches "rate limit"', () => expect(isRateLimitError('rate limit exceeded')).toBe(true));
  it('matches "too many requests"', () => expect(isRateLimitError('Too Many Requests')).toBe(true));
  it('matches "429"', () => expect(isRateLimitError('HTTP 429')).toBe(true));
  it('does not match unrelated error', () => expect(isRateLimitError('404 not found')).toBe(false));
});

describe('isAuthError', () => {
  it('matches "unauthorized"', () => expect(isAuthError('Unauthorized')).toBe(true));
  it('matches "invalid api key"', () => expect(isAuthError('invalid api key')).toBe(true));
  it('matches "insufficient_tokens"', () => expect(isAuthError('insufficient tokens')).toBe(true));
  it('matches "token expired"', () => expect(isAuthError('token expired')).toBe(true));
  it('does not match unrelated error', () => expect(isAuthError('Network error')).toBe(false));
});

describe('isWasmError', () => {
  it('matches "wasm" in message', () => expect(isWasmError('WASM command failed')).toBe(true));
  it('matches "handle_command" in message', () => expect(isWasmError('handle_command panic')).toBe(true));
  it('matches transaction containing "wasm"', () => expect(isWasmError('unrelated', 'wasm_init')).toBe(true));
  it('does not match plain message without transaction', () => expect(isWasmError('network error')).toBe(false));
});

describe('isGenerationError', () => {
  it('matches /api/generate/ URL', () => expect(isGenerationError('/api/generate/sprite')).toBe(true));
  it('matches full URL with /api/generate/', () =>
    expect(isGenerationError('https://app.example.com/api/generate/music')).toBe(true));
  it('returns false for non-generate URL', () => expect(isGenerationError('/api/chat')).toBe(false));
  it('returns false for undefined', () => expect(isGenerationError(undefined)).toBe(false));
});

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

describe('extractProvider', () => {
  it('extracts anthropic', () => expect(extractProvider('Anthropic API error')).toBe('anthropic'));
  it('extracts openai', () => expect(extractProvider('OpenAI rate limit')).toBe('openai'));
  it('extracts openai from dalle reference', () => expect(extractProvider('DALL-E quota exceeded')).toBe('openai'));
  it('extracts elevenlabs', () => expect(extractProvider('ElevenLabs TTS error')).toBe('elevenlabs'));
  it('extracts suno', () => expect(extractProvider('Suno music gen failed')).toBe('suno'));
  it('extracts meshy', () => expect(extractProvider('Meshy 3D model error')).toBe('meshy'));
  it('extracts openrouter', () => expect(extractProvider('OpenRouter gateway error')).toBe('openrouter'));
  it('returns unknown_provider for unrecognized text', () => expect(extractProvider('Something else')).toBe('unknown_provider'));
});

describe('extractWasmCommand', () => {
  it('extracts command from structured message', () =>
    expect(extractWasmCommand('WASM command failed: spawn_entity')).toBe('spawn_entity'));
  it('extracts command from "wasm cmd error: update_material"', () =>
    expect(extractWasmCommand('wasm cmd error update_material')).toBe('update_material'));
  it('falls back to transaction if it looks like a command', () =>
    expect(extractWasmCommand('engine panic', 'delete_entities')).toBe('delete_entities'));
  it('returns unknown_command if nothing matches', () =>
    expect(extractWasmCommand('unknown panic')).toBe('unknown_command'));
});

describe('extractGenerationType', () => {
  it('extracts sprite from URL', () =>
    expect(extractGenerationType('https://app.example.com/api/generate/sprite')).toBe('sprite'));
  it('extracts music from URL', () =>
    expect(extractGenerationType('/api/generate/music?v=1')).toBe('music'));
  it('extracts model from URL', () =>
    expect(extractGenerationType('/api/generate/model')).toBe('model'));
  it('returns unknown_type for non-generate URL', () =>
    expect(extractGenerationType('/api/chat')).toBe('unknown_type'));
});

describe('extractAuthCode', () => {
  it('extracts INSUFFICIENT_TOKENS', () =>
    expect(extractAuthCode('INSUFFICIENT_TOKENS: you have 0 left')).toBe('INSUFFICIENT_TOKENS'));
  it('extracts INVALID_KEY', () =>
    expect(extractAuthCode('INVALID_KEY provided')).toBe('INVALID_KEY'));
  it('returns AUTH_UNKNOWN when no code found', () =>
    expect(extractAuthCode('some vague auth failure')).toBe('AUTH_UNKNOWN'));
  it('extracts HTTP_401 for 401 status messages (regression PF-825)', () =>
    expect(extractAuthCode('HTTP 401 Unauthorized')).toBe('HTTP_401'));
  it('extracts HTTP_403 for 403 status messages (regression PF-825)', () =>
    expect(extractAuthCode('403 Forbidden')).toBe('HTTP_403'));
  it('does NOT extract 5xx codes as auth codes (regression PF-825)', () =>
    expect(extractAuthCode('500 Internal Server Error')).toBe('AUTH_UNKNOWN'));
  it('does NOT extract 5403 as an auth code (regression PF-825)', () =>
    expect(extractAuthCode('error code 5403')).toBe('AUTH_UNKNOWN'));
});

describe('isAuthError (regression PF-825)', () => {
  it('matches standalone 401 with word boundary', () =>
    expect(isAuthError('HTTP 401 Unauthorized')).toBe(true));
  it('matches standalone 403 with word boundary', () =>
    expect(isAuthError('403 Forbidden')).toBe(true));
  it('does NOT match 5403 as an auth error', () =>
    expect(isAuthError('error code 5403')).toBe(false));
  it('does NOT match 14010 as an auth error', () =>
    expect(isAuthError('reference 14010')).toBe(false));
});

// ---------------------------------------------------------------------------
// fingerprintEvent — end-to-end grouping
// ---------------------------------------------------------------------------

describe('fingerprintEvent', () => {
  describe('rate limit errors', () => {
    it('groups all rate limit errors under a single fingerprint', () => {
      const event = fingerprintEvent(makeExceptionEvent('Anthropic rate limit exceeded 429'));
      expect(event.fingerprint).toEqual(['rate-limit-exceeded']);
      expect(event.tags?.error_class).toBe('rate_limit');
    });

    it('groups OpenAI rate limit under same fingerprint', () => {
      const event = fingerprintEvent(makeExceptionEvent('OpenAI Too Many Requests'));
      expect(event.fingerprint).toEqual(['rate-limit-exceeded']);
    });
  });

  describe('auth errors', () => {
    it('groups by error code', () => {
      const event = fingerprintEvent(makeExceptionEvent('INSUFFICIENT_TOKENS: balance is 0'));
      expect(event.fingerprint).toEqual(['auth-error', 'INSUFFICIENT_TOKENS']);
      expect(event.tags?.error_class).toBe('auth');
    });

    it('uses AUTH_UNKNOWN when no code is present', () => {
      const event = fingerprintEvent(makeExceptionEvent('unauthorized request'));
      expect(event.fingerprint).toEqual(['auth-error', 'AUTH_UNKNOWN']);
    });
  });

  describe('WASM errors', () => {
    it('groups by command type', () => {
      const event = fingerprintEvent(makeExceptionEvent('WASM command failed: spawn_entity'));
      expect(event.fingerprint).toEqual(['wasm-command-failure', 'spawn_entity']);
      expect(event.tags?.error_class).toBe('wasm');
      expect(event.tags?.wasm_command).toBe('spawn_entity');
    });

    it('uses transaction as fallback command name', () => {
      const event = fingerprintEvent({
        ...makeExceptionEvent('engine panic'),
        transaction: 'delete_entities',
      });
      expect(event.fingerprint).toEqual(['wasm-command-failure', 'delete_entities']);
    });
  });

  describe('generation errors', () => {
    it('groups by generation type', () => {
      const event = fingerprintEvent({
        ...makeExceptionEvent('Generation failed'),
        request: { url: 'https://app.example.com/api/generate/music' },
      });
      expect(event.fingerprint).toEqual(['generation-failure', 'music']);
      expect(event.tags?.error_class).toBe('generation');
      expect(event.tags?.generation_type).toBe('music');
    });

    it('handles sprite generation', () => {
      const event = fingerprintEvent({
        ...makeExceptionEvent('Provider error'),
        request: { url: '/api/generate/sprite' },
      });
      expect(event.fingerprint).toEqual(['generation-failure', 'sprite']);
    });
  });

  describe('AI provider timeouts', () => {
    it('groups by provider name', () => {
      const event = fingerprintEvent(makeExceptionEvent('Anthropic request timeout'));
      expect(event.fingerprint).toEqual(['ai-provider-timeout', 'anthropic']);
      expect(event.tags?.error_class).toBe('timeout');
      expect(event.tags?.ai_provider).toBe('anthropic');
    });

    it('uses unknown_provider when provider cannot be identified', () => {
      const event = fingerprintEvent(makeExceptionEvent('Operation timed out'));
      expect(event.fingerprint).toEqual(['ai-provider-timeout', 'unknown_provider']);
    });
  });

  describe('generic AI provider errors', () => {
    it('groups by provider + exception type', () => {
      const event = fingerprintEvent(makeExceptionEvent(
        'Anthropic API returned 500 for request abc-123-xyz',
        'APIError',
      ));
      expect(event.fingerprint).toEqual(['ai-provider-error', 'anthropic', 'APIError']);
      expect(event.tags?.error_class).toBe('ai_provider');
    });

    it('groups distinct messages from the same provider into the same bucket', () => {
      const event1 = fingerprintEvent(makeExceptionEvent('OpenAI error ref=abc111', 'NetworkError'));
      const event2 = fingerprintEvent(makeExceptionEvent('OpenAI error ref=xyz999', 'NetworkError'));
      expect(event1.fingerprint).toEqual(event2.fingerprint);
    });
  });

  describe('fallthrough (default Sentry fingerprinting)', () => {
    it('does not set a fingerprint for unrelated errors', () => {
      const event = fingerprintEvent(makeExceptionEvent('Cannot read property of undefined'));
      // fingerprintEvent should return the event unchanged when no rule matches
      expect(event.fingerprint).toBeUndefined();
    });

    it('preserves existing tags on the event', () => {
      const event = fingerprintEvent({
        ...makeExceptionEvent('rate limit'),
        tags: { env: 'production' },
      });
      expect(event.tags?.env).toBe('production');
      expect(event.fingerprint).toEqual(['rate-limit-exceeded']);
    });
  });

  describe('priority ordering', () => {
    it('rate limit takes priority over auth even if message mentions both', () => {
      const event = fingerprintEvent(makeExceptionEvent('rate limit — unauthorized'));
      expect(event.fingerprint).toEqual(['rate-limit-exceeded']);
    });

    it('auth takes priority over WASM when both keywords appear', () => {
      const event = fingerprintEvent(makeExceptionEvent('unauthorized WASM call'));
      expect(event.fingerprint?.[0]).toBe('auth-error');
    });
  });
});

// ---------------------------------------------------------------------------
// scrubString — secret value redaction (audit 2026-05-30, F03/F04)
// ---------------------------------------------------------------------------

describe('scrubString', () => {
  it('redacts Anthropic-style API keys', () => {
    expect(scrubString('key=sk-ant-api03-AbCdEf0123456789xyz')).toBe('key=[REDACTED_API_KEY]');
  });

  it('redacts generic sk- API keys', () => {
    expect(scrubString('OPENAI=sk-proj-0123456789abcdefghij')).toBe('OPENAI=[REDACTED_API_KEY]');
  });

  it('redacts Replicate r8_ tokens', () => {
    expect(scrubString('token r8_abcdefghij0123456789KLMNO')).toBe('token [REDACTED_API_KEY]');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOjEyMw.s5d-fakeSig_123';
    expect(scrubString(`auth ${jwt}`)).toBe('auth [REDACTED_JWT]');
  });

  it('redacts Bearer tokens', () => {
    expect(scrubString('Authorization: Bearer abc123def456ghi')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts email addresses', () => {
    expect(scrubString('user nolantj@live.com signed in')).toBe('user [REDACTED_EMAIL] signed in');
  });

  it('redacts IPv4 addresses', () => {
    expect(scrubString('from 192.168.1.42 ok')).toBe('from [REDACTED_IP] ok');
  });

  it('leaves innocuous strings untouched', () => {
    expect(scrubString('spawn_entity failed at frame 12')).toBe('spawn_entity failed at frame 12');
  });
});

// ---------------------------------------------------------------------------
// deepScrub — recursive key/value redaction
// ---------------------------------------------------------------------------

describe('deepScrub', () => {
  it('redacts values under sensitive keys regardless of content', () => {
    const out = deepScrub({ apiKey: 'whatever', authorization: 'x', password: 'p' }) as Record<string, unknown>;
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
  });

  it('scrubs secret-looking values under innocuous keys', () => {
    const out = deepScrub({ note: 'contact nolantj@live.com from 10.0.0.1' }) as Record<string, string>;
    expect(out.note).toBe('contact [REDACTED_EMAIL] from [REDACTED_IP]');
  });

  it('recurses into nested objects and arrays', () => {
    const out = deepScrub({ a: { b: [{ secret: 'z' }] } }) as { a: { b: Array<{ secret: string }> } };
    expect(out.a.b[0].secret).toBe('[REDACTED]');
  });

  it('preserves non-sensitive primitives', () => {
    const out = deepScrub({ count: 42, ok: true, label: 'sprite' }) as Record<string, unknown>;
    expect(out).toEqual({ count: 42, ok: true, label: 'sprite' });
  });

  it('does not throw on deeply nested structures', () => {
    let nested: Record<string, unknown> = { secret: 'leaf' };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    expect(() => deepScrub(nested)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// scrubEvent — beforeSend / beforeSendTransaction hook
// ---------------------------------------------------------------------------

describe('scrubEvent', () => {
  it('deletes stack-frame local variables (F04)', () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                { function: 'decryptKey', vars: { apiKey: 'sk-ant-api03-SECRET0123456789xyz' } },
              ],
            },
          },
        ],
      },
    });
    const out = scrubEvent(event);
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it('scrubs secrets embedded in the exception value', () => {
    const out = scrubEvent(makeExceptionEvent('failed with key sk-ant-api03-AbCdEf0123456789xyz'));
    expect(out.exception?.values?.[0]?.value).toBe('failed with key [REDACTED_API_KEY]');
  });

  it('drops cookies and redacts sensitive request headers (F03)', () => {
    const event = makeEvent({
      request: {
        url: '/api/chat',
        cookies: { session: 'abc' },
        headers: { authorization: 'Bearer xyz', 'x-api-key': 'sk-123', 'content-type': 'application/json' },
        query_string: 'email=nolantj@live.com',
      },
    });
    const out = scrubEvent(event);
    expect(out.request?.cookies).toBeUndefined();
    const headers = out.request?.headers as Record<string, string>;
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers['x-api-key']).toBe('[REDACTED]');
    expect(headers['content-type']).toBe('application/json');
    expect(out.request?.query_string).toBe('email=[REDACTED_EMAIL]');
  });

  it('drops user PII but keeps the id for correlation (F03)', () => {
    const event = makeEvent({
      user: { id: 'user_123', ip_address: '203.0.113.5', email: 'nolantj@live.com', username: 'tristan' },
    });
    const out = scrubEvent(event);
    expect(out.user?.id).toBe('user_123');
    expect(out.user?.ip_address).toBeUndefined();
    expect(out.user?.email).toBeUndefined();
    expect(out.user?.username).toBeUndefined();
  });

  it('scrubs breadcrumb messages and data', () => {
    const event = makeEvent({
      breadcrumbs: [
        { message: 'sent to nolantj@live.com', data: { apiKey: 'sk-secret' } },
      ],
    });
    const out = scrubEvent(event);
    expect(out.breadcrumbs?.[0]?.message).toBe('sent to [REDACTED_EMAIL]');
    expect((out.breadcrumbs?.[0]?.data as Record<string, unknown>)?.apiKey).toBe('[REDACTED]');
  });

  it('scrubs event.extra and event.contexts', () => {
    const event = makeEvent({
      extra: { prompt: 'my key is sk-ant-api03-AbCdEf0123456789xyz' },
      contexts: { custom: { clientSecret: 'topsecret' } } as Event['contexts'],
    });
    const out = scrubEvent(event);
    expect((out.extra as Record<string, string>)?.prompt).toBe('my key is [REDACTED_API_KEY]');
    expect((out.contexts as Record<string, Record<string, unknown>>)?.custom?.clientSecret).toBe('[REDACTED]');
  });

  it('returns the event when there is nothing sensitive (undefined fields safe)', () => {
    const event = makeExceptionEvent('plain error');
    expect(() => scrubEvent(event)).not.toThrow();
    expect(scrubEvent(makeEvent())).toBeDefined();
  });

  it('is idempotent — scrubbing twice yields the same result', () => {
    const once = scrubEvent(makeExceptionEvent('key sk-ant-api03-AbCdEf0123456789xyz'));
    const twice = scrubEvent(once);
    expect(twice.exception?.values?.[0]?.value).toBe('key [REDACTED_API_KEY]');
  });
});

// ---------------------------------------------------------------------------
// scrubEvent — hardened coverage (audit review 2026-05-30)
//
// The adversarial security review found several PII/credential paths the first
// pass missed. Each test below pins one of those leak vectors closed.
// ---------------------------------------------------------------------------

describe('scrubEvent — hardened coverage (audit review)', () => {
  it('deletes frame locals on THREAD stacktraces, not just exception values (F04)', () => {
    // Server-side Node events attach frames under event.threads[].stacktrace.
    const event = makeEvent({
      threads: {
        values: [
          {
            stacktrace: {
              frames: [{ function: 'decrypt', vars: { key: 'sk-ant-api03-SECRET0123456789xyz' } }],
            },
          },
        ],
      },
    });
    const out = scrubEvent(event);
    expect(out.threads?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toBeUndefined();
  });

  it('scrubs request.env (REMOTE_ADDR / CGI vars)', () => {
    const event = makeEvent({
      request: { url: '/x', env: { REMOTE_ADDR: '203.0.113.9', SERVER_NAME: 'host' } },
    });
    const out = scrubEvent(event);
    const env = out.request?.env as Record<string, string>;
    expect(env.REMOTE_ADDR).toBe('[REDACTED_IP]');
    expect(env.SERVER_NAME).toBe('host');
  });

  it('scrubs a secret header VALUE hiding under an innocuous key name', () => {
    // `x-trace-token` is NOT in the sensitive-key list, so a key-only redactor
    // would have leaked the value. The value scrub catches it.
    const event = makeEvent({
      request: { url: '/x', headers: { 'x-trace-token': 'sk-ant-api03-AbCdEf0123456789xyz' } },
    });
    const out = scrubEvent(event);
    expect((out.request?.headers as Record<string, string>)['x-trace-token']).toBe('[REDACTED_API_KEY]');
  });

  it('scrubs non-string (object) query_string forms', () => {
    const event = makeEvent({
      request: { url: '/x', query_string: { redirect: 'https://x/?to=nolantj@live.com' } },
    });
    const out = scrubEvent(event);
    expect((out.request?.query_string as Record<string, string>).redirect).toBe(
      'https://x/?to=[REDACTED_EMAIL]'
    );
  });

  it('scrubs the request BODY (request.data) — prompts can embed BYOK keys (F03)', () => {
    // /api/chat and /api/generate/* bodies legitimately carry user prompts that
    // can contain a decrypted provider key — exactly the F03/F04 threat model.
    const event = makeEvent({
      request: {
        url: '/api/chat',
        data: { prompt: 'my key is sk-ant-api03-AbCdEf0123456789xyz', contact: 'nolantj@live.com' },
      },
    });
    const out = scrubEvent(event);
    const data = out.request?.data as Record<string, string>;
    expect(data.prompt).toBe('my key is [REDACTED_API_KEY]');
    expect(data.contact).toBe('[REDACTED_EMAIL]');
  });

  it('redacts sensitive tag keys and scrubs secret tag values', () => {
    const event = makeEvent({
      tags: { authorization: 'Bearer abc', note: 'ping nolantj@live.com', release: 'v1.2.3' },
    });
    const out = scrubEvent(event);
    expect(out.tags?.authorization).toBe('[REDACTED]');
    expect(out.tags?.note).toBe('ping [REDACTED_EMAIL]');
    // semver is NOT an IPv4 (only 3 octets) — must survive untouched.
    expect(out.tags?.release).toBe('v1.2.3');
  });

  it('scrubs event.transaction, logentry.message, and server_name', () => {
    const event = makeEvent({
      transaction: 'GET /u/nolantj@live.com',
      logentry: { message: 'key sk-ant-api03-AbCdEf0123456789xyz' },
      server_name: 'host-10.0.0.1',
    });
    const out = scrubEvent(event);
    expect(out.transaction).toBe('GET /u/[REDACTED_EMAIL]');
    expect(out.logentry?.message).toBe('key [REDACTED_API_KEY]');
    expect(out.server_name).toBe('host-[REDACTED_IP]');
  });

  it('scrubs exception mechanism.data', () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            mechanism: { type: 'generic', handled: true, data: { url: 'https://h/?u=nolantj@live.com' } },
          },
        ],
      },
    });
    const out = scrubEvent(event);
    expect((out.exception?.values?.[0]?.mechanism?.data as Record<string, string>)?.url).toBe(
      'https://h/?u=[REDACTED_EMAIL]'
    );
  });

  it('drops user.geo and scrubs custom user fields, keeping id', () => {
    const event = makeEvent({
      user: { id: 'u1', geo: { city: 'Austin' }, plan: 'pro', contact: 'nolantj@live.com' } as Event['user'],
    });
    const out = scrubEvent(event);
    expect(out.user?.id).toBe('u1');
    expect((out.user as Record<string, unknown>)?.geo).toBeUndefined();
    expect((out.user as Record<string, unknown>)?.plan).toBe('pro');
    expect((out.user as Record<string, unknown>)?.contact).toBe('[REDACTED_EMAIL]');
  });

  it('scrubs source context lines (context_line / pre_context / post_context) on frames', () => {
    const event = makeEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            stacktrace: {
              frames: [
                {
                  function: 'f',
                  context_line: 'const k = "sk-ant-api03-AbCdEf0123456789xyz"',
                  pre_context: ['// owner nolantj@live.com'],
                  post_context: ['connect 10.0.0.1'],
                },
              ],
            },
          },
        ],
      },
    });
    const out = scrubEvent(event);
    const frame = out.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.context_line).toBe('const k = "[REDACTED_API_KEY]"');
    expect(frame?.pre_context?.[0]).toBe('// owner [REDACTED_EMAIL]');
    expect(frame?.post_context?.[0]).toBe('connect [REDACTED_IP]');
  });
});

// ---------------------------------------------------------------------------
// scrubString — false-positive & linearity guards (audit review 2026-05-30)
//
// The bounded, \b-anchored patterns must NOT corrupt ordinary identifiers and
// must match in linear time on adversarial input.
// ---------------------------------------------------------------------------

describe('scrubString — false-positive & linearity guards (audit review)', () => {
  it('does not corrupt identifiers that merely contain "sk-" (disk-, task-, risk-)', () => {
    expect(scrubString('flushing disk-cache-0123456789abcdef now')).toBe(
      'flushing disk-cache-0123456789abcdef now'
    );
    expect(scrubString('processing task-0123456789abcdef now')).toBe('processing task-0123456789abcdef now');
    expect(scrubString('assessing risk-0123456789abcdef level')).toBe('assessing risk-0123456789abcdef level');
  });

  it('still redacts a real sk- key wrapped in punctuation (boundary fires)', () => {
    expect(scrubString('(sk-proj-0123456789abcdefghij)')).toBe('([REDACTED_API_KEY])');
  });

  it('does not mistake scoped-package paths for emails', () => {
    const path = 'at node_modules/@sentry/nextjs/build/index.js';
    expect(scrubString(path)).toBe(path);
  });

  it('does not stall on a long adversarial run (no catastrophic backtracking)', () => {
    // A 100k-char run of a single class member would blow up under a nested or
    // unbounded quantifier; the RFC-bounded patterns return promptly and unchanged.
    const long = 'a'.repeat(100_000);
    expect(scrubString(long)).toBe(long);
  });
});

// ---------------------------------------------------------------------------
// scrubSentryLog — beforeSendLog hook
// Sentry Logs (enableLogs) bypass beforeSend / scrubEvent entirely, so the log
// body + structured attributes must be scrubbed on their own pipeline.
// ---------------------------------------------------------------------------

describe('scrubSentryLog', () => {
  it('redacts secret-looking values in the log message', () => {
    const log = scrubSentryLog({
      level: 'error',
      message: 'generation failed for key=sk-ant-api03-AbCdEf0123456789xyz',
    });
    expect(log.message).toBe('generation failed for key=[REDACTED_API_KEY]');
  });

  it('redacts PII (email + IP) in the log message', () => {
    const log = scrubSentryLog({
      level: 'info',
      message: 'user nolantj@live.com from 192.168.1.42',
    });
    expect(log.message).toBe('user [REDACTED_EMAIL] from [REDACTED_IP]');
  });

  it('redacts sensitive keys and secret values in structured attributes', () => {
    const log = scrubSentryLog({
      level: 'warning',
      message: 'request rejected',
      attributes: {
        apiKey: 'sk-ant-api03-anything',
        note: 'retry from 10.0.0.1',
        prompt: 'contact nolantj@live.com',
      },
    });
    const attrs = log.attributes as Record<string, string>;
    expect(attrs.apiKey).toBe('[REDACTED]'); // sensitive key → value redacted wholesale
    expect(attrs.note).toBe('retry from [REDACTED_IP]'); // innocuous key → value scrubbed
    expect(attrs.prompt).toBe('contact [REDACTED_EMAIL]');
  });

  it('leaves a clean log untouched and returns the same object (mutates in place)', () => {
    const input = { level: 'info', message: 'spawn_entity ok at frame 12' };
    const out = scrubSentryLog(input);
    expect(out).toBe(input); // same reference — drop-in for Sentry's beforeSendLog
    expect(out.message).toBe('spawn_entity ok at frame 12');
  });

  it('tolerates a log with no attributes', () => {
    const input: { level: string; message: string; attributes?: Record<string, unknown> } = {
      level: 'debug',
      message: 'tick',
    };
    const log = scrubSentryLog(input);
    expect(log.attributes).toBeUndefined();
  });

  it('redacts a parameterized (boxed String) fmt message — the rendered body the SDK ships', () => {
    // `Sentry.logger.fmt`…`` returns a boxed String object (typeof 'object'), not
    // a primitive, and the SDK ships `String(message)` as the body AFTER
    // beforeSendLog. A plain `typeof === 'string'` guard would skip it and leak
    // the interpolated PII. Mirror the real shape (boxed String + template props).
    const boxed = Object.assign(new String('gen failed for nolantj@live.com from 192.168.1.42'), {
      __sentry_template_string__: 'gen failed for %s from %s',
      __sentry_template_values__: ['nolantj@live.com', '192.168.1.42'],
    });
    const out = scrubSentryLog({ level: 'error', message: boxed as unknown as string });
    expect(String(out.message)).toBe('gen failed for [REDACTED_EMAIL] from [REDACTED_IP]');
  });

  it('redacts user.name / user.username attributes the SDK flattens from scope (PII parity with scrubEvent)', () => {
    // The SDK copies the active scope's `username` into a `user.name` log
    // attribute; deepScrub's key regex catches `user.email` but not `user.name`,
    // so it must be redacted explicitly — matching scrubEvent's `delete username`.
    const out = scrubSentryLog({
      level: 'info',
      message: 'authenticated',
      attributes: {
        'user.id': 'u_123',
        'user.email': 'nolantj@live.com',
        'user.name': 'tristan_nolan',
        'user.username': 'tristan_nolan',
      },
    });
    const attrs = out.attributes as Record<string, string>;
    expect(attrs['user.name']).toBe('[REDACTED]');
    expect(attrs['user.username']).toBe('[REDACTED]');
    expect(attrs['user.email']).toBe('[REDACTED]'); // sensitive key → redacted by deepScrub
    expect(attrs['user.id']).toBe('u_123'); // kept for correlation, as in scrubEvent
  });
});
