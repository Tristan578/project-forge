#![cfg(test)]
//! Source-parity gates for every `EntitySnapshot` producer.
//!
//! `EntitySnapshot` is built by calling [`EntitySnapshot::new`] and then
//! assigning fields one at a time. Adding a `pub` field to the struct therefore
//! compiles everywhere: each producer keeps building a snapshot, silently
//! leaving the new field at its `new()` default. The failure is not a crash --
//! it is a component that disappears on save/reload or on undo.
//!
//! `entity_factory_parity_tests` already pins the CONSUMER
//! (`spawn_from_snapshot`) that way. This module pins the PRODUCERS. Four of
//! them live under `engine/src/bridge/`, which is
//! `#[cfg(target_arch = "wasm32")]`-gated at the crate root (`lib.rs`), so
//! `cargo test` never compiles those files at all. A source-parity gate reading
//! them with `include_str!` is the only mechanism that can cover them.
//!
//! ## What each gate does
//!
//! For one producer it slices the brace-balanced block named by a unique marker
//! out of the production source, extracts the snapshot field names mentioned as
//! `<prefix><field>` inside it, and asserts that
//!
//! ```text
//! assigned + exempt == every pub field of EntitySnapshot
//! ```
//!
//! as an equality of NAME SETS in both directions: nothing may be missing, and
//! nothing may be both assigned and exempt. Counts are never compared against
//! each other -- a literal-vs-literal arithmetic check would pass no matter
//! what the production source said.
//!
//! Slicing and name extraction go through [`crate::core::parity_util`], whose
//! `strip_comments` blanks comments AND string-literal contents first, so a
//! commented-out assignment (`// snap.lod_data = ...`) does not score as an
//! assignment. That exact false pass is what motivated `parity_util`.
//!
//! ## Empty-parse protection
//!
//! Every parser here carries a floor and asserts it. If a producer is rewritten
//! into a shape the scanner cannot read (a struct literal, a builder chain, a
//! renamed local), the count collapses and the gate FAILS telling you to extend
//! the parser -- it never quietly passes on nothing.
//!
//! ## Known limitation
//!
//! [`crate::core::parity_util::names_in`] counts a MENTION, not specifically a
//! write, so `if snap.parent_id.is_none()` inside a producer block would score
//! as an assignment. No producer block currently reads a snapshot field back;
//! closing that hole needs an expression parser, which is out of proportion to
//! the risk here.

use crate::core::parity_util::{block_of, fields_of, names_in, strip_comments};

const SNAPSHOT_SOURCE: &str = include_str!("history.rs");
const ENTITY_FACTORY_SOURCE: &str = include_str!("entity_factory.rs");
const ENGINE_MODE_SOURCE: &str = include_str!("engine_mode.rs");
const SCENE_IO_SOURCE: &str = include_str!("../bridge/scene_io.rs");
const PROCEDURAL_SOURCE: &str = include_str!("../bridge/procedural.rs");
const SPRITE_SOURCE: &str = include_str!("../bridge/sprite.rs");

/// `EntitySnapshot` had 38 `pub` fields when these gates were written. The
/// floor only guards against the field parser silently reading nothing; it is
/// never compared against an exemption count.
const SNAPSHOT_FIELD_FLOOR: usize = 38;

/// Marker for the `EntitySnapshot::new` signature. Unique in `history.rs`.
const CTOR_MARKER: &str = "pub fn new(";

/// The four fields `EntitySnapshot::new` takes as parameters. No producer
/// assigns them after construction because the constructor already set them,
/// so they are exempt everywhere. The list is not taken on trust:
/// [`constructor_parameters_are_exactly_the_shared_exemptions`] re-parses the
/// real signature out of `history.rs` and compares.
const CTOR_ARGS: &[(&str, &str)] = &[
    (
        "entity_id",
        "passed to EntitySnapshot::new as the first argument",
    ),
    (
        "entity_type",
        "passed to EntitySnapshot::new as the second argument",
    ),
    (
        "name",
        "passed to EntitySnapshot::new as the third argument",
    ),
    (
        "transform",
        "passed to EntitySnapshot::new as the fourth argument",
    ),
];

