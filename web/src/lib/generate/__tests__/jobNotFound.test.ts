import { describe, it, expect } from 'vitest';
import { JOB_NOT_FOUND_MESSAGE } from '../jobNotFound';
import { RETRY_GUIDANCE } from '../retryGuidance';

/**
 * The status routes' 404 (#10262) is shown to the person verbatim by
 * `useGenerationPolling.failJob`, so it must follow the status-route
 * convention: name what happened AND what to do about it, and never be a
 * machine code the poller's `statusErrorText` would refuse to surface.
 */
describe('JOB_NOT_FOUND_MESSAGE', () => {
  it('names the condition for the person, not the developer', () => {
    expect(JOB_NOT_FOUND_MESSAGE).toMatch(/not found/i);
    expect(JOB_NOT_FOUND_MESSAGE).toMatch(/your account/i);
    // The old string, verbatim: terse, developer-facing, no next step.
    expect(JOB_NOT_FOUND_MESSAGE).not.toBe('Job not found');
  });

  it('carries the shared next-step suffix from retryGuidance', () => {
    expect(JOB_NOT_FOUND_MESSAGE.endsWith(`. ${RETRY_GUIDANCE}`)).toBe(true);
    // Sentence, then guidance — not guidance alone.
    expect(JOB_NOT_FOUND_MESSAGE.length).toBeGreaterThan(RETRY_GUIDANCE.length + 2);
  });

  it('is not a machine code (the poller never shows those)', () => {
    // Mirrors `MACHINE_CODE` in useGenerationPolling.ts: an all-caps
    // underscore token like TIER_REQUIRED is dropped by statusErrorText, so a
    // code here would leave the person with the bare timeout fallback.
    expect(JOB_NOT_FOUND_MESSAGE).not.toMatch(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
  });
});
