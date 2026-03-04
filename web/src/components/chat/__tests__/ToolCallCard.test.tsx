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

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      undo: vi.fn(),
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
});
