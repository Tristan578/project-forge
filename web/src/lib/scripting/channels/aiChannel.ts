// AI channel handler — proxies generation requests to API routes with progress polling.

import type { AsyncHandler } from '../asyncChannelRouter';
import { getCapabilityUnavailability, type ProviderCapability } from '@/lib/config/providers';

export interface AiChannelDeps {
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Every `forge.ai.*` method with the route it posts to AND the capability it
 * spends, in one table: a method cannot gain a route without declaring its
 * capability, so the #9117 gate below can never be bypassed by drift.
 * Every `route` must be a key of `ROUTE_CAPABILITY` with the same capability
 * (pinned by aiChannel.test.ts) — that table is checked against the routes on
 * disk, so an entry here cannot point at a route that does not exist.
 * Hoisted to module scope to avoid reconstruction on every invocation.
 */
export const AI_METHODS: Readonly<Record<string, { route: string; capability: ProviderCapability }>> = {
  generateTexture: { route: '/api/generate/texture', capability: 'texture' },
  generateModel: { route: '/api/generate/model', capability: 'model3d' },
  generateSound: { route: '/api/generate/sfx', capability: 'sfx' },
  generateVoice: { route: '/api/generate/voice', capability: 'voice' },
  generateMusic: { route: '/api/generate/music', capability: 'music' },
};

export function createAiHandler(deps: AiChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, reportProgress, signal: AbortSignal) => {
    reportProgress(0, 'Submitting request...');

    const entry = AI_METHODS[method];
    if (!entry) {
      throw new Error(`Unknown AI method: ${method}`);
    }
    const { route, capability } = entry;

    // #9117: a capability declared unavailable in code is refused before the
    // request leaves the worker, with the same reason the editor shows.
    const unavailable = getCapabilityUnavailability(capability);
    if (unavailable) {
      throw new Error(unavailable.reason);
    }

    // Submit generation request
    const submitResult = await deps.fetchJson(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal,
    }) as { jobId?: string; error?: string };

    if (!submitResult.jobId) {
      throw new Error(submitResult.error ?? 'Failed to submit generation request');
    }

    // Poll for completion
    const { jobId } = submitResult;
    reportProgress(10, 'Processing...');

    while (!signal.aborted) {
      const status = await deps.fetchJson(`/api/generate/status/${jobId}`, { signal }) as {
        status: string;
        progress?: number;
        message?: string;
        data?: unknown;
        error?: string;
      };

      if (status.status === 'completed') {
        reportProgress(100, 'Done');
        return status.data;
      }

      if (status.status === 'failed') {
        throw new Error(status.error ?? 'Generation failed');
      }

      // Report intermediate progress
      reportProgress(status.progress ?? 50, status.message ?? 'Processing...');

      // Wait before next poll (abortable)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, POLL_INTERVAL_MS);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
    }

    throw new Error('AI generation request was cancelled');
  };
}
