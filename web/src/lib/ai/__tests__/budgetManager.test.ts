import { describe, it, expect, beforeEach } from 'vitest';
import { AIBudgetManager } from '../budgetManager';
import type { BudgetWarning } from '../budgetManager';

describe('AIBudgetManager', () => {
  let manager: AIBudgetManager;

  beforeEach(() => {
    manager = new AIBudgetManager({ ceilingTokens: 100 });
  });

  // ---------------------------------------------------------------------------
  // Constructor / defaults
  // ---------------------------------------------------------------------------

  it('uses default ceiling of 500 when none supplied', () => {
    const m = new AIBudgetManager();
    expect(m.sessionCeiling).toBe(500);
  });

  it('uses supplied ceiling', () => {
    expect(manager.sessionCeiling).toBe(100);
  });

  it('starts with zero committed spend', () => {
    expect(manager.totalCommittedSpend).toBe(0);
    expect(manager.remaining).toBe(100);
    expect(manager.percentUsed).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // requestBudget — success path
  // ---------------------------------------------------------------------------

  it('grants a budget request within ceiling', () => {
    const result = manager.requestBudget('chat', 30);
    expect(result.success).toBe(true);
    expect(result.reservedTokens).toBe(30);
    expect(result.remaining).toBe(70);
    expect(result.operationId).toBeTruthy();
  });

  it('grants a zero-cost request unconditionally', () => {
    const result = manager.requestBudget('free_op', 0);
    expect(result.success).toBe(true);
    expect(result.reservedTokens).toBe(0);
    expect(result.remaining).toBe(100);
  });

  it('reduces remaining after reservation', () => {
    manager.requestBudget('op1', 40);
    expect(manager.remaining).toBe(60);
  });

  it('stacks multiple reservations', () => {
    manager.requestBudget('op1', 40);
    manager.requestBudget('op2', 30);
    expect(manager.remaining).toBe(30);
  });

  // ---------------------------------------------------------------------------
  // requestBudget — failure path
  // ---------------------------------------------------------------------------

  it('rejects a request that would exceed the ceiling', () => {
    const result = manager.requestBudget('expensive', 150);
    expect(result.success).toBe(false);
    expect(result.reservedTokens).toBe(0);
    expect(result.error).toContain('Budget exceeded');
  });

  it('rejects when cumulative reservations would exceed ceiling', () => {
    manager.requestBudget('op1', 70);
    const result = manager.requestBudget('op2', 40);
    expect(result.success).toBe(false);
  });

  it('returns remaining in rejection result', () => {
    manager.requestBudget('op1', 60);
    const result = manager.requestBudget('op2', 50);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(40);
  });

  // ---------------------------------------------------------------------------
  // releaseBudget
  // ---------------------------------------------------------------------------

  it('releases reservation and restores remaining', () => {
    const r = manager.requestBudget('op1', 50);
    expect(manager.remaining).toBe(50);
    manager.releaseBudget(r.operationId);
    expect(manager.remaining).toBe(100);
  });

  it('is a no-op for unknown operationId', () => {
    manager.requestBudget('op1', 20);
    expect(() => manager.releaseBudget('nonexistent-id')).not.toThrow();
    expect(manager.remaining).toBe(80);
  });

  // ---------------------------------------------------------------------------
  // commitBudget
  // ---------------------------------------------------------------------------

  it('commits actual spend and removes reservation', () => {
    const r = manager.requestBudget('op1', 40);
    const commit = manager.commitBudget(r.operationId, 35);
    expect(commit.success).toBe(true);
    expect(commit.actualTokens).toBe(35);
    expect(commit.totalSessionSpend).toBe(35);
    expect(commit.remaining).toBe(65);
    expect(manager.totalCommittedSpend).toBe(35);
  });

  it('handles actual > estimated gracefully', () => {
    const r = manager.requestBudget('op1', 40);
    const commit = manager.commitBudget(r.operationId, 45);
    expect(commit.totalSessionSpend).toBe(45);
    // remaining is ceiling - committed (reservation removed)
    expect(manager.remaining).toBe(55);
  });

  it('does not commit negative tokens', () => {
    const r = manager.requestBudget('op1', 10);
    manager.commitBudget(r.operationId, -5);
    expect(manager.totalCommittedSpend).toBe(0);
  });

  it('accumulates multiple commits', () => {
    const r1 = manager.requestBudget('op1', 20);
    const r2 = manager.requestBudget('op2', 30);
    manager.commitBudget(r1.operationId, 20);
    manager.commitBudget(r2.operationId, 30);
    expect(manager.totalCommittedSpend).toBe(50);
    expect(manager.remaining).toBe(50);
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  it('resets all state', () => {
    const r = manager.requestBudget('op1', 60);
    manager.commitBudget(r.operationId, 60);
    manager.reset();
    expect(manager.totalCommittedSpend).toBe(0);
    expect(manager.remaining).toBe(100);
    expect(manager.percentUsed).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Warning callbacks
  // ---------------------------------------------------------------------------

  it('fires warning_80 at 80% utilisation', () => {
    const warnings: BudgetWarning[] = [];
    const m = new AIBudgetManager({ ceilingTokens: 100, onWarning: (w) => warnings.push(w) });
    const r = m.requestBudget('op1', 80);
    m.commitBudget(r.operationId, 80);
    expect(warnings.some((w) => w.level === 'warning_80')).toBe(true);
  });

  it('fires warning_95 at 95% utilisation', () => {
    const warnings: BudgetWarning[] = [];
    const m = new AIBudgetManager({ ceilingTokens: 100, onWarning: (w) => warnings.push(w) });
    const r = m.requestBudget('op1', 95);
    m.commitBudget(r.operationId, 95);
    // Both 80% and 95% thresholds will fire when crossing 95%
    expect(warnings.some((w) => w.level === 'warning_95')).toBe(true);
  });

  it('fires warning_80 then warning_95 as spend grows', () => {
    const warnings: BudgetWarning[] = [];
    const m = new AIBudgetManager({ ceilingTokens: 100, onWarning: (w) => warnings.push(w) });

    const r1 = m.requestBudget('op1', 82);
    m.commitBudget(r1.operationId, 82);
    expect(warnings.map((w) => w.level)).toContain('warning_80');

    const r2 = m.requestBudget('op2', 13);
    m.commitBudget(r2.operationId, 13);
    expect(warnings.map((w) => w.level)).toContain('warning_95');
  });

  it('does not fire the same warning twice', () => {
    const warnings: BudgetWarning[] = [];
    const m = new AIBudgetManager({ ceilingTokens: 100, onWarning: (w) => warnings.push(w) });

    const r1 = m.requestBudget('op1', 81);
    m.commitBudget(r1.operationId, 81);
    const r2 = m.requestBudget('op2', 1);
    m.commitBudget(r2.operationId, 1);

    const warning80Calls = warnings.filter((w) => w.level === 'warning_80');
    expect(warning80Calls).toHaveLength(1);
  });

  it('resets warning flags on reset()', () => {
    let callCount = 0;
    const m = new AIBudgetManager({ ceilingTokens: 100, onWarning: () => { callCount++; } });
    const r1 = m.requestBudget('op1', 80);
    m.commitBudget(r1.operationId, 80);
    const countAfterFirst = callCount;
    m.reset();
    const r2 = m.requestBudget('op2', 80);
    m.commitBudget(r2.operationId, 80);
    expect(callCount).toBeGreaterThan(countAfterFirst);
  });

  // ---------------------------------------------------------------------------
  // percentUsed
  // ---------------------------------------------------------------------------

  it('reports correct percentage', () => {
    const r = manager.requestBudget('op1', 25);
    manager.commitBudget(r.operationId, 25);
    expect(manager.percentUsed).toBe(25);
  });

  it('caps percentUsed at 100', () => {
    const r = manager.requestBudget('op1', 100);
    manager.commitBudget(r.operationId, 110);
    expect(manager.percentUsed).toBe(100);
  });
});
