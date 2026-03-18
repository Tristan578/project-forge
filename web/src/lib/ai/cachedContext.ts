/**
 * Cached context helpers for Claude API calls.
 *
 * Two levels of caching:
 *   1. Application-level: avoids re-building expensive strings (promptCache)
 *   2. Claude API: cache_control: { type: 'ephemeral' } marks blocks for
 *      server-side caching (reduces token costs by ~30%).
 *
 * Usage:
 *   const ctx = getCachedSceneContext();    // read from cache or rebuild
 *   invalidateSceneCache();                 // call when scene graph changes
 *   const sys = getCachedSystemPrompt();    // static per session
 */

import { promptCache } from './promptCache';

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

const SCENE_CONTEXT_KEY = 'scene_context';
const SYSTEM_PROMPT_KEY = 'system_prompt';

// ---------------------------------------------------------------------------
// System prompt (static per session — cached indefinitely)
// ---------------------------------------------------------------------------

/**
 * Get the cached system prompt string.
 * The system prompt is static for the lifetime of the session so it is
 * cached indefinitely (no TTL) and never needs invalidation.
 *
 * @param buildFn - Factory called on cache miss. Must return the full
 *   system prompt string as defined in web/src/app/api/chat/route.ts.
 */
export function getCachedSystemPrompt(buildFn: () => string): string {
  const cached = promptCache.getCachedPrompt(SYSTEM_PROMPT_KEY);
  if (cached !== undefined) return cached;

  const value = buildFn();
  promptCache.setCachedPrompt(SYSTEM_PROMPT_KEY, value);
  return value;
}

// ---------------------------------------------------------------------------
// Scene context (dynamic — invalidated on scene changes)
// ---------------------------------------------------------------------------

/**
 * Get the cached scene context string.
 *
 * The scene context changes whenever entities are added, removed, renamed,
 * or modified. Call `invalidateSceneCache()` when any of those events occur.
 *
 * @param buildFn - Factory called on cache miss. Builds the scene context
 *   string from current store state.
 * @param forceRefresh - When true, always rebuilds even if a cached value
 *   exists. Use when you know the scene just changed.
 */
export function getCachedSceneContext(
  buildFn: () => string,
  forceRefresh = false
): string {
  if (!forceRefresh) {
    const cached = promptCache.getCachedPrompt(SCENE_CONTEXT_KEY);
    if (cached !== undefined) return cached;
  }

  const value = buildFn();
  promptCache.setCachedPrompt(SCENE_CONTEXT_KEY, value);
  return value;
}

/**
 * Invalidate the scene context cache.
 *
 * Call this whenever the scene graph changes — entity added/removed/modified.
 * The next call to getCachedSceneContext() will rebuild from store state.
 */
export function invalidateSceneCache(): void {
  promptCache.invalidate(SCENE_CONTEXT_KEY);
}

// ---------------------------------------------------------------------------
// Compound action context caching
// ---------------------------------------------------------------------------

/**
 * Cache a scene analysis result from compound actions.
 *
 * Compound tools (create_scene, setup_character, etc.) call describe_scene /
 * analyze_gameplay internally before executing steps. This caches those
 * analysis results so subsequent steps within the same compound action don't
 * re-request the same analysis.
 *
 * Key format: `compound_analysis:<analysisType>:<sceneHash>`
 * TTL: 30 seconds — compound actions complete well within this window.
 */
const COMPOUND_ANALYSIS_TTL_MS = 30_000;

export function getCachedCompoundAnalysis(
  analysisKey: string,
  buildFn: () => string
): string {
  const cacheKey = `compound_analysis:${analysisKey}`;
  const cached = promptCache.getCachedPrompt(cacheKey);
  if (cached !== undefined) return cached;

  const value = buildFn();
  promptCache.setCachedPrompt(cacheKey, value, COMPOUND_ANALYSIS_TTL_MS);
  return value;
}

/**
 * Invalidate a specific compound analysis cache entry.
 */
export function invalidateCompoundAnalysis(analysisKey: string): void {
  promptCache.invalidate(`compound_analysis:${analysisKey}`);
}

/**
 * Invalidate ALL cached state (scene + system prompt + compound analyses).
 * Use sparingly — typically only needed in tests or on scene reset.
 */
export function invalidateAllCaches(): void {
  promptCache.clear();
}
