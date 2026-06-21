import { describe, it, expect } from 'vitest';
import {
  buildContentSecurityPolicy,
  buildCspRouteRules,
  buildPlayContentSecurityPolicy,
  cspSourceToRegExp,
  effectiveCspForPath,
  EVAL_FREE_ROUTE_SOURCES,
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

describe('buildPlayContentSecurityPolicy', () => {
  it('locks script-src to first-party + WASM only (no eval, no inline)', () => {
    const csp = buildPlayContentSecurityPolicy();
    expect(scriptSrc(csp)).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(scriptSrc(csp)).not.toContain("'unsafe-eval'"); // standalone token absent
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('appends the engine CDN origin to script-src and connect-src when provided', () => {
    const cdn = 'https://cdn.spawnforge.test';
    const csp = buildPlayContentSecurityPolicy(cdn);
    expect(scriptSrc(csp)).toContain(cdn);
    const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src '));
    expect(connect).toContain(cdn);
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

  it('applies the locked-down game policy to /play (no eval, no inline, no Clerk)', () => {
    const playScript = evalOf('/play/game-1');
    expect(playScript).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(playScript).not.toContain("'unsafe-eval'");
    expect(playScript).not.toContain("'unsafe-inline'");
    expect(playScript).not.toContain('clerk');
  });
});
