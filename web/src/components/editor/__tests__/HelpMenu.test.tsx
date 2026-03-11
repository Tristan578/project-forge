/**
 * Render tests for HelpMenu component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { HelpMenu } from '../HelpMenu';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  HelpCircle: (props: Record<string, unknown>) => <span data-testid="help-icon" {...props} />,
  Keyboard: (props: Record<string, unknown>) => <span data-testid="keyboard-icon" {...props} />,
  BookOpen: (props: Record<string, unknown>) => <span data-testid="book-icon" {...props} />,
  GraduationCap: (props: Record<string, unknown>) => <span data-testid="grad-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-icon" {...props} />,
  MessageSquareText: (props: Record<string, unknown>) => <span data-testid="msg-icon" {...props} />,
}));

describe('HelpMenu', () => {
  const mockOnOpenShortcuts = vi.fn();
  const mockOnOpenFeedback = vi.fn();
  const mockStartTutorial = vi.fn();
  const mockOpenPanel = vi.fn();

  function setupStore({ hasWorkspaceApi = false } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
      const state = { startTutorial: mockStartTutorial };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
      const state = {
        openPanel: mockOpenPanel,
        api: hasWorkspaceApi ? {} : null,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders help button', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    expect(screen.getByLabelText('Help menu')).toBeDefined();
  });

  it('does not show menu initially', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows menu when help button is clicked', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('shows Keyboard Shortcuts menu item', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
  });

  it('shows Documentation menu item', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    expect(screen.getByText('Documentation')).toBeDefined();
  });

  it('shows Restart Tutorial menu item', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    expect(screen.getByText('Restart Tutorial')).toBeDefined();
  });

  it('shows Send Feedback menu item', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    expect(screen.getByText('Send Feedback')).toBeDefined();
  });

  it('calls onOpenShortcuts when Keyboard Shortcuts is clicked', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(mockOnOpenShortcuts).toHaveBeenCalled();
  });

  it('calls startTutorial when Restart Tutorial is clicked', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    fireEvent.click(screen.getByText('Restart Tutorial'));
    expect(mockStartTutorial).toHaveBeenCalledWith('first-scene');
  });

  it('calls onOpenFeedback when Send Feedback is clicked', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    fireEvent.click(screen.getByText('Send Feedback'));
    expect(mockOnOpenFeedback).toHaveBeenCalled();
  });

  it('closes menu after clicking menu item', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    fireEvent.click(screen.getByText('Keyboard Shortcuts'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes menu on Escape key', () => {
    setupStore();
    render(<HelpMenu onOpenShortcuts={mockOnOpenShortcuts} onOpenFeedback={mockOnOpenFeedback} />);
    fireEvent.click(screen.getByLabelText('Help menu'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
