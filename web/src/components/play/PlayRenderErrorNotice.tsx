'use client';

/**
 * Render-error notice for the published-game player (#8887).
 *
 * The editor's counterpart is `components/editor/RenderErrorNotice.tsx`; both
 * read the same `RENDER_ERROR` wire and take their words from
 * `lib/engine/renderErrorWire.ts` (`playerRenderErrorCopy` here). This one is
 * separate because `/play` is the public bundle and must not pull in the
 * editor's engine graph (`useEngine`, the editor stores), and because a player
 * has different actions: there is no Save and no backend preference on `/play`.
 *
 * Behaviour by outcome:
 *
 * - `stopped` (a repeated error, out of memory, or a lost device): the game can
 *   no longer draw and cannot resume, so an assertive alert covers the frozen
 *   canvas and stays until the player acts. The only actions are the real ones:
 *   Reload game (restarts it) and Back to SpawnForge. Focus moves to Reload so a
 *   keyboard player, whose focus was on the canvas, lands on the way out.
 * - `continued` (one skipped frame): a small polite note at the bottom of the
 *   game, dismissible, that does NOT take focus. A skip is usually invisible,
 *   but it can leave a visibly wrong frame, and the owner's rule is that an
 *   error is never silent. It is kept small and out of the way because the game
 *   is still playable, and it counts repeats in one note rather than stacking.
 *
 * The raw wgpu text is never primary text: it sits in a collapsed "Technical
 * details" disclosure (useful when reporting the game) and goes to Sentry.
 *
 * The notice renders inside the canvas area, which is inside the element
 * `GamePlayer` sends fullscreen, so it shows in fullscreen too.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button, InlineAlert } from '@spawnforge/ui';
import {
  RENDER_ERROR_CLASS_LABEL,
  playerRenderErrorCopy,
  type RenderErrorReport,
} from '@/lib/engine/renderErrorWire';

/** WCAG 2.5.5 target size, applied to every action (the library `md` size is 36px). */
const TARGET = 'min-h-[44px]';

/** Indirection so tests can observe a reload without navigating jsdom. */
export const playRenderErrorActions = {
  reload: () => window.location.reload(),
};

export interface PlayRenderErrorNoticeProps {
  notice: RenderErrorReport;
  /** How many skipped (`continued`) errors this session. */
  skippedCount: number;
  onDismiss: () => void;
}

export function PlayRenderErrorNotice({ notice, skippedCount, onDismiss }: PlayRenderErrorNoticeProps) {
  const stopped = notice.outcome === 'stopped';
  const copy = playerRenderErrorCopy(notice.errorClass, notice.outcome);
  const reloadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (stopped) reloadRef.current?.focus();
  }, [stopped]);

  const alert = (
    <InlineAlert
      variant={stopped ? 'error' : 'warning'}
      aria-labelledby="play-render-error-title"
      aria-describedby="play-render-error-body"
      data-testid="play-render-error"
      data-error-class={notice.errorClass}
      data-outcome={notice.outcome}
      className="pointer-events-auto w-full max-w-md px-4 py-3 text-sm shadow-lg"
    >
      <h2 id="play-render-error-title" className="font-semibold">
        {copy.title}
      </h2>
      <p id="play-render-error-body" className="mt-1">
        {copy.body}
      </p>
      {!stopped && skippedCount > 1 && <p className="mt-1">This has happened {skippedCount} times.</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={reloadRef}
          variant={stopped ? 'default' : 'outline'}
          onClick={() => playRenderErrorActions.reload()}
          className={TARGET}
        >
          Reload game
        </Button>
        {stopped ? (
          <Link
            href="/"
            className={`${TARGET} inline-flex items-center rounded-[var(--sf-radius-md)] px-4 text-sm underline-offset-2 hover:underline focus-visible:outline-2`}
          >
            Back to SpawnForge
          </Link>
        ) : (
          <Button variant="ghost" onClick={onDismiss} className={TARGET}>
            Dismiss
          </Button>
        )}
      </div>

      <details className="mt-2">
        <summary className={`${TARGET} flex cursor-pointer items-center text-xs text-[var(--sf-text-secondary)]`}>
          Technical details
        </summary>
        <p className="text-xs">{RENDER_ERROR_CLASS_LABEL[notice.errorClass]}</p>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs">
          {notice.detail || '(no message from the graphics driver)'}
        </pre>
      </details>
    </InlineAlert>
  );

  if (stopped) {
    // Covers the frozen canvas; scrollable so the whole notice is reachable on
    // a short phone viewport.
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center overflow-auto bg-zinc-950/85 p-4">
        {alert}
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">{alert}</div>
  );
}
