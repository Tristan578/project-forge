import type { NodeDefinition, NodeCategory } from './visualScriptTypes';
import { CATEGORY_COLORS } from './visualScriptTypes';

// === Events Category (8 nodes) ===
const eventsNodes: NodeDefinition[] = [
  {
    type: 'OnStart',
    label: 'On Start',
    category: 'events',
    description: 'Triggered once when the game starts',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnUpdate',
    label: 'On Update',
    category: 'events',
    description: 'Triggered every frame',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'dt', name: 'Delta Time', type: 'float' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnCollisionEnter',
    label: 'On Collision Enter',
    category: 'events',
    description: 'Triggered when this entity starts colliding with another',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'otherEntity', name: 'Other Entity', type: 'entity' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnCollisionExit',
    label: 'On Collision Exit',
    category: 'events',
    description: 'Triggered when this entity stops colliding with another',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'otherEntity', name: 'Other Entity', type: 'entity' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnTriggerEnter',
    label: 'On Trigger Enter',
    category: 'events',
    description: 'Triggered when another entity enters this trigger volume',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'otherEntity', name: 'Other Entity', type: 'entity' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnTriggerExit',
    label: 'On Trigger Exit',
    category: 'events',
    description: 'Triggered when another entity exits this trigger volume',
    inputs: [],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'otherEntity', name: 'Other Entity', type: 'entity' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnKeyPress',
    label: 'On Key Press',
    category: 'events',
    description: 'Triggered when a specific key is pressed',
    inputs: [
      { id: 'key', name: 'Key', type: 'string', defaultValue: 'Space' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.events,
  },
  {
    type: 'OnTimer',
    label: 'On Timer',
    category: 'events',
    description: 'Triggered at regular intervals',
    inputs: [
      { id: 'delay', name: 'Delay', type: 'float', defaultValue: 1.0 },
      { id: 'repeat', name: 'Repeat', type: 'bool', defaultValue: true },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.events,
  },
];

// === Flow Control (6 nodes) ===
const flowNodes: NodeDefinition[] = [
  {
    type: 'Branch',
    label: 'Branch',
    category: 'flow',
    description: 'Conditional execution based on a boolean value',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'condition', name: 'Condition', type: 'bool' },
    ],
    outputs: [
      { id: 'exec_true', name: 'True', type: 'exec' },
      { id: 'exec_false', name: 'False', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
  {
    type: 'ForLoop',
    label: 'For Loop',
    category: 'flow',
    description: 'Repeats execution for a range of integers',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'start', name: 'Start', type: 'int', defaultValue: 0 },
      { id: 'end', name: 'End', type: 'int', defaultValue: 10 },
    ],
    outputs: [
      { id: 'exec_body', name: 'Loop Body', type: 'exec' },
      { id: 'index', name: 'Index', type: 'int' },
      { id: 'exec_done', name: 'Done', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
  {
    type: 'WhileLoop',
    label: 'While Loop',
    category: 'flow',
    description: 'Repeats execution while a condition is true',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'condition', name: 'Condition', type: 'bool' },
    ],
    outputs: [
      { id: 'exec_body', name: 'Loop Body', type: 'exec' },
      { id: 'exec_done', name: 'Done', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
  {
    type: 'Sequence',
    label: 'Sequence',
    category: 'flow',
    description: 'Executes multiple outputs in sequence',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
    ],
    outputs: [
      { id: 'exec_out_1', name: 'Then 1', type: 'exec' },
      { id: 'exec_out_2', name: 'Then 2', type: 'exec' },
      { id: 'exec_out_3', name: 'Then 3', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
  {
    type: 'Delay',
    label: 'Delay',
    category: 'flow',
    description: 'Waits for a specified number of seconds before continuing',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'seconds', name: 'Seconds', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
  {
    type: 'DoOnce',
    label: 'Do Once',
    category: 'flow',
    description: 'Executes only once until reset',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'reset', name: 'Reset', type: 'exec' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.flow,
  },
];

// === Math (20 nodes) ===
const mathNodes: NodeDefinition[] = [
  {
    type: 'Add',
    label: 'Add',
    category: 'math',
    description: 'Adds two numbers',
    inputs: [
      { id: 'a', name: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', name: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Subtract',
    label: 'Subtract',
    category: 'math',
    description: 'Subtracts B from A',
    inputs: [
      { id: 'a', name: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', name: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Multiply',
    label: 'Multiply',
    category: 'math',
    description: 'Multiplies two numbers',
    inputs: [
      { id: 'a', name: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', name: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Divide',
    label: 'Divide',
    category: 'math',
    description: 'Divides A by B',
    inputs: [
      { id: 'a', name: 'A', type: 'float', defaultValue: 0 },
      { id: 'b', name: 'B', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Clamp',
    label: 'Clamp',
    category: 'math',
    description: 'Restricts a value to a range',
    inputs: [
      { id: 'value', name: 'Value', type: 'float' },
      { id: 'min', name: 'Min', type: 'float', defaultValue: 0 },
      { id: 'max', name: 'Max', type: 'float', defaultValue: 1 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Abs',
    label: 'Absolute',
    category: 'math',
    description: 'Returns the absolute value',
    inputs: [
      { id: 'value', name: 'Value', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Min',
    label: 'Min',
    category: 'math',
    description: 'Returns the smaller of two numbers',
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Max',
    label: 'Max',
    category: 'math',
    description: 'Returns the larger of two numbers',
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Random',
    label: 'Random',
    category: 'math',
    description: 'Returns a random number in a range',
    inputs: [
      { id: 'min', name: 'Min', type: 'float', defaultValue: 0 },
      { id: 'max', name: 'Max', type: 'float', defaultValue: 1 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'RandomBool',
    label: 'Random Bool',
    category: 'math',
    description: 'Returns a random true or false',
    inputs: [],
    outputs: [
      { id: 'result', name: 'Result', type: 'bool' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Lerp',
    label: 'Lerp',
    category: 'math',
    description: 'Linearly interpolates between A and B',
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float' },
      { id: 't', name: 'T', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'InverseLerp',
    label: 'Inverse Lerp',
    category: 'math',
    description: 'Finds the interpolation factor for a value between A and B',
    inputs: [
      { id: 'a', name: 'A', type: 'float' },
      { id: 'b', name: 'B', type: 'float' },
      { id: 'value', name: 'Value', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Sin',
    label: 'Sin',
    category: 'math',
    description: 'Returns the sine of an angle in radians',
    inputs: [
      { id: 'angle', name: 'Angle', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Cos',
    label: 'Cos',
    category: 'math',
    description: 'Returns the cosine of an angle in radians',
    inputs: [
      { id: 'angle', name: 'Angle', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Atan2',
    label: 'Atan2',
    category: 'math',
    description: 'Returns the angle from the X axis to a point',
    inputs: [
      { id: 'y', name: 'Y', type: 'float' },
      { id: 'x', name: 'X', type: 'float' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Distance',
    label: 'Distance',
    category: 'math',
    description: 'Returns the distance between two vectors',
    inputs: [
      { id: 'a', name: 'A', type: 'vec3' },
      { id: 'b', name: 'B', type: 'vec3' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'Normalize',
    label: 'Normalize',
    category: 'math',
    description: 'Returns a unit vector in the same direction',
    inputs: [
      { id: 'value', name: 'Value', type: 'vec3' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'DotProduct',
    label: 'Dot Product',
    category: 'math',
    description: 'Returns the dot product of two vectors',
    inputs: [
      { id: 'a', name: 'A', type: 'vec3' },
      { id: 'b', name: 'B', type: 'vec3' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'float' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'CrossProduct',
    label: 'Cross Product',
    category: 'math',
    description: 'Returns the cross product of two vectors',
    inputs: [
      { id: 'a', name: 'A', type: 'vec3' },
      { id: 'b', name: 'B', type: 'vec3' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.math,
  },
  {
    type: 'MakeVec3',
    label: 'Make Vec3',
    category: 'math',
    description: 'Creates a 3D vector from components',
    inputs: [
      { id: 'x', name: 'X', type: 'float', defaultValue: 0 },
      { id: 'y', name: 'Y', type: 'float', defaultValue: 0 },
      { id: 'z', name: 'Z', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.math,
  },
];

// === Transform (10 nodes) ===
const transformNodes: NodeDefinition[] = [
  {
    type: 'GetPosition',
    label: 'Get Position',
    category: 'transform',
    description: 'Gets the position of an entity',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'position', name: 'Position', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'SetPosition',
    label: 'Set Position',
    category: 'transform',
    description: 'Sets the position of an entity',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'position', name: 'Position', type: 'vec3' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'GetRotation',
    label: 'Get Rotation',
    category: 'transform',
    description: 'Gets the rotation of an entity as Euler angles',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'rotation', name: 'Rotation', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'SetRotation',
    label: 'Set Rotation',
    category: 'transform',
    description: 'Sets the rotation of an entity using Euler angles',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'rotation', name: 'Rotation', type: 'vec3' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'Translate',
    label: 'Translate',
    category: 'transform',
    description: 'Moves an entity by a delta amount',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'dx', name: 'DX', type: 'float', defaultValue: 0 },
      { id: 'dy', name: 'DY', type: 'float', defaultValue: 0 },
      { id: 'dz', name: 'DZ', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'Rotate',
    label: 'Rotate',
    category: 'transform',
    description: 'Rotates an entity by a delta amount',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'dx', name: 'DX', type: 'float', defaultValue: 0 },
      { id: 'dy', name: 'DY', type: 'float', defaultValue: 0 },
      { id: 'dz', name: 'DZ', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'LookAt',
    label: 'Look At',
    category: 'transform',
    description: 'Rotates an entity to face a target position',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'target', name: 'Target', type: 'vec3' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'GetForward',
    label: 'Get Forward',
    category: 'transform',
    description: 'Gets the forward direction vector of an entity',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'direction', name: 'Direction', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'GetRight',
    label: 'Get Right',
    category: 'transform',
    description: 'Gets the right direction vector of an entity',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'direction', name: 'Direction', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.transform,
  },
  {
    type: 'GetUp',
    label: 'Get Up',
    category: 'transform',
    description: 'Gets the up direction vector of an entity',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'direction', name: 'Direction', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.transform,
  },
];

// === Physics (6 nodes) ===
const physicsNodes: NodeDefinition[] = [
  {
    type: 'ApplyForce',
    label: 'Apply Force',
    category: 'physics',
    description: 'Applies a continuous force to a physics body',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'fx', name: 'FX', type: 'float', defaultValue: 0 },
      { id: 'fy', name: 'FY', type: 'float', defaultValue: 0 },
      { id: 'fz', name: 'FZ', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.physics,
  },
  {
    type: 'ApplyImpulse',
    label: 'Apply Impulse',
    category: 'physics',
    description: 'Applies an instant impulse to a physics body',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'fx', name: 'FX', type: 'float', defaultValue: 0 },
      { id: 'fy', name: 'FY', type: 'float', defaultValue: 0 },
      { id: 'fz', name: 'FZ', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.physics,
  },
  {
    type: 'SetVelocity',
    label: 'Set Velocity',
    category: 'physics',
    description: 'Sets the linear velocity of a physics body',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'vx', name: 'VX', type: 'float', defaultValue: 0 },
      { id: 'vy', name: 'VY', type: 'float', defaultValue: 0 },
      { id: 'vz', name: 'VZ', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.physics,
  },
  {
    type: 'GetVelocity',
    label: 'Get Velocity',
    category: 'physics',
    description: 'Gets the linear velocity of a physics body',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'velocity', name: 'Velocity', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.physics,
  },
  {
    type: 'Raycast',
    label: 'Raycast',
    category: 'physics',
    description: 'Casts a ray and returns the first hit',
    inputs: [
      { id: 'origin', name: 'Origin', type: 'vec3' },
      { id: 'direction', name: 'Direction', type: 'vec3' },
      { id: 'maxDistance', name: 'Max Distance', type: 'float', defaultValue: 100 },
    ],
    outputs: [
      { id: 'hit', name: 'Hit', type: 'bool' },
      { id: 'hitEntity', name: 'Hit Entity', type: 'entity' },
      { id: 'hitPoint', name: 'Hit Point', type: 'vec3' },
    ],
    color: CATEGORY_COLORS.physics,
  },
  {
    type: 'IsGrounded',
    label: 'Is Grounded',
    category: 'physics',
    description: 'Checks if an entity is touching the ground',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'grounded', name: 'Grounded', type: 'bool' },
    ],
    color: CATEGORY_COLORS.physics,
  },
];

// === Input (3 nodes) ===
const inputNodes: NodeDefinition[] = [
  {
    type: 'IsPressed',
    label: 'Is Pressed',
    category: 'input',
    description: 'Checks if an input action is currently pressed',
    inputs: [
      { id: 'action', name: 'Action', type: 'string', defaultValue: 'jump' },
    ],
    outputs: [
      { id: 'pressed', name: 'Pressed', type: 'bool' },
    ],
    color: CATEGORY_COLORS.input,
  },
  {
    type: 'JustPressed',
    label: 'Just Pressed',
    category: 'input',
    description: 'Checks if an input action was just pressed this frame',
    inputs: [
      { id: 'action', name: 'Action', type: 'string', defaultValue: 'jump' },
    ],
    outputs: [
      { id: 'pressed', name: 'Pressed', type: 'bool' },
    ],
    color: CATEGORY_COLORS.input,
  },
  {
    type: 'GetAxis',
    label: 'Get Axis',
    category: 'input',
    description: 'Gets the value of an input axis',
    inputs: [
      { id: 'action', name: 'Action', type: 'string', defaultValue: 'move_right' },
    ],
    outputs: [
      { id: 'value', name: 'Value', type: 'float' },
    ],
    color: CATEGORY_COLORS.input,
  },
];

// === Audio (4 nodes) ===
const audioNodes: NodeDefinition[] = [
  {
    type: 'PlaySound',
    label: 'Play Sound',
    category: 'audio',
    description: 'Starts playing audio attached to an entity',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.audio,
  },
  {
    type: 'StopSound',
    label: 'Stop Sound',
    category: 'audio',
    description: 'Stops playing audio attached to an entity',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.audio,
  },
  {
    type: 'PlayOneShot',
    label: 'Play One-Shot',
    category: 'audio',
    description: 'Plays a sound effect once at a position',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'assetId', name: 'Asset ID', type: 'string' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.audio,
  },
  {
    type: 'SetVolume',
    label: 'Set Volume',
    category: 'audio',
    description: 'Sets the volume of an audio source',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'volume', name: 'Volume', type: 'float', defaultValue: 1.0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.audio,
  },
];

// === State/Variables (5 nodes) ===
const stateNodes: NodeDefinition[] = [
  {
    type: 'GetVariable',
    label: 'Get Variable',
    category: 'state',
    description: 'Gets the value of a script variable',
    inputs: [
      { id: 'key', name: 'Key', type: 'string' },
    ],
    outputs: [
      { id: 'value', name: 'Value', type: 'any' },
    ],
    color: CATEGORY_COLORS.state,
  },
  {
    type: 'SetVariable',
    label: 'Set Variable',
    category: 'state',
    description: 'Sets the value of a script variable',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'key', name: 'Key', type: 'string' },
      { id: 'value', name: 'Value', type: 'any' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.state,
  },
  {
    type: 'Increment',
    label: 'Increment',
    category: 'state',
    description: 'Increments a numeric variable',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'key', name: 'Key', type: 'string' },
      { id: 'amount', name: 'Amount', type: 'float', defaultValue: 1 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'newValue', name: 'New Value', type: 'float' },
    ],
    color: CATEGORY_COLORS.state,
  },
  {
    type: 'Decrement',
    label: 'Decrement',
    category: 'state',
    description: 'Decrements a numeric variable',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'key', name: 'Key', type: 'string' },
      { id: 'amount', name: 'Amount', type: 'float', defaultValue: 1 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'newValue', name: 'New Value', type: 'float' },
    ],
    color: CATEGORY_COLORS.state,
  },
  {
    type: 'Compare',
    label: 'Compare',
    category: 'state',
    description: 'Compares two values using an operator',
    inputs: [
      { id: 'a', name: 'A', type: 'any' },
      { id: 'b', name: 'B', type: 'any' },
      { id: 'operator', name: 'Operator', type: 'string', defaultValue: '==' },
    ],
    outputs: [
      { id: 'result', name: 'Result', type: 'bool' },
    ],
    color: CATEGORY_COLORS.state,
  },
];

// === Entity (6 nodes) ===
const entityNodes: NodeDefinition[] = [
  {
    type: 'SpawnEntity',
    label: 'Spawn Entity',
    category: 'entity',
    description: 'Creates a new entity at a position',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'type', name: 'Type', type: 'string', defaultValue: 'cube' },
      { id: 'name', name: 'Name', type: 'string' },
      { id: 'x', name: 'X', type: 'float', defaultValue: 0 },
      { id: 'y', name: 'Y', type: 'float', defaultValue: 0 },
      { id: 'z', name: 'Z', type: 'float', defaultValue: 0 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
      { id: 'entityId', name: 'Entity ID', type: 'entity' },
    ],
    color: CATEGORY_COLORS.entity,
  },
  {
    type: 'DestroyEntity',
    label: 'Destroy Entity',
    category: 'entity',
    description: 'Removes an entity from the scene',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.entity,
  },
  {
    type: 'FindByName',
    label: 'Find by Name',
    category: 'entity',
    description: 'Finds an entity by its name',
    inputs: [
      { id: 'name', name: 'Name', type: 'string' },
    ],
    outputs: [
      { id: 'entities', name: 'Entity', type: 'entity' },
    ],
    color: CATEGORY_COLORS.entity,
  },
  {
    type: 'GetEntityName',
    label: 'Get Entity Name',
    category: 'entity',
    description: 'Gets the name of an entity',
    inputs: [
      { id: 'entity', name: 'Entity', type: 'entity' },
    ],
    outputs: [
      { id: 'name', name: 'Name', type: 'string' },
    ],
    color: CATEGORY_COLORS.entity,
  },
  {
    type: 'SetVisibility',
    label: 'Set Visibility',
    category: 'entity',
    description: 'Shows or hides an entity',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'visible', name: 'Visible', type: 'bool', defaultValue: true },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.entity,
  },
  {
    type: 'SetColor',
    label: 'Set Color',
    category: 'entity',
    description: 'Changes the color of an entity',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'entity', name: 'Entity', type: 'entity' },
      { id: 'r', name: 'R', type: 'float', defaultValue: 1 },
      { id: 'g', name: 'G', type: 'float', defaultValue: 1 },
      { id: 'b', name: 'B', type: 'float', defaultValue: 1 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.entity,
  },
];

// === UI (5 nodes) ===
const uiNodes: NodeDefinition[] = [
  {
    type: 'ShowText',
    label: 'Show Text',
    category: 'ui',
    description: 'Displays text on the screen',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'id', name: 'ID', type: 'string' },
      { id: 'text', name: 'Text', type: 'string' },
      { id: 'x', name: 'X', type: 'float', defaultValue: 50 },
      { id: 'y', name: 'Y', type: 'float', defaultValue: 10 },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.ui,
  },
  {
    type: 'UpdateText',
    label: 'Update Text',
    category: 'ui',
    description: 'Changes the content of existing text',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'id', name: 'ID', type: 'string' },
      { id: 'text', name: 'Text', type: 'string' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.ui,
  },
  {
    type: 'RemoveText',
    label: 'Remove Text',
    category: 'ui',
    description: 'Removes text from the screen',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'id', name: 'ID', type: 'string' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.ui,
  },
  {
    type: 'ShowScreen',
    label: 'Show Screen',
    category: 'ui',
    description: 'Displays a UI screen',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'screenName', name: 'Screen Name', type: 'string' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.ui,
  },
  {
    type: 'HideScreen',
    label: 'Hide Screen',
    category: 'ui',
    description: 'Hides a UI screen',
    inputs: [
      { id: 'exec_in', name: '', type: 'exec' },
      { id: 'screenName', name: 'Screen Name', type: 'string' },
    ],
    outputs: [
      { id: 'exec_out', name: '', type: 'exec' },
    ],
    color: CATEGORY_COLORS.ui,
  },
];

// === Export All ===
export const NODE_DEFINITIONS: NodeDefinition[] = [
  ...eventsNodes,
  ...flowNodes,
  ...mathNodes,
  ...transformNodes,
  ...physicsNodes,
  ...inputNodes,
  ...audioNodes,
  ...stateNodes,
  ...entityNodes,
  ...uiNodes,
];

export const NODE_DEFINITION_MAP: Record<string, NodeDefinition> = Object.fromEntries(
  NODE_DEFINITIONS.map(n => [n.type, n])
);

export const NODE_CATEGORIES: { category: NodeCategory; label: string; nodes: NodeDefinition[] }[] = [
  { category: 'events', label: 'Events', nodes: eventsNodes },
  { category: 'flow', label: 'Flow Control', nodes: flowNodes },
  { category: 'math', label: 'Math', nodes: mathNodes },
  { category: 'transform', label: 'Transform', nodes: transformNodes },
  { category: 'physics', label: 'Physics', nodes: physicsNodes },
  { category: 'input', label: 'Input', nodes: inputNodes },
  { category: 'audio', label: 'Audio', nodes: audioNodes },
  { category: 'state', label: 'State', nodes: stateNodes },
  { category: 'entity', label: 'Entity', nodes: entityNodes },
  { category: 'ui', label: 'UI', nodes: uiNodes },
];
