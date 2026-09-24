/** Async modal loading/failure and keyboard dismissal/focus regressions. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@/test/utils/componentTestUtils';
import { GameDetailModal } from '../GameDetailModal';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Play: (props: Record<string, unknown>) => <span data-testid="play-icon" {...props} />,
  Heart: (props: Record<string, unknown>) => <span data-testid="heart-icon" {...props} />,
  GitFork: (props: Record<string, unknown>) => <span data-testid="fork-icon" {...props} />,
  ExternalLink: (props: Record<string, unknown>) => <span data-testid="external-link" {...props} />,
  Share2: (props: Record<string, unknown>) => <span data-testid="share-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
  MessageCircle: (props: Record<string, unknown>) => <span data-testid="message-circle" {...props} />,
  Flag: (props: Record<string, unknown>) => <span data-testid="flag-icon" {...props} />,
}));


vi.mock('../CommentSection', () => ({
  CommentSection: () => <div data-testid="comment-section" />,
}));

const mockPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockPush })),
}));

// Mock fetch for game detail endpoint
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GameDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('installs Escape and focus trapping after a delayed fetch with stable onClose', async () => {
    let complete: (response: Response) => void = () => { throw new Error('fetch promise not initialized'); };
    mockFetch.mockReturnValueOnce(new Promise<Response>(resolve => { complete = resolve; }));
    const onClose = vi.fn();
    render(<><button>Outside</button><GameDetailModal gameId="game-1" onClose={onClose} /></>);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await act(async () => complete(new Response(JSON.stringify({ game: {
      id: 'game-1', title: 'Delayed Game', description: null, authorName: 'Author', authorId: 'author-1',
      playCount: 0, likeCount: 0, avgRating: 0, ratingCount: 0,
      ratingBreakdown: [], tags: [], cdnUrl: null, createdAt: '2024-01-01', comments: [],
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await screen.findByRole('heading', { name: 'Delayed Game' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    const user = userEvent.setup();
    await user.tab({ shift: true });
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Outside' })).not.toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps the loading dialog dismissible with focused Close', async () => {
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    const onClose = vi.fn();
    render(<GameDetailModal gameId="game-1" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Loading game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
  });


  it('preserves rating focus when the caller replaces its dismissal callback', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ game: {
      id: 'game-1', title: 'Focus Game', description: null,
      authorName: 'Author', authorId: 'author-1', playCount: 0, likeCount: 0,
      avgRating: 3, ratingCount: 1, ratingBreakdown: [], tags: [], cdnUrl: null,
      createdAt: '2024-01-01', comments: [],
    } }) });
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(<GameDetailModal gameId="game-1" onClose={firstClose} />);
    const radio = await screen.findByRole('radio', { name: 'Rate 3 stars' });
    radio.focus();
    expect(radio).toHaveFocus();
    rerender(<GameDetailModal gameId="game-1" onClose={latestClose} />);
    expect(radio).toHaveFocus();
    await userEvent.setup().keyboard('{Escape}');
    expect(latestClose).toHaveBeenCalledExactlyOnceWith();
    expect(firstClose).not.toHaveBeenCalled();
  });


  it.each([
    { state: 'loading', action: 'Escape' }, { state: 'loading', action: 'Close' },
    { state: 'success', action: 'Escape' }, { state: 'success', action: 'Close' },
    { state: 'failure', action: 'Escape' }, { state: 'failure', action: 'Close' },
  ])('returns focus to the keyboard invoker after $action in $state', async ({ state, action }) => {
    if (state === 'loading') mockFetch.mockReturnValueOnce(new Promise(() => {}));
    else if (state === 'failure') mockFetch.mockResolvedValueOnce({ ok: false });
    else mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ game: {
      id: 'game-1', title: 'Focus Game', description: null,
      authorName: 'Author', authorId: 'author-1', playCount: 0, likeCount: 0,
      avgRating: 3, ratingCount: 1, ratingBreakdown: [], tags: [], cdnUrl: null,
      createdAt: '2024-01-01', comments: [],
    } }) });
    function GalleryInvoker() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>View Focus Game</button>
        {open && <GameDetailModal gameId="game-1" onClose={() => setOpen(false)} />}</>;
    }
    render(<GalleryInvoker />);
    const user = userEvent.setup();
    const view = screen.getByRole('button', { name: 'View Focus Game' });
    await user.tab(); expect(view).toHaveFocus();
    await user.keyboard('{Enter}');
    if (state !== 'loading') await screen.findByRole('heading', { name: state === 'success' ? 'Focus Game' : 'Game unavailable' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    if (action === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view).toHaveFocus();
  });

  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<GameDetailModal gameId="game-1" onClose={vi.fn()} />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('renders game details after loading', async () => {
    const gameData = {
      game: {
        id: 'game-1',
        title: 'Amazing Game',
        description: 'A great game',
        authorName: 'Author',
        authorId: 'author-1',
        playCount: 100,
        likeCount: 25,
        avgRating: 4.2,
        ratingCount: 10,
        ratingBreakdown: [],
        tags: ['action'],
        cdnUrl: null,
        createdAt: '2024-01-01',
        comments: [],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(gameData),
    });

    render(<GameDetailModal gameId="game-1" onClose={vi.fn()} />);

    // Wait for async load
    const title = await screen.findByText('Amazing Game');
    expect(title).toBeDefined();
    expect(screen.getByText('by Author')).toBeDefined();
    expect(screen.getByText('A great game')).toBeDefined();
  });

  it('points the Play Game link at the /play route, never a raw R2 bundle url (#7580)', async () => {
    // Regression guard for the #7580 review: publish once repurposed cdnUrl to
    // the absolute R2 bundle object URL when the mirror succeeded. This <a href>
    // (and the share link built from it) is a playable-page link, so cdnUrl must
    // stay the relative /play/{userId}/{slug} route. The publish route now keeps
    // it there; this pins the consumer's expectation so the contract cannot
    // silently drift back.
    const playUrl = '/play/clerk_1/amazing-game';
    const gameData = {
      game: {
        id: 'game-1',
        title: 'Amazing Game',
        description: 'A great game',
        authorName: 'Author',
        authorId: 'author-1',
        playCount: 100,
        likeCount: 25,
        avgRating: 4.2,
        ratingCount: 10,
        ratingBreakdown: [],
        tags: ['action'],
        cdnUrl: playUrl,
        createdAt: '2024-01-01',
        comments: [],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(gameData),
    });

    render(<GameDetailModal gameId="game-1" onClose={vi.fn()} />);

    const playLink = await screen.findByRole('link', { name: /Play Game/i });
    const href = playLink.getAttribute('href');
    expect(href).toBe(playUrl);
    // A raw bundle object url would be an absolute https://…/bundle.json — the
    // exact regression this guards against.
    expect(href).not.toMatch(/^https?:\/\//);
    expect(href).not.toContain('bundle.json');
  });

  it.each([
    { quarantinedScripts: 3, query: '?quarantinedScripts=3' },
    { quarantinedScripts: 0, query: '' },
    { quarantinedScripts: undefined, query: '' },
    { quarantinedScripts: '3&redirect=elsewhere', query: '' },
  ])('opens the forked editor with the quarantine notice for count $quarantinedScripts', async ({ quarantinedScripts, query }) => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          game: {
            id: 'game-1', title: 'Remixable Game', description: null,
            authorName: 'Author', authorId: 'author-1',
            playCount: 0, likeCount: 0, avgRating: 0, ratingCount: 0,
            ratingBreakdown: [], tags: [], cdnUrl: null,
            createdAt: '2024-01-01', comments: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projectId: 'project /?#', quarantinedScripts }),
      });
    const onClose = vi.fn();

    // Exercise the real store so the API count must survive both boundaries.
    render(<GameDetailModal gameId="game-1" onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fork' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/editor/project%20%2F%3F%23${query}`);
    });
    expect(mockFetch).toHaveBeenCalledWith('/api/community/games/game-1/fork', { method: 'POST' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // a11y (#9048): the icon-only close button must have an accessible name.
  it('gives the modal close button an accessible name', async () => {
    const gameData = {
      game: {
        id: 'game-1',
        title: 'Amazing Game',
        description: 'A great game',
        authorName: 'Author',
        authorId: 'author-1',
        playCount: 100,
        likeCount: 25,
        avgRating: 4.2,
        ratingCount: 10,
        ratingBreakdown: [],
        tags: ['action'],
        cdnUrl: null,
        createdAt: '2024-01-01',
        comments: [],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(gameData),
    });
    const onClose = vi.fn();

    render(<GameDetailModal gameId="game-1" onClose={onClose} />);
    await screen.findByText('Amazing Game');

    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed fetch in a named dismissible dialog', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    const onClose = vi.fn();
    render(<GameDetailModal gameId="game-1" onClose={onClose} />);
    await screen.findByRole('heading', { name: 'Game unavailable' });
    expect(screen.getByRole('dialog', { name: 'Game unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This game could not be loaded');
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
  });});

// ---------------------------------------------------------------------------
// Fork attribution (#7858)
// ---------------------------------------------------------------------------
describe('GameDetailModal fork attribution', () => {
  const baseGame = {
    id: 'game-2', title: 'Fork Of Something', description: null,
    authorName: 'Forker', authorId: 'user-2', playCount: 1, likeCount: 0,
    avgRating: 0, ratingCount: 0, ratingBreakdown: [], tags: [], cdnUrl: null,
    createdAt: '2025-01-03T00:00:00.000Z', comments: [], forkCount: 3, forkedFrom: null,
  };

  afterEach(() => {
    cleanup();
  });

  it('credits the original with a link to its play page and shows the fork count', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ game: {
      ...baseGame,
      forkedFrom: { gameId: 'game-1', title: 'The Original', slug: 'the-original', authorClerkId: 'user_clerkOriginal', authorName: 'Origin Author' },
    } }) });
    render(<GameDetailModal gameId="game-2" onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: 'The Original' });
    expect(link).toHaveAttribute('href', '/play/user_clerkOriginal/the-original');
    expect(screen.getByText(/Remixed from/)).toHaveTextContent('Remixed from The Original by Origin Author');
    expect(screen.getByText('Forks').nextElementSibling).toHaveTextContent('3');
  });

  it('renders no attribution line when the game is not a fork', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ game: baseGame }) });
    render(<GameDetailModal gameId="game-2" onClose={() => {}} />);
    await screen.findByText('Fork Of Something');
    expect(screen.queryByText(/Remixed from/)).toBeNull();
  });

  it('says the source is no longer available, with no title, author or link, when the original was taken down', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ game: {
      ...baseGame,
      forkedFrom: { gameId: null, title: null, slug: null, authorClerkId: null, authorName: null, unavailable: true },
    } }) });
    render(<GameDetailModal gameId="game-2" onClose={() => {}} />);
    expect(await screen.findByText('Remixed from a game that is no longer available')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Original/ })).toBeNull();
    expect(screen.queryByText(/by Origin Author/)).toBeNull();
  });
});
