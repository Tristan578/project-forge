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
    entityId = 'entity-1',
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        skeletons2d: skeleton ? { [entityId]: skeleton } : {},
        skeletalAnimations2d: { [entityId]: animations },
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

  it('reads a NaN bend direction as positive, the way the builder sends it', () => {
    // `undefined` alone does not pin this: `undefined < 0` is false, so the
    // `Number.isFinite` guard can be deleted outright and the missing-field test
    // above stays green. NaN is the input that needs it — `NaN < 0` is false too,
    // but `typeof NaN === 'number'`, so without the guard the intent is untested
    // either way. `wireIkConstraint` replaces a non-finite bend with +1, and the
    // panel has to say the same thing the payload does.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: Number.NaN,
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
    // Anchored: `/Target: 0/` also matches `Target: 0abc`, and a stringify bug
    // that appended anything would sail past it.
    expect(screen.getByText(/^Target: 0$/)).toBeInTheDocument();
  });

  it('renders a constraint whose bone chain is absent instead of throwing', () => {
    // `import_skeleton_json` checks an `ikConstraints` entry only as far as "is a
    // non-array object" and writes it straight in, so `boneChain` can be missing.
    // `.join` on it threw a TypeError out of render and blanked the whole panel:
    // the user imports a rig and the inspector disappears until a reload.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          { name: 'arm_ik' } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('arm_ik')).toBeInTheDocument();
    expect(screen.getByText(/Bones: none/)).toBeInTheDocument();
  });

  it('drops a chain entry the builder drops, rather than rendering a gap', () => {
    // A `null` is what an array hole becomes on the way through JSON. The builder
    // drops it; printing it rendered "upper_arm →  → forearm", an empty segment
    // that reads as a bone whose name failed to load rather than as a dropped one.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', null, 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: 1,
            mix: 1,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Bones: upper_arm → forearm')).toBeInTheDocument();
  });

  it('clamps the displayed mix the way the builder clamps the sent one', () => {
    // The panel printed 150% for a value the engine receives as 100%.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: 1,
            mix: 1.5,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Mix: 100%')).toBeInTheDocument();
  });

  it('does not render Mix: NaN% for a mix the store never carried', () => {
    // `undefined * 100` is `NaN`, and `.toFixed(0)` renders it verbatim — a raw
    // JS artifact in product copy, describing a value the engine never saw.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'arm_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: 1,
          } as unknown as (typeof baseSkeleton)['ikConstraints'][number],
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // The builder's default for an unusable mix is full IK, not zero.
    expect(screen.getByText('Mix: 100%')).toBeInTheDocument();
  });

  it('reserves the flag gutter on every row so the text column stays flush', () => {
    // `box-sizing: border-box` means a border on only the flagged row insets its
    // text by 2px against every sibling — a ragged edge on the one row that
    // reports a problem. Both branches carry the width; only the colour differs.
    setupStore({
      skeleton: {
        ...baseSkeleton,
        ikConstraints: [
          {
            name: 'live_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: 'entity-target',
            bendDirection: 1,
            mix: 1,
          },
          {
            name: 'dead_ik',
            boneChain: ['upper_arm', 'forearm'],
            targetEntityId: '',
            bendDirection: 1,
            mix: 1,
          },
        ],
      },
    });
    render(<SkeletonInspector entityId="entity-1" />);
    const rowOf = (name: string) => screen.getByText(name).parentElement as HTMLElement;
    for (const [name, colour] of [
      ['live_ik', 'border-transparent'],
      ['dead_ik', 'border-amber-400'],
    ] as const) {
      const row = rowOf(name);
      expect(row.className, name).toContain('border-l-2');
      expect(row.className, name).toContain(colour);
    }
  });

  it('shows selected bone properties when a bone is selected', () => {
    setupStore({ skeleton: baseSkeleton, selectedBone: 'root' });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Bone: root').textContent).toBe('Bone: root');
    expect(screen.getByText('Position').textContent).toBe('Position');
    expect(screen.getByText('Rotation (deg)').textContent).toBe('Rotation (deg)');
  });

  // --- Mesh attachment editor (#9732) ---
  // The panel is the manual, no-chat authoring path for the same data
  // `add_skeleton2d_mesh_attachment` writes: vertices plus per-vertex bone
  // weights. The editor additionally rejects unknown-bone references and
  // zero-total weights, and writes through `setSkeleton2d`, the same
  // store setter every other edit in this panel uses.

  const skeletonWithMesh: SkeletonData2d = {
    ...baseSkeleton,
    skins: {
      default: {
        name: 'default',
        attachments: {
          cloak: {
            type: 'mesh',
            textureId: '',
            vertices: [
              [1, 1],
              [2, 2],
            ],
            uvs: [
              [0, 0],
              [0, 0],
            ],
            triangles: [],
            weights: [
              { bones: ['root'], weights: [1] },
              { bones: ['root'], weights: [1] },
            ],
          },
        },
      },
    },
  };

  const texturedSkeleton: SkeletonData2d = {
    ...baseSkeleton,
    skins: {
      default: {
        name: 'default',
        attachments: {
          cloak: {
            type: 'mesh',
            textureId: 'cloak-texture',
            vertices: [[0, 0], [1, 0], [1, 1], [0, 1]],
            uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
            triangles: [0, 1, 2, 0, 2, 3],
            weights: Array.from({ length: 4 }, () => ({ bones: ['root'], weights: [1] })),
          },
        },
      },
    },
  };

  it('preserves texture, UVs, and triangles when editing mesh positions and weights', () => {
    setupStore({ skeleton: texturedSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    fireEvent.change(screen.getByLabelText('Vertex 2 X'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Vertex 2 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments.cloak).toEqual({
      ...texturedSkeleton.skins.default.attachments.cloak,
      vertices: [[0, 0], [5, 0], [1, 1], [0, 1]],
      weights: [
        { bones: ['root'], weights: [1] },
        { bones: ['root'], weights: [0.5] },
        { bones: ['root'], weights: [1] },
        { bones: ['root'], weights: [1] },
      ],
    });
  });

  it('discards another entity\'s draft before edits can be applied to the new selection', () => {
    setupStore({ skeleton: texturedSkeleton });
    const { rerender } = render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '999' } });

    // Updates to the same selection retain its in-progress edits.
    rerender(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(999);

    const secondAttachment = {
      ...texturedSkeleton.skins.default.attachments.cloak,
      textureId: 'second-texture',
      vertices: [[12, 13], [14, 15], [16, 17]] as [number, number][],
      uvs: [[0, 0], [1, 0], [0, 1]] as [number, number][],
      triangles: [0, 1, 2],
      weights: Array.from({ length: 3 }, () => ({ bones: ['root'], weights: [1] })),
    };
    setupStore({
      entityId: 'entity-2',
      skeleton: {
        ...baseSkeleton,
        activeSkin: 'alternate',
        skins: { alternate: { name: 'alternate', attachments: { cloak: secondAttachment } } },
      },
    });
    rerender(<SkeletonInspector entityId="entity-2" />);

    expect(screen.queryByRole('button', { name: 'Apply Mesh Attachment' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mesh: cloak')).not.toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();

    // The new entity's own skin and mesh are the only source for a fresh edit.
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(12);
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Mesh Attachment' }));
    expect(mockSetSkeleton2d).toHaveBeenCalledTimes(1);
    expect(mockSetSkeleton2d.mock.calls[0][0]).toBe('entity-2');
    const saved = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(saved.skins.alternate.attachments.cloak).toEqual({
      ...secondAttachment,
      vertices: [[20, 13], [14, 15], [16, 17]],
    });
  });

  it('remaps surviving triangles and UVs when an interior vertex is deleted', () => {
    setupStore({ skeleton: texturedSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    fireEvent.click(screen.getByLabelText('Remove vertex 2'));
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments.cloak).toMatchObject({
      textureId: 'cloak-texture',
      vertices: [[0, 0], [1, 1], [0, 1]],
      uvs: [[0, 0], [1, 1], [0, 1]],
      triangles: [0, 1, 2],
    });
  });

  it('preserves existing topology and UVs when appending a vertex', () => {
    setupStore({ skeleton: texturedSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    fireEvent.click(screen.getByText('+ Add vertex'));
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments.cloak).toMatchObject({
      textureId: 'cloak-texture',
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
      triangles: [0, 1, 2, 0, 2, 3],
    });
    expect(payload.skins.default.attachments.cloak.vertices).toHaveLength(5);
  });

  it('renders the Mesh Attachments section for the selected skin', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Mesh Attachments').textContent).toBe('Mesh Attachments');
  });

  it('opens a draft editor pre-populated with the first bone when a mesh attachment is added', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText('Attachment name')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Attachment name'), { target: { value: 'cloak' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 1 influence 1 bone')).toHaveValue('root');
  });

  it('writes a valid mesh attachment into the store on Apply', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'cloak' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 Y'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(mockSetSkeleton2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        skins: expect.objectContaining({
          default: expect.objectContaining({
            attachments: expect.objectContaining({
              cloak: expect.objectContaining({
                type: 'mesh',
                vertices: [[2, 3]],
                weights: [{ bones: ['root'], weights: [1] }],
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('rejects an unknown bone reference and leaves the store untouched', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'cloak' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 bone'), { target: { value: 'ghost' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(screen.getByText(/unknown bone "ghost"/i)).toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('rejects a zero-total-weight vertex and leaves the store untouched', () => {
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'cloak' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(screen.getByText(/zero total weight/i)).toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('does not overwrite the prior attachment when Apply is rejected', () => {
    // The negative Gherkin: an invalid Apply identifies the bad row and the prior
    // attachment (here, the one already in the store) is left unchanged — proven
    // by `setSkeleton2d` never being called on the reject path.
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 bone'), { target: { value: 'ghost' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('lists an existing mesh attachment and loads it for editing', () => {
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    expect(screen.getByText(/cloak/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 2 X')).toHaveValue(2);
    expect(screen.getByLabelText('Vertex 2 influence 1 bone')).toHaveValue('root');
  });

  it('deletes a mesh attachment through the store, removing it from the skin', () => {
    // handleDeleteMeshAttachment had no test — nothing exercised the delete
    // button or asserted the payload `setSkeleton2d` receives.
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Delete mesh attachment cloak'));
    expect(mockSetSkeleton2d).toHaveBeenCalledTimes(1);
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments).not.toHaveProperty('cloak');
    expect(Object.keys(payload.skins.default.attachments)).toHaveLength(0);
  });

  it('closes the open draft when deleting the attachment being edited is confirmed', async () => {
    // The `meshDraft?.original === name` branch: deleting the attachment whose
    // draft is open discards those unsaved edits, so — like switching targets
    // or adding a new attachment — it is gated behind the same confirm dialog
    // rather than clearing silently (#9732).
    mockConfirm.mockResolvedValueOnce(true);
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Delete mesh attachment cloak'));
    await vi.waitFor(() => {
      expect(mockSetSkeleton2d).toHaveBeenCalledTimes(1);
    });
    expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments).not.toHaveProperty('cloak');
    // The draft editor (its "Mesh: cloak" header) is gone; the list entry
    // "cloak (2 verts)" is derived from the mocked store and is unaffected here.
    await vi.waitFor(() => {
      expect(screen.queryByText('Mesh: cloak')).not.toBeInTheDocument();
    });
  });

  it('keeps the open draft and does not delete when the discard is declined', async () => {
    // A declined confirm must leave both the attachment and the draft intact —
    // the destructive delete never reaches the store (#9732).
    mockConfirm.mockResolvedValueOnce(false);
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByLabelText('Delete mesh attachment cloak'));
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    });
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(9);
    expect(screen.getByLabelText('Vertex 1 influence 1 weight')).toHaveValue(0.5);
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments.cloak).toEqual(expect.objectContaining({
      vertices: [[9, 1], [2, 2]],
      weights: [{ bones: ['root'], weights: [0.5] }, { bones: ['root'], weights: [1] }],
    }));
  });

  it('deletes an attachment with no confirmation when no draft is open for it', () => {
    // Deleting an attachment that is not the currently open draft (or when no
    // draft is open at all) must not prompt — there is nothing of that draft's
    // to discard.
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Delete mesh attachment cloak'));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSetSkeleton2d).toHaveBeenCalledTimes(1);
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments).not.toHaveProperty('cloak');
  });

  it('shows the duplicate-name error and opens no draft when the name already exists', () => {
    setupStore({ skeleton: skeletonWithMesh });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'cloak' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    // No draft opened (the editor header is absent) and nothing was written.
    expect(screen.queryByText('Mesh: cloak')).not.toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('rejects Apply when every vertex has been removed', () => {
    // The `meshDraft.vertices.length === 0` guard: remove the sole vertex, then
    // Apply must name the empty-mesh error and leave the store untouched.
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.click(screen.getByLabelText('Remove vertex 1'));
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(screen.getByText(/at least one vertex/i)).toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('discards the draft when Cancel is clicked, writing nothing', () => {
    // The Cancel button clears `meshDraft`/`meshError`; the editor closes and no
    // store write happens.
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    expect(screen.getByText('Mesh: belt')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Mesh: belt')).not.toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  it('rejects a vertex influence with a blank bone name', () => {
    // The `!bone` branch in handleApplyMesh — the bone field is a text input, so
    // it can be cleared to an empty string (unlike the numeric position/weight
    // fields, which the number input sanitizes to '' → Number('') === 0). Only
    // unknown-bone and zero-total-weight were covered before.
    setupStore({ skeleton: baseSkeleton });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 bone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(screen.getByText(/has no bone/i)).toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
  });

  // --- Discard-guard on an open mesh draft (#9732) ---
  // Vertex/weight edits live only in local draft state until Apply, so opening a
  // new draft or switching the edit target throws away every unapplied edit.
  // Both entry points route through the same confirm dialog Remove Skeleton uses.

  const skeletonWithTwoMeshes: SkeletonData2d = {
    ...baseSkeleton,
    skins: {
      default: {
        name: 'default',
        attachments: {
          cloak: {
            type: 'mesh',
            textureId: '',
            vertices: [[1, 1]],
            uvs: [[0, 0]],
            triangles: [],
            weights: [{ bones: ['root'], weights: [1] }],
          },
          belt: {
            type: 'mesh',
            textureId: '',
            vertices: [[2, 2]],
            uvs: [[0, 0]],
            triangles: [],
            weights: [{ bones: ['root'], weights: [1] }],
          },
        },
      },
    },
  };

  it('shows duplicate-name errors beside Add without replacing the open draft or its validation error', () => {
    setupStore({ skeleton: skeletonWithTwoMeshes });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const draftError = screen.getByText(/zero total weight/i);

    const nameInput = screen.getByRole('textbox', { name: 'Attachment name' });
    fireEvent.change(nameInput, { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    const addError = screen.getByText(/already exists/i);
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    expect(nameInput).toHaveAccessibleDescription(addError.textContent ?? '');
    expect(nameInput.parentElement?.nextElementSibling).toBe(addError);
    expect(screen.getByText('Mesh: cloak').parentElement).not.toContainElement(addError);
    expect(draftError).toBeInTheDocument();
    expect(screen.queryByText('Mesh: belt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(9);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'sash' } });
    expect(addError).not.toBeInTheDocument();
    expect(nameInput).not.toHaveAttribute('aria-invalid');
    expect(nameInput).not.toHaveAttribute('aria-describedby');
    expect(draftError).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.skins.default.attachments.cloak).toEqual(expect.objectContaining({
      vertices: [[9, 1]],
      weights: [{ bones: ['root'], weights: [0.5] }],
    }));
    expect(payload.skins.default.attachments.belt).toEqual(skeletonWithTwoMeshes.skins.default.attachments.belt);
    expect(payload.skins.default.attachments).not.toHaveProperty('sash');
  });

  it('does not prompt when the first mesh draft is opened (nothing to discard)', () => {
    setupStore({ skeleton: skeletonWithTwoMeshes });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    // meshDraft was null on the first open, so the discard dialog must be skipped.
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('keeps the open draft when switching edit targets is declined', async () => {
    // Editing cloak, then clicking Edit belt, must confirm the discard first. A
    // declined confirm leaves the cloak draft intact — the destructive switch is
    // gated exactly like Remove Skeleton.
    mockConfirm.mockResolvedValueOnce(false);
    setupStore({ skeleton: skeletonWithTwoMeshes });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByLabelText('Edit mesh attachment belt'));
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    });
    // Target never switched: still editing cloak, never belt.
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    expect(screen.queryByText('Mesh: belt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(9);
    expect(screen.getByLabelText('Vertex 1 influence 1 weight')).toHaveValue(0.5);
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(mockSetSkeleton2d).toHaveBeenCalledWith('entity-1', expect.objectContaining({
      skins: expect.objectContaining({
        default: expect.objectContaining({
          attachments: expect.objectContaining({
            cloak: expect.objectContaining({
              vertices: [[9, 1]],
              weights: [{ bones: ['root'], weights: [0.5] }],
            }),
          }),
        }),
      }),
    }));
  });

  it('switches the edit target when the discard is confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    setupStore({ skeleton: skeletonWithTwoMeshes });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Edit mesh attachment belt'));
    await vi.waitFor(() => {
      expect(screen.getByText('Mesh: belt')).toBeInTheDocument();
    });
    expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    expect(screen.queryByText('Mesh: cloak')).not.toBeInTheDocument();
  });

  it('keeps the open draft when adding a new attachment is declined', async () => {
    // The other destructive entry point: typing a fresh name and clicking Add
    // while a draft is open. A declined confirm preserves the current draft and
    // opens no new one.
    mockConfirm.mockResolvedValueOnce(false);
    setupStore({ skeleton: skeletonWithTwoMeshes });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.click(screen.getByLabelText('Edit mesh attachment cloak'));
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'sash' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    });
    expect(screen.getByText('Mesh: cloak')).toBeInTheDocument();
    expect(screen.queryByText('Mesh: sash')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(9);
    expect(screen.getByLabelText('Vertex 1 influence 1 weight')).toHaveValue(0.5);
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    expect(mockSetSkeleton2d).toHaveBeenCalledWith('entity-1', expect.objectContaining({
      skins: expect.objectContaining({
        default: expect.objectContaining({
          attachments: expect.objectContaining({
            cloak: expect.objectContaining({
              vertices: [[9, 1]],
              weights: [{ bones: ['root'], weights: [0.5] }],
            }),
          }),
        }),
      }),
    }));
  });

  // --- Discard-guard on the Active Skin selector (#9732) ---
  // Switching the active skin also drops an open, unapplied mesh draft, so it is
  // gated by the same confirm dialog as Add/Edit rather than clearing silently.

  const skeletonWithTwoSkins: SkeletonData2d = {
    ...baseSkeleton,
    skins: {
      default: { name: 'default', attachments: {} },
      alt: { name: 'alt', attachments: {} },
    },
    activeSkin: 'default',
  };

  it('switches the active skin without prompting when no draft is open', () => {
    // Nothing to lose: the guard runs `open` synchronously, so the skin change
    // reaches the store immediately and the confirm dialog is never shown.
    setupStore({ skeleton: skeletonWithTwoSkins });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByLabelText('Active skin'), { target: { value: 'alt' } });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSetSkeleton2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ activeSkin: 'alt' }),
    );
  });

  it('keeps the open draft and does not switch skin when the discard is declined', async () => {
    // Open a draft in the default skin, then pick a different skin. A declined
    // confirm must leave the draft intact and never write the new activeSkin —
    // the misclick the guard exists to catch.
    mockConfirm.mockResolvedValueOnce(false);
    setupStore({ skeleton: skeletonWithTwoSkins });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    expect(screen.getByText('Mesh: belt')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Vertex 1 X'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Vertex 1 influence 1 weight'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByLabelText('Active skin'), { target: { value: 'alt' } });
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    });
    // Draft still open, and no skin write happened.
    expect(screen.getByText('Mesh: belt')).toBeInTheDocument();
    expect(mockSetSkeleton2d).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Active skin')).toHaveValue('default');
    expect(screen.getByLabelText('Vertex 1 X')).toHaveValue(9);
    expect(screen.getByLabelText('Vertex 1 influence 1 weight')).toHaveValue(0.5);
    fireEvent.click(screen.getByText('Apply Mesh Attachment'));
    const payload = mockSetSkeleton2d.mock.calls[0][1] as SkeletonData2d;
    expect(payload.activeSkin).toBe('default');
    expect(payload.skins.default.attachments.belt).toEqual(expect.objectContaining({
      vertices: [[9, 0]],
      weights: [{ bones: ['root'], weights: [0.5] }],
    }));
    expect(payload.skins.alt).toEqual(skeletonWithTwoSkins.skins.alt);
  });

  it('switches the active skin and drops the draft when the discard is confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    setupStore({ skeleton: skeletonWithTwoSkins });
    render(<SkeletonInspector entityId="entity-1" />);
    fireEvent.change(screen.getByPlaceholderText('Attachment name'), { target: { value: 'belt' } });
    fireEvent.click(screen.getByLabelText('Add mesh attachment'));
    expect(screen.getByText('Mesh: belt')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Active skin'), { target: { value: 'alt' } });
    await vi.waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Discard unsaved mesh edits?');
    });
    expect(mockSetSkeleton2d).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ activeSkin: 'alt' }),
    );
    // The draft editor is gone once the discard is accepted.
    await vi.waitFor(() => {
      expect(screen.queryByText('Mesh: belt')).not.toBeInTheDocument();
    });
  });
});
