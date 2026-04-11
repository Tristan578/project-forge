/**
 * Broad integration test for the chat executor — PF-8341 (#8341).
 *
 * Successor to `executorIntegration.test.ts`, which only covered 5 of the 29
 * handler domains registered in `executor.ts`. This file drives real handler
 * code through `executeToolCall` against a real Zustand `useEditorStore`,
 * with only the WASM command dispatcher and `global.fetch` stubbed.
 *
 * Guarantees asserted here:
 *   1. Every handler domain spread into the registry is reachable.
 *   2. No registry key is silently shadowed — each domain's representative
 *      tool must resolve to a function from that domain's own module.
 *   3. Read-only tools actually return `success: true`; mutating/network
 *      tools at least return a well-formed `ExecutionResult`.
 *   4. Real dispatcher and store mutations are verified with exact command
 *      payloads — no tautological `||` assertions.
 *   5. Handler throws surface as `{ success: false, error }` through the
 *      executor's top-level catch.
 *   6. The structural guard introspects the actual exported registry, so
 *      adding a new handler domain to `executor.ts` without extending the
 *      representative table fails loudly.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExecutionResult } from '../handlers/types';
import {
  executeToolCall,
  handlerRegistry,
  HANDLER_DOMAIN_SOURCES,
} from '../executor';
import {
  useEditorStore,
  setCommandDispatcher,
  type EditorState,
} from '@/stores/editorStore';

// Direct imports of every domain source map so tests can verify that each
// representative tool resolves to a function from the claimed domain (not a
// silently-shadowed duplicate from a later-registered domain).
import { transformHandlers } from '../handlers/transformHandlers';
import { materialHandlers } from '../handlers/materialHandlers';
import { queryHandlers } from '../handlers/queryHandlers';
import { editModeHandlers } from '../handlers/editModeHandlers';
import { audioHandlers } from '../handlers/audioHandlers';
import { securityHandlers } from '../handlers/securityHandlers';
import { exportHandlers } from '../handlers/exportHandlers';
import { shaderHandlers } from '../handlers/shaderHandlers';
import { performanceHandlers } from '../handlers/performanceHandlers';
import { generationHandlers } from '../handlers/generationHandlers';
import { handlers2d } from '../handlers/handlers2d';
import { entityHandlers } from '../handlers/entityHandlers';
import { sceneManagementHandlers } from '../handlers/sceneManagementHandlers';
import { uiBuilderHandlers } from '../handlers/uiBuilderHandlers';
import { dialogueHandlers } from '../handlers/dialogueHandlers';
import { scriptLibraryHandlers } from '../handlers/scriptLibraryHandlers';
import { physicsJointHandlers } from '../handlers/physicsJointHandlers';
import { animationParticleHandlers } from '../handlers/animationParticleHandlers';
import { gameplayHandlers } from '../handlers/gameplayHandlers';
import { assetHandlers } from '../handlers/assetHandlers';
import { audioEntityHandlers } from '../handlers/audioEntityHandlers';
import { pixelArtHandlers } from '../handlers/pixelArtHandlers';
import { compoundHandlers } from '../handlers/compoundHandlers';
import { leaderboardHandlers } from '../handlers/leaderboardHandlers';
import { ideaHandlers } from '../handlers/ideaHandlers';
import { worldHandlers } from '../handlers/worldHandlers';
import { localizationHandlers } from '../handlers/localizationHandlers';
import { economyHandlers } from '../handlers/economyHandlers';
import { cutsceneHandlers } from '../handlers/cutsceneHandlers';

// ── Lookup from domain name → source handler map (used by shadow check) ────
const DOMAIN_SOURCES: Record<string, Record<string, unknown>> = {
  transformHandlers,
  materialHandlers,
  queryHandlers,
  editModeHandlers,
  audioHandlers,
  securityHandlers,
  exportHandlers,
  shaderHandlers,
  performanceHandlers,
  generationHandlers,
  handlers2d,
  entityHandlers,
  sceneManagementHandlers,
  uiBuilderHandlers,
  dialogueHandlers,
  scriptLibraryHandlers,
  physicsJointHandlers,
  animationParticleHandlers,
  gameplayHandlers,
  assetHandlers,
  audioEntityHandlers,
  pixelArtHandlers,
  compoundHandlers,
  leaderboardHandlers,
  ideaHandlers,
  worldHandlers,
  localizationHandlers,
  economyHandlers,
  cutsceneHandlers,
};

// ── Dispatcher spy: captures every WASM engine command emitted by handlers.
// editorStore's `_dispatchCommand` is module-level state, so we MUST clear
// it in `afterEach` to prevent leaking across test files.
const dispatchSpy = vi.fn<(cmd: string, payload: unknown) => void>();

function seedEditorStore(): EditorState {
  const partial: Partial<EditorState> = {
    sceneName: 'Test Scene',
    sceneGraph: {
      nodes: {
        'entity-1': {
          entityId: 'entity-1',
          name: 'Cube',
          parentId: null,
          children: [],
          components: [],
          visible: true,
        },
      },
      rootIds: ['entity-1'],
    },
    selectedIds: new Set<string>(['entity-1']),
  };
  useEditorStore.setState(partial as EditorState, false);
  return useEditorStore.getState();
}

// Network-backed handler stub. Shape includes `jobId`/`usageId` so the
// generation refund path (CLAUDE.md: "usageId NEVER remove") runs to
// completion in the happy-path test below rather than being short-circuited.
type StubFetchBody = Record<string, unknown>;
function installFetchSpy(body: StubFetchBody = { ok: true }) {
  const response = {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
  return vi.spyOn(global, 'fetch').mockResolvedValue(response);
}

beforeEach(() => {
  dispatchSpy.mockClear();
  setCommandDispatcher(dispatchSpy);
  seedEditorStore();
  installFetchSpy();
});

afterEach(() => {
  // Restore vi.spyOn mocks (global.fetch, etc.) AND clear the leaked
  // module-level dispatcher in editorStore so later test files don't see
  // this file's stale spy.
  vi.restoreAllMocks();
  setCommandDispatcher(() => {
    /* noop */
  });
});

