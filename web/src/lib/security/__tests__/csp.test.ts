import { describe, it, expect } from 'vitest';
import {
  buildContentSecurityPolicy,
  buildCspRouteRules,
  buildPlayContentSecurityPolicy,
  clerkFrontendApiFromPublishableKey,
  cspSourceToRegExp,
  effectiveCspForPath,
  EVAL_FREE_ROUTE_SOURCES,
  isDevEvalAllowed,
  isPlayPath,
  PLAY_ROUTE_SOURCE,
  playCspOptionsFromEnv,
} from '../csp';

/** Pull the `script-src` directive out of a full CSP header value. */
function scriptSrc(csp: string): string {
  const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  if (!directive) throw new Error('no script-src directive in CSP');
  return directive;
}

describe('buildContentSecurityPolicy (#8612, #8634)', () => {
  describe('eval scoping', () => {
    it("includes 'unsafe-eval' only when allowUnsafeEval is true (editor/sandbox routes)", () => {
      const permissive = buildContentSecurityPolicy({ allowUnsafeEval: true });
      expect(scriptSrc(permissive)).toContain("'unsafe-eval'");
    });

    it("omits 'unsafe-eval' when allowUnsafeEval is false (public content routes)", () => {
      const strict = buildContentSecurityPolicy({ allowUnsafeEval: false });
      // Must NOT contain the standalone eval token...
      expect(scriptSrc(strict)).not.toContain("'unsafe-eval'");
      // ...but MUST retain 'wasm-unsafe-eval' (it is a distinct token, and even
      // content routes may lazy-load WASM-backed widgets).
      expect(scriptSrc(strict)).toContain("'wasm-unsafe-eval'");
    });

    it("substring of 'wasm-unsafe-eval' is not mistaken for 'unsafe-eval' removal", () => {
      // Regression guard: the only delta between the two policies is the
      // standalone "'unsafe-eval'" token, NOT the 'wasm-unsafe-eval' substring.
      const permissive = buildContentSecurityPolicy({ allowUnsafeEval: true });
      const strict = buildContentSecurityPolicy({ allowUnsafeEval: false });
      expect(permissive.replace(" 'unsafe-eval'", '')).toBe(strict);
    });
  });

  describe('unchanged hardening guarantees', () => {
    it("retains 'unsafe-inline' in both modes (required by Clerk + Next framework scripts)", () => {
      expect(scriptSrc(buildContentSecurityPolicy({ allowUnsafeEval: true }))).toContain("'unsafe-inline'");
      expect(scriptSrc(buildContentSecurityPolicy({ allowUnsafeEval: false }))).toContain("'unsafe-inline'");
    });

    it("keeps default-src 'self' and frame-ancestors 'none' regardless of eval scope", () => {
      for (const allowUnsafeEval of [true, false]) {
        const csp = buildContentSecurityPolicy({ allowUnsafeEval });
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
      }
    });

    it('appends the engine CDN origin to script-src and connect-src when provided', () => {
      const cdn = 'https://cdn.spawnforge.test';
      const csp = buildContentSecurityPolicy({ allowUnsafeEval: false, engineCdn: cdn });
      expect(scriptSrc(csp)).toContain(cdn);
      const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
      expect(connect).toContain(cdn);
    });

    it('does not append a CDN origin when none is configured', () => {
      const csp = buildContentSecurityPolicy({ allowUnsafeEval: false });
      expect(csp).not.toContain('undefined');
      // No trailing/double spaces from an empty CDN directive.
      expect(csp).not.toMatch(/\s{2,}/);
    });
  });

  describe('EVAL_FREE_ROUTE_SOURCES', () => {
    it('covers the user-content surface named in the findings (community) but excludes editor routes', () => {
      expect(EVAL_FREE_ROUTE_SOURCES).toContain('/community/:path*');
      // Editor routes must NOT be tightened — they need 'unsafe-eval' for the
      // Function()-based script sandbox. A tightening entry would break scripting.
      expect(EVAL_FREE_ROUTE_SOURCES).not.toContain('/editor/:path*');
      expect(EVAL_FREE_ROUTE_SOURCES).not.toContain('/dev/:path*');
      expect(EVAL_FREE_ROUTE_SOURCES).not.toContain('/dev');
    });

    it('lists only well-formed Next.js route source patterns', () => {
      for (const source of EVAL_FREE_ROUTE_SOURCES) {
        expect(source.startsWith('/')).toBe(true);
        expect(source).not.toContain('//');
      }
    });
  });
});

