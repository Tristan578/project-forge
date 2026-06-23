import type { GenerationType } from '@/stores/generationStore';

/**
 * Single source of truth mapping each async generation type to the API route
 * that reports its job status. Both the auto-poller
 * (`useGenerationPolling.getStatusEndpoint`) and the chat tool
 * (`get_generation_status`) consume this map so the two can never drift apart
 * again (#8762 — `pixel-art`/`sprite_sheet`/`tileset` had silently fallen out
 * of the chat tool's copy, making `get_generation_status({ type: 'pixel-art' })`
 * return a false "Could not find generation job").
 *
 * `sfx` and `voice` (members of `GenerationType`) are intentionally absent: they
 * have no async `/status` route, so they are not pollable. The `satisfies`
 * clause keeps the keys checked against `GenerationType` — a typo'd or removed
 * type fails `tsc` here rather than silently producing a dead route string.
 */
export const STATUS_ENDPOINTS = {
  model: '/api/generate/model/status',
  texture: '/api/generate/texture/status',
  skybox: '/api/generate/skybox/status',
  music: '/api/generate/music/status',
  sprite: '/api/generate/sprite/status',
  sprite_sheet: '/api/generate/sprite-sheet/status',
  tileset: '/api/generate/tileset-gen/status',
  'pixel-art': '/api/generate/pixel-art/status',
} as const satisfies Partial<Record<GenerationType, string>>;

/** A generation type that has an async status endpoint. */
export type StatusPollableType = keyof typeof STATUS_ENDPOINTS;

/**
 * Resolve a generation type to its status route, or `undefined` if the type has
 * no async status endpoint (e.g. `sfx`, `voice`, or an unknown string).
 * Used by `get_generation_status`, which branches on presence rather than throwing.
 */
export function resolveStatusEndpoint(type: string): string | undefined {
  return (STATUS_ENDPOINTS as Record<string, string | undefined>)[type];
}

/**
 * Resolve a generation type to its status route, throwing on an unknown or
 * unpollable type. Used by the auto-poller, where an unresolvable type is a
 * programming error (the job should never have been enqueued for polling).
 */
export function getStatusEndpoint(type: string): string {
  const route = resolveStatusEndpoint(type);
  if (!route) {
    throw new Error(`Unknown generation type: ${type}`);
  }
  return route;
}
