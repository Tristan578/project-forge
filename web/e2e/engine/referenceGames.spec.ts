import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_SHORT_MS,
} from '../constants';
import { REFERENCE_GAMES } from '../fixtures/reference-games';
import {
  resolveEntityRefs,
  type ExpectedEntityState,
  type ExpectedInputAction,
  type ReferenceGame,
  type ReferenceGameExpectedState,
} from '../fixtures/reference-games/referenceGame';
import {
  collectEngineConsole,
  expectNoEngineRejections,
  type EngineConsole,
} from '../helpers/engine-console';
import { SCENE_EXPORTED_EVENT } from '../../src/lib/engine/sceneExportWire';
import { formatWinnabilityMessage } from '../../src/lib/playMode/winnabilityValidator';
import type { useEditorStore } from '@/stores/editorStore';

/**
 * #10159 — the two versioned reference games load through the REAL engine.
 *
 * Each game in `e2e/fixtures/reference-games` is applied the way
 * `inputReplay.spec.ts` builds its scene ("Build the fixture scene through REAL
 * engine commands"): the same store actions the editor's own controls call —
 * `newScene`, `setProjectType`, `spawnEntity`, `updateTransform`, the physics
 * setters, `addGameComponent`, `setInputBinding` — each of which dispatches a
 * real command into the WASM engine under ANGLE/SwiftShader software WebGL2.
 *
 * NOTHING HERE IS READ BACK FROM A STORE THE TEST WROTE. `addGameComponent` and
 * the physics setters write the store optimistically before they dispatch, so
 * `allGameComponents` would show every component even if the engine dropped
 * all of them. The assertions read only what the engine produced itself:
 *
 * - the engine's own serialization of the scene — `export_scene` answered by
 *   `SCENE_EXPORTED` (`build_scene_file` in Rust), correlated by `requestId` —
 *   for entity names and types, each entity's physics, each entity's game
 *   component types, the win and lose fields, and the input actions; and
 * - `sceneGraph.nodes`, which only the engine's SCENE_GRAPH_UPDATE event
 *   writes, for "exactly these entities" and for each entity's
 *   `GameComponents` marker; and
 * - `engineMode`, which only the engine's ENGINE_MODE_CHANGED event sets to
 *   `'play'` (see `pipeline-live-engine.spec.ts` for the writer audit).
 *
 * The oracle is the fixture's EXPECTED-STATE RECORD, not the fixture: the
 * record is hand-written and version-pinned (`e2e/lib/__tests__/
 * referenceGames.test.ts` holds it to the fixture), so the engine is compared
 * against an independent statement of the game.
 *
 * A payload the engine HARD-rejects surfaces only as the
 * `Engine rejected command` console line (`helpers/engine-console.ts`, shared
 * with `pipeline-live-engine.spec.ts`). Those lines ride along in every
 * component round's polled value, so a rejection is reported as a rejection,
 * next to the component counts it disturbed. A payload the engine accepts but
 * then cannot build (`build_game_component` logs and skips it) never emits
 * GAME_COMPONENT_CHANGED and so shows up as a component-count mismatch.
 *
 * NOT ASSERTED: traversal, collecting, winning or losing. Those depend on
 * physical movement at an unpinned frame rate under a software rasteriser and
 * are owned by the journey issues that play these games (#10152 2D, #10163 3D)
 * after the pinned runtime lands (#10007).
 *
 * DOCUMENTED GAP: SwiftShader is software WebGL2, not WebGPU.
 */

type Store = typeof useEditorStore;

/** The fields of an exported entity this spec reads. */
interface ExportedEntity {
  entityId: string;
  entityType: string;
  name: string;
  physicsData?: unknown;
  physicsEnabled?: boolean;
  physics2dData?: unknown;
  physics2dEnabled?: boolean;
  gameComponents?: { components?: Array<Record<string, unknown> & { type: string }> } | null;
}

type ExportedInputSource = { type: string; value: string };

