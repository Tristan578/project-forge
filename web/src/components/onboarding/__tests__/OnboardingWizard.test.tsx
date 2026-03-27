/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';

// ---- Mock stores ----

const mockSelectPath = vi.fn();
const mockCompleteOnboarding = vi.fn();
const mockStartTutorial = vi.fn();
const mockSetRightPanelTab = vi.fn();

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectPath: mockSelectPath,
      completeOnboarding: mockCompleteOnboarding,
      startTutorial: mockStartTutorial,
    }),
}));

// By default, canUseAI returns true (non-starter tier)
let mockCanUseAI = () => true;

vi.mock('@/stores/userStore', () => ({
  useUserStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      canUseAI: mockCanUseAI,
    }),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setRightPanelTab: mockSetRightPanelTab,
    }),
}));

describe('OnboardingWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanUseAI = () => true;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  // ---- Render ----

  it('renders the wizard with "Welcome to SpawnForge" heading', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText('Welcome to SpawnForge')).toBeDefined();
  });

  it('renders all 4 path cards when AI is enabled (non-starter tier)', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText('Build with AI')).toBeDefined();
    expect(screen.getByText('Start from Template')).toBeDefined();
    expect(screen.getByText('Blank Canvas')).toBeDefined();
    expect(screen.getByText('Take a Tour')).toBeDefined();
  });

  it('renders a dialog with aria-modal and aria-labelledby attributes', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('onboarding-wizard-title');
  });

  // ---- Starter tier: AI card locked ----

  it('shows locked AI card with upgrade badge for starter tier', () => {
    mockCanUseAI = () => false;
    render(<OnboardingWizard onComplete={onComplete} />);

    // The AI card should be present but disabled
    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.getAttribute('aria-disabled')).toBe('true');
    // Shows upgrade text within the AI card
    expect(aiCard.textContent).toContain('Upgrade');
  });

  it('renders upgrade link pointing to /pricing for starter tier', () => {
    mockCanUseAI = () => false;
    render(<OnboardingWizard onComplete={onComplete} />);
    // Find the upgrade link within the AI card specifically
    const aiCard = screen.getByTestId('path-card-ai');
    const link = aiCard.querySelector('a[href="/pricing"]');
    expect(link).not.toBeNull();
  });

  it('renders non-starter AI card as a clickable button', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const aiCard = screen.getByTestId('path-card-ai');
    // When not locked it renders as a button
    expect(aiCard.tagName.toLowerCase()).toBe('button');
  });

  // ---- Path navigation ----

  it('clicking "Blank Canvas" calls selectPath, completeOnboarding, and onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-blank'));
    expect(mockSelectPath).toHaveBeenCalledWith('blank');
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('clicking "Build with AI" switches to chat tab and calls onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-ai'));
    expect(mockSelectPath).toHaveBeenCalledWith('ai');
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('chat');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('clicking "Take a Tour" starts the first-scene tutorial and calls onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-tour'));
    expect(mockSelectPath).toHaveBeenCalledWith('tour');
    expect(mockStartTutorial).toHaveBeenCalledWith('first-scene');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ---- Template path ----

  it('clicking "Start from Template" shows the inline template selector', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    expect(screen.getByText('Choose a starter template')).toBeDefined();
    // Path cards are hidden
    expect(screen.queryByText('Build with AI')).toBeNull();
  });

  it('shows 5 template cards in the template selector', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    const templates = ['platformer', 'runner', 'shooter', 'puzzle', 'explorer'];
    for (const t of templates) {
      expect(screen.getByTestId(`template-card-${t}`)).toBeDefined();
    }
  });

  it('template selector Back button returns to path selection', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to path selection' }));
    // Path cards visible again
    expect(screen.getByText('Build with AI')).toBeDefined();
  });

  it('selecting a template calls completeOnboarding and onComplete', async () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-platformer'));
    // Wait for the async handleTemplateChosen to resolve
    await vi.waitFor(() => {
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Dismiss button ----

  it('X button dismisses the wizard via completeOnboarding + onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Dismiss and start with blank canvas'));
    expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
