/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { OnboardingWizard, templateDimension } from '../OnboardingWizard';
import { useUserStore } from '@/stores/userStore';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';
import { TEMPLATE_REGISTRY } from '@/data/templates';
import type { TemplateLoadResult } from '@/stores/slices/sceneSlice';

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

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setRightPanelTab: mockSetRightPanelTab,
    }),
}));

// The wizard reaches the editor store through `getState()` only, for the
// template load (#10156). `loadTemplate` resolves the store's real result
// shape; each case sets what it needs.
const loadTemplate = vi.fn<(id: string) => Promise<TemplateLoadResult>>();
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ loadTemplate }) },
}));

vi.mock('@/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/posthog')>()),
  trackEvent: vi.fn(),
}));

// The toast's own behaviour is pinned in customizeWithAi.test.ts; here only
// WHEN the wizard offers it (#10172).
const mockOfferCustomizeWithAi = vi.fn();
vi.mock('@/lib/chat/customizeWithAi', () => ({
  offerCustomizeWithAi: (...args: unknown[]) => mockOfferCustomizeWithAi(...args),
}));

// The user store is REAL so a profile arriving after mount is observable: the
// static selector mock this file used to carry could not reproduce #10156's
// first-render defect at all. Reset to a loaded, paying user by default.
const INITIAL_USER = useUserStore.getInitialState();
function setUser(patch: Partial<ReturnType<typeof useUserStore.getState>>) {
  useUserStore.setState({ ...INITIAL_USER, ...patch });
}

const LOADED_OK: TemplateLoadResult = { success: true, entityCount: 32, skippedEntityIds: [] };

