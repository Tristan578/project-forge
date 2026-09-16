/** Gallery card preview with independent native details and like controls. */
'use client';

import { GalleryGame } from '@/stores/communityStore';
import { Heart, Play } from 'lucide-react';
import { StarRating } from './StarRating';

/** Community preview data and independent details/like actions. */
interface GameCardProps {
  /** Published gallery summary rendered by this card. */
  game: GalleryGame;
  /** Toggle the caller-owned liked state. */
  onLike: () => void;
  /** Current liked state announced by the Like button. */
  isLiked: boolean;
  /** Open details for this game. */
  onClick: () => void;
}

/**
 * Render a neutral card with sibling native View and Like buttons.
 * The View button covers the preview; Like sits above it and activates independently.
 * @param props Game summary, current like state, and independent callbacks.
 * @returns A gallery card with native keyboard actions and a read-only rating.
 */
export function GameCard({ game, onLike, isLiked, onClick }: GameCardProps) {
  return (
    <article className="relative bg-zinc-800 rounded-lg overflow-hidden hover:bg-zinc-700 transition-colors group">
      <button
        type="button"
        aria-label={`View ${game.title}`}
        onClick={onClick}
        className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      />
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
        <div className="absolute top-2 right-2 z-20 flex gap-2">
          <button
            type="button"
            onClick={onLike}
            aria-label={isLiked ? 'Unlike' : 'Like'}
            aria-pressed={isLiked}
            className={`min-h-11 min-w-11 flex items-center justify-center p-2 rounded-full backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
              isLiked
                ? 'bg-red-500/80 text-white'
                : 'bg-black/40 text-white hover:bg-black/60'
            }`}
          >
            <Heart aria-hidden="true" className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
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
              <Play aria-hidden="true" className="w-3 h-3" />
              {game.playCount}
            </div>
            <div className="flex items-center gap-1">
              <Heart aria-hidden="true" className="w-3 h-3" />
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
    </article>
  );
}
