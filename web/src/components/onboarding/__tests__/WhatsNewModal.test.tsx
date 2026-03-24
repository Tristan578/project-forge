/**
 * Render tests for WhatsNewModal component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WhatsNewModal } from '../WhatsNewModal';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => <span data-testid="check-circle" {...props} />,
}));

describe('WhatsNewModal', () => {
  const mockDismissWhatsNew = vi.fn();

  function setupStore({ showWhatsNew = true } = {}) {
    vi.mocked(useOnboardingStore).mockReturnValue({
      showWhatsNew,
      dismissWhatsNew: mockDismissWhatsNew,
    } as unknown as ReturnType<typeof useOnboardingStore>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when showWhatsNew is false', () => {
    setupStore({ showWhatsNew: false });
    const { container } = render(<WhatsNewModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders What\'s New heading', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    expect(screen.getByText("What's New")).not.toBeNull();
  });

  it('renders welcome back message', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    expect(screen.getByText(/Welcome back/)).not.toBeNull();
  });

  it('renders feature titles', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    expect(screen.getByText('Visual Scripting')).not.toBeNull();
    expect(screen.getByText('Cloud Publishing')).not.toBeNull();
    expect(screen.getByText('Dialogue System')).not.toBeNull();
  });

  it('renders feature descriptions', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    expect(screen.getByText(/node-based visual editor/)).not.toBeNull();
  });

  it('renders Got it button', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    expect(screen.getByText('Got it')).not.toBeNull();
  });

  it('calls dismissWhatsNew when Got it clicked', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    fireEvent.click(screen.getByText('Got it'));
    expect(mockDismissWhatsNew).toHaveBeenCalled();
  });

  it('renders check circle icons for each feature', () => {
    setupStore({ showWhatsNew: true });
    render(<WhatsNewModal />);
    const icons = screen.getAllByTestId('check-circle');
    expect(icons.length).toBeGreaterThanOrEqual(6);
  });
});
