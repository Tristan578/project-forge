/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PhysicsFeelPanel } from '../PhysicsFeelPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
  getCommandDispatcher: vi.fn(),
}));

vi.mock('@/lib/ai/physicsFeel', () => ({
  PHYSICS_PRESETS: {
    platformer_floaty: { name: 'Floaty Platformer', description: 'Light, airy feel', gravity: 9.8, jumpForce: 10, moveSpeed: 8, friction: 0.3, airControl: 0.8, terminalVelocity: 20, acceleration: 30, deceleration: 30 },
    platformer_snappy: { name: 'Snappy Platformer', description: 'Tight, responsive', gravity: 18, jumpForce: 16, moveSpeed: 12, friction: 0.5, airControl: 0.6, terminalVelocity: 40, acceleration: 60, deceleration: 70 },
    rpg_weighty: { name: 'Weighty RPG', description: 'Heavy, deliberate', gravity: 22, jumpForce: 8, moveSpeed: 5, friction: 0.7, airControl: 0.2, terminalVelocity: 50, acceleration: 15, deceleration: 25 },
    racing_arcade: { name: 'Arcade Racing', description: 'Fast, drifty', gravity: 15, jumpForce: 0, moveSpeed: 30, friction: 0.2, airControl: 0.9, terminalVelocity: 70, acceleration: 90, deceleration: 50 },
    shooter_fps: { name: 'FPS Shooter', description: 'Grounded movement', gravity: 20, jumpForce: 12, moveSpeed: 10, friction: 0.6, airControl: 0.3, terminalVelocity: 45, acceleration: 80, deceleration: 80 },
    puzzle_floaty: { name: 'Puzzle Float', description: 'Zero gravity', gravity: 1, jumpForce: 5, moveSpeed: 4, friction: 0.1, airControl: 1.0, terminalVelocity: 10, acceleration: 10, deceleration: 10 },
    metroidvania: { name: 'Metroidvania', description: 'Precise jumps', gravity: 16, jumpForce: 14, moveSpeed: 9, friction: 0.4, airControl: 0.5, terminalVelocity: 35, acceleration: 45, deceleration: 55 },
    roguelike: { name: 'Roguelike', description: 'Punchy feel', gravity: 20, jumpForce: 13, moveSpeed: 11, friction: 0.5, airControl: 0.4, terminalVelocity: 40, acceleration: 55, deceleration: 65 },
  },
  PRESET_KEYS: ['platformer_floaty', 'platformer_snappy', 'rpg_weighty', 'racing_arcade', 'shooter_fps', 'puzzle_floaty', 'metroidvania', 'roguelike'],
  interpolateProfiles: vi.fn((a, _b, _t) => a),
  analyzePhysicsFeel: vi.fn(() => ({
    currentFeel: 'Snappy Platformer',
    closestPreset: 'platformer_snappy',
    similarity: 0.87,
    suggestions: ['Increase air control slightly'],
  })),
  applyPhysicsProfile: vi.fn(),
  generateCustomProfile: vi.fn((desc: string) => ({
    name: 'Custom',
    description: desc,
    gravity: 9.8,
    jumpForce: 10,
    moveSpeed: 8,
    friction: 0.3,
    airControl: 0.8,
    terminalVelocity: 20,
    acceleration: 30,
    deceleration: 30,
  })),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { applyPhysicsProfile, analyzePhysicsFeel } from '@/lib/ai/physicsFeel';

function mockStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneGraph: { nodes: {} },
    primaryPhysics: null,
    physicsEnabled: false,
    physics2d: {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('PhysicsFeelPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
    vi.mocked(getCommandDispatcher).mockReturnValue(vi.fn());
  });

  afterEach(() => cleanup());

  it('renders the Physics Feel heading', () => {
    render(<PhysicsFeelPanel />);
    expect(screen.getByText('Physics Feel')).toBeInTheDocument();
  });

  it('renders 8 preset buttons in the gallery', () => {
    render(<PhysicsFeelPanel />);
    // Each preset name appears at least once (may appear in both Preset A grid and Preset B select)
    expect(screen.getAllByText('Floaty Platformer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Snappy Platformer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Weighty RPG').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Arcade Racing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FPS Shooter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Puzzle Float').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Metroidvania').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Roguelike').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Apply button disabled when no physics entities exist', () => {
    mockStore({ sceneGraph: { nodes: {} }, physics2d: {}, physicsEnabled: false });
    render(<PhysicsFeelPanel />);
    const applyBtn = screen.getByLabelText('Apply physics profile to all entities');
    expect(applyBtn.hasAttribute('disabled')).toBe(true);
  });

  it('shows Apply button enabled when physics entities exist', () => {
    mockStore({
      sceneGraph: {
        nodes: {
          'ent-1': { entityId: 'ent-1', components: ['PhysicsData', 'RigidBody'], name: 'Box' },
        },
      },
      physics2d: {},
      physicsEnabled: false,
    });
    render(<PhysicsFeelPanel />);
    const applyBtn = screen.getByLabelText('Apply physics profile to all entities');
    expect(applyBtn.hasAttribute('disabled')).toBe(false);
  });

  it('calls applyPhysicsProfile when Apply is clicked with entities present', () => {
    const mockDispatch = vi.fn();
    vi.mocked(getCommandDispatcher).mockReturnValue(mockDispatch);
    mockStore({
      sceneGraph: {
        nodes: {
          'ent-1': { entityId: 'ent-1', components: ['PhysicsData'], name: 'Box' },
        },
      },
      physics2d: {},
      physicsEnabled: false,
    });

    render(<PhysicsFeelPanel />);
    fireEvent.click(screen.getByLabelText('Apply physics profile to all entities'));
    expect(vi.mocked(applyPhysicsProfile)).toHaveBeenCalledOnce();
  });

  it('blend slider changes blend factor', () => {
    render(<PhysicsFeelPanel />);
    const slider = screen.getByLabelText('Blend factor between Preset A and Preset B');
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('calls analyzePhysicsFeel when Analyze scene button is clicked', () => {
    render(<PhysicsFeelPanel />);
    fireEvent.click(screen.getByLabelText('Analyze current scene physics feel'));
    expect(vi.mocked(analyzePhysicsFeel)).toHaveBeenCalledOnce();
  });

  it('displays analysis results after scene analysis', () => {
    render(<PhysicsFeelPanel />);
    fireEvent.click(screen.getByLabelText('Analyze current scene physics feel'));
    // Analysis shows closest feel label in the results panel
    expect(screen.getByText('87%')).toBeInTheDocument();
    // "Snappy Platformer" is shown in the analysis — may also appear in preset gallery
    expect(screen.getAllByText('Snappy Platformer').length).toBeGreaterThanOrEqual(1);
  });

  it('renders preset B select for blending', () => {
    render(<PhysicsFeelPanel />);
    const select = screen.getByLabelText('Select Preset B for blending');
    expect(select).toBeInTheDocument();
  });

  it('custom description input accepts text', () => {
    render(<PhysicsFeelPanel />);
    const input = screen.getByLabelText('Describe a custom physics feel');
    fireEvent.change(input, { target: { value: 'floaty moon gravity' } });
    expect((input as HTMLInputElement).value).toBe('floaty moon gravity');
  });
});
