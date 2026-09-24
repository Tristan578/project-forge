'use client';

import { useCallback, useState } from 'react';

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
 * waits.
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
  return { armed, arm, disarm };
}
