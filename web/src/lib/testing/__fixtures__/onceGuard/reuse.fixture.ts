// FIXTURE — must PASS under the mock*Once guard. Not a real test.
//
// The same function object used as a consumed once-implementation AND as the
// persistent implementation. getMockImplementation() returns the persistent
// implementation once the queue is drained, so a guard that compared function
// identity against what the user passed in would report a leak that does not
// exist. Each queued value is wrapped in a fresh closure precisely so that
// cannot happen.
import { it, expect, vi } from 'vitest';

const impl = () => 'same function';
const shared = vi.fn(impl).mockName('reusedImplMock');

it('reuses a consumed once-implementation as the persistent one', () => {
  shared.mockImplementationOnce(impl);
  expect(shared()).toBe('same function');
  shared.mockImplementation(impl);
  expect(shared()).toBe('same function');
});
