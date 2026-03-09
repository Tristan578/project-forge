/**
 * E2E tests with mock bridge — validates the full SpawnForge pipeline:
 * bridge API -> result processing -> store updates
 *
 * Uses mocked responses (from recorded fixtures pattern).
 * Runs in CI without Aseprite installed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';
import { createBridgeSlice, type BridgeSlice } from '@/stores/slices/bridgeSlice';

vi.mock('@/lib/bridges/bridgeManager', () => ({
  discoverTool: vi.fn(),
  healthCheck: vi.fn(),
  loadBridgesConfig: vi.fn(() => ({})),
  saveBridgesConfig: vi.fn(),
  getDefaultPaths: vi.fn(() => ({
    darwin: '/Applications/Aseprite.app/Contents/MacOS/aseprite',
  })),
}));

vi.mock('@/lib/bridges/asepriteBridge', () => ({
  executeOperation: vi.fn(),
  parseOutput: vi.fn(),
}));

describe('Bridge E2E Pipeline', () => {
  let store: ReturnType<typeof createSliceStore<BridgeSlice>>;
  let bridgeManager: typeof import('../bridgeManager');
  let asepriteBridge: typeof import('../asepriteBridge');

  beforeEach(async () => {
    vi.resetModules();
    store = createSliceStore<BridgeSlice>(createBridgeSlice);
    bridgeManager = await import('../bridgeManager');
    asepriteBridge = await import('../asepriteBridge');
  });

  it('full discover -> execute -> store update pipeline', async () => {
    // 1. Discover tool
    vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
      id: 'aseprite',
      name: 'Aseprite',
      paths: { darwin: '/usr/bin/aseprite' },
      activeVersion: '1.3.17',
      status: 'connected',
    });

    const toolConfig = await bridgeManager.discoverTool('aseprite');
    store.getState().setBridgeTool(toolConfig);
    expect(store.getState().bridgeTools.aseprite.status).toBe('connected');

    // 2. Start operation
    const opId = 'op-create-sprite-1';
    store.getState().addBridgeOperation({
      id: opId,
      toolId: 'aseprite',
      operationName: 'createSprite',
      status: 'running',
      startedAt: Date.now(),
    });
    expect(store.getState().bridgeOperations[0].status).toBe('running');

    // 3. Execute (mocked)
    vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
      success: true,
      stdout: 'OK:32x32',
      exitCode: 0,
      outputFiles: ['/tmp/sprite.png'],
    });

    const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
      name: 'createSprite',
      params: { width: '32', height: '32' },
    });

    // 4. Update store
    store.getState().updateBridgeOperation(opId, {
      status: result.success ? 'completed' : 'failed',
    });
    expect(store.getState().bridgeOperations[0].status).toBe('completed');

    // 5. Clean up
    store.getState().removeBridgeOperation(opId);
    expect(store.getState().bridgeOperations).toHaveLength(0);
  });

  it('handles discovery failure gracefully', async () => {
    vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
      id: 'aseprite',
      name: 'Aseprite',
      paths: {},
      activeVersion: null,
      status: 'not_found',
    });

    const toolConfig = await bridgeManager.discoverTool('aseprite');
    store.getState().setBridgeTool(toolConfig);
    expect(store.getState().bridgeTools.aseprite.status).toBe('not_found');
  });

  it('handles execution failure and updates store', async () => {
    store.getState().setBridgeTool({
      id: 'aseprite',
      name: 'Aseprite',
      paths: { darwin: '/usr/bin/aseprite' },
      activeVersion: '1.3.17',
      status: 'connected',
    });

    const opId = 'op-fail-1';
    store.getState().addBridgeOperation({
      id: opId,
      toolId: 'aseprite',
      operationName: 'createSprite',
      status: 'running',
      startedAt: Date.now(),
    });

    vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
      success: false,
      error: 'Script error at line 5',
      exitCode: 1,
    });

    const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
      name: 'createSprite',
      params: {},
    });

    store.getState().updateBridgeOperation(opId, {
      status: 'failed',
      error: result.error,
    });

    expect(store.getState().bridgeOperations[0].status).toBe('failed');
    expect(store.getState().bridgeOperations[0].error).toBe('Script error at line 5');
  });
});
