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

// Mutable state object so individual tests can override it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockState: any = { sceneGraph: mockSceneGraph };

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockState) : mockState),
    {
      getState: vi.fn(() => mockState),
    }
  ),
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

  it('calls diagnoseIssues with a scene context when Diagnose is clicked', async () => {
    const { default: AutoIterationPanel } = await import('../AutoIterationPanel');
    render(<AutoIterationPanel />);

    const diagnoseButton = screen.getByRole('button', { name: /Diagnose/i });
    fireEvent.click(diagnoseButton);

    expect(mockDiagnoseIssues).toHaveBeenCalledTimes(1);
    const ctx = mockDiagnoseIssues.mock.calls[0][1];
    expect(ctx).toHaveProperty('sceneName');
    expect(ctx).toHaveProperty('entityCount');
    expect(ctx).toHaveProperty('entities');
  });
});
