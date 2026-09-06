/**
 * @vitest-environment node
 *
 * An INDEPENDENT check of the runtime egress guard, written without reference
 * to the guard's own test list (#9736).
 *
 * The point of the guard is that it does not need to know how a body was
 * assembled. So these cases deliberately avoid every shape the lint rule and
 * the guard's own suite enumerate: no catch block, no provider client, no
 * response helper. A handler simply puts a live platform key somewhere a client
 * can read it, by ordinary means, on a SUCCESS status.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { withEgressGuard } from '../egressGuard';

const SECRET = 'msy_independentprobe0123456789abcdef';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('egress guard, independently probed', () => {
  it('redacts a secret buried in a nested field of a 200 body', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const handler = withEgressGuard(async () =>
      NextResponse.json({ ok: true, job: { meta: { echoed: `upstream said ${SECRET}` } } }),
    );
    const res = await handler(new Request('http://localhost/api/x'));
    const text = await res.text();
    expect(text).not.toContain(SECRET);
  });

  it('redacts a secret placed in a custom header on a 200', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const handler = withEgressGuard(async () => {
      const res = NextResponse.json({ ok: true });
      res.headers.set('X-Debug-Upstream', SECRET);
      return res;
    });
    const res = await handler(new Request('http://localhost/api/x'));
    expect(res.headers.get('X-Debug-Upstream')).not.toContain(SECRET);
  });

  it('redacts a secret in a percent-encoded redirect target', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    const handler = withEgressGuard(async () =>
      NextResponse.redirect(`https://example.com/cb?k=${encodeURIComponent(SECRET)}`),
    );
    const res = await handler(new Request('http://localhost/api/x'));
    const location = res.headers.get('Location') ?? '';
    expect(decodeURIComponent(location)).not.toContain(SECRET);
  });

  it('leaves an ordinary success body byte-identical', async () => {
    const body = { ok: true, items: [1, 2, 3], note: 'nothing sensitive here' };
    const handler = withEgressGuard(async () => NextResponse.json(body));
    const res = await handler(new Request('http://localhost/api/x'));
    expect(await res.json()).toEqual(body);
  });

  it('still answers when the handler itself returns a malformed body', async () => {
    const handler = withEgressGuard(async () => new Response('not json{', { status: 500 }));
    const res = await handler(new Request('http://localhost/api/x'));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
