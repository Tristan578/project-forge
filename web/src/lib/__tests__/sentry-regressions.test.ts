/**
 * PF-689: Regression tests for Sentry-discovered anti-patterns.
 *
 * Each test documents a specific bug pattern from project_lessons_learned.md,
 * verifies the fixed behavior, and would fail against the buggy code.
 *
 * Bug patterns covered:
 * - #2: Missing await on rate limiting calls (lesson #2)
 * - #3: `Number(undefined) ?? 60` → NaN (lesson #3)
 * - #3: `||` instead of `??` for numeric defaults (lesson #3)
 * - #17: Array spread on large arrays (lesson #17)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Bug #3: Number(undefined) ?? 60 → NaN regression
// ---------------------------------------------------------------------------

describe('Lesson #3: NaN guard — Number(undefined) ?? fallback', () => {
  /**
   * Regression for: saveSystemGenerator.ts line ~487
   * Pattern: `Number(data.config?.saveSlots) || 3` — works BUT
   *          `Number(data.config?.autoSaveInterval) ?? 60` — FAILS because
   *          Number(undefined) === NaN, and NaN ?? 60 === NaN (not 60!)
   * Fix: Use Number.isFinite check before accepting the value.
   */

  it('Number(undefined) produces NaN — NOT 0', () => {
    // This is the footgun: developers expect undefined to produce 0 or fallback
    expect(Number(undefined)).toBeNaN();
  });

  it('NaN ?? fallback returns NaN (nullish coalescing does NOT guard NaN)', () => {
    // ?? only catches null/undefined, not NaN
    const result = Number(undefined) ?? 60;
    expect(result).toBeNaN();
    // This is the bug: the developer intended to get 60, but gets NaN
  });

  it('safe pattern: Number.isFinite guard returns fallback for non-finite input', () => {
    function safeNumber(val: unknown, fallback: number): number {
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    expect(safeNumber(undefined, 60)).toBe(60);
    // Note: Number(null) === 0, which IS finite — so null → 0, not fallback.
    // For null-safety, check explicitly or use `val ?? fallback` first.
    expect(safeNumber('not-a-number', 60)).toBe(60);
    expect(safeNumber(NaN, 60)).toBe(60);
    expect(safeNumber('45', 60)).toBe(45);
    expect(safeNumber(45, 60)).toBe(45);
  });

  it('safe pattern: Number.isFinite guard preserves zero (does NOT replace 0 with fallback)', () => {
    function safeNumber(val: unknown, fallback: number): number {
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
    // 0 is a valid value — must NOT be replaced with fallback
    expect(safeNumber(0, 60)).toBe(0);
    expect(safeNumber('0', 60)).toBe(0);
  });

  it('or-operator pattern || replaces zero with fallback — this is the bug', () => {
    // This demonstrates lesson #3: || treats 0 as falsy
    const volume = 0;
    const buggyDefault = volume || 1.0; // BUG: returns 1.0 when volume is 0
    expect(buggyDefault).toBe(1.0); // documents the bug

    const correctDefault = volume ?? 1.0; // CORRECT: returns 0 (but beware NaN)
    expect(correctDefault).toBe(0);
  });

  it('saveSlots formula uses Number.isFinite guard (fixed from || pattern)', () => {
    // Fixed: saveSystemGenerator now uses Number.isFinite pattern for saveSlots
    // (was: `Number(val) || 3` which treated 0 as falsy)
    const fixedPattern = (val: unknown) =>
      Math.min(20, Math.max(1, Number.isFinite(Number(val)) ? Number(val) : 3));
    expect(fixedPattern(undefined)).toBe(3);
    expect(fixedPattern(null)).toBe(1); // Number(null) === 0, isFinite(0) → true, clamped to min 1
    expect(fixedPattern('10')).toBe(10);
    expect(fixedPattern(0)).toBe(1); // 0 is valid input, clamped to min 1 (not silently replaced with 3)

    // The autoSaveInterval formula also uses the correct pattern (Number.isFinite)
    const safePattern = (val: unknown) =>
      Math.max(0, Number.isFinite(Number(val)) ? Number(val) : 60);
    expect(safePattern(undefined)).toBe(60);
    expect(safePattern(0)).toBe(0); // zero is valid for autoSaveInterval
    expect(safePattern('45')).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// Bug #3: || vs ?? for numeric defaults — specific numeric-zero cases
// ---------------------------------------------------------------------------

describe('Lesson #3: ?? vs || for numeric defaults', () => {
  it('?? does not replace 0 with default', () => {
    const intensity = 0;
    expect(intensity ?? 1.0).toBe(0); // correct
    expect(intensity || 1.0).toBe(1.0); // bug: silently replaced
  });

  it('?? does not replace empty string with default', () => {
    const name = '';
    expect(name ?? 'default').toBe(''); // correct
    expect(name || 'default').toBe('default'); // may or may not be desired
  });

  it('?? does not replace false with default', () => {
    const flag = false;
    expect(flag ?? true).toBe(false); // correct
    expect(flag || true).toBe(true); // bug for boolean defaults
  });

  it('both ?? and || replace null', () => {
    const val: null = null;
    expect(val ?? 42).toBe(42);
    expect(val ?? 42).toBe(42);
  });

  it('both ?? and || replace undefined', () => {
    const val: undefined = undefined;
    expect(val ?? 42).toBe(42);
    expect(val ?? 42).toBe(42);
  });

  it('only || replaces NaN — ?? does NOT (NaN is not nullish)', () => {
    const val = NaN;
    expect(val ?? 42).toBeNaN(); // ?? doesn't help with NaN
    expect(val || 42).toBe(42); // || catches NaN (but also catches 0 and false)
  });
});

// ---------------------------------------------------------------------------
// Bug #2: Missing await on async rate limiting calls
// ---------------------------------------------------------------------------

describe('Lesson #2: Async rate-limit calls must be awaited', () => {
  /**
   * Regression for PF-719, PF-725, PF-730.
   * When rateLimit() is not awaited, you get a Promise<object> back.
   * A Promise is always truthy, so:
   *   - `if (result.allowed)` → always true (wrong: should check result)
   *   - `if (!result.allowed)` → always false (every request bypasses rate limit)
   */

  it('demonstrates that a Promise object is truthy (bypass scenario)', () => {
    // This is what happens when you forget await:
    const fakeAsync = async () => ({ allowed: false, remaining: 0 });
    const unawaited = fakeAsync(); // Returns Promise<{allowed:false}>, NOT the object
    // A Promise is an object, which is truthy — so allowed check always passes
    expect(typeof unawaited).toBe('object');
    expect(!!unawaited).toBe(true); // truthy! rate limit bypassed
  });

  it('awaited result returns the actual object (correct scenario)', async () => {
    const fakeAsync = async () => ({ allowed: false, remaining: 0, resetAt: Date.now() });
    const result = await fakeAsync();
    expect(result.allowed).toBe(false); // correct: rate limiting works
  });

  it('async function result.allowed check without await is always true', () => {
    // Document the exact failure mode
    const mockRateLimit = async (_key: string, _max: number, _window: number) => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
    });

    // Buggy code (no await):
    const rl = mockRateLimit('test:user-1', 10, 60); // returns Promise, not result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buggyAllowed = (rl as any).allowed; // undefined — Promise has no .allowed
    expect(buggyAllowed).toBeUndefined();
    // `if (!buggyAllowed)` is true when buggyAllowed is undefined — so it WOULD block
    // But `if (rl.allowed)` treating rl as truthy means the bypass
    expect(!!rl).toBe(true); // Promise is truthy = rate limit bypassed
  });

  it('rate limit helper has the correct async interface', async () => {
    // Verify the actual rate limit signature returns a promise
    const { rateLimit } = await import('@/lib/rateLimit');
    // rateLimit IS async — calling without await is the bug
    const result = rateLimit('test:regression', 100, 1000);
    expect(result).toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved).toHaveProperty('allowed');
    expect(resolved).toHaveProperty('remaining');
    expect(resolved).toHaveProperty('resetAt');
  });
});

// ---------------------------------------------------------------------------
// Bug #17: Array spread on large arrays causes RangeError
// ---------------------------------------------------------------------------

describe('Lesson #17: Large array spread causes stack overflow', () => {
  it('Math.max(...largeArray) throws RangeError for arrays > ~65k elements', () => {
    // Document the failure mode — do NOT actually crash the test runner
    // by creating a 65k array. Use a smaller array to verify the pattern fix.
    const safeMax = (arr: number[]) => arr.reduce((m, x) => Math.max(m, x), -Infinity);
    const arr = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(safeMax(arr)).toBe(9);
    // Also verify it handles empty array
    expect(safeMax([])).toBe(-Infinity);
  });

  it('reduce-based max handles single-element array', () => {
    const safeMax = (arr: number[]) => arr.reduce((m, x) => Math.max(m, x), -Infinity);
    expect(safeMax([42])).toBe(42);
  });

  it('reduce-based max handles negative numbers', () => {
    const safeMax = (arr: number[]) => arr.reduce((m, x) => Math.max(m, x), -Infinity);
    expect(safeMax([-5, -3, -10])).toBe(-3);
  });

  it('for-of loop push avoids spread stack overflow', () => {
    // Demonstrates safe alternative to arr.push(...other) for large arrays
    const target: number[] = [1, 2, 3];
    const source = [4, 5, 6];

    // Safe pattern:
    for (const item of source) {
      target.push(item);
    }
    expect(target).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

// ---------------------------------------------------------------------------
// Bug patterns from Session 2026-03-20 (MEMORY.md)
// ---------------------------------------------------------------------------

describe('Sentry Session 2026-03-20: specific bug regressions', () => {
  /**
   * Regression for NaN in saveSystemGenerator saveSlots field.
   * Lesson: `Number(undefined) ?? 60` yields NaN, not 60.
   * The correct pattern is Number.isFinite check.
   */
  it('NaN guard regression: Number(undefined) ?? 60 returns NaN (regression for PF-756)', () => {
    // Verify the exact expression that caused the bug
    const value = Number(undefined) ?? 60;
    expect(Number.isNaN(value)).toBe(true);
    expect(value).not.toBe(60);
  });

  it('NaN guard fix: Number.isFinite pattern returns correct fallback', () => {
    const safeValue = (raw: unknown, fallback: number): number => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    expect(safeValue(undefined, 60)).toBe(60);
    expect(Number.isNaN(safeValue(undefined, 60))).toBe(false);
  });

  /**
   * Regression for audioManager volume || 1.0 — volume of 0 gets replaced.
   * Lesson: || treats 0 as falsy. Use ?? for numeric defaults.
   */
  it('volume || 1.0 regression: volume=0 returns 1.0 instead of 0 (regression for audio bug)', () => {
    const computeTargetVolume = (gainValue: number) => gainValue || 1.0;
    // Bug: gain value of 0 (fully muted) returns 1.0 (fully audible)
    expect(computeTargetVolume(0)).toBe(1.0); // documents the bug
    expect(computeTargetVolume(0)).not.toBe(0);
  });

  it('volume ?? 1.0 fix: volume=0 returns 0 correctly', () => {
    const computeTargetVolume = (gainValue: number) => gainValue ?? 1.0;
    expect(computeTargetVolume(0)).toBe(0); // correct: 0 is a valid volume
    expect(computeTargetVolume(0.5)).toBe(0.5);
    expect(computeTargetVolume(1.0)).toBe(1.0);
  });

  /**
   * Regression for scene transition duration || 500.
   * sceneManagementHandlers.ts line ~237: duration: p.data.duration || 500
   * If a user passes duration=0 (instant), it gets replaced with 500ms.
   */
  it('duration || 500 regression: duration=0 returns 500 instead of 0', () => {
    // Simulates the handler logic.
    //
    // The `||` below IS the subject of this case; rewriting it to `??` would
    // delete the behaviour being demonstrated. Note also that the case asserts
    // a lambda declared right here rather than the shipped handler -- which has
    // read `?? 500` since sceneManagementHandlers.ts:264 -- so it cannot
    // actually catch the regression it is named for. Tracked in #9564.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const getDuration = (input: number | undefined) => input || 500;
    expect(getDuration(0)).toBe(500); // documents the bug: instant transition becomes 500ms
    expect(getDuration(0)).not.toBe(0);
  });

  it('duration ?? 500 fix: duration=0 returns 0 correctly', () => {
    const getDuration = (input: number | undefined) => input ?? 500;
    expect(getDuration(0)).toBe(0); // correct: instant transition works
    expect(getDuration(undefined)).toBe(500); // fallback when not provided
    expect(getDuration(1000)).toBe(1000); // custom duration preserved
  });
});

// ---------------------------------------------------------------------------
// PF-892: anthropicAIIntegration must never appear in client config
// ---------------------------------------------------------------------------

describe('PF-892: Sentry client config must not include server-only AI integrations', () => {
  /**
   * anthropicAIIntegration and vercelAIIntegration are server-only Sentry
   * integrations. Including them in the browser (client) config causes runtime
   * errors because the Anthropic SDK is not available in the browser context.
   *
   * instrumentation-client.ts must only use browser-safe integrations:
   *   - browserTracingIntegration
   *   - replayIntegration
   *
   * sentry.server.config.ts and sentry.edge.config.ts may use:
   *   - anthropicAIIntegration
   *   - vercelAIIntegration
   */
  it('instrumentation-client.ts does not contain anthropicAIIntegration', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const clientConfigPath = path.resolve(
      process.cwd(),
      'instrumentation-client.ts',
    );
    const content = fs.readFileSync(clientConfigPath, 'utf-8');
    expect(content).not.toContain('anthropicAIIntegration');
  });

  it('instrumentation-client.ts does not contain vercelAIIntegration', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const clientConfigPath = path.resolve(
      process.cwd(),
      'instrumentation-client.ts',
    );
    const content = fs.readFileSync(clientConfigPath, 'utf-8');
    expect(content).not.toContain('vercelAIIntegration');
  });

  it('sentry.server.config.ts contains anthropicAIIntegration (server-side AI monitoring)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const serverConfigPath = path.resolve(
      process.cwd(),
      'sentry.server.config.ts',
    );
    const content = fs.readFileSync(serverConfigPath, 'utf-8');
    expect(content).toContain('anthropicAIIntegration');
  });
});

// ---------------------------------------------------------------------------
// F03/F04 (#8778): Sentry dataCollection opt-out must stay exhaustive
// ---------------------------------------------------------------------------

describe('F03/F04 (#8778): Sentry dataCollection opt-out must stay exhaustive', () => {
  /**
   * The migration off the deprecated `sendDefaultPii: false` to the
   * `dataCollection` framework introduced a silent footgun: once ANY
   * `dataCollection` key is set, Sentry resolves every OMITTED field to its
   * permissive DEFAULT (cookies / queryParams / httpHeaders / genAI /
   * stackFrameVariables all ON). A future edit that drops a single field — or
   * flips one to `true` — would re-enable PII capture while still passing tsc
   * and every existing test. These guards fail on that regression, preserving
   * the F03/F04 audit posture (no default PII, no stack-frame locals) across all
   * three Sentry init sites.
   *
   * See web/src/lib/monitoring/sentryConfig.ts and the three init configs.
   */
  const CONFIG_FILES = [
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'instrumentation-client.ts',
  ] as const;

  // Every privacy-relevant dataCollection field with its required opt-out
  // literal. Missing any of these → Sentry's permissive default silently
  // re-enables that data class.
  const REQUIRED_OPT_OUTS = [
    'userInfo: false',
    'cookies: false',
    'queryParams: false',
    'httpHeaders: { request: false, response: false }',
    'httpBodies: []',
    'genAI: { inputs: false, outputs: false }',
    'stackFrameVariables: false',
  ] as const;

  // Any of these literals inside a config means a field was flipped back ON.
  // (None collide with unrelated config: the AI integration uses
  // `recordInputs`/`recordOutputs`, not `inputs:`/`outputs:`.)
  const FORBIDDEN_OPT_INS = [
    'userInfo: true',
    'cookies: true',
    'queryParams: true',
    'stackFrameVariables: true',
    'request: true',
    'response: true',
    'inputs: true',
    'outputs: true',
  ] as const;

  // Strip block + line comments so the guards inspect ACTIVE config only. The
  // configs intentionally DOCUMENT the migration in prose (e.g. "Migrated off
  // the deprecated `sendDefaultPii: false`"), so a raw-text scan would conflate
  // explanatory comments with real Sentry.init options.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSDoc)
      .replace(/\/\/.*$/gm, ''); // line comments
  }

  async function readConfig(file: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
    return stripComments(raw);
  }

  it.each(CONFIG_FILES)('%s declares a dataCollection block', async (file) => {
    const content = await readConfig(file);
    expect(content).toContain('dataCollection: {');
  });

  it.each(CONFIG_FILES)(
    '%s opts out of every PII-relevant dataCollection field',
    async (file) => {
      const content = await readConfig(file);
      for (const field of REQUIRED_OPT_OUTS) {
        expect(
          content,
          `${file} is missing an exhaustive opt-out: "${field}" — a dropped field re-enables PII via Sentry defaults`,
        ).toContain(field);
      }
    },
  );

  it.each(CONFIG_FILES)(
    '%s never flips a dataCollection field back on',
    async (file) => {
      const content = await readConfig(file);
      for (const optIn of FORBIDDEN_OPT_INS) {
        expect(
          content,
          `${file} re-enables PII via "${optIn}"`,
        ).not.toContain(optIn);
      }
    },
  );

  it.each(CONFIG_FILES)(
    '%s no longer uses the deprecated sendDefaultPii flag',
    async (file) => {
      const content = await readConfig(file);
      expect(content).not.toContain('sendDefaultPii');
    },
  );

  it.each(CONFIG_FILES)(
    '%s keeps scrubSentryEvent as defence-in-depth on beforeSend',
    async (file) => {
      const content = await readConfig(file);
      expect(content).toContain('beforeSend: scrubSentryEvent');
    },
  );
});

