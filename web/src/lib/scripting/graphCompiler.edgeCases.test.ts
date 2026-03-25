import { describe, it, expect } from 'vitest';
import { compileGraph } from './graphCompiler';
import type { VisualScriptGraph, VisualScriptNode, VisualScriptEdge } from './visualScriptTypes';

/**
 * Edge case tests for the visual script graph compiler (PF-158).
 */

// Helper: create a minimal node
function node(id: string, type: string, data: Record<string, unknown> = {}): VisualScriptNode {
  return { id, type, position: { x: 0, y: 0 }, data };
}

// Helper: create an exec edge
function execEdge(id: string, source: string, target: string, sourceHandle = 'exec_out', targetHandle = 'exec_in'): VisualScriptEdge {
  return { id, source, sourceHandle, target, targetHandle };
}

// Helper: create a data edge
function dataEdge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): VisualScriptEdge {
  return { id, source, sourceHandle, target, targetHandle };
}

describe('graphCompiler - Edge Cases', () => {
  describe('Empty and Minimal Graphs', () => {
    it('compiles graph with no nodes and no edges', () => {
      const graph: VisualScriptGraph = { nodes: [], edges: [] };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('No event nodes') })])
      );
    });

    it('compiles single event node with no connections', () => {
      const graph: VisualScriptGraph = {
        nodes: [node('1', 'OnStart')],
        edges: [],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('function onStart()');
    });

    it('compiles event node connected to nothing (no exec_out target)', () => {
      const graph: VisualScriptGraph = {
        nodes: [node('1', 'OnUpdate')],
        edges: [],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('function onUpdate(dt: number)');
    });
  });

  describe('Disconnected Nodes', () => {
    it('warns on multiple disconnected exec nodes', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetPosition', { entity: 'e1' }),
          node('3', 'Translate', { entity: 'e2' }),
          node('4', 'SpawnEntity', { type: 'cube', name: 'a', x: 0, y: 0, z: 0 }),
        ],
        edges: [],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      const disconnectedWarnings = result.warnings.filter(w => w.message.includes('disconnected'));
      expect(disconnectedWarnings.length).toBe(3); // SetPosition, Translate, SpawnEntity
    });

    it('does not warn OnStart or OnUpdate as disconnected', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'OnUpdate'),
        ],
        edges: [],
      };
      const result = compileGraph(graph);
      const disconnectedWarnings = result.warnings.filter(w => w.message.includes('disconnected'));
      expect(disconnectedWarnings.length).toBe(0);
    });

    it('data-only nodes without exec connection still compile', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 1, b: 2 }),
          node('3', 'Multiply', { a: 3, b: 4 }),
        ],
        edges: [
          dataEdge('e1', '2', 'result', '3', 'a'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Add and Multiply are connected to each other but not to the exec chain
      // Only Multiply should show as not-disconnected (connected via edge),
      // but neither are on an exec path from an event node
    });
  });

  describe('Unknown Node Types', () => {
    it('warns on unknown event node type', () => {
      const graph: VisualScriptGraph = {
        nodes: [node('1', 'OnCustomEvent')],
        edges: [],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // No event nodes recognized
      expect(result.warnings.some(w => w.message.includes('No event nodes'))).toBe(true);
    });

    it('warns on unknown exec node type in chain', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'UnknownNode', {}),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type'))).toBe(true);
    });

    it('warns on unknown data node type', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'CustomDataNode', { value: 42 }),
          node('3', 'SetVariable', { key: 'x' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'output', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown data node type'))).toBe(true);
      // Should use fallback value '0'
      expect(result.code).toContain('forge.state.set');
    });
  });

  describe('Missing Edge Targets', () => {
    it('handles edge pointing to non-existent node', () => {
      const graph: VisualScriptGraph = {
        nodes: [node('1', 'OnStart')],
        edges: [execEdge('e1', '1', 'nonexistent')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Should not crash; the missing node is skipped
      expect(result.code).toContain('function onStart()');
    });

    it('handles data edge with non-existent source node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('3', 'SetVariable', { key: 'x' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', 'ghost', 'result', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Should fall back to inline data or default '0'
      expect(result.code).toContain('forge.state.set');
    });
  });

  describe('ForLoop Edge Cases', () => {
    it('compiles ForLoop with empty body', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ForLoop', { start: 0, end: 10 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = 0; i < 10; i++)');
    });

    it('compiles ForLoop where start equals end', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ForLoop', { start: 5, end: 5 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = 5; i < 5; i++)');
    });

    it('compiles ForLoop with negative range', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ForLoop', { start: -3, end: 3 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = -3; i < 3; i++)');
    });

    it('compiles ForLoop with exec_out continuation', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ForLoop', { start: 0, end: 3 }),
          node('3', 'SpawnEntity', { type: 'cube', name: 'box', x: 0, y: 0, z: 0 }),
          node('4', 'SetVariable', { key: 'done', value: true }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_body'),
          execEdge('e3', '2', '4', 'exec_out'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = 0; i < 3; i++)');
      expect(result.code).toContain('forge.spawn');
      expect(result.code).toContain('forge.state.set');
    });
  });

  describe('Branch Edge Cases', () => {
    it('compiles Branch with only true branch', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'Branch', { condition: true }),
          node('3', 'Translate', { entity: 'e', dx: 1, dy: 0, dz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_true'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('if (true)');
      expect(result.code).toContain('forge.translate');
      expect(result.code).not.toContain('else');
    });

    it('compiles Branch with only false branch', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'Branch', { condition: false }),
          node('3', 'Translate', { entity: 'e', dx: 0, dy: 0, dz: 1 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_false'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('else');
      expect(result.code).toContain('forge.translate');
    });

    it('compiles Branch with both true and false branches', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'Branch', { condition: true }),
          node('3', 'Translate', { entity: 'e', dx: 1, dy: 0, dz: 0 }),
          node('4', 'Translate', { entity: 'e', dx: -1, dy: 0, dz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_true'),
          execEdge('e3', '2', '4', 'exec_false'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('if (true)');
      expect(result.code).toContain('else');
    });

    it('compiles Branch with empty both branches', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Branch', { condition: true }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('if (true)');
    });

    it('compiles nested Branch inside Branch', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'IsPressed', { action: 'jump' }),
          node('3', 'Branch', {}),
          node('4', 'IsPressed', { action: 'sprint' }),
          node('5', 'Branch', {}),
          node('6', 'ApplyImpulse', { entity: 'e', fx: 0, fy: 20, fz: 0 }),
          node('7', 'ApplyImpulse', { entity: 'e', fx: 0, fy: 10, fz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'pressed', '3', 'condition'),
          execEdge('e3', '3', '5', 'exec_true'),
          dataEdge('e4', '4', 'pressed', '5', 'condition'),
          execEdge('e5', '5', '6', 'exec_true'),
          execEdge('e6', '5', '7', 'exec_false'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.input.isPressed("jump")');
      expect(result.code).toContain('forge.input.isPressed("sprint")');
      expect(result.code).toContain('0, 20, 0'); // High jump
      expect(result.code).toContain('0, 10, 0'); // Normal jump
    });
  });

  describe('Data Node Value Formatting', () => {
    it('formats string values with JSON encoding', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'player_name', value: 'Hero "Brave"' }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('"player_name"');
    });

    it('formats boolean values', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'alive', value: true }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("alive", true)');
    });

    it('formats array values', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetPosition', { entity: 'e', position: [1, 2, 3] }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('[1, 2, 3]');
    });

    it('uses fallback value 0 for missing port data', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Translate', { entity: 'e' }), // Missing dx, dy, dz
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.translate("e", 0, 0, 0)');
    });

    it('formats numeric zero correctly', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'score', value: 0 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("score", 0)');
    });
  });

  describe('All Math Data Nodes', () => {
    it('compiles Add node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 10, b: 20 }),
          node('3', 'SetVariable', { key: 'sum' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'result', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('(10 + 20)');
    });

    it('compiles Subtract node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Subtract', { a: 100, b: 50 }),
          node('3', 'SetVariable', { key: 'diff' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'result', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('(100 - 50)');
    });

    it('compiles Divide node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Divide', { a: 100, b: 4 }),
          node('3', 'SetVariable', { key: 'ratio' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'result', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('(100 / 4)');
    });

    it('compiles chained math: (a + b) * c', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 2, b: 3 }),
          node('3', 'Multiply', { b: 10 }),
          node('4', 'SetVariable', { key: 'result' }),
        ],
        edges: [
          execEdge('e1', '1', '4'),
          dataEdge('e2', '2', 'result', '3', 'a'),
          dataEdge('e3', '3', 'result', '4', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('((2 + 3) * 10)');
    });
  });

  describe('All Event Types', () => {
    it('compiles OnCollisionExit', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnCollisionExit', { entity: 'player' }),
          node('2', 'PlaySound', { entity: 'sfx' }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('forge.physics.onCollisionExit');
    });

    it('compiles OnTriggerEnter', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnTriggerEnter', { entity: 'zone' }),
          node('2', 'SetVariable', { key: 'entered', value: true }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('forge.physics.onTriggerEnter');
    });

    it('compiles OnTriggerExit', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnTriggerExit', { entity: 'zone' }),
          node('2', 'SetVariable', { key: 'exited', value: true }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('forge.physics.onTriggerExit');
    });

    it('compiles OnKeyPress', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnKeyPress', { key: 'space' }),
          node('2', 'ApplyImpulse', { entity: 'player', fx: 0, fy: 10, fz: 0 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.code).toContain('forge.input.justPressed("space")');
    });

    it('compiles all event types in a single graph', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'OnUpdate'),
          node('3', 'OnCollisionEnter', { entity: 'e' }),
          node('4', 'OnTimer', { interval: 1 }),
          node('5', 'OnKeyPress', { key: 'e' }),
        ],
        edges: [],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('function onStart()');
      expect(result.code).toContain('function onUpdate(dt: number)');
      expect(result.code).toContain('onCollisionEnter');
      expect(result.code).toContain('_timer_4_elapsed');
      expect(result.code).toContain('justPressed');
    });
  });

  describe('Multiple Timers', () => {
    it('compiles multiple OnTimer nodes with separate state', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('t1', 'OnTimer', { interval: 2 }),
          node('t2', 'OnTimer', { interval: 5 }),
          node('s1', 'SpawnEntity', { type: 'sphere', name: 'enemy', x: 0, y: 0, z: 0 }),
          node('s2', 'SpawnEntity', { type: 'cube', name: 'powerup', x: 0, y: 0, z: 0 }),
        ],
        edges: [
          execEdge('e1', 't1', 's1'),
          execEdge('e2', 't2', 's2'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('let _timer_t1_elapsed = 0');
      expect(result.code).toContain('let _timer_t2_elapsed = 0');
      expect(result.code).toContain('_timer_t1_elapsed >= 2');
      expect(result.code).toContain('_timer_t2_elapsed >= 5');
    });
  });

  describe('GetVariable Data Node', () => {
    it('compiles GetVariable used in condition', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'GetVariable', { key: 'health' }),
          node('3', 'Branch', {}),
          node('4', 'PlaySound', { entity: 'alarm' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'value', '3', 'condition'),
          execEdge('e3', '3', '4', 'exec_true'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.get("health")');
    });
  });

  describe('ApplyForce Node', () => {
    it('compiles ApplyForce with all parameters', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ApplyForce', { entity: 'ball', fx: 10, fy: 0, fz: -5 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.physics.applyForce("ball", 10, 0, -5)');
    });
  });

  describe('Exec Chain Continuation', () => {
    it('compiles sequential exec chain (3+ nodes)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'a', value: 1 }),
          node('3', 'SetVariable', { key: 'b', value: 2 }),
          node('4', 'SetVariable', { key: 'c', value: 3 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3'),
          execEdge('e3', '3', '4'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("a", 1)');
      expect(result.code).toContain('forge.state.set("b", 2)');
      expect(result.code).toContain('forge.state.set("c", 3)');
    });
  });

  describe('Duplicate Node IDs in Edges', () => {
    it('handles multiple edges to same input (takes first)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 10, b: 20 }),
          node('3', 'Multiply', { a: 100, b: 200 }),
          node('4', 'SetVariable', { key: 'x' }),
        ],
        edges: [
          execEdge('e1', '1', '4'),
          dataEdge('e2', '2', 'result', '4', 'value'),
          dataEdge('e3', '3', 'result', '4', 'value'), // Second edge to same port
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // First edge wins
      expect(result.code).toContain('(10 + 20)');
    });
  });

  // ==================================================================
  // Additional edge cases (PF-158)
  // ==================================================================

  describe('Data Node Compilation', () => {
    it('compiles MakeVec3 data node fed into SetPosition', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'MakeVec3', { x: 5, y: 10, z: 15 }),
          node('3', 'SetPosition', { entity: 'player' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'vec3', '3', 'position'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('[5, 10, 15]');
      expect(result.code).toContain('forge.setPosition');
    });

    it('compiles Distance data node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'GetPosition', { entity: 'player' }),
          node('3', 'GetPosition', { entity: 'enemy' }),
          node('4', 'Distance', {}),
          node('5', 'SetVariable', { key: 'dist' }),
        ],
        edges: [
          execEdge('e1', '1', '5'),
          dataEdge('e2', '2', 'position', '4', 'a'),
          dataEdge('e3', '3', 'position', '4', 'b'),
          dataEdge('e4', '4', 'result', '5', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('Math.sqrt');
      expect(result.code).toContain('Math.pow');
      expect(result.code).toContain('forge.getTransform');
    });

    it('compiles GetAxis data node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'GetAxis', { action: 'horizontal' }),
          node('3', 'Translate', { entity: 'player', dy: 0, dz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'value', '3', 'dx'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.input.getAxis("horizontal")');
      expect(result.code).toContain('forge.translate');
    });

    it('compiles IsPressed data node', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'IsPressed', { action: 'fire' }),
          node('3', 'Branch', {}),
          node('4', 'PlaySound', { entity: 'weapon' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'pressed', '3', 'condition'),
          execEdge('e3', '3', '4', 'exec_true'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.input.isPressed("fire")');
      expect(result.code).toContain('forge.audio.play');
    });

    it('compiles GetPosition data node with fallback', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'GetPosition', { entity: 'camera' }),
          node('3', 'SetVariable', { key: 'camPos' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'position', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.getTransform("camera")?.position || [0, 0, 0]');
    });
  });

  describe('ShowText Exec Node', () => {
    it('compiles ShowText with all parameters', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ShowText', { id: 'msg-1', text: 'Hello!', x: 50, y: 30 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.ui.showText("msg-1", "Hello!", 50, 30)');
    });

    it('compiles ShowText with missing values using fallback 0', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ShowText', { id: 'msg-1', text: 'Hello' }), // Missing x, y
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.ui.showText("msg-1", "Hello", 0, 0)');
    });
  });

  describe('Unimplemented Exec Node Types', () => {
    it('warns for WhileLoop (not compiled)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'WhileLoop', { condition: true }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type: WhileLoop'))).toBe(true);
    });

    it('warns for Sequence (not compiled)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Sequence', {}),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type: Sequence'))).toBe(true);
    });

    it('warns for Delay (not compiled)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Delay', { seconds: 2 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type: Delay'))).toBe(true);
    });

    it('warns for DoOnce (not compiled)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'DoOnce', {}),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type: DoOnce'))).toBe(true);
    });
  });

  describe('Multiple Event Handlers with Exec Chains', () => {
    it('compiles OnStart and OnUpdate each with their own exec chains', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'initialized', value: true }),
          node('3', 'OnUpdate'),
          node('4', 'Translate', { entity: 'player', dx: 1, dy: 0, dz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '3', '4'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('function onStart()');
      expect(result.code).toContain('forge.state.set("initialized", true)');
      expect(result.code).toContain('function onUpdate(dt: number)');
      expect(result.code).toContain('forge.translate("player"');
    });
  });

  describe('Deeply Nested Structures', () => {
    it('compiles nested Branch inside ForLoop', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ForLoop', { start: 0, end: 5 }),
          node('3', 'Branch', { condition: true }),
          node('4', 'SpawnEntity', { type: 'cube', name: 'box', x: 0, y: 0, z: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_body'),
          execEdge('e3', '3', '4', 'exec_true'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = 0; i < 5; i++)');
      expect(result.code).toContain('if (true)');
      expect(result.code).toContain('forge.spawn');
    });

    it('compiles ForLoop inside Branch', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Branch', { condition: true }),
          node('3', 'ForLoop', { start: 0, end: 3 }),
          node('4', 'SetVariable', { key: 'count', value: 1 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_true'),
          execEdge('e3', '3', '4', 'exec_body'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('if (true)');
      expect(result.code).toContain('for (let i = 0; i < 3; i++)');
      expect(result.code).toContain('forge.state.set("count", 1)');
    });
  });

  describe('Data Node Chaining Edge Cases', () => {
    it('compiles deeply chained math: ((a + b) * c) / d', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 2, b: 3 }),
          node('3', 'Multiply', { b: 4 }),
          node('4', 'Divide', { b: 2 }),
          node('5', 'SetVariable', { key: 'result' }),
        ],
        edges: [
          execEdge('e1', '1', '5'),
          dataEdge('e2', '2', 'result', '3', 'a'),
          dataEdge('e3', '3', 'result', '4', 'a'),
          dataEdge('e4', '4', 'result', '5', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('(((2 + 3) * 4) / 2)');
    });

    it('compiles data node used by multiple exec nodes', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 10, b: 5 }),
          node('3', 'SetVariable', { key: 'x' }),
          node('4', 'SetVariable', { key: 'y' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          execEdge('e2', '3', '4'),
          dataEdge('e3', '2', 'result', '3', 'value'),
          dataEdge('e4', '2', 'result', '4', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Both SetVariable nodes should use the same Add expression
      const matches = result.code.match(/\(10 \+ 5\)/g);
      expect(matches?.length).toBe(2);
    });
  });

  describe('ApplyImpulse Node', () => {
    it('compiles ApplyImpulse with all parameters', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'ApplyImpulse', { entity: 'ball', fx: 0, fy: 50, fz: -10 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.physics.applyImpulse("ball", 0, 50, -10)');
    });

    it('compiles ApplyImpulse with data node input', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnUpdate'),
          node('2', 'Multiply', { a: 10, b: 5 }),
          node('3', 'ApplyImpulse', { entity: 'rocket', fx: 0, fz: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'result', '3', 'fy'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('(10 * 5)');
      expect(result.code).toContain('forge.physics.applyImpulse');
    });
  });

  describe('Timer State Variables', () => {
    it('generates state variables only for timer nodes', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'OnUpdate'),
          node('timer1', 'OnTimer', { interval: 3 }),
          node('3', 'SetVariable', { key: 'x', value: 0 }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Only the timer node should have state
      expect(result.code).toContain('let _timer_timer1_elapsed = 0');
      // Should not contain state for other node types
      expect(result.code).not.toContain('_timer_1_');
      expect(result.code).not.toContain('_timer_2_');
    });
  });

  // ==================================================================
  // PF-158 Subtask Tests: Cyclic graphs, fan-out, type mismatch, etc.
  // ==================================================================

  describe('Cyclic Graph Detection', () => {
    it('detects two-node exec cycle (A -> B -> A) and returns compile error', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('a', 'SetVariable', { key: 'x', value: 1 }),
          node('b', 'SetVariable', { key: 'y', value: 2 }),
        ],
        edges: [
          execEdge('e1', '1', 'a'),
          execEdge('e2', 'a', 'b'),
          execEdge('e3', 'b', 'a'), // Cycle: b -> a
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const cycleError = result.errors.find(e => e.message.includes('Cycle detected'));
      expect(cycleError).not.toBeUndefined();
      expect(cycleError!.nodeId).toBe('a');
    });

    it('detects self-referencing exec edge (node exec_out -> own exec_in)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'x', value: 1 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '2'), // Self-loop
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(false);
      const cycleError = result.errors.find(e => e.message.includes('Cycle detected'));
      expect(cycleError).not.toBeUndefined();
      expect(cycleError!.nodeId).toBe('2');
    });

    it('detects three-node exec cycle (A -> B -> C -> A)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('a', 'SetVariable', { key: 'x', value: 1 }),
          node('b', 'SetVariable', { key: 'y', value: 2 }),
          node('c', 'SetVariable', { key: 'z', value: 3 }),
        ],
        edges: [
          execEdge('e1', '1', 'a'),
          execEdge('e2', 'a', 'b'),
          execEdge('e3', 'b', 'c'),
          execEdge('e4', 'c', 'a'), // Cycle back
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(false);
      const cycleError = result.errors.find(e => e.message.includes('Cycle detected'));
      expect(cycleError).not.toBeUndefined();
      expect(cycleError!.nodeId).toBe('a');
      // The error message should contain the cycle path
      expect(cycleError!.message).toContain('a');
      expect(cycleError!.message).toContain('b');
      expect(cycleError!.message).toContain('c');
    });

    it('detects data node cycle (Add feeds Multiply, Multiply feeds Add)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('add', 'Add', { b: 1 }),
          node('mul', 'Multiply', { b: 2 }),
          node('set', 'SetVariable', { key: 'x' }),
        ],
        edges: [
          execEdge('e1', '1', 'set'),
          dataEdge('e2', 'add', 'result', 'mul', 'a'),
          dataEdge('e3', 'mul', 'result', 'add', 'a'),
          dataEdge('e4', 'add', 'result', 'set', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(false);
      const cycleError = result.errors.find(e => e.message.includes('Data cycle detected'));
      expect(cycleError).not.toBeUndefined();
    });

    it('compiles valid acyclic graph correctly after cycle detection was added (regression)', () => {
      // Linear chain: OnStart -> SetVariable -> Translate -> PlaySound
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'score', value: 0 }),
          node('3', 'Translate', { entity: 'e1', dx: 1, dy: 0, dz: 0 }),
          node('4', 'PlaySound', { entity: 'sfx1' }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3'),
          execEdge('e3', '3', '4'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('forge.state.set("score", 0)');
      expect(result.code).toContain('forge.translate');
      expect(result.code).toContain('forge.audio.play');
    });
  });

  describe('Fan-Out: Multiple Exec Edges from Same Output', () => {
    it('compiles all targets when exec_out has multiple edges', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'a', value: 1 }),
          node('3', 'SetVariable', { key: 'b', value: 2 }),
          node('4', 'SetVariable', { key: 'c', value: 3 }),
        ],
        edges: [
          // Three edges from same source handle (fan-out)
          execEdge('e1', '1', '2'),
          execEdge('e2', '1', '3'),
          execEdge('e3', '1', '4'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("a", 1)');
      expect(result.code).toContain('forge.state.set("b", 2)');
      expect(result.code).toContain('forge.state.set("c", 3)');
    });

    it('handles fan-out from Branch exec_true to multiple targets', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Branch', { condition: true }),
          node('3', 'SetVariable', { key: 'a', value: 1 }),
          node('4', 'SetVariable', { key: 'b', value: 2 }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3', 'exec_true'),
          execEdge('e3', '2', '4', 'exec_true'), // Second edge from same handle
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("a", 1)');
      expect(result.code).toContain('forge.state.set("b", 2)');
    });
  });

  describe('Special Value Formatting', () => {
    it('formats null node data value as "null" string', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'x', value: null }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // null is not a string/boolean/number/array — hits String(null) = "null"
      expect(result.code).toContain('forge.state.set("x", null)');
    });

    it('uses fallback 0 for undefined node data value', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'x' }), // No value key in data
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // undefined data falls through to fallback '0'
      expect(result.code).toContain('forge.state.set("x", 0)');
    });

    it('formats special characters in string values via JSON.stringify', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'msg', value: 'line1\nline2\ttab' }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // JSON.stringify handles escape sequences
      expect(result.code).toContain('"msg"');
      expect(result.code).toContain('forge.state.set');
    });

    it('formats empty string value', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'empty', value: '' }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("empty", "")');
    });

    it('formats negative number values', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'offset', value: -42.5 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.state.set("offset", -42.5)');
    });

    it('formats empty array value', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetPosition', { entity: 'e', position: [] }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('[]');
    });
  });

  describe('Type Mismatch on Connections', () => {
    it('compiles when exec node is wired as data source (treated as data node)', () => {
      // Wire a SetVariable exec node's output as data input to another node
      // The compiler will try to compile it as a data node and hit the default case
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'a', value: 10 }),
          node('3', 'SetVariable', { key: 'b' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          // Data edge from an exec node (SetVariable) — treated as unknown data node
          dataEdge('e2', '2', 'value', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // SetVariable is not a known data node type, so it produces a warning and returns '0'
      expect(result.warnings.some(w => w.message.includes('Unknown data node type: SetVariable'))).toBe(true);
    });

    it('compiles when data node is wired into exec chain', () => {
      // Wire an Add (data node) into exec chain — it'll be treated as unknown exec node
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Add', { a: 1, b: 2 }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Add is not a known exec node type
      expect(result.warnings.some(w => w.message.includes('Unknown exec node type: Add'))).toBe(true);
    });
  });

  describe('PlaySound Exec Node', () => {
    it('compiles PlaySound with entity parameter', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'PlaySound', { entity: 'bgm' }),
        ],
        edges: [execEdge('e1', '1', '2')],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.audio.play("bgm")');
    });

    it('compiles PlaySound with exec chain continuation', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'PlaySound', { entity: 'sfx' }),
          node('3', 'SetVariable', { key: 'played', value: true }),
        ],
        edges: [
          execEdge('e1', '1', '2'),
          execEdge('e2', '2', '3'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.audio.play("sfx")');
      expect(result.code).toContain('forge.state.set("played", true)');
    });
  });

  describe('Multiply Standalone', () => {
    it('compiles Multiply data node with inline values', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'Multiply', { a: 7, b: 6 }),
          node('3', 'SetVariable', { key: 'product' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'result', '3', 'value'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('(7 * 6)');
    });
  });

  describe('SpawnEntity with Data Node Inputs', () => {
    it('compiles SpawnEntity with MakeVec3 for position', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'MakeVec3', { x: 10, y: 20, z: 30 }),
          node('3', 'SpawnEntity', { type: 'sphere', name: 'ball' }),
        ],
        edges: [
          execEdge('e1', '1', '3'),
          dataEdge('e2', '2', 'x', '3', 'x'),
          dataEdge('e3', '2', 'y', '3', 'y'),
          dataEdge('e4', '2', 'z', '3', 'z'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('forge.spawn("sphere"');
    });
  });

  describe('Long Sequential Exec Chain', () => {
    it('compiles 10 sequential SetVariable nodes', () => {
      const nodes = [node('start', 'OnStart')];
      const edges: VisualScriptEdge[] = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(node(`n${i}`, 'SetVariable', { key: `var${i}`, value: i }));
        const source = i === 0 ? 'start' : `n${i - 1}`;
        edges.push(execEdge(`e${i}`, source, `n${i}`));
      }
      const graph: VisualScriptGraph = { nodes, edges };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      for (let i = 0; i < 10; i++) {
        expect(result.code).toContain(`forge.state.set("var${i}", ${i})`);
      }
    });
  });

  describe('Edge with Nonexistent Handle', () => {
    it('ignores exec edge with non-matching source handle', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'x', value: 1 }),
        ],
        edges: [
          // Use a handle that OnStart doesn't actually output on
          execEdge('e1', '1', '2', 'nonexistent_handle'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // The edge maps by source handle, so 'nonexistent_handle' won't match 'exec_out'
      // The body of onStart should be empty
      expect(result.code).toContain('function onStart()');
      expect(result.code).not.toContain('forge.state.set');
    });
  });

  describe('Disconnected Non-Event Node Types', () => {
    it('warns on disconnected collision events (OnCollisionEnter is event, not excluded)', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnCollisionEnter', { entity: 'player' }),
          node('2', 'OnTriggerEnter', { entity: 'zone' }),
          node('3', 'SetVariable', { key: 'x', value: 1 }),
        ],
        edges: [],
      };
      const result = compileGraph(graph);
      // OnStart/OnUpdate are exempt from disconnected warnings,
      // but other event types are not exempt from the disconnected check
      const disconnected = result.warnings.filter(w => w.message.includes('disconnected'));
      // All three nodes are disconnected (no edges), but only non-OnStart/OnUpdate get warned
      expect(disconnected.length).toBe(3);
    });
  });

  describe('Edge Map Construction', () => {
    it('handles graph with edges but no matching nodes', () => {
      const graph: VisualScriptGraph = {
        nodes: [node('1', 'OnStart')],
        edges: [
          execEdge('e1', 'ghost1', 'ghost2'),
          dataEdge('e2', 'ghost3', 'output', 'ghost4', 'input'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Ghost edges reference non-existent nodes but don't crash
      expect(result.code).toContain('function onStart()');
    });

    it('handles duplicate edge IDs gracefully', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('1', 'OnStart'),
          node('2', 'SetVariable', { key: 'a', value: 1 }),
          node('3', 'SetVariable', { key: 'b', value: 2 }),
        ],
        edges: [
          execEdge('same-id', '1', '2'),
          execEdge('same-id', '2', '3'), // Same ID but different edge
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      // Both edges should still work since edge maps key by source/target, not ID
      expect(result.code).toContain('forge.state.set("a", 1)');
      expect(result.code).toContain('forge.state.set("b", 2)');
    });
  });

  describe('Complex Real-World Patterns', () => {
    it('compiles a patrol pattern: timer triggers position toggle', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('timer', 'OnTimer', { interval: 2 }),
          node('getvar', 'GetVariable', { key: 'goingRight' }),
          node('branch', 'Branch', {}),
          node('moveRight', 'Translate', { entity: 'enemy', dx: 5, dy: 0, dz: 0 }),
          node('moveLeft', 'Translate', { entity: 'enemy', dx: -5, dy: 0, dz: 0 }),
          node('setTrue', 'SetVariable', { key: 'goingRight', value: false }),
          node('setFalse', 'SetVariable', { key: 'goingRight', value: true }),
        ],
        edges: [
          execEdge('e1', 'timer', 'branch'),
          dataEdge('e2', 'getvar', 'value', 'branch', 'condition'),
          execEdge('e3', 'branch', 'moveRight', 'exec_true'),
          execEdge('e4', 'moveRight', 'setTrue'),
          execEdge('e5', 'branch', 'moveLeft', 'exec_false'),
          execEdge('e6', 'moveLeft', 'setFalse'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('_timer_timer_elapsed');
      expect(result.code).toContain('forge.state.get("goingRight")');
      expect(result.code).toContain('forge.translate("enemy", 5, 0, 0)');
      expect(result.code).toContain('forge.translate("enemy", -5, 0, 0)');
      expect(result.code).toContain('forge.state.set("goingRight", false)');
      expect(result.code).toContain('forge.state.set("goingRight", true)');
    });

    it('compiles a spawn loop: OnStart → ForLoop → SpawnEntity with computed position', () => {
      const graph: VisualScriptGraph = {
        nodes: [
          node('start', 'OnStart'),
          node('loop', 'ForLoop', { start: 0, end: 5 }),
          node('mul', 'Multiply', { a: 2, b: 3 }),
          node('spawn', 'SpawnEntity', { type: 'cube', name: 'block', y: 0, z: 0 }),
        ],
        edges: [
          execEdge('e1', 'start', 'loop'),
          execEdge('e2', 'loop', 'spawn', 'exec_body'),
          dataEdge('e3', 'mul', 'result', 'spawn', 'x'),
        ],
      };
      const result = compileGraph(graph);
      expect(result.success).toBe(true);
      expect(result.code).toContain('for (let i = 0; i < 5; i++)');
      expect(result.code).toContain('forge.spawn("cube"');
      expect(result.code).toContain('(2 * 3)');
    });
  });
});
