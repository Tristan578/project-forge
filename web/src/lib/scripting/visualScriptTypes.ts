// === Port Types ===
export type PortType = 'exec' | 'float' | 'int' | 'bool' | 'string' | 'vec3' | 'entity' | 'any';

export interface PortDefinition {
  id: string;
  name: string;
  type: PortType;
  defaultValue?: unknown;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  color: string;  // hex color for the node header
}

export type NodeCategory =
  | 'events' | 'flow' | 'math' | 'transform' | 'physics'
  | 'input' | 'audio' | 'state' | 'entity' | 'ui';

// === Graph Data ===
export interface VisualScriptGraph {
  nodes: VisualScriptNode[];
  edges: VisualScriptEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface VisualScriptNode {
  id: string;
  type: string;           // matches NodeDefinition.type
  position: { x: number; y: number };
  data: Record<string, unknown>;  // port values / inline properties
}

export interface VisualScriptEdge {
  id: string;
  source: string;         // source node ID
  sourceHandle: string;   // output port ID
  target: string;         // target node ID
  targetHandle: string;   // input port ID
}

// === Compiler Output ===
export interface CompileResult {
  success: boolean;
  code: string;
  errors: CompileError[];
  warnings: CompileWarning[];
}

export interface CompileError {
  nodeId: string;
  message: string;
}

export interface CompileWarning {
  nodeId: string;
  message: string;
}

// Port type compatibility matrix
export const PORT_COMPATIBILITY: Record<PortType, PortType[]> = {
  exec: ['exec'],
  float: ['float', 'int', 'any'],
  int: ['int', 'float', 'any'],
  bool: ['bool', 'any'],
  string: ['string', 'any'],
  vec3: ['vec3', 'any'],
  entity: ['entity', 'string', 'any'],
  any: ['float', 'int', 'bool', 'string', 'vec3', 'entity', 'any'],
};

// Port type colors for the UI
export const PORT_COLORS: Record<PortType, string> = {
  exec: '#ffffff',
  float: '#4ade80',   // green
  int: '#60a5fa',     // blue
  bool: '#f87171',    // red
  string: '#fbbf24',  // yellow
  vec3: '#c084fc',    // purple
  entity: '#fb923c',  // orange
  any: '#94a3b8',     // gray
};

// Category colors for node headers
export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  events: '#dc2626',
  flow: '#6366f1',
  math: '#16a34a',
  transform: '#0891b2',
  physics: '#d97706',
  input: '#9333ea',
  audio: '#db2777',
  state: '#0d9488',
  entity: '#ea580c',
  ui: '#2563eb',
};
