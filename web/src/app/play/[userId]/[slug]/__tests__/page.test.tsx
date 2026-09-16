/**
 * Tests for the /play page's consumption of the per-request CSP nonce
 * (PF-1018, #9038).
 *
 * The proxy MINTS the nonce and advertises it in the response CSP; this page
 * READS it back off the forwarded `x-nonce` request header and stamps it onto
 * its own JSON-LD `<script>`. Those are two halves of one contract living in
 * two files, and proxy.test.ts only covers the minting half. If the header name
 * is ever typo'd, or the `headers()` read is dropped in a refactor, nothing
 * server-side throws — the tag simply ships without a nonce. Under the /play
 * policy (no 'unsafe-inline') the browser then drops it silently.
 *
 * Rendering is done by invoking the async server component directly and walking
 * the returned element tree. RTL cannot render an async server component, and
 * a string-match over the source could not tell a live `nonce={nonce}` from one
 * inside a comment.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const headersGet = vi.fn<(name: string) => string | null>();

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: headersGet })),
}));

// notFound() throws a control-flow signal in Next; the real one throws an error
// carrying the NEXT_HTTP_ERROR_FALLBACK;404 digest. The mock reproduces the
// throw so the page's non-null narrowing and short-circuit are exercised.
const NOT_FOUND_SIGNAL = 'NEXT_NOT_FOUND';
const notFoundMock = vi.fn((): never => {
  throw new Error(NOT_FOUND_SIGNAL);
});
vi.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
}));

vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(async () => ({ userId: null })),
}));

// The page renders these; their internals are irrelevant to the nonce contract.
// The happy-path tree asserts actual component elements and props; direct async
// invocation does not render children, so mock invocation counts are not evidence.
const gamePlayerMock = vi.fn((_props?: unknown) => null);
const breadcrumbsMock = vi.fn((_props?: unknown) => null);
vi.mock('@/components/play/GamePlayer', () => ({
  GamePlayer: (props: unknown) => gamePlayerMock(props),
}));
vi.mock('@/components/marketing/Breadcrumbs', () => ({
  Breadcrumbs: (props: unknown) => breadcrumbsMock(props),
}));

vi.mock('@/lib/db/schema', () => ({
  publishedGames: {
    title: 'title',
    description: 'description',
    createdAt: 'created_at',
    userId: 'user_id',
    slug: 'slug',
    status: 'status',
  },
  users: { id: 'id', clerkId: 'clerk_id', displayName: 'display_name' },
}));

/**
 * The page issues two sequential queries (user, then game). Returning a row for
 * both is what makes the JSON-LD branch render at all — with no game the tag is
 * `null` and a nonce assertion would pass vacuously.
 */
const GAME_ROW = {
  title: 'Cave Escape',
  description: 'A tiny platformer',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
const USER_ROW = { id: 'u1', displayName: 'Ada' };

let limitResults: Array<unknown[] | Error> = [];
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => {
      const result = limitResults.shift() ?? [];
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }),
  })),
  queryWithResilience: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}));

/** Depth-first search for the JSON-LD script element in a rendered tree. */
function findJsonLd(node: ReactNode): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findJsonLd(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<{ type?: string; children?: ReactNode }>;
  if (el.type === 'script' && el.props?.type === 'application/ld+json') return el;
  return findJsonLd(el.props?.children);
}

/** Find a component element in returned JSX without pretending its body rendered. */
function findComponent(node: ReactNode, component: ReactElement['type']): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findComponent(child, component);
      if (hit) return hit;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  return element.type === component ? element : findComponent(element.props?.children, component);
}

async function renderPlayPage() {
  const { default: PlayPage } = await import('../page');
  return PlayPage({
    params: Promise.resolve({ userId: 'user_abc', slug: 'cave-escape' }),
  });
}

