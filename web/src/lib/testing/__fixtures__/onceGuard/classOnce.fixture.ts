// FIXTURE — must PASS under the mock*Once guard. Not a real test.
//
// vitest 4 constructs a once-implementation with `Reflect.construct` when the
// mock is called with `new`, and supports classes there. The guard's per-call
// wrapper sits at the head of the queue in place of the class, so it must be
// construct-aware or `new mock()` throws "Class constructor cannot be invoked
// without 'new'" from inside the guard.
import { it, expect, vi } from 'vitest';

class Widget {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

function Legacy(this: { n: number }, n: number) {
  this.n = n * 2;
}

type Impl = (...args: unknown[]) => unknown;
const ctor = vi.fn<Impl>().mockName('constructibleMock');
const Ctor = ctor as unknown as new (n: number) => { n: number };

it('constructs class and function once-implementations with new', () => {
  ctor.mockImplementationOnce(Widget as unknown as Impl);
  ctor.mockImplementationOnce(Legacy as unknown as Impl);
  expect(new Ctor(7).n).toBe(7);
  expect(new Ctor(4).n).toBe(8);
});
