'use client';

import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorBoundary
      error={error}
      reset={reset}
      route="play"
      title="Play Error"
      description="Something went wrong loading this game."
      primaryLabel="Retry"
      secondaryHref="/community"
      secondaryLabel="Back to Community"
    />
  );
}
