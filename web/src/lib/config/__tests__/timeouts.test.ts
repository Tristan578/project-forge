import { describe, it, expect } from 'vitest';
import {
  E2E_TEST_TIMEOUT_MS,
  E2E_HYDRATION_TIMEOUT_MS,
  E2E_VISIBILITY_TIMEOUT_MS,
  E2E_NAVIGATION_TIMEOUT_MS,
  E2E_EXPECT_TIMEOUT_MS,
  E2E_ACTION_TIMEOUT_MS,
  E2E_WEB_SERVER_TIMEOUT_MS,
  E2E_SHORT_WAIT_MS,
  E2E_MEDIUM_WAIT_MS,
  VITEST_TEST_TIMEOUT_MS,
  VITEST_HOOK_TIMEOUT_MS,
  GPU_INIT_TIMEOUT_MS,
  WASM_FETCH_TIMEOUT_MS,
  ENGINE_GLOBAL_TIMEOUT_MS,
  API_MAX_DURATION_DEFAULT_S,
  API_MAX_DURATION_CHAT_S,
  API_MAX_DURATION_HEAVY_GEN_S,
  API_MAX_DURATION_STANDARD_GEN_S,
  API_MAX_DURATION_BATCH_S,
  API_MAX_DURATION_SIMPLE_S,
  API_MAX_DURATION_CRON_S,
  EXTERNAL_API_TIMEOUT_MS,
  REPLICATE_STATUS_TIMEOUT_MS,
  WEBSOCKET_MESSAGE_TIMEOUT_MS,
  REAPER_BRIDGE_TIMEOUT_MS,
  RATE_LIMIT_PUBLIC_WINDOW_MS,
  RATE_LIMIT_ADMIN_WINDOW_MS,
  RATE_LIMIT_APPEAL_WINDOW_MS,
  RATE_LIMIT_PUBLIC_MAX,
  RATE_LIMIT_ADMIN_MAX,
  RATE_LIMIT_PLAY_MAX,
  DEBOUNCE_VIEWPORT_MS,
  DEBOUNCE_TRANSFORM_AUTOSAVE_MS,
  TIP_COOLDOWN_MS,
  ERROR_TTL_MS,
  HEALTH_CACHE_TTL_MS,
  BRIDGE_CACHE_TTL_MS,
  DOCS_EMPTY_CACHE_TTL_MS,
  CIRCUIT_BREAKER_WINDOW_MS,
  CIRCUIT_BREAKER_HALF_OPEN_MS,
  WEBHOOK_RETRY_MAX_DELAY_MS,
  GENERATION_AGENT_STEP_TIMEOUT_MS,
  GENERATION_AGENT_TIMEOUT_BUFFER_MS,
  deriveGenerationStepTimeoutMs,
} from '../timeouts';

describe('E2E / Playwright timeouts', () => {
  it('E2E_TEST_TIMEOUT_MS is 60 seconds', () => {
    expect(E2E_TEST_TIMEOUT_MS).toBe(60_000);
  });

  it('E2E_HYDRATION_TIMEOUT_MS is 45 seconds', () => {
    expect(E2E_HYDRATION_TIMEOUT_MS).toBe(45_000);
  });

  it('E2E_VISIBILITY_TIMEOUT_MS is 30 seconds', () => {
    expect(E2E_VISIBILITY_TIMEOUT_MS).toBe(30_000);
  });

  it('E2E_NAVIGATION_TIMEOUT_MS is 30 seconds', () => {
    expect(E2E_NAVIGATION_TIMEOUT_MS).toBe(30_000);
  });

  it('hydration timeout is shorter than test timeout', () => {
    expect(E2E_HYDRATION_TIMEOUT_MS).toBeLessThan(E2E_TEST_TIMEOUT_MS);
  });

  it('E2E_EXPECT_TIMEOUT_MS is 15 seconds', () => {
    expect(E2E_EXPECT_TIMEOUT_MS).toBe(15_000);
  });

  it('E2E_ACTION_TIMEOUT_MS is 10 seconds', () => {
    expect(E2E_ACTION_TIMEOUT_MS).toBe(10_000);
  });

  it('E2E_WEB_SERVER_TIMEOUT_MS is 120 seconds', () => {
    expect(E2E_WEB_SERVER_TIMEOUT_MS).toBe(120_000);
  });

  it('E2E_SHORT_WAIT_MS is 5 seconds', () => {
    expect(E2E_SHORT_WAIT_MS).toBe(5_000);
  });

  it('E2E_MEDIUM_WAIT_MS is 10 seconds', () => {
    expect(E2E_MEDIUM_WAIT_MS).toBe(10_000);
  });

  it('short wait < medium wait < visibility timeout', () => {
    expect(E2E_SHORT_WAIT_MS).toBeLessThan(E2E_MEDIUM_WAIT_MS);
    expect(E2E_MEDIUM_WAIT_MS).toBeLessThan(E2E_VISIBILITY_TIMEOUT_MS);
  });
});

