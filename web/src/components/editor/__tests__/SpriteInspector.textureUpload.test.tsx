/**
 * SpriteInspector's texture picker: what reaches `load_texture`.
 *
 * The picker sends the file as a data URL WHOLE, header included, because
 * the header is how the engine learns the format (#10396). These tests drive
 * the real assetSlice behind the inspector with a mock dispatcher, so what is
 * asserted is the command payload the engine would receive.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { SpriteInspector } from '../SpriteInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { SpriteData } from '@/stores/slices/types';
import { createAssetSlice, setAssetDispatcher } from '@/stores/slices/assetSlice';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';

vi.mock('@/stores/editorStore', () => ({ useEditorStore: vi.fn(() => ({})) }));
vi.mock('../PixelArtEditor', () => ({ PixelArtEditor: () => null }));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Image: (props: Record<string, unknown>) => <span data-testid="image-icon" {...props} />,
  Pencil: (props: Record<string, unknown>) => <span data-testid="pencil-icon" {...props} />,
}));

vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('@/lib/audio/entityAudioGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audio/entityAudioGraph')>()),
  queueAudioImport: vi.fn(),
}));

import { showPersistentError } from '@/lib/toast';

/** The 8-byte PNG signature: base64 `iVBORw0KGgo=`. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A JPEG start-of-image + APP0 marker: base64 `/9j/4A==`. */
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

function pickedFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes], name, { type });
}

const spriteData: SpriteData = {
  textureAssetId: null,
  colorTint: [1, 1, 1, 1],
  flipX: false,
  flipY: false,
  customSize: null,
  sortingLayer: 'Default',
  sortingOrder: 0,
  anchor: 'center',
};

const mockDispatch = vi.fn();
const slice = createSliceStore(createAssetSlice);

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      primaryId: 'entity-1',
      sprites: { 'entity-1': spriteData },
      sortingLayers: [{ name: 'Default', order: 0, visible: true }],
      assetRegistry: {},
      setSpriteData: vi.fn(),
      loadTexture: slice.getState().loadTexture,
    };
    return typeof selector === 'function' ? selector(state) : state;
  });
}

function textureInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  expect(input, 'the texture file input must render').not.toBeNull();
  return input as HTMLInputElement;
}

describe('SpriteInspector texture upload (#10396)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAssetDispatcher(mockDispatch);
    setupStore();
  });

  afterEach(() => {
    cleanup();
    setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  it('a picked PNG reaches load_texture as the whole data URL, in the sprite slot', async () => {
    const { container } = render(<SpriteInspector />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'hero.png', 'image/png')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'hero.png',
      entityId: 'entity-1',
      slot: 'sprite',
    }));
    expect(showPersistentError).not.toHaveBeenCalled();
  });

  it('a picked JPEG reaches load_texture declared as image/jpeg', async () => {
    const { container } = render(<SpriteInspector />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(JPEG_BYTES, 'hero.jpg', 'image/jpeg')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/jpeg;base64,/9j/4A==',
      name: 'hero.jpg',
      slot: 'sprite',
    })));
  });

  it('a .png the OS gave no type reaches load_texture declared as image/png', async () => {
    const { container } = render(<SpriteInspector />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'hero.png', '')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
    })));
  });

  it('a .webp arriving anyway is refused before any command, naming the file', async () => {
    const { container } = render(<SpriteInspector />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(JPEG_BYTES, 'hero.webp', 'image/webp')] } });

    await waitFor(() => expect(showPersistentError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(showPersistentError).mock.calls[0]![0]).toContain('"hero.webp"');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('the picker offers only the formats the engine decodes', () => {
    const { container } = render(<SpriteInspector />);

    expect(textureInput(container).getAttribute('accept')).toBe('.png,.jpg,.jpeg');
  });
});
