import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { WorldBuilderPanel } from '../WorldBuilderPanel';

const { mockWorld } = vi.hoisted(() => {
  const mockWorld = {
    name: 'Aethoria',
    genre: 'Fantasy',
    era: 'Medieval',
    description: 'A land of ancient magic and warring kingdoms.',
    factions: [
      {
        name: 'Iron Order',
        alignment: 'hostile' as const,
        description: 'A militaristic faction',
        leader: 'Commander Varek',
        territory: 'Northern Citadel',
        traits: ['disciplined', 'ruthless'],
        relationships: { 'Silver Guild': 'enemy' },
      },
    ],
    regions: [
      {
        name: 'Verdant Vale',
        description: 'A lush valley',
        biome: 'temperate',
        dangerLevel: 2,
        resources: ['timber', 'grain'],
        landmarks: ['Old Mill', 'River Ford'],
        connectedTo: [],
      },
    ],
    timeline: [
      {
        year: 450,
        name: 'The Great Collapse',
        description: 'The old empire fell',
        impact: 'Fractured the realm into warring states',
        factionsInvolved: ['Iron Order'],
      },
    ],
    lore: [
      {
        title: 'The Lost Spells',
        category: 'magic',
        content: 'Ancient magic was sealed away after the collapse.',
      },
    ],
    rules: [
      {
        name: 'Faction Loyalty',
        description: 'Players must choose a faction',
        gameplayEffect: 'Affects NPC dialogue and quest availability',
      },
    ],
  };
  return { mockWorld };
});

vi.mock('@/lib/ai/worldBuilder', () => ({
  WORLD_PRESETS: {
    medieval_fantasy: {
      name: 'Aethoria',
      genre: 'Fantasy',
      era: 'Medieval',
      description: 'A land of ancient magic',
      factions: [],
      regions: [],
      timeline: [],
      lore: [],
      rules: [],
    },
  },
  generateWorld: vi.fn(() => Promise.resolve(mockWorld)),
  worldToMarkdown: vi.fn(() => '# Aethoria\n\nA land of ancient magic.'),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

import { generateWorld, worldToMarkdown } from '@/lib/ai/worldBuilder';

describe('WorldBuilderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateWorld).mockResolvedValue(mockWorld);
  });
  afterEach(() => cleanup());

  it('renders the World Builder heading', () => {
    render(<WorldBuilderPanel />);
    expect(screen.getByText('World Builder')).toBeDefined();
  });

  it('renders the world description textarea', () => {
    render(<WorldBuilderPanel />);
    expect(screen.getByLabelText('Describe your world concept')).toBeDefined();
  });

  it('renders the genre preset selector', () => {
    render(<WorldBuilderPanel />);
    expect(screen.getByLabelText('Genre preset (optional)')).toBeDefined();
  });

  it('shows preset options in the genre select', () => {
    render(<WorldBuilderPanel />);
    const select = screen.getByLabelText('Genre preset (optional)') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('medieval_fantasy');
    expect(options).toContain('sci_fi_space');
    expect(options).toContain('cyberpunk_city');
  });

  it('Generate button is disabled when description and preset are both empty', () => {
    render(<WorldBuilderPanel />);
    const button = screen.getByLabelText('Generate world with AI');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('Generate button is enabled when description is entered', () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A world of floating islands' },
    });
    expect(screen.getByLabelText('Generate world with AI').hasAttribute('disabled')).toBe(false);
  });

  it('Generate button is enabled when preset is selected', () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Genre preset (optional)'), {
      target: { value: 'medieval_fantasy' },
    });
    expect(screen.getByLabelText('Generate world with AI').hasAttribute('disabled')).toBe(false);
  });

  it('shows Load Preset button only when a preset is selected', () => {
    render(<WorldBuilderPanel />);
    expect(screen.queryByLabelText('Load preset world')).toBeNull();
    fireEvent.change(screen.getByLabelText('Genre preset (optional)'), {
      target: { value: 'medieval_fantasy' },
    });
    expect(screen.getByLabelText('Load preset world')).toBeDefined();
  });

  it('shows empty state message before generation', () => {
    render(<WorldBuilderPanel />);
    expect(screen.getByText(/Describe a world concept or select a genre preset/)).toBeDefined();
  });

  it('calls generateWorld when Generate button is clicked', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A cyberpunk megacity' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    expect(vi.mocked(generateWorld)).toHaveBeenCalledOnce();
  });

  it('shows world name after successful generation', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByText('Aethoria'));
    expect(screen.getByText('Aethoria')).toBeDefined();
  });

  it('shows world genre and era after generation', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByText('Aethoria'));
    expect(screen.getByText('Fantasy')).toBeDefined();
    expect(screen.getByText('Medieval')).toBeDefined();
  });

  it('shows faction section after generation', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByText('Factions'));
    expect(screen.getAllByText('Iron Order').length).toBeGreaterThanOrEqual(1);
  });

  it('shows region section after generation', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByText('Verdant Vale'));
    expect(screen.getByText('Regions')).toBeDefined();
  });

  it('shows Export button after generation', async () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByLabelText('Export world as markdown'));
    expect(screen.getByLabelText('Export world as markdown')).toBeDefined();
  });

  it('calls worldToMarkdown when Export is clicked', async () => {
    // Mock DOM methods needed for download
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A magical realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByLabelText('Export world as markdown'));
    fireEvent.click(screen.getByLabelText('Export world as markdown'));
    expect(vi.mocked(worldToMarkdown)).toHaveBeenCalledWith(mockWorld);
  });

  it('shows error message when generateWorld throws', async () => {
    vi.mocked(generateWorld).mockRejectedValue(new Error('World gen failed'));
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Describe your world concept'), {
      target: { value: 'A broken world' },
    });
    fireEvent.click(screen.getByLabelText('Generate world with AI'));
    await waitFor(() => screen.getByText('World gen failed'));
    expect(screen.getByText('World gen failed')).toBeDefined();
  });

  it('loads preset world when Load Preset is clicked', () => {
    render(<WorldBuilderPanel />);
    fireEvent.change(screen.getByLabelText('Genre preset (optional)'), {
      target: { value: 'medieval_fantasy' },
    });
    fireEvent.click(screen.getByLabelText('Load preset world'));
    // After loading the preset, world name should appear
    expect(screen.getByText('Aethoria')).toBeDefined();
  });

  it('description textarea accepts text input', () => {
    render(<WorldBuilderPanel />);
    const textarea = screen.getByLabelText('Describe your world concept');
    fireEvent.change(textarea, { target: { value: 'A steampunk dystopia' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('A steampunk dystopia');
  });
});
