//! Format gates for the two editor import paths that let the caller choose the
//! image decoder: `load_texture` (the data-URL MIME type) and `import_gltf`
//! (each glTF image's `mimeType`, or its `uri`).
//!
//! `bevy_image` picks a decoder from the declared type, and its KTX2 path
//! decompresses supercompressed levels with `ruzstd` 0.8.2, which carries
//! RUSTSEC-2026-0344: a small zstd input can make it allocate without bound.
//! `ruzstd` cannot be upgraded while `bevy_image` 0.19 pins `^0.8`, and the
//! renderer's `tonemapping_luts` need the KTX2+zstd features, so the decoder
//! stays compiled in and must simply never be reachable from a file a person
//! imports. Neither path crosses a user boundary — a scene file stores asset
//! metadata, not bytes, and both drains are editor-only — so the exposure is
//! that a crafted import can exhaust the importing tab's memory (#10396).
//!
//! Two gates, both pure, and both run twice: once in the command handler,
//! where a refusal becomes the typed error the caller sees, and again in the
//! bridge drain that owns the bytes, so a future producer that reaches the
//! queue by another route does not get past it.
//!
//! - [`check_texture_payload`] is an allowlist. Only the formats this build has
//!   a decoder for ([`ALLOWED_TEXTURE_MIME_TYPES`]) are accepted; everything
//!   else is refused by name. A raw base64 body with no `data:` header is
//!   typed by its signature bytes (PNG or JPEG) and refused otherwise.
//!   `asset_import_guard_decoder_tests.rs` pins that every entry really has a
//!   decoder compiled in.
//! - [`inspect_gltf_base64`] / [`inspect_gltf_bytes`] is a denylist over the
//!   fields `bevy_gltf::loader::load_image` dispatches on: `images[].mimeType`
//!   for buffer-view and data-URI images, the data URI's own type when
//!   `mimeType` is absent, and the file extension of a path. A document that
//!   cannot be read is refused rather than passed on.
//!
//! `web/src/lib/engine/textureFormatGuard.ts` carries the texture allowlist on
//! the editor side so a refusal reaches a picker or the chat tool before the
//! command is built; its test pins the two lists together.
//!
//! [`gltf_memory_extension`] is the third pure helper here: the extension the
//! glTF drain stores a payload under, decided without regard to case.
//!
//! Dependency-free beyond serde/serde_json/base64 on purpose: a probe crate can
//! `#[path]`-include this file and run its tests natively on a machine where
//! the full engine does not link. The tests live in
//! `asset_import_guard_tests.rs`, declared below with a relative `#[path]` so
//! the probe finds them next to this file.

use std::collections::BTreeMap;
use std::fmt;

use base64::Engine as _;
use serde::Deserialize;

/// The texture formats `load_texture` accepts, by canonical MIME type.
///
/// These are exactly the `bevy_image` features `engine/Cargo.toml` enables for
/// the editor (`png`, `jpeg`); the decoder test file next to this module fails
/// if an entry here has no decoder compiled in. `image/jpg`, which browsers
/// never emit but some tools do, is accepted and canonicalised to `image/jpeg`.
pub const ALLOWED_TEXTURE_MIME_TYPES: &[&str] = &["image/png", "image/jpeg"];

/// Declared type (lower-cased) to the canonical MIME type it stands for.
const ACCEPTED_DECLARATIONS: &[(&str, &'static str)] = &[
    ("image/png", "image/png"),
    ("image/jpeg", "image/jpeg"),
    ("image/jpg", "image/jpeg"),
];

/// The first 11 base64 characters of every PNG: the 8-byte signature
/// `89 50 4E 47 0D 0A 1A 0A` plus the high byte of the IHDR chunk length,
/// which is always zero. A raw base64 body (no `data:` header) starting with
/// this is typed `image/png`.
const RAW_PNG_BASE64_PREFIX: &str = "iVBORw0KGgo";

/// The first 4 base64 characters of every JPEG: the SOI marker and the first
/// byte of the marker that follows it, `FF D8 FF`. A raw base64 body starting
/// with this is typed `image/jpeg`.
const RAW_JPEG_BASE64_PREFIX: &str = "/9j/";

/// The refusal for a raw base64 body that starts with neither prefix. Shared
/// verbatim with `web/src/lib/engine/textureFormatGuard.ts`, whose test pins
/// the literal, so a person sees one sentence whichever side refused.
pub const RAW_BASE64_REFUSAL: &str =
    "raw base64 texture data is neither PNG nor JPEG; send a data URL that names image/png or image/jpeg";

/// Maximum byte length of a glTF base64 payload (~50 MB decoded, 1.33x overhead).
pub const MAX_GLTF_BASE64_LEN: usize = 67_500_000;
/// Maximum byte length of a texture base64 payload (~50 MB decoded, 1.33x overhead).
pub const MAX_TEXTURE_BASE64_LEN: usize = 67_500_000;

/// How many characters of a declared type a refusal echoes back.
const ECHO_LIMIT: usize = 48;

// ---------------------------------------------------------------------------
// load_texture
// ---------------------------------------------------------------------------

/// A texture payload that passed the allowlist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextureSource<'a> {
    /// The canonical type to hand to `ImageType::MimeType`; always one of
    /// [`ALLOWED_TEXTURE_MIME_TYPES`].
    pub mime_type: &'static str,
    /// The base64 body with any data-URL header removed.
    pub base64: &'a str,
}

