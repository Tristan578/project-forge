import { describe, it, expect } from 'vitest';

import { assertPushAllowed, PUSH_CONFIRM_FLAG } from '../assert-push-allowed';

/**
 * `drizzle-kit push` and `drizzle-kit migrate` are mutually exclusive ownership
 * models. Push diffs `schema.ts` straight onto the database and writes no
 * journal; migrate applies recorded migrations in order. A database that is
 * migrate-managed must never be pushed — doing so silently desynchronises the
 * schema from the migration history, which is #9969: production carried whatever
 * `schema.ts` looked like at the last successful push, four migrations' worth of
 * tables, columns and indexes absent, and no journal to reveal it.
 *
 * The journal is the signal. Its presence means "migrations own this database".
 */
describe('assertPushAllowed', () => {
  it('allows a push when the database has no journal (push-managed or fresh)', () => {
    expect(() => assertPushAllowed({ journalRowCount: null, confirmed: false })).not.toThrow();
  });

  it('allows a push when the journal exists but is empty', () => {
    // An empty journal table with no rows means no migration has been recorded,
    // so nothing is being desynchronised yet.
    expect(() => assertPushAllowed({ journalRowCount: 0, confirmed: false })).not.toThrow();
  });

  it('REFUSES a push when the database is migrate-managed', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: false })).toThrow(
      /migrate-managed/i,
    );
  });

  it('names the override flag in the refusal, so the message is actionable', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: false })).toThrow(
      new RegExp(PUSH_CONFIRM_FLAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('allows a deliberate override when the confirm flag is passed', () => {
    expect(() => assertPushAllowed({ journalRowCount: 13, confirmed: true })).not.toThrow();
  });

  it('refuses on a single recorded migration, not just a full journal', () => {
    // Boundary: the guard must trip at the FIRST recorded migration. A check
    // written as `> 1`, or one comparing against the repo's migration count,
    // would let a partially-migrated database be pushed over.
    expect(() => assertPushAllowed({ journalRowCount: 1, confirmed: false })).toThrow();
  });
});
