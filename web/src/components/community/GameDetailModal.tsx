/** Async community game details in a persistent keyboard-accessible modal. */
'use client';

import { useEffect, useState } from 'react';
import { X, Play, Heart, GitFork, ExternalLink, Share2, Check } from 'lucide-react';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { StarRating } from './StarRating';
import { CommentSection } from './CommentSection';
import { useCommunityStore } from '@/stores/communityStore';
import { useRouter } from 'next/navigation';

/** Public game details returned by the community endpoint. */
interface GameDetail {
  /** Game identifier. */
  id: string;
  /** Display title. */
  title: string;
  /** Optional game description. */
  description: string | null;
  /** Public author display name. */
  authorName: string;
  /** Public author identifier. */
  authorId: string;
  /** Recorded play count. */
  playCount: number;
  /** Recorded like count. */
  likeCount: number;
  /** Average rating from zero to five. */
  avgRating: number;
  /** Number of submitted ratings. */
  ratingCount: number;
  /** Counts grouped by integer star rating. */
  ratingBreakdown: { rating: number; count: number }[];
  /** Public gallery tags. */
  tags: string[];
  /** Optional playable public page URL. */
  cdnUrl: string | null;
  /** Creation timestamp. */
  createdAt: string;
  /** Public threaded comments. */
  comments: Array<{
    /** Comment identifier. */
    id: string;
    /** Comment text. */
    content: string;
    /** Parent comment ID or null for a root comment. */
    parentId: string | null;
    /** Comment author identifier. */
    authorId: string;
    /** Comment author display name. */
    authorName: string;
    /** Comment creation timestamp. */
    createdAt: string;
  }>;
}

/** Requested game and caller-owned modal dismissal. */
interface GameDetailModalProps {
  /** Community game to fetch and display. */
  gameId: string;
  /** Dismiss the modal when Close or Escape is activated. */
  onClose: () => void;
}

/**
 * Fetch public details while keeping the dialog and its Close control mounted.
 * Loading and failure remain named, dismissible dialogs; the stable root lets
 * useDialogA11y install autofocus, Escape handling, and Tab trapping on mount.
 * @param props Community game identifier and dismissal callback.
 * @returns A persistent modal showing loading, unavailable, or fetched content.
 */
export function GameDetailModal({ gameId, onClose }: GameDetailModalProps) {
  const dialogRef = useDialogA11y(onClose);
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
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

    void fetchGame();
  }, [gameId]);

  const handleLike = () => {
    if (likedGameIds.has(gameId)) {
      void unlikeGame(gameId);
      if (game) setGame({ ...game, likeCount: game.likeCount - 1 });
    } else {
      void likeGame(gameId);
      if (game) setGame({ ...game, likeCount: game.likeCount + 1 });
    }
  };

  const handleRate = (rating: number) => {
    void rateGame(gameId, rating);
  };

  const handleFork = async () => {
    try {
      const { projectId, quarantinedScripts } = await forkGame(gameId);
      // `/editor/<id>`, not `/editor?project=<id>`: the editor route is
      // `app/editor/[id]` and reads the id from useParams(), and there is no
      // `/editor` route for the query-string form to land on — so forking from
      // the community gallery 404'd (#9046). This matches RemixButton, which is
      // the same "server made you a project, now open it" flow.
      const quarantineQuery = quarantinedScripts > 0
        ? `?quarantinedScripts=${quarantinedScripts}`
        : '';
      router.push(`/editor/${encodeURIComponent(projectId)}${quarantineQuery}`);
      onClose();
    } catch (err) {
      console.error('Failed to fork game:', err);
    }
  };

  const handleShare = async () => {
    const url = game?.cdnUrl ? `${window.location.origin}${game.cdnUrl}` : window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
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

  return (
    <div ref={dialogRef} className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="game-detail-title" tabIndex={-1}>
      <div className="bg-zinc-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4 flex justify-between items-start z-10">
          <div>
            <h2 id="game-detail-title" className="text-2xl font-bold text-zinc-100">{game?.title ?? (loading ? 'Loading game' : 'Game unavailable')}</h2>
            {game && <p className="text-sm text-zinc-400">by {game.authorName}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
          >
            <X aria-hidden="true" className="w-6 h-6" />
          </button>
        </div>

        {loading ? (
          <p role="status" className="p-6 text-zinc-400">Loading...</p>
        ) : !game ? (
          <p role="alert" className="p-6 text-zinc-300">This game could not be loaded. Close this dialog and try again.</p>
        ) : (
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
              <div className="text-zinc-400">Preview not available</div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-4">
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
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700"
            >
              {copied ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5" />}
              {copied ? 'Copied!' : 'Share'}
            </button>
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
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
              <div className="text-xs text-zinc-400">Rating</div>
              <div className="flex items-center gap-2">
                <StarRating value={game.avgRating} size="sm" />
                <span className="text-sm text-zinc-300">
                  ({game.ratingCount})
                </span>
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-400">Plays</div>
              <div className="text-lg font-semibold text-zinc-100">
                {game.playCount}
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-400">Likes</div>
              <div className="text-lg font-semibold text-zinc-100">
                {game.likeCount}
              </div>
            </div>
            <div className="bg-zinc-800 rounded p-3">
              <div className="text-xs text-zinc-400">Comments</div>
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
            gameId={gameId}
            onAddComment={handleAddComment}
          />
        </div>
        )}
      </div>
    </div>
  );
}
