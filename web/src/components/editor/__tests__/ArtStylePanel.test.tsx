/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { ArtStylePanel } from '../ArtStylePanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('lucide-react', () => ({
  Palette: () => null,
  Lock: () => null,
  Unlock: () => null,
  BarChart3: () => null,
  Paintbrush: () => null,
  ChevronDown: () => null,
  Check: () => null,
}));

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    selector({
      primaryId: null,
      primaryName: null,
      artStyle: null,
      setArtStyle: vi.fn(),
    })
  );
}

describe('ArtStylePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<ArtStylePanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
