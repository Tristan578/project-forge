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
      className="fixed left-1/2 top-3 z-[100] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-[var(--sf-radius-lg)] border border-[var(--sf-destructive)] bg-[var(--sf-bg-surface)] px-4 py-3 text-sm text-[var(--sf-text)] shadow-xl"
    >
      <AlertTriangle
        className="mt-0.5 shrink-0 text-[var(--sf-destructive)]"
        size={18}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-2">
        <p>{sceneLoadError.reason}</p>
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
