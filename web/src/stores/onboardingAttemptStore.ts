/**
 * The first-run AI attempt that OnboardingGate is waiting on (#6831).
 *
 * When a first-time user picks "Build with AI", onboarding completes only if
 * the run that attempt starts reaches `completed`; a failed, cancelled or
 * abandoned attempt brings the welcome wizard back. That wait has to outlive
 * the gate component:
 *
 * - EditorLayout renders the gate in two layout trees (desktop and compact),
 *   so crossing the responsive breakpoint unmounts one gate and mounts
 *   another mid-attempt;
 * - an in-app visit elsewhere (the review's "Buy tokens" link opens the
 *   settings page) and back remounts it too.
 *
 * Component state reset on either, stacking the wizard over the open dialog
 * and never crediting a build that then succeeded. This module store survives
 * both, because the JS module does, and it is deliberately NOT persisted: a
 * full page load drops the orchestrator run with it, so the attempt is over.
 * That includes completing a purchase, which goes through Stripe and returns
 * to the site root; keeping a plan across checkout is #10270.
 */
import { create } from 'zustand';

export interface OnboardingAttemptState {
  /** The user took the AI path and its outcome is not known yet. */
  pending: boolean;
  /**
   * The attempt's run has been observed live, so a later `completed` belongs to
   * it and not to an earlier run whose status was still showing.
   */
  runSeen: boolean;
  /**
   * The attempt's dialog has been observed open. An attempt can only have
   * ENDED once its dialog or its run was actually seen, so a parent that opens
   * the dialog a render late is not read as "closed, nothing running".
   */
  dialogSeen: boolean;
  startAttempt: () => void;
  markRunSeen: () => void;
  markDialogSeen: () => void;
  endAttempt: () => void;
}

const IDLE = { pending: false, runSeen: false, dialogSeen: false } as const;

export const useOnboardingAttemptStore = create<OnboardingAttemptState>()((set) => ({
  ...IDLE,
  startAttempt: () => set({ pending: true, runSeen: false, dialogSeen: false }),
  markRunSeen: () => set({ runSeen: true }),
  markDialogSeen: () => set({ dialogSeen: true }),
  endAttempt: () => set({ ...IDLE }),
}));
