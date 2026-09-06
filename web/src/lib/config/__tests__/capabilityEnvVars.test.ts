/**
 * CAPABILITY_ENV_VARS + isCapabilityConfigured (#9719).
 *
 * One table answers "which env vars can serve this capability?" for both
 * `/api/capabilities` and the AI Providers health probe, so the two can never
 * disagree about what "configured" means — the drift PF-1054 removed once
 * already and #9719 found creeping back as a false-green probe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CAPABILITY_ENV_VARS,
  CAPABILITY_LABELS,
  CAPABILITY_PROVIDER_OPTIONS,
  GATEWAY_CAPABILITIES,
  PROVIDER_CAPABILITIES,
  PLATFORM_KEY_ENV,
  GATEWAY_KEY_ENV,
  isCapabilityConfigured,
  listUnconfiguredCapabilities,
  type ProviderCapability,
} from '../providers';

describe('CAPABILITY_ENV_VARS', () => {
  it('has exactly one row per provider capability', () => {
    expect(Object.keys(CAPABILITY_ENV_VARS).sort()).toEqual([...PROVIDER_CAPABILITIES].sort());
  });

  it('every row names at least one env var from the shared tables', () => {
    const known = new Set<string>([
      ...Object.values(PLATFORM_KEY_ENV),
      ...Object.values(GATEWAY_KEY_ENV),
    ]);
    for (const [cap, vars] of Object.entries(CAPABILITY_ENV_VARS)) {
      expect(vars.length, cap).toBeGreaterThan(0);
      for (const v of vars) expect(known.has(v), `${cap}: ${v}`).toBe(true);
    }
  });

  // #9727 review: gateway coverage is encoded TWICE — declaratively in
  // GATEWAY_CAPABILITIES (which `web/scripts/verify-platform-generation.ts`
  // reads algorithmically, and which docs/guides/platform-keys.md states
  // verbatim) and by hand in each CAPABILITY_ENV_VARS row. The check above
  // walks every row and can never fail on that property (lesson 11): it only
  // asks whether a row names SOME known env var. These two are the drift
  // alarm for #9523 ("route more capabilities through the gateway"), which
  // edits GATEWAY_CAPABILITIES and would otherwise leave this table behind —
  // the probe reporting `degraded` for a capability the gateway already
  // serves, while /api/capabilities tells users to configure a key.
  it('every gateway-served capability accepts the gateway key', () => {
    for (const cap of GATEWAY_CAPABILITIES) {
      expect(CAPABILITY_ENV_VARS[cap], cap).toContain(GATEWAY_KEY_ENV.vercelGateway);
    }
  });

  it('no capability outside GATEWAY_CAPABILITIES accepts the gateway key', () => {
    const gatewayServed = new Set<string>(GATEWAY_CAPABILITIES);
    const direct = PROVIDER_CAPABILITIES.filter((cap) => !gatewayServed.has(cap));
    // Fail rather than pass vacuously if every capability becomes
    // gateway-served: an empty sweep is zero items inspected, not zero
    // problems found.
    expect(direct.length).toBeGreaterThan(0);
    for (const cap of direct) {
      expect(CAPABILITY_ENV_VARS[cap], cap).not.toContain(GATEWAY_KEY_ENV.vercelGateway);
    }
  });

  // The API, health probe, and verification script share these alternatives.
  it('an operation-dependent capability lists exactly its provider options', () => {
    const entries = Object.entries(CAPABILITY_PROVIDER_OPTIONS) as [
      ProviderCapability,
      readonly (keyof typeof PLATFORM_KEY_ENV)[],
    ][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [cap, required] of entries) {
      expect(CAPABILITY_ENV_VARS[cap], cap).toEqual(
        required.map((provider) => PLATFORM_KEY_ENV[provider]),
      );
    }
  });
});

describe('isCapabilityConfigured', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is false with nothing set', () => {
    expect(isCapabilityConfigured('model3d')).toBe(false);
    expect(isCapabilityConfigured('chat')).toBe(false);
  });

  it('is true when a serving env var is set', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'msy_x');
    expect(isCapabilityConfigured('model3d')).toBe(true);
    expect(isCapabilityConfigured('texture')).toBe(true);
    expect(isCapabilityConfigured('sfx')).toBe(false);
  });

  it('allows either sprite provider without requiring the other key', () => {
    vi.stubEnv('PLATFORM_REPLICATE_KEY', 'r8');
    expect(isCapabilityConfigured('sprite')).toBe(true);
    vi.stubEnv('PLATFORM_OPENAI_KEY', 'sk');
    expect(isCapabilityConfigured('sprite')).toBe(true);
  });

  it('treats the Vercel runtime as configured only for gateway-served capabilities', () => {
    vi.stubEnv('VERCEL', '1');
    expect(isCapabilityConfigured('chat')).toBe(true);
    expect(isCapabilityConfigured('model3d')).toBe(false);
  });
});

describe('listUnconfiguredCapabilities', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not count the gateway key as evidence for asset generation', () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw');
    const missing = listUnconfiguredCapabilities();
    expect(missing).not.toContain('chat');
    expect(missing).toEqual(
      expect.arrayContaining(['model3d', 'texture', 'sfx', 'voice', 'sprite', 'bg_removal']),
    );
    // music is declared unavailable (#9522): no key could configure it.
    expect(missing).not.toContain('music');
  });

  it('is empty when every capability has a key', () => {
    for (const v of Object.values(PLATFORM_KEY_ENV)) vi.stubEnv(v, 'x');
    expect(listUnconfiguredCapabilities()).toEqual([]);
  });

  // A capability declared in UNAVAILABLE_CAPABILITIES has no key that could
  // configure it (music/Suno, #9522), so it must not be reported as
  // "unconfigured" — that reads as "an operator forgot a key" and would keep
  // the AI Providers probe permanently degraded (#9727 review).
  it('excludes capabilities that are declared unavailable, key or no key', () => {
    for (const [provider, v] of Object.entries(PLATFORM_KEY_ENV)) {
      if (provider !== 'suno') vi.stubEnv(v, 'x');
    }
    expect(listUnconfiguredCapabilities()).toEqual([]);
    vi.stubEnv(PLATFORM_KEY_ENV.suno, 'x');
    expect(listUnconfiguredCapabilities()).toEqual([]);
  });
});

describe('CAPABILITY_LABELS', () => {
  it('names every capability with the user-facing feature label', () => {
    expect(Object.keys(CAPABILITY_LABELS).sort()).toEqual([...PROVIDER_CAPABILITIES].sort());
    expect(CAPABILITY_LABELS.model3d).toBe('3D Model Generation');
    expect(CAPABILITY_LABELS.music).toBe('Music Generation');
    expect(CAPABILITY_LABELS.bg_removal).toBe('Background Removal');
  });
});
