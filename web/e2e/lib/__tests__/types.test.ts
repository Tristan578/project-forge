/**
 * Type-level tests for the shared types in types.ts
 *
 * These tests verify structural compatibility, default field behavior,
 * and discriminated union exhaustiveness — all at the TypeScript level.
 * Runtime assertions confirm the type definitions match actual usage patterns.
 */
import { describe, it, expect } from 'vitest';
import type {
  ViewportCapture,
  SceneSnapshot,
  SceneNodeSummary,
  ViewportObservation,
  CommandResult,
  VerificationResult,
  CaptureOptions,
} from '../types';

describe('ViewportCapture shape', () => {
  it('accepts all valid backend values', () => {
    const backends: ViewportCapture['backend'][] = ['webgl2', 'webgpu', 'unknown'];
    expect(backends).toHaveLength(3);
  });

  it('can be constructed with required fields', () => {
    const capture: ViewportCapture = {
      dataUrl: 'data:image/png;base64,abc',
      width: 1280,
      height: 720,
      timestamp: Date.now(),
      backend: 'webgl2',
      isBlank: false,
    };
    expect(capture.width).toBe(1280);
    expect(capture.backend).toBe('webgl2');
  });
});

describe('SceneNodeSummary shape', () => {
  it('allows optional transform field', () => {
    const nodeWithTransform: SceneNodeSummary = {
      id: 'e1',
      name: 'Cube',
      type: 'Mesh',
      visible: true,
      children: [],
      parentId: null,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    };
    expect(nodeWithTransform.transform?.position[1]).toBe(0);
  });

  it('allows node without transform', () => {
    const nodeNoTransform: SceneNodeSummary = {
      id: 'e1',
      name: 'Cube',
      type: 'Mesh',
      visible: true,
      children: [],
      parentId: null,
    };
    expect(nodeNoTransform.transform).toBeUndefined();
  });

  it('allows string parentId', () => {
    const childNode: SceneNodeSummary = {
      id: 'e2',
      name: 'Child',
      type: 'Mesh',
      visible: true,
      children: [],
      parentId: 'e1',
    };
    expect(childNode.parentId).toBe('e1');
  });
});

describe('SceneSnapshot shape', () => {
  it('can be constructed with empty scene', () => {
    const empty: SceneSnapshot = {
      entityCount: 0,
      rootIds: [],
      nodes: {},
      selectedIds: [],
      engineMode: 'edit',
      sceneName: 'Untitled',
    };
    expect(empty.entityCount).toBe(0);
  });

  it('accepts all valid engineMode values', () => {
    const modes: SceneSnapshot['engineMode'][] = ['edit', 'play', 'paused'];
    expect(modes).toHaveLength(3);
  });
});

describe('ViewportObservation shape', () => {
  it('has optional label', () => {
    const obs: ViewportObservation = {
      scene: {
        entityCount: 0, rootIds: [], nodes: {},
        selectedIds: [], engineMode: 'edit', sceneName: 'Test',
      },
      viewport: {
        dataUrl: '', width: 0, height: 0,
        timestamp: 0, backend: 'unknown', isBlank: true,
      },
      consoleErrors: [],
      capturedAt: 0,
    };
    expect(obs.label).toBeUndefined();
  });
});

describe('CommandResult shape', () => {
  it('success result has no error', () => {
    const result: CommandResult = {
      success: true,
      durationMs: 10,
    };
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('failure result has error message', () => {
    const result: CommandResult = {
      success: false,
      error: 'Engine not initialized',
      durationMs: 5,
    };
    expect(result.error).toBe('Engine not initialized');
  });

  it('spawn result can include entityId', () => {
    const result: CommandResult = {
      success: true,
      entityId: 'entity-abc',
      durationMs: 15,
    };
    expect(result.entityId).toBe('entity-abc');
  });
});

describe('VerificationResult shape', () => {
  it('passed result has truthy evidence', () => {
    const result: VerificationResult = {
      passed: true,
      reason: 'Found',
      evidence: {
        sceneSnapshot: {
          entityCount: 1, rootIds: ['e1'], nodes: {},
          selectedIds: [], engineMode: 'edit', sceneName: 'Test',
        },
      },
    };
    expect(result.passed).toBe(true);
    expect(result.evidence.sceneSnapshot?.entityCount).toBe(1);
  });

  it('failed result can have empty evidence', () => {
    const result: VerificationResult = {
      passed: false,
      reason: 'Store unavailable',
      evidence: {},
    };
    expect(result.evidence.sceneSnapshot).toBeUndefined();
    expect(result.evidence.viewport).toBeUndefined();
  });
});

describe('CaptureOptions shape', () => {
  it('all fields are optional', () => {
    const opts: CaptureOptions = {};
    expect(opts.canvasSelector).toBeUndefined();
    expect(opts.maxRetries).toBeUndefined();
    expect(opts.retryDelayMs).toBeUndefined();
  });

  it('accepts all fields', () => {
    const opts: CaptureOptions = {
      canvasSelector: '#myCanvas',
      maxRetries: 5,
      retryDelayMs: 200,
    };
    expect(opts.maxRetries).toBe(5);
  });
});
