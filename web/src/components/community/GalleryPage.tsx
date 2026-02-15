'use client';

import { useEffect, useState } from 'react';
import { useCommunityStore } from '@/stores/communityStore';
import { GameCard } from './GameCard';
import { GameDetailModal } from './GameDetailModal';
import { Search, TrendingUp, Clock, Star, Play } from 'lucide-react';

export function GalleryPage() {
  const {
    games,
    featuredGames,
    loading,
    searchQuery,
    sortBy,
    filterTag,
    hasMore,
    likedGameIds,
    fetchGames,
    fetchFeaturedGames,
    setSearchQuery,
    setSortBy,
    setFilterTag,
    likeGame,
    unlikeGame,
  } = useCommunityStore();

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    fetchGames(true);
    fetchFeaturedGames();

    // Fetch popular tags
    const fetchTags = async () => {
      try {
        const res = await fetch('/api/community/tags');
        if (!res.ok) return;
        const data = await res.json();
        setTags(data.tags);
      } catch (err) {
        console.error('Failed to fetch tags:', err);
      }
    };

    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(localSearch);
  };

  const handleLoadMore = () => {
    fetchGames(false);
  };

  const sortOptions = [
    { value: 'trending' as const, label: 'Trending', icon: TrendingUp },
    { value: 'newest' as const, label: 'Newest', icon: Clock },
    { value: 'top_rated' as const, label: 'Top Rated', icon: Star },
    { value: 'most_played' as const, label: 'Most Played', icon: Play },
  ];

  return (
    <div className="min-h-screen bg-zinc-900">
      {/* Header */}
      <div className="bg-zinc-800 border-b border-zinc-700">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-zinc-100 mb-2">
            Community Gallery
          </h1>
          <p className="text-zinc-400">
            Discover and play games created by the community
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Featured Games */}
        {featuredGames.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-zinc-100 mb-4">Featured</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {featuredGames.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  isLiked={likedGameIds.has(game.id)}
                  onLike={() =>
                    likedGameIds.has(game.id)
                      ? unlikeGame(game.id)
                      : likeGame(game.id)
                  }
                  onClick={() => setSelectedGameId(game.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div className="space-y-4 mb-6">
          {/* Search Bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search games..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded pl-10 pr-4 py-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Search
            </button>
          </form>

          {/* Sort Tabs */}
          <div className="flex gap-2 overflow-x-auto">
            {sortOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => setSortBy(option.value)}
                  className={`flex items-center gap-2 px-4 py-2 rounded transition-colors whitespace-nowrap ${
                    sortBy === option.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {option.label}
                </button>
              );
            })}
          </div>

          {/* Tag Filters */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilterTag(null)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  !filterTag
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                All
              </button>
              {tags.slice(0, 10).map((tag) => (
                <button
                  key={tag.tag}
                  onClick={() => setFilterTag(tag.tag)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    filterTag === tag.tag
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {tag.tag} ({tag.count})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Games Grid */}
        {loading && games.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">
            No games found. Try different filters.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  isLiked={likedGameIds.has(game.id)}
                  onLike={() =>
                    likedGameIds.has(game.id)
                      ? unlikeGame(game.id)
                      : likeGame(game.id)
                  }
                  onClick={() => setSelectedGameId(game.id)}
                />
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="px-6 py-3 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Game Detail Modal */}
      {selectedGameId && (
        <GameDetailModal
          gameId={selectedGameId}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </div>
  );
}
