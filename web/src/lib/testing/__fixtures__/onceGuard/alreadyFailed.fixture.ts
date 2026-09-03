// FIXTURE — first test must FAIL for its OWN reason only, second must PASS.
// Not a real test.
//
// A test that dies before reaching its consuming call leaves the once-value
// armed. The guard must not stack a second "leak" error on it — the primary
// assertion is the thing to fix, and the leak vanishes with it — and the
// next test, which drains the leftover, is not to blame.
import { it, expect, vi } from 'vitest';

const shared = vi.fn().mockName('failedTestMock');

it('fails on its own assertion after queueing a once-value', () => {
  shared.mockReturnValueOnce('never reached');
  expect(1).toBe(2); // the real failure; the consuming call below is never reached
  shared();
});

it('the next test drains the leftover of the failed test and is not blamed', () => {
  expect(shared()).toBe('never reached');
});
