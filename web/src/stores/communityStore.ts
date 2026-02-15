import { create } from 'zustand';

export interface GalleryGame {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  authorName: string;
  authorId: string;
  playCount: number;
  likeCount: number;
  avgRating: number;
  ratingCount: number;
  commentCount: number;
  tags: string[];
  thumbnail: string | null;
  cdnUrl: string | null;
  createdAt: string;
}

interface CommunityState {
  // Gallery
  games: GalleryGame[];
  featuredGames: GalleryGame[];
  loading: boolean;
  error: string | null;

  // Filters
  searchQuery: string;
  sortBy: 'trending' | 'newest' | 'top_rated' | 'most_played';
  filterTag: string | null;
  page: number;
  hasMore: boolean;

  // User interactions
  likedGameIds: Set<string>;
  userRatings: Record<string, number>;

  // Actions
  fetchGames: (reset?: boolean) => Promise<void>;
  fetchFeaturedGames: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  setSortBy: (sort: CommunityState['sortBy']) => void;
  setFilterTag: (tag: string | null) => void;
  likeGame: (gameId: string) => Promise<void>;
  unlikeGame: (gameId: string) => Promise<void>;
  rateGame: (gameId: string, rating: number) => Promise<void>;
  forkGame: (gameId: string) => Promise<string>;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  // Initial state
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

  // Actions
  fetchGames: async (reset = false) => {
    const { searchQuery, sortBy, filterTag, page, games } = get();
    set({ loading: true, error: null });

    try {
      const params = new URLSearchParams({
        sort: sortBy,
        page: reset ? '1' : String(page),
        limit: '20',
      });
      if (searchQuery) params.set('q', searchQuery);
      if (filterTag) params.set('tag', filterTag);

      const res = await fetch(`/api/community/games?${params}`);
      if (!res.ok) throw new Error('Failed to fetch games');

      const data = await res.json();

      set({
        games: reset ? data.games : [...games, ...data.games],
        hasMore: data.hasMore,
        page: reset ? 2 : page + 1,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Unknown error',
        loading: false,
      });
    }
  },

  fetchFeaturedGames: async () => {
    try {
      const res = await fetch('/api/community/games/featured');
      if (!res.ok) throw new Error('Failed to fetch featured games');

      const data = await res.json();
      set({ featuredGames: data.games });
    } catch (err) {
      console.error('Failed to fetch featured games:', err);
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q, page: 1 });
    get().fetchGames(true);
  },

  setSortBy: (sort) => {
    set({ sortBy: sort, page: 1 });
    get().fetchGames(true);
  },

  setFilterTag: (tag) => {
    set({ filterTag: tag, page: 1 });
    get().fetchGames(true);
  },

  likeGame: async (gameId) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/like`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to like game');

      const data = await res.json();

      // Update local state
      set((state) => {
        const newLikedGameIds = new Set(state.likedGameIds);
        newLikedGameIds.add(gameId);

        const updateGame = (game: GalleryGame) =>
          game.id === gameId ? { ...game, likeCount: data.likeCount } : game;

        return {
          likedGameIds: newLikedGameIds,
          games: state.games.map(updateGame),
          featuredGames: state.featuredGames.map(updateGame),
        };
      });
    } catch (err) {
      console.error('Failed to like game:', err);
    }
  },

  unlikeGame: async (gameId) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/like`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to unlike game');

      const data = await res.json();

      // Update local state
      set((state) => {
        const newLikedGameIds = new Set(state.likedGameIds);
        newLikedGameIds.delete(gameId);

        const updateGame = (game: GalleryGame) =>
          game.id === gameId ? { ...game, likeCount: data.likeCount } : game;

        return {
          likedGameIds: newLikedGameIds,
          games: state.games.map(updateGame),
          featuredGames: state.featuredGames.map(updateGame),
        };
      });
    } catch (err) {
      console.error('Failed to unlike game:', err);
    }
  },

  rateGame: async (gameId, rating) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error('Failed to rate game');

      const data = await res.json();

      // Update local state
      set((state) => {
        const updateGame = (game: GalleryGame) =>
          game.id === gameId
            ? {
                ...game,
                avgRating: data.avgRating,
                ratingCount: data.ratingCount,
              }
            : game;

        return {
          userRatings: { ...state.userRatings, [gameId]: rating },
          games: state.games.map(updateGame),
          featuredGames: state.featuredGames.map(updateGame),
        };
      });
    } catch (err) {
      console.error('Failed to rate game:', err);
    }
  },

  forkGame: async (gameId) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/fork`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to fork game');

      const data = await res.json();
      return data.projectId;
    } catch (err) {
      console.error('Failed to fork game:', err);
      throw err;
    }
  },
}));
