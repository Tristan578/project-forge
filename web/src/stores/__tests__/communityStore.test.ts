/**
 * Unit tests for the communityStore Zustand store.
 *
 * Tests cover game gallery, filters, sorting, pagination, user interactions
 * (likes, ratings, forks), and API integration.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommunityStore, type GalleryGame } from '../communityStore';

// Mock fetch globally
global.fetch = vi.fn();

const mockGame: GalleryGame = {
  id: 'game-1',
  title: 'Test Game',
  description: 'A test game',
  slug: 'test-game',
  authorName: 'Test Author',
  authorId: 'author-1',
  playCount: 100,
  likeCount: 10,
  avgRating: 4.5,
  ratingCount: 20,
  commentCount: 5,
  tags: ['action', 'adventure'],
  thumbnail: 'https://example.com/thumb.png',
  cdnUrl: 'https://cdn.example.com/game',
  createdAt: '2025-01-01T00:00:00Z',
};

describe('communityStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useCommunityStore.setState({
      games: [],
      featuredGames: [],
      loading: false,
      error: null,
      searchQuery: '',
      sortBy: 'trending',
      filterTag: null,
      page: 1,
      hasMore: true,
      likedGameIds: new Set(),
      userRatings: {},
    });
    // Clear mocks
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with empty games array', () => {
      const state = useCommunityStore.getState();
      expect(state.games).toEqual([]);
    });

    it('should initialize with empty featured games', () => {
      const state = useCommunityStore.getState();
      expect(state.featuredGames).toEqual([]);
    });

    it('should initialize with loading false', () => {
      const state = useCommunityStore.getState();
      expect(state.loading).toBe(false);
    });

    it('should initialize with no error', () => {
      const state = useCommunityStore.getState();
      expect(state.error).toBeNull();
    });

    it('should initialize with trending sort', () => {
      const state = useCommunityStore.getState();
      expect(state.sortBy).toBe('trending');
    });

    it('should initialize with page 1', () => {
      const state = useCommunityStore.getState();
      expect(state.page).toBe(1);
      expect(state.hasMore).toBe(true);
    });

    it('should initialize with empty liked games', () => {
      const state = useCommunityStore.getState();
      expect(state.likedGameIds).toEqual(new Set());
    });

    it('should initialize with empty user ratings', () => {
      const state = useCommunityStore.getState();
      expect(state.userRatings).toEqual({});
    });
  });

  describe('Filter Actions', () => {
    it('should update search query and reset page', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [], hasMore: false }),
      } as Response);

      const { setSearchQuery } = useCommunityStore.getState();
      setSearchQuery('platformer');

      const state = useCommunityStore.getState();
      expect(state.searchQuery).toBe('platformer');
      expect(state.page).toBe(1);
    });

    it('should update sort by and reset page', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [], hasMore: false }),
      } as Response);

      const { setSortBy } = useCommunityStore.getState();
      setSortBy('newest');

      const state = useCommunityStore.getState();
      expect(state.sortBy).toBe('newest');
      expect(state.page).toBe(1);
    });

    it('should update filter tag and reset page', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [], hasMore: false }),
      } as Response);

      const { setFilterTag } = useCommunityStore.getState();
      setFilterTag('puzzle');

      const state = useCommunityStore.getState();
      expect(state.filterTag).toBe('puzzle');
      expect(state.page).toBe(1);
    });

    it('should clear filter tag', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [], hasMore: false }),
      } as Response);

      useCommunityStore.setState({ filterTag: 'action' });
      const { setFilterTag } = useCommunityStore.getState();
      setFilterTag(null);

      const state = useCommunityStore.getState();
      expect(state.filterTag).toBeNull();
    });
  });

  describe('fetchGames', () => {
    it('should fetch games successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [mockGame], hasMore: true }),
      } as Response);

      const { fetchGames } = useCommunityStore.getState();
      await fetchGames();

      const state = useCommunityStore.getState();
      expect(state.games).toHaveLength(1);
      expect(state.games[0]).toEqual(mockGame);
      expect(state.hasMore).toBe(true);
      expect(state.loading).toBe(false);
    });

    it('should append games when not resetting', async () => {
      useCommunityStore.setState({ games: [mockGame], page: 2 });

      const newGame = { ...mockGame, id: 'game-2', title: 'Game 2' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [newGame], hasMore: false }),
      } as Response);

      const { fetchGames } = useCommunityStore.getState();
      await fetchGames(false);

      const state = useCommunityStore.getState();
      expect(state.games).toHaveLength(2);
      expect(state.games[0]).toEqual(mockGame);
      expect(state.games[1]).toEqual(newGame);
      expect(state.page).toBe(3);
    });

    it('should replace games when resetting', async () => {
      useCommunityStore.setState({ games: [mockGame], page: 5 });

      const newGame = { ...mockGame, id: 'game-2', title: 'Game 2' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [newGame], hasMore: true }),
      } as Response);

      const { fetchGames } = useCommunityStore.getState();
      await fetchGames(true);

      const state = useCommunityStore.getState();
      expect(state.games).toHaveLength(1);
      expect(state.games[0]).toEqual(newGame);
      expect(state.page).toBe(2);
    });

    it('should handle fetch error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const { fetchGames } = useCommunityStore.getState();
      await fetchGames();

      const state = useCommunityStore.getState();
      expect(state.error).toBe('Failed to fetch games');
      expect(state.loading).toBe(false);
    });

    it('should build correct query params', async () => {
      useCommunityStore.setState({
        searchQuery: 'test',
        sortBy: 'top_rated',
        filterTag: 'puzzle',
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [], hasMore: false }),
      } as Response);

      const { fetchGames } = useCommunityStore.getState();
      await fetchGames();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=top_rated')
      );
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('q=test'));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('tag=puzzle'));
    });
  });

  describe('fetchFeaturedGames', () => {
    it('should fetch featured games', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ games: [mockGame] }),
      } as Response);

      const { fetchFeaturedGames } = useCommunityStore.getState();
      await fetchFeaturedGames();

      const state = useCommunityStore.getState();
      expect(state.featuredGames).toHaveLength(1);
      expect(state.featuredGames[0]).toEqual(mockGame);
    });

    it('should handle fetch error silently', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
      } as Response);

      const { fetchFeaturedGames } = useCommunityStore.getState();
      await fetchFeaturedGames();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('User Interactions', () => {
    it('should like a game', async () => {
      useCommunityStore.setState({ games: [mockGame] });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ likeCount: 11 }),
      } as Response);

      const { likeGame } = useCommunityStore.getState();
      await likeGame('game-1');

      const state = useCommunityStore.getState();
      expect(state.likedGameIds.has('game-1')).toBe(true);
      expect(state.games[0].likeCount).toBe(11);
    });

    it('should update like in both games and featured', async () => {
      useCommunityStore.setState({
        games: [mockGame],
        featuredGames: [mockGame],
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ likeCount: 15 }),
      } as Response);

      const { likeGame } = useCommunityStore.getState();
      await likeGame('game-1');

      const state = useCommunityStore.getState();
      expect(state.games[0].likeCount).toBe(15);
      expect(state.featuredGames[0].likeCount).toBe(15);
    });

    it('should unlike a game', async () => {
      useCommunityStore.setState({
        games: [mockGame],
        likedGameIds: new Set(['game-1']),
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ likeCount: 9 }),
      } as Response);

      const { unlikeGame } = useCommunityStore.getState();
      await unlikeGame('game-1');

      const state = useCommunityStore.getState();
      expect(state.likedGameIds.has('game-1')).toBe(false);
      expect(state.games[0].likeCount).toBe(9);
    });

    it('should rate a game', async () => {
      useCommunityStore.setState({ games: [mockGame] });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ avgRating: 4.6, ratingCount: 21 }),
      } as Response);

      const { rateGame } = useCommunityStore.getState();
      await rateGame('game-1', 5);

      const state = useCommunityStore.getState();
      expect(state.userRatings['game-1']).toBe(5);
      expect(state.games[0].avgRating).toBe(4.6);
      expect(state.games[0].ratingCount).toBe(21);
    });

    it('should fork a game and return project ID', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ projectId: 'proj-123' }),
      } as Response);

      const { forkGame } = useCommunityStore.getState();
      const projectId = await forkGame('game-1');

      expect(projectId).toBe('proj-123');
      expect(fetch).toHaveBeenCalledWith(
        '/api/community/games/game-1/fork',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should handle fork error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
      } as Response);

      const { forkGame } = useCommunityStore.getState();
      await expect(forkGame('game-1')).rejects.toThrow();

      consoleSpy.mockRestore();
    });
  });
});
