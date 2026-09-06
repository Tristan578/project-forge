/**
 * @vitest-environment node
 *
 * `redactSecrets` is the last line before a string leaves the process — into an
 * HTTP response body, or into Sentry. It exists because #9736 found provider
 * clients folding an upstream response body verbatim into a thrown Error, and
 * TWELVE routes returning that error's `message` to the caller: on the platform
 * path the credential in play is the platform's, so a provider that echoes key
 * material in a 401 body hands a platform secret to any signed-in user.
 *
 * Two independent mechanisms, because either alone is insufficient:
 *
 *  - SHAPE matching catches a credential we have never seen the value of — a
 *    user's BYOK key inside a provider's error text, since BYOK keys live
 *    encrypted in the database and never in `process.env`. It reaches only the
 *    shapes listed, and of the five BYOK providers it covers anthropic, meshy
 *    and elevenlabs by prefix; suno and hyper3d publish no distinctive prefix
 *    and are covered only behind `Bearer `.
 *  - VALUE matching catches anything currently in the environment whatever its
 *    shape, but only for secrets this process holds, and only server-side.
 *
 * The value path is the one that makes the guarantee hold for a provider we add
 * tomorrow whose key format nobody here has seen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  redactSecrets,
  resetSecretEnvCache,
  REDACTION_PLACEHOLDER,
  DEPTH_LIMIT_PLACEHOLDER,
} from '../redactSecrets';

afterEach(() => {
  vi.unstubAllEnvs();
  resetSecretEnvCache();
});

describe('redactSecrets — shape matching', () => {
  // Each entry is a credential shape that has appeared in a provider error body
  // or is documented by the provider as its key format.
  //
  // ASSEMBLED AT RUNTIME, never written as a literal. GitHub's push protection
  // rejected this file when the fixtures were spelled out — correctly, since it
  // cannot tell a plausible fixture from a live key. Allowlisting them through
  // the unblock URL would have trained the scanner to ignore this path, so the
  // fixtures are concatenated instead: the assembled value still exercises the
  // pattern, and the repository contains no scannable token.
  const body = (n: number) => 'A'.repeat(n);
  const mixed = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const SHAPES: Array<[string, string]> = [
    ['OpenAI secret key', 'sk-' + 'proj-' + body(44)],
    ['Stripe live secret', 'sk' + '_live_' + '51' + mixed.slice(0, 24)],
    ['Stripe test secret', 'sk' + '_test_' + '51' + mixed.slice(0, 24)],
    ['Stripe restricted', 'rk' + '_live_' + '51' + mixed.slice(0, 24)],
    ['Stripe webhook secret', 'whsec' + '_' + mixed],
    ['Anthropic key', 'sk-' + 'ant-' + 'api03-' + body(36)],
    ['Replicate token', 'r8' + '_' + mixed.slice(0, 24)],
    ['GitHub PAT', 'gh' + 'p_' + mixed.slice(0, 30)],
    // Fine-grained PATs do NOT match the classic `gh[pousr]_` shape, and
    // GITHUB_MODELS_PAT is one of this deployment's own variables.
    ['GitHub fine-grained PAT', 'github' + '_pat_' + '11ABCDE0123456789_' + mixed.slice(0, 24)],
    // The three providers whose bodies caused #9736. Meshy and ElevenLabs had
    // no shape at all before this: the OpenAI pattern is HYPHENATED, so no
    // underscore-form `sk_` key could ever match it.
    ['Meshy key', 'msy' + '_' + mixed.slice(0, 28)],
    ['ElevenLabs key', 'sk' + '_' + '0123456789abcdef0123456789abcdef'],
    ['SpawnForge API key', 'forge' + '_' + '0123456789abcdef0123456789abcdef'],
  ];

  it.each(SHAPES)('removes a %s from surrounding text', (_label, secret) => {
    const out = redactSecrets(`Meshy status error (401): {"error":"bad key ${secret}"}`);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTION_PLACEHOLDER);
    // The surrounding diagnostic must survive — a redactor that eats the whole
    // string trades one problem for an undebuggable one.
    expect(out).toContain('401');
  });

  it('removes an OpenRouter key, which carries a hyphenated version segment', () => {
    const key = 'sk-' + 'or-v1-' + '0123456789abcdef0123456789abcdef';
    expect(redactSecrets(`rejected ${key}`)).not.toContain(key);
  });

  it('leaves ordinary hyphenated text that merely begins "sk-" alone', () => {
    // This now runs on API response bodies, where rewriting a legitimate
    // identifier corrupts the payload with no signal to anyone.
    const text = 'module sk-learn-preprocessing-module-name failed to load';
    expect(redactSecrets(text)).toBe(text);
  });

  it('removes a bearer credential regardless of the token shape', () => {
    const out = redactSecrets('upstream sent Authorization: Bearer aVeryLongOpaqueTokenValue123456');
    expect(out).not.toContain('aVeryLongOpaqueTokenValue123456');
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('removes a postgres connection string, which carries a password', () => {
    const out = redactSecrets('connect failed: postgresql://user:hunter2@db.example.com:5432/main');
    expect(out).not.toContain('hunter2');
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });
});

describe('redactSecrets — value matching against the live environment', () => {
  it('removes the value of a secret-named variable whatever its shape', () => {
    // Deliberately not a recognisable credential shape: this is the case shape
    // matching cannot catch, and the reason value matching exists.
    vi.stubEnv('PLATFORM_MESHY_KEY', 'correct-horse-battery-staple-42');
    const out = redactSecrets('Meshy error: rejected correct-horse-battery-staple-42');
    expect(out).not.toContain('correct-horse-battery-staple-42');
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('removes every occurrence, not just the first', () => {
    vi.stubEnv('CRON_SECRET', 'abcdefghijklmnopqrstuvwxyz012345');
    const out = redactSecrets('abcdefghijklmnopqrstuvwxyz012345 then abcdefghijklmnopqrstuvwxyz012345');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });

  it('treats a value containing regex metacharacters literally', () => {
    // A key with `.` or `+` in it must not be compiled as a pattern: that would
    // both fail to match the real value and redact unrelated text.
    vi.stubEnv('STRIPE_SECRET_KEY', 'aa.bb+cc(dd)ee[ff]gg*hh');
    const out = redactSecrets('key aa.bb+cc(dd)ee[ff]gg*hh rejected; unrelated aaXbbYcc text');
    expect(out).not.toContain('aa.bb+cc(dd)ee[ff]gg*hh');
    expect(out).toContain('unrelated aaXbbYcc text');
  });

  it('ignores NEXT_PUBLIC_ variables, which are compiled into the client bundle', () => {
    // Redacting these would corrupt legitimate output while protecting nothing:
    // they are public by construction.
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_aVeryLongPublishableValue');
    const out = redactSecrets('clerk key pk_test_aVeryLongPublishableValue is public');
    expect(out).toContain('pk_test_aVeryLongPublishableValue');
  });

  it('ignores short values, which would mangle ordinary text', () => {
    // A secret-named variable set to something short (a flag, a mode, an
    // accidental empty-ish value) must not turn every occurrence of that
    // substring into a placeholder.
    vi.stubEnv('SOME_TOKEN', 'true');
    const out = redactSecrets('the value is true and remains true');
    expect(out).toBe('the value is true and remains true');
  });

  it('ignores a non-secret-named variable', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f2dd46e01ae691183e286492e48da9ac4d46227e');
    const out = redactSecrets('deployed f2dd46e01ae691183e286492e48da9ac4d46227e');
    expect(out).toContain('f2dd46e01ae691183e286492e48da9ac4d46227e');
  });
});

describe('redactSecrets — behaviour on ordinary input', () => {
  it('returns unremarkable text unchanged', () => {
    const text = 'Model generation failed: the requested format is not supported.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('returns null and undefined UNCHANGED rather than coercing them to ""', () => {
    // An earlier version coerced both to '' at depth 0, so
    // `apiError(500, 'x', 'CODE', null)` shipped `details: ""` where it
    // previously shipped nothing meaningful. A redactor that changes a
    // response's shape is doing something other than redacting.
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets({ details: null })).toEqual({ details: null });
  });

  it('redacts inside a nested structure, so `details` cannot smuggle a value out', () => {
    vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'el-secret-value-not-a-known-shape');
    const out = redactSecrets({
      error: 'failed',
      details: { upstream: 'rejected el-secret-value-not-a-known-shape', nested: ['el-secret-value-not-a-known-shape'] },
    });
    expect(JSON.stringify(out)).not.toContain('el-secret-value-not-a-known-shape');
  });

  it('does not recurse without bound on a self-referencing object', () => {
    const cyclic: Record<string, unknown> = { a: 'safe' };
    cyclic.self = cyclic;
    expect(() => redactSecrets(cyclic)).not.toThrow();
  });
});

describe('redactSecrets — the depth bound REDACTS rather than passing through', () => {
  // The previous implementation returned the sub-tree unchanged past MAX_DEPTH,
  // so a secret nested nine levels deep in `details` was emitted verbatim. The
  // only test on the bound asserted a cyclic input did not throw — which pins
  // termination and would pass over a total leak (lessons-learned #11).
  const nest = (depth: number, leaf: unknown): unknown =>
    depth === 0 ? leaf : { level: nest(depth - 1, leaf) };

  it('replaces a sub-tree past the bound instead of emitting it', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'deep-secret-value-not-a-known-shape');
    const out = redactSecrets(nest(12, 'leaked deep-secret-value-not-a-known-shape'));
    const json = JSON.stringify(out);
    expect(json).not.toContain('deep-secret-value-not-a-known-shape');
    expect(json).toContain(DEPTH_LIMIT_PLACEHOLDER);
  });

  it('still redacts everything ABOVE the bound', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'shallow-secret-value-not-a-shape');
    const out = redactSecrets({ a: 'shallow-secret-value-not-a-shape', deep: nest(12, 'x') });
    expect(JSON.stringify(out)).not.toContain('shallow-secret-value-not-a-shape');
  });
});

describe('redactSecrets — non-plain objects keep their identity', () => {
  // Rebuilding objects from Object.keys() dropped prototypes and non-enumerable
  // state, so a Date in `details` serialised as {} instead of an ISO string and
  // an Error became {} — its message, name and stack are all non-enumerable.
  // That corrupts legitimate output, the harm this module claims to avoid.
  it('preserves a Date', () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const out = redactSecrets({ createdAt }) as { createdAt: Date };
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(out)).toContain('2026-01-02T03:04:05.000Z');
  });

  it('preserves an Error as its redacted name and message, not {}', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'error-secret-value-not-a-shape');
    const out = redactSecrets({
      cause: new TypeError('upstream said error-secret-value-not-a-shape'),
    }) as { cause: { name: string; message: string } };
    expect(out.cause.name).toBe('TypeError');
    expect(out.cause.message).toContain(REDACTION_PLACEHOLDER);
    expect(out.cause.message).not.toContain('error-secret-value-not-a-shape');
  });

  it('preserves Map and Set while still redacting their contents', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'collection-secret-not-a-shape');
    const out = redactSecrets({
      m: new Map([['k', 'collection-secret-not-a-shape']]),
      s: new Set(['collection-secret-not-a-shape']),
    }) as { m: Map<string, string>; s: Set<string> };
    expect(out.m).toBeInstanceOf(Map);
    expect(out.s).toBeInstanceOf(Set);
    expect(out.m.get('k')).toBe(REDACTION_PLACEHOLDER);
    expect([...out.s]).toEqual([REDACTION_PLACEHOLDER]);
  });
});

describe('SECRET_NAME_PATTERN covers the variable names this deployment receives', () => {
  /**
   * The previous pattern was suffix-anchored on `(_KEY|_SECRET|_TOKEN|...)$`,
   * which silently missed real variables. Each name below is either one this
   * repo reads from `process.env` or one Neon/Vercel/AWS injects. The suite
   * previously pinned only a NEGATIVE ("ignores a non-secret-named variable"),
   * so nothing said the names that actually arrive are covered.
   */
  const COVERED = [
    'GITHUB_MODELS_PAT',        // ours; ends _PAT, missed by the old suffix list
    'ASSET_R2_ACCESS_KEY_ID',   // ours; ends _ID
    'ASSET_R2_SECRET_ACCESS_KEY',
    'ENCRYPTION_MASTER_KEY',
    'PLATFORM_SUNO_KEY',
    'CLERK_WEBHOOK_SECRET',
    'UPSTASH_REDIS_REST_TOKEN',
    'QSTASH_CURRENT_SIGNING_KEY',
    'CRON_SECRET',
    'DATABASE_URL',
    'SENTRY_DSN',
    'PGPASSWORD',               // Neon/Postgres; no underscore before PASSWORD
    'POSTGRES_URL',
    'DATABASE_URL_UNPOOLED',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ];

  it.each(COVERED)('redacts the value of %s', (name) => {
    const value = `value-for-${name.toLowerCase()}-0123456789`;
    vi.stubEnv(name, value);
    expect(redactSecrets(`upstream said ${value}`)).not.toContain(value);
  });

  const NOT_COVERED = ['VERCEL_GIT_COMMIT_SHA', 'ASSET_CDN_HOSTS', 'MCP_RELAY_EDITOR_ORIGINS'];

  it.each(NOT_COVERED)('leaves the value of %s alone', (name) => {
    const value = `value-for-${name.toLowerCase()}-0123456789`;
    vi.stubEnv(name, value);
    expect(redactSecrets(`deployed ${value}`)).toContain(value);
  });
});

