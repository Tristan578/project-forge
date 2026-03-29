/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { IdeaGeneratorPanel } from '../IdeaGeneratorPanel';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/ideaGenerator', () => ({
  GENRE_CATALOG: [],
  MECHANIC_CATALOG: [],
  generateIdeas: vi.fn().mockResolvedValue([]),
  buildGddPrompt: vi.fn(() => ''),
}));

describe('IdeaGeneratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useChatStore).mockImplementation((selector: any) =>
      selector({ sendMessage: vi.fn() })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<IdeaGeneratorPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
