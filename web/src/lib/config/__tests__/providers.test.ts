import { describe, it, expect } from 'vitest';
import {
  PROVIDER_NAMES,
  BYOK_PROVIDERS,
  BACKEND_IDS,
  PROVIDER_CAPABILITIES,
  DIRECT_CAPABILITY_PROVIDER,
  BACKEND_TO_PROVIDER,
  IMAGE_SIZE_CONSTRAINTS,
  SPRITE_PROVIDERS,
  SPRITE_SIZES,
  SPRITE_TOKEN_COST,
  SPRITE_ESTIMATED_SECONDS,
  PIXEL_ART_STYLES,
  PIXEL_ART_SIZES,
  PIXEL_ART_DITHERING_MODES,
  CIRCUIT_BREAKER_DEFAULTS,
  type ProviderName,
  type ProviderCapability,
} from '../providers';

describe('PROVIDER_NAMES', () => {
  it('contains the canonical provider set', () => {
    const names = [...PROVIDER_NAMES];
    expect(names).toContain('anthropic');
    expect(names).toContain('openai');
    expect(names).toContain('meshy');
    expect(names).toContain('elevenlabs');
    expect(names).toContain('suno');
    expect(names).toContain('replicate');
    expect(names).toContain('removebg');
    expect(names).toContain('openrouter');
    expect(names).toContain('vercel-gateway');
    expect(names).toContain('github-models');
  });

  it('has no duplicates', () => {
    const names = [...PROVIDER_NAMES];
    expect(names.length).toBe(new Set(names).size);
  });
});

describe('BYOK_PROVIDERS', () => {
  it('contains BYOK-enabled providers including hyper3d', () => {
    const providers = [...BYOK_PROVIDERS];
    expect(providers).toContain('anthropic');
    expect(providers).toContain('meshy');
    expect(providers).toContain('hyper3d');
    expect(providers).toContain('elevenlabs');
    expect(providers).toContain('suno');
  });

  it('has no duplicates', () => {
    const providers = [...BYOK_PROVIDERS];
    expect(providers.length).toBe(new Set(providers).size);
  });
});

