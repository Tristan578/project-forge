// @vitest-environment jsdom
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

const mockChatState = { entityPickerFilter: '' };

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockChatState as unknown as Record<string, unknown>)
  ),
}));

describe('EntityPicker', () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock scrollIntoView which doesn't exist in jsdom
    Element.prototype.scrollIntoView = vi.fn();
    // Reset filter
    mockChatState.entityPickerFilter = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing and shows entities', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Player')).toBeDefined();
    expect(screen.getByText('Ground')).toBeDefined();
    expect(screen.getByText('PointLight1')).toBeDefined();
  });

  it('calls onSelect when an entity is clicked', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Player'));
    expect(mockOnSelect).toHaveBeenCalledWith('Player', 'entity-1');
  });

  it('shows entity IDs next to names', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('entity-1')).toBeDefined();
    expect(screen.getByText('entity-2')).toBeDefined();
  });

  it('filters entity list based on entityPickerFilter', () => {
    mockChatState.entityPickerFilter = 'player';
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Player')).toBeDefined();
    // Ground and PointLight1 do not match "player"
    expect(screen.queryByText('Ground')).toBeNull();
    expect(screen.queryByText('PointLight1')).toBeNull();
  });

  it('shows "No entities found" when filter matches nothing', () => {
    mockChatState.entityPickerFilter = 'zzznomatch';
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('No entities found')).toBeDefined();
  });

  it('filter matching is case-insensitive', () => {
    mockChatState.entityPickerFilter = 'GROUND';
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    expect(screen.getByText('Ground')).toBeDefined();
    expect(screen.queryByText('Player')).toBeNull();
  });

  it('ArrowDown key moves selection to next entity', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    // Initially the first item (index 0) is selected
    const buttons = screen.getAllByRole('button');
    // First button has the highlighted class initially
    expect(buttons[0].className).toContain('bg-zinc-800');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // After ArrowDown, second button should be highlighted
    const updatedButtons = screen.getAllByRole('button');
    expect(updatedButtons[1].className).toContain('bg-zinc-800');
  });

  it('ArrowUp key does not go below index 0', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    // Press ArrowUp from first position — should stay at 0
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).toContain('bg-zinc-800');
  });

  it('Enter key selects the currently highlighted entity', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    // First entity is selected by default (index 0)
    // Find which entity is first in the list
    const buttons = screen.getAllByRole('button');
    const firstEntityName = buttons[0].querySelector('span.flex-1')?.textContent;
    expect(firstEntityName).toBeDefined();

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(mockOnSelect).toHaveBeenCalledOnce();
    expect(mockOnSelect.mock.calls[0][0]).toBe(firstEntityName);
  });

  it('Escape key calls onClose', () => {
    render(<EntityPicker onSelect={mockOnSelect} onClose={mockOnClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockOnClose).toHaveBeenCalledOnce();
  });
});
