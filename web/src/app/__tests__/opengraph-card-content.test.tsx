/**
 * What the OG cards actually say.
 *
 * `opengraph-image.test.tsx` proves the cards render without reaching a CDN. It
 * cannot prove *which* card rendered: the play route catches any failure and
 * falls back to a card built from constants, which reaches no CDN and produces
 * bytes just as happily as the real one. Every offline assertion there is
 * satisfied by the fallback.
 *
 * So this file stubs `next/og` and reads the element tree instead. The stub is
 * why it is a separate file — a `vi.doMock` of `next/og` that leaked into the
 * real-render suite would silently turn every one of those renders into a no-op
 * and take the CDN guard with it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: unknown[] = [];

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown) {
      captured.push(element);
    }
  },
}));

/** Concatenates every string in a React element tree, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return '';
}

const ROCKET = String.fromCodePoint(0x1f680);
/** U+1D400 MATHEMATICAL BOLD CAPITAL A — astral, but not emoji. */
const BOLD_A = String.fromCodePoint(0x1d400);

/**
 * Renders the play card against canned query results and returns its text.
 *
 * `rows` is consumed one query at a time, so a short array models "user found,
 * game missing". An `Error` member models a rejected query.
 */
async function playCardText(rows: unknown[]) {
  captured.length = 0;
  vi.resetModules();

  let call = 0;
  vi.doMock('@/lib/db/client', () => ({
    getDb: () => {
      throw new Error('getDb should not run: queryWithResilience is mocked');
    },
    queryWithResilience: async () => {
      const row = rows[call++];
      if (row instanceof Error) throw row;
      return row ?? [];
    },
  }));

  const mod = await import('../play/[userId]/[slug]/opengraph-image');
  await mod.default({ params: Promise.resolve({ userId: 'clerk_1', slug: 'space-game' }) });

  expect(captured).toHaveLength(1);
  return { text: textOf(captured[0]), queries: call };
}

const FOUND = [
  [{ id: 'u1', displayName: `${ROCKET}Ada` }],
  [{ title: `${ROCKET} Space Game`, description: `Blast off ${ROCKET}` }],
];

describe('play OG card content', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/db/client');
  });

  it('renders the real card, not the fallback', async () => {
    const { text, queries } = await playCardText(FOUND);
    expect(queries).toBe(2);
    // The distinguishing assertion. `expect(call).toBe(2)` alone cannot make it:
    // everything after the second query — three `stripEmoji` calls and the
    // truncation — runs inside `loadCard`'s catch, so a throw there still leaves
    // `call` at 2 and renders this same fallback.
    expect(text).not.toContain('Game not found');
    expect(text).toContain('Space Game');
    expect(text).toContain('Blast off');
    expect(text).toContain('Ada');
  });

  it('strips emoji from every user-supplied field', async () => {
    const { text } = await playCardText(FOUND);
    expect([...text].filter((c) => /\p{Extended_Pictographic}/u.test(c))).toEqual([]);
  });

  it('takes an astral non-emoji initial whole', async () => {
    // Guards the call site, not just the helper: by the time `initialFor` runs,
    // `creatorName` is already stripped, so a revert to `creatorName[0]` still
    // yields 'A' for an ASCII name and nothing notices. An astral name is what
    // separates them — `[0]` there is half a surrogate pair.
    const { text } = await playCardText([
      [{ id: 'u1', displayName: `${BOLD_A}da` }],
      [{ title: 'Space Game', description: 'desc' }],
    ]);

    // Asserting the card merely *contains* BOLD_A proves nothing: the creator
    // name renders elsewhere on the card and carries the whole pair either way.
    // What separates the two spellings is a surrogate with no partner, which a
    // well-formed string never has.
    const lone = text.match(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g);
    expect(lone).toBeNull();
  });

  it('truncates after stripping, so the slice cannot cut an emoji in half', async () => {
    // The emoji sits astride the 117-unit cut. Anywhere else and the two
    // orderings agree: an emoji past the cut is dropped either way, so a test
    // that puts it at the end pins nothing.
    const straddling = `${'x'.repeat(116)}${ROCKET}${'x'.repeat(20)}`;
    const { text } = await playCardText([
      [{ id: 'u1', displayName: 'Ada' }],
      [{ title: 'Space Game', description: straddling }],
    ]);

    // Stripping first leaves 136 plain characters, truncated to 117 + '...'.
    // Slicing first would cut the surrogate pair at index 117 and leave its
    // high half behind — a lone surrogate, and one character short.
    expect(text).toContain(`${'x'.repeat(117)}...`);
    expect(
      text.match(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g)
    ).toBeNull();
  });

  it('falls back when the user is not found', async () => {
    const { text, queries } = await playCardText([[]]);
    expect(queries).toBe(1);
    expect(text).toContain('Game not found');
  });

  it('falls back when the game is not found', async () => {
    const { text, queries } = await playCardText([[{ id: 'u1', displayName: 'Ada' }], []]);
    expect(queries).toBe(2);
    expect(text).toContain('Game not found');
  });

  it('falls back when a query rejects', async () => {
    const { text } = await playCardText([new Error('connection lost')]);
    expect(text).toContain('Game not found');
  });

  it('falls back when a row is missing the one field with no null guard', async () => {
    // `game.title` is read as `stripEmoji(game.title)` with no `?? ''`,
    // unlike description and displayName. A row without it throws inside
    // `loadCard` — which must degrade to the fallback, not to a 500.
    const { text } = await playCardText([
      [{ id: 'u1', displayName: 'Ada' }],
      [{ description: 'no title on this row' }],
    ]);
    expect(text).toContain('Game not found');
  });
});
