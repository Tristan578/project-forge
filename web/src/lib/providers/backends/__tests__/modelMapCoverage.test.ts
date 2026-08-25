/**
 * Cross-backend coverage guard for canonical Anthropic chat model IDs.
 *
 * Two things are derived rather than written down, because both are exactly
 * what went stale in PF-1233:
 *
 *   - the ID set comes from `@/lib/ai/models` (the source of truth), and
 *   - the backend list comes from `getAllBackends()` in the provider registry,
 *     so a newly registered chat backend is covered the day it is registered
 *     instead of the day someone remembers to add it here.
 *
 * A backend whose MODEL_MAP omits a canonical ID makes `resolveModelId` fall
 * through to its default chat model (Sonnet) — silently downgrading a premium
 * request, or silently upgrading a Haiku one and inflating upstream cost.
 * The assertion is on the resolved MODEL, not merely its family: mapping
 * `claude-opus-4-8` onto a retired `anthropic/claude-opus-4` is the same class
 * of defect and must not pass.
 *
 * Regression coverage: PF-1233 / #9376 — openrouter.ts's MODEL_MAP carried two
 * retired IDs ('claude-opus-4', 'claude-haiku-3-5') and was missing every
 * current canonical Anthropic ID except Sonnet, so
 * resolveModelId('claude-opus-4-8') silently returned Sonnet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AI_MODELS, GATEWAY_MODEL_FAST, GATEWAY_MODEL_PREMIUM } from '@/lib/ai/models';

/** Strip a `provider/` prefix, leaving the bare model id. */
function bareId(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

/** Strip a trailing dated-snapshot suffix ('-20251001'). */
function undated(id: string): string {
  return id.replace(/-\d{8}$/, '');
}

/**
 * Every bare canonical chat ID a backend can actually receive from the app.
 * The gateway-format constants contribute their bare forms, which differ from
 * the AI_MODELS entries (GATEWAY_MODEL_FAST has no dated snapshot suffix).
 */
const CANONICAL_CHAT_IDS: readonly string[] = Array.from(
  new Set([
    AI_MODELS.chat,
    AI_MODELS.fast,
    AI_MODELS.premium,
    AI_MODELS.deep,
    bareId(GATEWAY_MODEL_FAST),
    bareId(GATEWAY_MODEL_PREMIUM),
  ]),
);

describe('backend MODEL_MAP coverage for canonical Anthropic chat IDs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-test');
    vi.stubEnv('GITHUB_MODELS_TOKEN', 'ghm-test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sanity: the derived id set is non-empty and all-Anthropic', () => {
    expect(CANONICAL_CHAT_IDS.length).toBeGreaterThan(0);
    for (const id of CANONICAL_CHAT_IDS) {
      expect(id, `${id} is not an Anthropic canonical chat id`).toMatch(/^claude-/);
    }
  });

  it('covers every backend the registry knows about', async () => {
    const { getAllBackends } = await import('@/lib/providers/registry');
    // If this trips, a backend was added to the registry: it is already
    // covered by the loop below — this pin just makes the count visible so
    // the growth is deliberate rather than silent.
    expect(getAllBackends().length).toBeGreaterThanOrEqual(4);
  });

  it.each(CANONICAL_CHAT_IDS)(
    "every registered backend resolves '%s' to that same model",
    async (id) => {
      const { getAllBackends } = await import('@/lib/providers/registry');
      const offenders: string[] = [];
      for (const { backend } of getAllBackends()) {
        const resolved = backend.resolveModelId(id);
        // A backend may translate the dated snapshot onto its undated form
        // (that is the same model), and may add a `provider/` prefix. It may
        // not land on a different model.
        const ok = undated(bareId(resolved)) === undated(id);
        if (!ok) offenders.push(`${backend.id}: '${id}' -> '${resolved}'`);
      }
      expect(
        offenders,
        `these backends do not resolve '${id}' to itself — MODEL_MAP is missing the id (silent fallback to the default chat model) or points it at a different model:\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    },
  );
});
