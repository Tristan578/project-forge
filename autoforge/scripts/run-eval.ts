/**
 * run-eval.ts — Run a single evaluation pass against all benchmark prompts.
 *
 * Usage: npx tsx scripts/run-eval.ts [--vision] [--prompt <id>]
 *
 * Without --vision: heuristics only (fast, free)
 * With --vision: heuristics + vision scoring (slower, ~$0.006/scene with Gemini Flash)
 * With --prompt: run only one specific benchmark prompt
 */

import { readdirSync, readFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../autoforge.config.js';
import {
  scoreHeuristics,
  type BenchmarkPrompt,
  type SceneState,
  type EntityInfo,
} from './eval-heuristics.js';
import { scoreScene, type VisionResult } from './eval-vision.js';
import {
  initBrowser,
  executeCompoundAction,
  getSceneState,
  takeScreenshots,
  resetScene,
  closeBrowser,
} from './screenshot.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const useVision = args.includes('--vision');
const promptFilter = args.includes('--prompt')
  ? args[args.indexOf('--prompt') + 1]
  : null;

// ---------------------------------------------------------------------------
// Load benchmark prompts
// ---------------------------------------------------------------------------
function loadPrompts(): BenchmarkPrompt[] {
  const dir = config.promptsDir;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const prompts: BenchmarkPrompt[] = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
    if (promptFilter && data.id !== promptFilter) continue;
    prompts.push(data);
  }
  return prompts;
}

// ---------------------------------------------------------------------------
// Convert raw scene state to typed SceneState
// ---------------------------------------------------------------------------
function parseSceneState(raw: unknown): SceneState {
  const state = raw as Record<string, unknown>;
  const graph = state.sceneGraph as { nodes: Record<string, unknown> } | undefined;
  if (!graph?.nodes) return { entities: [] };

  const entities: EntityInfo[] = Object.values(graph.nodes).map((n) => {
    const node = n as Record<string, unknown>;
    const transform = node.transform as Record<string, unknown> | undefined;
    const translation = transform?.translation as Record<string, number> | undefined;
    return {
      id: (node.entityId as string) ?? '',
      name: (node.name as string) ?? '',
      type: (node.entityType as string) ?? 'unknown',
      visible: (node.visible as boolean) ?? true,
      parentId: (node.parentId as string) ?? null,
      childCount: ((node.children as unknown[]) ?? []).length,
      position: {
        x: translation?.x ?? 0,
        y: translation?.y ?? 0,
        z: translation?.z ?? 0,
      },
      components: (node.components as string[]) ?? [],
      hasPhysics: ((node.components as string[]) ?? []).some((c: string) =>
        c.includes('Physics')
      ),
      hasAudio: ((node.components as string[]) ?? []).some((c: string) =>
        c.includes('Audio')
      ),
      hasScript: false, // populated from allScripts
      materialName: (node.materialName as string) ?? undefined,
    };
  });

  return { entities };
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------
export interface EvalResult {
  promptId: string;
  heuristicScore: number;
  visionScore: number | null;
  totalScore: number;
  heuristicBreakdown: Record<string, { score: number; max: number; reason: string }>;
  visionBreakdown: {
    composition: number;
    lighting: number;
    material: number;
    completeness: number;
    polish: number;
    notes: string;
  } | null;
}

export async function runEvaluation(): Promise<EvalResult[]> {
  const prompts = loadPrompts();
  if (prompts.length === 0) {
    throw new Error('No benchmark prompts found in autoforge/prompts/');
  }

  console.log(
    `Running evaluation: ${prompts.length} prompts, vision: ${useVision}`
  );

  await initBrowser();
  const results: EvalResult[] = [];

  for (const prompt of prompts) {
    console.log(`\n--- Evaluating: ${prompt.id} ---`);
    console.log(`  Prompt: "${prompt.prompt}"`);

    // Reset scene
    await resetScene();

    // Execute compound action
    await executeCompoundAction('create_scene_from_description', {
      description: prompt.prompt,
    });

    // Get scene state
    const rawState = await getSceneState();
    const sceneState = parseSceneState(rawState);

    // Tier 1: Heuristics
    const heuristic = scoreHeuristics(sceneState, prompt);
    console.log(`  Heuristic: ${heuristic.score}/${heuristic.maxScore}`);
    for (const [key, val] of Object.entries(heuristic.breakdown)) {
      console.log(`    ${key}: ${val.score}/${val.max} — ${val.reason}`);
    }

    // Tier 2: Vision (if enabled)
    let vision: VisionResult | null = null;
    if (useVision) {
      const experimentId = `eval-${Date.now()}`;
      const screenshots = await takeScreenshots(experimentId, prompt.id);
      vision = await scoreScene(
        screenshots,
        prompt.prompt,
        prompt.expectedElements
      );
      console.log(`  Vision: ${vision.score}/${vision.maxScore}`);
      console.log(`    ${vision.averaged.notes}`);
    }

    const result: EvalResult = {
      promptId: prompt.id,
      heuristicScore: heuristic.score,
      visionScore: vision?.score ?? null,
      totalScore: heuristic.score + (vision?.score ?? 0),
      heuristicBreakdown: heuristic.breakdown,
      visionBreakdown: vision
        ? { ...vision.averaged }
        : null,
    };
    results.push(result);
  }

  await closeBrowser();

  // Log results
  if (!existsSync(config.resultsDir)) mkdirSync(config.resultsDir, { recursive: true });
  const logFile = resolve(
    config.resultsDir,
    `eval-${new Date().toISOString().slice(0, 10)}.jsonl`
  );
  for (const r of results) {
    appendFileSync(logFile, JSON.stringify(r) + '\n');
  }

  // Summary
  const avgTotal =
    results.reduce((s, r) => s + r.totalScore, 0) / results.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`Prompts evaluated: ${results.length}`);
  console.log(
    `Average score: ${avgTotal.toFixed(1)}/${useVision ? 110 : 60}`
  );
  console.log(`Results written to: ${logFile}`);

  return results;
}

// Run if called directly
runEvaluation().catch(console.error);
