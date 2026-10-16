/**
 * MaterialInspector's texture slots: what reaches `load_texture`, and the
 * "assign an existing asset" option that cannot work yet.
 *
 * The slot's picker sends the file as a data URL WHOLE, header included,
 * because the header is how the engine learns the format (#10396). These
 * tests drive the real assetSlice behind the inspector with a mock
 * dispatcher, so what is asserted is the command payload the engine would
 * receive.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { MaterialInspector } from '../MaterialInspector';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useShaderEditorStore } from '@/stores/shaderEditorStore';
import { createAssetSlice, setAssetDispatcher } from '@/stores/slices/assetSlice';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';

vi.mock('@/stores/editorStore', () => ({ useEditorStore: vi.fn(() => ({})) }));
vi.mock('@/stores/workspaceStore', () => ({ useWorkspaceStore: vi.fn(() => ({})) }));
vi.mock('@/stores/shaderEditorStore', () => ({ useShaderEditorStore: vi.fn(() => ({})) }));

vi.mock('@/lib/materialPresets', () => ({
  MATERIAL_PRESETS: [],
  ALL_CATEGORIES: [],
  getPresetById: vi.fn(() => null),
  saveCustomMaterial: vi.fn(),
}));

vi.mock('../GenerateTextureDialog', () => ({ GenerateTextureDialog: () => null }));

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
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

import { showError, showPersistentError } from '@/lib/toast';

/** A FileReader that fails every read, as a corrupted or locked file does. */
class FailingFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(): void {
    queueMicrotask(() => this.onerror?.());
  }
}

