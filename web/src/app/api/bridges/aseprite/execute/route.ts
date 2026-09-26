import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import type { BridgeToolConfig } from '@/lib/bridges/types';
import { ALLOWED_TEMPLATES } from '@/lib/bridges/luaTemplates';
import { captureException } from '@/lib/monitoring/sentry-server';
import { BRIDGE_CACHE_TTL_MS } from '@/lib/config/timeouts';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';

/**
 * Template params that name files on the server. The templates hand them to
 * `saveAs` / `app.open`, so taking them from a client let a caller choose where
 * the server writes and what it opens (#10271). Clients may not send them; the
 * server generates an output path itself and deletes the file afterwards.
 */
const SERVER_PATH_PARAMS = new Set(['outputPath', 'inputPath', 'outputPng', 'outputJson']);

/**
 * The operations this route runs, and the only ones it advertises. An explicit
 * list rather than `ALLOWED_TEMPLATES` minus exclusions, so a template added
 * later is not exposed to clients by default.
 */
const ROUTE_OPERATIONS = ['createSprite', 'createAnimation'] as const;
const ROUTE_OPERATION_SET: ReadonlySet<string> = new Set(ROUTE_OPERATIONS);
const ALLOWED_LIST = ROUTE_OPERATIONS.join(', ');

/**
 * Templates only server code may run. `drawFrames` needs server-generated
 * output paths and is reached through `drawPixelArt`, which validates the pixel
 * data and returns the sheet.
 */
const SERVER_ONLY_TEMPLATES = new Set(['drawFrames']);

/**
 * Templates that begin with `app.open("{{inputPath}}")`. The client may not
 * name that path (above), and the server has no way yet to name an existing
 * sprite of its own, so they would open `""` and do nothing. Refused until a
 * server-owned input exists: #10283.
 */
const INPUT_SPRITE_TEMPLATES = new Set(['editSprite', 'applyPalette', 'exportSheet']);

/**
 * Size limits for what a client may ask Aseprite to build. The template
 * loader's numeric check (0-99999) exists to reject non-numbers, not to bound
 * work: 99999 x 99999 x 99999 frames passes it. The route returns the saved
 * file's bytes, so every byte Aseprite writes is read into memory and sent
 * back; both the request and the file are capped here. (Not exported: a
 * Next.js route file may export only route handlers and config.)
 */
const SPRITE_LIMITS = {
  maxDimension: 2048,
  maxFrames: 256,
  maxOutputBytes: 8 * 1024 * 1024,
} as const;

const SIZE_PARAMS: Record<string, number> = {
  width: SPRITE_LIMITS.maxDimension,
  height: SPRITE_LIMITS.maxDimension,
  frameCount: SPRITE_LIMITS.maxFrames,
};

function oversizedParams(params: Record<string, unknown>): string[] {
  return Object.entries(SIZE_PARAMS)
    .filter(([key, max]) => key in params && Number(params[key]) > max)
    .map(([key, max]) => `${key} (max ${max})`);
}

const asepriteExecuteSchema = z.object({
  operation: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).nullish(),
});

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

