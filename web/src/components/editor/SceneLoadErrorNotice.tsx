/** Persistent save-lockout notice and reload guidance for untrusted scene viewports. */
'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';

/**
 * Explain a save lockout after rejection or a thrown scene dispatch.
 * The viewport may be empty, incomplete, or corrupted. Save paths refuse to
 * overwrite stored scene data while this non-dismissible alert remains active.
 * Reads sceneLoadError rather than loadScene's boolean, so a healthy cold-open
 * deferral does not show a warning. A confirmed trustworthy recovery clears it.
 * @returns An assertive alert with reload guidance, or null without a lockout.
 */
export function SceneLoadErrorNotice() {
  const sceneLoadError = useEditorStore((s) => s.sceneLoadError);

  if (!sceneLoadError) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-h-[calc(100dvh-1.5rem)] w-fit max-w-xl items-start gap-3 overflow-y-auto rounded-[var(--sf-radius-lg)] border border-[var(--sf-destructive)] bg-[var(--sf-bg-surface)] px-4 py-3 text-sm text-[var(--sf-text)] shadow-xl"
    >
      <AlertTriangle
        className="mt-0.5 shrink-0 text-[var(--sf-destructive)]"
        size={18}
        aria-hidden="true"
      />
      {/* Phone layout (measured in Chromium; pinned by
          e2e/tests/scene-load-error-notice.spec.ts, since jsdom has no layout).
          WIDTH: `inset-x-3 mx-auto w-fit` centres the notice inside a box 12px
          in from each edge, so it can use the whole viewport minus 24px.
          Centring with `left-1/2 -translate-x-1/2` left it only the half of the
          screen to the right of `left`, so it was 188px wide at 375px and any
          max width on it never applied.
          HEIGHT: the reason can carry up to 512 characters of engine text, so
          it scrolls inside its own capped box and the explanation and the
          Reload button stay on screen. The notice is also capped at the
          viewport height and scrolls, so a very short screen can still reach
          the button. The reason box is focusable and named, so a keyboard
          user can scroll it.
          WRAPPING: an engine refusal can quote a long unbroken scene value.
          `wrap-anywhere` (overflow-wrap: anywhere) lets that token count as
          breakable when the browser sizes this fit-content notice;
          `break-words` only wraps after sizing, so the notice grew to its max
          width and ran off a phone screen. `min-w-0` lets the column shrink
          inside the flex row. */}
      <div className="flex min-w-0 flex-col gap-2">
        <div
          role="region"
          aria-label="Error details"
          tabIndex={0}
          className="max-h-[min(12rem,30dvh)] min-w-0 overflow-y-auto"
          data-testid="scene-load-error-reason-scroll"
        >
          <p className="min-w-0 wrap-anywhere" data-testid="scene-load-error-reason">{sceneLoadError.reason}</p>
        </div>
        <p className="text-[var(--sf-text-secondary)]">
          Saving is turned off because the viewport may be incomplete or corrupted.
          Your stored scene is protected. Reload to try again, or start a new scene to re-enable saving.
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Reload project
          </Button>
        </div>
      </div>
    </div>
  );
}
