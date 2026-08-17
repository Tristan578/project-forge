/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@/test/utils/componentTestUtils';
import { AutoRiggingPanel } from '../AutoRiggingPanel';
import { useEditorStore } from '@/stores/editorStore';
import { RIG_TEMPLATES, rigToCommands } from '@/lib/ai/autoRigging';
import type { SkeletonData2d } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

/** The engine-shaped bones the humanoid template produces, before narrowing. */
function wireBones(): { name: string; localPosition: number[] }[] {
  const payload = rigToCommands(RIG_TEMPLATES.humanoid(), 'entity-1').find(
    (c) => c.command === 'create_skeleton2d',
  )?.payload as { skeletonData: { bones: { name: string; localPosition: number[] }[] } };
  return payload.skeletonData.bones;
}

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

      const wire = wireBones();
      expect(setSkeleton2d).toHaveBeenCalledTimes(1);
      const [entityId, stored] = setSkeleton2d.mock.calls[0] as [string, SkeletonData2d];
      expect(entityId).toBe('entity-1');
      // The skeleton itself reaches the store, not a wrapper around it: same
      // bones, same order.
      expect(stored.bones.map((b) => b.name)).toEqual(wire.map((b) => b.name));
    });

    // `buildCreateSkeleton2dPayload` emits the ENGINE's wire shape, where a bone's
    // `localPosition` is a 3-tuple. The store declares a pair. The panel used to
    // cast the difference away (`as Parameters<typeof setSkeleton2d>[1]`), so the
    // store held values its own types said could not exist and the inspector
    // rendered them.
    it('narrows the wire skeleton to the store shape instead of casting it in', () => {
      mockStore('entity-1');
      render(<AutoRiggingPanel />);

      fireEvent.click(screen.getByRole('button', { name: /humanoid/i }));
      fireEvent.click(screen.getByLabelText('Apply rig to selected entity'));

      const wire = wireBones();
      const [, stored] = setSkeleton2d.mock.calls[0] as [string, SkeletonData2d];
      // `toEqual` over EVERY bone, not a length check on one: a spot-check passes
      // on a payload where only the first bone was narrowed.
      expect(stored.bones.map((b) => b.localPosition)).toEqual(
        wire.map((b) => [b.localPosition[0], b.localPosition[1]]),
      );
      // `toe_l` is one of the few template bones with a non-zero z, so it proves
      // the third element is dropped rather than just absent from the fixture.
      expect(wire.find((b) => b.name === 'toe_l')?.localPosition).toEqual([0.1, 0.05, 0.1]);
      expect(stored.bones.find((b) => b.name === 'toe_l')?.localPosition).toEqual([0.1, 0.05]);
    });

    it('does nothing when no entity is selected', () => {
      render(<AutoRiggingPanel />);

      fireEvent.click(screen.getByRole('button', { name: /humanoid/i }));
      fireEvent.click(screen.getByLabelText('Apply rig to selected entity'));

      expect(setSkeleton2d).not.toHaveBeenCalled();
    });
  });
});
