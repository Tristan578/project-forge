import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { IdeaGeneratorModal } from '../IdeaGeneratorModal';

vi.mock('@/hooks/useDialogA11y', () => ({
  useDialogA11y: vi.fn(() => ({ current: null })),
}));

vi.mock('@/lib/ai/ideaGenerator', () => ({
  generateIdeas: vi.fn(() => [
    {
      id: 'idea-1',
      title: 'Neon Dungeon Crawler',
      description: 'A fast-paced roguelike with neon visuals.',
      genreMix: {
        primary: { id: 'roguelike', name: 'Roguelike', trending: false },
        secondary: { id: 'action', name: 'Action', trending: true },
      },
      mechanicCombo: {
        mechanics: [
          { id: 'm1', name: 'Procedural Generation', complexity: 'high' },
        ],
      },
      score: 82,
      hooks: ['Endless replayability', 'Fast progression'],
      targetAudience: 'Casual and mid-core gamers',
      complexity: 'medium',
      estimatedScope: '3 months',
    },
    {
      id: 'idea-2',
      title: 'City Builder Puzzle',
      description: 'Build cities by solving puzzles.',
      genreMix: {
        primary: { id: 'puzzle', name: 'Puzzle', trending: false },
        secondary: { id: 'strategy', name: 'Strategy', trending: false },
      },
      mechanicCombo: {
        mechanics: [{ id: 'm2', name: 'Tile Placement', complexity: 'low' }],
      },
      score: 65,
      hooks: ['Relaxing gameplay'],
      targetAudience: 'Casual gamers',
      complexity: 'low',
      estimatedScope: '6 weeks',
    },
    {
      id: 'idea-3',
      title: 'Space Survival RPG',
      description: 'Survive in deep space with RPG mechanics.',
      genreMix: {
        primary: { id: 'rpg', name: 'RPG', trending: true },
        secondary: { id: 'survival', name: 'Survival', trending: false },
      },
      mechanicCombo: {
        mechanics: [{ id: 'm3', name: 'Crafting', complexity: 'medium' }],
      },
      score: 75,
      hooks: ['Deep story'],
      targetAudience: 'Hardcore gamers',
      complexity: 'high',
      estimatedScope: '6 months',
    },
  ]),
  GENRE_CATALOG: [
    { id: 'roguelike', name: 'Roguelike', trending: false },
    { id: 'action', name: 'Action', trending: true },
    { id: 'puzzle', name: 'Puzzle', trending: false },
  ],
  MECHANIC_CATALOG: [
    { id: 'm1', name: 'Procedural Generation', complexity: 'high' },
    { id: 'm2', name: 'Tile Placement', complexity: 'low' },
    { id: 'm3', name: 'Crafting', complexity: 'medium' },
  ],
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { generateIdeas } from '@/lib/ai/ideaGenerator';

describe('IdeaGeneratorModal', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onStart: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn();
    onStart = vi.fn();
  });

  afterEach(() => cleanup());

  it('renders nothing when isOpen is false', () => {
    render(<IdeaGeneratorModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByText('Game Idea Generator')).toBeNull();
  });

  it('renders the modal when isOpen is true', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Game Idea Generator')).toBeInTheDocument();
  });

  it('has role="dialog" and aria-modal="true" for accessibility', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-labelledby pointing to the title', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('idea-gen-title');
    expect(screen.getByText('Game Idea Generator')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close idea generator'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('generates ideas on open', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    expect(vi.mocked(generateIdeas)).toHaveBeenCalled();
  });

  it('renders idea cards for all generated ideas', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Neon Dungeon Crawler')).toBeInTheDocument();
    expect(screen.getByText('City Builder Puzzle')).toBeInTheDocument();
    expect(screen.getByText('Space Survival RPG')).toBeInTheDocument();
  });

  it('calls generateIdeas again when Generate button is clicked', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    vi.mocked(generateIdeas).mockClear();
    fireEvent.click(screen.getByText('Generate'));
    expect(vi.mocked(generateIdeas)).toHaveBeenCalledOnce();
  });

  it('shows idea description when a card is expanded', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    // Click on first idea card to expand it
    fireEvent.click(screen.getByText('Neon Dungeon Crawler'));
    expect(screen.getByText('A fast-paced roguelike with neon visuals.')).toBeInTheDocument();
  });

  it('shows Start button on expanded idea card', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Neon Dungeon Crawler'));
    expect(screen.getByText('Start this idea')).toBeInTheDocument();
  });

  it('calls onStart and onClose when Start button is clicked', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} onStart={onStart} />);
    fireEvent.click(screen.getByText('Neon Dungeon Crawler'));
    fireEvent.click(screen.getByText('Start this idea'));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the Filters toggle button', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('shows filter controls when Filters is toggled', () => {
    render(<IdeaGeneratorModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Filters'));
    expect(screen.getByLabelText('Genre')).toBeInTheDocument();
    expect(screen.getByLabelText('Max complexity')).toBeInTheDocument();
  });
});
