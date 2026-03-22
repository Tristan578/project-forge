/**
 * run-loop.ts — The AutoForge experiment loop state manager.
 *
 * This provides the state management, git operations, convergence checks,
 * and summary generation that Claude Code uses during the nightly loop.
 *
 * Claude Code reads program.md, forms hypotheses, and uses these exports
 * to record results and check whether to continue.
 *
 * Usage: npx tsx scripts/run-loop.ts  (validates setup when run directly)
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { config } from '../autoforge.config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ExperimentRecord {
  experiment: number;
  timestamp: string;
  hypothesis: string;
  filesChanged: string[];
  heuristicScore: number;
  visionScore: number | null;
  totalScore: number;
  baselineScore: number;
  delta: number;
  kept: boolean;
  reason: string;
  commitHash: string | null;
  durationMs: number;
}

export interface LoopState {
  runId: string;
  startedAt: string;
  baselineScore: number;
  bestScore: number;
  experimentsRun: number;
  experimentsKept: number;
  experiments: ExperimentRecord[];
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------
function getStateFile(): string {
  return resolve(config.resultsDir, 'loop-state.json');
}

export function loadState(): LoopState | null {
  const file = getStateFile();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function saveState(state: LoopState): void {
  if (!existsSync(config.resultsDir)) mkdirSync(config.resultsDir, { recursive: true });
  writeFileSync(getStateFile(), JSON.stringify(state, null, 2));
}

export function initState(baselineScore: number): LoopState {
  const state: LoopState = {
    runId: `autoforge-${new Date().toISOString().slice(0, 10)}-${Date.now()}`,
    startedAt: new Date().toISOString(),
    baselineScore,
    bestScore: baselineScore,
    experimentsRun: 0,
    experimentsKept: 0,
    experiments: [],
  };
  saveState(state);
  return state;
}

// ---------------------------------------------------------------------------
// Experiment recording
// ---------------------------------------------------------------------------
export function recordExperiment(
  state: LoopState,
  record: ExperimentRecord
): void {
  state.experiments.push(record);
  state.experimentsRun++;
  if (record.kept) {
    state.experimentsKept++;
    state.bestScore = record.totalScore;
  }
  saveState(state);

  // Also append to daily JSONL log
  const logFile = resolve(
    config.resultsDir,
    `loop-${new Date().toISOString().slice(0, 10)}.jsonl`
  );
  appendFileSync(logFile, JSON.stringify(record) + '\n');
}

// ---------------------------------------------------------------------------
// Git operations (for the experiment loop)
// ---------------------------------------------------------------------------
export function getCurrentCommitHash(): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: config.projectRoot,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getChangedFiles(): string[] {
  try {
    const diff = execSync('git diff --name-only', {
      cwd: config.projectRoot,
      encoding: 'utf-8',
    }).trim();
    return diff ? diff.split('\n') : [];
  } catch {
    return [];
  }
}

export function commitExperiment(hypothesis: string, delta: number): string {
  try {
    execSync('git add -A', { cwd: config.projectRoot });
    const msg = `autoforge: ${hypothesis} (+${delta.toFixed(1)} points)`;
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
      cwd: config.projectRoot,
    });
    return getCurrentCommitHash();
  } catch {
    return 'commit-failed';
  }
}

export function discardChanges(): void {
  try {
    execSync('git checkout -- .', { cwd: config.projectRoot });
    execSync('git clean -fd', { cwd: config.projectRoot });
  } catch {
    // Best effort
  }
}

// ---------------------------------------------------------------------------
// Convergence check
// ---------------------------------------------------------------------------
export function shouldContinue(state: LoopState): {
  continue: boolean;
  reason: string;
} {
  // Check experiment limit
  if (state.experimentsRun >= config.maxExperiments) {
    return { continue: false, reason: `reached max experiments (${config.maxExperiments})` };
  }

  // Check time limit
  const elapsed =
    (Date.now() - new Date(state.startedAt).getTime()) / (1000 * 60 * 60);
  if (elapsed >= config.maxHours) {
    return { continue: false, reason: `reached max hours (${config.maxHours})` };
  }

  // Check for diminishing returns (5 consecutive failures)
  const recent = state.experiments.slice(-5);
  if (recent.length >= 5 && recent.every((e) => !e.kept)) {
    return {
      continue: false,
      reason: '5 consecutive experiments failed — diminishing returns',
    };
  }

  return { continue: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------
export function generateSummary(state: LoopState): string {
  const kept = state.experiments.filter((e) => e.kept);
  const improvement = state.bestScore - state.baselineScore;

  const lines = [
    `# AutoForge Run Summary`,
    ``,
    `**Run ID:** ${state.runId}`,
    `**Started:** ${state.startedAt}`,
    `**Experiments:** ${state.experimentsRun} total, ${state.experimentsKept} kept`,
    `**Baseline score:** ${state.baselineScore}`,
    `**Best score:** ${state.bestScore} (${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)})`,
    ``,
    `## Kept Experiments`,
    ``,
  ];

  for (const exp of kept) {
    lines.push(
      `- **#${exp.experiment}:** ${exp.hypothesis} (+${exp.delta.toFixed(1)} → ${exp.totalScore})`
    );
  }

  if (kept.length === 0) {
    lines.push('_No experiments improved on baseline._');
  }

  lines.push('', '## Discarded Experiments (last 10)', '');
  const discarded = state.experiments.filter((e) => !e.kept).slice(-10);
  for (const exp of discarded) {
    lines.push(
      `- **#${exp.experiment}:** ${exp.hypothesis} (${exp.delta.toFixed(1)}, reason: ${exp.reason})`
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validate setup (when run directly)
// ---------------------------------------------------------------------------
function validateSetup(): void {
  console.log('=== AutoForge Loop State Manager ===\n');

  console.log(`Project root: ${config.projectRoot}`);
  console.log(`Results dir:  ${config.resultsDir}`);
  console.log(`Prompts dir:  ${config.promptsDir}`);
  console.log(`Max experiments: ${config.maxExperiments}`);
  console.log(`Max hours: ${config.maxHours}`);

  // Check editable surface exists
  console.log('\nEditable surface:');
  for (const file of config.editableSurface) {
    const exists = existsSync(file);
    console.log(`  ${exists ? 'OK' : 'MISSING'}: ${file}`);
  }

  // Check API keys
  const hasGateway = !!config.aiGatewayApiKey;
  const hasAnthropic = !!config.anthropicApiKey;
  console.log(`\nVision auth: ${hasGateway ? 'AI Gateway' : hasAnthropic ? 'Anthropic SDK' : 'NOT CONFIGURED'}`);
  console.log(`Vision model: ${config.visionModel}`);

  // Check prompts
  const promptFiles = existsSync(config.promptsDir)
    ? readdirSync(config.promptsDir).filter((f: string) => f.endsWith('.json'))
    : [];
  console.log(`Benchmark prompts: ${promptFiles.length}`);

  // Check existing state
  const state = loadState();
  if (state) {
    console.log(`\nExisting loop state found:`);
    console.log(`  Run ID: ${state.runId}`);
    console.log(`  Experiments: ${state.experimentsRun} run, ${state.experimentsKept} kept`);
    console.log(`  Best score: ${state.bestScore}`);
  } else {
    console.log(`\nNo existing loop state (first run).`);
  }

  console.log('\nSetup validation complete.');
}

// If run directly, validate setup
const isDirectRun = process.argv[1]?.includes('run-loop');
if (isDirectRun) {
  validateSetup();
}
