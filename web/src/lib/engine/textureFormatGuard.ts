/**
 * The texture formats `load_texture` accepts, checked before the command is
 * built.
 *
 * The engine enforces the same allowlist in
 * `engine/src/core/asset_import_guard.rs` (`check_texture_payload`), in the
 * command handler and again in the drain, and that is the real gate: it
 * covers every caller, including an MCP client. This copy exists so a picker,
 * the chat tool and the generation poller can tell the person *why* a file
 * was refused - and which formats are accepted - without a round trip into
 * WASM, and so the chat tool never reports success for a texture the engine
 * will refuse.
 *
 * Why there is an allowlist at all: `bevy_image` picks a decoder from the
 * declared type, and its KTX2 path decompresses with `ruzstd` 0.8.2
 * (RUSTSEC-2026-0344), which cannot be upgraded while bevy pins it; a crafted
 * import can exhaust the importing tab's memory. Only the formats the engine
 * build compiles a decoder for are accepted; `__tests__/textureFormatGuard.test.ts`
 * pins this list, the accepted declarations and the refusal wording against
 * the Rust source rather than trusting them to stay in step.
 *
 * Kept free of any `@/stores` or `@/hooks` value-import: the slices import it.
 */

/** Canonical MIME types the engine decodes; mirrors `ALLOWED_TEXTURE_MIME_TYPES`. */
export const ALLOWED_TEXTURE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export type AllowedTextureMimeType = (typeof ALLOWED_TEXTURE_MIME_TYPES)[number];

/**
 * Declared type (lower-cased) to the canonical type it stands for; mirrors
 * `ACCEPTED_DECLARATIONS`. `image/jpg`, which browsers never emit but some
 * tools do, is accepted and canonicalised.
 */
export const ACCEPTED_TEXTURE_DECLARATIONS: ReadonlyArray<readonly [string, AllowedTextureMimeType]> = [
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
];

/**
 * The first 11 base64 characters of every PNG: the 8-byte signature
 * `89 50 4E 47 0D 0A 1A 0A` plus the high byte of the IHDR chunk length,
 * which is always zero. A raw base64 body (no `data:` header) starting with
 * this is typed `image/png`; mirrors `RAW_PNG_BASE64_PREFIX`.
 */
const RAW_PNG_BASE64_PREFIX = 'iVBORw0KGgo';

/**
 * The first 4 base64 characters of every JPEG: the SOI marker and the first
 * byte of the marker after it, `FF D8 FF`. A raw base64 body starting with
 * this is typed `image/jpeg`; mirrors `RAW_JPEG_BASE64_PREFIX`.
 */
const RAW_JPEG_BASE64_PREFIX = '/9j/';

/**
 * The refusal for a raw base64 body that starts with neither prefix. The
 * engine's `RAW_BASE64_REFUSAL` verbatim - the test pins the literal against
 * the Rust source - so a person sees one sentence whichever side refused.
 */
export const RAW_BASE64_REFUSAL =
  'raw base64 texture data is neither PNG nor JPEG; send a data URL that names image/png or image/jpeg';

/** How many characters of a declared type a refusal echoes back; mirrors `ECHO_LIMIT`. */
const ECHO_LIMIT = 48;

export type TextureCheck =
  | { ok: true; mimeType: AllowedTextureMimeType; base64: string }
  | { ok: false; error: string };

/**
 * Check a `load_texture` payload against the allowlist.
 *
 * Accepts a data URL (`data:<type>[;params];base64,<body>`) whose type is
 * allowlisted (or `image/jpg`), compared without regard to case or
 * parameters, or a raw base64 body, which is typed by its first bytes: a PNG
 * signature is `image/png`, a JPEG SOI marker is `image/jpeg`, and anything
 * else is refused with `RAW_BASE64_REFUSAL`. The `error` of a refusal is the
 * engine's own wording, so a person sees the same sentence whichever side
 * refused.
 */
export function checkTexturePayload(data: string): TextureCheck {
  if (data === '') return refusal('texture data is empty');
  // No header: a raw base64 body carries no declared type, so its own first
  // bytes choose between the two decoders the engine build has, and nothing
  // else gets a decoder at all. Neither dispatch can reach the KTX2 decoder.
  if (data.slice(0, 5).toLowerCase() !== 'data:') {
    return sniffRawBase64(data);
  }
  const rest = data.slice(5);
  const comma = rest.indexOf(',');
  if (comma === -1) return refusal("data URL has no ',' between its header and its payload");
  const header = rest.slice(0, comma);
  const body = rest.slice(comma + 1);

  const [declaredRaw = '', ...params] = header.split(';');
  const declared = declaredRaw.trim();
  if (isUndeclaredType(declared)) {
    // "unsupported texture format ''" would read as a bug; this names the
    // situation - a file nobody could identify - and what is accepted.
    return refusal(`unrecognised file type; accepted formats are ${ALLOWED_TEXTURE_MIME_TYPES.join(', ')}`);
  }
  const accepted = ACCEPTED_TEXTURE_DECLARATIONS.find(([d]) => d === declared.toLowerCase());
  if (!accepted) {
    return refusal(
      `unsupported texture format '${boundedEcho(declared)}'; accepted formats are ${ALLOWED_TEXTURE_MIME_TYPES.join(', ')}`,
    );
  }
  if (!params.some((param) => param.trim().toLowerCase() === 'base64')) {
    return refusal('data URL must be base64-encoded (data:<type>;base64,...)');
  }
  if (body === '') return refusal('texture data is empty');
  return { ok: true, mimeType: accepted[1], base64: body };
}

