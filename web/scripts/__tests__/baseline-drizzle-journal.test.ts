import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertMigrationMayRun,
  assertSchemaMatches,
  loadMigrationRecords,
  planBaseline,
  type MigrationRecord,
} from '../baseline-drizzle-journal';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function migrations(): MigrationRecord[] {
  return [
    { tag: '0000_base', when: 100, hash: 'hash-0' },
    { tag: '0001_next', when: 200, hash: 'hash-1' },
  ];
}

describe('Drizzle journal baseline planning (#9684)', () => {
  it('allows fresh and tracked databases through the migration preflight', () => {
    expect(assertMigrationMayRun({ applicationTableCount: 0, journalRowCount: null })).toBe(
      'fresh',
    );
    expect(assertMigrationMayRun({ applicationTableCount: 30, journalRowCount: 11 })).toBe(
      'tracked',
    );
  });

  it('blocks non-empty databases with a missing or empty migration journal', () => {
    expect(() =>
      assertMigrationMayRun({ applicationTableCount: 30, journalRowCount: null }),
    ).toThrow('Refusing to migrate a non-empty database');
    expect(() =>
      assertMigrationMayRun({ applicationTableCount: 30, journalRowCount: 0 }),
    ).toThrow('Refusing to migrate a non-empty database');
  });

  it('plans every migration when the journal is missing or empty', () => {
    expect(planBaseline(migrations(), [])).toEqual({
      missing: migrations(),
      alreadyRecorded: [],
    });
  });

  it('is idempotent when all exact migration records already exist', () => {
    expect(
      planBaseline(migrations(), [
        { created_at: 100, hash: 'hash-0' },
        { created_at: '200', hash: 'hash-1' },
      ]),
    ).toEqual({ missing: [], alreadyRecorded: migrations() });
  });

  it('rejects a hash conflict instead of claiming drifted SQL was applied', () => {
    expect(() => planBaseline(migrations(), [{ created_at: 100, hash: 'wrong' }])).toThrow(
      'Migration journal hash conflict for 0000_base',
    );
  });

  it('rejects unknown, duplicate, and malformed journal timestamps', () => {
    expect(() => planBaseline(migrations(), [{ created_at: 999, hash: 'x' }])).toThrow(
      'unknown timestamp 999',
    );
    expect(() =>
      planBaseline(migrations(), [
        { created_at: 100, hash: 'hash-0' },
        { created_at: 100, hash: 'hash-0' },
      ]),
    ).toThrow('duplicate timestamp 100');
    expect(() => planBaseline(migrations(), [{ created_at: 'not-a-number', hash: 'x' }])).toThrow(
      'invalid created_at',
    );
  });

  it('hashes the exact migration bytes using Drizzle’s SHA-256 algorithm', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'spawnforge-migrations-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'meta'));
    await writeFile(
      join(directory, 'meta', '_journal.json'),
      JSON.stringify({ entries: [{ tag: '0000_example', when: 123 }] }),
    );
    const sql = 'CREATE TABLE example (id integer);\n';
    await writeFile(join(directory, '0000_example.sql'), sql);

    await expect(loadMigrationRecords(directory)).resolves.toEqual([
      {
        tag: '0000_example',
        when: 123,
        hash: createHash('sha256').update(sql).digest('hex'),
      },
    ]);
  });

  it('rejects an established but partial schema instead of baselining it', async () => {
    const emptyCatalog = {
      query: async () => [],
    };

    await expect(assertSchemaMatches(emptyCatalog)).rejects.toThrow(
      'Schema audit failed; missing tables:',
    );
  });
});
