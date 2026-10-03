/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, renderHook } from '@testing-library/react';
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@/test/utils/componentTestUtils';
import { toast } from 'sonner';
import { QuickStartDialog } from '../QuickStartDialog';
import {
  INSUFFICIENT_TOKENS_MESSAGE,
  RESERVATION_UNCONFIRMED_MESSAGE,
  SIGNED_OUT_MESSAGE,
  ENGINE_NOT_READY_MESSAGE,
} from '@/stores/slices/orchestratorSlice';
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

/** A class list that makes an element a scroll container or bounds its height. */
const SCROLLER_CLASS = /(^|\s)(overflow-(y-)?(auto|scroll)|max-h-\S+)(\s|$)/;

/**
 * Asserts a gate's action button is in view at every scroll offset by
 * construction: it is in the Dialog's footer (`[data-dialog-actions]`), which
 * is outside the body's scroll, not in the body. Walking up from it to the
 * dialog panel there is no scroll container or height bound at all; the body
 * is still the ONE scroller (no second bounded scroller nested in it), and
 * nothing in the dialog is pinned (`sticky`) over the body's content. The
 * button sits in the gate's action group, named by the gate heading in the
 * body, so a screen reader still hears which gate it answers.
 */
function expectActionsInFooter(button: HTMLElement) {
  const dialog = screen.getByRole('dialog');
  expect(dialog.contains(button)).toBe(true);
  const body = dialog.querySelector('[data-dialog-body]');
  const footer = dialog.querySelector('[data-dialog-actions]');
  expect(body).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(footer?.contains(button)).toBe(true);
  expect(body?.contains(button)).toBe(false);

  let node: HTMLElement | null = button.parentElement;
  while (node && node !== dialog) {
    expect(node.getAttribute('class') ?? '', `bounded ancestor: ${node.outerHTML.slice(0, 80)}`).not.toMatch(SCROLLER_CLASS);
    node = node.parentElement;
  }
  expect(node).toBe(dialog);

  const inside = Array.from(body?.querySelectorAll('*') ?? []);
  expect(inside.length).toBeGreaterThan(0);
  const nested = inside.filter((el) => SCROLLER_CLASS.test(el.getAttribute('class') ?? ''));
  expect(nested.map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  expect(dialog.querySelectorAll('.sticky')).toHaveLength(0);

  const group = button.closest<HTMLElement>('[role="group"]');
  expect(group).not.toBeNull();
  const heading = document.getElementById(group?.getAttribute('aria-labelledby') ?? '');
  expect(heading?.tagName).toBe('H3');
  expect(body?.contains(heading as Node)).toBe(true);
  expect(group?.getAttribute('data-testid')).toBe('approval-gate-actions');
}

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

  // PF-1215 round 2 (4/5), then PR #10294: a bounded scroller nested inside
  // another lets the OUTER scroll carry the inner box's Approve/Cancel row out
  // of view on a short viewport. Round 2 removed a `max-h-[45vh]` wrapper here;
  // #10294 made the Dialog body itself a scroller, so the gate's own
  // max-h-[50vh] box became the nested one. The rule now: exactly ONE
  // scroller in the dialog -- the Dialog body -- and the gate's buttons in the
  // Dialog's footer, outside that scroll, so no scroll offset can hide them
  // (round 5: pinning them inside the body covered content and failed in
  // Firefox). jsdom has no layout, so this pins the structure; the geometry is
  // measured by e2e/tests/quick-start-plan-review-layout.spec.ts.
  it('keeps the approval gate actions reachable: one scroller (the Dialog body), actions in the footer outside it', async () => {
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
    expect(screen.getByText('Generate assets?')).toBeTruthy();
    expectActionsInFooter(approve);
    expectActionsInFooter(screen.getByRole('button', { name: 'Cancel' }));
    // The gate's summary stays in the body; "Stop" and "Close" share the footer.
    const body = screen.getByRole('dialog').querySelector('[data-dialog-body]');
    expect(body?.contains(screen.getByRole('heading', { name: 'Generate assets?' }))).toBe(true);
    const footer = screen.getByRole('dialog').querySelector('[data-dialog-actions]');
    expect(footer?.contains(screen.getByRole('button', { name: 'Stop' }))).toBe(true);
    expect(footer?.contains(screen.getByRole('button', { name: 'Close' }))).toBe(true);
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

  // The gate's buttons live in the Dialog footer, outside the running view's
  // own element. Reopening onto a pending gate changes the phase in the same
  // commit that mounts the gate, and the phase effect must count the footer
  // as "the build view already placed focus", or it pulls focus off Approve
  // onto the status line (PR #10294 round 5).
  it('keeps focus on Approve when the dialog reopens onto a pending gate', async () => {
    setState({
      orchestratorStatus: 'executing',
      pendingGate: {
        id: 'gate_assets',
        label: 'Generate assets?',
        description: 'These cost tokens.',
        displayData: {},
      },
    });
    const { rerender } = render(<QuickStartDialog open={false} onClose={vi.fn()} />);
    rerender(<QuickStartDialog open onClose={vi.fn()} />);

    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(document.activeElement).toBe(approve);
    // Still there once the Dialog's deferred initial-focus frame has run:
    // `useDialogA11y` schedules it with requestAnimationFrame at open, and
    // frame callbacks run in the order they were scheduled, so this one runs
    // after it.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(document.activeElement).toBe(approve);
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
      // Twice: in the cost bar, and in the total pinned beside "Build it".
      expect(screen.getAllByText('340')).toHaveLength(2);
      // The number that actually leaves the balance: the reservation is the
      // estimate's upper bound, refunded down to what the build uses.
      expect(screen.getByText(/tokens are held while it builds/).textContent).toContain('Up to 400 tokens');
      expect(screen.getByText('Asset generation')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('Your game plan is ready');
      expect(runPipelineFromPlan).not.toHaveBeenCalled();
      // The review's own Cancel is the way out; a second "Stop" beside it
      // would be two controls for one action.
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });

    // PR #10294: the review's buttons are in the Dialog footer, outside the
    // body's scroll, so the body can be scrolled to any offset without
    // carrying them away or sliding anything under them. The cost bar, its
    // Buy tokens link and the plan stay in the body, reachable by scrolling.
    it('puts "Build it" and "Discard plan" in the Dialog footer; the cost and its Buy tokens link stay in the body', async () => {
      await reachPlanReview({ tokenEstimate: { ...ESTIMATE, sufficientBalance: false } });
      const build = screen.getByRole('button', { name: 'Build it' });
      expectActionsInFooter(build);
      expectActionsInFooter(screen.getByRole('button', { name: 'Discard plan' }));

      const body = screen.getByRole('dialog').querySelector('[data-dialog-body]');
      // Non-vacuous: each of the tall parts is actually rendered.
      for (const node of [
        screen.getByText('Jungle Canopy'),
        screen.getByText('Estimated token cost'),
        screen.getByRole('link', { name: 'Buy tokens' }),
      ]) {
        expect(body?.contains(node), node.textContent ?? '').toBe(true);
      }
    });

    // PR #10294 round 3 (ux): "Build it" takes focus at open while the cost
    // bar can be scrolled out of view, so the total rides beside the button,
    // in the same footer group.
    it('shows the token total in the footer group beside "Build it"', async () => {
      await reachPlanReview();
      const group = screen.getByRole('group', { name: 'Review your game plan' });
      const total = screen.getByTestId('token-cost-total');
      expect(group.contains(total)).toBe(true);
      expect(group.contains(screen.getByRole('button', { name: 'Build it' }))).toBe(true);
      expect(screen.getByRole('dialog').querySelector('[data-dialog-actions]')?.contains(total)).toBe(true);
      expect(total.textContent).toBe('Cost: 340 tokens, up to 400 held');
      expect(within(total).queryByText(/balance/)).toBeNull();
    });

    it('says in the footer total when the cost may exceed the balance', async () => {
      await reachPlanReview({ tokenEstimate: { ...ESTIMATE, sufficientBalance: false } });
      const total = screen.getByTestId('token-cost-total');
      expect(screen.getByRole('group', { name: 'Review your game plan' }).contains(total)).toBe(true);
      expect(within(total).getByText('May exceed your balance')).toBeTruthy();
      expect(total.textContent).toContain('Cost: 340 tokens, up to 400 held');
    });

    // PR #10294 rounds 3-4 (ux HIGH): an armed Discard put "Discard this
    // plan?" and "Keep plan" in the body, where on a 320px-tall viewport no
    // scroll offset could show them. The question now IS the action row.
    it('asks the discard question in the action row itself, with its two answers, and nothing in the body', async () => {
      await reachPlanReview();
      const discard = screen.getByRole('button', { name: 'Discard plan' });
      await userEvent.click(discard);

      const group = screen.getByRole('group', { name: 'Review your game plan' });
      const question = within(group).getByRole('status');
      expect(question.textContent).toBe('Discard this plan? Planning it again costs tokens.');
      // The question takes the total's place, so the row does not grow.
      expect(within(group).queryByTestId('token-cost-total')).toBeNull();
      expect(Array.from(screen.getByTestId('approval-gate-action-summary').children)).toEqual([question]);
      // The two answers, and only them: no "Build it" while the question is open.
      const buttons = within(screen.getByTestId('approval-gate-buttons')).getAllByRole('button');
      expect(buttons.map((b) => b.textContent)).toEqual(['Discard it', 'Keep plan']);
      expect(screen.queryByRole('button', { name: 'Build it' })).toBeNull();
      expectActionsInFooter(buttons[0]);
      expectActionsInFooter(buttons[1]);
      // "Keep plan" is the button just pressed, and keeps focus: pressing it
      // again backs out rather than discarding.
      expect(buttons[1]).toBe(discard);
      expect(document.activeElement).toBe(discard);
      // Nothing about the question is left in the body to be scrolled away.
      const body = screen.getByRole('dialog').querySelector('[data-dialog-body]');
      expect(body?.textContent).not.toContain('Discard this plan?');
      expect(body?.querySelectorAll('button')).toHaveLength(0);
    });

    // A refused "Build it" puts its reason in the body above the cost, while
    // the button stays in the footer. On a short viewport or a long plan the
    // alert was out of view (PR #10294 round 4: 28 of 48 configurations).
    it('scrolls a refused build\'s reason into view (nearest), and not before', async () => {
      const scrollIntoView = vi.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: scrollIntoView,
      });
      try {
        // The store reports the refusal before "Build it" settles; the
        // settling render changes the Dialog's description (and so the body's
        // height), so the scroll must wait for it.
        let settle!: () => void;
        runPipelineFromPlan.mockImplementationOnce(() => {
          hoisted.state.orchestratorStatus = 'awaiting_approval';
          hoisted.state.orchestratorError = INSUFFICIENT_TOKENS_MESSAGE;
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        });
        const { rerender } = await reachPlanReview();
        expect(scrollIntoView).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
        // The mocked store does not notify; re-render as a store update would.
        rerender(<QuickStartDialog open onClose={vi.fn()} />);
        await screen.findByRole('alert');
        expect(screen.getByRole('button', { name: 'Build it' })).toBeDisabled();
        expect(scrollIntoView).not.toHaveBeenCalled();
        await act(async () => {
          settle();
        });
        expect(screen.getByRole('button', { name: 'Build it' })).not.toBeDisabled();
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
        const target = scrollIntoView.mock.contexts[0] as HTMLElement;
        expect(within(target).getByRole('alert').textContent).toContain(INSUFFICIENT_TOKENS_MESSAGE);
        // The same refusal re-rendered is not scrolled to again.
        rerender(<QuickStartDialog open onClose={vi.fn()} />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
      } finally {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
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

    // The plan cost tokens to design, so Discard asks once -- the same rule
    // as OrchestratorPanel, through the same useDiscardConfirm.
    it('asks once, then drops the plan and closes on "Discard it"', async () => {
      const onClose = vi.fn();
      await reachPlanReview({}, onClose);

      const discard = screen.getByRole('button', { name: 'Discard plan' });
      await userEvent.click(discard);

      expect(cancelPipeline).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText('Discard this plan? Planning it again costs tokens.')).toBeTruthy();
      // The pressed button turns into "Keep plan" and keeps focus, so a second
      // press backs out; discarding is the deliberate move to "Discard it".
      expect(screen.getByRole('button', { name: 'Keep plan' })).toBe(discard);
      expect(document.activeElement).toBe(discard);

      await userEvent.click(screen.getByRole('button', { name: 'Discard it' }));

      expect(cancelPipeline).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(runPipelineFromPlan).not.toHaveBeenCalled();
    });

    it('backs out of Discard with "Keep plan"', async () => {
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Discard plan' }));

      await userEvent.click(screen.getByRole('button', { name: 'Keep plan' }));

      // Focus stays on the same button, which reads "Discard plan" again; it
      // does not move to "Build it", one Enter away from spending.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard plan' }));
      expect(screen.getByRole('button', { name: 'Build it' })).toBeTruthy();
      expect(screen.queryByText(/Discard this plan\?/)).toBeNull();
      expect(cancelPipeline).not.toHaveBeenCalled();
    });

    // An armed Discard must not survive a build attempt: a refused build puts
    // the same plan back on the review, where one click would then drop it.
    // While armed there is no "Build it" at all (its place answers the
    // question), so a build can only start from an unarmed review.
    it('starts a build only from an unarmed review, so a refused build returns unarmed', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'awaiting_approval';
        hoisted.state.orchestratorError = INSUFFICIENT_TOKENS_MESSAGE;
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Discard plan' }));
      expect(screen.getByRole('button', { name: 'Discard it' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Build it' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Keep plan' }));

      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      await screen.findByText(/The build did not start/);
      expect(screen.getByRole('button', { name: 'Discard plan' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Discard it' })).toBeNull();
      expect(cancelPipeline).not.toHaveBeenCalled();
    });

    it('surfaces a build that fails after confirmation, with Try again', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        // A step ran and failed: the plan is spent, so the way on is a new one.
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

    // #6831 review: a refused build returns the plan to the review with the
    // reason on the STORE (status 'awaiting_approval', `orchestratorError`), so
    // "Build it" is right there again and nothing is re-designed. Because it is
    // store state, it also survives the dialog closing and in-app navigation
    // (not a full page load such as a Stripe checkout; see #10270).
    it('keeps the review up with the reason and a Buy tokens link when the reservation is refused', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'awaiting_approval';
        hoisted.state.orchestratorError = INSUFFICIENT_TOKENS_MESSAGE;
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(INSUFFICIENT_TOKENS_MESSAGE);
      expect(screen.getByRole('link', { name: 'Buy tokens' }).getAttribute('href')).toBe(
        '/settings?tab=tokens',
      );
      // One announcement: the alert and the status line, not also a toast.
      expect(toast.error).not.toHaveBeenCalled();
      // Says what happened, not "building" or "stopped early".
      expect(screen.getByRole('status').textContent).toContain('The build did not start');
      // Scoped to the build: designing the plan was metered.
      expect(screen.getByText(/No build tokens were taken/)).toBeTruthy();
      expect(screen.queryByText(/Nothing was spent/)).toBeNull();
      // The way on is the plan it already has, not a paid re-design.
      expect(screen.getByRole('button', { name: 'Build it' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(startQuickStart).toHaveBeenCalledTimes(1);
    });

    it('shows the refusal again when the dialog is reopened, e.g. after visiting settings', () => {
      setState({
        orchestratorStatus: 'awaiting_approval',
        orchestratorError: INSUFFICIENT_TOKENS_MESSAGE,
        currentPlan: PLAN,
        tokenEstimate: ESTIMATE,
      });

      render(<QuickStartDialog open onClose={vi.fn()} />);

      expect(screen.getByRole('heading', { name: 'Review your game plan' })).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain(INSUFFICIENT_TOKENS_MESSAGE);
      expect(screen.getByRole('button', { name: 'Build it' })).toBeTruthy();
    });

    // The cached estimate is usually short too when the server refuses for
    // balance. Its "this MAY cost more" row, with a second Buy tokens link,
    // would contradict the refusal right above it.
    it('shows one Buy tokens link, not the cost bar\'s speculative warning too, on a balance refusal', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'awaiting_approval';
        hoisted.state.orchestratorError = INSUFFICIENT_TOKENS_MESSAGE;
      });
      await reachPlanReview({ tokenEstimate: { ...ESTIMATE, sufficientBalance: false } });
      expect(screen.getByText(/may cost more than your token balance/)).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      await screen.findByText(/The build did not start/);
      expect(screen.getAllByRole('link', { name: 'Buy tokens' })).toHaveLength(1);
      expect(screen.queryByText(/may cost more than your token balance/)).toBeNull();
    });

    // Any refusal but a short balance leaves the cost bar's balance warning
    // (and its Buy tokens link) as the only one on screen, so it stays.
    it('keeps the cost bar\'s balance warning for a refusal that is not about the balance', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'awaiting_approval';
        hoisted.state.orchestratorError = SIGNED_OUT_MESSAGE;
      });
      await reachPlanReview({ tokenEstimate: { ...ESTIMATE, sufficientBalance: false } });

      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      expect((await screen.findByRole('alert')).textContent).toContain(SIGNED_OUT_MESSAGE);
      expect(screen.getByText(/may cost more than your token balance/)).toBeTruthy();
      // The alert names no link of its own; the bar's is the one.
      expect(screen.getAllByRole('link', { name: /buy tokens/i })).toHaveLength(1);
    });

    // No reply, or a 2xx the client could not read: the hold may already have
    // been taken. The dialog must not say nothing was spent.
    it('does not claim nothing was spent when the reservation outcome is unknown', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'failed';
        hoisted.state.orchestratorError = RESERVATION_UNCONFIRMED_MESSAGE;
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      expect((await screen.findByRole('alert')).textContent).toContain(RESERVATION_UNCONFIRMED_MESSAGE);
      expect(screen.queryByText(/No build tokens were taken/)).toBeNull();
      // The message says to check the balance; the way to is right there.
      expect(screen.getByRole('link', { name: 'Check balance' }).getAttribute('href')).toBe(
        '/settings?tab=tokens',
      );
      expect(screen.queryByRole('button', { name: 'Build it' })).toBeNull();
    });

    it('keeps the review up when the engine is not ready, with no Buy tokens link', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'awaiting_approval';
        hoisted.state.orchestratorError = ENGINE_NOT_READY_MESSAGE;
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

      expect((await screen.findByRole('alert')).textContent).toContain(ENGINE_NOT_READY_MESSAGE);
      expect(screen.queryByRole('link', { name: 'Buy tokens' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Build it' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('surfaces a step failure the store recorded, with Try again', async () => {
      runPipelineFromPlan.mockImplementationOnce(async () => {
        hoisted.state.orchestratorStatus = 'failed';
        hoisted.state.orchestratorError = 'The level could not be generated.';
      });
      await reachPlanReview();
      await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
      expect((await screen.findByRole('alert')).textContent).toContain('The level could not be generated.');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(screen.getByText('Nothing is running now.')).toBeTruthy();
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

    // `confirming` guards the click until the whole run settles, so it must
    // not own the status line: once the run reports 'executing', and at every
    // mid-run gate, the live region has to say so.
    it('drops "Starting the build" once the run is executing, and shows a mid-run gate\'s wait', async () => {
      let finish!: () => void;
      runPipelineFromPlan.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const { rerender } = await reachPlanReview();
      fireEvent.click(screen.getByRole('button', { name: 'Build it' }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Starting the build'));

      hoisted.state.orchestratorStatus = 'executing';
      rerender(<QuickStartDialog open onClose={vi.fn()} />);
      expect(screen.getByRole('status').textContent).toContain('Building your game');

      hoisted.state.orchestratorStatus = 'awaiting_approval';
      hoisted.state.pendingGate = {
        id: 'gate_assets',
        label: 'Generate assets?',
        description: 'These cost tokens.',
        displayData: {},
      };
      rerender(<QuickStartDialog open onClose={vi.fn()} />);
      expect(screen.getByRole('status').textContent).toContain('Waiting on your approval');
      finish();
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

    it('hands focus to the status line when an answered mid-run gate goes away', async () => {
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
      const { rerender } = render(<QuickStartDialog open onClose={vi.fn()} />);
      const approve = screen.getByRole('button', { name: 'Approve' });
      await waitFor(() => expect(document.activeElement).toBe(approve));

      hoisted.state.pendingGate = null;
      hoisted.state.orchestratorStatus = 'executing';
      rerender(<QuickStartDialog open onClose={vi.fn()} />);

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
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

  // The dialog's description must follow the run: "Building. You can keep
  // working" under a finished, failed or cancelled run misstates what is
  // happening.
  it.each([
    ['completed', 'Your game is built.'],
    ['cancelled', 'Nothing is running now.'],
    ['failed', 'Nothing is running now.'],
  ] as const)('describes a %s run without saying it is still building', async (status, copy) => {
    startQuickStart.mockImplementationOnce(async () => {
      hoisted.state.orchestratorStatus = status;
      return true;
    });
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Plan my game' }));

    expect(await screen.findByText(copy)).toBeTruthy();
    expect(screen.queryByText(/Building\. You can keep working/)).toBeNull();
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
