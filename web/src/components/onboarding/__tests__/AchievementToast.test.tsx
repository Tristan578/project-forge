/**
 * Render tests for AchievementToast component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { AchievementToast } from '../AchievementToast';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/data/achievements', () => ({
  ACHIEVEMENTS: [
    {
      id: 'first-entity',
      name: 'First Steps',
      description: 'Spawned your first entity',
      icon: 'Box',
      tier: 'bronze',
    },
    {
      id: 'gold-achievement',
      name: 'Gold Master',
      description: 'Completed everything',
      icon: 'Star',
      tier: 'gold',
    },
  ],
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
    Box: ({ className }: { className?: string }) => <span data-testid="box-icon" className={className} />,
    Star: ({ className }: { className?: string }) => <span data-testid="star-icon" className={className} />,
  };
});

describe('AchievementToast', () => {
  const mockDismissAchievementToast = vi.fn();

  function setupStore({
    showAchievementToast = false,
    lastAchievementShown = null as string | null,
  } = {}) {
    vi.mocked(useOnboardingStore).mockReturnValue({
      showAchievementToast,
      lastAchievementShown,
      dismissAchievementToast: mockDismissAchievementToast,
    } as unknown as ReturnType<typeof useOnboardingStore>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('returns null when showAchievementToast is false', () => {
    setupStore({ showAchievementToast: false });
    const { container } = render(<AchievementToast />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when achievement not found', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'nonexistent' });
    const { container } = render(<AchievementToast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Achievement Unlocked heading', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    expect(screen.getByText('Achievement Unlocked!')).not.toBeNull();
  });

  it('renders achievement name', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    expect(screen.getByText('First Steps')).not.toBeNull();
  });

  it('renders achievement description', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    expect(screen.getByText('Spawned your first entity')).not.toBeNull();
  });

  it('renders tier badge', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    expect(screen.getByText('bronze')).not.toBeNull();
  });

  it('calls dismissAchievementToast when X clicked', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    fireEvent.click(screen.getByTestId('x-icon'));
    expect(mockDismissAchievementToast).toHaveBeenCalled();
  });

  it('auto-dismisses after 5 seconds', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'first-entity' });
    render(<AchievementToast />);
    vi.advanceTimersByTime(5000);
    expect(mockDismissAchievementToast).toHaveBeenCalled();
  });

  it('renders gold tier badge for gold achievement', () => {
    setupStore({ showAchievementToast: true, lastAchievementShown: 'gold-achievement' });
    render(<AchievementToast />);
    expect(screen.getByText('gold')).not.toBeNull();
  });
});
