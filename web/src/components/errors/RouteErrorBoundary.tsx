'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { captureException, setTag } from '@/lib/monitoring/sentry-client';

export interface RouteErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  route: string;
  title: string;
  description: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function RouteErrorBoundary({
  error,
  reset,
  route,
  title,
  description,
  primaryLabel = 'Try Again',
  secondaryHref,
  secondaryLabel,
}: RouteErrorBoundaryProps) {
  useEffect(() => {
    setTag('route', route);
    captureException(error, { digest: error.digest });
  }, [error, route]);

  const displayMessage =
    process.env.NODE_ENV === 'development'
      ? `${description} (${error.message})`
      : description;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-screen bg-zinc-950 flex items-center justify-center"
    >
      <div className="text-center space-y-6 px-4 max-w-md">
        <div className="space-y-2">
          <p className="text-zinc-400 text-sm font-mono uppercase tracking-widest">
            500
          </p>
          <h1 className="text-3xl font-bold text-zinc-100">{title}</h1>
          <p className="text-zinc-400">{displayMessage}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 transition-colors text-sm font-medium"
          >
            {primaryLabel}
          </button>
          {secondaryHref && secondaryLabel && (
            <Link
              href={secondaryHref}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-900 transition-colors text-sm font-medium"
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
