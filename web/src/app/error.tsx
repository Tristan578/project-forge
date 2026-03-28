"use client";

import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  const displayMessage =
    process.env.NODE_ENV === 'development'
      ? error.message
      : 'An unexpected error occurred. Please try again.';
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center space-y-6 px-4">
        <div className="space-y-2">
          <p className="text-zinc-400 text-sm font-mono uppercase tracking-widest">
            500
          </p>
          <h1 className="text-3xl font-bold text-zinc-100">
            Something went wrong
          </h1>
          <p className="text-zinc-400 max-w-sm mx-auto">
            {displayMessage}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors text-sm font-medium"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-900 transition-colors text-sm font-medium"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
