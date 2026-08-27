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
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  startQuickStart.mockResolvedValue(true);
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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    expect(hoisted.openPanel).toHaveBeenCalledWith('orchestrator');
    expect(startQuickStart).toHaveBeenCalledWith(
      'Platformer: lava caves with three gems',
      '3d',
    );
  });

  it('falls back to the card placeholder when the prompt is left blank', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    const region = await screen.findByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('Building your game');
  });

  it('surfaces a thrown failure as an alert and a toast', async () => {
    startQuickStart.mockRejectedValueOnce(new Error('decompose route is down'));
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Build it' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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

    // Reopening must not put "Build it" back in front of a user whose second
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
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

    expect((await screen.findByRole('status')).textContent).toContain('ready');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('returns to the prompt on Try again and clears the failure', async () => {
    startQuickStart.mockRejectedValueOnce(new Error('decompose route is down'));
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText(/what happens in your platformer/i)).toBeTruthy();
  });

  it('lands focus on Approve when a gate appears and rejects it on Cancel', async () => {
    const { rerender } = render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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

  // The real UI can never leave `selectedId` pointing at a card that isn't in
  // `QUICK_START_GAME_TYPES` -- `handlePick` only ever sets it from that same
  // list. This forces the one lookup miss `handleSubmit` defends against.
  it('refuses to submit and returns to pick when the selected card cannot be found', async () => {
    render(<QuickStartDialog open onClose={vi.fn()} />);
    await pickPlatformer();

    vi.mocked(findQuickStartGameType).mockReturnValueOnce(null);
    await userEvent.click(screen.getByRole('button', { name: 'Build it' }));

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
