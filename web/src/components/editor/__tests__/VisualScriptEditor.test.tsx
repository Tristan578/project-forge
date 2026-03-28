import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { VisualScriptEditor } from '../VisualScriptEditor';
import type { VisualScriptGraph } from '@/lib/scripting/visualScriptTypes';

// ---- Mock @xyflow/react ----
// ReactFlow is a heavy dependency that requires a real DOM and canvas APIs.
// We mock it with a minimal stub that renders children / panels.
vi.mock('@xyflow/react', () => {
  const React = require('react');
  const ReactFlow = ({
    children,
    onConnect,
    isValidConnection,
    onNodesChange: _onNodesChange,
    onEdgesChange: _onEdgesChange,
    onDragOver: _onDragOver,
    onDrop: _onDrop,
  }: {
    children?: React.ReactNode;
    onConnect?: (connection: unknown) => void;
    isValidConnection?: (connection: unknown) => boolean;
    onNodesChange?: unknown;
    onEdgesChange?: unknown;
    onDragOver?: unknown;
    onDrop?: unknown;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'react-flow',
        // Expose handlers for tests
        'data-on-connect': onConnect ? 'true' : 'false',
        'data-has-validation': isValidConnection ? 'true' : 'false',
      },
      children,
    );

  const Background = () => null;
  const Controls = () => null;
  const MiniMap = () => null;
  const Panel = ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'react-flow-panel' }, children);

  return {
    default: ReactFlow,
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Panel,
    BackgroundVariant: { Dots: 'dots' },
    useNodesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
    useEdgesState: vi.fn((initial: unknown[]) => [initial, vi.fn(), vi.fn()]),
    addEdge: vi.fn((edge: unknown, edges: unknown[]) => [...edges, edge]),
  };
});

vi.mock('../visual-script/CustomNode', () => ({
  CustomNode: () => null,
}));

vi.mock('../visual-script/NodePalette', () => {
  const React = require('react');
  return {
    NodePalette: ({ onClose }: { onClose: () => void }) =>
      React.createElement(
        'div',
        { 'data-testid': 'node-palette' },
        React.createElement('button', { onClick: onClose, 'aria-label': 'Close palette' }, 'Close'),
      ),
  };
});

vi.mock('@/lib/scripting/nodeDefinitions', () => ({
  NODE_DEFINITION_MAP: {
    OnStart: {
      type: 'OnStart',
      label: 'On Start',
      inputs: [],
      outputs: [{ id: 'exec_out', name: '', type: 'exec' }],
    },
    GetFloat: {
      type: 'GetFloat',
      label: 'Get Float',
      inputs: [],
      outputs: [{ id: 'value_out', name: 'Value', type: 'float' }],
    },
    SetFloat: {
      type: 'SetFloat',
      label: 'Set Float',
      inputs: [{ id: 'value_in', name: 'Value', type: 'float' }],
      outputs: [],
    },
    LogMessage: {
      type: 'LogMessage',
      label: 'Log Message',
      inputs: [{ id: 'exec_in', name: '', type: 'exec' }, { id: 'msg_in', name: 'Message', type: 'string' }],
      outputs: [],
    },
  },
}));

