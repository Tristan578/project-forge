import type { NextConfig } from "next";

const cspDirectives = [
  "default-src 'self'",
  // 'unsafe-inline' is required for Clerk's sign-in/sign-up inline scripts in production.
  // TODO: Scope to auth routes or adopt nonce-based CSP to avoid global unsafe-inline.
  // The /play/:path* route keeps a strict CSP without unsafe-eval or unsafe-inline.
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' https://*.clerk.accounts.dev https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://api.anthropic.com https://api.meshy.ai https://api.elevenlabs.io https://studio-api.suno.ai https://api.hyper3d.ai",
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
            value: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'",
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

export default nextConfig;
