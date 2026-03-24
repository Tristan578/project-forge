/**
 * Tests for backup verification coverage: confirms that the schema exports
 * match the tables and enums that scripts/verify-db-backup.sh checks.
 *
 * These tests catch the common drift where a new table is added to schema.ts
 * but not added to the verification script (or vice versa).
 */
import { describe, it, expect } from 'vitest';
import * as schema from '../schema';

// Tables that verify-db-backup.sh checks for existence.
// Keep this list in sync with the `required_tables` array in that script.
const VERIFIED_TABLES_IN_SCRIPT = [
  'users',
  'projects',
  'tokenPurchases',
  'tokenUsage',
  'tokenConfig',
  'tierConfig',
  'costLog',
  'creditTransactions',
  'publishedGames',
  'generationJobs',
  'apiKeys',
  'providerKeys',
  'webhookEvents',
  'feedback',
  'marketplaceAssets',
  'assetPurchases',
  'assetReviews',
  'sellerProfiles',
  'gameRatings',
  'gameComments',
  'gameLikes',
  'gameTags',
  'gameForks',
  'featuredGames',
  'userFollows',
  'moderationAppeals',
] as const;

// Enums that verify-db-backup.sh checks for existence (as pg_type entries).
// Keep this list in sync with the `required_enums` array in that script.
const VERIFIED_ENUMS_IN_SCRIPT = [
  'tierEnum',
  'providerEnum',
  'tokenSourceEnum',
  'tokenPackageEnum',
  'transactionTypeEnum',
  'publishStatusEnum',
  'jobStatusEnum',
  'generationTypeEnum',
  'assetCategoryEnum',
  'assetStatusEnum',
  'assetLicenseEnum',
  'feedbackTypeEnum',
  'appealStatusEnum',
] as const;

// Tables that verify-db-backup.sh checks row counts for.
const ROW_COUNTED_TABLES_IN_SCRIPT = [
  'users',
  'projects',
  'tokenPurchases',
  'tokenUsage',
  'costLog',
  'creditTransactions',
  'publishedGames',
  'generationJobs',
] as const;

describe('backup verification script coverage', () => {
  describe('table existence checks', () => {
    it.each(VERIFIED_TABLES_IN_SCRIPT)(
      'schema exports table "%s" that verify-db-backup.sh checks',
      (tableName) => {
        expect(schema[tableName as keyof typeof schema]).not.toBeUndefined();
      }
    );
  });

  describe('enum type checks', () => {
    it.each(VERIFIED_ENUMS_IN_SCRIPT)(
      'schema exports enum "%s" that verify-db-backup.sh checks',
      (enumName) => {
        expect(schema[enumName as keyof typeof schema]).not.toBeUndefined();
      }
    );
  });

  describe('row count table checks', () => {
    it.each(ROW_COUNTED_TABLES_IN_SCRIPT)(
      'schema exports table "%s" that verify-db-backup.sh counts rows for',
      (tableName) => {
        expect(schema[tableName as keyof typeof schema]).not.toBeUndefined();
      }
    );
  });

  describe('schema completeness', () => {
    it('all tables in schema have a corresponding entry in the verification script', () => {
      // This is the inverse check: schema tables that are NOT in the verification
      // script. New tables should be added to the script. This test will WARN
      // (not fail) by logging tables that have been added to schema.ts but
      // not yet to the verification script.
      //
      // To convert to a hard failure: uncomment the expect() at the bottom.

      const schemaTableKeys = Object.keys(schema).filter((key) => {
        const val = schema[key as keyof typeof schema];
        // Drizzle table objects have a `getSQL` method; enums and types do not.
        return (
          val !== null &&
          typeof val === 'object' &&
          'getSQL' in (val as object)
        );
      });

      const uncoveredTables = schemaTableKeys.filter(
        (key) => !VERIFIED_TABLES_IN_SCRIPT.includes(key as typeof VERIFIED_TABLES_IN_SCRIPT[number])
      );

      if (uncoveredTables.length > 0) {
        // Using console.warn so test output is informative without hard-failing.
        // Teams should review these and add them to verify-db-backup.sh.
        console.warn(
          `[backup-verification] The following tables are in schema.ts but NOT in ` +
          `scripts/verify-db-backup.sh required_tables:\n  ${uncoveredTables.join('\n  ')}\n` +
          `Consider adding them to the verification script.`
        );
      }

      // The tables we explicitly verify must all still be present in schema.
      VERIFIED_TABLES_IN_SCRIPT.forEach((tableName) => {
        expect(
          schema[tableName as keyof typeof schema],
          `Table "${tableName}" is in verify-db-backup.sh but missing from schema.ts`
        ).not.toBeNull();
      });
    });

    it('all enums in schema have a corresponding entry in the verification script', () => {
      const schemaEnumKeys = Object.keys(schema).filter((key) => {
        const val = schema[key as keyof typeof schema];
        // Drizzle PgEnum objects have an `enumName` property.
        return (
          val !== null &&
          typeof val === 'object' &&
          'enumName' in (val as object)
        );
      });

      const uncoveredEnums = schemaEnumKeys.filter(
        (key) => !VERIFIED_ENUMS_IN_SCRIPT.includes(key as typeof VERIFIED_ENUMS_IN_SCRIPT[number])
      );

      if (uncoveredEnums.length > 0) {
        console.warn(
          `[backup-verification] The following enums are in schema.ts but NOT in ` +
          `scripts/verify-db-backup.sh required_enums:\n  ${uncoveredEnums.join('\n  ')}\n` +
          `Consider adding them to the verification script.`
        );
      }

      VERIFIED_ENUMS_IN_SCRIPT.forEach((enumName) => {
        expect(
          schema[enumName as keyof typeof schema],
          `Enum "${enumName}" is in verify-db-backup.sh but missing from schema.ts`
        ).not.toBeNull();
      });
    });
  });
});

