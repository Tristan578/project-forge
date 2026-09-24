'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Two-step Discard for a plan waiting to be built.
 *
 * Discarding throws away a plan the user paid to design, so the first press
 * arms and the second discards. The arm belongs to ONE plan at ONE review:
 * - it is keyed on the plan object, so a new plan is never shown pre-armed;
 * - leaving the review (`awaiting` goes false: a build started, from this
 *   surface or from chat, or the run was cancelled or reset) clears it;
 * - the caller clears it (`disarm`) when the user presses Build, because a
 *   refused build returns the SAME plan to the review without ever leaving it
 *   long enough to render (#6831 review).
 *
 * Both plan surfaces use this, so a plan is guarded the same way wherever it
 * waits. Attach `discardRef` to the Discard button: `keep` backs out of the
 * arm and puts focus back on it, since the Keep plan button the user pressed
 * unmounts with the prompt and focus would otherwise fall to the body.
 */
export function useDiscardConfirm(plan: object | null, awaiting: boolean) {
  const [armedFor, setArmedFor] = useState<object | null>(null);

  // Applied during render rather than in an effect, so the frame that leaves
  // the review already carries the cleared arm.
  const [prevAwaiting, setPrevAwaiting] = useState(awaiting);
  if (prevAwaiting !== awaiting) {
    setPrevAwaiting(awaiting);
    setArmedFor(null);
  }

  const armed = awaiting && plan !== null && armedFor === plan;
  const arm = useCallback(() => setArmedFor(plan), [plan]);
  const disarm = useCallback(() => setArmedFor(null), []);
  const discardRef = useRef<HTMLButtonElement>(null);
  const keep = useCallback(() => {
    setArmedFor(null);
    // The Discard button stays mounted (only its label changes), so it can
    // take focus now, before the prompt holding the pressed button goes away.
    discardRef.current?.focus();
  }, []);
  return { armed, arm, disarm, keep, discardRef };
}
