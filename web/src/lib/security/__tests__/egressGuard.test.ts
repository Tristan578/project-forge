/**
 * @vitest-environment node
 *
 * Does `withEgressGuard` actually redact, at runtime, on the shapes that
 * defeated the static rule?
 *
 * Every case below is a handler that leaks, written the way the review board
 * wrote it when defeating `spawnforge/no-raw-response-in-catch`: an alias into
 * a module-scoped cache, a response header, a redirect URL, a cookie, a
 * `ReadableStream`, and `Promise.allSettled`'s `reason`. Each one is
 * lint-clean; each one is redacted here.
 *
 * ASSERTIONS ARE ON THE SERIALIZED RESPONSE — the bytes and headers a client
 * would receive — never on an internal call. A test that asserted
 * "redactSecrets was called" would pass over a guard that called it and threw
 * the result away (lessons-learned #11).
 *
 * The secret is a real Anthropic key SHAPE (`sk-ant-…`), so the shape half of
 * `redactSecrets` is what has to fire; one case additionally stubs an
 * environment variable to exercise the value half.
 */
import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { REDACTION_PLACEHOLDER, resetSecretEnvCache } from '@/lib/security/redactSecrets';
import { buildDeepSceneBody } from './deepSceneBody';

/** Matches `/\bsk-ant-[A-Za-z0-9_-]{16,200}/` in redactSecrets' shape list. */
const SECRET = 'sk-ant-api03-0123456789abcdefghijKLMNOPQRSTUVWXYZ';

/** What a provider client folds into a thrown error (#9736's actual shape). */
const UPSTREAM_ERROR = new Error(`Meshy status error (401): {"detail":"invalid key ${SECRET}"}`);

afterEach(() => {
  resetSecretEnvCache();
  vi.unstubAllEnvs();
});

async function serialize(res: Response): Promise<{ status: number; text: string; headers: string }> {
  const headerDump: string[] = [];
  res.headers.forEach((v, k) => headerDump.push(`${k}: ${v}`));
  return { status: res.status, text: await res.text(), headers: headerDump.join('\n') };
}

