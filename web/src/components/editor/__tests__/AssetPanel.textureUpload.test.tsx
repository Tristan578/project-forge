/**
 * AssetPanel's texture picker and drop zone: what reaches `load_texture`.
 *
 * The picker sends the file as a data URL WHOLE, header included, because
 * the header is how the engine learns the format (#10396). These tests drive
 * the real assetSlice behind the panel with a mock dispatcher, so what is
 * asserted is the command payload the engine would receive - not a mocked
 * `loadTexture` argument.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { AssetPanel } from '../AssetPanel';
import { useEditorStore } from '@/stores/editorStore';
import { createAssetSlice, setAssetDispatcher, type AssetSlice } from '@/stores/slices/assetSlice';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/hooks/useGenerationGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGenerationGate: vi.fn(() => ({ blocked: false, reason: undefined, loading: false, unprovisionable: false, byokConfigurable: false })),
}));

vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn((selector: (s: { tier: string; profileLoaded: boolean }) => unknown) =>
    selector({ tier: 'pro', profileLoaded: true }),
  ),
}));

vi.mock('@/lib/ai/tierAccess', () => ({
  canAccessPanel: vi.fn(() => true),
  effectiveTier: vi.fn((tier: string) => tier),
  getRequiredTier: vi.fn(() => null),
  TIER_LABELS: { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' },
}));

vi.mock('../MaterialLibraryPanel', () => ({ MaterialLibraryPanel: () => null }));
vi.mock('@/components/editor/PrefabLibraryPanel', () => ({ PrefabLibraryPanel: () => null }));
vi.mock('../GenerateModelDialog', () => ({ GenerateModelDialog: () => null }));
vi.mock('../GenerateTextureDialog', () => ({ GenerateTextureDialog: () => null }));
vi.mock('../GenerateSoundDialog', () => ({ GenerateSoundDialog: () => null }));
vi.mock('../GenerateMusicDialog', () => ({ GenerateMusicDialog: () => null }));
vi.mock('../GenerateSkyboxDialog', () => ({ GenerateSkyboxDialog: () => null }));

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

/** The 8-byte PNG signature: base64 `iVBORw0KGgo=`. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A FileReader that fails every read, as a corrupted or locked file does. */
class FailingFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(): void {
    queueMicrotask(() => this.onerror?.());
  }
}

/** A FileReader that fails for files named `broken*` and reads the rest as the PNG signature. */
class SelectiveFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(file: File): void {
    queueMicrotask(() => {
      if (file.name.startsWith('broken')) {
        this.onerror?.();
      } else {
        this.result = 'data:image/png;base64,iVBORw0KGgo=';
        this.onload?.();
      }
    });
  }
}
/** A JPEG start-of-image + APP0 marker: base64 `/9j/4A==`. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

function pickedFile(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type });
}

const mockDispatch = vi.fn();
const slice = createSliceStore(createAssetSlice);

/** The store actions the panel calls; the texture one is the real slice unless a test overrides it. */
type ImportActions = Pick<AssetSlice, 'importGltf' | 'loadTexture' | 'importAudio'>;

function setupStore(
  overrides: Partial<ImportActions> = {},
  primaryId: string | null = 'ent-1',
  sprites: Record<string, unknown> = {},
): ImportActions {
  const actions: ImportActions = {
    importGltf: vi.fn(() => ({ success: true })),
    loadTexture: slice.getState().loadTexture,
    importAudio: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector({
    assetRegistry: {},
    ...actions,
    placeAsset: vi.fn(),
    deleteAsset: vi.fn(),
    primaryId,
    sprites,
  }));
  return actions;
}

function fileInput(container: HTMLElement, accepts: string, what: string): HTMLInputElement {
  const input = container.querySelector(`input[type="file"][accept*="${accepts}"]`);
  expect(input, `the ${what} file input must render`).not.toBeNull();
  return input as HTMLInputElement;
}

const textureInput = (container: HTMLElement) => fileInput(container, '.png', 'texture');
const gltfInput = (container: HTMLElement) => fileInput(container, '.glb', 'model');
const audioInput = (container: HTMLElement) => fileInput(container, '.mp3', 'audio');

