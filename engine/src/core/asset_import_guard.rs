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
//!   else is refused by name. `asset_import_guard_decoder_tests.rs` pins that
//!   every entry really has a decoder compiled in.
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
//! Dependency-free beyond serde/serde_json/base64 on purpose: a probe crate can
//! `#[path]`-include this file and run its tests natively on a machine where
//! the full engine does not link.

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

/// The type a raw base64 body (no `data:` header) is decoded as.
///
/// Keeps the behaviour the pickers relied on before they sent a data URL; it
/// is safe because a fixed PNG dispatch can never reach the KTX2 decoder.
const RAW_BASE64_MIME_TYPE: &str = "image/png";

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
    /// A declared type outside the allowlist. Carries a bounded, printable
    /// copy of the declaration so the message can name it safely.
    UnsupportedFormat(String),
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
            TextureRefusal::UnsupportedFormat(declared) => write!(
                f,
                "unsupported texture format '{}'; accepted formats are {}",
                declared,
                ALLOWED_TEXTURE_MIME_TYPES.join(", ")
            ),
        }
    }
}

/// Check a `load_texture` payload against the allowlist.
///
/// Accepts either a data URL (`data:<type>[;params];base64,<body>`) whose type
/// is in [`ALLOWED_TEXTURE_MIME_TYPES`] (or `image/jpg`), compared without
/// regard to case or parameters, or a raw base64 body, which is decoded as
/// PNG. Returns the canonical type and the body to decode.
pub fn check_texture_payload(data: &str) -> Result<TextureSource<'_>, TextureRefusal> {
    if data.is_empty() {
        return Err(TextureRefusal::Empty);
    }
    // No header: a raw base64 body carries no type to check and is decoded as
    // PNG, a fixed dispatch that can never reach the KTX2 decoder.
    let Some(rest) = strip_prefix_ignore_ascii_case(data, "data:") else {
        return Ok(TextureSource { mime_type: RAW_BASE64_MIME_TYPE, base64: data });
    };
    let Some(comma) = rest.find(',') else {
        return Err(TextureRefusal::MalformedDataUrl);
    };
    let header = &rest[..comma];
    let body = &rest[comma + 1..];

    let mut parts = header.split(';');
    let declared = parts.next().unwrap_or("").trim();
    let lowered = declared.to_ascii_lowercase();
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
    let chunk_len =
        u32::from_le_bytes([preamble[12], preamble[13], preamble[14], preamble[15]]) as usize;
    let needed = GLB_PREAMBLE_LEN
        .checked_add(chunk_len)
        .ok_or(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))?;
    // Every 4 characters decode to 3 bytes, so this is the shortest prefix
    // that holds the whole JSON chunk; the BIN chunk after it is never decoded.
    let needed_chars = needed.div_ceil(3) * 4;
    let bytes = engine.decode(prefix(body, needed_chars)).map_err(|_| UNDECODABLE)?;
    inspect_gltf_bytes(&bytes)
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
    let end = GLB_PREAMBLE_LEN + chunk_len;
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

#[cfg(test)]
mod tests {
    use super::*;

    const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

    // --- load_texture ------------------------------------------------------

    #[test]
    fn raw_base64_is_decoded_as_png() {
        let source = check_texture_payload("iVBORw0KGgo=").unwrap();
        assert_eq!(source.mime_type, "image/png");
        assert_eq!(source.base64, "iVBORw0KGgo=");
    }

    #[test]
    fn png_and_jpeg_data_urls_are_accepted_with_their_header_removed() {
        let png = check_texture_payload("data:image/png;base64,AAAA").unwrap();
        assert_eq!(png, TextureSource { mime_type: "image/png", base64: "AAAA" });
        let jpeg = check_texture_payload("data:image/jpeg;base64,BBBB").unwrap();
        assert_eq!(jpeg, TextureSource { mime_type: "image/jpeg", base64: "BBBB" });
    }

    #[test]
    fn image_jpg_is_canonicalised_to_image_jpeg() {
        let source = check_texture_payload("data:image/jpg;base64,AAAA").unwrap();
        assert_eq!(source.mime_type, "image/jpeg");
    }

    #[test]
    fn case_and_parameter_variants_reach_the_same_decoder() {
        let source = check_texture_payload("DATA:Image/PNG;charset=utf-8;BASE64,AAAA").unwrap();
        assert_eq!(source, TextureSource { mime_type: "image/png", base64: "AAAA" });
        let source = check_texture_payload("data:image/jpeg ; q=1;base64,AAAA").unwrap();
        assert_eq!(source.mime_type, "image/jpeg");
    }

