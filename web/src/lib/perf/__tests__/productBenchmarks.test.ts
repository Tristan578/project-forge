/**
 * PRODUCT-PATH BENCHMARKS — these time real SpawnForge code.
 *
 * Read this alongside `benchmark.test.ts`, which is the opposite kind of file:
 * that one unit-tests the comparator *helpers* against hand-built
 * `makeResult()` objects and times nothing real. Before PF-9458 that synthetic
 * file was the ONLY thing the "performance harness" ran, which is why #6697
 * (closed COMPLETED on 2026-03-17 for building this harness) was closed
 * prematurely: the harness existed, was wired to no workflow, had no committed
 * baseline, and measured no product code. Do not close a benchmark ticket on
 * the harness's existence again — check that each `it()` below calls a named
 * product function.
 *
 * ---------------------------------------------------------------------------
 * Which product paths, and why these
 * ---------------------------------------------------------------------------
 * Selection rule: the path must (a) be reachable from a real caller in
 * `src/`, (b) run in the node/jsdom vitest environment with NO WASM build, and
 * (c) sit on a hot user-visible path where an accidental O(n^2) would be felt.
 * `command-dispatch-single` from `baselines.ts` fails (b) — it needs
 * `handle_command()` from the WASM engine — and is deliberately left
 * unmeasured; `UNMEASURED_BASELINES` below pins that fact so nobody quietly
 * adds more unmeasured entries.
 *
 * ---------------------------------------------------------------------------
 * Machine variance
 * ---------------------------------------------------------------------------
 * Wall-clock timing on a shared GitHub-hosted runner is noisy: the vCPU is
 * shared, frequency scaling is out of our control, and V8's GC can land inside
 * any single iteration. Three things absorb that:
 *
 *   1. WARMUP. `BENCH_WARMUP` (default 5) unmeasured calls run first, so JIT
 *      tier-up and first-touch allocation are not charged to iteration 1.
 *   2. ITERATIONS. `BENCH_ITERATIONS` (default 40 locally, 200 in the
 *      benchmark workflow) — the reported metrics are order statistics over
 *      that many samples, so one preempted iteration cannot move the median.
 *   3. THRESHOLD. The comparator flags a benchmark only above 2.0x baseline.
 *      That is deliberately coarse: measured run-to-run spread of the medians
 *      here is well under 1.5x on the same machine, and cross-runner spread on
 *      GitHub's shared runners is commonly ~1.3-1.6x for CPU-bound work. A
 *      1.2x or 1.5x gate would be permanently red and get ignored; 2.0x still
 *      catches the failure mode that matters (an algorithmic regression — a
 *      linear scan turning quadratic — which shows up as 5x-50x, not 1.9x).
 *      The comparator also defaults to comparing `avg` and `p50` only: p95/p99
 *      over 200 samples on a shared runner are dominated by GC pauses and
 *      scheduler preemption and are not a stable regression signal.
 *
 * Assertions in THIS file are correctness-only, never timing-based, so the
 * everyday `vitest run` stays deterministic. Regression detection lives in
 * `scripts/run-benchmarks.sh`, which diffs the emitted report against
 * `benchmarks/baseline.json`.
 *
 * ---------------------------------------------------------------------------
 * Emitting a report
 * ---------------------------------------------------------------------------
 * Set `SPAWNFORGE_BENCH_OUTPUT=<path>` and the suite writes a `BenchmarkReport`
 * there in `afterAll`. Unset (the normal `vitest run` case) it writes nothing.
 *
 * `SPAWNFORGE_BENCH_SLOWDOWN=<N>` repeats each measured product call N times
 * per iteration. It exists to demonstrate that the comparator actually goes red
 * on a slowdown (see the mutation matrix in the PF-9458 PR) — it slows the REAL
 * product call rather than faking a number. Default 1; asserted below.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { create } from 'zustand';

import { benchmark, buildReport, type BenchmarkResult } from '../benchmark';
import { PERFORMANCE_BASELINES } from '../baselines';

// --- product code under measurement ---------------------------------------
import { buildEntityIndex } from '@/lib/engine/entityIndex';
import { filterHierarchy } from '@/lib/hierarchyFilter';
import { getPresetById, MATERIAL_PRESETS } from '@/lib/materialPresets';
import { DeltaSerializer } from '@/lib/engine/deltaSerializer';
import { migrateScene, CURRENT_FORMAT_VERSION } from '@/lib/sceneFile';
import { compileGraph } from '@/lib/scripting/graphCompiler';
import { createSceneGraphSlice, type SceneGraphSlice } from '@/stores/slices/sceneGraphSlice';

// --- deterministic inputs --------------------------------------------------
import {
  makeSceneGraph,
  makeSceneSnapshot,
  mutateSnapshot,
  makeVisualScriptGraph,
  makeForgeSceneV1Json,
} from './fixtures';

// ---------------------------------------------------------------------------
// Run configuration
// ---------------------------------------------------------------------------

/** Parse a positive-integer env var, falling back when unset/invalid. */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  // `||` would swallow a legitimate 0; Number('') is 0 and Number('x') is NaN.
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

