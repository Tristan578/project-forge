// AI channel handler — proxies generation requests to API routes with progress polling.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface AiChannelDeps {
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
}

const POLL_INTERVAL_MS = 2000;

// Hoisted to module scope to avoid reconstruction on every handler invocation
const AI_ROUTE_MAP: Record<string, string> = {
  generateTexture: '/api/generate/texture',
  generateModel: '/api/generate/model',
  generateSound: '/api/generate/sound',
  generateVoice: '/api/generate/voice',
  generateMusic: '/api/generate/music',
};

export function createAiHandler(deps: AiChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, reportProgress, signal: AbortSignal) => {
    reportProgress(0, 'Submitting request...');

    const route = AI_ROUTE_MAP[method];
    if (!route) {
      throw new Error(`Unknown AI method: ${method}`);
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
