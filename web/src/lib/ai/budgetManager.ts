/**
 * AIBudgetManager — tracks cumulative token spend per session.
 *
 * Responsibilities:
 *   - Reserve tokens before an AI operation starts (requestBudget)
 *   - Release reserved tokens if an operation is cancelled (releaseBudget)
 *   - Finalize actual spend after an operation completes (commitBudget)
 *   - Enforce a hard per-session ceiling and emit warnings at 80% / 95%
 */

export interface BudgetRequest {
  operationId: string;
  operation: string;
  estimatedTokens: number;
}

export interface BudgetResult {
  success: boolean;
  operationId: string;
  reservedTokens: number;
  /** Tokens remaining after reservation (accounting for other pending reservations) */
  remaining: number;
  error?: string;
}

export interface BudgetCommitResult {
  success: boolean;
  actualTokens: number;
  totalSessionSpend: number;
  remaining: number;
}

export interface BudgetWarning {
  level: 'warning_80' | 'warning_95';
  percentUsed: number;
  totalSpend: number;
  ceiling: number;
  remaining: number;
}

export type BudgetWarningCallback = (warning: BudgetWarning) => void;

interface ReservationEntry {
  operationId: string;
  operation: string;
  estimatedTokens: number;
  reservedAt: number;
}

export interface BudgetManagerOptions {
  /** Hard ceiling for the session in tokens. Default: 500 */
  ceilingTokens?: number;
  /** Callback fired when spend crosses 80% or 95% thresholds */
  onWarning?: BudgetWarningCallback;
}

export class AIBudgetManager {
  private readonly ceiling: number;
  private committedSpend: number = 0;
  private reservations: Map<string, ReservationEntry> = new Map();
  private readonly onWarning?: BudgetWarningCallback;
  private warnedAt80 = false;
  private warnedAt95 = false;

  constructor(options: BudgetManagerOptions = {}) {
    this.ceiling = options.ceilingTokens ?? 500;
    this.onWarning = options.onWarning;
  }

  /** Total tokens currently reserved (pending operations) */
  private get pendingTokens(): number {
    let total = 0;
    for (const r of this.reservations.values()) {
      total += r.estimatedTokens;
    }
    return total;
  }

  /** Tokens committed + reserved (effective spend) */
  private get effectiveSpend(): number {
    return this.committedSpend + this.pendingTokens;
  }

  /** Tokens available before hitting the ceiling */
  get remaining(): number {
    return Math.max(0, this.ceiling - this.effectiveSpend);
  }

  /** Total tokens committed so far in this session */
  get totalCommittedSpend(): number {
    return this.committedSpend;
  }

  /** The session ceiling */
  get sessionCeiling(): number {
    return this.ceiling;
  }

  /**
   * Check whether the session has sufficient headroom and reserve tokens for
   * the given operation. Returns a failure result (does NOT throw) if budget
   * would be exceeded.
   */
  requestBudget(operation: string, estimatedTokens: number): BudgetResult {
    const operationId = `${operation}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    if (estimatedTokens <= 0) {
      // Free operations always succeed; still register so callers can commitBudget
      const entry: ReservationEntry = {
        operationId,
        operation,
        estimatedTokens: 0,
        reservedAt: Date.now(),
      };
      this.reservations.set(operationId, entry);
      return {
        success: true,
        operationId,
        reservedTokens: 0,
        remaining: this.remaining,
      };
    }

    const wouldSpend = this.effectiveSpend + estimatedTokens;
    if (wouldSpend > this.ceiling) {
      return {
        success: false,
        operationId,
        reservedTokens: 0,
        remaining: this.remaining,
        error: `Budget exceeded: need ${estimatedTokens} tokens but only ${this.remaining} remaining in session (ceiling: ${this.ceiling})`,
      };
    }

    const entry: ReservationEntry = {
      operationId,
      operation,
      estimatedTokens,
      reservedAt: Date.now(),
    };
    this.reservations.set(operationId, entry);

    const remaining = this.remaining;
    this.checkThresholds();

    return {
      success: true,
      operationId,
      reservedTokens: estimatedTokens,
      remaining,
    };
  }

  /**
   * Release a reservation without committing spend — use when an operation
   * is cancelled before it consumes any tokens.
   */
  releaseBudget(operationId: string): void {
    this.reservations.delete(operationId);
  }

  /**
   * Finalise token spend for a completed operation.
   * Removes the reservation and adds actualTokens to committed spend.
   */
  commitBudget(operationId: string, actualTokens: number): BudgetCommitResult {
    this.reservations.delete(operationId);
    this.committedSpend += Math.max(0, actualTokens);

    const remaining = this.remaining;
    this.checkThresholds();

    return {
      success: true,
      actualTokens,
      totalSessionSpend: this.committedSpend,
      remaining,
    };
  }

  /** Reset the manager — useful when starting a new session */
  reset(): void {
    this.committedSpend = 0;
    this.reservations.clear();
    this.warnedAt80 = false;
    this.warnedAt95 = false;
  }

  /** Current utilisation as a percentage (0–100) */
  get percentUsed(): number {
    return Math.min(100, (this.effectiveSpend / this.ceiling) * 100);
  }

  private checkThresholds(): void {
    if (!this.onWarning) return;
    const pct = this.percentUsed;

    if (!this.warnedAt95 && pct >= 95) {
      this.warnedAt95 = true;
      this.onWarning({
        level: 'warning_95',
        percentUsed: pct,
        totalSpend: this.effectiveSpend,
        ceiling: this.ceiling,
        remaining: this.remaining,
      });
    } else if (!this.warnedAt80 && pct >= 80) {
      this.warnedAt80 = true;
      this.onWarning({
        level: 'warning_80',
        percentUsed: pct,
        totalSpend: this.effectiveSpend,
        ceiling: this.ceiling,
        remaining: this.remaining,
      });
    }
  }
}