function refusal(error: string): TextureCheck {
  return { ok: false, error };
}

/**
 * Type a raw base64 body by the signature its first characters encode.
 *
 * Base64 is case-sensitive and position-aligned, so the comparison is exact:
 * `IVBORW0KGGO` decodes to different bytes and is not a PNG. Mirrors the
 * engine's `sniff_raw_base64`.
 */
function sniffRawBase64(data: string): TextureCheck {
  if (data.startsWith(RAW_PNG_BASE64_PREFIX)) return { ok: true, mimeType: 'image/png', base64: data };
  if (data.startsWith(RAW_JPEG_BASE64_PREFIX)) return { ok: true, mimeType: 'image/jpeg', base64: data };
  return refusal(RAW_BASE64_REFUSAL);
}

/** The bytes every PNG starts with: `89 50 4E 47` (the signature's first four). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47] as const;

/** The bytes every JPEG starts with: the SOI marker `FF D8` and the `FF` of the marker after it. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/**
 * The accepted texture type `bytes` begin with, or null when they begin
 * with neither signature (a WebP, a truncated file, nothing at all).
 *
 * For a fetched blob whose server gave it no usable Content-Type: the
 * FileReader writes that absence into the data URL header, and the gate then
 * refuses a correctly generated PNG as unrecognised. The caller declares the
 * sniffed type on the data URL (`declareTextureType`) and leaves an
 * unsniffable blob alone, so the gate still refuses what nobody can identify.
 */
export function sniffImageMimeType(bytes: Uint8Array): AllowedTextureMimeType | null {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return null;
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

/** A printable, bounded copy of a declared type for an error message. */
function boundedEcho(declared: string): string {
  const chars = [...declared];
  const printable = chars
    .slice(0, ECHO_LIMIT)
    .map((c) => (/^[\x20-\x7e]$/.test(c) ? c : '?'))
    .join('');
  return chars.length > ECHO_LIMIT ? `${printable}...` : printable;
}

/**
 * No usable type: an empty declaration, or the generic
 * `application/octet-stream` a browser gives a file it cannot classify.
 * Mirrors the engine's `UnrecognisedType`.
 */
function isUndeclaredType(declared: string): boolean {
  const lowered = declared.trim().toLowerCase();
  return lowered === '' || lowered === 'application/octet-stream';
}

/**
 * The types a picker may derive from a file's extension when the OS gave it
 * none - `File.type` is empty on a machine with no MIME mapping for `.png`.
 * Only the accepted formats are listed: an unknown extension stays undeclared
 * and the guard refuses it as unrecognised rather than guessing.
 */
const EXTENSION_MIME_TYPES: ReadonlyMap<string, AllowedTextureMimeType> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
]);

/** The type a picked file should declare: `File.type`, or one derived from its extension when that is empty. */
export function textureMimeTypeForFile(type: string, name: string): string {
  const declared = type.trim().toLowerCase();
  if (!isUndeclaredType(declared)) return declared;
  const dot = name.lastIndexOf('.');
  if (dot === -1) return '';
  return EXTENSION_MIME_TYPES.get(name.slice(dot + 1).toLowerCase()) ?? '';
}

/**
 * A data URL whose header declares `mimeType` when it declared nothing
 * usable. A header that already names a type - right or wrong - is kept, so
 * the browser's own classification is never second-guessed; a raw body is
 * returned as is.
 */
export function declareTextureType(dataUrl: string, mimeType: string): string {
  if (mimeType === '' || dataUrl.slice(0, 5).toLowerCase() !== 'data:') return dataUrl;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl;
  const [declaredRaw = '', ...params] = dataUrl.slice(5, comma).split(';');
  if (!isUndeclaredType(declaredRaw)) return dataUrl;
  const rest = params.length > 0 ? `;${params.join(';')}` : '';
  return `data:${mimeType}${rest}${dataUrl.slice(comma)}`;
}

/**
 * `dataUrl` with its header naming `mimeType`, whatever it named before;
 * parameters such as `;base64` are kept, and a raw body or a header with no
 * `,` is returned as is. For a caller whose evidence is the bytes' own
 * signature (`sniffImageMimeType`, used by the generation poller): the bytes
 * outrank whatever Content-Type the storage served, because the engine picks
 * its decoder from this header. A picker uses `declareTextureType`, which
 * never overrides a type the browser declared.
 */
