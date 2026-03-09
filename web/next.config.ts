import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
    ];
  },
};

export default withSentryConfig(nextConfig, {
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