// ---------------------------------------------------------------------------
// Producer descriptions
// ---------------------------------------------------------------------------

/// A helper a producer hands part of the snapshot to.
struct Delegate {
    label: &'static str,
    source: &'static str,
    marker: &'static str,
    prefix: &'static str,
    /// Floor on how many fields the delegate must be SEEN to assign.
    assign_floor: usize,
}

/// One block of production source that builds an `EntitySnapshot`.
struct Producer {
    /// Used in failure messages so a red test names the producer, not a number.
    label: &'static str,
    /// Path shown in failure messages.
    file: &'static str,
    source: &'static str,
    /// Unique marker naming the block. Must be unique after comment stripping.
    marker: &'static str,
    /// How assignments are written inside the block (`snap.` / `snapshot.`).
    prefix: &'static str,
    /// Floor on how many fields the parser must be SEEN to assign. Guards
    /// against a producer rewritten into a shape the scanner cannot read.
    assign_floor: usize,
    /// Per-field exemptions, composed from one or more lists. Every entry
    /// carries its own reason; there is no catch-all bucket.
    exempt: &'static [&'static [(&'static str, &'static str)]],
    /// A helper this producer delegates part of the snapshot to, if any.
    delegate: Option<Delegate>,
}

impl Producer {
    /// Fields this producer is seen to assign, including via its delegate.
    fn assigned(&self, fields: &[String]) -> Vec<String> {
        let block = block_of(self.source, self.marker);
        let mut found = names_in(&block, self.prefix, fields);
        assert!(
            found.len() >= self.assign_floor,
            "{} ({}): parsed only {} `{}<field>` assignments out of the block at \
             `{}`, expected at least {}. The producer was rewritten into a shape \
             this scanner cannot read -- extend the parser first, do not lower \
             the floor.",
            self.label,
            self.file,
            found.len(),
            self.prefix,
            self.marker,
            self.assign_floor,
        );

        if let Some(d) = &self.delegate {
            let dblock = block_of(d.source, d.marker);
            let dfound = names_in(&dblock, d.prefix, fields);
            assert!(
                dfound.len() >= d.assign_floor,
                "{} ({}): delegate `{}` parsed only {} `{}<field>` assignments, \
                 expected at least {}. The delegate was rewritten into a shape \
                 this scanner cannot read -- extend the parser first.",
                self.label,
                self.file,
                d.label,
                dfound.len(),
                d.prefix,
                d.assign_floor,
            );
            for name in dfound {
                if !found.contains(&name) {
                    found.push(name);
                }
            }
        }

        found
    }