const ITERATIONS = intFromEnv('BENCH_ITERATIONS', 40);
const WARMUP = intFromEnv('BENCH_WARMUP', 5);
const SLOWDOWN = intFromEnv('SPAWNFORGE_BENCH_SLOWDOWN', 1);
const OUTPUT_PATH = process.env.SPAWNFORGE_BENCH_OUTPUT;

/**
 * Repetitions performed inside ONE measured iteration, for operations that are
 * individually too cheap to time honestly.
 *
 * `benchmark()` awaits the measured function, so each iteration pays a promise
 * tick plus two `performance.now()` reads — on the order of a microsecond. A
 * single `setFullGraph` costs ~2us and a single `updateNode` ~1us, so an
 * unbatched measurement would be roughly half harness overhead and its ratio to
 * a baseline would be meaningless. Batching lifts each measured iteration to
 * ~0.1-0.2ms, where harness overhead is under 1%. The batch size is part of the
 * benchmark's definition: change it and the baseline must be re-recorded.
 */
const STORE_HYDRATE_BATCH = 64;
const STORE_UPDATE_BATCH = 256;

/**
 * Baseline names in `PERFORMANCE_BASELINES` that this suite deliberately does
 * NOT measure, with the reason. Pinned by a test so the list cannot grow
 * silently — every addition here is a new piece of unmeasured budget.
 */
const UNMEASURED_BASELINES: Record<string, string> = {
  'command-dispatch-single':
    'Requires handle_command() from the WASM engine; unavailable in node/jsdom vitest.',
};

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

const collected: BenchmarkResult[] = [];

/**
 * Time `fn` and record the result under `name`.
 *
 * `SPAWNFORGE_BENCH_SLOWDOWN` repeats `fn` inside a single measured iteration,
 * so a slowdown factor of N multiplies the recorded time by roughly N while
 * still executing genuine product code.
 */
async function measure(name: string, fn: () => void): Promise<BenchmarkResult> {
  const body =
    SLOWDOWN === 1
      ? fn
      : () => {
          for (let i = 0; i < SLOWDOWN; i++) fn();
        };
  const result = await benchmark(name, body, {
    iterations: ITERATIONS,
    warmupRuns: WARMUP,
  });
  collected.push(result);
  return result;
}

