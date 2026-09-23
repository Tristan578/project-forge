/**
 * Tests for GameComponentInspector — rendering, adding, updating, removing
 * game components, and section collapse/expand.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { axe } from 'jest-axe';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameComponentInspector } from '../GameComponentInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import type { GameComponentData } from '@/stores/editorStore';
import {
  defaultCharacterController,
  jumpHeightSliderMax,
} from '@/lib/game/characterControllerDefaults';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  GAME_COMPONENT_TYPES: [
    'character_controller', 'health', 'collectible', 'damage_zone',
    'checkpoint', 'teleporter', 'moving_platform', 'trigger_zone',
    'spawner', 'follower', 'projectile', 'win_condition', 'dialogue_trigger',
  ],
}));

// `listTrees` comes from the real module: it is the guard that keeps one unwalkable
// stored tree from throwing on `t.id` and taking the whole inspector down, so a stub
// here would let these tests pass against an inspector that no longer has it.
vi.mock('@/stores/dialogueStore', async () => ({
  listTrees: (await vi.importActual<typeof import('@/stores/dialogueStore')>(
    '@/stores/dialogueStore',
  )).listTrees,
  useDialogueStore: vi.fn(() => ({})),
}));

vi.mock('./Vec3Input', () => ({
  Vec3Input: ({ label, value }: { label: string; value: [number, number, number] }) => (
    <div data-testid={`vec3-${label || 'input'}`}>{value.join(',')}</div>
  ),
}));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: ({ term, text }: { term?: string; text?: string }) => (
    <span data-testid={`tooltip-${term || 'text'}`}>{text}</span>
  ),
}));

const mockAddGameComponent = vi.fn();
const mockUpdateGameComponent = vi.fn();
const mockRemoveGameComponent = vi.fn();

function setupStore(overrides: {
  primaryId?: string | null;
  primaryGameComponents?: GameComponentData[] | null;
  dialogueTrees?: Record<string, unknown>;
  /**
   * `jumpHeight` does not mean the same thing in the two project types — an apex
   * height in metres on the 3D kinematic path, a rise rate on the 2D legacy one —
   * so the Add Component default, the slider range and the unit all follow from
   * it (PF-1228). Defaults to '3d', matching `spriteSlice`.
   */
  projectType?: '2d' | '3d';
  /** PF-1148: entityId -> component type -> field -> correction. */
  gameComponentAdjustments?: Record<string, unknown>;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryGameComponents: overrides.primaryGameComponents ?? [],
      addGameComponent: mockAddGameComponent,
      updateGameComponent: mockUpdateGameComponent,
      removeGameComponent: mockRemoveGameComponent,
      projectType: overrides.projectType ?? '3d',
      gameComponentAdjustments: overrides.gameComponentAdjustments ?? {},
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDialogueStore).mockImplementation((selector: any) => {
    const state = { dialogueTrees: overrides.dialogueTrees ?? {} };
    return selector(state);
  });
}