/// Why a texture payload was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TextureRefusal {
    /// No bytes at all, or a data URL with nothing after the comma.
    Empty,
    /// A `data:` URL with no `,` — nothing after the header to decode.
    MalformedDataUrl,
    /// A `data:` URL whose header does not say `;base64`.
    NotBase64,
    /// No usable type at all: an empty declaration (`data:;base64,`) or the
    /// generic `application/octet-stream` a browser gives a file it cannot
    /// classify. Named separately because "unsupported texture format ''"
    /// reads as a bug rather than as a file nobody could identify.
    UnrecognisedType,
    /// A declared type outside the allowlist. Carries a bounded, printable
    /// copy of the declaration so the message can name it safely.
    UnsupportedFormat(String),
    /// A raw base64 body (no `data:` header) whose first bytes are neither a
    /// PNG signature nor a JPEG SOI marker. Until #10396 such a body was
    /// decoded as PNG unconditionally, so a raw JPEG from an MCP client was
    /// accepted here and failed in the drain with nothing but a log line.
    RawBase64NeitherPngNorJpeg,
}

impl fmt::Display for TextureRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TextureRefusal::Empty => write!(f, "texture data is empty"),
            TextureRefusal::MalformedDataUrl => {
                write!(f, "data URL has no ',' between its header and its payload")
            }
            TextureRefusal::NotBase64 => {
                write!(f, "data URL must be base64-encoded (data:<type>;base64,...)")
            }
            TextureRefusal::UnrecognisedType => write!(
                f,
                "unrecognised file type; accepted formats are {}",
                ALLOWED_TEXTURE_MIME_TYPES.join(", ")
            ),
            TextureRefusal::UnsupportedFormat(declared) => write!(
                f,
                "unsupported texture format '{}'; accepted formats are {}",
                declared,
                ALLOWED_TEXTURE_MIME_TYPES.join(", ")
            ),
            TextureRefusal::RawBase64NeitherPngNorJpeg => f.write_str(RAW_BASE64_REFUSAL),
        }
    }
}

/// Check a `load_texture` payload against the allowlist.
///
/// Accepts either a data URL (`data:<type>[;params];base64,<body>`) whose type
/// is in [`ALLOWED_TEXTURE_MIME_TYPES`] (or `image/jpg`), compared without
/// regard to case or parameters, or a raw base64 body, which is typed by its
/// first bytes: a PNG signature is `image/png`, a JPEG SOI marker is
/// `image/jpeg`, and anything else is refused with [`RAW_BASE64_REFUSAL`].
/// Returns the canonical type and the body to decode.
pub fn check_texture_payload(data: &str) -> Result<TextureSource<'_>, TextureRefusal> {
    if data.is_empty() {
        return Err(TextureRefusal::Empty);
    }
    // No header: a raw base64 body carries no declared type, so its own first
    // bytes choose between the two decoders this build has, and nothing else
    // gets a decoder at all. Neither dispatch can reach the KTX2 decoder.
    let Some(rest) = strip_prefix_ignore_ascii_case(data, "data:") else {
        return sniff_raw_base64(data);
    };
    let Some(comma) = rest.find(',') else {
        return Err(TextureRefusal::MalformedDataUrl);
    };
    let header = &rest[..comma];
    let body = &rest[comma + 1..];

    let mut parts = header.split(';');
    let declared = parts.next().unwrap_or("").trim();
    let lowered = declared.to_ascii_lowercase();
    if lowered.is_empty() || lowered == "application/octet-stream" {
        return Err(TextureRefusal::UnrecognisedType);
    }
    let Some((_, mime_type)) = ACCEPTED_DECLARATIONS.iter().find(|(d, _)| *d == lowered) else {
        return Err(TextureRefusal::UnsupportedFormat(bounded_echo(declared)));
    };
    if !parts.any(|param| param.trim().eq_ignore_ascii_case("base64")) {
        return Err(TextureRefusal::NotBase64);
    }
    if body.is_empty() {
        return Err(TextureRefusal::Empty);
    }
    Ok(TextureSource { mime_type, base64: body })
}

