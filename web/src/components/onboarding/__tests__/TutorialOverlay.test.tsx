/**
 * Render tests for TutorialOverlay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TutorialOverlay } from '../TutorialOverlay';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/data/tutorials', () => ({
  TUTORIALS: [
    {
      id: 'basic-editor',
      title: 'Basic Editor',
      steps: [
        {
          id: 'step-1',
          title: 'Welcome to SpawnForge',
          description: 'This is your scene editor where you create games.',
          target: null,
          targetPosition: 'bottom',
        },
        {
          id: 'step-2',
          title: 'Add Objects',
          description: 'Use the toolbar to add objects to your scene.',
          target: null,
          targetPosition: 'bottom',
        },
      ],
    },
  ],
}));

vi.mock('lucide-react', () => ({
  ArrowRight: (props: Record<string, unknown>) => <span data-testid="arrow-right-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}));

function setupStore(activeTutorial: string | null, tutorialStep = 0) {
  const mockAdvanceTutorial = vi.fn();
  const mockCompleteTutorial = vi.fn();
  const mockSkipTutorial = vi.fn();

  // The component uses selector functions: useOnboardingStore((s) => s.field)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
    const state = {
      activeTutorial,
      tutorialStep,
      advanceTutorial: mockAdvanceTutorial,
      completeTutorial: mockCompleteTutorial,
      skipTutorial: mockSkipTutorial,
    };
    return selector(state);
  });

  return { mockAdvanceTutorial, mockCompleteTutorial, mockSkipTutorial };
}

describe('TutorialOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when no active tutorial', () => {
    setupStore(null);
    const { container } = render(<TutorialOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders current step title', () => {
    setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    expect(screen.getByText('Welcome to SpawnForge')).not.toBeNull();
  });

  it('renders current step description', () => {
    setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    expect(screen.getByText('This is your scene editor where you create games.')).not.toBeNull();
  });

  it('renders step counter', () => {
    setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    expect(screen.getByText('Step 1 of 2')).not.toBeNull();
  });

  it('renders Next button on non-last step', () => {
    setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    expect(screen.getByText('Next')).not.toBeNull();
  });

  it('renders Complete button on last step', () => {
    setupStore('basic-editor', 1);
    render(<TutorialOverlay />);
    expect(screen.getByText('Complete')).not.toBeNull();
  });

  it('renders Skip Tutorial button', () => {
    setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    expect(screen.getByText('Skip Tutorial')).not.toBeNull();
  });

  it('calls advanceTutorial when Next clicked on non-last step', () => {
    const { mockAdvanceTutorial } = setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Next'));
    expect(mockAdvanceTutorial).toHaveBeenCalled();
  });

  it('calls completeTutorial when Complete clicked on last step', () => {
    const { mockCompleteTutorial } = setupStore('basic-editor', 1);
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Complete'));
    expect(mockCompleteTutorial).toHaveBeenCalled();
  });

  it('calls skipTutorial when Skip Tutorial clicked', () => {
    const { mockSkipTutorial } = setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Skip Tutorial'));
    expect(mockSkipTutorial).toHaveBeenCalled();
  });

  it('calls skipTutorial when X button clicked', () => {
    const { mockSkipTutorial } = setupStore('basic-editor', 0);
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockSkipTutorial).toHaveBeenCalled();
  });

  it('shows step 2 of 2 when on last step', () => {
    setupStore('basic-editor', 1);
    render(<TutorialOverlay />);
    expect(screen.getByText('Step 2 of 2')).not.toBeNull();
  });
});