/** The fields of an exported scene this spec reads. */
interface ExportedScene {
  entities: ExportedEntity[];
  inputBindings?: {
    actions?: Record<
      string,
      {
        actionType?: { type?: string; positive?: ExportedInputSource[]; negative?: ExportedInputSource[] };
        sources?: ExportedInputSource[];
      }
    >;
  };
}

/**
 * One exported entity in the record's vocabulary. `'2d+3d'` is a state neither
 * game declares; it exists so an entity carrying both simulations shows up in
 * the diff instead of being folded into one of them.
 */
type EngineEntityState = Omit<ExpectedEntityState, 'physics'> & {
  physics: ExpectedEntityState['physics'] | '2d+3d';
};

/** What the engine holds, in the expected-state record's vocabulary. */
interface EngineGameState {
  entities: Record<string, EngineEntityState | { name: string; unexpected: true }>;
  inputActions: Record<string, ExpectedInputAction | 'missing' | 'unreadable'>;
  win: ReferenceGameExpectedState['win'] | string;
  lose: ReferenceGameExpectedState['lose'] | string;
}

/**
 * The first line of the pre-play gate's refusal, derived from the formatter
 * `gameSlice.play()` uses so the two cannot drift apart.
 */
const WINNABILITY_REFUSAL = formatWinnabilityMessage({ winnable: false, issues: [] }).split('\n')[0];

let exportSeq = 0;

/**
 * Ask the ENGINE to serialize the scene and return what it produced.
 *
 * `export_scene { requestId }` is answered on a later frame by SCENE_EXPORTED,
 * which `transformEvents` re-broadcasts as the `forge:scene-exported` DOM event
 * carrying the same `requestId`. The dispatch goes through `__FORGE_DISPATCH`,
 * i.e. the production dispatcher, and its return value is checked: `undefined`
 * means the E2E hook is absent and `false` means there is no live engine, and
 * both should read as that cause rather than as a timeout.
 */
async function exportEngineScene(page: Page): Promise<ExportedScene> {
  exportSeq += 1;
  const requestId = `ref-game-${exportSeq}`;
  const json = await page.evaluate(
    ({ requestId, eventName, timeoutMs }) =>
      new Promise<string>((resolve, reject) => {
        const onExported = (event: Event) => {
          const detail = (event as CustomEvent<{ json: string; requestId?: string }>).detail;
          if (detail?.requestId !== requestId) return;
          window.clearTimeout(timer);
          window.removeEventListener(eventName, onExported);
          resolve(detail.json);
        };
        const timer = window.setTimeout(() => {
          window.removeEventListener(eventName, onExported);
          reject(new Error(`the engine did not answer export_scene ${requestId} within ${timeoutMs}ms`));
        }, timeoutMs);
        window.addEventListener(eventName, onExported);
        const sent = window.__FORGE_DISPATCH?.('export_scene', { requestId });
        if (sent !== true) {
          window.clearTimeout(timer);
          window.removeEventListener(eventName, onExported);
          reject(
            new Error(
              sent === undefined
                ? '__FORGE_DISPATCH is absent (E2E hooks are off in this build)'
                : '__FORGE_DISPATCH had no live engine dispatcher',
            ),
          );
        }
      }),
    { requestId, eventName: SCENE_EXPORTED_EVENT, timeoutMs: E2E_TIMEOUT_SHORT_MS },
  );
  return JSON.parse(json) as ExportedScene;
}

/** The engine's scene graph as `{ id: { name, components } }`. */
function readSceneGraph(page: Page): Promise<Record<string, { name: string; components: string[] }>> {
  return page.evaluate(() => {
    const nodes = (window.__EDITOR_STORE as Store).getState().sceneGraph.nodes;
    return Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [id, { name: node.name, components: [...node.components] }]),
    );
  });
}

function sources(list: ExportedInputSource[] | undefined): string[] {
  return (list ?? []).map((source) => source.value);
}

