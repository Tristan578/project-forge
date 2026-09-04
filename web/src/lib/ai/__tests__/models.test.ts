import { describe, it, expect } from 'vitest';
import {
  AI_MODEL_PRIMARY,
  AI_MODEL_FAST,
  AI_MODEL_PREMIUM,
  AI_MODEL_DEEP,
  AI_MODEL_PRIMARY_4X,
  AI_MODEL_PREMIUM_4X,
  AI_MODELS,
  GATEWAY_MODEL_CHAT,
  GATEWAY_MODEL_FAST,
  GATEWAY_MODEL_PREMIUM,
  GATEWAY_MODEL_DEEP,
  gatewayFallbackModels,
  THINKING_BUDGET_TOKENS,
  anthropicThinkingOption,
  bareModelId,
  isPremiumModel,
  supportsEffort,
  thinkingModeFor,
} from '../models';

describe('AI model constants', () => {
  it('exports AI_MODEL_PRIMARY as a non-empty string', () => {
    expect(typeof AI_MODEL_PRIMARY).toBe('string');
    expect(AI_MODEL_PRIMARY.length).toBeGreaterThan(0);
  });

  it('exports AI_MODEL_FAST as a non-empty string', () => {
    expect(typeof AI_MODEL_FAST).toBe('string');
    expect(AI_MODEL_FAST.length).toBeGreaterThan(0);
  });

  it('AI_MODEL_PRIMARY and AI_MODEL_FAST are different models', () => {
    expect(AI_MODEL_PRIMARY).not.toBe(AI_MODEL_FAST);
  });

  it('AI_MODEL_PRIMARY matches expected claude-sonnet pattern', () => {
    // Validates the model ID follows the Anthropic naming convention.
    // Update this pattern if Anthropic changes their naming scheme.
    expect(AI_MODEL_PRIMARY).toMatch(/^claude-/);
  });

  it('AI_MODEL_FAST matches expected claude-haiku pattern', () => {
    expect(AI_MODEL_FAST).toMatch(/^claude-/);
  });

  it('exports AI_MODEL_DEEP as a non-empty claude-* string', () => {
    expect(typeof AI_MODEL_DEEP).toBe('string');
    expect(AI_MODEL_DEEP).toMatch(/^claude-/);
  });

  it('AI_MODEL_DEEP is distinct from primary and fast tiers', () => {
    expect(AI_MODEL_DEEP).not.toBe(AI_MODEL_PRIMARY);
    expect(AI_MODEL_DEEP).not.toBe(AI_MODEL_FAST);
  });

  it('GATEWAY_MODEL_DEEP uses provider-namespaced format', () => {
    expect(GATEWAY_MODEL_DEEP).toContain('/');
    expect(GATEWAY_MODEL_DEEP.split('/')[0]).toBe('anthropic');
  });
});

describe('model id literal pins (PF-1216 / #9339)', () => {
  // These pin the actual migration this PR makes. A test that only checks
  // "is a claude-* string" (see the pattern-match tests above) would stay
  // green through an accidental partial rollback.
  it('pins the Claude 5 family as the live constants', () => {
    expect(AI_MODEL_PRIMARY).toBe('claude-sonnet-5');
    expect(AI_MODEL_PREMIUM).toBe('claude-opus-5');
    expect(AI_MODEL_DEEP).toBe('claude-opus-5');
  });

  it('pins the 4.x ids kept for rollback', () => {
    expect(AI_MODEL_PRIMARY_4X).toBe('claude-sonnet-4-6');
    expect(AI_MODEL_PREMIUM_4X).toBe('claude-opus-4-8');
  });

  it('derives the gateway ids from the same constants a rollback would edit', () => {
    // GATEWAY_MODEL_CHAT/PREMIUM used to be hand-written literals independent
    // of AI_MODEL_PRIMARY/PREMIUM, so the documented one-line rollback missed
    // the gateway route. Assert the derivation, not just the current value,
    // so a future hand-written literal regresses this test immediately.
    expect(GATEWAY_MODEL_CHAT).toBe(`anthropic/${AI_MODEL_PRIMARY}`);
    expect(GATEWAY_MODEL_PREMIUM).toBe(`anthropic/${AI_MODEL_PREMIUM}`);
    expect(GATEWAY_MODEL_CHAT).toBe('anthropic/claude-sonnet-5');
    expect(GATEWAY_MODEL_PREMIUM).toBe('anthropic/claude-opus-5');
  });
});

