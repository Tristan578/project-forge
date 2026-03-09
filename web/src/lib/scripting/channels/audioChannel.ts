// Audio channel handler — async audio queries (detectLoopPoints, getWaveform).

import type { AsyncHandler } from '../asyncChannelRouter';

export interface AudioChannelDeps {
  detectLoopPoints: (assetId: string) => Promise<unknown>;
  getWaveform: (assetId: string) => Promise<unknown>;
}

export function createAudioHandler(deps: AudioChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>) => {
    switch (method) {
      case 'detectLoopPoints': {
        const assetId = args.assetId as string;
        if (!assetId) throw new Error('Missing assetId for detectLoopPoints');
        return await deps.detectLoopPoints(assetId);
      }
      case 'getWaveform': {
        const assetId = args.assetId as string;
        if (!assetId) throw new Error('Missing assetId for getWaveform');
        return await deps.getWaveform(assetId);
      }
      default:
        throw new Error(`Unknown audio method: ${method}`);
    }
  };
}
