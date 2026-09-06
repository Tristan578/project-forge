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
  createRedactionPass,
  resetSecretEnvCache,
  RedactionBudgetExceededError,
  MAX_REDACTION_NODES,
  REDACTION_PLACEHOLDER,
  CIRCULAR_PLACEHOLDER,
} from '../redactSecrets';
import { buildDeepSceneBody } from './deepSceneBody';

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
    // SIXTY-FOUR hex, which is what `randomBytes(32).toString('hex')` produces
    // (web/src/app/api/keys/api-key/route.ts:49). The previous fixture was 32
    // hex, built to match a pattern that said `{32}` — so the fixture and the
    // pattern agreed with each other and neither agreed with the artifact, and
    // a REAL key passed through unredacted while the suite stayed green
    // (lessons-learned #14). `{32}` cannot backtrack, so the 33rd hex character
    // defeated the trailing `\b` and the match always failed.
    ['SpawnForge API key', 'forge' + '_' + '0123456789abcdef'.repeat(4)],
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

  // The 12-character floor, pinned at the boundary rather than somewhere in
  // its neighbourhood. The suite's shortest redactable fixture was 23 chars
  // and its shortest ignored one was 4, so every value in between could be
  // chosen for the constant with nothing failing — a 19-wide interval around
  // the number that decides which credentials are too short to protect.
  it('redacts a value exactly at the length floor', () => {
    vi.stubEnv('SOME_TOKEN', 'abcdefghijkl'); // 12
    const out = redactSecrets('sent abcdefghijkl upstream');
    expect(out).not.toContain('abcdefghijkl');
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  it('leaves a value one character below the floor alone', () => {
    vi.stubEnv('SOME_TOKEN', 'abcdefghijk'); // 11
    expect(redactSecrets('sent abcdefghijk upstream')).toBe('sent abcdefghijk upstream');
  });

  // Order matters when one secret is a substring of another. Removing the
  // SHORTER one first leaves the longer one's tail in the output — a partial
  // redaction that still ships credential bytes. Every other value-matching
  // test here stubs exactly one variable, so the longest-first sort had no
  // gate at all and deleting it was invisible.
  it('removes the longer secret first when one contains the other', () => {
    vi.stubEnv('SOME_TOKEN', 'abcdefghijklmnop');
    vi.stubEnv('OTHER_TOKEN', 'abcdefghijklmnopQRSTUVWXYZ');
    resetSecretEnvCache();
    const out = redactSecrets('upstream said abcdefghijklmnopQRSTUVWXYZ');
    expect(out).not.toContain('QRSTUVWXYZ');
    expect(out).not.toContain('abcdefghijklmnop');
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

  // A `not.toThrow()` on a self-referencing object used to sit here. It could
  // not fail: `redactSecrets` wraps its whole body in a catch that returns a
  // placeholder, so no input throws and no production change makes one throw.
  // Delete the cycle guard and the walk spins to the node budget, raises
  // RedactionBudgetExceededError, and that same catch swallows it — green
  // either way. The property it was named for is asserted on CONTENT by
  // "replaces only the CYCLE, and keeps the rest of the structure" below,
  // which DOES fail under that mutation. Keeping both would have counted the
  // vacuous one as coverage.
});

describe('redactSecrets — DEPTH DOES NOT DESTROY DATA, and a secret at any depth is still removed', () => {
  // History, because it is the whole point of this block. The bound was
  // `MAX_DEPTH = 8` and past it the sub-tree was REPLACED with a placeholder
  // string. On the error path that was right: truncating a diagnostic costs
  // nothing, and the version before it emitted a deeply-nested secret verbatim.
  // Then `withEgressGuard` moved the same code onto every 200 body, where the
  // bound silently destroyed tilemap tiles, skeleton bones and animation
  // keyframes — see MAX_REDACTION_NODES. Depth is now unbounded; only cycles
  // and a total node budget bound the walk.
  const nest = (depth: number, leaf: unknown): unknown =>
    depth === 0 ? leaf : { level: nest(depth - 1, leaf) };

  it('returns a 40-level structure with every leaf intact', () => {
    const deep = nest(40, { tiles: [1, 2, 3], name: 'ground' });
    expect(redactSecrets(deep)).toEqual(deep);
  });

  it('still removes a secret nested 40 levels down — depth is not a hiding place', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'deep-secret-value-not-a-known-shape');
    const out = redactSecrets(nest(40, 'leaked deep-secret-value-not-a-known-shape'));
    const json = JSON.stringify(out);
    expect(json).not.toContain('deep-secret-value-not-a-known-shape');
    expect(json).toContain(REDACTION_PLACEHOLDER);
  });

  it('still redacts everything above a deep sub-tree', () => {
    vi.stubEnv('PLATFORM_MESHY_KEY', 'shallow-secret-value-not-a-shape');
    const out = redactSecrets({ a: 'shallow-secret-value-not-a-shape', deep: nest(40, 'x') });
    expect(JSON.stringify(out)).not.toContain('shallow-secret-value-not-a-shape');
  });

  it('replaces only the CYCLE, and keeps the rest of the structure', () => {
    const cyclic: Record<string, unknown> = { a: 'safe', list: [1, 2] };
    cyclic.self = cyclic;
    const out = redactSecrets(cyclic) as Record<string, unknown>;
    expect(out.a).toBe('safe');
    expect(out.list).toEqual([1, 2]);
    expect(out.self).toBe(CIRCULAR_PLACEHOLDER);
  });

  it('does NOT treat a DAG as a cycle — one object referenced twice is data, not recursion', () => {
    // The naive "everything I have already seen" guard fails this, and failing
    // it would destroy legitimate data exactly as the depth bound did: a shared
    // material or tileset referenced by two entities is an ordinary shape.
    const shared = { tileset: 'grass', frames: [0, 1, 2] };
    const out = redactSecrets({ a: shared, b: shared }) as Record<string, unknown>;
    expect(out.a).toEqual(shared);
    expect(out.b).toEqual(shared);
  });

  it('keeps a `__proto__` key as DATA instead of silently dropping it', () => {
    // `result[key] = value` invokes Object.prototype's setter for this one key,
    // so the key disappeared from the output and an object value was installed
    // as a prototype. `sceneData` is `z.record(z.string(), z.unknown())`, so the
    // key is reachable from user- and engine-authored JSON.
    const body = JSON.parse('{"__proto__":{"a":1},"b":2}') as Record<string, unknown>;
    const out = redactSecrets(body);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"a":1},"b":2}');
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('redactSecrets — KEYS are a channel too', () => {
  /**
   * Keys used to be copied straight through: `openContainer` captured
   * `Object.keys(source)` and only VALUES reached `redactString`. A body whose
   * only occurrence of a credential was in key position therefore made
   * `hasCandidate` return true (the text is on the wire), took the slow path,
   * paid the whole parse/walk/re-serialise round trip — and shipped the key
   * unchanged. The worst available outcome: the lossy path AND the leak.
   *
   * `sceneData` is `z.record(z.string(), z.unknown())` carrying engine- and
   * user-authored keys, so the channel is reachable, and a provider echoing the
   * key it rejected as a JSON key is the literal `{"msy_…":"invalid"}` shape.
   */
  const MESHY = 'msy' + '_' + 'ab12cd34ef56gh78ij90';

  it('removes a credential sitting in an object KEY', () => {
    const out = JSON.stringify(redactSecrets({ [MESHY]: 'invalid' }));
    expect(out).not.toContain(MESHY);
    expect(out).toBe(`{"${REDACTION_PLACEHOLDER}":"invalid"}`);
  });

  it('removes an environment value sitting in an object KEY', () => {
    vi.stubEnv('PLATFORM_SUNO_KEY', 'no-known-shape-but-a-secret');
    resetSecretEnvCache();
    const out = JSON.stringify(redactSecrets({ 'failed for no-known-shape-but-a-secret': true }));
    expect(out).not.toContain('no-known-shape-but-a-secret');
  });

  it('removes a credential in a MAP key, which `target.set` would also have carried through', () => {
    const out = redactSecrets(new Map<string, string>([[MESHY, 'invalid']]));
    expect([...out.keys()]).toEqual([REDACTION_PLACEHOLDER]);
  });

  it('does NOT silently drop an entry when two keys redact to the same placeholder', () => {
    // `record[key] = value` resolves a collision by overwriting, so redacting
    // keys without handling this would lose an entry with no trace — the depth
    // bound's mistake again. Deterministic, in source key order.
    const other = 'msy' + '_' + 'zz98yy76xx54ww32vv10';
    const out = redactSecrets({ [MESHY]: 'first', [other]: 'second', ok: 1 });
    expect(out).toEqual({
      [REDACTION_PLACEHOLDER]: 'first',
      [`${REDACTION_PLACEHOLDER} (2)`]: 'second',
      ok: 1,
    });
    // Same input, same output — a renaming scheme that depended on iteration
    // luck would make the body nondeterministic.
    expect(redactSecrets({ [MESHY]: 'first', [other]: 'second', ok: 1 })).toEqual(out);
  });

  it('leaves ordinary keys — and their order — exactly as they were', () => {
    // Key redaction must not become a second way to corrupt a clean body.
    const body = JSON.parse('{"10":"ten","2":"two","name":"Grass Tileset"}') as unknown;
    expect(JSON.stringify(redactSecrets(body))).toBe(JSON.stringify(body));
    expect(JSON.stringify(body)).toContain('"name":"Grass Tileset"');
  });
});

describe('createRedactionPass — the node budget FAILS CLOSED', () => {
  it('throws past the budget rather than returning a truncated value', () => {
    // The bound exists so a pathological body cannot pin a request. It THROWS
    // because the alternative — emitting a partially-walked structure — is the
    // depth bound's mistake again: a corrupted payload served as if it were the
    // real one. `withEgressGuard` turns this into its fixed 500.
    //
    // Sized off the exported constant, so lowering the budget cannot leave this
    // asserting against a number that no longer exists.
    const pass = createRedactionPass();
    const over = new Array<number>(MAX_REDACTION_NODES + 1).fill(0);
    expect(() => pass.redactValue(over)).toThrow(RedactionBudgetExceededError);
  });

  it('does not throw just under the budget — the bound is not firing on ordinary width', () => {
    const pass = createRedactionPass();
    const under = new Array<number>(1000).fill(0);
    expect(pass.redactValue(under)).toEqual(under);
  });

  it('has real headroom over the LARGEST REALISTIC body on this surface', () => {
    // The assertion above cannot fail for any budget >= 1001, so it says
    // nothing about whether the bound would fire in production. The docblock on
    // MAX_REDACTION_NODES justifies 2,000,000 by claiming the biggest body this
    // guard sees is a published scene — and the previous version of that claim
    // cited a file that does not exist and a size the committed harness
    // measures at nearly double (lessons-learned #8). So measure it.
    const body = buildDeepSceneBody({ entities: 400 });
    const pass = createRedactionPass({ percentAware: true, includeSelfIssuedShapes: false });
    pass.redactValue(body);
    const nodes = pass.lastNodeCount();

    // Not vacuous: a fixture that walked a handful of nodes would satisfy any
    // headroom claim while proving nothing.
    expect(nodes).toBeGreaterThan(30_000);
    // ...and the bound is two orders of magnitude away, which is the claim.
    expect(nodes).toBeLessThan(MAX_REDACTION_NODES / 10);
    // The exact figures the docblock quotes, so growth in the fixture is a
    // failing test rather than a comment that quietly became false.
    expect(nodes).toBe(38_412);
    expect(JSON.stringify(body).length).toBe(349_983);
  });

  it('walks a 50,000-level structure without a stack overflow', () => {
    // A recursive walk dies here with RangeError at roughly ten thousand
    // frames, which would make "depth never destroys data" false at a limit
    // nobody chose. The traversal is iterative over an explicit stack.
    let node: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 50_000; i += 1) node = { n: node };
    const pass = createRedactionPass();
    let out = pass.redactValue(node);
    for (let i = 0; i < 50_000; i += 1) out = (out as Record<string, unknown>).n as typeof out;
    expect(out).toEqual({ leaf: 'bottom' });
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
    'AWS_SECRET_ACCESS_KEY',
  ];

  it.each(COVERED)('redacts the value of %s', (name) => {
    const value = `value-for-${name.toLowerCase()}-0123456789`;
    vi.stubEnv(name, value);
    expect(redactSecrets(`upstream said ${value}`)).not.toContain(value);
  });

  const NOT_COVERED = [
    'VERCEL_GIT_COMMIT_SHA',
    'ASSET_CDN_HOSTS',
    'MCP_RELAY_EDITOR_ORIGINS',
    // A SigV4 access key id is a public identifier, not a credential, and it
    // travels in the clear inside every presigned URL this deployment mints.
    // Redacting it rewrote the signed `Location` of the marketplace download
    // route and R2 answered 403. See PUBLIC_IDENTIFIER_NAME_PATTERN.
    'ASSET_R2_ACCESS_KEY_ID',
    'AWS_ACCESS_KEY_ID',
  ];

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

describe('createRedactionPass', () => {
  const KEY = 'sk-ant-api03-0123456789abcdefghijKLMNOPQRSTUVWXYZ';

  it('redacts a secret at depth 8, where the old MAX_DEPTH bound used to truncate', () => {
    // This exact shape — eight levels — is what `withEgressGuard` handed the
    // redactor for every response, and the sub-tree at level 8 came back as the
    // string '[REDACTED: nesting depth limit]'. Both halves are asserted: the
    // structure survives AND the secret inside it is gone.
    const deep = { a: { b: { c: { d: { e: { f: { g: `key ${KEY}` } } } } } } };
    const out = createRedactionPass().redactValue(deep);
    expect(out.a.b.c.d.e.f.g).toBe(`key ${REDACTION_PLACEHOLDER}`);
  });

  it('derives the environment list ONCE for the whole pass', () => {
    resetSecretEnvCache();
    const spy = vi.spyOn(Object, 'keys');
    const before = spy.mock.calls.filter((c) => c[0] === process.env).length;
    const pass = createRedactionPass();
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) pass.redactValue(s);
    const after = spy.mock.calls.filter((c) => c[0] === process.env).length;
    spy.mockRestore();
    // One derive, plus at most one fingerprint check.
    expect(after - before).toBeLessThanOrEqual(2);
  });

  it('throws on a hostile input rather than emitting it, so the caller can fail closed', () => {
    // `redactSecrets` swallows this (Sentry must never be broken by its own
    // scrubber); a pass hands the decision to the caller, and `withEgressGuard`
    // answers with its fixed 500.
    const hostile = { get boom(): string { throw new Error('nope'); } };
    const pass = createRedactionPass();
    expect(() => pass.redactValue(hostile)).toThrow();
    expect(pass.redactValue(`key ${KEY}`)).toBe(`key ${REDACTION_PLACEHOLDER}`);
  });

  describe('hasCandidate — the scan the fast path depends on', () => {
    it('says NO for ordinary text, which is what lets a body keep its original bytes', () => {
      const pass = createRedactionPass();
      expect(pass.hasCandidate('{"ok":true,"name":"Grass Tileset"}')).toBe(false);
    });

    it('says YES for every shape and every environment value redaction would act on', () => {
      vi.stubEnv('PLATFORM_MESHY_KEY', 'not-a-known-shape-but-still-a-secret');
      resetSecretEnvCache();
      const pass = createRedactionPass();
      expect(pass.hasCandidate(`echo ${KEY}`)).toBe(true);
      expect(pass.hasCandidate('echo not-a-known-shape-but-still-a-secret')).toBe(true);
    });

    it('OVER-approximates: it never says no where redactText would change the string', () => {
      // The same-string half of the property. Necessary but NOT sufficient —
      // see the composition sweep below, which is the pair the guard actually
      // evaluates.
      vi.stubEnv('PLATFORM_ELEVENLABS_KEY', 'env-value-with-no-known-shape-at-all');
      resetSecretEnvCache();
      const pass = createRedactionPass({ percentAware: true });
      const samples = [
        'plain text with nothing in it',
        `bearer-ish ${KEY}`,
        'env-value-with-no-known-shape-at-all inline',
        `encoded%20${encodeURIComponent(KEY)}%20tail`,
        `encoded%20${encodeURIComponent('env-value-with-no-known-shape-at-all')}`,
        'postgresql://user:hunter2ispassword@db.example.com:5432/main',
        'a%20b%20c',
        '{"tiles":[1,2,3,null,4]}',
      ];
      for (const sample of samples) {
        const changed = pass.redactText(sample) !== sample;
        if (changed) expect(pass.hasCandidate(sample), sample).toBe(true);
      }
      // ...and the sweep is not vacuous: at least some samples DID change.
      expect(samples.filter((s) => pass.redactText(s) !== s).length).toBeGreaterThan(3);
    });

    describe('THE OTHER DIRECTION: detected implies rewritten', () => {
      /**
       * `hasCandidate(t)` TRUE must imply `redactText(t) !== t`.
       *
       * The sweep above is the converse — it proves the scan never says NO
       * where the rewrite would act. Nothing pinned this side, and it went
       * false the moment the scan learned to read JSON escapes and
       * `redactString` did not: the scan found the credential in the unescaped
       * view and said candidate, while `redactLiteral` + `redactPercentEncoded`
       * changed nothing. `withEgressGuard` then left the fast path, rewrote
       * nothing and emitted the credential on five text-mode channels — worse
       * than never detecting, because the response also pays the slow path.
       *
       * Each escape is placed IMMEDIATELY BEFORE the credential, which is the
       * position that defeats the `\b` every shape is left-anchored on.
       */
      const BS = String.fromCharCode(92);
      const ESCAPE_FORMS: Array<[string, string]> = [
        ['backslash-n', `${BS}n`],
        ['backslash-r', `${BS}r`],
        ['backslash-t', `${BS}t`],
        ['backslash-f', `${BS}f`],
        ['backslash-b', `${BS}b`],
        ['an escaped quote', `${BS}"`],
        ['an escaped backslash', `${BS}${BS}`],
        ['a u-escape', `${BS}u0020`],
      ];

      it.each(ESCAPE_FORMS)('rewrites a credential hidden behind %s', (_label, escape) => {
        const pass = createRedactionPass({ percentAware: true });
        const text = `Meshy status error (401): Unauthorized${escape}${KEY} is not valid`;

        expect(pass.hasCandidate(text)).toBe(true);
        expect(pass.redactText(text)).not.toContain(KEY);
        expect(pass.redactText(text)).toContain(REDACTION_PLACEHOLDER);
      });

      it('rewrites a credential hidden behind an escape AND percent-encoding', () => {
        // The fourth of the four spellings both halves look at: unescape, then
        // percent-decode. The rewrite maps the match back through BOTH index
        // maps to cut it out of the original string.
        const pass = createRedactionPass({ percentAware: true });
        const text = `detail=x${BS}n%73k-ant-api03-0123456789abcdefghijKLMNOPQRSTUVWXYZ&ok=1`;

        expect(pass.hasCandidate(text)).toBe(true);
        expect(pass.redactText(text)).toContain(REDACTION_PLACEHOLDER);
      });

      it('holds as a SWEEP: nothing the scan flags survives the rewrite unchanged', () => {
        // The property, not eight examples of it. A future decoding taught to
        // one half and not the other fails here rather than in production.
        vi.stubEnv('PGPASSWORD', 'line-one-is-long-and-unique');
        resetSecretEnvCache();
        const pass = createRedactionPass({ percentAware: true });
        const samples = [
          ...ESCAPE_FORMS.map(([, e]) => `401:${e}${KEY} rejected`),
          ...ESCAPE_FORMS.map(([, e]) => `db said${e}line-one-is-long-and-unique`),
          `encoded%20${encodeURIComponent(KEY)}`,
          `sess=x${BS}n${KEY}; Path=/`,
          'plain text with nothing in it',
          `busy${BS}nretry later`,
        ];

        for (const sample of samples) {
          if (pass.hasCandidate(sample)) {
            expect(pass.redactText(sample), sample).not.toBe(sample);
          }
        }
        // Non-vacuous on BOTH sides: most samples were flagged, and at least one
        // was not — a scan that answered yes to everything would satisfy the
        // loop above while destroying the guard's fast path.
        const flagged = samples.filter((s) => pass.hasCandidate(s));
        expect(flagged.length).toBeGreaterThan(15);
        expect(flagged.length).toBeLessThan(samples.length);
      });
    });

    describe('THE INVARIANT: if the parsed leaves would be redacted, the scan says candidate', () => {
      /**
       * The property above compares `hasCandidate(s)` with `redactText(s)` on
       * the SAME string, which is a pair the guard never evaluates and which is
       * nearly trivially true — both run the same matchers on the same input.
       * The guard calls `hasCandidate(serialisedBody)` and then
       * `redactValue(JSON.parse(serialisedBody))` (`egressGuard.ts`), i.e. it
       * scans the WIRE and rewrites the PARSED tree. That pair is what has to
       * hold, and it did not: a JSON escape between the word boundary and a
       * credential hid it from the scan, so the guard granted byte identity and
       * shipped the secret verbatim (lessons-learned #1, #11).
       *
       * Stated as one line, and swept over a corpus of escaped forms rather
       * than asserted on one example:
       *
       *     JSON.stringify(redactValue(V)) !== JSON.stringify(V)
       *       =>  hasCandidate(JSON.stringify(V))
       */
      const check = (body: unknown): { changed: boolean; scanned: boolean; wire: string } => {
        const pass = createRedactionPass({ percentAware: true });
        const wire = JSON.stringify(body);
        const parsed = JSON.parse(wire) as unknown;
        const before = JSON.stringify(parsed);
        const after = JSON.stringify(pass.redactValue(parsed));
        return { changed: after !== before, scanned: pass.hasCandidate(wire), wire };
      };

      /**
       * Every character `JSON.stringify` escapes with a two-character sequence,
       * plus a control character it escapes as `\uXXXX`. Each one is placed
       * IMMEDIATELY BEFORE the credential, which is the position that matters:
       * on the wire the last character before the key becomes a word character
       * (`n`, `t`, `u`), defeating the `\b` every shape is left-anchored on.
       */
      const ESCAPED_PREFIXES: Array<[string, string]> = [
        ['newline', '\n'],
        ['carriage return', '\r'],
        ['tab', '\t'],
        ['form feed', '\f'],
        ['backspace', '\b'],
        ['double quote', '"'],
        ['backslash', '\\'],
        // U+0001 has no short escape, so JSON.stringify writes it as a six
        // character `\uXXXX` sequence ending in the word character `1`. Built
        // with fromCharCode so the source file carries no raw control byte
        // (`scripts/check-source-encoding.sh`).
        ['a u-escaped control character', String.fromCharCode(1)],
      ];

      it.each(ESCAPED_PREFIXES)(
        'holds for a shaped credential after %s',
        (_label, prefix) => {
          // #9736's literal shape: a provider auth failure folded into a
          // message, with the credential starting a new line.
          const body = {
            error: `Meshy status error (401): Unauthorized${prefix}${KEY} is not valid`,
          };
          const { changed, scanned, wire } = check(body);
          expect(changed, wire).toBe(true);
          expect(scanned, wire).toBe(true);
        },
      );

      it.each([
        ['a double quote', 'has"quote-and-more-chars-here'],
        ['a backslash', 'has\\backslash-and-more-chars'],
        ['a newline (a PEM private key is the real case)', 'line-one-is-long\nline-two-here'],
        ['a tab', 'has\ttab-and-more-chars-here'],
      ])('holds for an environment secret containing %s', (_label, value) => {
        // SECRET_NAME_PATTERN selects PASSWORD and PRIVATE, so both of these
        // names are real classes: a PGPASSWORD with a quote, and any PEM
        // `*_PRIVATE_KEY`, whose value is newline-separated by definition.
        vi.stubEnv('PGPASSWORD', value);
        resetSecretEnvCache();
        const { changed, scanned, wire } = check({ error: `db said ${value}` });
        expect(changed, wire).toBe(true);
        expect(scanned, wire).toBe(true);
      });

      it('holds for a credential in KEY position', () => {
        const { changed, scanned, wire } = check({ [`msy_${'ab12cd34ef56gh78ij90'}`]: 'invalid' });
        expect(changed, wire).toBe(true);
        expect(scanned, wire).toBe(true);
      });

      it('holds for a credential reached only through nesting and an escape', () => {
        const body = {
          jobs: [
            { id: 'a', log: 'fine' },
            { id: 'b', log: { upstream: { detail: `401:\t${KEY}` } } },
          ],
        };
        const { changed, scanned, wire } = check(body);
        expect(changed, wire).toBe(true);
        expect(scanned, wire).toBe(true);
      });

      it('the sweep can fail: the same bodies without a credential are NOT candidates', () => {
        // A gate that says "candidate" for everything would satisfy every
        // assertion above while destroying the fast path. This is the other
        // side of it, and it is what makes the sweep meaningful.
        for (const [, prefix] of ESCAPED_PREFIXES) {
          const body = { error: `Meshy status error (401): Unauthorized${prefix}retry later` };
          const { changed, scanned, wire } = check(body);
          expect(changed, wire).toBe(false);
          expect(scanned, wire).toBe(false);
        }
      });
    });
  });

  describe('includeSelfIssuedShapes — the forge_ key is scoped to diagnostic text', () => {
    // 64 hex, which is what randomBytes(32).toString('hex') actually produces.
    const FORGE_KEY = `forge_${'0123456789abcdef'.repeat(4)}`;

    it('removes it by default, which is the Sentry and error-body path', () => {
      expect(createRedactionPass().redactText(`rejected ${FORGE_KEY}`)).not.toContain(FORGE_KEY);
    });

    it('leaves it alone when the caller opts out, so the one-time key display still works', () => {
      // POST /api/keys/api-key returns `key: rawKey` in its 200 body — that IS
      // the feature. A shape firing there would empty the API Keys UI.
      const pass = createRedactionPass({ includeSelfIssuedShapes: false });
      const body = `{"key":"${FORGE_KEY}","warning":"Save this key now."}`;
      expect(pass.redactText(body)).toBe(body);
      expect(pass.hasCandidate(body)).toBe(false);
    });

    it('the old 32-hex pattern could not have matched a real key at all', () => {
      // Kept as a named regression: `{32}` cannot backtrack, so the 33rd hex
      // character defeated the trailing \b. The shape was listed as coverage
      // and provided none.
      expect(/\bforge_[0-9a-f]{32}\b/.test(FORGE_KEY)).toBe(false);
      expect(/\bforge_[0-9a-f]{64}\b/.test(FORGE_KEY)).toBe(true);
    });
  });

  describe('percentAware', () => {
    // Percent-encoding destroys the word boundary every credential shape is
    // anchored on: in `...key%20sk-ant-AAA` the character before `sk-ant-` is
    // the `0` of `%20`, which IS a word character. A redirect `Location` and a
    // `Set-Cookie` value are percent-encoded by the time they are headers, so
    // without this the two client-visible channels the egress guard exists to
    // close were passing the key through verbatim.
    const encoded = `https://x.test/fail?e=invalid%20key%20${KEY}%22%7D`;

    it('is OFF by default, so the Sentry path and the response constructors are unchanged', () => {
      expect(createRedactionPass().redactText(encoded)).toBe(encoded);
      expect(redactSecrets(encoded)).toBe(encoded);
    });

    it('removes a secret that is only visible once escapes are resolved', () => {
      const out = createRedactionPass({ percentAware: true }).redactText(encoded);
      expect(out).not.toContain(KEY);
      expect(out).toContain(REDACTION_PLACEHOLDER);
      // The surrounding encoding is untouched — only the matched run is cut, so
      // a Set-Cookie's unencoded attributes and a URL's structure survive.
      expect(out).toBe(`https://x.test/fail?e=invalid%20key%20${REDACTION_PLACEHOLDER}%22%7D`);
    });

    it('removes an ENVIRONMENT value that has been percent-encoded', () => {
      vi.stubEnv('PROVIDER_ACCESS_TOKEN', 'value with spaces and /slashes/');
      resetSecretEnvCache();
      const raw = 'detail=value%20with%20spaces%20and%20%2Fslashes%2F&ok=1';
      const out = createRedactionPass({ percentAware: true }).redactText(raw);
      expect(out).toBe(`detail=${REDACTION_PLACEHOLDER}&ok=1`);
    });

    it('leaves a string with no escapes, and a string whose escapes hide nothing, exactly as it was', () => {
      const pass = createRedactionPass({ percentAware: true });
      expect(pass.redactText('nothing to see here')).toBe('nothing to see here');
      expect(pass.redactText('a%20b%20c')).toBe('a%20b%20c');
    });

    it('does not corrupt a multi-byte UTF-8 escape sequence it cannot decode to ASCII', () => {
      const emoji = 'note%20%F0%9F%94%92%20locked';
      expect(createRedactionPass({ percentAware: true }).redactText(emoji)).toBe(emoji);
    });
  });
});

describe('the environment name pattern exempts a PUBLIC identifier', () => {
  // ASSET_R2_ACCESS_KEY_ID matches the secret-name pattern on the word KEY, and
  // its value appears verbatim in every SigV4 presigned URL as
  // X-Amz-Credential=<AKID>/<date>/auto/s3/aws4_request. Redacting it rewrote
  // the Location of /api/marketplace/assets/[id]/download, R2 answered 403
  // InvalidAccessKeyId, and every paid asset download failed silently.
  it('does NOT redact an access key ID out of a presigned URL', () => {
    vi.stubEnv('ASSET_R2_ACCESS_KEY_ID', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    resetSecretEnvCache();
    const url =
      'https://acct.r2.cloudflarestorage.com/bucket/key?X-Amz-Credential='
      + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%2F20260906%2Fauto%2Fs3%2Faws4_request';
    expect(createRedactionPass({ percentAware: true }).redactText(url)).toBe(url);
  });

  it('DOES still redact the paired secret access key', () => {
    vi.stubEnv('ASSET_R2_SECRET_ACCESS_KEY', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    resetSecretEnvCache();
    const out = redactSecrets('signing failed with bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(out).not.toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });

  // BOTH anchors of /(^|_)KEY_ID$/, because this is the one pattern in the file
  // whose job is to carve a hole in coverage — widening it stops redacting real
  // credentials, and nothing else would notice. The bare-`_KEY` case alone left
  // `/KEY_ID/` (no anchors at all) passing the whole suite, so each anchor gets
  // a name that the unanchored form would newly exempt.
  it.each([
    ['a trailing suffix past the identifier', 'FOO_KEY_ID_SECRET', 'dddddddddddddddddddddddddddddddd'],
    // Reaches SECRET_NAME_PATTERN on the word SECRET, and ends in KEY_ID with
    // a letter in front of it — so the LEADING anchor is what keeps it
    // redacted. A bare `MONKEY_ID` proves nothing here: `(^|_)KEY(_|$)` never
    // matches it, so it is not secret-named and never reaches the exemption.
    ['a name that merely ends in KEY_ID', 'SECRET_MONKEY_ID', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
    ['an ordinary _KEY variable', 'SOME_PROVIDER_KEY', 'cccccccccccccccccccccccccccccccc'],
  ])('the exemption is anchored, so it does not swallow %s', (_label, name, value) => {
    vi.stubEnv(name, value);
    resetSecretEnvCache();
    const out = redactSecrets(`used ${value}`);
    expect(out).not.toContain(value);
    expect(out).toContain(REDACTION_PLACEHOLDER);
  });
});
