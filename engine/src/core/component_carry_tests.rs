//! Test modules for [`super::component_carry`].
//!
//! Split out of `component_carry.rs` purely to keep that file under the
//! repository's 800-line ceiling (`.claude/tools/validate-rust.sh`). The parity
//! module's `include_str!` still resolves against this directory, so it reads
//! the same production source it pins.

#[cfg(test)]
mod carry_behaviour_tests {
    use crate::core::component_carry::*;
    use crate::core::audio::AudioData;
    use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled};

    /// Deliberately OFF-default: a fixture built from `Default::default()` is
    /// satisfied by an `insert(default())` mutant that restores nothing real.
    fn cave() -> ReverbZoneData {
        ReverbZoneData {
            preset: "cave".to_string(),
            wet_mix: 0.9,
            ..Default::default()
        }
    }

    /// Also off-default on every field the assertions read.
    fn loud_audio() -> AudioData {
        AudioData {
            volume: 0.375,
            loop_audio: true,
            spatial: true,
            ..Default::default()
        }
    }

    fn restore(aux: &AuxComponentData) -> (World, Entity) {
        let mut world = World::new();
        let entity = world.spawn_empty().id();
        {
            let mut commands = world.commands();
            let mut entity_commands = commands.entity(entity);
            insert_aux_components(&mut entity_commands, aux);
        }
        world.flush();
        (world, entity)
    }

    #[test]
    fn enabled_reverb_zone_is_carried_with_its_marker() {
        let aux = AuxComponentData {
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        let restored = world
            .get::<ReverbZoneData>(entity)
            .expect("reverb zone data should be carried");
        assert_eq!(restored.preset, "cave");
        assert_eq!(restored.wet_mix, 0.9);
        assert!(world.get::<ReverbZoneEnabled>(entity).is_some());
    }

    #[test]
    fn disabled_reverb_zone_stays_disabled() {
        let aux = AuxComponentData {
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: false,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        assert!(world.get::<ReverbZoneData>(entity).is_some());
        assert!(
            world.get::<ReverbZoneEnabled>(entity).is_none(),
            "a disabled reverb zone must not come back enabled"
        );
    }

    #[test]
    fn no_reverb_zone_carries_neither_component() {
        let (world, entity) = restore(&AuxComponentData::default());
        assert!(world.get::<ReverbZoneData>(entity).is_none());
        assert!(world.get::<ReverbZoneEnabled>(entity).is_none());
    }

    #[test]
    fn muted_audio_is_carried_muted() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: false,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        let restored = world
            .get::<AudioData>(entity)
            .expect("audio data should be carried");
        assert_eq!(restored.volume, 0.375);
        assert!(restored.loop_audio);
        assert!(
            world.get::<AudioEnabled>(entity).is_none(),
            "audio the user switched off must not come back playing"
        );
    }

    #[test]
    fn playing_audio_is_carried_playing() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        assert!(world.get::<AudioData>(entity).is_some());
        assert!(world.get::<AudioEnabled>(entity).is_some());
    }

    #[test]
    fn combine_result_keeps_gameplay_components_and_drops_geometry_recipes() {
        use crate::core::procedural_mesh::{ProceduralMeshData, ProceduralOp};

        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            reverb_zone_data: Some(cave()),
            reverb_zone_enabled: true,
            procedural_mesh_data: Some(ProceduralMeshData {
                positions: vec![[1.0, 2.0, 3.0]],
                normals: vec![[0.0, 1.0, 0.0]],
                uvs: vec![[0.25, 0.75]],
                indices: vec![0],
                operation: ProceduralOp::Lathe { profile: vec![[0.5, 0.0], [0.5, 1.0]], segments: 12 },
            }),
            active_game_camera: true,
            physics2d_enabled: true,
            tilemap_enabled: true,
            ..Default::default()
        };

        let carried = aux.for_combine_result();

        // Carried: gameplay/authoring components travel to the merged entity.
        assert!(carried.audio_data.is_some());
        assert!(carried.audio_enabled);
        assert!(carried.reverb_zone_data.is_some());
        assert!(carried.reverb_zone_enabled);

        // Exempt: geometry recipes and the active-camera flag do not.
        assert!(
            carried.procedural_mesh_data.is_none(),
            "the merged entity carries its own combined geometry"
        );
        assert!(
            !carried.active_game_camera,
            "a new entity must not steal the active-camera flag"
        );
        assert!(!carried.physics2d_enabled);
        assert!(!carried.tilemap_enabled);
    }

    #[test]
    fn combine_result_carry_survives_the_insert_path() {
        let aux = AuxComponentData {
            audio_data: Some(loud_audio()),
            audio_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux.for_combine_result());
        assert_eq!(
            world
                .get::<AudioData>(entity)
                .expect("combine result should carry audio")
                .volume,
            0.375
        );
        assert!(world.get::<AudioEnabled>(entity).is_some());
    }
}

/// Source-parity gate for the carry model.
///
/// Behavioural tests only ever prove the component they name. The defect class
/// here is DIVERGENCE — a field added to `AuxComponentData` and wired into some
/// paths but not others — so what has to be pinned is the field list itself.
#[cfg(test)]
mod component_carry_parity {
    const SOURCE: &str = include_str!("component_carry.rs");

