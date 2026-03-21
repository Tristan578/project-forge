import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file by vitest.
// Factory functions cannot reference outer-scope variables at hoist time,
// so we capture the spy via the module mock return value instead.
vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
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

type SentryEvent = Record<string, unknown>;

/** Invoke configureSentryFingerprinting and return the registered processor. */
function getProcessor(): (event: SentryEvent) => SentryEvent {
  configureSentryFingerprinting();
  const spy = vi.mocked(Sentry.addEventProcessor);
  expect(spy).toHaveBeenCalled();
  return spy.mock.calls[spy.mock.calls.length - 1][0] as unknown as (event: SentryEvent) => SentryEvent;
}

/** Build a minimal Sentry event with an optional message and/or exception value. */
function makeEvent(message?: string, exceptionValue?: string): SentryEvent {
  const event: SentryEvent = {};
  if (message !== undefined) event.message = message;
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
  it('extracts HTTP 401 status code', () => {
    expect(extractAuthCode('401 Unauthorized')).toBe('401');
  });

  it('extracts HTTP 403 status code', () => {
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

  it('maps "invalid token" to invalid_token', () => {
    expect(extractAuthCode('invalid token provided')).toBe('invalid_token');
  });

  it('maps "token is invalid" to invalid_token', () => {
    expect(extractAuthCode('token is invalid')).toBe('invalid_token');
  });

  it('returns auth_error as fallback', () => {
    expect(extractAuthCode('auth subsystem failure')).toBe('auth_error');
  });
});

// ---------------------------------------------------------------------------
// configureSentryFingerprinting -- event processor integration
// ---------------------------------------------------------------------------

describe('configureSentryFingerprinting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers an event processor with Sentry', () => {
    configureSentryFingerprinting();
    expect(vi.mocked(Sentry.addEventProcessor)).toHaveBeenCalledOnce();
  });

  describe('rate-limit errors', () => {
    it('assigns rate-limit-error fingerprint for 429 messages', () => {
      const process = getProcessor();
      const result = process(makeEvent('429 Too Many Requests'));
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });

    it('assigns rate-limit-error fingerprint for "rate limit" text', () => {
      const process = getProcessor();
      const result = process(makeEvent('Rate limit exceeded for endpoint'));
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });

    it('assigns rate-limit-error fingerprint for "too many requests" in exception', () => {
      const process = getProcessor();
      const result = process(makeEvent(undefined, 'Too many requests from this IP'));
      expect(result.fingerprint).toEqual(['rate-limit-error']);
    });
  });

  describe('auth errors', () => {
    it('groups 401 errors under auth-error/401', () => {
      const process = getProcessor();
      const result = process(makeEvent('401 unauthorized'));
      expect(result.fingerprint).toEqual(['auth-error', '401']);
    });

    it('groups 403 errors under auth-error/403', () => {
      const process = getProcessor();
      const result = process(makeEvent('403 Forbidden'));
      expect(result.fingerprint).toEqual(['auth-error', '403']);
    });

    it('groups "token expired" under auth-error/token_expired', () => {
      const process = getProcessor();
      const result = process(makeEvent('session token expired'));
      expect(result.fingerprint).toEqual(['auth-error', 'token_expired']);
    });
  });

  describe('AI provider errors', () => {
    it('groups anthropic errors by provider', () => {
      const process = getProcessor();
      const result = process(makeEvent('Anthropic API returned 529 overload'));
      expect(result.fingerprint).toEqual(['ai-provider-error', 'anthropic']);
    });

    it('groups openai errors by provider', () => {
      const process = getProcessor();
      const result = process(makeEvent('OpenAI model not found'));
      expect(result.fingerprint).toEqual(['ai-provider-error', 'openai']);
    });

    it('groups meshy errors by provider', () => {
      const process = getProcessor();
      const result = process(makeEvent('Meshy generation quota exceeded'));
      expect(result.fingerprint).toEqual(['ai-provider-error', 'meshy']);
    });

    it('reads provider from exception value when message absent', () => {
      const process = getProcessor();
      const result = process(makeEvent(undefined, 'ElevenLabs API error 503'));
      expect(result.fingerprint).toEqual(['ai-provider-error', 'elevenlabs']);
    });
  });

  describe('WASM command failures', () => {
    it('groups by command type from "command:" prefix', () => {
      const process = getProcessor();
      const result = process(
        makeEvent('handle_command error: command: spawn_entity failed unexpectedly'),
      );
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'spawn_entity']);
    });

    it('groups generic WASM error with unknown_command fallback', () => {
      const process = getProcessor();
      const result = process(makeEvent('WASM engine crashed with exit code 1'));
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'unknown_command']);
    });

    it('groups engine command failures', () => {
      const process = getProcessor();
      const result = process(makeEvent('engine command failed: no such entity'));
      expect(result.fingerprint).toEqual(['wasm-command-failure', 'unknown_command']);
    });
  });

  describe('generation failures', () => {
    it('groups sprite generation failures by type', () => {
      const process = getProcessor();
      const result = process(makeEvent('sprite generation failed after 30s'));
      expect(result.fingerprint).toEqual(['generation-failure', 'sprite']);
    });

    it('groups model generation failures by type', () => {
      const process = getProcessor();
      const result = process(makeEvent('3D model generation error: timeout'));
      expect(result.fingerprint).toEqual(['generation-failure', 'model']);
    });

    it('groups unknown generation types as unknown', () => {
      const process = getProcessor();
      const result = process(makeEvent('asset generation pipeline failed'));
      expect(result.fingerprint).toEqual(['generation-failure', 'unknown']);
    });
  });

  describe('unmatched events', () => {
    it('passes through events without a fingerprint for Sentry default grouping', () => {
      const process = getProcessor();
      const result = process(makeEvent('NullPointerException at editor.ts:42'));
      expect(result.fingerprint).toBeUndefined();
    });

    it('handles events with neither message nor exception gracefully', () => {
      const process = getProcessor();
      const result = process({});
      expect(result.fingerprint).toBeUndefined();
    });
  });
});
