/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { TutorialPanel } from '../TutorialPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/tutorialGenerator', () => ({
  detectMechanics: vi.fn(() => []),
  generateTutorialPlan: vi.fn().mockResolvedValue({}),
  tutorialPlanToScript: vi.fn(() => ''),
}));

describe('TutorialPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ primaryId: null, sceneGraph: { nodes: {}, rootIds: [] } })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<TutorialPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
