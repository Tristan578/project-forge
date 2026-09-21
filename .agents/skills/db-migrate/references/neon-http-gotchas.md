# Neon HTTP Driver Gotchas

Critical pitfalls for the neon-http Drizzle driver used in `web/src/lib/db/`.

## 1. db.transaction() THROWS — Never Use It

The neon-http driver does NOT support Drizzle's `db.transaction()`. Calling it throws
at runtime:

```ts
// WRONG — throws "No transactions support in neon-http driver"
await db.transaction(async (tx) => {
  await tx.insert(users).values(...);
  await tx.update(tokens).set(...);
});
```

Use `getNeonSql()` and the raw neon tagged template instead:

```ts
import { getNeonSql } from '@/lib/db/client';

const neonSql = getNeonSql();

await neonSql.transaction([
  neonSql`INSERT INTO users (id, email) VALUES (${id}, ${email})`,
  neonSql`UPDATE token_balances SET balance = balance - ${cost} WHERE user_id = ${id}`,
]);
```

The hook in `.claude/hooks/check-db-transaction.sh` warns on every Edit/Write when
`db.transaction(` is detected.

## 2. Tagged Template Returns Row[] — Not { rowCount }

`neonSql`...`` resolves to `Row[]`, not an object with `.rowCount`:

```ts
// WRONG — rowCount is undefined, always truthy
const result = await neonSql`INSERT INTO foo (x) VALUES (${x})`;
if (result.rowCount > 0) { ... }

// CORRECT — use .length
const result = await neonSql`INSERT INTO foo (x) VALUES (${x})`;
if (result.length > 0) { ... }
```

`INSERT ... WHERE NOT EXISTS` returns an empty array when the row is skipped — not an
error.

## 3. Transaction Statement Ordering

PostgreSQL evaluates statements within a neon transaction sequentially. Each statement
sees the effects of all prior statements:

```ts
// CORRECT — INSERT runs first so the subsequent SELECT can find the new row
await neonSql.transaction([
  neonSql`INSERT INTO audit_log (usage_id, action) VALUES (${usageId}, 'charged')`,
  neonSql`UPDATE token_balances
          SET balance = balance - (SELECT cost FROM usage_records WHERE id = ${usageId})
          WHERE user_id = ${userId}`,
]);

// WRONG — UPDATE reads usage_records before INSERT has run
await neonSql.transaction([
  neonSql`UPDATE token_balances SET balance = balance - (SELECT cost FROM usage_records WHERE id = ${usageId}) WHERE user_id = ${userId}`,
  neonSql`INSERT INTO audit_log (usage_id, action) VALUES (${usageId}, 'charged')`,
]);
```

Rule: **INSERT...SELECT must always appear BEFORE the UPDATE that reads from it.**

## 4. Drizzle onConflictDoUpdate — List All Mutable Fields

When using `.onConflictDoUpdate()`, the `.set()` object must include EVERY mutable field.
Missing fields silently keep their original values:

```ts
// WRONG — name silently stays unchanged on conflict
await db.insert(projects)
  .values({ id, name, updatedAt })
  .onConflictDoUpdate({
    target: projects.id,
    set: { updatedAt },   // missing name!
  });

// CORRECT
await db.insert(projects)
  .values({ id, name, updatedAt })
  .onConflictDoUpdate({
    target: projects.id,
    set: { name, updatedAt },
  });
```

After writing any upsert, compare the `.values()` fields with the `.set()` fields.

## 5. Idempotent Refunds

Never refund by simply crediting tokens without checking if the refund already happened.
Use a metadata JSONB guard:

```ts
// Check before crediting
const [record] = await db
  .select({ metadata: usageRecords.metadata })
  .from(usageRecords)
  .where(eq(usageRecords.id, usageId));

const already = (record?.metadata as Record<string, unknown>)?.refundedUsageId;
if (already) return; // idempotent — skip

// Credit and mark
await neonSql.transaction([
  neonSql`UPDATE token_balances SET balance = balance + ${amount} WHERE user_id = ${userId}`,
  neonSql`UPDATE usage_records SET metadata = metadata || '{"refundedUsageId": ${usageId}}' WHERE id = ${usageId}`,
]);
```

## 6. ZADD Member Uniqueness

`Date.now()` can collide within the same millisecond in sorted sets. Add a random suffix:

```ts
// WRONG — members collide in same ms
await redis.zadd(key, { score: Date.now(), member: Date.now().toString() });

// CORRECT — unique enough for sorted set members
const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
await redis.zadd(key, { score: Date.now(), member });
```
