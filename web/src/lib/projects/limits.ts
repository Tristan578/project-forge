/**
 * Tier-based limits for project storage and entities.
 */

export const PROJECT_LIMITS = {
  starter: 3,
  hobbyist: 10,
  creator: 50,
  pro: Infinity,
} as const;

export const ENTITY_LIMITS = {
  starter: 50,
  hobbyist: 500,
  creator: 2000,
  pro: 10000,
} as const;
