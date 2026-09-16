'use client';

import { Star } from 'lucide-react';
import { useState } from 'react';

interface StarRatingProps {
  value: number;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export function StarRating({
  value,
  count,
  size = 'md',
  interactive = false,
  onChange,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = useState(0);

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const starSize = sizeClasses[size];
  const displayRating = interactive && hoverRating > 0 ? hoverRating : value;

  const roundedValue = Math.round(value * 10) / 10;
  // Non-interactive stars are a display of an average, not five separate
  // controls: expose them to assistive tech as one labelled image so a screen
  // reader announces the value once instead of "button, button, ...".
  const displayLabel = `Average rating: ${roundedValue} out of 5 stars${
    count !== undefined ? `, ${count} rating${count === 1 ? '' : 's'}` : ''
  }`;

  return (
    <div className="flex items-center gap-1">
      <div
        className="flex gap-0.5"
        {...(interactive
          ? { role: 'radiogroup', 'aria-label': 'Rate this game' }
          : { role: 'img', 'aria-label': displayLabel })}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            aria-label={interactive ? `Rate ${star} star${star === 1 ? '' : 's'}` : undefined}
            aria-pressed={interactive ? star <= value : undefined}
            className={`${interactive ? 'cursor-pointer hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded' : 'cursor-default'}`}
            onMouseEnter={() => interactive && setHoverRating(star)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            onClick={() => interactive && onChange?.(star)}
          >
            <Star
              className={`${starSize} ${
                star <= displayRating
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'fill-none text-zinc-400'
              }`}
            />
          </button>
        ))}
      </div>
      {count !== undefined && (
        <span className="text-xs text-zinc-400 ml-1">({count})</span>
      )}
    </div>
  );
}
