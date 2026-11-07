/**
 * Pins the public copy to the capability flags (lessons-learned #1, #11, #18).
 *
 * Production cannot deliver platform-funded generation (#9117), generation
 * through a user's own key has never been shown working in production
 * (implemented-unverified in `docs/capability-matrix.md`; decided 2026-11-05 on
 * #10457 that the copy says "coming after launch" until it has), and hosted MCP
 * access is off (#9722). Yet the pricing cards, llms.txt, FAQ and feature pages
 * sold all three. Four things are pinned here:
 *
 * 1. The tier bullets and FAQ sentences under every flag state, derived from the
 *    real builders.
 * 2. The flags agree with the real production gates (`mcpBridgeEnabled()`).
 * 3. No public surface carries a previously-unbacked phrase unless the matching
 *    flag is on. The surface list is read from disk, comments are stripped, and
 *    the scan fails when it inspects nothing or when its own phrase list stops
 *    matching a fixture (a scan of zero items passes vacuously).
 * 4. The rendered copy (tier bullets, FAQ sentences) passes the same scan in
 *    the flag state that renders it, and FAILS it when rendered for a flag that
 *    is on but scanned as if it were off, so the scan can see each claim.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BYOK_GENERATION_VERIFIED,
  PLATFORM_GENERATION_KEYS_PROVISIONED,
  currentPublicCapabilities,
  hostedMcpEnabled,
  type PublicCapabilityFlags,
} from '../publicCapabilities';
import {
  buildFaqCapabilitySentences,
  buildTierCapabilities,
  COMING_AFTER_LAUNCH,
  isExclusionFeature,
  TIER_PLANS,
  TIER_KEYS,
  PAID_TIER_PLANS,
} from '@/lib/billing/tierPlans';
import { mcpBridgeEnabled } from '@/lib/mcp/bridgeOptIn';

const OFF: PublicCapabilityFlags = { platformGenerationKeys: false, byokGeneration: false, hostedMcp: false };
const ON: PublicCapabilityFlags = { platformGenerationKeys: true, byokGeneration: true, hostedMcp: true };

/** Every combination of the three flags, so no state is left unrendered. */
const ALL_FLAG_STATES: PublicCapabilityFlags[] = [false, true].flatMap((platformGenerationKeys) =>
  [false, true].flatMap((byokGeneration) =>
    [false, true].map((hostedMcp) => ({ platformGenerationKeys, byokGeneration, hostedMcp })),
  ),
);

