/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from '@/test/utils/componentTestUtils';
import { toast } from 'sonner';
import { QuickStartDialog } from '../QuickStartDialog';
import {
  QUICK_START_GAME_TYPES,
  QUICK_START_PROMPT_MAX,
  findQuickStartGameType,
} from '@/lib/game-creation/quickStart';
import {
  useQuickStartOwnsGate,
  _resetQuickStartGateOwner,
} from '@/components/editor/quickStartGateOwner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Wraps the real implementation so every existing test (which drives the UI
// through the real card list) is unaffected, while one test below forces a
// single call to miss and reproduce the defensive `!card` branch in
// `handleSubmit` -- a state the real UI never lets the user reach, since
// `selectedId` is only ever set from this same list via `handlePick`.
vi.mock('@/lib/game-creation/quickStart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game-creation/quickStart')>();
  return {
    ...actual,
    findQuickStartGameType: vi.fn(actual.findQuickStartGameType),
  };
});

const hoisted = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  openPanel: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.fn((selector: (s: any) => unknown) => selector(hoisted.state)),
    { getState: () => hoisted.state },
  ),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ openPanel: hoisted.openPanel }) },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// `startQuickStart` resolves true when THIS call owned the run and false
// when it was refused because one was already live (orchestratorSlice.ts).
const startQuickStart = vi.fn().mockResolvedValue(true);
const resolveGate = vi.fn();
const cancelPipeline = vi.fn();
// `play` reports whether it dispatched: false when the winnability gate
// refused or no engine is attached (gameSlice.ts, #10166).
const play = vi.fn().mockReturnValue(true);
const setEngineMode = vi.fn();
const runPipelineFromPlan = vi.fn().mockResolvedValue(undefined);

