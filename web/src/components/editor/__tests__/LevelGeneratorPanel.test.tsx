/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { LevelGeneratorPanel } from '../LevelGeneratorPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/levelGenerator', () => ({
  LEVEL_TEMPLATES: [],
  validateLayout: vi.fn(() => ({ valid: true, errors: [] })),
  generateLevel: vi.fn().mockResolvedValue({}),
  applyConstraints: vi.fn((l: unknown) => l),
  levelToCommands: vi.fn(() => []),
}));

describe('LevelGeneratorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<LevelGeneratorPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
