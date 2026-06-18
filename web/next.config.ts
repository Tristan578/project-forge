import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";
import {
  buildContentSecurityPolicy,
  EVAL_FREE_ROUTE_SOURCES,
} from "./src/lib/security/csp";

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CDN origin for WASM engine files (e.g. "https://cdn.spawnforge.ai")
const engineCdn = process.env.NEXT_PUBLIC_ENGINE_CDN_URL || "";
const cdnDirective = engineCdn ? ` ${engineCdn}` : "";

// Global CSP. 'unsafe-eval' is retained because the in-editor script sandbox
// compiles user scripts with Function() inside a same-origin worker that inherits
// this policy (see src/lib/security/csp.ts). It is scoped OUT of script-free public
// routes via EVAL_FREE_ROUTE_SOURCES below (#8612, #8634).
const globalCsp = buildContentSecurityPolicy({ allowUnsafeEval: true, engineCdn });
// Tightened CSP (no 'unsafe-eval') applied to public content routes that never
// mount the script sandbox. Emitted alongside the global policy; browsers enforce
// the intersection, so these routes effectively lose 'unsafe-eval'.
const evalFreeCsp = buildContentSecurityPolicy({ allowUnsafeEval: false, engineCdn });

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: globalCsp,
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@spawnforge/ui"],
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
      {
        // Restrictive CSP for published/played games — no unsafe-eval needed
        source: "/play/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${cdnDirective}; connect-src 'self'${cdnDirective}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'`,
          },
        ],
      },
      // Tighten 'unsafe-eval' out of public content routes that never run the
      // editor script sandbox. Listed BEFORE the global /:path* rule; the
      // tightened CSP is emitted alongside the global one and browsers enforce
      // the most-restrictive intersection (#8612, #8634).
      ...EVAL_FREE_ROUTE_SOURCES.map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: evalFreeCsp }],
      })),
      {
        source: "/:path*",
        headers: securityHeaders,
      },
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

export default withSentryConfig(withNextIntl(analyzer(nextConfig)), {
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
