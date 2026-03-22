import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDeprecationHeaders, type DeprecationInfo } from '../apiDeprecation';

// Mock dynamic Sentry import so tests don't throw on missing module
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(headers: Record<string, string> = {}): Response {
  return new Response(null, { headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkDeprecationHeaders', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns deprecated=false when no deprecation headers present', () => {
    const result = checkDeprecationHeaders(makeResponse(), 'Test API');
    expect(result.deprecated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('returns deprecated=false and does not warn for clean responses', () => {
    checkDeprecationHeaders(makeResponse({ 'Content-Type': 'application/json' }), 'Test API');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Deprecation header
  // -------------------------------------------------------------------------

  it('detects Deprecation: true header', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Deprecation: 'true' }),
      'Some API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.deprecation).toBe('true');
  });

  it('detects Deprecation header with ISO timestamp', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Deprecation: '2026-06-01T00:00:00Z' }),
      'Legacy API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.deprecation).toBe('2026-06-01T00:00:00Z');
  });

  it('logs a console.warn when Deprecation header is present', () => {
    checkDeprecationHeaders(makeResponse({ Deprecation: 'true' }), 'Meshy API');
    expect(warnSpy).toHaveBeenCalledOnce();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('Meshy API');
    expect(message).toContain('Deprecation');
  });

  // -------------------------------------------------------------------------
  // Sunset header
  // -------------------------------------------------------------------------

  it('detects Sunset header', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Sunset: 'Sat, 01 Jun 2026 00:00:00 GMT' }),
      'Old API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.sunset).toBe('Sat, 01 Jun 2026 00:00:00 GMT');
  });

  it('includes sunset date in warning message', () => {
    checkDeprecationHeaders(
      makeResponse({ Sunset: '2027-01-01T00:00:00Z' }),
      'Sunset API',
    );
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('Sunset');
    expect(message).toContain('2027-01-01T00:00:00Z');
  });

  // -------------------------------------------------------------------------
  // Warning header
  // -------------------------------------------------------------------------

  it('detects Warning header with code 299', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Warning: '299 - "Deprecated endpoint, use /v2"' }),
      'Deprecated API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('299');
  });

  it('detects Warning header with code 214', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Warning: '214 - "API being sunsetted"' }),
      'Transform API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('ignores Warning header codes that are not deprecation-related', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Warning: '110 - "Response is Stale"' }),
      'Cached API',
    );
    expect(result.deprecated).toBe(false);
  });

  it('handles multiple Warning entries separated by commas', () => {
    const result = checkDeprecationHeaders(
      makeResponse({
        Warning: '110 - "Stale", 299 - "Deprecated", 214 - "Sunset soon"',
      }),
      'Multi-warning API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.warnings).toHaveLength(2); // 299 + 214, not 110
  });

  it('handles Warning header with quoted comma in text', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Warning: '299 - "See v2, use /new-endpoint"' }),
      'Quoted API',
    );
    // Single entry, comma inside quotes must not be split
    expect(result.warnings).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Combined headers
  // -------------------------------------------------------------------------

  it('detects all three signals simultaneously', () => {
    const result = checkDeprecationHeaders(
      makeResponse({
        Deprecation: 'true',
        Sunset: '2026-12-31T00:00:00Z',
        Warning: '299 - "Please migrate"',
      }),
      'Dying API',
    );
    expect(result.deprecated).toBe(true);
    expect(result.deprecation).toBe('true');
    expect(result.sunset).toBe('2026-12-31T00:00:00Z');
    expect(result.warnings).toHaveLength(1);
  });

  it('returns correct structure when no signals found', () => {
    const result = checkDeprecationHeaders(makeResponse(), 'Healthy API');
    const expected: DeprecationInfo = { deprecated: false, warnings: [] };
    expect(result).toEqual(expected);
  });

  it('includes apiName in the log message', () => {
    checkDeprecationHeaders(makeResponse({ Deprecation: 'true' }), 'ElevenLabs API');
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('ElevenLabs API');
  });

  it('does not include deprecation/sunset fields when not present', () => {
    const result = checkDeprecationHeaders(
      makeResponse({ Warning: '299 - "Deprecated"' }),
      'Warning-only API',
    );
    expect(result.deprecation).toBeUndefined();
    expect(result.sunset).toBeUndefined();
  });
});
