// FIXTURE — first test must FAIL, second must PASS. Not a real test.
//
// A BARE automock first materialised INSIDE a test: nothing imports the
// module statically, so the mocker builds it during the dynamic import below
// while a test is running. That is the only path where the guard's wrapper
// around the mocker's module-form `mockObject` is load-bearing — without it
// the automock would be attributed to this test and its leak never reported.
import { it, expect, vi } from 'vitest';

vi.mock('@/lib/testing/__fixtures__/onceGuard/dep');

it('arms a once-value on a lazily built bare automock without consuming it', async () => {
  const { helper } = await import('@/lib/testing/__fixtures__/onceGuard/dep');
  vi.mocked(helper).mockReturnValueOnce('armed lazily on the automock'); // <- leak
  expect(vi.isMockFunction(helper)).toBe(true);
});

it('the next test consumes the lazy automock leftover and is not blamed', async () => {
  const { helper } = await import('@/lib/testing/__fixtures__/onceGuard/dep');
  expect(helper()).toBe('armed lazily on the automock'); // the contamination, made visible
  expect(helper()).toBeUndefined();
});
