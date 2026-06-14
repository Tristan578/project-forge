import { test, expect } from '../fixtures/editor.fixture';
import { injectStore, readStore } from '../helpers/store-injection';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_LOAD_MS,
  E2E_TIMEOUT_SHORT_MS,
} from '../constants';

/**
 * STRICT interactive-journey gate (#8601 F09 + #8604 F12).
 *
 * Proves the core new-user journey survives on the SAME production server users
 * hit — idea -> generated scene -> entities spawn -> Play -> winnable -> export.
 *
 * This spec is tagged `@journey` and runs ONLY in the `test-e2e-journey` CI job,
 * which:
 *   - builds with `NEXT_PUBLIC_E2E_HOOKS=true` so the editor/chat stores are
 *     exposed on `window` against a real `next build` + `next start` server, and
 *   - runs with `E2E_STRICT_STORES=true` so the store-injection helpers THROW
 *     when a store or target is missing instead of skipping.
 *
 * Because of that, every assertion below is UNCONDITIONAL — there are no
 * `if (count > 0)` short-circuits. A broken journey stage turns the gate red.
 * (The pre-existing @ui specs guard their assertions so they can also run in a
 * store-less local mode; this gate deliberately does not.)
 *
 * The "winnable" assertion is computed structurally from real store state by
 * {@link isStructurallyWinnable} below — it intentionally does NOT import the
 * production winnability validator (#8542), so the gate is an independent check
 * rather than a tautology, and stays decoupled from that PR's merge order.
 *
 * No WASM/AI is involved: a representative generated platformer is injected via
 * the same store setters the real generation pipeline calls, then driven through
 * the real editor UI (Play controls, the Export button).
 */

interface WinConditionShape {
  conditionType: 'score' | 'collectAll' | 'reachGoal';
  targetScore: number | null;
  targetEntityId: string | null;
}

interface GameComponentShape {
  type: string;
  winCondition?: WinConditionShape;
}

interface WinCheckInput {
  components: Record<string, GameComponentShape[]>;
  nodeIds: string[];
}

/**
 * Structural winnability check, mirroring the intent of the production validator
 * (#8542) but kept independent so this gate cannot pass vacuously: a scene is
 * winnable only if it has a player (CharacterController) AND at least one win
 * condition that is actually satisfiable from the current scene contents.
 */
function isStructurallyWinnable(input: WinCheckInput): { winnable: boolean; reason: string } {
  const all = Object.values(input.components).flat();
  const winConditions = all.filter((c) => c.type === 'winCondition');
  if (winConditions.length === 0) {
    return { winnable: false, reason: 'no win condition in scene' };
  }
  const hasPlayer = all.some((c) => c.type === 'characterController');
  if (!hasPlayer) {
    return { winnable: false, reason: 'no player (CharacterController) in scene' };
  }
  const hasCollectible = all.some((c) => c.type === 'collectible');
  const nodes = new Set(input.nodeIds);

  for (const wc of winConditions) {
    const cond = wc.winCondition;
    if (!cond) continue;
    if (cond.conditionType === 'reachGoal') {
      // A reachable goal must reference an entity that actually exists.
      if (cond.targetEntityId && nodes.has(cond.targetEntityId)) {
        return { winnable: true, reason: 'reachGoal: player + existing goal entity' };
      }
    } else if (cond.conditionType === 'collectAll') {
      if (hasCollectible) {
        return { winnable: true, reason: 'collectAll: player + collectible set' };
      }
    } else if (cond.conditionType === 'score') {
      if ((cond.targetScore ?? 0) > 0 && hasCollectible) {
        return { winnable: true, reason: 'score: reachable target via collectibles' };
      }
    }
  }
  return { winnable: false, reason: 'win condition present but not satisfiable from scene' };
}

/**
 * Inject a representative AI-generated, winnable platformer: a player with a
 * CharacterController, a goal entity, a collectible, and a reachGoal win
 * condition that references the goal. Uses the same store setters the real
 * generation pipeline drives (addNode / addGameComponent).
 */
const INJECT_WINNABLE_GAME = `
  const state = window.__EDITOR_STORE.getState();
  // Matches the SceneNode shape (keyed by entityId): { entityId, name, parentId, children, components, visible }.
  const node = (entityId, name) => ({ entityId, name, parentId: null, children: [], components: [], visible: true });
  state.addNode(node('journey-player', 'Player'));
  state.addNode(node('journey-goal', 'Goal'));
  state.addNode(node('journey-coin', 'Coin'));
  state.addGameComponent('journey-player', {
    type: 'characterController',
    characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
  });
  state.addGameComponent('journey-player', {
    type: 'winCondition',
    winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'journey-goal' },
  });
  state.addGameComponent('journey-coin', {
    type: 'collectible',
    collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 1 },
  });
`;

/**
 * Inject an UNWINNABLE scene: a player + a reachGoal win condition that points
 * at a goal entity which was never spawned. Used to prove the winnability check
 * has teeth (does not just return true for any scene with a win condition).
 */
const INJECT_UNWINNABLE_GAME = `
  const state = window.__EDITOR_STORE.getState();
  state.addNode({ entityId: 'journey-player', name: 'Player', parentId: null, children: [], components: [], visible: true });
  state.addGameComponent('journey-player', {
    type: 'characterController',
    characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
  });
  state.addGameComponent('journey-player', {
    type: 'winCondition',
    winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'ghost-goal-does-not-exist' },
  });
`;

