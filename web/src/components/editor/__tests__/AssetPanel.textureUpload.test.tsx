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
import { render, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { AssetPanel } from '../AssetPanel';
import { useEditorStore } from '@/stores/editorStore';
import { createAssetSlice, setAssetDispatcher } from '@/stores/slices/assetSlice';
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

function setupStore() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector({
    assetRegistry: {},
    importGltf: vi.fn(),
    loadTexture: slice.getState().loadTexture,
    importAudio: vi.fn(),
    placeAsset: vi.fn(),
    deleteAsset: vi.fn(),
    primaryId: 'ent-1',
  }));
}

function textureInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"][accept*=".png"]');
  expect(input, 'the texture file input must render').not.toBeNull();
  return input as HTMLInputElement;
}

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

  it('a dropped PNG is imported whole; a dropped .webp is not imported at all', async () => {
    const { container } = render(<AssetPanel />);
    const input = textureInput(container);

    // The drop lands on the panel; firing it on the hidden input bubbles there.
    fireEvent.drop(input, {
      dataTransfer: {
        files: [pickedFile(PNG_BYTES, 'floor.png', 'image/png'), pickedFile(JPEG_BYTES, 'photo.webp', 'image/webp')],
        types: ['Files'],
      },
    });

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith('load_texture', expect.objectContaining({
      dataBase64: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'floor.png',
    })));
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(showPersistentError).not.toHaveBeenCalled();
  });
});
