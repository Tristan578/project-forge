import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { AudioInspector } from '../AudioInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    navigateDocs: vi.fn(),
  })),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('../GenerateSoundDialog', () => ({ GenerateSoundDialog: () => null }));
vi.mock('../GenerateMusicDialog', () => ({ GenerateMusicDialog: () => null }));
vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'ent-1',
    primaryAudio: null,
    assetRegistry: {},
    audioBuses: [{ name: 'master', volume: 1 }, { name: 'sfx', volume: 1 }],
    setAudio: vi.fn(),
    removeAudio: vi.fn(),
    playAudio: vi.fn(),
    stopAudio: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('AudioInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows Add Audio button when no audio is attached', () => {
    mockEditorStore();
    render(<AudioInspector />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Add Audio')).toBeInTheDocument();
  });

  it('shows audio controls when audio data exists', () => {
    mockEditorStore({
      primaryAudio: {
        assetId: null,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: false,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
      },
    });
    render(<AudioInspector />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Pitch')).toBeInTheDocument();
    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Remove Audio')).toBeInTheDocument();
  });

  it('shows spatial audio settings when spatial is enabled', () => {
    mockEditorStore({
      primaryAudio: {
        assetId: null,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 50,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
      },
    });
    render(<AudioInspector />);
    expect(screen.getByText('Max Distance')).toBeInTheDocument();
    expect(screen.getByText('Ref Distance')).toBeInTheDocument();
    expect(screen.getByText('Rolloff')).toBeInTheDocument();
  });
});
