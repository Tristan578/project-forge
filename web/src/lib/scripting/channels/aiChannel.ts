// AI channel handler — proxies generation requests to API routes with progress polling.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface AiChannelDeps {
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
}

const POLL_INTERVAL_MS = 2000;

export function createAiHandler(deps: AiChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, reportProgress) => {
    reportProgress(0, 'Submitting request...');

    // Map method to API route
    const routeMap: Record<string, string> = {
      generateTexture: '/api/generate/texture',
      generateModel: '/api/generate/model',
      generateSound: '/api/generate/sound',
      generateVoice: '/api/generate/voice',
      generateMusic: '/api/generate/music',
    };

    const route = routeMap[method];
    if (!route) {
      throw new Error(`Unknown AI method: ${method}`);
    }

    // Submit generation request
    const submitResult = await deps.fetchJson(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }) as { jobId?: string; error?: string };

    if (!submitResult.jobId) {
      throw new Error(submitResult.error ?? 'Failed to submit generation request');
    }

    // Poll for completion
    const { jobId } = submitResult;
    reportProgress(10, 'Processing...');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const status = await deps.fetchJson(`/api/generate/status/${jobId}`) as {
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

      // Wait before next poll
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  };
}
