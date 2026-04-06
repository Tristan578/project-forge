import { getDb, queryWithResilience } from '../db/client';
import { costLog } from '../db/schema';

/**
 * Log a cost event for audit and analytics.
 * Append-only — no business logic, just recording.
 */
export async function logCost(
  userId: string,
  actionType: string,
  provider: string | null,
  actualCostCents: number | null,
  tokensCharged: number,
  metadata?: Record<string, unknown>
): Promise<string> {
  const [record] = await queryWithResilience(() =>
    getDb()
      .insert(costLog)
      .values({
        userId,
        actionType,
        provider,
        actualCostCents,
        tokensCharged,
        requestMetadata: metadata ?? null,
      })
      .returning({ id: costLog.id })
  );
  return record.id;
}