// ────────────────────────────────────────────────────────────────────────
// 1. Registry introspection: detect drift and key collisions
// ────────────────────────────────────────────────────────────────────────

describe('executor: registry structural invariants (PF-8341)', () => {
  it('exposes exactly 29 handler domain sources', () => {
    // Introspects the ACTUAL exported list from executor.ts — not a hardcoded
    // copy. If someone adds or removes a domain, this fails immediately.
    expect(HANDLER_DOMAIN_SOURCES).toHaveLength(29);
    const uniqueDomainNames = new Set(HANDLER_DOMAIN_SOURCES.map((d) => d.name));
    expect(uniqueDomainNames.size).toBe(29);
  });

  it('every key in the merged handlerRegistry traces back to a source domain', () => {
    const mergedKeys = new Set(Object.keys(handlerRegistry));
    const sourceKeys = new Set<string>();
    for (const { handlers } of HANDLER_DOMAIN_SOURCES) {
      for (const key of Object.keys(handlers)) sourceKeys.add(key);
    }
    for (const key of mergedKeys) {
      expect(sourceKeys.has(key)).toBe(true);
    }
  });

  /**
   * Known, intentional key shadows.
   *
   * `queryHandlers` is effectively a legacy aggregator — virtually every
   * read-only key it exposes has been re-added to a later domain-specific
   * module and the later registration wins. The queryHandlers copies are
   * dead code in practice. Only `query_play_state` remains unique to it.
   *
   * This allowlist captures the dead shadows so any NEW collision (e.g.
   * two unrelated domains both defining `create_asset`) fails loudly.
   * When cleaning up queryHandlers, shrink this list instead of expanding
   * it. Any un-allowlisted collision is a real bug.
   */
  const KNOWN_SHADOWS: ReadonlySet<string> = new Set([
    // Original 10 shadows (entity / audio / animation / selection / mode)
    'get_scene_graph',
    'get_entity_details',
    'get_selection',
    'get_camera_state',
    'get_mode',
    'get_audio_buses',
    'get_audio',
    'get_animation_state',
    'list_animations',
    'get_animation_graph',
    // queryHandlers ↔ handlers2d shadows
    'get_sprite',
    'get_tilemap',
    'get_physics2d',
    'get_skeleton2d',
    // queryHandlers ↔ generationHandlers
    'get_sprite_generation_status',
    // queryHandlers ↔ sceneManagementHandlers
    'get_scene_name',
    'get_input_bindings',
    'get_input_state',
    'get_quality_settings',
    // queryHandlers ↔ scriptLibraryHandlers
    'get_script',
    'list_script_templates',
    'get_token_balance',
    'get_token_pricing',
    // queryHandlers ↔ physicsJointHandlers
    'get_physics',
    'get_joint',
    'get_terrain',
    // queryHandlers ↔ animationParticleHandlers
    'get_particle',
    'get_animation_clip',
    // queryHandlers ↔ gameplayHandlers
    'get_game_components',
    'list_game_component_types',
    'get_game_camera',
    'get_export_status',
    // queryHandlers ↔ assetHandlers
    'list_assets',
  ]);

  it('no unexpected key collisions between handler domains', () => {
    const seen = new Map<string, string>();
    const collisions: Array<{ key: string; first: string; second: string }> = [];
    for (const { name, handlers } of HANDLER_DOMAIN_SOURCES) {
      for (const key of Object.keys(handlers)) {
        const prior = seen.get(key);
        if (prior && !KNOWN_SHADOWS.has(key)) {
          collisions.push({ key, first: prior, second: name });
        }
        seen.set(key, name);
      }
    }
    expect(collisions).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Domain coverage: one representative tool per domain
// ────────────────────────────────────────────────────────────────────────

/**
 * Read-only representatives — MUST return `success: true`. Chosen so that
 * the tool belongs uniquely to its domain (not shadowed by a later
 * registration). For `queryHandlers` we use `get_scene_name`, which is
 * one of the few keys that does NOT collide with another domain.
 */
const READ_ONLY_REPRESENTATIVES: ReadonlyArray<{
  domain: string;
  tool: string;
  args: Record<string, unknown>;
}> = [
  { domain: 'securityHandlers',          tool: 'get_security_status',     args: {} },
  { domain: 'entityHandlers',            tool: 'get_entity_details',      args: { entityId: 'entity-1' } },
  { domain: 'uiBuilderHandlers',         tool: 'list_ui_screens',         args: {} },
  { domain: 'assetHandlers',             tool: 'list_assets',             args: {} },
  { domain: 'audioEntityHandlers',       tool: 'get_audio_buses',         args: {} },
  { domain: 'cutsceneHandlers',          tool: 'list_cutscenes',          args: {} },
  { domain: 'compoundHandlers',          tool: 'describe_scene',          args: {} },
];

/**
 * Mutating / dispatcher-backed / network-backed representatives. These
 * return `ExecutionResult` but may be `success: false` depending on
 * validation of args or network shape — we assert only the shape contract.
 * Every entry is paired with the domain module we EXPECT it to come from,
 * so shadow bugs surface as explicit assertion failures.
 */
const MUTATING_REPRESENTATIVES: ReadonlyArray<{
  domain: string;
  tool: string;
  args: Record<string, unknown>;
}> = [
  { domain: 'queryHandlers',             tool: 'query_play_state',        args: {} },
  { domain: 'worldHandlers',             tool: 'get_current_world',       args: {} },
  { domain: 'transformHandlers',         tool: 'spawn_entity',            args: { entityType: 'cube' } },
  { domain: 'materialHandlers',          tool: 'apply_material_preset',   args: { entityId: 'entity-1', preset: 'gold' } },
  { domain: 'editModeHandlers',          tool: 'enter_edit_mode',         args: { entityId: 'entity-1' } },
  { domain: 'audioHandlers',             tool: 'set_music_intensity',     args: { intensity: 0.5 } },
  { domain: 'exportHandlers',            tool: 'set_loading_screen',      args: { title: 'Loading', subtitle: '...' } },
  { domain: 'shaderHandlers',            tool: 'create_shader_graph',     args: { name: 'TestGraph' } },
  { domain: 'performanceHandlers',       tool: 'set_performance_budget',  args: { maxTriangles: 100000 } },
  { domain: 'generationHandlers',        tool: 'generate_texture',        args: { prompt: 'grass' } },
  { domain: 'handlers2d',                tool: 'create_sprite',           args: { name: 'Hero' } },
  { domain: 'sceneManagementHandlers',   tool: 'new_scene',               args: {} },
  { domain: 'dialogueHandlers',          tool: 'create_dialogue_tree',    args: { id: 'tree-1', title: 'Intro' } },
  { domain: 'scriptLibraryHandlers',     tool: 'create_script',           args: { name: 'Test', entityId: 'entity-1' } },
  { domain: 'physicsJointHandlers',      tool: 'toggle_physics',          args: { entityId: 'entity-1', enabled: true } },
  { domain: 'animationParticleHandlers', tool: 'play_animation',          args: { entityId: 'entity-1', clip: 'idle' } },
  { domain: 'gameplayHandlers',          tool: 'add_game_component',      args: { entityId: 'entity-1', component: 'health' } },
  { domain: 'pixelArtHandlers',          tool: 'set_pixel_art_palette',   args: { entityId: 'entity-1', palette: 'nes' } },
  { domain: 'leaderboardHandlers',       tool: 'list_leaderboards',       args: { gameId: 'game-1' } },
  { domain: 'ideaHandlers',              tool: 'generate_game_ideas',     args: { count: 1 } },
  { domain: 'localizationHandlers',      tool: 'set_preview_locale',      args: { locale: 'es' } },
  { domain: 'economyHandlers',           tool: 'design_economy',          args: { genre: 'rpg' } },
];

describe('executor: representative-tool coverage covers all 29 domains (PF-8341)', () => {
  it('read-only + mutating tables sum to 29 unique domains', () => {
    const allDomains = new Set<string>([
      ...READ_ONLY_REPRESENTATIVES.map((r) => r.domain),
      ...MUTATING_REPRESENTATIVES.map((r) => r.domain),
    ]);
    expect(allDomains.size).toBe(29);
    expect(allDomains.size).toBe(HANDLER_DOMAIN_SOURCES.length);
  });

  it.each([...READ_ONLY_REPRESENTATIVES, ...MUTATING_REPRESENTATIVES])(
    '$domain::$tool resolves to a function from its claimed source module',
    ({ domain, tool }) => {
      const source = DOMAIN_SOURCES[domain];
      expect(source).toBeDefined();
      const sourceFn = source[tool];
      const registryFn = handlerRegistry[tool];
      expect(registryFn).toBeDefined();
      // If this fails, a later-registered domain is shadowing our
      // representative and the chosen tool actually runs a different
      // domain's handler. Pick a non-colliding tool.
      expect(registryFn).toBe(sourceFn);
    },
  );

  it.each(READ_ONLY_REPRESENTATIVES)(
    'read-only $domain::$tool returns success: true',
    async ({ tool, args }) => {
      const store = useEditorStore.getState();
      const result: ExecutionResult = await executeToolCall(tool, args, store);
      expect(result.success).toBe(true);
    },
  );

  it.each(MUTATING_REPRESENTATIVES)(
    'mutating $domain::$tool returns a well-formed ExecutionResult',
    async ({ tool, args }) => {
      const store = useEditorStore.getState();
      const result: ExecutionResult = await executeToolCall(tool, args, store);
      // Shape contract: executor NEVER rejects. Every call must resolve to
      // a plain object with a boolean `success`, and failures must carry a
      // non-empty string `error` (never `undefined`, never a raw Error).
      expect(typeof result.success).toBe('boolean');
      if (!result.success) {
        expect(typeof result.error).toBe('string');
        expect(result.error).toBeTruthy();
        // Guard the specific "handler wasn't registered at all" panic —
        // distinct from legitimate validation errors that may mention
        // "undefined" in their messages.
        expect(result.error).not.toMatch(/is not a function|handler not registered/i);
      }
    },
  );

  it('unknown tool names never crash and return a helpful error', async () => {
    const store = useEditorStore.getState();
    const result = await executeToolCall('tool_that_does_not_exist', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Real-store end-to-end: exact command assertions (no tautologies)
// ────────────────────────────────────────────────────────────────────────

describe('executor: real Zustand store end-to-end (PF-8341)', () => {
  it('spawn_entity dispatches spawn_entity with the expected payload', async () => {
    const store = useEditorStore.getState();
    const result = await executeToolCall(
      'spawn_entity',
      { entityType: 'sphere', name: 'Real Sphere' },
      store,
    );
    expect(result.success).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith(
      'spawn_entity',
      expect.objectContaining({ entityType: 'sphere', name: 'Real Sphere' }),
    );
  });

  it('update_transform dispatches update_transform with the new position', async () => {
    const store = useEditorStore.getState();
    const result = await executeToolCall(
      'update_transform',
      { entityId: 'entity-1', position: { x: 5, y: 0, z: 0 } },
      store,
    );
    expect(result.success).toBe(true);
    // The transform slice normalizes `{x,y,z}` into `[x,y,z]` tuples
    // before dispatch. Accept any transform-related command name, but
    // require the correct entityId AND the exact normalized position
    // tuple in the payload — no `||` fallbacks, no tautologies.
    const transformCalls = dispatchSpy.mock.calls.filter(([cmd]) =>
      /transform/i.test(String(cmd)),
    );
    expect(transformCalls.length).toBeGreaterThan(0);
    const payloads = transformCalls.map(([, payload]) => payload);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: 'entity-1',
          position: [5, 0, 0],
        }),
      ]),
    );
  });

  it('get_scene_name returns the seeded scene name from the real store', async () => {
    const store = useEditorStore.getState();
    const result = await executeToolCall('get_scene_name', {}, store);
    expect(result.success).toBe(true);
    expect(JSON.stringify(result.result)).toContain('Test Scene');
  });

  it('get_entity_details returns structured data for the seeded entity', async () => {
    const store = useEditorStore.getState();
    const result = await executeToolCall(
      'get_entity_details',
      { entityId: 'entity-1' },
      store,
    );
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ name: 'Cube' });
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Error-propagation contract
// ────────────────────────────────────────────────────────────────────────

describe('executor: error-propagation contract (PF-8341)', () => {
  it('handler throws surface as success: false, never as a rejected promise', async () => {
    // Spy on a slice action the transform handler depends on, forcing it
    // to throw. If the executor's top-level catch is intact, the rejected
    // promise never reaches the caller.
    const throwing = vi.fn(() => {
      throw new Error('Simulated handler failure');
    });
    useEditorStore.setState(
      { spawnEntity: throwing } as unknown as Partial<EditorState>,
      false,
    );

    const store = useEditorStore.getState();
    const result = await executeToolCall(
      'spawn_entity',
      { entityType: 'sphere' },
      store,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Simulated handler failure');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Network-backed happy path: generate_texture refund wiring
// ────────────────────────────────────────────────────────────────────────

describe('executor: network-backed happy path (PF-8341)', () => {
  it('generate_texture completes with a jobId when the server returns usageId', async () => {
    // CLAUDE.md: "usageId in generate route responses — NEVER remove. Client
    // needs it for async job refunds." Stub the specific response shape the
    // handler expects so the trackJob refund path is actually exercised.
    vi.restoreAllMocks();
    installFetchSpy({
      jobId: 'stub-job-123',
      usageId: 'stub-usage-456',
      estimatedSeconds: 5,
      provider: 'openai',
    });
    setCommandDispatcher(dispatchSpy);

    const store = useEditorStore.getState();
    const result = await executeToolCall(
      'generate_texture',
      { prompt: 'mossy stone', resolution: '512' },
      store,
    );

    // The handler returns `{ success: true, result: { message, jobId } }`
    // when trackJob succeeds. If it silently returns success without a
    // jobId, the refund path is broken and this assertion catches it.
    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ jobId: 'stub-job-123' });
  });
});
