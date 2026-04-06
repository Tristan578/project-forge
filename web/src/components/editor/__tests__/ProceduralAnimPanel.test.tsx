/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
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
