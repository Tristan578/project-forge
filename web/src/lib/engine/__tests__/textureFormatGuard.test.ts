/**
 * `checkTexturePayload` is the editor-side twin of
 * `engine/src/core/asset_import_guard.rs::check_texture_payload`. The
 * behaviour cases mirror that module's tests one for one; the pins at the end
 * read the Rust source so the allowlist, the accepted declarations, the
 * refusal wording and the `load_texture` wire field names cannot drift apart
 * silently (#10396, #10397).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ACCEPTED_TEXTURE_DECLARATIONS,
  ALLOWED_TEXTURE_MIME_TYPES,
  checkTexturePayload,
} from '../textureFormatGuard';

// The wire-shape pin dispatches through the real slice; only the audio queue
// it imports is stubbed, as assetSlice.test.ts does.
vi.mock('@/lib/audio/entityAudioGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audio/entityAudioGraph')>()),
  queueAudioImport: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showError: vi.fn(),
  showPersistentError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

const ENGINE_SRC = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src');

function rustSource(relative: string): string {
  return readFileSync(join(ENGINE_SRC, relative), 'utf8');
}

describe('checkTexturePayload', () => {
  it('decodes a raw base64 body as PNG', () => {
    expect(checkTexturePayload('iVBORw0KGgo=')).toEqual({
      ok: true,
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    });
  });

  it('accepts png and jpeg data URLs with the header removed', () => {
    expect(checkTexturePayload('data:image/png;base64,AAAA')).toEqual({
      ok: true,
      mimeType: 'image/png',
      base64: 'AAAA',
    });
    expect(checkTexturePayload('data:image/jpeg;base64,BBBB')).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
      base64: 'BBBB',
    });
  });

  it('canonicalises image/jpg to image/jpeg', () => {
    expect(checkTexturePayload('data:image/jpg;base64,AAAA')).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
      base64: 'AAAA',
    });
  });

  it('ignores case and parameters, as the engine does', () => {
    expect(checkTexturePayload('DATA:Image/PNG;charset=utf-8;BASE64,AAAA')).toEqual({
      ok: true,
      mimeType: 'image/png',
      base64: 'AAAA',
    });
    expect(checkTexturePayload('data:image/jpeg ; q=1;base64,AAAA')).toMatchObject({
      ok: true,
      mimeType: 'image/jpeg',
    });
  });

  it('refuses image/ktx2 by name, listing the accepted formats', () => {
    const result = checkTexturePayload('data:image/ktx2;base64,q0tUWCAyMLsNChoK');
    expect(result).toEqual({
      ok: false,
      error: "unsupported texture format 'image/ktx2'; accepted formats are image/png, image/jpeg",
    });
  });

  it('refuses ktx2 case and parameter variants', () => {
    for (const declared of ['IMAGE/KTX2', 'image/ktx2;q=1', ' image/ktx2 ']) {
      const result = checkTexturePayload(`data:${declared};base64,AAAA`);
      expect(result.ok, declared).toBe(false);
      expect(result.ok ? '' : result.error).toContain('unsupported texture format');
    }
  });

  it('refuses dds, webp and anything else outside the allowlist', () => {
    for (const declared of ['image/x-dds', 'image/vnd-ms.dds', 'image/webp', 'application/octet-stream']) {
      expect(checkTexturePayload(`data:${declared};base64,AAAA`)).toEqual({
        ok: false,
        error: `unsupported texture format '${declared}'; accepted formats are image/png, image/jpeg`,
      });
    }
  });

  it('refuses a data URL that is not base64', () => {
    expect(checkTexturePayload('data:image/png,%89PNG')).toEqual({
      ok: false,
      error: 'data URL must be base64-encoded (data:<type>;base64,...)',
    });
  });

  it('refuses a data URL without a comma', () => {
    expect(checkTexturePayload('data:image/png;base64')).toEqual({
      ok: false,
      error: "data URL has no ',' between its header and its payload",
    });
  });

  it('refuses empty payloads', () => {
    expect(checkTexturePayload('')).toEqual({ ok: false, error: 'texture data is empty' });
    expect(checkTexturePayload('data:image/png;base64,')).toEqual({
      ok: false,
      error: 'texture data is empty',
    });
  });

  it('echoes a bounded, printable copy of the declaration', () => {
    const declared = `image/${'x'.repeat(60)}\u0007\n${'y'.repeat(60)}`;
    const result = checkTexturePayload(`data:${declared};base64,AAAA`);
    expect(result.ok).toBe(false);
    const echoed = (result as { error: string }).error.match(/'([^']*)'/)![1];
    expect(echoed.endsWith('...')).toBe(true);
    expect([...echoed].length).toBeLessThanOrEqual(48 + 3);
    expect(/^[\x20-\x7e]*$/.test(echoed)).toBe(true);
  });
});

describe('the allowlist matches engine/src/core/asset_import_guard.rs', () => {
  const source = rustSource(join('core', 'asset_import_guard.rs'));

  it('names the same formats, in the same order', () => {
    const match = source.match(/^pub const ALLOWED_TEXTURE_MIME_TYPES: &\[&str\] = &\[([^\]]*)\];/m);
    expect(match, 'the Rust allowlist declaration must be where this test reads it').not.toBeNull();
    const rust = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rust.length).toBeGreaterThan(0);
    expect([...ALLOWED_TEXTURE_MIME_TYPES]).toEqual(rust);
  });

  it('accepts exactly the same declarations, canonicalised the same way', () => {
    const block = source.match(/^const ACCEPTED_DECLARATIONS[^=]*=\s*&\[([\s\S]*?)\];/m);
    expect(block, 'the Rust declaration table must be where this test reads it').not.toBeNull();
    const rust = [...block![1].matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
    expect(rust.length).toBeGreaterThan(0);
    expect(ACCEPTED_TEXTURE_DECLARATIONS.map(([declared, canonical]) => [declared, canonical])).toEqual(rust);
    for (const [declared, canonical] of rust) {
      expect(checkTexturePayload(`data:${declared};base64,AAAA`)).toEqual({
        ok: true,
        mimeType: canonical,
        base64: 'AAAA',
      });
    }
  });

  it('refuses in the same words', () => {
    // A wording pin: each sentence the TS side produces must be the literal
    // the Rust `Display` impl writes, so a person reads one sentence whichever
    // side refused. The Rust text is matched inside a `write!` so a comment
    // quoting it does not satisfy this.
    const rustWrites = [...source.matchAll(/write!\(\s*f,\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    expect(rustWrites.length).toBeGreaterThanOrEqual(4);
    const empty = checkTexturePayload('') as { error: string };
    const noComma = checkTexturePayload('data:image/png;base64') as { error: string };
    const notBase64 = checkTexturePayload('data:image/png,AAAA') as { error: string };
    for (const sentence of [empty.error, noComma.error, notBase64.error]) {
      expect(rustWrites, sentence).toContain(sentence);
    }
    expect(rustWrites).toContain("unsupported texture format '{}'; accepted formats are {}");
    const unsupported = checkTexturePayload('data:image/webp;base64,AAAA') as { error: string };
    expect(unsupported.error).toBe(
      "unsupported texture format '{}'; accepted formats are {}"
        .replace('{}', 'image/webp')
        .replace('{}', ALLOWED_TEXTURE_MIME_TYPES.join(', ')),
    );
  });
});

describe('the load_texture wire shape matches engine/src/core/commands/scene.rs', () => {
  const source = rustSource(join('core', 'commands', 'scene.rs'));

  const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  /** Field names (camelCased, as `#[serde(rename_all = "camelCase")]` reads them) and aliases. */
  function rustPayloadShape(struct: string): { fields: string[]; aliases: string[] } {
    const block = source.match(new RegExp(`struct ${struct} \\{([\\s\\S]*?)\\n\\}`));
    expect(block, `${struct} must be declared in scene.rs`).not.toBeNull();
    const fields: string[] = [];
    const aliases: string[] = [];
    for (const line of block![1].split('\n')) {
      const alias = line.match(/#\[serde\(alias = "([^"]+)"\)\]/);
      if (alias) aliases.push(alias[1]);
      const field = line.match(/^\s*([a-z_0-9]+):\s*[A-Za-z<>\[\]; 0-9]+,\s*$/);
      if (field) fields.push(camel(field[1]));
    }
    expect(fields.length).toBeGreaterThan(0);
    return { fields, aliases };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { setAssetDispatcher } = await import('@/stores/slices/assetSlice');
    setAssetDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  it('assetSlice.loadTexture sends exactly the fields LoadTexturePayload reads, by their wire names', async () => {
    const { createSliceStore } = await import('@/stores/slices/__tests__/sliceTestTemplate');
    const { createAssetSlice, setAssetDispatcher } = await import('@/stores/slices/assetSlice');
    const dispatch = vi.fn();
    setAssetDispatcher(dispatch);
    const store = createSliceStore(createAssetSlice);

    store.getState().loadTexture('data:image/png;base64,AAAA', 'stone.png', 'entity-1', 'base_color');

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [command, payload] = dispatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(command).toBe('load_texture');
    const { fields, aliases } = rustPayloadShape('LoadTexturePayload');
    // The body is `dataBase64`, the name every producer sends; `data` is the
    // pre-#10397 name, kept as an alias so a direct caller on it still parses.
    expect(fields).toContain('dataBase64');
    expect(aliases).toEqual(['data']);
    expect(Object.keys(payload).sort()).toEqual([...fields].sort());
  });

  it('assetSlice.importGltf sends only fields ImportGltfPayload reads', async () => {
    const { createSliceStore } = await import('@/stores/slices/__tests__/sliceTestTemplate');
    const { createAssetSlice, setAssetDispatcher } = await import('@/stores/slices/assetSlice');
    const dispatch = vi.fn();
    setAssetDispatcher(dispatch);
    const store = createSliceStore(createAssetSlice);

    store.getState().importGltf('eyJhc3NldCI6eyJ2ZXJzaW9uIjoiMi4wIn19', 'model.glb', 'entity-1', 'asset-1');

    const [, payload] = dispatch.mock.calls[0] as [string, Record<string, unknown>];
    const { fields } = rustPayloadShape('ImportGltfPayload');
    for (const key of Object.keys(payload)) {
      expect(fields, key).toContain(key);
    }
    expect(Object.keys(payload)).toContain('dataBase64');
  });
});
