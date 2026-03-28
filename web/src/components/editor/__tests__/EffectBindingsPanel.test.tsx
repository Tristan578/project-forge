/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { EffectBindingsPanel } from '../EffectBindingsPanel';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));
vi.mock('@/lib/ai/effectBindings', () => ({
  EFFECT_PRESETS: {},
  PRESET_KEYS: [],
  applyBinding: vi.fn(),
  applyEffect: vi.fn(),
  createEffect: vi.fn(() => ({})),
  loadBindings: vi.fn(() => []),
  saveBindings: vi.fn(),
}));

describe('EffectBindingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without crashing', () => {
    const { container } = render(<EffectBindingsPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