    /// Flattened exemptions: the shared constructor arguments plus this
    /// producer's own lists. Duplicates are an error, not a merge.
    fn exemptions(&self) -> Vec<(&'static str, &'static str)> {
        let mut out: Vec<(&'static str, &'static str)> = CTOR_ARGS.to_vec();
        for list in self.exempt {
            for &(field, reason) in *list {
                assert!(
                    !out.iter().any(|(f, _)| *f == field),
                    "{}: `{field}` is exempted twice. Two reasons for one field \
                     means one of them is stale.",
                    self.label,
                );
                out.push((field, reason));
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Exemption lists
// ---------------------------------------------------------------------------

/// `apply_scene_export` writes a full-fidelity snapshot for every entity in the
/// scene, because `apply_scene_load` restores it through
/// `entity_factory::spawn_from_snapshot`, which reads every field. Anything
/// dropped here is silently lost on save/reload, so nothing is exempt.
const SCENE_IO_EXEMPT: &[(&str, &str)] = &[];

/// The CSG source snapshots recorded before the operands are consumed.
const CSG_SOURCE_EXEMPT: &[(&str, &str)] = &[(
    "parent_id",
    "spawn_from_snapshot ignores parent_id and the CSG undo arm runs no reparent pass, so a recorded value would be dead data",
)];

/// The Edit -> Play scene snapshot taken by `engine_mode::snapshot_scene`.
const ENGINE_MODE_EXEMPT: &[(&str, &str)] = &[(
    "parent_id",
    "restore_scene runs no reparent pass, so a recorded parent_id could never be applied on the way back to Edit",
)];

/// Fields that NO fresh-spawn producer records, because the entity is being
/// created in the same block and nothing inserts the corresponding component.
///
/// Shared by four producers rather than copied four times, but it is not a
/// blanket exemption: every field carries its own reason, and each producer's
/// staleness test re-checks the whole list against that producer's own block,
/// so the moment one of them starts assigning a field the list has to be split.
const FRESH_SPAWN_EXEMPT: &[(&str, &str)] = &[
    (
        "parent_id",
        "spawned at the scene root with no ChildOf, and spawn_from_snapshot ignores parent_id anyway",
    ),
    (
        "visible",
        "the spawn bundle carries EntityVisible::default() (true), which EntitySnapshot::new already defaults to",
    ),
    (
        "light_data",
        "no LightData is inserted: this spawn creates geometry, not a light",
    ),
    (
        "physics_data",
        "no PhysicsData is inserted; physics is opted into later through the physics command domain",
    ),
    (
        "physics_enabled",
        "sibling marker of physics_data; no PhysicsEnabled is inserted at spawn",
    ),
    (
        "asset_ref",
        "the geometry is generated in-process, never loaded through an AssetRef",
    ),
    (
        "script_data",
        "no ScriptData at spawn; scripts are attached from the editor afterwards",
    ),
    ("audio_data", "no AudioData is inserted at spawn"),
    (
        "audio_enabled",
        "sibling marker of audio_data; EntitySnapshot::new already defaults it to true",
    ),
    ("reverb_zone_data", "no ReverbZoneData is inserted at spawn"),
    ("reverb_zone_enabled", "sibling marker of reverb_zone_data"),
    ("particle_data", "no ParticleData is inserted at spawn"),
    ("particle_enabled", "sibling marker of particle_data"),
    (
        "shader_effect_data",
        "no ShaderEffectData is inserted at spawn",
    ),
    (
        "terrain_data",
        "no TerrainData: terrain entities are only ever spawned by the terrain domain",
    ),
    ("terrain_mesh_data", "sibling of terrain_data"),
    (
        "joint_data",
        "a joint needs two existing bodies; an entity spawned in this block has none",
    ),
    ("game_components", "no GameComponents is inserted at spawn"),
    (
        "animation_clip_data",
        "no AnimationClipData is inserted at spawn",
    ),
    (
        "game_camera_data",
        "no GameCameraData: this spawn never creates a camera",
    ),
    ("active_game_camera", "sibling marker of game_camera_data"),
    ("physics2d_data", "no Physics2dData is inserted at spawn"),
    ("physics2d_enabled", "sibling marker of physics2d_data"),
    (
        "joint2d_data",
        "a 2D joint needs two existing bodies; an entity spawned in this block has none",
    ),
    ("tilemap_data", "no TilemapData is inserted at spawn"),
    ("tilemap_enabled", "sibling marker of tilemap_data"),
    ("skeleton2d_data", "no SkeletonData2d is inserted at spawn"),
    ("skeleton2d_enabled", "sibling marker of skeleton2d_data"),
    (
        "skeletal_animations",
        "no SkeletalAnimation2d is inserted at spawn",
    ),
    ("lod_data", "no LodData is inserted at spawn"),
];

/// On top of [`FRESH_SPAWN_EXEMPT`], for the CSG result entity.
const CSG_RESULT_EXEMPT: &[(&str, &str)] = &[
    (
        "procedural_mesh_data",
        "the CSG result carries CsgMeshData; ProceduralMeshData is a different mesh source",
    ),
    ("sprite_data", "no SpriteData: the CSG result is a 3D mesh"),
];

/// On top of [`FRESH_SPAWN_EXEMPT`], for extrude and lathe.
const PROCEDURAL_MESH_EXEMPT: &[(&str, &str)] = &[
    (
        "csg_mesh_data",
        "the generated mesh is ProceduralMeshData; it is not the result of a CSG operation",
    ),
    ("sprite_data", "no SpriteData: this is a 3D mesh"),
];

/// On top of [`FRESH_SPAWN_EXEMPT`], for the 2D sprite spawn.
const SPRITE_EXEMPT: &[(&str, &str)] = &[
    (
        "material_data",
        "a sprite is drawn from SpriteData; it carries no MaterialData PBR material",
    ),
    ("csg_mesh_data", "no CSG mesh: this is a 2D sprite"),
    (
        "procedural_mesh_data",
        "no procedural mesh: this is a 2D sprite",
    ),
];

// ---------------------------------------------------------------------------
// The producers
// ---------------------------------------------------------------------------

/// Scene export. Delegates terrain to
/// `entity_factory::apply_terrain_to_snapshot`, so the gate reads that helper
/// too rather than exempting two fields it does in fact record.
const SCENE_IO: Producer = Producer {
    label: "scene export",
    file: "engine/src/bridge/scene_io.rs",
    source: SCENE_IO_SOURCE,
    marker: "pub(super) fn apply_scene_export(",
    prefix: "snap.",
    assign_floor: 32,
    exempt: &[SCENE_IO_EXEMPT],
    delegate: Some(Delegate {
        label: "entity_factory::apply_terrain_to_snapshot",
        source: ENTITY_FACTORY_SOURCE,
        marker: "pub fn apply_terrain_to_snapshot(",
        prefix: "snapshot.",
        assign_floor: 2,
    }),
};

/// Edit -> Play scene capture.
const ENGINE_MODE: Producer = Producer {
    label: "engine_mode::snapshot_scene",
    file: "engine/src/core/engine_mode.rs",
    source: ENGINE_MODE_SOURCE,
    marker: "pub fn snapshot_scene(",
    prefix: "snap.",
    assign_floor: 33,
    exempt: &[ENGINE_MODE_EXEMPT],
    delegate: None,
};

/// CSG operand capture. The operands may be despawned, so anything this closure
/// drops is unrecoverable -- undo cannot bring the component back.
const CSG_SOURCE: Producer = Producer {
    label: "procedural CSG source snapshot",
    file: "engine/src/bridge/procedural.rs",
    source: PROCEDURAL_SOURCE,
    marker: "let build_snapshot =",
    prefix: "snap.",
    assign_floor: 33,
    exempt: &[CSG_SOURCE_EXEMPT],
    delegate: None,
};

/// CSG result entity, created in the same block.
const CSG_RESULT: Producer = Producer {
    label: "procedural CSG result snapshot",
    file: "engine/src/bridge/procedural.rs",
    source: PROCEDURAL_SOURCE,
    marker: "let result_snapshot = {",
    prefix: "snap.",
    assign_floor: 2,
    exempt: &[FRESH_SPAWN_EXEMPT, CSG_RESULT_EXEMPT],
    delegate: None,
};

const EXTRUDE: Producer = Producer {
    label: "procedural extrude snapshot",
    file: "engine/src/bridge/procedural.rs",
    source: PROCEDURAL_SOURCE,
    marker: "history.push(UndoableAction::ExtrudeShape {",
    prefix: "snap.",
    assign_floor: 2,
    exempt: &[FRESH_SPAWN_EXEMPT, PROCEDURAL_MESH_EXEMPT],
    delegate: None,
};

const LATHE: Producer = Producer {
    label: "procedural lathe snapshot",
    file: "engine/src/bridge/procedural.rs",
    source: PROCEDURAL_SOURCE,
    marker: "history.push(UndoableAction::LatheShape {",
    prefix: "snap.",
    assign_floor: 2,
    exempt: &[FRESH_SPAWN_EXEMPT, PROCEDURAL_MESH_EXEMPT],
    delegate: None,
};

const SPRITE: Producer = Producer {
    label: "sprite spawn snapshot",
    file: "engine/src/bridge/sprite.rs",
    source: SPRITE_SOURCE,
    marker: "pub(super) fn apply_spawn_sprite_requests(",
    prefix: "snapshot.",
    assign_floor: 1,
    exempt: &[FRESH_SPAWN_EXEMPT, SPRITE_EXEMPT],
    delegate: None,
};

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/// Every `pub` field of `EntitySnapshot`, parsed out of `history.rs`.
fn snapshot_fields() -> Vec<String> {
    let fields = fields_of(SNAPSHOT_SOURCE, "pub struct EntitySnapshot {");
    assert!(
        fields.len() >= SNAPSHOT_FIELD_FLOOR,
        "parsed only {} pub fields out of `pub struct EntitySnapshot` (expected \
         at least {SNAPSHOT_FIELD_FLOOR}). The struct was rewritten into a shape \
         this scanner cannot read -- extend the parser first, do not lower the \
         floor: a gate that reads no fields passes for every producer.",
        fields.len(),
    );
    fields
}

/// The parameter names of `EntitySnapshot::new`, parsed out of `history.rs`.
fn constructor_parameters() -> Vec<String> {
    let stripped = strip_comments(SNAPSHOT_SOURCE);
    let hits = stripped.matches(CTOR_MARKER).count();
    assert_eq!(
        hits, 1,
        "`{CTOR_MARKER}` occurs {hits} times in history.rs -- the constructor \
         marker is no longer unique, extend the parser first",
    );
    let start = stripped.find(CTOR_MARKER).unwrap() + CTOR_MARKER.len();
    let rest = &stripped[start..];

    let mut depth = 1usize;
    let mut end = None;
    for (i, c) in rest.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end.expect("unbalanced parentheses after the EntitySnapshot::new marker");

    let params: Vec<String> = rest[..end]
        .split(',')
        .filter_map(|param| {
            let (name, _) = param.split_once(':')?;
            let name = name.trim();
            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect();

    assert!(
        params.len() >= CTOR_ARGS.len(),
        "parsed only {params:?} from the EntitySnapshot::new signature -- the \
         signature was rewritten into a shape this scanner cannot read, extend \
         the parser first",
    );
    params
}

fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names
}

/// The gate: assigned fields and exempt fields together must be exactly the
/// field set of `EntitySnapshot`, compared by NAME in both directions.
fn assert_full_coverage(producer: &Producer) {
    let fields = snapshot_fields();
    let assigned = producer.assigned(&fields);
    let exemptions = producer.exemptions();

    let overlap: Vec<&str> = exemptions
        .iter()
        .map(|(f, _)| *f)
        .filter(|f| assigned.iter().any(|a| a == f))
        .collect();
    assert!(
        overlap.is_empty(),
        "{} ({}): {overlap:?} are exempted but the producer does assign them. \
         Drop the exemption.",
        producer.label,
        producer.file,
    );

    let missing: Vec<&str> = fields
        .iter()
        .filter(|f| {
            !assigned.iter().any(|a| a == *f) && !exemptions.iter().any(|(e, _)| *e == f.as_str())
        })
        .map(|f| f.as_str())
        .collect();
    assert!(
        missing.is_empty(),
        "{} ({}): EntitySnapshot fields {missing:?} are neither assigned in the \
         block at `{}` nor exempted. Either record them on the snapshot or add \
         an exemption with a one-line reason saying why this producer can never \
         know them.",
        producer.label,
        producer.file,
        producer.marker,
    );

    let mut covered: Vec<String> = assigned.clone();
    covered.extend(exemptions.iter().map(|(f, _)| (*f).to_string()));
    assert_eq!(
        sorted(covered),
        sorted(fields),
        "{} ({}): assigned + exempt does not equal the EntitySnapshot field set",
        producer.label,
        producer.file,
    );
}

/// The companion: an exemption must still name a real field that this producer
/// still does not assign, and must still say why.
fn assert_exemptions_are_accurate(producer: &Producer) {
    let fields = snapshot_fields();
    let assigned = producer.assigned(&fields);

    for (field, reason) in producer.exemptions() {
        assert!(
            fields.iter().any(|f| f == field),
            "{} ({}): exemption `{field}` is not a field of EntitySnapshot any \
             more -- the field was renamed or removed, delete the exemption.",
            producer.label,
            producer.file,
        );
        assert!(
            !assigned.iter().any(|a| a == field),
            "{} ({}): `{field}` is exempted but the producer now assigns it. \
             Delete the exemption so the gate keeps covering the field.",
            producer.label,
            producer.file,
        );
        assert!(
            !reason.trim().is_empty(),
            "{} ({}): exemption `{field}` has no reason.",
            producer.label,
            producer.file,
        );
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Grounds [`CTOR_ARGS`] in production source: if `EntitySnapshot::new` starts
/// taking (or stops taking) a field, the shared exemption is wrong everywhere
/// and every producer needs re-examining.
#[test]
fn constructor_parameters_are_exactly_the_shared_exemptions() {
    let declared: Vec<String> = CTOR_ARGS.iter().map(|(f, _)| (*f).to_string()).collect();
    assert_eq!(
        constructor_parameters(),
        declared,
        "EntitySnapshot::new no longer takes exactly {declared:?}. Those names \
         are exempt from every producer gate because the constructor sets them; \
         update CTOR_ARGS and re-check each producer.",
    );
}

#[test]
fn scene_export_records_every_snapshot_field() {
    assert_full_coverage(&SCENE_IO);
}

#[test]
fn scene_export_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&SCENE_IO);
}

#[test]
fn engine_mode_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&ENGINE_MODE);
}

#[test]
fn engine_mode_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&ENGINE_MODE);
}

#[test]
fn csg_source_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&CSG_SOURCE);
}