function setState(overrides: Record<string, unknown> = {}) {
  Object.keys(hoisted.state).forEach((k) => delete hoisted.state[k]);
  Object.assign(hoisted.state, {
    orchestratorStatus: 'idle',
    orchestratorError: null,
    pendingGate: null,
    projectType: '3d',
    startQuickStart,
    resolveGate,
    cancelPipeline,
    play,
    setEngineMode,
    runPipelineFromPlan,
    currentPlan: null,
    tokenEstimate: null,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  startQuickStart.mockResolvedValue(true);
  play.mockReturnValue(true);
  runPipelineFromPlan.mockResolvedValue(undefined);
  setState();
});

afterEach(() => {
  cleanup();
  // The gate-ownership store is module-level, shared with OrchestratorPanel,
  // and QuickStartDialog claims it for real (unmocked) on every mount below
  // -- reset so a leaked claim from one test can never change what the next
  // test's `useQuickStartOwnsGate()` reports.
  _resetQuickStartGateOwner();
});

/** Walks the dialog from the type cards to the prompt step. */
async function pickPlatformer() {
  // `useDialogA11y`'s open effect defers the dialog's initial focus with a
  // `requestAnimationFrame`, and re-queries the DOM for the first focusable
  // element when that callback actually fires -- not at schedule time. Left
  // undrained, the callback can still be pending once a fast synchronous test
  // has already driven `phase` to 'running', at which point it re-focuses
  // whatever is *now* first in the DOM (the Close button) instead of the
  // platformer card it originally targeted, silently overriding
  // QuickStartDialog's own `[phase]` focus effect a few lines later. Waiting
  // for that first focus to land closes the race for every test that starts
  // here, rather than papering over one assertion downstream.
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /platformer/i }),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: /platformer/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickStartDialog', () => {
  it('renders nothing when closed', () => {
    render(<QuickStartDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is an accessible modal named after the control that opens it', () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Make me a game' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('offers every game type as a real button carrying its label', () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);

    for (const card of QUICK_START_GAME_TYPES) {
      const button = screen.getByRole('button', { name: new RegExp(card.label, 'i') });
      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toContain(card.description);
    }
  });

  it('starts a quick-start run with the typed prompt and the current project type', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();

    await userEvent.type(
      screen.getByLabelText(/what happens in your platformer/i),
      'lava caves with three gems',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    expect(hoisted.openPanel).toHaveBeenCalledWith('orchestrator');
    expect(startQuickStart).toHaveBeenCalledWith(
      'Platformer: lava caves with three gems',
      '3d',
    );
  });

  it('falls back to the card placeholder when the prompt is left blank', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const card = QUICK_START_GAME_TYPES[0];
    expect(startQuickStart).toHaveBeenCalledWith(
      `${card.label}: ${card.placeholder}`,
      '3d',
    );
  });

  it('reports progress from the orchestrator in a polite live region', async () => {
    startQuickStart.mockImplementationOnce(async () => {
      hoisted.state.orchestratorStatus = 'executing';
      return true;
    });
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const region = await screen.findByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Building your game');
  });

  it('surfaces a thrown failure as an alert and a toast', async () => {
    startQuickStart.mockRejectedValueOnce(new Error('decompose route is down'));
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('decompose route is down');
    expect(toast.error).toHaveBeenCalledWith('decompose route is down');
  });

  it('surfaces a failure the store only recorded (no throw) as an alert and a toast', async () => {
    // Mirrors `runPipelineFromPlan`'s own guard clauses (orchestratorSlice.ts):
    // every real path that sets `orchestratorError` sets `orchestratorStatus:
    // 'failed'` in the same `set()` call, so the mock does both together.
    startQuickStart.mockImplementationOnce(async () => {
      hoisted.state.orchestratorStatus = 'failed';
      hoisted.state.orchestratorError = 'Not enough tokens to build this game.';
      return true;
    });
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not enough tokens to build this game.');
    expect(toast.error).toHaveBeenCalledWith('Not enough tokens to build this game.');
  });

  // PF-1215 round 2: `runPipelineFromPlan`'s `onPlanStatusChange` callback --
  // the path a normal step failure takes, e.g. `verify_all_scenes` reporting
  // an unwinnable game -- sets ONLY `orchestratorStatus: 'failed'` and never
  // touches `orchestratorError` (see the design-intent comment on
  // `OrchestratorPanel`'s `StepItem`, PF-1224: that field is reserved for a
  // genuine throw). Reading `orchestratorError` truthiness alone left this
  // case undetected: `error` stayed null, so the actions row rendered no
  // "Try again" (needs `error`) and no "Stop" (needs `runIsLive`, false for
  // 'failed') -- only "Close" was left, with no way back into the flow short
  // of closing and reopening the dialog.
  it('surfaces a normal step failure (status only, no recorded message) with a generic message and Try again', async () => {
    startQuickStart.mockImplementationOnce(async () => {
      hoisted.state.orchestratorStatus = 'failed';
      return true;
    });
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not start building your game. Please try again.');
    expect(toast.error).toHaveBeenCalledWith(
      'Could not start building your game. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows a gate the run did not auto-approve so the user is never stranded', async () => {
    const { rerender } = render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    setState({
      orchestratorStatus: 'executing',
      pendingGate: {
        id: 'gate_assets',
        label: 'Generate assets?',
        description: 'These cost tokens.',
        displayData: {},
      },
    });
    rerender(<QuickStartDialog open onClose={vi.fn()} />);

    expect(screen.getByText('Generate assets?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(resolveGate).toHaveBeenCalledWith('approved');
  });

  // PF-1215 round 2 (4/5): a second `max-h-[45vh] overflow-y-auto` wrapper
  // around the whole ApprovalGateDialog used to clip the Approve/Cancel row
  // along with the scroll body -- the outer, SMALLER bound always engaged
  // before ApprovalGateDialog's own inner max-h-[50vh] region could, so the
  // inner bound was dead code and the buttons scrolled out of view again,
  // the exact failure the inner region exists to prevent. Approve must not
  // sit inside ANY scrollable-bounded ancestor between it and the dialog.
  it('never nests the approval gate action row inside a scroll-bounded container', async () => {
    const { rerender } = render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    setState({
      orchestratorStatus: 'executing',
      pendingGate: {
        id: 'gate_assets',
        label: 'Generate assets?',
        description: 'These cost tokens.',
        displayData: {},
      },
    });
    rerender(<QuickStartDialog open onClose={vi.fn()} />);

    const approveButton = screen.getByRole('button', { name: 'Approve' });
    let node: HTMLElement | null = approveButton.parentElement;
    while (node && node !== document.body) {
      expect(node.className).not.toContain('overflow-y-auto');
      node = node.parentElement;
    }
  });

  it('reaches the submit button by keyboard from the prompt field', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();

    // Click rather than `.focus()`: user-event keeps its own record of the
    // focused element, and a programmatic focus leaves that record stale, so
    // the first `tab()` is spent resyncing instead of moving focus.
    await userEvent.click(screen.getByLabelText(/what happens in your platformer/i));
    await userEvent.tab();
    await userEvent.tab();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plan my game' }));
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<QuickStartDialog open onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('moves focus with the phase so it never drops to document.body', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);

    // pick -> describe: the card that was focused is unmounted by the transition.
    await pickPlatformer();
    expect(document.activeElement).toBe(
      screen.getByLabelText(/what happens in your platformer/i),
    );

    // describe -> pick: "Back" is unmounted with the prompt step.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', {
        name: new RegExp(QUICK_START_GAME_TYPES[0].label, 'i'),
      }),
    );
  });

  it('focuses the live region when the build view replaces the prompt', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));
    const status = await screen.findByRole('status');
    expect(document.activeElement).toBe(status);
  });

  it('caps the prompt so the composed prompt cannot exceed what the route accepts', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();

    const card = QUICK_START_GAME_TYPES[0];
    const field = screen.getByLabelText(
      /what happens in your platformer/i,
    ) as HTMLTextAreaElement;

    // `buildQuickStartPrompt` sends "<label>: <body>", and the route validates
    // that whole string — so the body's budget is the cap minus the prefix.
    const expectedMax = QUICK_START_PROMPT_MAX - card.label.length - 2;
    expect(field.maxLength).toBe(expectedMax);
    // Built from `expectedMax` (computed independently above), not from
    // `field.maxLength` -- the textarea's `maxLength` prop and this count
    // paragraph both read the SAME `promptMax` local in QuickStartDialog, so
    // deriving the search text from the DOM value it is meant to help verify
    // would make this assertion pass even if `promptMax`'s own computation
    // were wrong, as long as both usages stayed in lockstep with each other
    // (PF-1215 round 2, 4/5).
    expect(screen.getByText(`0 / ${expectedMax}`)).toBeTruthy();
  });

  it('says why nothing started when the slice refuses a second run', async () => {
    startQuickStart.mockResolvedValueOnce(false);
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A build is already running');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('A build is already running'),
    );
    // Back on the prompt, not on a build view for a run that never started.
    expect(screen.getByLabelText(/what happens in your platformer/i)).toBeTruthy();
  });

  it('resumes the running view when reopened during a live run', () => {
    setState({ orchestratorStatus: 'executing' });
    render(<QuickStartDialog open onClose={vi.fn()} />);

    // Reopening must not put "Plan my game" back in front of a user whose second
    // run the slice would refuse.
    expect(screen.queryByRole('button', { name: /platformer/i })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Building your game');
  });

  // PF-1215 round 2 (4/5): the `useEffect` that claims the shared gate store
  // while this dialog is open (so ApprovalGateDialog is never rendered twice
  // -- once here, once in OrchestratorPanel) had no test anywhere pointed at
  // it; `claimQuickStartGate()` ran unmocked on every mount above but nothing
  // ever read the store back. Reads it through the real, unmocked hook (not
  // a spy on the claim/release functions) so this proves the actual shared
  // state transitions, not just that a function got called.
  it('claims the shared gate-ownership store while open and releases it on close and unmount', () => {
    const owner = renderHook(() => useQuickStartOwnsGate());
    expect(owner.result.current).toBe(false);

    const { rerender, unmount } = render(<QuickStartDialog open onClose={vi.fn()} />);
    expect(owner.result.current).toBe(true);

    rerender(<QuickStartDialog open={false} onClose={vi.fn()} />);
    expect(owner.result.current).toBe(false);

    rerender(<QuickStartDialog open onClose={vi.fn()} />);
    expect(owner.result.current).toBe(true);

    unmount();
    expect(owner.result.current).toBe(false);

    owner.unmount();
  });

  it('stops the live run and closes when Stop is pressed', async () => {
    const onClose = vi.fn();
    setState({ orchestratorStatus: 'executing' });
    render(<QuickStartDialog open onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(cancelPipeline).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers no Stop once the run is over, so a finished run is not re-cancelled', async () => {
    startQuickStart.mockImplementationOnce(async () => {
      hoisted.state.orchestratorStatus = 'completed';
      return true;
    });
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    expect((await screen.findByRole('status')).textContent).toContain('ready');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('returns to the prompt on Try again and clears the failure', async () => {
    startQuickStart.mockRejectedValueOnce(new Error('decompose route is down'));
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText(/what happens in your platformer/i)).toBeTruthy();
  });

  it('lands focus on Approve when a gate appears and rejects it on Cancel', async () => {
    const { rerender } = render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    setState({
      orchestratorStatus: 'executing',
      pendingGate: {
        id: 'gate_assets',
        label: 'Generate assets?',
        description: 'These cost tokens.',
        displayData: {},
      },
    });
    rerender(<QuickStartDialog open onClose={vi.fn()} />);

    const approve = screen.getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(document.activeElement).toBe(approve));

    // Cancel is the next stop, so the whole gate is reachable by keyboard.
    await userEvent.tab();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);

    await userEvent.click(cancel);
    expect(resolveGate).toHaveBeenCalledWith('rejected');
  });

  // #6831, owner decision "confirm cost first": the describe step's "Plan my
  // game" only DESIGNS the game (startQuickStart stops at 'awaiting_approval').
  // The plan and its token estimate are shown here, and the build's tokens are
  // reserved only when the user presses "Build it" on this review.
  describe('plan review before any build spend (#6831)', () => {
    const PLAN_GATE = {
      id: 'gate_plan',
      label: 'Review your game plan',
      description: 'Check the scenes, entities, and systems before building starts.',
      afterStepId: 'step_0',
      status: 'pending',
      displayData: {
        sceneSummaries: [{ name: 'Jungle Canopy', entityCount: 7, systemDescriptions: [] }],
      },
    };
    const PLAN = { approvalGates: [PLAN_GATE] };
    const ESTIMATE = {
      totalEstimated: 340,
      totalVarianceLow: 300,
      totalVarianceHigh: 400,
      breakdown: [
        { category: 'Asset generation', estimatedTokens: 300 },
        { category: 'Scripts', estimatedTokens: 40 },
      ],
      sufficientBalance: true,
    };

    /** Walks to the review: the design finished and left a plan on the store. */
    async function reachPlanReview(
      overrides: Record<string, unknown> = {},
      onClose: () => void = vi.fn(),
    ) {
      startQuickStart.mockImplementationOnce(async () => {
        Object.assign(hoisted.state, {
          orchestratorStatus: 'awaiting_approval',
          currentPlan: PLAN,
          tokenEstimate: ESTIMATE,
          ...overrides,
        });
        return true;
      });
      const utils = render(<QuickStartDialog open onClose={onClose} />);
      await pickPlatformer();
      await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));
      await screen.findByRole('button', { name: 'Build it' });
      return utils;
    }

    it('shows the plan and its cost, and has run nothing yet', async () => {
      await reachPlanReview();

      expect(screen.getByRole('heading', { name: 'Review your game plan' })).toBeTruthy();
      expect(screen.getByText('Jungle Canopy')).toBeTruthy();
      expect(screen.getByText('Estimated token cost')).toBeTruthy();
      expect(screen.getByText('340')).toBeTruthy();
      expect(screen.getByText('Asset generation')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('Your game plan is ready');
      expect(runPipelineFromPlan).not.toHaveBeenCalled();
      // The review's own Cancel is the way out; a second "Stop" beside it
      // would be two controls for one action.
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });

    it('puts focus on "Build it" so the confirmation is one keypress away', async () => {
      await reachPlanReview();
      const build = screen.getByRole('button', { name: 'Build it' });
      await waitFor(() => expect(document.activeElement).toBe(build));
    });

    it('runs the plan only when the user presses "Build it"', async () => {
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
      expect(runPipelineFromPlan).toHaveBeenCalledTimes(1);
    });

    it('starts one build however fast "Build it" is pressed twice', async () => {
      let finish!: () => void;
      runPipelineFromPlan.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await reachPlanReview();
      const build = screen.getByRole('button', { name: 'Build it' });

      fireEvent.click(build);
      fireEvent.click(build);

      expect(runPipelineFromPlan).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(build).toHaveProperty('disabled', true));
      finish();
    });

    it('drops the plan and closes on "Discard plan"', async () => {
      const onClose = vi.fn();
      await reachPlanReview({}, onClose);

      await userEvent.click(screen.getByRole('button', { name: 'Discard plan' }));

      expect(cancelPipeline).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(runPipelineFromPlan).not.toHaveBeenCalled();
    });

    it('surfaces a build that fails after confirmation, with Try again', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'failed';
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('Could not start building your game. Please try again.');
      expect(toast.error).toHaveBeenCalledWith(
        'Could not start building your game. Please try again.',
      );
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });

    it('surfaces the failure message the store recorded', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'failed';
        hoisted.state.orchestratorError = 'Engine not loaded';
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Engine not loaded');
    });

    it('surfaces a thrown failure', async () => {
      runPipelineFromPlan.mockRejectedValueOnce(new Error('pipeline import failed'));
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
      expect((await screen.findByRole('alert')).textContent).toContain('pipeline import failed');
    });

    // "Build it" reserves the build's tokens, and the server's answer is the
    // real balance check; `sufficientBalance` reads a cached client balance.
    // The warning is shown and the build is not blocked on it (the panel's
    // Start Building agrees). A refused reservation surfaces as an error.
    it('shows a low-balance warning without blocking the build on a cached balance', async () => {
      await reachPlanReview({ tokenEstimate: { ...ESTIMATE, sufficientBalance: false } });

      expect(screen.getByText(/may cost more than your token balance/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Build it' })).toHaveProperty('disabled', false);
    });

    it('still offers "Build it" for a plan that carries no gate_plan', async () => {
      await reachPlanReview({ currentPlan: { approvalGates: [] } });

      expect(screen.getByRole('heading', { name: 'Review your game plan' })).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
      expect(runPipelineFromPlan).toHaveBeenCalledTimes(1);
    });

    // "Close", Escape and the backdrop all keep the plan: nothing has been
    // reserved yet, the design is already paid for, and reopening the dialog
    // returns to this review. "Discard plan" is the way to drop it.
    it.each([
      ['the footer Close button', () => userEvent.click(screen.getByRole('button', { name: 'Close' }))],
      ['Escape', () => userEvent.keyboard('{Escape}')],
    ])('keeps the plan when the review is dismissed with %s', async (_how, dismiss) => {
      const onClose = vi.fn();
      await reachPlanReview({}, onClose);

      await dismiss();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(cancelPipeline).not.toHaveBeenCalled();
      expect(runPipelineFromPlan).not.toHaveBeenCalled();
    });

    it('returns to the review when reopened with the plan still waiting', () => {
      setState({ orchestratorStatus: 'awaiting_approval', currentPlan: PLAN, tokenEstimate: ESTIMATE });
      render(<QuickStartDialog open onClose={vi.fn()} />);

      expect(screen.getByRole('heading', { name: 'Review your game plan' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Build it' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /platformer/i })).toBeNull();
    });

    it('says the build is starting, not "review it", while Build it is in flight', async () => {
      let finish!: () => void;
      runPipelineFromPlan.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await reachPlanReview();

      fireEvent.click(screen.getByRole('button', { name: 'Build it' }));

      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Starting the build'));
      expect(screen.queryByText(/only when you press Build it/)).toBeNull();
      finish();
    });

    // "Build it" unmounts with the review once the run moves to 'executing'.
    // Without a hand-off, focus falls to document.body inside the modal.
    it('hands focus to the status line when the review goes away after Build it', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'executing';
      });
      await reachPlanReview();
      const build = screen.getByRole('button', { name: 'Build it' });
      await waitFor(() => expect(document.activeElement).toBe(build));

      await userEvent.click(build);

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Build it' })).toBeNull());
      expect(document.activeElement).toBe(screen.getByRole('status'));
    });

    it('shows a mid-run gate, not the plan review, when a gate is pending', async () => {
      setState({
        orchestratorStatus: 'awaiting_approval',
        currentPlan: PLAN,
        tokenEstimate: ESTIMATE,
        pendingGate: {
          id: 'gate_assets',
          label: 'Generate assets?',
          description: 'These cost tokens.',
          displayData: {},
        },
      });
      render(<QuickStartDialog open onClose={vi.fn()} />);

      expect(screen.getByText('Generate assets?')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Build it' })).toBeNull();
    });
  });

  describe('Play now (#10166)', () => {
    /** Builds through to the running view with the orchestrator in `status`. */
    async function buildToStatus(status: string, onClose = vi.fn()) {
      startQuickStart.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = status;
        return true;
      });
      render(<QuickStartDialog open onClose={onClose} />);
      await pickPlatformer();
      await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));
      await screen.findByRole('status');
      return onClose;
    }

    it('offers Play now once the build completes, and focuses it', async () => {
      await buildToStatus('completed');

      const playNow = screen.getByTestId('quick-start-play-now');
      expect(playNow.textContent).toContain('Play now');
      await waitFor(() => expect(document.activeElement).toBe(playNow));
    });

    it.each(['executing', 'failed', 'cancelled'])(
      'offers no Play now while the status is %s',
      async (status) => {
        await buildToStatus(status);
        expect(screen.queryByTestId('quick-start-play-now')).toBeNull();
      },
    );

    it('plays once and closes when play() reports it dispatched', async () => {
      const onClose = await buildToStatus('completed');
      play.mockReturnValueOnce(true);

      await userEvent.click(screen.getByTestId('quick-start-play-now'));

      expect(play).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      // engineMode follows ENGINE_MODE_CHANGED from the engine, never a guess
      // made here right after play().
      expect(setEngineMode).not.toHaveBeenCalled();
    });

    it('closes without an alert of its own when play() was refused: the chat overlay explains', async () => {
      const onClose = await buildToStatus('completed');
      play.mockReturnValueOnce(false);

      await userEvent.click(screen.getByTestId('quick-start-play-now'));

      expect(play).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(setEngineMode).not.toHaveBeenCalled();
    });
  });

  // The real UI can never leave `selectedId` pointing at a card that isn't in
  // `QUICK_START_GAME_TYPES` -- `handlePick` only ever sets it from that same
  // list. This forces the one lookup miss `handleSubmit` defends against.
  it('refuses to submit and returns to pick when the selected card cannot be found', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();

    vi.mocked(findQuickStartGameType).mockReturnValueOnce(null);
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Pick a game type first.');
    expect(startQuickStart).not.toHaveBeenCalled();
    expect(hoisted.openPanel).not.toHaveBeenCalled();
    // Back on the pick step, not stuck on a build view for a run that never started.
    expect(
      screen.getByRole('button', { name: new RegExp(QUICK_START_GAME_TYPES[0].label, 'i') }),
    ).toBeTruthy();
  });
});