    #[test]
    fn ktx2_is_refused_by_name_with_the_accepted_formats_listed() {
        let err = check_texture_payload("data:image/ktx2;base64,q0tUWCAyMLsNChoK").unwrap_err();
        assert_eq!(err, TextureRefusal::UnsupportedFormat("image/ktx2".to_string()));
        let message = err.to_string();
        assert!(message.contains("image/ktx2"), "{message}");
        assert!(message.contains("image/png"), "{message}");
        assert!(message.contains("image/jpeg"), "{message}");
    }

    #[test]
    fn ktx2_case_and_parameter_variants_are_refused_too() {
        for declared in ["IMAGE/KTX2", "image/ktx2;q=1", " image/ktx2 "] {
            let data = format!("data:{declared};base64,AAAA");
            assert!(
                matches!(check_texture_payload(&data), Err(TextureRefusal::UnsupportedFormat(_))),
                "{declared} must be refused"
            );
        }
    }

    #[test]
    fn dds_and_webp_are_refused() {
        for declared in ["image/x-dds", "image/vnd-ms.dds", "image/webp", "application/octet-stream"] {
            let data = format!("data:{declared};base64,AAAA");
            assert_eq!(
                check_texture_payload(&data),
                Err(TextureRefusal::UnsupportedFormat(declared.to_string())),
            );
        }
    }

    #[test]
    fn a_data_url_that_is_not_base64_is_refused() {
        assert_eq!(
            check_texture_payload("data:image/png,%89PNG"),
            Err(TextureRefusal::NotBase64)
        );
    }

    #[test]
    fn a_data_url_without_a_comma_is_refused() {
        assert_eq!(
            check_texture_payload("data:image/png;base64"),
            Err(TextureRefusal::MalformedDataUrl)
        );
    }

    #[test]
    fn empty_payloads_are_refused() {
        assert_eq!(check_texture_payload(""), Err(TextureRefusal::Empty));
        assert_eq!(check_texture_payload("data:image/png;base64,"), Err(TextureRefusal::Empty));
    }

    #[test]
    fn a_refusal_echoes_a_bounded_printable_copy_of_the_declaration() {
        let declared = format!("image/{}\u{7}\n{}", "x".repeat(60), "y".repeat(60));
        let err = check_texture_payload(&format!("data:{declared};base64,AAAA")).unwrap_err();
        let TextureRefusal::UnsupportedFormat(echoed) = err else { panic!("{err:?}") };
        assert!(echoed.ends_with("..."), "{echoed}");
        assert!(echoed.chars().count() <= ECHO_LIMIT + 3, "{echoed}");
        assert!(echoed.chars().all(|c| c.is_ascii_graphic() || c == ' ' || c == '.'), "{echoed}");
    }

    #[test]
    fn the_accepted_declarations_and_the_allowlist_name_the_same_formats() {
        for (_, canonical) in ACCEPTED_DECLARATIONS {
            assert!(ALLOWED_TEXTURE_MIME_TYPES.contains(canonical), "{canonical}");
        }
        for allowed in ALLOWED_TEXTURE_MIME_TYPES {
            assert!(
                ACCEPTED_DECLARATIONS.iter().any(|(_, canonical)| canonical == allowed),
                "{allowed} is allowlisted but no declaration maps to it"
            );
            assert!(!allowed.contains("ktx2"));
        }
        assert_eq!(RAW_BASE64_MIME_TYPE, "image/png");
    }

    // --- import_gltf -------------------------------------------------------

