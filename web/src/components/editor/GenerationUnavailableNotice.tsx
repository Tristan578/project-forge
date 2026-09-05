'use client';

interface GenerationUnavailableNoticeProps {
  /** The server's reason (from /api/capabilities `hint`), shown verbatim. */
  reason: string | undefined;
}

/**
 * Explicit "this cannot run" state for a generation dialog (#9117). Rendered
 * when `useGenerationGate` reports the capability unavailable, so nobody
 * composes a prompt for a request the server will refuse. `role="status"` so
 * screen readers announce it on open. Deliberately icon-free: the dialog
 * tests stub `lucide-react` to the handful of icons each dialog imports.
 */
export function GenerationUnavailableNotice({ reason }: GenerationUnavailableNoticeProps) {
  return (
    <div
      role="status"
      className="rounded border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
    >
      <span className="font-semibold">Unavailable. </span>
      <span>{reason ?? 'This generation feature is currently unavailable.'}</span>
    </div>
  );
}
