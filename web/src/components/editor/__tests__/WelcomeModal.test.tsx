/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
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

describe('WelcomeModal', () => {
  beforeEach(() => {
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
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access denied');
    });

    render(<WelcomeModal />);
    expect(screen.getByRole('heading', { name: /Welcome to SpawnForge/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});
