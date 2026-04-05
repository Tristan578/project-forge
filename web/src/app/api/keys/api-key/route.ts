import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import { captureException } from '@/lib/monitoring/sentry-server';
import { API_KEY_SCOPES, findInvalidScopes, type ApiKeyScope } from '@/lib/config/scopes';
import { RATE_LIMIT_ADMIN_WINDOW_MS } from '@/lib/config/timeouts';

/** POST /api/keys/api-key — generate a new MCP API key */
export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `apikey-gen:${id}`, max: 5, windowSeconds: RATE_LIMIT_ADMIN_WINDOW_MS / 1000, distributed: false },
  });
  if (mid.error) return mid.error;

  // MCP keys require Creator+ tier
  const tierCheck = assertTier(mid.authContext!.user, ['creator', 'pro']);
  if (tierCheck) return tierCheck;

  let body: { name?: unknown; scopes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : 'Default';
  const scopes: ApiKeyScope[] = Array.isArray(body.scopes) ? (body.scopes as ApiKeyScope[]) : [...API_KEY_SCOPES];

  // Validate scopes
  const invalidScopes = findInvalidScopes(scopes);
  if (invalidScopes.length > 0) {
    return NextResponse.json(
      { error: `Invalid scopes: ${invalidScopes.join(', ')}` },
      { status: 400 }
    );
  }

  // Generate key: forge_<32 random hex chars>
  const rawKey = `forge_${randomBytes(32).toString('hex')}`;
  const prefix = rawKey.slice(0, 12); // "forge_xxxx" — enough for identification
  const keyHash = await bcrypt.hash(rawKey, 12);

  const db = getDb();
  try {
  const [record] = await db
    .insert(apiKeys)
    .values({
      userId: mid.userId!,
      name,
      keyHash,
      keyPrefix: prefix,
      scopes,
    })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });

  // Return the raw key ONCE — it's never stored in plaintext
  return NextResponse.json({
    id: record.id,
    key: rawKey,
    prefix,
    name,
    scopes,
    createdAt: record.createdAt.toISOString(),
    warning: 'Save this key now. It cannot be retrieved again.',
  });
  } catch (err) {
    captureException(err, { route: '/api/keys/api-key', method: 'POST' });
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
  }
}

/** GET /api/keys/api-key — list API keys (no secrets) */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;

  try {
    const db = getDb();
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsed: apiKeys.lastUsed,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, mid.userId!));

    return NextResponse.json({
      keys: keys.map((k) => ({
        ...k,
        lastUsed: k.lastUsed?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    captureException(err, { route: '/api/keys/api-key', method: 'GET' });
    return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 });
  }
}
