// Behavior Tree DSL — English description to NPC behavior logic
// Converts natural language descriptions into executable behavior tree structures
// that compile to TypeScript scripts for the SpawnForge script worker.

import { AI_MODEL_FAST } from './models';
import { fetchAI } from './client';

// ---- Types ----

export type BehaviorNodeType =
  | 'sequence'
  | 'selector'
  | 'parallel'
  | 'condition'
  | 'action'
  | 'decorator'
  | 'inverter'
  | 'repeater';

export interface BehaviorNode {
  id: string;
  type: BehaviorNodeType;
  name: string;
  children?: BehaviorNode[];
  params?: Record<string, unknown>;
}

export type BehaviorVariableType = 'number' | 'boolean' | 'string' | 'vector3';

export interface BehaviorVariable {
  name: string;
  type: BehaviorVariableType;
  defaultValue: unknown;
}

export interface BehaviorTree {
  name: string;
  description: string;
  root: BehaviorNode;
  variables: BehaviorVariable[];
}

// ---- Validation ----

const VALID_NODE_TYPES: ReadonlySet<string> = new Set<BehaviorNodeType>([
  'sequence',
  'selector',
  'parallel',
  'condition',
  'action',
  'decorator',
  'inverter',
  'repeater',
]);

const VALID_VARIABLE_TYPES: ReadonlySet<string> = new Set<BehaviorVariableType>([
  'number',
  'boolean',
  'string',
  'vector3',
]);

const MAX_TREE_DEPTH = 10;

export function isValidNodeType(type: string): type is BehaviorNodeType {
  return VALID_NODE_TYPES.has(type);
}

export function isValidVariableType(type: string): type is BehaviorVariableType {
  return VALID_VARIABLE_TYPES.has(type);
}

/** Validate a behavior node and its children recursively */
export function validateNode(node: BehaviorNode, depth: number = 0): string[] {
  const errors: string[] = [];

  if (depth > MAX_TREE_DEPTH) {
    errors.push(`Tree exceeds maximum depth of ${MAX_TREE_DEPTH}`);
    return errors;
  }

  if (!node.id || typeof node.id !== 'string') {
    errors.push('Node missing required "id" field');
  }

  if (!isValidNodeType(node.type)) {
    errors.push(`Invalid node type: "${node.type}"`);
  }

  if (!node.name || typeof node.name !== 'string') {
    errors.push('Node missing required "name" field');
  }

  // Composite nodes should have children
  const compositeTypes: ReadonlySet<string> = new Set(['sequence', 'selector', 'parallel']);
  if (compositeTypes.has(node.type) && (!node.children || node.children.length === 0)) {
    errors.push(`Composite node "${node.name}" (${node.type}) must have at least one child`);
  }

  // Decorator/inverter/repeater should have exactly one child
  const singleChildTypes: ReadonlySet<string> = new Set(['decorator', 'inverter', 'repeater']);
  if (singleChildTypes.has(node.type)) {
    if (!node.children || node.children.length !== 1) {
      errors.push(`Node "${node.name}" (${node.type}) must have exactly one child`);
    }
  }

  // Leaf nodes should not have children
  const leafTypes: ReadonlySet<string> = new Set(['condition', 'action']);
  if (leafTypes.has(node.type) && node.children && node.children.length > 0) {
    errors.push(`Leaf node "${node.name}" (${node.type}) should not have children`);
  }

  // Validate children recursively
  if (node.children) {
    for (const child of node.children) {
      errors.push(...validateNode(child, depth + 1));
    }
  }

  return errors;
}

/** Collect all node IDs from a tree recursively */
function collectNodeIds(node: BehaviorNode): string[] {
  const ids: string[] = [];
  if (node.id) ids.push(node.id);
  if (node.children) {
    for (const child of node.children) {
      ids.push(...collectNodeIds(child));
    }
  }
  return ids;
}

/** Validate an entire behavior tree */
export function validateTree(tree: BehaviorTree): string[] {
  const errors: string[] = [];

  if (!tree.name || typeof tree.name !== 'string') {
    errors.push('Tree missing required "name" field');
  }

  if (!tree.root) {
    errors.push('Tree missing required "root" node');
    return errors;
  }

  errors.push(...validateNode(tree.root));

  // Validate node ID uniqueness — duplicate IDs cause variable name collisions
  // in generateNodeCode() and produce a SyntaxError when the script runs.
  const allIds = collectNodeIds(tree.root);
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) {
      errors.push(`Duplicate node ID: "${id}" — all node IDs must be unique`);
    }
    seen.add(id);
  }

  // Validate variables
  if (tree.variables) {
    for (const v of tree.variables) {
      if (!v.name || typeof v.name !== 'string') {
        errors.push('Variable missing required "name" field');
      }
      if (!isValidVariableType(v.type)) {
        errors.push(`Invalid variable type: "${v.type}" for variable "${v.name}"`);
      }
    }
  }

  return errors;
}

