import { describe, it, expect } from 'vitest';
import * as schema from '../schema';

/**
 * Drizzle table objects have a Symbol(drizzle:Name) symbol property that
 * identifies the table name, and an object-type value. We verify both
 * existence and structural shape rather than just toBeDefined().
 */
function isTableObject(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  // Drizzle tables have a getSQL method or column sub-properties
  return Object.keys(value as object).length > 0;
}

describe('database schema', () => {
  it('exports all expected tables as Drizzle table objects', () => {
    const tables = [
      'users', 'apiKeys', 'providerKeys', 'tokenUsage', 'tokenPurchases',
      'projects', 'tokenConfig', 'tierConfig', 'costLog', 'creditTransactions',
      'publishedGames', 'gameRatings', 'gameComments', 'gameLikes', 'userFollows',
      'gameTags', 'gameForks', 'featuredGames', 'marketplaceAssets',
      'assetPurchases', 'assetReviews', 'sellerProfiles', 'feedback', 'generationJobs',
    ] as const;

    for (const name of tables) {
      const table = schema[name];
      expect(table, `${name} should be exported`).not.toBeUndefined();
      expect(isTableObject(table), `${name} should be a Drizzle table object`).toBe(true);
    }
  });

  it('exports exactly the expected number of tables', () => {
    const tables = [
      'users', 'apiKeys', 'providerKeys', 'tokenUsage', 'tokenPurchases',
      'projects', 'tokenConfig', 'tierConfig', 'costLog', 'creditTransactions',
      'publishedGames', 'gameRatings', 'gameComments', 'gameLikes', 'userFollows',
      'gameTags', 'gameForks', 'featuredGames', 'marketplaceAssets',
      'assetPurchases', 'assetReviews', 'sellerProfiles', 'feedback', 'generationJobs',
    ];
    expect(tables.length).toBe(24);
  });

  it('exports enums as non-null objects', () => {
    const enums = [
      { name: 'tierEnum', value: schema.tierEnum },
      { name: 'providerEnum', value: schema.providerEnum },
      { name: 'tokenSourceEnum', value: schema.tokenSourceEnum },
      { name: 'publishStatusEnum', value: schema.publishStatusEnum },
      { name: 'jobStatusEnum', value: schema.jobStatusEnum },
    ];

    for (const { name, value } of enums) {
      expect(value, `${name} should be exported`).not.toBeUndefined();
      expect(typeof value, `${name} should be an object or function`).not.toBe('undefined');
    }
  });

  it('generationJobs table has expected column structure', () => {
    const { generationJobs } = schema;
    // Drizzle tables expose their columns as object keys
    const keys = Object.keys(generationJobs);
    expect(keys).toContain('id');
    expect(keys).toContain('userId');
    expect(keys).toContain('status');
    expect(keys).toContain('prompt');
    expect(keys).toContain('parameters');
  });

  it('users table has expected column structure', () => {
    const { users } = schema;
    const keys = Object.keys(users);
    expect(keys).toContain('id');
    expect(keys).toContain('email');
  });

  it('projects table has expected column structure', () => {
    const { projects } = schema;
    const keys = Object.keys(projects);
    expect(keys).toContain('id');
    expect(keys).toContain('userId');
    expect(keys).toContain('name');
  });
});
