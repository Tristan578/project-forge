/**
 * Render tests for OnboardingPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { OnboardingPanel } from '../OnboardingPanel';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/hooks/useProjectType', () => ({
  useProjectType: vi.fn(() => ({ projectType: '3d', is2D: false, is3D: true, canCreate: () => true })),
}));

vi.mock('@/data/tutorials', () => ({
  TUTORIALS: [
    {
      id: 'tutorial-basics',
      name: 'The Basics',
      description: 'Learn the fundamentals',
      difficulty: 'beginner',
      estimatedMinutes: 5,
    },
    {
      id: 'tutorial-physics',
      name: 'Physics 101',
      description: 'Add physics to your scene',
      difficulty: 'intermediate',
      estimatedMinutes: 10,
    },
  ],
}));

vi.mock('@/data/onboardingTasks', () => {
  const tasks = [
    { id: 'create-entity', label: 'Create an Entity', description: 'Add an object', category: 'basic' },
    { id: 'add-material', label: 'Add a Material', description: 'Color an object', category: 'basic' },
    { id: 'write-script', label: 'Write a Script', description: 'Add logic', category: 'advanced' },
  ];
  return {
    ONBOARDING_TASKS: tasks,
    getTasksForProjectType: vi.fn(() => tasks),
  };
});

vi.mock('@/data/achievements', () => ({
  ACHIEVEMENTS: [
    {
      id: 'first-entity',
      name: 'First Steps',
      description: 'Spawned your first entity',
      icon: 'Box',
      tier: 'bronze',
    },
  ],
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
    CheckCircle2: (props: Record<string, unknown>) => <span data-testid="check-circle" {...props} />,
    Circle: (props: Record<string, unknown>) => <span data-testid="circle" {...props} />,
    Lock: (props: Record<string, unknown>) => <span data-testid="lock-icon" {...props} />,
    Box: ({ className }: { className?: string }) => <span data-testid="box-icon" className={className} />,
  };
});

describe('OnboardingPanel', () => {
  const mockSetShowOnboardingPanel = vi.fn();
  const mockStartTutorial = vi.fn();

  function setupStore({
    showOnboardingPanel = true,
    tutorialCompleted = {} as Record<string, boolean>,
    basicTasks = {} as Record<string, boolean>,
    advancedTasks = {} as Record<string, boolean>,
    unlockedAchievements = [] as string[],
  } = {}) {
    vi.mocked(useOnboardingStore).mockReturnValue({
      showOnboardingPanel,
      setShowOnboardingPanel: mockSetShowOnboardingPanel,
      tutorialCompleted,
      basicTasks,
      advancedTasks,
      unlockedAchievements,
      startTutorial: mockStartTutorial,
    } as unknown as ReturnType<typeof useOnboardingStore>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when showOnboardingPanel is false', () => {
    setupStore({ showOnboardingPanel: false });
    const { container } = render(<OnboardingPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Getting Started heading', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Getting Started')).not.toBeNull();
  });

  it('renders Tutorials section heading', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Tutorials')).not.toBeNull();
  });

  it('renders tutorial names', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('The Basics')).not.toBeNull();
    expect(screen.getByText('Physics 101')).not.toBeNull();
  });

  it('renders tutorial difficulty and time', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('beginner')).not.toBeNull();
    expect(screen.getByText('5 min')).not.toBeNull();
  });

  it('calls startTutorial when tutorial button clicked', () => {
    setupStore();
    render(<OnboardingPanel />);
    fireEvent.click(screen.getByText('The Basics'));
    expect(mockStartTutorial).toHaveBeenCalledWith('tutorial-basics');
  });

  it('renders Feature Checklist section', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Feature Checklist')).not.toBeNull();
  });

  it('renders Basic Skills section with task labels', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Basic Skills')).not.toBeNull();
    expect(screen.getByText('Create an Entity')).not.toBeNull();
    expect(screen.getByText('Add a Material')).not.toBeNull();
  });

  it('renders Advanced Skills section', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Advanced Skills')).not.toBeNull();
    expect(screen.getByText('Write a Script')).not.toBeNull();
  });

  it('renders basic task progress count', () => {
    setupStore({ basicTasks: { 'create-entity': true } });
    render(<OnboardingPanel />);
    // "1 / 2" for basic tasks
    expect(screen.getByText('1 / 2')).not.toBeNull();
  });

  it('renders Achievements section heading', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('Achievements')).not.toBeNull();
  });

  it('renders achievement name', () => {
    setupStore();
    render(<OnboardingPanel />);
    expect(screen.getByText('First Steps')).not.toBeNull();
  });

  it('renders lock icon for locked achievements', () => {
    setupStore({ unlockedAchievements: [] });
    render(<OnboardingPanel />);
    expect(screen.getByTestId('lock-icon')).not.toBeNull();
  });

  it('calls setShowOnboardingPanel(false) when X clicked', () => {
    setupStore();
    render(<OnboardingPanel />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockSetShowOnboardingPanel).toHaveBeenCalledWith(false);
  });
});
