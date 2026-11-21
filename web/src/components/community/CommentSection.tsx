'use client';

import { useState } from 'react';
import { MessageCircle, Flag } from 'lucide-react';

interface Comment {
  id: string;
  content: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  createdAt: string;
}

interface CommentSectionProps {
  comments: Comment[];
  gameId: string;
  onAddComment: (content: string, parentId?: string) => void;
}

export function CommentSection({ comments, gameId, onAddComment }: CommentSectionProps) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const handleFlag = async (commentId: string) => {
    try {
      const res = await fetch(`/api/community/games/${gameId}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      });
      if (res.ok) {
        setFlaggedIds((prev) => new Set(prev).add(commentId));
      }
    } catch {
      // silently fail
    }
  };

  const topLevelComments = comments.filter((c) => !c.parentId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    onAddComment(content, replyTo || undefined);
    setContent('');
    setReplyTo(null);
  };

  const formatDate = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
        <MessageCircle className="w-5 h-5" />
        Comments ({comments.length})
      </h3>

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        {replyTo && (
          <div className="text-sm text-zinc-400">
            Replying to comment...
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="ml-2 text-indigo-400 hover:text-indigo-300"
            >
              Cancel
            </button>
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a comment..."
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
          rows={3}
          maxLength={1000}
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-zinc-400">{content.length}/1000</span>
          <button
            type="submit"
            disabled={!content.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            Post
          </button>
        </div>
      </form>

      {/* Comments list */}
      <div className="space-y-4">
        {topLevelComments.map((comment) => {
          const replies = comments.filter((c) => c.parentId === comment.id);

          return (
            <div key={comment.id} className="space-y-2">
              {/* Main comment */}
              <div className="bg-zinc-800 rounded p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="text-sm font-semibold text-zinc-100">
                      {comment.authorName}
                    </span>
                    <span className="text-xs text-zinc-400 ml-2">
                      {formatDate(comment.createdAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleFlag(comment.id)}
                    disabled={flaggedIds.has(comment.id)}
                    className={`text-zinc-400 hover:text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed ${flaggedIds.has(comment.id) ? 'text-red-500' : ''}`}
                    title={flaggedIds.has(comment.id) ? 'Reported' : 'Report comment'}
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-zinc-300 mb-2">{comment.content}</p>
                <button
                  onClick={() => setReplyTo(comment.id)}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Reply
                </button>
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <div className="ml-8 space-y-2">
                  {replies.map((reply) => (
                    <div key={reply.id} className="bg-zinc-800 rounded p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-sm font-semibold text-zinc-100">
                            {reply.authorName}
                          </span>
                          <span className="text-xs text-zinc-400 ml-2">
                            {formatDate(reply.createdAt)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleFlag(reply.id)}
                          disabled={flaggedIds.has(reply.id)}
                          className={`text-zinc-400 hover:text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed ${flaggedIds.has(reply.id) ? 'text-red-500' : ''}`}
                          title={flaggedIds.has(reply.id) ? 'Reported' : 'Report comment'}
                        >
                          <Flag className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-sm text-zinc-300">{reply.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {comments.length === 0 && (
        <div className="text-center py-8 text-zinc-400">
          No comments yet. Be the first to comment!
        </div>
      )}
    </div>
  );
}