/** One exported input action in the record's vocabulary. */
function readInputAction(
  def: NonNullable<NonNullable<ExportedScene['inputBindings']>['actions']>[string] | undefined,
): ExpectedInputAction | 'missing' | 'unreadable' {
  if (!def) return 'missing';
  if (def.actionType?.type === 'Axis') {
    return { type: 'axis', positive: sources(def.actionType.positive), negative: sources(def.actionType.negative) };
  }
  if (def.actionType?.type === 'Digital') return { type: 'digital', sources: sources(def.sources) };
  return 'unreadable';
}

/**
 * Translate the engine's export into the expected-state record's vocabulary,
 * keyed by FIXTURE entity id via the spawn map. An exported entity the game
 * did not spawn is kept, under `unexpected:<name>`, so an extra entity shows up
 * in the diff instead of being dropped by the translation.
 */
function engineGameState(
  scene: ExportedScene,
  fixtureIdOf: Map<string, string>,
  expected: ReferenceGameExpectedState,
): EngineGameState {
  const entities: EngineGameState['entities'] = {};
  const componentsOf = (e: ExportedEntity) => e.gameComponents?.components ?? [];
  const idOf = (runtimeId: string) => fixtureIdOf.get(runtimeId) ?? `unexpected:${runtimeId}`;

  for (const entity of scene.entities) {
    const fixtureId = fixtureIdOf.get(entity.entityId);
    if (fixtureId === undefined) {
      entities[`unexpected:${entity.name}`] = { name: entity.name, unexpected: true };
      continue;
    }
    const has3d = entity.physicsEnabled === true && entity.physicsData != null;
    const has2d = entity.physics2dEnabled === true && entity.physics2dData != null;
    entities[fixtureId] = {
      name: entity.name,
      entityType: entity.entityType as ExpectedEntityState['entityType'],
      physics: has3d && has2d ? '2d+3d' : has3d ? '3d' : has2d ? '2d' : null,
      gameComponents: componentsOf(entity)
        .map((c) => c.type as ExpectedEntityState['gameComponents'][number])
        .sort(),
    };
  }

  const inputActions: EngineGameState['inputActions'] = {};
  for (const name of Object.keys(expected.inputActions)) {
    inputActions[name] = readInputAction(scene.inputBindings?.actions?.[name]);
  }

  const holding = (type: string) => scene.entities.filter((e) => componentsOf(e).some((c) => c.type === type));
  const component = (e: ExportedEntity, type: string) => componentsOf(e).find((c) => c.type === type) ?? {};
  const sortedIds = (list: ExportedEntity[]) => list.map((e) => idOf(e.entityId)).sort();

  const winners = holding('winCondition');
  const players = holding('characterController');
  let win: EngineGameState['win'];
  if (winners.length !== 1 || players.length !== 1) {
    win = `engine holds ${winners.length} win condition(s) and ${players.length} character controller(s)`;
  } else {
    const data = component(winners[0], 'winCondition');
    const target = typeof data.targetEntityId === 'string' ? idOf(data.targetEntityId) : null;
    win = {
      entityId: idOf(winners[0].entityId),
      conditionType: data.conditionType as ReferenceGameExpectedState['win']['conditionType'],
      targetEntityId: target,
      playerEntityId: idOf(players[0].entityId),
      collectibleEntityIds: sortedIds(holding('collectible')),
    };
  }

  const zones = holding('damageZone');
  const oneShots = [...new Set(zones.map((z) => component(z, 'damageZone').oneShot))];
  let lose: EngineGameState['lose'];
  if (players.length !== 1 || oneShots.length !== 1) {
    lose = `engine holds ${players.length} player(s) and damage zones with oneShot values ${JSON.stringify(oneShots)}`;
  } else {
    const health = component(players[0], 'health');
    lose = {
      playerEntityId: idOf(players[0].entityId),
      maxHp: health.maxHp as number,
      respawnOnDeath: health.respawnOnDeath as boolean,
      despawnOnDeath: health.despawnOnDeath as boolean,
      respawnPoint: health.respawnPoint as [number, number, number],
      damageZoneEntityIds: sortedIds(zones),
      oneShot: oneShots[0] as boolean,
    };
  }

  return { entities, inputActions, win, lose };
}

