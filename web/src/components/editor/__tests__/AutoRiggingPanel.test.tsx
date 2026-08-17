/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@/test/utils/componentTestUtils';
import { AutoRiggingPanel } from '../AutoRiggingPanel';
import { useEditorStore } from '@/stores/editorStore';
import { RIG_TEMPLATES, rigToCommands } from '@/lib/ai/autoRigging';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

describe('AutoRiggingPanel', () => {
  const setSkeleton2d = vi.fn();

  function mockStore(primaryId: string | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ primaryId, setSkeleton2d, sceneGraph: { nodes: {} } })
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<AutoRiggingPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  describe('Apply Rig', () => {
    // This path had no coverage at all, which is how it shipped as a silent
    // no-op: `rigToCommands` was corrected to emit `create_skeleton2d` with the
    // skeleton nested under `skeletonData`, while the panel still searched for
    // the old `set_skeleton_2d` and spread the payload root (PF-1170).
    it('hands the nested skeletonData from rigToCommands to the store', () => {
      mockStore('entity-1');
      render(<AutoRiggingPanel />);

      fireEvent.click(screen.getByRole('button', { name: /humanoid/i }));
      fireEvent.click(screen.getByLabelText('Apply rig to selected entity'));

      const expected = rigToCommands(RIG_TEMPLATES.humanoid(), 'entity-1')
        .find((c) => c.command === 'create_skeleton2d')?.payload as {
          skeletonData: unknown;
        };
      // Full value, not objectContaining — the whole point is that the store
      // receives the skeleton itself and not a wrapper around it.
      expect(setSkeleton2d.mock.calls).toEqual([['entity-1', expected.skeletonData]]);
    });

    it('does nothing when no entity is selected', () => {
      render(<AutoRiggingPanel />);

      fireEvent.click(screen.getByRole('button', { name: /humanoid/i }));
      fireEvent.click(screen.getByLabelText('Apply rig to selected entity'));

      expect(setSkeleton2d).not.toHaveBeenCalled();
    });
  });
});
