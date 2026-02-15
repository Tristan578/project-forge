'use client';

import { GalleryGame } from '@/stores/communityStore';
import { Heart, Play } from 'lucide-react';
import { StarRating } from './StarRating';

interface GameCardProps {
  game: GalleryGame;
  onLike: () => void;
  isLiked: boolean;
  onClick: () => void;
}

export function GameCard({ game, onLike, isLiked, onClick }: GameCardProps) {
  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onLike();
  };

  return (
    <div
      className="bg-zinc-800 rounded-lg overflow-hidden cursor-pointer hover:bg-zinc-750 transition-colors group"
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 relative">
        {game.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.thumbnail}
            alt={game.title}
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute top-2 right-2 flex gap-2">
          <button
            onClick={handleLikeClick}
            className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
              isLiked
                ? 'bg-red-500/80 text-white'
                : 'bg-black/40 text-white hover:bg-black/60'
            }`}
          >
            <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-zinc-100 font-semibold mb-1 truncate group-hover:text-white">
          {game.title}
        </h3>
        <p className="text-xs text-zinc-400 mb-3">by {game.authorName}</p>

        {/* Stats */}
        <div className="flex items-center justify-between mb-3">
          <StarRating value={game.avgRating} count={game.ratingCount} size="sm" />
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="flex items-center gap-1">
              <Play className="w-3 h-3" />
              {game.playCount}
            </div>
            <div className="flex items-center gap-1">
              <Heart className="w-3 h-3" />
              {game.likeCount}
            </div>
          </div>
        </div>

        {/* Tags */}
        {game.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {game.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs bg-zinc-700 text-zinc-300 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
