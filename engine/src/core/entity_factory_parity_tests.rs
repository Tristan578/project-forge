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

    /// Field names declared on `EntitySnapshot`, read from `history.rs`.
    fn snapshot_fields() -> Vec<String> {
        crate::core::parity_util::fields_of(SNAPSHOT_SOURCE, "pub struct EntitySnapshot {")
    }

    /// Snapshot field names read as `snapshot.<field>` inside
    /// `spawn_from_snapshot`.
    ///
    /// Comments are stripped before the scan (see
    /// [`crate::core::parity_util::strip_comments`]): a mention inside a
    /// comment is not a read, so a commented-out
    /// `// commands.entity(entity).insert(snapshot.lod_data)` must not satisfy
    /// this gate. That failure is in the false-pass direction, which is the
    /// only direction that matters for a gate whose job is to notice an
    /// omission.
    fn fields_read() -> Vec<String> {
        let fields = snapshot_fields();
        let body = crate::core::parity_util::block_of(FACTORY_SOURCE, "pub fn spawn_from_snapshot(");
        crate::core::parity_util::names_in(&body, "snapshot.", &fields)
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
