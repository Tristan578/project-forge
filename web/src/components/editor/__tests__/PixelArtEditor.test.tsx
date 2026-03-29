/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { PixelArtEditor } from '../PixelArtEditor';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));

describe('PixelArtEditor', () => {
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

  it('renders nothing when closed', () => {
    render(
      <PixelArtEditor open={false} onClose={vi.fn()} entityId={null} />
    );
    // When not open, no dialog or modal content should be rendered
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the editor when open', () => {
    const { container } = render(
      <PixelArtEditor open={true} onClose={vi.fn()} entityId="ent-1" />
    );
    expect(container.firstChild).not.toBeNull();
  });
});
