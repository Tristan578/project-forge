import { describe, expect, it } from 'vitest';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { MigrationRecord } from '../baseline-drizzle-journal';
import {
  createStatementRecorder,
  describeMigrationFailure,
  zipMigrationStatements,
  type MigrationStatements,
} from '../apply-migrations';

/**
 * A failed migration must be NAMED (#10161).
 *
 * `drizzle-orm`'s neon-http migrator runs every pending migration's statements
 * first and records every journal row only after the whole chain applied
 * (node_modules/drizzle-orm/neon-http/migrator.js), so a failure leaves the
 * journal exactly as it was: nothing in the database says which migration was
 * being applied. The driver's error carries Postgres's message and position
 * but not the statement. What apply-migrations.ts has is drizzle's `logger`,
 * which is called with each statement's text immediately before it executes —
 * so the last logged statement is the one that failed, and the migration file
 * it came from is the migration to name.
 */

const MIGRATIONS: MigrationStatements[] = [
  {
    tag: '0000_base',
    statements: ['CREATE TABLE a (id int);', '\nCREATE INDEX a_idx ON a (id);\n'],
  },
  {
    tag: '0001_next',
    statements: ['ALTER TABLE a ADD COLUMN b text;'],
  },
];

describe('createStatementRecorder', () => {
  it('has no statement before anything was logged', () => {
    const recorder = createStatementRecorder();
    expect(recorder.lastStatement()).toBeNull();
  });

  it('remembers the MOST RECENT statement the migrator logged, not the first', () => {
    const recorder = createStatementRecorder();
    recorder.logger.logQuery('CREATE TABLE a (id int);', []);
    recorder.logger.logQuery('ALTER TABLE a ADD COLUMN b text;', []);
    expect(recorder.lastStatement()).toBe('ALTER TABLE a ADD COLUMN b text;');
  });
});

describe('describeMigrationFailure', () => {
  it('names the migration and the statement position for a statement the migrator ran', () => {
    expect(describeMigrationFailure('ALTER TABLE a ADD COLUMN b text;', MIGRATIONS)).toBe(
      'while applying migration 0001_next (statement 1 of 1)',
    );
  });

  it('matches a statement whatever whitespace the breakpoint split left around it', () => {
    // readMigrationFiles splits on `--> statement-breakpoint` and keeps the
    // surrounding newlines; drizzle logs the statement as split.
    expect(describeMigrationFailure('CREATE INDEX a_idx ON a (id);', MIGRATIONS)).toBe(
      'while applying migration 0000_base (statement 2 of 2)',
    );
    expect(describeMigrationFailure('\nCREATE INDEX a_idx ON a (id);\n', MIGRATIONS)).toBe(
      'while applying migration 0000_base (statement 2 of 2)',
    );
  });

  it('says so when no migration statement had run yet', () => {
    expect(describeMigrationFailure(null, MIGRATIONS)).toBe(
      'before any migration statement ran (preparing the drizzle journal table)',
    );
  });

  it("reports a statement outside every migration file as drizzle's own bookkeeping, quoting it", () => {
    const insert = 'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values($1, $2)';
    expect(describeMigrationFailure(insert, MIGRATIONS)).toBe(
      `outside any migration file, on drizzle's own bookkeeping statement: ${insert}`,
    );
  });

  it('truncates a long unmatched statement to 120 characters so a log line stays readable', () => {
    const long = `SELECT ${'x'.repeat(500)}`;
    const described = describeMigrationFailure(long, MIGRATIONS);
    const marker = 'bookkeeping statement: ';
    const quoted = described.slice(described.indexOf(marker) + marker.length);
    expect(quoted).toBe(`${long.slice(0, 120)} [truncated]`);
    expect(described.length).toBeLessThan(long.length);
  });
});

describe('zipMigrationStatements', () => {
  const metas: MigrationMeta[] = [
    { sql: ['CREATE TABLE a (id int);'], folderMillis: 100, hash: 'h0', bps: true },
    { sql: ['ALTER TABLE a ADD COLUMN b text;'], folderMillis: 200, hash: 'h1', bps: true },
  ];
  const records: MigrationRecord[] = [
    { tag: '0000_base', when: 100, hash: 'h0' },
    { tag: '0001_next', when: 200, hash: 'h1' },
  ];

  it("pairs drizzle's migration files with the journal's tags by position", () => {
    expect(zipMigrationStatements(metas, records)).toEqual([
      { tag: '0000_base', statements: ['CREATE TABLE a (id int);'] },
      { tag: '0001_next', statements: ['ALTER TABLE a ADD COLUMN b text;'] },
    ]);
  });

  it('refuses two readings of the journal that disagree on how many migrations there are', () => {
    expect(() => zipMigrationStatements(metas, records.slice(0, 1))).toThrow(/2 migration file\(s\).*1 journal entr/);
  });

  it('refuses a pairing whose timestamps disagree, so a tag can never name the wrong file', () => {
    const shifted: MigrationRecord[] = [records[0]!, { ...records[1]!, when: 999 }];
    expect(() => zipMigrationStatements(metas, shifted)).toThrow(/0001_next.*999.*200/);
  });
});