async function POST_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:bridges-aseprite-execute:${id}`, max: 10, windowSeconds: 60, distributed: false },
    validate: asepriteExecuteSchema,
  });
  if (mid.error) return mid.error;

  try {
    const { operation, params } = mid.body as z.infer<typeof asepriteExecuteSchema>;

    if (SERVER_ONLY_TEMPLATES.has(operation)) {
      return NextResponse.json(
        { error: `Operation "${operation}" is not available through this route` },
        { status: 400 }
      );
    }

    if (INPUT_SPRITE_TEMPLATES.has(operation)) {
      return NextResponse.json(
        {
          error: `Operation "${operation}" requires an input sprite, which this route cannot accept yet. `
            + `Allowed: ${ALLOWED_LIST}`,
        },
        { status: 400 }
      );
    }

    // Runtime allowlist check. Both lists must agree: the route's own, and the
    // template loader's (which `executeOperation` enforces again).
    if (!ROUTE_OPERATION_SET.has(operation) || !ALLOWED_TEMPLATES.has(operation)) {
      return NextResponse.json(
        { error: `Unknown operation: "${operation}". Allowed: ${ALLOWED_LIST}` },
        { status: 400 }
      );
    }

    const clientPaths = Object.keys(params ?? {}).filter((key) => SERVER_PATH_PARAMS.has(key));
    if (clientPaths.length > 0) {
      return NextResponse.json(
        { error: `File paths are chosen by the server. Remove: ${clientPaths.join(', ')}` },
        { status: 400 }
      );
    }

    const oversized = oversizedParams(params ?? {});
    if (oversized.length > 0) {
      return NextResponse.json(
        { error: `Sprite too large. Reduce: ${oversized.join(', ')}` },
        { status: 400 }
      );
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

    // Both operations `saveAs` a destination; it is the server's, under its
    // temp directory. The saved bytes ARE the result, so they are read into
    // memory before the file is removed (the same read-then-delete order as
    // `drawPixelArt`), and only the bytes leave — never the path.
    const outputPath = join(tmpdir(), 'spawnforge-bridge', `${randomUUID()}.aseprite`).replace(/\\/g, '/');
    let result;
    let saved: Buffer | null = null;
    try {
      result = await executeOperation(binaryPath, {
        name: operation,
        params: { ...(params ?? {}), outputPath },
      });
      // The size is checked before the read, so an oversized file is never
      // loaded; it is reported like any other failed run below.
      if (
        result.success
        && existsSync(outputPath)
        && statSync(outputPath).size <= SPRITE_LIMITS.maxOutputBytes
      ) {
        saved = readFileSync(outputPath);
      }
    } finally {
      try {
        unlinkSync(outputPath);
      } catch {
        /* never written */
      }
    }

    // Forwarding `result` verbatim is a leak on the SUCCESS path (#9736): a
    // BridgeResult carries `stdout`, `stderr` and `error: stderr || ...`, which
    // hold the child_process message — the full command line and the temp Lua
    // script path under the server's tmpdir. The catch below already says the
    // intent ("avoid leaking internal paths or system details"); this is the
    // half that was not doing it. The rule cannot see this shape: no catch, no
    // construction it can follow, so only a test can hold the line.
    if (!result.success || saved === null) {
      captureException(
        new Error(
          result.success
            ? `Aseprite reported success but saved no file: ${operation}`
            : `Aseprite operation failed: ${operation}`,
        ),
        {
          route: '/api/bridges/aseprite/execute',
          operation,
          exitCode: result.exitCode,
          stderr: result.stderr,
        },
      );
      // Fixed text rather than `stderr`, which names the child_process command
      // line and the temp Lua script path — AND actionable, for the same reason
      // the sibling `status` route is: this bridge runs on the USER's machine
      // and they are the only person who can fix it. "Check Sentry for details"
      // named a next step the person on the other end cannot take; Sentry is an
      // internal developer tool they have no access to.
      return redactedJson(
        {
          success: false,
          error:
            'The Aseprite operation did not complete. Check that Aseprite is installed and the '
            + 'local bridge is running, then try again.',
        },
        { status: 502 },
      );
    }

    // No `outputFiles`: a BridgeResult's file list would be server paths, and
    // the one file this route produced is returned in full below.
    return redactedJson({
      success: true,
      sprite: {
        format: 'aseprite',
        contentType: 'application/octet-stream',
        base64: saved.toString('base64'),
      },
      metadata: result.metadata,
    });
  } catch (err) {
    captureException(err, { route: '/api/bridges/aseprite/execute' });
    // Fixed text to avoid leaking internal paths or system details; the full
    // error is captured by Sentry above. Same wording as the `!result.success`
    // branch — the user cannot tell the two apart and the remedy is identical.
    return redactedJson(
      {
        error:
          'The Aseprite operation did not complete. Check that Aseprite is installed and the '
          + 'local bridge is running, then try again.',
      },
      { status: 500 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