describe('PlayPage nonce consumption (PF-1018)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitResults = [[USER_ROW], [GAME_ROW]];
  });

  it('stamps the proxy-supplied nonce onto its JSON-LD script', async () => {
    headersGet.mockImplementation((name) =>
      name === 'x-nonce' ? 'test-nonce-value' : null,
    );

    const tree = await renderPlayPage();
    const script = findJsonLd(tree);

    // Guard the guard: if the tag stopped rendering, the nonce assertion below
    // would be vacuous rather than failing.
    expect(script, 'JSON-LD script did not render').not.toBeNull();
    expect(headersGet).toHaveBeenCalledWith('x-nonce');
    expect((script!.props as { nonce?: string }).nonce).toBe('test-nonce-value');
  });

  it('omits the attribute entirely when no nonce was forwarded', async () => {
    // `nonce=""` is not the same as no nonce: an empty attribute is a value the
    // policy will never match, so it must be undefined rather than a blank
    // string on the paths that carry no nonce (e.g. a static prerender).
    headersGet.mockReturnValue(null);

    const script = findJsonLd(await renderPlayPage());
    expect(script).not.toBeNull();
    expect((script!.props as { nonce?: string }).nonce).toBeUndefined();
  });

  it('reads the nonce from the request headers, not a hardcoded value', async () => {
    // Pins the wiring rather than one literal: a page that ignored the header
    // and emitted a constant would pass the first test but fail this one.
    headersGet.mockImplementation((name) =>
      name === 'x-nonce' ? 'a-different-nonce' : null,
    );

    const script = findJsonLd(await renderPlayPage());
    expect((script!.props as { nonce?: string }).nonce).toBe('a-different-nonce');
  });
});

/**
 * A missing published game must produce a true HTTP 404, not a soft-404 (a 200
 * with a "Game Not Found" title that crawlers index).
 *
 * Acceptance criterion (PF-1029): "Given a visitor requests a published game
 * that does not exist, When the response is returned, Then its HTTP status is
 * 404 rather than 200." The proxy returns a direct404 before streaming; this
 * unit contract pins the page race guard, which terminates body construction
 * when metadata disappears. Playwright separately proves literal document status.
 */
describe('PlayPage 404 on missing game (PF-1029)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersGet.mockReturnValue(null);
  });

  it('calls notFound() and renders no game body when the game is missing', async () => {
    // User exists, but no published game matches the slug — the realistic
    // missing/unpublished case getGameData collapses to null.
    limitResults = [[USER_ROW], []];

    // notFound() throws, so the component never reaches its return: the JSON-LD
    // script and the GamePlayer/Breadcrumbs elements are never constructed.
    await expect(renderPlayPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledExactlyOnceWith();
  });

  it('404s when the user itself does not exist', async () => {
    // First query (user lookup) is empty, so getGameData short-circuits to null
    // before the game query — this path must 404 too, not render a shell.
    limitResults = [[], []];

    await expect(renderPlayPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(['author', 'game'])('propagates a %s database failure without declaring the game missing', async query => {
    limitResults = query === 'author' ? [new Error('database unreachable')] : [[USER_ROW], new Error('database unreachable')];
    await expect(renderPlayPage()).rejects.toThrow('database unreachable');
    expect(notFoundMock).not.toHaveBeenCalled();
    limitResults = query === 'author' ? [new Error('database unreachable')] : [[USER_ROW], new Error('database unreachable')];
    const { generateMetadata } = await import('../page');
    await expect(generateMetadata({ params: Promise.resolve({ userId: 'user_abc', slug: 'cave-escape' }) }))
      .rejects.toThrow('database unreachable');
  });

  it('does NOT call notFound() when a published game exists', async () => {
    // Guards the guard: proves the 404 is conditional on absence, not always on.
    limitResults = [[USER_ROW], [GAME_ROW]];

    const tree = await renderPlayPage();
    const script = findJsonLd(tree);
    expect(script, 'JSON-LD script did not render for a real game').not.toBeNull();
    expect(notFoundMock).not.toHaveBeenCalled();
    const { GamePlayer } = await import('@/components/play/GamePlayer');
    const { Breadcrumbs } = await import('@/components/marketing/Breadcrumbs');
    const player = findComponent(tree, GamePlayer);
    const breadcrumb = findComponent(tree, Breadcrumbs);
    expect(player).not.toBeNull();
    expect(player!.props).toEqual({ userId: 'user_abc', slug: 'cave-escape', isAuthenticated: false });
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb!.props).toEqual({ items: [
      { label: 'Community', href: '/community' },
      { label: GAME_ROW.title, href: '/play/user_abc/cave-escape' },
    ] });
  });
});