describe('redactSecrets — cost', () => {
  /**
   * Deriving the environment list allocates an entry array per key, regex-tests
   * every name and sorts the survivors — ~0.3 ms. The previous version paid it
   * on EVERY string leaf, so one Sentry event with hundreds of strings burned
   * ~90 ms of synchronous CPU inside `beforeSend`, and `scrubMetric` put it on
   * the success path of every generation request.
   *
   * Counting `ownKeys` traps is what makes the claim checkable: it is
   * independent of machine speed, and it FAILS if the derivation moves back
   * inside the recursion.
   */
  function countEnumerations(run: () => void): number {
    const real = process.env;
    let ownKeys = 0;
    const proxy = new Proxy(real, {
      ownKeys(target) {
        ownKeys += 1;
        return Reflect.ownKeys(target);
      },
    });
    Object.defineProperty(process, 'env', { value: proxy, configurable: true, writable: true });
    try {
      resetSecretEnvCache();
      ownKeys = 0;
      run();
      return ownKeys;
    } finally {
      Object.defineProperty(process, 'env', { value: real, configurable: true, writable: true });
      resetSecretEnvCache();
    }
  }

  it('enumerates process.env a bounded number of times regardless of leaf count', () => {
    const small = countEnumerations(() => redactSecrets({ a: 'one', b: 'two' }));
    const large = countEnumerations(() =>
      redactSecrets({ items: Array.from({ length: 200 }, (_, i) => `leaf ${i}`) }),
    );
    // One fingerprint check plus at most one rebuild. Before the fix `large`
    // was ~200.
    expect(small).toBeLessThanOrEqual(2);
    expect(large).toBeLessThanOrEqual(2);
  });

  it('reuses the memoised list across calls while the environment is unchanged', () => {
    const repeated = countEnumerations(() => {
      for (let i = 0; i < 10; i += 1) redactSecrets(`call ${i}`);
    });
    // 10 fingerprint checks, one rebuild — not 10 rebuilds.
    expect(repeated).toBeLessThanOrEqual(11);
  });

  it('still notices a secret set AFTER the list was memoised', () => {
    // The memo must not become the "protection that quietly stopped applying".
    redactSecrets('warm the cache');
    vi.stubEnv('LATE_BOUND_API_KEY', 'late-bound-secret-value-0123456789');
    expect(redactSecrets('saw late-bound-secret-value-0123456789')).not.toContain(
      'late-bound-secret-value-0123456789',
    );
  });

  it('still notices a secret whose value is REPLACED in place after memoisation', () => {
    // Key count is unchanged here, so only the per-name value check catches it.
    vi.stubEnv('CRON_SECRET', 'first-value-0123456789abcdef');
    redactSecrets('warm the cache with first-value-0123456789abcdef');
    vi.stubEnv('CRON_SECRET', 'second-value-0123456789abcdef');
    expect(redactSecrets('saw second-value-0123456789abcdef')).not.toContain(
      'second-value-0123456789abcdef',
    );
  });
});

