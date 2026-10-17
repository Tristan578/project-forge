/**
 * `checkTexturePayload` is the editor-side twin of
 * `engine/src/core/asset_import_guard.rs::check_texture_payload`. The
 * behaviour cases mirror that module's tests one for one; the pins at the end
 * read the Rust source so the allowlist, the accepted declarations, the
 * refusal wording and the `load_texture` wire field names cannot drift apart
 * silently (#10396, #10397).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';

import {
  ACCEPTED_TEXTURE_DECLARATIONS,
  ALLOWED_TEXTURE_MIME_TYPES,
  RAW_BASE64_REFUSAL,
  assetImportFailureMessage,
  boundDisplayName,
  checkTexturePayload,
  declareTextureType,
  fileReadFailureMessage,
  fileTypeNotAcceptedMessage,
  sniffImageMimeType,
  textureLoadFailureMessage,
  textureMimeTypeForFile,
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
  it('types a raw base64 body that starts with the PNG signature as image/png', () => {
    expect(checkTexturePayload('iVBORw0KGgo=')).toEqual({
      ok: true,
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    });
  });

  it('types a raw base64 body that starts with the JPEG SOI marker as image/jpeg', () => {
    expect(checkTexturePayload('/9j/4AAQSkZJRg==')).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
      base64: '/9j/4AAQSkZJRg==',
    });
  });

  it("refuses a raw base64 body that is neither, in the engine's sentence", () => {
    // The sentence is pinned as a literal here (and against the Rust source
    // below): a raw JPEG used to be accepted as PNG and fail in the drain
    // with only a log line (#10396).
    const sentence = 'raw base64 texture data is neither PNG nor JPEG; send a data URL that names image/png or image/jpeg';
    expect(RAW_BASE64_REFUSAL).toBe(sentence);
    for (const body of [
      'AAAA',
      'UklGRg==', // RIFF: a WebP
      'Z2xURg==', // glTF
      'IVBORW0KGGO=', // the PNG prefix in the wrong case: different bytes
      'iVBORw0KGg', // one character short of the PNG prefix
      '/9j', // one character short of the JPEG prefix
    ]) {
      expect(checkTexturePayload(body), body).toEqual({ ok: false, error: sentence });
    }
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
    for (const declared of ['image/x-dds', 'image/vnd-ms.dds', 'image/webp', 'text/plain']) {
      expect(checkTexturePayload(`data:${declared};base64,AAAA`)).toEqual({
        ok: false,
        error: `unsupported texture format '${declared}'; accepted formats are image/png, image/jpeg`,
      });
    }
  });

  it('refuses an empty or generic declared type as unrecognised, naming the accepted formats', () => {
    // A browser gives a file it cannot classify no type at all; the data URL
    // then reads `data:;base64,` or `data:application/octet-stream;base64,`.
    for (const data of [
      'data:;base64,AAAA',
      'data:application/octet-stream;base64,AAAA',
      'DATA:Application/Octet-Stream;charset=binary;base64,AAAA',
      'data: ;base64,AAAA',
    ]) {
      expect(checkTexturePayload(data), data).toEqual({
        ok: false,
        error: 'unrecognised file type; accepted formats are image/png, image/jpeg',
      });
    }
  });
});

describe('textureMimeTypeForFile', () => {
  it('keeps the type the browser declared', () => {
    expect(textureMimeTypeForFile('image/png', 'anything.bin')).toBe('image/png');
    expect(textureMimeTypeForFile('image/webp', 'photo.png')).toBe('image/webp');
  });

  it('derives png/jpeg from the extension when the OS declared none', () => {
    expect(textureMimeTypeForFile('', 'stone.PNG')).toBe('image/png');
    expect(textureMimeTypeForFile('', 'photo.jpg')).toBe('image/jpeg');
    expect(textureMimeTypeForFile('', 'photo.jpeg')).toBe('image/jpeg');
    expect(textureMimeTypeForFile('application/octet-stream', 'stone.png')).toBe('image/png');
  });

  it('leaves an unknown extension undeclared, so the guard refuses it as unrecognised', () => {
    expect(textureMimeTypeForFile('', 'lut.ktx2')).toBe('');
    expect(textureMimeTypeForFile('', 'noextension')).toBe('');
    expect(checkTexturePayload(declareTextureType('data:;base64,AAAA', textureMimeTypeForFile('', 'lut.ktx2')))).toEqual({
      ok: false,
      error: 'unrecognised file type; accepted formats are image/png, image/jpeg',
    });
  });
});

describe('sniffImageMimeType', () => {
  it('reads the PNG signature', () => {
    expect(sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    // Only the first four bytes are read; the rest of the file may be anything.
    expect(sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
  });

  it('reads the JPEG SOI marker', () => {
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toBe('image/jpeg');
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
  });

  it('returns null for anything else, including too few bytes and a near miss', () => {
    // RIFF....WEBP
    expect(sniffImageMimeType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x48]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xfe, 0xe0]))).toBeNull();
  });

  it('agrees with the base64 sniff: the bytes behind each raw prefix are typed the same way', () => {
    const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(sniffImageMimeType(decode('iVBORw0KGgo='))).toBe('image/png');
    expect(sniffImageMimeType(decode('/9j/'))).toBe('image/jpeg');
    expect(sniffImageMimeType(decode('UklGRg=='))).toBeNull();
    expect(checkTexturePayload('UklGRg==').ok).toBe(false);
  });
});

describe('declareTextureType', () => {
  it('rewrites an empty or generic data URL header to the derived type', () => {
    expect(declareTextureType('data:;base64,AAAA', 'image/png')).toBe('data:image/png;base64,AAAA');
    expect(declareTextureType('data:application/octet-stream;base64,AAAA', 'image/jpeg')).toBe('data:image/jpeg;base64,AAAA');
  });

  it('leaves a declared header and a raw body alone', () => {
    expect(declareTextureType('data:image/png;base64,AAAA', 'image/jpeg')).toBe('data:image/png;base64,AAAA');
    expect(declareTextureType('data:image/webp;base64,AAAA', 'image/png')).toBe('data:image/webp;base64,AAAA');
    expect(declareTextureType('AAAA', 'image/png')).toBe('AAAA');
    expect(declareTextureType('data:;base64,AAAA', '')).toBe('data:;base64,AAAA');
  });
});

describe('the failure sentences a picker shows', () => {
  it('the read failure names the file', () => {
    expect(fileReadFailureMessage('broken.png')).toBe(
      'Failed to read file "broken.png". The file may be corrupted or inaccessible.',
    );
  });

  it("the load failure names the file and carries the Error's message", () => {
    expect(textureLoadFailureMessage('stone.png', new Error('engine not ready'))).toBe(
      'Could not load texture "stone.png": engine not ready',
    );
  });

  it('a non-Error throw is stringified into the load failure', () => {
    expect(textureLoadFailureMessage('stone.png', 'boom')).toBe('Could not load texture "stone.png": boom');
    expect(textureLoadFailureMessage('stone.png', 42)).toBe('Could not load texture "stone.png": 42');
  });

  it("the import failure names the file and carries the Error's message, or the stringified throw", () => {
    expect(assetImportFailureMessage('tower.glb', new Error('engine not ready'))).toBe(
      'Could not import "tower.glb": engine not ready',
    );
    expect(assetImportFailureMessage('song.mp3', 'boom')).toBe('Could not import "song.mp3": boom');
  });

  it('the not-accepted sentence names the file and every type the drop zone takes', () => {
    expect(fileTypeNotAcceptedMessage('photo.webp')).toBe(
      '"photo.webp" was not imported: the editor accepts PNG and JPEG textures, GLB and glTF models, and MP3, OGG, WAV and FLAC audio.',
    );
  });

  describe('the file name is bounded in every sentence', () => {
    const LONG = 'n'.repeat(100);
    const CUT = `${'n'.repeat(60)}…`;

    it('boundDisplayName cuts a 100-character name to 60 plus an ellipsis, and leaves a short one as is', () => {
      expect(boundDisplayName(LONG)).toBe(CUT);
      expect([...boundDisplayName(LONG)]).toHaveLength(61);
      expect(boundDisplayName('n'.repeat(60))).toBe('n'.repeat(60));
      expect(boundDisplayName('stone.png')).toBe('stone.png');
    });

    it('counts characters, not UTF-16 units, so a cut never splits a surrogate pair', () => {
      const emoji = '🙂'.repeat(70);
      expect(boundDisplayName(emoji)).toBe(`${'🙂'.repeat(60)}…`);
    });

    it('the read, load, import and not-accepted sentences all cut a long name the same way', () => {
      expect(fileReadFailureMessage(LONG)).toBe(`Failed to read file "${CUT}". The file may be corrupted or inaccessible.`);
      expect(textureLoadFailureMessage(LONG, new Error('x'))).toBe(`Could not load texture "${CUT}": x`);
      expect(assetImportFailureMessage(LONG, new Error('x'))).toBe(`Could not import "${CUT}": x`);
      expect(fileTypeNotAcceptedMessage(LONG)).toMatch(new RegExp(`^"${CUT}" was not imported: `));
    });

    it('and leave a short name untouched', () => {
      expect(fileReadFailureMessage('stone.png')).toContain('"stone.png"');
      expect(textureLoadFailureMessage('stone.png', new Error('x'))).toContain('"stone.png"');
      expect(assetImportFailureMessage('stone.png', new Error('x'))).toContain('"stone.png"');
      expect(fileTypeNotAcceptedMessage('photo.webp')).toContain('"photo.webp"');
    });
  });

  it('the read-failure sentence has one definition in web/src: no component or reader copies it', () => {
    // `fileToDataUrl` in AssetPanel used to hand-write the same sentence and
    // show it itself, so a caller reporting per file reported twice. This
    // walks the production sources (tests may quote the sentence to pin it)
    // and fails on any second copy - and on an empty walk, which would be a
    // pass that inspected nothing.
    const SENTENCE = 'The file may be corrupted or inaccessible.';
    const SRC = join(__dirname, '..', '..', '..');
    const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => !p.split(sep).includes('__tests__'));
    expect(sources.length).toBeGreaterThan(100);
    const holders = sources.filter((p) => readFileSync(join(SRC, p), 'utf8').includes(SENTENCE));
    expect(holders).toEqual([join('lib', 'engine', 'textureFormatGuard.ts')]);
    const occurrences = readFileSync(join(SRC, holders[0]!), 'utf8').split(SENTENCE).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('checkTexturePayload refuses what it cannot read, and echoes safely', () => {
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

  it('types a raw body by the same two prefixes, and refuses the rest in the same sentence', () => {
    // The Rust side writes this refusal with `f.write_str(RAW_BASE64_REFUSAL)`,
    // not `write!`, so the pin above does not see it; this one reads the
    // constant itself and checks the Display arm writes that constant rather
    // than a second copy of the words.
    const png = source.match(/^const RAW_PNG_BASE64_PREFIX: &str = "([^"]+)";/m);
    const jpeg = source.match(/^const RAW_JPEG_BASE64_PREFIX: &str = "([^"]+)";/m);
    const refusal = source.match(/^pub const RAW_BASE64_REFUSAL: &str =\s*"([^"]+)";/m);
    expect(png, 'the Rust PNG prefix must be where this test reads it').not.toBeNull();
    expect(jpeg, 'the Rust JPEG prefix must be where this test reads it').not.toBeNull();
    expect(refusal, 'the Rust refusal sentence must be where this test reads it').not.toBeNull();
    expect(source).toMatch(/RawBase64NeitherPngNorJpeg => f\.write_str\(RAW_BASE64_REFUSAL\)/);
    expect(RAW_BASE64_REFUSAL).toBe(refusal![1]);

    // Exactly the Rust prefix is accepted (so the TS prefix is no longer than
    // it), and one character short of it is refused (so it is no shorter).
    expect(checkTexturePayload(png![1])).toEqual({ ok: true, mimeType: 'image/png', base64: png![1] });
    expect(checkTexturePayload(jpeg![1])).toEqual({ ok: true, mimeType: 'image/jpeg', base64: jpeg![1] });
    expect(checkTexturePayload(png![1].slice(0, -1))).toEqual({ ok: false, error: refusal![1] });
    expect(checkTexturePayload(jpeg![1].slice(0, -1))).toEqual({ ok: false, error: refusal![1] });
  });
});

const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The wire names a payload struct in `core/commands/scene.rs` reads: its
 * fields camelCased (as `#[serde(rename_all = "camelCase")]` reads them) and
 * its `#[serde(alias)]`es.
 */
