/**
 * Unit tests for viewportFormatter.ts
 *
 * These are pure function tests — no Playwright, no browser required.
 */
import { describe, it, expect } from 'vitest';
import { formatObservation, formatVerificationResult } from '../viewportFormatter';
import type { ViewportObservation, VerificationResult, SceneSnapshot, ViewportCapture } from '../types';

function makeViewportCapture(overrides?: Partial<ViewportCapture>): ViewportCapture {
  return {
    dataUrl: 'data:image/png;base64,abc',
    width: 1280,
    height: 720,
    timestamp: 1000000000000,
    backend: 'webgl2',
    isBlank: false,
    ...overrides,
  };
}

function makeSceneSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
  return {
    entityCount: 2,
    rootIds: ['entity-1', 'entity-2'],
    nodes: {
      'entity-1': { id: 'entity-1', name: 'Cube', type: 'Mesh', visible: true, children: [], parentId: null },
      'entity-2': { id: 'entity-2', name: 'Light', type: 'Light', visible: true, children: [], parentId: null },
    },
    selectedIds: ['entity-1'],
    engineMode: 'edit',
    sceneName: 'My Scene',
    ...overrides,
  };
}

function makeObservation(overrides?: Partial<ViewportObservation>): ViewportObservation {
  return {
    label: 'test observation',
    scene: makeSceneSnapshot(),
    viewport: makeViewportCapture(),
    consoleErrors: [],
    capturedAt: 1000000000000,
    ...overrides,
  };
}

describe('formatObservation', () => {
  it('includes the label when provided', () => {
    const obs = makeObservation({ label: 'after spawn' });
    const result = formatObservation(obs);
    expect(result).toContain('after spawn');
  });

  it('omits the label dash when no label is provided', () => {
    const obs = makeObservation({ label: undefined });
    const result = formatObservation(obs);
    // Header should not have a dash + label suffix
    expect(result).toContain('## Viewport Observation\n');
    // The header line itself should not contain an em-dash (entity rows may still)
    const headerLine = result.split('\n')[0];
    expect(headerLine).not.toContain('—');
  });

  it('includes engine mode', () => {
    const obs = makeObservation({ scene: makeSceneSnapshot({ engineMode: 'play' }) });
    const result = formatObservation(obs);
    expect(result).toContain('**play**');
  });

  it('includes entity count', () => {
    const obs = makeObservation();
    const result = formatObservation(obs);
    expect(result).toContain('2');
  });

  it('includes entity names and types', () => {
    const obs = makeObservation();
    const result = formatObservation(obs);
    expect(result).toContain('Cube');
    expect(result).toContain('Light');
    expect(result).toContain('Mesh');
  });

  it('marks hidden entities with (hidden)', () => {
    const obs = makeObservation({
      scene: makeSceneSnapshot({
        nodes: {
          'entity-1': { id: 'entity-1', name: 'HiddenCube', type: 'Mesh', visible: false, children: [], parentId: null },
        },
        rootIds: ['entity-1'],
        entityCount: 1,
      }),
    });
    const result = formatObservation(obs);
    expect(result).toContain('*(hidden)*');
  });

  it('shows "none" when no console errors', () => {
    const obs = makeObservation({ consoleErrors: [] });
    const result = formatObservation(obs);
    expect(result).toContain('- None');
  });

  it('lists console errors when present', () => {
    const obs = makeObservation({ consoleErrors: ['TypeError: foo is not a function'] });
    const result = formatObservation(obs);
    expect(result).toContain('TypeError: foo is not a function');
  });

  it('shows blank frame warning when isBlank is true', () => {
    const obs = makeObservation({ viewport: makeViewportCapture({ isBlank: true }) });
    const result = formatObservation(obs);
    expect(result).toContain('engine may not have rendered yet');
  });

  it('shows selected entity count', () => {
    const obs = makeObservation();
    const result = formatObservation(obs);
    expect(result).toContain('entity-1');
  });
});

describe('formatVerificationResult', () => {
  it('shows PASS when passed is true', () => {
    const result: VerificationResult = {
      passed: true,
      reason: 'Entity found',
      evidence: {},
    };
    expect(formatVerificationResult(result)).toContain('PASS');
  });

  it('shows FAIL when passed is false', () => {
    const result: VerificationResult = {
      passed: false,
      reason: 'Entity not found',
      evidence: {},
    };
    expect(formatVerificationResult(result)).toContain('FAIL');
  });

  it('includes the reason', () => {
    const result: VerificationResult = {
      passed: true,
      reason: 'All checks passed',
      evidence: {},
    };
    expect(formatVerificationResult(result)).toContain('All checks passed');
  });

  it('includes scene evidence when provided', () => {
    const result: VerificationResult = {
      passed: true,
      reason: 'ok',
      evidence: { sceneSnapshot: makeSceneSnapshot() },
    };
    const formatted = formatVerificationResult(result);
    expect(formatted).toContain('2 entities');
    expect(formatted).toContain('edit');
  });

  it('includes viewport evidence when provided', () => {
    const result: VerificationResult = {
      passed: false,
      reason: 'blank',
      evidence: { viewport: makeViewportCapture({ isBlank: true }) },
    };
    const formatted = formatVerificationResult(result);
    expect(formatted).toContain('1280');
    expect(formatted).toContain('webgl2');
  });
});
