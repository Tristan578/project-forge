/**
 * FIRST_AI_GENERATION (#10170) against the REAL milestone store, so the
 * localStorage record is observable. The sibling useCelebrations.test.ts
 * mocks `checkMilestone`, which is right for queue mechanics but cannot show
 * what gets recorded.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editorStore';
import type { OrchestratorStatus } from '@/stores/slices/orchestratorSlice';
import { MILESTONE_STORAGE_KEY } from '@/lib/celebrations/milestones';
import { useCelebrations } from '../useCelebrations';

function setStatus(status: OrchestratorStatus) {
  act(() => {
    useEditorStore.setState({ orchestratorStatus: status });
  });
}

function recorded(): string[] {
  return JSON.parse(localStorage.getItem(MILESTONE_STORAGE_KEY) ?? '[]') as string[];
}

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ orchestratorStatus: 'idle', nodeCount: 0, engineMode: 'edit' });
});

afterEach(() => {
  localStorage.clear();
});

describe('useCelebrations — FIRST_AI_GENERATION (#10170)', () => {
  it('celebrates once and records the milestone when a run completes', () => {
    const { result } = renderHook(() => useCelebrations());

    setStatus('decomposing');
    setStatus('awaiting_approval');
    setStatus('executing');
    expect(result.current.activeCelebration).toBeNull();

    setStatus('completed');

    expect(result.current.activeCelebration?.title).toBe('First AI generation!');
    expect(recorded()).toContain('FIRST_AI_GENERATION');
  });

  it('queues nothing for a later run once the milestone is recorded', () => {
    const { result } = renderHook(() => useCelebrations());
    setStatus('executing');
    setStatus('completed');
    act(() => result.current.dismissCelebration());

    setStatus('decomposing');
    setStatus('executing');
    setStatus('completed');

    expect(result.current.activeCelebration).toBeNull();
    expect(recorded().filter((m) => m === 'FIRST_AI_GENERATION')).toHaveLength(1);
  });

  it('queues nothing when the milestone was recorded in an earlier session', () => {
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(['FIRST_AI_GENERATION']));
    const { result } = renderHook(() => useCelebrations());

    setStatus('executing');
    setStatus('completed');

    expect(result.current.activeCelebration).toBeNull();
  });

  it.each([['failed'], ['cancelled']] as const)(
    'queues and records nothing when the run ends %s',
    (outcome) => {
      const { result } = renderHook(() => useCelebrations());

      setStatus('executing');
      setStatus(outcome);

      expect(result.current.activeCelebration).toBeNull();
      expect(recorded()).not.toContain('FIRST_AI_GENERATION');
    },
  );

  // Only the success transition counts. A status that is already 'completed'
  // when the hook mounts (a run that finished before this editor mounted it)
  // is not a new achievement observed here.
  it('does not fire for a status that was already completed at mount', () => {
    useEditorStore.setState({ orchestratorStatus: 'completed' });
    const { result } = renderHook(() => useCelebrations());

    setStatus('idle');

    expect(result.current.activeCelebration).toBeNull();
    expect(recorded()).not.toContain('FIRST_AI_GENERATION');
  });
});
