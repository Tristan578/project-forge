'use client';

import { useState, useCallback } from 'react';
import { Star, Copy, Loader2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import {
  buildReviewContext,
  generateReview,
  getRatingDescriptor,
  type GameReview,
} from '@/lib/ai/gameReviewer';

// ---- Score Bar ----

function getScoreColor(score: number): string {
  if (score >= 8) return 'bg-green-500';
  if (score >= 5) return 'bg-yellow-500';
  return 'bg-red-500';
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const widthPercent = (score / 10) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-zinc-400">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getScoreColor(score)}`}
          style={{ width: `${widthPercent}%` }}
        />
      </div>
      <span className="w-6 text-right text-xs font-mono text-zinc-300">{score}</span>
    </div>
  );
}

// ---- Rating Badge ----

function RatingBadge({ rating }: { rating: number }) {
  const descriptor = getRatingDescriptor(rating);
  const colorClass = rating >= 9
    ? 'text-green-400 border-green-500/30'
    : rating >= 7
      ? 'text-blue-400 border-blue-500/30'
      : rating >= 4
        ? 'text-yellow-400 border-yellow-500/30'
        : 'text-red-400 border-red-500/30';

  return (
    <div className={`flex flex-col items-center gap-1 rounded-lg border p-3 ${colorClass}`}>
      <span className="text-3xl font-bold">{rating}</span>
      <span className="text-[10px] font-medium uppercase tracking-wider">{descriptor}</span>
    </div>
  );
}

// ---- Bullet List ----

function BulletList({ items, color }: { items: string[]; color: 'green' | 'red' | 'blue' }) {
  if (items.length === 0) return null;

  const dotColor = color === 'green' ? 'bg-green-400' : color === 'red' ? 'bg-red-400' : 'bg-blue-400';

  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- Copy to Markdown ----

function reviewToMarkdown(review: GameReview): string {
  const lines: string[] = [];
  lines.push(`# ${review.title}`);
  lines.push('');
  lines.push(`**Overall Rating: ${review.overallRating}/10 - ${getRatingDescriptor(review.overallRating)}**`);
  lines.push('');
  lines.push(`> ${review.summary}`);
  lines.push('');
  lines.push('## Scores');
  lines.push('');
  lines.push(`| Category | Score |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Fun Factor | ${review.scores.funFactor}/10 |`);
  lines.push(`| Polish | ${review.scores.polish}/10 |`);
  lines.push(`| Difficulty | ${review.scores.difficulty}/10 |`);
  lines.push(`| Originality | ${review.scores.originality}/10 |`);
  lines.push(`| Accessibility | ${review.scores.accessibility}/10 |`);
  lines.push(`| Replayability | ${review.scores.replayability}/10 |`);
  lines.push('');

  if (review.pros.length > 0) {
    lines.push('## Strengths');
    lines.push('');
    for (const pro of review.pros) lines.push(`- ${pro}`);
    lines.push('');
  }

  if (review.cons.length > 0) {
    lines.push('## Areas for Improvement');
    lines.push('');
    for (const con of review.cons) lines.push(`- ${con}`);
    lines.push('');
  }

  if (review.suggestions.length > 0) {
    lines.push('## Suggestions');
    lines.push('');
    for (const sug of review.suggestions) lines.push(`- ${sug}`);
    lines.push('');
  }

  if (review.reviewText) {
    lines.push('## Full Review');
    lines.push('');
    lines.push(review.reviewText);
  }

  return lines.join('\n');
}

// ---- Main Panel ----

export function ReviewPanel() {
  const [review, setReview] = useState<GameReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reviewExpanded, setReviewExpanded] = useState(false);

  const getState = useEditorStore;

  const handleGenerateReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReview(null);
    setReviewExpanded(false);
    setCopied(false);

    try {
      const context = buildReviewContext(() => getState.getState());
      const result = await generateReview(context);
      setReview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate review');
    } finally {
      setLoading(false);
    }
  }, [getState]);

  const handleCopy = useCallback(async () => {
    if (!review) return;
    try {
      await navigator.clipboard.writeText(reviewToMarkdown(review));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [review]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <Star size={14} className="text-yellow-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            AI Game Review
          </h2>
        </div>
        {review && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Copy review as markdown"
              aria-label="Copy review as markdown"
            >
              <Copy size={11} />
              <span>{copied ? 'Copied' : 'Share'}</span>
            </button>
            <button
              onClick={handleGenerateReview}
              disabled={loading}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              title="Re-generate review"
              aria-label="Re-generate review"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Empty state / generate button */}
        {!review && !loading && !error && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <Star size={32} className="text-zinc-600" />
            <p className="text-xs text-zinc-500 max-w-[200px]">
              Get an AI-powered professional review of your game with scores and improvement suggestions.
            </p>
            <button
              onClick={handleGenerateReview}
              className="rounded-md bg-yellow-600 px-4 py-2 text-xs font-medium text-white hover:bg-yellow-500 transition-colors focus:ring-2 focus:ring-yellow-500 focus:outline-none"
            >
              Get AI Review
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 size={24} className="text-yellow-400 animate-spin" />
            <p className="text-xs text-zinc-500">Analyzing your game...</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded border border-red-500/30 bg-red-900/20 p-3 text-xs text-red-400">
            <p className="font-medium">Review failed</p>
            <p className="mt-1 text-red-500">{error}</p>
            <button
              onClick={handleGenerateReview}
              className="mt-2 rounded bg-red-600/30 px-3 py-1 text-xs text-red-300 hover:bg-red-600/50 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Review results */}
        {review && (
          <>
            {/* Title + Overall Rating */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-zinc-200">{review.title}</h3>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{review.summary}</p>
              </div>
              <RatingBadge rating={review.overallRating} />
            </div>

            {/* Score bars */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Scores
              </h4>
              <ScoreBar label="Fun Factor" score={review.scores.funFactor} />
              <ScoreBar label="Polish" score={review.scores.polish} />
              <ScoreBar label="Difficulty" score={review.scores.difficulty} />
              <ScoreBar label="Originality" score={review.scores.originality} />
              <ScoreBar label="Accessibility" score={review.scores.accessibility} />
              <ScoreBar label="Replayability" score={review.scores.replayability} />
            </div>

            {/* Pros */}
            {review.pros.length > 0 && (
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-green-400">
                  Strengths
                </h4>
                <BulletList items={review.pros} color="green" />
              </div>
            )}

            {/* Cons */}
            {review.cons.length > 0 && (
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-400">
                  Areas for Improvement
                </h4>
                <BulletList items={review.cons} color="red" />
              </div>
            )}

            {/* Suggestions */}
            {review.suggestions.length > 0 && (
              <div>
                <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  Suggestions
                </h4>
                <BulletList items={review.suggestions} color="blue" />
              </div>
            )}

            {/* Full review text (expandable) */}
            {review.reviewText && (
              <div>
                <button
                  onClick={() => setReviewExpanded((prev) => !prev)}
                  className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <span>Full Review</span>
                  {reviewExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {reviewExpanded && (
                  <p className="mt-2 text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                    {review.reviewText}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
