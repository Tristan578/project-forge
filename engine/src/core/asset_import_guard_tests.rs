//! Tests for `asset_import_guard`, in a sibling file because the guard is
//! capped at 800 lines by the arch validator (rule 2) and its tests pushed it
//! to 937. The guard declares this module with a RELATIVE `#[path]`, which is
//! what lets the probe crate - it `#[path]`-includes the guard by absolute
//! path and runs these tests natively - find this file next to the guard.
//! `include_str!` below is relative to this file, so the file must stay in
//! `engine/src/core/`.

// Line-anchored, as in the other sibling test files (`component_carry_tests.rs`,
// `engine_mode_tests.rs`): the repo's source scanners treat everything after the
// first `#[cfg(test)]` line as test code (`core/pending/runtime_drains.rs`,
// `without_tests`). This module is test-only already - the guard declares it
// `#[cfg(test)]` - but a scanner reading this file alone cannot see that, and the
// source pins below quote the drains' own call text, which would otherwise read
// as this file draining a queue. Nothing above that line may quote it either.
#[cfg(test)]
use super::*;

/// Hand-built documents for these tests and for the command-handler tests in
/// `core/commands/scene.rs`, which reach them as `asset_import_guard::fixtures`
/// through the guard's re-export.
pub(crate) mod fixtures {
    use super::super::{GLB_CHUNK_JSON, GLB_MAGIC, GLB_PREAMBLE_LEN};

