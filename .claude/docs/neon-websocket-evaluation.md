# Neon WebSocket Driver Evaluation

> PF-662 — Evaluated: 2026-03-22

## Current Setup

Driver: `@neondatabase/serverless` HTTP driver
Config: `web/src/lib/db/client.ts` — `neon()` function with `{ fullResults: false }`
ORM: Drizzle ORM, using `drizzle(neon(process.env.DATABASE_URL))`.

The HTTP driver executes each SQL statement as an independent HTTPS request to the Neon serverless proxy. There is no persistent connection. This is the recommended default for Next.js API routes deployed on Vercel.

## Alternative: WebSocket Driver

`@neondatabase/serverless` also exports a WebSocket-based client (`Pool` or `Client`) that maintains a persistent TCP connection to the Neon proxy over WebSockets, enabling:

- True multi-statement transactions (`BEGIN / COMMIT / ROLLBACK`)
- Connection pooling (reuse connections within a process lifetime)
- Lower per-query latency once connection is established (no TLS handshake on each request)

## Pros

- **Real transactions** — atomic reads and writes across multiple tables. Currently, tier changes (e.g. upgrading from hobbyist to creator) use advisory locks as a workaround but are still susceptible to read-modify-write races between the lock acquisition and the write.
- **Lower tail latency** — warm WebSocket connection eliminates per-request TLS negotiation overhead (~20-50ms saved on cache-miss requests).
- **Standard Postgres semantics** — `SERIALIZABLE` isolation available, useful for credit deduction + cost logging atomicity.

## Cons

- **Serverless cold starts** — Vercel function instances spin up cold on every request surge. A WebSocket connection must be established during the cold start, adding latency that the HTTP driver avoids (HTTP driver uses connection pooling in the Neon proxy itself, which is always warm).
- **Connection lifecycle management** — The caller must explicitly call `pool.end()` / `client.end()` to avoid open handles. In Next.js route handlers this requires careful try/finally blocks or module-level pools with process cleanup hooks.
- **WebSocket reconnection** — If the Neon proxy drops the connection (idle timeout, proxy restart), the client must reconnect. The HTTP driver has no persistent connection to drop.
- **Vercel edge runtime** — The WebSocket driver does not run on the Vercel Edge Runtime (no native Node.js `net` module). All routes using the WebSocket driver must use the Node.js runtime (`export const runtime = 'nodejs'`), which most routes already declare.
- **Additional complexity** — Module-level `Pool` singletons interact unpredictably with Next.js hot-reload in development. The HTTP driver is stateless and has no such issue.

## What Needs Transactions Right Now

| Operation | Risk without transaction | Current mitigation |
|-----------|--------------------------|-------------------|
| Tier upgrade / downgrade | Double-charge or missed deduction if two requests race | Advisory lock (`pg_advisory_xact_lock`) — partial protection |
| Credit deduction + cost log insert | Cost logged but deduction failed (or vice versa) | Both writes are in the same route handler; failure leaves inconsistency |
| Appeal approval + content unflag | Appeal approved but content remains flagged | No mitigation — two separate `await db.update()` calls |

## Recommendation

**Stay with the HTTP driver for now.**

The majority of API routes perform single-statement operations (insert one row, update one row) where the HTTP driver is perfectly adequate. The throughput advantage of connection pooling is already provided by the Neon serverless proxy, which maintains its own pool toward Postgres.

When true transactions are needed, use the WebSocket `neon()` transaction helper instead of switching the entire application:

```typescript
// Targeted transaction using the HTTP driver's built-in transaction API
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
await sql.transaction([
  sql`UPDATE credit_transactions SET balance = balance - ${amount} WHERE user_id = ${userId}`,
  sql`INSERT INTO cost_log (user_id, amount, reason) VALUES (${userId}, ${amount}, ${reason})`,
]);
```

This avoids the cold-start and reconnection complexity of the WebSocket driver while still providing atomic multi-statement execution.

## When to Reconsider

Switch to the WebSocket driver if any of the following become true:

1. SpawnForge introduces long-running API operations that benefit from server-sent events or streaming database results (e.g. real-time collaboration cursors).
2. P99 database latency becomes a user-facing problem and profiling shows TLS handshakes are the dominant cost.
3. A route requires `SERIALIZABLE` isolation that cannot be expressed with advisory locks.

In those cases, scope the WebSocket driver to specific modules rather than changing the global client, and add explicit `pool.end()` in cleanup hooks.

## References

- [Neon serverless driver docs](https://neon.tech/docs/serverless/serverless-driver)
- `web/src/lib/db/client.ts` — current HTTP driver setup
- `web/src/lib/db/schema.ts` — Drizzle schema (costLog, creditTransactions, tierConfig, tokenConfig)
