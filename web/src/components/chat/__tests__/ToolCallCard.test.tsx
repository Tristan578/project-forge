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
  ShieldAlert: (props: Record<string, unknown>) => <span data-testid="shield-alert-icon" {...props} />,
}));

const sceneNodes: Record<string, { entityId: string; name: string }> = {
  'e-1': { entityId: 'e-1', name: 'Player' },
};

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      undo: vi.fn(),
      sceneGraph: { nodes: sceneNodes, rootIds: ['e-1'] },
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

  // ---------------------------------------------------------------------------
  // Server-side approval gate (PF-8860)
  // ---------------------------------------------------------------------------
  describe('server approval gate', () => {
    const gated = {
      id: 'tc-gate',
      name: 'delete_entities',
      input: { entityIds: ['e-1'] },
      status: 'approval-required' as const,
      undoable: true,
      approvalId: 'ap-1',
    };

    it('says what will happen in the user’s words, not raw JSON', () => {
      // Approving what you cannot read is not approval. The id `e-1` means
      // nothing to a user — the editor only ever shows them "Player".
      render(<ToolCallCard toolCall={gated} onApprove={vi.fn()} onReject={vi.fn()} />);

      const summary = screen.getByTestId('approval-action');
      expect(summary.textContent).toContain('"Player"');
      expect(summary.textContent).toContain('Delete');
      expect(summary.textContent).not.toContain('entityIds');
    });

    it('falls back to the id when the scene graph does not know the entity', () => {
      render(
        <ToolCallCard
          toolCall={{ ...gated, input: { entityIds: ['0f3a9c21b4d85e17'] } }}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      );
      // An unresolvable id is information, not something to paper over.
      expect(screen.getByTestId('approval-action').textContent).toContain('0f3a9c21\u2026');
    });

    it('is visually distinct from the routine client-side preview card', () => {
      // The two cards can sit side by side in one turn. When the server-gate
      // card and the ordinary preview card look alike, the gate reads as
      // routine — so the difference is carried by three cues, not colour
      // alone: a testid-bearing container, a heavier border, and a header band.
      const { container: gateEl } = render(
        <ToolCallCard toolCall={gated} onApprove={vi.fn()} onReject={vi.fn()} />
      );
      const gate = gateEl.querySelector('[data-testid="server-approval-gate"]')!;
      expect(gate).not.toBeNull();
      expect(gate.className).toContain('border-2');
      expect(gate.className).toContain('rose');
      expect(screen.getByText(/needs your approval/i)).toBeDefined();

      cleanup();

      const { container: previewEl } = render(
        <ToolCallCard
          toolCall={{ ...gated, status: 'preview', approvalId: undefined }}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      );
      expect(previewEl.querySelector('[data-testid="server-approval-gate"]')).toBeNull();
      expect(screen.queryByText(/needs your approval/i)).toBeNull();
    });

    it('gives Approve and Deny a 44px touch target', () => {
      // WCAG 2.5.5 / the platform 44px minimum. The consequence of missing it
      // here is not a mis-tap on a nav link — it is a mis-tap on "delete
      // everything in this scene".
      render(<ToolCallCard toolCall={gated} onApprove={vi.fn()} onReject={vi.fn()} />);

      for (const label of ['Approve', 'Deny']) {
        const button = screen.getByText(label).closest('button')!;
        expect(button.className, `${label} is under the 44px minimum`).toContain('min-h-11');
        expect(button.className).toContain('min-w-[88px]');
      }
    });

    it('routes Approve and Deny to the GATE callbacks, never the local preview ones', () => {
      // The two pairs are deliberately separate props: onApprove/onReject
      // resolve a client-side preview locally and the server hears nothing,
      // which for a gated call would leave the SDK waiting forever on an
      // approval that was answered only in the browser.
      const onApproveGated = vi.fn();
      const onDenyGated = vi.fn();
      const onApprove = vi.fn();
      const onReject = vi.fn();
      render(
        <ToolCallCard
          toolCall={gated}
          onApproveGated={onApproveGated}
          onDenyGated={onDenyGated}
          onApprove={onApprove}
          onReject={onReject}
        />
      );

      fireEvent.click(screen.getByText('Deny'));
      expect(onDenyGated).toHaveBeenCalledWith('tc-gate');
      expect(onApproveGated).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('Approve'));
      expect(onApproveGated).toHaveBeenCalledWith('tc-gate');

      expect(onApprove).not.toHaveBeenCalled();
      expect(onReject).not.toHaveBeenCalled();
    });
  });
});
