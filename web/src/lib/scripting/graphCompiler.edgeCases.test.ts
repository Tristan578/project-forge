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
});
