'use client';

import { useCallback, useMemo, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CustomNode } from './visual-script/CustomNode';
import { NodePalette } from './visual-script/NodePalette';
import { NODE_DEFINITION_MAP } from '@/lib/scripting/nodeDefinitions';
import { PORT_COMPATIBILITY } from '@/lib/scripting/visualScriptTypes';
import type { VisualScriptGraph } from '@/lib/scripting/visualScriptTypes';

interface VisualScriptEditorProps {
  graph: VisualScriptGraph;
  onGraphChange: (graph: VisualScriptGraph) => void;
  onCompile: () => void;
}

export function VisualScriptEditor({ graph, onGraphChange, onCompile }: VisualScriptEditorProps) {
  // Convert graph to React Flow format
  const initialNodes = useMemo(() => graph.nodes.map(n => ({
    id: n.id,
    type: 'custom',
    position: n.position,
    data: { ...n.data, nodeType: n.type },
  })), [graph.nodes]);

  const initialEdges = useMemo(() => graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourceHandle,
    target: e.target,
    targetHandle: e.targetHandle,
    animated: e.sourceHandle?.startsWith('exec') || false,
    style: { stroke: e.sourceHandle?.startsWith('exec') ? '#fff' : '#4ade80' },
  })), [graph.edges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const nodeTypes: NodeTypes = useMemo(() => ({
    custom: CustomNode,
  }), []);

  // Connection validation
  const isValidConnection = useCallback((connection: Connection) => {
    if (!connection.sourceHandle || !connection.targetHandle) return false;

    // Get source and target node definitions
    const sourceNode = nodes.find(n => n.id === connection.source);
    const targetNode = nodes.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    const sourceDef = NODE_DEFINITION_MAP[sourceNode.data.nodeType as string];
    const targetDef = NODE_DEFINITION_MAP[targetNode.data.nodeType as string];
    if (!sourceDef || !targetDef) return false;

    const sourcePort = sourceDef.outputs.find(p => p.id === connection.sourceHandle);
    const targetPort = targetDef.inputs.find(p => p.id === connection.targetHandle);
    if (!sourcePort || !targetPort) return false;

    // Check type compatibility
    return PORT_COMPATIBILITY[sourcePort.type]?.includes(targetPort.type) || false;
  }, [nodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges(eds => addEdge({
      ...connection,
      animated: connection.sourceHandle?.startsWith('exec') || false,
      style: { stroke: connection.sourceHandle?.startsWith('exec') ? '#fff' : '#4ade80' },
    }, eds));
  }, [setEdges]);

  // Sync back to parent
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    // Debounce graph change notification
  }, [onNodesChange]);

  // Save current state to graph
  const saveGraph = useCallback(() => {
    const graphData: VisualScriptGraph = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: (n.data.nodeType as string) || n.type || 'unknown',
        position: n.position,
        data: { ...n.data },
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle || '',
        target: e.target,
        targetHandle: e.targetHandle || '',
      })),
    };
    onGraphChange(graphData);
  }, [nodes, edges, onGraphChange]);

  // Drop handler for palette drag-and-drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow');
    if (!nodeType || !reactFlowWrapper.current) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left - 100,
      y: event.clientY - bounds.top - 20,
    };

    const newNode = {
      id: `node_${Date.now()}`,
      type: 'custom' as const,
      position,
      data: { nodeType },
    };

    setNodes(nds => [...nds, newNode]);
  }, [setNodes]);

  return (
    <div ref={reactFlowWrapper} className="h-full w-full" style={{ background: '#18181b' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={15} size={1} color="#333" />
        <Controls className="!bg-zinc-800 !border-zinc-700 [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-700" />
        <MiniMap
          className="!bg-zinc-800 !border-zinc-700"
          nodeColor="#4ade80"
          maskColor="rgba(0,0,0,0.7)"
        />
        <Panel position="top-left">
          <div className="flex gap-1">
            <button
              onClick={() => setPaletteOpen(!paletteOpen)}
              className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 border border-zinc-700 hover:bg-zinc-700"
            >
              + Add Node
            </button>
            <button
              onClick={() => { saveGraph(); onCompile(); }}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
            >
              Compile
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {paletteOpen && (
        <NodePalette onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}
