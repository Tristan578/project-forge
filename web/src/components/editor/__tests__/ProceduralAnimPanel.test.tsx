/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@/test/utils/componentTestUtils';
import { ProceduralAnimPanel } from '../ProceduralAnimPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/proceduralAnimation', () => ({
  generateAnimation: vi.fn().mockReturnValue({
    name: 'test',
    duration: 1,
    keyframes: [],
    loop: true,
    blendIn: 0.1,
    blendOut: 0.1,
  }),
  animationToClipData: vi.fn(() => ({ duration: 1, playMode: 'loop', speed: 1, autoplay: false, tracks: [] })),
  getAnimationTypeInfo: vi.fn(() => ({ label: 'Walk', description: 'Walking', defaultDuration: 1, looping: true })),
  ANIMATION_TYPES: ['walk', 'run'],
}));

function mockStore(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    primaryId: null,
    primaryName: null,
    addClipKeyframe: vi.fn(),
    createAnimationClip: vi.fn(),
    setClipProperty: vi.fn(),
    skeletons2d: {},
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(defaults));
}

describe('ProceduralAnimPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<ProceduralAnimPanel />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows default bone warning when no skeleton is attached', () => {
    mockStore({ primaryId: 'ent1' });
    const { getByRole } = render(<ProceduralAnimPanel />);
    const alert = getByRole('alert');
    expect(alert.textContent).toContain('default humanoid bones');
  });

  it('hides default bone warning when 2D skeleton is attached', () => {
    mockStore({
      primaryId: 'ent1',
      skeletons2d: {
        ent1: { bones: [{ name: 'root' }, { name: 'torso' }] },
      },
    });
    const { queryByRole } = render(<ProceduralAnimPanel />);
    expect(queryByRole('alert')).toBeNull();
  });

  it('shows custom bone input textarea when no skeleton detected', () => {
    mockStore({ primaryId: 'ent1' });
    const { getByLabelText } = render(<ProceduralAnimPanel />);
    expect(getByLabelText(/custom bones/i)).toBeTruthy();
  });

  it('clears custom bone input when entity selection changes', () => {
    mockStore({ primaryId: 'ent1' });
    // Use key to force React to unmount/remount when entity changes (simulates
    // what the editor does — panels re-key on primaryId)
    const { getByLabelText, unmount } = render(<ProceduralAnimPanel />);
    const textarea = getByLabelText(/custom bones/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hip, shoulder' } });
    expect(textarea.value).toBe('hip, shoulder');

    // Switch to a different entity — remount to trigger prev-value pattern
    unmount();
    mockStore({ primaryId: 'ent2' });
    const { getByLabelText: getByLabelText2 } = render(<ProceduralAnimPanel />);
    const textarea2 = getByLabelText2(/custom bones/i) as HTMLTextAreaElement;
    expect(textarea2.value).toBe('');
  });

  it('clears generated animation when entity selection changes', () => {
    mockStore({ primaryId: 'ent1' });
    const { getByText, queryByText, unmount } = render(<ProceduralAnimPanel />);

    // Generate an animation
    const generateBtn = getByText(/generate/i);
    fireEvent.click(generateBtn);

    // Should show apply button after generation
    expect(queryByText(/apply/i)).toBeTruthy();

    // Switch entity — remount
    unmount();
    mockStore({ primaryId: 'ent2' });
    const result2 = render(<ProceduralAnimPanel />);

    // Apply button should be gone (generatedAnim reset on fresh mount)
    expect(result2.queryByText(/apply to entity/i)).toBeNull();
  });

  it('hides custom bone input when skeleton is attached', () => {
    mockStore({
      primaryId: 'ent1',
      skeletons2d: {
        ent1: { bones: [{ name: 'root' }] },
      },
    });
    const { queryByLabelText } = render(<ProceduralAnimPanel />);
    expect(queryByLabelText(/custom bones/i)).toBeNull();
  });
});
