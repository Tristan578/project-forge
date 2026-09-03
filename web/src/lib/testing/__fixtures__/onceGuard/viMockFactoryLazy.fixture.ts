// FIXTURE — first test must FAIL, second must PASS. Not a real test.
//
// A vi.mock FACTORY that first runs INSIDE a test: nothing imports the module
// statically, so the factory is triggered by the dynamic import below while a
// test is running. The mock it builds is still module-scoped — vitest caches
// the mocked module and hands the same instance to the next test — so the
// "created inside this test" exemption must NOT apply. A first cut of the
// guard exempted it (the factory ran while currentTestName was set).
import { it, expect, vi } from 'vitest';

vi.mock('@/lib/testing/__fixtures__/onceGuard/dep', () => ({
  helper: vi.fn(() => 'from-factory'),
  other: vi.fn(() => 0),
}));

it('arms a once-value on a lazily built factory mock without consuming it', async () => {
  const { helper } = await import('@/lib/testing/__fixtures__/onceGuard/dep');
  vi.mocked(helper).mockReturnValueOnce('armed lazily'); // <- leak
  expect(helper).toBeDefined();
});

it('the next test consumes the lazy leftover and is not blamed', async () => {
  const { helper } = await import('@/lib/testing/__fixtures__/onceGuard/dep');
  expect(helper()).toBe('armed lazily'); // the contamination, made visible
  expect(helper()).toBe('from-factory');
});
