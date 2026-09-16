/** React not-found fallback for a play render whose published metadata disappears. */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { GAME_NOT_FOUND_HEADING, GAME_NOT_FOUND_DESCRIPTION } from '@/lib/play/notFoundDocument';

/**
 * Render the unavailable-game presentation inside Next.js notFound handling.
 * The proxy returns the same text as a direct HTTP404 document before streaming;
 * this fallback catches removals after preflight, when status may already be sent.
 * @returns An announced missing-game message and native home link.
 */
export default function GameNotFound() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4"
    >
      <div className="max-w-md text-center">
        <div aria-hidden="true" className="mb-4 text-6xl">
          :(
        </div>
        <h1 className="mb-2 text-xl font-semibold text-zinc-200">{GAME_NOT_FOUND_HEADING}</h1>
        <p className="mb-6 text-sm text-zinc-400">
          {GAME_NOT_FOUND_DESCRIPTION}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to SpawnForge
          </Link>
        </div>
      </div>
    </div>
  );
}
