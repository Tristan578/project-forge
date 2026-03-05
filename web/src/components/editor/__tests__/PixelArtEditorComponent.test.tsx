/**
 * Tests for PixelArtEditor component — rendering, tool selection, keyboard
 * shortcuts, undo/redo, color picking, canvas size, export, and apply.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { PixelArtEditor } from '../PixelArtEditor';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

const mockLoadTexture = vi.fn();

// jsdom doesn't support canvas 2d context fully — mock createImageData/putImageData/toDataURL
const mockCtx = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  closePath: vi.fn(),
  fillText: vi.fn(),
  scale: vi.fn(),
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

describe('PixelArtEditor', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    const origCreateElement = document.createElement.bind(document);
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreateElement(tag, options);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() => mockCtx) as unknown as HTMLCanvasElement['getContext'];
        (el as HTMLCanvasElement).toDataURL = () => 'data:image/png;base64,mockbase64';
      }
      return el;
    });
  });

  afterAll(() => {
    createElementSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupStoreMock();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Visibility ───────────────────────────────────────────────────────────

  it('renders nothing when open is false', () => {
    const { container } = render(
      <PixelArtEditor open={false} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the editor when open is true', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Pixel Art Editor')).toBeDefined();
  });

  // ── Tool buttons ─────────────────────────────────────────────────────────

  it('renders all 6 tool buttons', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const toolButtons = ['Pencil (B)', 'Eraser (E)', 'Fill (G)', 'Line (L)', 'Rectangle (R)', 'Eyedropper (I)'];
    for (const title of toolButtons) {
      expect(screen.getByTitle(title)).toBeDefined();
    }
  });

  it('highlights pencil tool by default', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const pencilBtn = screen.getByTitle('Pencil (B)');
    expect(pencilBtn.className).toContain('bg-blue-600');
  });

  it('switches to eraser tool when clicked', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const eraserBtn = screen.getByTitle('Eraser (E)');
    fireEvent.click(eraserBtn);
    expect(eraserBtn.className).toContain('bg-blue-600');
  });

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  it('switches tool on keyboard shortcut press', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'e' });
    expect(screen.getByTitle('Eraser (E)').className).toContain('bg-blue-600');

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByTitle('Fill (G)').className).toContain('bg-blue-600');

    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByTitle('Line (L)').className).toContain('bg-blue-600');

    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByTitle('Rectangle (R)').className).toContain('bg-blue-600');

    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.getByTitle('Eyedropper (I)').className).toContain('bg-blue-600');

    fireEvent.keyDown(window, { key: 'b' });
    expect(screen.getByTitle('Pencil (B)').className).toContain('bg-blue-600');
  });

  // ── Canvas size ──────────────────────────────────────────────────────────

  it('renders canvas size selector with default 16x16', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    // Info text at bottom shows size
    expect(screen.getByText('16x16px')).toBeDefined();
  });

  it('changes canvas size via select dropdown', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const select = screen.getByDisplayValue('16x16') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '32' } });
    expect(screen.getByText('32x32px')).toBeDefined();
  });

  // ── Zoom ─────────────────────────────────────────────────────────────────

  it('shows default zoom level', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Zoom: 16x')).toBeDefined();
  });

  it('zoom in doubles zoom up to 64', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const zoomInBtn = screen.getByTitle('Zoom in');
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('Zoom: 32x')).toBeDefined();
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('Zoom: 64x')).toBeDefined();
    // At max — still 64
    fireEvent.click(zoomInBtn);
    expect(screen.getByText('Zoom: 64x')).toBeDefined();
  });

  it('zoom out halves zoom down to 2', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const zoomOutBtn = screen.getByTitle('Zoom out');
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText('Zoom: 8x')).toBeDefined();
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText('Zoom: 4x')).toBeDefined();
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText('Zoom: 2x')).toBeDefined();
    // At min — still 2
    fireEvent.click(zoomOutBtn);
    expect(screen.getByText('Zoom: 2x')).toBeDefined();
  });

  // ── Grid toggle ──────────────────────────────────────────────────────────

  it('toggles grid visibility', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const gridBtn = screen.getByTitle('Toggle grid');
    expect(gridBtn.className).toContain('text-blue-400'); // On by default
    fireEvent.click(gridBtn);
    expect(gridBtn.className).toContain('text-zinc-500'); // Off
    fireEvent.click(gridBtn);
    expect(gridBtn.className).toContain('text-blue-400'); // On again
  });

  // ── Undo/Redo buttons ────────────────────────────────────────────────────

  it('undo and redo buttons are disabled initially', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
    const redoBtn = screen.getByTitle('Redo (Ctrl+Y)');
    expect(undoBtn.hasAttribute('disabled')).toBe(true);
    expect(redoBtn.hasAttribute('disabled')).toBe(true);
  });

  // ── Close ────────────────────────────────────────────────────────────────

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<PixelArtEditor open={true} onClose={onClose} />);
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<PixelArtEditor open={true} onClose={onClose} />);
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Export ───────────────────────────────────────────────────────────────

  it('renders export PNG button', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Export PNG')).toBeDefined();
  });

  // ── Apply to Sprite ──────────────────────────────────────────────────────

  it('does not show apply button when entityId is not provided', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Apply to Sprite')).toBeNull();
  });

  it('shows apply button when entityId is provided', () => {
    render(
      <PixelArtEditor open={true} onClose={vi.fn()} entityId="ent-1" />
    );
    expect(screen.getByText('Apply to Sprite')).toBeDefined();
  });

  it('calls loadTexture and onClose when apply is clicked', () => {
    const onClose = vi.fn();
    render(
      <PixelArtEditor open={true} onClose={onClose} entityId="ent-1" />
    );
    fireEvent.click(screen.getByText('Apply to Sprite'));
    expect(mockLoadTexture).toHaveBeenCalledWith(
      'mockbase64', // base64 extracted from data URL
      expect.stringContaining('pixel-art-'),
      'ent-1',
      'base_color',
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ── Palette ──────────────────────────────────────────────────────────────

  it('renders default palette colors', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Palette')).toBeDefined();
    // Default palette has 16 colors
    const paletteButtons = screen.getAllByTitle(/#[0-9a-f]{6}/i);
    expect(paletteButtons.length).toBe(16);
  });

  it('adds current color to palette when + Add to palette is clicked', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    // Change color via the color picker (type="color")
    const colorPicker = document.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(colorPicker, { target: { value: '#123456' } });

    // Click add to palette
    fireEvent.click(screen.getByText('+ Add to palette'));

    // Should now have 17 palette buttons
    const paletteButtons = screen.getAllByTitle(/#[0-9a-f]{6}/i);
    expect(paletteButtons.length).toBe(17);
  });

  it('does not add duplicate color to palette', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    // #000000 is already in the default palette
    fireEvent.click(screen.getByText('+ Add to palette'));

    const paletteButtons = screen.getAllByTitle(/#[0-9a-f]{6}/i);
    expect(paletteButtons.length).toBe(16); // Still 16
  });

  // ── Color input ──────────────────────────────────────────────────────────

  it('updates color from text input with valid hex', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const textInput = document.querySelector('input[type="text"][maxlength="7"]') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: '#abcdef' } });
    expect(textInput.value).toBe('#abcdef');
  });

  it('rejects invalid hex in text input', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const textInput = document.querySelector('input[type="text"][maxlength="7"]') as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: 'not-hex' } });
    // Color should remain unchanged
    expect(textInput.value).toBe('#000000');
  });

  // ── Clear canvas ─────────────────────────────────────────────────────────

  it('enables undo after clear', () => {
    render(<PixelArtEditor open={true} onClose={vi.fn()} />);
    const clearBtn = screen.getByTitle('Clear canvas');
    fireEvent.click(clearBtn);
    const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
    expect(undoBtn.hasAttribute('disabled')).toBe(false);
  });
});
