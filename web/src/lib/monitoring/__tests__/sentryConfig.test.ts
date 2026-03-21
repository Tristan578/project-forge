import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the processor registered via addEventProcessor so tests can invoke it
let capturedProcessor: ((event: Record<string, unknown>) => Record<string, unknown>) | null = null;

vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: vi.fn((fn: (event: Record<string, unknown>) => Record<string, unknown>) => {
    capturedProcessor = fn;
  }),
}));

import * as Sentry from '@sentry/nextjs';
import { extractAuthCode, configureSentryFingerprinting } from '../sentryConfig';

// Helper — build a minimal Sentry event with an exception message
function makeEvent(message: string): Record<string, unknown> {
  return {
    exception: {
      values: [{ type: 'Error', value: message }],
    },
  };
}

describe('extractAuthCode', () => {
  it('returns 401 for "401 Unauthorized"', () => {
    expect(extractAuthCode('401 Unauthorized')).toBe(401);
  });

  it('returns 403 for "403 Forbidden"', () => {
    expect(extractAuthCode('403 Forbidden')).toBe(403);
  });

  it('returns 407 for "407 Proxy Authentication Required"', () => {
    expect(extractAuthCode('407 Proxy Authentication Required')).toBe(407);
  });

  it('returns 419 for "419 Authentication Timeout"', () => {
    expect(extractAuthCode('419 Authentication Timeout')).toBe(419);
  });

  it('returns 429 for "429 Too Many Requests"', () => {
    expect(extractAuthCode('429 Too Many Requests')).toBe(429);
  });

  it('returns null for 500 Internal Server Error (5xx must never match)', () => {
    expect(extractAuthCode('500 Internal Server Error')).toBeNull();
  });

  it('returns null for 502 Bad Gateway', () => {
    expect(extractAuthCode('502 Bad Gateway')).toBeNull();
  });

  it('returns null for 503 Service Unavailable', () => {
    expect(extractAuthCode('503 Service Unavailable')).toBeNull();
  });

  it('returns null for 504 Gateway Timeout', () => {
    expect(extractAuthCode('504 Gateway Timeout')).toBeNull();
  });

  it('returns null when no status code is present', () => {
    expect(extractAuthCode('Something went wrong')).toBeNull();
  });

  it('returns null for 404 Not Found (not an auth code)', () => {
    expect(extractAuthCode('404 Not Found')).toBeNull();
  });

  it('returns null for 400 Bad Request (not an auth code)', () => {
    expect(extractAuthCode('400 Bad Request')).toBeNull();
  });

  it('returns 401 when code appears mid-sentence', () => {
    expect(extractAuthCode('Request failed with status 401')).toBe(401);
  });

  it('returns null for empty string', () => {
    expect(extractAuthCode('')).toBeNull();
  });
});

describe('configureSentryFingerprinting', () => {
  beforeEach(() => {
    capturedProcessor = null;
    vi.clearAllMocks();
  });

  it('registers an event processor with Sentry', () => {
    configureSentryFingerprinting();
    expect(Sentry.addEventProcessor).toHaveBeenCalledTimes(1);
    expect(capturedProcessor).toBeTypeOf('function');
  });

  describe('auth error fingerprinting', () => {
    it('assigns auth-error fingerprint for 401 exception message', () => {
      configureSentryFingerprinting();
      const event = makeEvent('401 Unauthorized');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['auth-error', '401']);
    });

    it('assigns auth-error fingerprint for 403 exception message', () => {
      configureSentryFingerprinting();
      const event = makeEvent('403 Forbidden');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['auth-error', '403']);
    });

    it('assigns auth-error fingerprint for 429 exception message', () => {
      configureSentryFingerprinting();
      const event = makeEvent('429 Too Many Requests');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['auth-error', '429']);
    });
  });

  describe('5xx errors must NOT get auth fingerprint', () => {
    it('does NOT fingerprint 500 Internal Server Error as auth-error', () => {
      configureSentryFingerprinting();
      const event = makeEvent('500 Internal Server Error');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toBeUndefined();
    });

    it('does NOT fingerprint 502 Bad Gateway as auth-error', () => {
      configureSentryFingerprinting();
      const event = makeEvent('502 Bad Gateway');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toBeUndefined();
    });

    it('does NOT fingerprint 503 Service Unavailable as auth-error', () => {
      configureSentryFingerprinting();
      const event = makeEvent('503 Service Unavailable');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toBeUndefined();
    });
  });

  describe('network error fingerprinting', () => {
    it('assigns network-error fingerprint for "Failed to fetch"', () => {
      configureSentryFingerprinting();
      const event = makeEvent('Failed to fetch');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['network-error', '{{ default }}']);
    });

    it('assigns network-error fingerprint for "Network Error"', () => {
      configureSentryFingerprinting();
      const event = makeEvent('Network Error');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['network-error', '{{ default }}']);
    });

    it('assigns network-error fingerprint for CORS errors', () => {
      configureSentryFingerprinting();
      const event = makeEvent('CORS policy blocked the request');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['network-error', '{{ default }}']);
    });
  });

  describe('default fingerprinting passthrough', () => {
    it('leaves fingerprint undefined for generic errors', () => {
      configureSentryFingerprinting();
      const event = makeEvent('Unexpected token in JSON');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toBeUndefined();
    });

    it('leaves fingerprint undefined for TypeError', () => {
      configureSentryFingerprinting();
      const event = makeEvent("Cannot read properties of undefined (reading 'map')");
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toBeUndefined();
    });
  });

  describe('event.message field', () => {
    it('detects auth code in top-level message field', () => {
      configureSentryFingerprinting();
      const event = { message: '401 Unauthorized', exception: { values: [] } };
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['auth-error', '401']);
    });
  });

  describe('auth code priority over network', () => {
    it('prefers auth fingerprint when message contains both auth code and network text', () => {
      configureSentryFingerprinting();
      const event = makeEvent('401 Unauthorized — Failed to fetch');
      const result = capturedProcessor!(event) as { fingerprint?: string[] };
      expect(result.fingerprint).toEqual(['auth-error', '401']);
    });
  });
});
