// FIXTURE — first test must FAIL, second must PASS. Not a real test.
//
// A BARE automock: `vi.mock(path)` with no factory. Its functions are built by
// the mocker from @vitest/spy's createMockInstance and never pass through
// `vi.fn` — the shape a first cut of the guard was blind to, and the repo's
// most common one (86 files). The guard must fail the arming test and leave
// the consumer alone.
import { it, expect, vi } from 'vitest';
import { helper } from '@/lib/testing/__fixtures__/onceGuard/dep';

vi.mock('@/lib/testing/__fixtures__/onceGuard/dep');

it('arms a once-value on a bare automock without consuming it', () => {
  vi.mocked(helper).mockReturnValueOnce('armed on the automock'); // <- leak
  expect(vi.isMockFunction(helper)).toBe(true);
});

it('the next test consumes the automock leftover and is not blamed', () => {
  expect(helper()).toBe('armed on the automock'); // the contamination, made visible
  expect(helper()).toBeUndefined();
});