describe('withEgressGuard — the shapes that defeated the lint rule', () => {
  it('redacts a value laundered through an ALIAS into a module-scoped cache, on the LATER request that reads it', async () => {
    // The pass-3 blocker, verbatim: `const sink = cache; sink.set(...)` is
    // lint-clean because `sink` is *named* inside the catch, even though it
    // reaches a module-scoped Map that outlives the request.
    const cache = new Map<string, string>();

    const writer = withEgressGuard(async () => {
      try {
        throw UPSTREAM_ERROR;
      } catch (err) {
        const sink = cache;
        sink.set('last', (err as Error).message);
        return NextResponse.json({ error: 'Upstream failed' }, { status: 502 });
      }
    });

    // A DIFFERENT request, later, reads the cache back into a body. Nothing in
    // this handler is inside a catch at all.
    const reader = withEgressGuard(async () =>
      NextResponse.json({ lastError: cache.get('last') ?? null }));

    await writer();
    const out = await serialize(await reader());

    expect(cache.get('last')).toContain(SECRET); // the leak really happened
    expect(out.text).not.toContain(SECRET);
    expect(out.text).toContain(REDACTION_PLACEHOLDER);
    expect(JSON.parse(out.text).lastError).toContain(REDACTION_PLACEHOLDER);
  });

  it('redacts a response HEADER set after construction', async () => {
    const handler = withEgressGuard(async () => {
      try {
        throw UPSTREAM_ERROR;
      } catch (err) {
        const res = NextResponse.json({ error: 'Upstream failed' }, { status: 502 });
        const headers = res.headers; // aliasing the header bag: lint-clean
        headers.set('X-Upstream-Detail', (err as Error).message);
        return res;
      }
    });

    const res = await handler();
    const out = await serialize(res);

    expect(out.status).toBe(502);
    expect(res.headers.get('X-Upstream-Detail')).not.toContain(SECRET);
    expect(res.headers.get('X-Upstream-Detail')).toContain(REDACTION_PLACEHOLDER);
    expect(out.headers).not.toContain(SECRET);
  });

  it('redacts a REDIRECT URL, which is client-visible in the Location header and the address bar', async () => {
    const handler = withEgressGuard(async () => {
      try {
        throw UPSTREAM_ERROR;
      } catch (err) {
        return NextResponse.redirect(
          `https://spawnforge.test/fail?e=${encodeURIComponent((err as Error).message)}`,
        );
      }
    });

    const res = await handler();
    const location = res.headers.get('location') ?? '';

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    // Percent-encoding does not hide it. The guard looks THROUGH the encoding
    // and splices the placeholder into the raw string at the mapped offsets, so
    // the rest of the URL keeps its original encoding byte-for-byte and the
    // placeholder stays greppable.
    expect(decodeURIComponent(location)).not.toContain(SECRET);
    expect(location).toContain(REDACTION_PLACEHOLDER);
    expect(location).toMatch(/^https:\/\/spawnforge\.test\/fail\?e=Meshy%20status/);
  });

  it('redacts a COOKIE value', async () => {
    const handler = withEgressGuard(async () => {
      try {
        throw UPSTREAM_ERROR;
      } catch (err) {
        const res = NextResponse.json({ error: 'Upstream failed' }, { status: 502 });
        res.cookies.set('lastError', (err as Error).message);
        return res;
      }
    });

    const res = await handler();
    const setCookie = res.headers.get('set-cookie') ?? '';

    expect(setCookie).not.toBe('');
    expect(setCookie).not.toContain(SECRET);
    expect(setCookie).toContain(REDACTION_PLACEHOLDER);
  });

  it('redacts a ReadableStream error body, because a status >= 400 is always buffered', async () => {
    const handler = withEgressGuard(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          try {
            throw UPSTREAM_ERROR;
          } catch (err) {
            controller.enqueue(new TextEncoder().encode((err as Error).message));
            controller.close();
          }
        },
      });
      return new Response(stream, { status: 500, headers: { 'content-type': 'text/plain' } });
    });

    const out = await serialize(await handler());

    expect(out.status).toBe(500);
    expect(out.text).not.toContain(SECRET);
    expect(out.text).toContain(REDACTION_PLACEHOLDER);
  });

  it("redacts Promise.allSettled's rejection reason, which never passes through a catch clause", async () => {
    const handler = withEgressGuard(async () => {
      const results = await Promise.allSettled([
        Promise.resolve('ok'),
        Promise.reject(UPSTREAM_ERROR),
      ]);
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as Error).message);
      return NextResponse.json({ error: 'Partial failure', failures }, { status: 502 });
    });

    const out = await serialize(await handler());

    expect(out.status).toBe(502);
    expect(out.text).not.toContain(SECRET);
    expect(JSON.parse(out.text).failures[0]).toContain(REDACTION_PLACEHOLDER);
  });

  it('redacts an ENVIRONMENT value, whatever its shape, wherever it sits in the body', async () => {
    vi.stubEnv('SOME_PROVIDER_SECRET', 'not-a-known-shape-but-still-a-secret');
    resetSecretEnvCache();

    const handler = withEgressGuard(async () =>
      NextResponse.json({ deep: { detail: `boom: ${process.env.SOME_PROVIDER_SECRET}` } }, { status: 500 }));

    const out = await serialize(await handler());

    expect(out.text).not.toContain('not-a-known-shape-but-still-a-secret');
    expect(JSON.parse(out.text).deep.detail).toBe(`boom: ${REDACTION_PLACEHOLDER}`);
  });
});