/// Type a raw base64 body by the signature its first characters encode.
///
/// Base64 is case-sensitive and position-aligned, so the comparison is exact:
/// `IVBORW0KGGO` decodes to different bytes and is not a PNG.
fn sniff_raw_base64(data: &str) -> Result<TextureSource<'_>, TextureRefusal> {
    let mime_type = if data.starts_with(RAW_PNG_BASE64_PREFIX) {
        "image/png"
    } else if data.starts_with(RAW_JPEG_BASE64_PREFIX) {
        "image/jpeg"
    } else {
        return Err(TextureRefusal::RawBase64NeitherPngNorJpeg);
    };
    Ok(TextureSource { mime_type, base64: data })
}

/// `str::strip_prefix` without regard to ASCII case.
fn strip_prefix_ignore_ascii_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// A printable, bounded copy of a declared type for an error message.
fn bounded_echo(declared: &str) -> String {
    let mut out: String = declared
        .chars()
        .take(ECHO_LIMIT)
        .map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '?' })
        .collect();
    if declared.chars().count() > ECHO_LIMIT {
        out.push_str("...");
    }
    out
}

// ---------------------------------------------------------------------------
// import_gltf
// ---------------------------------------------------------------------------

/// Why a glTF/GLB document was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GltfRefusal {
    /// Not a GLB or glTF document this gate can read. The reason is fixed
    /// text, never file content.
    Malformed(&'static str),
    /// `images[index]` would be handed to the KTX2 decoder, declared through
    /// its `mimeType`, a data URI's own type, or a `.ktx2` file extension.
    Ktx2Image { index: usize, declared_by: &'static str },
    /// The document uses `KHR_texture_basisu`.
    BasisUniversal,
}

impl fmt::Display for GltfRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GltfRefusal::Malformed(reason) => write!(f, "not a readable glTF/GLB file ({reason})"),
            GltfRefusal::Ktx2Image { index, declared_by } => write!(
                f,
                "image #{index} is a KTX2 texture (declared by its {declared_by}); KTX2 textures \
                 are not supported, convert the model's textures to PNG or JPEG and import again"
            ),
            GltfRefusal::BasisUniversal => write!(
                f,
                "the model uses KHR_texture_basisu (Basis Universal textures), which is not \
                 supported; convert the model's textures to PNG or JPEG and import again"
            ),
        }
    }
}

const GLB_MAGIC: &[u8; 4] = b"glTF";
const GLB_CHUNK_JSON: &[u8; 4] = b"JSON";
/// Magic, version, total length (12 bytes) plus the first chunk's length and type.
const GLB_PREAMBLE_LEN: usize = 20;

/// The base64 body of an `import_gltf` payload: everything after the first
/// `,` when there is one (a `data:model/gltf-binary;base64,` header), else the
/// whole string. Mirrors what the drain decodes, so both gates read the same
/// bytes.
pub fn gltf_payload_base64(data: &str) -> &str {
    match data.find(',') {
        Some(comma) => &data[comma + 1..],
        None => data,
    }
}

/// The material texture slots `load_texture` can fill, named as `MaterialData`
/// names them. `apply_texture_load` assigns exactly these (pinned by
/// `apply_texture_load_assigns_exactly_the_material_slots_the_guard_admits`).
pub const MATERIAL_TEXTURE_SLOTS: [&str; 9] = [
    "base_color",
    "normal_map",
    "metallic_roughness",
    "emissive",
    "occlusion",
    "depth_map",
    "clearcoat",
    "clearcoat_roughness",
    "clearcoat_normal",
];

/// The component a `load_texture` slot writes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureSlotOwner {
    /// `sprite`: a 2D sprite's `SpriteData.texture_asset_id`.
    Sprite,
    /// One of [`MATERIAL_TEXTURE_SLOTS`] on a 3D entity's `MaterialData`.
    Material,
}

/// The owner of `slot`, or `None` for a slot no component has. Checked by
/// `apply_texture_load` before anything is decoded or registered, so a
/// texture whose target cannot take it changes nothing and leaves no asset
/// behind (#10399).
pub fn texture_slot_owner(slot: &str) -> Option<TextureSlotOwner> {
    if slot == "sprite" {
        Some(TextureSlotOwner::Sprite)
    } else if MATERIAL_TEXTURE_SLOTS.contains(&slot) {
        Some(TextureSlotOwner::Material)
    } else {
        None
    }
}

