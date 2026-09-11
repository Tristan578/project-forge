import { describe, it, expect } from 'vitest';

import {
  assertGenerateSafe,
  readSnapshotState,
  GENERATE_CONFIRM_FLAG,
} from '../assert-generate-safe';
import { join } from 'node:path';

describe('assertGenerateSafe', () => {
  it('allows generate when every journal entry has a snapshot', () => {
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 13, confirmed: false }),
    ).not.toThrow();
  });

  it('REFUSES when snapshots lag the journal', () => {
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 1, confirmed: false }),
    ).toThrow(/1 snapshot\(s\) for 13 journal entries/);
  });

  it('refuses on a single missing snapshot, not just a large gap', () => {
    // Boundary: the emitted diff is wrong as soon as ONE snapshot is behind.
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 12, confirmed: false }),
    ).toThrow();
  });

  it('names the override flag so the refusal is actionable', () => {
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 1, confirmed: false }),
    ).toThrow(new RegExp(GENERATE_CONFIRM_FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('allows a deliberate override', () => {
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 1, confirmed: true }),
    ).not.toThrow();
  });

  it('fails rather than passing vacuously when the journal reads as empty', () => {
    // An unreadable journal must not look like "nothing to check" (lesson 9).
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 0, snapshotCount: 0, confirmed: false }),
    ).toThrow(/empty/i);
  });

  it('tolerates more snapshots than entries (a squashed or extra snapshot)', () => {
    expect(() =>
      assertGenerateSafe({ journalEntryCount: 13, snapshotCount: 14, confirmed: false }),
    ).not.toThrow();
  });
});

describe('readSnapshotState (against this repository)', () => {
  it('reports the real counts, and this repo is currently INCOMPLETE', () => {
    const metaDir = join(process.cwd(), 'drizzle', 'meta');
    const { journalEntryCount, snapshotCount } = readSnapshotState(metaDir);

    // Non-vacuity: a reader that found nothing would make the guard meaningless.
    expect(journalEntryCount).toBeGreaterThan(0);

    // This is the live defect the guard exists for. When the snapshot history is
    // repaired this assertion flips, and that is the signal to delete the guard
    // and reopen the push-vs-migrate ADR's third condition.
    expect(snapshotCount).toBeLessThan(journalEntryCount);
  });
});