// ---- ID Generation ----

let nodeCounter = 0;

export function generateNodeId(): string {
  nodeCounter++;
  return `bt_${nodeCounter}`;
}

export function resetNodeCounter(): void {
  nodeCounter = 0;
}

// ---- Helper constructors ----

function makeNode(
  type: BehaviorNodeType,
  name: string,
  children?: BehaviorNode[],
  params?: Record<string, unknown>
): BehaviorNode {
  return {
    id: generateNodeId(),
    type,
    name,
    ...(children ? { children } : {}),
    ...(params ? { params } : {}),
  };
}

function action(name: string, params?: Record<string, unknown>): BehaviorNode {
  return makeNode('action', name, undefined, params);
}

function condition(name: string, params?: Record<string, unknown>): BehaviorNode {
  return makeNode('condition', name, undefined, params);
}

function sequence(name: string, children: BehaviorNode[]): BehaviorNode {
  return makeNode('sequence', name, children);
}

function selector(name: string, children: BehaviorNode[]): BehaviorNode {
  return makeNode('selector', name, children);
}

function inverter(name: string, child: BehaviorNode): BehaviorNode {
  return makeNode('inverter', name, [child]);
}

function repeater(name: string, child: BehaviorNode, params?: Record<string, unknown>): BehaviorNode {
  return makeNode('repeater', name, [child], params);
}

// ---- Preset Behavior Trees ----

function createPatrolPreset(): BehaviorTree {
  resetNodeCounter();
  return {
    name: 'Patrol',
    description: 'Move between two patrol points with a wait at each',
    root: repeater('repeat_patrol', sequence('patrol_loop', [
      action('move_to_a', { target: 'pointA' }),
      action('wait', { duration: 2 }),
      action('move_to_b', { target: 'pointB' }),
      action('wait', { duration: 2 }),
    ])),
    variables: [
      { name: 'pointA', type: 'vector3', defaultValue: { x: -5, y: 0, z: 0 } },
      { name: 'pointB', type: 'vector3', defaultValue: { x: 5, y: 0, z: 0 } },
      { name: 'moveSpeed', type: 'number', defaultValue: 3 },
      { name: 'waitDuration', type: 'number', defaultValue: 2 },
    ],
  };
}

function createChasePlayerPreset(): BehaviorTree {
  resetNodeCounter();
  return {
    name: 'Chase Player',
    description: 'Detect and chase the player when they get close',
    root: selector('chase_root', [
      sequence('chase_sequence', [
        condition('player_near', { range: 10 }),
        action('face_player'),
        action('move_toward_player', { speed: 5 }),
      ]),
      action('idle'),
    ]),
    variables: [
      { name: 'detectionRange', type: 'number', defaultValue: 10 },
      { name: 'chaseSpeed', type: 'number', defaultValue: 5 },
    ],
  };
}

function createFleePreset(): BehaviorTree {
  resetNodeCounter();
  return {
    name: 'Flee When Low Health',
    description: 'Retreat to safety when health drops below threshold',
    root: selector('flee_root', [
      sequence('flee_sequence', [
        inverter('not_healthy', condition('health_above', { threshold: 0.3 })),
        action('find_escape', { searchRadius: 20 }),
        action('move_to_escape', { speed: 6 }),
      ]),
      action('idle'),
    ]),
    variables: [
      { name: 'healthThreshold', type: 'number', defaultValue: 0.3 },
      { name: 'escapeRadius', type: 'number', defaultValue: 20 },
      { name: 'fleeSpeed', type: 'number', defaultValue: 6 },
    ],
  };
}