/// The extension the drain stores an `import_gltf` payload under in the
/// in-memory asset source, which is what tells `bevy_gltf` whether to parse
/// JSON (`gltf`) or a binary container (`glb`).
///
/// Only a final `.gltf`, in any case, is JSON; every other name - `.glb`,
/// `.GLB`, no extension, `model.gltf.bak` - is stored as GLB. Case-insensitive
/// because a picked or dropped `MODEL.GLTF` used to be stored as `.glb`, and
/// Bevy cannot parse JSON at a `.glb` path (#10396).
pub fn gltf_memory_extension(name: &str) -> &'static str {
    let ends_with_gltf = name
        .get(name.len().saturating_sub(".gltf".len())..)
        .is_some_and(|tail| tail.eq_ignore_ascii_case(".gltf"));
    if ends_with_gltf { "gltf" } else { "glb" }
}

/// Inspect an `import_gltf` payload without decoding more of it than needed.
///
/// A GLB is sniffed from its first 12 bytes; then only the preamble and the
/// JSON chunk are decoded, so a 50 MB model costs a JSON parse here, not a
/// second full base64 decode. A `.gltf` (JSON) document is decoded whole.
pub fn inspect_gltf_base64(data: &str) -> Result<(), GltfRefusal> {
    const UNDECODABLE: GltfRefusal = GltfRefusal::Malformed("base64 could not be decoded");
    let body = gltf_payload_base64(data);
    let engine = &base64::engine::general_purpose::STANDARD;

    // 16 characters decode to the 12-byte GLB header.
    let head = engine.decode(prefix(body, 16)).map_err(|_| UNDECODABLE)?;
    if head.len() < 12 || &head[..4] != GLB_MAGIC {
        // JSON glTF (or something else entirely): the document is the JSON.
        let bytes = engine.decode(body).map_err(|_| UNDECODABLE)?;
        return inspect_gltf_bytes(&bytes);
    }

    // 28 characters decode to 21 bytes: the preamble plus one.
    let preamble = engine.decode(prefix(body, 28)).map_err(|_| UNDECODABLE)?;
    if preamble.len() < GLB_PREAMBLE_LEN {
        return Err(GltfRefusal::Malformed("GLB header is truncated"));
    }
    let chunk_len = u32::from_le_bytes([preamble[12], preamble[13], preamble[14], preamble[15]]);
    // The shortest prefix that holds the whole JSON chunk; the BIN chunk
    // after it is never decoded. A claim longer than the body just means
    // the whole body, and the byte-level checks then refuse it as truncated.
    let needed_chars = glb_json_prefix_chars(chunk_len);
    let take = if needed_chars >= body.len() as u64 { body.len() } else { needed_chars as usize };
    let bytes = engine.decode(prefix(body, take)).map_err(|_| UNDECODABLE)?;
    inspect_gltf_bytes(&bytes)
}

/// How many base64 characters hold a GLB's preamble plus a JSON chunk of
/// `chunk_len` bytes: every 4 characters decode to 3 bytes.
///
/// Computed in u64 on purpose. `chunk_len` is whatever the file claims, and
/// for anything above ~1 GiB the answer exceeds u32::MAX, so on wasm32 the
/// usize arithmetic this replaced overflowed - a panic in a debug build, a
/// wrap in release - before the length could be compared with the body.
fn glb_json_prefix_chars(chunk_len: u32) -> u64 {
    let needed = GLB_PREAMBLE_LEN as u64 + u64::from(chunk_len);
    needed.div_ceil(3) * 4
}

/// Inspect decoded glTF bytes: a GLB (preamble + JSON chunk, possibly
/// truncated after the JSON chunk) or a JSON glTF document.
pub fn inspect_gltf_bytes(bytes: &[u8]) -> Result<(), GltfRefusal> {
    if bytes.len() < 4 || &bytes[..4] != GLB_MAGIC {
        return inspect_gltf_json(bytes);
    }
    if bytes.len() < GLB_PREAMBLE_LEN {
        return Err(GltfRefusal::Malformed("GLB header is truncated"));
    }
    let u32_at = |at: usize| u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    if u32_at(4) != 2 {
        return Err(GltfRefusal::Malformed("GLB version is not 2"));
    }
    if &bytes[16..20] != GLB_CHUNK_JSON {
        return Err(GltfRefusal::Malformed("first GLB chunk is not JSON"));
    }
    let declared_total = u32_at(8) as usize;
    let chunk_len = u32_at(12) as usize;
    if chunk_len > declared_total.saturating_sub(GLB_PREAMBLE_LEN) {
        return Err(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"));
    }
    // Cannot overflow after the check above (chunk_len <= u32::MAX - 20), but
    // stated rather than relied on.
    let end = GLB_PREAMBLE_LEN
        .checked_add(chunk_len)
        .ok_or(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))?;
    if bytes.len() < end {
        return Err(GltfRefusal::Malformed("GLB JSON chunk is truncated"));
    }
    inspect_gltf_json(&bytes[GLB_PREAMBLE_LEN..end])
}