describe('BACKEND_IDS', () => {
  it('contains the canonical backend set', () => {
    const ids = [...BACKEND_IDS];
    expect(ids).toContain('direct');
    expect(ids).toContain('vercel-gateway');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('github-models');
    expect(ids).toContain('cloudflare-ai');
    expect(ids).toContain('byok');
  });

  it('has no duplicates', () => {
    const ids = [...BACKEND_IDS];
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('PROVIDER_CAPABILITIES', () => {
  it('contains all expected capability types', () => {
    const caps = [...PROVIDER_CAPABILITIES];
    expect(caps).toContain('chat');
    expect(caps).toContain('embedding');
    expect(caps).toContain('image');
    expect(caps).toContain('model3d');
    expect(caps).toContain('texture');
    expect(caps).toContain('sfx');
    expect(caps).toContain('voice');
    expect(caps).toContain('music');
    expect(caps).toContain('sprite');
    expect(caps).toContain('bg_removal');
  });

  it('has no duplicates', () => {
    const caps = [...PROVIDER_CAPABILITIES];
    expect(caps.length).toBe(new Set(caps).size);
  });
});

describe('DIRECT_CAPABILITY_PROVIDER', () => {
  it('maps every capability to a known provider', () => {
    const knownProviders = new Set<string>(PROVIDER_NAMES);
    for (const [cap, provider] of Object.entries(DIRECT_CAPABILITY_PROVIDER) as [ProviderCapability, ProviderName][]) {
      expect(knownProviders.has(provider), `capability "${cap}" maps to unknown provider "${provider}"`).toBe(true);
    }
  });

  it('covers every capability in PROVIDER_CAPABILITIES', () => {
    for (const cap of PROVIDER_CAPABILITIES) {
      expect(
        Object.prototype.hasOwnProperty.call(DIRECT_CAPABILITY_PROVIDER, cap),
        `capability "${cap}" is missing from DIRECT_CAPABILITY_PROVIDER`
      ).toBe(true);
    }
  });

  it('routes chat to anthropic', () => {
    expect(DIRECT_CAPABILITY_PROVIDER.chat).toBe('anthropic');
  });

  it('routes embedding to openai', () => {
    expect(DIRECT_CAPABILITY_PROVIDER.embedding).toBe('openai');
  });

  it('routes sprite to replicate', () => {
    expect(DIRECT_CAPABILITY_PROVIDER.sprite).toBe('replicate');
  });

  it('routes bg_removal to removebg', () => {
    expect(DIRECT_CAPABILITY_PROVIDER.bg_removal).toBe('removebg');
  });
});

describe('BACKEND_TO_PROVIDER', () => {
  it('maps gateway backends to their provider names', () => {
    expect(BACKEND_TO_PROVIDER['vercel-gateway']).toBe('vercel-gateway');
    expect(BACKEND_TO_PROVIDER['openrouter']).toBe('openrouter');
    expect(BACKEND_TO_PROVIDER['github-models']).toBe('github-models');
  });

  it('only maps to known providers', () => {
    const knownProviders = new Set<string>(PROVIDER_NAMES);
    for (const provider of Object.values(BACKEND_TO_PROVIDER)) {
      expect(knownProviders.has(provider!), `mapped to unknown provider "${provider}"`).toBe(true);
    }
  });
});

describe('IMAGE_SIZE_CONSTRAINTS', () => {
  it('defines constraints for dall-e-3', () => {
    const c = IMAGE_SIZE_CONSTRAINTS['dall-e-3'];
    expect(c).toBeDefined();
    expect(c.allowedSizes).toContain('1024x1024');
    expect(c.defaultSize).toBe('1024x1024');
    expect(c.maxDimension).toBe(1792);
  });

  it('defines constraints for sdxl', () => {
    const c = IMAGE_SIZE_CONSTRAINTS['sdxl'];
    expect(c).toBeDefined();
    expect(c.defaultSize).toBe('1024x1024');
    expect(c.maxDimension).toBe(1024);
  });

  it('defaultSize is always in allowedSizes', () => {
    for (const [model, c] of Object.entries(IMAGE_SIZE_CONSTRAINTS)) {
      expect(
        c.allowedSizes as readonly string[],
        `${model}: defaultSize "${c.defaultSize}" not in allowedSizes`
      ).toContain(c.defaultSize);
    }
  });
});

describe('SPRITE_PROVIDERS', () => {
  it('contains auto, dalle3, sdxl', () => {
    expect([...SPRITE_PROVIDERS]).toEqual(['auto', 'dalle3', 'sdxl']);
  });
});

describe('SPRITE_SIZES', () => {
  it('contains expected sizes', () => {
    const sizes = [...SPRITE_SIZES];
    expect(sizes).toContain('32x32');
    expect(sizes).toContain('1024x1024');
  });
});

describe('SPRITE_TOKEN_COST', () => {
  it('defines cost for dalle3 and sdxl', () => {
    expect(SPRITE_TOKEN_COST.dalle3).toBeGreaterThan(0);
    expect(SPRITE_TOKEN_COST.sdxl).toBeGreaterThan(0);
  });

  it('dalle3 costs more than sdxl (higher quality)', () => {
    expect(SPRITE_TOKEN_COST.dalle3).toBeGreaterThan(SPRITE_TOKEN_COST.sdxl);
  });
});

describe('SPRITE_ESTIMATED_SECONDS', () => {
  it('defines estimated time for dalle3 and sdxl', () => {
    expect(SPRITE_ESTIMATED_SECONDS.dalle3).toBeGreaterThan(0);
    expect(SPRITE_ESTIMATED_SECONDS.sdxl).toBeGreaterThan(0);
  });
});

describe('PIXEL_ART_STYLES', () => {
  it('contains expected style values', () => {
    const styles = [...PIXEL_ART_STYLES];
    expect(styles).toContain('character');
    expect(styles).toContain('prop');
    expect(styles).toContain('tile');
    expect(styles).toContain('icon');
    expect(styles).toContain('environment');
  });
});

describe('PIXEL_ART_SIZES', () => {
  it('contains expected pixel dimensions', () => {
    const sizes = [...PIXEL_ART_SIZES];
    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
    expect(sizes).toContain(64);
    expect(sizes).toContain(128);
  });

  it('is sorted ascending', () => {
    const sizes = [...PIXEL_ART_SIZES];
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });
});

describe('PIXEL_ART_DITHERING_MODES', () => {
  it('contains none, bayer4x4, bayer8x8', () => {
    expect([...PIXEL_ART_DITHERING_MODES]).toEqual(['none', 'bayer4x4', 'bayer8x8']);
  });
});

describe('CIRCUIT_BREAKER_DEFAULTS', () => {
  it('has errorRateThreshold between 0 and 1', () => {
    expect(CIRCUIT_BREAKER_DEFAULTS.errorRateThreshold).toBeGreaterThan(0);
    expect(CIRCUIT_BREAKER_DEFAULTS.errorRateThreshold).toBeLessThanOrEqual(1);
  });

  it('has positive minRequestsToEvaluate', () => {
    expect(CIRCUIT_BREAKER_DEFAULTS.minRequestsToEvaluate).toBeGreaterThan(0);
  });

  it('has positive costAnomalyMultiplier', () => {
    expect(CIRCUIT_BREAKER_DEFAULTS.costAnomalyMultiplier).toBeGreaterThan(1);
  });
});
