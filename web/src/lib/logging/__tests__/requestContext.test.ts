import { describe, it, expect } from 'vitest';
import { extractRequestId, extractUserId } from '@/lib/logging/requestContext';

// Minimal headers mock
function makeHeaders(entries: Record<string, string>): Headers {
  return new Map(Object.entries(entries)) as unknown as Headers;
}

describe('extractRequestId', () => {
  it('returns x-request-id when present', () => {
    const headers = makeHeaders({ 'x-request-id': 'abc-123' });
    expect(extractRequestId(headers)).toBe('abc-123');
  });

  it('falls back to x-vercel-id when x-request-id is absent', () => {
    const headers = makeHeaders({ 'x-vercel-id': 'vercel-xyz' });
    expect(extractRequestId(headers)).toBe('vercel-xyz');
  });

  it('falls back to x-trace-id when neither request-id nor vercel-id is present', () => {
    const headers = makeHeaders({ 'x-trace-id': 'trace-999' });
    expect(extractRequestId(headers)).toBe('trace-999');
  });

  it('generates a req_ prefixed id when no headers are present', () => {
    const headers = makeHeaders({});
    const id = extractRequestId(headers);
    expect(id).toMatch(/^req_/);
    expect(id.length).toBeGreaterThan(4);
  });

  it('prefers x-request-id over other headers', () => {
    const headers = makeHeaders({
      'x-request-id': 'first',
      'x-vercel-id': 'second',
      'x-trace-id': 'third',
    });
    expect(extractRequestId(headers)).toBe('first');
  });

  it('generates unique IDs on successive calls without headers', () => {
    const headers = makeHeaders({});
    const id1 = extractRequestId(headers);
    const id2 = extractRequestId(headers);
    // IDs should differ (either via UUID or timestamp+rand)
    // Extremely unlikely to collide — acceptable for test
    expect(id1).not.toBe(id2);
  });
});

describe('extractUserId', () => {
  it('returns user.id when available', () => {
    expect(extractUserId({ user: { id: 'user-1' }, clerkId: 'clerk-1' })).toBe('user-1');
  });

  it('falls back to clerkId when user.id is absent', () => {
    expect(extractUserId({ clerkId: 'clerk-2' })).toBe('clerk-2');
  });

  it('returns undefined when authCtx is null', () => {
    expect(extractUserId(null)).toBeUndefined();
  });

  it('returns undefined when authCtx is undefined', () => {
    expect(extractUserId(undefined)).toBeUndefined();
  });

  it('returns undefined when both user.id and clerkId are absent', () => {
    expect(extractUserId({})).toBeUndefined();
  });
});
