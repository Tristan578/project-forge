import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { assertTier } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import { captureException } from '@/lib/monitoring/sentry-server';
import { API_KEY_SCOPES, findInvalidScopes, type ApiKeyScope } from '@/lib/config/scopes';
import { RATE_LIMIT_ADMIN_WINDOW_MS } from '@/lib/config/timeouts';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
});

/** POST /api/keys/api-key — generate a new MCP API key */
async function POST_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `apikey-gen:${id}`, max: 5, windowSeconds: RATE_LIMIT_ADMIN_WINDOW_MS / 1000, distributed: false },
    validate: createApiKeySchema,
  });
  if (mid.error) return mid.error;

  // MCP keys require Creator+ tier
  const tierCheck = assertTier(mid.authContext!.user, ['creator', 'pro']);
  if (tierCheck) return tierCheck;

  const body = mid.body as z.infer<typeof createApiKeySchema>;
  const name = body.name && body.name.length > 0 ? body.name : 'Default';
  const scopes: ApiKeyScope[] = body.scopes ? (body.scopes as ApiKeyScope[]) : [...API_KEY_SCOPES];

  // Validate scopes
  const invalidScopes = findInvalidScopes(scopes);
  if (invalidScopes.length > 0) {
    return NextResponse.json(
      { error: `Invalid scopes: ${invalidScopes.join(', ')}` },
      { status: 400 }
    );
  }

  // Generate key: forge_ + 32 random BYTES rendered as 64 hex characters.
  //
  // The count matters and this comment used to get it wrong ("32 random hex
  // chars"), which is exactly what produced `/\bforge_[0-9a-f]{32}\b/` in
  // `redactSecrets.ts` — a pattern that could never match a real key, because
  // `{32}` cannot backtrack and the 33rd hex character defeats the trailing
  // `\b`. It was listed as coverage for the one credential class this codebase
  // can name with certainty and provided none. The regex is corrected to {64};
  // this line is corrected so the next reader does not re-derive the same
  // wrong length.
  const rawKey = `forge_${randomBytes(32).toString('hex')}`;
  const prefix = rawKey.slice(0, 12); // "forge_xxxx" — enough for identification
  const keyHash = await bcrypt.hash(rawKey, 12);

  try {
  const [record] = await queryWithResilience(() =>
    getDb()
      .insert(apiKeys)
      .values({
        userId: mid.userId!,
        name,
        keyHash,
        keyPrefix: prefix,
        scopes,
      })
      .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt })
  );

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
    return redactedJson({ error: 'Failed to create API key' }, { status: 500 });
  }
}

/** GET /api/keys/api-key — list API keys (no secrets) */
async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;

  try {
    const keys = await queryWithResilience(() =>
      getDb()
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          lastUsed: apiKeys.lastUsed,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, mid.userId!))
    );

    return NextResponse.json({
      keys: keys.map((k) => ({
        ...k,
        lastUsed: k.lastUsed?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    captureException(err, { route: '/api/keys/api-key', method: 'GET' });
    return redactedJson({ error: 'Failed to list API keys' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
export const GET = withEgressGuard(GET_impl);