describe('withEgressGuard — a response with nothing to redact is returned UNTOUCHED', () => {
  /**
   * This block is the one that would have caught the blocker, and the reason it
   * did not exist before is instructive: the previous version of it used
   * `{ ok: true, items: [1,2,3], nested: { a: null, b: 'plain text' } }`. Every
   * value in that fixture survives JSON.parse -> JSON.stringify unchanged and
   * nothing in it reaches depth 3, so the assertion passed for any
   * implementation that round-trips JSON at all — including the one that was
   * replacing every sub-tree past depth 8 with a placeholder string on every
   * real response (lessons-learned #11).
   *
   * The fixtures below are chosen so each named loss is REACHABLE: if the guard
   * went back to parse-and-re-serialise, each `it` here fails.
   */

  it('returns the handler\'s own Response OBJECT, not a rebuilt one', async () => {
    // The strongest form of the claim, and the cheapest to check: identity.
    // Nothing was re-serialised because nothing was serialised.
    const produced: Response[] = [];
    const handler = withEgressGuard(async () => {
      const made = NextResponse.json({ ok: true });
      produced.push(made);
      return made;
    });

    const res = await handler();

    expect(res).toBe(produced[0]);
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
  });

  it('keeps a REALISTIC published-game body byte-identical, tiles and keyframes included', async () => {
    // ~190 KB, 400 entities, with `tiles`, `localPosition` and `keyframes` at
    // depth 8 and 9 — the exact values the old MAX_DEPTH=8 bound replaced with
    // the string '[REDACTED: nesting depth limit]', which made the player's
    // deserialisation of a published game fail outright.
    const body = buildDeepSceneBody({ entities: 400 });
    const text = JSON.stringify(body);
    const handler = withEgressGuard(async () =>
      new NextResponse(text, { status: 200, headers: { 'content-type': 'application/json' } }));

    const out = await (await handler()).text();

    expect(out).toBe(text);
    // ...and the assertion is not vacuous: the body really is big and deep.
    expect(text.length).toBeGreaterThan(150_000);
    const first = (JSON.parse(out) as ReturnType<typeof buildDeepSceneBody>);
    const game = first.game as { sceneData: { entities: Array<Record<string, unknown>> } };
    const entity = game.sceneData.entities[0];
    const tilemap = entity.tilemap as { layers: Array<{ tiles: unknown[] }> };
    expect(Array.isArray(tilemap.layers[0].tiles)).toBe(true);
    expect(tilemap.layers[0].tiles.length).toBe(24);
  });

  it('preserves formatting, key order, large integers and -0 — every loss a round-trip causes', async () => {
    // Each of these is a real emitted body somewhere on this surface:
    //  - /api/user/export-data:297 emits JSON.stringify(x, null, 2) as a
    //    Content-Disposition attachment a human is meant to open and read;
    //  - sceneData is z.record(z.string(), z.unknown()), so tilemap layers keyed
    //    by index and script params carry integer-like keys;
    //  - a bigint column serialised as a JSON number exceeds 2^53.
    const text = [
      '{',
      '  "10": "ten",',
      '  "2": "two",',
      '  "bigId": 9007199254740993,',
      '  "huge": 12345678901234567890,',
      '  "negZero": -0,',
      '  "overflow": 1e400,',
      '  "note": "nothing sensitive here"',
      '}',
    ].join('\n');
    const handler = withEgressGuard(async () =>
      new NextResponse(text, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-disposition': 'attachment; filename="spawnforge-data-export.json"',
        },
      }));

    const out = await (await handler()).text();

    expect(out).toBe(text);
    // Named individually so a regression says WHICH loss came back.
    expect(out).toContain('\n  "10": "ten",\n  "2": "two",');   // formatting + key order
    expect(out).toContain('9007199254740993');                   // > 2^53
    expect(out).toContain('12345678901234567890');
    expect(out).toContain('-0');
    expect(out).toContain('1e400');
    // The fixture is capable of failing: a round-trip demonstrably changes it.
    expect(JSON.stringify(JSON.parse(text))).not.toBe(text);
  });

  it('preserves body, status, statusText and headers when nothing matches', async () => {
    const body = { ok: true, items: [1, 2, 3], nested: { a: null, b: 'plain text' } };
    const handler = withEgressGuard(async () =>
      new NextResponse(JSON.stringify(body), {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json', 'x-custom': 'kept' },
      }));

    const res = await handler();

    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Created');
    expect(res.headers.get('x-custom')).toBe('kept');
    expect(await res.text()).toBe(JSON.stringify(body));
  });

  it('keeps content-length when the body is NOT rewritten', async () => {
    const text = JSON.stringify({ ok: true });
    const handler = withEgressGuard(async () =>
      new NextResponse(text, {
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(text)),
        },
      }));

    const res = await handler();

    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)));
    expect(await res.text()).toBe(text);
  });

  it('DROPS a stale content-length when the body IS rewritten', async () => {
    // Redaction changes the byte length by construction — `[REDACTED]` is rarely
    // the width of the secret it replaces — and a stale length truncates or
    // hangs the response on the wire.
    const text = JSON.stringify({ error: `upstream said ${SECRET}` });
    const handler = withEgressGuard(async () =>
      new NextResponse(text, {
        status: 502,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(text)),
        },
      }));

    const res = await handler();
    const out = await res.text();

    expect(res.headers.get('content-length')).toBeNull();
    expect(out).not.toContain(SECRET);
    expect(out).toContain(REDACTION_PLACEHOLDER);
    // The whole redacted body arrived, not a prefix cut to the old length.
    expect(JSON.parse(out).error).toBe(`upstream said ${REDACTION_PLACEHOLDER}`);
  });

  it('redacts a secret planted DEEP inside an otherwise ordinary scene body', async () => {
    // The other half of the byte-identity claim. A guard that achieved identity
    // by not redacting would pass every test above; this is the one that says
    // the fast path is a fast path and not a hole.
    const body = buildDeepSceneBody({ entities: 40, plantedDeepText: `leaked ${SECRET}` });
    const text = JSON.stringify(body);
    expect(text).toContain(SECRET); // the fixture really carries it

    const handler = withEgressGuard(async () =>
      new NextResponse(text, { headers: { 'content-type': 'application/json' } }));

    const out = await (await handler()).text();

    expect(out).not.toContain(SECRET);
    expect(out).toContain(REDACTION_PLACEHOLDER);
    // ...and the deep structure around it is intact, not truncated.
    const parsed = JSON.parse(out) as {
      game: { sceneData: { entities: Array<{ tilemap: { layers: Array<{ tiles: unknown[] }> } }> } };
    };
    expect(parsed.game.sceneData.entities).toHaveLength(40);
    expect(parsed.game.sceneData.entities[0].tilemap.layers[0].tiles).toHaveLength(24);
  });

  it('does not turn a null-body status into a body', async () => {
    const handler = withEgressGuard(async () => new NextResponse(null, { status: 204 }));
    const res = await handler();
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('leaves a non-textual success body untouched', async () => {
    const bytes = new Uint8Array([0, 159, 146, 150, 255, 0]);
    const handler = withEgressGuard(async () =>
      new NextResponse(bytes, { headers: { 'content-type': 'application/octet-stream' } }));

    const res = await handler();
    const got = new Uint8Array(await res.arrayBuffer());

    expect([...got]).toEqual([...bytes]);
  });

  it('leaves a success body with NO content-type untouched, byte for byte', async () => {
    // An absent type used to be treated as textual, so the guard buffered the
    // body, UTF-8-decoded it and re-emitted it as text: every byte >= 0x80 came
    // back as U+FFFD. A PNG header came out 16 bytes instead of 10.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8]);
    const handler = withEgressGuard(async () => new Response(bytes, { status: 200 }));

    const res = await handler();
    const got = new Uint8Array(await res.arrayBuffer());

    expect([...got]).toEqual([...bytes]);
  });

  it('still buffers and redacts an ERROR body with no content-type', async () => {
    // The absent-type rule is scoped to success. Any status >= 400 is buffered
    // whatever the type, because that is where the leak class lives.
    const handler = withEgressGuard(async () =>
      new Response(`boom ${SECRET}`, { status: 500 }));

    const text = await (await handler()).text();

    expect(text).not.toContain(SECRET);
    expect(text).toContain(REDACTION_PLACEHOLDER);
  });

  it('redacts a non-JSON textual body as text', async () => {
    const handler = withEgressGuard(async () =>
      new NextResponse(`<rss><item>${SECRET}</item></rss>`, {
        headers: { 'content-type': 'application/rss+xml' },
      }));

    const text = await (await handler()).text();

    expect(text).not.toContain(SECRET);
    expect(text).toBe(`<rss><item>${REDACTION_PLACEHOLDER}</item></rss>`);
  });

  it('falls back to text redaction when a body claims JSON and is not', async () => {
    const handler = withEgressGuard(async () =>
      new NextResponse(`not json: ${SECRET}`, {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }));

    const text = await (await handler()).text();

    expect(text).toBe(`not json: ${REDACTION_PLACEHOLDER}`);
  });
});