describe('Vitest timeouts', () => {
  it('VITEST_TEST_TIMEOUT_MS is 30 seconds', () => {
    expect(VITEST_TEST_TIMEOUT_MS).toBe(30_000);
  });

  it('VITEST_HOOK_TIMEOUT_MS is 30 seconds', () => {
    expect(VITEST_HOOK_TIMEOUT_MS).toBe(30_000);
  });
});

describe('Engine / WASM loading timeouts', () => {
  it('GPU_INIT_TIMEOUT_MS is 30 seconds', () => {
    expect(GPU_INIT_TIMEOUT_MS).toBe(30_000);
  });

  it('WASM_FETCH_TIMEOUT_MS is 60 seconds', () => {
    expect(WASM_FETCH_TIMEOUT_MS).toBe(60_000);
  });

  it('ENGINE_GLOBAL_TIMEOUT_MS is 30 seconds', () => {
    expect(ENGINE_GLOBAL_TIMEOUT_MS).toBe(30_000);
  });

  it('WASM fetch timeout is longer than GPU init timeout', () => {
    expect(WASM_FETCH_TIMEOUT_MS).toBeGreaterThan(GPU_INIT_TIMEOUT_MS);
  });
});

describe('API maxDuration constants (seconds)', () => {
  it('API_MAX_DURATION_DEFAULT_S is a positive integer', () => {
    expect(Number.isInteger(API_MAX_DURATION_DEFAULT_S)).toBe(true);
    expect(API_MAX_DURATION_DEFAULT_S).toBeGreaterThan(0);
  });

  it('API_MAX_DURATION_CHAT_S is longer than standard gen', () => {
    expect(API_MAX_DURATION_CHAT_S).toBeGreaterThanOrEqual(API_MAX_DURATION_STANDARD_GEN_S);
  });

  it('API_MAX_DURATION_HEAVY_GEN_S is longest gen route', () => {
    expect(API_MAX_DURATION_HEAVY_GEN_S).toBeGreaterThan(API_MAX_DURATION_STANDARD_GEN_S);
  });

  it('API_MAX_DURATION_SIMPLE_S equals default', () => {
    expect(API_MAX_DURATION_SIMPLE_S).toBe(API_MAX_DURATION_DEFAULT_S);
  });

  it('all maxDuration values are positive', () => {
    const values = [
      API_MAX_DURATION_DEFAULT_S,
      API_MAX_DURATION_CHAT_S,
      API_MAX_DURATION_HEAVY_GEN_S,
      API_MAX_DURATION_STANDARD_GEN_S,
      API_MAX_DURATION_BATCH_S,
      API_MAX_DURATION_SIMPLE_S,
      API_MAX_DURATION_CRON_S,
    ];
    for (const v of values) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('External API timeouts', () => {
  it('EXTERNAL_API_TIMEOUT_MS is 60 seconds', () => {
    expect(EXTERNAL_API_TIMEOUT_MS).toBe(60_000);
  });

  it('REPLICATE_STATUS_TIMEOUT_MS is positive', () => {
    expect(REPLICATE_STATUS_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('WEBSOCKET_MESSAGE_TIMEOUT_MS is 30 seconds', () => {
    expect(WEBSOCKET_MESSAGE_TIMEOUT_MS).toBe(30_000);
  });

  it('REAPER_BRIDGE_TIMEOUT_MS is 60 seconds', () => {
    expect(REAPER_BRIDGE_TIMEOUT_MS).toBe(60_000);
  });
});

describe('Rate limit windows', () => {
  it('RATE_LIMIT_PUBLIC_WINDOW_MS is 5 minutes', () => {
    expect(RATE_LIMIT_PUBLIC_WINDOW_MS).toBe(300_000);
  });

  it('RATE_LIMIT_ADMIN_WINDOW_MS is 1 minute', () => {
    expect(RATE_LIMIT_ADMIN_WINDOW_MS).toBe(60_000);
  });

  it('RATE_LIMIT_APPEAL_WINDOW_MS is 10 minutes', () => {
    expect(RATE_LIMIT_APPEAL_WINDOW_MS).toBe(600_000);
  });

  it('public window is longer than admin window', () => {
    expect(RATE_LIMIT_PUBLIC_WINDOW_MS).toBeGreaterThan(RATE_LIMIT_ADMIN_WINDOW_MS);
  });

  it('RATE_LIMIT_PUBLIC_MAX is positive', () => {
    expect(RATE_LIMIT_PUBLIC_MAX).toBeGreaterThan(0);
  });

  it('RATE_LIMIT_ADMIN_MAX is positive', () => {
    expect(RATE_LIMIT_ADMIN_MAX).toBeGreaterThan(0);
  });

  it('RATE_LIMIT_PLAY_MAX is positive', () => {
    expect(RATE_LIMIT_PLAY_MAX).toBeGreaterThan(0);
  });

  it('play routes allow more requests than admin routes', () => {
    expect(RATE_LIMIT_PLAY_MAX).toBeGreaterThan(RATE_LIMIT_ADMIN_MAX);
  });
});

describe('Debounce and cooldown intervals', () => {
  it('DEBOUNCE_VIEWPORT_MS is 100ms', () => {
    expect(DEBOUNCE_VIEWPORT_MS).toBe(100);
  });

  it('DEBOUNCE_TRANSFORM_AUTOSAVE_MS is 2 seconds', () => {
    expect(DEBOUNCE_TRANSFORM_AUTOSAVE_MS).toBe(2_000);
  });

  it('TIP_COOLDOWN_MS is 30 seconds', () => {
    expect(TIP_COOLDOWN_MS).toBe(30_000);
  });

  it('ERROR_TTL_MS is 30 seconds', () => {
    expect(ERROR_TTL_MS).toBe(30_000);
  });

  it('HEALTH_CACHE_TTL_MS is 30 seconds', () => {
    expect(HEALTH_CACHE_TTL_MS).toBe(30_000);
  });

  it('BRIDGE_CACHE_TTL_MS is 60 seconds', () => {
    expect(BRIDGE_CACHE_TTL_MS).toBe(60_000);
  });

  it('DOCS_EMPTY_CACHE_TTL_MS is 30 seconds', () => {
    expect(DOCS_EMPTY_CACHE_TTL_MS).toBe(30_000);
  });

  it('auto-save debounce is longer than viewport debounce', () => {
    expect(DEBOUNCE_TRANSFORM_AUTOSAVE_MS).toBeGreaterThan(DEBOUNCE_VIEWPORT_MS);
  });
});

describe('Circuit breaker timing', () => {
  it('CIRCUIT_BREAKER_WINDOW_MS is 5 minutes', () => {
    expect(CIRCUIT_BREAKER_WINDOW_MS).toBe(300_000);
  });

  it('CIRCUIT_BREAKER_HALF_OPEN_MS is 60 seconds', () => {
    expect(CIRCUIT_BREAKER_HALF_OPEN_MS).toBe(60_000);
  });

  it('window is longer than half-open delay', () => {
    expect(CIRCUIT_BREAKER_WINDOW_MS).toBeGreaterThan(CIRCUIT_BREAKER_HALF_OPEN_MS);
  });
});

describe('Webhook retry timing', () => {
  it('WEBHOOK_RETRY_MAX_DELAY_MS is 60 seconds', () => {
    expect(WEBHOOK_RETRY_MAX_DELAY_MS).toBe(60_000);
  });
});

describe('Generation agent step timeout (PF-916, #8826)', () => {
  // The maxDuration (seconds) every generate route actually declares today.
  // 10 of the 13 standard routes run at 60s; localize 120s; model + music 180s.
  const ALL_ROUTE_MAX_DURATIONS_S = [60, 120, 180];

  it('GENERATION_AGENT_TIMEOUT_BUFFER_MS is a positive margin', () => {
    expect(GENERATION_AGENT_TIMEOUT_BUFFER_MS).toBeGreaterThan(0);
  });

  it('base step cap is enforceable on the SHORTEST (60s) route — the old 150s bug', () => {
    // Regression: the old constant was 150_000, larger than the 60s budget of
    // ~10 of the 13 routes, so the abort could NEVER fire there. The base cap
    // must now fit inside the standard 60s route minus the buffer.
    const standardBudgetMs =
      API_MAX_DURATION_STANDARD_GEN_S * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS;
    expect(GENERATION_AGENT_STEP_TIMEOUT_MS).toBeLessThanOrEqual(standardBudgetMs);
    expect(GENERATION_AGENT_STEP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GENERATION_AGENT_STEP_TIMEOUT_MS).toBe(55_000);
  });

  it('derives a cap that fires before maxDuration on EVERY real route', () => {
    for (const maxDurationS of ALL_ROUTE_MAX_DURATIONS_S) {
      const derived = deriveGenerationStepTimeoutMs(maxDurationS);
      // Strictly less than the function budget so the abort + refund run first.
      expect(derived).toBeLessThan(maxDurationS * 1000);
      // And leaves at least the full buffer of headroom.
      expect(maxDurationS * 1000 - derived).toBeGreaterThanOrEqual(
        GENERATION_AGENT_TIMEOUT_BUFFER_MS,
      );
      expect(derived).toBeGreaterThan(0);
    }
  });

  it('derives a LONGER cap from a longer route budget — not clamped to the 60s base (#8833)', () => {
    // Regression: localize (120s) and model/music (180s) declare a longer
    // maxDuration because their single provider call legitimately runs longer.
    // The derived cap must be each route's OWN budget, NOT the 55s base — else a
    // valid long job is aborted early and refunded spuriously.
    expect(deriveGenerationStepTimeoutMs(120)).toBe(
      120 * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS,
    );
    expect(deriveGenerationStepTimeoutMs(180)).toBe(
      180 * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS,
    );
    // And both exceed the 60s-route base, proving the old clamp is gone.
    expect(deriveGenerationStepTimeoutMs(120)).toBeGreaterThan(GENERATION_AGENT_STEP_TIMEOUT_MS);
    expect(deriveGenerationStepTimeoutMs(180)).toBeGreaterThan(GENERATION_AGENT_STEP_TIMEOUT_MS);
  });

  it('the 60s standard route derives exactly the base cap', () => {
    // The base constant IS the 60s route budget, so a 60s route lands on it.
    expect(deriveGenerationStepTimeoutMs(60)).toBe(GENERATION_AGENT_STEP_TIMEOUT_MS);
  });

  it('derives a short route to its own (smaller) budget', () => {
    // A hypothetical 30s route: budget 25s < base 55s.
    expect(deriveGenerationStepTimeoutMs(30)).toBe(
      30 * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS,
    );
  });

  it('honors an explicit configured override, still clamped to the route budget', () => {
    // Override below the route budget is used as-is.
    expect(deriveGenerationStepTimeoutMs(180, 10_000)).toBe(10_000);
    // Override above the route budget is clamped down to the budget.
    expect(deriveGenerationStepTimeoutMs(60, 999_000)).toBe(
      60 * 1000 - GENERATION_AGENT_TIMEOUT_BUFFER_MS,
    );
  });

  it('never returns a non-positive cap even for a pathologically small maxDuration', () => {
    // maxDuration smaller than the buffer would yield a negative raw budget;
    // the derive floors it at 1ms so the timer is always armable.
    expect(deriveGenerationStepTimeoutMs(1)).toBeGreaterThanOrEqual(1);
  });
});
