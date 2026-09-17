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
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedResponse {
  element: unknown;
  options: unknown;
}

const captured: CapturedResponse[] = [];

vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(element: unknown, options: unknown) {
      captured.push({ element, options });
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

interface CapturedElement {
  children: unknown;
  style: Record<string, unknown>;
}

/** Narrow unknown React/Satori values to the props this route's layout exposes. */
function capturedElement(node: unknown): CapturedElement | null {
  if (node === null || typeof node !== 'object' || !('props' in node)) return null;
  const props = (node as { props?: unknown }).props;
  if (props === null || typeof props !== 'object') return null;
  const children = 'children' in props ? (props as { children?: unknown }).children : undefined;
  const style = 'style' in props ? (props as { style?: unknown }).style : undefined;
  return { children, style: style !== null && typeof style === 'object' ? style as Record<string, unknown> : {} };
}

/** Flatten direct element children without assuming React's internal node type. */
function directElements(children: unknown): CapturedElement[] {
  if (Array.isArray(children)) return children.flatMap(directElements);
  const element = capturedElement(children);
  return element ? [element] : [];
}

/** Read the custom-font list passed to ImageResponse, if the route supplied it. */
function responseFonts(options: unknown): Array<{ name: string; weight: number }> | undefined {
  if (options === null || typeof options !== 'object' || !('fonts' in options)) return undefined;
  const fonts = (options as { fonts?: unknown }).fonts;
  if (!Array.isArray(fonts)) return undefined;
  return fonts.map(({ name, weight }) => ({ name, weight }));
}

interface LocatedElement {
  element: CapturedElement;
  ancestors: CapturedElement[];
}

/** Find the real rendered wrapper for a field and retain its route-tree parents. */
function findRenderedText(root: unknown, text: string): LocatedElement {
  const visit = (node: unknown, ancestors: CapturedElement[]): LocatedElement | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child, ancestors);
        if (found) return found;
      }
      return null;
    }
    const element = capturedElement(node);
    if (!element) return null;
    // Descend before accepting a parent with the same aggregate text: the
    // title wrapper and the Arabic helper row both contain the phrase, but
    // only the innermost helper row owns the reverse/wrap layout contract.
    const nested = visit(element.children, [element, ...ancestors]);
    if (nested) return nested;
    return textOf(element.children) === text ? { element, ancestors } : null;
  };
  const found = visit(root, []);
  if (!found) throw new Error('Missing rendered text wrapper for ' + text);
  return found;
}