const BYOK_BULLET = '3D, texture and audio generation with your own API keys (BYOK)';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tier capability bullets follow the flags', () => {
  it('with every flag off, the Starter plan sells AI chat and lists asset generation as coming after launch', () => {
    const caps = buildTierCapabilities(OFF);
    expect(caps.hobbyist).toEqual(['AI chat', `AI asset generation ${COMING_AFTER_LAUNCH}`]);
    // Rendered with the X icon, like the other bullets production cannot back.
    expect(isExclusionFeature(caps.hobbyist[1])).toBe(true);
    expect(caps.creator[0]).toBe(`MCP access for external AI tools ${COMING_AFTER_LAUNCH}`);
    expect(caps.pro[0]).toBe(`Platform AI keys, no balance required ${COMING_AFTER_LAUNCH}`);
    for (const key of TIER_KEYS) {
      for (const bullet of caps[key]) {
        expect(bullet).not.toBe('AI chat and asset generation');
        expect(bullet).not.toMatch(/own (API )?keys|BYOK/i);
        if (/platform ai keys|mcp access|asset generation/i.test(bullet)) {
          expect(bullet.endsWith(COMING_AFTER_LAUNCH)).toBe(true);
        }
      }
    }
  });

  it('with BYOK generation verified but no platform keys, the Starter plan sells generation through your own key', () => {
    const caps = buildTierCapabilities({ ...OFF, byokGeneration: true });
    expect(caps.hobbyist).toEqual(['AI chat', BYOK_BULLET]);
    expect(isExclusionFeature(BYOK_BULLET)).toBe(false);
  });

  it('with platform keys but BYOK generation unverified, BYOK is the bullet marked coming after launch', () => {
    const caps = buildTierCapabilities({ ...OFF, platformGenerationKeys: true });
    expect(caps.hobbyist).toEqual(['AI chat and asset generation', `Bring your own AI keys (BYOK) ${COMING_AFTER_LAUNCH}`]);
    expect(isExclusionFeature(caps.hobbyist[1])).toBe(true);
  });

  it('with every flag on, the original claims return unqualified', () => {
    const caps = buildTierCapabilities(ON);
    expect(caps.hobbyist).toEqual(['AI chat and asset generation', 'Bring your own AI keys (BYOK)']);
    expect(caps.creator).toContain('MCP access for external AI tools');
    expect(caps.pro).toContain('Platform AI keys, no balance required');
    for (const key of TIER_KEYS) {
      for (const bullet of caps[key]) expect(bullet.endsWith(COMING_AFTER_LAUNCH)).toBe(false);
    }
  });

  it('each flag moves only its own bullets', () => {
    const base = buildTierCapabilities(OFF);
    const mcpOnly = buildTierCapabilities({ ...OFF, hostedMcp: true });
    expect(mcpOnly.creator[0]).toBe('MCP access for external AI tools');
    expect(mcpOnly.hobbyist).toEqual(base.hobbyist);
    expect(mcpOnly.pro).toEqual(base.pro);
    const keysOnly = buildTierCapabilities({ ...OFF, platformGenerationKeys: true });
    expect(keysOnly.creator).toEqual(base.creator);
    expect(keysOnly.pro[0]).toBe('Platform AI keys, no balance required');
    const byokOnly = buildTierCapabilities({ ...OFF, byokGeneration: true });
    expect(byokOnly.hobbyist).not.toEqual(base.hobbyist);
    expect(byokOnly.creator).toEqual(base.creator);
    expect(byokOnly.pro).toEqual(base.pro);
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

describe('FAQ capability sentences follow the flags', () => {
  it('with every flag off, no sentence claims generation through any key', () => {
    const faq = buildFaqCapabilitySentences(OFF);
    expect(faq.entryPlanAi).toBe('a monthly AI token allowance for AI chat (AI asset generation is coming after launch)');
    expect(faq.generation).toBe(' AI asset generation (3D models, textures and audio) is coming after launch.');
    expect(faq.topPlanAi).toMatch(/platform-managed AI keys are coming after launch\)$/);
    expect(faq.mcpAvailability).toMatch(/coming after launch\.$/);
    for (const sentence of Object.values(faq)) expect(sentence).not.toMatch(/own (provider |API )?keys?\b|bring-your-own/i);
  });

  it('with BYOK generation verified, the entry plan and generation answers name your own key', () => {
    const faq = buildFaqCapabilitySentences({ ...OFF, byokGeneration: true });
    expect(faq.entryPlanAi).toBe('a monthly AI token allowance and bring-your-own-key support');
    expect(faq.generation).toMatch(/needs your own provider API key \(Meshy or ElevenLabs\)\.$/);
  });

  it('with platform keys on, generation needs no qualifier and the top plan reaches the platform keys', () => {
    const faq = buildFaqCapabilitySentences({ ...OFF, platformGenerationKeys: true });
    expect(faq.generation).toBe('');
    expect(faq.topPlanAi).toBe('which reaches the platform AI keys without needing a token balance');
    expect(faq.entryPlanAi).toMatch(/bringing your own provider key is coming after launch\)$/);
  });

  it('with hosted MCP on, the MCP answer carries no local-build qualifier', () => {
    expect(buildFaqCapabilitySentences({ ...OFF, hostedMcp: true }).mcpAvailability).toBe('');
  });
});

