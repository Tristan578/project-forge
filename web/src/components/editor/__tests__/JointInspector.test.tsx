/**
 * Render tests for JointInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { JointInspector } from '../JointInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { JointData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

const baseSceneGraph = {
  nodes: {
    'entity-1': { entityId: 'entity-1', name: 'Entity 1', children: [] },
    'entity-2': { entityId: 'entity-2', name: 'Entity 2', children: [] },
  },
  rootIds: ['entity-1', 'entity-2'],
};

const baseJoint: JointData = {
  jointType: 'revolute',
  connectedEntityId: 'entity-2',
  anchorSelf: [0, 0, 0],
  anchorOther: [0, 0, 0],
  axis: [0, 1, 0],
  limits: null,
  motor: null,
};

describe('JointInspector', () => {
  const mockCreateJoint = vi.fn();
  const mockUpdateJoint = vi.fn();
  const mockRemoveJoint = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    primaryJoint = null as JointData | null,
    physicsEnabled = true,
    sceneGraph = baseSceneGraph,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        primaryId,
        primaryJoint,
        physicsEnabled,
        sceneGraph,
        createJoint: mockCreateJoint,
        updateJoint: mockUpdateJoint,
        removeJoint: mockRemoveJoint,
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

  it('returns null when no primaryId', () => {
    setupStore({ primaryId: null });
    const { container } = render(<JointInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when physics not enabled', () => {
    setupStore({ physicsEnabled: false });
    const { container } = render(<JointInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Add Joint button when no joint configured', () => {
    setupStore();
    render(<JointInspector />);
    expect(screen.getByText('Add Joint').textContent).toBe('Add Joint');
  });

  it('shows need another entity message when only one entity', () => {
    setupStore({
      sceneGraph: {
        nodes: { 'entity-1': { entityId: 'entity-1', name: 'Entity 1', children: [] } } as typeof baseSceneGraph.nodes,
        rootIds: ['entity-1'],
      },
    });
    render(<JointInspector />);
    expect(screen.getByText('Need another entity').textContent).toBe('Need another entity');
  });

  it('calls createJoint when Add Joint clicked', () => {
    setupStore();
    render(<JointInspector />);
    fireEvent.click(screen.getByText('Add Joint'));
    expect(mockCreateJoint).toHaveBeenCalledWith('entity-1', expect.objectContaining({ jointType: 'revolute' }));
  });

  it('renders Joint heading when joint configured', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Joint').textContent).toBe('Joint');
  });

  it('renders Remove button when joint configured', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Remove').textContent).toBe('Remove');
  });

  it('calls removeJoint when Remove clicked', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    fireEvent.click(screen.getByText('Remove'));
    expect(mockRemoveJoint).toHaveBeenCalledWith('entity-1');
  });

  it('renders Type select with current joint type', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Type').textContent).toBe('Type');
    const selects = screen.getAllByRole('combobox');
    const typeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === 'revolute'
    ) as HTMLSelectElement;
    expect(typeSelect?.value).toBe('revolute');
  });

  it('renders all joint type options', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByRole('option', { name: 'Revolute' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Fixed' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Spherical' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Prismatic' })).not.toBeNull();
  });

  it('calls updateJoint when type changed', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    const selects = screen.getAllByRole('combobox');
    const typeSelect = selects.find(
      (s) => (s as HTMLSelectElement).value === 'revolute'
    )!;
    fireEvent.change(typeSelect, { target: { value: 'fixed' } });
    expect(mockUpdateJoint).toHaveBeenCalledWith('entity-1', { jointType: 'fixed' });
  });

  it('renders Axis inputs for revolute joint', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Axis').textContent).toBe('Axis');
  });

  it('does not render Axis for fixed joint type', () => {
    setupStore({ primaryJoint: { ...baseJoint, jointType: 'fixed' } });
    render(<JointInspector />);
    expect(screen.queryByText('Axis')).toBeNull();
  });

  it('renders Limits checkbox for revolute joint', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Limits').textContent).toBe('Limits');
  });

  it('shows Min/Max inputs when limits enabled', () => {
    setupStore({
      primaryJoint: { ...baseJoint, limits: { min: -1, max: 1 } },
    });
    render(<JointInspector />);
    expect(screen.getByText('Min').textContent).toBe('Min');
    expect(screen.getByText('Max').textContent).toBe('Max');
  });

  it('renders Motor checkbox for revolute joint', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Motor').textContent).toBe('Motor');
  });

  it('shows Velocity/Max Force when motor enabled', () => {
    setupStore({
      primaryJoint: { ...baseJoint, motor: { targetVelocity: 1, maxForce: 100 } },
    });
    render(<JointInspector />);
    expect(screen.getByText('Velocity').textContent).toBe('Velocity');
    expect(screen.getByText('Max Force').textContent).toBe('Max Force');
  });

  it('renders Connected To select with other entities', () => {
    setupStore({ primaryJoint: baseJoint });
    render(<JointInspector />);
    expect(screen.getByText('Connected To').textContent).toBe('Connected To');
    expect(screen.getByText('Entity 2').textContent).toBe('Entity 2');
  });
});
