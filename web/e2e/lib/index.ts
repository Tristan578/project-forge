/**
 * Barrel exports for the AgentViewport integration library.
 *
 * Import from here rather than individual files:
 * ```ts
 * import { AgentViewport, formatObservation, isBlankFrame } from '../lib';
 * ```
 */

export { AgentViewport } from './agentViewport';
export { captureCanvasFrame, isBlankFrame } from './canvasReadback';
export { formatObservation, formatVerificationResult } from './viewportFormatter';
export type {
  CaptureOptions,
  CommandResult,
  SceneNodeSummary,
  SceneSnapshot,
  VerificationResult,
  ViewportCapture,
  ViewportObservation,
} from './types';