/// The first `n` bytes of `s`, or all of it when shorter or when `n` is not
/// a char boundary (base64 is ASCII; anything else fails to decode anyway).
fn prefix(s: &str, n: usize) -> &str {
    s.get(..n).unwrap_or(s)
}

/// Only the fields the decoder choice depends on; everything else is skipped.
#[derive(Deserialize, Default)]
#[serde(default)]
struct GltfProbe {
    images: Vec<GltfImageProbe>,
    textures: Vec<GltfTextureProbe>,
    #[serde(rename = "extensionsUsed")]
    extensions_used: Vec<String>,
    #[serde(rename = "extensionsRequired")]
    extensions_required: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GltfImageProbe {
    uri: Option<String>,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GltfTextureProbe {
    extensions: BTreeMap<String, serde::de::IgnoredAny>,
}

fn inspect_gltf_json(json: &[u8]) -> Result<(), GltfRefusal> {
    // serde derives a struct from a JSON array positionally, so `[]` would
    // read as a document with no images. A glTF document is an object.
    let first = json.iter().find(|byte| !byte.is_ascii_whitespace());
    if first != Some(&b'{') {
        return Err(GltfRefusal::Malformed("glTF JSON is not an object"));
    }
    let probe: GltfProbe = serde_json::from_slice(json)
        .map_err(|_| GltfRefusal::Malformed("glTF JSON could not be parsed"))?;

    for (index, image) in probe.images.iter().enumerate() {
        if let Some(declared) = &image.mime_type {
            if mime_base(declared) == "image/ktx2" {
                return Err(GltfRefusal::Ktx2Image { index, declared_by: "mimeType" });
            }
        }
        if let Some(uri) = &image.uri {
            let uri = percent_decode(uri);
            let lower = uri.trim().to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("data:") {
                let header = &rest[..rest.find(',').unwrap_or(rest.len())];
                if mime_base(header) == "image/ktx2" {
                    return Err(GltfRefusal::Ktx2Image { index, declared_by: "data URI type" });
                }
            } else {
                let path = lower.split(['?', '#']).next().unwrap_or("");
                if path.ends_with(".ktx2") {
                    return Err(GltfRefusal::Ktx2Image { index, declared_by: "file extension" });
                }
            }
        }
    }

    let is_basisu = |name: &str| name.trim().eq_ignore_ascii_case("KHR_texture_basisu");
    if probe
        .extensions_used
        .iter()
        .chain(&probe.extensions_required)
        .any(|name| is_basisu(name))
    {
        return Err(GltfRefusal::BasisUniversal);
    }
    if probe
        .textures
        .iter()
        .any(|texture| texture.extensions.keys().any(|key| is_basisu(key)))
    {
        return Err(GltfRefusal::BasisUniversal);
    }
    Ok(())
}

/// The type part of a MIME declaration: before any `;` parameter, trimmed,
/// lower-cased. `from_mime_type` lower-cases too, so a case variant reaches
/// the same decoder.
fn mime_base(declared: &str) -> String {
    declared
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

/// `%XX` escapes decoded, lossily. `bevy_gltf` percent-decodes a `uri` before
/// dispatching on it, so a `.ktx2` spelled `%2Ektx2` is still a `.ktx2`.
fn percent_decode(uri: &str) -> String {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }
    let bytes = uri.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((high << 4) | low);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// The tests and their fixtures, in a sibling file (this one is capped at 800
// lines by the arch validator). The `#[path]` is RELATIVE on purpose: the
// probe crate includes this file by absolute path, and a relative path here is
// what makes it find the tests next to it.
#[cfg(test)]
#[path = "asset_import_guard_tests.rs"]
mod tests;

/// Hand-built glTF documents for the command-handler tests in
/// `core/commands/scene.rs`, re-exported so they keep importing
/// `asset_import_guard::fixtures` now that the tests live in their own file.
/// Unused in the probe crate, which compiles this file without `commands/`.
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use tests::fixtures;

