'use client';

import { useWorkspaceStore } from '@/stores/workspaceStore';

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
   * Sending the user to Settings for something Settings cannot fix would be a
   * dead end of its own (#9725 p7).
   */
  unprovisionable?: boolean;
  /**
   * True when the key this capability is missing is one Settings can actually
   * store — a `BYOK_PROVIDERS` member, which is what `/api/keys/[provider]`
   * accepts and ApiKeyManager renders a field for. Only then does the Settings
   * affordance appear. `sprite` (Replicate + OpenAI), `image` and
   * `bg_removal` (OpenAI, remove.bg) name providers Settings has no field for,
   * so offering it there was the same dead end in a different disguise
   * (#9725 p8). Absent is treated as false: a missing click beats a wrong one.
   */
  byokConfigurable?: boolean;
}

/**
 * Explicit "this cannot run" state for a generation dialog (#9117). Rendered
 * when `useGenerationGate` reports the capability unavailable for the current
 * user — either declared unprovisionable in code, or lacking both a platform
 * key and the caller's own BYOK key — so nobody composes a prompt for a
 * request the server will refuse.
 *
 * For the provisionable case this notice is the whole point of leaving the
 * entry point clickable: it is where the provider is named and where the route
 * to Settings lives. That route opens the editor's own Settings modal on the
 * keys tab; it must never be an `<a href>`, which would unload the WASM
 * session and the scene along with it (#9725 p8).
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
  byokConfigurable,
}: GenerationUnavailableNoticeProps) {
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const canFixInSettings = unprovisionable === false && byokConfigurable === true;
  return (
    <div
      id={id}
      role="status"
      className="rounded border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
    >
      <span className="font-semibold">Unavailable. </span>
      <span>{reason ?? 'This generation feature is not available yet.'}</span>
      {canFixInSettings && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => openSettings('keys')}
            className="font-semibold underline underline-offset-2 hover:text-amber-200"
          >
            Open Settings
          </button>
        </>
      )}
    </div>
  );
}
