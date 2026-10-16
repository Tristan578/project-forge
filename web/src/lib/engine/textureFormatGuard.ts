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

/** What a raw base64 body (no `data:` header) is decoded as; mirrors `RAW_BASE64_MIME_TYPE`. */
const RAW_BASE64_MIME_TYPE: AllowedTextureMimeType = 'image/png';

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
 * parameters, or a raw base64 body, which is decoded as PNG. The `error` of a
 * refusal is the engine's own wording, so a person sees the same sentence
 * whichever side refused.
 */
export function checkTexturePayload(data: string): TextureCheck {
  if (data === '') return refusal('texture data is empty');
  // No header: a raw base64 body carries no type to check and is decoded as
  // PNG, a fixed dispatch that can never reach the KTX2 decoder.
  if (data.slice(0, 5).toLowerCase() !== 'data:') {
    return { ok: true, mimeType: RAW_BASE64_MIME_TYPE, base64: data };
  }
  const rest = data.slice(5);
  const comma = rest.indexOf(',');
  if (comma === -1) return refusal("data URL has no ',' between its header and its payload");
  const header = rest.slice(0, comma);
  const body = rest.slice(comma + 1);

  const [declaredRaw = '', ...params] = header.split(';');
  const declared = declaredRaw.trim();
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

/** A printable, bounded copy of a declared type for an error message. */
function boundedEcho(declared: string): string {
  const chars = [...declared];
  const printable = chars
    .slice(0, ECHO_LIMIT)
    .map((c) => (/^[\x20-\x7e]$/.test(c) ? c : '?'))
    .join('');
  return chars.length > ECHO_LIMIT ? `${printable}...` : printable;
}
