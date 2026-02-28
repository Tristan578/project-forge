import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

const cspDirectives = [
  "default-src 'self'",
  // Dev mode needs 'unsafe-inline' for Next.js HMR/hydration inline scripts.
  // Production builds use external script files and don't need it.
  `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'${isDev ? " 'unsafe-inline'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clerk.accounts.dev https://api.anthropic.com https://api.meshy.ai https://api.elevenlabs.io https://studio-api.suno.ai https://api.hyper3d.ai",
  "worker-src 'self' blob:",
  "media-src 'self' blob:",
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
    ];
  },
};

export default nextConfig;
