/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { IdeaGeneratorPanel } from '../IdeaGeneratorPanel';
import { useChatStore } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { generateIdeas, type GameIdea } from '@/lib/ai/ideaGenerator';

// The hook is mocked for the selector, and `getState` is what `revealChat()`
// reads. The workspace store is real: `chatOverlayOpen` is the assertion.
const chat = vi.hoisted(() => ({ sendMessage: vi.fn(), setRightPanelTab: vi.fn() }));
vi.mock('@/stores/chatStore', () => ({
  useChatStore: Object.assign(vi.fn(), {
    getState: () => ({ setRightPanelTab: chat.setRightPanelTab }),
  }),
}));
vi.mock('@/lib/ai/ideaGenerator', () => ({
  GENRE_CATALOG: [],
  MECHANIC_CATALOG: [],
  generateIdeas: vi.fn(() => []),
  buildGddPrompt: vi.fn((idea: { title: string }) => `Design a GDD for ${idea.title}`),
}));

const IDEA: GameIdea = {
  id: 'idea-1',
  title: 'Gravity Garden',
  description: 'Grow a garden by flipping gravity.',
  genreMix: {
    primary: { id: 'puzzle', name: 'Puzzle', description: '', trending: false, tags: [] },
    secondary: { id: 'platformer', name: 'Platformer', description: '', trending: false, tags: [] },
  },
  mechanicCombo: {
    mechanics: [{ id: 'gravity-flip', name: 'Gravity flip', description: '', complexity: 'low', tags: [] }],
  },
  score: 80,
  hooks: ['Every level flips'],
  targetAudience: 'casual players',
};

describe('IdeaGeneratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useChatStore).mockImplementation((selector: any) =>
      selector({ sendMessage: chat.sendMessage, isStreaming: false })
    );
    vi.mocked(generateIdeas).mockReturnValue([IDEA]);
    useWorkspaceStore.setState({ chatOverlayOpen: false });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<IdeaGeneratorPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  it('reveals the chat when an idea is handed to the AI, so the reply is on screen on desktop too (#10166)', async () => {
    render(<IdeaGeneratorPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Generate Ideas/i }));
    // Ideas land on the next animation frame.
    fireEvent.click(await screen.findByRole('button', { name: /Use This Idea/i }));

    expect(chat.sendMessage).toHaveBeenCalledWith('Design a GDD for Gravity Garden');
    expect(chat.setRightPanelTab).toHaveBeenCalledWith('chat');
    expect(useWorkspaceStore.getState().chatOverlayOpen).toBe(true);
  });
});