describe('the flags agree with the production gates', () => {
  it('platform generation keys are declared not provisioned (#9117) until deliberately flipped', () => {
    // Production reports "Available only with your own API key" on /api/health.
    // Flipping this constant is a decision that needs evidence; see the module.
    expect(PLATFORM_GENERATION_KEYS_PROVISIONED).toBe(false);
  });

  it('BYOK generation is declared unverified until one artifact is generated through a user key in production', () => {
    // Every BYOK generation cell in docs/capability-matrix.md is
    // implemented-unverified. Flipping this constant is a decision that needs
    // that artifact as evidence; see the module.
    expect(BYOK_GENERATION_VERIFIED).toBe(false);
    expect(currentPublicCapabilities().byokGeneration).toBe(false);
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

const PENDING = /coming after launch/i;

/** A user-key claim: "your own Meshy key", "own provider API keys", "BYOK", "bring your own key". */
const BYOK_PHRASE =
  /\bown (Meshy |ElevenLabs |Meshy or ElevenLabs |provider |AI )?(API )?keys?\b|\bBYOK\b|bring[- ]your[- ]own[- ](AI |API |provider )?keys?\b/gi;

/**
 * True when every match of `re` on `line` is followed, inside the same clause,
 * by "coming after launch". The clause runs on into `next` because JSX wraps,
 * and ends at the first character in `stops`. Judged per MATCH and only on the
 * text AFTER it, so a "coming after launch" that belongs to a different claim
 * earlier on the line (or before a full stop) cannot qualify this one.
 */
function pendingInClause(re: RegExp, line: string, next: string, stops: RegExp, qualifier: RegExp = PENDING): boolean {
  const ahead = `${line} ${next}`;
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const matches = [...line.matchAll(global)];
  if (matches.length === 0) return false;
  return matches.every((m) => {
    const tail = ahead.slice((m.index ?? 0) + m[0].length);
    return qualifier.test(tail.split(stops)[0] ?? '');
  });
}

/** Sentence ends: a full stop or semicolon followed by space or end of text. */
const SENTENCE_END = /[.;](?=\s|$)/;
/**
 * A key claim's clause also ends at a comma or colon: "With your own Meshy key,
 * generate ... Platform-provided generation is coming after launch" must not be
 * read as qualifying the key.
 */
const CLAUSE_END = /[.;,:](?=\s|$)/;

type Rule = {
  name: string;
  re: RegExp;
  /** When the line is allowed to carry this phrase. */
  allowed: (flags: PublicCapabilityFlags, line: string, next: string, window: string) => boolean;
};

/**
 * Phrases that were promises production could not keep. Each rule names the
 * flag that makes it true and the only qualifier that may stand in for it.
 */
const UNBACKED: ReadonlyArray<Rule> = [
  {
    name: 'unqualified AI asset generation',
    re: /AI asset generation|asset generation\b|AI-generated assets|\bgenerat(e|es|ing|ion of) (3D models|textures)|texture\/model generation|3D\/(texture\/)?audio generation|texture and audio generation/i,
    allowed: (flags, line, next, window) =>
      flags.platformGenerationKeys ||
      pendingInClause(UNBACKED_GENERATION, line, next, SENTENCE_END) ||
      (flags.byokGeneration && new RegExp(BYOK_PHRASE.source, 'i').test(window)),
  },
  {
    name: 'generation through your own key (BYOK) claimed as working',
    re: BYOK_PHRASE,
    allowed: (flags, line, next) => flags.byokGeneration || pendingInClause(BYOK_PHRASE, line, next, CLAUSE_END),
  },
  {
    name: 'platform AI keys',
    re: /platform(-managed)? (AI )?keys/i,
    allowed: (flags, line, next) =>
      flags.platformGenerationKeys || pendingInClause(/platform(-managed)? (AI )?keys/i, line, next, SENTENCE_END),
  },
  {
    name: 'MCP access / any MCP agent',
    re: /MCP access|any MCP|any LLM can|Control SpawnForge from AI tools/i,
    allowed: (flags, line, next) =>
      flags.hostedMcp ||
      pendingInClause(/MCP access|any MCP|any LLM can|Control SpawnForge from AI tools/i, line, next, SENTENCE_END, /local build|local setup|coming after launch/i),
  },
  {
    name: 'AI sprite / pixel art generation',
    re: /AI[- ]powered sprite generation|AI pixel art generation|Generate pixel art characters/i,
    allowed: () => false,
  },
  {
    name: 'wrong prices and nonexistent plan features',
    re: /\$99|Hobbyist:|custom domain|team collaboration|dedicated support|priority support|remove branding|unlimited AI/i,
    allowed: () => false,
  },
];
// Declared after the array so the generation rule's qualifier and its trigger
// are one regex, not two copies that can drift (lessons-learned #18).
const UNBACKED_GENERATION = UNBACKED[0]!.re;

const stripComments = (text: string, file: string) => {
  if (file.endsWith('.txt')) return text;
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
};

/** Judge a file: returns the offending `name: line` strings for the given flags. */
function violations(file: string, text: string, flags: PublicCapabilityFlags) {
  const found: string[] = [];
  // Judge each sentence-ish window: the line plus its neighbours, since JSX wraps.
  const lines = stripComments(text, file).split('\n');
  lines.forEach((line, i) => {
    const next = lines[i + 1] ?? '';
    const window = `${line} ${next} ${lines[i - 1] ?? ''}`;
    for (const rule of UNBACKED) {
      if (!new RegExp(rule.re.source, 'i').test(line)) continue;
      if (rule.allowed(flags, line, next, window)) continue;
      found.push(`${rule.name}: ${line.trim().slice(0, 120)}`);
    }
  });
  return found;
}

/** The names of the rules a text trips, for asserting WHICH guard fired (lessons-learned #24). */
const rulesHit = (text: string, flags: PublicCapabilityFlags) =>
  violations('fixture.txt', text, flags).map((v) => v.slice(0, v.indexOf(':')));

const BYOK_RULE = 'generation through your own key (BYOK) claimed as working';

describe('public surfaces carry no unbacked capability claim', () => {
  it('the scanner catches each rule on a fixture (not vacuous)', () => {
    const fixtures: Record<string, string> = {
      'unqualified AI asset generation': 'Includes AI asset generation for everyone.',
      [BYOK_RULE]: 'Add your own Meshy key in Settings.',
      'platform AI keys': 'Studio reaches the platform AI keys.',
      'MCP access / any MCP agent': 'Any MCP-compatible agent can control it.',
      'AI sprite / pixel art generation': 'AI pixel art generation built in.',
      'wrong prices and nonexistent plan features': 'Pro: $99/month with custom domain.',
    };
    for (const rule of UNBACKED) {
      expect(rulesHit(fixtures[rule.name]!, OFF), rule.name).toContain(rule.name);
    }
  });

  it('each escape hatch admits only what it names', () => {
    // The flag admits the claim...
    expect(violations('f.txt', 'AI asset generation with your own API keys (BYOK)', { ...OFF, byokGeneration: true })).toEqual([]);
    expect(violations('f.txt', 'Studio reaches the platform AI keys.', ON)).toEqual([]);
    // ...and "coming after launch" in the claim's own clause admits it with the flag off.
    expect(violations('f.txt', 'AI asset generation (coming after launch)', OFF)).toEqual([]);
    expect(violations('f.txt', 'Bring your own AI keys (BYOK) (coming after launch)', OFF)).toEqual([]);
    // With BYOK unverified, the key wording is a claim, not a qualifier (decided 2026-11-05).
    expect(rulesHit('AI asset generation with your own API keys (BYOK)', OFF)).toEqual(
      expect.arrayContaining(['unqualified AI asset generation', BYOK_RULE]),
    );
    // A "coming after launch" belonging to ANOTHER clause does not qualify the key.
    expect(rulesHit('With your own Meshy key, generate models. Platform generation is coming after launch.', OFF)).toContain(BYOK_RULE);
    expect(rulesHit('Hosted access is coming after launch. With your own provider API keys, AI can generate', OFF)).toContain(BYOK_RULE);
    // Platform keys do not make a BYOK claim true.
    expect(rulesHit('Add your own Meshy key in Settings.', { ...OFF, platformGenerationKeys: true })).toContain(BYOK_RULE);
  });

  it('rejects every BYOK generation line this PR first shipped (bf1e5353), by the BYOK rule itself', () => {
    // Verbatim from the surfaces before the 2026-11-05 decision. Each must trip
    // the BYOK rule on its own, not ride on another rule's verdict.
    const shipped = [
      '- AI asset generation with your own provider API keys (BYOK): 3D models, textures, audio, music, voice. Platform-provided generation is coming after launch',
      '- Starter: $9/month — 10 cloud projects, 3 published games, 300 AI tokens/month, AI chat, 3D/texture/audio generation with your own Meshy or ElevenLabs key',
      'The platform handles everything from scene composition and physics to scripting, and one-click publishing (asset generation works with your own provider API keys) — all in the browser',
      '- AI asset generation with your own provider API keys (BYOK); platform-provided generation is coming after launch:',
      '{MCP_COMMAND_COUNT} MCP commands across {MCP_CATEGORY_COUNT} categories. With your own Meshy or ElevenLabs API key, AI can generate 3D models, textures, sound effects,',
      'everything from scene generation to asset creation (generating 3D models, textures and audio uses your own provider API keys today).',
      'commands are published for LLM control (external clients attach to a local build today; hosted access is coming after launch). With your own provider API keys, AI can generate 3D models, textures, sound',
      "{ feature: 'Asset Pipeline', spawnforge: 'AI texture/model generation (bring your own key)', competitor: 'Manual import workflow' },",
      "{ feature: 'AI Assistance', spawnforge: '25+ AI modules, 3D/audio generation (bring your own key)', competitor: 'No built-in AI' },",
      "  : ' Generating 3D models, textures and audio currently needs your own provider API key (Meshy or ElevenLabs).';",
      '"AI-assisted asset generation with your own provider API keys (3D models, textures, audio)",',
      "title: 'AI Asset Pipeline (bring your own key)',",
      "text: 'With your own Meshy or ElevenLabs API key, generate 3D models, textures, sound effects, voice lines, and music from natural language prompts. Platform-provided generation is coming after launch.',",
      "description: 'Generate 3D models, textures, audio, and music with AI using your own provider API keys',",
      'which adds a monthly AI token allowance and bring-your-own-key support.',
      BYOK_BULLET,
    ];
    for (const line of shipped) expect(rulesHit(line, OFF), line).toContain(BYOK_RULE);
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

describe('rendered copy passes the scan in the state that renders it', () => {
  /**
   * Tier bullets and FAQ sentences for a flag state, as one text with a blank
   * line between items: each bullet and sentence is rendered on its own, so a
   * qualifier on the NEXT bullet must not be read as qualifying this one.
   */
  const renderedCopy = (flags: PublicCapabilityFlags) => {
    const caps = buildTierCapabilities(flags);
    const faq = buildFaqCapabilitySentences(flags);
    const items = [...TIER_KEYS.flatMap((key) => caps[key]), ...Object.values(faq).filter(Boolean)];
    expect(items.length).toBeGreaterThan(TIER_KEYS.length); // the render was not empty
    return items.join('\n\n');
  };

  it.each(ALL_FLAG_STATES)('flags %o', (flags) => {
    expect(violations('rendered.txt', renderedCopy(flags), flags)).toEqual([]);
  });

  it('the shipped pricing bullets and FAQ answers pass under this build\'s flags', () => {
    const live = TIER_PLANS.flatMap((plan) => plan.features).join('\n');
    expect(violations('rendered.txt', live, currentPublicCapabilities())).toEqual([]);
  });

  it('copy rendered with a flag on fails the scan when that flag is off, so the scan sees each claim', () => {
    expect(rulesHit(renderedCopy({ ...OFF, byokGeneration: true }), OFF)).toContain(BYOK_RULE);
    expect(rulesHit(renderedCopy({ ...OFF, platformGenerationKeys: true }), OFF)).toEqual(
      expect.arrayContaining(['unqualified AI asset generation', 'platform AI keys']),
    );
    expect(rulesHit(renderedCopy({ ...OFF, hostedMcp: true }), OFF)).toContain('MCP access / any MCP agent');
  });
});