describe('AI_MODELS object', () => {
  it('has all required keys', () => {
    const requiredKeys = [
      'chat',
      'fast',
      'deep',
      'embedding',
      'gatewayChat',
      'gatewayEmbedding',
      'gatewayDeep',
      'githubDefault',
      'openrouterDefault',
    ] as const;

    for (const key of requiredKeys) {
      expect(AI_MODELS).toHaveProperty(key);
      expect(typeof AI_MODELS[key]).toBe('string');
      expect(AI_MODELS[key].length).toBeGreaterThan(0);
    }
  });

  it('chat key matches AI_MODEL_PRIMARY', () => {
    expect(AI_MODELS.chat).toBe(AI_MODEL_PRIMARY);
  });

  it('fast key matches AI_MODEL_FAST', () => {
    expect(AI_MODELS.fast).toBe(AI_MODEL_FAST);
  });

  it('deep key matches AI_MODEL_DEEP', () => {
    expect(AI_MODELS.deep).toBe(AI_MODEL_DEEP);
  });

  it('gatewayDeep matches GATEWAY_MODEL_DEEP', () => {
    expect(AI_MODELS.gatewayDeep).toBe(GATEWAY_MODEL_DEEP);
  });

  it('embedding key is a non-empty string', () => {
    expect(typeof AI_MODELS.embedding).toBe('string');
    expect(AI_MODELS.embedding.length).toBeGreaterThan(0);
  });

  it('gatewayChat uses provider-namespaced format', () => {
    // Gateway models must be in "provider/model" format for the Vercel AI Gateway
    expect(AI_MODELS.gatewayChat).toContain('/');
  });

  it('gatewayEmbedding uses provider-namespaced format', () => {
    expect(AI_MODELS.gatewayEmbedding).toContain('/');
  });

  it('openrouterDefault uses provider-namespaced format', () => {
    expect(AI_MODELS.openrouterDefault).toContain('/');
  });

  it('all values are strings of non-zero length', () => {
    const values = Object.values(AI_MODELS) as string[];
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('exposes premium and gatewayPremium keys', () => {
    expect(AI_MODELS.premium).toBe(AI_MODEL_PREMIUM);
    expect(AI_MODELS.gatewayPremium).toBe(GATEWAY_MODEL_PREMIUM);
  });
});

describe('AI_MODEL_PREMIUM', () => {
  it('is a non-empty Anthropic-style model id', () => {
    expect(typeof AI_MODEL_PREMIUM).toBe('string');
    expect(AI_MODEL_PREMIUM).toMatch(/^claude-opus-/);
  });

  it('differs from primary and fast model ids', () => {
    expect(AI_MODEL_PREMIUM).not.toBe(AI_MODEL_PRIMARY);
    expect(AI_MODEL_PREMIUM).not.toBe(AI_MODEL_FAST);
  });

  it('has a corresponding gateway-format string', () => {
    expect(GATEWAY_MODEL_PREMIUM).toContain('/');
    expect(GATEWAY_MODEL_PREMIUM.endsWith(AI_MODEL_PREMIUM)).toBe(true);
  });
});

describe('isPremiumModel', () => {
  it('returns true for the bare premium id', () => {
    expect(isPremiumModel(AI_MODEL_PREMIUM)).toBe(true);
  });

  it('returns true for the gateway-format premium id', () => {
    expect(isPremiumModel(GATEWAY_MODEL_PREMIUM)).toBe(true);
  });

  it('returns true for the 4.x rollback premium id (bare and gateway-format)', () => {
    // A caller that explicitly requests the pre-migration Opus id — a
    // rollback, or a stale in-flight request — must still gate as premium.
    expect(isPremiumModel(AI_MODEL_PREMIUM_4X)).toBe(true);
    expect(isPremiumModel(`anthropic/${AI_MODEL_PREMIUM_4X}`)).toBe(true);
  });

  it('returns false for the primary chat model', () => {
    expect(isPremiumModel(AI_MODEL_PRIMARY)).toBe(false);
    expect(isPremiumModel(AI_MODELS.gatewayChat)).toBe(false);
  });

  it('returns false for the fast model', () => {
    expect(isPremiumModel(AI_MODEL_FAST)).toBe(false);
  });

  it('returns false for null, undefined, and empty string', () => {
    expect(isPremiumModel(null)).toBe(false);
    expect(isPremiumModel(undefined)).toBe(false);
    expect(isPremiumModel('')).toBe(false);
  });

  it('returns false for an unknown opus-shaped string (no substring match)', () => {
    // Defensive: the helper should only allow exactly the known opus id, not
    // any string containing "opus". Future opus revisions must be opted in.
    expect(isPremiumModel('claude-opus-5-0')).toBe(false);
    expect(isPremiumModel('anthropic/claude-opus-9-9')).toBe(false);
    expect(isPremiumModel('opus-pretender')).toBe(false);
  });
});

describe('thinkingModeFor / supportsEffort (#9626)', () => {
  // The request shape is a property of the MODEL, not the backend: the wrong
  // shape is an HTTP 400 from Anthropic. Table from the 2026-09-01 review.
  const cases: Array<[string, 'adaptive' | 'budget' | 'none']> = [
    [AI_MODEL_PREMIUM, 'adaptive'], // claude-opus-5 rejects the budget form
    ['anthropic/claude-opus-4-8', 'adaptive'], // gateway spelling, pre-migration id
    [AI_MODEL_PRIMARY, 'adaptive'], // claude-sonnet-5
    ['claude-sonnet-4.6', 'adaptive'],
    ['claude-opus-4-7', 'adaptive'],
    ['claude-haiku-4-7', 'adaptive'], // anything 4.7+ regardless of family
    ['claude-fable-5-1', 'adaptive'],
    // NOTE: no separate 'claude-opus-5' literal row here — AI_MODEL_PREMIUM
    // already is that string post-migration, and it.each duplicate titles
    // read as broader coverage than they are (see the dedup below).
    [AI_MODEL_FAST, 'budget'], // claude-haiku-4-5-20251001 rejects adaptive
    ['claude-haiku-4.5', 'budget'],
    ['claude-sonnet-4-5', 'budget'],
    ['claude-sonnet-4.5', 'budget'],
    ['claude-opus-4-1', 'budget'],
    ['claude-3-7-sonnet-20250219', 'budget'],
    ['claude-3-5-sonnet-20241022', 'none'],
    ['gpt-4o-mini', 'none'],
    ['anthropic/gpt-4o-mini', 'none'],
    ['', 'none'],
  ];

  it.each(cases)('%s → %s', (model, expected) => {
    expect(thinkingModeFor(model)).toBe(expected);
  });

  it('returns none for undefined and null', () => {
    expect(thinkingModeFor(undefined)).toBe('none');
    expect(thinkingModeFor(null)).toBe('none');
  });

  it('supportsEffort is exactly the adaptive set', () => {
    for (const [model, mode] of cases) {
      expect(supportsEffort(model), model).toBe(mode === 'adaptive');
    }
  });

  it('the three user-selectable models each resolve to a shape the API accepts', () => {
    expect(thinkingModeFor(AI_MODEL_PREMIUM)).toBe('adaptive');
    expect(thinkingModeFor(AI_MODEL_PRIMARY)).toBe('adaptive');
    expect(thinkingModeFor(AI_MODEL_FAST)).toBe('budget');
  });
});

describe('gatewayFallbackModels (#9631)', () => {
  it('premium falls back to chat then fast, chat to fast, fast to nothing', () => {
    expect(gatewayFallbackModels(GATEWAY_MODEL_PREMIUM)).toEqual([AI_MODELS.gatewayChat, 'anthropic/claude-haiku-4-5']);
    expect(gatewayFallbackModels(AI_MODELS.gatewayChat)).toEqual(['anthropic/claude-haiku-4-5']);
    expect(gatewayFallbackModels('anthropic/claude-haiku-4-5')).toEqual([]);
  });

  it('never guesses a fallback for an unknown id', () => {
    expect(gatewayFallbackModels('openai/gpt-4o-mini')).toEqual([]);
    expect(gatewayFallbackModels(undefined)).toEqual([]);
    expect(gatewayFallbackModels(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Extended-thinking / effort capability table (PF-1216 / #9339)
// ---------------------------------------------------------------------------

describe('bareModelId', () => {
  it('strips a provider prefix', () => {
    expect(bareModelId('anthropic/claude-opus-5')).toBe('claude-opus-5');
  });

  it('passes a bare id through unchanged', () => {
    expect(bareModelId('claude-opus-5')).toBe('claude-opus-5');
  });
});

describe('thinkingModeFor — gateway spelling parity (PF-1216 / #9339)', () => {
  it('resolves the gateway-format id to the same mode as the bare id', () => {
    expect(thinkingModeFor(GATEWAY_MODEL_CHAT)).toBe(thinkingModeFor(AI_MODEL_PRIMARY));
    expect(thinkingModeFor(GATEWAY_MODEL_PREMIUM)).toBe(thinkingModeFor(AI_MODEL_PREMIUM));
    expect(thinkingModeFor(GATEWAY_MODEL_FAST)).toBe('budget');
  });

  it('returns none for an id with no parseable Claude version', () => {
    // Fail-safe: an id the parser cannot place must omit the field rather than
    // guess a shape the API answers with HTTP 400.
    expect(thinkingModeFor('gpt-4o')).toBe('none');
    expect(thinkingModeFor('')).toBe('none');
    expect(thinkingModeFor(null)).toBe('none');
    expect(thinkingModeFor(undefined)).toBe('none');
  });

  it('supportsEffort is false for every non-adaptive id', () => {
    expect(supportsEffort(AI_MODEL_FAST)).toBe(false);
    expect(supportsEffort(GATEWAY_MODEL_FAST)).toBe(false);
    expect(supportsEffort('claude-sonnet-4.5')).toBe(false);
    expect(supportsEffort('gpt-4o')).toBe(false);
    expect(supportsEffort('')).toBe(false);
    expect(supportsEffort(null)).toBe(false);
  });
});

describe('anthropicThinkingOption', () => {
  it('returns the adaptive literal for the Claude 5 family', () => {
    expect(anthropicThinkingOption(AI_MODEL_PRIMARY)).toEqual({ type: 'adaptive' });
    expect(anthropicThinkingOption(AI_MODEL_PREMIUM)).toEqual({ type: 'adaptive' });
  });

  it('never emits budgetTokens for a Claude 5 model', () => {
    // The exact 400 this migration exists to remove.
    for (const model of [AI_MODEL_PRIMARY, AI_MODEL_PREMIUM, AI_MODEL_DEEP]) {
      expect(anthropicThinkingOption(model)).not.toHaveProperty('budgetTokens');
      expect(anthropicThinkingOption(model)).not.toMatchObject({ type: 'enabled' });
    }
  });

  it('keeps the legacy budget literal for Haiku 4.5', () => {
    expect(anthropicThinkingOption(AI_MODEL_FAST)).toEqual({
      type: 'enabled',
      budgetTokens: THINKING_BUDGET_TOKENS,
    });
  });

  it('keeps the 4.x rollback constants on a supported shape', () => {
    // Pointing AI_MODEL_PRIMARY/AI_MODEL_PREMIUM back at these must not leave
    // the thinking toggle a silent no-op.
    expect(anthropicThinkingOption(AI_MODEL_PRIMARY_4X)).toEqual({ type: 'adaptive' });
    expect(anthropicThinkingOption(AI_MODEL_PREMIUM_4X)).toEqual({ type: 'adaptive' });
  });

  it('keeps the legacy budget literal for pre-4.6 Claude models', () => {
    // The dotted spelling parses the same as the dashed one (#9626).
    expect(anthropicThinkingOption('claude-sonnet-4.5')).toEqual({
      type: 'enabled',
      budgetTokens: THINKING_BUDGET_TOKENS,
    });
  });

  it('returns undefined for a model with no known shape', () => {
    expect(anthropicThinkingOption('gpt-4o')).toBeUndefined();
    expect(anthropicThinkingOption(null)).toBeUndefined();
  });
});

describe('thinking-table coverage for shipped models', () => {
  // A model we actually route must never land on the safe `none` default —
  // that would turn the extended-thinking toggle into a silent no-op for a
  // tier that pays for it. Derived from AI_MODELS so a new chat model is
  // covered the day it is added, not the day someone remembers this file.
  // Each entry also pins the EXACT shape, not just "not none": asserting
  // only `!== 'none'` would stay green if a model silently flipped from
  // 'adaptive' to 'budget' (or vice versa) and started 400ing.
  const SHIPPED_CHAT_MODELS: Array<[string, 'adaptive' | 'budget']> = [
    [AI_MODELS.chat, 'adaptive'],
    [AI_MODELS.fast, 'budget'],
    [AI_MODELS.premium, 'adaptive'],
    [AI_MODELS.deep, 'adaptive'],
    [bareModelId(GATEWAY_MODEL_CHAT), 'adaptive'],
    [bareModelId(GATEWAY_MODEL_FAST), 'budget'],
    [bareModelId(GATEWAY_MODEL_PREMIUM), 'adaptive'],
    [bareModelId(GATEWAY_MODEL_DEEP), 'adaptive'],
    [AI_MODEL_PRIMARY_4X, 'adaptive'],
    [AI_MODEL_PREMIUM_4X, 'adaptive'],
  ];

  // Several of the above resolve to the same model id: AI_MODEL_DEEP aliases
  // AI_MODEL_PREMIUM, and the gateway ids are now derived from the same bare
  // constants (see the derivation test above) — so the gateway-chat and
  // gateway-premium entries duplicate the direct chat/premium entries
  // exactly. Running it.each on the raw list would produce duplicate test
  // titles that read as broader coverage than they are.
  const uniqueShippedModels = Array.from(
    new Map<string, 'adaptive' | 'budget'>(SHIPPED_CHAT_MODELS).entries(),
  );

  it('sanity: the derived id set is non-empty and all Anthropic', () => {
    // A vacuous sweep over zero ids would report as full coverage.
    expect(uniqueShippedModels.length).toBeGreaterThan(0);
    for (const [id] of uniqueShippedModels) {
      expect(id, `${id} is not an Anthropic chat id`).toMatch(/^claude-/);
    }
  });

  it.each(uniqueShippedModels)('%s resolves to the %s shape', (model, expectedMode) => {
    expect(
      thinkingModeFor(model),
      `${model} is routable but resolves to the wrong (or no) entry in thinkingModeFor()'s table, so the thinking toggle either silently does nothing or sends the wrong shape for it`,
    ).toBe(expectedMode);
    expect(anthropicThinkingOption(model)).toBeDefined();
  });
});