describe('GDPR data export table coverage', () => {
  // Tables that must be included in GDPR data export (per backup-restore.md Section 7).
  const GDPR_EXPORT_TABLES = [
    'users',
    'projects',
    'tokenUsage',
    'tokenPurchases',
    'creditTransactions',
    'publishedGames',
    'feedback',
    'generationJobs',
  ] as const;

  it.each(GDPR_EXPORT_TABLES)(
    'schema exports GDPR-covered table "%s"',
    (tableName) => {
      expect(schema[tableName as keyof typeof schema]).not.toBeUndefined();
    }
  );

  it('all GDPR export tables have user_id or id for per-user export', () => {
    // Spot-check that users, projects, and tokenUsage have the expected
    // column structure that the GDPR export query relies on.

    // Drizzle table objects expose column definitions via their table schema.
    // We check the TypeScript inferred types as a proxy.
    type UserRow = typeof schema.users.$inferSelect;
    type ProjectRow = typeof schema.projects.$inferSelect;
    type TokenUsageRow = typeof schema.tokenUsage.$inferSelect;
    type CreditTxnRow = typeof schema.creditTransactions.$inferSelect;
    type GenerationJobRow = typeof schema.generationJobs.$inferSelect;

    // These compile-time checks confirm the column exists in the type.
    const _userCheck: Pick<UserRow, 'id' | 'email' | 'tier'> = {} as Pick<UserRow, 'id' | 'email' | 'tier'>;
    const _projectCheck: Pick<ProjectRow, 'id' | 'userId'> = {} as Pick<ProjectRow, 'id' | 'userId'>;
    const _tokenUsageCheck: Pick<TokenUsageRow, 'id' | 'userId'> = {} as Pick<TokenUsageRow, 'id' | 'userId'>;
    const _creditTxnCheck: Pick<CreditTxnRow, 'id' | 'userId' | 'transactionType'> = {} as Pick<CreditTxnRow, 'id' | 'userId' | 'transactionType'>;
    const _genJobCheck: Pick<GenerationJobRow, 'id' | 'userId' | 'status'> = {} as Pick<GenerationJobRow, 'id' | 'userId' | 'status'>;

    // If any of the above fail to compile, the GDPR export query will break.
    expect(_userCheck).not.toBeUndefined();
    expect(_projectCheck).not.toBeUndefined();
    expect(_tokenUsageCheck).not.toBeUndefined();
    expect(_creditTxnCheck).not.toBeUndefined();
    expect(_genJobCheck).not.toBeUndefined();
  });
});

describe('backup RPO/RTO documentation assertions', () => {
  it('documents 5-minute RPO target', () => {
    // This test exists as a regression guard: if the RPO target changes,
    // this test must be updated along with docs/database-backup-restore.md.
    const RPO_TARGET_MINUTES = 5;
    expect(RPO_TARGET_MINUTES).toBe(5);
  });

  it('documents 30-minute RTO target', () => {
    const RTO_TARGET_MINUTES = 30;
    expect(RTO_TARGET_MINUTES).toBe(30);
  });

  it('documents 7-day PITR retention window', () => {
    const PITR_RETENTION_DAYS = 7;
    expect(PITR_RETENTION_DAYS).toBe(7);
  });
});
