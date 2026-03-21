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
