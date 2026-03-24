import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { EntityPicker } from '../EntityPicker';

vi.mock('lucide-react', () => ({
  Box: (props: Record<string, unknown>) => <span data-testid="box-icon" {...props} />,
  Sun: (props: Record<string, unknown>) => <span data-testid="sun-icon" {...props} />,
  Lightbulb: (props: Record<string, unknown>) => <span data-testid="lightbulb-icon" {...props} />,
  Mountain: (props: Record<string, unknown>) => <span data-testid="mountain-icon" {...props} />,
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sceneGraph: {
        nodes: {
          'entity-1': { entityId: 'entity-1', name: 'Player', components: [] },
          'entity-2': { entityId: 'entity-2', name: 'Ground', components: [] },
          'entity-3': { entityId: 'entity-3', name: 'PointLight1', components: ['PointLight'] },
        },
      },
    })
  ),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      entityPickerFilter: '',
    })
  ),
}));

describe('EntityPicker', () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock scrollIntoView which doesn't exist in jsdom
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing and shows entities', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Player')).not.toBeNull();
    expect(screen.getByText('Ground')).not.toBeNull();
    expect(screen.getByText('PointLight1')).not.toBeNull();
  });

  it('calls onSelect when an entity is clicked', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Player'));
    expect(mockOnSelect).toHaveBeenCalledWith('Player', 'entity-1');
  });

  it('shows entity IDs next to names', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('entity-1')).not.toBeNull();
    expect(screen.getByText('entity-2')).not.toBeNull();
  });
});
