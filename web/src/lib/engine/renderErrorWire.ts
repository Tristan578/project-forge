/**
 * The `RENDER_ERROR` wire (#8887).
 *
 * Bevy 0.19's default render-error handler quit the engine on ANY wgpu error,
 * and on the web that exit was silent: the viewport froze and the editor never
 * heard why. The engine now installs its own handler
 * (`engine/src/core/render_errors.rs`) that never quits. It either skips a
 * one-off error and keeps drawing, or stops drawing the viewport while the
 * engine, the scene and saving keep working. Every decision is emitted as
 * `RENDER_ERROR` with the payload `{ errorClass, outcome, detail, occurrence }`.
 *
 * Two surfaces read it, each with its own words from this file: the editor
 * (`hooks/events/renderErrorEvents.ts` -> `RenderErrorNotice`, `renderErrorCopy`)
 * and the published-game player (`components/play/GamePlayer.tsx` ->
 * `PlayRenderErrorNotice`, `playerRenderErrorCopy`).
 *
 * The Rust enum spellings are pinned against this file by
 * `hooks/events/__tests__/renderErrorWireParity.test.ts`.
 */

export const RENDER_ERROR_EVENT = 'RENDER_ERROR';

/** One per `wgpu_types::error::ErrorType`, camelCase as serde writes them. */
export const RENDER_ERROR_CLASSES = ['validation', 'internal', 'outOfMemory', 'deviceLost'] as const;
export type RenderErrorClass = (typeof RENDER_ERROR_CLASSES)[number];

/** `continued`: skipped, still drawing. `stopped`: the viewport stopped drawing. */
export const RENDER_ERROR_OUTCOMES = ['continued', 'stopped'] as const;
export type RenderErrorOutcome = (typeof RENDER_ERROR_OUTCOMES)[number];

export interface RenderErrorReport {
  errorClass: RenderErrorClass;
  outcome: RenderErrorOutcome;
  /** The raw wgpu description. Diagnostic detail only, never the headline. May be empty. */
  detail: string;
  /** 1-based count of render errors the engine has reported this session. */
  occurrence: number;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * Parse a `RENDER_ERROR` payload. Returns `null` for anything that does not
 * match the engine's shape; an unrecognised class or outcome is dropped rather
 * than defaulted, so the editor never shows copy for an error it did not get.
 */
export function parseRenderErrorReport(payload: unknown): RenderErrorReport | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { errorClass, outcome, detail, occurrence } = payload as Record<string, unknown>;
  if (!isOneOf(RENDER_ERROR_CLASSES, errorClass)) return null;
  if (!isOneOf(RENDER_ERROR_OUTCOMES, outcome)) return null;
  if (typeof detail !== 'string') return null;
  if (typeof occurrence !== 'number' || !Number.isInteger(occurrence) || occurrence < 1) return null;
  return { errorClass, outcome, detail, occurrence };
}

/** The user-facing words for one notice. */
export interface RenderErrorCopy {
  title: string;
  body: string;
}

/**
 * Plain-language copy for every class/outcome the engine can report.
 *
 * Only claims what is true in this codebase: after `stopped` the engine's main
 * loop keeps running (`StopRendering` halts Bevy's render sub-app only), so the
 * scene stays loaded and the toolbar's Save and Cloud Save still export it.
 * A `continued` outcome can only be a validation or internal error; the engine
 * stops outright on out-of-memory and device loss.
 */
export function renderErrorCopy(errorClass: RenderErrorClass, outcome: RenderErrorOutcome): RenderErrorCopy {
  if (outcome === 'continued') {
    return {
      title: 'A graphics error was skipped',
      body:
        'The viewport hit a graphics error and skipped drawing one frame. Your scene is unchanged and you can keep working. ' +
        'If the viewport looks wrong, save your work and reload the editor.',
    };
  }
  const saveThenReload = 'Your scene is still loaded, so save your work from the toolbar first, then reload the editor.';
  switch (errorClass) {
    case 'outOfMemory':
      return {
        title: 'The graphics card ran out of memory',
        body:
          'The viewport stopped drawing because the graphics card ran out of memory. ' +
          `${saveThenReload} Closing other tabs or apps that use graphics can free memory.`,
      };
    case 'deviceLost':
      return {
        title: 'The connection to the graphics card was lost',
        body:
          'The viewport stopped drawing because the browser lost its graphics device. This can happen after a driver update, ' +
          `waking from sleep, or a graphics crash. ${saveThenReload}`,
      };
    case 'validation':
    case 'internal':
      return {
        title: 'The viewport stopped drawing',
        body:
          'The same graphics error kept happening, so the engine stopped drawing the viewport to avoid flicker. ' +
          saveThenReload,
      };
  }
}

/**
 * The same notice, worded for someone PLAYING a published game on `/play`
 * (`components/play/PlayRenderErrorNotice.tsx`). Kept beside the editor copy so
 * the two surfaces change together.
 *
 * A player did not make the game and has none of the editor's tools: no
 * toolbar, no Save, no scene. The only actions that exist on `/play` are
 * reloading (which restarts the game from its start) and leaving, so this copy
 * points at nothing else. It also never names a graphics backend: the player
 * has no backend preference to switch (`loadPlayEngine` always auto-selects),
 * so "try WebGL2" would be advice with no control behind it.
 */
export function playerRenderErrorCopy(errorClass: RenderErrorClass, outcome: RenderErrorOutcome): RenderErrorCopy {
  if (outcome === 'continued') {
    return {
      title: 'A graphics glitch was skipped',
      body:
        'The game hit a graphics error, skipped one frame and kept running. ' +
        'If the picture looks wrong, reload the game to restart it.',
    };
  }
  switch (errorClass) {
    case 'outOfMemory':
      return {
        title: 'Your device ran out of graphics memory',
        body:
          'The game stopped drawing because your device ran out of graphics memory. ' +
          'Close other tabs or apps that use graphics, then reload to restart the game.',
      };
    case 'deviceLost':
      return {
        title: 'The game lost its connection to the graphics card',
        body:
          'The game stopped drawing because your browser lost access to the graphics card. This can happen after a driver ' +
          'update, waking from sleep, or a graphics crash. Reload to restart the game.',
      };
    case 'validation':
    case 'internal':
      return {
        title: 'The game stopped drawing',
        body:
          'The same graphics error kept happening, so the game stopped drawing to avoid flickering. ' +
          'Reload to restart the game. If it happens again, try a different browser.',
      };
  }
}

/** Short technical label for the details disclosure and for Sentry. */
export const RENDER_ERROR_CLASS_LABEL: Record<RenderErrorClass, string> = {
  validation: 'GPU validation error',
  internal: 'GPU internal error',
  outOfMemory: 'GPU out of memory',
  deviceLost: 'GPU device lost',
};
