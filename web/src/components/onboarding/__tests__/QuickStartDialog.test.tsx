/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
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
} from '@/lib/game-creation/quickStart';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
});

/** Walks the dialog from the type cards to the prompt step. */
async function pickPlatformer() {
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
    startQuickStart.mockImplementationOnce(async () => {
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

    expect(document.activeElement).toBe(await screen.findByRole('status'));
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
    expect(field.maxLength).toBe(QUICK_START_PROMPT_MAX - card.label.length - 2);
    expect(screen.getByText(`0 / ${field.maxLength}`)).toBeTruthy();
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
});
