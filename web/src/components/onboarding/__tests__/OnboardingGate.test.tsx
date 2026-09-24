/**
 * @vitest-environment jsdom
 */
import { Suspense, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
import {
  OnboardingGate,
  LEGACY_QUICKSTART_KEY,
  LEGACY_WELCOME_KEY,
  ONBOARDING_COMPLETED_KEY,
} from '../OnboardingGate';
import { useOnboardingAttemptStore } from '@/stores/onboardingAttemptStore';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  onboarding: {} as Record<string, unknown>,
  editor: {} as Record<string, unknown>,
}));

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(hoisted.onboarding),
  ),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(hoisted.editor),
  ),
}));

// The wizard is reduced to the two reports it makes to the gate. Its own
// behaviour (which card calls which) is pinned in OnboardingWizard.test.tsx.
vi.mock('../OnboardingWizard', () => ({
  OnboardingWizard: ({
    onComplete,
    onStartAi,
  }: {
    onComplete: () => void;
    onStartAi?: () => void;
  }) => (
    <div role="dialog" aria-label="Welcome wizard">
      <button type="button" onClick={onComplete}>
        Blank canvas
      </button>
      <button type="button" onClick={onStartAi}>
        Build with AI
      </button>
    </div>
  ),
}));

vi.mock('../../editor/WelcomeModal', () => ({
  WelcomeModal: () => <div data-testid="welcome-modal" />,
}));

const completeOnboarding = vi.fn();
const onRequestQuickStart = vi.fn();

function setStores(
  onboarding: Record<string, unknown> = {},
  editor: Record<string, unknown> = {},
) {
  Object.keys(hoisted.onboarding).forEach((k) => delete hoisted.onboarding[k]);
  Object.keys(hoisted.editor).forEach((k) => delete hoisted.editor[k]);
  Object.assign(hoisted.onboarding, {
    onboardingCompleted: false,
    isNewUser: true,
    completeOnboarding,
    ...onboarding,
  });
  Object.assign(hoisted.editor, { orchestratorStatus: 'idle', ...editor });
}

function setStatus(status: string) {
  hoisted.editor.orchestratorStatus = status;
}

function gate(quickStartOpen: boolean) {
  return (
    <Suspense fallback={null}>
      <OnboardingGate onRequestQuickStart={onRequestQuickStart} quickStartOpen={quickStartOpen} />
    </Suspense>
  );
}

/**
 * Owns the quick-start dialog's open state the way EditorLayout does: the
 * gate's `onRequestQuickStart` flips it in the same event, and the dialog's
 * own close is modelled by a button.
 */
function Harness({ layout = 'desktop' }: { layout?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Suspense fallback={null}>
        <OnboardingGate
          // A different key is a different tree: switching it remounts the
          // gate, as crossing EditorLayout's responsive breakpoint does.
          key={layout}
          onRequestQuickStart={() => {
            onRequestQuickStart();
            setOpen(true);
          }}
          quickStartOpen={open}
        />
      </Suspense>
      {open && (
        <button type="button" onClick={() => setOpen(false)}>
          Close quick start
        </button>
      )}
    </>
  );
}

function closeDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Close quick start' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setStores();
  // Module-level, so an attempt left pending by one test would leak.
  useOnboardingAttemptStore.getState().endAttempt();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Renders a first-time user's wizard and takes the AI path. */
async function startAiPath() {
  const utils = render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: 'Build with AI' }));
  expect(onRequestQuickStart).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Close quick start' })).toBeTruthy();
  return {
    ...utils,
    update: (layout = 'desktop') => utils.rerender(<Harness layout={layout} />),
  };
}

/**
 * Resolve the gate's lazy wizard before a "shows nothing" assertion. The first
 * render of a lazy component suspends into `fallback={null}`, so without this
 * such an assertion passes whether or not the gate meant to show the wizard,
 * and only passes for real when an earlier test happened to load the chunk.
 * Once resolved, `React.lazy` renders synchronously for every later render.
 */
async function primeLazyWizard() {
  const probe = render(gate(false));
  await screen.findByRole('dialog', { name: 'Welcome wizard' });
  probe.unmount();
}

