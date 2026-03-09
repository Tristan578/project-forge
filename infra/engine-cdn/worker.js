/**
 * engine-cdn Worker — Serves WASM engine files from R2 with CORS headers.
 *
 * Deployed at: engine.spawnforge.ai/*
 * R2 Bucket: spawnforge-engine
 *
 * Why this exists: R2 custom domain access doesn't apply R2 CORS rules.
 * Browsers need Access-Control-Allow-Origin to fetch engine JS/WASM cross-origin.
 *
 * Deploy: cd infra/engine-cdn && wrangler deploy
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // strip leading /

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    // Only allow GET and HEAD
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Fetch from R2
    const object = await env.ENGINE_BUCKET.get(key);
    if (!object) {
      return new Response("Not Found", { status: 404, headers: corsHeaders(request) });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable");

    // Add CORS headers
    const cors = corsHeaders(request);
    for (const [k, v] of Object.entries(cors)) {
      headers.set(k, v);
    }

    return new Response(object.body, { headers });
  },
};

const ALLOWED_ORIGINS = [
  "https://spawnforge.ai",
  "https://www.spawnforge.ai",
  "http://localhost:3000",
  "http://localhost:3001",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith(".vercel.app");
  const allowOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
  };
}
