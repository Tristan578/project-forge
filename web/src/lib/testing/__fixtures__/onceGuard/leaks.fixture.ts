// FIXTURE — must FAIL under the mock*Once guard. Not a real test.
import { it, expect, vi } from 'vitest';

// Module-scoped: outlives every test in this file.
const shared = vi.fn().mockName('sharedModuleMock');

it('queues a once-value on the shared mock and never consumes it', () => {
  shared.mockReturnValueOnce('for-the-next-test'); // <- the leak the guard must name
  expect(shared).toBeDefined();
});
