import { describe, it, expect } from 'vitest';
import {
  buildContentSecurityPolicy,
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
