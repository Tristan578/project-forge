/**
 * Tests for the PixelArtEditor Layers panel — manual controls for
 * operation family `pixel.FR-1.OP-01` (Layers, selections and palette editing),
 * layer-model portion. Parent #9817, delivered under #10094.
 *
 * Covers add / delete / reorder / visibility-toggle / rename / select-active /
 * opacity, and that drawing records an undoable change on the active layer.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PixelArtEditor } from '../PixelArtEditor';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

const mockLoadTexture = vi.fn();

const mockCtx = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
  putImageData: vi.fn(),
  getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
};

function setupStoreMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = { loadTexture: mockLoadTexture };
    return selector(state);
  });
}

const origCreateElement = document.createElement.bind(document);

describe('PixelArtEditor layers panel (pixel.FR-1.OP-01)', () => {
  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() => mockCtx) as unknown as HTMLCanvasElement['getContext'];
        (el as HTMLCanvasElement).toDataURL = () => 'data:image/png;base64,mockbase64';
      }
      return el;
    });
    setupStoreMock();
  });

  afterEach(() => {
    cleanup();
  });

  function open() {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
  }

  // ── Default state ──────────────────────────────────────────────────────────

  it('starts with a single "Layer 1"', () => {
    open();
    expect(screen.getByTitle('Select Layer 1')).toBeInTheDocument();
    // The active-layer name input reflects the active layer.
    const nameInput = screen.getByLabelText('Layer name') as HTMLInputElement;
    expect(nameInput.value).toBe('Layer 1');
  });

  it('disables delete, move up and move down with a single layer', () => {
    open();
    expect(screen.getByTitle('Delete layer').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Move layer up').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Move layer down').hasAttribute('disabled')).toBe(true);
  });

  // ── Add ────────────────────────────────────────────────────────────────────

  it('adds a new layer and makes it active', () => {
    open();
    fireEvent.click(screen.getByTitle('Add layer'));
    expect(screen.getByTitle('Select Layer 1')).toBeInTheDocument();
    expect(screen.getByTitle('Select Layer 2')).toBeInTheDocument();
    // Newly added layer is active.
    const nameInput = screen.getByLabelText('Layer name') as HTMLInputElement;
    expect(nameInput.value).toBe('Layer 2');
    // Delete is now enabled (>1 layer).
    expect(screen.getByTitle('Delete layer').hasAttribute('disabled')).toBe(false);
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  it('deletes the active layer', () => {
    open();
    fireEvent.click(screen.getByTitle('Add layer'));
    expect(screen.getByTitle('Select Layer 2')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Delete layer'));
    expect(screen.queryByTitle('Select Layer 2')).toBeNull();
    expect(screen.getByTitle('Select Layer 1')).toBeInTheDocument();
  });

  // ── Select active ──────────────────────────────────────────────────────────

  it('selects a layer as active when its row is clicked', () => {
    open();
    fireEvent.click(screen.getByTitle('Add layer')); // active = Layer 2
    fireEvent.click(screen.getByTitle('Select Layer 1'));
    const nameInput = screen.getByLabelText('Layer name') as HTMLInputElement;
    expect(nameInput.value).toBe('Layer 1');
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('toggles layer visibility (styling the row) and records undo', () => {
    open();
    const selectBtn = screen.getByTitle('Select Layer 1');
    expect(selectBtn.className).not.toContain('italic');
    fireEvent.click(screen.getByTitle('Toggle visibility of Layer 1'));
    expect(screen.getByTitle('Select Layer 1').className).toContain('italic');
    // Toggling is undoable.
    expect(screen.getByTitle('Undo (Ctrl+Z)').hasAttribute('disabled')).toBe(false);
  });

  // ── Rename ─────────────────────────────────────────────────────────────────

  it('renames the active layer through the name input', () => {
    open();
    const nameInput = screen.getByLabelText('Layer name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Outline' } });
    expect(screen.getByTitle('Select Outline')).toBeInTheDocument();
  });

  // ── Reorder ────────────────────────────────────────────────────────────────

  it('moves the active layer up and down, updating disabled bounds', () => {
    open();
    fireEvent.click(screen.getByTitle('Add layer')); // Layer 2 active, at top
    // At top: move up disabled, move down enabled.
    expect(screen.getByTitle('Move layer up').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Move layer down').hasAttribute('disabled')).toBe(false);
    // Move Layer 2 down to the bottom.
    fireEvent.click(screen.getByTitle('Move layer down'));
    // Now active (Layer 2) is at the bottom: move down disabled, move up enabled.
    expect(screen.getByTitle('Move layer down').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTitle('Move layer up').hasAttribute('disabled')).toBe(false);
  });

  // ── Opacity ────────────────────────────────────────────────────────────────

  it('sets the active layer opacity via the slider', () => {
    open();
    const slider = screen.getByLabelText('Layer opacity') as HTMLInputElement;
    expect(slider.value).toBe('1');
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(slider.value).toBe('0.5');
  });

  // ── Draw on active layer ───────────────────────────────────────────────────

  it('records an undoable change when drawing on the active layer', () => {
    const { container } = render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const canvas = container.querySelector('canvas.cursor-crosshair') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    expect(screen.getByTitle('Undo (Ctrl+Z)').hasAttribute('disabled')).toBe(true);
    fireEvent.mouseDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.mouseUp(canvas);
    expect(screen.getByTitle('Undo (Ctrl+Z)').hasAttribute('disabled')).toBe(false);
  });

  // ── Keyboard shortcuts guarded while renaming ──────────────────────────────

  it('does not switch tools when typing shortcut letters into the name input', () => {
    open();
    const nameInput = screen.getByLabelText('Layer name');
    // 'e' would normally switch to the eraser; focused in the input it must not.
    fireEvent.keyDown(nameInput, { key: 'e' });
    expect(screen.getByTitle('Pencil (B)').className).toContain('bg-blue-600');
    expect(screen.getByTitle('Eraser (E)').className).not.toContain('bg-blue-600');
  });
});
