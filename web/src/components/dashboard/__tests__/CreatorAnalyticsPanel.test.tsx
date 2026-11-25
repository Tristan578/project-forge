/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@/test/utils/componentTestUtils';
import { CreatorAnalyticsPanel } from '../CreatorAnalyticsPanel';
import type { CreatorStats } from '@/lib/projects/creatorStats';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

const fetchMock = vi.fn();

const STATS: CreatorStats = {
  totalPublishedGames: 3,
  totalPlays: 1515,
  games: [
    { id: 'a', title: 'Crystal Run', slug: 'crystal-run', status: 'published', playCount: 1500, createdAt: '2026-09-01T10:00:00.000Z' },
    { id: 'b', title: 'Lava Caves', slug: 'lava-caves', status: 'published', playCount: 15, createdAt: '2026-09-02T10:00:00.000Z' },
    { id: 'c', title: 'Sky Hop', slug: 'sky-hop', status: 'flagged', playCount: 0, createdAt: '2026-09-03T10:00:00.000Z' },
  ],
  tokenUsage: { monthlyUsed: 250, monthlyTotal: 1000, addon: 40 },
};

/**
 * Answer every request with this response until told otherwise. Persistent,
 * not *Once: the render helper runs React's StrictMode, which mounts effects
 * twice, so the panel legitimately fetches twice on mount.
 */
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(() => {
  mockPush.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CreatorAnalyticsPanel', () => {
  it('shows a loading state, and no numbers, before the stats arrive', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<CreatorAnalyticsPanel />);

    expect(screen.getByTestId('creator-analytics-loading')).toBeInTheDocument();
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Total plays')).toBeNull();
  });

  it('shows the three totals and a row per game, most played first', async () => {
    respond(STATS);
    render(<CreatorAnalyticsPanel />);

    const totals = await screen.findByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('Games live').nextSibling?.textContent).toBe('3');
    expect(within(totals).getByText('Total plays').nextSibling?.textContent).toBe('1,515');
    expect(within(totals).getByText('Tokens used this cycle').nextSibling?.textContent).toBe('250');
    expect(within(totals).getByText(/of 1,000 monthly, plus 40 add-on tokens left/)).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Crystal Run',
      'Lava Caves',
      'Sky Hop',
    ]);
    expect(within(rows[0]!).getByText('1,500')).toBeInTheDocument();
    // Moderation state is spelled out for the creator, not the raw enum.
    expect(within(rows[2]!).getByText('Under review')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/creator/stats');
  });

  it('shows zeros and an empty-state message for a creator with no games', async () => {
    respond({ ...STATS, totalPublishedGames: 0, totalPlays: 0, games: [] });
    render(<CreatorAnalyticsPanel />);

    expect(await screen.findByText(/No published games yet/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    const totals = screen.getByRole('region', { name: 'Totals' });
    expect(within(totals).getByText('Total plays').nextSibling?.textContent).toBe('0');
  });

  it('shows an error with Retry when the route fails, and recovers on retry', async () => {
    respond({ error: 'Creator stats are unavailable right now' }, 503);
    render(<CreatorAnalyticsPanel />);

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load your analytics');

    respond(STATS);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('region', { name: 'Totals' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the connection failed when the request itself rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<CreatorAnalyticsPanel />);

    expect((await screen.findByRole('alert')).textContent).toContain('Unable to connect');
  });

  it('sends a signed-out user to sign in', async () => {
    respond({ error: 'Unauthorized' }, 401);
    render(<CreatorAnalyticsPanel />);

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sign-in'));
  });

  it('goes back to the projects list', async () => {
    respond(STATS);
    render(<CreatorAnalyticsPanel />);
    await screen.findByRole('region', { name: 'Totals' });

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });
});
