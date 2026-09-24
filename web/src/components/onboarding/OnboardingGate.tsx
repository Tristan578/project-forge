'use client';

/**
 * OnboardingGate — decides which first-run surface a user sees, and is the ONE
 * place that marks onboarding complete (#6831).
 *
 * Shows the OnboardingWizard for brand-new users, and falls back to the
 * WelcomeModal for users who completed the legacy quickstart/welcome flow.
 * Users with any legacy key (forge-quickstart-completed, forge-welcomed) are
 * treated as returning users and never shown the new wizard.
 *
 * WHY ONE COMPLETION WRITER. The wizard used to call `completeOnboarding()` on
 * every exit, including the moment a first-time user clicked "Build with AI" —
 * before the AI run had produced anything. A run that then failed, was
 * cancelled, or whose dialog was closed left the user permanently past
 * onboarding with nothing built (owner decision, #6831 comment of
 * 2026-09-24: the wizard must come back). The wizard now only REPORTS what the
 * user chose (`onComplete` for the paths that finish on the spot, `onStartAi`
 * for the AI path) and this gate owns the write:
 *
 * - blank / tour / template / dismiss: complete immediately, as before.
 * - AI: hide the wizard while the quick-start dialog is open or its run is
 *   live, complete ONLY when that run reaches `completed`, and show the wizard
 *   again when the dialog is closed with no live and no completed run.
 *
 * "That run" matters: `orchestratorStatus` can already read `completed` from an
 * earlier run, so completion requires having seen THIS attempt go live first.
 */

import { lazy, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore } from '@/stores/editorStore';
import { isOrchestratorRunLive } from '@/stores/slices/orchestratorSlice';
import { safeGetItem, safeSetItem } from '@/lib/storage/safeLocalStorage';

const WelcomeModal = lazy(() =>
  import('../editor/WelcomeModal').then((m) => ({ default: m.WelcomeModal })),
);
const OnboardingWizard = lazy(() =>
  import('./OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })),
);

// No-op subscribe — localStorage doesn't fire events in the same tab
const noopSubscribe = () => () => {};

export const LEGACY_QUICKSTART_KEY = 'forge-quickstart-completed';
export const LEGACY_WELCOME_KEY = 'forge-welcomed';
export const ONBOARDING_COMPLETED_KEY = 'forge-onboarding-completed';

export interface OnboardingGateProps {
  /** Opens the quick-start ("Make me a game") dialog. */
  onRequestQuickStart: () => void;
  /** Whether that dialog is currently open (owned by EditorLayout). */
  quickStartOpen: boolean;
}

export function OnboardingGate({ onRequestQuickStart, quickStartOpen }: OnboardingGateProps) {
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted);
  const isNewUser = useOnboardingStore((s) => s.isNewUser);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);
  const orchestratorStatus = useEditorStore((s) => s.orchestratorStatus);

  // Check legacy localStorage keys (old quickstart/welcome flows)
  const legacyDone = useSyncExternalStore(
    noopSubscribe,
    () => !!safeGetItem(LEGACY_QUICKSTART_KEY) || !!safeGetItem(LEGACY_WELCOME_KEY),
    () => true, // SSR: treat as done to avoid hydration mismatch
  );

  // Check if new onboarding was completed (separate from legacy)
  const onboardingDone = useSyncExternalStore(
    noopSubscribe,
    () => !!safeGetItem(ONBOARDING_COMPLETED_KEY),
    () => false,
  );

  const [wizardDismissed, setWizardDismissed] = useState(false);
  // The user took the AI path and its outcome is not known yet.
  const [aiPending, setAiPending] = useState(false);
  // THIS attempt has been observed live (decomposing / awaiting approval /
  // executing), so a later `completed` belongs to it and not to an older run.
  const [aiRunSeen, setAiRunSeen] = useState(false);

  const runLive = isOrchestratorRunLive(orchestratorStatus);
  const aiSucceeded = aiPending && aiRunSeen && orchestratorStatus === 'completed';

  // Adjusted DURING RENDER, not in an effect (same shape as QuickStartDialog's
  // open/close reset): an effect would paint the wizard back over the dialog
  // for a frame, and `set-state-in-effect` rejects the synchronous setState.
  if (aiPending && runLive && !aiRunSeen) {
    setAiRunSeen(true);
  }
  // The dialog is gone and nothing is running or finished: the attempt ended
  // without a game (never started, failed, cancelled, or closed before
  // "Build it"). Onboarding stays incomplete and the wizard comes back.
  if (aiPending && !quickStartOpen && !runLive && !aiSucceeded) {
    setAiPending(false);
    setAiRunSeen(false);
  }

  const markComplete = useCallback(() => {
    safeSetItem(ONBOARDING_COMPLETED_KEY, '1');
    completeOnboarding();
  }, [completeOnboarding]);

  // A side effect on the persisted store and localStorage, so it runs in an
  // effect, not in render. No local setState here: `completeOnboarding` flips
  // `onboardingCompleted`, which is what makes this gate render nothing.
  useEffect(() => {
    if (aiSucceeded) markComplete();
  }, [aiSucceeded, markComplete]);

  const handleWizardComplete = useCallback(() => {
    markComplete();
    setWizardDismissed(true);
  }, [markComplete]);

  const handleStartAi = useCallback(() => {
    setAiPending(true);
    setAiRunSeen(false);
    onRequestQuickStart();
  }, [onRequestQuickStart]);

  // New onboarding completed — no modals needed
  if (onboardingDone || onboardingCompleted || wizardDismissed) {
    return null;
  }

  // Legacy users who already completed the old welcome flow — no overlay needed.
  // WelcomeModal's internal useSyncExternalStore checks !forge-welcomed, so
  // rendering it here (when forge-welcomed IS set) would always be a no-op anyway.
  if (legacyDone) {
    return null;
  }

  // True first-time users (isNewUser=true in persisted Zustand store) → wizard,
  // unless their AI attempt is in progress, in which case the quick-start
  // dialog (or the running build) is what they are looking at.
  if (isNewUser) {
    if (aiPending) return null;
    return <OnboardingWizard onComplete={handleWizardComplete} onStartAi={handleStartAi} />;
  }

  // Returning users who don't have any legacy key (cleared storage after the wizard
  // or bypassed it) → WelcomeModal as the lightweight fallback welcome experience
  return <WelcomeModal />;
}
