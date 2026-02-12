/**
 * Tier-based limits for project storage and entities.
 */

export const PROJECT_LIMITS = {
  free: 1,
  starter: 10,
  creator: 50,
  studio: Infinity,
} as const;

export const ENTITY_LIMITS = {
  free: 50,
  starter: 500,
  creator: 2000,
  studio: 10000,
} as const;
