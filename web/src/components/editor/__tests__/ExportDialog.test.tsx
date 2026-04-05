/**
 * Tests for ExportDialog — rendering, mode selection, presets, title input,
 * export button, close behavior, loading screen customization, error display.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@/test/utils/componentTestUtils';
import { ExportDialog } from '../ExportDialog';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/lib/export/exportEngine', () => ({
  exportGame: vi.fn(() => Promise.resolve(new Blob(['test']))),
  downloadBlob: vi.fn(),
}));

vi.mock('@/lib/export/presets', () => ({
  EXPORT_PRESETS: {
    web: { name: 'Web', description: 'For websites', format: 'single-html', resolution: 'responsive', includeDebug: false, loadingScreen: { backgroundColor: '#1a1a1a', progressBarColor: '#6366f1', progressStyle: 'bar' } },
    mobile: { name: 'Mobile', description: 'For mobile', format: 'pwa', resolution: '1280x720', includeDebug: false, loadingScreen: { backgroundColor: '#000', progressBarColor: '#fff', progressStyle: 'spinner' } },
  },
  getPreset: vi.fn((name: string) => {
    if (name === 'web') return { name: 'Web', format: 'single-html', resolution: 'responsive', includeDebug: false, loadingScreen: { backgroundColor: '#1a1a1a', progressBarColor: '#6366f1', progressStyle: 'bar' } };
    if (name === 'mobile') return { name: 'Mobile', format: 'pwa', resolution: '1280x720', includeDebug: false, loadingScreen: { backgroundColor: '#000', progressBarColor: '#fff', progressStyle: 'spinner' } };
    return null;
  }),
}));

vi.mock('@/lib/export/embedGenerator', () => ({
  generateResponsiveEmbedSnippet: vi.fn(() => '<iframe src="game.html"></iframe>'),
  generateEmbedSnippet: vi.fn(() => '<iframe src="game.html" width="1920" height="1080"></iframe>'),
}));

vi.mock('@/lib/analytics/events', () => ({
  trackGameExported: vi.fn(),
}));

const mockSetExporting = vi.fn();

function setupStore(overrides: {
  sceneName?: string;
  isExporting?: boolean;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      sceneName: overrides.sceneName ?? 'My Game',
      isExporting: overrides.isExporting ?? false,
      setExporting: mockSetExporting,
    };
    return selector(state);
  });
}

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Not open ──────────────────────────────────────────────────────────

  it('renders nothing when not open', () => {
    setupStore();
    const { container } = render(<ExportDialog isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders dialog with title when open', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Export Game').textContent).toBe('Export Game');
  });

  it('renders game title input pre-filled with scene name', () => {
    setupStore({ sceneName: 'Space Shooter' });
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText('Enter game title') as HTMLInputElement;
    expect(titleInput.value).toBe('Space Shooter');
  });

  it('renders export mode radio buttons', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Single HTML File').textContent).toBe('Single HTML File');
    expect(screen.getByText('ZIP Bundle').textContent).toBe('ZIP Bundle');
    expect(screen.getByText('PWA (Progressive Web App)').textContent).toBe('PWA (Progressive Web App)');
    expect(screen.getByText('Embed (iframe)').textContent).toBe('Embed (iframe)');
  });

  it('renders resolution selector', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Responsive (Fill Window)').textContent).toBe('Responsive (Fill Window)');
  });

  it('renders background color inputs', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Background Color').textContent).toBe('Background Color');
  });

  it('renders include debug checkbox', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Include Debug Info').textContent).toBe('Include Debug Info');
  });

  it('renders Export and Cancel buttons', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Export').textContent).toBe('Export');
    expect(screen.getByText('Cancel').textContent).toBe('Cancel');
  });

  // ── Quick presets ─────────────────────────────────────────────────────

  it('renders quick preset buttons', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Web').textContent).toBe('Web');
    expect(screen.getByText('Mobile').textContent).toBe('Mobile');
  });

  it('applies preset when clicked', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Web'));
    // Single HTML should be selected after applying Web preset
    const radios = document.querySelectorAll('input[type="radio"]');
    const singleHtml = radios[0] as HTMLInputElement;
    expect(singleHtml.checked).toBe(true);
  });

  // ── Export mode switching ─────────────────────────────────────────────

  it('switches to ZIP mode', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const zipRadio = screen.getByText('ZIP Bundle').closest('label')?.querySelector('input');
    fireEvent.click(zipRadio!);
    expect((zipRadio as HTMLInputElement).checked).toBe(true);
  });

  it('switches to PWA mode', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const pwaRadio = screen.getByText('PWA (Progressive Web App)').closest('label')?.querySelector('input');
    fireEvent.click(pwaRadio!);
    expect((pwaRadio as HTMLInputElement).checked).toBe(true);
  });

  it('switches to embed mode', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const embedRadio = screen.getByText('Embed (iframe)').closest('label')?.querySelector('input');
    fireEvent.click(embedRadio!);
    expect((embedRadio as HTMLInputElement).checked).toBe(true);
  });

  // ── Title input ───────────────────────────────────────────────────────

  it('updates title on change', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText('Enter game title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    expect(titleInput.value).toBe('New Title');
  });

  it('disables export when title is empty', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText('Enter game title');
    fireEvent.change(titleInput, { target: { value: '' } });
    const exportBtn = screen.getByText('Export').closest('button');
    expect(exportBtn?.hasAttribute('disabled')).toBe(true);
  });

  it('shows validation hint when title is empty', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const titleInput = screen.getByPlaceholderText('Enter game title');
    fireEvent.change(titleInput, { target: { value: '' } });
    expect(screen.getByText('A game title is required to export').textContent).toBe('A game title is required to export');
  });

  // ── Close behavior ────────────────────────────────────────────────────

  it('calls onClose when Cancel is clicked', () => {
    setupStore();
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when close X button is clicked', () => {
    setupStore();
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close export dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on backdrop click', () => {
    setupStore();
    const onClose = vi.fn();
    const { container } = render(<ExportDialog isOpen={true} onClose={onClose} />);
    const backdrop = container.querySelector('.fixed.inset-0');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose on Escape key', () => {
    setupStore();
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close on Escape while exporting', () => {
    setupStore({ isExporting: true });
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Loading screen customization ──────────────────────────────────────

  it('toggles loading screen customization section', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Customize Loading Screen'));
    expect(screen.getByText('Progress Style').textContent).toBe('Progress Style');
    expect(screen.getByText('Loading Title').textContent).toBe('Loading Title');
    expect(screen.getByText('Loading Subtitle').textContent).toBe('Loading Subtitle');
  });

  it('changes progress style', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Customize Loading Screen'));
    // The progress style select contains 'Progress Bar' option
    const selects = document.querySelectorAll('select');
    const progressSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => o.textContent === 'Spinner')
    ) as HTMLSelectElement;
    expect(progressSelect).not.toBeNull();
    fireEvent.change(progressSelect, { target: { value: 'spinner' } });
    expect(progressSelect.value).toBe('spinner');
  });

  // ── Include debug toggle ──────────────────────────────────────────────

  it('toggles debug info checkbox', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const debugCheckbox = screen.getByText('Include Debug Info').closest('label')?.querySelector('input');
    fireEvent.click(debugCheckbox!);
    expect((debugCheckbox as HTMLInputElement).checked).toBe(true);
  });

  // ── Exporting state ───────────────────────────────────────────────────

  it('shows Exporting... button text when isExporting', () => {
    setupStore({ isExporting: true });
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Exporting...').textContent).toBe('Exporting...');
  });

  it('shows Cancel Export button when exporting and calls onClose', () => {
    const onClose = vi.fn();
    setupStore({ isExporting: true });
    render(<ExportDialog isOpen={true} onClose={onClose} />);
    const cancelBtn = screen.getByText('Cancel Export');
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn.closest('button')?.hasAttribute('disabled')).toBe(false);
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables close X button when exporting', () => {
    setupStore({ isExporting: true });
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const closeBtn = screen.getByLabelText('Close export dialog');
    expect(closeBtn.hasAttribute('disabled')).toBe(true);
  });

  // ── Export action ─────────────────────────────────────────────────────

  it('calls exportGame and downloadBlob on export click', async () => {
    setupStore();
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);

    const { exportGame, downloadBlob } = await import('@/lib/export/exportEngine');

    await act(async () => {
      fireEvent.click(screen.getByText('Export'));
    });

    expect(mockSetExporting).toHaveBeenCalledWith(true);
    expect(exportGame).toHaveBeenCalled();
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringContaining('.html'),
    );
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── Resolution selector ───────────────────────────────────────────────

  it('changes resolution', () => {
    setupStore();
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const resSelect = screen.getByText('Responsive (Fill Window)').closest('select') as HTMLSelectElement;
    fireEvent.change(resSelect, { target: { value: '1920x1080' } });
    expect(resSelect.value).toBe('1920x1080');
  });
});