function createGuardAreaPreset(): BehaviorTree {
  resetNodeCounter();
  return {
    name: 'Guard Area',
    description: 'Guard an area — attack if enemies are close, chase if spotted, otherwise patrol',
    root: selector('guard_root', [
      sequence('attack_sequence', [
        condition('enemy_in_range', { range: 3 }),
        action('attack'),
      ]),
      sequence('chase_sequence', [
        condition('enemy_spotted', { range: 12 }),
        action('chase_enemy', { speed: 4 }),
      ]),
      repeater('patrol_loop', sequence('patrol_seq', [
        action('move_to_a', { target: 'pointA' }),
        action('wait', { duration: 1.5 }),
        action('move_to_b', { target: 'pointB' }),
        action('wait', { duration: 1.5 }),
      ])),
    ]),
    variables: [
      { name: 'attackRange', type: 'number', defaultValue: 3 },
      { name: 'spotRange', type: 'number', defaultValue: 12 },
      { name: 'pointA', type: 'vector3', defaultValue: { x: -4, y: 0, z: 0 } },
      { name: 'pointB', type: 'vector3', defaultValue: { x: 4, y: 0, z: 0 } },
    ],
  };
}

function createCollectItemsPreset(): BehaviorTree {
  resetNodeCounter();
  return {
    name: 'Collect Items',
    description: 'Find and collect the nearest item',
    root: sequence('collect_root', [
      action('find_nearest_item'),
      action('move_to_item', { speed: 3 }),
      action('pickup_item'),
    ]),
    variables: [
      { name: 'collectSpeed', type: 'number', defaultValue: 3 },
      { name: 'searchRadius', type: 'number', defaultValue: 15 },
    ],
  };
}

export const BEHAVIOR_PRESETS: Record<string, () => BehaviorTree> = {
  patrol: createPatrolPreset,
  chase_player: createChasePlayerPreset,
  flee_when_low_health: createFleePreset,
  guard_area: createGuardAreaPreset,
  collect_items: createCollectItemsPreset,
};

/** Get a preset by key (returns a fresh copy each time) */
export function getPreset(key: string): BehaviorTree | null {
  const factory = BEHAVIOR_PRESETS[key];
  return factory ? factory() : null;
}

// ---- Script Generation ----

/** Indentation helper */
function indent(code: string, level: number): string {
  const prefix = '  '.repeat(level);
  return code
    .split('\n')
    .map((line) => (line.trim() ? prefix + line : ''))
    .join('\n');
}

/** Generate the runtime tick function for a single node */
function generateNodeCode(node: BehaviorNode, level: number = 1): string {
  const varName = `status_${node.id}`;

  switch (node.type) {
    case 'action': {
      const paramsStr = node.params ? JSON.stringify(node.params) : '{}';
      return indent(
        `// Action: ${node.name}\nconst ${varName} = actions["${node.name}"]?.(${paramsStr}) ?? "success";`,
        level
      );
    }
    case 'condition': {
      const paramsStr = node.params ? JSON.stringify(node.params) : '{}';
      return indent(
        `// Condition: ${node.name}\nconst ${varName} = conditions["${node.name}"]?.(${paramsStr}) ? "success" : "failure";`,
        level
      );
    }
    case 'sequence': {
      const childCode = (node.children ?? [])
        .map((child, i) => {
          const childGen = generateNodeCode(child, level + 1);
          const childVar = `status_${child.id}`;
          const bailLine = indent(`if (${childVar} !== "success") return ${childVar};`, level + 1);
          return i < (node.children?.length ?? 0) - 1 ? `${childGen}\n${bailLine}` : childGen;
        })
        .join('\n');
      const lastChild = node.children?.[node.children.length - 1];
      const lastVar = lastChild ? `status_${lastChild.id}` : '"success"';
      return indent(`// Sequence: ${node.name}\n`, level) + childCode + '\n' + indent(`const ${varName} = ${lastVar};`, level);
    }
    case 'selector': {
      const childCode = (node.children ?? [])
        .map((child, i) => {
          const childGen = generateNodeCode(child, level + 1);
          const childVar = `status_${child.id}`;
          const bailLine = indent(`if (${childVar} === "success") return "success";`, level + 1);
          return i < (node.children?.length ?? 0) - 1 ? `${childGen}\n${bailLine}` : childGen;
        })
        .join('\n');
      const lastChild = node.children?.[node.children.length - 1];
      const lastVar = lastChild ? `status_${lastChild.id}` : '"failure"';
      return indent(`// Selector: ${node.name}\n`, level) + childCode + '\n' + indent(`const ${varName} = ${lastVar};`, level);
    }
    case 'inverter': {
      const child = node.children?.[0];
      if (!child) return indent(`const ${varName} = "failure"; // inverter with no child`, level);
      const childCode = generateNodeCode(child, level);
      const childVar = `status_${child.id}`;
      return (
        childCode +
        '\n' +
        indent(`const ${varName} = ${childVar} === "success" ? "failure" : "success";`, level)
      );
    }
    case 'repeater': {
      const child = node.children?.[0];
      if (!child) return indent(`const ${varName} = "success"; // repeater with no child`, level);
      const childCode = generateNodeCode(child, level);
      // Repeater always returns "running" (it re-ticks on next frame)
      return childCode + '\n' + indent(`const ${varName} = "running";`, level);
    }
    case 'decorator': {
      const child = node.children?.[0];
      if (!child) return indent(`const ${varName} = "success"; // decorator with no child`, level);
      const childCode = generateNodeCode(child, level);
      const childVar = `status_${child.id}`;
      return childCode + '\n' + indent(`const ${varName} = ${childVar}; // decorator pass-through`, level);
    }
    case 'parallel': {
      const childCode = (node.children ?? [])
        .map((child) => generateNodeCode(child, level + 1))
        .join('\n');
      const childVars = (node.children ?? []).map((c) => `status_${c.id}`);
      const allSuccessCheck = childVars.map((v) => `${v} === "success"`).join(' && ');
      return (
        indent(`// Parallel: ${node.name}\n`, level) +
        childCode +
        '\n' +
        indent(
          `const ${varName} = (${allSuccessCheck || 'true'}) ? "success" : "running";`,
          level
        )
      );
    }
    default:
      return indent(`const ${varName} = "failure"; // unknown type: ${node.type}`, level);
  }
}

