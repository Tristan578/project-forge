/**
 * Panel and command lifecycle tracking for Vercel Web Analytics.
 *
 * These functions are fire-and-forget and never block the UI.
 * No PII is sent — only panel IDs, command names, durations, and counts.
 */

import { track } from '@vercel/analytics';

const env = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

// ---------------------------------------------------------------------------
// Panel open/close tracking
// ---------------------------------------------------------------------------

/**
 * Track when an editor panel is opened.
 * Call at the moment the panel becomes visible.
 */
export function trackPanelOpened(panelId: string): void {
  track('panel_opened', { panelId, env });
}

/**
 * Track when an editor panel is closed.
 * @param durationMs - milliseconds the panel was visible
 */
export function trackPanelClosed(panelId: string, durationMs: number): void {
  track('panel_closed', { panelId, durationMs, env });
}

// ---------------------------------------------------------------------------
// Command tracking
// ---------------------------------------------------------------------------

/**
 * Track a command dispatched to the engine.
 * Only the command name is sent — no args or entity IDs.
 */
export function trackCommandDispatched(commandName: string): void {
  track('command_dispatched', { commandName, env });
}

// ---------------------------------------------------------------------------
// AI generation tracking
// ---------------------------------------------------------------------------

/**
 * Track when an AI generation job is initiated.
 * @param moduleName - e.g. "meshy_3d", "elevenlabs_sfx", "suno_music"
 */
export function trackGenerationStarted(moduleName: string): void {
  track('generation_started', { moduleName, env });
}

/**
 * Track when an AI generation job completes (success or failure).
 * @param moduleName  - same identifier used in trackGenerationStarted
 * @param durationMs  - wall-clock time from start to completion
 * @param success     - whether the generation succeeded
 */
export function trackGenerationCompleted(
  moduleName: string,
  durationMs: number,
  success: boolean,
): void {
  track('generation_completed', { moduleName, durationMs, success, env });
}

// ---------------------------------------------------------------------------
// Publishing tracking
// ---------------------------------------------------------------------------

/**
 * Track when a game is published.
 * @param entityCount  - total number of entities in the published scene
 * @param projectSizeKb - approximate project size in kilobytes
 */
export function trackGamePublished(entityCount: number, projectSizeKb: number): void {
  track('game_published_detail', { entityCount, projectSizeKb, env });
}
