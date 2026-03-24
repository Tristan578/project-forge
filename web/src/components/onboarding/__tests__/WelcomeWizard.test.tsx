/**
 * Render tests for WelcomeWizard component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WelcomeWizard } from '../WelcomeWizard';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  GraduationCap: (props: Record<string, unknown>) => <span data-testid="graduation-icon" {...props} />,
  Sparkles: (props: Record<string, unknown>) => <span data-testid="sparkles-icon" {...props} />,
  Rocket: (props: Record<string, unknown>) => <span data-testid="rocket-icon" {...props} />,
}));

describe('WelcomeWizard', () => {
  const mockOnStartTutorial = vi.fn();
  const mockOnChooseTemplate = vi.fn();
  const mockOnSkip = vi.fn();
  const mockRecordVisit = vi.fn();

  function setupStore({ isNewUser = true } = {}) {
    vi.mocked(useOnboardingStore).mockReturnValue({
      isNewUser,
      recordVisit: mockRecordVisit,
    } as unknown as ReturnType<typeof useOnboardingStore>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when not a new user', () => {
    setupStore({ isNewUser: false });
    const { container } = render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Welcome to SpawnForge heading', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(screen.getByText('Welcome to SpawnForge!')).not.toBeNull();
  });

  it('renders Start a Tutorial option', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(screen.getByText('Start a Tutorial')).not.toBeNull();
  });

  it('renders Choose a Template option', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(screen.getByText('Choose a Template')).not.toBeNull();
  });

  it('renders Jump Right In option', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(screen.getByText('Jump Right In')).not.toBeNull();
  });

  it('calls onStartTutorial when Start a Tutorial clicked', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    fireEvent.click(screen.getByText('Start a Tutorial'));
    expect(mockOnStartTutorial).toHaveBeenCalled();
  });

  it('calls onChooseTemplate when Choose a Template clicked', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    fireEvent.click(screen.getByText('Choose a Template'));
    expect(mockOnChooseTemplate).toHaveBeenCalled();
  });

  it('calls onSkip when Jump Right In clicked', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    fireEvent.click(screen.getByText('Jump Right In'));
    expect(mockOnSkip).toHaveBeenCalled();
  });

  it('renders Don\'t show this again checkbox', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    expect(screen.getByText("Don't show this again")).not.toBeNull();
  });

  it('calls recordVisit when checkbox is checked and action taken', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    // Check the "don't show again" checkbox first
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    // Then click an action
    fireEvent.click(screen.getByText('Jump Right In'));
    expect(mockRecordVisit).toHaveBeenCalled();
  });

  it('does not call recordVisit when checkbox unchecked', () => {
    setupStore();
    render(
      <WelcomeWizard
        onStartTutorial={mockOnStartTutorial}
        onChooseTemplate={mockOnChooseTemplate}
        onSkip={mockOnSkip}
      />
    );
    fireEvent.click(screen.getByText('Jump Right In'));
    expect(mockRecordVisit).not.toHaveBeenCalled();
  });
});