/** Collect all node IDs in a tree, throwing on duplicates (PF-307). */
function validateNodeIdUniqueness(node: BehaviorNode, seen = new Set<string>()): void {
  if (seen.has(node.id)) {
    throw new Error(`Duplicate behavior tree node ID: "${node.id}". Each node must have a unique ID.`);
  }
  seen.add(node.id);
  for (const child of node.children ?? []) {
    validateNodeIdUniqueness(child, seen);
  }
}

/** Convert a BehaviorTree to an executable TypeScript script for SpawnForge */
export function behaviorTreeToScript(tree: BehaviorTree): string {
  validateNodeIdUniqueness(tree.root);

  // Generate variable declarations — include defaults for all action-referenced
  // variables to prevent ReferenceError when actions reference variables from
  // presets other than the one selected.
  const declaredNames = new Set(tree.variables.map((v) => v.name));
  const fallbackVars: Record<string, unknown> = {
    pointA: null, pointB: null, moveSpeed: 3, waitDuration: 2,
    chaseSpeed: 5, detectionRange: 10, healthThreshold: 0.3,
    attackRange: 3, spotRange: 12,
  };
  const varDecls = [
    ...tree.variables.map((v) => {
      const val = JSON.stringify(v.defaultValue);
      return `let ${v.name} = ${val};`;
    }),
    ...Object.entries(fallbackVars)
      .filter(([name]) => !declaredNames.has(name))
      .map(([name, val]) => `let ${name} = ${JSON.stringify(val)};`),
  ].join('\n');

  // Generate the tree evaluation code
  const treeCode = generateNodeCode(tree.root, 1);
  const rootVar = `status_${tree.root.id}`;

  return `// Behavior Tree: ${tree.name}
// ${tree.description}
//
// Generated from behavior tree DSL. Edit variables below to customize.

${varDecls}

// Action implementations — customize these for your game
const actions = {
  move_to_a(params) {
    const target = pointA ?? params.target;
    if (!target) return "failure";
    const pos = forge.getTransform(entityId)?.position;
    if (!pos) return "failure";
    const tx = target.x ?? target[0] ?? 0;
    const tz = target.z ?? target[2] ?? 0;
    const dx = tx - pos[0];
    const dz = tz - pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.5) return "success";
    const s = (moveSpeed ?? 3) * forge.time.delta / dist;
    forge.translate(entityId, dx * s, 0, dz * s);
    return "running";
  },
  move_to_b(params) {
    const target = pointB ?? params.target;
    if (!target) return "failure";
    const pos = forge.getTransform(entityId)?.position;
    if (!pos) return "failure";
    const tx = target.x ?? target[0] ?? 0;
    const tz = target.z ?? target[2] ?? 0;
    const dx = tx - pos[0];
    const dz = tz - pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.5) return "success";
    const s = (moveSpeed ?? 3) * forge.time.delta / dist;
    forge.translate(entityId, dx * s, 0, dz * s);
    return "running";
  },
  wait(params) {
    const dur = params.duration ?? waitDuration ?? 2;
    if (!this._waitStart) this._waitStart = forge.time.elapsed;
    if (forge.time.elapsed - this._waitStart >= dur) {
      this._waitStart = null;
      return "success";
    }
    return "running";
  },
  idle() { return "running"; },
  face_player() {
    // Look toward player — stub for customization
    return "success";
  },
  move_toward_player(params) {
    const speed = params.speed ?? chaseSpeed ?? 5;
    // Move toward player — stub for customization
    void speed;
    return "running";
  },
  find_escape(params) {
    void params;
    return "success";
  },
  move_to_escape(params) {
    void params;
    return "running";
  },
  attack() { return "success"; },
  chase_enemy(params) { void params; return "running"; },
  find_nearest_item() { return "success"; },
  move_to_item(params) { void params; return "running"; },
  pickup_item() { return "success"; },
};

// Condition implementations — customize these for your game
const conditions = {
  player_near(params) {
    const range = params.range ?? detectionRange ?? 10;
    // Check if player is within range — stub for customization
    void range;
    return false;
  },
  health_above(params) {
    const threshold = params.threshold ?? healthThreshold ?? 0.3;
    // Check entity health — stub for customization
    void threshold;
    return true;
  },
  enemy_in_range(params) {
    const range = params.range ?? attackRange ?? 3;
    void range;
    return false;
  },
  enemy_spotted(params) {
    const range = params.range ?? spotRange ?? 12;
    void range;
    return false;
  },
};

function tickBehaviorTree() {
${treeCode}
  return ${rootVar};
}

function onUpdate(_dt) {
  tickBehaviorTree();
}
`;
}