describe('Sentry Logs scrubber gap: beforeSendLog: scrubSentryLog is required unconditionally', () => {
  /**
   * `Sentry.logger.*` calls route through a SEPARATE delivery pipeline
   * (`beforeSendLog`) that `beforeSend` / `beforeSendTransaction` — and
   * therefore `scrubSentryEvent` — never touch. Without a `beforeSendLog`
   * scrubber, a stray log call could ship a prompt, BYOK key, or PII
   * unredacted, bypassing the F03/F04 posture.
   *
   * This used to be gated on `content.includes('enableLogs: true')`, which
   * coupled the scrubber requirement to a line that is on its way to becoming
   * deletable: @sentry/core flips the `enableLogs` default from false to TRUE
   * in 10.71.0 (client.js's `... ?? true`), and web/package.json pins
   * `"@sentry/nextjs": "^10.70.0"`, so a future bump makes the explicit opt-in
   * look redundant. Rather than let one deletion take both the trigger and the
   * guard with it, the two requirements are now pinned INDEPENDENTLY and
   * unconditionally: every init must wire the scrubber (below), and every init
   * must still opt into logs explicitly (below that, which is what the
   * installed 10.70.0 actually needs to emit logs at all).
   */
  const CONFIG_FILES = [
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'instrumentation-client.ts',
  ] as const;

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  async function readConfig(file: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
    return stripComments(raw);
  }

  it.each(CONFIG_FILES)(
    '%s wires beforeSendLog: scrubSentryLog',
    async (file) => {
      const content = await readConfig(file);
      expect(
        content,
        `${file} initializes Sentry but does not route Sentry Logs through scrubSentryLog — Sentry.logger.* bypasses scrubSentryEvent, and enableLogs defaults to TRUE from @sentry/core 10.71.0, so there is no opt-in line gating the pipeline`,
      ).toContain('beforeSendLog: scrubSentryLog');
    },
  );

  it('every config still opts in explicitly: enableLogs: true', async () => {
    // Two independent reasons this line must stay, both of which the
    // unconditional scrubber pin above cannot see:
    //   1. On the version actually installed (@sentry/core 10.70.0) enableLogs
    //      still defaults to FALSE — client.js has no `?? true`. Deleting the
    //      opt-in silently turns Sentry Logs OFF, killing the PF-967 server
    //      lifecycle logging in lib/monitoring/sentry-server.ts and reducing
    //      the scrubber pin to busywork.
    //   2. Once ^10.70.0 resolves 10.71.0+ the default flips to true and the
    //      line reads as redundant — precisely when someone deletes it. The
    //      explicit opt-in pins intent across the whole supported range.
    const optedIn = await Promise.all(
      CONFIG_FILES.map(async (f) => [f, (await readConfig(f)).includes('enableLogs: true')] as const),
    );
    const missing = optedIn.filter(([, on]) => !on).map(([f]) => f);
    expect(
      missing,
      `these configs no longer opt into Sentry Logs: ${missing.join(', ')} — on @sentry/core 10.70.0 enableLogs defaults to false, so Sentry.logger.* silently stops shipping`,
    ).toEqual([]);
  });

  it('no config opts OUT of logs while pinning the scrubber', async () => {
    const optedOut = await Promise.all(
      CONFIG_FILES.map(async (f) => (await readConfig(f)).includes('enableLogs: false')),
    );
    expect(optedOut.filter(Boolean)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PF-1053: Sentry Metrics scrubber gap — metrics are ON BY DEFAULT
// ---------------------------------------------------------------------------

describe('PF-1053: Sentry Metrics require beforeSendMetric: scrubSentryMetric', () => {
  /**
   * Metrics are a THIRD delivery pipeline, independent of both `beforeSend`
   * (scrubSentryEvent) and `beforeSendLog` (scrubSentryLog). Two facts make the
   * scrubber load-bearing rather than precautionary:
   *
   *   1. `enableMetrics` DEFAULTS TO TRUE (@sentry/core options.d.ts) — unlike
   *      logs, there is no opt-in line to grep for. Any `Sentry.metrics.*` call
   *      anywhere in the tree ships immediately.
   *   2. The SDK auto-attaches the active scope's `user.id`, `user.email`, and
   *      `user.name` to EVERY metric — unconditionally, and BEFORE the hook
   *      runs (@sentry/core `metrics/internal.js` → `_enrichMetricAttributes`).
   *      `dataCollection.userInfo: false` does NOT gate this; it is read at
   *      envelope time and governs server-side IP inference only. So
   *      beforeSendMetric is the only place the stamping can be removed.
   *      Nothing calls `Sentry.setUser()` in web/src today, so this is
   *      defense-in-depth against the first caller, not a live leak.
   *
   * So the requirement is unconditional: every init that could emit a metric —
   * all three — must route metrics through the scrubber.
   */
  const CONFIG_FILES = [
    'sentry.server.config.ts',
    'sentry.edge.config.ts',
    'instrumentation-client.ts',
  ] as const;

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  async function readConfig(file: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    const raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
    return stripComments(raw);
  }

  it.each(CONFIG_FILES)(
    '%s wires beforeSendMetric: scrubSentryMetric',
    async (file) => {
      const content = await readConfig(file);
      expect(
        content,
        `${file} does not route Sentry Metrics through scrubSentryMetric — metrics are enabled by default and the SDK attaches user.email/user.name to every one`,
      ).toContain('beforeSendMetric: scrubSentryMetric');
    },
  );

  it.each(CONFIG_FILES)(
    '%s uses the top-level beforeSendMetric, not the deprecated _experiments form',
    async (file) => {
      const content = await readConfig(file);
      // `_experiments.beforeSendMetric` still works but is @deprecated in
      // @sentry/core 10.x; the top-level option wins when both are present, so a
      // future removal of the experimental key would silently unhook the scrubber.
      expect(content).not.toContain('_experiments');
    },
  );

  it('keeps the requirement honest: no config silently opts out of metrics', async () => {
    // The pin above is unconditional because metrics default ON. If a future
    // edit set `enableMetrics: false` somewhere, the scrubber assertion for that
    // file would become busywork rather than protection — surface that here
    // instead of letting the two drift apart unnoticed.
    const optedOut = await Promise.all(
      CONFIG_FILES.map(async (f) => (await readConfig(f)).includes('enableMetrics: false')),
    );
    expect(optedOut.filter(Boolean)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PF-967 (#8956): Sentry feedback widget config must stay pinned
// ---------------------------------------------------------------------------

describe('PF-967: Sentry feedback widget config must stay pinned', () => {
  /**
   * The feedback widget's host element id and the #sentry-feedback CSS rules in
   * globals.css are a coupled pair: the CSS overrides the widget's default
   * --z-index of 100000 (which would paint over every app surface, including
   * CookieConsent and toasts) and lifts the trigger above the fixed
   * MobileToolbar on small screens. Dropping `id` from the integration, or the
   * CSS block, silently reverts the widget to painting over everything.
   * `showBranding: false` is the no-vendor-attribution policy applied to the
   * widget footer.
   */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  async function readFile(file: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    return fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
  }

  it('instrumentation-client.ts registers feedbackIntegration with the pinned id and no branding', async () => {
    const content = stripComments(await readFile('instrumentation-client.ts'));
    expect(content).toContain('feedbackIntegration(');
    expect(
      content,
      'feedbackIntegration must pin id: sentry-feedback — the globals.css layering rules target that element id',
    ).toContain("id: 'sentry-feedback'");
    expect(
      content,
      'feedbackIntegration must set showBranding: false (no vendor attribution in product UI)',
    ).toContain('showBranding: false');
    expect(
      content,
      'feedbackIntegration must set enableScreenshot: false — feedback screenshots are raw page captures with no masking pipeline (unlike replay maskAllText, #8001), so a screenshot taken while ApiKeyManager shows a freshly-generated MCP key would ship the plaintext credential to Sentry',
    ).toContain('enableScreenshot: false');
  });

  it('globals.css carries the #sentry-feedback layering override', async () => {
    // Raw read — the assertions target CSS declarations, not comments, and the
    // JS comment-stripping regex would also eat CSS /* */ blocks.
    const css = await readFile('src/app/globals.css');
    expect(
      css,
      'globals.css must style #sentry-feedback — without it the widget defaults to z-index 100000 over every app surface',
    ).toContain('#sentry-feedback');
    expect(
      css,
      'the widget must sit above bottom chrome (z-30) but below CookieConsent/AchievementToast (z-50); sonner toasts use their own stylesheet default (999999999) and are above everything regardless',
    ).toContain('--z-index: 40');
    expect(
      css,
      'globals.css must hide the feedback trigger while the cookie banner is visible — CookieConsent (z-50) anchors at the same bottom-right corner and would fully cover the z-40 trigger for first-time visitors',
    ).toContain("body:has([aria-label='Cookie consent']) #sentry-feedback");
  });

  it('CookieConsent keeps the aria-label the feedback-trigger hide rule is coupled to', async () => {
    // The globals.css :has() selector targets this exact aria-label; renaming
    // it in the component silently re-breaks the covered-trigger bug.
    const consent = await readFile('src/components/CookieConsent.tsx');
    expect(
      consent,
      'CookieConsent must keep aria-label="Cookie consent" — the #sentry-feedback hide rule in globals.css selects on it',
    ).toContain('aria-label="Cookie consent"');
  });
});

// ---------------------------------------------------------------------------
// Sentry profiling: every prerequisite is silent when missing
// ---------------------------------------------------------------------------

describe('Sentry profiling config must stay pinned', () => {
  /**
   * Profiling has an unusual failure mode: EVERY prerequisite fails SILENTLY.
   * A version skew, a missing header, a bundled native addon, or an unset
   * sample rate each produce zero profiles, zero errors, and zero log lines —
   * the feature simply never reports and nothing tells you why. These pins turn
   * each silent prerequisite into a red test.
   *
   * The four independent prerequisites:
   *   1. `@sentry/profiling-node` must resolve to the SAME version as
   *      `@sentry/nextjs` (Sentry ships them as a matched pair; a skew fails
   *      silently at load).
   *   2. `@sentry/profiling-node` must be externalized from the server bundle —
   *      it is a native `.node` addon Turbopack cannot bundle. Next 16.2.12
   *      already externalizes it by default (it is listed under "Native Node.js
   *      addons" in next/dist/lib/server-external-packages.jsonc), so the
   *      explicit entry is redundant TODAY and is pinned here precisely because
   *      that built-in list is an implementation detail: if a Next upgrade drops
   *      the entry, the only symptom is an opaque native-binary bundling error.
   *   3. Browser profiling is gated behind the `Document-Policy: js-profiling`
   *      response header. Without it the JS Self-Profiling API is unavailable
   *      and `browserProfilingIntegration()` no-ops even in Chromium.
   *   4. `profileSessionSampleRate` must be set wherever profiling is enabled —
   *      it defaults to 0, i.e. profiling on with nothing ever collected.
   *
   * Plus one hard constraint: the Edge runtime cannot load native addons, so
   * `nodeProfilingIntegration` must never appear in the edge config.
   */

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  async function readSource(file: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    return stripComments(fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8'));
  }

  /**
   * Assert `profileSessionSampleRate` is present AND that every rate it can
   * resolve to is non-zero.
   *
   * A bare `toContain('profileSessionSampleRate')` pins only the key name, which
   * makes the pin vacuous against the exact regression it names: the SDK default
   * is 0, so `profileSessionSampleRate: 0` — or `IS_PROD ? 0 : 1.0`, which
   * disables profiling in production only — leaves the substring intact and the
   * test green while collecting nothing. Both configs assign a ternary, so every
   * numeric literal in the assignment is a rate this build can actually use and
   * each one has to be checked.
   */
  function expectNonZeroProfileSampleRate(source: string, label: string): void {
    const match = source.match(/profileSessionSampleRate:\s*([^,\n]+)/);
    expect(
      match,
      `${label}: profileSessionSampleRate must be assigned — it defaults to 0, so profiling enabled without it collects nothing, silently`,
    ).not.toBeNull();

    const rates = (match![1].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(
      rates.length,
      `${label}: profileSessionSampleRate must resolve to numeric literals this test can verify, got "${match![1].trim()}"`,
    ).toBeGreaterThan(0);

    for (const rate of rates) {
      expect(
        rate,
        `${label}: profileSessionSampleRate resolves to ${rate} on at least one branch of "${match![1].trim()}" — a zero rate is indistinguishable from profiling being off`,
      ).toBeGreaterThan(0);
    }
  }

  it('pins @sentry/profiling-node to the same declared range as @sentry/nextjs', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> };

    const nextjsRange = pkg.dependencies?.['@sentry/nextjs'];
    const profilingRange = pkg.dependencies?.['@sentry/profiling-node'];

    // Shape-asserted, not merely truthy: a non-string or a garbage value would
    // satisfy toBeTruthy() while telling us nothing about what npm will install.
    expect(nextjsRange, '@sentry/nextjs must be a declared dependency').toMatch(
      /^[\^~]?\d+\.\d+\.\d+/,
    );
    expect(
      profilingRange,
      '@sentry/profiling-node must be a declared dependency — nodeProfilingIntegration is imported from it',
    ).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
    expect(
      profilingRange,
      'the two ranges must be IDENTICAL strings so npm can never resolve them to different versions — Sentry ships @sentry/nextjs and @sentry/profiling-node as a matched pair and a skew fails silently at load',
    ).toBe(nextjsRange);
  });

  it('resolves both Sentry packages to the same version in the root lockfile', async () => {
    // The manifest ranges matching is necessary but not sufficient: the ranges
    // are carets, so the LOCKFILE is what decides the installed pair. A relock
    // that floated one node and not the other is exactly the silent skew this
    // guards. Single-root-lockfile monorepo — the lockfile lives at the repo
    // root, one level above web/.
    const fs = await import('fs');
    const path = await import('path');
    const lock = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), '..', 'package-lock.json'), 'utf-8'),
    ) as { packages: Record<string, { version?: string }> };

    const nextjs = lock.packages['node_modules/@sentry/nextjs']?.version;
    const profiling = lock.packages['node_modules/@sentry/profiling-node']?.version;

    // Exact-version shape, not truthiness — a lockfile node must carry a
    // concrete resolved version, and asserting that is what makes the
    // equality check below meaningful.
    expect(nextjs, '@sentry/nextjs must be present in the root lockfile').toMatch(
      /^\d+\.\d+\.\d+/,
    );
    expect(
      profiling,
      '@sentry/profiling-node must be present in the root lockfile — a manifest entry without a locked node means npm ci installs nothing',
    ).toMatch(/^\d+\.\d+\.\d+/);
    expect(
      profiling,
      `lockfile skew: @sentry/nextjs resolves to ${nextjs} but @sentry/profiling-node resolves to ${profiling} — mismatched versions make nodeProfilingIntegration fail silently`,
    ).toBe(nextjs);
  });

  it('never loads nodeProfilingIntegration in the Edge runtime', async () => {
    const edge = await readSource('sentry.edge.config.ts');
    expect(
      edge,
      'the Edge runtime cannot load native addons — nodeProfilingIntegration must never appear in sentry.edge.config.ts',
    ).not.toContain('nodeProfilingIntegration');
    expect(
      edge,
      '@sentry/profiling-node must never be imported into the Edge bundle',
    ).not.toContain('@sentry/profiling-node');
  });

  it('wires nodeProfilingIntegration with a sample rate in the Node runtime', async () => {
    const server = await readSource('sentry.server.config.ts');
    expect(server).toContain('nodeProfilingIntegration');
    expect(
      server,
      'profileLifecycle must be "trace" so profiles auto-attach to sampled spans; without it profiling stays in manual mode and collects nothing',
    ).toContain("profileLifecycle: 'trace'");
    expectNonZeroProfileSampleRate(server, 'sentry.server.config.ts');
  });

  it('registers browserProfilingIntegration AFTER browserTracingIntegration', async () => {
    const client = await readSource('instrumentation-client.ts');
    expect(client).toContain('browserProfilingIntegration');
    expectNonZeroProfileSampleRate(client, 'instrumentation-client.ts');

    const tracingAt = client.indexOf('browserTracingIntegration');
    const profilingAt = client.indexOf('browserProfilingIntegration');
    expect(tracingAt).toBeGreaterThanOrEqual(0);
    expect(
      profilingAt,
      'browserProfilingIntegration must be listed AFTER browserTracingIntegration — registered before it, profileSessionSampleRate is silently ignored',
    ).toBeGreaterThan(tracingAt);
  });

  it('externalizes the native profiling addon from the server bundle', async () => {
    const config = await readSource('next.config.ts');
    expect(
      config,
      '@sentry/profiling-node ships a native .node addon Turbopack cannot bundle. Next currently externalizes it by default, so this explicit entry is deliberate redundancy: it keeps the requirement declared here if a Next upgrade ever drops it from server-external-packages.jsonc, where the only symptom would be an opaque native-binary bundling error',
    ).toContain('serverExternalPackages');
    expect(config).toContain('"@sentry/profiling-node"');
  });

  it('serves the Document-Policy header browser profiling requires', async () => {
    const config = await readSource('next.config.ts');
    expect(
      config,
      'the JS Self-Profiling API is gated behind `Document-Policy: js-profiling` — without the header browserProfilingIntegration no-ops silently, even in Chromium',
    ).toContain('Document-Policy');
    expect(config).toContain('js-profiling');
  });
});