/** The record with its id lists sorted the way `engineGameState` sorts them. */
function expectedGameState(expected: ReferenceGameExpectedState): EngineGameState {
  return {
    entities: expected.entities,
    inputActions: expected.inputActions,
    win: { ...expected.win, collectibleEntityIds: [...expected.win.collectibleEntityIds].sort() },
    lose: { ...expected.lose, damageZoneEntityIds: [...expected.lose.damageZoneEntityIds].sort() },
  };
}

/**
 * Empty the scene through the engine and return the ids of what survives.
 *
 * `new_scene` despawns every entity except the undeletable editor camera, and
 * the export skips that camera (`snapshot_scene` records only entities with an
 * `EntityType`). So an export with ZERO entities is the engine itself saying
 * the scene is empty, and the scene-graph nodes left at that point are the
 * engine-internal ones — none of which may carry a mesh, light, physics or
 * game component, which is what separates them from a game's entities.
 */
async function startFromEmptyScene(page: Page): Promise<string[]> {
  const accepted = await page.evaluate(() => (window.__EDITOR_STORE as Store).getState().newScene());
  expect(accepted, 'newScene() refused: no engine dispatcher, or the engine rejected new_scene').toBe(true);

  await expect
    .poll(async () => (await exportEngineScene(page)).entities.map((e) => e.name), {
      timeout: E2E_TIMEOUT_INTERACTION_MS,
      message: 'the engine still exports entities after new_scene',
    })
    .toEqual([]);
  await expect
    .poll(
      async () =>
        Object.values(await readSceneGraph(page))
          .filter((node) => node.components.length > 0)
          .map((node) => node.name),
      { timeout: E2E_TIMEOUT_INTERACTION_MS, message: 'the scene graph still shows scene content after new_scene' },
    )
    .toEqual([]);

  const survivors = await readSceneGraph(page);
  expect(
    Object.keys(survivors).length,
    'the engine reported no scene graph at all, so "exactly the game\'s entities" cannot be judged',
  ).toBeGreaterThan(0);
  return Object.keys(survivors).sort();
}

/**
 * Spawn every entity through `spawnEntity` and return fixture id -> engine id.
 * `spawnEntity` mints the id client-side and hands it to the engine, which
 * adopts it, so the map is known synchronously; whether the engine actually
 * spawned each one is established separately, from the scene graph.
 */
async function spawnGame(page: Page, game: ReferenceGame): Promise<Record<string, string>> {
  return page.evaluate(
    ({ projectType, entities }) => {
      const state = (window.__EDITOR_STORE as Store).getState();
      state.setProjectType(projectType);
      const ids: Record<string, string> = {};
      for (const entity of entities) {
        const id = state.spawnEntity(entity.entityType, entity.name, entity.position);
        if (!id) throw new Error(`spawnEntity refused ${entity.entityType} "${entity.name}"`);
        ids[entity.id] = id;
      }
      return ids;
    },
    {
      projectType: game.projectType,
      entities: game.entities.map(({ id, name, entityType, position }) => ({ id, name, entityType, position })),
    },
  );
}

/**
 * Scale, physics and input bindings. Run only after every spawn is confirmed:
 * the engine's apply systems look an entity up by id and silently skip a
 * request for one that does not exist yet, so configuring in the same frame as
 * the spawn would race it.
 */
async function configureGame(page: Page, game: ReferenceGame, ids: Record<string, string>): Promise<void> {
  const plan = game.entities.map((entity) => ({ id: ids[entity.id], scale: entity.scale, physics: entity.physics }));
  await page.evaluate(
    ({ plan, bindings }) => {
      const state = (window.__EDITOR_STORE as Store).getState();
      for (const entity of plan) {
        state.updateTransform(entity.id, 'scale', entity.scale);
        if (entity.physics?.dimension === '2d') {
          state.setPhysics2d(entity.id, entity.physics.data, true);
        } else if (entity.physics?.dimension === '3d') {
          // Toggle first, then the data: the engine chains the pair in that
          // order, and the chat compound handlers call them the same way.
          state.togglePhysics(entity.id, true);
          state.updatePhysics(entity.id, entity.physics.data);
        }
      }
      for (const binding of bindings) state.setInputBinding(binding);
    },
    { plan, bindings: game.inputBindings },
  );
}

