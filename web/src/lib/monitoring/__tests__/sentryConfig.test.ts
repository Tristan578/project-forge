import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/nextjs BEFORE importing the module under test so the
// addEventProcessor spy is in place when sentryConfig is evaluated.
const mockAddEventProcessor = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: mockAddEventProcessor,
}));

import {
  configureSentryFingerprinting,
  extractProvider,
  extractGenerationType,
  extractCommandType,
  extractAuthCode,
} from '../sentryConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Invoke configureSentryFingerprinting and return the registered processor. */
function getProcessor(): (event: Record<string, unknown>) => Record<string, unknown> {
  configureSentryFingerprinting();
  expect(mockAddEventProcessor).toHaveBeenCalled();
  // The last call's first argument is the processor function
  return mockAddEventProcessor.mock.calls[mockAddEventProcessor.mock.calls.length - 1][0] as (
    event: Record<string, unknown>,
  ) => Record<string, unknown>;
}

/** Build a minimal Sentry event with an exception message. */
function makeEvent(message?: string, exceptionValue?: string): Record<string, unknown> {
  const event: Record<string, unknown> = {};
  if (message !== undefined) {
    event.message = message;
  }
  if (exceptionValue !== undefined) {
    event.exception = { values: [{ value: exceptionValue }] };
  }
  return event;
}

// ---------------------------------------------------------------------------
// extractProvider
// ---------------------------------------------------------------------------

