/**
 * Runtime allowlist for deep-generation surfaces.
 *
 * This module is a dependency-free leaf — no browser APIs, no analytics
 * imports — so it can be imported safely from both client modules and the
 * server-side /api/chat route without pulling client analytics code into
 * the server bundle.
 *
 * `deepTier.ts` re-exports the type from here so existing importers
 * (the three generator modules) keep working unchanged.
 */

export const DEEP_GEN_SURFACES = ['gdd', 'world_builder', 'cutscene'] as const;
export type DeepGenSurface = (typeof DEEP_GEN_SURFACES)[number];
