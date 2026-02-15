/**
 * Shader Editor Panel
 * Visual shader graph editor using React Flow.
 */

'use client';

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
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
  type IsValidConnection,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ShaderNodeBase } from './shader-nodes/ShaderNodeBase';
import { ShaderNodePalette } from './shader-nodes/ShaderNodePalette';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';
import { SHADER_PORT_COMPATIBILITY, SHADER_NODE_DEFINITIONS } from '@/lib/shaders/shaderNodeTypes';
import { compileToWgsl } from '@/lib/shaders/wgslCompiler';
import { X, Save, Code } from 'lucide-react';

export function ShaderEditorPanel() {
  const {
    isOpen,
    activeGraphId,
    graphs,
    closeShaderEditor,
    addNode,
    updateNodePosition,
    addEdge: addEdgeToStore,
    saveGraph,
  } = useShaderEditorStore();

  const [paletteOpen, setPaletteOpen] = React.useState(true);
  const [showCode, setShowCode] = React.useState(false);
  const [compiledCode, setCompiledCode] = React.useState('');
  const [compileError, setCompileError] = React.useState<string | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Get active graph
  const activeGraph = activeGraphId ? graphs[activeGraphId] : null;

  // Convert graph to React Flow format
  const initialNodes = useMemo<Node[]>(() => {
    if (!activeGraph) return [];
    return activeGraph.nodes.map((n) => ({
      id: n.id,
      type: 'shader',
      position: n.position,
      data: { nodeType: n.type, ...n.data },
    }));
  }, [activeGraph]);

  const initialEdges = useMemo<Edge[]>(() => {
    if (!activeGraph) return [];
    return activeGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      animated: false,
      style: { stroke: '#4ade80', strokeWidth: 2 },
    }));
  }, [activeGraph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync React Flow state back to store when nodes move
  useEffect(() => {
    nodes.forEach((node) => {
      const graphNode = activeGraph?.nodes.find((n) => n.id === node.id);
      if (graphNode && (graphNode.position.x !== node.position.x || graphNode.position.y !== node.position.y)) {
        updateNodePosition(node.id, node.position);
      }
    });
  }, [nodes, activeGraph, updateNodePosition]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      shader: ShaderNodeBase,
    }),
    []
  );

  // Connection validation based on type compatibility
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const sourceHandle = connection.sourceHandle ?? null;
      const targetHandle = connection.targetHandle ?? null;

      if (!sourceHandle || !targetHandle) return false;

      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      // Get node types from definitions
      const sourceDef = SHADER_NODE_DEFINITIONS[sourceNode.data?.nodeType as string];
      const targetDef = SHADER_NODE_DEFINITIONS[targetNode.data?.nodeType as string];
      if (!sourceDef || !targetDef) return false;

      const sourcePort = sourceDef.outputs.find((p: { id: string; type: string }) => p.id === sourceHandle);
      const targetPort = targetDef.inputs.find((p: { id: string; type: string }) => p.id === targetHandle);
      if (!sourcePort || !targetPort) return false;

      // Check type compatibility
      const compat = SHADER_PORT_COMPATIBILITY[sourcePort.type as keyof typeof SHADER_PORT_COMPATIBILITY];
      return compat?.includes(targetPort.type as never) || false;
    },
    [nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: false,
            style: { stroke: '#4ade80', strokeWidth: 2 },
          },
          eds
        )
      );

      addEdgeToStore({
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
      });
    },
    [setEdges, addEdgeToStore]
  );

  // Drag and drop handlers
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = {
        x: event.clientX - bounds.left - 100,
        y: event.clientY - bounds.top - 20,
      };

      const newNodeId = addNode(nodeType, position);

      // Add to React Flow immediately
      const newNode: Node = {
        id: newNodeId,
        type: 'shader',
        position,
        data: { nodeType },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [addNode, setNodes]
  );

  // Compile shader
  const handleCompile = useCallback(() => {
    if (!activeGraph) return;

    const result = compileToWgsl(activeGraph);
    if (result.error) {
      setCompileError(result.error);
      setCompiledCode('');
    } else {
      setCompiledCode(result.code);
      setCompileError(null);
    }
    setShowCode(true);
  }, [activeGraph]);

  // Save graph
  const handleSave = useCallback(() => {
    const name = activeGraph?.name || 'Untitled Shader';
    saveGraph(name);
  }, [activeGraph, saveGraph]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-900 px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-300">Shader Editor</h2>
          <span className="text-xs text-zinc-500">{activeGraph?.name || 'Untitled'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            <Save className="h-3 w-3" />
            Save
          </button>
          <button
            onClick={handleCompile}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
          >
            <Code className="h-3 w-3" />
            Compile
          </button>
          <button
            onClick={closeShaderEditor}
            className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={reactFlowWrapper} className="relative flex-1">
        {paletteOpen && <ShaderNodePalette onClose={() => setPaletteOpen(false)} />}

        <div className={`h-full ${paletteOpen ? 'ml-64' : ''}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
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
            <MiniMap className="!bg-zinc-800 !border-zinc-700" nodeColor="#4ade80" maskColor="rgba(0,0,0,0.7)" />

            {!paletteOpen && (
              <Panel position="top-left">
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 border border-zinc-700 hover:bg-zinc-700"
                >
                  + Add Node
                </button>
              </Panel>
            )}
          </ReactFlow>
        </div>

        {/* Code preview modal */}
        {showCode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
            <div className="max-h-[80vh] w-[800px] max-w-[90vw] rounded border border-zinc-700 bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2">
                <h3 className="text-sm font-semibold text-zinc-300">Compiled WGSL Code</h3>
                <button
                  onClick={() => setShowCode(false)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-auto p-4" style={{ maxHeight: 'calc(80vh - 60px)' }}>
                {compileError ? (
                  <div className="rounded bg-red-950/30 border border-red-800 px-3 py-2 text-sm text-red-400">
                    {compileError}
                  </div>
                ) : (
                  <pre className="text-xs text-zinc-300 font-mono">{compiledCode}</pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
