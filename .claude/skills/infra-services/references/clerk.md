# Clerk Auth Patterns

## Configuration
- SDK: `@clerk/nextjs` (Next.js integration)
- Edge middleware: @web/src/proxy.ts -- exports `proxy` function (Next.js 16 convention)
- Auth helper: @web/src/lib/auth/api-auth.ts -- exports `authenticateRequest()` returning `AuthContext`
- User sync: @web/src/lib/auth/user-service.ts -- `syncUserFromClerk()` creates/updates DB user
- Env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (client), `CLERK_SECRET_KEY` (server)

## Import Pattern
```typescript
import { auth, clerkClient } from '@clerk/nextjs/server';
import { getUserByClerkId, syncUserFromClerk } from '@/lib/auth/user-service';
```

## API Route Auth Pattern
```typescript
import { authenticateRequest, type AuthContext } from '@/lib/auth/api-auth';

export async function POST(request: Request) {
  const authResult = await authenticateRequest(request);
  if (authResult instanceof NextResponse) return authResult; // 401
  const { user } = authResult as AuthContext;
  // ... use user.id, user.tier, etc.
}
```

## Gotchas
1. **Edge Runtime**: `proxy.ts` runs on Vercel Edge. No Node.js APIs.
2. **Webhook handler**: Clerk webhooks need `svix` signature verification. See user-service for sync pattern.
3. **User deletion**: Must handle `user.deleted` webhook events to honor account deletion (PF-472, done).
4. **Dev bypass**: `http://localhost:3000/dev` bypasses auth for local testing without Clerk keys.
5. **CI builds**: Root layout uses `force-dynamic` so build works without Clerk env vars.

## Testing
- Mock `@clerk/nextjs/server`: `vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn() }))`
- Test file: `web/src/lib/auth/api-auth.test.ts`
