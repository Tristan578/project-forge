/**
 * Render tests for PublishDialog component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PublishDialog } from '../PublishDialog';
import { usePublishStore } from '@/stores/publishStore';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/publishStore', () => ({
  usePublishStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Globe: (props: Record<string, unknown>) => <span data-testid="globe-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  AlertCircle: (props: Record<string, unknown>) => <span data-testid="alert-icon" {...props} />,
  Copy: (props: Record<string, unknown>) => <span data-testid="copy-icon" {...props} />,
  Tag: (props: Record<string, unknown>) => <span data-testid="tag-icon" {...props} />,
}));

describe('PublishDialog', () => {
  const mockOnClose = vi.fn();
  const mockPublishGame = vi.fn();
  const mockCheckSlug = vi.fn().mockResolvedValue(true);

  function setupStore({
    sceneName = 'My Game',
    projectId = 'proj-1',
    isPublishing = false,
    publishError = null as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = { sceneName, projectId };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(usePublishStore).mockImplementation((selector: any) => {
      const state = {
        isPublishing,
        publishError,
        publishGame: mockPublishGame,
        checkSlug: mockCheckSlug,
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

  it('returns null when not open', () => {
    setupStore();
    const { container } = render(<PublishDialog isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Publish Game heading when open', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Publish Game')).toBeInTheDocument();
  });

  it('renders title input with placeholder', () => {
    setupStore({ sceneName: 'My Scene' });
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('My Awesome Game')).toBeInTheDocument();
  });

  it('renders URL Slug label', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('URL Slug')).toBeInTheDocument();
  });

  it('renders Description textarea', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('A brief description of your game')).toBeInTheDocument();
  });

  it('renders Tags section', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText('e.g. platformer, puzzle')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when X is clicked', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('shows Publish button', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Publish')).toBeInTheDocument();
  });

  it('shows Publishing... when isPublishing', () => {
    setupStore({ isPublishing: true });
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Publishing...')).toBeInTheDocument();
  });

  it('shows error message when publishError set', () => {
    setupStore({ publishError: 'Slug already taken' });
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Slug already taken')).toBeInTheDocument();
  });

  it('adds tag when Add button is clicked', () => {
    setupStore();
    render(<PublishDialog isOpen={true} onClose={mockOnClose} />);
    const tagInput = screen.getByPlaceholderText('e.g. platformer, puzzle');
    fireEvent.change(tagInput, { target: { value: 'platformer' } });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText('platformer')).toBeInTheDocument();
  });
});
