'use client';

import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

export default function AdminError({
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
      route="admin"
      title="Admin Error"
      description="Something went wrong loading the admin console."
      primaryLabel="Retry"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Dashboard"
    />
  );
}