/** Forge a Clerk publishable key for `host`, matching Clerk's own encoding. */
function publishableKeyFor(host: string, prefix = 'pk_test_'): string {
  return prefix + btoa(`${host}$`);
}

describe('clerkFrontendApiFromPublishableKey', () => {
  it('decodes the Frontend API host from a dev and a live key', () => {
    expect(clerkFrontendApiFromPublishableKey(publishableKeyFor('sunny-cat-42.clerk.accounts.dev')))
      .toBe('sunny-cat-42.clerk.accounts.dev');
    expect(clerkFrontendApiFromPublishableKey(publishableKeyFor('clerk.spawnforge.ai', 'pk_live_')))
      .toBe('clerk.spawnforge.ai');
  });

  it('returns null for absent or unrecognized keys instead of guessing a host', () => {
    expect(clerkFrontendApiFromPublishableKey(undefined)).toBeNull();
    expect(clerkFrontendApiFromPublishableKey('')).toBeNull();
    expect(clerkFrontendApiFromPublishableKey('sk_test_abc')).toBeNull();
    expect(clerkFrontendApiFromPublishableKey('pk_test_')).toBeNull();
    // Valid base64, but missing Clerk's trailing '$' terminator.
    expect(clerkFrontendApiFromPublishableKey(`pk_test_${btoa('clerk.example.com')}`)).toBeNull();
  });

  it('returns null when the payload is not decodable base64', () => {
    // `atob` throws a DOMException on invalid input rather than returning a
    // falsy value, so this reaches the catch branch — the only path that keeps
    // a malformed NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY from taking down every
    // /play request with a 500 instead of degrading to "no Clerk host".
    expect(clerkFrontendApiFromPublishableKey('pk_test_***not-base64***')).toBeNull();
    expect(clerkFrontendApiFromPublishableKey('pk_live_%%%%')).toBeNull();
  });

  it('rejects a decoded value that would inject a CSP directive', () => {
    // The decoded host is interpolated into a header. A key crafted to decode to
    // a value containing ';' or whitespace must be dropped, not emitted.
    const injected = publishableKeyFor('evil.com; script-src *');
    expect(clerkFrontendApiFromPublishableKey(injected)).toBeNull();
    expect(buildPlayContentSecurityPolicy({ clerkPublishableKey: injected }))
      .not.toContain('evil.com');
  });
});

