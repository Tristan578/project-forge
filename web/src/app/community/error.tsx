'use client';

import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

export default function CommunityError({
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
      route="community"
      title="Community Error"
      description="Something went wrong loading the community feed."
      primaryLabel="Retry"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Dashboard"
    />
  );
}
