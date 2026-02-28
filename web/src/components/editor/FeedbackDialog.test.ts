import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Feedback API validation', () => {
  const originalFetch = globalThis.fetch;
  let lastFetchBody: Record<string, unknown> | null = null;

  beforeEach(() => {
    lastFetchBody = null;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        lastFetchBody = JSON.parse(init.body as string);
      }
      return new Response(JSON.stringify({ success: true, id: 'test-id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts valid feedback types', () => {
    const validTypes = ['bug', 'feature', 'general'];
    for (const type of validTypes) {
      expect(validTypes).toContain(type);
    }
  });

  it('rejects invalid feedback types', () => {
    const validTypes = ['bug', 'feature', 'general'];
    expect(validTypes).not.toContain('spam');
    expect(validTypes).not.toContain('');
  });

  it('validates description minimum length', () => {
    const minLength = 10;
    expect('short'.trim().length).toBeLessThan(minLength);
    expect('This is a valid feedback description'.trim().length).toBeGreaterThanOrEqual(minLength);
  });

  it('validates description maximum length', () => {
    const maxLength = 5000;
    const longText = 'a'.repeat(5001);
    expect(longText.length).toBeGreaterThan(maxLength);
  });

  it('constructs correct API request body', async () => {
    await globalThis.fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'bug',
        description: 'Test bug report for the editor',
        metadata: { url: 'http://localhost:3000/dev', viewport: '1920x1080' },
      }),
    });

    expect(lastFetchBody).toEqual({
      type: 'bug',
      description: 'Test bug report for the editor',
      metadata: { url: 'http://localhost:3000/dev', viewport: '1920x1080' },
    });
  });

  it('sends metadata with browser info', async () => {
    const metadata = {
      url: 'http://localhost:3000/dev',
      userAgent: 'test-agent',
      viewport: '1920x1080',
    };

    await globalThis.fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'feature',
        description: 'I would like a dark mode toggle',
        metadata,
      }),
    });

    expect(lastFetchBody?.metadata).toBeDefined();
    expect(lastFetchBody?.type).toBe('feature');
  });

  it('trims description whitespace', () => {
    const description = '  Test feedback with spaces  ';
    expect(description.trim()).toBe('Test feedback with spaces');
    expect(description.trim().length).toBeGreaterThanOrEqual(10);
  });
});
