/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { QuestGeneratorPanel } from '../QuestGeneratorPanel';

vi.mock('@/lib/ai/questGenerator', () => ({
  generateQuestChain: vi.fn().mockResolvedValue({}),
  validateGenerateOptions: vi.fn(() => ({ valid: true, errors: [] })),
  exportQuestChainToScript: vi.fn(() => ''),
  CHAIN_TEMPLATES: {
    hero_origin: {
      id: 'hero_origin',
      name: 'Hero Origin',
      description: 'A classic hero journey from humble beginnings to legendary status.',
      arcDescription: 'Humble to legendary',
      questCount: 5,
    },
  },
}));

describe('QuestGeneratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<QuestGeneratorPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