/** Drop `files` on the panel; firing on the hidden input bubbles there. */
function dropFiles(container: HTMLElement, files: File[]): void {
  fireEvent.drop(textureInput(container), { dataTransfer: { files, types: ['Files'] } });
}

const readFailure = (name: string) => `Failed to read file "${name}". The file may be corrupted or inaccessible.`;

describe('AssetPanel texture upload (#10396)', () => {
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
    const { container } = render(<AssetPanel />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'broken.png', 'image/png')] } });

    await waitFor(() => expect(showError).toHaveBeenCalledWith(
      'Failed to read file "broken.png". The file may be corrupted or inaccessible.',
    ));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(showPersistentError).not.toHaveBeenCalled();
  });

  it('an unreadable file in a drop batch is reported and the rest still import', async () => {
    vi.stubGlobal('FileReader', SelectiveFileReader);
    const { container } = render(<AssetPanel />);

    fireEvent.drop(textureInput(container), {
      dataTransfer: {
        files: [pickedFile(PNG_BYTES, 'broken.png', 'image/png'), pickedFile(PNG_BYTES, 'floor.png', 'image/png')],
        types: ['Files'],
      },
    });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith('Failed to read file "broken.png". The file may be corrupted or inaccessible.');
  });

  describe('a texture the store cannot load', () => {
    const throwing = () => vi.fn(() => { throw new Error('engine not ready'); });

    it('dropped: is reported as a load failure, not as an unreadable file, and the progress bar still clears', async () => {
      const loadTexture = throwing();
      setupStore({ loadTexture });
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'floor.png', 'image/png')]);

      await waitFor(() => expect(showError).toHaveBeenCalledWith('Could not load texture "floor.png": engine not ready'));
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to read file'));
      expect(loadTexture).toHaveBeenCalledTimes(1);
      expect(mockDispatch).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });

    it('picked: is reported as a load failure, and the file after it still loads', async () => {
      // Throws for one file and is the real slice for the rest, so "the next
      // file still loads" is observable at the dispatcher.
      const real = slice.getState().loadTexture;
      const loadTexture = vi.fn((dataUrl: string, name: string, entityId: string, slot: string) => {
        if (name === 'bad.png') throw new Error('engine not ready');
        return real(dataUrl, name, entityId, slot);
      });
      setupStore({ loadTexture });
      const { container } = render(<AssetPanel />);

      fireEvent.change(textureInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'bad.png', 'image/png'), pickedFile(PNG_BYTES, 'stone.png', 'image/png')] },
      });

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'stone.png' })));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledWith('Could not load texture "bad.png": engine not ready');
    });
  });

  describe('an unreadable model or audio file (#10396 round 3)', () => {
    it('in a drop batch: is reported once, the texture after it still loads, and the progress bar clears', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const { importGltf } = setupStore();
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'broken.glb', ''), pickedFile(PNG_BYTES, 'floor.png', 'image/png')]);

      // The bar is up while the batch runs, and gone once it is done.
      expect(screen.getByText(/Importing 1\/2/)).toBeTruthy();
      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(importGltf).not.toHaveBeenCalled();
      // ONE toast for the model: the reader no longer shows one of its own.
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledWith(readFailure('broken.glb'));
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });

    it('a picked model that cannot be read is reported and the next one still imports', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const { importGltf } = setupStore();
      const { container } = render(<AssetPanel />);

      fireEvent.change(gltfInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'broken.glb', ''), pickedFile(PNG_BYTES, 'model.glb', '')] },
      });

      await waitFor(() => expect(importGltf).toHaveBeenCalledWith('iVBORw0KGgo=', 'model.glb'));
      expect(importGltf).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledWith(readFailure('broken.glb'));
    });

    it('a picked model with an upper-case extension is imported, as the drop zone would', async () => {
      const { importGltf } = setupStore();
      const { container } = render(<AssetPanel />);

      fireEvent.change(gltfInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'MODEL.GLB', '')] },
      });

      await waitFor(() => expect(importGltf).toHaveBeenCalledWith('iVBORw0KGgo=', 'MODEL.GLB'));
      expect(showError).not.toHaveBeenCalled();
    });

    it('a picked audio file that cannot be read is reported and the next one still imports', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const { importAudio } = setupStore();
      const { container } = render(<AssetPanel />);

      fireEvent.change(audioInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'broken.mp3', ''), pickedFile(PNG_BYTES, 'song.mp3', '')] },
      });

      await waitFor(() => expect(importAudio).toHaveBeenCalledWith('iVBORw0KGgo=', 'song.mp3'));
      expect(importAudio).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError).toHaveBeenCalledWith(readFailure('broken.mp3'));
    });
  });

  describe('a model or audio file the store cannot import (#10396 round 4)', () => {
    it('picked: a thrown importGltf is reported as an import failure, and the next model still imports', async () => {
      const importGltf = vi.fn((_base64: string, name: string) => {
        if (name === 'bad.glb') throw new Error('engine not ready');
        return { success: true };
      });
      setupStore({ importGltf });
      const { container } = render(<AssetPanel />);

      fireEvent.change(gltfInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'bad.glb', ''), pickedFile(PNG_BYTES, 'model.glb', '')] },
      });

      await waitFor(() => expect(importGltf).toHaveBeenCalledWith('iVBORw0KGgo=', 'model.glb'));
      expect(importGltf).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith('Could not import "bad.glb": engine not ready');
      expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to read file'));
    });

    it('dropped: a thrown importAudio is reported as an import failure, the texture after it still loads, and the progress bar clears', async () => {
      const importAudio = vi.fn(() => { throw new Error('audio graph not ready'); });
      setupStore({ importAudio });
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'bad.mp3', ''), pickedFile(PNG_BYTES, 'floor.png', 'image/png')]);

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(importAudio).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith('Could not import "bad.mp3": audio graph not ready');
      expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to read file'));
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });

    // The other two importer catches. Each of the four (picked model, picked
    // audio, dropped model, dropped audio) has exactly one test here that goes
    // red when its catch is deleted: without it the throw escapes as an
    // unhandled rejection and the file after it never imports.
    it('picked: a thrown importAudio is reported as an import failure, and the next audio file still imports', async () => {
      const importAudio = vi.fn((_base64: string, name: string) => {
        if (name === 'bad.mp3') throw new Error('audio graph not ready');
      });
      setupStore({ importAudio });
      const { container } = render(<AssetPanel />);

      fireEvent.change(audioInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'bad.mp3', ''), pickedFile(PNG_BYTES, 'song.mp3', '')] },
      });

      await waitFor(() => expect(importAudio).toHaveBeenCalledWith('iVBORw0KGgo=', 'song.mp3'));
      expect(importAudio).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith('Could not import "bad.mp3": audio graph not ready');
      expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to read file'));
    });

    it('dropped: a thrown importGltf is reported as an import failure, the texture after it still loads, and the progress bar clears', async () => {
      const importGltf = vi.fn(() => { throw new Error('engine not ready'); });
      setupStore({ importGltf });
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'bad.glb', ''), pickedFile(PNG_BYTES, 'floor.png', 'image/png')]);

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(importGltf).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith('Could not import "bad.glb": engine not ready');
      expect(showError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to read file'));
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });
  });

  // A 2D sprite renders from its SpriteData, not a material: a texture
  // imported or dropped while one is selected goes to the sprite's own slot.
  // `base_color` found no material and changed nothing (#10399).
  describe('a texture with a 2D sprite selected (#10399)', () => {
    const spriteSelected = { 'ent-1': { textureAssetId: null } };

    it('picked: the texture goes to the sprite slot', async () => {
      setupStore({}, 'ent-1', spriteSelected);
      const { container } = render(<AssetPanel />);

      fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'hero.png', 'image/png')] } });

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
        'load_texture',
        expect.objectContaining({ name: 'hero.png', entityId: 'ent-1', slot: 'sprite' }),
      ));
    });

    it('dropped: the texture goes to the sprite slot', async () => {
      setupStore({}, 'ent-1', spriteSelected);
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'hero.png', 'image/png')]);

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
        'load_texture',
        expect.objectContaining({ name: 'hero.png', entityId: 'ent-1', slot: 'sprite' }),
      ));
    });

    it('a selected entity with no sprite data keeps the base colour slot', async () => {
      setupStore({}, 'ent-1', { 'some-other-entity': { textureAssetId: null } });
      const { container } = render(<AssetPanel />);

      fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'floor.png', 'image/png')] } });

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
        'load_texture',
        expect.objectContaining({ name: 'floor.png', entityId: 'ent-1', slot: 'base_color' }),
      ));
    });
  });

  describe('a texture with no entity selected (#10396)', () => {
    const needsTarget = (name: string) =>
      `"${name}" was not imported: select an entity to apply the texture to, then import it again.`;

    it('picked: each texture is named in a notice, and nothing is sent', async () => {
      setupStore({}, null);
      const { container } = render(<AssetPanel />);

      fireEvent.change(textureInput(container), {
        target: { files: [pickedFile(PNG_BYTES, 'floor.png', 'image/png'), pickedFile(PNG_BYTES, 'wall.png', 'image/png')] },
      });

      await waitFor(() => expect(showError).toHaveBeenCalledTimes(2));
      expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual([needsTarget('floor.png'), needsTarget('wall.png')]);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('dropped: the texture is named, the model in the same drop still imports, and the progress bar clears', async () => {
      const { importGltf } = setupStore({}, null);
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'floor.png', 'image/png'), pickedFile(PNG_BYTES, 'model.glb', '')]);

      await waitFor(() => expect(importGltf).toHaveBeenCalledWith('iVBORw0KGgo=', 'model.glb'));
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith(needsTarget('floor.png'));
      expect(mockDispatch).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });
  });

  describe('a batch with many unreadable files raises at most three toasts: two named, one summary (#10396)', () => {
    /** Five unreadable PNGs and one readable one, the readable one last so the cap cannot hide it. */
    const fiveBrokenAndOne = () => [
      ...[1, 2, 3, 4, 5].map((n) => pickedFile(PNG_BYTES, `broken${n}.png`, 'image/png')),
      pickedFile(PNG_BYTES, 'floor.png', 'image/png'),
    ];

    const expectCappedBatch = (warn: ReturnType<typeof vi.spyOn>) => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual([
        readFailure('broken1.png'),
        readFailure('broken2.png'),
        '3 more files failed to import; details are in the browser console.',
      ]);
      expect(warn.mock.calls).toEqual([
        [`[assets] ${readFailure('broken3.png')}`],
        [`[assets] ${readFailure('broken4.png')}`],
        [`[assets] ${readFailure('broken5.png')}`],
      ]);
    };

    it('dropped', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { container } = render(<AssetPanel />);

        dropFiles(container, fiveBrokenAndOne());

        await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
        await waitFor(() => expect(showError).toHaveBeenCalledTimes(3));
        expectCappedBatch(warn);
        await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
      } finally {
        warn.mockRestore();
      }
    });

    it('picked', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { container } = render(<AssetPanel />);

        fireEvent.change(textureInput(container), { target: { files: fiveBrokenAndOne() } });

        await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({ name: 'floor.png' })));
        await waitFor(() => expect(showError).toHaveBeenCalledTimes(3));
        expectCappedBatch(warn);
      } finally {
        warn.mockRestore();
      }
    });
  });

  it('a picked PNG reaches load_texture as the whole data URL, header included', async () => {
    const { container } = render(<AssetPanel />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'stone.png', 'image/png')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', {
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'stone.png',
      entityId: 'ent-1',
      slot: 'base_color',
    }));
    expect(showPersistentError).not.toHaveBeenCalled();
  });

  it('a picked JPEG reaches load_texture declared as image/jpeg', async () => {
    const { container } = render(<AssetPanel />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(JPEG_BYTES, 'photo.jpg', 'image/jpeg')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/jpeg;base64,/9j/4A==',
      name: 'photo.jpg',
    })));
  });

  it('a .png the OS gave no type reaches load_texture declared as image/png', async () => {
    const { container } = render(<AssetPanel />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(PNG_BYTES, 'stone.png', '')] } });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
    })));
  });

  it('a .webp arriving anyway is refused before any command, naming the file and the accepted formats', async () => {
    const { container } = render(<AssetPanel />);

    fireEvent.change(textureInput(container), { target: { files: [pickedFile(JPEG_BYTES, 'photo.webp', 'image/webp')] } });

    await waitFor(() => expect(showPersistentError).toHaveBeenCalledTimes(1));
    const [message, options] = vi.mocked(showPersistentError).mock.calls[0]!;
    expect(message).toContain('"photo.webp"');
    expect(message).toContain("unsupported texture format 'image/webp'; accepted formats are image/png, image/jpeg");
    expect(options).toEqual({ id: 'load_texture-refused:photo.webp' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('the picker offers only the formats the engine decodes', () => {
    const { container } = render(<AssetPanel />);

    expect(textureInput(container).getAttribute('accept')).toBe('.png,.jpg,.jpeg');
  });

  describe('a dropped file of a type the editor does not import is named, not ignored (#10396)', () => {
    const notAccepted = (name: string) =>
      `"${name}" was not imported: the editor accepts PNG and JPEG textures, GLB and glTF models, and MP3, OGG, WAV and FLAC audio.`;

    it('a drop of only a .webp raises one toast naming it, sends nothing, and never shows the progress bar', async () => {
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(JPEG_BYTES, 'photo.webp', 'image/webp')]);

      // Nothing to import, so the bar is never shown - not shown-and-stuck.
      expect(screen.queryByText(/Importing/)).toBeNull();
      await waitFor(() => expect(showError).toHaveBeenCalledWith(notAccepted('photo.webp')));
      expect(showError).toHaveBeenCalledTimes(1);
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(showPersistentError).not.toHaveBeenCalled();
      expect(screen.queryByText(/Importing/)).toBeNull();
    });

    it('a dropped PNG is imported whole; a .webp beside it is named in one toast and not imported', async () => {
      const { container } = render(<AssetPanel />);

      dropFiles(container, [pickedFile(PNG_BYTES, 'floor.png', 'image/png'), pickedFile(JPEG_BYTES, 'photo.webp', 'image/webp')]);

      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
        dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
        name: 'floor.png',
      })));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(showError).toHaveBeenCalledTimes(1));
      expect(showError).toHaveBeenCalledWith(notAccepted('photo.webp'));
      expect(showPersistentError).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });

    it('the toast cap applies: four such files raise two named toasts and one summary', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { container } = render(<AssetPanel />);

        dropFiles(container, ['a.webp', 'b.psd', 'c.txt', 'd.gif'].map((name) => pickedFile(JPEG_BYTES, name, '')));

        await waitFor(() => expect(showError).toHaveBeenCalledTimes(3));
        expect(vi.mocked(showError).mock.calls.map(([m]) => m)).toEqual([
          notAccepted('a.webp'),
          notAccepted('b.psd'),
          '2 more files failed to import; details are in the browser console.',
        ]);
        expect(warn.mock.calls).toEqual([
          [`[assets] ${notAccepted('c.txt')}`],
          [`[assets] ${notAccepted('d.gif')}`],
        ]);
        expect(mockDispatch).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('every type the sentence names is taken from a drop, so none of them is reported as not accepted', async () => {
      vi.stubGlobal('FileReader', SelectiveFileReader);
      const { importGltf, importAudio } = setupStore();
      const { container } = render(<AssetPanel />);
      const names = ['a.png', 'b.jpg', 'c.jpeg', 'd.glb', 'e.gltf', 'f.mp3', 'g.ogg', 'h.wav', 'i.flac'];

      dropFiles(container, names.map((name) => pickedFile(PNG_BYTES, name, '')));

      await waitFor(() => expect(importAudio).toHaveBeenCalledTimes(4));
      expect(importGltf).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledTimes(3);
      expect(showError).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText(/Importing/)).toBeNull());
    });
  });
});
