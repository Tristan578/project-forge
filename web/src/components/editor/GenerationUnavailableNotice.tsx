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
  /**
   * True when NO key can enable this capability (`UNAVAILABLE_CAPABILITIES`).
   * When false, the reason is actionable — the user can add their own key —
   * so the notice also links to Settings. Sending them there for something
   * Settings cannot fix would be a dead end of its own (#9725 p7).
   */
  unprovisionable?: boolean;
}

/**
 * Explicit "this cannot run" state for a generation dialog (#9117). Rendered
 * when `useGenerationGate` reports the capability unavailable for the current
 * user — either declared unprovisionable in code, or lacking both a platform
 * key and the caller's own BYOK key — so nobody composes a prompt for a
 * request the server will refuse.
 *
 * For the provisionable case this notice is the whole point of leaving the
 * entry point clickable: it is where the provider is named and where the link
 * to Settings lives.
 *
 * Icon-free because the dialog tests stub `lucide-react` to the icons each
 * dialog imports. The inline amber styling mirrors the editor's existing
 * warning boxes; extracting a shared `InlineAlert` primitive into
 * `packages/ui` is tracked in #9726.
 */
export function GenerationUnavailableNotice({
  id,
  reason,
  unprovisionable,
}: GenerationUnavailableNoticeProps) {
  return (
    <div
      id={id}
      role="status"
      className="rounded border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
    >
      <span className="font-semibold">Unavailable. </span>
      <span>{reason ?? 'This generation feature is not available yet.'}</span>
      {unprovisionable === false && (
        <>
          {' '}
          <a
            href="/settings"
            className="font-semibold underline underline-offset-2 hover:text-amber-200"
          >
            Open Settings
          </a>
        </>
      )}
    </div>
  );
}
