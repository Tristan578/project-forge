/**
 * Refuse `drizzle-kit generate` while the snapshot history is incomplete (#9979).
 *
 * THE TRAP THIS CLOSES
 * --------------------
 * `drizzle-kit generate` diffs `schema.ts` against the **latest snapshot** in
 * `drizzle/meta/`. This repository has 13 journal entries and, at the time of
 * writing, a single snapshot: `0000_snapshot.json`. So the next `generate` would
 * diff today's schema against the state as of `0000` and emit a migration that
 * re-creates twelve migrations' worth of tables, columns, types and indexes.
 * Applied to a database that already has them, that is destructive.
 *
 * This was harmless while `cd.yml` applied schema changes with `drizzle-kit
 * push`, because nobody needed `generate` — push diffed `schema.ts` onto the
 * database directly. Moving production to `migrate` (#9979) makes `generate` the
 * only way to author a schema change, which turns a dormant hazard into the
 * default path. Hence this guard, landing in the same change.
 *
 * The `docs/decisions/` ADR on push-vs-migrate named exactly this as one of
 * three conditions for revisiting that decision. The other two are now met; this
 * one is not, and repairing it means reconstructing snapshots from history — real,
 * separable work, tracked separately.
 *
 * WHAT "COMPLETE" MEANS: one snapshot per journal entry. drizzle-kit writes
 * `NNNN_snapshot.json` alongside each generated migration, so a healthy repo has
 * exactly as many snapshots as entries.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GENERATE_CONFIRM_FLAG = '--confirm=GENERATE_WITH_INCOMPLETE_SNAPSHOTS';

export interface GenerateGuardState {
  journalEntryCount: number;
  snapshotCount: number;
  confirmed: boolean;
}

export function assertGenerateSafe(state: GenerateGuardState): void {
  const { journalEntryCount, snapshotCount, confirmed } = state;

  // A gate that scans nothing is not a gate (lesson 9).
  if (journalEntryCount === 0) {
    throw new Error(
      'Refusing to generate: the migration journal is empty, so there is nothing ' +
        'to diff against. This almost certainly means drizzle/meta/_journal.json ' +
        'could not be read.',
    );
  }

  if (snapshotCount >= journalEntryCount) return;

  if (confirmed) return;

  throw new Error(
    `Refusing to generate: drizzle/meta/ holds ${snapshotCount} snapshot(s) for ` +
      `${journalEntryCount} journal entries. drizzle-kit diffs against the LATEST ` +
      'snapshot, so the migration it emits would re-create every object added ' +
      `since then — see #9979. Repair the snapshot history first. To override ` +
      `deliberately (you will be reviewing the emitted SQL by hand), re-run with ` +
      `${GENERATE_CONFIRM_FLAG}.`,
  );
}

/** Read the on-disk counts. Exported so the CLI and tests share one reader. */
export function readSnapshotState(metaDir: string): {
  journalEntryCount: number;
  snapshotCount: number;
} {
  const journal = JSON.parse(
    readFileSync(join(metaDir, '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const snapshotCount = readdirSync(metaDir).filter((f) =>
    /^\d+_snapshot\.json$/.test(f),
  ).length;
  return { journalEntryCount: journal.entries.length, snapshotCount };
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const metaDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'drizzle',
      'meta',
    );
    const { journalEntryCount, snapshotCount } = readSnapshotState(metaDir);
    assertGenerateSafe({
      journalEntryCount,
      snapshotCount,
      confirmed: process.argv.includes(GENERATE_CONFIRM_FLAG),
    });
    console.log(
      JSON.stringify({ generateGuard: 'passed', journalEntryCount, snapshotCount }),
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