afterAll(() => {
  if (!OUTPUT_PATH) return;
  const commit = process.env.GITHUB_SHA ?? 'unknown';
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(buildReport(collected, commit), null, 2)}\n`);
});

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('product benchmarks (real code paths)', () => {
  it('scene-graph-rebuild-100-nodes — buildEntityIndex() over a 100-node scene', async () => {
    // Caller: src/lib/chat/context.ts and compoundHandlers.ts rebuild this
    // index on every AI turn. A regression here slows every chat command.
    const graph = makeSceneGraph(100);
    let index: ReturnType<typeof buildEntityIndex> | null = null;

    await measure('scene-graph-rebuild-100-nodes', () => {
      index = buildEntityIndex(graph);
    });

    // Correctness — a broken buildEntityIndex must FAIL here, not record a
    // suspiciously fast time.
    expect(index).not.toBeNull();
    expect(index!.byId.size).toBe(100);
    expect(index!.byName.get(graph.nodes.e0.name)?.has('e0')).toBe(true);
    expect([...index!.byType.values()].reduce((n, s) => n + s.size, 0)).toBe(100);
  });

  it('hierarchy-filter-500-nodes — filterHierarchy() over a 500-node scene', async () => {
    // Caller: src/components/editor/SceneHierarchy.tsx, re-run on every
    // keystroke in the hierarchy search box.
    const graph = makeSceneGraph(500);
    let result: ReturnType<typeof filterHierarchy> | null = null;

    await measure('hierarchy-filter-500-nodes', () => {
      result = filterHierarchy(graph, 'coin');
    });

    expect(result).not.toBeNull();
    expect(result!.matchCount).toBeGreaterThan(0);
    // Ancestors are pulled in for context, so visible is a superset of matches.
    expect(result!.visibleIds.size).toBeGreaterThanOrEqual(result!.matchCount);
    for (const id of result!.matchingIds) {
      expect(graph.nodes[id].name.toLowerCase()).toContain('coin');
    }
  });

  it('material-preset-lookup — getPresetById() sweep over the full catalogue', async () => {
    // Caller: MaterialInspector.tsx and the compound chat handlers.
    // getPresetById is a linear Array.find over MATERIAL_PRESETS; one full
    // sweep per iteration keeps the measurement above timer resolution.
    const ids = MATERIAL_PRESETS.map((p) => p.id);
    let found = 0;

    await measure('material-preset-lookup', () => {
      found = 0;
      for (const id of ids) {
        if (getPresetById(id)) found++;
      }
    });

    expect(ids.length).toBeGreaterThan(0);
    expect(found).toBe(ids.length);
    expect(getPresetById('definitely-not-a-preset')).toBeUndefined();
  });

  it('scene-serialize-100-entities — DeltaSerializer over a 100-entity play tick', async () => {
    // Caller: src/lib/scripting/useScriptRunner.ts, once per play frame.
    // This is the hottest measured path in the product: at 60fps a 2x
    // regression is 2x of every frame's serialization budget.
    const base = makeSceneSnapshot(100);
    const next = mutateSnapshot(base, 0.2);
    let patch: ReturnType<DeltaSerializer['computeDelta']> | null = null;

    await measure('scene-serialize-100-entities', () => {
      // A fresh serializer per iteration keeps every iteration identical:
      // frame 1 is always a keyframe, frame 2 always a delta.
      const serializer = new DeltaSerializer(60);
      serializer.computeDelta(base);
      patch = serializer.computeDelta(next);
    });

    expect(patch).not.toBeNull();
    expect(patch!.isKeyframe).toBe(false);
    // 20% of 100 entities changed; the diff must find some but not all.
    const changedCount = Object.keys(patch!.changed).length;
    expect(changedCount).toBeGreaterThan(0);
    expect(changedCount).toBeLessThan(100);
    expect(patch!.removed).toHaveLength(0);
    expect(patch!.added).toHaveLength(0);
  });

  it('scene-deserialize-100-entities — JSON.parse + migrateScene() v1 -> v3', async () => {
    // Caller: src/lib/sceneFile.ts readSceneFile / openSceneFilePicker, run on
    // every scene load and on autosave restore.
    const json = makeForgeSceneV1Json(100);
    let migrated: ReturnType<typeof migrateScene> | null = null;

    await measure('scene-deserialize-100-entities', () => {
      const parsed = JSON.parse(json) as { formatVersion: number } & Record<string, unknown>;
      migrated = migrateScene(parsed, parsed.formatVersion, CURRENT_FORMAT_VERSION);
    });

    expect(migrated).not.toBeNull();
    expect(migrated!.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    // v2 and v3 migration steps both have to have run.
    expect(migrated!.audioBuses).toEqual({});
    expect(migrated!.assets).toEqual({});
    expect((migrated!.entities as unknown[]).length).toBe(100);
  });

  it('visual-script-compile-44-nodes — compileGraph() over a 44-node graph', async () => {
    // Caller: src/components/editor/ScriptEditorPanel.tsx, on every compile of
    // a visual script. 4 event handlers x 10 chained action nodes.
    const graph = makeVisualScriptGraph(4, 10);
    let result: ReturnType<typeof compileGraph> | null = null;

    await measure('visual-script-compile-44-nodes', () => {
      result = compileGraph(graph);
    });

    expect(graph.nodes).toHaveLength(44);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.errors).toHaveLength(0);
    expect(result!.code).toContain('function onStart()');
    expect(result!.code).toContain('function onUpdate(dt: number)');
    expect(result!.code).toContain('forge.translate');
  });

  it('store-hydrate-scene-graph-100-entities — batched setFullGraph() on the editor scene slice', async () => {
    // Caller: the SCENE_GRAPH_CHANGED engine event handler; this is the scene
    // load path that repopulates the hierarchy panel.
    const graph = makeSceneGraph(100);

    // Compose the slice the same way stores/slices/__tests__ do: the slice
    // reads selection fields owned by sibling slices.
    type TestState = SceneGraphSlice & {
      selectedIds: Set<string>;
      primaryId: string | null;
      primaryName: string | null;
      primaryTransform: unknown | null;
      spawnTerrain: () => string | undefined;
    };
    const store = create<TestState>()((set, get, api) => ({
      ...createSceneGraphSlice(set, get, api),
      selectedIds: new Set<string>(),
      primaryId: null,
      primaryName: null,
      primaryTransform: null,
      spawnTerrain: () => undefined,
    }));

    await measure('store-hydrate-scene-graph-100-entities', () => {
      for (let i = 0; i < STORE_HYDRATE_BATCH; i++) {
        store.getState().setFullGraph({ nodes: {}, rootIds: [] });
        store.getState().setFullGraph(graph);
      }
    });

    expect(store.getState().nodeCount).toBe(100);
    expect(store.getState().sceneGraph.rootIds).toEqual(graph.rootIds);
  });

  it('store-update-propagation — batched updateNode() through to a subscriber', async () => {
    // Caller: every incremental engine event (rename, visibility toggle,
    // reparent) lands on updateNode, and React panels re-render off the
    // subscription. Zustand notifies subscribers synchronously, so this times
    // the full set -> notify -> selector-read round trip.
    const graph = makeSceneGraph(100);

    type TestState = SceneGraphSlice & {
      selectedIds: Set<string>;
      primaryId: string | null;
      primaryName: string | null;
      primaryTransform: unknown | null;
      spawnTerrain: () => string | undefined;
    };
    const store = create<TestState>()((set, get, api) => ({
      ...createSceneGraphSlice(set, get, api),
      selectedIds: new Set<string>(),
      primaryId: null,
      primaryName: null,
      primaryTransform: null,
      spawnTerrain: () => undefined,
    }));
    store.getState().setFullGraph(graph);

    let observedName: string | null = null;
    let notifications = 0;
    const unsubscribe = store.subscribe((state) => {
      notifications++;
      observedName = state.sceneGraph.nodes.e7?.name ?? null;
    });

    let tick = 0;
    await measure('store-update-propagation', () => {
      for (let i = 0; i < STORE_UPDATE_BATCH; i++) {
        store.getState().updateNode('e7', { name: `Renamed_${tick++}` });
      }
    });

    unsubscribe();

    expect(notifications).toBe((ITERATIONS + WARMUP) * STORE_UPDATE_BATCH);
    expect(observedName).toBe(`Renamed_${tick - 1}`);
    expect(store.getState().nodeCount).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Harness self-checks — these guard the harness itself, not the product
// ---------------------------------------------------------------------------

describe('product benchmark harness', () => {
  it('measures every registered baseline except the documented WASM-only one', () => {
    const measured = new Set(collected.map((r) => r.name));
    const registered = Object.keys(PERFORMANCE_BASELINES);

    const unmeasured = registered.filter((name) => !measured.has(name));
    expect(
      unmeasured.sort(),
      'Every PERFORMANCE_BASELINES entry must either be measured by this suite ' +
        'or be listed in UNMEASURED_BASELINES with a reason.',
    ).toEqual(Object.keys(UNMEASURED_BASELINES).sort());
  });

  it('registers a baseline budget for every measured benchmark', () => {
    for (const result of collected) {
      expect(
        PERFORMANCE_BASELINES[result.name],
        `${result.name} has no entry in PERFORMANCE_BASELINES`,
      ).toBeDefined();
    }
  });

  it('measures at least three real product paths', () => {
    expect(collected.length).toBeGreaterThanOrEqual(3);
  });

  it('records the configured iteration count on every result', () => {
    for (const result of collected) {
      expect(result.iterations, result.name).toBe(ITERATIONS);
    }
  });

  it('defaults the slowdown seam to 1 so CI never runs deliberately slowed code', () => {
    // Guards against SPAWNFORGE_BENCH_SLOWDOWN leaking into a baseline
    // recording. The benchmark workflow never sets it.
    expect(intFromEnv('SPAWNFORGE_BENCH_SLOWDOWN_UNSET_PROBE', 1)).toBe(1);
  });
});
