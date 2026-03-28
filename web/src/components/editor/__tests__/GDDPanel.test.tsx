/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { GDDPanel } from '../GDDPanel';

vi.mock('@/lib/ai/gddGenerator', () => ({
  generateGDD: vi.fn().mockResolvedValue({}),
  gddToMarkdown: vi.fn(() => ''),
  estimateScope: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/systemDecomposer', () => ({
  decomposeIntoSystems: vi.fn(() => []),
  getSystemLabel: vi.fn(() => ''),
}));

describe('GDDPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<GDDPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