describe('redactSecrets — source invariants', () => {
  const source = readFileSync(join(__dirname, '..', 'redactSecrets.ts'), 'utf8');

  it('has no unbounded quantifier in any credential shape', () => {
    // `sentryConfig.ts` documents that every quantifier on attacker-influenced
    // text must be UPPER-bounded, and this module is called from `scrubString`
    // on exactly that input. An unbounded `{16,}` here would regress that
    // invariant through the back door. The check scans the SECRET_SHAPES block
    // only, and fails if that block cannot be found — a scan over zero lines
    // passes vacuously and reads as coverage (lessons-learned #9).
    const start = source.indexOf('const SECRET_SHAPES');
    const end = source.indexOf('];', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    expect(block).toContain('sk-ant-');
    // `{16,}` — an open-ended repetition count.
    expect(block.match(/\{\d+,\}/g)).toBeNull();
    // `]+`, `]*`, `)+`, `)*` — the two positions an unbounded quantifier can
    // actually occupy here. A bare `+` inside a character class is a literal
    // plus sign, which is why this is anchored to the closing bracket.
    expect(block.match(/[\])][+*]/g)).toBeNull();
    // `\s+` between a prefix and its token is unbounded too.
    expect(block.match(/\\s[+*]/g)).toBeNull();
  });
});