describe('OnboardingWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setUser({ tier: 'hobbyist', profileLoaded: true, activeFeatures: null });
    loadTemplate.mockResolvedValue(LOADED_OK);
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
    setUser({ tier: 'starter', profileLoaded: true });
    render(<OnboardingWizard onComplete={onComplete} />);

    // The AI card should be present but disabled
    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.getAttribute('aria-disabled')).toBe('true');
    // Shows upgrade text within the AI card
    expect(aiCard.textContent).toContain('Upgrade');
  });

  it('renders upgrade link pointing to /pricing for starter tier', () => {
    setUser({ tier: 'starter', profileLoaded: true });
    render(<OnboardingWizard onComplete={onComplete} />);
    // Find the upgrade link within the AI card specifically
    const aiCard = screen.getByTestId('path-card-ai');
    const link = aiCard.querySelector('a[href="/pricing"]');
    expect(link).not.toBeNull();
  });

  it('renders the locked card when the profile fetch failed (loaded, still starter)', () => {
    // userStore.fetchProfile marks the profile loaded on every terminal
    // failure and leaves the tier at 'starter': the answer is "no".
    setUser({ tier: 'starter', profileLoaded: true, activeFeatures: null });
    render(<OnboardingWizard onComplete={onComplete} />);
    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.getAttribute('aria-busy')).toBeNull();
    expect(aiCard.querySelector('a[href="/pricing"]')).not.toBeNull();
  });

  it('renders non-starter AI card as a clickable button', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const aiCard = screen.getByTestId('path-card-ai');
    // When not locked it renders as a button
    expect(aiCard.tagName.toLowerCase()).toBe('button');
  });

  // ---- Profile not yet loaded: neither locked nor enabled (#10156) ----

  it('renders a pending AI card, with no upgrade link and no button, until the profile loads', () => {
    setUser({ tier: 'starter', profileLoaded: false });
    render(<OnboardingWizard onComplete={onComplete} />);

    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.getAttribute('aria-busy')).toBe('true');
    expect(aiCard.getAttribute('aria-disabled')).toBe('true');
    expect(aiCard.tagName.toLowerCase()).not.toBe('button');
    expect(aiCard.querySelector('a[href="/pricing"]')).toBeNull();
    expect(aiCard.textContent).not.toContain('Upgrade to unlock AI');
  });

  it('unlocks the AI card when the profile arrives after mount, with no other store change', () => {
    const onStartAi = vi.fn();
    setUser({ tier: 'starter', profileLoaded: false });
    render(<OnboardingWizard onComplete={onComplete} onStartAi={onStartAi} />);
    expect(screen.getByTestId('path-card-ai').tagName.toLowerCase()).not.toBe('button');

    act(() => {
      useUserStore.setState({ tier: 'hobbyist', profileLoaded: true });
    });

    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.tagName.toLowerCase()).toBe('button');
    fireEvent.click(aiCard);
    expect(onStartAi).toHaveBeenCalledTimes(1);
  });

  it('unlocks the AI card when the tier changes after the profile is already loaded', () => {
    // Only `tier` moves here (an entitlement sync, or setTier). Subscribing
    // to `profileLoaded` alone would not re-render for this; selecting the
    // stable `canUseAI` function would not re-render for anything.
    const onStartAi = vi.fn();
    setUser({ tier: 'starter', profileLoaded: true });
    render(<OnboardingWizard onComplete={onComplete} onStartAi={onStartAi} />);
    expect(screen.getByTestId('path-card-ai').querySelector('a[href="/pricing"]')).not.toBeNull();

    act(() => {
      useUserStore.setState({ tier: 'hobbyist' });
    });

    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.tagName.toLowerCase()).toBe('button');
    fireEvent.click(aiCard);
    expect(onStartAi).toHaveBeenCalledTimes(1);
  });

  it('locks the AI card when the profile resolves to starter', () => {
    setUser({ tier: 'starter', profileLoaded: false });
    render(<OnboardingWizard onComplete={onComplete} />);

    act(() => {
      useUserStore.setState({ profileLoaded: true });
    });

    const aiCard = screen.getByTestId('path-card-ai');
    expect(aiCard.getAttribute('aria-busy')).toBeNull();
    expect(aiCard.querySelector('a[href="/pricing"]')).not.toBeNull();
  });

  // ---- Path navigation ----

  // #6831: OnboardingGate is the ONE writer of the completed flag. The wizard
  // reports the user's choice through `onComplete` and never writes the flag,
  // which is what lets the gate withhold completion from an AI run that fails.
  it('clicking "Blank Canvas" calls selectPath and onComplete, leaving the completed flag to the caller', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-blank'));
    expect(mockSelectPath).toHaveBeenCalledWith('blank');
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('with no onStartAi (standalone), "Build with AI" switches to chat and falls back to onComplete', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-ai'));
    expect(mockSelectPath).toHaveBeenCalledWith('ai');
    expect(mockSetRightPanelTab).toHaveBeenCalledWith('chat');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // PF-1215: before this, "Build with AI" only switched the right panel to chat
  // and left the user to guess a phrase the intent classifier would recognise.
  //
  // #6831: picking AI must NOT complete onboarding. Whether it completes is
  // decided by the outcome of the run the dialog starts (OnboardingGate).
  it('clicking "Build with AI" opens the quick-start dialog without completing onboarding', () => {
    const onStartAi = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} onStartAi={onStartAi} />);
    fireEvent.click(screen.getByTestId('path-card-ai'));
    expect(onStartAi).toHaveBeenCalledTimes(1);
    expect(mockSelectPath).toHaveBeenCalledWith('ai');
    expect(onComplete).not.toHaveBeenCalled();
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
  });

  it('does not open the quick-start dialog for the non-AI paths', () => {
    const onStartAi = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} onStartAi={onStartAi} />);
    fireEvent.click(screen.getByTestId('path-card-blank'));
    expect(onStartAi).not.toHaveBeenCalled();
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

  it("tags every template card with the dimension its registry entry carries, so a registry change fails here", () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));

    const ids = ['platformer', 'runner', 'shooter', 'puzzle', 'explorer'];
    let checked = 0;
    for (const id of ids) {
      const entry = TEMPLATE_REGISTRY.find((e) => e.id === id);
      expect(entry, `registry entry for ${id}`).toBeDefined();
      const expected = entry!.tags.includes('3d') ? '3D' : entry!.tags.includes('2d') ? '2D' : null;
      expect(expected, `registry entry ${id} carries a 2d or 3d tag`).not.toBeNull();
      const card = screen.getByTestId(`template-card-${id}`);
      const badges = Array.from(card.querySelectorAll('span')).map((s) => s.textContent);
      expect(badges, `card ${id}`).toContain(expected);
      expect(badges, `card ${id}`).not.toContain(expected === '3D' ? '2D' : '3D');
      expect(templateDimension(id)).toBe(expected);
      checked += 1;
    }
    expect(checked).toBe(ids.length);
    // platformer and runner are the two that were hand-tagged '2D' (#10156).
    expect(templateDimension('platformer')).toBe('3D');
    expect(templateDimension('runner')).toBe('3D');
    expect(templateDimension('no-such-template')).toBeNull();
  });

  it('loads the chosen template first, and completes onboarding only after the load settles', async () => {
    let settle!: (result: TemplateLoadResult) => void;
    loadTemplate.mockReturnValueOnce(new Promise<TemplateLoadResult>((resolve) => { settle = resolve; }));
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-platformer'));

    expect(loadTemplate).toHaveBeenCalledTimes(1);
    expect(loadTemplate).toHaveBeenCalledWith('platformer');
    // The load is still pending: nothing may have completed onboarding yet,
    // or OnboardingGate would unmount this wizard before it could report.
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(mockOfferCustomizeWithAi).not.toHaveBeenCalled();
    expect(screen.getByTestId('template-card-runner')).toHaveProperty('disabled', true);

    await act(async () => {
      settle(LOADED_OK);
    });

    // #10172: offered once the template is in, naming it as the registry does.
    const name = TEMPLATE_REGISTRY.find((t) => t.id === 'platformer')?.name;
    expect(name).toBeTruthy();
    expect(mockOfferCustomizeWithAi).toHaveBeenCalledTimes(1);
    expect(mockOfferCustomizeWithAi).toHaveBeenCalledWith(name);

    // #6831: the wizard reports through onComplete; OnboardingGate is the
    // single writer of completeOnboarding.
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledTimes(2);
    expect(trackEvent).toHaveBeenNthCalledWith(1, AnalyticsEvent.TEMPLATE_USED, { templateId: 'platformer' });
    expect(trackEvent).toHaveBeenNthCalledWith(2, AnalyticsEvent.TEMPLATE_APPLIED, {
      templateId: 'platformer',
      source: 'onboarding',
    });
  });

  it('keeps Back, Escape and Dismiss inert while a load is pending, so the load cannot land on top of another path', async () => {
    let settle!: (result: TemplateLoadResult) => void;
    loadTemplate.mockReturnValueOnce(new Promise<TemplateLoadResult>((resolve) => { settle = resolve; }));
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-platformer'));

    // Back: the selector stays up, so "Blank Canvas" cannot be chosen underneath.
    const back = screen.getByRole('button', { name: 'Back to path selection' });
    expect(back).toHaveProperty('disabled', true);
    fireEvent.click(back);
    expect(screen.getByTestId('template-card-platformer')).toBeDefined();
    expect(screen.queryByTestId('path-card-blank')).toBeNull();

    // Escape and the X: neither completes onboarding around the pending load.
    fireEvent.keyDown(document, { key: 'Escape' });
    const dismiss = screen.getByLabelText('Dismiss and start with blank canvas');
    expect(dismiss).toHaveProperty('disabled', true);
    fireEvent.click(dismiss);
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      settle(LOADED_OK);
    });
    // The wizard never writes the completed flag (the caller does, #6831)...
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    // ...and reports completion exactly once, from the load itself.
    expect(onComplete).toHaveBeenCalledTimes(1);

    // And the exits work again after a failed load re-enables the selector.
    loadTemplate.mockResolvedValueOnce({ success: false, error: 'nope' });
    cleanup();
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-runner'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Back to path selection' })).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('Dismiss and start with blank canvas')).toHaveProperty('disabled', false);
  });

  it('drops a load result that lands after the wizard has unmounted', async () => {
    let settle!: (result: TemplateLoadResult) => void;
    loadTemplate.mockReturnValueOnce(new Promise<TemplateLoadResult>((resolve) => { settle = resolve; }));
    const { unmount } = render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-platformer'));
    unmount();

    await act(async () => {
      settle(LOADED_OK);
    });
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('stays mounted, shows the load error as an alert and re-enables the cards when the load fails', async () => {
    const error = 'The engine is not ready yet — try again in a moment.';
    loadTemplate.mockResolvedValueOnce({ success: false, error });
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-platformer'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(error);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByTestId('template-card-platformer')).toHaveProperty('disabled', false);
    expect(screen.getByTestId('template-card-runner')).toHaveProperty('disabled', false);
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(mockOfferCustomizeWithAi).not.toHaveBeenCalled();
  });

  it('treats a thrown load like a failed one, with a generic message', async () => {
    loadTemplate.mockRejectedValueOnce(new Error('boom'));
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-runner'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load that template');
    expect(alert.textContent).not.toContain('boom');
    expect(screen.getByTestId('template-card-runner')).toHaveProperty('disabled', false);
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('clears a load error when the user goes Back, so reopening the selector starts clean', async () => {
    loadTemplate.mockResolvedValueOnce({ success: false, error: 'first failure' });
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-puzzle'));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Back to path selection' }));
    fireEvent.click(screen.getByTestId('path-card-template'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the previous error when a new load starts', async () => {
    loadTemplate.mockResolvedValueOnce({ success: false, error: 'first failure' });
    let settle!: (result: TemplateLoadResult) => void;
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('path-card-template'));
    fireEvent.click(screen.getByTestId('template-card-puzzle'));
    await screen.findByRole('alert');

    loadTemplate.mockReturnValueOnce(new Promise<TemplateLoadResult>((resolve) => { settle = resolve; }));
    fireEvent.click(screen.getByTestId('template-card-puzzle'));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      settle(LOADED_OK);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ---- Dismiss button ----

  it('X button dismisses the wizard via onComplete, leaving the completed flag to the caller', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Dismiss and start with blank canvas'));
    expect(mockCompleteOnboarding).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
