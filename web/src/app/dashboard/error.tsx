'use client';

import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

export default function DashboardError({
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
      route="dashboard"
      title="Dashboard Error"
      description="Something went wrong loading your dashboard."
      primaryLabel="Retry"
    />
  );
}
