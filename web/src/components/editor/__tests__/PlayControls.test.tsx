import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PlayControls } from '../PlayControls';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    engineMode: 'edit',
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('PlayControls', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders play, pause, and stop buttons in edit mode', () => {
    mockEditorStore();
    render(<PlayControls />);
    expect(screen.getByRole('button', { name: /play/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /pause/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /stop/i })).toBeDefined();
  });

  it('shows Playing status indicator when in play mode', () => {
    mockEditorStore({ engineMode: 'play' });
    render(<PlayControls />);
    expect(screen.getByText('Playing')).toBeDefined();
  });

  it('shows Paused status and resume button when paused', () => {
    mockEditorStore({ engineMode: 'paused' });
    render(<PlayControls />);
    expect(screen.getByText('Paused')).toBeDefined();
    expect(screen.getByRole('button', { name: /resume/i })).toBeDefined();
  });

  it('calls play when play button is clicked in edit mode', () => {
    const mockPlay = vi.fn();
    mockEditorStore({ play: mockPlay });
    render(<PlayControls />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(mockPlay).toHaveBeenCalled();
  });
});
