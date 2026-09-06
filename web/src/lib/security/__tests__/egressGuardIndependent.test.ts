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
 *
 * Two corrections to the first version of this file, both worth naming:
 *
 *  - It called `handler(new Request(...))` against a zero-argument handler, so
 *    this file failed `tsc --noEmit` on the branch it was pushed to. The
 *    handlers now take the request they are given, which is also what a real
 *    route handler looks like.
 *  - "Leaves an ordinary success body byte-identical" asserted
 *    `expect(await res.json()).toEqual(body)`, which PARSES the output and
 *    therefore cannot see key reordering, number reformatting or lost
 *    formatting by construction — a check incapable of failing on the property
 *    it names (lessons-learned #11). It now compares TEXT, on a body built to
 *    make each of those losses reachable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withEgressGuard } from '../egressGuard';
import { resetSecretEnvCache } from '../redactSecrets';

const SECRET = 'msy_independentprobe0123456789abcdef';

const request = () => new NextRequest('http://localhost/api/x');

afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretEnvCache();
});

describe('egress guard, independently probed', () => {
  it('redacts a secret buried in a nested field of a 200 body', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    resetSecretEnvCache();
    const handler = withEgressGuard(async (_req: NextRequest) =>
      NextResponse.json({ ok: true, job: { meta: { echoed: `upstream said ${SECRET}` } } }),
    );
    const res = await handler(request());
    expect(await res.text()).not.toContain(SECRET);
  });

  it('redacts a secret placed in a custom header on a 200', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    resetSecretEnvCache();
    const handler = withEgressGuard(async (_req: NextRequest) => {
      const res = NextResponse.json({ ok: true });
      res.headers.set('X-Debug-Upstream', SECRET);
      return res;
    });
    const res = await handler(request());
    expect(res.headers.get('X-Debug-Upstream')).not.toContain(SECRET);
  });

  it('redacts a secret in a percent-encoded redirect target', async () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', SECRET);
    resetSecretEnvCache();
    const handler = withEgressGuard(async (_req: NextRequest) =>
      NextResponse.redirect(`https://example.com/cb?k=${encodeURIComponent(SECRET)}`),
    );
    const res = await handler(request());
    const location = res.headers.get('Location') ?? '';
    expect(decodeURIComponent(location)).not.toContain(SECRET);
  });

  it('leaves an ordinary success body byte-identical, compared as TEXT', async () => {
    // Not `res.json()`. Parsing the output throws away exactly the differences
    // this assertion exists to catch, so the fixture carries a value for each:
    // an integer-like key that JS property ordering moves, an integer past 2^53,
    // and deliberate indentation.
    const text = '{\n  "10": "ten",\n  "2": "two",\n  "id": 9007199254740993\n}';
    const handler = withEgressGuard(async (_req: NextRequest) =>
      new NextResponse(text, { headers: { 'content-type': 'application/json' } }),
    );
    const res = await handler(request());
    expect(await res.text()).toBe(text);
  });

  it('still answers when the handler itself returns a malformed body', async () => {
    const handler = withEgressGuard(async (_req: NextRequest) =>
      new Response('not json{', { status: 500 }),
    );
    const res = await handler(request());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