describe('buildPlayContentSecurityPolicy (PF-1018, #9038)', () => {
  const clerkKey = publishableKeyFor('clerk.spawnforge.test', 'pk_live_');

  it('authorizes inline scripts by nonce, not by unsafe-inline, when a nonce is given', () => {
    // The whole point of the fix: Next.js bootstraps hydration with inline
    // <script> tags. The policy must admit them, and a nonce is how it does so
    // without re-opening arbitrary inline execution.
    const script = scriptSrc(buildPlayContentSecurityPolicy({ nonce: 'dGVzdC1ub25jZQ==' }));
    expect(script).toContain("'nonce-dGVzdC1ub25jZQ=='");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it('falls back to unsafe-inline when no nonce is available (static headers() rule)', () => {
    // A next.config.ts rule cannot carry a per-request value. Degrading to the
    // site-wide inline posture is correct; degrading to a blank page is not.
    const script = scriptSrc(buildPlayContentSecurityPolicy());
    expect(script).toContain("'unsafe-inline'");
    expect(script).not.toContain('nonce-');
  });

  it("never admits 'unsafe-eval' by default (games need WASM, not string-to-code)", () => {
    for (const csp of [
      buildPlayContentSecurityPolicy(),
      buildPlayContentSecurityPolicy({ nonce: 'abc123' }),
      // Explicitly false must behave exactly like omitted.
      buildPlayContentSecurityPolicy({ nonce: 'abc123', devUnsafeEval: false }),
    ]) {
      expect(scriptSrc(csp)).not.toContain("'unsafe-eval'");
      expect(scriptSrc(csp)).toContain("'wasm-unsafe-eval'");
    }
  });

  it("admits 'unsafe-eval' ONLY when the dev-server opt-in is passed", () => {
    // The dev Fast Refresh runtime evals; without this the eval error aborts
    // hydration and the page is dead server HTML under `npm run dev`.
    const csp = buildPlayContentSecurityPolicy({ nonce: 'abc123', devUnsafeEval: true });
    expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    // The opt-in must not quietly relax anything else.
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(csp).toContain("object-src 'none'");
  });

  it('is gated on NODE_ENV === "development" and fails closed everywhere else', () => {
    // This predicate is the ONLY thing standing between the dev convenience and
    // a production policy that permits string-to-code. Anything that is not
    // literally 'development' — including an unset value, 'test', and
    // lookalikes — must be false.
    expect(isDevEvalAllowed('development')).toBe(true);
    for (const env of ['production', 'test', 'staging', 'Development', 'development ', '', undefined]) {
      expect(isDevEvalAllowed(env)).toBe(false);
    }
  });

  it('keeps every production route rule free of \'unsafe-eval\' except the editor routes', () => {
    // buildCspRouteRules defaults devUnsafeEval from NODE_ENV; pin the production
    // value explicitly so this contract holds regardless of the runner's env.
    const rules = buildCspRouteRules({ devUnsafeEval: false });
    expect(scriptSrc(effectiveCspForPath(rules, '/play/u/g')!)).not.toContain("'unsafe-eval'");
    for (const source of EVAL_FREE_ROUTE_SOURCES) {
      const path = source.replace('/:path*', '/x');
      expect(scriptSrc(effectiveCspForPath(rules, path)!)).not.toContain("'unsafe-eval'");
    }
    // The editor routes still need it for the Function()-based script sandbox.
    expect(scriptSrc(effectiveCspForPath(rules, '/editor/scene')!)).toContain("'unsafe-eval'");
  });

  it('relaxes exactly those same routes under the dev server, and nothing more', () => {
    const rules = buildCspRouteRules({ devUnsafeEval: true });
    for (const path of ['/play/u/g', '/pricing', '/community/x']) {
      const script = scriptSrc(effectiveCspForPath(rules, path)!);
      expect(script).toContain("'unsafe-eval'");
      expect(script).toContain("'wasm-unsafe-eval'");
    }
    // Frame/object/base restrictions are unaffected by the dev opt-in.
    const play = effectiveCspForPath(rules, '/play/u/g')!;
    expect(play).toContain("frame-ancestors 'none'");
    expect(play).toContain("object-src 'none'");
  });

  it('throws rather than emit a header built from a non-base64 nonce', () => {
    expect(() => buildPlayContentSecurityPolicy({ nonce: "x' 'unsafe-inline" })).toThrow(/base64/);
    expect(() => buildPlayContentSecurityPolicy({ nonce: 'a b' })).toThrow(/base64/);
  });

  it('allowlists the Clerk host derived from the publishable key', () => {
    // <ClerkProvider> mounts on /play via the root layout, so Clerk's script is
    // genuinely loaded here — omitting the host does not stop Clerk mounting, it
    // only makes the load fail.
    const csp = buildPlayContentSecurityPolicy({ clerkPublishableKey: clerkKey });
    for (const name of ['script-src', 'connect-src', 'frame-src', 'img-src']) {
      const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
      expect(directive).toContain('https://clerk.spawnforge.test');
    }
  });

  it('omits the derived Clerk script host when no publishable key is configured', () => {
    // Without a key Clerk loads no scripts, so allowlisting a Frontend API host
    // would be dead surface rather than a functional requirement. (`img-src`
    // keeps Clerk's avatar CDN unconditionally — that is a fixed asset host, not
    // a derived script origin.)
    const csp = buildPlayContentSecurityPolicy();
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
      expect(directive).not.toContain('clerk');
    }
    expect(csp).not.toContain('undefined');
    expect(csp).not.toMatch(/\s{2,}/);
  });

  it('appends the engine CDN origin to script-src and connect-src when provided', () => {
    const cdn = 'https://cdn.spawnforge.test';
    const csp = buildPlayContentSecurityPolicy({ engineCdn: cdn });
    expect(scriptSrc(csp)).toContain(cdn);
    const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
    expect(connect).toContain(cdn);
  });

  it('keeps the baseline lockdown directives in both modes', () => {
    for (const csp of [
      buildPlayContentSecurityPolicy(),
      buildPlayContentSecurityPolicy({ nonce: 'abc123', clerkPublishableKey: clerkKey }),
    ]) {
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    }
  });
});

describe('cspSourceToRegExp (Next.js source pattern matching)', () => {
  it('treats /:path* as a catch-all that matches every route incl. the root', () => {
    const re = cspSourceToRegExp('/:path*');
    expect(re.test('/')).toBe(true);
    expect(re.test('/anything')).toBe(true);
    expect(re.test('/a/b/c')).toBe(true);
    expect(re.test('/play/game-1')).toBe(true);
  });

  it('matches a prefixed wildcard against the prefix and its descendants only', () => {
    const re = cspSourceToRegExp('/play/:path*');
    expect(re.test('/play')).toBe(true);
    expect(re.test('/play/game-1')).toBe(true);
    expect(re.test('/play/a/b')).toBe(true);
    // A sibling prefix that merely starts with the same letters must NOT match.
    expect(re.test('/playground')).toBe(false);
    expect(re.test('/community/x')).toBe(false);
  });
});

describe('buildCspRouteRules — ordering contract (#8612, #8634)', () => {
  // This is the regression guard for the live bug: Next.js applies every matching
  // headers() rule and the LAST writer of a duplicate key wins (NOT a browser
  // intersection). The permissive global rule must therefore be emitted BEFORE the
  // tightened overrides, or it silently overrides them and 'unsafe-eval' leaks back
  // onto /play and the public content routes. The prior code ordered them the wrong
  // way around; these assertions fail on that ordering.
  it('emits the global /:path* rule BEFORE the /play and content-route overrides', () => {
    const rules = buildCspRouteRules({ engineCdn: '' });
    const sources = rules.map((r) => r.source);
    const globalIdx = sources.indexOf('/:path*');
    const playIdx = sources.indexOf('/play/:path*');
    const communityIdx = sources.indexOf('/community/:path*');

    expect(globalIdx).toBe(0);
    expect(playIdx).toBeGreaterThan(globalIdx);
    expect(communityIdx).toBeGreaterThan(globalIdx);
    // Every eval-free content source must appear after the global rule.
    for (const source of EVAL_FREE_ROUTE_SOURCES) {
      expect(sources.indexOf(source)).toBeGreaterThan(globalIdx);
    }
  });

  it('every rule sets exactly the Content-Security-Policy header', () => {
    for (const rule of buildCspRouteRules()) {
      expect(rule.headers).toHaveLength(1);
      expect(rule.headers[0].key).toBe('Content-Security-Policy');
      expect(rule.headers[0].value.length).toBeGreaterThan(0);
    }
  });
});

describe('effectiveCspForPath — resolves last-writer-wins per route (#8612, #8634)', () => {
  const rules = buildCspRouteRules({ engineCdn: '' });
  const evalOf = (path: string) => {
    const csp = effectiveCspForPath(rules, path);
    if (!csp) throw new Error(`no CSP resolved for ${path}`);
    return scriptSrc(csp);
  };

  it("KEEPS 'unsafe-eval' on editor + default routes (Function() script sandbox needs it)", () => {
    expect(evalOf('/dev')).toContain("'unsafe-eval'");
    expect(evalOf('/editor/scene-1')).toContain("'unsafe-eval'");
    expect(evalOf('/')).toContain("'unsafe-eval'");
    expect(evalOf('/some/marketing/page')).toContain("'unsafe-eval'");
  });

  it("DROPS 'unsafe-eval' on public content routes (the override must actually win)", () => {
    // Regression: under the old (broken) ordering the global rule overrode these,
    // so 'unsafe-eval' stayed present here. The override now wins.
    expect(evalOf('/community/games/123')).not.toContain("'unsafe-eval'");
    expect(evalOf('/pricing')).not.toContain("'unsafe-eval'");
    expect(evalOf('/docs/getting-started')).not.toContain("'unsafe-eval'");
    // 'wasm-unsafe-eval' (a distinct token) is retained on content routes.
    expect(evalOf('/community/games/123')).toContain("'wasm-unsafe-eval'");
  });

  it('applies the eval-free game policy to /play, without blocking its inline bootstrap', () => {
    // The static rule carries no nonce (a headers() rule cannot), so it MUST
    // admit inline scripts: Next.js hydrates via inline <script> tags, and a
    // policy with neither a nonce nor 'unsafe-inline' rendered every published
    // game blank (PF-1018). The proxy's nonce-bearing header supersedes this one
    // in practice — see proxy.test.ts.
    const playScript = evalOf('/play/game-1');
    expect(playScript).not.toContain("'unsafe-eval'");
    expect(playScript).toContain("'wasm-unsafe-eval'");
    expect(playScript).toContain("'unsafe-inline'");
  });
});

describe('PLAY_ROUTE_SOURCE — one definition of the /play scope', () => {
  it('is the source the static rule is emitted under', () => {
    const rules = buildCspRouteRules();
    expect(rules.some((r) => r.source === PLAY_ROUTE_SOURCE)).toBe(true);
  });

  // The proxy decides whether to mint a nonce from isPlayPath; next.config.ts
  // emits the static rule under PLAY_ROUTE_SOURCE. If those two disagreed about
  // a URL, one writer would emit a policy the other never intended for it.
  it.each([
    ['/play', true],
    ['/play/', true],
    ['/play/user_abc/my-game', true],
    ['/playground', false],
    ['/community/play', false],
    ['/', false],
  ])('isPlayPath(%s) === %s, and matches the route source', (pathname, expected) => {
    expect(isPlayPath(pathname as string)).toBe(expected);
    expect(cspSourceToRegExp(PLAY_ROUTE_SOURCE).test(pathname as string)).toBe(expected);
  });

  it('is stateless across calls (no lastIndex drift from a reused RegExp)', () => {
    expect(isPlayPath('/play/a')).toBe(true);
    expect(isPlayPath('/play/a')).toBe(true);
    expect(isPlayPath('/playground')).toBe(false);
    expect(isPlayPath('/play/a')).toBe(true);
  });
});

describe('playCspOptionsFromEnv — shared by both writers of the /play header', () => {
  it('supplies every PlayCspOptions field except the nonce', () => {
    // A field present on the options type but missing here would be silently
    // dropped from BOTH writers; a field wired into only one writer is exactly
    // the divergence this function exists to prevent.
    expect(Object.keys(playCspOptionsFromEnv()).sort()).toEqual([
      'clerkPublishableKey',
      'devUnsafeEval',
      'engineCdn',
    ]);
    expect(playCspOptionsFromEnv()).not.toHaveProperty('nonce');
  });

  it('reads the engine CDN and Clerk key from the environment', () => {
    const prevCdn = process.env.NEXT_PUBLIC_ENGINE_CDN_URL;
    const prevKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_ENGINE_CDN_URL = 'https://cdn.example.test';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==';
    try {
      const opts = playCspOptionsFromEnv();
      expect(opts.engineCdn).toBe('https://cdn.example.test');
      expect(opts.clerkPublishableKey).toBe('pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==');
      expect(opts.devUnsafeEval).toBe(isDevEvalAllowed());
    } finally {
      if (prevCdn === undefined) delete process.env.NEXT_PUBLIC_ENGINE_CDN_URL;
      else process.env.NEXT_PUBLIC_ENGINE_CDN_URL = prevCdn;
      if (prevKey === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = prevKey;
    }
  });

  it('yields a static /play policy differing from the proxy policy only by the nonce', () => {
    const opts = playCspOptionsFromEnv();
    const staticCsp = effectiveCspForPath(buildCspRouteRules(opts), '/play/user_abc/my-game');
    const proxyCsp = buildPlayContentSecurityPolicy({ ...opts, nonce: 'dGVzdA==' });
    expect(staticCsp).toBeDefined();
    // Same directives, same order, same hosts — the ONLY textual difference is
    // the script-src auth token, which is the nonce vs the no-nonce fallback.
    expect(proxyCsp.replace(" 'nonce-dGVzdA=='", ' <AUTH>')).toBe(
      (staticCsp as string).replace(" 'unsafe-inline'", ' <AUTH>'),
    );
  });
});