function wizardShown(): boolean {
  return screen.queryByRole('dialog', { name: 'Welcome wizard' }) !== null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingGate', () => {
  describe('which first-run surface a user sees', () => {
    it('shows the wizard to a first-time user', async () => {
      render(gate(false));
      expect(await screen.findByRole('dialog', { name: 'Welcome wizard' })).toBeTruthy();
    });

    it.each([[LEGACY_QUICKSTART_KEY], [LEGACY_WELCOME_KEY]])(
      'shows nothing to a user who finished the legacy flow (%s)',
      async (key) => {
        await primeLazyWizard();
        localStorage.setItem(key, '1');
        const { container } = render(gate(false));
        expect(container.textContent).toBe('');
        expect(wizardShown()).toBe(false);
        expect(screen.queryByTestId('welcome-modal')).toBeNull();
      },
    );

    it('shows nothing once onboarding is complete, by either record', async () => {
      await primeLazyWizard();
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
      const first = render(gate(false));
      expect(first.container.textContent).toBe('');
      first.unmount();

      localStorage.clear();
      setStores({ onboardingCompleted: true });
      const second = render(gate(false));
      expect(second.container.textContent).toBe('');
    });

    it('falls back to the welcome modal for a returning user with no record', async () => {
      setStores({ isNewUser: false });
      render(gate(false));
      expect(await screen.findByTestId('welcome-modal')).toBeTruthy();
    });
  });

  describe('paths that finish on the spot', () => {
    it('completes onboarding and records it when the wizard reports completion', async () => {
      render(gate(false));
      fireEvent.click(await screen.findByRole('button', { name: 'Blank canvas' }));

      expect(completeOnboarding).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('1');
      expect(wizardShown()).toBe(false);
    });
  });

  // #6831, owner decision: a failed AI run shows the wizard again. The gate is
  // the one writer of the completed flag, and it writes it for the AI path only
  // when the run that path started reaches 'completed'.
  describe('the AI path completes onboarding only when its run succeeds (#6831)', () => {
    it('does not complete onboarding when the user picks AI', async () => {
      await startAiPath();

      expect(completeOnboarding).not.toHaveBeenCalled();
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeNull();
      // The quick-start dialog is what the user is looking at now.
      expect(wizardShown()).toBe(false);
    });

    it('completes onboarding when the run reaches completed', async () => {
      const { update } = await startAiPath();

      for (const status of ['decomposing', 'planning', 'awaiting_approval', 'executing']) {
        setStatus(status);
        update();
        expect(completeOnboarding).not.toHaveBeenCalled();
      }

      setStatus('completed');
      update();

      await waitFor(() => expect(completeOnboarding).toHaveBeenCalledTimes(1));
      expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('1');
    });

    it.each([['failed'], ['cancelled']])(
      'shows the wizard again when the run ends %s and the dialog is closed',
      async (outcome) => {
        const { update } = await startAiPath();
        setStatus('executing');
        update();
        setStatus(outcome);
        update();

        // The dialog is still open over its failure or cancellation; the
        // wizard must not stack on top of it.
        expect(wizardShown()).toBe(false);

        closeDialog();

        expect(await screen.findByRole('dialog', { name: 'Welcome wizard' })).toBeTruthy();
        expect(completeOnboarding).not.toHaveBeenCalled();
        expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeNull();
      },
    );

    it('shows the wizard again when the dialog is closed before anything started', async () => {
      await startAiPath();

      closeDialog();

      expect(await screen.findByRole('dialog', { name: 'Welcome wizard' })).toBeTruthy();
      expect(completeOnboarding).not.toHaveBeenCalled();
    });

    // The dialog can be closed while the run carries on (it says "You can keep
    // working while this runs"), and the plan review can be answered from the
    // orchestrator panel. The attempt is still in flight, so neither the
    // wizard nor a completion may happen yet.
    it('keeps the wizard away while the run is live with the dialog closed, then completes', async () => {
      const { update } = await startAiPath();
      setStatus('awaiting_approval');
      update();

      closeDialog();
      expect(wizardShown()).toBe(false);
      expect(completeOnboarding).not.toHaveBeenCalled();

      setStatus('executing');
      update();
      setStatus('completed');
      update();

      await waitFor(() => expect(completeOnboarding).toHaveBeenCalledTimes(1));
    });

    it('does not credit an earlier run: a status already completed is not success', async () => {
      setStores({}, { orchestratorStatus: 'completed' });
      await startAiPath();

      expect(completeOnboarding).not.toHaveBeenCalled();

      closeDialog();

      expect(await screen.findByRole('dialog', { name: 'Welcome wizard' })).toBeTruthy();
      expect(completeOnboarding).not.toHaveBeenCalled();
    });

    // The attempt outlives the component: EditorLayout renders the gate in two
    // layout trees, so a breakpoint change (a tablet rotating) remounts it
    // mid-attempt, and so does leaving the editor for "Buy tokens" and back.
    it('keeps waiting on the attempt when the gate remounts, and credits its success', async () => {
      const { update } = await startAiPath();
      setStatus('awaiting_approval');
      update();

      update('compact');

      expect(wizardShown()).toBe(false);
      expect(completeOnboarding).not.toHaveBeenCalled();

      setStatus('executing');
      update('compact');
      setStatus('completed');
      update('compact');

      await waitFor(() => expect(completeOnboarding).toHaveBeenCalledTimes(1));
    });

    it('completes after a failed attempt is retried from the same dialog', async () => {
      const { update } = await startAiPath();
      setStatus('decomposing');
      update();
      setStatus('failed');
      update();
      expect(completeOnboarding).not.toHaveBeenCalled();

      // "Try again" in the dialog: a new run, same dialog, same attempt.
      setStatus('decomposing');
      update();
      setStatus('completed');
      update();

      await waitFor(() => expect(completeOnboarding).toHaveBeenCalledTimes(1));
    });

    // The attempt only ENDS once its dialog or run has been seen. A parent that
    // opens the dialog a render after the click must not have the wizard
    // bounce straight back in between.
    it('waits for a dialog opened a render late instead of reading it as closed', async () => {
      const { rerender } = render(gate(false));
      fireEvent.click(await screen.findByRole('button', { name: 'Build with AI' }));

      expect(wizardShown()).toBe(false);

      rerender(gate(true));
      expect(wizardShown()).toBe(false);

      rerender(gate(false));
      expect(await screen.findByRole('dialog', { name: 'Welcome wizard' })).toBeTruthy();
      expect(completeOnboarding).not.toHaveBeenCalled();
    });
  });
});
