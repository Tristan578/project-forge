/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

describe('PacingAnalyzerPanel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({
        sceneGraph: { nodes: {}, rootIds: [] },
        primaryId: null,
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', async () => {
    const { PacingAnalyzerPanel } = await import('../PacingAnalyzerPanel');
    const { container } = render(<PacingAnalyzerPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
