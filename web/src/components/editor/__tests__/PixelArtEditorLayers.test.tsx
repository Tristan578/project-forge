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
import { useEditorStore, type EditorState } from '@/stores/editorStore';
const { useEditorStore: actualEditorStore } = await vi.importActual<typeof import('@/stores/editorStore')>('@/stores/editorStore');

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
  putImageData: vi.fn((_image: { data: Uint8ClampedArray; width: number; height: number }, _x: number, _y: number) => {}),
  getImageData: vi.fn((x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
};

function setupStoreMock() {
  const state: EditorState = { ...actualEditorStore.getInitialState(), loadTexture: mockLoadTexture };
  vi.mocked(useEditorStore).mockImplementation(<T,>(selector: (state: EditorState) => T): T => selector(state));
}

const origCreateElement = document.createElement.bind(document);

describe('PixelArtEditor layers panel (pixel.FR-1.OP-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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


  function draw(canvas: HTMLCanvasElement, x = 5, y = 5) {
    fireEvent.mouseDown(canvas, { clientX: x, clientY: y });
    fireEvent.mouseUp(canvas);
  }

  function lastImage() {
    const image = mockCtx.putImageData.mock.lastCall?.[0];
    if (!image) throw new Error('Expected real editor pixel output');
    return image;
  }

  function firstPixel() { return [...lastImage().data.slice(0, 4)]; }

  it('restores dimensions, layers and edge pixels through resize undo and redo', () => {
    const { container } = render(<PixelArtEditor open onClose={vi.fn()} entityId="sprite-1" />);
    const canvas = container.querySelector('canvas.cursor-crosshair') as HTMLCanvasElement;
    fireEvent.click(screen.getByTitle('#ff004d'));
    draw(canvas, 245, 245);
    fireEvent.click(screen.getByTitle('Add layer'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '64' } });
    expect(screen.getByRole('combobox')).toHaveValue('64');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(screen.getByRole('combobox')).toHaveValue('16');
    expect(screen.getByTitle('Select Layer 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Sprite' }));
    expect(lastImage().width).toBe(16);
    expect([...lastImage().data.slice((15 * 16 + 15) * 4, (15 * 16 + 15) * 4 + 4)]).toEqual([255, 0, 77, 255]);
    expect(mockLoadTexture).toHaveBeenLastCalledWith('mockbase64', 'pixel-art-16x16.png', 'sprite-1', 'base_color');
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(screen.getByRole('combobox')).toHaveValue('64');
    expect(screen.queryByTitle('Select Layer 2')).not.toBeInTheDocument();
    draw(canvas, 245, 245);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Sprite' }));
    expect(lastImage().width).toBe(64);
    expect([...lastImage().data.slice((61 * 64 + 61) * 4, (61 * 64 + 61) * 4 + 4)]).toEqual([255, 0, 77, 255]);
  });

  it.each(['name', 'opacity'] as const)('makes %s changes undoable and invalidates stale redo', field => {
    open();
    fireEvent.click(screen.getByTitle('Add layer'));
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(screen.getByTitle('Redo (Ctrl+Y)')).not.toBeDisabled();
    const control = screen.getByLabelText(field === 'name' ? 'Layer name' : 'Layer opacity');
    const changed = field === 'name' ? 'Outline' : '0.5';
    fireEvent.change(control, { target: { value: changed } });
    expect(screen.getByTitle('Redo (Ctrl+Y)')).toBeDisabled();
    expect(control).toHaveValue(field === 'name' ? changed : '0.5');
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(control).toHaveValue(field === 'name' ? 'Layer 1' : '1');
    fireEvent.click(screen.getByTitle('Redo (Ctrl+Y)'));
    expect(control).toHaveValue(changed);
    expect(screen.queryByTitle('Select Layer 2')).not.toBeInTheDocument();
  });

  it('isolates active painting and composites preview, reorder, opacity, export and apply exactly', () => {
    const { container } = render(<PixelArtEditor open onClose={vi.fn()} entityId="sprite-1" />);
    const canvas = container.querySelector('canvas.cursor-crosshair') as HTMLCanvasElement;
    fireEvent.click(screen.getByTitle('#ff004d')); draw(canvas);
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    fireEvent.click(screen.getByTitle('Add layer'));
    fireEvent.click(screen.getByTitle('#29adff')); draw(canvas);
    expect(firstPixel()).toEqual([41, 173, 255, 255]);
    fireEvent.change(screen.getByLabelText('Layer opacity'), { target: { value: '0.5' } });
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Sprite' }));
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
    expect(mockLoadTexture).toHaveBeenLastCalledWith('mockbase64', 'pixel-art-16x16.png', 'sprite-1', 'base_color');
    fireEvent.click(screen.getByTitle('Toggle visibility of Layer 2'));
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
    fireEvent.click(screen.getByTitle('Move layer down'));
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    fireEvent.click(screen.getByTitle('Move layer up'));
    fireEvent.click(screen.getByTitle('Clear layer'));
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
    fireEvent.click(screen.getByTitle('Delete layer'));
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    fireEvent.click(screen.getByTitle('Undo (Ctrl+Z)'));
    expect(firstPixel()).toEqual([148, 87, 166, 255]);
  });


  it.each([
    { title: 'Eraser (E)', erase: true }, { title: 'Fill (G)', erase: false },
    { title: 'Line (L)', erase: false }, { title: 'Rectangle (R)', erase: false },
  ])('keeps inactive layer pixels intact while using $title', ({ title, erase }) => {
    const { container } = render(<PixelArtEditor open onClose={vi.fn()} />);
    const canvas = container.querySelector('canvas.cursor-crosshair') as HTMLCanvasElement;
    fireEvent.click(screen.getByTitle('#ff004d')); draw(canvas);
    fireEvent.click(screen.getByTitle('Add layer'));
    fireEvent.click(screen.getByTitle('#29adff'));
    if (erase) draw(canvas);
    fireEvent.click(screen.getByTitle(title));
    fireEvent.mouseDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(canvas, { clientX: 21, clientY: 21 });
    fireEvent.mouseUp(canvas);
    expect(firstPixel()).toEqual(erase ? [255, 0, 77, 255] : [41, 173, 255, 255]);
    fireEvent.click(screen.getByTitle('Toggle visibility of Layer 2'));
    expect(firstPixel()).toEqual([255, 0, 77, 255]);
    expect([...lastImage().data.slice(4, 8)]).toEqual([0, 0, 0, 0]);
  });

  it('renders the drawing canvas when a retained closed editor opens', () => {
    const { container, rerender } = render(<PixelArtEditor open={false} onClose={vi.fn()} />);
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(mockCtx.fillRect).not.toHaveBeenCalled();
    rerender(<PixelArtEditor open onClose={vi.fn()} />);
    expect(container.querySelector('canvas.cursor-crosshair')).toBeInTheDocument();
    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 256, 256);
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
