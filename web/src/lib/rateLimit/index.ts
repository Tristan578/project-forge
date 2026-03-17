/**
 * Rate limiting utilities.
 *
 * Re-exports all in-memory helpers from the original rateLimit module for
 * backward compatibility, and adds `rateLimitDistributed` which uses
 * Upstash Redis when configured and falls back to in-memory otherwise.
 */

// Re-export all existing helpers so callers using '@/lib/rateLimit' or
// '@/lib/rateLimit/index' get the same surface area.
export {
  rateLimit,
  rateLimitResponse,
  rateLimitPublicRoute,
  rateLimitAdminRoute,
  getClientIp,
} from '../rateLimit';

export { distributedRateLimit } from './distributed';
export type { DistributedRateLimitResult } from './distributed';
