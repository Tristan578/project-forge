// FIXTURE — must PASS under the mock*Once guard. Not a real test.
import { it, expect, vi } from 'vitest';

const shared = vi.fn().mockName('balancedModuleMock');

it('queues two values and consumes both', () => {
  shared.mockReturnValueOnce(1).mockReturnValueOnce(2);
  expect(shared()).toBe(1);
  expect(shared()).toBe(2);
});

it('queues via mockResolvedValueOnce and awaits it', async () => {
  shared.mockResolvedValueOnce('done');
  await expect(shared()).resolves.toBe('done');
});

it('queues, then mockReset drains the queue', () => {
  shared.mockReturnValueOnce('never read');
  shared.mockReset();
  expect(shared()).toBeUndefined();
});
