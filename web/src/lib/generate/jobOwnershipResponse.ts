/**
 * The response a `/api/generate/<type>/status` route returns when
 * `verifyProviderJobOwner` answers anything other than `'owner'` (#10262).
 *
 * Kept OUT of `jobOwnership.ts` on purpose: every status-route test replaces
 * that module wholesale with `vi.mock`, so a mapping living there would be
 * mocked away and the tests would assert on a stub rather than on the status
 * code the route really sends.
 *
 * - `'not_owner'` -> 404 + `JOB_NOT_FOUND_MESSAGE`. A confirmed miss; the
 *   poller treats 404 as terminal and refunds immediately.
 * - `'unverifiable'` -> 503 + `JOB_OWNERSHIP_UNAVAILABLE_MESSAGE`. The lookup
 *   failed, so this is fail-closed (no key is resolved) but NOT terminal: the
 *   poller treats every non-404 failure as transient and polls again, so a DB
 *   blip or an open circuit breaker never permanently fails and refunds a
 *   correctly bound job that the provider is still finishing.
 */
import { NextResponse } from 'next/server';
import type { JobOwnership } from './jobOwnership';
import { JOB_NOT_FOUND_MESSAGE, JOB_OWNERSHIP_UNAVAILABLE_MESSAGE } from './jobNotFound';

export function jobOwnershipRefusal(ownership: Exclude<JobOwnership, 'owner'>): NextResponse {
  if (ownership === 'unverifiable') {
    return NextResponse.json({ error: JOB_OWNERSHIP_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  return NextResponse.json({ error: JOB_NOT_FOUND_MESSAGE }, { status: 404 });
}
