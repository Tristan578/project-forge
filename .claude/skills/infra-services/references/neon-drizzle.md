# Neon Postgres + Drizzle ORM Patterns

## Configuration
- Driver: `@neondatabase/serverless` (neon-http for serverless, NOT node-postgres)
- ORM: Drizzle (`drizzle-orm` + `drizzle-kit`)
- Schema: @web/src/lib/db/schema.ts
- Client: @web/src/lib/db/client.ts (exports `getDb()`)
- Env: `DATABASE_URL` (server-only, never `NEXT_PUBLIC_`)

## Import Pattern
```typescript
import { getDb } from '@/lib/db/client';
import { users, creditTransactions } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
```

## Gotchas
1. **Cold starts**: First query after inactivity takes 1-2s. Connection pooling helps.
2. **neon-http vs neon-serverless**: neon-http is for simple queries. For transactions with serializable isolation, may need neon-serverless WebSocket driver (PF-662).
3. **No raw SQL interpolation**: Always use Drizzle's parameterized query builders. Never template-string SQL.
4. **Transaction context**: Pass the transaction handle (`tx`) to functions that need atomic operations. See `subscription-lifecycle.ts` for the pattern.
5. **Migration**: `npx drizzle-kit push` for schema changes. No manual SQL.
6. **Validation**: API routes use manual `typeof` checks, NOT Zod. Zod is not installed.

## Testing
- Mock `getDb()` in tests, don't hit real database
- `vi.mock('@/lib/db/client')` -- use `@/` alias, never relative paths
