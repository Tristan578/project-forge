// FIXTURE — first test must FAIL, second must PASS. Not a real test.
//
// The realistic shape from #9501: the mock comes from a vi.mock factory, one
// test arms a value the code under test never reads, and the NEXT test would
// silently consume it. The guard must fail the first test and leave the
// second alone (the second consumes what it was handed and is not to blame).
import { it, expect, vi } from 'vitest';
import { getClientIp } from '@/lib/rateLimit';

vi.mock('@/lib/rateLimit', () => ({
  getClientIp: vi.fn(() => 'default'),
}));

it('arms a once-value on the factory mock without consuming it', () => {
  vi.mocked(getClientIp).mockReturnValueOnce('armed');
  // Nothing calls getClientIp here.
  expect(true).toBe(true);
});

it('the next test consumes the leftover and is not blamed', () => {
  // The mock ignores its argument; the fixture is about the queue, not the IP.
  expect(getClientIp({} as never)).toBe('armed'); // the contamination, made visible
  expect(getClientIp({} as never)).toBe('default');
});
