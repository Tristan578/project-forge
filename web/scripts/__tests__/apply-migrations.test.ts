import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { MigrationRecord } from '../baseline-drizzle-journal';
import {
  causeMessages,
  createStatementRecorder,
  currentMigrationIndex,
  describeMigrationFailure,
  findApplyingMigration,
  rootCauseMessage,
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

  it('keeps every statement in the order it was logged, for locating the migration being applied', () => {
    const recorder = createStatementRecorder();
    expect(recorder.statements()).toEqual([]);
    recorder.logger.logQuery('CREATE TABLE a (id int);', []);
    recorder.logger.logQuery('ALTER TABLE a ADD COLUMN b text;', []);
    recorder.logger.logQuery('CREATE TABLE a (id int);', []);
    expect(recorder.statements()).toEqual([
      'CREATE TABLE a (id int);',
      'ALTER TABLE a ADD COLUMN b text;',
      'CREATE TABLE a (id int);',
    ]);
  });
});

// Two migrations that carry the same statement text — `CREATE EXTENSION IF NOT
// EXISTS vector;` is the realistic one: it is idempotent, so a later migration
// has every reason to repeat it. Matching on text alone cannot tell them apart.
const DUPLICATE = 'CREATE EXTENSION IF NOT EXISTS vector;';
const WITH_DUPLICATE: MigrationStatements[] = [
  { tag: '0000_base', statements: [DUPLICATE, 'CREATE TABLE a (id int);'] },
  { tag: '0001_next', statements: ['CREATE TABLE b (id int);', DUPLICATE] },
];

