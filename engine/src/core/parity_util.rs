//! Shared primitives for the engine's source-parity gates.
//!
//! `component_carry_tests` and `entity_factory_parity_tests` both slice
//! production source pulled in with `include_str!` and then count identifier
//! mentions inside the slice. A mention inside a comment is not a read, and
//! treating it as one fails in the FALSE-PASS direction — a commented-out
//! carry line
//!
//! ```text
//! // entry.lod_data = ld.cloned();
//! ```
//!
//! kept every parity test green while the field was no longer carried at all.
//!
//! The strip has to happen in BOTH gates, so it lives here rather than being
//! copied into each. A drifted copy would reopen the hole in exactly one of
//! them, which is the class of failure these gates exist to catch.

/// Blank out every comment in `src`, preserving byte length and line breaks.
///
/// Length preservation keeps offsets aligned with the original, and keeping
/// newlines means line-oriented parsing ([`fields_of`]) sees the same line
/// structure it always did.
///
/// String literals are recognised and their CONTENTS blanked, delimiters kept.
/// Recognising them is what stops `"https://example.com"` from being read as
/// the start of a comment; blanking the contents closes the same false-pass
/// hole comments open, since `let _ = "entry.lod_data";` is exactly as easy to
/// write as a commented-out carry line. Raw strings (`r"…"`, `r#"…"#`) are
/// handled the same way. A `{` inside either must not be counted as a brace by
/// [`block_of`].
///
/// A marker that lives inside a string literal is therefore never found, which
/// fails closed: [`block_of`] asserts on the occurrence count.
///
/// `'` is deliberately NOT treated as a delimiter: in Rust it opens a lifetime
/// (`&'static str`) far more often than a char literal, so pairing quotes on it
/// would desynchronise the scanner and start skipping real comments — the
/// false-pass direction again. The cost is that a `'/'` char literal is not
/// recognised, which cannot produce a `//` on its own.
pub fn strip_comments(src: &str) -> String {
    let b = src.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0usize;

    while i < b.len() {
        // Raw string: `r`, then zero or more `#`, then `"`. Only when the `r`
        // does not continue an identifier, or an `r` inside a name would open a
        // phantom raw string.
        if b[i] == b'r' && (i == 0 || !is_ident_byte(b[i - 1])) {
            let mut j = i + 1;
            while j < b.len() && b[j] == b'#' {
                j += 1;
            }
            if j < b.len() && b[j] == b'"' {
                let hashes = j - i - 1;
                let end = find_raw_end(b, j + 1, hashes);
                // Keep the `r##"` opener and the `"##` closer, blank the body.
                let close = end - 1 - hashes;
                out.extend_from_slice(&b[i..=j]);
                blank(&mut out, &b[j + 1..close]);
                out.extend_from_slice(&b[close..end]);
                i = end;
                continue;
            }
        }

        match b[i] {
            b'"' => {
                let end = find_string_end(b, i + 1);
                // Keep both quotes, blank what is between them.
                out.push(b'"');
                blank(&mut out, &b[i + 1..end - 1]);
                out.push(b[end - 1]);
                i = end;
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'/' => {
                let end = b[i..]
                    .iter()
                    .position(|&c| c == b'\n')
                    .map_or(b.len(), |p| i + p);
                blank(&mut out, &b[i..end]);
                i = end;
            }
            b'/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                let end = find_block_comment_end(b, i + 2);
                blank(&mut out, &b[i..end]);
                i = end;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }

    String::from_utf8(out).expect("stripping only ever blanks whole comment regions")
}

/// Push `region` as spaces, keeping its newlines so line numbers do not shift.
fn blank(out: &mut Vec<u8>, region: &[u8]) {
    for &c in region {
        out.push(if c == b'\n' { b'\n' } else { b' ' });
    }
}

fn is_ident_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// Index just past the closing quote of a normal string opened before `from`.
fn find_string_end(b: &[u8], from: usize) -> usize {
    let mut i = from;
    while i < b.len() {
        match b[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    b.len()
}

/// Index just past the terminator of a raw string opened before `from`.
fn find_raw_end(b: &[u8], from: usize, hashes: usize) -> usize {
    let mut i = from;
    while i < b.len() {
        if b[i] == b'"'
            && b[i + 1..].iter().take(hashes).filter(|&&c| c == b'#').count() == hashes
        {
            return i + 1 + hashes;
        }
        i += 1;
    }
    b.len()
}

/// Index just past the `*/` of a block comment opened before `from`.
///
/// Rust block comments nest, so this counts depth rather than stopping at the
/// first `*/`.
fn find_block_comment_end(b: &[u8], from: usize) -> usize {
    let mut i = from;
    let mut depth = 1usize;
    while i + 1 < b.len() {
        if b[i] == b'/' && b[i + 1] == b'*' {
            depth += 1;
            i += 2;
        } else if b[i] == b'*' && b[i + 1] == b'/' {
            depth -= 1;
            i += 2;
            if depth == 0 {
                return i;
            }
        } else {
            i += 1;
        }
    }
    b.len()
}

/// Slice the brace-balanced block introduced by `marker`, comments removed.
///
/// The marker must be UNIQUE in the comment-stripped source. Both halves of
/// that matter: an ambiguous marker picks the wrong block, and a line-based
/// terminator (the original `\n}` search) overshoots a nested item. Comments
/// are stripped BEFORE the brace walk so a `{` written inside one cannot
/// unbalance the count.
pub fn block_of(source: &str, marker: &str) -> String {
    let stripped = strip_comments(source);
    let hits = stripped.matches(marker).count();
    assert_eq!(
        hits, 1,
        "parity marker `{marker}` occurs {hits} times — a marker that is not \
         unique cannot identify a block"
    );
    let start = stripped.find(marker).unwrap();
    let rest = &stripped[start..];
    let open = rest
        .find('{')
        .unwrap_or_else(|| panic!("stale parity marker: no opening brace after {marker}"));
    let bytes = rest.as_bytes();
    let mut depth = 0usize;
    for (i, c) in bytes.iter().enumerate().skip(open) {
        match c {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return rest[..=i].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("stale parity marker: unbalanced braces after {marker}");
}

/// Names from `fields` mentioned as `<prefix><name>` inside `block`.
///
/// `block` is expected to have come from [`block_of`], i.e. to be
/// comment-free. Returned in first-seen order, deduplicated.
pub fn names_in(block: &str, prefix: &str, fields: &[String]) -> Vec<String> {
    let mut used: Vec<String> = Vec::new();
    for (idx, _) in block.match_indices(prefix) {
        let tail = &block[idx + prefix.len()..];
        let name: String = tail
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if fields.contains(&name) && !used.contains(&name) {
            used.push(name);
        }
    }
    used
}

/// Field names declared inside the brace-balanced block at `marker`.
pub fn fields_of(source: &str, marker: &str) -> Vec<String> {
    block_of(source, marker)
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (name, _) = line.trim().split_once(':')?;
            let name = name.trim().strip_prefix("pub ")?.trim();
            if name.is_empty()
                || !name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            {
                return None;
            }
            Some(name.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    /// The exact hole the round-2 board found: a carry line that is present as
    /// text but commented out must not score as a read.
    #[test]
    fn a_commented_out_carry_line_is_not_a_read() {
        let src = "\
fn build() {
    entry.audio_data = ad.cloned();
    // entry.lod_data = ld.cloned();
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(
            used,
            vec!["audio_data".to_string()],
            "a commented-out assignment must not count as carrying the field"
        );
    }

    #[test]
    fn a_block_commented_carry_line_is_not_a_read() {
        let src = "\
fn build() {
    entry.audio_data = ad.cloned();
    /* entry.lod_data = ld.cloned(); */
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(used, vec!["audio_data".to_string()]);
    }

    #[test]
    fn a_brace_inside_a_comment_does_not_unbalance_the_block() {
        let src = "\
fn build() {
    // a stray { in prose
    entry.audio_data = ad.cloned();
}
let after = 1;
";
        let block = block_of(src, "fn build()");
        assert!(block.ends_with('}'));
        assert!(
            !block.contains("let after"),
            "the block must stop at its own closing brace, not run past it"
        );
    }

    /// A `//` inside a string must not swallow the rest of the line, or the
    /// scanner desynchronises and the real code after it stops being scanned.
    #[test]
    fn a_double_slash_inside_a_string_is_not_a_comment() {
        let src = "\
fn build() {
    let url = \"https://example.com\";
    entry.audio_data = ad.cloned();
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data"]));
        assert_eq!(
            used,
            vec!["audio_data".to_string()],
            "the assignment after the URL must still be scanned"
        );
    }

    /// Same false-pass class as a comment: a carry line parked in a string
    /// literal is not a read either.
    #[test]
    fn a_carry_line_inside_a_string_is_not_a_read() {
        let src = "\
fn build() {
    let _ = \"entry.lod_data = ld.cloned();\";
    entry.audio_data = ad.cloned();
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(used, vec!["audio_data".to_string()]);
    }

    #[test]
    fn a_brace_inside_a_string_does_not_unbalance_the_block() {
        let src = "\
fn build() {
    let _ = \"a stray { in text\";
    entry.audio_data = ad.cloned();
}
let after = 1;
";
        let block = block_of(src, "fn build()");
        assert!(block.ends_with('}'));
        assert!(!block.contains("let after"));
    }

    #[test]
    fn a_double_slash_inside_a_raw_string_is_not_a_comment() {
        let src = "\
fn build() {
    let s = r#\"// entry.lod_data = ld.cloned();\"#;
    entry.audio_data = ad.cloned();
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(
            used,
            vec!["audio_data".to_string()],
            "a raw string's contents are neither a comment nor a read"
        );
    }

    /// Lifetimes must not be mistaken for char literals, or the scanner
    /// desynchronises and stops stripping real comments.
    #[test]
    fn lifetimes_do_not_desynchronise_the_scanner() {
        let src = "\
fn build(x: &'a str, y: &'static str) {
    // entry.lod_data = ld.cloned();
    entry.audio_data = ad.cloned();
}
";
        let block = block_of(src, "fn build(");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(used, vec!["audio_data".to_string()]);
    }

    #[test]
    fn stripping_preserves_length_and_line_count() {
        let src = "a // comment\nb /* two\nlines */ c\n";
        let out = strip_comments(src);
        assert_eq!(out.len(), src.len(), "offsets must stay aligned");
        assert_eq!(out.lines().count(), src.lines().count());
    }

    #[test]
    fn nested_block_comments_are_fully_stripped() {
        let src = "\
fn build() {
    /* outer /* inner */ entry.lod_data = ld.cloned(); */
    entry.audio_data = ad.cloned();
}
";
        let block = block_of(src, "fn build()");
        let used = names_in(&block, "entry.", &fields(&["audio_data", "lod_data"]));
        assert_eq!(used, vec!["audio_data".to_string()]);
    }

    #[test]
    fn a_marker_mentioned_only_in_a_comment_does_not_make_it_ambiguous() {
        let src = "\
// see fn build() for the carry
fn build() {
    entry.audio_data = ad.cloned();
}
";
        // Would panic on a duplicate marker if comments were counted.
        let block = block_of(src, "fn build()");
        assert!(block.contains("audio_data"));
    }

    #[test]
    fn fields_of_reads_declared_field_names() {
        let src = "\
pub struct Thing {
    /// Doc: not a field.
    pub audio_data: Option<AudioData>,
    // pub lod_data: Option<LodData>,
    pub audio_enabled: bool,
}
";
        assert_eq!(
            fields_of(src, "pub struct Thing {"),
            fields(&["audio_data", "audio_enabled"]),
            "a commented-out declaration is not a field"
        );
    }
}
