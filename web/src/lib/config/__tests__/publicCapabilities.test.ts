/**
 * Pins the public copy to the capability flags (lessons-learned #1, #11, #18).
 *
 * Production cannot deliver platform-funded generation (#9117) or hosted MCP
 * access (#9722), yet the pricing cards, llms.txt, FAQ and feature pages sold
 * both. Three things are pinned here:
 *
 * 1. The tier bullets under each flag state, derived from the real builder.
 * 2. The flags agree with the real production gates (`mcpBridgeEnabled()`).
 * 3. No public surface carries a previously-unbacked phrase unless the matching
 *    flag is on. The surface list is read from disk, comments are stripped, and
 *    the scan fails when it inspects nothing or when its own phrase list stops
 *    matching a fixture (a scan of zero items passes vacuously).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PLATFORM_GENERATION_KEYS_PROVISIONED,
  currentPublicCapabilities,
  hostedMcpEnabled,
} from '../publicCapabilities';
import {
  buildTierCapabilities,
  COMING_AFTER_LAUNCH,
  isExclusionFeature,
  TIER_PLANS,
  TIER_KEYS,
  PAID_TIER_PLANS,
} from '@/lib/billing/tierPlans';
import { mcpBridgeEnabled } from '@/lib/mcp/bridgeOptIn';

const OFF = { platformGenerationKeys: false, hostedMcp: false };
const ON = { platformGenerationKeys: true, hostedMcp: true };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tier capability bullets follow the flags', () => {
  it('with both flags off, no bullet promises platform keys, hosted MCP or platform asset generation', () => {
    const caps = buildTierCapabilities(OFF);
    expect(caps.hobbyist).toEqual(['AI chat', '3D, texture and audio generation with your own API keys (BYOK)']);
    expect(caps.creator[0]).toBe(`MCP access for external AI tools ${COMING_AFTER_LAUNCH}`);
    expect(caps.pro[0]).toBe(`Platform AI keys, no balance required ${COMING_AFTER_LAUNCH}`);
    for (const key of TIER_KEYS) {
      for (const bullet of caps[key]) {
        expect(bullet).not.toBe('AI chat and asset generation');
        if (/platform ai keys|mcp access/i.test(bullet)) {
          expect(bullet.endsWith(COMING_AFTER_LAUNCH)).toBe(true);
        }
      }
    }
  });

  it('with both flags on, the original claims return unqualified', () => {
    const caps = buildTierCapabilities(ON);
    expect(caps.hobbyist).toContain('AI chat and asset generation');
    expect(caps.creator).toContain('MCP access for external AI tools');
    expect(caps.pro).toContain('Platform AI keys, no balance required');
    for (const key of TIER_KEYS) {
      for (const bullet of caps[key]) expect(bullet.endsWith(COMING_AFTER_LAUNCH)).toBe(false);
    }
  });

  it('each flag moves only its own bullet', () => {
    const mcpOnly = buildTierCapabilities({ ...OFF, hostedMcp: true });
    expect(mcpOnly.creator[0]).toBe('MCP access for external AI tools');
    expect(mcpOnly.pro[0].endsWith(COMING_AFTER_LAUNCH)).toBe(true);
    const keysOnly = buildTierCapabilities({ ...OFF, platformGenerationKeys: true });
    expect(keysOnly.creator[0].endsWith(COMING_AFTER_LAUNCH)).toBe(true);
    expect(keysOnly.pro[0]).toBe('Platform AI keys, no balance required');
  });

  it('renders pending bullets as exclusions so no green check sits beside them', () => {
    expect(isExclusionFeature(`Anything ${COMING_AFTER_LAUNCH}`)).toBe(true);
    expect(isExclusionFeature('Advanced AI panels')).toBe(false);
  });

  it('the shipped TIER_PLANS use this build\'s flags', () => {
    const live = buildTierCapabilities(currentPublicCapabilities());
    for (const plan of TIER_PLANS) {
      for (const bullet of live[plan.key]) expect(plan.features).toContain(bullet);
    }
  });
});

describe('the flags agree with the production gates', () => {
  it('platform generation keys are declared not provisioned (#9117) until deliberately flipped', () => {
    // Production reports "Available only with your own API key" on /api/health.
    // Flipping this constant is a decision that needs evidence; see the module.
    expect(PLATFORM_GENERATION_KEYS_PROVISIONED).toBe(false);
  });

  it('hostedMcpEnabled tracks NEXT_PUBLIC_MCP_BRIDGE exactly as the production gate does', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', '');
    expect(hostedMcpEnabled()).toBe(false);
    expect(mcpBridgeEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', 'TRUE');
    expect(hostedMcpEnabled()).toBe(false);
    expect(mcpBridgeEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', 'true');
    expect(hostedMcpEnabled()).toBe(true);
    expect(mcpBridgeEnabled()).toBe(true);
  });

  it('copy does not claim hosted MCP just because the build is not a production build', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_MCP_BRIDGE', '');
    expect(mcpBridgeEnabled()).toBe(true); // the dev bridge is on...
    expect(hostedMcpEnabled()).toBe(false); // ...but marketing copy describes production
  });

  it('reads the env var as a literal member expression (Next.js only inlines that form)', () => {
    const src = readFileSync(resolve(__dirname, '../publicCapabilities.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).toMatch(/process\.env\.NEXT_PUBLIC_MCP_BRIDGE\s*===\s*'true'/);
  });
});

// ---------------------------------------------------------------------------
// Public-surface scan
// ---------------------------------------------------------------------------

const WEB = resolve(__dirname, '../../../..');
const REPO = resolve(WEB, '..');

/** Every public file that quoted a capability production could not back. */
const SURFACES = [
  'web/src/app/faq/page.tsx',
  'web/src/app/about/page.tsx',
  'web/src/app/layout.tsx',
  'web/src/app/use-cases/[slug]/page.tsx',
  'web/src/app/compare/[competitor]/page.tsx',
  'web/src/app/blog/content/spawnforge-vs-unity-vs-godot.tsx',
  'web/src/app/blog/content/spawnforge-browser-ai-game-engine.tsx',
  'web/src/components/onboarding/WhatsNewModal.tsx',
  'web/public/llms.txt',
  'web/public/llms-full.txt',
  'apps/docs/app/page.tsx',
  'apps/docs/app/mcp/page.tsx',
] as const;

