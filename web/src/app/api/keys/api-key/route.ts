import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import type { ApiKeyScope } from '@/lib/db/schema';

const VALID_SCOPES: ApiKeyScope[] = ['scene:read', 'scene:write', 'ai:generate', 'project:manage'];

/** POST /api/keys/api-key — generate a new MCP API key */
export async function POST(req: Request) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // MCP keys require Creator+ tier
  const tierCheck = assertTier(authResult.ctx.user, ['creator', 'pro']);
  if (tierCheck) return tierCheck;

  const body = await req.json();
  const name = (body.name as string) || 'Default';
  const scopes = (body.scopes as ApiKeyScope[]) || VALID_SCOPES;

  // Validate scopes
  const invalidScopes = scopes.filter((s: string) => !VALID_SCOPES.includes(s as ApiKeyScope));
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
}

/** GET /api/keys/api-key — list API keys (no secrets) */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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
}
