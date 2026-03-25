/**
 * Unit tests for PacingAnalyzerPanel.
 *
 * Verifies that the panel:
 *  - Renders the correct UI states (empty, with entities).
 *  - Only re-runs pacing analysis when entity ids/names/types change —
 *    NOT on every transform update (PF-873 regression guard).
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { useEditorStore } from '@/stores/editorStore';
import { analyzePacing } from '@/lib/ai/emotionalPacing';

// Mock the heavy analysis function so we can count invocations.
vi.mock('@/lib/ai/emotionalPacing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/emotionalPacing')>();
  return {
    ...actual,
    analyzePacing: vi.fn(actual.analyzePacing),
  };
});

import { PacingAnalyzerPanel } from '../PacingAnalyzerPanel';

const mockedAnalyzePacing = vi.mocked(analyzePacing);

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  useEditorStore.setState({
    sceneGraph: { nodes: {}, rootIds: [] },
    nodeCount: 0,
  });
});

const oneEntityState = {
  sceneGraph: {
    nodes: {
      'e1': { entityId: 'e1', name: 'Entity One', parentId: null, children: [], components: ['mesh'], visible: true },
    },
    rootIds: ['e1'],
  },
  nodeCount: 1,
};

describe('PacingAnalyzerPanel', () => {
  describe('empty state', () => {
    it('shows the empty state prompt when there are no entities', () => {
      render(<PacingAnalyzerPanel />);
      expect(screen.getByText(/Add entities to the scene to analyze pacing/i)).toBeTruthy();
    });

    it('does not run analysis when there are no entities', () => {
      render(<PacingAnalyzerPanel />);
      expect(mockedAnalyzePacing).not.toHaveBeenCalled();
    });
  });

  describe('with entities', () => {
    it('renders the pacing chart when entities are present', () => {
      useEditorStore.setState(oneEntityState);

      const { container } = render(<PacingAnalyzerPanel />);

      // Use querySelector to find the svg with role img — avoids duplicate-match
      // issues if the component ever renders multiple SVGs.
      const chart = container.querySelector('svg[aria-label="Emotional pacing chart"]');
      expect(chart).toBeTruthy();
    });

    it('runs analysis once when entities are first provided', () => {
      useEditorStore.setState(oneEntityState);

      render(<PacingAnalyzerPanel />);

      // Analysis should have been called at least once on initial render
      // with entities present.
      expect(mockedAnalyzePacing).toHaveBeenCalledTimes(1);
    });
  });

  describe('PF-873 regression — no re-analysis on transform events', () => {
    it('does not re-run analysis when the store updates an unrelated field', () => {
      useEditorStore.setState(oneEntityState);

      render(<PacingAnalyzerPanel />);
      const initialCallCount = mockedAnalyzePacing.mock.calls.length;

      // Simulate a transform event — store update that does NOT change
      // any pacing-relevant field (id, name, component type).
      // The nodes reference changes (new object) but the key-string is identical.
      // Wrap in act() so React flushes any re-render if the selector fires.
      act(() => {
        useEditorStore.setState((prev) => ({
          ...prev,
          sceneGraph: {
            ...prev.sceneGraph,
            nodes: {
              'e1': {
                ...prev.sceneGraph.nodes['e1'],
                // No name/components change — only positional metadata would have changed.
              },
            },
          },
        }));
      });

      // Analysis should NOT be called again — the key string is unchanged.
      expect(mockedAnalyzePacing.mock.calls.length).toBe(initialCallCount);
    });

    it('does re-run analysis when an entity name changes', () => {
      useEditorStore.setState(oneEntityState);

      render(<PacingAnalyzerPanel />);
      const callsBefore = mockedAnalyzePacing.mock.calls.length;

      // Change the entity name — pacing-relevant. Wrap in act() so React
      // flushes the re-render synchronously after the store update.
      act(() => {
        useEditorStore.setState({
          sceneGraph: {
            nodes: {
              'e1': { entityId: 'e1', name: 'Boss Enemy', parentId: null, children: [], components: ['mesh'], visible: true },
            },
            rootIds: ['e1'],
          },
          nodeCount: 1,
        });
      });

      expect(mockedAnalyzePacing.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('does re-run analysis when a new entity is added', () => {
      useEditorStore.setState(oneEntityState);

      render(<PacingAnalyzerPanel />);
      const callsBefore = mockedAnalyzePacing.mock.calls.length;

      // Add a second entity. Wrap in act() so React flushes re-render.
      act(() => {
        useEditorStore.setState({
          sceneGraph: {
            nodes: {
              'e1': { entityId: 'e1', name: 'Entity One', parentId: null, children: [], components: ['mesh'], visible: true },
              'e2': { entityId: 'e2', name: 'Entity Two', parentId: null, children: [], components: ['light'], visible: true },
            },
            rootIds: ['e1', 'e2'],
          },
          nodeCount: 2,
        });
      });

      expect(mockedAnalyzePacing.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe('template selector', () => {
    it('renders template options in the dropdown', () => {
      render(<PacingAnalyzerPanel />);
      const select = screen.getByLabelText(/Compare with template/i);
      expect(select).toBeTruthy();
    });
  });
});
