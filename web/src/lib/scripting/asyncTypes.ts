// Async Channel Protocol — shared type definitions for worker ↔ main thread communication.
// See: docs/plans/2026-03-09-async-channel-protocol-design.md

export type AsyncChannel = 'physics' | 'audio' | 'ai' | 'asset' | 'animation' | 'multiplayer';

export const ASYNC_CHANNELS: readonly AsyncChannel[] = [
  'physics', 'audio', 'ai', 'asset', 'animation', 'multiplayer',
] as const;

export interface AsyncRequest {
  type: 'async_request';
  requestId: string;
  channel: AsyncChannel;
  method: string;
  args: unknown;
}

export interface AsyncResponse {
  requestId: string;
  status: 'ok' | 'error' | 'progress';
  data?: unknown;
  error?: string;
  progress?: {
    percent: number;
    message?: string;
  };
}

export interface ChannelConfig {
  maxConcurrent: number;
  timeoutMs: number;
  supportsProgress: boolean;
  playModeOnly: boolean;
}

export const CHANNEL_CONFIGS: Record<AsyncChannel, ChannelConfig> = {
  physics:     { maxConcurrent: 32, timeoutMs: 1_000,   supportsProgress: false, playModeOnly: true },
  animation:   { maxConcurrent: 8,  timeoutMs: 2_000,   supportsProgress: false, playModeOnly: true },
  audio:       { maxConcurrent: 4,  timeoutMs: 10_000,  supportsProgress: false, playModeOnly: false },
  ai:          { maxConcurrent: 3,  timeoutMs: 120_000, supportsProgress: true,  playModeOnly: false },
  asset:       { maxConcurrent: 4,  timeoutMs: 30_000,  supportsProgress: true,  playModeOnly: false },
  multiplayer: { maxConcurrent: 16, timeoutMs: 10_000,  supportsProgress: false, playModeOnly: true },
};

export const CHANNEL_ALLOWED_METHODS: Record<AsyncChannel, Set<string>> = {
  physics:     new Set(['raycast', 'raycast2d', 'isGrounded', 'overlapSphere']),
  animation:   new Set(['listClips', 'getClipDuration']),
  audio:       new Set(['detectLoopPoints', 'getWaveform']),
  ai:          new Set(['generateTexture', 'generateModel', 'generateSound', 'generateVoice', 'generateMusic']),
  asset:       new Set(['loadImage', 'loadModel']),
  multiplayer: new Set([]),
};
