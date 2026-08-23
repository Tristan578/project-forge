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
import { QUICK_START_GAME_TYPES } from '@/lib/game-creation/quickStart';

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

const startQuickStart = vi.fn().mockResolvedValue(undefined);
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
  startQuickStart.mockResolvedValue(undefined);
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
    setState({ orchestratorStatus: 'executing' });
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
});
