/**
 * Shared type definitions for the audio subsystem.
 */

export interface LoopPoint {
  startSample: number;
  endSample: number;
  startTime: number;
  endTime: number;
  score: number;
}

export interface AudioSnapshot {
  name: string;
  busStates: Record<string, { volume: number; muted: boolean }>;
  crossfadeDurationMs: number;
}

export interface EffectDefinition {
  effectType: string;
  params: Record<string, number>;
  enabled: boolean;
}

export interface EffectInstance {
  type: string;
  inputNode: AudioNode;
  outputNode: AudioNode;
  params: Record<string, number>;
  enabled: boolean;
}
