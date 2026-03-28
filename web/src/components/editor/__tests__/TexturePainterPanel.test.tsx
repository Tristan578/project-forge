/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { TexturePainterPanel } from '../TexturePainterPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/texturePainter', () => ({
  TEXTURE_STYLES: [],
  VALID_TEXTURE_SLOTS: [],
  VALID_BLEND_MODES: [],
  generateTexturePrompt: vi.fn(() => ''),
  applyMaterialChanges: vi.fn(),
  clampIntensity: vi.fn((v: number) => v),
}));

describe('TexturePainterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ primaryId: null })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<TexturePainterPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
