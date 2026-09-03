// FIXTURE — must PASS under the mock*Once guard. Not a real test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

it('a mock built inside the test may leave a once-value armed', () => {
  const local = vi.fn().mockName('builtInsideTest');
  local.mockReturnValueOnce('garbage, not contamination');
  expect(local).toBeDefined();
});

describe('beforeEach-built mocks', () => {
  let perTest: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    perTest = vi.fn().mockName('builtInBeforeEach');
  });

  it('may also leave a once-value armed', () => {
    perTest.mockResolvedValueOnce('rebuilt next test anyway');
    expect(perTest).toBeDefined();
  });
});
