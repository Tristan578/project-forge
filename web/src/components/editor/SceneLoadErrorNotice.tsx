'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@spawnforge/ui';
import { useEditorStore } from '@/stores/editorStore';

/**
 * Explains a REJECTED scene load instead of leaving an empty viewport with no
 * account of itself (#10056).
 *
 * Before this, `loadScene` gained rejection paths that return without
 * dispatching, and the editor page discarded the boolean: the editor rendered
 * with an empty viewport, the project's name already in the title bar, and no
 * indication anything had gone wrong — so the next save wrote that empty scene
 * over the project. The banner is the visible half of the fix; the refusal in
 * every save path is the half that protects the data, and this text is what
 * tells the user why nothing is saving.
 *
 * Reads `sceneLoadError`, NOT `loadScene`'s boolean: that boolean is also false
 * on a healthy cold open (the engine dispatcher mounts after this page), so
 * gating on it would show this alert every time.
 *
 * `role="alert"` rather than the `role="status"` its sibling
 * `RemixQuarantineNotice` uses: a quarantine notice is informational, whereas
 * this one says the work in front of the user is not their project and cannot
 * be saved — assertive announcement is the correct urgency. For the same
 * reason it is NOT dismissible: dismissing would hide a condition that is still
 * true and still blocking every save.
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
          Saving is turned off so this empty editor cannot overwrite your saved project.
          Reload to try again, or start a new scene to re-enable saving.
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
