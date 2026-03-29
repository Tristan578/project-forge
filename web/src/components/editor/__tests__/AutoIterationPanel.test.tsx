/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/autoIteration', () => ({
  diagnoseIssues: vi.fn().mockResolvedValue([]),
  generateFixes: vi.fn().mockResolvedValue([]),
  applyFixes: vi.fn().mockResolvedValue(undefined),
  severityColor: vi.fn(() => ''),
  severityLabel: vi.fn(() => ''),
  categoryLabel: vi.fn(() => ''),
}));

describe('AutoIterationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', async () => {
    const { default: AutoIterationPanel } = await import('../AutoIterationPanel');
    const { container } = render(<AutoIterationPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
