//! Source-parity gate for [`super::entity_factory::spawn_from_snapshot`].
//!
//! Split into a sibling file rather than an inline `#[cfg(test)] mod`: the gate
//! slices `entity_factory.rs` by a marker string, and a marker written as a
//! literal *inside* that file is a second occurrence of itself. The uniqueness
//! assertion would then fire on the test's own source.
//!
//! `component_carry`'s parity module pins the three paths that share
//! `AuxComponentData`. `spawn_from_snapshot` is the fourth rebuild path and it
//! does NOT go through `insert_aux_components` — it reads the snapshot
//! directly, so a field added to `EntitySnapshot` can be written by
//! `snapshot_entity` and never read back here. Undo would then restore a
//! stripped entity, and nothing would report it: the restore returns an
//! `Entity` either way.

#[cfg(test)]
mod snapshot_restore_parity {
    const FACTORY_SOURCE: &str = include_str!("entity_factory.rs");
    const SNAPSHOT_SOURCE: &str = include_str!("history.rs");

    /// Snapshot fields `spawn_from_snapshot` deliberately never reads.
    const RESTORE_EXEMPT: &[(&str, &str)] = &[(
        "parent_id",
        "hierarchy is re-established by the caller's reparent pass once every \
         entity in the undone batch exists; reading it here would try to attach \
         to a parent that has not been respawned yet",
    )];

    /// Floors: a slice that silently returns nothing is what makes this class of
    /// test report green on a broken parser.
    const SNAPSHOT_FIELD_FLOOR: usize = 38;
    const READ_FLOOR: usize = 36;

    /// Slice the brace-balanced block introduced by `marker`, which must be
    /// unique in `source`.
    fn block_of(source: &'static str, marker: &str) -> &'static str {
        let hits = source.matches(marker).count();
        assert_eq!(
            hits, 1,
            "parity marker `{marker}` occurs {hits} times — a marker that is not \
             unique cannot identify a block"
        );
        let start = source.find(marker).unwrap();
        let rest = &source[start..];
        let open = rest
            .find('{')
            .unwrap_or_else(|| panic!("stale parity marker: no opening brace after {marker}"));
        let bytes = rest.as_bytes();
        let mut depth = 0usize;
        for (i, b) in bytes.iter().enumerate().skip(open) {
            match b {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return &rest[..=i];
                    }
                }
                _ => {}
            }
        }
        panic!("stale parity marker: unbalanced braces after {marker}");
    }

    /// Field names declared on `EntitySnapshot`, read from `history.rs`.
    fn snapshot_fields() -> Vec<String> {
        block_of(SNAPSHOT_SOURCE, "pub struct EntitySnapshot {")
            .lines()
            .skip(1)
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with("//") {
                    return None;
                }
                let (name, _) = trimmed.split_once(':')?;
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

    /// Snapshot field names read as `snapshot.<field>` inside
    /// `spawn_from_snapshot`.
    fn fields_read() -> Vec<String> {
        let fields = snapshot_fields();
        let body = block_of(FACTORY_SOURCE, "pub fn spawn_from_snapshot(");
        let mut used: Vec<String> = Vec::new();
        for (idx, _) in body.match_indices("snapshot.") {
            let tail = &body[idx + "snapshot.".len()..];
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

    #[test]
    fn every_snapshot_field_is_restored_or_exempt() {
        let fields = snapshot_fields();
        assert!(
            fields.len() >= SNAPSHOT_FIELD_FLOOR,
            "parsed only {} EntitySnapshot fields (floor {SNAPSHOT_FIELD_FLOOR}) — \
             the parser is broken, not the code",
            fields.len()
        );
        let read = fields_read();
        assert!(
            read.len() >= READ_FLOOR,
            "parsed only {} snapshot reads (floor {READ_FLOOR}) — the parser is \
             broken, not the code",
            read.len()
        );
        // Reverse check: everything matched must really be a field.
        for name in &read {
            assert!(
                fields.contains(name),
                "`{name}` is not an EntitySnapshot field — reverse check failed"
            );
        }
        let missing: Vec<&String> = fields
            .iter()
            .filter(|f| !read.contains(f) && !RESTORE_EXEMPT.iter().any(|(e, _)| *e == f.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "spawn_from_snapshot reads neither these fields nor exempts them, so an \
             undo restores an entity without them: {missing:?}"
        );
    }

    #[test]
    fn exemptions_are_still_accurate() {
        let fields = snapshot_fields();
        let read = fields_read();
        for (name, reason) in RESTORE_EXEMPT {
            assert!(
                fields.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, which is no longer an EntitySnapshot field"
            );
            assert!(
                !read.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, but spawn_from_snapshot now reads it — \
                 drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }
    }
}
