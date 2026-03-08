import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { WelcomeModal } from '../WelcomeModal';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { getRecentProjects } from '@/lib/workspace/recentProjects';

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(),
}));

vi.mock('@/lib/workspace/recentProjects', () => ({
  getRecentProjects: vi.fn(),
}));

vi.mock('../TemplateGallery', () => ({
  TemplateGallery: () => null,
}));

describe('WelcomeModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) =>
      selector({ navigateDocs: vi.fn() }),
    );
    vi.mocked(useOnboardingStore).mockImplementation((selector: any) =>
      selector({ startTutorial: vi.fn() }),
    );
  });

  afterEach(() => {
    cleanup();
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
});