export function replaceDataUrlType(dataUrl: string, mimeType: string): string {
  if (mimeType === '' || dataUrl.slice(0, 5).toLowerCase() !== 'data:') return dataUrl;
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl;
  const [, ...params] = dataUrl.slice(5, comma).split(';');
  const rest = params.length > 0 ? `;${params.join(';')}` : '';
  return `data:${mimeType}${rest}${dataUrl.slice(comma)}`;
}

/** The longest file name shown in a refusal toast before it is cut. */
const MAX_DISPLAY_NAME = 60;

/**
 * `name` cut to `MAX_DISPLAY_NAME` characters with an ellipsis, so a long
 * file name cannot swamp a toast. The ONE bound for every sentence that
 * embeds a file name - the slice's refusal and the three below - so they
 * cannot drift apart; a name under the limit is returned as is.
 */
export function boundDisplayName(name: string): string {
  const chars = [...name];
  return chars.length > MAX_DISPLAY_NAME ? `${chars.slice(0, MAX_DISPLAY_NAME).join('')}…` : name;
}

/**
 * What a picker or drop zone tells the person when the browser could not
 * read a file at all, before any question of format. It applies to a model
 * or an audio file as much as to a texture, so it is the ONE definition of
 * the sentence: a caller reports it, it never shows a toast itself, and no
 * reader copies the wording.
 */
export function fileReadFailureMessage(name: string): string {
  return `Failed to read file "${boundDisplayName(name)}". The file may be corrupted or inaccessible.`;
}

/**
 * What a picker tells the person when the store's `loadTexture` THREW - a
 * failure after the file was read, distinct from an unreadable file. The
 * action normally answers with a result rather than throwing, so this is the
 * message for the case nothing else names.
 */
export function textureLoadFailureMessage(name: string, error: unknown): string {
  return `Could not load texture "${boundDisplayName(name)}": ${errorDetail(error)}`;
}

/**
 * The same for the store's `importGltf` or `importAudio`: a throw while the
 * editor hands a read file to the engine, named as an import failure rather
 * than left as an unhandled rejection that tells the person nothing.
 */
export function assetImportFailureMessage(name: string, error: unknown): string {
  return `Could not import "${boundDisplayName(name)}": ${errorDetail(error)}`;
}

/**
 * What the editor shows when the engine accepted a texture and then could
 * not apply it (`TEXTURE_LOAD_ERROR`, #10399): the image did not decode, or
 * the entity has no sprite or material for the slot. `load_texture` answers
 * when the request is queued, so this arrives a frame later. The engine's
 * reason is bounded like every other detail.
 */
export function textureApplyFailureMessage(name: string, reason: string): string {
  return `Texture "${boundDisplayName(name)}" was not applied: ${errorDetail(reason)}`;
}

/**
 * What the drop zone tells the person about a file whose extension names no
 * type the editor imports - a `.webp`, a `.psd`, a `.txt`. Such a file used
 * to be filtered out of a drop without a word, so a drop of nothing but a
 * `.webp` did nothing and said nothing. Reported through the batch's
 * reporter like a read failure, so it counts against the toast cap.
 */
export function fileTypeNotAcceptedMessage(name: string): string {
  return `"${boundDisplayName(name)}" was not imported: the editor accepts PNG and JPEG textures, GLB and glTF models, and MP3, OGG, WAV and FLAC audio.`;
}

/**
 * What the texture picker and the drop zone tell the person about a texture
 * when no entity is selected. `load_texture` applies an image to a slot on an
 * entity, so with nothing selected the texture has nowhere to go; it used to
 * be skipped without a word while the drop's progress bar counted it.
 */
export function textureNeedsTargetMessage(name: string): string {
  return `"${boundDisplayName(name)}" was not imported: select an entity to apply the texture to, then import it again.`;
}

/**
 * The longest thrown-error detail a transient toast carries. The file name
 * is bounded above and the engine's relayed refusal reason is truncated by
 * the slice; a store action's message is bounded here for the same reason,
 * so one unexpectedly long throw cannot swamp a four-second toast.
 */
export const MAX_ERROR_DETAIL = 200;

function errorDetail(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const chars = [...detail];
  return chars.length > MAX_ERROR_DETAIL ? `${chars.slice(0, MAX_ERROR_DETAIL).join('')}…` : detail;
}

/**
 * Read a picked texture file as a data URL, header included - the header is
 * how the engine learns the format - with the type filled in from the
 * extension when the OS declared none. Rejects when the FileReader fails;
 * the caller shows `fileReadFailureMessage` for that.
 */
export function readTextureFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(declareTextureType(reader.result as string, textureMimeTypeForFile(file.type, file.name)));
    reader.onerror = () => reject(new Error(`FileReader error for "${file.name}"`));
    reader.readAsDataURL(file);
  });
}
