/**
 * Unit tests for useProjectType hook — 2D/3D workflow gating.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectType } from '../useProjectType';
import { useEditorStore } from '@/stores/editorStore';

describe('useProjectType', () => {
  beforeEach(() => {
    useEditorStore.setState({ projectType: '3d' });
  });

  describe('3D project mode', () => {
    beforeEach(() => {
      useEditorStore.setState({ projectType: '3d' });
    });

    it('returns is3D true and is2D false', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.is3D).toBe(true);
      expect(result.current.is2D).toBe(false);
    });

    it('returns projectType as "3d"', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.projectType).toBe('3d');
    });

    it('canCreate allows 3D entity types', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.canCreate('cube')).toBe(true);
      expect(result.current.canCreate('sphere')).toBe(true);
      expect(result.current.canCreate('light')).toBe(true);
      expect(result.current.canCreate('camera')).toBe(true);
      expect(result.current.canCreate('mesh')).toBe(true);
    });

    it('canCreate rejects 2D-only entity types', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.canCreate('sprite')).toBe(false);
      expect(result.current.canCreate('camera2d')).toBe(false);
    });
  });

  describe('2D project mode', () => {
    beforeEach(() => {
      useEditorStore.setState({ projectType: '2d' });
    });

    it('returns is2D true and is3D false', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.is2D).toBe(true);
      expect(result.current.is3D).toBe(false);
    });

    it('returns projectType as "2d"', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.projectType).toBe('2d');
    });

    it('canCreate allows 2D entity types', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.canCreate('sprite')).toBe(true);
      expect(result.current.canCreate('camera2d')).toBe(true);
    });

    it('canCreate rejects 3D-only entity types', () => {
      const { result } = renderHook(() => useProjectType());
      expect(result.current.canCreate('cube')).toBe(false);
      expect(result.current.canCreate('sphere')).toBe(false);
      expect(result.current.canCreate('light')).toBe(false);
      expect(result.current.canCreate('camera')).toBe(false);
      expect(result.current.canCreate('mesh')).toBe(false);
    });
  });

  describe('canCreate boundary cases', () => {
    it('handles empty string entity type in 3D mode', () => {
      useEditorStore.setState({ projectType: '3d' });
      const { result } = renderHook(() => useProjectType());
      // Empty string is not in the 2D exclusion list, so it's allowed in 3D
      expect(result.current.canCreate('')).toBe(true);
    });

    it('handles empty string entity type in 2D mode', () => {
      useEditorStore.setState({ projectType: '2d' });
      const { result } = renderHook(() => useProjectType());
      // Empty string is not in the 2D inclusion list, so it's rejected
      expect(result.current.canCreate('')).toBe(false);
    });

    it('is case-sensitive for entity type matching', () => {
      useEditorStore.setState({ projectType: '2d' });
      const { result } = renderHook(() => useProjectType());
      expect(result.current.canCreate('sprite')).toBe(true);
      expect(result.current.canCreate('Sprite')).toBe(false);
      expect(result.current.canCreate('SPRITE')).toBe(false);
    });
  });

  describe('reactivity', () => {
    it('updates when projectType changes from 3D to 2D', () => {
      useEditorStore.setState({ projectType: '3d' });
      const { result, rerender } = renderHook(() => useProjectType());
      expect(result.current.is3D).toBe(true);

      useEditorStore.setState({ projectType: '2d' });
      rerender();
      expect(result.current.is2D).toBe(true);
      expect(result.current.is3D).toBe(false);
    });

    it('updates canCreate results when mode changes', () => {
      useEditorStore.setState({ projectType: '3d' });
      const { result, rerender } = renderHook(() => useProjectType());
      expect(result.current.canCreate('sprite')).toBe(false);

      useEditorStore.setState({ projectType: '2d' });
      rerender();
      expect(result.current.canCreate('sprite')).toBe(true);
    });
  });
});
