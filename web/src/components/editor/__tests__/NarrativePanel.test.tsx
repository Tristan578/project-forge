/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { NarrativePanel } from '../NarrativePanel';

const { mockArc } = vi.hoisted(() => {
  const mockArc = {
    title: 'The Last Guardian',
    genre: 'Fantasy',
    themes: ['sacrifice', 'courage'],
    characters: [
      {
        name: 'Aria',
        role: 'protagonist' as const,
        description: 'A young warrior',
        motivation: 'To protect her village',
      },
      {
        name: 'Lord Malak',
        role: 'antagonist' as const,
        description: 'A powerful sorcerer',
        motivation: 'To dominate the realm',
      },
    ],
    acts: [
      {
        number: 1,
        name: 'The Call',
        turningPoint: 'Village is attacked',
        scenes: [
          {
            id: 'scene-1',
            name: 'The Beginning',
            description: 'Aria discovers her destiny',
            dialogue: [
              { speaker: 'Aria', text: 'I must go.', emotion: 'determined' },
            ],
            choices: [
              {
                text: 'Accept the quest',
                consequence: 'Adventure begins',
                nextSceneId: 'scene-2',
              },
            ],
          },
        ],
      },
    ],
    endings: [
      {
        id: 'end-good',
        name: 'Victory',
        type: 'good' as const,
        description: 'The realm is saved',
        conditions: ['Malak defeated', 'Village safe'],
      },
      {
        id: 'end-bad',
        name: 'Defeat',
        type: 'bad' as const,
        description: 'The realm falls',
        conditions: [],
      },
    ],
  };
  return { mockArc };
});

vi.mock('@/lib/ai/narrativeGenerator', () => ({
  NARRATIVE_PRESETS: {
    hero_journey: {
      id: 'hero_journey',
      name: "Hero's Journey",
      description: 'Classic 3-act structure',
      actStructure: [],
      suggestedCharacterRoles: ['protagonist', 'antagonist'],
      endingTypes: ['good', 'bad'],
    },
    mystery: {
      id: 'mystery',
      name: 'Mystery',
      description: 'Discovery and investigation',
      actStructure: [],
      suggestedCharacterRoles: ['protagonist', 'neutral'],
      endingTypes: ['good', 'bad', 'secret'],
    },
  },
  generateNarrative: vi.fn(() => Promise.resolve(mockArc)),
  narrativeToDialogueTree: vi.fn(() => ({ id: 'tree-1', nodes: {} })),
  findDeadEnds: vi.fn(() => []),
  buildSceneGraph: vi.fn(() => new Map([['scene-1', { sceneName: 'The Beginning', targets: [] }]])),
}));

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: vi.fn((selector: (s: { importTree: () => string; selectTree: () => void }) => unknown) =>
    selector({ importTree: vi.fn(() => 'tree-1'), selectTree: vi.fn() })
  ),
}));

vi.mock('@/lib/ai/models', () => ({
  AI_MODEL_PRIMARY: 'claude-sonnet-4-5',
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

import { generateNarrative, findDeadEnds } from '@/lib/ai/narrativeGenerator';

describe('NarrativePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateNarrative).mockResolvedValue(mockArc);
    vi.mocked(findDeadEnds).mockReturnValue([]);
  });
  afterEach(() => cleanup());

  it('renders the Narrative Arc Generator heading', () => {
    render(<NarrativePanel />);
    expect(screen.getByText('Narrative Arc Generator')).toBeInTheDocument();
  });

  it('renders the Story Premise textarea', () => {
    render(<NarrativePanel />);
    expect(screen.getByLabelText('Story premise input')).toBeInTheDocument();
  });

  it('renders the narrative preset selector', () => {
    render(<NarrativePanel />);
    expect(screen.getByLabelText('Select narrative preset')).toBeInTheDocument();
  });

  it('shows preset options including hero_journey and mystery', () => {
    render(<NarrativePanel />);
    const select = screen.getByLabelText('Select narrative preset') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('hero_journey');
    expect(options).toContain('mystery');
  });

  it('Generate Narrative button is disabled when premise is empty', () => {
    render(<NarrativePanel />);
    const button = screen.getByLabelText('Generate narrative');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('Generate Narrative button is enabled when premise is entered', () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A hero saves the world' },
    });
    const button = screen.getByLabelText('Generate narrative');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('shows empty state message before generation', () => {
    render(<NarrativePanel />);
    expect(screen.getByText(/Enter a story premise and click Generate/)).toBeInTheDocument();
  });

  it('calls generateNarrative when Generate Narrative button is clicked', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A hero saves the world' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    expect(vi.mocked(generateNarrative)).toHaveBeenCalledOnce();
  });

  it('shows Generating... text while generation is pending', () => {
    vi.mocked(generateNarrative).mockReturnValue(new Promise(() => {}));
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A mystery unfolds' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    expect(screen.getByText('Generating...')).toBeInTheDocument();
  });

  it('shows arc title after successful generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('The Last Guardian'));
    expect(screen.getByText('The Last Guardian')).toBeInTheDocument();
  });

  it('shows genre and themes after generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText(/Fantasy/));
    expect(screen.getByText(/sacrifice/)).toBeInTheDocument();
  });

  it('shows character names after generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('Aria'));
    expect(screen.getByText('Lord Malak')).toBeInTheDocument();
  });

  it('shows character roles after generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('protagonist'));
    expect(screen.getByText('antagonist')).toBeInTheDocument();
  });

  it('shows ending names after generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('Victory'));
    expect(screen.getByText('Defeat')).toBeInTheDocument();
  });

  it('shows Export to Dialogue System button after generation', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByLabelText('Export narrative to dialogue system'));
    expect(screen.getByLabelText('Export narrative to dialogue system')).toBeInTheDocument();
  });

  it('shows error message when generateNarrative throws', async () => {
    vi.mocked(generateNarrative).mockRejectedValue(new Error('AI service error'));
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A hero saves the world' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('AI service error'));
    expect(screen.getByText('AI service error')).toBeInTheDocument();
  });

  it('calls findDeadEnds on the generated arc', async () => {
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByText('The Last Guardian'));
    expect(vi.mocked(findDeadEnds)).toHaveBeenCalledWith(mockArc);
  });

  it('premise textarea accepts text input', () => {
    render(<NarrativePanel />);
    const textarea = screen.getByLabelText('Story premise input');
    fireEvent.change(textarea, { target: { value: 'An epic space adventure' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('An epic space adventure');
  });
});
