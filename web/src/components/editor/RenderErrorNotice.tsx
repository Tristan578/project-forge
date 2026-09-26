'use client';

/**
 * Viewport notice for engine render errors (#8887).
 *
 * Replaces what Bevy 0.19 did by default, which was to quit the engine on any
 * GPU error and leave a frozen viewport with no explanation. The engine now
 * reports each error (`RENDER_ERROR`) and this shows it in plain language with
 * the actions that are real in this editor:
 *
 * - Reload editor, for every `stopped` outcome (the viewport cannot resume).
 * - Switch to WebGL2 and reload, only when the active backend is WebGPU. It
 *   uses the same `setPreferredBackend('webgl2')` preference `InitOverlay`'s
 *   "Try WebGL2 Mode" sets, which survives the reload.
 * - Dismiss, only for a `continued` outcome, where the viewport is still live.
 *
 * The wgpu text is secondary: it sits in a collapsed "Technical details"
 * disclosure, and the handler also sends it to Sentry.
 *
 * Non-modal on purpose: the toolbar's Save must stay reachable, because saving
 * still works after the viewport stops and is the first thing the copy asks for.
 */

import { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, InlineAlert } from '@spawnforge/ui';
import { getActiveEngineBackend, setPreferredBackend } from '@/hooks/useEngine';
import { RENDER_ERROR_CLASS_LABEL, renderErrorCopy } from '@/lib/engine/renderErrorWire';
import { useRenderErrorStore } from '@/stores/renderErrorStore';

/** WCAG 2.5.5 target size, applied to every action (the library `md` size is 36px). */
const TARGET = 'min-h-[44px]';

/** Indirection so tests can observe a reload without navigating jsdom. */
export const renderErrorNoticeActions = {
  reload: () => window.location.reload(),
};

export function RenderErrorNotice() {
  const notice = useRenderErrorStore((s) => s.notice);
  const skippedCount = useRenderErrorStore((s) => s.skippedCount);
  const dismiss = useRenderErrorStore((s) => s.dismiss);

  const handleReload = useCallback(() => {
    renderErrorNoticeActions.reload();
  }, []);

  const handleSwitchToWebGL2 = useCallback(() => {
    setPreferredBackend('webgl2');
    renderErrorNoticeActions.reload();
  }, []);

  if (!notice) return null;

  const stopped = notice.outcome === 'stopped';
  const copy = renderErrorCopy(notice.errorClass, notice.outcome);
  const offerWebGL2 = stopped && getActiveEngineBackend() === 'webgpu';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-40 flex justify-center px-4">
      <InlineAlert
        variant={stopped ? 'error' : 'warning'}
        aria-labelledby="render-error-title"
        aria-describedby="render-error-body"
        data-testid="render-error-notice"
        data-error-class={notice.errorClass}
        data-outcome={notice.outcome}
        className="pointer-events-auto w-full max-w-lg px-4 py-3 text-sm shadow-lg"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id="render-error-title" className="font-semibold">
              {copy.title}
            </h2>
            <p id="render-error-body" className="mt-1">
              {copy.body}
            </p>
            {!stopped && skippedCount > 1 && (
              <p className="mt-1">This has happened {skippedCount} times this session.</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {stopped && (
                <Button onClick={handleReload} className={TARGET}>
                  Reload editor
                </Button>
              )}
              {offerWebGL2 && (
                <Button variant="outline" onClick={handleSwitchToWebGL2} className={TARGET}>
                  Switch to WebGL2 and reload
                </Button>
              )}
              {!stopped && (
                <Button variant="outline" onClick={dismiss} className={TARGET}>
                  Dismiss
                </Button>
              )}
            </div>

            <details className="mt-3">
              <summary className={`${TARGET} flex cursor-pointer items-center text-xs text-[var(--sf-text-secondary)]`}>
                Technical details
              </summary>
              <dl className="mt-1 space-y-1 text-xs">
                <div>
                  <dt className="inline font-semibold">Error: </dt>
                  <dd className="inline">{RENDER_ERROR_CLASS_LABEL[notice.errorClass]}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold">Engine: </dt>
                  <dd className="inline">{stopped ? 'viewport stopped drawing' : 'skipped and kept drawing'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Message from the graphics layer (wgpu):</dt>
                  <dd>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                      {notice.detail || '(none given)'}
                    </pre>
                  </dd>
                </div>
              </dl>
            </details>
          </div>
        </div>
      </InlineAlert>
    </div>
  );
}
