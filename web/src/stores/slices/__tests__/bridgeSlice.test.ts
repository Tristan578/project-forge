import { describe, it, expect, beforeEach } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import { createBridgeSlice, type BridgeSlice } from '../bridgeSlice';

describe('BridgeSlice', () => {
  let store: ReturnType<typeof createSliceStore<BridgeSlice>>;

  beforeEach(() => {
    store = createSliceStore<BridgeSlice>(createBridgeSlice);
  });

  describe('initial state', () => {
    it('starts with no discovered tools', () => {
      expect(store.getState().bridgeTools).toEqual({});
    });

    it('starts with no running operations', () => {
      expect(store.getState().bridgeOperations).toEqual([]);
    });
  });

  describe('setBridgeTool', () => {
    it('adds a discovered tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });
      expect(store.getState().bridgeTools.aseprite).toBeDefined();
      expect(store.getState().bridgeTools.aseprite.status).toBe('connected');
    });

    it('updates an existing tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'not_found',
      });
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });
      expect(store.getState().bridgeTools.aseprite.status).toBe('connected');
    });
  });

  describe('removeBridgeTool', () => {
    it('removes a tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'connected',
      });
      store.getState().removeBridgeTool('aseprite');
      expect(store.getState().bridgeTools.aseprite).toBeUndefined();
    });
  });

  describe('bridge operations', () => {
    it('adds a running operation', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'running',
        startedAt: Date.now(),
      });
      expect(store.getState().bridgeOperations).toHaveLength(1);
      expect(store.getState().bridgeOperations[0].status).toBe('running');
    });

    it('updates operation status', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'running',
        startedAt: Date.now(),
      });
      store.getState().updateBridgeOperation('op-1', { status: 'completed' });
      expect(store.getState().bridgeOperations[0].status).toBe('completed');
    });

    it('removes completed operations', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'completed',
        startedAt: Date.now(),
      });
      store.getState().removeBridgeOperation('op-1');
      expect(store.getState().bridgeOperations).toHaveLength(0);
    });
  });
});
