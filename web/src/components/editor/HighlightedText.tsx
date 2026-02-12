/**
 * Text component with substring highlighting.
 *
 * Wraps matching substrings in a highlighted span for visual emphasis.
 * Used in the Scene Hierarchy panel to show filter matches.
 */

'use client';

import { useMemo } from 'react';
import { escapeRegExp } from '@/lib/hierarchyFilter';

interface HighlightedTextProps {
  /** The full text to display */
  text: string;
  /** The substring to highlight (case-insensitive) */
  highlight?: string;
  /** Additional CSS classes for the container span */
  className?: string;
}

export function HighlightedText({
  text,
  highlight,
  className = '',
}: HighlightedTextProps) {
  const parts = useMemo(() => {
    if (!highlight?.trim()) {
      return [{ text, isMatch: false }];
    }

    const escapedHighlight = escapeRegExp(highlight.trim());
    const regex = new RegExp(`(${escapedHighlight})`, 'gi');
    const splitParts = text.split(regex);

    return splitParts
      .filter((part) => part.length > 0)
      .map((part) => ({
        text: part,
        isMatch: regex.test(part),
      }));
  }, [text, highlight]);

  // If no highlighting needed, return plain text
  if (parts.length === 1 && !parts[0].isMatch) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.isMatch ? (
          <span
            key={index}
            className="bg-yellow-500/30 rounded-sm px-0.5"
          >
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  );
}
