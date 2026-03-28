import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { API_KEY_SCOPES, findInvalidScopes, type ApiKeyScope } from '@/lib/config/scopes';
import { RATE_LIMIT_ADMIN_WINDOW_MS } from '@/lib/config/timeouts';

/** POST /api/keys/api-key — generate a new MCP API key */
export async function POST(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 5 API key generation requests per minute per user
  const rl = await rateLimit(`apikey-gen:${authResult.ctx.user.id}`, 5, RATE_LIMIT_ADMIN_WINDOW_MS);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  // MCP keys require Creator+ tier
  const tierCheck = assertTier(authResult.ctx.user, ['creator', 'pro']);
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
      userId: authResult.ctx.user.id,
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
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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
      .where(eq(apiKeys.userId, authResult.ctx.user.id));

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
