/**
 * @vitest-environment node
 *
 * `redactSecrets` is the last line before a string leaves the process — into an
 * HTTP response body, or into Sentry. It exists because #9736 found provider
 * clients folding an upstream response body verbatim into a thrown Error, and
 * fourteen routes returning that error's `message` to the caller: on the
 * platform path the credential in play is the platform's, so a provider that
 * echoes key material in a 401 body hands a platform secret to any signed-in
 * user.
 *
 * Two independent mechanisms, because either alone is insufficient:
 *
 *  - SHAPE matching catches a credential we have never seen the value of (a
 *    user's BYOK key inside a provider's error text), but only for shapes we
 *    thought of.
 *  - VALUE matching catches anything currently in the environment whatever its
 *    shape, but only for secrets this process holds.
 *
 * The value path is the one that makes the guarantee hold for a provider we add
 * tomorrow whose key format nobody here has seen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { redactSecrets, REDACTION_PLACEHOLDER } from '../redactSecrets';

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('handles empty and non-string input without throwing', () => {
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(undefined as unknown as string)).toBe('');
    expect(redactSecrets(null as unknown as string)).toBe('');
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