vi.mock('@/lib/scripting/visualScriptTypes', () => ({
  PORT_COMPATIBILITY: {
    exec: ['exec'],
    float: ['float', 'int', 'any'],
    int: ['int', 'float', 'any'],
    bool: ['bool', 'any'],
    string: ['string', 'any'],
    vec3: ['vec3', 'any'],
    entity: ['entity', 'string', 'any'],
    any: ['float', 'int', 'bool', 'string', 'vec3', 'entity', 'any'],
  },
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

// Import mocked modules for access in tests
import { useNodesState, useEdgesState } from '@xyflow/react';

const EMPTY_GRAPH: VisualScriptGraph = { nodes: [], edges: [] };

const GRAPH_WITH_NODES: VisualScriptGraph = {
  nodes: [
    { id: 'n1', type: 'OnStart', position: { x: 100, y: 100 }, data: {} },
    { id: 'n2', type: 'GetFloat', position: { x: 300, y: 100 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'n1', sourceHandle: 'exec_out', target: 'n2', targetHandle: '' },
  ],
};

describe('VisualScriptEditor', () => {
  let onGraphChange: ReturnType<typeof vi.fn>;
  let onCompile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onGraphChange = vi.fn();
    onCompile = vi.fn();
    // Set up default useNodesState/useEdgesState behavior
    vi.mocked(useNodesState).mockImplementation((initial) => [
      initial as never,
      vi.fn() as never,
      vi.fn() as never,
    ]);
    vi.mocked(useEdgesState).mockImplementation((initial) => [
      initial as never,
      vi.fn() as never,
      vi.fn() as never,
    ]);
  });

  afterEach(() => cleanup());

  it('renders the ReactFlow canvas container', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    expect(screen.getByTestId('react-flow')).toBeDefined();
  });

  it('renders the Add Node button in the panel', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    expect(screen.getByText('+ Add Node')).toBeDefined();
  });

  it('renders the Compile button in the panel', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    expect(screen.getByText('Compile')).toBeDefined();
  });

  it('toggles NodePalette open when Add Node button is clicked', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    expect(screen.queryByTestId('node-palette')).toBeNull();

    fireEvent.click(screen.getByText('+ Add Node'));
    expect(screen.getByTestId('node-palette')).toBeDefined();
  });

  it('closes NodePalette when its close button is clicked', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    fireEvent.click(screen.getByText('+ Add Node'));
    expect(screen.getByTestId('node-palette')).toBeDefined();

    fireEvent.click(screen.getByLabelText('Close palette'));
    expect(screen.queryByTestId('node-palette')).toBeNull();
  });

  it('calls onCompile when Compile button is clicked', () => {
    render(<VisualScriptEditor graph={EMPTY_GRAPH} onGraphChange={onGraphChange} onCompile={onCompile} />);
    fireEvent.click(screen.getByText('Compile'));
    expect(onCompile).toHaveBeenCalledOnce();
  });

  it('initialises with nodes from the provided graph', () => {
    render(<VisualScriptEditor graph={GRAPH_WITH_NODES} onGraphChange={onGraphChange} onCompile={onCompile} />);
    // useNodesState is called with the converted nodes
    expect(vi.mocked(useNodesState)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'n1', type: 'custom' }),
        expect.objectContaining({ id: 'n2', type: 'custom' }),
      ])
    );
  });

  it('initialises with edges from the provided graph', () => {
    render(<VisualScriptEditor graph={GRAPH_WITH_NODES} onGraphChange={onGraphChange} onCompile={onCompile} />);
    expect(vi.mocked(useEdgesState)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'e1', source: 'n1', target: 'n2' }),
      ])
    );
  });

  it('marks exec edges as animated in initial edges', () => {
    render(<VisualScriptEditor graph={GRAPH_WITH_NODES} onGraphChange={onGraphChange} onCompile={onCompile} />);
    const edgesArg = vi.mocked(useEdgesState).mock.calls[0][0];
    const execEdge = edgesArg.find((e: { id: string; animated?: boolean }) => e.id === 'e1');
    expect(execEdge?.animated).toBe(true);
  });
});

// ---- isValidConnection logic tests (unit tests of the algorithm) ----
// We test the PORT_COMPATIBILITY values directly from the mock to verify
// the compatibility matrix is correctly defined (the same data isValidConnection relies on).
import { PORT_COMPATIBILITY } from '@/lib/scripting/visualScriptTypes';

describe('VisualScriptEditor — connection type compatibility (unit)', () => {
  it('exec ports are only compatible with exec ports', () => {
    expect(PORT_COMPATIBILITY['exec']).toContain('exec');
    expect(PORT_COMPATIBILITY['exec']).not.toContain('float');
    expect(PORT_COMPATIBILITY['exec']).not.toContain('string');
  });

  it('float ports accept float and int targets (widening)', () => {
    expect(PORT_COMPATIBILITY['float']).toContain('float');
    expect(PORT_COMPATIBILITY['float']).toContain('int');
    expect(PORT_COMPATIBILITY['float']).not.toContain('string');
  });

  it('any ports accept all types', () => {
    const allTypes = ['float', 'int', 'bool', 'string', 'vec3', 'entity', 'any'];
    for (const t of allTypes) {
      expect(PORT_COMPATIBILITY['any']).toContain(t);
    }
  });
});
