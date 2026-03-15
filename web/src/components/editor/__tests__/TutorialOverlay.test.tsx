/**
 * Tests for TutorialOverlay — rendering, step navigation, skip, complete,
 * action-required disabling, bubble positioning.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TutorialOverlay } from '../TutorialOverlay';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(), { subscribe: vi.fn(() => vi.fn()) }),
}));

vi.mock('@/data/tutorials', () => ({
  TUTORIALS: [
    {
      id: 'basics',
      name: 'Getting Started',
      steps: [
        { title: 'Welcome', description: 'Welcome to SpawnForge!', target: null, targetPosition: null, actionRequired: null, autoAdvance: false },
        { title: 'Select Entity', description: 'Click an entity in the viewport.', target: '[data-testid="viewport"]', targetPosition: 'bottom', actionRequired: { type: 'select-entity', value: null }, autoAdvance: true },
        { title: 'Done', description: 'You completed the tutorial!', target: null, targetPosition: null, actionRequired: null, autoAdvance: false },
      ],
    },
  ],
}));

const mockAdvanceTutorial = vi.fn();
const mockRetreatTutorial = vi.fn();
const mockSkipTutorial = vi.fn();
const mockCompleteTutorial = vi.fn();

function setupStore(overrides: {
  activeTutorial?: string | null;
  tutorialStep?: number;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
    const state = {
      activeTutorial: 'activeTutorial' in overrides ? overrides.activeTutorial : 'basics',
      tutorialStep: overrides.tutorialStep ?? 0,
      advanceTutorial: mockAdvanceTutorial,
      retreatTutorial: mockRetreatTutorial,
      skipTutorial: mockSkipTutorial,
      completeTutorial: mockCompleteTutorial,
    };
    return selector(state);
  });
}

describe('TutorialOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No active tutorial ────────────────────────────────────────────────

  it('renders nothing when no active tutorial', () => {
    setupStore({ activeTutorial: null });
    const { container } = render(<TutorialOverlay />);
    expect(container.innerHTML).toBe('');
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders step title and description', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Welcome')).toBeDefined();
    expect(screen.getByText('Welcome to SpawnForge!')).toBeDefined();
  });

  it('renders step counter', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Step 1 of 3')).toBeDefined();
  });

  it('renders step number badge', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('1')).toBeDefined();
  });

  it('renders Next button on non-last step', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Next')).toBeDefined();
  });

  it('renders Skip Tutorial button', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Skip Tutorial')).toBeDefined();
  });

  // ── Navigation ────────────────────────────────────────────────────────

  it('advances tutorial on Next click', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Next'));
    expect(mockAdvanceTutorial).toHaveBeenCalledOnce();
  });

  it('skips tutorial on Skip click', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Skip Tutorial'));
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  it('skips tutorial on X button click', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByTitle('Skip tutorial'));
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  // ── Last step ─────────────────────────────────────────────────────────

  it('renders Complete button on last step', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Complete')).toBeDefined();
  });

  it('completes tutorial on Complete click', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Complete'));
    expect(mockCompleteTutorial).toHaveBeenCalledOnce();
  });

  it('renders last step title', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Done')).toBeDefined();
    expect(screen.getByText('Step 3 of 3')).toBeDefined();
  });

  // ── Action-required step ──────────────────────────────────────────────

  it('disables Next when action is required and not completed', () => {
    setupStore({ tutorialStep: 1 });
    render(<TutorialOverlay />);
    const nextBtn = screen.getByText('Next').closest('button');
    expect(nextBtn?.hasAttribute('disabled')).toBe(true);
  });

  it('renders action step content', () => {
    setupStore({ tutorialStep: 1 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Select Entity')).toBeDefined();
    expect(screen.getByText('Click an entity in the viewport.')).toBeDefined();
  });

  // ── Backdrop ──────────────────────────────────────────────────────────

  it('renders backdrop overlay', () => {
    setupStore();
    render(<TutorialOverlay />);
    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).not.toBeNull();
  });

  // ── Keyboard navigation ───────────────────────────────────────────────

  it('closes tutorial on Escape key', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  it('advances tutorial on ArrowRight key (no action required)', () => {
    setupStore(); // step 0 has no actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockAdvanceTutorial).toHaveBeenCalledOnce();
  });

  it('does not advance on ArrowRight when action is required', () => {
    setupStore({ tutorialStep: 1 }); // step 1 has actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockAdvanceTutorial).not.toHaveBeenCalled();
  });

  it('completes tutorial on ArrowRight at last step', () => {
    setupStore({ tutorialStep: 2 }); // last step, no actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockCompleteTutorial).toHaveBeenCalledOnce();
  });

  it('retreats tutorial on ArrowLeft key when not on first step', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(mockRetreatTutorial).toHaveBeenCalledOnce();
  });

  it('does not retreat on ArrowLeft when on first step', () => {
    setupStore({ tutorialStep: 0 });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(mockRetreatTutorial).not.toHaveBeenCalled();
  });

  it('does not respond to keyboard when no tutorial active', () => {
    setupStore({ activeTutorial: null });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockSkipTutorial).not.toHaveBeenCalled();
  });
});
