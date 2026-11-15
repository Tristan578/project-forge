/**
 * Refuse `drizzle-kit generate` when the latest migration has no snapshot (#9983).
 *
 * WHAT DRIZZLE-KIT ACTUALLY DOES
 * ------------------------------
 * `generate` diffs `schema.ts` against the **latest snapshot** in `drizzle/meta/`.
 * Only that one matters. Intermediate snapshots are history; their absence
 * changes nothing about the next migration drizzle-kit emits.
 *
 * THE ORIGINAL BUG (#9979). This repository had exactly one snapshot,
 * `0000_snapshot.json`, against 13 journal entries — so the latest was twelve
 * migrations stale. Running `generate` did not merely emit a destructive diff:
 * it reached `promptNamedWithSchemasConflict` trying to resolve phantom renames,
 * `render10` threw for want of a TTY, and **drizzle-kit still exited 0** having
 * written nothing. Silent success, no migration, same failure shape as the
 * `drizzle-kit push` this project moved off.
 *
 * WHY THIS GUARD IS NOT COUNT PARITY ANY MORE
 * -------------------------------------------
 * Its first version required one snapshot per journal entry. That was the wrong
 * property, and the repair proved it: #9983 squashed the history to a single
 * `0012_snapshot.json` describing the current schema, leaving 2 snapshots for 13
 * entries. `generate` then emitted a correct one-line diff — while the parity
 * check would still have refused. A guard that blocks a healthy repository gets
 * overridden by reflex, and then it guards nothing.
 *
 * What matters is that the LAST journal entry has a snapshot beside it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GENERATE_CONFIRM_FLAG = '--confirm=GENERATE_WITH_STALE_SNAPSHOT';

export interface GenerateGuardState {
  /** `idx` of the newest journal entry, or `null` when the journal is unreadable. */
  latestEntryIdx: number | null;
  /** Numeric prefixes of every `NNNN_snapshot.json` present. */
  snapshotIndices: number[];
  confirmed: boolean;
}

export function assertGenerateSafe(state: GenerateGuardState): void {
  const { latestEntryIdx, snapshotIndices, confirmed } = state;

  // A gate that scans nothing is not a gate (lesson 9). An unreadable or empty
  // journal must fail rather than read as "nothing to check".
  if (latestEntryIdx === null) {
    throw new Error(
      'Refusing to generate: drizzle/meta/_journal.json is empty or unreadable, ' +
        'so the snapshot state cannot be judged.',
    );
  }

  if (snapshotIndices.includes(latestEntryIdx)) return;

  if (confirmed) return;

  const newest = snapshotIndices.length
    ? String(Math.max(...snapshotIndices)).padStart(4, '0')
    : 'none';
  throw new Error(
    `Refusing to generate: the newest journal entry is ${String(latestEntryIdx).padStart(4, '0')} ` +
      `but the newest snapshot is ${newest}. drizzle-kit diffs against the LATEST ` +
      'snapshot, so it would try to re-create every object added since then — and ' +
      'on a large gap it stalls on an interactive rename prompt and exits 0 having ' +
      'written nothing (#9983). Generate a snapshot for the latest migration first. ' +
      `To override deliberately (you will be reviewing the emitted SQL by hand), ` +
      `re-run with ${GENERATE_CONFIRM_FLAG}.`,
  );
}

/** Read the on-disk state. Exported so the CLI and tests share one reader. */
export function readSnapshotState(metaDir: string): {
  latestEntryIdx: number | null;
  snapshotIndices: number[];
} {
  let latestEntryIdx: number | null = null;
  try {
    const journal = JSON.parse(
      readFileSync(join(metaDir, '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number }> };
    if (Array.isArray(journal.entries) && journal.entries.length > 0) {
      latestEntryIdx = Math.max(...journal.entries.map((e) => e.idx));
    }
  } catch {
    latestEntryIdx = null;
  }

  const snapshotIndices = readdirSync(metaDir)
    .map((f) => /^(\d+)_snapshot\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));

  return { latestEntryIdx, snapshotIndices };
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
    const { latestEntryIdx, snapshotIndices } = readSnapshotState(metaDir);
    assertGenerateSafe({
      latestEntryIdx,
      snapshotIndices,
      confirmed: process.argv.includes(GENERATE_CONFIRM_FLAG),
    });
    console.log(
      JSON.stringify({ generateGuard: 'passed', latestEntryIdx, snapshotIndices }),
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
