/**
 * Tests for InspectorErrorBoundary component logic.
 * Since @testing-library/react is not available and vitest only includes
 * .test.ts files, we test the class component's static methods and
 * state management logic directly.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { InspectorErrorBoundary } from '../InspectorErrorBoundary';

describe('InspectorErrorBoundary', () => {
  describe('getDerivedStateFromError', () => {
    it('should return hasError true with the error object', () => {
      const error = new Error('Test crash');
      const result = InspectorErrorBoundary.getDerivedStateFromError(error);

      expect(result.hasError).toBe(true);
      expect(result.error).toBe(error);
    });

    it('should preserve error message in state', () => {
      const error = new Error('Material inspector failed');
      const result = InspectorErrorBoundary.getDerivedStateFromError(error);

      expect(result.error?.message).toBe('Material inspector failed');
    });
  });

  describe('component structure', () => {
    it('should be a class component (React error boundary requirement)', () => {
      expect(typeof InspectorErrorBoundary).toBe('function');
      expect(InspectorErrorBoundary.prototype.render).not.toBeUndefined();
      expect(InspectorErrorBoundary.prototype.componentDidCatch).not.toBeUndefined();
    });

    it('should have getDerivedStateFromError static method', () => {
      expect(typeof InspectorErrorBoundary.getDerivedStateFromError).toBe('function');
    });

    it('should accept section prop for labeling', () => {
      // Verify the component can be instantiated with required props
      const instance = new InspectorErrorBoundary({ section: 'Material', children: null });
      expect(instance.state).toEqual({ hasError: false, error: null });
    });
  });

  describe('error state management', () => {
    it('should initialize with no error', () => {
      const instance = new InspectorErrorBoundary({ section: 'Physics', children: null });
      expect(instance.state.hasError).toBe(false);
      expect(instance.state.error).toBeNull();
    });

    it('should transition to error state via getDerivedStateFromError', () => {
      const error = new Error('Physics exploded');
      const newState = InspectorErrorBoundary.getDerivedStateFromError(error);

      expect(newState).toEqual({
        hasError: true,
        error,
      });
    });
  });
});