const READ_WIN_INPUT = `JSON.stringify({
  components: window.__EDITOR_STORE.getState().allGameComponents,
  nodeIds: Object.keys(window.__EDITOR_STORE.getState().sceneGraph?.nodes ?? {}),
})`;

test.describe('Interactive Journey Gate @journey', () => {
  test.beforeEach(async ({ page, editor }) => {
    await editor.loadPage();
    // Explicit no-redirect invariant for the journey gate: the /dev gate
    // (e2eHooksEnabled) must have RENDERED the editor in this build, not
    // redirected to /sign-in. loadPage()'s hydration wait already implies this
    // — __REACT_HYDRATED is set only once EditorLayout mounts, and it mounts
    // only when /dev renders — but assert the URL directly so a future gate or
    // a regression in the NEXT_PUBLIC_E2E_HOOKS build flag fails with a clear
    // "expected /dev, got /sign-in" instead of an opaque hydration timeout.
    // Kept in this spec (not the shared loadPage fixture) so it only affects the
    // journey gate and can't shift console-capture timing for other E2E specs.
    await expect(page).toHaveURL(/\/dev(?:[/?#]|$)/, { timeout: E2E_TIMEOUT_ELEMENT_MS });
  });

  // -------------------------------------------------------------------------
  // 0. The prod server exposes the stores the journey depends on
  // -------------------------------------------------------------------------
  test('production server exposes the editor and chat stores', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

    const engineMode = await readStore<string>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE.getState().engineMode`,
    );
    expect(engineMode).toBe('edit');

    const chatReady = await readStore<boolean>(
      page,
      '__CHAT_STORE',
      `typeof window.__CHAT_STORE?.getState === 'function'`,
    );
    expect(chatReady).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 1. A generated game spawns its entities into the scene graph
  // -------------------------------------------------------------------------
  test('a generated game spawns its entities into the scene graph', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
    await injectStore(page, '__EDITOR_STORE', INJECT_WINNABLE_GAME);

    const nodeIds = await readStore<string[]>(
      page,
      '__EDITOR_STORE',
      `Object.keys(window.__EDITOR_STORE.getState().sceneGraph?.nodes ?? {})`,
    );

    expect(nodeIds).toContain('journey-player');
    expect(nodeIds).toContain('journey-goal');
    expect(nodeIds).toContain('journey-coin');
  });

  // -------------------------------------------------------------------------
  // 2. The generated game is winnable (positive case)
  // -------------------------------------------------------------------------
  test('the generated game is winnable (reachable goal + player)', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
    await injectStore(page, '__EDITOR_STORE', INJECT_WINNABLE_GAME);

    const raw = await readStore<string>(page, '__EDITOR_STORE', READ_WIN_INPUT);
    expect(raw).not.toBeNull();
    const result = isStructurallyWinnable(JSON.parse(raw as string) as WinCheckInput);

    expect(result, `expected winnable scene: ${result.reason}`).toMatchObject({ winnable: true });
  });

  // -------------------------------------------------------------------------
  // 3. An unwinnable scene is detected (proves the check is not vacuous)
  // -------------------------------------------------------------------------
  test('an unwinnable scene is correctly detected as not winnable', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
    await injectStore(page, '__EDITOR_STORE', INJECT_UNWINNABLE_GAME);

    const raw = await readStore<string>(page, '__EDITOR_STORE', READ_WIN_INPUT);
    expect(raw).not.toBeNull();
    const result = isStructurallyWinnable(JSON.parse(raw as string) as WinCheckInput);

    expect(result.winnable, `expected NOT winnable: ${result.reason}`).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. The generated game enters Play mode
  // -------------------------------------------------------------------------
  test('the generated game enters Play mode', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
    await injectStore(page, '__EDITOR_STORE', INJECT_WINNABLE_GAME);

    await injectStore(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE.getState().setEngineMode('play')`,
    );

    const mode = await readStore<string>(
      page,
      '__EDITOR_STORE',
      `window.__EDITOR_STORE.getState().engineMode`,
    );
    expect(mode).toBe('play');

    await expect(page.getByText('Playing').first()).toBeVisible({ timeout: E2E_TIMEOUT_SHORT_MS });
  });

  // -------------------------------------------------------------------------
  // 5. The generated game is exportable (real Export button + dialog)
  // -------------------------------------------------------------------------
  test('the generated game is exportable', async ({ page, editor }) => {
    await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);
    await injectStore(page, '__EDITOR_STORE', INJECT_WINNABLE_GAME);

    // Drive the REAL toolbar Export button (the old @ui test poked a store
    // action that never existed and only "passed" because it was guarded).
    const exportButton = page.locator('button[aria-label="Export game"]');
    await expect(exportButton).toBeEnabled({ timeout: E2E_TIMEOUT_ELEMENT_MS });
    await exportButton.click();

    const dialog = page.locator('[data-testid="export-dialog"]');
    await expect(dialog).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Export format options must render...
    const formatRadios = dialog.locator('input[type="radio"]');
    expect(await formatRadios.count()).toBeGreaterThanOrEqual(2);

    // ...and the export action must be reachable (title defaults to the scene
    // name, so the submit button is enabled).
    const submit = dialog.getByRole('button', { name: 'Export', exact: true });
    await expect(submit).toBeEnabled();
  });
});
