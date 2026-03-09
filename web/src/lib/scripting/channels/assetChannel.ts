// Asset channel handler — loads images and models with progress reporting.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface AssetChannelDeps {
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
}

export function createAssetHandler(deps: AssetChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, reportProgress, signal: AbortSignal) => {
    switch (method) {
      case 'loadImage': {
        reportProgress(0, 'Loading image...');
        const result = await deps.fetchJson('/api/assets/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'image', url: args.url, assetId: args.assetId }),
          signal,
        });
        reportProgress(100, 'Image loaded');
        return result;
      }
      case 'loadModel': {
        reportProgress(0, 'Loading model...');
        const result = await deps.fetchJson('/api/assets/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'model', url: args.url, assetId: args.assetId }),
          signal,
        });
        reportProgress(100, 'Model loaded');
        return result;
      }
      default:
        throw new Error(`Unknown asset method: ${method}`);
    }
  };
}
