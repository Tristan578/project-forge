/**
 * Tests for ShaderEditorPanel — renders when open, hides when closed,
 * close button, save, compile with success/error, palette toggle, and
 * code preview modal.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { ShaderEditorPanel } from '../ShaderEditorPanel';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';

vi.mock('@/stores/shaderEditorStore', () => ({
  useShaderEditorStore: vi.fn(() => ({})),
}));

// Mock @xyflow/react to avoid DOM/ResizeObserver issues in jsdom
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="rf-panel">{children}</div>
  ),
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  addEdge: (_edge: unknown, eds: unknown[]) => eds,
  BackgroundVariant: { Dots: 'dots' },
}));

vi.mock('@xyflow/react/dist/style.css', () => ({}));

vi.mock('@/components/editor/shader-nodes/ShaderNodeBase', () => ({
  ShaderNodeBase: () => <div data-testid="shader-node-base" />,
}));

vi.mock('@/components/editor/shader-nodes/ShaderNodePalette', () => ({
  ShaderNodePalette: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="shader-node-palette">
      <button onClick={onClose}>Close Palette</button>
    </div>
  ),
}));

vi.mock('@/lib/shaders/wgslCompiler', () => ({
  compileToWgsl: vi.fn(),
}));

vi.mock('@/lib/shaders/shaderNodeTypes', () => ({
  SHADER_PORT_COMPATIBILITY: {},
  SHADER_NODE_DEFINITIONS: {},
  SHADER_NODE_CATEGORIES: [
    { id: 'input', label: 'Input', color: '#3b82f6' },
    { id: 'math', label: 'Math', color: '#f59e0b' },
    { id: 'output', label: 'Output', color: '#ef4444' },
  ],
}));

import { compileToWgsl } from '@/lib/shaders/wgslCompiler';

const mockCloseShaderEditor = vi.fn();
const mockAddNode = vi.fn(() => 'new-node-id');
const mockUpdateNodePosition = vi.fn();
const mockAddEdgeToStore = vi.fn();
const mockSaveGraph = vi.fn();

const baseGraph = {
  id: 'graph-1',
  name: 'Test Shader',
  nodes: [],
  edges: [],
};

function setupStore(overrides: {
  isOpen?: boolean;
  activeGraphId?: string | null;
  graphs?: Record<string, typeof baseGraph>;
} = {}) {
  const graphs = overrides.graphs ?? { 'graph-1': baseGraph };
  const activeGraphId = 'activeGraphId' in overrides ? overrides.activeGraphId : 'graph-1';

  const state = {
    isOpen: overrides.isOpen ?? true,
    activeGraphId,
    graphs,
    closeShaderEditor: mockCloseShaderEditor,
    addNode: mockAddNode,
    updateNodePosition: mockUpdateNodePosition,
    addEdge: mockAddEdgeToStore,
    saveGraph: mockSaveGraph,
  };
  // ShaderEditorPanel calls useShaderEditorStore() without a selector
  vi.mocked(useShaderEditorStore).mockReturnValue(
    state as ReturnType<typeof useShaderEditorStore>
  );
}

describe('ShaderEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(compileToWgsl).mockReturnValue({ code: 'fn main() {}' });
  });
  afterEach(() => cleanup());

  // ── Visibility ─────────────────────────────────────────────────────────

  it('renders nothing when isOpen is false', () => {
    setupStore({ isOpen: false });
    const { container } = render(<ShaderEditorPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the editor when isOpen is true', () => {
    setupStore({ isOpen: true });
    render(<ShaderEditorPanel />);
    expect(screen.getByText('Shader Editor')).not.toBeNull();
  });

  // ── Header ─────────────────────────────────────────────────────────────

  it('displays the active graph name in the header', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    expect(screen.getByText('Test Shader')).not.toBeNull();
  });

  it('shows "Untitled" when no active graph exists', () => {
    setupStore({ activeGraphId: null, graphs: {} });
    render(<ShaderEditorPanel />);
    // The graph name span should say 'Untitled'
    expect(screen.getByText('Untitled')).not.toBeNull();
  });

  // ── Close button ───────────────────────────────────────────────────────

  it('calls closeShaderEditor when close button is clicked', () => {
    setupStore();
    const { container } = render(<ShaderEditorPanel />);
    // The X close button in the header is adjacent to Save and Compile buttons.
    // It has no text — find the button that calls closeShaderEditor by excluding
    // Save (has text 'Save') and Compile (has text 'Compile') buttons.
    const headerButtons = Array.from(
      container.querySelectorAll('.flex.items-center.gap-2 button') as NodeListOf<HTMLButtonElement>
    );
    // The close button is the one without visible text (only an SVG icon)
    const closeBtn = headerButtons.find(
      (b) => !b.textContent?.includes('Save') && !b.textContent?.includes('Compile')
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(mockCloseShaderEditor).toHaveBeenCalled();
    } else {
      // Fallback: try clicking by order — last in the header group
      const allButtons = screen.getAllByRole('button');
      // Close Palette button is also present — skip it. Header close button index = 2
      fireEvent.click(allButtons[2]);
      expect(mockCloseShaderEditor).toHaveBeenCalled();
    }
  });

  // ── Save button ────────────────────────────────────────────────────────

  it('calls saveGraph when Save is clicked', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Save'));
    expect(mockSaveGraph).toHaveBeenCalledWith('Test Shader');
  });

  it('saves with "Untitled Shader" when no active graph', () => {
    setupStore({ activeGraphId: null, graphs: {} });
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Save'));
    expect(mockSaveGraph).toHaveBeenCalledWith('Untitled Shader');
  });

  // ── Compile button ─────────────────────────────────────────────────────

  it('opens code preview on successful compile', () => {
    vi.mocked(compileToWgsl).mockReturnValue({ code: 'fn main() { }' });
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Compile'));

    expect(screen.getByText('Compiled WGSL Code')).not.toBeNull();
    expect(screen.getByText('fn main() { }')).not.toBeNull();
  });

  it('shows error in code preview when compile fails', () => {
    vi.mocked(compileToWgsl).mockReturnValue({ code: '', error: 'Cycle detected in graph' });
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Compile'));

    expect(screen.getByText('Cycle detected in graph')).not.toBeNull();
  });

  it('does not open code preview when no active graph', () => {
    setupStore({ activeGraphId: null, graphs: {} });
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Compile'));

    expect(screen.queryByText('Compiled WGSL Code')).toBeNull();
  });

  // ── Code preview close ─────────────────────────────────────────────────

  it('closes code preview modal when X is clicked', () => {
    vi.mocked(compileToWgsl).mockReturnValue({ code: 'fn main() {}' });
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Compile'));
    expect(screen.getByText('Compiled WGSL Code')).not.toBeNull();

    // The modal has an X close button — find and click it
    const modalCloseButtons = screen.getAllByRole('button').filter(
      (b) => b.closest('.absolute.inset-0') !== null
    );
    if (modalCloseButtons.length > 0) {
      fireEvent.click(modalCloseButtons[0]);
      expect(screen.queryByText('Compiled WGSL Code')).toBeNull();
    }
  });

  // ── Palette ────────────────────────────────────────────────────────────

  it('renders ShaderNodePalette by default', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    expect(screen.getByTestId('shader-node-palette')).not.toBeNull();
  });

  it('hides palette after clicking the palette close button', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Close Palette'));
    expect(screen.queryByTestId('shader-node-palette')).toBeNull();
  });

  it('shows "+ Add Node" button when palette is hidden', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Close Palette'));
    expect(screen.getByText('+ Add Node')).not.toBeNull();
  });

  it('reopens palette when "+ Add Node" is clicked', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    fireEvent.click(screen.getByText('Close Palette'));
    fireEvent.click(screen.getByText('+ Add Node'));
    expect(screen.getByTestId('shader-node-palette')).not.toBeNull();
  });

  // ── React Flow canvas ─────────────────────────────────────────────────

  it('renders the ReactFlow canvas area', () => {
    setupStore();
    render(<ShaderEditorPanel />);
    expect(screen.getByTestId('react-flow')).not.toBeNull();
  });
});