function rustPayloadShape(struct: string): { fields: string[]; aliases: string[] } {
  const source = rustSource(join('core', 'commands', 'scene.rs'));
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

describe('the MCP manifest names exactly the fields the engine reads', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..', '..');
  const COPIES = [
    'mcp-server/manifest/commands.json',
    'web/src/data/commands.json',
    'apps/docs/data/commands.json',
  ];

  interface ManifestCommand {
    name: string;
    parameters: { properties: Record<string, unknown>; required?: string[] };
  }

  function manifestCommand(name: string): ManifestCommand {
    const manifest = JSON.parse(readFileSync(join(ROOT, COPIES[0]), 'utf8')) as { commands: ManifestCommand[] };
    const entry = manifest.commands.find((c) => c.name === name);
    expect(entry, `${name} must be in the manifest`).toBeDefined();
    return entry!;
  }

  it('the three manifest copies are byte-identical', () => {
    const [canonical, ...others] = COPIES.map((p) => readFileSync(join(ROOT, p), 'utf8'));
    expect(canonical.length).toBeGreaterThan(0);
    for (const other of others) expect(other).toBe(canonical);
  });

  it.each([
    ['load_texture', 'LoadTexturePayload'],
    ['import_gltf', 'ImportGltfPayload'],
  ])('every %s parameter is a field %s reads, and the body is dataBase64', (command, struct) => {
    const { properties, required } = manifestCommand(command).parameters;
    const names = Object.keys(properties);
    expect(names.length).toBeGreaterThan(0);
    const { fields } = rustPayloadShape(struct);
    for (const name of names) expect(fields, `${command}.${name}`).toContain(name);
    for (const name of required ?? []) expect(names, `required ${name}`).toContain(name);
    expect(names).toContain('dataBase64');
  });
});

describe('the load_texture wire shape matches engine/src/core/commands/scene.rs', () => {
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
