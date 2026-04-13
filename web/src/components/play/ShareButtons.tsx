'use client';

import { useState, useCallback } from 'react';
import { Share2, X as XIcon } from 'lucide-react';

interface ShareButtonsProps {
  gameTitle: string;
  gameUrl: string;
}

function addUtm(url: string, source: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', 'game_share');
  return u.toString();
}

export function ShareButtons({ gameTitle, gameUrl }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `Check out "${gameTitle}" on SpawnForge!`
  )}&url=${encodeURIComponent(addUtm(gameUrl, 'twitter'))}`;

  const redditUrl = `https://reddit.com/submit?title=${encodeURIComponent(
    `${gameTitle} — Made with SpawnForge`
  )}&url=${encodeURIComponent(addUtm(gameUrl, 'reddit'))}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(addUtm(gameUrl, 'copy_link'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [gameUrl]);

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: gameTitle,
        text: `Check out "${gameTitle}" on SpawnForge!`,
        url: addUtm(gameUrl, 'native_share'),
      });
    } catch {
      // User cancelled or API not available
    }
  }, [gameTitle, gameUrl]);

  const hasNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  const btnClass =
    'rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300';

  return (
    <div className="flex items-center gap-1">
      {hasNativeShare && (
        <button
          onClick={handleNativeShare}
          className={btnClass}
          title="Share"
        >
          <Share2 size={16} />
        </button>
      )}

      <a
        href={twitterUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={btnClass}
        title="Share on X"
      >
        <XIcon size={16} />
      </a>

      <a
        href={redditUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={btnClass}
        title="Share on Reddit"
      >
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
        </svg>
      </a>

      <button
        onClick={handleCopy}
        className={btnClass}
        title="Copy link"
      >
        {copied ? (
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x={9} y={9} width={13} height={13} rx={2} ry={2} />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}
