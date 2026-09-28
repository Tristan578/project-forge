/**
 * Render-error notice state (#8887).
 *
 * Holds the one notice the editor shows for engine render errors. Fed by the
 * `RENDER_ERROR` handler in `hooks/events/renderErrorEvents.ts`, read by
 * `components/editor/RenderErrorNotice.tsx`.
 *
 * A `stopped` notice is sticky: the viewport really has stopped drawing, so it
 * cannot be dismissed and a later `continued` report cannot replace it (the
 * engine never sends one after stopping, and this store does not trust that).
 * A `continued` notice can be dismissed; a later report shows it again.
 */

import { create } from 'zustand';
import type { RenderErrorReport } from '@/lib/engine/renderErrorWire';

export interface RenderErrorNoticeState {
  /** The report being shown, or null when there is nothing to show. */
  notice: RenderErrorReport | null;
  /** How many `continued` reports this session, so a recurring glitch reads as one. */
  skippedCount: number;
  report: (report: RenderErrorReport) => void;
  /** Hide a `continued` notice. A `stopped` notice cannot be dismissed. */
  dismiss: () => void;
  /** Test/reset seam. */
  reset: () => void;
}

export const useRenderErrorStore = create<RenderErrorNoticeState>((set, get) => ({
  notice: null,
  skippedCount: 0,
  report: (report) => {
    const { notice, skippedCount } = get();
    if (report.outcome === 'continued') {
      if (notice?.outcome === 'stopped') return;
      set({ notice: report, skippedCount: skippedCount + 1 });
      return;
    }
    set({ notice: report });
  },
  dismiss: () => {
    if (get().notice?.outcome === 'stopped') return;
    set({ notice: null });
  },
  reset: () => set({ notice: null, skippedCount: 0 }),
}));