// What drizzle's neon-http migrator logs BEFORE the first migration statement
// (node_modules/drizzle-orm/neon-http/migrator.js): the schema, the journal
// table, and the read of the newest journal row.
const BOOKKEEPING = [
  'CREATE SCHEMA IF NOT EXISTS "drizzle"',
  '\n\t\tCREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (\n\t\t\tid SERIAL PRIMARY KEY\n\t\t)\n\t',
  'select id, hash, created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1',
];

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

  it('names the migration BEING APPLIED when the same statement text sits in an earlier one too', () => {
    // Without the index the first match wins, which is the earlier migration —
    // the wrong one when the later migration is the one that failed.
    expect(describeMigrationFailure(DUPLICATE, WITH_DUPLICATE, 1)).toBe(
      'while applying migration 0001_next (statement 2 of 2)',
    );
    expect(describeMigrationFailure(DUPLICATE, WITH_DUPLICATE, 0)).toBe(
      'while applying migration 0000_base (statement 1 of 2)',
    );
  });

  it('falls back to the first match when it was not told which migration is being applied', () => {
    expect(describeMigrationFailure(DUPLICATE, WITH_DUPLICATE)).toBe(
      'while applying migration 0000_base (statement 1 of 2)',
    );
    expect(describeMigrationFailure(DUPLICATE, WITH_DUPLICATE, null)).toBe(
      'while applying migration 0000_base (statement 1 of 2)',
    );
  });

  it('does not trust an index whose migration lacks the statement, or one out of range', () => {
    // 0001_next has no `CREATE TABLE a`; naming it would invent a location.
    expect(describeMigrationFailure('CREATE TABLE a (id int);', WITH_DUPLICATE, 1)).toBe(
      'while applying migration 0000_base (statement 2 of 2)',
    );
    expect(describeMigrationFailure(DUPLICATE, WITH_DUPLICATE, 7)).toBe(
      'while applying migration 0000_base (statement 1 of 2)',
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

describe('currentMigrationIndex', () => {
  // After its own bookkeeping, the migrator logs the PENDING migrations'
  // statements in order, so the log is a prefix of their concatenation. Aligning
  // it against that concatenation names the migration of the last statement
  // exactly — which text matching alone cannot when a statement repeats.
  it('names the migration of the last logged statement on a from-zero run, skipping the bookkeeping', () => {
    const logged = [
      ...BOOKKEEPING,
      'CREATE TABLE a (id int);',
      '\nCREATE INDEX a_idx ON a (id);\n',
      'ALTER TABLE a ADD COLUMN b text;',
    ];
    expect(currentMigrationIndex(logged, MIGRATIONS, [0, 1])).toBe(1);
    expect(currentMigrationIndex(logged.slice(0, -1), MIGRATIONS, [0, 1])).toBe(0);
  });

  it('is not fooled by a duplicate in a migration that was already applied', () => {
    // 0000 is in the journal, so only 0001 runs. The failing DUPLICATE is 0001's.
    const logged = [...BOOKKEEPING, 'CREATE TABLE b (id int);', DUPLICATE];
    expect(currentMigrationIndex(logged, WITH_DUPLICATE, [1])).toBe(1);
    // The same log read as if everything were pending lands on 0000 — which is
    // why the pending set has to come from the journal, not be assumed.
    expect(currentMigrationIndex(logged, WITH_DUPLICATE, [0, 1])).toBe(0);
  });

  it('is null before any migration statement ran', () => {
    expect(currentMigrationIndex([], MIGRATIONS, [0, 1])).toBeNull();
    expect(currentMigrationIndex(BOOKKEEPING, MIGRATIONS, [0, 1])).toBeNull();
  });

  it('is null when the LAST logged statement is not the one the alignment expected', () => {
    // A statement drizzle logged that no pending migration contains must not
    // let an earlier statement's migration stand in for it.
    expect(
      currentMigrationIndex([...BOOKKEEPING, 'CREATE TABLE a (id int);', 'SELECT 1'], MIGRATIONS, [0, 1]),
    ).toBeNull();
  });

  it('is null when nothing is pending', () => {
    expect(currentMigrationIndex([...BOOKKEEPING, 'CREATE TABLE a (id int);'], MIGRATIONS, [])).toBeNull();
  });
});

describe('findApplyingMigration', () => {
  // The migrator inserts journal rows only after EVERY statement applied, so a
  // failure leaves the journal as the migrator read it; reading it again names
  // the migrations that were pending.
  const folderMillis = [100, 200];
  const logged = [...BOOKKEEPING, 'CREATE TABLE b (id int);', DUPLICATE];

  function queryReturning(rows: unknown): { query: (text: string) => Promise<unknown>; texts: string[] } {
    const texts: string[] = [];
    return {
      texts,
      query: (text: string) => {
        texts.push(text);
        return Promise.resolve(rows);
      },
    };
  }

  it("reads the journal's newest row and treats only newer migrations as pending", async () => {
    // bigint arrives as a string over the neon HTTP driver.
    const { query, texts } = queryReturning([{ created_at: '100' }]);
    await expect(findApplyingMigration(query, logged, WITH_DUPLICATE, folderMillis)).resolves.toBe(1);
    expect(texts).toEqual([
      'select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1',
    ]);
  });

  it('treats every migration as pending when the journal is empty', async () => {
    const fromZero = [...BOOKKEEPING, DUPLICATE];
    await expect(
      findApplyingMigration(queryReturning([]).query, fromZero, WITH_DUPLICATE, folderMillis),
    ).resolves.toBe(0);
  });

  it('is null, not a throw, when the journal cannot be read: the real failure must still be the one reported', async () => {
    const failing = () => Promise.reject(new Error('connection reset'));
    await expect(findApplyingMigration(failing, logged, WITH_DUPLICATE, folderMillis)).resolves.toBeNull();
  });

  it('is null for a journal timestamp that is not a number, rather than reading it as an empty journal', async () => {
    await expect(
      findApplyingMigration(queryReturning([{ created_at: 'not-a-number' }]).query, logged, WITH_DUPLICATE, folderMillis),
    ).resolves.toBeNull();
  });
});

describe('rootCauseMessage / causeMessages', () => {
  // drizzle wraps the driver's error: DrizzleQueryError("Failed query: <sql>\nparams: ")
  // with `cause` = NeonDbError whose message is Postgres's own text. The first
  // mutation run (PR #10370, job 112542684001) printed only the wrapper, and the
  // Postgres message surfaced nowhere but the service container's log.
  const postgres = new Error('relation "table_that_does_not_exist" does not exist');
  const drizzle = new Error('Failed query: CREATE TABLE "probe" (...);\nparams: ', { cause: postgres });

  it("ends with the ROOT cause — Postgres's message — not drizzle's wrapper", () => {
    expect(rootCauseMessage(drizzle)).toBe('relation "table_that_does_not_exist" does not exist');
  });

  it('returns the message itself when there is no cause', () => {
    expect(rootCauseMessage(new Error('plain'))).toBe('plain');
  });

  it('stringifies a non-Error throwable', () => {
    expect(rootCauseMessage('a string was thrown')).toBe('a string was thrown');
    expect(rootCauseMessage(new Error('outer', { cause: 42 }))).toBe('42');
  });

  it('lists every distinct message from the outside in, deduplicated', () => {
    const wrapped = new Error('while applying migration x: relation "t" does not exist', { cause: drizzle });
    expect(causeMessages(wrapped)).toEqual([
      'while applying migration x: relation "t" does not exist',
      'Failed query: CREATE TABLE "probe" (...);\nparams: ',
      'relation "table_that_does_not_exist" does not exist',
    ]);
    const repeated = new Error('same', { cause: new Error('same', { cause: new Error('same') }) });
    expect(causeMessages(repeated)).toEqual(['same']);
  });

  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as Error & { cause: unknown }).cause = b;
    expect(causeMessages(a)).toEqual(['a', 'b']);
    expect(rootCauseMessage(a)).toBe('b');
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

// ---------------------------------------------------------------------------
// The script has to RUN as a CLI, not just import (#10161)
// ---------------------------------------------------------------------------
//
// `main()` sits behind `import.meta.url === pathToFileURL(process.argv[1]).href`
// so that importing this module from a test never executes it (#10190). The
// other side of that guard is a silent fail-open: if the comparison ever stops
// matching (a path-casing difference, a symlinked checkout, tsx changing what
// it reports as `import.meta.url`), `npm run db:migrate` exits 0 having applied
// NOTHING — a green step on the production deploy path in front of an
// unmigrated database, the failure shape #9979 replaced `drizzle-kit migrate`
// to end. Every helper above is imported through vitest and cannot see it. Only
// spawning the script the way npm does can.

const web = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const tsxCli = resolve(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');

describe('apply-migrations as npm runs it (#10161)', () => {
  it('is the script `npm run db:migrate` runs, through tsx, from the web directory', () => {
    const pkg = JSON.parse(readFileSync(resolve(web, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Fails closed: if the npm script stops running this file, the spawn below
    // would be testing something the deploy no longer runs.
    expect(pkg.scripts['db:migrate']).toMatch(/&&\s*tsx scripts\/apply-migrations\.ts\s*$/);
  });

  it('does not exit 0 having done nothing: with DATABASE_URL unset it exits 1 and names DATABASE_URL', () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync(process.execPath, [tsxCli, 'scripts/apply-migrations.ts'], {
        cwd: web,
        env,
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number | null; stdout?: string; stderr?: string };
      status = failure.status ?? -1;
      stdout = failure.stdout ?? '';
      stderr = failure.stderr ?? '';
    }
    // A guard that stopped matching exits 0 with empty output, so the exit code
    // and the message are asserted together: neither alone distinguishes "main()
    // ran and refused" from "main() never ran".
    expect({ status, stdout, stderr }).toEqual({
      status: 1,
      stdout: '',
      stderr: expect.stringContaining('DATABASE_URL is required'),
    });
    expect(stderr).toContain('::error::Migration failed');
    expect(stderr).not.toContain('Transform failed');
  }, 90_000);
});