/**
 * Add the game components in ROUNDS: round `r` adds each entity's `r`-th
 * component, then waits for the engine's export to show it before the next
 * round starts — one component per entity per frame, the way the inspector's
 * Add button delivers them.
 *
 * Measured, not assumed: adding an entity's two components in the same frame
 * leaves the engine holding only the second (#10193). `apply_game_component_adds`
 * inserts a new `GameComponents` through deferred `Commands` for an entity that
 * has none, so the second request in that frame still sees none and its insert
 * replaces the first. Until that is fixed this spec must not batch, or it would
 * fail on the engine bug instead of proving the games load; the wait between
 * rounds is also what reports a dropped component as a count mismatch.
 *
 * Each round's polled value carries the engine-rejection lines collected so
 * far, beside the counts. Console events reach the test asynchronously, so a
 * one-shot check straight after a dispatch could run before the line arrives;
 * inside the poll it cannot be missed, and a rejected payload (from this round
 * or from `configureGame`) fails with its `Engine rejected command` line in the
 * diff rather than as a bare count mismatch.
 */
async function addGameComponentsInRounds(
  page: Page,
  game: ReferenceGame,
  ids: Record<string, string>,
  fixtureIdOf: Map<string, string>,
  engineConsole: EngineConsole,
): Promise<void> {
  const rounds = Math.max(0, ...game.entities.map((e) => e.gameComponents.length));
  for (let round = 0; round < rounds; round++) {
    const adds = game.entities
      .filter((entity) => entity.gameComponents.length > round)
      .map((entity) => ({
        id: ids[entity.id],
        component: resolveEntityRefs(entity.gameComponents[round], (fixtureId) => ids[fixtureId]),
      }));
    await page.evaluate((batch) => {
      const state = (window.__EDITOR_STORE as Store).getState();
      for (const { id, component } of batch) state.addGameComponent(id, component);
    }, adds);

    const expectedCounts = Object.fromEntries(
      game.entities.map((e) => [e.id, Math.min(round + 1, e.gameComponents.length)]),
    );
    await expect
      .poll(
        async () => ({
          engineRejections: engineConsole.rejections(),
          gameComponentCounts: Object.fromEntries(
            (await exportEngineScene(page)).entities.map((e) => [
              fixtureIdOf.get(e.entityId) ?? `unexpected:${e.name}`,
              e.gameComponents?.components?.length ?? 0,
            ]),
          ),
        }),
        {
          timeout: E2E_TIMEOUT_INTERACTION_MS,
          message: `the engine does not hold the game components added in round ${round + 1} of ${rounds}`,
        },
      )
      .toEqual({ engineRejections: [], gameComponentCounts: expectedCounts });
  }
}

