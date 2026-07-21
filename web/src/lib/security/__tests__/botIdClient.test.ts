import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('botid/client/core', () => ({ initBotId: vi.fn() }));

import { initBotId } from 'botid/client/core';
import { registerBotIdProtection } from '../botIdClient';

const mockInitBotId = vi.mocked(initBotId);

describe('registerBotIdProtection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers exactly the generate wildcard and billing checkout routes, POST only', () => {
    registerBotIdProtection();

    expect(mockInitBotId).toHaveBeenCalledTimes(1);
    // toEqual (not objectContaining) on purpose: the protect list is the
    // client half of the server-side checkBotIdGate contract — a route added
    // or dropped here without a matching gate change (or vice versa) either
    // 403s every real user on that route (no client classification headers)
    // or silently leaves the gate unenforced.
    expect(mockInitBotId).toHaveBeenCalledWith({
      protect: [
        { path: '/api/generate/*', method: 'POST' },
        { path: '/api/billing/checkout', method: 'POST' },
      ],
    });
  });
});
