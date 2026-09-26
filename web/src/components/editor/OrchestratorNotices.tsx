'use client';

/**
 * What the plan surfaces -- the quick-start plan review and OrchestratorPanel --
 * show for an orchestrator error, and how they confirm discarding a plan. One
 * module so the two cannot drift: they call the same `runPipelineFromPlan` and
 * `cancelPipeline`, and before this each mapped a message to its follow-up
 * link, and guarded Discard, its own way (#6831 review).
 */

import Link from 'next/link';
import { Button } from '@spawnforge/ui';
import {
  INSUFFICIENT_TOKENS_MESSAGE,
  RESERVATION_UNCONFIRMED_MESSAGE,
  SIGNED_OUT_MESSAGE,
} from '@/stores/slices/orchestratorSlice';
import { SETTINGS_TOKENS_HREF } from '@/lib/navigation/settingsRoutes';

/** Clerk's sign-in page (`app/sign-in`), public in `proxy.ts`. */
const SIGN_IN_HREF = '/sign-in';

/** The follow-up an orchestrator error names, as a link, or null when it names none. */
export function orchestratorErrorAction(error: string): { label: string; href: string } | null {
  if (error === INSUFFICIENT_TOKENS_MESSAGE) return { label: 'Buy tokens', href: SETTINGS_TOKENS_HREF };
  // The message tells the user to check their balance, since the hold may or
  // may not have been taken; give them the way to.
  if (error === RESERVATION_UNCONFIRMED_MESSAGE) return { label: 'Check balance', href: SETTINGS_TOKENS_HREF };
  // Building again is refused until they do, so the way to is right here.
  if (error === SIGNED_OUT_MESSAGE) return { label: 'Sign in', href: SIGN_IN_HREF };
  return null;
}

/**
 * Does this error already say the balance is short, with its own Buy tokens
 * link? Only then does the cost bar's speculative "may cost more than your
 * balance" row give way: for any other refusal (a rate limit, a lapsed
 * session) that row is the only balance warning left on screen.
 */
export function errorReportsShortBalance(error: string | null): boolean {
  return error === INSUFFICIENT_TOKENS_MESSAGE;
}

/**
 * An orchestrator error as an alert, with the follow-up link it names.
 * role="alert": a refused build changes nothing else on screen, so this is the
 * only way a screen reader learns of it. Each surface passes its own surface
 * classes.
 */
export function OrchestratorErrorNotice({ error, className }: { error: string; className?: string }) {
  const action = orchestratorErrorAction(error);
  return (
    <div role="alert" className={className}>
      {error}
      {action && (
        <>
          {' '}
          <Link href={action.href} className="underline underline-offset-2">
            {action.label}
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Shown while Discard is armed: what discarding costs, and a way back.
 * Designing a plan is metered by /api/game/decompose, so a discarded plan is
 * paid for again if the user wants it back.
 */
export function DiscardConfirmPrompt({ onKeep }: { onKeep: () => void }) {
  return (
    <div role="status" className="flex items-center justify-between gap-2 text-xs text-[var(--sf-text)]">
      <span>Discard this plan? Planning it again costs tokens.</span>
      <Button type="button" variant="outline" size="sm" onClick={onKeep}>
        Keep plan
      </Button>
    </div>
  );
}
