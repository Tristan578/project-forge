import { describe, it, expect } from 'vitest';
import { isTable } from 'drizzle-orm';
import * as schema from '../schema';

const EXPECTED_TABLE_NAMES = [
  'users', 'apiKeys', 'providerKeys', 'tokenUsage', 'tokenPurchases',
  'projects', 'tokenConfig', 'tierConfig', 'costLog', 'creditTransactions',
  'publishedGames', 'gameReports', 'gameRatings', 'gameComments', 'gameLikes', 'userFollows',
  'gameTags', 'gameForks', 'featuredGames', 'marketplaceAssets',
  'assetPurchases', 'assetReviews', 'sellerProfiles', 'feedback', 'generationJobs',
  'webhookEvents', 'leaderboards', 'leaderboardEntries', 'moderationAppeals',
  'waitlistSignups', 'graphNodes', 'graphEdges',
] as const;

describe('database schema', () => {
  it('exports all expected tables as Drizzle table objects', () => {
    for (const name of EXPECTED_TABLE_NAMES) {
      const table = schema[name];
      expect(table, `${name} should be exported`).not.toBeUndefined();
      expect(isTable(table), `${name} should be a Drizzle table object`).toBe(true);
    }
  });

  it('exports exactly the expected number of tables', () => {
    const actualTableNames = Object.entries(schema)
      .filter(([, value]) => isTable(value))
      .map(([name]) => name)
      .sort();

    expect(actualTableNames).toEqual([...EXPECTED_TABLE_NAMES].sort());
  });

  it('exports enums as non-null objects', () => {
    const enums = [
      { name: 'tierEnum', value: schema.tierEnum },
      { name: 'providerEnum', value: schema.providerEnum },
      { name: 'tokenSourceEnum', value: schema.tokenSourceEnum },
      { name: 'publishStatusEnum', value: schema.publishStatusEnum },
      { name: 'jobStatusEnum', value: schema.jobStatusEnum },
      { name: 'gameReportReasonEnum', value: schema.gameReportReasonEnum },
    ];

    for (const { name, value } of enums) {
      expect(value, `${name} should be exported`).not.toBeUndefined();
      expect(typeof value, `${name} should be an object or function`).not.toBe('undefined');
    }
  });

  // #9522: music moved from Suno to ElevenLabs, but the pg `provider` enum must
  // KEEP 'suno' — historical tokenUsage/apiKeys/costLog rows still reference it,
  // and dropping the value would break reads of those rows. No migration drops it.
  it("pg provider enum retains 'suno' for historical rows (#9522)", () => {
    expect(schema.providerEnum.enumValues).toContain('suno');
  });

  // #9522: the TS `Provider` union is the read-path type for provider columns;
  // it must still admit 'suno' so old rows type-check when read back.
  it("Provider union still admits 'suno' for read-path typing (#9522)", () => {
    const historical: schema.Provider = 'suno';
    expect(historical).toBe('suno');
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