    /// Fields `insert_aux_components` deliberately never puts back.
    const RESTORE_EXEMPT: &[(&str, &str)] = &[(
        "active_game_camera",
        "a newly created entity must not steal the active-camera flag from the \
         entity it was copied from; the callers zero it on the snapshot too",
    )];

    /// Floors: a slice that silently returns nothing is what makes this class of
    /// test report green on a broken parser.
    const FIELD_FLOOR: usize = 23;
    const COLLECTED_FLOOR: usize = 23;
    const SNAPSHOT_FLOOR: usize = 23;
    const RESTORED_FLOOR: usize = 22;
    const COMBINE_FLOOR: usize = 12;

    /// Slice the source from `marker` to the first line that is exactly `}`.
    fn block_after(marker: &str) -> &'static str {
        let start = SOURCE
            .find(marker)
            .unwrap_or_else(|| panic!("stale parity marker: {marker} not found in component_carry.rs"));
        let rest = &SOURCE[start..];
        let end = rest
            .find("\n}")
            .unwrap_or_else(|| panic!("stale parity marker: no closing brace after {marker}"));
        &rest[..end]
    }

    /// Every field name declared on `AuxComponentData`.
    fn struct_fields() -> Vec<String> {
        block_after("pub struct AuxComponentData {")
            .lines()
            .skip(1)
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with("//") || trimmed.starts_with("///") {
                    return None;
                }
                let (name, _) = trimmed.split_once(':')?;
                let name = name.trim().strip_prefix("pub ")?.trim();
                if name.is_empty() || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                    return None;
                }
                Some(name.to_string())
            })
            .collect()
    }

    /// Field names mentioned as `<prefix><field>` inside the block at `marker`.
    fn fields_used(marker: &str, prefix: &str) -> Vec<String> {
        let body = block_after(marker);
        let fields = struct_fields();
        let mut used: Vec<String> = Vec::new();
        for (idx, _) in body.match_indices(prefix) {
            let tail = &body[idx + prefix.len()..];
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

    /// Field names assigned in the `for_combine_result` struct literal.
    fn combine_carried() -> Vec<String> {
        fields_used("pub fn for_combine_result", "self.")
    }

    fn assert_covers(
        what: &str,
        used: &[String],
        exempt: &[(&str, &str)],
        floor: usize,
    ) {
        let fields = struct_fields();
        assert!(
            fields.len() >= FIELD_FLOOR,
            "parsed only {} AuxComponentData fields (floor {}) — the parser is broken, not the code",
            fields.len(),
            FIELD_FLOOR
        );
        assert!(
            used.len() >= floor,
            "{what}: parsed only {} field uses (floor {floor}) — the parser is broken, not the code",
            used.len()
        );
        for name in used {
            assert!(
                fields.contains(name),
                "{what}: `{name}` is not a field of AuxComponentData — reverse check failed"
            );
        }
        let missing: Vec<&String> = fields
            .iter()
            .filter(|f| !used.contains(f) && !exempt.iter().any(|(e, _)| *e == f.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "{what}: these AuxComponentData fields are neither handled nor exempt: {missing:?}"
        );
    }

    #[test]
    fn every_field_is_collected_from_the_world() {
        assert_covers(
            "build_aux_index",
            &fields_used("pub fn build_aux_index", "entry."),
            &[],
            COLLECTED_FLOOR,
        );
    }

    #[test]
    fn every_field_is_written_into_the_undo_snapshot() {
        // No exemptions: an undo that restores a stripped entity is the bug.
        assert_covers(
            "snapshot_entity",
            &fields_used("pub fn snapshot_entity", "aux."),
            &[],
            SNAPSHOT_FLOOR,
        );
    }

    #[test]
    fn every_field_is_restored_onto_new_entities() {
        assert_covers(
            "pub fn insert_aux_components",
            &fields_used("pub fn insert_aux_components", "aux."),
            RESTORE_EXEMPT,
            RESTORED_FLOOR,
        );
    }

    #[test]
    fn every_field_is_decided_for_the_combine_result() {
        assert_covers(
            "for_combine_result",
            &combine_carried(),
            crate::core::component_carry::COMBINE_RESULT_EXEMPT,
            COMBINE_FLOOR,
        );
    }

    #[test]
    fn exemptions_are_still_accurate() {
        let fields = struct_fields();
        let restored = fields_used("pub fn insert_aux_components", "aux.");
        for (name, reason) in RESTORE_EXEMPT {
            assert!(
                fields.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, which is no longer a field of AuxComponentData"
            );
            assert!(
                !restored.contains(&name.to_string()),
                "RESTORE_EXEMPT names `{name}`, but insert_aux_components now restores it — drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }

        let carried = combine_carried();
        for (name, reason) in crate::core::component_carry::COMBINE_RESULT_EXEMPT {
            assert!(
                fields.contains(&name.to_string()),
                "COMBINE_RESULT_EXEMPT names `{name}`, which is no longer a field of AuxComponentData"
            );
            assert!(
                !carried.contains(&name.to_string()),
                "COMBINE_RESULT_EXEMPT names `{name}`, but for_combine_result now carries it — drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }
    }
}
