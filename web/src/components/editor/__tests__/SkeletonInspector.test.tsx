/**
 * Render tests for SkeletonInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SkeletonInspector } from '../SkeletonInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { SkeletonData2d } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
}));

const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialogPortal: () => null,
  }),
}));

const baseSkeleton: SkeletonData2d = {
  bones: [
    {
      name: 'root',
      parentBone: null,
      localPosition: [0, 0],
      localRotation: 0,
      localScale: [1, 1],
      length: 1,
      color: [1, 1, 1, 1],
    },
  ],
  slots: [],
  skins: { default: { name: 'default', attachments: {} } },
  activeSkin: 'default',
  ikConstraints: [],
};

describe('SkeletonInspector', () => {
  const mockSetSkeleton2d = vi.fn();
  const mockRemoveSkeleton2d = vi.fn();
  const mockSetSelectedBone = vi.fn();
  const mockPlayAnimation = vi.fn();

  function setupStore({
    skeleton = null as SkeletonData2d | null,
    animations = [] as { name: string; duration: number }[],
    selectedBone = null as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        skeletons2d: skeleton ? { 'entity-1': skeleton } : {},
        skeletalAnimations2d: { 'entity-1': animations },
        selectedBone,
        setSelectedBone: mockSetSelectedBone,
        setSkeleton2d: mockSetSkeleton2d,
        removeSkeleton2d: mockRemoveSkeleton2d,
        playAnimation: mockPlayAnimation,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "No skeleton data" when no skeleton', () => {
    setupStore();
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('No skeleton data').textContent).toBe('No skeleton data');
  });

  it('shows Add Skeleton button when no skeleton', () => {
    setupStore();
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Add Skeleton').textContent).toBe('Add Skeleton');
  });

  it('calls setSkeleton2d when Add Skeleton clicked', () => {
    setupStore();
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('Add Skeleton'));
    expect(mockSetSkeleton2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ bones: [], activeSkin: 'default' })
    );
  });

  it('renders Bone Hierarchy label when skeleton exists', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Bone Hierarchy').textContent).toBe('Bone Hierarchy');
  });

  it('shows bone name in bone list', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('root').textContent).toBe('root');
  });

  it('shows "No bones" when bones array is empty', () => {
    setupStore({ skeleton: { ...baseSkeleton, bones: [] } });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('No bones').textContent).toBe('No bones');
  });

  it('calls setSelectedBone when bone button clicked', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('root'));
    expect(mockSetSelectedBone).toHaveBeenCalledWith('root');
  });

  it('renders Create Bone label', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Create Bone').textContent).toBe('Create Bone');
  });

  it('renders bone name input placeholder', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByPlaceholderText('Bone name').tagName.toLowerCase()).toMatch(/input|textarea/);
  });

  it('calls setSkeleton2d when a bone name is entered and add button clicked', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    const input = screen.getByPlaceholderText('Bone name');
    fireEvent.change(input, { target: { value: 'arm' } });
    // Click the Plus button (it has no text, only icon)
    const plusButtons = screen.getAllByTestId('plus-icon');
    fireEvent.click(plusButtons[0]);
    expect(mockSetSkeleton2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        bones: expect.arrayContaining([
          expect.objectContaining({ name: 'arm' }),
        ]),
      })
    );
  });

  it('shows "Root bone" when no bone is selected', () => {
    setupStore({ skeleton: baseSkeleton, selectedBone: null });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Root bone').textContent).toBe('Root bone');
  });

  it('shows parent bone name when a bone is selected', () => {
    setupStore({ skeleton: baseSkeleton, selectedBone: 'root' });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Parent: root').textContent).toBe('Parent: root');
  });

  it('renders Active Skin label', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Active Skin').textContent).toBe('Active Skin');
  });

  it('renders skin name as option in skin select', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByRole('option', { name: 'default' })).not.toBeNull();
  });

  it('renders animations section when animations exist', () => {
    setupStore({
      skeleton: baseSkeleton,
      animations: [{ name: 'walk', duration: 1.2 }],
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Animations').textContent).toBe('Animations');
    expect(screen.getByText('walk (1.2s)').textContent).toBe('walk (1.2s)');
  });

  it('calls playAnimation when animation button clicked', () => {
    setupStore({
      skeleton: baseSkeleton,
      animations: [{ name: 'walk', duration: 1.2 }],
    });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('walk (1.2s)'));
    expect(mockPlayAnimation).toHaveBeenCalledWith('entity-1', 'walk');
  });

  it('shows Remove Skeleton button', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Remove Skeleton').textContent).toBe('Remove Skeleton');
  });

  it('calls removeSkeleton2d when Remove Skeleton confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByText('Remove Skeleton'));
    // Wait for the async confirm to resolve
    await vi.waitFor(() => {
      expect(mockRemoveSkeleton2d).toHaveBeenCalledWith('entity-1');
    });
  });

  it('renders IK constraints when they exist', () => {
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            // The engine's `EntityId` is a UUID string; `''` is how a constraint
            // with no target yet is spelled.
            targetEntityId: '',
            bendDirection: 1,
            mix: 0.8,
          },
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('IK Constraints').textContent).toBe('IK Constraints');
    // The name row also carries the inactive badge, so assert the two parts
    // separately rather than an equality on the row's whole text content.
    expect(screen.getByText('arm_ik')).toBeInTheDocument();
    // This fixture's `targetEntityId` is empty, which the engine's solver can never
    // resolve — so the row MUST say so. Asserting the badge away to keep an older
    // equality passing would put back the bug where a chain that can never move a
    // bone rendered identically to a working one.
    expect(screen.getByText('(inactive)')).toBeInTheDocument();
    expect(
      screen.getByText(/Target: not set — this chain will not solve/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bones: upper_arm → forearm/)).toBeInTheDocument();
    expect(screen.getByText(/Bend: positive/)).toBeInTheDocument();
    expect(screen.getByText(/Mix: 80%/)).toBeInTheDocument();
  });

  it('does not mark an IK constraint inactive when it has a target', () => {
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: -1,
            mix: 1,
          },
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.queryByText('(inactive)')).not.toBeInTheDocument();
    expect(screen.getByText(/Target: entity-target/)).toBeInTheDocument();
    expect(screen.getByText(/Bend: negative/)).toBeInTheDocument();
  });

  it('marks a constraint inactive when the target key is absent, not just empty', () => {
    // `setSkeleton2d` writes its argument into the store verbatim — only the
    // engine copy goes through the builder — so the key can be missing entirely.
    // `!== ''` is `true` for `undefined`, which rendered a bare "Target: " on the
    // very row the inactive treatment exists for.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            bendDirection: 1,
            mix: 1,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('(inactive)')).toBeInTheDocument();
    expect(
      screen.getByText(/Target: not set — this chain will not solve/),
    ).toBeInTheDocument();
  });

  it('reads a missing bend direction the way the builder sends it', () => {
    // `>= 0` is `false` for `undefined`, so the panel said "negative" while
    // `wireIkConstraint` sent +1 — the inspector contradicting the payload.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            mix: 1,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText(/Bend: positive/)).toBeInTheDocument();
  });

  it('treats entity id 0 as a target rather than as no target', () => {
    // A truthiness test would call this inactive. The engine field is a `String`
    // and the builder stringifies a numeric id, so 0 is a real entity.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 0,
            bendDirection: 1,
            mix: 1,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.queryByText('(inactive)')).not.toBeInTheDocument();
    expect(screen.getByText(/Target: 0/)).toBeInTheDocument();
  });

  it('shows selected bone properties when a bone is selected', () => {
    setupStore({ skeleton: baseSkeleton, selectedBone: 'root' });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Bone: root').textContent).toBe('Bone: root');
    expect(screen.getByText('Position').textContent).toBe('Position');
    expect(screen.getByText('Rotation (deg)').textContent).toBe('Rotation (deg)');
  });
});
