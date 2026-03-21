import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";
import createNextIntlPlugin from "next-intl/plugin";

const analyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// CDN origin for WASM engine files (e.g. "https://cdn.spawnforge.ai")
const engineCdn = process.env.NEXT_PUBLIC_ENGINE_CDN_URL || '';
const cdnDirective = engineCdn ? ` ${engineCdn}` : '';

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-inline' is required for Clerk's sign-in/sign-up inline scripts in production.
  // Since 'unsafe-eval' is already allowed (for WASM), 'unsafe-inline' does not
  // meaningfully reduce CSP security. The /play/:path* route keeps a strict CSP.
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com${cdnDirective}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.clerk.accounts.dev https://api.anthropic.com https://api.meshy.ai https://api.elevenlabs.io https://studio-api.suno.ai https://api.hyper3d.ai${cdnDirective}`,
  "frame-src 'self' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
];

const nextConfig: NextConfig = {
  compress: true,
  // Forward browser console logs to the terminal during `next dev` (16.2+).
  // Enables real-time visibility into client-side errors without opening DevTools.
  logging: {
    browserToTerminal: true,
  },
  experimental: {
    // Subresource Integrity: inject sha256 integrity hashes into <script> tags
    // to prevent injection of unauthorized scripts in production.
    sri: { algorithm: 'sha256' },
    // Inline prefetch payloads into the page HTML to reduce waterfall requests
    // on navigation, improving LCP for App Router navigations (16.2+).
    prefetchInlining: true,
    // Cache RSC navigation payloads in the browser for instant back/forward
    // navigation on previously visited routes (16.2+).
    cachedNavigations: true,
    // Use the new scroll restoration handler that correctly restores scroll
    // position across App Router navigations (16.2+).
    appNewScrollHandler: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'gravatar.com',
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
      {
        source: "/engine-pkg-webgl2/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgpu/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgl2-runtime/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/engine-pkg-webgpu-runtime/:file*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(analyzer(nextConfig)), {
  // Suppress source map upload logs in CI
  silent: true,

  // Upload source maps for production builds
  org: process.env.SENTRY_ORG || 'tristan-nolan',
  project: process.env.SENTRY_PROJECT || 'spawnforge-ai',

  // Auth token for source map upload (set SENTRY_AUTH_TOKEN in env)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Source map configuration
  sourcemaps: {
    // Hide source maps from users in production
    deleteSourcemapsAfterUpload: true,
  },

  // Widen the upload scope to include WASM-related files
  widenClientFileUpload: true,
});
