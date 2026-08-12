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

  // One case per class of character satori routes to the emoji CDN. They are
  // NOT all `Extended_Pictographic` — see the note on `stripEmoji`.
  // Every one of these was measured reaching jsDelivr through the real bundle.
  it.each([
    ['pictographic', String.fromCodePoint(0x1f680)],
    ['regional-indicator flag', '\u{1F1FA}\u{1F1F8}'],
    ['keycap sequence', '1️⃣'],
    ['lone skin-tone modifier', String.fromCodePoint(0x1f3fb)],
    ['ZWJ sequence', '\u{1F468}‍\u{1F4BB}'],
    ['tag sequence flag', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'],
  ])('reaches no remote host with a %s in user text', async (_class, glyph) => {
    const rows = [
      [{ id: 'u1', displayName: `${glyph}Ada` }],
      [{ title: `${glyph} Space Game`, description: `Blast off ${glyph}` }],
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

    // `call` reaching 2 says both queries ran. It does NOT say the real card
    // rendered — everything after the second query is inside `loadCard`'s
    // catch. `opengraph-card-content.test.tsx` is what pins that.
    expect(call).toBe(2);
    expect(remote).toEqual([]);
    expect(bytes).toBeGreaterThan(0);
  });

  it('reaches no remote host when a long description is truncated', async () => {
    // Truncation is the other way a sanitised string can still reach a CDN: cut
    // an astral character's surrogate pair in half and satori resolves the
    // leftover through Google Fonts. This case only proves the cut itself is
    // harmless for text the bundled font covers — see the note below for why an
    // astral character cannot be tested here at all.
    const rows = [
      [{ id: 'u1', displayName: 'Ada' }],
      [{ title: 'Space Game', description: 'x'.repeat(400) }],
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

    expect(call).toBe(2);
    expect(remote).toEqual([]);
    expect(bytes).toBeGreaterThan(0);
  });
});

/*
 * Why the truncation guard is not an offline-render test.
 *
 * The obvious case — an astral non-emoji astride the cut — cannot be asserted
 * here. Satori fetched `fonts.googleapis.com/css2?family=Noto+Sans+Math` for
 * U+1D400 even when the pair arrived whole: `@vercel/og`'s bundled font is
 * Latin-only, so ANY codepoint outside its coverage is resolved remotely,
 * whether or not our truncation damaged it. Both spellings fail this suite
 * identically, so it can discriminate nothing.
 *
 * That remote font fetch is pre-existing and outside this change: it is the
 * documented behaviour of `@vercel/og` for non-Latin text, it affects only the
 * on-demand play card (never `next build`), and it is the same for a CJK title
 * today as it was before. What it does mean is that codepoint-safe truncation
 * has to be pinned structurally instead — `opengraph-card-content.test.tsx`
 * reads the rendered element tree for a lone surrogate, and `lib/og/text` tests
 * `truncateChars` directly.
 */

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
 * It scans for `Extended_Pictographic`, which is deliberately NOT the property
 * satori keys on — satori keys on `Emoji`, and the two differ by 43 codepoints
 * (see `stripEmoji`). This is a source-hygiene net, not a model of the
 * classifier: it catches the glyph a developer would actually paste into a
 * source file, and it stays quiet on ordinary typography (`—` is not
 * pictographic) and on the digits and `#`/`*` that `Emoji` also covers, which
 * appear in this codebase constantly and are harmless. The runtime guarantee is
 * the offline render above; this only keeps the source clean.
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
