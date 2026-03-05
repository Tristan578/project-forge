/**
 * Tests for SpriteSheetImportDialog — rendering, file upload, grid controls,
 * import action, drag-and-drop, error state, close behavior.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SpriteSheetImportDialog } from '../SpriteSheetImportDialog';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/lib/sprites/sheetImporter', () => ({
  loadImageFile: vi.fn(() => {
    const img = { naturalWidth: 128, naturalHeight: 64 } as HTMLImageElement;
    return Promise.resolve(img);
  }),
  detectGridDimensions: vi.fn(() => ({ rows: 2, columns: 4 })),
  sliceSheet: vi.fn((w: number, h: number, r: number, c: number) => {
    const frames = [];
    const fw = Math.floor(w / c);
    const fh = Math.floor(h / r);
    let idx = 0;
    for (let row = 0; row < r; row++) {
      for (let col = 0; col < c; col++) {
        frames.push({ index: idx++, x: col * fw, y: row * fh, width: fw, height: fh });
      }
    }
    return frames;
  }),
  generateDefaultClips: vi.fn(() => ({ idle: { frames: [0, 1], looping: true }, run: { frames: [2, 3], looping: true } })),
  buildSpriteSheetData: vi.fn(() => ({ assetId: 'spritesheet_123', frames: [] })),
  drawGridOverlay: vi.fn(),
  renderFrame: vi.fn(() => ({
    toDataURL: () => 'data:image/png;base64,mock',
  })),
}));

const mockSetSpriteSheet = vi.fn();

function setupStore(overrides: { primaryId?: string | null } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: overrides.primaryId ?? 'ent-1',
      setSpriteSheet: mockSetSpriteSheet,
    };
    return selector(state);
  });
}

describe('SpriteSheetImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Not open ──────────────────────────────────────────────────────────

  it('renders nothing when not open', () => {
    setupStore();
    const { container } = render(
      <SpriteSheetImportDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders dialog title when open', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Import Sprite Sheet')).toBeDefined();
  });

  it('renders drop zone before file is loaded', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Drop a sprite sheet image here')).toBeDefined();
  });

  it('renders Browse Files button', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Browse Files')).toBeDefined();
  });

  it('renders Cancel and Import buttons', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Cancel')).toBeDefined();
    expect(screen.getByText('Import (1 frames)')).toBeDefined();
  });

  it('import button is disabled before image is loaded', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    const importBtn = screen.getByText('Import (1 frames)').closest('button');
    expect(importBtn?.hasAttribute('disabled')).toBe(true);
  });

  // ── Close behavior ────────────────────────────────────────────────────

  it('calls onClose when Cancel clicked', () => {
    setupStore();
    const onClose = vi.fn();
    render(<SpriteSheetImportDialog isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when X button clicked', () => {
    setupStore();
    const onClose = vi.fn();
    render(<SpriteSheetImportDialog isOpen={true} onClose={onClose} />);
    // X button is the first button after the title
    const headerButtons = document.querySelectorAll('.flex.items-center.justify-between button');
    fireEvent.click(headerButtons[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── No entity selected ────────────────────────────────────────────────

  it('disables import when no entity selected', () => {
    setupStore({ primaryId: null });
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    const importBtn = screen.getByText('Import (1 frames)').closest('button');
    expect(importBtn?.hasAttribute('disabled')).toBe(true);
  });

  // ── Drag and drop ─────────────────────────────────────────────────────

  it('highlights drop zone on drag over', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    const dropZone = screen.getByText('Drop a sprite sheet image here').closest('div[class*="border-dashed"]')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    expect(dropZone.className).toContain('border-blue-500');
  });

  it('removes highlight on drag leave', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    const dropZone = screen.getByText('Drop a sprite sheet image here').closest('div[class*="border-dashed"]')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.dragLeave(dropZone, { preventDefault: vi.fn() });
    expect(dropZone.className).not.toContain('border-blue-500');
  });

  // ── File select triggers processing ───────────────────────────────────

  it('processes file on input change', async () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['png data'], 'spritesheet.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    const { loadImageFile } = await import('@/lib/sprites/sheetImporter');
    expect(loadImageFile).toHaveBeenCalledWith(file);
  });

  // ── Accepted file types ───────────────────────────────────────────────

  it('accepts PNG, JPEG, and WebP files', () => {
    setupStore();
    render(<SpriteSheetImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('PNG, JPG, or WebP')).toBeDefined();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput.accept).toContain('image/png');
    expect(fileInput.accept).toContain('image/jpeg');
    expect(fileInput.accept).toContain('image/webp');
  });
});
