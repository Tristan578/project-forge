/**
 * Render tests for TemplateGallery component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TemplateGallery } from '../TemplateGallery';
import { useEditorStore } from '@/stores/editorStore';

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
  const mockLoadTemplate = vi.fn().mockResolvedValue(undefined);
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
    expect(screen.getByText('Choose a Template')).toBeDefined();
  });

  it('renders subtitle text', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Start with a pre-built game or a blank project')).toBeDefined();
  });

  it('renders Blank Project card', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Blank Project')).toBeDefined();
  });

  it('renders close button with aria-label', () => {
    render(<TemplateGallery isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByLabelText('Close template gallery')).toBeDefined();
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
    expect(screen.getByRole('dialog')).toBeDefined();
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
});
