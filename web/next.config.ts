import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import { withBotId } from "botid/next/config";
import { buildCspRouteRules, playCspOptionsFromEnv } from "./src/lib/security/csp";
import { assertClerkPublishableKeyShape } from "./src/lib/auth/clerkKey";

// Fail the build on a configured-but-unusable Clerk publishable key (#9044).
// A MISSING key is fine and stays fine — local checkouts and CI E2E builds have
// none. A key that is PRESENT but cannot work is always a paste error, and the
// old inline prefix check treated it as "Clerk is not set up here". That is how
// docs.spawnforge.ai shipped with every sign-in dead and no signal anywhere;
// the same paste into this project's env var would take the paid funnel with
// it. Checked here rather than at runtime so the deploy goes red instead of the
// live site.
assertClerkPublishableKeyShape();

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Per-route Content-Security-Policy rules. ORDER IS LOAD-BEARING: Next.js applies
// every matching headers() rule and the LAST writer of a duplicate key wins (it
// is NOT a browser-style intersection). buildCspRouteRules() therefore emits the
// permissive global /:path* rule FIRST and the tightened /play + content-route
// overrides AFTER it, so each override is the last writer for its paths and
// 'unsafe-eval' is actually dropped there (#8612, #8634). Single source of truth
// + ordering contract live in src/lib/security/csp.ts and are unit-tested.
// Options come from playCspOptionsFromEnv() — the SAME call the proxy makes when
// it mints the nonce — so the two writers of the /play header differ only in the
// nonce, and a field added there reaches both writers automatically.
const cspRouteRules = buildCspRouteRules(playCspOptionsFromEnv());

// Non-CSP security headers applied to every route. CSP is intentionally NOT here
// — it comes from cspRouteRules so the last-writer-wins ordering is explicit and
// testable. These keys never collide with the CSP rules, so their order is moot.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // Enables the JS Self-Profiling API that Sentry's browserProfilingIntegration
  // (instrumentation-client.ts) samples. WITHOUT this header the API is simply
  // absent from the page and the integration no-ops — no console error, no
  // Sentry warning, just an empty profile stream. Chromium-only by design;
  // other engines ignore the header. Pinned by sentry-regressions.test.ts.
  { key: "Document-Policy", value: "js-profiling" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@spawnforge/ui"],
  // @sentry/profiling-node ships a native V8 CpuProfiler .node addon, which
  // Turbopack cannot bundle. Next 16.2.12 ALREADY externalizes it by default —
  // it is listed under "Native Node.js addons" in
  // node_modules/next/dist/lib/server-external-packages.jsonc — so this entry is
  // redundant TODAY and is kept deliberately, not because the build needs it:
  // Next's built-in list is an implementation detail that has churned before,
  // and the failure mode when an entry silently leaves it is an opaque native-
  // binary bundling error at build time. Declaring it here makes the requirement
  // survive a Next upgrade. Pinned by sentry-regressions.test.ts.
  serverExternalPackages: ["@sentry/profiling-node"],
  compress: true,
  // This is a top-level config option that gates the experimental caching
  // a build error: "Error: Caching is not enabled in the current environment."
  // Forward browser console logs to the terminal during `next dev` (16.2+).
  // Enables real-time visibility into client-side errors without opening DevTools.
  logging: {
    browserToTerminal: true,
  },
  experimental: {
    // SRI removed (2026-03-29): Vercel's CDN post-processes JS chunks after
    // build (edge compression, immutable cache rewriting), invalidating the
    // build-time sha256 hashes. Every script fails browser integrity checks,
    // producing a blank page on routes requiring client JS (e.g. /sign-in).
    // Compensating control: strict CSP script-src 'self' + named allowlist.
    // Revisit if Vercel adds SRI-compatible delivery mode.
    // Inline prefetch payloads into the page HTML to reduce waterfall requests
    // on navigation, improving LCP for App Router navigations (16.2+).
    prefetchInlining: true,
    // Use the new scroll restoration handler that correctly restores scroll
    // position across App Router navigations (16.2+).
    appNewScrollHandler: true,
    // Enable the 'use cache' directive for Server Components. Allows
    // cache-eligible components to declare cacheTag() and cacheLife() hints
    // so Next.js can skip re-rendering on subsequent requests.
    useCache: true,
  },
  // Include CHANGELOG.md in the serverless function bundle so the
  // changelog page can read it at runtime (cache revalidation).
  // Top-level in Next.js 15+ (moved out of experimental).
  outputFileTracingIncludes: {
    '/changelog': ['../CHANGELOG.md'],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "gravatar.com",
      },
    ],
  },
  async headers() {
    return [
      // Non-CSP security headers for every route. CSP is supplied separately by
      // cspRouteRules (below) so the last-writer-wins ordering is explicit.
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Content-Security-Policy rules, already ordered global-first so the
      // tightened /play + content-route overrides win under Next's
      // last-writer-wins semantics (#8612, #8634). Do NOT reorder by hand — the
      // ordering contract is owned and tested in src/lib/security/csp.ts.
      ...cspRouteRules,
      {
        source: "/engine-pkg-webgl2/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/engine-pkg-webgpu/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/engine-pkg-webgl2-runtime/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/engine-pkg-webgpu-runtime/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // WASM-specific headers: correct MIME type + cross-origin isolation required
      // for SharedArrayBuffer (used by Bevy's multi-threaded workloads).
      // These match only .wasm files within each engine-pkg directory.
      // NOTE: In production, WASM is served by the R2 CDN at engine.spawnforge.ai
      // (infra/engine-cdn/worker.js sets COEP/COOP). These headers are the local
      // fallback for dev server and any non-CDN paths. vercel.json header entries
      // for engine-pkg were removed since R2 CDN is the canonical source.
      {
        source: "/engine-pkg-webgl2/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgpu/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgl2-runtime/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgpu-runtime/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(analyzer(withBotId(nextConfig))), {
  // Show all Sentry build output (source map upload warnings, etc.)
  silent: false,

  // Upload source maps for production builds
  org: process.env.SENTRY_ORG || "tristan-nolan",
  project: process.env.SENTRY_PROJECT || "spawnforge-ai",

  // Auth token for source map upload (set SENTRY_AUTH_TOKEN in env)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Tree-shake Sentry logger statements to reduce bundle size (webpack only;
  // Turbopack handles this via its own dead-code elimination).
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },

  // Route Sentry events through /monitoring to bypass ad-blockers.
  // Replaces the manual /api/sentry tunnel route.
  tunnelRoute: "/monitoring",

  // Source map configuration
  sourcemaps: {
    // Hide source maps from users in production
    deleteSourcemapsAfterUpload: true,
  },

  // Widen the upload scope to include WASM-related files
  widenClientFileUpload: true,
});
