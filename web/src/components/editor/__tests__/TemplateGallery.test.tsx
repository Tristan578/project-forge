/**
 * Render tests for TemplateGallery component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { TemplateGallery } from '../TemplateGallery';
import { useEditorStore } from '@/stores/editorStore';
import { AnalyticsEvent } from '@/lib/analytics/posthog';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Gamepad2: (props: Record<string, unknown>) => <span data-testid="gamepad-icon" {...props} />,
  Zap: (props: Record<string, unknown>) => <span data-testid="zap-icon" {...props} />,
  Crosshair: (props: Record<string, unknown>) => <span data-testid="crosshair-icon" {...props} />,
  Puzzle: (props: Record<string, unknown>) => <span data-testid="puzzle-icon" {...props} />,
  Compass: (props: Record<string, unknown>) => <span data-testid="compass-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
}));

const mockTrackEvent = vi.fn();
vi.mock('@/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics/posthog')>()),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock('@/data/templates', () => ({
  TEMPLATE_REGISTRY: [
    {
      id: 'platformer',
      name: 'Platformer',
      description: 'Side-scrolling platformer game',
      difficulty: 'beginner',
      entityCount: 5,
      tags: ['2d', 'platformer'],
      thumbnail: { gradient: 'linear-gradient()', icon: 'Gamepad2', accentColor: '#ff0000' },
    },
  ],
}));

describe('TemplateGallery', () => {
  const mockOnClose = vi.fn();
  const mockLoadTemplate = vi
    .fn()
    .mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
  const mockNewScene = vi.fn();

  function setupStore() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        loadTemplate: mockLoadTemplate,
        newScene: mockNewScene,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadTemplate.mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when not open', () => {
    const { container } = render(<TemplateGallery isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Choose a Template heading when open', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Choose a Template')).toBeInTheDocument();
  });

  it('renders subtitle text', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Start with a pre-built game or a blank project')).toBeInTheDocument();
  });

  it('renders Blank Project card', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Blank Project')).toBeInTheDocument();
  });

  it('renders close button with aria-label', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText('Close template gallery')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close template gallery'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls newScene and onClose when Blank Project selected', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Blank Project').closest('button')!);
    expect(mockNewScene).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('has role="dialog" on the modal', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when Escape key pressed', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop clicked', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    // The outer fixed div has onClick={onClose}
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalled();
  });

  // The gallery used to close and fire TEMPLATE_USED / TEMPLATE_APPLIED for any
  // outcome, so a failed load looked identical to a successful one: the dialog
  // went away, the funnel counted an activation, and the canvas stayed empty.
  describe('when the template load fails', () => {
    beforeEach(() => {
      mockLoadTemplate.mockResolvedValue({ success: false, error: 'Engine is not ready yet' });
    });

    it('stays open and shows the reason', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Engine is not ready yet');
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not report the template as used or applied', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);
      await screen.findByRole('alert');

      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it('clears the error when the retry succeeds', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);
      await screen.findByRole('alert');

      mockLoadTemplate.mockResolvedValue({ success: true, entityCount: 5, skippedEntityIds: [] });
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('when the template load succeeds', () => {
    it('closes and reports the template as used and applied', async () => {
      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);

      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockTrackEvent).toHaveBeenCalledWith(AnalyticsEvent.TEMPLATE_USED, {
        templateId: 'platformer',
      });
      expect(mockTrackEvent).toHaveBeenCalledWith(AnalyticsEvent.TEMPLATE_APPLIED, {
        templateId: 'platformer',
        source: 'gallery',
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('blocks a second selection while a load is in flight', async () => {
      let settle: (value: { success: boolean; entityCount: number; skippedEntityIds: string[] }) => void = () => {};
      mockLoadTemplate.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

      render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
      fireEvent.click((await screen.findByText('Platformer')).closest('button')!);

      const card = screen.getByText('Platformer').closest('button')!;
      await waitFor(() => expect(card).toBeDisabled());
      expect(card).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByText('Blank Project').closest('button')!).toBeDisabled();

      settle({ success: true, entityCount: 5, skippedEntityIds: [] });
      await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
      expect(mockLoadTemplate).toHaveBeenCalledTimes(1);
    });
  });
});