// ---- AI Response Parsing ----

/** Parse AI-generated behavior tree JSON from a raw response string */
export function parseBehaviorTreeResponse(raw: string): BehaviorTree | null {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr) as BehaviorTree;

    // Basic structural validation
    if (!parsed.name || !parsed.root) {
      return null;
    }

    // Validate the tree
    const errors = validateTree(parsed);
    if (errors.length > 0) {
      console.warn('Behavior tree validation warnings:', errors);
    }

    // Ensure variables array exists
    if (!parsed.variables) {
      parsed.variables = [];
    }

    return parsed;
  } catch {
    return null;
  }
}

// ---- AI Generation ----

/** Build the system prompt for behavior tree generation */
export function buildBehaviorTreePrompt(description: string): string {
  return `You are a behavior tree designer for a game engine. Convert the following natural language description into a behavior tree JSON structure.

The behavior tree uses these node types:
- "sequence": Runs children in order; fails if any child fails
- "selector": Tries children in order; succeeds if any child succeeds
- "parallel": Runs all children simultaneously; succeeds when all succeed
- "condition": Checks a boolean condition (leaf node)
- "action": Performs an action (leaf node)
- "inverter": Inverts child result (single child)
- "repeater": Repeats child indefinitely (single child)
- "decorator": Modifies child behavior (single child)

Each node has: id (string, unique), type, name, children (array, optional), params (object, optional).
The tree has: name, description, root (node), variables (array of {name, type, defaultValue}).
Variable types: "number", "boolean", "string", "vector3" (vector3 default: {x, y, z}).

Description: "${description}"

Respond with ONLY valid JSON. No explanation, no markdown fences.`;
}

/** Generate a behavior tree from a natural language description using the AI chat API */
export async function generateBehaviorTree(description: string): Promise<BehaviorTree> {
  const prompt = buildBehaviorTreePrompt(description);

  const content = await fetchAI(prompt, {
    model: AI_MODEL_FAST,
    priority: 2,
  });

  const tree = parseBehaviorTreeResponse(content);
  if (!tree) {
    throw new Error('Failed to parse AI response into a valid behavior tree');
  }

  return tree;
}

/** Count total nodes in a behavior tree */
export function countNodes(node: BehaviorNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

/** Get the depth of a behavior tree */
export function getTreeDepth(node: BehaviorNode): number {
  if (!node.children || node.children.length === 0) return 1;
  let maxChildDepth = 0;
  for (const child of node.children) {
    maxChildDepth = Math.max(maxChildDepth, getTreeDepth(child));
  }
  return 1 + maxChildDepth;
}