describe('withEgressGuard — statusText is a client-visible channel, and it is covered', () => {
  it('redacts a secret placed in the HTTP reason phrase', async () => {
    // `new NextResponse(null, { status: 500, statusText: err.message })` is
    // precisely the "shape nobody thought of" the module header promises to
    // cover, and it used to be copied through verbatim. The reason phrase is
    // transmitted on the wire under HTTP/1.1.
    const handler = withEgressGuard(async () =>
      new NextResponse(JSON.stringify({ error: 'Upstream failed' }), {
        status: 502,
        statusText: `Upstream rejected ${SECRET}`,
        headers: { 'content-type': 'application/json' },
      }));

    const res = await handler();

    expect(res.statusText).not.toContain(SECRET);
    expect(res.statusText).toContain(REDACTION_PLACEHOLDER);
  });
});

describe('withEgressGuard — SELF_ISSUED_SHAPES are scoped to the error path', () => {
  const FORGE_KEY = `forge_${'0123456789abcdef'.repeat(4)}`;

  it('leaves a newly-minted API key in a 200 body, because that IS the feature', async () => {
    // POST /api/keys/api-key returns `key: rawKey` once, for the display that is
    // the point of creating a key. Redacting it there would empty the API Keys
    // UI — a control breaking the product it protects.
    const body = JSON.stringify({ key: FORGE_KEY, warning: 'Save this key now.' });
    const handler = withEgressGuard(async () =>
      new NextResponse(body, { status: 200, headers: { 'content-type': 'application/json' } }));

    expect(await (await handler()).text()).toBe(body);
  });

  it('removes the same key from an ERROR body, where it is always a leak', async () => {
    const handler = withEgressGuard(async () =>
      new NextResponse(JSON.stringify({ error: `rejected ${FORGE_KEY}` }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }));

    const text = await (await handler()).text();

    expect(text).not.toContain(FORGE_KEY);
    expect(text).toContain(REDACTION_PLACEHOLDER);
  });
});
describe('withEgressGuard — failure behaviour', () => {
  it('never throws from its own work: a response it cannot read becomes a fixed 500', async () => {
    const hostile = {
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: {} as ReadableStream<Uint8Array>,
      text: () => Promise.reject(new Error(`unreadable ${SECRET}`)),
    } as unknown as Response;

    const res = await withEgressGuard(async () => hostile)();
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
  });

  it('re-throws an uncaught handler error rather than converting it — the documented gap', async () => {
    // Stated as a gap in egressGuard.ts: swallowing this would silence
    // instrumentation.onRequestError and Sentry. Next.js renders its own error
    // response, which this guard never sees. Pinned so the choice is visible
    // rather than assumed.
    const handler = withEgressGuard(async () => {
      throw UPSTREAM_ERROR;
    });
    await expect(handler()).rejects.toThrow(UPSTREAM_ERROR);
  });

  it('passes a 2xx event-stream through unbuffered — the other documented gap', async () => {
    // Buffering here would stall SSE until the stream ended, and hang forever on
    // an open one; /api/chat streams as its core product path. The consequence
    // is that a 2xx stream BODY is not redacted, and this pins that so nobody
    // reads the guard as covering it. Headers still are.
    const handler = withEgressGuard(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${SECRET}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-detail': SECRET },
      });
    });

    const res = await handler();

    expect(res.headers.get('x-detail')).toContain(REDACTION_PLACEHOLDER);
    expect(await res.text()).toContain(SECRET); // the gap, asserted
  });
});

describe('withEgressGuard — cost', () => {
  it('derives the environment secret list ONCE per response, not once per header', async () => {
    // `redactSecrets` fingerprints `process.env` on every call, and that
    // fingerprint IS an enumeration. Redacting a body, ten headers and a cookie
    // with separate calls would pay it twelve times per request. This asserts
    // the property the batching exists for — on the path that actually runs.
    resetSecretEnvCache();
    const spy = vi.spyOn(Object, 'keys');

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    for (let i = 0; i < 10; i += 1) headers[`x-h${i}`] = `value ${i}`;

    const handler = withEgressGuard(async () =>
      new NextResponse(JSON.stringify({ a: 1, b: 'two', c: { d: 'three' } }), { headers }));

    const before = spy.mock.calls.filter((c) => c[0] === process.env).length;
    await handler();
    const after = spy.mock.calls.filter((c) => c[0] === process.env).length;
    spy.mockRestore();

    // One derive plus at most one fingerprint check.
    expect(after - before).toBeLessThanOrEqual(2);
  });
});
