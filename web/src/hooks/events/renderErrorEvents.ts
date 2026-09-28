/**
 * Event handler for engine render errors (#8887).
 *
 * The engine emits `RENDER_ERROR` when wgpu reports an error, after deciding
 * whether to keep drawing (`continued`) or stop the viewport (`stopped`); see
 * `engine/src/core/render_errors.rs`. This handler shows the notice and sends
 * the raw detail to Sentry, which is where the wgpu text belongs.
 */

import { captureException } from '@/lib/monitoring/sentry-client';
import { getActiveEngineBackend } from '@/hooks/useEngine';
import {
  RENDER_ERROR_CLASS_LABEL,
  RENDER_ERROR_EVENT,
  parseRenderErrorReport,
} from '@/lib/engine/renderErrorWire';
import { useRenderErrorStore } from '@/stores/renderErrorStore';
import type { SetFn, GetFn } from './types';

export function handleRenderErrorEvent(
  type: string,
  data: unknown,
  _set: SetFn,
  _get: GetFn,
): boolean {
  if (type !== RENDER_ERROR_EVENT) return false;

  const report = parseRenderErrorReport(data);
  if (!report) {
    // Claimed rather than left to the hub's "Unknown engine event": the name
    // is ours, and the payload being unreadable is the thing worth reporting.
    console.warn('[renderErrorEvents] RENDER_ERROR payload was unreadable; no notice shown.', data);
    captureException(new Error('RENDER_ERROR payload was unreadable'), { source: 'render_error_handler' });
    return true;
  }

  useRenderErrorStore.getState().report(report);
  captureException(
    new Error(`Engine render error: ${RENDER_ERROR_CLASS_LABEL[report.errorClass]} (${report.outcome})`),
    {
      source: 'render_error_handler',
      errorClass: report.errorClass,
      outcome: report.outcome,
      occurrence: report.occurrence,
      detail: report.detail,
      engineBackend: getActiveEngineBackend(),
    },
  );
  return true;
}
