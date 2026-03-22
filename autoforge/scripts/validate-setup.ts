/**
 * validate-setup.ts — Pre-flight check for AutoForge.
 *
 * Run this after cloning to verify everything is configured correctly.
 * Usage: cd autoforge && npx tsx scripts/validate-setup.ts
 */

import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { config } from '../autoforge.config.js';

let errors = 0;
let warnings = 0;

function check(label: string, condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FAIL ${label} — ${msg}`);
    errors++;
  }
}

function warn(label: string, condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  WARN ${label} — ${msg}`);
    warnings++;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>NUL`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

console.log('=== AutoForge Setup Validation ===\n');

// Project structure
console.log('Project Structure:');
check('Project root', existsSync(config.projectRoot), 'git repo not found');
check('autoforge/ dir', existsSync(config.autoforgeDir), 'autoforge/ not found');
check('program.md', existsSync(config.programMd), 'program.md not found');

// Editable surface
console.log('\nEditable Surface:');
for (const file of config.editableSurface) {
  const shortPath = file.replace(config.projectRoot + '/', '');
  check(shortPath, existsSync(file), 'file not found');
}

// Benchmark prompts
console.log('\nBenchmark Prompts:');
const promptCount = existsSync(config.promptsDir)
  ? readdirSync(config.promptsDir).filter((f) => f.endsWith('.json')).length
  : 0;
check(
  `${promptCount} prompts found`,
  promptCount >= 5,
  'need at least 5 benchmark prompts'
);

// Dependencies
console.log('\nDependencies:');
check('node_modules', existsSync('node_modules'), 'run: npm install');
warn('playwright browsers', (() => {
  try {
    execSync('npx playwright install --dry-run chromium 2>&1', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})(), 'run: npx playwright install chromium');

// Tools
console.log('\nTools:');
check('node', commandExists('node'), 'Node.js not installed');
check('git', commandExists('git'), 'git not installed');
warn('gh', commandExists('gh'), 'GitHub CLI not installed (needed for PR creation)');
warn('claude', commandExists('claude'), 'Claude Code CLI not installed (needed for nightly loop)');

// API keys — AI Gateway is the primary auth method, Anthropic API is fallback
console.log('\nVision Scoring Auth:');
const hasGatewayKey = !!config.aiGatewayApiKey;
const hasAnthropicKey = !!config.anthropicApiKey && config.anthropicApiKey !== 'sk-ant-your-key-here';
check(
  'Vision API key',
  hasGatewayKey || hasAnthropicKey,
  'set AI_GATEWAY_API_KEY (recommended) or ANTHROPIC_API_KEY in autoforge/.env'
);
if (hasGatewayKey) {
  console.log(`  INFO Using AI Gateway → ${config.visionModel}`);
} else if (hasAnthropicKey) {
  console.log(`  INFO Using direct Anthropic SDK → ${config.visionModel}`);
}

// Optional provider keys
console.log('\nProvider APIs (optional — for Sunday validation):');
warn('MESHY_API_KEY', !!config.meshyApiKey, 'not set — 3D model validation disabled');
warn('ELEVENLABS_API_KEY', !!config.elevenlabsApiKey, 'not set — audio validation disabled');
warn('SUNO_API_KEY', !!config.sunoApiKey, 'not set — music validation disabled');

// Sentry
console.log('\nObservability (optional):');
warn('SENTRY_DSN', !!config.sentryDsn, 'not set — error tracking disabled');

// Dev server
console.log('\nDev Server:');
const devServerUrl = config.devServerUrl;
let serverReachable = false;
try {
  execSync(`curl -s -o /dev/null -w "%{http_code}" ${devServerUrl} 2>/dev/null`, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  serverReachable = true;
} catch {
  // Not running
}
warn(
  `Dev server at ${devServerUrl}`,
  serverReachable,
  'not running — start with: cd web && npm run dev'
);

// Results directory
console.log('\nResults:');
check('results/ dir', existsSync(config.resultsDir) || true, 'will be created on first run');

// Summary
console.log(`\n=== Results: ${errors} errors, ${warnings} warnings ===`);
if (errors > 0) {
  console.log('Fix the errors above before running AutoForge.');
  process.exit(1);
} else if (warnings > 0) {
  console.log('Warnings are non-blocking but may limit functionality.');
} else {
  console.log('All checks passed. Ready to run AutoForge.');
}
