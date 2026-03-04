import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GalleryPage } from '../GalleryPage';

vi.mock('lucide-react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
  TrendingUp: (props: Record<string, unknown>) => <span data-testid="trending-icon" {...props} />,
  Clock: (props: Record<string, unknown>) => <span data-testid="clock-icon" {...props} />,
  Star: (props: Record<string, unknown>) => <span data-testid="star-icon" {...props} />,
  Play: (props: Record<string, unknown>) => <span data-testid="play-icon" {...props} />,
}));

vi.mock('./GameCard', () => ({
  GameCard: ({ game }: { game: { title: string } }) => (
    <div data-testid="game-card">{game.title}</div>
  ),
}));

vi.mock('./GameDetailModal', () => ({
  GameDetailModal: () => <div data-testid="game-detail-modal" />,
}));

const mockFetchGames = vi.fn();
const mockFetchFeaturedGames = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSetSortBy = vi.fn();
const mockSetFilterTag = vi.fn();

vi.mock('@/stores/communityStore', () => ({
  useCommunityStore: vi.fn(() => ({
    games: [],
    featuredGames: [],
    loading: false,
    searchQuery: '',
    sortBy: 'trending',
    filterTag: null,
    hasMore: false,
    likedGameIds: new Set(),
    fetchGames: mockFetchGames,
    fetchFeaturedGames: mockFetchFeaturedGames,
    setSearchQuery: mockSetSearchQuery,
    setSortBy: mockSetSortBy,
    setFilterTag: mockSetFilterTag,
    likeGame: vi.fn(),
    unlikeGame: vi.fn(),
  })),
}));

// Mock fetch for tags endpoint
const mockFetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ tags: [] }),
  })
);
vi.stubGlobal('fetch', mockFetch);

describe('GalleryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    render(<GalleryPage />);
    expect(screen.getByText('Community Gallery')).toBeDefined();
    expect(screen.getByText('Discover and play games created by the community')).toBeDefined();
  });

  it('shows empty state when no games', () => {
    render(<GalleryPage />);
    expect(screen.getByText('No games found. Try different filters.')).toBeDefined();
  });

  it('renders sort tabs', () => {
    render(<GalleryPage />);
    expect(screen.getByText('Trending')).toBeDefined();
    expect(screen.getByText('Newest')).toBeDefined();
    expect(screen.getByText('Top Rated')).toBeDefined();
    expect(screen.getByText('Most Played')).toBeDefined();
  });

  it('calls setSortBy when a sort tab is clicked', () => {
    render(<GalleryPage />);
    fireEvent.click(screen.getByText('Newest'));
    expect(mockSetSortBy).toHaveBeenCalledWith('newest');
  });
});