test.describe('Reference games through the live engine @engine @engine-smoke', () => {
  let engineConsole: EngineConsole;

  test.beforeEach(async ({ page, editor }) => {
    // Before the first navigation, so engine boot is covered too.
    engineConsole = collectEngineConsole(page);
    await editor.load();
  });

  for (const { game, expected } of REFERENCE_GAMES) {
    test(`${game.fixtureId}@${game.version}: the engine holds exactly its entities and components, and Play enters play mode`, async ({
      page,
    }, testInfo) => {
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

      // --- An engine-confirmed empty scene --------------------------------
      const survivors = await startFromEmptyScene(page);

      // --- Spawn, and wait for the ENGINE to report every entity ----------
      const ids = await spawnGame(page, game);
      const spawnedIds = Object.values(ids).sort();
      await expect
        .poll(
          async () => Object.keys(await readSceneGraph(page)).filter((id) => !survivors.includes(id)).sort(),
          { timeout: E2E_TIMEOUT_INTERACTION_MS, message: 'the engine did not report every spawned entity' },
        )
        .toEqual(spawnedIds);

      // --- Configure through the same store actions the editor uses -------
      const fixtureIdOf = new Map(Object.entries(ids).map(([fixtureId, runtimeId]) => [runtimeId, fixtureId]));
      await configureGame(page, game, ids);
      // Every round's poll also carries the rejection lines, so a payload the
      // engine refused here or there fails AS a rejection.
      await addGameComponentsInRounds(page, game, ids, fixtureIdOf, engineConsole);

      // --- The engine's own serialization matches the record --------------
      let lastExport: ExportedScene | null = null;
      await expect
        .poll(
          async () => {
            try {
              lastExport = await exportEngineScene(page);
              return engineGameState(lastExport, fixtureIdOf, expected);
            } catch (error) {
              return { exportFailed: (error as Error).message };
            }
          },
          {
            timeout: E2E_TIMEOUT_INTERACTION_MS,
            message: `the engine's export of ${game.fixtureId}@${game.version} does not match its expected-state record`,
          },
        )
        .toEqual(expectedGameState(expected))
        .catch(async (error: unknown) => {
          await testInfo.attach('engine-export.json', {
            body: JSON.stringify(lastExport, null, 2),
            contentType: 'application/json',
          });
          throw error;
        });

      // --- The scene graph holds exactly these entities --------------------
      const graph = await readSceneGraph(page);
      expect(Object.keys(graph).filter((id) => survivors.includes(id)).sort(), 'engine-internal nodes changed').toEqual(
        survivors,
      );
      const gameNodes = Object.fromEntries(
        Object.entries(graph)
          .filter(([id]) => !survivors.includes(id))
          .map(([id, node]) => [
            fixtureIdOf.get(id) ?? `unexpected:${node.name}`,
            { name: node.name, gameComponents: node.components.includes('GameComponents') },
          ]),
      );
      expect(gameNodes).toEqual(
        Object.fromEntries(
          Object.entries(expected.entities).map(([fixtureId, entity]) => [
            fixtureId,
            { name: entity.name, gameComponents: entity.gameComponents.length > 0 },
          ]),
        ),
      );

      // --- The real Play button enters play mode ---------------------------
      // PlayControls renders the role="status" indicator only outside edit
      // mode; filtering by role keeps AnimationInspector's "Playing" out.
      const playStatus = page.getByRole('status').filter({ hasText: 'Playing' });
      await expect(playStatus).toHaveCount(0);
      expect(
        await page.evaluate(() => (window.__EDITOR_STORE as Store).getState().engineMode),
        'the game must be built in edit mode for Play to be a transition',
      ).toBe('edit');
      const playBtn = page.locator('button[aria-label="Play"]');
      await expect(playBtn).toBeEnabled({ timeout: E2E_TIMEOUT_ELEMENT_MS });
      await playBtn.click();

      // Wait for EITHER outcome, so a gate refusal reads as the refusal text
      // rather than as a timeout on engineMode.
      const outcome = await page.waitForFunction(
        (needle) => {
          if ((window.__EDITOR_STORE as Store).getState().engineMode === 'play') return { mode: 'play' };
          const chat = window.__CHAT_STORE as
            | { getState: () => { messages: Array<{ role: string; content: string }> } }
            | undefined;
          const refusal = (chat?.getState().messages ?? []).find(
            (m) => m.role === 'system' && m.content.includes(needle),
          );
          return refusal ? { refusal: refusal.content } : null;
        },
        WINNABILITY_REFUSAL,
        { timeout: E2E_TIMEOUT_INTERACTION_MS },
      );
      expect(await outcome.jsonValue(), 'Play did not enter play mode').toEqual({ mode: 'play' });
      await expect(playStatus).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

      expectNoEngineRejections(engineConsole);
    });
  }
});
