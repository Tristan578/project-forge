#![cfg(test)]
//! Pins that every texture format `core::asset_import_guard` allowlists has a
//! decoder compiled into this build, and that the two `Image::from_buffer`
//! dispatches the editor uses - `ImageType::MimeType` in `apply_texture_load`
//! and `ImageType::Extension("png")` in the custom-skybox path
//! (`bridge/material.rs`) - really decode a PNG and a JPEG.
//!
//! Until #10397 `engine/Cargo.toml` enabled no `bevy_image` decoder feature
//! but `ktx2`, so `ImageFormat::from_mime_type("image/png")` was `None` and
//! every texture upload and every custom PNG skybox failed with
//! `InvalidImageMimeType`, with nothing but a log line to show for it. An
//! allowlist that names a format the build cannot decode is a lie; this file
//! is what makes that lie fail a build.
//!
//! Separate from `asset_import_guard.rs` because that file is `#[path]`-
//! included by a std-only probe crate, and these tests need `bevy::image`.
//! The bridge drains themselves are wasm32-only and cannot run here; what
//! this file proves is the decode each of them performs, with the exact
//! `ImageType` each passes.

use base64::Engine as _;
use bevy::asset::RenderAssetUsages;
use bevy::image::{CompressedImageFormats, Image, ImageFormat, ImageSampler, ImageType, TextureError};

use super::asset_import_guard::{check_texture_payload, ALLOWED_TEXTURE_MIME_TYPES};

/// A 1x1 RGBA8 PNG (signature, IHDR, IDAT, IEND; CRCs verified).
const PNG_1X1_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// A 1x1 RGB baseline JPEG (pixel 200,30,30), encoded by the `image` crate
/// and decoded back through zune-jpeg, the decoder `bevy_image`'s `jpeg`
/// feature compiles in.
const JPEG_1X1_BASE64: &str = concat!(
    "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAABAAEDAREAAhEBAxEB/9sAQwADAgIDAgIDAwMDBAMD",
    "BAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwED",
    "BAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU",
    "FBQUFBQU/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA",
    "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3",
    "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm",
    "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA",
    "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx",
    "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK",
    "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3",
    "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwKvzI",
    "/uM//9k=",
);

/// Every MIME type `bevy_image::ImageFormat::from_mime_type` knows, except
/// `image/ktx2`, which is the deliberate exception tested on its own.
const BEVY_KNOWN_MIME_TYPES: &[&str] = &[
    "image/basis",
    "image/x-basis",
    "image/bmp",
    "image/x-bmp",
    "image/vnd-ms.dds",
    "image/vnd.radiance",
    "image/gif",
    "image/x-icon",
    "image/jpeg",
    "image/png",
    "image/qoi",
    "image/x-qoi",
    "image/x-exr",
    "image/x-portable-bitmap",
    "image/x-portable-graymap",
    "image/x-portable-pixmap",
    "image/x-portable-anymap",
    "image/x-targa",
    "image/x-tga",
    "image/tiff",
    "image/webp",
];

fn decode_base64(encoded: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("fixture base64")
}

/// `Image::from_buffer` exactly as `apply_texture_load` and the custom-skybox
/// drain call it, minus the sRGB flag they vary.
fn from_buffer(bytes: &[u8], image_type: ImageType<'_>) -> Result<Image, TextureError> {
    Image::from_buffer(
        bytes,
        image_type,
        CompressedImageFormats::NONE,
        true,
        ImageSampler::Default,
        RenderAssetUsages::RENDER_WORLD,
    )
}

#[test]
fn every_allowlisted_mime_type_has_a_decoder_compiled_in() {
    for mime_type in ALLOWED_TEXTURE_MIME_TYPES {
        assert!(
            ImageFormat::from_mime_type(mime_type).is_some(),
            "{mime_type} is allowlisted in core::asset_import_guard but no decoder is compiled \
             in: enable the matching bevy feature in engine/Cargo.toml"
        );
    }
}

#[test]
fn the_allowlist_and_the_build_agree_on_every_other_format() {
    // A decoder is compiled in exactly when the allowlist names the format.
    // Enabling `webp` (say) without allowlisting it, or allowlisting a format
    // without its feature, fails here and forces the decision to be made.
    for mime_type in BEVY_KNOWN_MIME_TYPES {
        assert_eq!(
            ImageFormat::from_mime_type(mime_type).is_some(),
            ALLOWED_TEXTURE_MIME_TYPES.contains(mime_type),
            "{mime_type}: decoder compiled in and allowlist entry must agree"
        );
    }
}

#[test]
fn ktx2_still_decodes_on_this_build_and_is_refused_by_the_gate() {
    // The gate exists because this is `Some`: the decoder stays compiled in
    // for tonemapping_luts, so reachability is what the allowlist controls.
    assert!(ImageFormat::from_mime_type("image/ktx2").is_some());
    assert!(!ALLOWED_TEXTURE_MIME_TYPES.contains(&"image/ktx2"));
    assert!(check_texture_payload("data:image/ktx2;base64,q0tUWCAyMLsNChoK").is_err());
}

#[test]
fn png_and_jpeg_decode_through_the_mime_path_load_texture_uses() {
    for (data_url, expected_bytes) in [
        (format!("data:image/png;base64,{PNG_1X1_BASE64}"), decode_base64(PNG_1X1_BASE64)),
        (format!("data:image/jpeg;base64,{JPEG_1X1_BASE64}"), decode_base64(JPEG_1X1_BASE64)),
    ] {
        let source = check_texture_payload(&data_url).expect("allowlisted");
        assert_eq!(decode_base64(source.base64), expected_bytes);
        let image = from_buffer(&expected_bytes, ImageType::MimeType(source.mime_type))
            .unwrap_or_else(|err| panic!("{} did not decode: {err:?}", source.mime_type));
        assert_eq!((image.width(), image.height()), (1, 1), "{}", source.mime_type);
    }
}

#[test]
fn png_decodes_through_the_extension_path_the_custom_skybox_uses() {
    // `bridge/material.rs` hands a generated skybox to
    // `ImageType::Extension("png")`; before #10397 that was
    // `InvalidImageExtension` on every custom skybox.
    let image = from_buffer(&decode_base64(PNG_1X1_BASE64), ImageType::Extension("png"))
        .unwrap_or_else(|err| panic!("png extension path did not decode: {err:?}"));
    assert_eq!((image.width(), image.height()), (1, 1));
}

#[test]
fn a_jpeg_declared_as_png_fails_in_the_png_decoder_not_elsewhere() {
    // The declared type IS the dispatch: mislabelled bytes go to the decoder
    // the label names and fail there. This is why a raw base64 body can be
    // decoded as PNG unconditionally - the bytes never choose the decoder.
    let err = from_buffer(&decode_base64(JPEG_1X1_BASE64), ImageType::MimeType("image/png"))
        .expect_err("JPEG bytes are not a PNG");
    assert!(matches!(err, TextureError::ImageError(_)), "{err:?}");
}
