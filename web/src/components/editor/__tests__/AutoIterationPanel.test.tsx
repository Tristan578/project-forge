/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';

const mockSceneGraph = {
  nodes: {
    'e-1': { entityId: 'e-1', name: 'Player', parentId: null, children: [], components: ['mesh', 'physics'], visible: true },
    'e-2': { entityId: 'e-2', name: 'Enemy', parentId: null, children: [], components: ['mesh', 'ai'], visible: true },
  },
  rootIds: ['e-1', 'e-2'],
};

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({ sceneGraph: mockSceneGraph })),
  }),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDiagnoseIssues = vi.fn((..._args: any[]) => []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGenerateFixes = vi.fn((..._args: any[]) => []);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockApplyFixes = vi.fn((..._args: any[]) => ({
  iterationNumber: 1,
  timestamp: Date.now(),
  summary: 'Applied',
  fixesApplied: [],
  issuesFound: [],
}));

vi.mock('@/lib/ai/autoIteration', () => ({
  diagnoseIssues: mockDiagnoseIssues,
  generateFixes: mockGenerateFixes,
  applyFixes: mockApplyFixes,
  severityColor: vi.fn(() => ''),
  severityLabel: vi.fn(() => ''),
  categoryLabel: vi.fn(() => ''),
}));

describe('AutoIterationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', async () => {
    const { default: AutoIterationPanel } = await import('../AutoIterationPanel');
    const { container } = render(<AutoIterationPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  it('passes scene graph entities to diagnoseIssues via buildSceneContext', async () => {
    const { default: AutoIterationPanel } = await import('../AutoIterationPanel');
    render(<AutoIterationPanel />);

    const diagnoseButton = screen.getByRole('button', { name: /Diagnose/i });
    fireEvent.click(diagnoseButton);

    expect(mockDiagnoseIssues).toHaveBeenCalledTimes(1);
    const ctx = mockDiagnoseIssues.mock.calls[0][1];
    expect(ctx.entityCount).toBe(2);
    expect(ctx.entities).toHaveLength(2);
    expect(ctx.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'e-1', name: 'Player', components: ['mesh', 'physics'] }),
        expect.objectContaining({ id: 'e-2', name: 'Enemy', components: ['mesh', 'ai'] }),
      ]),
    );
  });

  it('passes empty entities when scene graph has no nodes', async () => {
    const { useEditorStore } = await import('@/stores/editorStore');
    vi.mocked(useEditorStore.getState).mockReturnValue({
      sceneGraph: { nodes: {}, rootIds: [] },
    } as never);

    const { default: AutoIterationPanel } = await import('../AutoIterationPanel');
    render(<AutoIterationPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Diagnose/i }));

    const ctx = mockDiagnoseIssues.mock.calls[0][1];
    expect(ctx.entityCount).toBe(0);
    expect(ctx.entities).toHaveLength(0);
  });
});
