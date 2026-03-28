/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { ReviewPanel } from '../ReviewPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));
vi.mock('@/lib/ai/gameReviewer', () => ({
  buildReviewContext: vi.fn(() => ({})),
  generateReview: vi.fn().mockResolvedValue({}),
  getRatingDescriptor: vi.fn(() => ''),
}));

describe('ReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) =>
      selector({ sceneGraph: { nodes: {}, rootIds: [] } })
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<ReviewPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
