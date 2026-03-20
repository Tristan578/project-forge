/**
 * Centralized AI model configuration.
 *
 * All AI feature modules MUST import model IDs from here instead of
 * hardcoding strings. When Anthropic releases new model versions,
 * update these constants once — not in 20+ files.
 */

/** Primary model for complex generation (GDD, world building, tutorials) */
export const AI_MODEL_PRIMARY = 'claude-sonnet-4-5-20250929';

/** Fast model for simpler tasks (reviews, behavior trees, quick analysis) */
export const AI_MODEL_FAST = 'claude-haiku-4-5-20251001';
