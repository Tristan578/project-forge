/**
 * Render tests for NodeInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { NodeInspector } from '../NodeInspector';
import type { VisualScriptNode } from '@/lib/scripting/visualScriptTypes';

vi.mock('@/lib/scripting/nodeDefinitions', () => ({
  NODE_DEFINITION_MAP: {
    on_start: {
      label: 'On Start',
      description: 'Runs when game starts',
      color: '#ff9900',
      inputs: [],
      outputs: [{ id: 'exec_out', name: 'Exec', type: 'exec' }],
    },
    print_log: {
      label: 'Print Log',
      description: 'Logs a message to the console',
      color: '#6699ff',
      inputs: [
        { id: 'exec_in', name: 'Exec', type: 'exec' },
        { id: 'message', name: 'Message', type: 'string', defaultValue: 'Hello' },
        { id: 'count', name: 'Count', type: 'int', defaultValue: 0 },
        { id: 'enabled', name: 'Enabled', type: 'bool', defaultValue: true },
      ],
      outputs: [{ id: 'exec_out', name: 'Exec', type: 'exec' }],
    },
  },
}));

function makeNode(type: string, data: Record<string, unknown> = {}): VisualScriptNode {
  return {
    id: 'node-1',
    type,
    position: { x: 0, y: 0 },
    data: { nodeType: type, ...data },
  } as VisualScriptNode;
}

describe('NodeInspector', () => {
  const mockOnNodeDataChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders placeholder when no node is selected', () => {
    render(<NodeInspector node={null} onNodeDataChange={mockOnNodeDataChange} />);
    expect(screen.getByText('Select a node to edit its properties')).toBeDefined();
  });

  it('returns null when node type has no definition', () => {
    const node = makeNode('unknown_type');
    const { container } = render(<NodeInspector node={node} onNodeDataChange={mockOnNodeDataChange} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders node label', () => {
    render(<NodeInspector node={makeNode('on_start')} onNodeDataChange={mockOnNodeDataChange} />);
    expect(screen.getByText('On Start')).toBeDefined();
  });

  it('renders node description', () => {
    render(<NodeInspector node={makeNode('on_start')} onNodeDataChange={mockOnNodeDataChange} />);
    expect(screen.getByText('Runs when game starts')).toBeDefined();
  });

  it('shows "No editable properties" when no non-exec inputs', () => {
    render(<NodeInspector node={makeNode('on_start')} onNodeDataChange={mockOnNodeDataChange} />);
    expect(screen.getByText('No editable properties')).toBeDefined();
  });

  it('renders text input for string port', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('renders number input for int port', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('renders checkbox for bool port', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDefined();
  });

  it('calls onNodeDataChange when text input changes', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const textInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(textInput, { target: { value: 'New message' } });
    expect(mockOnNodeDataChange).toHaveBeenCalledWith('node-1', expect.objectContaining({ message: 'New message' }));
  });

  it('calls onNodeDataChange when number input changes', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const numberInput = screen.getAllByRole('spinbutton')[0];
    fireEvent.change(numberInput, { target: { value: '5' } });
    expect(mockOnNodeDataChange).toHaveBeenCalledWith('node-1', expect.objectContaining({ count: 5 }));
  });

  it('calls onNodeDataChange when checkbox changes', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(mockOnNodeDataChange).toHaveBeenCalledWith('node-1', expect.objectContaining({ enabled: false }));
  });

  it('shows port labels', () => {
    render(<NodeInspector node={makeNode('print_log')} onNodeDataChange={mockOnNodeDataChange} />);
    expect(screen.getByText('Message')).toBeDefined();
    expect(screen.getByText('Count')).toBeDefined();
    expect(screen.getByText('Enabled')).toBeDefined();
  });
});