    /// A minimal GLB: 12-byte header, then one JSON chunk (space-padded to a
    /// multiple of four, as the spec requires), then `extra` appended verbatim.
    fn build_glb(json: &str, extra: &[u8]) -> Vec<u8> {
        let mut chunk = json.as_bytes().to_vec();
        while chunk.len() % 4 != 0 {
            chunk.push(b' ');
        }
        let total = (GLB_PREAMBLE_LEN + chunk.len() + extra.len()) as u32;
        let mut glb = Vec::new();
        glb.extend_from_slice(GLB_MAGIC);
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&total.to_le_bytes());
        glb.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        glb.extend_from_slice(GLB_CHUNK_JSON);
        glb.extend_from_slice(&chunk);
        glb.extend_from_slice(extra);
        glb
    }

    const PNG_IMAGE: &str =
        r#"{"asset":{"version":"2.0"},"images":[{"mimeType":"image/png","bufferView":0}]}"#;

    #[test]
    fn a_glb_with_a_png_image_is_accepted() {
        assert_eq!(inspect_gltf_bytes(&build_glb(PNG_IMAGE, b"BIN!")), Ok(()));
        let b64 = B64.encode(build_glb(PNG_IMAGE, b""));
        assert_eq!(inspect_gltf_base64(&b64), Ok(()));
        assert_eq!(inspect_gltf_base64(&format!("data:model/gltf-binary;base64,{b64}")), Ok(()));
    }

    #[test]
    fn a_glb_declaring_a_ktx2_image_is_refused_with_its_index() {
        let json = r#"{"asset":{"version":"2.0"},"images":[{"mimeType":"image/png","bufferView":0},{"mimeType":"image/ktx2","bufferView":1}]}"#;
        assert_eq!(
            inspect_gltf_bytes(&build_glb(json, b"")),
            Err(GltfRefusal::Ktx2Image { index: 1, declared_by: "mimeType" })
        );
        let b64 = B64.encode(build_glb(json, b""));
        assert!(inspect_gltf_base64(&b64).is_err());
    }

    #[test]
    fn mime_type_case_and_parameter_variants_are_refused() {
        for declared in ["IMAGE/KTX2", "image/ktx2; q=1", " image/ktx2"] {
            let json = format!(r#"{{"images":[{{"mimeType":"{declared}","bufferView":0}}]}}"#);
            assert!(inspect_gltf_json(json.as_bytes()).is_err(), "{declared}");
        }
    }

    #[test]
    fn a_ktx2_uri_is_refused_however_it_is_spelled() {
        for uri in ["textures/a.ktx2", "A.KTX2", "a.ktx2?v=1", "a.ktx2#frag", "a%2Ektx2", " a.ktx2 "] {
            let json = format!(r#"{{"images":[{{"uri":"{uri}"}}]}}"#);
            assert_eq!(
                inspect_gltf_json(json.as_bytes()),
                Err(GltfRefusal::Ktx2Image { index: 0, declared_by: "file extension" }),
                "{uri}"
            );
        }
    }

    #[test]
    fn a_ktx2_data_uri_is_refused_even_without_a_mime_type() {
        let json = r#"{"images":[{"uri":"data:image/ktx2;base64,q0tUWCAyMLsNChoK"}]}"#;
        assert_eq!(
            inspect_gltf_json(json.as_bytes()),
            Err(GltfRefusal::Ktx2Image { index: 0, declared_by: "data URI type" })
        );
        let json = r#"{"images":[{"uri":"DATA:IMAGE/KTX2,plain"}]}"#;
        assert!(inspect_gltf_json(json.as_bytes()).is_err());
    }

    #[test]
    fn png_and_jpeg_uris_and_data_uris_are_accepted() {
        let json = r#"{"images":[{"uri":"a.png"},{"uri":"b.JPG?x=1"},{"uri":"data:image/jpeg;base64,AAAA"},{"uri":"ktx2.png"}]}"#;
        assert_eq!(inspect_gltf_json(json.as_bytes()), Ok(()));
    }

    #[test]
    fn basis_universal_is_refused_wherever_it_is_declared() {
        for json in [
            r#"{"extensionsUsed":["KHR_texture_basisu"]}"#,
            r#"{"extensionsRequired":["khr_texture_basisu"]}"#,
            r#"{"textures":[{"source":0,"extensions":{"KHR_texture_basisu":{"source":1}}}]}"#,
        ] {
            assert_eq!(inspect_gltf_json(json.as_bytes()), Err(GltfRefusal::BasisUniversal), "{json}");
        }
        let json = r#"{"extensionsUsed":["KHR_materials_unlit"],"textures":[{"source":0,"extensions":{"KHR_texture_transform":{}}}]}"#;
        assert_eq!(inspect_gltf_json(json.as_bytes()), Ok(()));
    }

    #[test]
    fn a_glb_whose_header_is_malformed_is_refused() {
        // Truncated preamble.
        assert_eq!(
            inspect_gltf_bytes(b"glTF\x02\x00\x00\x00\x14\x00\x00\x00"),
            Err(GltfRefusal::Malformed("GLB header is truncated"))
        );
        // Version 1.
        let mut glb = build_glb(PNG_IMAGE, b"");
        glb[4] = 1;
        assert_eq!(inspect_gltf_bytes(&glb), Err(GltfRefusal::Malformed("GLB version is not 2")));
        // First chunk is BIN, not JSON.
        let mut glb = build_glb(PNG_IMAGE, b"");
        glb[16..20].copy_from_slice(b"BIN\0");
        assert_eq!(
            inspect_gltf_bytes(&glb),
            Err(GltfRefusal::Malformed("first GLB chunk is not JSON"))
        );
        // Chunk longer than the file claims to be.
        let mut glb = build_glb(PNG_IMAGE, b"");
        glb[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            inspect_gltf_bytes(&glb),
            Err(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))
        );
        // Chunk cut short.
        let glb = build_glb(PNG_IMAGE, b"");
        assert_eq!(
            inspect_gltf_bytes(&glb[..glb.len() - 8]),
            Err(GltfRefusal::Malformed("GLB JSON chunk is truncated"))
        );
    }

    #[test]
    fn bytes_that_are_neither_glb_nor_json_are_refused() {
        assert_eq!(
            inspect_gltf_bytes(b"Hello"),
            Err(GltfRefusal::Malformed("glTF JSON is not an object"))
        );
        // serde would read `[]` as a struct with every field defaulted.
        assert_eq!(
            inspect_gltf_bytes(b"  []"),
            Err(GltfRefusal::Malformed("glTF JSON is not an object"))
        );
        assert_eq!(
            inspect_gltf_bytes(b"{\"images\":[42]}"),
            Err(GltfRefusal::Malformed("glTF JSON could not be parsed"))
        );
        assert_eq!(
            inspect_gltf_bytes(b"{\"images\":"),
            Err(GltfRefusal::Malformed("glTF JSON could not be parsed"))
        );
        assert_eq!(inspect_gltf_base64("SGVsbG8="), Err(GltfRefusal::Malformed("glTF JSON is not an object")));
        assert_eq!(inspect_gltf_base64("not base64!"), Err(GltfRefusal::Malformed("base64 could not be decoded")));
    }

    #[test]
    fn a_json_gltf_document_is_inspected_whole() {
        let json = r#"{"asset":{"version":"2.0"},"images":[{"uri":"tex.ktx2"}]}"#;
        assert!(inspect_gltf_bytes(json.as_bytes()).is_err());
        assert!(inspect_gltf_base64(&B64.encode(json)).is_err());
        assert_eq!(inspect_gltf_base64(&B64.encode(PNG_IMAGE)), Ok(()));
    }

    #[test]
    fn a_glb_is_inspected_from_its_json_chunk_without_decoding_the_rest() {
        // The base64 of a GLB with a large BIN chunk, with garbage appended
        // where the BIN chunk's base64 would be: a full decode fails, the
        // prefix decode never reaches it.
        let glb = build_glb(PNG_IMAGE, &[0u8; 4096]);
        let mut b64 = B64.encode(&glb[..GLB_PREAMBLE_LEN + 88]);
        assert_eq!(b64.len() % 4, 0, "fixture must end on a base64 group");
        b64.push_str("!!!!");
        assert!(B64.decode(&b64).is_err(), "the fixture's tail must not decode");
        assert_eq!(inspect_gltf_base64(&b64), Ok(()));

        // The same header claiming a JSON chunk the payload does not contain
        // is a truncation, not an acceptance.
        let mut short = build_glb(PNG_IMAGE, b"");
        short[12..16].copy_from_slice(&(88u32 + 400).to_le_bytes());
        short[8..12].copy_from_slice(&(GLB_PREAMBLE_LEN as u32 + 88 + 400).to_le_bytes());
        assert_eq!(
            inspect_gltf_base64(&B64.encode(&short)),
            Err(GltfRefusal::Malformed("GLB JSON chunk is truncated"))
        );
    }

    #[test]
    fn the_payload_body_is_everything_after_the_first_comma() {
        assert_eq!(gltf_payload_base64("data:model/gltf-binary;base64,AAAA"), "AAAA");
        assert_eq!(gltf_payload_base64("AAAA"), "AAAA");
        assert_eq!(gltf_payload_base64("a,b,c"), "b,c");
    }

    #[test]
    fn refusal_messages_tell_the_person_what_to_do() {
        let ktx2 = GltfRefusal::Ktx2Image { index: 1, declared_by: "mimeType" }.to_string();
        assert!(ktx2.contains("image #1"), "{ktx2}");
        assert!(ktx2.contains("KTX2"), "{ktx2}");
        assert!(ktx2.contains("PNG or JPEG"), "{ktx2}");
        let basisu = GltfRefusal::BasisUniversal.to_string();
        assert!(basisu.contains("KHR_texture_basisu"), "{basisu}");
        assert!(basisu.contains("PNG or JPEG"), "{basisu}");
        let malformed = GltfRefusal::Malformed("GLB version is not 2").to_string();
        assert!(malformed.contains("GLB version is not 2"), "{malformed}");
    }

    #[test]
    fn percent_decoding_is_lossy_and_leaves_bad_escapes_alone() {
        assert_eq!(percent_decode("a%2Ektx2"), "a.ktx2");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%zz"), "a%zz");
        assert_eq!(percent_decode("%FF"), "\u{FFFD}");
    }
}
