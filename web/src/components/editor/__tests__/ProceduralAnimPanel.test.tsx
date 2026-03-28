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
  generateAnimation: vi.fn().mockResolvedValue({}),
  animationToClipData: vi.fn(() => ({})),
  getAnimationTypeInfo: vi.fn(() => ({})),
  ANIMATION_TYPES: [],
}));

describe('ProceduralAnimPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ primaryId: null, primaryName: null })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<ProceduralAnimPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
