/**
 * Config barrel — re-exports all config modules for convenience.
 *
 * Prefer direct imports from specific modules for tree-shaking:
 *   import { GPU_INIT_TIMEOUT_MS } from '@/lib/config/timeouts';
 *
 * Use the barrel only when importing from multiple config modules:
 *   import { GPU_INIT_TIMEOUT_MS, PROVIDER_NAMES } from '@/lib/config';
 */

export * from './timeouts';
export * from './providers';
export * from './scopes';
export * from './enums';