describe('extractProvider', () => {
  it('matches anthropic (case-insensitive)', () => {
    expect(extractProvider('Anthropic API error 500')).toBe('anthropic');
  });

  it('matches openai', () => {
    expect(extractProvider('openai quota exceeded')).toBe('openai');
  });

  it('matches meshy', () => {
    expect(extractProvider('Meshy 3D model generation failed')).toBe('meshy');
  });

  it('matches elevenlabs', () => {
    expect(extractProvider('ElevenLabs SFX timeout')).toBe('elevenlabs');
  });

  it('returns null for unknown providers', () => {
    expect(extractProvider('some random database error')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractProvider('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractGenerationType
// ---------------------------------------------------------------------------

describe('extractGenerationType', () => {
  it('detects sprite', () => {
    expect(extractGenerationType('sprite generation failed')).toBe('sprite');
  });

  it('detects model', () => {
    expect(extractGenerationType('3D model generation error')).toBe('model');
  });

  it('detects sfx', () => {
    expect(extractGenerationType('sfx generation timeout')).toBe('sfx');
  });

  it('detects music', () => {
    expect(extractGenerationType('Music generation failed')).toBe('music');
  });

  it('detects texture', () => {
    expect(extractGenerationType('texture gen error')).toBe('texture');
  });

  it('returns null for unknown types', () => {
    expect(extractGenerationType('widget creation failed')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractCommandType
// ---------------------------------------------------------------------------

describe('extractCommandType', () => {
  it('extracts command name after "command:" prefix', () => {
    expect(extractCommandType('command: spawn_entity failed')).toBe('spawn_entity');
  });

  it('extracts command name after "cmd:" prefix', () => {
    expect(extractCommandType('cmd: update_material xyz')).toBe('update_material');
  });

  it('falls back to first snake_case word', () => {
    expect(extractCommandType('delete_entity abc-123 not found')).toBe('delete_entity');
  });

  it('returns unknown_command when no pattern matches', () => {
    expect(extractCommandType('generic wasm failure')).toBe('unknown_command');
  });
});

// ---------------------------------------------------------------------------
// extractAuthCode
// ---------------------------------------------------------------------------

describe('extractAuthCode', () => {
  it('extracts HTTP status codes', () => {
    expect(extractAuthCode('401 Unauthorized')).toBe('401');
    expect(extractAuthCode('403 Forbidden')).toBe('403');
  });

  it('maps "unauthorized" to the correct slug', () => {
    expect(extractAuthCode('User is unauthorized')).toBe('unauthorized');
  });

  it('maps "forbidden" to the correct slug', () => {
    expect(extractAuthCode('Forbidden resource')).toBe('forbidden');
  });

  it('maps "expired" to token_expired', () => {
    expect(extractAuthCode('JWT expired')).toBe('token_expired');
  });

  it('maps "invalid token" variations', () => {
    expect(extractAuthCode('invalid token provided')).toBe('invalid_token');
    expect(extractAuthCode('token is invalid')).toBe('invalid_token');
  });

  it('returns auth_error as fallback', () => {
    expect(extractAuthCode('auth subsystem failure')).toBe('auth_error');
  });
});

// ---------------------------------------------------------------------------
// configureSentryFingerprinting — event processor integration
// ---------------------------------------------------------------------------

describe('configureSentryFingerprinting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers an event processor with Sentry', () => {
    configureSentryFingerprinting();
    expect(mockAddEventProcessor).toHaveBeenCalledOnce();
  });

  describe('rate-limit errors', () => {
    it('assigns rate-limit-error fingerprint for 429 messages', () => {
      const processor = getProcessor();
      const event = makeEvent('429 Too Many Requests');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });

    it('assigns rate-limit-error fingerprint for "rate limit" text', () => {
      const processor = getProcessor();
      const event = makeEvent('Rate limit exceeded for endpoint');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });

    it('assigns rate-limit-error fingerprint for "too many requests" in exception', () => {
      const processor = getProcessor();
      const event = makeEvent(undefined, 'Too many requests from this IP');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });
  });

  describe('auth errors', () => {
    it('groups 401 errors under auth-error/401', () => {
      const processor = getProcessor();
      const event = makeEvent('401 unauthorized');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['auth-error', '401']);
    });

    it('groups 403 errors under auth-error/403', () => {
      const processor = getProcessor();
      const event = makeEvent('403 Forbidden');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['auth-error', '403']);
    });

    it('groups "token expired" under auth-error/token_expired', () => {
      const processor = getProcessor();
      const event = makeEvent('session token expired');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['auth-error', 'token_expired']);
    });
  });

  describe('AI provider errors', () => {
    it('groups anthropic errors by provider', () => {
      const processor = getProcessor();
      const event = makeEvent('Anthropic API returned 529 overload');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['ai-provider-error', 'anthropic']);
    });

    it('groups openai errors by provider', () => {
      const processor = getProcessor();
      const event = makeEvent('OpenAI model not found');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['ai-provider-error', 'openai']);
    });

    it('groups meshy errors by provider', () => {
      const processor = getProcessor();
      const event = makeEvent('Meshy generation quota exceeded');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['ai-provider-error', 'meshy']);
    });

    it('reads provider from exception value when message absent', () => {
      const processor = getProcessor();
      const event = makeEvent(undefined, 'ElevenLabs API error 503');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['ai-provider-error', 'elevenlabs']);
    });
  });

  describe('WASM command failures', () => {
    it('groups by command type from "command:" prefix', () => {
      const processor = getProcessor();
      const event = makeEvent('handle_command error: command: spawn_entity failed unexpectedly');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'spawn_entity']);
    });

    it('groups generic WASM error with unknown_command fallback', () => {
      const processor = getProcessor();
      const event = makeEvent('WASM engine crashed with exit code 1');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'unknown_command']);
    });

    it('groups engine command failures', () => {
      const processor = getProcessor();
      const event = makeEvent('engine command failed: no such entity');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'unknown_command']);
    });
  });

  describe('generation failures', () => {
    it('groups sprite generation failures by type', () => {
      const processor = getProcessor();
      const event = makeEvent('sprite generation failed after 30s');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['generation-failure', 'sprite']);
    });

    it('groups model generation failures by type', () => {
      const processor = getProcessor();
      const event = makeEvent('3D model generation error: timeout');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['generation-failure', 'model']);
    });

    it('groups unknown generation types as unknown', () => {
      const processor = getProcessor();
      const event = makeEvent('asset generation pipeline failed');
      const result = processor(event);
      expect(result.fingerprint).toEqual(['generation-failure', 'unknown']);
    });
  });

  describe('unmatched events', () => {
    it('passes through events without a fingerprint for Sentry default grouping', () => {
      const processor = getProcessor();
      const event = makeEvent('NullPointerException at editor.ts:42');
      const result = processor(event);
      expect(result.fingerprint).toBeUndefined();
    });

    it('handles events with neither message nor exception gracefully', () => {
      const processor = getProcessor();
      const event: Record<string, unknown> = {};
      const result = processor(event);
      expect(result.fingerprint).toBeUndefined();
    });
  });
});