/** The 8-byte PNG signature: base64 `iVBORw0KGgo=`. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A JPEG start-of-image + APP0 marker: base64 `/9j/4A==`. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function pickedFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type });
}

const material = {
  baseColor: [1, 0, 0, 1] as [number, number, number, number],
  metallic: 0.5,
  perceptualRoughness: 0.5,
  reflectance: 0.5,
  emissive: [0, 0, 0, 1] as [number, number, number, number],
  doubleSided: false,
  unlit: false,
  alphaMode: 'opaque' as const,
  baseColorTexture: null as string | null,
  normalMapTexture: null as string | null,
  metallicRoughnessTexture: null as string | null,
  emissiveTexture: null as string | null,
  occlusionTexture: null as string | null,
  depthMapTexture: null as string | null,
  clearcoatTexture: null as string | null,
  clearcoatRoughnessTexture: null as string | null,
  clearcoatNormalTexture: null as string | null,
  uvOffset: [0, 0] as [number, number],
  uvScale: [1, 1] as [number, number],
  uvRotation: 0,
  parallaxDepthScale: 0.1,
  parallaxMappingMethod: 'occlusion' as const,
  maxParallaxLayerCount: 16,
  parallaxReliefMaxSteps: 5,
  clearcoat: 0,
  clearcoatPerceptualRoughness: 0.5,
  specularTransmission: 0,
  diffuseTransmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: null as number | null,
  attenuationColor: [1, 1, 1] as [number, number, number],
};

const mockDispatch = vi.fn();
const mockRemoveTexture = vi.fn();
const slice = createSliceStore(createAssetSlice);

function setupStore(assetRegistry: Record<string, unknown> = {}, materialOverrides: Partial<typeof material> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector({
    primaryId: 'ent-1',
    primaryMaterial: { ...material, ...materialOverrides },
    updateMaterial: vi.fn(),
    primaryShaderEffect: null,
    updateShaderEffect: vi.fn(),
    removeShaderEffect: vi.fn(),
    loadTexture: slice.getState().loadTexture,
    removeTexture: mockRemoveTexture,
    assetRegistry,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => selector({ navigateDocs: vi.fn() }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useShaderEditorStore).mockImplementation((selector: any) => selector({ openShaderEditor: vi.fn() }));
}

const baseColorInput = () => screen.getByLabelText('Upload base color texture file') as HTMLInputElement;

describe('MaterialInspector texture slots (#10396)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAssetDispatcher(mockDispatch);
    setupStore();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  it('a file the browser cannot read is reported, and nothing is sent', async () => {
    vi.stubGlobal('FileReader', FailingFileReader);
    render(<MaterialInspector />);

    fireEvent.change(baseColorInput(), { target: { files: [pickedFile(PNG_BYTES, 'broken.png', 'image/png')] } });

    await waitFor(() => expect(showError).toHaveBeenCalledWith(
      'Failed to read file "broken.png". The file may be corrupted or inaccessible.',
    ));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(showPersistentError).not.toHaveBeenCalled();
  });

  it('a picked PNG reaches load_texture as the whole data URL, for the slot it was picked in', async () => {
    render(<MaterialInspector />);

    fireEvent.change(baseColorInput(), { target: { files: [pickedFile(PNG_BYTES, 'bricks.png', 'image/png')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'bricks.png',
      entityId: 'ent-1',
      slot: 'base_color',
    }));
    expect(showPersistentError).not.toHaveBeenCalled();
  });

  it('a picked JPEG reaches load_texture declared as image/jpeg', async () => {
    render(<MaterialInspector />);

    fireEvent.change(screen.getByLabelText('Upload normal map texture file'), {
      target: { files: [pickedFile(JPEG_BYTES, 'bump.jpg', 'image/jpeg')] },
    });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
      dataBase64: 'data:image/jpeg;base64,/9j/4A==',
      name: 'bump.jpg',
      entityId: 'ent-1',
      slot: 'normal_map',
    }));
  });

  it('a .png the OS gave no type reaches load_texture declared as image/png', async () => {
    render(<MaterialInspector />);

    fireEvent.change(baseColorInput(), { target: { files: [pickedFile(PNG_BYTES, 'bricks.png', '')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
    })));
  });

  it('a .webp arriving anyway is refused before any command, naming the file', async () => {
    render(<MaterialInspector />);

    fireEvent.change(baseColorInput(), { target: { files: [pickedFile(JPEG_BYTES, 'photo.webp', 'image/webp')] } });

    await waitFor(() => expect(showPersistentError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(showPersistentError).mock.calls[0]![0]).toContain('"photo.webp"');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('the slot picker offers only the formats the engine decodes', () => {
    render(<MaterialInspector />);

    expect(baseColorInput().getAttribute('accept')).toBe('.png,.jpg,.jpeg');
  });

  describe('assigning an existing texture asset (not available until #10398)', () => {
    const registry = {
      tex1: { id: 'tex1', name: 'bricks.png', kind: 'texture', fileSize: 1024, source: { type: 'upload', filename: 'bricks.png' } },
    };

    it('lists another asset but does not offer it, and a visible note the select points at says why', () => {
      setupStore(registry);
      render(<MaterialInspector />);

      const select = screen.getByLabelText('Base Color') as HTMLSelectElement;
      const option = Array.from(select.options).find((o) => o.value === 'tex1');
      expect(option, 'the asset must still be listed').toBeDefined();
      expect(option!.disabled).toBe(true);
      expect(option!.textContent).toBe('bricks.png (assign not available yet)');
      // The explanation is visible text, and the select is described by it.
      const noteId = select.getAttribute('aria-describedby');
      expect(noteId).toBeTruthy();
      const note = document.getElementById(noteId!);
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain('#10398');
      expect(note!.textContent).toMatch(/upload/i);
      expect(select).not.toHaveAttribute('title');
    });

    it("the slot's current texture reads as itself, enabled, with nothing to explain", () => {
      setupStore(registry, { baseColorTexture: 'tex1' });
      render(<MaterialInspector />);

      const select = screen.getByLabelText('Base Color') as HTMLSelectElement;
      expect(select.value).toBe('tex1');
      const option = Array.from(select.options).find((o) => o.value === 'tex1');
      expect(option!.disabled).toBe(false);
      expect(option!.textContent).toBe('bricks.png');
      // The only asset is this slot's own: no other to assign, so no note.
      expect(select.getAttribute('aria-describedby')).toBeNull();
    });

    it('with the current texture and another asset, only the other one is withheld', () => {
      setupStore(
        { ...registry, tex2: { id: 'tex2', name: 'stone.png', kind: 'texture', fileSize: 2048, source: { type: 'upload', filename: 'stone.png' } } },
        { baseColorTexture: 'tex1' },
      );
      render(<MaterialInspector />);

      const select = screen.getByLabelText('Base Color') as HTMLSelectElement;
      const byValue = Object.fromEntries(Array.from(select.options).map((o) => [o.value, o]));
      expect(byValue['tex1']!.disabled).toBe(false);
      expect(byValue['tex1']!.textContent).toBe('bricks.png');
      expect(byValue['tex2']!.disabled).toBe(true);
      expect(byValue['tex2']!.textContent).toBe('stone.png (assign not available yet)');
      expect(select.getAttribute('aria-describedby')).toBeTruthy();
    });

    it('choosing it anyway sends no empty-bodied load_texture and raises no refusal', () => {
      // The option is disabled, and the handler also ignores an asset id: an
      // empty body used to go to the engine as a texture and come back as
      // "texture data is empty" on an ordinary control.
      setupStore(registry);
      render(<MaterialInspector />);

      fireEvent.change(screen.getByLabelText('Base Color'), { target: { value: 'tex1' } });

      expect(mockDispatch).not.toHaveBeenCalled();
      expect(showPersistentError).not.toHaveBeenCalled();
    });

    it('"None" and "Upload new..." still work beside it', () => {
      setupStore(registry);
      render(<MaterialInspector />);
      const select = screen.getByLabelText('Base Color') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: '__none__' } });
      expect(mockRemoveTexture).toHaveBeenCalledWith('ent-1', 'base_color');
      expect(Array.from(select.options).find((o) => o.value === '__upload__')?.disabled).toBe(false);
    });
  });
});
