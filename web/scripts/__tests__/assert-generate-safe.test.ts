import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  assertGenerateSafe,
  readSnapshotState,
  GENERATE_CONFIRM_FLAG,
} from '../assert-generate-safe';

describe('assertGenerateSafe', () => {
  it('allows generate when the latest journal entry has a snapshot', () => {
    // The repaired shape: history squashed to one current snapshot. Only the
    // LATEST matters, so 2 snapshots against 13 entries is healthy.
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: 12, snapshotIndices: [0, 12], confirmed: false }),
    ).not.toThrow();
  });

  it('allows a fully populated history too', () => {
    expect(() =>
      assertGenerateSafe({
        latestEntryIdx: 12,
        snapshotIndices: Array.from({ length: 13 }, (_, i) => i),
        confirmed: false,
      }),
    ).not.toThrow();
  });

  it('REFUSES when the latest entry has no snapshot', () => {
    // The #9979 state: one snapshot, twelve migrations of drift behind it.
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: 12, snapshotIndices: [0], confirmed: false }),
    ).toThrow(/newest journal entry is 0012 but the newest snapshot is 0000/);
  });

  it('refuses on a gap of ONE, not just a large gap', () => {
    // Boundary: the emitted diff is already wrong when a single migration is
    // unrepresented. A check written as "close enough" would pass this.
    expect(() =>
      assertGenerateSafe({
        latestEntryIdx: 12,
        snapshotIndices: [0, 11],
        confirmed: false,
      }),
    ).toThrow();
  });

  it('is not fooled by a snapshot NEWER than the latest entry', () => {
    // A stray 0013_snapshot.json with no matching journal entry does not make
    // entry 12 represented. Count-based logic would have accepted this.
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: 12, snapshotIndices: [0, 13], confirmed: false }),
    ).toThrow();
  });

  it('names the override flag so the refusal is actionable', () => {
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: 12, snapshotIndices: [0], confirmed: false }),
    ).toThrow(new RegExp(GENERATE_CONFIRM_FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('allows a deliberate override', () => {
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: 12, snapshotIndices: [0], confirmed: true }),
    ).not.toThrow();
  });

  it('fails rather than passing vacuously when the journal is unreadable', () => {
    expect(() =>
      assertGenerateSafe({ latestEntryIdx: null, snapshotIndices: [0, 12], confirmed: false }),
    ).toThrow(/empty or unreadable/i);
  });
});

describe('readSnapshotState (against this repository)', () => {
  it('reports the real state, and this repo is now HEALTHY', () => {
    const metaDir = join(process.cwd(), 'drizzle', 'meta');
    const { latestEntryIdx, snapshotIndices } = readSnapshotState(metaDir);

    // Non-vacuity: a reader that found nothing would make the guard meaningless.
    expect(latestEntryIdx).not.toBeNull();
    expect(snapshotIndices.length).toBeGreaterThan(0);

    // The repair's standing assertion. This is what #9983 fixed, and it is what
    // regresses if someone adds a migration without its snapshot.
    expect(snapshotIndices).toContain(latestEntryIdx);
  });
});
