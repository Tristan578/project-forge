/**
 * Render tests for CustomNode component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { CustomNode } from '../CustomNode';

vi.mock('@/lib/scripting/nodeDefinitions', () => ({
  NODE_DEFINITION_MAP: {
    on_start: {
      label: 'On Start',
      description: 'Runs when game starts',
      color: '#ff9900',
      inputs: [
        { id: 'exec_in', name: 'Exec In', type: 'exec' },
      ],
      outputs: [
        { id: 'exec_out', name: 'Exec Out', type: 'exec' },
      ],
    },
    print_log: {
      label: 'Print Log',
      description: 'Logs a message',
      color: '#6699ff',
      inputs: [
        { id: 'exec_in', name: 'Exec In', type: 'exec' },
        { id: 'message', name: 'Message', type: 'string' },
      ],
      outputs: [
        { id: 'exec_out', name: 'Exec Out', type: 'exec' },
      ],
    },
  },
}));

vi.mock('@/lib/scripting/visualScriptTypes', () => ({
  PORT_COLORS: {
    exec: '#ffffff',
    string: '#ff6644',
    float: '#44ff88',
    bool: '#ffcc00',
    int: '#88aaff',
    entity: '#ff44cc',
    vec3: '#44ccff',
  },
}));

vi.mock('@xyflow/react', () => ({
  Handle: (props: Record<string, unknown>) => (
    <div data-testid={`handle-${props.id}`} data-type={props.type} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}));

function makeNodeProps(nodeType: string, selected = false) {
  return {
    id: 'node-1',
    type: 'custom',
    data: { nodeType },
    selected,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('CustomNode', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders unknown node fallback when no definition found', () => {
    render(<CustomNode {...makeNodeProps('unknown_type')} />);
    expect(screen.getByText('Unknown: unknown_type')).not.toBeNull();
  });

  it('renders node label from definition', () => {
    render(<CustomNode {...makeNodeProps('on_start')} />);
    expect(screen.getByText('On Start')).not.toBeNull();
  });

  it('renders node label for print_log', () => {
    render(<CustomNode {...makeNodeProps('print_log')} />);
    expect(screen.getByText('Print Log')).not.toBeNull();
  });

  it('renders input port names', () => {
    render(<CustomNode {...makeNodeProps('print_log')} />);
    expect(screen.getByText('Message')).not.toBeNull();
  });

  it('renders output port Exec Out', () => {
    render(<CustomNode {...makeNodeProps('on_start')} />);
    expect(screen.getByText('Exec Out')).not.toBeNull();
  });

  it('renders target handles for inputs', () => {
    render(<CustomNode {...makeNodeProps('print_log')} />);
    const inputHandle = screen.getByTestId('handle-exec_in');
    expect(inputHandle.getAttribute('data-type')).toBe('target');
  });

  it('renders source handles for outputs', () => {
    render(<CustomNode {...makeNodeProps('on_start')} />);
    const outputHandle = screen.getByTestId('handle-exec_out');
    expect(outputHandle.getAttribute('data-type')).toBe('source');
  });

  it('applies blue border class when selected', () => {
    const { container } = render(<CustomNode {...makeNodeProps('on_start', true)} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper?.className).toContain('border-blue-500');
  });

  it('does not apply blue border when not selected', () => {
    const { container } = render(<CustomNode {...makeNodeProps('on_start', false)} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper?.className).toContain('border-zinc-700');
  });
});
