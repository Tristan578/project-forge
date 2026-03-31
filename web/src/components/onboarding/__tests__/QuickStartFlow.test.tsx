/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickStartFlow, shouldShowQuickStart } from '../QuickStartFlow';

// Mock editorStore
const mockLoadTemplate = vi.fn().mockResolvedValue(undefined);
const mockSetEngineMode = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      loadTemplate: mockLoadTemplate,
      setEngineMode: mockSetEngineMode,
    }),
}));

const STORAGE_KEY = 'forge-quickstart-completed';

describe('QuickStartFlow', () => {
  const onComplete = vi.fn();
  const onSkip = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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

  it('shows error message and stays on step 2 when loadTemplate fails (regression for #7126)', async () => {
    mockLoadTemplate.mockRejectedValueOnce(new Error('Template not found'));
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

    expect(screen.getByRole('alert').textContent).toContain('Template not found');
    // Must remain on step 2 — not advance to step 3
    expect(screen.getByText('Describe your game')).toBeDefined();
    expect(screen.queryByText('Your game is ready!')).toBeNull();
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
      expect(mockLoadTemplate).toHaveBeenCalledWith('shooter');
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

  it('calls setEngineMode(play) and onComplete when Play Now is clicked', async () => {
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
