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

// Hoisted rather than inline `vi.fn()`s: the inline form built a fresh pair on
// every selector call, so nothing could assert on them and nothing could make
// `importTree` refuse.
const { mockImportTree, mockSelectTree } = vi.hoisted(() => ({
  mockImportTree: vi.fn((): string | null => 'tree-1'),
  mockSelectTree: vi.fn(),
}));

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: vi.fn((selector: (s: { importTree: () => string | null; selectTree: () => void }) => unknown) =>
    selector({ importTree: mockImportTree, selectTree: mockSelectTree })
  ),
}));

// `@/lib/ai/models` is not mocked: it is a side-effect-free constants module,
// and a fixture copy of it silently drifts from what the product ships.

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
    mockImportTree.mockReturnValue('tree-1');
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

  it('says so when the export is refused, instead of doing nothing', async () => {
    // `importTree` returns null for a tree the runtime would refuse to walk.
    // The button otherwise did nothing at all — no tree in the editor, no
    // reason given — so the author's only remaining move was to press it again.
    mockImportTree.mockReturnValue(null);
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByLabelText('Export narrative to dialogue system'));

    fireEvent.click(screen.getByLabelText('Export narrative to dialogue system'));

    await waitFor(() => screen.getByText(/generated tree was rejected/));
    // And it must not send the author to a tree that was never imported.
    expect(mockSelectTree).not.toHaveBeenCalled();
  });

  it('opens the imported tree and reports nothing when the export succeeds', async () => {
    // Without this, an unconditional error message passes the test above.
    render(<NarrativePanel />);
    fireEvent.change(screen.getByLabelText('Story premise input'), {
      target: { value: 'A guardian protects the realm' },
    });
    fireEvent.click(screen.getByLabelText('Generate narrative'));
    await waitFor(() => screen.getByLabelText('Export narrative to dialogue system'));

    fireEvent.click(screen.getByLabelText('Export narrative to dialogue system'));

    expect(mockSelectTree).toHaveBeenCalledWith('tree-1');
    expect(screen.queryByText(/generated tree was rejected/)).toBeNull();
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
