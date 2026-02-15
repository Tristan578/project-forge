'use client';

import { useEffect, useState } from 'react';
import { X, Play, Heart, GitFork, ExternalLink } from 'lucide-react';
import { StarRating } from './StarRating';
import { CommentSection } from './CommentSection';
import { useCommunityStore } from '@/stores/communityStore';
import { useRouter } from 'next/navigation';

interface GameDetail {
  id: string;
  title: string;
  description: string | null;
  authorName: string;
  authorId: string;
  playCount: number;
  likeCount: number;
  avgRating: number;
  ratingCount: number;
  ratingBreakdown: { rating: number; count: number }[];
  tags: string[];
  cdnUrl: string | null;
  createdAt: string;
  comments: Array<{
    id: string;
    content: string;
    parentId: string | null;
    authorId: string;
    authorName: string;
    createdAt: string;
  }>;
}

interface GameDetailModalProps {
  gameId: string;
  onClose: () => void;
}

export function GameDetailModal({ gameId, onClose }: GameDetailModalProps) {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { likedGameIds, userRatings, likeGame, unlikeGame, rateGame, forkGame } =
    useCommunityStore();
  const router = useRouter();

  useEffect(() => {
    const fetchGame = async () => {
      try {
        const res = await fetch(`/api/community/games/${gameId}`);
        if (!res.ok) throw new Error('Failed to fetch game');
        const data = await res.json();
        setGame(data.game);
      } catch (err) {
        console.error('Failed to fetch game:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGame();
  }, [gameId]);

  const handleLike = () => {
    if (likedGameIds.has(gameId)) {
      unlikeGame(gameId);
      if (game) setGame({ ...game, likeCount: game.likeCount - 1 });
    } else {
      likeGame(gameId);
      if (game) setGame({ ...game, likeCount: game.likeCount + 1 });
    }
  };

  const handleRate = (rating: number) => {
    rateGame(gameId, rating);
  };

  const handleFork = async () => {
    try {
      const projectId = await forkGame(gameId);
      router.push(`/editor?project=${projectId}`);
      onClose();
    } catch (err) {
      console.error('Failed to fork game:', err);
    }
  };

  const handleAddComment = async (content: string, parentId?: string) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parentId }),
      });
      if (!res.ok) throw new Error('Failed to post comment');

      const data = await res.json();
      if (game) {
        setGame({
          ...game,
          comments: [...game.comments, data.comment],
        });
      }
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  if (!game) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex justify-between items-start z-10">
          <div>
            <h2 className="text-2xl font-bold text-zinc-100">{game.title}</h2>
            <p className="text-sm text-zinc-400">by {game.authorName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Game preview */}
          <div className="aspect-video bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 rounded flex items-center justify-center">
            {game.cdnUrl ? (
              <a
                href={game.cdnUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <Play className="w-5 h-5" />
                Play Game
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <div className="text-zinc-500">Preview not available</div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleLike}
              className={`flex items-center gap-2 px-4 py-2 rounded transition-colors ${
                likedGameIds.has(gameId)
                  ? 'bg-red-500 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Heart
                className={`w-5 h-5 ${likedGameIds.has(gameId) ? 'fill-current' : ''}`}
              />
              {game.likeCount}
            </button>
            <button
              onClick={handleFork}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700"
            >
              <GitFork className="w-5 h-5" />
              Fork
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-zinc-400">Your rating:</span>
              <StarRating
                value={userRatings[gameId] || 0}
                interactive
                onChange={handleRate}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">Rating</div>
              <div className="flex items-center gap-2">
                <StarRating value={game.avgRating} size="sm" />
                <span className="text-sm text-zinc-300">
                  ({game.ratingCount})
                </span>
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">Plays</div>
              <div className="text-lg font-semibold text-zinc-100">
                {game.playCount}
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">Likes</div>
              <div className="text-lg font-semibold text-zinc-100">
                {game.likeCount}
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-500">Comments</div>
              <div className="text-lg font-semibold text-zinc-100">
                {game.comments.length}
              </div>
            </div>
          </div>

          {/* Description */}
          {game.description && (
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">
                Description
              </h3>
              <p className="text-zinc-300">{game.description}</p>
            </div>
          )}

          {/* Tags */}
          {game.tags.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-zinc-100 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {game.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-3 py-1 bg-zinc-800 text-zinc-300 rounded text-sm"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <CommentSection
            comments={game.comments}
            onAddComment={handleAddComment}
          />
        </div>
      </div>
    </div>
  );
}
