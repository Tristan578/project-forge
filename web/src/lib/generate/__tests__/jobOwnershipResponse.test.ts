/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { jobOwnershipRefusal } from '../jobOwnershipResponse';
import { JOB_NOT_FOUND_MESSAGE, JOB_OWNERSHIP_UNAVAILABLE_MESSAGE } from '../jobNotFound';

/**
 * The status code IS the contract with the poller (#10262): 404 is terminal
 * (refund + stop), anything else non-OK is transient (keep polling). So a
 * confirmed miss and a failed lookup must map to different codes.
 */
describe('jobOwnershipRefusal', () => {
  it("maps 'not_owner' to a terminal 404 with the not-found sentence", async () => {
    const res = jobOwnershipRefusal('not_owner');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: JOB_NOT_FOUND_MESSAGE });
  });

  it("maps 'unverifiable' to a retryable 503 with the unavailable sentence, never 404", async () => {
    const res = jobOwnershipRefusal('unverifiable');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: JOB_OWNERSHIP_UNAVAILABLE_MESSAGE });
  });
});
