/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { DifficultyPanel } from '../DifficultyPanel';

vi.mock('@/lib/ai/difficultyAdjustment', () => ({
  DDA_PRESETS: {
    standard: {
      enabled: true,
      sensitivity: 0.5,
      minDifficulty: 0.3,
      maxDifficulty: 1.0,
      adjustmentSpeed: 0.1,
      cooldownSeconds: 15,
      isCompetitive: false,
    },
  },
  createDefaultProfile: vi.fn(() => ({
    level: 0.5,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    enemySpeedMultiplier: 1.0,
    resourceDropRate: 1.0,
    checkpointFrequency: 1.0,
    hintDelay: 5.0,
  })),
  calculateDifficultyAdjustment: vi.fn(() => ({})),
  generateDDAScript: vi.fn(() => ''),
}));

describe('DifficultyPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<DifficultyPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
