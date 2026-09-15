import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { GameDetailModal } from '../GameDetailModal';

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

vi.mock('../StarRating', () => ({
  StarRating: ({ value }: { value: number }) => (
    <span data-testid="star-rating">{value}</span>
  ),
}));

vi.mock('../CommentSection', () => ({
  CommentSection: () => <div data-testid="comment-section" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('@/stores/communityStore', () => ({
  useCommunityStore: vi.fn(() => ({
    likedGameIds: new Set(),
    userRatings: {},
    likeGame: vi.fn(),
    unlikeGame: vi.fn(),
    rateGame: vi.fn(),
    forkGame: vi.fn(),
  })),
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

  it('renders nothing if game fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
    });

    const { container } = render(
      <GameDetailModal gameId="game-1" onClose={vi.fn()} />
    );

    // Wait for loading to finish
    await vi.waitFor(() => {
      expect(screen.queryByText('Loading...')).toBeNull();
    });

    // Component returns null when no game
    expect(container.innerHTML).toBe('');
  });
});
