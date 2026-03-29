/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { PlaytestPanel } from '../PlaytestPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/gameplayBot', () => ({
  BOT_STRATEGIES: [],
  simulatePlaytest: vi.fn().mockResolvedValue({}),
  generatePlaytestReport: vi.fn(() => ({})),
}));

describe('PlaytestPanel', () => {
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
    const { container } = render(<PlaytestPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
