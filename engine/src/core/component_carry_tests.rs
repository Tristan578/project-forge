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

    /// `audio_enabled` defaults to `true` (serde back-compat for `.forge`
    /// scenes saved before the field existed), so a bundle carrying the flag
    /// with no data behind it is reachable. A bare marker on an entity with no
    /// `AudioData` is a component the rest of the engine reads as "this entity
    /// plays audio" while there is nothing to play.
    #[test]
    fn audio_enabled_without_audio_data_inserts_no_marker() {
        let aux = AuxComponentData {
            audio_data: None,
            audio_enabled: true,
            ..Default::default()
        };
        let (world, entity) = restore(&aux);
        assert!(world.get::<AudioData>(entity).is_none());
        assert!(
            world.get::<AudioEnabled>(entity).is_none(),
            "an enablement marker must never outlive the data it enables"
        );
    }

    #[test]
    fn combine_result_base_keeps_the_look_and_body_but_not_the_asset_or_hidden_state() {
        use crate::core::asset_manager::{AssetKind, AssetRef};

        // Off-default on every field the assertions read.
        let mat = MaterialData { metallic: 0.875, ..Default::default() };
        let light = LightData { intensity: 4321.0, ..LightData::point() };
        let phys = PhysicsData { friction: 0.75, ..Default::default() };
        let asset = AssetRef {
            asset_id: "asset-1".to_string(),
            asset_name: "source.glb".to_string(),
            asset_type: AssetKind::GltfModel,
        };

        let source = BaseComponentData {
            visible: false,
            material_data: Some(&mat),
            light_data: Some(&light),
            physics_data: Some(&phys),
            physics_enabled: true,
            asset_ref: Some(&asset),
        };

        let carried = source.for_combine_result();

        assert_eq!(
            carried.material_data.expect("the result keeps the primary's look").metallic,
            0.875
        );
        assert_eq!(carried.light_data.expect("light carries").intensity, 4321.0);
        assert_eq!(carried.physics_data.expect("body carries").friction, 0.75);
        assert!(carried.physics_enabled, "a simulated source produces a simulated result");
        assert!(
            carried.asset_ref.is_none(),
            "the merged geometry belongs to no imported asset"
        );
        assert!(
            carried.visible,
            "combining hidden sources must not produce an entity the user cannot find"
        );
    }

    /// `insert_base_components` deliberately inserts neither `visible` nor
    /// `material_data` — every caller spawns those in its own bundle, because a
    /// mesh entity needs its `MeshMaterial3d` handle seeded in the same breath.
    /// Pinned here so the seam is a decision, not an oversight.
    #[test]
    fn insert_base_components_restores_the_body_and_light_but_not_the_look() {
        let mat = MaterialData { metallic: 0.875, ..Default::default() };
        let light = LightData { intensity: 4321.0, ..LightData::point() };
        let phys = PhysicsData { friction: 0.75, ..Default::default() };

        let mut world = World::new();
        let entity = world.spawn_empty().id();
        {
            let mut commands = world.commands();
            let mut entity_commands = commands.entity(entity);
            insert_base_components(
                &mut entity_commands,
                BaseComponentData {
                    visible: true,
                    material_data: Some(&mat),
                    light_data: Some(&light),
                    physics_data: Some(&phys),
                    physics_enabled: true,
                    asset_ref: None,
                },
            );
        }
        world.flush();

        assert_eq!(world.get::<LightData>(entity).expect("light restored").intensity, 4321.0);
        assert_eq!(world.get::<PhysicsData>(entity).expect("body restored").friction, 0.75);
        assert!(world.get::<PhysicsEnabled>(entity).is_some());
        assert!(
            world.get::<MaterialData>(entity).is_none(),
            "material is spawned by the caller's own bundle — see BASE_INSERT_EXEMPT"
        );
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
    const SNAPSHOT_SOURCE: &str = include_str!("history.rs");

    /// Fields `insert_aux_components` deliberately never puts back.
    const RESTORE_EXEMPT: &[(&str, &str)] = &[(
        "active_game_camera",
        "a newly created entity must not steal the active-camera flag from the \
         entity it was copied from; the callers zero it on the snapshot too",
    )];

    /// Fields of `BaseComponentData` that `insert_base_components` deliberately
    /// does NOT insert, because every caller already spawns them itself.
    const BASE_INSERT_EXEMPT: &[(&str, &str)] = &[
        (
            "visible",
            "read only by snapshot_entity: it records what the caller spawned. \
             Every caller puts EntityVisible in its own spawn bundle, so \
             inserting a second one here would fight the bundle",
        ),
        (
            "material_data",
            "a mesh entity needs MaterialData and its MeshMaterial3d handle \
             seeded in the same bundle (sync_material_data only runs on \
             Changed<MaterialData>, so a value inserted afterwards is never \
             seen — PF-1225); the callers therefore spawn both together",
        ),
    ];

    /// `EntitySnapshot` fields that are NOT part of the carry model, each with
    /// the reason it is decided somewhere other than `AuxComponentData`.
    const SNAPSHOT_NON_AUX: &[(&str, &str)] = &[
        ("entity_id", "identity, assigned by the spawning caller"),
        ("entity_type", "identity, assigned by the spawning caller"),
        ("name", "identity, assigned by the spawning caller"),
        (
            "transform",
            "placement, decided per caller (array offsets, duplicate nudge, combine origin)",
        ),
        (
            "parent_id",
            "hierarchy, re-established by the caller's reparent pass",
        ),
        (
            "visible",
            "BaseComponentData field — see COMBINE_RESULT_BASE_EXEMPT/BASE_INSERT_EXEMPT",
        ),
        ("material_data", "BaseComponentData field"),
        ("light_data", "BaseComponentData field"),
        ("physics_data", "BaseComponentData field"),
        ("physics_enabled", "BaseComponentData field"),
        ("asset_ref", "BaseComponentData field"),
    ];

    /// Floors: a slice that silently returns nothing is what makes this class of
    /// test report green on a broken parser.
    const FIELD_FLOOR: usize = 27;
    const COLLECTED_FLOOR: usize = 27;
    const SNAPSHOT_FLOOR: usize = 27;
    const RESTORED_FLOOR: usize = 26;
    const COMBINE_FLOOR: usize = 12;
    const BASE_FIELD_FLOOR: usize = 6;
    const BASE_INSERTED_FLOOR: usize = 4;
    const BASE_COMBINE_FLOOR: usize = 4;
    const ENTITY_SNAPSHOT_FIELD_FLOOR: usize = 38;

    /// Slice the brace-balanced block introduced by `marker`.
    ///
    /// The marker must be UNIQUE in the file: the previous version took the
    /// first match and ran to the first column-0 `}`, which silently sliced the
    /// module doc comment once a second `for_combine_result` existed. Both
    /// halves matter — an ambiguous marker picks the wrong block, and a
    /// line-based terminator overshoots a nested item.
    fn block_after(marker: &str) -> &'static str {
        block_of(SOURCE, marker)
    }

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

    /// Field names declared inside the brace-balanced block at `marker`.
    fn fields_of(source: &'static str, marker: &str) -> Vec<String> {
        block_of(source, marker)
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

    /// Every field name declared on `AuxComponentData`.
    fn struct_fields() -> Vec<String> {
        fields_of(SOURCE, "pub struct AuxComponentData {")
    }

    /// Every field name declared on `BaseComponentData`.
    fn base_fields() -> Vec<String> {
        fields_of(SOURCE, "pub struct BaseComponentData<'a> {")
    }

    /// Every field name declared on `EntitySnapshot`, read from `history.rs`.
    fn snapshot_fields() -> Vec<String> {
        fields_of(SNAPSHOT_SOURCE, "pub struct EntitySnapshot {")
    }

    /// Names from `fields` mentioned as `<prefix><name>` inside the block at
    /// `marker`.
    fn names_used(marker: &str, prefix: &str, fields: &[String]) -> Vec<String> {
        let body = block_after(marker);
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

    fn fields_used(marker: &str, prefix: &str) -> Vec<String> {
        names_used(marker, prefix, &struct_fields())
    }

    /// Field names assigned in `AuxComponentData::for_combine_result`.
    ///
    /// Keyed on the impl block, not on the function name: `for_combine_result`
    /// is no longer unique in this file.
    fn combine_carried() -> Vec<String> {
        fields_used("impl AuxComponentData {", "self.")
    }

    /// Field names carried through `BaseComponentData::for_combine_result`.
    fn base_combine_carried() -> Vec<String> {
        names_used("impl<'a> BaseComponentData<'a> {", "self.", &base_fields())
    }

    /// Field names `insert_base_components` reads off its `base` argument.
    fn base_inserted() -> Vec<String> {
        names_used("pub fn insert_base_components", "base.", &base_fields())
    }

    fn assert_covers_list(
        what: &str,
        fields: &[String],
        field_floor: usize,
        used: &[String],
        exempt: &[(&str, &str)],
        floor: usize,
    ) {
        assert!(
            fields.len() >= field_floor,
            "{what}: parsed only {} declared fields (floor {field_floor}) — the parser is broken, not the code",
            fields.len()
        );
        assert!(
            used.len() >= floor,
            "{what}: parsed only {} field uses (floor {floor}) — the parser is broken, not the code",
            used.len()
        );
        for name in used {
            assert!(
                fields.contains(name),
                "{what}: `{name}` is not a declared field — reverse check failed"
            );
        }
        let missing: Vec<&String> = fields
            .iter()
            .filter(|f| !used.contains(f) && !exempt.iter().any(|(e, _)| *e == f.as_str()))
            .collect();
        assert!(
            missing.is_empty(),
            "{what}: these fields are neither handled nor exempt: {missing:?}"
        );
    }

    fn assert_covers(what: &str, used: &[String], exempt: &[(&str, &str)], floor: usize) {
        assert_covers_list(what, &struct_fields(), FIELD_FLOOR, used, exempt, floor);
    }

    /// Two-direction staleness: an exempt name that is no longer a field, and
    /// an exempt name the code has started handling, both fail.
    fn assert_exemptions_current(
        what: &str,
        fields: &[String],
        handled: &[String],
        exempt: &[(&str, &str)],
    ) {
        for (name, reason) in exempt {
            assert!(
                fields.contains(&name.to_string()),
                "{what} names `{name}`, which is no longer a declared field"
            );
            assert!(
                !handled.contains(&name.to_string()),
                "{what} names `{name}`, but the code now handles it — drop the exemption"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no exemption reason");
        }
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
            "AuxComponentData::for_combine_result",
            &combine_carried(),
            crate::core::component_carry::COMBINE_RESULT_EXEMPT,
            COMBINE_FLOOR,
        );
    }

    #[test]
    fn every_base_field_is_restored_or_exempt() {
        assert_covers_list(
            "insert_base_components",
            &base_fields(),
            BASE_FIELD_FLOOR,
            &base_inserted(),
            BASE_INSERT_EXEMPT,
            BASE_INSERTED_FLOOR,
        );
    }

    #[test]
    fn every_base_field_is_decided_for_the_combine_result() {
        assert_covers_list(
            "BaseComponentData::for_combine_result",
            &base_fields(),
            BASE_FIELD_FLOOR,
            &base_combine_carried(),
            crate::core::component_carry::COMBINE_RESULT_BASE_EXEMPT,
            BASE_COMBINE_FLOOR,
        );
    }

    /// The other parity tests are self-referential: they compare
    /// `AuxComponentData` against code that was written from it, so a component
    /// missing from the struct is invisible to all of them. `EntitySnapshot` is
    /// the independent list — it is what a `.forge` scene and the undo stack
    /// actually store — so diffing against it is what catches a component that
    /// persists but never travels.
    #[test]
    fn the_carry_list_covers_every_snapshot_field_or_says_why_not() {
        let snap = snapshot_fields();
        assert!(
            snap.len() >= ENTITY_SNAPSHOT_FIELD_FLOOR,
            "parsed only {} EntitySnapshot fields (floor {ENTITY_SNAPSHOT_FIELD_FLOOR}) — the parser is broken",
            snap.len()
        );
        let aux = struct_fields();
        let base = base_fields();

        let unaccounted: Vec<&String> = snap
            .iter()
            .filter(|f| {
                !aux.contains(f)
                    && !base.contains(f)
                    && !SNAPSHOT_NON_AUX.iter().any(|(e, _)| *e == f.as_str())
            })
            .collect();
        assert!(
            unaccounted.is_empty(),
            "these EntitySnapshot fields are in neither carry bundle nor SNAPSHOT_NON_AUX, \
             so they persist across a save but silently vanish on duplicate/array/combine: {unaccounted:?}"
        );

        // Reverse direction: an entry that stops being a snapshot field, or
        // that the carry bundles have since absorbed, is stale.
        for (name, reason) in SNAPSHOT_NON_AUX {
            assert!(
                snap.contains(&name.to_string()),
                "SNAPSHOT_NON_AUX names `{name}`, which is no longer an EntitySnapshot field"
            );
            assert!(!reason.trim().is_empty(), "`{name}` has no reason");
            if base.contains(&name.to_string()) {
                continue; // BaseComponentData fields are listed here on purpose.
            }
            assert!(
                !aux.contains(&name.to_string()),
                "SNAPSHOT_NON_AUX names `{name}`, but AuxComponentData now carries it — drop the entry"
            );
        }
    }

    #[test]
    fn exemptions_are_still_accurate() {
        let fields = struct_fields();
        assert_exemptions_current(
            "RESTORE_EXEMPT",
            &fields,
            &fields_used("pub fn insert_aux_components", "aux."),
            RESTORE_EXEMPT,
        );
        assert_exemptions_current(
            "COMBINE_RESULT_EXEMPT",
            &fields,
            &combine_carried(),
            crate::core::component_carry::COMBINE_RESULT_EXEMPT,
        );

        let base = base_fields();
        assert_exemptions_current(
            "BASE_INSERT_EXEMPT",
            &base,
            &base_inserted(),
            BASE_INSERT_EXEMPT,
        );
        assert_exemptions_current(
            "COMBINE_RESULT_BASE_EXEMPT",
            &base,
            &base_combine_carried(),
            crate::core::component_carry::COMBINE_RESULT_BASE_EXEMPT,
        );
    }
}
