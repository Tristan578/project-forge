import { describe, it, expect } from 'vitest';
import { JOB_NOT_FOUND_MESSAGE, JOB_OWNERSHIP_UNAVAILABLE_MESSAGE } from '../jobNotFound';
import { RETRY_GUIDANCE } from '../retryGuidance';

/**
 * The status routes' ownership refusals (#10262) are shown to the person
 * verbatim by `useGenerationPolling.failJob`, so each must name what happened
 * AND what to do about it, and never be a machine code the poller's
 * `statusErrorText` would refuse to surface.
 */
const MACHINE_CODE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

describe('JOB_NOT_FOUND_MESSAGE (the terminal 404)', () => {
  it('is the sentence written for this condition', () => {
    // Pinned verbatim: the changeset quotes it, and the poller's fallback
    // imports it, so a reword is a deliberate edit to all three.
    expect(JOB_NOT_FOUND_MESSAGE).toBe(
      'We lost track of this generation, so it was stopped. Try generating it again.',
    );
  });

  it('does not suggest an account problem', () => {
    // The person who legitimately sees this is the job's OWNER (a legacy job
    // with no binding, or one whose bind write failed). "Not found for your
    // account" read like something was wrong with the account.
    expect(JOB_NOT_FOUND_MESSAGE).not.toMatch(/account/i);
    expect(JOB_NOT_FOUND_MESSAGE).not.toBe('Job not found');
  });

  it('does NOT carry the prompt-oriented retry suffix', () => {
    // RETRY_GUIDANCE says "adjust your prompt"; nothing about the prompt caused
    // this refusal, so that next step is wrong here.
    expect(JOB_NOT_FOUND_MESSAGE).not.toContain(RETRY_GUIDANCE);
    expect(JOB_NOT_FOUND_MESSAGE).not.toMatch(/prompt/i);
  });

  it('is not a machine code (the poller never shows those)', () => {
    expect(JOB_NOT_FOUND_MESSAGE).not.toMatch(MACHINE_CODE);
  });
});

describe('JOB_OWNERSHIP_UNAVAILABLE_MESSAGE (the retryable 503)', () => {
  it('says the check could not run, and gives a next step', () => {
    expect(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE).toMatch(/temporarily unavailable/i);
    expect(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE).toMatch(/Try generating it again\.$/);
  });

  it('is distinct from the 404 sentence and is not a machine code', () => {
    // The two conditions mean different things (a verdict vs. no verdict), so
    // they must not read alike.
    expect(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE).not.toBe(JOB_NOT_FOUND_MESSAGE);
    expect(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE).not.toMatch(MACHINE_CODE);
    expect(JOB_OWNERSHIP_UNAVAILABLE_MESSAGE).not.toMatch(/account/i);
  });
});