/** Assert the real route rendered the helper's logical Arabic word-row shape. */
function expectArabicWordRow(located: LocatedElement, phrase: string): void {
  expect(located.element.style).toMatchObject({ display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap' });
  const words = directElements(located.element.children);
  expect(words.map(word => textOf(word.children))).toEqual(phrase.split(' '));
  for (const word of words) {
    expect(word.style).toMatchObject({ display: 'flex', whiteSpace: 'normal', wordBreak: 'break-all', maxWidth: '100%', flexShrink: 0 });
  }
}

const ROCKET = String.fromCodePoint(0x1f680);
/** U+2000B CJK ideograph — covered by the local CJK font and not emoji. */
const BOLD_A = String.fromCodePoint(0x2000b);

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
  return { text: textOf(captured[0].element), tree: captured[0].element, options: captured[0].options, queries: call };
}

const FOUND = [
  [{ id: 'u1', displayName: `${ROCKET}Ada` }],
  [{ title: `${ROCKET} Space Game`, description: `Blast off ${ROCKET}` }],
];

describe('play OG card content', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/db/client');
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/db/client');
    vi.doUnmock('node:fs/promises');
  });

  it('renders the real card, not the fallback', async () => {
    const { text, tree, options, queries } = await playCardText(FOUND);
    expect(queries).toBe(2);
    // The distinguishing assertion. `expect(call).toBe(2)` alone cannot make it:
    // everything after the second query — three `stripEmoji` calls and the
    // truncation — runs inside `loadCard`'s catch, so a throw there still leaves
    // `call` at 2 and renders this same fallback.
    expect(text).not.toContain('Game not found');
    expect(text).toContain('Space Game');
    expect(text).toContain('Blast off');
    expect(text).toContain('Ada');
    expect(capturedElement(tree)?.style.fontFamily).toBe('SpawnForge OG Latin, SpawnForge OG Arabic, SpawnForge OG CJK');
    expect(findRenderedText(tree, 'Space Game').element.style.fontWeight).toBe(700);
    expect(responseFonts(options)).toEqual([
      { name: 'SpawnForge OG Latin', weight: 400 },
      { name: 'SpawnForge OG Latin', weight: 700 },
      { name: 'SpawnForge OG Arabic', weight: 400 },
      { name: 'SpawnForge OG CJK', weight: 400 },
    ]);
  });

  it('omits custom fonts and private covered text after a traced asset read failure', async () => {
    const selectiveRead = vi.fn();
    vi.doMock('node:fs/promises', async (importActual) => {
      const actual = await importActual<typeof import('node:fs/promises')>();
      selectiveRead.mockImplementation((...args: Parameters<typeof actual.readFile>) => {
        if (String(args[0]).includes('NotoSans-Regular.ttf')) {
          return Promise.reject(new Error('simulated traced font read failure'));
        }
        return actual.readFile(...args);
      });
      return { ...actual, readFile: selectiveRead };
    });
    const creator = 'صانع خاص';
    const title = '秘密のゲーム';
    const description = 'وصف سري';
    const { text, options } = await playCardText([[{ id: 'u1', displayName: creator }], [{ title, description }]]);

    expect(selectiveRead.mock.calls.some(([file]) => String(file).includes('NotoSans-Regular.ttf'))).toBe(true);
    expect(options).not.toHaveProperty('fonts');
    expect(text).toBe('SpawnForge Play on SpawnForge');
    expect(text).not.toContain(creator);
    expect(text).not.toContain(title);
    expect(text).not.toContain(description);
  });

  it.each(['星の冒険', '별의 모험', '星际冒险', 'Звёздное приключение', 'مغامرة النجوم'])('retains supported text %s in the actual card', async (title) => {
    const { text } = await playCardText([[{ id: 'u1', displayName: title }], [{ title, description: title }]]);
    expect(text).toContain(title);
    expect(text).not.toContain('Game not found');
  });

  it('wires each pure-Arabic field through its own bounded logical word row', async () => {
    const title = 'مغامرة النجوم';
    const description = 'رحلة إلى السماء';
    const creator = 'أحمد ناصر';
    const { text, tree } = await playCardText([[{ id: 'u1', displayName: creator }], [{ title, description }]]);
    expect(text).toContain(title);
    expect(text).toContain(description);
    expect(text).toContain(creator);
    expect(text).not.toContain('Game not found');

    const titleRow = findRenderedText(tree, title);
    const descriptionRow = findRenderedText(tree, description);
    const creatorRow = findRenderedText(tree, creator);
    expect(new Set([titleRow.element, descriptionRow.element, creatorRow.element]).size).toBe(3);
    expectArabicWordRow(titleRow, title);
    expectArabicWordRow(descriptionRow, description);
    expectArabicWordRow(creatorRow, creator);
    expect(titleRow.ancestors[0]?.style).toMatchObject({ width: 900, maxWidth: '100%', minWidth: 0 });
    expect(descriptionRow.ancestors[0]?.style).toMatchObject({ width: 800, maxWidth: '100%', minWidth: 0 });
    expect(creatorRow.ancestors[0]?.style).toMatchObject({ width: 680, minWidth: 0, flexShrink: 1 });
    expect(creatorRow.ancestors[1]?.style).toMatchObject({ width: 760, minWidth: 0, flexShrink: 1 });
    const brand = findRenderedText(tree, 'SpawnForge');
    expect(brand.ancestors[0]?.style).toMatchObject({ flexShrink: 0 });
  });
  it.each(['title', 'description', 'displayName'])('uses only generic text when %s has an uncovered glyph', async (field) => {
    const user = { id: 'u1', displayName: 'PrivateCreator' };
    const game = { title: 'PrivateTitle', description: 'PrivateDescription' };
    if (field === 'displayName') user.displayName += '\u03E2';
    else game[field as 'title' | 'description'] += '\u9FF0';
    const { text } = await playCardText([[user], [game]]);
    expect(text).toContain('Play on SpawnForge');
    expect(text).not.toContain('Game not found');
    expect(text).not.toContain('Private');
  });

  it.each(['\u019B', '\u0264', '\u2184'])('uses generic text when uppercasing creator initial %s yields a missing glyph', async (initial) => {
    const { text } = await playCardText([
      [{ id: 'u1', displayName: initial + 'PrivateCreator' }],
      [{ title: 'PrivateTitle', description: 'PrivateDescription' }],
    ]);
    expect(text).toContain('Play on SpawnForge');
    expect(text).not.toContain('Game not found');
    expect(text).not.toContain('Private');
    expect(text).not.toContain(initial.toUpperCase());
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
    expect(text).toContain(BOLD_A);
    expect(text).not.toContain('Game not found');
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
