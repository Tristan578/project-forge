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

vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(async () => ({ userId: null })),
}));

// The page renders these; their internals are irrelevant to the nonce contract.
vi.mock('@/components/play/GamePlayer', () => ({
  GamePlayer: () => null,
}));
vi.mock('@/components/marketing/Breadcrumbs', () => ({
  Breadcrumbs: () => null,
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

let limitResults: unknown[][] = [];
vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(limitResults.shift() ?? [])),
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
