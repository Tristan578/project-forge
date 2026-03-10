import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleMaterialEvent } from '../materialEvents';
import type { CustomWgslSource } from '@/stores/slices/types';

describe('handleMaterialEvent — custom WGSL', () => {
  let actions: ReturnType<typeof createMockActions> & { setCustomWgslSource: ReturnType<typeof vi.fn> };
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    const baseActions = createMockActions();
    actions = {
      ...baseActions,
      setCustomWgslSource: vi.fn(),
    };
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  it('CUSTOM_WGSL_SOURCE_CHANGED: calls setCustomWgslSource with payload', () => {
    const source: CustomWgslSource = {
      userCode: 'return base_color * user_color;',
      name: 'Tint Effect',
      compileStatus: 'ok',
      compileError: null,
    };

    const result = handleMaterialEvent(
      'CUSTOM_WGSL_SOURCE_CHANGED',
      source as unknown as Record<string, unknown>,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setCustomWgslSource).toHaveBeenCalledWith(source);
  });

  it('CUSTOM_WGSL_SOURCE_CHANGED: handles error status', () => {
    const source: CustomWgslSource = {
      userCode: 'this is invalid',
      name: 'Bad Shader',
      compileStatus: 'error',
      compileError: 'Unbalanced braces: 1 open, 0 close',
    };

    const result = handleMaterialEvent(
      'CUSTOM_WGSL_SOURCE_CHANGED',
      source as unknown as Record<string, unknown>,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.setCustomWgslSource).toHaveBeenCalledWith(
      expect.objectContaining({
        compileStatus: 'error',
        compileError: 'Unbalanced braces: 1 open, 0 close',
      })
    );
  });

  it('CUSTOM_WGSL_SOURCE_CHANGED: handles pending status', () => {
    const source: CustomWgslSource = {
      userCode: 'return base_color;',
      name: 'Passthrough',
      compileStatus: 'pending',
      compileError: null,
    };

    handleMaterialEvent(
      'CUSTOM_WGSL_SOURCE_CHANGED',
      source as unknown as Record<string, unknown>,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(actions.setCustomWgslSource).toHaveBeenCalledWith(
      expect.objectContaining({ compileStatus: 'pending' })
    );
  });

  it('returns false for unrelated event types', () => {
    const result = handleMaterialEvent(
      'UNRELATED_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });
});
