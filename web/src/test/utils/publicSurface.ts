/**
 * The routes and components that are INTENDED to be reachable with no auth
 * redirect, plus the shared marketing components.
 *
 * This lives in a shared module because two independent guards consume it and
 * they must not drift:
 *
 * - `src/app/__tests__/public-social-proof.test.ts` scans these sources for
 *   fabricated social proof (PF-1020).
 * - `src/__tests__/proxy.test.ts` asserts every entry that maps to a URL is
 *   actually matched by `buildPublicRoutes()` in `src/proxy.ts` (PF-1038).
 *
 * The second guard is the answer to a real failure: `src/app/docs` and
 * `src/app/health` were both intended to be public, were both listed here, and
 * were both missing from `buildPublicRoutes()` — so anonymous visitors were
 * redirected to sign-in on routes that exist precisely for them. Declaring
 * intent in one place and enforcing it in another is what makes that class of
 * gap fail a test instead of shipping.
 *
 * `play/[userId]/[slug]` calls `safeAuth()` only to set a display flag and
 * never redirects, so it belongs. `dashboard`, `settings`, `editor` and `admin`
 * are rightly absent — each redirects anonymous requests.
 *
 * Adding a public route? Add it here AND to `buildPublicRoutes()`. The
 * assertions in both suites fail if an entry stops resolving or stops being
 * public, but nothing can detect a route you never listed.
 */
export const PUBLIC_SURFACE = [
  'src/app/page.tsx',
  'src/app/about',
  'src/app/api-docs',
  'src/app/blog',
  'src/app/changelog',
  'src/app/community',
  'src/app/compare',
  'src/app/docs',
  'src/app/faq',
  'src/app/health',
  'src/app/play',
  'src/app/pricing',
  'src/app/privacy',
  'src/app/sign-in',
  'src/app/sign-up',
  'src/app/terms',
  'src/app/use-cases',
  'src/components/marketing',
] as const;

const APP_PREFIX = 'src/app/';

/**
 * The subset of {@link PUBLIC_SURFACE} that maps to a URL path, as the path a
 * visitor would actually request. `src/components/marketing` is excluded (not a
 * route); `src/app/page.tsx` maps to `/`.
 */
export const PUBLIC_PAGE_ROUTES: string[] = PUBLIC_SURFACE.filter((entry) =>
  entry.startsWith(APP_PREFIX),
).map((entry) => {
  const segment = entry.slice(APP_PREFIX.length);
  return segment === 'page.tsx' ? '/' : `/${segment}`;
});
