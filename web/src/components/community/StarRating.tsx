/** Read-only average stars and a native single-choice interactive rating group. */
'use client';

import { Star } from 'lucide-react';
import { useId, useState } from 'react';

/** Rating display or caller-controlled integer selection. */
interface StarRatingProps {
  /** Value from zero to five; averages may be fractional, selections are integer. */
  value: number;
  /** Optional number of ratings, included in the read-only announcement. */
  count?: number;
  /** Star artwork size, default md; interactive targets remain 44px. */
  size?: 'sm' | 'md' | 'lg';
  /** Enable native rating radios; false displays one labelled image. */
  interactive?: boolean;
  /** Receive the selected integer rating; the caller updates value. */
  onChange?: (rating: number) => void;
}

/**
 * Show an average once to assistive technology or expose five named native radios.
 * Exactly one integer rating is checked; native arrow keys change the choice.
 * Pointer hover previews filled stars without changing the caller-owned value.
 * @param props Rating value, optional count/size, and selection callback.
 * @returns Stars with read-only or single-choice semantics.
 */
export function StarRating({ value, count, size = 'md', interactive = false, onChange }: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);
  const groupId = useId();
  const sizeClasses = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-5 h-5' };
  const boundedValue = Number.isFinite(value) ? Math.min(5, Math.max(0, value)) : 0;
  const displayRating = interactive && hoverRating > 0 ? hoverRating : boundedValue;
  const roundedValue = Math.round(boundedValue * 10) / 10;
  const displayLabel = `Average rating: ${roundedValue} out of 5 stars${count !== undefined ? `, ${count} rating${count === 1 ? '' : 's'}` : ''}`;
  const artwork = (star: number) => <Star aria-hidden="true" className={`${sizeClasses[size]} ${star <= displayRating ? 'fill-yellow-400 text-yellow-400' : 'fill-none text-zinc-400'}`} />;

  return (
    <div className="flex items-center gap-1">
      <div className={interactive ? 'flex' : 'flex gap-0.5'}
        role={interactive ? 'radiogroup' : 'img'}
        aria-label={interactive ? 'Rate this game' : displayLabel}>
        {[1, 2, 3, 4, 5].map(star => interactive ? (
          <label key={star} className="relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded"
            onMouseEnter={() => setHoverRating(star)} onMouseLeave={() => setHoverRating(0)}>
            <input className="peer sr-only" type="radio" name={groupId} value={star}
              aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
              checked={star === boundedValue} onChange={() => onChange?.(star)} />
            <span className="flex h-11 w-11 items-center justify-center rounded peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400">
              {artwork(star)}
            </span>
          </label>
        ) : <span key={star} aria-hidden="true">{artwork(star)}</span>)}
      </div>
      {count !== undefined && <span className="text-xs text-zinc-400 ml-1" aria-hidden={!interactive}>({count})</span>}
    </div>
  );
}
