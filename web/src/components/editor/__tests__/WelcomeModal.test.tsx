/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { WelcomeModal } from '../WelcomeModal';
import { useWorkspaceStore, type WorkspaceState } from '@/stores/workspaceStore';
import { useOnboardingStore, type OnboardingState } from '@/stores/onboardingStore';
import { useChatStore } from '@/stores/chatStore';
import { getRecentProjects } from '@/lib/workspace/recentProjects';

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/workspace/recentProjects', () => ({
  getRecentProjects: vi.fn(),
}));

vi.mock('@/components/editor/TemplateGallery', () => ({
  TemplateGallery: () => null,
}));

vi.mock('@/components/editor/IdeaGeneratorModal', () => ({
  IdeaGeneratorModal: () => null,
}));

// Controllable TUTORIALS mock — default includes 'first-scene', tests can override
const mockTutorials = vi.hoisted(() => ({
  TUTORIALS: [{ id: 'first-scene', name: 'First Scene', steps: [] }],
}));

vi.mock('@/data/tutorials', () => mockTutorials);

describe('WelcomeModal', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    const workspaceState = { navigateDocs: vi.fn() } as unknown as WorkspaceState;
    const onboardingState = { startTutorial: vi.fn() } as unknown as OnboardingState;
    vi.mocked(useWorkspaceStore).mockImplementation((selector) => selector(workspaceState));
    vi.mocked(useOnboardingStore).mockImplementation((selector) => selector(onboardingState));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useChatStore).mockImplementation((selector: any) => selector({ sendMessage: vi.fn() }));
    vi.mocked(getRecentProjects).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders the modal with Welcome heading', () => {
    render(<WelcomeModal />);
    expect(screen.getByRole('heading', { name: /Welcome to SpawnForge/i })).toBeInTheDocument();
  });

  it('renders the Start Tutorial button', () => {
    render(<WelcomeModal />);
    expect(screen.getByRole('button', { name: /Start Tutorial/i })).toBeInTheDocument();
  });

  it('shows empty recent projects state when no projects exist', () => {
    render(<WelcomeModal />);
    // Recent Projects section should not be visible when empty
    expect(screen.queryByText('Recent Projects')).toBeNull();
  });

  it('renders Skip button to dismiss the modal', () => {
    render(<WelcomeModal />);
    expect(screen.getByRole('button', { name: /Skip/i })).toBeInTheDocument();
  });

  it('renders only recent projects with safe ids', () => {
    vi.mocked(getRecentProjects).mockReturnValue([
      { id: 'project-123_ok', name: 'Safe Project', openedAt: Date.now() },
      { id: 'javascript:alert(1)', name: 'Unsafe Project', openedAt: Date.now() - 1000 },
    ]);

    render(<WelcomeModal />);

    const safeLink = screen.getByRole('link', { name: /Safe Project/i });
    expect(safeLink.getAttribute('href')).toBe('/editor/project-123_ok');
    expect(screen.queryByRole('link', { name: /Unsafe Project/i })).toBeNull();
  });

  it('does not render when localStorage has dismissed key', () => {
    localStorage.setItem('forge-welcomed', '1');
    render(<WelcomeModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders modal when localStorage throws (private browsing)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied', 'SecurityError');
    });

    render(<WelcomeModal />);
    expect(screen.getByRole('heading', { name: /Welcome to SpawnForge/i })).toBeInTheDocument();
    // Spy restored by afterEach via vi.restoreAllMocks()
  });

  it('does not throw when dismissing with "Don\'t show again" and setItem throws', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    render(<WelcomeModal />);
    const checkbox = screen.getByRole('checkbox', { name: /Don't show again/i });
    await user.click(checkbox);
    const skipBtn = screen.getByRole('button', { name: /Skip/i });
    // Should not throw — dismissal succeeds even if write fails
    await user.click(skipBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows error message when tutorial data is unavailable', () => {
    // Clear the array in-place so the existing ESM named export reference observes the change
    const saved = [...mockTutorials.TUTORIALS];
    mockTutorials.TUTORIALS.splice(0, mockTutorials.TUTORIALS.length);

    try {
      render(<WelcomeModal />);
      fireEvent.click(screen.getByRole('button', { name: /Start Tutorial/i }));

      // After clicking, tutorialError should be true and the error message shown
      expect(screen.getByText(/Tutorial data unavailable/i)).toBeInTheDocument();
      // Start Tutorial button should be replaced with error text
      expect(screen.queryByRole('button', { name: /Start Tutorial/i })).toBeNull();
    } finally {
      // Restore for subsequent tests without replacing the exported array object
      mockTutorials.TUTORIALS.splice(0, mockTutorials.TUTORIALS.length, ...saved);
    }
  });

  it('starts tutorial and dismisses modal when tutorial data exists', () => {
    const mockStartTutorial = vi.fn();
    const onboardingState = { startTutorial: mockStartTutorial } as unknown as OnboardingState;
    vi.mocked(useOnboardingStore).mockImplementation((selector) => selector(onboardingState));

    render(<WelcomeModal />);
    fireEvent.click(screen.getByRole('button', { name: /Start Tutorial/i }));

    expect(mockStartTutorial).toHaveBeenCalledWith('first-scene');
    // Modal should be dismissed (dialog gone)
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
