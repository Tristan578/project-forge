import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createMaterialSlice, setMaterialDispatcher, type MaterialSlice } from '../materialSlice';
import type { CustomWgslSource } from '../types';

describe('materialSlice — custom WGSL', () => {
  let store: ReturnType<typeof createSliceStore<MaterialSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setMaterialDispatcher(mockDispatch);
    store = createSliceStore(createMaterialSlice);
  });

  afterEach(() => {
    setMaterialDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with null customWgslSource', () => {
      expect(store.getState().customWgslSource).toBeNull();
    });
  });

  describe('setCustomWgslSource', () => {
    it('should store the source', () => {
      const src: CustomWgslSource = {
        userCode: 'return base_color;',
        name: 'Test',
        compileStatus: 'ok',
        compileError: null,
      };
      store.getState().setCustomWgslSource(src);
      expect(store.getState().customWgslSource).toEqual(src);
    });

    it('should clear the source when called with null', () => {
      const src: CustomWgslSource = {
        userCode: 'return vec4(1.0);',
        name: 'Red',
        compileStatus: 'ok',
        compileError: null,
      };
      store.getState().setCustomWgslSource(src);
      store.getState().setCustomWgslSource(null);
      expect(store.getState().customWgslSource).toBeNull();
    });
  });

  describe('updateCustomWgslSource', () => {
    it('should dispatch set_custom_wgsl_source command', () => {
      store.getState().updateCustomWgslSource('return base_color * user_color;', 'Tint');
      expect(mockDispatch).toHaveBeenCalledWith('set_custom_wgsl_source', {
        userCode: 'return base_color * user_color;',
        name: 'Tint',
      });
    });

    it('should set pending status optimistically when source exists', () => {
      // Set an existing source first
      store.getState().setCustomWgslSource({
        userCode: 'return base_color;',
        name: 'Old',
        compileStatus: 'ok',
        compileError: null,
      });

      store.getState().updateCustomWgslSource('return vec4(1.0, 0.0, 0.0, 1.0);', 'Red');

      const state = store.getState().customWgslSource;
      expect(state?.compileStatus).toBe('pending');
      expect(state?.compileError).toBeNull();
      expect(state?.userCode).toBe('return vec4(1.0, 0.0, 0.0, 1.0);');
      expect(state?.name).toBe('Red');
    });

    it('should create new source when none exists', () => {
      store.getState().updateCustomWgslSource('return base_color;', 'New Shader');
      const state = store.getState().customWgslSource;
      expect(state).not.toBeNull();
      expect(state?.compileStatus).toBe('pending');
    });

    it('should not dispatch if no dispatcher set', () => {
      setMaterialDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().updateCustomWgslSource('return base_color;', 'Test');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('validateWgsl', () => {
    it('should dispatch validate_wgsl command', () => {
      store.getState().validateWgsl('return base_color;');
      expect(mockDispatch).toHaveBeenCalledWith('validate_wgsl', {
        code: 'return base_color;',
      });
    });

    it('should not dispatch if no dispatcher set', () => {
      setMaterialDispatcher(null as unknown as (command: string, payload: unknown) => void);
      store.getState().validateWgsl('return base_color;');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
