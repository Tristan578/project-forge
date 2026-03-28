// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ToolCallCard } from '../ToolCallCard';

vi.mock('lucide-react', () => ({
  Check: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Loader2: (props: Record<string, unknown>) => <span data-testid="loader-icon" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
  Undo2: (props: Record<string, unknown>) => <span data-testid="undo-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="rotate-ccw" {...props} />,
  Eye: (props: Record<string, unknown>) => <span data-testid="eye-icon" {...props} />,
  XCircle: (props: Record<string, unknown>) => <span data-testid="x-circle-icon" {...props} />,
}));

const mockUndo = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      undo: mockUndo,
    })
  ),
}));

describe('ToolCallCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a successful tool call with label', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-1',
          name: 'spawn_entity',
          input: { entityType: 'cube', name: 'MyCube' },
          status: 'success',
          undoable: true,
        }}
      />
    );
    expect(screen.getByText('Spawn Entity')).toBeDefined();
    expect(screen.getByText('cube "MyCube"')).toBeDefined();
  });

  it('renders a pending tool call with loading indicator', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-2',
          name: 'update_transform',
          input: { position: [1, 2, 3] },
          status: 'pending',
          undoable: false,
        }}
      />
    );
    expect(screen.getByText('Transform')).toBeDefined();
    expect(screen.getByTestId('loader-icon')).toBeDefined();
  });

  it('shows approve/reject buttons for preview status', () => {
    const mockApprove = vi.fn();
    const mockReject = vi.fn();
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-3',
          name: 'despawn_entity',
          input: { entityId: 'e-1' },
          status: 'preview',
          undoable: false,
        }}
        onApprove={mockApprove}
        onReject={mockReject}
      />
    );
    expect(screen.getByText('Approve')).toBeDefined();
    expect(screen.getByText('Reject')).toBeDefined();

    fireEvent.click(screen.getByText('Approve'));
    expect(mockApprove).toHaveBeenCalledWith('tc-3');
  });

  it('expands to show input JSON when header button is clicked', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-4',
          name: 'rename_entity',
          input: { entityId: 'e-1', name: 'NewName' },
          status: 'success',
          undoable: false,
        }}
      />
    );
    // Click the main button (which contains the label text)
    const headerButton = screen.getByText('Rename').closest('button')!;
    fireEvent.click(headerButton);
    // JSON pre block should be visible after expanding — find the <pre> element
    const preElement = screen.getByText(/entityId/);
    expect(preElement.tagName).toBe('PRE');
  });

  it('renders error status with X icon', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-5',
          name: 'update_terrain',
          input: {},
          status: 'error',
          undoable: false,
        }}
      />
    );
    expect(screen.getByTestId('x-icon')).toBeDefined();
    expect(screen.getByText('Update Terrain')).toBeDefined();
  });

  it('renders rejected status with XCircle icon and Rejected label', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-6',
          name: 'spawn_entity',
          input: { entityType: 'cube' },
          status: 'rejected',
          undoable: false,
        }}
      />
    );
    expect(screen.getByTestId('x-circle-icon')).toBeDefined();
    expect(screen.getByText('Rejected')).toBeDefined();
    // Label should be strikethrough (line-through class on text element)
    const label = screen.getByText('Spawn Entity');
    expect(label.className).toContain('line-through');
  });

  it('renders undone status with RotateCcw icon and Undone label', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-7',
          name: 'rename_entity',
          input: { name: 'OldName' },
          status: 'undone',
          undoable: false,
        }}
      />
    );
    expect(screen.getByTestId('rotate-ccw')).toBeDefined();
    expect(screen.getByText('Undone')).toBeDefined();
    const label = screen.getByText('Rename');
    expect(label.className).toContain('line-through');
  });

  it('shows undo button for successful undoable tool call and calls undo on click', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-8',
          name: 'update_transform',
          input: { position: [1, 2, 3] },
          status: 'success',
          undoable: true,
        }}
      />
    );
    const undoBtn = screen.getByTitle('Undo this action');
    expect(undoBtn).toBeDefined();
    fireEvent.click(undoBtn);
    expect(mockUndo).toHaveBeenCalledOnce();
  });

  it('does not show undo button for non-undoable success', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-9',
          name: 'export_scene',
          input: {},
          status: 'success',
          undoable: false,
        }}
      />
    );
    expect(screen.queryByTitle('Undo this action')).toBeNull();
  });

  it('shows expanded error message when expanded', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-10',
          name: 'update_terrain',
          input: {},
          status: 'error',
          undoable: false,
          error: 'Terrain update failed: mesh too large',
        }}
      />
    );
    const headerButton = screen.getByText('Update Terrain').closest('button')!;
    fireEvent.click(headerButton);
    expect(screen.getByText('Terrain update failed: mesh too large')).toBeDefined();
  });

  it('shows result JSON in expanded view when result is present', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-11',
          name: 'export_scene',
          input: {},
          status: 'success',
          undoable: false,
          result: { sceneId: 'scene-123', url: 'https://cdn.example.com/scene.forge' },
        }}
      />
    );
    const headerButton = screen.getByText('Save Scene').closest('button')!;
    fireEvent.click(headerButton);
    // Result is rendered in a second <pre> element
    const preElements = screen.getAllByText(/sceneId|scene-123/);
    expect(preElements.length).toBeGreaterThan(0);
  });

  it('calls onReject when reject button is clicked', () => {
    const mockReject = vi.fn();
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-12',
          name: 'despawn_entity',
          input: { entityId: 'e-1' },
          status: 'preview',
          undoable: false,
        }}
        onReject={mockReject}
      />
    );
    fireEvent.click(screen.getByText('Reject'));
    expect(mockReject).toHaveBeenCalledWith('tc-12');
  });

  it('uses aria-expanded on header button to reflect collapse state', () => {
    render(
      <ToolCallCard
        toolCall={{
          id: 'tc-13',
          name: 'rename_entity',
          input: { name: 'Test' },
          status: 'success',
          undoable: false,
        }}
      />
    );
    const headerButton = screen.getByLabelText(/Expand Rename details/);
    expect(headerButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(headerButton);
    expect(screen.getByLabelText(/Collapse Rename details/).getAttribute('aria-expanded')).toBe('true');
  });
});
