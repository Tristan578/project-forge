/**
 * Tests for GameComponentInspector — rendering, adding, updating, removing
 * game components, and section collapse/expand.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { GameComponentInspector } from '../GameComponentInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import type { GameComponentData } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  GAME_COMPONENT_TYPES: [
    'character_controller', 'health', 'collectible', 'damage_zone',
    'checkpoint', 'teleporter', 'moving_platform', 'trigger_zone',
    'spawner', 'follower', 'projectile', 'win_condition', 'dialogue_trigger',
  ],
}));

vi.mock('@/stores/dialogueStore', () => ({
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
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'primaryId' in overrides ? overrides.primaryId : 'ent-1',
      primaryGameComponents: overrides.primaryGameComponents ?? [],
      addGameComponent: mockAddGameComponent,
      updateGameComponent: mockUpdateGameComponent,
      removeGameComponent: mockRemoveGameComponent,
    };
    return selector(state);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useDialogueStore).mockImplementation((selector: any) => {
    const state = { dialogueTrees: {} };
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
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0] } },
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

  it('adds character_controller with correct defaults', () => {
    setupStore({ primaryGameComponents: [] });
    render(<GameComponentInspector />);
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Character Controller'));

    expect(mockAddGameComponent).toHaveBeenCalledWith('ent-1', expect.objectContaining({
      type: 'characterController',
      characterController: expect.objectContaining({ speed: 5, jumpHeight: 8 }),
    }));
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

  it('renders Health section', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0] } },
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

  // ── Remove component ──────────────────────────────────────────────────

  it('calls removeGameComponent when remove button is clicked', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0] } },
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

  // ── Multiple components ───────────────────────────────────────────────

  it('renders multiple game components simultaneously', () => {
    setupStore({
      primaryGameComponents: [
        { type: 'characterController', characterController: { speed: 5, jumpHeight: 8, gravityScale: 1, canDoubleJump: false } },
        { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0] } },
        { type: 'collectible', collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 } },
      ],
    });
    render(<GameComponentInspector />);

    expect(screen.getByText('Character Controller').textContent).toBe('Character Controller');
    expect(screen.getByText('Health').textContent).toBe('Health');
    expect(screen.getByText('Collectible').textContent).toBe('Collectible');
  });
});