describe('GameComponentInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Empty / null states ────────────────────────────────────────────────

  it('renders nothing when no entity is selected', () => {
    setupStore({ primaryId: null });
    const { container } = render(<GameComponentInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('renders "No game components" when entity has no components', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    expect(screen.getByText('No game components attached').textContent).toBe('No game components attached');
  });

  it('renders heading and add button', () => {
    setupStore();
    render(<GameComponentInspector />);
    expect(screen.getByText('Game Components').textContent).toBe('Game Components');
    expect(screen.getByText('Add').textContent).toBe('Add');
  });

  // ── Add menu ─────────────────────────────────────────────────────────

  it('opens add menu on click and shows available types', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));

    // All 13 types should be available
    expect(screen.getByText('Character Controller').textContent).toBe('Character Controller');
    expect(screen.getByText('Health').textContent).toBe('Health');
    expect(screen.getByText('Collectible').textContent).toBe('Collectible');
    expect(screen.getByText('Win Condition').textContent).toBe('Win Condition');
  });

  it('hides already-attached types from add menu', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
      ],
    });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));

    // Health should NOT appear in the dropdown
    const menuItems = document.querySelectorAll('.w-48 button');
    const labels = Array.from(menuItems).map((b) => b.textContent);
    expect(labels).not.toContain('Health');
    expect(labels).toContain('Character Controller');
  });

  it('calls addGameComponent with defaults when type is selected', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Health'));

    expect(mockAddGameComponent).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({ type: 'health' }),
    );
  });

  /**
   * The manual Add Component path used to hand every project the engine's own
   * `CharacterControllerData::default()` — `jumpHeight: 8`. On the 2D legacy path
   * that number is a rise rate and 8 is what it was tuned against; on the 3D
   * kinematic path it is an apex height in metres, so the same literal asked for
   * an eight-metre jump with 2.6 seconds of hang time. Nothing could report it:
   * `dispatchCommand` returns void and a tall jump is a valid jump (PF-1228).
   *
   * Asserted as a full shape rather than `objectContaining`, because the failure
   * mode here is a field carrying the wrong number while the asserted ones look
   * right.
   */
  it('adds character_controller with a landable jump in a 3D project', () => {
    setupStore({ primaryGameComponents: [], projectType: '3d' });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Character Controller'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', {
      type: 'characterController',
      characterController: defaultCharacterController('3d'),
    });
    const added = mockAddGameComponent.mock.calls[0]![1] as {
      characterController: { jumpHeight: number };
    };
    expect(added.characterController.jumpHeight).not.toBe(8);
    expect(added.characterController.jumpHeight).toBeCloseTo(1.03, 2);
  });

  it('adds character_controller with the engine default in a 2D project', () => {
    setupStore({ primaryGameComponents: [], projectType: '2d' });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Character Controller'));

    // 8 is correct here: the legacy path nudges the transform by
    // `jump_height * 0.5 * dt` with no gravity integrator, so it is a speed.
    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', {
      type: 'characterController',
      characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false },
    });
  });

  it('adds collectible with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Collectible'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'collectible',
      collectible: expect.objectContaining({ value: 1, destroyOnCollect: true }),
    }));
  });

  it('adds damage_zone with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Damage Zone'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'damageZone',
      damageZone: expect.objectContaining({ damagePerSecond: 25 }),
    }));
  });

  it('adds checkpoint with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Checkpoint'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'checkpoint',
      checkpoint: expect.objectContaining({ autoSave: true }),
    }));
  });

  it('adds teleporter with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Teleporter'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'teleporter',
      teleporter: expect.objectContaining({ cooldownSecs: 1 }),
    }));
  });

  it('adds moving_platform with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Moving Platform'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'movingPlatform',
      movingPlatform: expect.objectContaining({ speed: 2, loopMode: 'pingPong' }),
    }));
  });

  it('adds trigger_zone with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Trigger Zone'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'triggerZone',
      triggerZone: expect.objectContaining({ eventName: 'trigger' }),
    }));
  });

  it('adds spawner with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Spawner'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'spawner',
      spawner: expect.objectContaining({ entityType: 'cube', intervalSecs: 3 }),
    }));
  });

  it('adds follower with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Follower'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'follower',
      follower: expect.objectContaining({ speed: 3, lookAtTarget: true }),
    }));
  });

  it('adds projectile with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Projectile'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'projectile',
      projectile: expect.objectContaining({ speed: 15, damage: 10 }),
    }));
  });

  it('adds win_condition with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Win Condition'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'winCondition',
      winCondition: expect.objectContaining({ conditionType: 'score', targetScore: 10 }),
    }));
  });

  it('adds dialogue_trigger with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Dialogue Trigger'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'dialogueTrigger',
      dialogueTrigger: expect.objectContaining({ triggerRadius: 3, requireInteract: true }),
    }));
  });

  // ── Rendering attached components ─────────────────────────────────────

  it('renders CharacterController section with controls', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Character Controller').textContent).toBe('Character Controller');
    expect(screen.getByText('Speed').textContent).toBe('Speed');
    expect(screen.getByText('Jump Height').textContent).toBe('Jump Height');
  });

  /**
   * The readout used to print a bare "8.0" for a number that is metres in one
   * project type and a rise rate in the other, and the slider ran to a fixed 20
   * in both. That ambiguity is what let a 26-foot default jump ship unnoticed,
   * so the unit and the range are asserted here rather than left to the eye
   * (PF-1228).
   */
  function jumpHeightRow(): HTMLElement {
    const row = screen.getByText('Jump Height').parentElement?.parentElement;
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  it('labels Jump Height in metres and bounds it by the airtime cap in 3D', () => {
    setupStore({
      projectType: '3d',
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 7, jumpHeight: 1, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);
    const row = jumpHeightRow();
    expect(row.textContent).toContain('1.0 m');
    const slider = row.querySelector('input[type="range"]') as HTMLInputElement;
    expect(Number(slider.max)).toBeCloseTo(jumpHeightSliderMax('3d', 1, 1), 10);
    // The ceiling is derived, not a round authoring number.
    expect(Number(slider.max)).toBeCloseTo(2.76, 2);
  });

  it('tracks the controller gravity rather than pinning one 3D ceiling', () => {
    setupStore({
      projectType: '3d',
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 7, jumpHeight: 1, gravityScale: 4, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);
    const slider = jumpHeightRow().querySelector('input[type="range"]') as HTMLInputElement;
    expect(Number(slider.max)).toBeCloseTo(jumpHeightSliderMax('3d', 4, 1), 10);
    expect(Number(slider.max)).toBeGreaterThan(jumpHeightSliderMax('3d', 1, 1));
  });

  it('shows Jump Height unitless with the authoring range in 2D', () => {
    setupStore({
      projectType: '2d',
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);
    const row = jumpHeightRow();
    // No unit: the legacy path's number is a rise rate whose unit is an artifact
    // of the missing integrator, not something to tell a creator to reason in.
    expect(row.textContent).toContain('8.0');
    expect(row.textContent).not.toContain(' m');
    const slider = row.querySelector('input[type="range"]') as HTMLInputElement;
    expect(Number(slider.max)).toBe(20);
  });

  it('raises the Jump Height ceiling for a value already above it', () => {
    setupStore({
      projectType: '3d',
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 7, jumpHeight: 40, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);
    // An imported scene, or a value typed before this bound existed. Pinning the
    // thumb at the end of the track while the readout shows something larger
    // reads as a broken slider and invites a drag that discards the value.
    const slider = jumpHeightRow().querySelector('input[type="range"]') as HTMLInputElement;
    expect(Number(slider.max)).toBe(40);
    expect(slider.value).toBe('40');
  });

  it('renders Health section', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Health').textContent).toBe('Health');
    expect(screen.getByText('Max HP').textContent).toBe('Max HP');
  });

  it('renders Collectible section', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'collectible', collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Collectible').textContent).toBe('Collectible');
    expect(screen.getByText('Value').textContent).toBe('Value');
  });

  it('renders DamageZone section', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'damageZone', damageZone: { damagePerSecond: 25, oneShot: false } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Damage Zone').textContent).toBe('Damage Zone');
    expect(screen.getByText('Damage/Sec').textContent).toBe('Damage/Sec');
  });

  it('renders MovingPlatform section with waypoints', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'movingPlatform', movingPlatform: { speed: 2, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Moving Platform').textContent).toBe('Moving Platform');
    expect(screen.getByText('Waypoints').textContent).toBe('Waypoints');
  });

  it('renders WinCondition section with conditional target score', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'winCondition', winCondition: { conditionType: 'score', targetScore: 10, targetEntityId: null } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Win Condition').textContent).toBe('Win Condition');
    expect(screen.getByText('Target Score').textContent).toBe('Target Score');
  });

  it('renders WinCondition reachGoal variant with Goal ID field', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'goal-1' } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Goal ID').textContent).toBe('Goal ID');
  });

  it('renders DialogueTrigger section with interact key when requireInteract is true', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'dialogueTrigger', dialogueTrigger: { treeId: '', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } },
      ],
    });
    render(<GameComponentInspector />);
    expect(screen.getByText('Dialogue Trigger').textContent).toBe('Dialogue Trigger');
    expect(screen.getByText('Key').textContent).toBe('Key');
  });

  it('offers the walkable stored trees and survives an unwalkable one', () => {
    // The tree options come straight from persisted JSON. A bare
    // `Object.values(dialogueTrees).map(t => t.id)` throws on a `null` entry, and a
    // throw here unmounts the inspector — the author loses the panel they were
    // editing, not just the one bad tree. `listTrees` skips it instead, so the
    // sibling trees stay pickable.
    setupStore({
      primaryGameComponents: [
        { type: 'dialogueTrigger', dialogueTrigger: { treeId: '', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } },
      ],
      dialogueTrees: {
        broken: null,
        noNodes: { id: 'noNodes', name: 'No nodes', startNodeId: 's', variables: {} },
        fine: { id: 'fine', name: 'Village Intro', startNodeId: 's', variables: {}, nodes: [] },
      },
    });
    render(<GameComponentInspector />);

    expect(screen.getByText('Dialogue Trigger').textContent).toBe('Dialogue Trigger');
    expect(screen.getByText('Village Intro').textContent).toBe('Village Intro');
    expect(screen.queryByText('No nodes')).toBeNull();
  });

  it('says so when the trigger points at a tree that is not on offer', () => {
    // A controlled `<select>` whose value matches no option displays the FIRST
    // option. So a trigger still naming a deleted — or unwalkable, and so
    // filtered out by `listTrees` — tree reads as `(none)`, which is also
    // exactly what an unconfigured trigger reads as. The author sees a field
    // they never set, sets it, and never learns the trigger was pointed
    // somewhere real and is now pointed somewhere else.
    setupStore({
      primaryGameComponents: [
        { type: 'dialogueTrigger', dialogueTrigger: { treeId: 'ghost-1', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } },
      ],
      dialogueTrees: {
        fine: { id: 'fine', name: 'Village Intro', startNodeId: 's', variables: {}, nodes: [] },
      },
    });
    render(<GameComponentInspector />);

    expect(screen.getByText(/Missing tree \(ghost-1\)/)).not.toBeNull();
    // The dead id is kept as the value rather than rewritten to '': nothing on
    // this screen should edit the author's data to make its own display tidy,
    // and the id is the only clue to what the trigger used to point at.
    const select = Array.from(document.querySelectorAll('select')).find((s) => s.value === 'ghost-1');
    expect(select).toBeDefined();
  });

  it('adds no such option when the trigger points at a listed tree', () => {
    // Without this, an unconditional warning option passes the test above.
    setupStore({
      primaryGameComponents: [
        { type: 'dialogueTrigger', dialogueTrigger: { treeId: 'fine', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } },
      ],
      dialogueTrees: {
        fine: { id: 'fine', name: 'Village Intro', startNodeId: 's', variables: {}, nodes: [] },
      },
    });
    render(<GameComponentInspector />);

    expect(screen.queryByText(/Missing tree/)).toBeNull();
    expect(screen.getByText('Village Intro').textContent).toBe('Village Intro');
  });

  it('adds no such option when the trigger is simply unconfigured', () => {
    // `treeId: ''` is the unset state, and it HAS an option — `(none)`. Warning
    // about it would put a scary label on every freshly-added trigger.
    setupStore({
      primaryGameComponents: [
        { type: 'dialogueTrigger', dialogueTrigger: { treeId: '', triggerRadius: 3, requireInteract: true, interactKey: 'e', oneShot: false } },
      ],
      dialogueTrees: {},
    });
    render(<GameComponentInspector />);

    expect(screen.queryByText(/Missing tree/)).toBeNull();
  });

  // ── Update component ──────────────────────────────────────────────────

  it('calls updateGameComponent when slider value changes', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);

    // Find the speed slider
    const sliders = document.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBeGreaterThan(0);

    // Change the first slider (speed)
    fireEvent.change(sliders[0], { target: { value: '10' } });
    expect(mockUpdateGameComponent).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({
        type: 'characterController',
        characterController: expect.objectContaining({ speed: 10 }),
      }),
    );
  });

  it('calls updateGameComponent when checkbox changes', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
      ],
    });
    render(<GameComponentInspector />);

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBeGreaterThan(0);

    fireEvent.click(checkboxes[0]);
    expect(mockUpdateGameComponent).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({
        type: 'characterController',
        characterController: expect.objectContaining({ canDoubleJump: true }),
      }),
    );
  });

  it('exposes the health Despawn toggle by its visible label and round-trips a change', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
      ],
    });
    render(<GameComponentInspector />);

    // Resolved by accessible name, not by index — the label association is
    // itself part of the contract, so a regression in `CheckboxRow` fails here
    // rather than silently degrading to an unnamed checkbox.
    const despawn = screen.getByLabelText('Despawn') as HTMLInputElement;
    expect(despawn.checked).toBe(true);

    fireEvent.click(despawn);
    expect(mockUpdateGameComponent).toHaveBeenCalledWith(
      'ent-1',
      expect.objectContaining({
        type: 'health',
        health: expect.objectContaining({ despawnOnDeath: false }),
      }),
    );
  });

  // ── Remove component ──────────────────────────────────────────────────

  it('calls removeGameComponent when remove button is clicked', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
      ],
    });
    render(<GameComponentInspector />);

    // The trash icon button inside the component section header
    const removeButtons = document.querySelectorAll('button');
    const trashBtn = Array.from(removeButtons).find((b) =>
      b.className.includes('hover:text-red-400') && b.closest('.rounded.border')
    );
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);
    expect(mockRemoveGameComponent).toHaveBeenCalledWith('ent-1', 'health');
  });

  // ── Section collapse/expand ───────────────────────────────────────────

  it('collapses section when header is clicked', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'checkpoint', checkpoint: { autoSave: true } },
      ],
    });
    render(<GameComponentInspector />);

    // Auto-Save checkbox should be visible
    expect(screen.getByText('Auto-Save').textContent).toBe('Auto-Save');

    // Click the section toggle button
    const toggleBtn = screen.getByText('Checkpoint');
    fireEvent.click(toggleBtn);

    // Content should be hidden
    expect(screen.queryByText('Auto-Save')).toBeNull();

    // Click again to expand
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Auto-Save').textContent).toBe('Auto-Save');
  });

  // ── Adjusted values (PF-1148) ─────────────────────────────────────────
  //
  // A field that holds a different value than the one asked for is marked,
  // with the requested value readable — and nothing is marked when nothing
  // was adjusted, because a false "we adjusted this" is worse than silence.

  describe('adjusted values', () => {
    const platform = (speed: number): GameComponentData => ({
      type: 'movingPlatform',
      movingPlatform: { speed, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' },
    });
    const speedClamp = {
      component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped',
    };
    const sentence = 'Moving Platform speed: you asked for 99999, it was capped at 1000.';

    it('lists the adjustment with the requested value, and marks the field it landed on', () => {
      setupStore({
        primaryGameComponents: [platform(1000)],
        gameComponentAdjustments: { 'ent-1': { movingPlatform: { speed: speedClamp } } },
      });
      render(<GameComponentInspector />);

      const note = screen.getByRole('status', { name: 'Adjusted to fit the engine’s limits' });
      expect(Array.from(note.querySelectorAll('li')).map((li) => li.textContent)).toEqual([sentence]);

      // The Speed slider is described by exactly that sentence, so a screen
      // reader on the field hears what was asked for.
      const speed = screen.getByLabelText('Speed');
      const describedBy = speed.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)?.textContent).toBe(sentence);

      // And the row itself carries the visible mark; the Pause row does not.
      expect(speed.closest('div')?.textContent).toContain('Adjusted');
      expect(screen.getByLabelText('Pause').closest('div')?.textContent).not.toContain('Adjusted');
      expect(screen.getByLabelText('Pause').getAttribute('aria-describedby')).toBeNull();
    });

    it('keeps the count visible on the header when the section is collapsed', () => {
      setupStore({
        primaryGameComponents: [platform(1000)],
        gameComponentAdjustments: { 'ent-1': { movingPlatform: { speed: speedClamp } } },
      });
      render(<GameComponentInspector />);
      fireEvent.click(screen.getByText('Moving Platform'));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByText('1 adjusted')).toBeDefined();
    });

    it('shows nothing for a marker the field no longer bears out', () => {
      // The speed is back to 2 (an undo the store has not heard about yet): the
      // marker describes a value the field does not hold, so it must not show.
      setupStore({
        primaryGameComponents: [platform(2)],
        gameComponentAdjustments: { 'ent-1': { movingPlatform: { speed: speedClamp } } },
      });
      render(<GameComponentInspector />);
      expect(screen.getByText('Moving Platform')).toBeDefined();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText(/adjusted/i)).toBeNull();
      expect(screen.getByLabelText('Speed').getAttribute('aria-describedby')).toBeNull();
    });

    describe('a route marker', () => {
      // "You gave 1 point" left the default route standing: two points, the
      // same count as plenty of routes the author could put there next.
      const routeReplaced = {
        component: 'movingPlatform', field: 'waypoints', requested: 1, applied: 2, reason: 'invalid-replaced',
        unit: 'points', appliedPoints: [[0, 0, 0], [0, 3, 0]],
      };
      const routeSentence = 'Moving Platform waypoints: you gave 1 point, but a route needs at least 2 usable points, '
        + 'so the default route (2 points) was used instead.';
      const withRoute = (waypoints: [number, number, number][]): GameComponentData => ({
        type: 'movingPlatform',
        movingPlatform: { speed: 2, waypoints, pauseDuration: 0.5, loopMode: 'pingPong' },
      });

      it('shows while the field holds the route it describes', () => {
        setupStore({
          primaryGameComponents: [withRoute([[0, 0, 0], [0, 3, 0]])],
          gameComponentAdjustments: { 'ent-1': { movingPlatform: { waypoints: routeReplaced } } },
        });
        render(<GameComponentInspector />);
        const note = screen.getByRole('status', { name: 'Adjusted to fit the engine’s limits' });
        expect(Array.from(note.querySelectorAll('li')).map((li) => li.textContent)).toEqual([routeSentence]);

        // The Waypoints row marks itself too, through its own lookup — the
        // note above is built from the section's list and would still read
        // correctly with this row's wiring gone, so it cannot stand in for it.
        const group = screen.getByRole('group', { name: 'Waypoints' });
        const describedBy = group.getAttribute('aria-describedby');
        expect(describedBy === null ? null : document.getElementById(describedBy)?.textContent).toBe(routeSentence);
        const badges = screen.getAllByText('Adjusted');
        expect(badges).toHaveLength(1);
        // Beside the row's own label, not somewhere else in the section.
        expect(screen.getByText('Waypoints').parentElement?.contains(badges[0])).toBe(true);
      });

      it('shows nothing once the field holds a different route with the same number of points', () => {
        setupStore({
          primaryGameComponents: [withRoute([[1, 1, 1], [4, 1, 1]])],
          gameComponentAdjustments: { 'ent-1': { movingPlatform: { waypoints: routeReplaced } } },
        });
        render(<GameComponentInspector />);
        expect(screen.getByText('Moving Platform')).toBeDefined();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByText(/adjusted/i)).toBeNull();
        expect(screen.getByRole('group', { name: 'Waypoints' }).getAttribute('aria-describedby')).toBeNull();
      });
    });

    // ── Vector rows ──
    //
    // `Vec3Row` has no single input to hang the note on, so it marks a named
    // group around the three axes and puts the badge beside it. That is its own
    // lookup by `field`: a typo there, or the group losing `aria-describedby`,
    // leaves the section note above (driven by the section's list, not by the
    // row) reading exactly as before. So these assert on the row, per field.
    describe('a vector row', () => {
      const notAVector = { description: '[1, 2]' };
      const vectorRows: readonly {
        label: string;
        component: GameComponentData;
        /** A correction on the row's own vector field. */
        vector: { component: string; field: string } & Record<string, unknown>;
        sentence: string;
        /** A correction on another field in the same section. */
        other: { component: string; field: string } & Record<string, unknown>;
      }[] = [
        {
          label: 'Respawn Pt',
          component: {
            type: 'health',
            health: { maxHp: 1_000_000, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true },
          },
          vector: { component: 'health', field: 'respawnPoint', requested: notAVector, applied: [0, 1, 0], reason: 'invalid-replaced' },
          sentence: 'Health respawn point: [1, 2] is not a value this field accepts, so [0, 1, 0] was used instead.',
          other: { component: 'health', field: 'maxHp', requested: 5_000_000, applied: 1_000_000, reason: 'clamped' },
        },
        {
          label: 'Target Pos',
          component: { type: 'teleporter', teleporter: { targetPosition: [0, 1, 0], cooldownSecs: 300 } },
          vector: { component: 'teleporter', field: 'targetPosition', requested: notAVector, applied: [0, 1, 0], reason: 'invalid-replaced' },
          sentence: 'Teleporter target position: [1, 2] is not a value this field accepts, so [0, 1, 0] was used instead.',
          other: { component: 'teleporter', field: 'cooldownSecs', requested: 900, applied: 300, reason: 'clamped' },
        },
        {
          label: 'Offset',
          component: {
            type: 'spawner',
            spawner: { entityType: 'cube', intervalSecs: 3, maxCount: 1000, spawnOffset: [0, 1, 0], onTrigger: null },
          },
          vector: { component: 'spawner', field: 'spawnOffset', requested: notAVector, applied: [0, 1, 0], reason: 'invalid-replaced' },
          sentence: 'Spawner spawn offset: [1, 2] is not a value this field accepts, so [0, 1, 0] was used instead.',
          other: { component: 'spawner', field: 'maxCount', requested: 5000, applied: 1000, reason: 'clamped' },
        },
      ];

      it.each(vectorRows)('marks the $label row itself when its field was adjusted', ({ label, component, vector, sentence }) => {
        setupStore({
          primaryGameComponents: [component],
          gameComponentAdjustments: { 'ent-1': { [component.type]: { [vector.field]: vector } } },
        });
        render(<GameComponentInspector />);

        // A screen reader entering any axis hears what was asked for.
        const group = screen.getByRole('group', { name: label });
        const describedBy = group.getAttribute('aria-describedby');
        expect(describedBy === null ? null : document.getElementById(describedBy)?.textContent).toBe(sentence);

        // The one visible mark in the section, on this row.
        const badges = screen.getAllByText('Adjusted');
        expect(badges).toHaveLength(1);
        expect(group.parentElement?.contains(badges[0])).toBe(true);
      });

      it.each(vectorRows)('leaves the $label row unmarked when only another field was adjusted', ({ label, component, other }) => {
        setupStore({
          primaryGameComponents: [component],
          gameComponentAdjustments: { 'ent-1': { [component.type]: { [other.field]: other } } },
        });
        render(<GameComponentInspector />);

        // Non-vacuous: the section is marking a field — just not this one.
        const note = screen.getByRole('status', { name: 'Adjusted to fit the engine’s limits' });
        expect(note.querySelectorAll('li')).toHaveLength(1);
        const badges = screen.getAllByText('Adjusted');
        expect(badges).toHaveLength(1);

        const group = screen.getByRole('group', { name: label });
        expect(group.getAttribute('aria-describedby')).toBeNull();
        expect(group.parentElement?.contains(badges[0])).toBe(false);
      });
    });

    it('shows nothing when nothing was adjusted', () => {
      setupStore({ primaryGameComponents: [platform(1000)] });
      render(<GameComponentInspector />);
      expect(screen.getByText('Moving Platform')).toBeDefined();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText(/adjusted/i)).toBeNull();
    });

    it('shows another entity’s markers nowhere', () => {
      setupStore({
        primaryGameComponents: [platform(1000)],
        gameComponentAdjustments: { 'ent-2': { movingPlatform: { speed: speedClamp } } },
      });
      render(<GameComponentInspector />);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('lists an adjusted field that has no control of its own', () => {
      // Current HP has no row in the Health section; the note is still the
      // place the author can read what they asked for.
      setupStore({
        primaryGameComponents: [{
          type: 'health',
          health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true },
        }],
        gameComponentAdjustments: {
          'ent-1': {
            health: {
              currentHp: { component: 'health', field: 'currentHp', requested: 5000, applied: 100, reason: 'clamped' },
            },
          },
        },
      });
      render(<GameComponentInspector />);
      const note = screen.getByRole('status', { name: 'Adjusted to fit the engine’s limits' });
      expect(note.textContent).toContain('Health current HP: you asked for 5000, it was capped at 100.');
    });

    it('has no axe violations with an adjusted field showing', async () => {
      setupStore({
        primaryGameComponents: [platform(1000)],
        gameComponentAdjustments: { 'ent-1': { movingPlatform: { speed: speedClamp } } },
      });
      const { container } = render(<GameComponentInspector />);
      // Non-vacuous: the note being audited is really there.
      expect(screen.getByRole('status')).toBeDefined();
      const results = await axe(container);
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  });

  // ── Multiple components ───────────────────────────────────────────────

  it('renders multiple game components simultaneously', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
        { type: 'collectible', collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 } },
      ],
    });
    render(<GameComponentInspector />);

    expect(screen.getByText('Character Controller').textContent).toBe('Character Controller');
    expect(screen.getByText('Health').textContent).toBe('Health');
    expect(screen.getByText('Collectible').textContent).toBe('Collectible');
  });
});
