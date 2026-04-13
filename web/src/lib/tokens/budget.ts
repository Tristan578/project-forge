/**
 * Token budget reservation for game creation pipelines.
 *
 * Wraps the existing token service with pipeline-specific operations:
 * - reserveTokenBudget(): deducts the high-variance estimate upfront
 * - releaseUnusedBudget(): refunds the difference (reserved - actual)
 * - recordStepUsage(): inserts audit rows per-step (no additional deduction)
 *
 * No new DB tables — uses existing token_usage table with metadata.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 3)
 */

import { deductTokens, refundTokenAmount, getTokenBalance } from './service';
import type { TokenBalance } from './service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetReservation {
  reservationId: string;
  userId: string;
  estimatedTotal: number;
  actualUsed: number;
  status: 'active' | 'released' | 'expired';
  createdAt: string;
}

export interface ReserveSuccess {
  success: true;
  reservationId: string;
  remaining: TokenBalance;
}

export interface ReserveError {
  success: false;
  error: 'INSUFFICIENT_TOKENS';
  balance: TokenBalance;
  cost: number;
}

// ---------------------------------------------------------------------------
// Reserve
// ---------------------------------------------------------------------------

/**
 * Reserve tokens upfront for a pipeline run.
 *
 * Deducts the full estimated cost atomically using the existing
 * deductTokens() with operation 'pipeline_reserve'. The reservation ID
 * is the usage record ID — used later to release unused tokens.
 */
export async function reserveTokenBudget(
  userId: string,
  estimatedTotal: number,
): Promise<ReserveSuccess | ReserveError> {
  if (estimatedTotal <= 0) {
    const balance = await getTokenBalance(userId);
    return {
      success: true,
      reservationId: 'free',
      remaining: balance,
    };
  }

  const result = await deductTokens(
    userId,
    'pipeline_reserve',
    estimatedTotal,
    undefined,
    { type: 'pipeline_reservation', estimatedTotal },
  );

  if (!result.success) {
    return {
      success: false,
      error: 'INSUFFICIENT_TOKENS',
      balance: result.balance,
      cost: estimatedTotal,
    };
  }

  return {
    success: true,
    reservationId: result.usageId,
    remaining: result.remaining,
  };
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

/**
 * Release unused tokens after pipeline completes or cancels.
 *
 * Calculates (reserved - actualUsed) and refunds the difference.
 * Uses refundTokenAmount() which is idempotent via the CTE pattern.
 */
export async function releaseUnusedBudget(
  userId: string,
  reservationId: string,
  actualUsed: number,
): Promise<{ refunded: number; remaining: TokenBalance }> {
  if (reservationId === 'free') {
    const remaining = await getTokenBalance(userId);
    return { refunded: 0, remaining };
  }

  // Look up the original reservation to find reserved amount
  // We use getTokenBalance to get current state, but the reserved amount
  // is tracked via metadata on the original usage record
  const { getNeonSql, queryWithResilience } = await import('../db/client');
  const neonSql = getNeonSql();

  const rows = await queryWithResilience(() =>
    neonSql`
      SELECT tokens, metadata
      FROM token_usage
      WHERE id = ${reservationId}::uuid
        AND user_id = ${userId}::uuid
        AND operation = 'pipeline_reserve'
      LIMIT 1
    `
  );

  if (rows.length === 0) {
    const remaining = await getTokenBalance(userId);
    return { refunded: 0, remaining };
  }

  const reserved = (rows[0] as { tokens: number }).tokens;
  const refundAmount = Math.max(0, reserved - actualUsed);

  if (refundAmount > 0) {
    await refundTokenAmount(
      userId,
      refundAmount,
      'pipeline_unused_budget',
      reservationId,
    );
  }

  const remaining = await getTokenBalance(userId);
  return { refunded: refundAmount, remaining };
}

// ---------------------------------------------------------------------------
// Step Usage Tracking
// ---------------------------------------------------------------------------

/**
 * Record per-step usage against a reservation (audit only).
 *
 * Inserts a token_usage row with operation 'pipeline_step' and metadata
 * linking to the reservation. No additional deduction — the tokens were
 * already reserved upfront.
 */
export async function recordStepUsage(
  userId: string,
  reservationId: string,
  stepId: string,
  tokensUsed: number,
): Promise<void> {
  if (tokensUsed <= 0 || reservationId === 'free') return;

  const { getNeonSql, queryWithResilience } = await import('../db/client');
  const neonSql = getNeonSql();

  const metadata = JSON.stringify({
    reservationId,
    stepId,
    type: 'pipeline_step_audit',
  });

  // Verify the reservation belongs to this user and get source
  const rows = await queryWithResilience(() =>
    neonSql`
      SELECT user_id, source FROM token_usage
      WHERE id = ${reservationId}::uuid AND user_id = ${userId}
      LIMIT 1
    `
  );

  if (rows.length === 0) return;

  const row = rows[0] as { user_id: string; source: string };
  const source = row.source;

  await queryWithResilience(() =>
    neonSql`
      INSERT INTO token_usage (user_id, operation, tokens, source, metadata)
      VALUES (${userId}, 'pipeline_step', ${tokensUsed}, ${source}, ${metadata}::jsonb)
    `
  );
}
