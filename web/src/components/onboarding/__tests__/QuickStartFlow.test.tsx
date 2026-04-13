/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickStartFlow, shouldShowQuickStart } from '../QuickStartFlow';

// Mock editorStore
const mockStartDecomposition = vi.fn().mockResolvedValue(undefined);
const mockSetEngineMode = vi.fn();

// Mutable store state — tests can mutate this to simulate failures
const mockStoreState: Record<string, unknown> = {
  startDecomposition: mockStartDecomposition,
  setEngineMode: mockSetEngineMode,
  orchestratorStatus: 'idle',
  orchestratorError: null,
};

vi.mock('@/stores/editorStore', () => {
  const hook = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockStoreState);
  hook.getState = () => mockStoreState;
  return { useEditorStore: hook };
});

const STORAGE_KEY = 'forge-quickstart-completed';

describe('QuickStartFlow', () => {
  const onComplete = vi.fn();
  const onSkip = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Reset mock store state
    mockStoreState.orchestratorStatus = 'idle';
    mockStoreState.orchestratorError = null;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders step 1 (game type selection) on first render', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    expect(screen.getByText('What kind of game?')).toBeDefined();
    // Step progress text is split across nodes — check with regex
    expect(screen.getByText(/Step 1 of 3/)).toBeDefined();
    // All 4 game type cards
    expect(screen.getAllByText('Platformer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shooter').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Puzzle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Explorer').length).toBeGreaterThan(0);
  });

  it('advances to step 2 when a game type card is selected', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    // Click the Platformer card button
    const platformerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Platformer') && b.textContent?.includes('Jump, run'),
    );
    expect(platformerBtn).not.toBeUndefined();
    fireEvent.click(platformerBtn!);

    expect(screen.getByText('Describe your game')).toBeDefined();
    expect(screen.getByText(/Step 2 of 3/)).toBeDefined();
    expect(screen.getByLabelText('Describe your game in one sentence')).toBeDefined();
  });

  it('pre-fills the textarea with the template placeholder on type selection', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const platformerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Platformer') && b.textContent?.includes('Jump, run'),
    )!;
    fireEvent.click(platformerBtn);

    const textarea = screen.getByLabelText('Describe your game in one sentence') as HTMLTextAreaElement;
    expect(textarea.value.length).toBeGreaterThan(0);
  });

  it('shows error message and stays on step 2 when decomposition fails', async () => {
    // Simulate the real behavior: startDecomposition resolves (never rejects)
    // but sets orchestratorStatus to 'failed' in the store
    mockStartDecomposition.mockImplementationOnce(async () => {
      mockStoreState.orchestratorStatus = 'failed';
      mockStoreState.orchestratorError = 'Decomposition failed';
    });
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const shooterBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Shooter') && b.textContent?.includes('Aim, shoot'),
    )!;
    fireEvent.click(shooterBtn);

    const generateBtn = screen.getByRole('button', { name: /generate game/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    expect(screen.getByRole('alert').textContent).toContain('Decomposition failed');
    // Must remain on step 2 — not advance to step 3
    expect(screen.getByText('Describe your game')).toBeDefined();
    expect(screen.queryByText(/is ready!/)).toBeNull();
    // onComplete must NOT have been called
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('generates the game and advances to step 3 when Generate is clicked', async () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const shooterBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Shooter') && b.textContent?.includes('Aim, shoot'),
    )!;
    fireEvent.click(shooterBtn);

    const generateBtn = screen.getByRole('button', { name: /generate game/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(mockStartDecomposition).toHaveBeenCalledWith(
        expect.stringContaining('Shooter:'),
        '3d',
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Your game is ready!')).toBeDefined();
    });

    expect(screen.getByText(/Step 3 of 3/)).toBeDefined();
  });

  it('disables generate button when prompt is empty', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const puzzleBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Puzzle') && b.textContent?.includes('Think, solve'),
    )!;
    fireEvent.click(puzzleBtn);

    const textarea = screen.getByLabelText('Describe your game in one sentence') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '' } });

    const generateBtn = screen.getByRole('button', { name: /generate game/i }) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(true);
  });

  it('disables Play Now button until orchestrator status is completed', async () => {
    mockStartDecomposition.mockImplementationOnce(async () => {
      mockStoreState.orchestratorStatus = 'awaiting_approval';
    });
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const explorerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Explorer') && b.textContent?.includes('Wander, discover'),
    )!;
    fireEvent.click(explorerBtn);
    fireEvent.click(screen.getByRole('button', { name: /generate game/i }));

    await waitFor(() => screen.getByText('Your game is ready!'));

    // Play Now button should be disabled (showing "Building your game...")
    const playBtn = screen.getByText(/building your game/i).closest('button')!;
    expect(playBtn.disabled).toBe(true);
    expect(mockSetEngineMode).not.toHaveBeenCalled();
  });

  it('calls setEngineMode(play) and onComplete when Play Now is clicked', async () => {
    // Simulate full pipeline completion
    mockStartDecomposition.mockImplementationOnce(async () => {
      mockStoreState.orchestratorStatus = 'completed';
    });
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const explorerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Explorer') && b.textContent?.includes('Wander, discover'),
    )!;
    fireEvent.click(explorerBtn);
    fireEvent.click(screen.getByRole('button', { name: /generate game/i }));

    await waitFor(() => screen.getByText('Play Now'));

    fireEvent.click(screen.getByText('Play Now'));

    expect(mockSetEngineMode).toHaveBeenCalledWith('play');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('saves completed flag to localStorage after Play Now', async () => {
    mockStartDecomposition.mockImplementationOnce(async () => {
      mockStoreState.orchestratorStatus = 'completed';
    });
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const explorerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Explorer') && b.textContent?.includes('Wander, discover'),
    )!;
    fireEvent.click(explorerBtn);
    fireEvent.click(screen.getByRole('button', { name: /generate game/i }));

    await waitFor(() => screen.getByText('Play Now'));
    fireEvent.click(screen.getByText('Play Now'));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('calls onSkip and saves storage key when the X button is clicked', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    fireEvent.click(screen.getByLabelText('Skip quickstart'));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('navigates back from step 2 to step 1', () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const platformerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Platformer') && b.textContent?.includes('Jump, run'),
    )!;
    fireEvent.click(platformerBtn);
    expect(screen.getByText('Describe your game')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Go back'));
    expect(screen.getByText('What kind of game?')).toBeDefined();
  });

  it('navigates back from step 3 to step 2', async () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const puzzleBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Puzzle') && b.textContent?.includes('Think, solve'),
    )!;
    fireEvent.click(puzzleBtn);
    fireEvent.click(screen.getByRole('button', { name: /generate game/i }));

    await waitFor(() => screen.getByText('Your game is ready!'));

    fireEvent.click(screen.getByLabelText('Go back'));
    expect(screen.getByText('Describe your game')).toBeDefined();
  });

  it('"Edit first, play later" button completes without entering play mode', async () => {
    render(<QuickStartFlow onComplete={onComplete} onSkip={onSkip} />);

    const platformerBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.includes('Platformer') && b.textContent?.includes('Jump, run'),
    )!;
    fireEvent.click(platformerBtn);
    fireEvent.click(screen.getByRole('button', { name: /generate game/i }));

    await waitFor(() => screen.getByText('Edit first, play later'));
    fireEvent.click(screen.getByText('Edit first, play later'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockSetEngineMode).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });
});

describe('shouldShowQuickStart', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns true when localStorage key is not set', () => {
    expect(shouldShowQuickStart()).toBe(true);
  });

  it('returns false when localStorage key is set', () => {
    localStorage.setItem(STORAGE_KEY, '1');
    expect(shouldShowQuickStart()).toBe(false);
  });
});