#[test]
fn csg_source_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&CSG_SOURCE);
}

#[test]
fn csg_result_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&CSG_RESULT);
}

#[test]
fn csg_result_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&CSG_RESULT);
}

#[test]
fn extrude_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&EXTRUDE);
}

#[test]
fn extrude_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&EXTRUDE);
}

#[test]
fn lathe_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&LATHE);
}

#[test]
fn lathe_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&LATHE);
}

#[test]
fn sprite_spawn_snapshot_records_every_snapshot_field() {
    assert_full_coverage(&SPRITE);
}

#[test]
fn sprite_spawn_snapshot_exemptions_are_still_accurate() {
    assert_exemptions_are_accurate(&SPRITE);
}

/// The gates above are worthless if the scanner cannot see an assignment at
/// all, so pin the mechanism itself against a hand-built producer.
#[test]
fn the_scanner_sees_a_real_assignment_and_not_a_commented_out_one() {
    let fields = vec![
        "sprite_data".to_string(),
        "lod_data".to_string(),
        "tilemap_data".to_string(),
    ];
    let src = "\
fn produce() {
    let mut snap = EntitySnapshot::new(a, b, c, d);
    snap.sprite_data = Some(sd);
    // snap.lod_data = Some(ld);
    let _ = \"snap.tilemap_data = Some(td);\";
    snap
}
";
    let block = block_of(src, "fn produce()");
    assert_eq!(
        names_in(&block, "snap.", &fields),
        vec!["sprite_data".to_string()],
        "only the live assignment may count: a commented-out one and one parked \
         in a string literal are not assignments",
    );
}
