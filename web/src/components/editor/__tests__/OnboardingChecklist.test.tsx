/**
 * Render tests for OnboardingChecklist component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { OnboardingChecklist } from '../OnboardingChecklist';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({})),
    subscribe: vi.fn(() => vi.fn()), // returns unsubscribe function
  }),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => ({ messages: [] })),
  },
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => <span data-testid="check-circle" {...props} />,
  Circle: (props: Record<string, unknown>) => <span data-testid="circle" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronUp: (props: Record<string, unknown>) => <span data-testid="chevron-up" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Trophy: (props: Record<string, unknown>) => <span data-testid="trophy-icon" {...props} />,
}));

describe('OnboardingChecklist', () => {
  function setupStore(tutorialCompleted: Record<string, boolean> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
      const state = { tutorialCompleted };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('returns null when dismissed (localStorage)', () => {
    localStorage.setItem('forge-checklist-dismissed', '1');
    setupStore();
    const { container } = render(<OnboardingChecklist />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Getting Started" heading when not dismissed', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Getting Started')).toBeDefined();
  });

  it('renders Progress label', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Progress')).toBeDefined();
  });

  it('renders Basics section', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Basics')).toBeDefined();
  });

  it('renders Advanced section', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Advanced')).toBeDefined();
  });

  it('shows "Locked" badge on Advanced when basics not complete', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Locked')).toBeDefined();
  });

  it('renders checklist task titles', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Create Your First Entity')).toBeDefined();
    expect(screen.getByText('Write a Script')).toBeDefined();
  });

  it('dismisses checklist when X button is clicked', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(screen.queryByText('Getting Started')).toBeNull();
  });

  it('stores dismiss in localStorage', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(localStorage.getItem('forge-checklist-dismissed')).toBe('1');
  });

  it('collapses content when collapse button is clicked', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTitle('Collapse'));
    expect(screen.queryByText('Progress')).toBeNull();
  });

  it('expands content again after clicking collapse twice', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTitle('Collapse'));
    fireEvent.click(screen.getByTitle('Expand'));
    expect(screen.getByText('Progress')).toBeDefined();
  });

  it('shows task count as 0/12 by default', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('0 / 12')).toBeDefined();
  });
});
