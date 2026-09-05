'use client';

interface GenerationUnavailableNoticeProps {
  /**
   * DOM id so the dialog container and its submit button can point at this
   * text with `aria-describedby`. A pre-filled live region is not reliably
   * announced on mount, so the description link is what tells a screen-reader
   * user WHY Generate is disabled.
   */
  id: string;
  /** The server's reason (from /api/capabilities `hint`), shown verbatim. */
  reason: string | undefined;
}

/**
 * Explicit "this cannot run" state for a generation dialog (#9117). Rendered
 * when `useGenerationGate` reports the capability unprovisionable, so nobody
 * composes a prompt for a request the server will refuse.
 *
 * Icon-free because the dialog tests stub `lucide-react` to the icons each
 * dialog imports. The inline amber styling mirrors the editor's existing
 * warning boxes; extracting a shared `InlineAlert` primitive into
 * `packages/ui` is tracked in #9726.
 */
export function GenerationUnavailableNotice({ id, reason }: GenerationUnavailableNoticeProps) {
  return (
    <div
      id={id}
      role="status"
      className="rounded border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
    >
      <span className="font-semibold">Unavailable. </span>
      <span>{reason ?? 'This generation feature is not available yet.'}</span>
    </div>
  );
}