/**
 * Phrases that were promises production could not keep. A match is allowed only
 * on a line that qualifies it (own key / BYOK / local build / coming after
 * launch), or when the relevant flag is on.
 */
const UNBACKED: ReadonlyArray<{ name: string; re: RegExp; flag: 'platformGenerationKeys' | 'hostedMcp' | 'never' }> = [
  { name: 'unqualified AI asset generation', re: /AI asset generation|asset generation\b|AI-generated assets|generates? 3D models/i, flag: 'platformGenerationKeys' },
  { name: 'platform AI keys', re: /platform (AI )?keys/i, flag: 'platformGenerationKeys' },
  { name: 'MCP access / any MCP agent', re: /MCP access|any MCP|any LLM can|Control SpawnForge from AI tools/i, flag: 'hostedMcp' },
  { name: 'AI sprite / pixel art generation', re: /AI[- ]powered sprite generation|AI pixel art generation|Generate pixel art characters/i, flag: 'never' },
  { name: 'wrong prices and nonexistent plan features', re: /\$99|Hobbyist:|custom domain|team collaboration|dedicated support|priority support|remove branding|unlimited AI/i, flag: 'never' },
];

const QUALIFIER =
  /own (provider |AI |API )?(API )?keys?|your own|bring your own|BYOK|local build|local setup|coming after launch|\(bring your own key\)/i;

const stripComments = (text: string, file: string) => {
  if (file.endsWith('.txt')) return text;
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
};

/** Judge a file: returns the offending `name: line` strings for the given flags. */
function violations(file: string, text: string, flags: { platformGenerationKeys: boolean; hostedMcp: boolean }) {
  const found: string[] = [];
  // Judge each sentence-ish window: the line plus the next one, since JSX wraps.
  const lines = stripComments(text, file).split('\n');
  lines.forEach((line, i) => {
    const window = `${line} ${lines[i + 1] ?? ''} ${lines[i - 1] ?? ''}`;
    for (const rule of UNBACKED) {
      if (!rule.re.test(line)) continue;
      if (rule.flag !== 'never' && flags[rule.flag]) continue;
      if (rule.flag !== 'never' && QUALIFIER.test(window)) continue;
      found.push(`${rule.name}: ${line.trim().slice(0, 120)}`);
    }
  });
  return found;
}

describe('public surfaces carry no unbacked capability claim', () => {
  it('the scanner catches each rule on a fixture (not vacuous)', () => {
    const fixtures: Record<string, string> = {
      'unqualified AI asset generation': 'Includes AI asset generation for everyone.',
      'platform AI keys': 'Studio reaches the platform AI keys.',
      'MCP access / any MCP agent': 'Any MCP-compatible agent can control it.',
      'AI sprite / pixel art generation': 'AI pixel art generation built in.',
      'wrong prices and nonexistent plan features': 'Pro: $99/month with custom domain.',
    };
    for (const rule of UNBACKED) {
      const hits = violations('fixture.txt', fixtures[rule.name], OFF);
      expect(hits.length, rule.name).toBeGreaterThan(0);
    }
    // ...and the qualifier / flag escape hatches work, so the scan is not just always-red.
    expect(violations('f.txt', 'AI asset generation with your own API keys (BYOK)', OFF)).toEqual([]);
    expect(violations('f.txt', 'Studio reaches the platform AI keys.', ON)).toEqual([]);
  });

  it.each(SURFACES)('%s', (rel) => {
    const text = readFileSync(resolve(REPO, rel), 'utf8');
    expect(text.length, `${rel} read as empty`).toBeGreaterThan(0);
    expect(violations(rel, text, currentPublicCapabilities())).toEqual([]);
  });

  it('llms.txt and llms-full.txt quote the same prices as the plans in code', () => {
    for (const rel of ['web/public/llms.txt', 'web/public/llms-full.txt']) {
      const text = readFileSync(resolve(REPO, rel), 'utf8');
      expect(PAID_TIER_PLANS.length).toBeGreaterThan(0);
      for (const plan of TIER_PLANS) {
        expect(text, `${rel} must name ${plan.name} at ${plan.price}`).toMatch(
          new RegExp(`${plan.name}[^\\n]*\\${plan.price}/month|${plan.name}\\W+\\|\\s*\\${plan.price}/month`),
        );
      }
    }
  });
});
