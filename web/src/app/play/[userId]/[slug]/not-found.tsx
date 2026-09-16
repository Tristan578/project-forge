import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Not-found boundary for /play/[userId]/[slug].
 *
 * Rendered when page.tsx calls notFound() for a game that is missing,
 * unpublished, or unreachable. This makes the server response a true HTTP 404
 * (fixing the previous soft-404 that returned 200 and got indexed) while
 * preserving the "Game Not Found" presentation the GamePlayer client component
 * already shows for the same condition, so the visible UX does not regress.
 *
 * No metadata is exported here on purpose: the missing-game <title> is the
 * single responsibility of generateMetadata in page.tsx.
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
        <h1 className="mb-2 text-xl font-semibold text-zinc-200">Game Not Found</h1>
        <p className="mb-6 text-sm text-zinc-400">
          This game does not exist or is not currently published.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
          >
            <ArrowLeft size={14} />
            Back to SpawnForge
          </Link>
        </div>
      </div>
    </div>
  );
}
