/**
 * Event handlers for performance metrics and LOD level changes.
 */

import { usePerformanceStore } from '@/stores/performanceStore';
import type { SetFn, GetFn } from './types';

export function handlePerformanceEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'PERFORMANCE_STATS': {
      const payload = data as {
        fps: number;
        frameTimeMs: number;
        entityCount: number;
        triangleCount: number;
        drawCallEstimate: number;
        wasmHeapBytes: number;
        meshMemoryBytes: number;
      };
      usePerformanceStore.getState().updateStats({
        fps: payload.fps,
        frameTime: payload.frameTimeMs,
        entityCount: payload.entityCount,
        triangleCount: payload.triangleCount,
        drawCalls: payload.drawCallEstimate,
        wasmHeapSize: payload.wasmHeapBytes,
        memoryUsage: payload.meshMemoryBytes / (1024 * 1024), // bytes to MB
      });
      return true;
    }

    case 'SYSTEM_TIMINGS': {
      // Per-frame CPU cost attributed to coarse system groups
      // (performance.FR-1.OP-01/OP-04). A group ABSENT from `perGroupMs` was
      // not measured this frame and must stay unavailable downstream — the
      // handler forwards the payload verbatim, never coercing a gap to 0.
      const timingPayload = data as {
        frameIndex: number;
        perGroupMs: Partial<Record<'entitySync' | 'transformApply' | 'physics' | 'rendering', number>>;
      };
      usePerformanceStore.getState().pushSystemTimingFrame({
        frameIndex: timingPayload.frameIndex,
        perGroupMs: timingPayload.perGroupMs ?? {},
      });
      return true;
    }

    case 'LOD_CHANGED': {
      const lodPayload = data as {
        entityId: string;
        currentLod: number;
      };
      usePerformanceStore.getState().setLodLevel(lodPayload.entityId, lodPayload.currentLod);
      return true;
    }

    default:
      return false;
  }
}
