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

/**
 * How many games a tier may have published at once.
 *
 * This lived as an inline literal inside the publish route, where nothing that
 * quotes the limit to a user could reach it.
 */
export const PUBLISH_LIMITS = {
  starter: 1,
  hobbyist: 3,
  creator: 10,
  pro: 100,
} as const;