    /// A minimal GLB: 12-byte header, then one JSON chunk (space-padded to a
    /// multiple of four, as the spec requires), then `extra` appended verbatim.
    pub(crate) fn glb(json: &str, extra: &[u8]) -> Vec<u8> {
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
}

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

// --- load_texture ------------------------------------------------------

/// A 1x1 RGBA8 PNG, the same bytes the decoder tests decode.
const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

#[test]
fn a_raw_base64_body_starting_like_a_png_is_typed_image_png() {
    // The bare prefix, the padded 8-byte signature, and a whole file; the
    // body is handed on untouched, the guard types it and decodes nothing.
    for raw in ["iVBORw0KGgo", "iVBORw0KGgo=", PNG_1X1] {
        let source = check_texture_payload(raw).unwrap_or_else(|err| panic!("{raw}: {err}"));
        assert_eq!(source, TextureSource { mime_type: "image/png", base64: raw }, "{raw}");
    }
}

#[test]
fn a_raw_base64_body_starting_like_a_jpeg_is_typed_image_jpeg() {
    // Until #10396 every raw body was PNG, so a raw JPEG was accepted here
    // and failed in the PNG decoder with nothing but a log line.
    for raw in ["/9j/", "/9j/4AAQ", "/9j/4AAQSkZJRgABAQEASABIAAD/2wBD"] {
        let source = check_texture_payload(raw).unwrap_or_else(|err| panic!("{raw}: {err}"));
        assert_eq!(source, TextureSource { mime_type: "image/jpeg", base64: raw }, "{raw}");
    }
}

#[test]
fn a_raw_base64_body_that_is_neither_png_nor_jpeg_is_refused_with_the_shared_sentence() {
    // Base64 is case-sensitive and position-aligned, so a case variant, a
    // leading space and a prefix one character short are all "neither".
    for raw in [
        "AAAA",
        "q0tUWCAyMLsNChoK",
        "SGVsbG8=",
        "IVBORW0KGGO=",
        "iVBORw0KGg",
        " iVBORw0KGgo=",
        "/9j",
        "/9J/4AAQ",
    ] {
        assert_eq!(check_texture_payload(raw), Err(TextureRefusal::RawBase64NeitherPngNorJpeg), "{raw:?}");
    }
    // The literal, not the constant: `textureFormatGuard.ts` carries this
    // exact sentence and its test pins it the same way.
    assert_eq!(
        TextureRefusal::RawBase64NeitherPngNorJpeg.to_string(),
        "raw base64 texture data is neither PNG nor JPEG; send a data URL that names image/png or image/jpeg"
    );
    assert_eq!(RAW_BASE64_REFUSAL, TextureRefusal::RawBase64NeitherPngNorJpeg.to_string());
}

#[test]
fn the_raw_prefixes_are_the_base64_of_the_png_and_jpeg_signatures() {
    // 11 characters carry 66 bits: the 8 signature bytes and the top two
    // bits of the IHDR length's high byte, which are zero in every PNG, so
    // the padded prefix decodes exactly under the strict engine.
    assert_eq!(B64.decode(format!("{RAW_PNG_BASE64_PREFIX}=")).unwrap(), b"\x89PNG\r\n\x1a\n");
    assert_eq!(B64.decode(RAW_JPEG_BASE64_PREFIX).unwrap(), [0xFF, 0xD8, 0xFF]);
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
    for declared in ["image/x-dds", "image/vnd-ms.dds", "image/webp", "text/plain"] {
        let data = format!("data:{declared};base64,AAAA");
        assert_eq!(
            check_texture_payload(&data),
            Err(TextureRefusal::UnsupportedFormat(declared.to_string())),
        );
    }
}

#[test]
fn an_empty_or_generic_declared_type_is_refused_as_unrecognised() {
    // A browser gives a file it cannot classify no type at all, which a
    // data URL spells `data:;base64,` or `data:application/octet-stream;base64,`.
    // "unsupported texture format ''" would read as a bug; this names the
    // situation and the accepted formats.
    for data in [
        "data:;base64,AAAA",
        "data:application/octet-stream;base64,AAAA",
        "DATA:Application/Octet-Stream;charset=binary;base64,AAAA",
        "data: ;base64,AAAA",
    ] {
        assert_eq!(check_texture_payload(data), Err(TextureRefusal::UnrecognisedType), "{data}");
    }
    let message = TextureRefusal::UnrecognisedType.to_string();
    assert!(message.starts_with("unrecognised file type"), "{message}");
    assert!(message.contains("image/png, image/jpeg"), "{message}");
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
    // A raw body is typed by sniffing, and only ever to an allowlisted type.
    for raw in [RAW_PNG_BASE64_PREFIX, RAW_JPEG_BASE64_PREFIX] {
        let typed = check_texture_payload(raw).unwrap().mime_type;
        assert!(ALLOWED_TEXTURE_MIME_TYPES.contains(&typed), "{raw} -> {typed}");
    }
}

// --- import_gltf -------------------------------------------------------

use self::fixtures::glb;

const PNG_IMAGE: &str =
    r#"{"asset":{"version":"2.0"},"images":[{"mimeType":"image/png","bufferView":0}]}"#;

#[test]
fn a_glb_with_a_png_image_is_accepted() {
    assert_eq!(inspect_gltf_bytes(&glb(PNG_IMAGE, b"BIN!")), Ok(()));
    let b64 = B64.encode(glb(PNG_IMAGE, b""));
    assert_eq!(inspect_gltf_base64(&b64), Ok(()));
    assert_eq!(inspect_gltf_base64(&format!("data:model/gltf-binary;base64,{b64}")), Ok(()));
}

#[test]
fn a_glb_declaring_a_ktx2_image_is_refused_with_its_index() {
    let json = r#"{"asset":{"version":"2.0"},"images":[{"mimeType":"image/png","bufferView":0},{"mimeType":"image/ktx2","bufferView":1}]}"#;
    assert_eq!(
        inspect_gltf_bytes(&glb(json, b"")),
        Err(GltfRefusal::Ktx2Image { index: 1, declared_by: "mimeType" })
    );
    let b64 = B64.encode(glb(json, b""));
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
    let mut doc = glb(PNG_IMAGE, b"");
    doc[4] = 1;
    assert_eq!(inspect_gltf_bytes(&doc), Err(GltfRefusal::Malformed("GLB version is not 2")));
    // First chunk is BIN, not JSON.
    let mut doc = glb(PNG_IMAGE, b"");
    doc[16..20].copy_from_slice(b"BIN\0");
    assert_eq!(
        inspect_gltf_bytes(&doc),
        Err(GltfRefusal::Malformed("first GLB chunk is not JSON"))
    );
    // Chunk longer than the file claims to be.
    let mut doc = glb(PNG_IMAGE, b"");
    doc[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(
        inspect_gltf_bytes(&doc),
        Err(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))
    );
    // Chunk cut short.
    let doc = glb(PNG_IMAGE, b"");
    assert_eq!(
        inspect_gltf_bytes(&doc[..doc.len() - 8]),
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
    let doc = glb(PNG_IMAGE, &[0u8; 4096]);
    let mut b64 = B64.encode(&doc[..GLB_PREAMBLE_LEN + 88]);
    assert_eq!(b64.len() % 4, 0, "fixture must end on a base64 group");
    b64.push_str("!!!!");
    assert!(B64.decode(&b64).is_err(), "the fixture's tail must not decode");
    assert_eq!(inspect_gltf_base64(&b64), Ok(()));

    // The same header claiming a JSON chunk the payload does not contain
    // is a truncation, not an acceptance.
    let mut short = glb(PNG_IMAGE, b"");
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

// --- gltf_memory_extension --------------------------------------------

#[test]
fn a_final_gltf_extension_is_stored_as_json_in_any_case() {
    // `MODEL.GLTF` used to be stored as `.glb`, where bevy_gltf cannot parse
    // JSON (#10396).
    for name in ["model.gltf", "MODEL.GLTF", "Model.Gltf", ".gltf", "mod\u{e8}le.GLTF"] {
        assert_eq!(gltf_memory_extension(name), "gltf", "{name}");
    }
}

#[test]
fn every_other_name_is_stored_as_glb() {
    // `.glb` in any case, no extension, `gltf` with no dot, a `.gltf` that is
    // not the final extension, and a name whose last five bytes are not a
    // char boundary (`\u{e9}` is two bytes).
    for name in ["x.glb", "x.GLB", "glb", "gltf", "", "model.gltf.bak", "model.gltf ", "\u{e9}abcd"] {
        assert_eq!(gltf_memory_extension(name), "glb", "{name:?}");
    }
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

// --- prefix arithmetic that cannot overflow on wasm32 ----------------

/// A GLB preamble claiming `chunk_len` bytes of JSON in a file of
/// `declared_total` bytes, followed by `payload` - far fewer bytes.
fn glb_preamble(declared_total: u32, chunk_len: u32, payload: &[u8]) -> Vec<u8> {
    let mut glb = Vec::new();
    glb.extend_from_slice(GLB_MAGIC);
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&declared_total.to_le_bytes());
    glb.extend_from_slice(&chunk_len.to_le_bytes());
    glb.extend_from_slice(GLB_CHUNK_JSON);
    glb.extend_from_slice(payload);
    glb
}

#[test]
fn a_chunk_length_near_u32_max_fails_closed_through_the_base64_path() {
    // Pins two things: the helper's values at the u32 boundary (the
    // result exceeds u32::MAX, which is why it is a u64), and that such a
    // claim is refused rather than decoded. It is NOT a reproduction of
    // the wasm32 overflow the u64 arithmetic replaced: on this 64-bit host
    // the old usize arithmetic would have passed too, and no 32-bit target
    // is available to run it on.
    assert_eq!(glb_json_prefix_chars(u32::MAX - 8), 5_726_623_076);
    assert!(glb_json_prefix_chars(u32::MAX - 8) > u64::from(u32::MAX));
    assert_eq!(glb_json_prefix_chars(0), 28);

    // Claims the whole file is JSON: the preamble arithmetic runs, the
    // short payload is what gets decoded, and it is refused as truncated.
    let truncated = B64.encode(glb_preamble(u32::MAX, u32::MAX - 20, b"{}  "));
    assert_eq!(
        inspect_gltf_base64(&truncated),
        Err(GltfRefusal::Malformed("GLB JSON chunk is truncated"))
    );
    // Claims more JSON than the file says it holds.
    let longer = B64.encode(glb_preamble(u32::MAX, u32::MAX - 8, b"{}  "));
    assert_eq!(
        inspect_gltf_base64(&longer),
        Err(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))
    );
    assert_eq!(
        inspect_gltf_base64(&B64.encode(glb_preamble(u32::MAX, u32::MAX, b"{}  "))),
        Err(GltfRefusal::Malformed("GLB JSON chunk is longer than the file says it is"))
    );
}

// --- the bridge drains re-run both gates ------------------------------
//
// `bridge/` is wasm32-only, so the drains' re-checks never run under
// `cargo test`. What the pins below PROVE is textual: that the body of
// each drain function holds exactly one executable statement calling its
// gate. What they do not prove is that the statement runs or what it
// does; that is the decoder tests' and CI's wasm build's job.

const SCENE_IO: &str = include_str!("../bridge/scene_io.rs");

/// `source` with every `/* ... */` span removed (newlines inside a span
/// are kept, so line structure survives). A `//` line is handled by the
/// line scan, not here.
fn without_block_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(open) = rest.find("/*") {
        out.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        match after.find("*/") {
            Some(close) => {
                out.extend(after[..close].chars().filter(|c| *c == '\n'));
                rest = &after[close + 2..];
            }
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The body of a top-level `pub(super) fn <name>(` in `scene_io.rs`: from
/// its signature line to the first `}` at column 0 after it, with block
/// comments removed. Panics, naming the function, if either edge is gone.
fn drain_body(name: &str) -> String {
    let lines: Vec<&str> = SCENE_IO.lines().collect();
    let signature = format!("pub(super) fn {name}(");
    let start = lines
        .iter()
        .position(|line| line.trim_start().starts_with(&signature))
        .unwrap_or_else(|| panic!("scene_io.rs no longer declares `{signature}`"));
    let end = (start..lines.len())
        .find(|&i| lines[i] == "}")
        .unwrap_or_else(|| panic!("`{name}` has no closing brace at column 0"));
    without_block_comments(&lines[start..=end].join("\n"))
}

/// Executable lines of `body` that begin with `statement`: anchored to
/// the trimmed line start, `//` lines excluded (block comments were
/// removed by `drain_body`).
fn executable_lines_starting_with(body: &str, statement: &str) -> usize {
    body.lines()
        .map(str::trim_start)
        .filter(|line| !line.starts_with("//") && line.starts_with(statement))
        .count()
}

/// Occurrences of `needle` anywhere in the executable lines of `body`: `//`
/// lines excluded (block comments were removed by `drain_body`), several on
/// one line all counted. For a call that need not start its line.
fn executable_occurrences(body: &str, needle: &str) -> usize {
    body.lines()
        .map(str::trim_start)
        .filter(|line| !line.starts_with("//"))
        .map(|line| line.matches(needle).count())
        .sum()
}

#[test]
fn the_scan_ignores_line_and_block_comments_and_other_functions() {
    let body = without_block_comments(
        "    gate(1);\n    // gate(2);\n    /* gate(3);\n    gate(4); */ other(5);\n    other(6);\n",
    );
    assert_eq!(executable_lines_starting_with(&body, "gate("), 1, "only the live call counts");
    // Code after a closing `*/` on the same line is still executable.
    assert_eq!(executable_lines_starting_with(&body, "other("), 2);
    assert_eq!(body.lines().count(), 5, "newlines inside a block comment are kept");
    assert_eq!(executable_occurrences(&body, "gate("), 1, "the occurrence count skips comments too");
    assert_eq!(executable_occurrences("    x = f(a(1), a(2));\n    // a(3);\n", "a("), 2, "two on one line");
    assert!(drain_body("apply_gltf_import").contains("pending.gltf_import_requests.drain("));
    assert!(!drain_body("apply_gltf_import").contains("fn apply_texture_load("));
}

#[test]
fn apply_gltf_import_takes_the_memory_extension_from_the_guard_exactly_once() {
    let statement = "let ext = asset_import_guard::gltf_memory_extension(&request.name);";
    assert_eq!(
        executable_lines_starting_with(&drain_body("apply_gltf_import"), statement),
        1,
        "proven: the body of `apply_gltf_import` in bridge/scene_io.rs holds exactly one \
         executable line beginning `{statement}` (trimmed line start; `//` lines and block \
         comments excluded). Not proven: that it runs - bridge/ is wasm32-only; the helper's \
         own behaviour is pinned by the gltf_memory_extension tests above."
    );
}

#[test]
fn apply_texture_load_hands_the_sprite_slot_to_sprite_data_exactly_once() {
    // The Sprite inspector sends slot "sprite". Until this arm existed it fell
    // through to the unknown-slot warning, so an upload registered an asset
    // nothing displayed (#10396).
    let body = drain_body("apply_texture_load");
    assert_eq!(
        executable_lines_starting_with(&body, "\"sprite\" =>"),
        1,
        "proven: the body of `apply_texture_load` in bridge/scene_io.rs holds exactly one \
         executable match arm beginning `\"sprite\" =>` (trimmed line start; `//` lines and \
         block comments excluded). Not proven: that it runs, that it is the arm the inspector's \
         slot reaches, or that SpriteData is written - bridge/ is wasm32-only."
    );
    assert_eq!(
        executable_occurrences(&body, "emit_sprite_changed("),
        1,
        "proven: the executable lines of `apply_texture_load` contain exactly one \
         `emit_sprite_changed(` call. Not proven: that it runs or what it emits - bridge/ is \
         wasm32-only."
    );
}

#[test]
fn apply_gltf_import_re_inspects_the_decoded_document_exactly_once() {
    let statement = "if let Err(refusal) = asset_import_guard::inspect_gltf_bytes(&bytes)";
    assert_eq!(
        executable_lines_starting_with(&drain_body("apply_gltf_import"), statement),
        1,
        "proven: the body of `apply_gltf_import` in bridge/scene_io.rs holds exactly one \
         executable line beginning `{statement}` (trimmed line start; `//` lines and block \
         comments excluded). Not proven: that it runs - bridge/ is wasm32-only. A rustfmt \
         reflow of that statement onto several lines fails this loudly; keep it on one."
    );
}

#[test]
fn apply_texture_load_takes_its_mime_type_from_the_allowlist_exactly_once() {
    let statement =
        "let source = match asset_import_guard::check_texture_payload(&request.data_base64)";
    assert_eq!(
        executable_lines_starting_with(&drain_body("apply_texture_load"), statement),
        1,
        "proven: the body of `apply_texture_load` in bridge/scene_io.rs holds exactly one \
         executable line beginning `{statement}` (trimmed line start; `//` lines and block \
         comments excluded). Not proven: that it runs - bridge/ is wasm32-only. A rustfmt \
         reflow of that statement onto several lines fails this loudly; keep it on one."
    );
}
