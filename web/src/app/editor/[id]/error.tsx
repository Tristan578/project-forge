'use client';

import { RouteErrorBoundary } from '@/components/errors/RouteErrorBoundary';

export default function EditorError({
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
      route="editor"
      title="Editor Error"
      description="Something went wrong in the editor. Your scene was auto-saved."
      primaryLabel="Reload Editor"
      secondaryHref="/dashboard"
      secondaryLabel="Back to Dashboard"
    />
  );
}
