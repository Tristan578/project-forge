/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { WorldPanel } from '../WorldPanel';

vi.mock('@/lib/ai/worldBuilder', () => ({
  validateWorldConsistency: vi.fn(() => ({ issues: [], score: 100 })),
  worldToMarkdown: vi.fn(() => ''),
}));
vi.mock('@/lib/chat/handlers/worldHandlers', () => ({
  loadPersistedWorld: vi.fn(() => null),
}));

describe('WorldPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing when no world prop provided', () => {
    const { container } = render(<WorldPanel onRegenerate={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
  });
});
