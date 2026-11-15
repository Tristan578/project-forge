/**
 * @vitest-environment node
 *
 * The async generation-failure path ends in a PERSISTENT toast
 * (`useGenerationPolling.failJob` -> `showPersistentError`), on the premise that
 * "a message that came from a server route is written for the user by
 * definition". That premise was half false: `Texture generation produced no
 * maps` names the condition and gives someone whose five-minute generation just
 * ended in an indefinite red banner nothing to do about it — the same register
 * as the strings that change explicitly removed from the toast channel.
 *
 * The base sentences are a synchronised catalogue (`emptyArtifactError.test.ts`
 * scans the tree to keep the submit-time and poll-time paths identical), so the
 * guidance is a SUFFIX rather than a rewording. These assert both halves of
 * that: the catalogue sentence survives verbatim, and something actionable is
 * attached.
 */
import { describe, it, expect } from 'vitest';
import { RETRY_GUIDANCE, withRetryGuidance } from '../retryGuidance';
import { EmptyArtifactError } from '../emptyArtifactError';

describe('withRetryGuidance', () => {
  it('keeps the catalogue sentence verbatim and appends a next step', () => {
    const base = new EmptyArtifactError('Texture', 'maps').message;
    const out = withRetryGuidance(base);

    // The drift guard scans for the base sentence as a literal, and the
    // submit-time path composes its own suffix onto the same base. Rewording it
    // per path is what this suffix exists to avoid.
    expect(out.startsWith(base)).toBe(true);
    expect(out).toBe('Texture generation produced no maps. Try again, or adjust your prompt.');
  });

  it('is actionable, which is the whole point — it names a verb the reader can do', () => {
    // Not `toBeDefined`: a check that cannot fail is worse than no check
    // (lessons-learned #11). This one fails if the guidance is emptied,
    // shortened to a full stop, or turned back into a bare diagnostic.
    expect(RETRY_GUIDANCE).toMatch(/^Try again, .+\.$/);
    expect(withRetryGuidance('Sprite generation failed')).toContain(RETRY_GUIDANCE);
  });

  it('does not promise a refund, because the poll-time path does not know of one', () => {
    // `failJob`'s `status: 'failed'` branch does not refund at all, and
    // `emptyArtifactResponse` passes `refunded` explicitly for the same reason.
    // Promising one that did not happen is a support ticket.
    expect(RETRY_GUIDANCE.toLowerCase()).not.toContain('refund');
  });
});
