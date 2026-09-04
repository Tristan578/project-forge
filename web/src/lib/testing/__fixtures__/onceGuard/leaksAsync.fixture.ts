// FIXTURE — every test here must FAIL under the mock*Once guard. Not a real test.
//
// The async helpers — mockResolvedValueOnce is the #9501 shape — plus the
// "only the still-armed line is named" property: the third test queues two
// values, consumes the first, and must be blamed for the second line only.
import { it, expect, vi } from 'vitest';

const shared = vi.fn().mockName('sharedAsyncMock');

it('queues mockResolvedValueOnce and never awaits it', () => {
  shared.mockResolvedValueOnce('never awaited'); // <- leak
  expect(shared).toBeDefined();
});

it('queues mockRejectedValueOnce and never awaits it', () => {
  shared.mockRejectedValueOnce(new Error('never awaited')); // <- leak
  expect(shared).toBeDefined();
});

it('queues two values and consumes only the first', async () => {
  shared.mockReturnValueOnce('consumed'); // <- consumed, not a leak
  shared.mockReturnValueOnce('armed'); // <- leak
  // The two earlier tests left their values armed ahead of ours; drain those
  // first. The guard attributed them to the tests that queued them, not to us.
  await shared();
  await (shared() as unknown as Promise<never>).catch(() => undefined);
  expect(shared()).toBe('consumed');
});
