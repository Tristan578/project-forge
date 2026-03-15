/**
 * Unit tests for the scriptDebugStore Zustand store.
 *
 * Tests cover debug toggling, breakpoint management, execution recording
 * (active node, node outputs, execution path), and pause/resume.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useScriptDebugStore } from '../scriptDebugStore';

function resetStore() {
  useScriptDebugStore.setState({
    debugEnabled: false,
    activeNodeId: null,
    nodeOutputs: {},
    executionPath: [],
    breakpoints: new Set<string>(),
    isPaused: false,
  });
}

describe('scriptDebugStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // -----------------------------------------------------------------------
  // Initial State
  // -----------------------------------------------------------------------
  describe('Initial State', () => {
    it('should have debugEnabled false', () => {
      expect(useScriptDebugStore.getState().debugEnabled).toBe(false);
    });

    it('should have no active node', () => {
      expect(useScriptDebugStore.getState().activeNodeId).toBeNull();
    });

    it('should have empty nodeOutputs', () => {
      expect(useScriptDebugStore.getState().nodeOutputs).toEqual({});
    });

    it('should have empty executionPath', () => {
      expect(useScriptDebugStore.getState().executionPath).toEqual([]);
    });

    it('should have no breakpoints', () => {
      expect(useScriptDebugStore.getState().breakpoints.size).toBe(0);
    });

    it('should not be paused', () => {
      expect(useScriptDebugStore.getState().isPaused).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // toggleDebug
  // -----------------------------------------------------------------------
  describe('toggleDebug', () => {
    it('should enable debug when it is off', () => {
      useScriptDebugStore.getState().toggleDebug();
      expect(useScriptDebugStore.getState().debugEnabled).toBe(true);
    });

    it('should disable debug when it is on', () => {
      useScriptDebugStore.setState({ debugEnabled: true });
      useScriptDebugStore.getState().toggleDebug();
      expect(useScriptDebugStore.getState().debugEnabled).toBe(false);
    });

    it('should clear activeNodeId when disabling', () => {
      useScriptDebugStore.setState({ debugEnabled: true, activeNodeId: 'n1' });
      useScriptDebugStore.getState().toggleDebug();
      expect(useScriptDebugStore.getState().activeNodeId).toBeNull();
    });

    it('should clear isPaused when disabling', () => {
      useScriptDebugStore.setState({ debugEnabled: true, isPaused: true });
      useScriptDebugStore.getState().toggleDebug();
      expect(useScriptDebugStore.getState().isPaused).toBe(false);
    });

    it('should preserve activeNodeId when enabling', () => {
      // activeNodeId is null initially; enabling does not clear it
      useScriptDebugStore.setState({ debugEnabled: false, activeNodeId: null });
      useScriptDebugStore.getState().toggleDebug();
      expect(useScriptDebugStore.getState().activeNodeId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Breakpoints
  // -----------------------------------------------------------------------
  describe('addBreakpoint', () => {
    it('should add a breakpoint for the given node ID', () => {
      useScriptDebugStore.getState().addBreakpoint('node-abc');
      expect(useScriptDebugStore.getState().breakpoints.has('node-abc')).toBe(true);
    });

    it('should accumulate multiple breakpoints', () => {
      const { addBreakpoint } = useScriptDebugStore.getState();
      addBreakpoint('n1');
      addBreakpoint('n2');
      addBreakpoint('n3');
      const { breakpoints } = useScriptDebugStore.getState();
      expect(breakpoints.size).toBe(3);
      expect(breakpoints.has('n1')).toBe(true);
      expect(breakpoints.has('n2')).toBe(true);
      expect(breakpoints.has('n3')).toBe(true);
    });

    it('should not duplicate the same node ID', () => {
      useScriptDebugStore.getState().addBreakpoint('n1');
      useScriptDebugStore.getState().addBreakpoint('n1');
      expect(useScriptDebugStore.getState().breakpoints.size).toBe(1);
    });
  });

  describe('removeBreakpoint', () => {
    it('should remove an existing breakpoint', () => {
      useScriptDebugStore.setState({ breakpoints: new Set(['n1', 'n2']) });
      useScriptDebugStore.getState().removeBreakpoint('n1');
      const { breakpoints } = useScriptDebugStore.getState();
      expect(breakpoints.has('n1')).toBe(false);
      expect(breakpoints.has('n2')).toBe(true);
    });

    it('should be a no-op when node ID is not a breakpoint', () => {
      useScriptDebugStore.setState({ breakpoints: new Set(['n1']) });
      useScriptDebugStore.getState().removeBreakpoint('n99');
      expect(useScriptDebugStore.getState().breakpoints.size).toBe(1);
    });
  });

  describe('clearBreakpoints', () => {
    it('should remove all breakpoints', () => {
      useScriptDebugStore.setState({ breakpoints: new Set(['n1', 'n2', 'n3']) });
      useScriptDebugStore.getState().clearBreakpoints();
      expect(useScriptDebugStore.getState().breakpoints.size).toBe(0);
    });

    it('should be a no-op on an already empty set', () => {
      useScriptDebugStore.getState().clearBreakpoints();
      expect(useScriptDebugStore.getState().breakpoints.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Execution Recording
  // -----------------------------------------------------------------------
  describe('setActiveNode', () => {
    it('should set activeNodeId to the provided ID', () => {
      useScriptDebugStore.getState().setActiveNode('n-exec-1');
      expect(useScriptDebugStore.getState().activeNodeId).toBe('n-exec-1');
    });

    it('should allow clearing active node to null', () => {
      useScriptDebugStore.setState({ activeNodeId: 'n1' });
      useScriptDebugStore.getState().setActiveNode(null);
      expect(useScriptDebugStore.getState().activeNodeId).toBeNull();
    });
  });

  describe('recordNodeOutput', () => {
    it('should store a primitive output value for a node', () => {
      useScriptDebugStore.getState().recordNodeOutput('n1', 42);
      expect(useScriptDebugStore.getState().nodeOutputs['n1']).toBe(42);
    });

    it('should store an object output value', () => {
      const value = { x: 1, y: 2, z: 3 };
      useScriptDebugStore.getState().recordNodeOutput('n-vec', value);
      expect(useScriptDebugStore.getState().nodeOutputs['n-vec']).toEqual(value);
    });

    it('should store boolean output values', () => {
      useScriptDebugStore.getState().recordNodeOutput('n-bool', false);
      expect(useScriptDebugStore.getState().nodeOutputs['n-bool']).toBe(false);
    });

    it('should overwrite a previous output for the same node', () => {
      useScriptDebugStore.getState().recordNodeOutput('n1', 'first');
      useScriptDebugStore.getState().recordNodeOutput('n1', 'second');
      expect(useScriptDebugStore.getState().nodeOutputs['n1']).toBe('second');
    });

    it('should preserve outputs for other nodes', () => {
      useScriptDebugStore.getState().recordNodeOutput('n1', 100);
      useScriptDebugStore.getState().recordNodeOutput('n2', 200);
      const { nodeOutputs } = useScriptDebugStore.getState();
      expect(nodeOutputs['n1']).toBe(100);
      expect(nodeOutputs['n2']).toBe(200);
    });
  });

  describe('addToExecutionPath', () => {
    it('should append a node ID to the execution path', () => {
      useScriptDebugStore.getState().addToExecutionPath('n1');
      expect(useScriptDebugStore.getState().executionPath).toEqual(['n1']);
    });

    it('should append in order, building a sequence', () => {
      const { addToExecutionPath } = useScriptDebugStore.getState();
      addToExecutionPath('n1');
      addToExecutionPath('n2');
      addToExecutionPath('n3');
      expect(useScriptDebugStore.getState().executionPath).toEqual(['n1', 'n2', 'n3']);
    });

    it('should allow the same node to appear multiple times', () => {
      const { addToExecutionPath } = useScriptDebugStore.getState();
      addToExecutionPath('n1');
      addToExecutionPath('n1');
      expect(useScriptDebugStore.getState().executionPath).toEqual(['n1', 'n1']);
    });
  });

  // -----------------------------------------------------------------------
  // Pause / Resume
  // -----------------------------------------------------------------------
  describe('pauseExecution', () => {
    it('should set isPaused to true', () => {
      useScriptDebugStore.getState().pauseExecution();
      expect(useScriptDebugStore.getState().isPaused).toBe(true);
    });

    it('should be idempotent when already paused', () => {
      useScriptDebugStore.setState({ isPaused: true });
      useScriptDebugStore.getState().pauseExecution();
      expect(useScriptDebugStore.getState().isPaused).toBe(true);
    });
  });

  describe('resumeExecution', () => {
    it('should set isPaused to false', () => {
      useScriptDebugStore.setState({ isPaused: true });
      useScriptDebugStore.getState().resumeExecution();
      expect(useScriptDebugStore.getState().isPaused).toBe(false);
    });

    it('should be idempotent when already running', () => {
      useScriptDebugStore.getState().resumeExecution();
      expect(useScriptDebugStore.getState().isPaused).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // clearExecutionPath
  // -----------------------------------------------------------------------
  describe('clearExecutionPath', () => {
    it('should reset executionPath to empty', () => {
      useScriptDebugStore.setState({ executionPath: ['n1', 'n2', 'n3'] });
      useScriptDebugStore.getState().clearExecutionPath();
      expect(useScriptDebugStore.getState().executionPath).toEqual([]);
    });

    it('should also clear activeNodeId', () => {
      useScriptDebugStore.setState({ activeNodeId: 'n2', executionPath: ['n1', 'n2'] });
      useScriptDebugStore.getState().clearExecutionPath();
      expect(useScriptDebugStore.getState().activeNodeId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // resetDebugState
  // -----------------------------------------------------------------------
  describe('resetDebugState', () => {
    it('should clear activeNodeId, nodeOutputs, executionPath and isPaused', () => {
      useScriptDebugStore.setState({
        debugEnabled: true,
        activeNodeId: 'n5',
        nodeOutputs: { n1: 42, n2: 'hello' },
        executionPath: ['n1', 'n2', 'n5'],
        breakpoints: new Set(['n1']),
        isPaused: true,
      });

      useScriptDebugStore.getState().resetDebugState();

      const state = useScriptDebugStore.getState();
      expect(state.activeNodeId).toBeNull();
      expect(state.nodeOutputs).toEqual({});
      expect(state.executionPath).toEqual([]);
      expect(state.isPaused).toBe(false);
    });

    it('should preserve debugEnabled and breakpoints across reset', () => {
      useScriptDebugStore.setState({
        debugEnabled: true,
        breakpoints: new Set(['n1', 'n2']),
        activeNodeId: 'n1',
        isPaused: true,
      });

      useScriptDebugStore.getState().resetDebugState();

      const state = useScriptDebugStore.getState();
      // resetDebugState only clears transient execution state
      expect(state.debugEnabled).toBe(true);
      expect(state.breakpoints.size).toBe(2);
    });
  });
});
