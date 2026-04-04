import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import type { BridgeToolConfig } from '@/lib/bridges/types';
import { ALLOWED_TEMPLATES } from '@/lib/bridges/luaTemplates';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { BRIDGE_CACHE_TTL_MS } from '@/lib/config/timeouts';

// Cache discovered tool config to avoid spawning a child process on every request
let cachedTool: { config: BridgeToolConfig; expiresAt: number } | null = null;

async function getCachedTool(): Promise<BridgeToolConfig> {
  const now = Date.now();
  if (cachedTool && now < cachedTool.expiresAt) {
    return cachedTool.config;
  }
  const config = await discoverTool('aseprite');
  cachedTool = { config, expiresAt: now + BRIDGE_CACHE_TTL_MS };
  return config;
}

export async function POST(req: Request) {
  const auth = await authenticateRequest();
  if (!auth.ok) {
    return auth.response;
  }

  const rl = await rateLimit(`user:bridges-aseprite-execute:${auth.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  try {
    const body = await req.json();
    const { operation, params } = body ?? {};

    if (!operation || typeof operation !== 'string') {
      return NextResponse.json({ error: 'operation is required' }, { status: 400 });
    }

    if (!ALLOWED_TEMPLATES.has(operation)) {
      return NextResponse.json(
        { error: `Unknown operation: "${operation}". Allowed: ${[...ALLOWED_TEMPLATES].join(', ')}` },
        { status: 400 }
      );
    }

    // Validate params is a plain object (not array); prototype pollution guarded by coerceParams
    if (params != null && (typeof params !== 'object' || Array.isArray(params))) {
      return NextResponse.json({ error: 'params must be a plain object' }, { status: 400 });
    }

    const tool = await getCachedTool();
    if (tool.status !== 'connected') {
      return NextResponse.json(
        { error: `Aseprite not available: ${tool.status}` },
        { status: 503 }
      );
    }

    const plat = process.platform as 'darwin' | 'win32' | 'linux';
    const binaryPath = tool.paths[plat];
    if (!binaryPath) {
      return NextResponse.json(
        { error: 'No Aseprite binary path for current platform' },
        { status: 503 }
      );
    }

    const result = await executeOperation(binaryPath, {
      name: operation,
      params: params ?? {},
    });

    return NextResponse.json(result);
  } catch (err) {
    captureException(err, { route: '/api/bridges/aseprite/execute' });
    // Return a generic error message to avoid leaking internal paths or system details.
    // The full error is captured by Sentry above for debugging.
    return NextResponse.json(
      { error: 'Aseprite operation failed. Check Sentry for details.' },
      { status: 500 }
    );
  }
}
