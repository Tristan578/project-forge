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
      className="fixed left-1/2 top-3 z-[100] flex max-w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 items-start gap-3 rounded-[var(--sf-radius-lg)] border border-[var(--sf-destructive)] bg-[var(--sf-bg-surface)] px-4 py-3 text-sm text-[var(--sf-text)] shadow-xl"
    >
      <AlertTriangle
        className="mt-0.5 shrink-0 text-[var(--sf-destructive)]"
        size={18}
        aria-hidden="true"
      />
      {/* An engine refusal can quote a long scene value, so the reason may
          hold an unbroken token. `wrap-anywhere` (overflow-wrap: anywhere)
          lets that token count as breakable when the browser sizes this
          shrink-to-fit fixed notice; `break-words` (overflow-wrap:
          break-word) only wraps AFTER sizing, so the notice still grew to
          its cap and ran off a phone-width screen. `min-w-0` lets this
          column shrink inside the flex row, and the notice's max width is
          capped at the viewport so it never runs past either edge. */}
      <div className="flex min-w-0 flex-col gap-2">
        <p className="min-w-0 wrap-anywhere" data-testid="scene-load-error-reason">{sceneLoadError.reason}</p>
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
