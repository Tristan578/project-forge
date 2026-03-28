import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ExportDialog } from '../ExportDialog';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('@/lib/export/presets', () => ({
  EXPORT_PRESETS: {
    web: { name: 'Web Standard', description: 'Basic HTML export', format: 'single-html', resolution: 'responsive', loadingScreen: { backgroundColor: '#1a1a1a', progressBarColor: '#6366f1', progressStyle: 'bar' }, includeDebug: false },
  },
  getPreset: vi.fn(),
}));

vi.mock('@/lib/export/embedGenerator', () => ({
  generateResponsiveEmbedSnippet: vi.fn(),
  generateEmbedSnippet: vi.fn(),
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneName: 'Test Game',
    isExporting: false,
    setExporting: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('ExportDialog', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('returns null when not open', () => {
    mockEditorStore();
    const { container } = render(<ExportDialog isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog with title and export button when open', () => {
    mockEditorStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Export Game')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows preset buttons', () => {
    mockEditorStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Quick Presets')).toBeInTheDocument();
    expect(screen.getByText('Web Standard')).toBeInTheDocument();
  });
});
