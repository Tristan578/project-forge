/**
 * AutoForge Configuration
 *
 * All paths are resolved relative to PROJECT_ROOT (auto-detected from git).
 * Override any value via environment variables or .env file.
 */

import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Resolve project root
// ---------------------------------------------------------------------------
function detectProjectRoot(): string {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: walk up from this file (ESM-compatible)
    const thisDir = dirname(fileURLToPath(import.meta.url));
    return resolve(thisDir, '..');
  }
}

// ---------------------------------------------------------------------------
// Load .env if present (no external deps — simple key=value parser)
// ---------------------------------------------------------------------------
function loadDotenv(root: string): void {
  const envPath = resolve(root, 'autoforge', '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const PROJECT_ROOT = detectProjectRoot();
loadDotenv(PROJECT_ROOT);

// ---------------------------------------------------------------------------
// Exported config
// ---------------------------------------------------------------------------
export const config = {
  // Paths — all relative to PROJECT_ROOT
  projectRoot: PROJECT_ROOT,
  autoforgeDir: resolve(PROJECT_ROOT, 'autoforge'),
  resultsDir: process.env.RESULTS_DIR || resolve(PROJECT_ROOT, 'autoforge', 'results'),
  assetCacheDir: process.env.ASSET_CACHE_DIR || resolve(PROJECT_ROOT, 'autoforge', 'asset-cache'),
  promptsDir: resolve(PROJECT_ROOT, 'autoforge', 'prompts'),
  programMd: resolve(PROJECT_ROOT, 'autoforge', 'program.md'),

  // The editable surface — files the experiment loop is allowed to modify
  editableSurface: [
    'web/src/lib/chat/handlers/compoundHandlers.ts',
    'web/src/lib/chat/handlers/sceneManagementHandlers.ts',
    'web/src/lib/chat/handlers/gameplayHandlers.ts',
    'web/src/lib/chat/context.ts',
  ].map((p) => resolve(PROJECT_ROOT, p)),

  // Dev server
  devServerUrl: process.env.DEV_SERVER_URL || 'http://localhost:3000',
  devServerWait: parseInt(process.env.DEV_SERVER_WAIT || '30', 10),

  // Experiment limits
  maxExperiments: parseInt(process.env.MAX_EXPERIMENTS || '20', 10),
  maxHours: parseInt(process.env.MAX_HOURS || '6', 10),

  // --- Vercel AI Gateway ---
  aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY || '',
  aiGatewayUrl: process.env.AI_GATEWAY_URL || 'https://ai-gateway.vercel.sh',

  // --- Vision scoring ---
  // Model string uses AI Gateway format: "provider/model-name"
  // Examples: "google/gemini-3-flash", "anthropic/claude-sonnet-4.6"
  visionModel: process.env.VISION_MODEL || 'google/gemini-3-flash',
  heuristicThreshold: parseInt(process.env.HEURISTIC_THRESHOLD || '30', 10),

  // --- Direct Anthropic API (fallback if no AI Gateway key) ---
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // --- Sentry observability ---
  sentryDsn: process.env.SENTRY_DSN || '',
  sentryProject: process.env.SENTRY_PROJECT || 'spawnforge-autoforge',

  // --- Provider APIs (for Sunday weekly validation) ---
  meshyApiKey: process.env.MESHY_API_KEY || '',
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  sunoApiKey: process.env.SUNO_API_KEY || '',

  // Dev route for headless evaluation (bypasses Clerk auth)
  devRoute: '/dev',
} as const;

export type AutoForgeConfig = typeof config;
