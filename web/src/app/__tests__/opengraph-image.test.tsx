/**
 * Tests for the OG image routes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

describe('Root OG Image', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports correct size (1200x630)', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.size).toEqual({ width: 1200, height: 630 });
  });

  it('exports alt text', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.alt).toBe('SpawnForge — AI-Powered Game Creation Platform');
  });

  it('exports image/png content type', async () => {
    const mod = await import('../opengraph-image');
    expect(mod.contentType).toBe('image/png');
  });

  it('default export returns an ImageResponse', async () => {
    const mod = await import('../opengraph-image');
    const response = mod.default();
    // ImageResponse extends Response
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('image/png');
  });
});

/**
 * Renders an OG route with every non-`data:` fetch refused, and reports which
 * hosts it tried to reach.
 *
 * Constructing the `ImageResponse` is not enough to see this — satori does the
 * work lazily, when the body is consumed. The four tests above have called
 * `mod.default()` since they were written and never noticed that the render
 * reached out to a CDN.
 *
 * `data:` URIs pass through: that is how `@vercel/og` loads its own bundled
 * WASM, and refusing it would fail every render for the wrong reason.
 */
async function renderOffline(makeResponse: () => Response | Promise<Response>) {
  const remote: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;
    if (url.startsWith('data:')) return realFetch(input, init);
    remote.push(url);
    throw new Error(`blocked remote fetch: ${url}`);
  }) as typeof fetch;
  try {
    const bytes = (await (await makeResponse()).arrayBuffer()).byteLength;
    return { remote, bytes };
  } catch {
    return { remote, bytes: 0 };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * A prerendered OG route that fetches a remote asset puts a third party on the
 * critical path of `next build` — and it does not degrade to a plain image, it
 * exits the export. That is how `⚒` (U+2692 HAMMER AND PICK) broke a build:
 * satori classifies the codepoint as an emoji and `@vercel/og` resolves emoji
 * through jsDelivr, never through the bundled font.
 *
 * `bytes` is the positive control. Without it a render that died for an
 * unrelated reason would report zero remote fetches and pass.
 */
describe('OG routes render offline', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ['root', () => import('../opengraph-image')],
    ['community', () => import('../community/opengraph-image')],
    ['pricing', () => import('../pricing/opengraph-image')],
  ])('%s reaches no remote host and still produces an image', async (_name, load) => {
    const mod = await load();
    const { remote, bytes } = await renderOffline(() => mod.default());
    expect(remote).toEqual([]);
    expect(bytes).toBeGreaterThan(0);
  });
});

/**
 * The play card is the one OG route that renders text it did not write: a game
 * title, a description, and a creator's initial. It is not prerendered, so an
 * emoji there does not break `next build` — it breaks that one game's share
 * card at request time, which is a defect nobody would ever see reported.
 *
 * The DB is mocked rather than stubbed at the driver level so the assertion is
 * about the route's own sanitising, not about drizzle.
 */
describe('play OG route renders offline with emoji-laden user text', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/db/client');
  });

  it('reaches no remote host and still produces an image', async () => {
    const rocket = String.fromCodePoint(0x1f680);
    const rows = [
      [{ id: 'u1', displayName: `${rocket}Ada` }],
      [{ title: `${rocket} Space Game`, description: `Blast off ${rocket}` }],
    ];
    let call = 0;
    vi.doMock('@/lib/db/client', () => ({
      getDb: () => {
        throw new Error('getDb should not run: queryWithResilience is mocked');
      },
      queryWithResilience: async () => rows[call++],
    }));

    const mod = await import('../play/[userId]/[slug]/opengraph-image');
    const { remote, bytes } = await renderOffline(() =>
      mod.default({
        params: Promise.resolve({ userId: 'clerk_1', slug: 'space-game' }),
      })
    );

    // Both queries ran, so the route rendered the real card. Without this the
    // test passes vacuously: the route catches any DB error and falls back to a
    // card built from constants, which of course renders offline.
    expect(call).toBe(2);
    expect(remote).toEqual([]);
    expect(bytes).toBeGreaterThan(0);
  });
});

const APP_DIR = join(__dirname, '..');
const OG_LIB_DIR = join(__dirname, '..', '..', 'lib', 'og');

function collectOgSources(dir: string, match: (name: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      found.push(...collectOgSources(full, match));
    } else if (match(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The offline render above covers the three static routes directly. This scan
 * covers what it cannot reach: `play/[userId]/[slug]` needs a database, and a
 * shared module is only exercised through whoever imports it.
 *
 * `Extended_Pictographic` is the property satori's own emoji segmentation keys
 * on, so it flags the same characters that would be routed to the emoji CDN —
 * and not ordinary typography (`—` is not pictographic).
 *
 * The scan reads raw source, comments included. That is deliberately one notch
 * stricter than the real rule: stripping comments first would need a
 * quote-aware parser, and a comment is a cheap place to spell the codepoint out
 * instead.
 */
describe('OG sources carry no emoji codepoints', () => {
  const pictographic = /\p{Extended_Pictographic}/u;

  const sources = [
    ...collectOgSources(APP_DIR, (n) => /^(opengraph|twitter)-image\.(tsx|ts|jsx|js)$/.test(n)),
    ...collectOgSources(OG_LIB_DIR, (n) => /\.(tsx|ts)$/.test(n)),
  ];

  it('scans exactly the files it is supposed to scan', () => {
    // Pinned to the list, not to a floor. A floor of 4 against 6 real files let
    // two of them leave the scan silently — a route renamed off the filename
    // pattern above is enough, and the remaining files keep the suite green.
    // Adding an OG route means adding it here, which is the intent.
    expect(sources.map((f) => relative(join(__dirname, '..', '..'), f)).sort()).toEqual([
      'app/community/opengraph-image.tsx',
      'app/opengraph-image.tsx',
      'app/play/[userId]/[slug]/opengraph-image.tsx',
      'app/pricing/opengraph-image.tsx',
      'lib/og/BrandMark.tsx',
      'lib/og/text.ts',
    ]);
  });

  it.each(sources)('%s', (file) => {
    const text = readFileSync(file, 'utf8');
    const offenders = [...text].filter((c) => pictographic.test(c));
    expect(offenders).toEqual([]);
  });
});
