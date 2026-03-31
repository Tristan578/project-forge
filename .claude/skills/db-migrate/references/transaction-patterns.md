# Transaction Patterns Reference

Correct patterns for atomic database operations with the neon-http driver and Drizzle ORM.

## The Golden Rule

**Never use `db.transaction()`.** It throws on neon-http. Always use `getNeonSql()`.

```ts
import { getNeonSql } from '@/lib/db/client';
const neonSql = getNeonSql();

await neonSql.transaction([
  neonSql`...statement 1...`,
  neonSql`...statement 2...`,
]);
```

## Pattern 1: INSERT Before SELECT-dependent UPDATE

When an UPDATE reads data that an INSERT creates, the INSERT must come first:

```ts
// Scenario: charge user for a job, then log the charge
await neonSql.transaction([
  // 1. Create the usage record first
  neonSql`
    INSERT INTO usage_records (id, user_id, cost, created_at)
    VALUES (${usageId}, ${userId}, ${cost}, NOW())
  `,
  // 2. Deduct from balance (reads usage_records)
  neonSql`
    UPDATE token_balances
    SET balance = balance - ${cost},
        updated_at = NOW()
    WHERE user_id = ${userId}
  `,
]);
```

## Pattern 2: Atomic Upsert — List ALL Mutable Fields in .set()

```ts
await db
  .insert(projects)
  .values({
    id: project.id,
    name: project.name,
    description: project.description,
    updatedAt: new Date(),
  })
  .onConflictDoUpdate({
    target: projects.id,
    set: {
      // List EVERY field that should update on conflict
      name: project.name,
      description: project.description,
      updatedAt: new Date(),
      // DO NOT forget fields — missing ones silently keep the original value
    },
  });
```

Checklist after writing any upsert:
- [ ] Every field in `.values()` that is mutable appears in `.set()`
- [ ] `id` and `createdAt` intentionally excluded from `.set()` (correct)
- [ ] All nullable fields included if they should be updatable

## Pattern 3: Delete Children Before Re-inserting

Avoid duplicates on concurrent upserts by deleting then re-inserting child rows:

```ts
await neonSql.transaction([
  // Delete existing children first
  neonSql`DELETE FROM scene_entities WHERE scene_id = ${sceneId}`,
  // Re-insert all children atomically
  ...entities.map(e =>
    neonSql`INSERT INTO scene_entities (id, scene_id, data) VALUES (${e.id}, ${sceneId}, ${JSON.stringify(e.data)})`
  ),
]);
```

Do NOT use upsert for children when there may be rows to delete — only deleted rows vanish,
orphaned rows from previous inserts will remain.

## Pattern 4: Checking Results

`neonSql` returns `Row[]`. Use `.length` to check whether rows were affected:

```ts
const rows = await neonSql`
  UPDATE token_balances
  SET balance = balance - ${cost}
  WHERE user_id = ${userId} AND balance >= ${cost}
  RETURNING balance
`;

if (rows.length === 0) {
  throw new Error('Insufficient balance or user not found');
}

const newBalance = (rows[0] as { balance: number }).balance;
```

## Pattern 5: INSERT WHERE NOT EXISTS (conditional insert)

Returns empty array when skipped — not an error:

```ts
const rows = await neonSql`
  INSERT INTO email_verifications (id, user_id, token)
  SELECT ${id}, ${userId}, ${token}
  WHERE NOT EXISTS (
    SELECT 1 FROM email_verifications WHERE user_id = ${userId}
  )
  RETURNING id
`;

if (rows.length === 0) {
  // Already verified — not an error, just idempotent
}
```

## Pattern 6: ZADD Unique Members

`Date.now()` alone collides in high-throughput code. Always add a random suffix:

```ts
const member = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
await redis.zadd(`user:${userId}:events`, { score: Date.now(), member });
```

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| `db.transaction(async tx => ...)` | Throws on neon-http | Use `neonSql.transaction([...])` |
| `result.rowCount` on neonSql result | undefined — always truthy | Use `result.length` |
| UPDATE before INSERT it depends on | UPDATE sees no data yet | Swap order |
| Missing fields in `.onConflictDoUpdate().set()` | Silent data loss | List all mutable fields |
| INSERT children without prior DELETE | Duplicate rows on retry | DELETE first |
| `Date.now()` as ZADD member | Collisions in same ms | Append random suffix |
