//! Native-App schedule smoke test (PF-9452).
//!
//! `win_condition_tests` in `game_components.rs` proves one system, in
//! isolation, has no B0002-class resource-access conflict (`Res<T>` +
//! `ResMut<T>` of the same resource in one schedule). It says nothing about
//! conflicts that only appear once every system in the real, fully-registered
//! `Update` schedule is present together — which is exactly how the
//! `system_win_condition` regression (#8661/PF-837) shipped to production:
//! the isolated test was green, but the real app panicked at Edit->Play.
//!
//! This module builds the closest thing to the real production `App` that a
//! native (non-wasm32) test can construct — using the actual `Plugin::build`
//! implementations below, not restatements of them — and runs one real
//! `Update` tick. Bevy's B0002 detection is static: it walks the declared
//! `SystemParam` access of every system at `Schedule::initialize` time,
//! independent of `run_if` conditions or of whether the resource is even
//! present in the `World` at runtime. So a single `app.update()` with every
//! system registered is sufficient to catch a conflict regardless of
//! `EngineMode` — we don't need to drive Play/Edit transitions here.
//!
//! `App::new()` supplies almost nothing (`MainSchedulePlugin`, type
//! registry, `AppExit`) — every one of the plugins below was added because
//! removing it produced a real "resource does not exist" / "message not
//! initialized" panic when this test was written, not by guessing:
//! `TaskPoolPlugin`/`FrameCountPlugin`/`TimePlugin`/`TransformPlugin`/
//! `AssetPlugin`/input/`GizmoPlugin` for baseline engine services;
//! `PickingPlugin`+`InteractionPlugin`+`MeshPickingPlugin` because
//! `ForgeGizmoPlugin` wraps `transform-gizmo-bevy`, whose systems read
//! `PointerHits`/`RayMap`/`HoverMap` (normally supplied by `DefaultPlugins`'
//! picking group); `ScenePlugin` because `bevy_rapier`'s async-collider
//! systems read `Res<SceneSpawner>` unconditionally. None of this pulls in
//! a renderer or window — confirmed by this test actually passing headless.
//!
//! Test-only: never compiled into the wasm build (see `parity_util`'s doc
//! comment for the same pattern), and nothing outside `#[cfg(test)]` may
//! depend on it.

#![cfg(test)]

use bevy::app::{App, TaskPoolPlugin};
use bevy::asset::AssetPlugin;
use bevy::diagnostic::FrameCountPlugin;
use bevy::gizmos::GizmoPlugin;
// `core::input::InputPlugin` / `core::material::MaterialPlugin` shadow Bevy's
// own `InputPlugin` / generic `MaterialPlugin<M>` — alias both sides so the
// import list stays unambiguous instead of relying on `bevy::prelude`'s glob
// silently losing the collision.
use bevy::input::InputPlugin as BevyInputPlugin;
use bevy::pbr::StandardMaterial;
use bevy::picking::mesh_picking::MeshPickingPlugin;
use bevy::picking::{InteractionPlugin, PickingPlugin};
use bevy::prelude::*;
use bevy::scene::ScenePlugin;
use bevy::time::TimePlugin;

use super::animation::AnimationPlugin;
use super::animation_clip::AnimationClipPlugin;
use super::asset_manager::{AssetRegistry, TextureHandleMap};
use super::audio::AudioBusConfig;
use super::camera::CameraControlPlugin;
use super::custom_wgsl::{CustomShaderRegistry, CustomWgslPlugin};
use super::engine_mode::{EngineMode, SceneSnapshot};
use super::environment::{EnvironmentPlugin, SkyboxHandles};
use super::game_camera::GameCameraPlugin;
use super::game_components::GameComponentsPlugin;
// Editor-only, matching the gate on the `add_plugins` call below.
#[cfg(not(feature = "runtime"))]
use super::gizmo::ForgeGizmoPlugin;
use super::history::HistoryStack;
use super::input::InputPlugin as ForgeInputPlugin;
use super::lighting::LightingPlugin;
use super::lod::{PerformanceMetrics, SimplificationBackend};
use super::material::MaterialPlugin as ForgeMaterialPlugin;
use super::observability::ObservabilityPlugin;
use super::pending::PendingCommands;
use super::physics::PhysicsPlugin;
use super::physics_2d_sim::Physics2dPlugin;
use super::post_processing::PostProcessingPlugin;
use super::project_type::ProjectType;
use super::quality::QualitySettings;
use super::scene_file::SceneName;
use super::scene_graph::SceneGraphCache;
use super::selection::{Selection, SelectionChangedEvent};
use super::shader_effects::ShaderEffectsPlugin;
// Editor-only, matching the gate on the `add_plugins` call below.
#[cfg(not(feature = "runtime"))]
use super::snap::SnapPlugin;
use super::sprite::SortingLayerConfig;
use super::terrain::TerrainChangeEvents;
use super::tilemap::Grid2dConfig;

/// The production plugin roster, read from the real source rather than
/// restated as a number.
///
/// `bridge/mod.rs` is `#[cfg(target_arch = "wasm32")]`-gated at the crate root,
/// so it is never *compiled* into this native test — but `include_str!` reads
/// the file regardless of cfg. That is what lets the exhaustiveness assertion
/// below compare against what production actually registers today instead of
/// against a hand-maintained count that agrees with itself by construction.
const BRIDGE_SRC: &str = include_str!("../bridge/mod.rs");

/// Plugins `bridge::init_engine` registers that belong to Bevy or a dependency.
/// They carry none of our `core::*` systems, so they are not what this module's
/// coverage is measured against. `DefaultPlugins` is absent on purpose: it is
/// registered as a builder chain (`DefaultPlugins.set(...)`), not a bare path,
/// so the parser below never sees it as a candidate at all.
const THIRD_PARTY_PLUGINS: &[&str] = &["MeshPickingPlugin", "HanabiPlugin"];

/// The first-party plugins `build_full_app` registers for real, spelled the way
/// `bridge/mod.rs` spells them (this module imports two of them under aliases —
/// `ForgeMaterialPlugin`, `ForgeInputPlugin` — because `core::material` and
/// `core::input` shadow Bevy's own types).
const REGISTERED_PLUGINS: &[&str] = &[
    "AnimationClipPlugin",
    "AnimationPlugin",
    "CameraControlPlugin",
    "CustomWgslPlugin",
    "EnvironmentPlugin",
    "ForgeGizmoPlugin",
    "GameCameraPlugin",
    "GameComponentsPlugin",
    "InputPlugin",
    "LightingPlugin",
    "MaterialPlugin",
    "ObservabilityPlugin",
    "Physics2dPlugin",
    "PhysicsPlugin",
    "PostProcessingPlugin",
    "ShaderEffectsPlugin",
    "SnapPlugin",
];

/// Plugins this native test cannot register, with the one-line reason each.
/// Every plugin NOT listed here is registered for real below — this list is
/// the full, explicit account of what native coverage does not reach.
const UNREGISTERED_PLUGINS: &[(&str, &str)] = &[
    (
        "bridge::SelectionPlugin",
        "lives in `bridge/`, which is `#[cfg(target_arch = \"wasm32\")]`-gated \
         at the crate root (engine/src/lib.rs) and does not exist in a native build",
    ),
];

/// Every first-party plugin `bridge/mod.rs` registers, by bare name.
///
/// Deliberately conservative: it counts only `add_plugins(<path>)` where the
/// argument is a single bare path expression, which is the only form the file
/// uses. A tuple registration would slip past it silently and make the
/// exhaustiveness check under-count, so that form is rejected outright rather
/// than quietly tolerated.
fn production_first_party_plugins() -> Vec<String> {
    assert!(
        !BRIDGE_SRC.contains("add_plugins(("),
        "bridge/mod.rs now registers a plugin TUPLE. This parser only understands \
         one plugin per `add_plugins` call and would silently under-count, which \
         would turn the exhaustiveness assertion below into a test that passes \
         because it looked at nothing. Extend the parser first."
    );

    let mut found: Vec<String> = Vec::new();
    for chunk in BRIDGE_SRC.split("add_plugins(").skip(1) {
        let Some(end) = chunk.find(')') else { continue };
        let arg = chunk[..end].trim();
        // Only a bare path is a registration we can attribute. Builder chains
        // (`DefaultPlugins.set(..)`) and struct literals contain characters
        // this rejects, so they are skipped rather than misread.
        if arg.is_empty() || !arg.chars().all(|c| c.is_alphanumeric() || c == '_' || c == ':') {
            continue;
        }
        let name = arg.rsplit("::").next().unwrap_or(arg);
        if THIRD_PARTY_PLUGINS.contains(&name) {
            continue;
        }
        found.push(name.to_string());
    }
    found.sort();
    found.dedup();
    found
}

/// Fails when production gains or loses a plugin without this module following.
///
/// This is the assertion that has to be non-vacuous: the regression it guards
/// (#8661/PF-837) shipped precisely because the production app changed while a
/// test kept measuring an older shape. It therefore compares plugin *names*
/// parsed out of `bridge/mod.rs` against the union of what `build_full_app`
/// registers and what `UNREGISTERED_PLUGINS` excuses — never a count against a
/// count.
#[test]
fn assert_exclusion_list_is_exhaustive() {
    let production = production_first_party_plugins();
    assert!(
        !production.is_empty(),
        "parsed zero plugins out of bridge/mod.rs — the registration shape changed \
         and this check is now measuring nothing"
    );

    let mut accounted: Vec<&str> = REGISTERED_PLUGINS.to_vec();
    accounted.extend(
        UNREGISTERED_PLUGINS
            .iter()
            .map(|(name, _)| name.rsplit("::").next().unwrap_or(name)),
    );

    let unaccounted: Vec<&String> = production
        .iter()
        .filter(|p| !accounted.contains(&p.as_str()))
        .collect();
    assert!(
        unaccounted.is_empty(),
        "bridge/mod.rs registers {unaccounted:?}, which this test neither builds \
         into `build_full_app` nor excuses in UNREGISTERED_PLUGINS. Its schedule \
         is therefore NOT the production schedule. Add the plugin to \
         `build_full_app` (preferred) or record why it cannot be reached natively."
    );

    let stale: Vec<&&str> = accounted
        .iter()
        .filter(|a| !production.iter().any(|p| p == *a))
        .collect();
    assert!(
        stale.is_empty(),
        "this test still accounts for {stale:?}, which bridge/mod.rs no longer \
         registers. Drop them so the coverage claim stays true."
    );
}

/// Builds an `App` carrying every substrate resource/plugin the 16 registered
/// `core::*` plugins need to build and run without a "resource does not
/// exist" panic — a different (and uninteresting, for this test) panic class
/// from the B0002 conflicts under test. Mirrors `bridge::init_engine`'s and
/// `bridge::SelectionPlugin::build`'s registrations; nothing here is invented.
fn build_full_app() -> App {
    let mut app = App::new();

    // Runtime substrate `App::new()` doesn't provide (see bevy_app::App::default):
    // task pool, frame counting, Time<T> (Res<Time> is read widely), transform
    // propagation (TransformSystems::Propagate, used as an ordering anchor by
    // bevy_panorbit_camera), asset storage (Assets<T> for meshes/materials/shaders),
    // keyboard/mouse input (ButtonInput<T>, read by capture_input and camera
    // systems), and gizmos (Gizmos system param, read by snap::render_grid_overlay).
    app.add_plugins((
        TaskPoolPlugin::default(),
        FrameCountPlugin,
        TimePlugin,
        TransformPlugin,
        AssetPlugin::default(),
        BevyInputPlugin::default(),
        GizmoPlugin,
        // `ForgeGizmoPlugin` wraps `transform-gizmo-bevy`, whose picking
        // integration reads `PointerHits`/`RayMap` — normally supplied by
        // `DefaultPlugins`' picking group, which we don't have here.
        PickingPlugin,
        InteractionPlugin,
        MeshPickingPlugin,
        // bevy_rapier's async-collider-from-scene systems read `Res<SceneSpawner>`
        // unconditionally; normally supplied by `DefaultPlugins`.
        ScenePlugin,
    ));

    // Some plugins reach into `Assets<T>` directly (custom_wgsl, shader_effects
    // via `resource_mut::<Assets<Shader>>()`; material.rs's `sync_material_data`
    // via `ResMut<Assets<StandardMaterial>>`) instead of depending on a plugin
    // that registers them — `init_asset` is the generic, render-pipeline-free
    // way to satisfy that (see `bevy_asset::AssetApp`).
    app.init_asset::<Shader>();
    app.init_asset::<Mesh>();
    app.init_asset::<StandardMaterial>();

    // Mirrors `bridge::SelectionPlugin::build`'s resource-init list minus the
    // bridge-private resources (`scripts::PlayTickCache`, `core_systems::PickBuffer`)
    // that only bridge-only systems (excluded above) ever touch.
    app.init_resource::<Selection>()
        .init_resource::<SceneGraphCache>()
        .init_resource::<PendingCommands>()
        .init_resource::<HistoryStack>()
        .init_resource::<EngineMode>()
        .init_resource::<SceneSnapshot>()
        .init_resource::<SceneName>()
        .init_resource::<AssetRegistry>()
        .init_resource::<TextureHandleMap>()
        .init_resource::<AudioBusConfig>()
        .init_resource::<QualitySettings>()
        .init_resource::<SkyboxHandles>()
        .init_resource::<ProjectType>()
        .init_resource::<Grid2dConfig>()
        .init_resource::<PerformanceMetrics>()
        .init_resource::<SimplificationBackend>()
        .init_resource::<CustomShaderRegistry>()
        .init_resource::<SortingLayerConfig>()
        .init_resource::<TerrainChangeEvents>()
        .add_message::<SelectionChangedEvent>();

    // The 16 `core::*` plugins that own `fn build`. Registration order
    // mirrors `bridge::init_engine` so `.after(...)`/`.before(...)` edges
    // resolve against the same set of already-declared systems/sets.
    app.add_plugins((
        AnimationPlugin,
        ForgeMaterialPlugin,
        LightingPlugin,
        EnvironmentPlugin,
        PostProcessingPlugin,
        ForgeInputPlugin,
        PhysicsPlugin,
        Physics2dPlugin,
        AnimationClipPlugin,
        ShaderEffectsPlugin,
        CustomWgslPlugin,
        CameraControlPlugin,
        GameCameraPlugin,
        GameComponentsPlugin,
        ObservabilityPlugin,
    ));

    // Editor-only plugins, gated exactly as `bridge::init_engine` gates them.
    #[cfg(not(feature = "runtime"))]
    app.add_plugins((ForgeGizmoPlugin, SnapPlugin));

    app
}

/// The core assertion: constructing the real app and ticking it once must
/// not panic. A B0002 conflict panics inside `app.update()` (schedule
/// initialization happens on first run), before any of our own assertions
/// even execute — so "the test function returns" IS the pass condition.
#[test]
fn full_schedule_has_no_b0002_conflicts() {
    let mut app = build_full_app();
    app.update();
}

/// Every bridge system that drains a `*_resyncs` queue must be ordered after
/// the undo/redo arms that fill it.
///
/// The arms in `core/entity_factory.rs` are pure Rust and cannot emit, so they
/// push onto a `PendingCommands` resync queue and depend on a bridge system
/// draining it *in the same frame*. Those drains sit in plain, non-`.chain()`ed
/// `Update` tuples, where Bevy is free to schedule the drain ahead of the arm —
/// and which side wins reshuffles whenever any unrelated system is added
/// (this is the same ambiguity that took the live engine smoke gate red on
/// #9493). `ResyncDrainSet.after(EditorApplySet)` is the constraint that
/// removes the ambiguity; this test is what keeps it attached.
///
/// The drain roster is DERIVED from `bridge/` source, not listed here, so a
/// future resync queue with a new drain system is caught on the commit that
/// adds it rather than being silently exempt. The directory is read at test
/// runtime because `include_str!` cannot enumerate a directory; a missing or
/// unreadable `bridge/` fails the test loudly rather than vacuously passing.
#[test]
fn every_resync_drain_is_ordered_after_the_undo_arms() {
    let bridge_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bridge");
    let entries = std::fs::read_dir(&bridge_dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", bridge_dir.display()));

    let mut drains: Vec<String> = Vec::new();
    for entry in entries {
        let path = entry.expect("unreadable dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let src = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let mut current_fn: Option<String> = None;
        for line in src.lines() {
            // Matches `fn`, `pub fn`, and `pub(super) fn` / `pub(crate) fn` —
            // the drains use more than one visibility, and a parser that knew
            // only `pub fn` skipped straight past `apply_reverb_zone_commands`.
            let trimmed = line.trim_start();
            let after_vis = trimmed
                .strip_prefix("pub")
                .map(|rest| rest.trim_start_matches(|c| c != 'f' && c != '\n'))
                .unwrap_or(trimmed);
            if let Some(rest) = after_vis.strip_prefix("fn ") {
                current_fn = rest.split('(').next().map(|n| n.trim().to_string());
            }
            if line.contains("_resyncs.drain(") {
                let name = current_fn.clone().unwrap_or_else(|| {
                    panic!("{}: a `_resyncs.drain(` with no enclosing `pub fn`", path.display())
                });
                if !drains.contains(&name) {
                    drains.push(name);
                }
            }
        }
    }

    // A parser that finds nothing would make every assertion below vacuous.
    // Two drains exist today (skeleton2d, reverb zones); fewer means the scan
    // broke, not that the hazard went away.
    assert!(
        drains.len() >= 2,
        "found only {} resync drain(s) in {} — the scan is broken, not the code",
        drains.len(),
        bridge_dir.display(),
    );

    for name in &drains {
        assert!(
            BRIDGE_SRC.contains(&format!("{name}.in_set(ResyncDrainSet)")),
            "`{name}` drains a resync queue but is not registered with \
             `.in_set(ResyncDrainSet)` in bridge/mod.rs. Without it Bevy may run \
             the drain before `apply_undo_requests` fills the queue, and the \
             editor mirror silently lags one frame behind every undo.",
        );
    }

    assert!(
        BRIDGE_SRC.contains("ResyncDrainSet.after(EditorApplySet)"),
        "bridge/mod.rs no longer orders `ResyncDrainSet` after `EditorApplySet`, \
         so membership in the set constrains nothing.",
    );
}

/// The scene-graph emit must be ordered after the scene-graph build.
///
/// `build_scene_graph` (core) rebuilds `SceneGraphCache::data` and raises
/// `dirty`; `emit_scene_graph_updates` (bridge) emits when dirty. They are
/// registered in two SEPARATE `add_systems(PostUpdate, ...)` calls, and
/// `.chain()` constrains only the tuple it is attached to — so without an
/// explicit edge between the groups Bevy may run the emit first and hand the
/// editor the PREVIOUS frame's graph. Which way it falls is decided by the
/// topological sort, i.e. it can flip when an unrelated system is registered
/// anywhere in the schedule. That is the same ambiguity class that took the
/// engine smoke gate red on #9493, and it is why this edge gets a test rather
/// than a comment (#9509).
///
/// The emit group is LOCATED by parsing, not hardcoded by line, so moving the
/// registration keeps the test honest instead of quietly matching nothing. Both
/// legal shapes are accepted: an explicit `.after(...)` edge on the emit group,
/// or the two systems chained inside one tuple with the build first.
#[test]
fn scene_graph_emit_is_ordered_after_the_build() {
    const BUILD: &str = "scene_graph::build_scene_graph";
    const EMIT: &str = "core_systems::emit_scene_graph_updates";

    // Cut the `add_systems(PostUpdate, ...)` registration that contains the
    // emit, up to the `;` that ends the statement, so `.after(...)` attached
    // after the closing paren is inside the slice.
    let emit_at = BRIDGE_SRC
        .find(EMIT)
        .unwrap_or_else(|| panic!("`{EMIT}` is not registered in bridge/mod.rs at all"));
    let stmt_start = BRIDGE_SRC[..emit_at]
        .rfind(".add_systems(")
        .expect("no `.add_systems(` precedes the scene-graph emit");
    let stmt_len = BRIDGE_SRC[stmt_start..]
        .find(';')
        .expect("the scene-graph emit's add_systems call is never terminated");
    let stmt = &BRIDGE_SRC[stmt_start..stmt_start + stmt_len];

    // Fail closed: a parse that produced a slice too small to hold either shape
    // would make the assertion below pass on nothing.
    assert!(
        stmt.contains(EMIT) && stmt.contains("PostUpdate"),
        "the parsed registration does not look like the PostUpdate emit group — \
         extend this parser rather than relaxing the assertion. Got:\n{stmt}",
    );

    let explicit_edge = stmt.contains(&format!("after({BUILD})"));
    let chained_together = stmt.contains(BUILD)
        && stmt.contains(".chain()")
        && stmt.find(BUILD) < stmt.find(EMIT);

    assert!(
        explicit_edge || chained_together,
        "`emit_scene_graph_updates` is no longer ordered after `build_scene_graph`.\n\
         `.chain()` orders only within its own tuple, and these two are registered in \
         separate `add_systems(PostUpdate, ...)` calls, so dropping the edge leaves them \
         AMBIGUOUS: Bevy may emit the previous frame's scene graph, and which way it falls \
         flips when any unrelated system is registered (#9493 / #9509).\n\
         Restore `.after({BUILD})` on the emit group, or chain both systems into one tuple \
         with the build first. Registration found:\n{stmt}",
    );
}

/// The 2D physics command systems must be ordered after the mode-restore.
///
/// `apply_physics2d_toggles` and `apply_physics2d_updates` are `.chain()`ed so
/// that enabling and configuring a body in the same frame is deterministic. But
/// `bridge::core_systems::apply_mode_change_requests` inserts and removes the
/// SAME `Physics2dData` / `Physics2dEnabled` on a Play->Edit snapshot restore,
/// and carried no ordering relationship to either — so a mode transition landing
/// in the same frame as a 2D physics edit was exactly the coin flip the
/// `.chain()` was added to remove (PF-1172 / #9274).
///
/// The chosen precedence is restore-then-edit: the snapshot establishes the
/// baseline and a same-frame user edit applies on top. Restore-last would
/// silently obliterate a change the user just made, with no feedback.
///
/// The 2D writer roster is DERIVED from `bridge/physics.rs` rather than listed
/// here, so a future `apply_physics2d_*` system that writes these components and
/// forgets the set is caught on the commit that adds it. Membership is only half
/// the guarantee — a set nobody orders constrains nothing — so the edge itself is
/// asserted too.
#[test]
fn physics2d_writers_are_ordered_after_the_mode_restore() {
    assert!(
        BRIDGE_SRC.contains("configure_sets(Update, Physics2dWriteSet.after(ModeRestoreSet))"),
        "bridge/mod.rs no longer orders `Physics2dWriteSet` after `ModeRestoreSet`, so \
         membership in the set constrains nothing and a Play->Edit restore can again \
         race a same-frame 2D physics edit.",
    );

    assert!(
        BRIDGE_SRC.contains("core_systems::apply_mode_change_requests.in_set(ModeRestoreSet)"),
        "`apply_mode_change_requests` left `ModeRestoreSet`. It is the snapshot restore \
         the 2D physics writers are ordered against; without membership the edge above \
         orders nothing.",
    );

    // Derive the writer roster from the source rather than hardcoding it.
    let physics_src = {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/bridge/physics.rs");
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
    };

    // A writer is a `apply_physics2d_*` system whose body inserts one of the two
    // components. The joint/force/raycast 2D systems are deliberately NOT here:
    // they touch different components and have no stake in this precedence.
    let mut writers: Vec<String> = Vec::new();
    let mut current_fn: Option<String> = None;
    for line in physics_src.lines() {
        let trimmed = line.trim_start();
        let after_vis = trimmed
            .strip_prefix("pub")
            .map(|rest| rest.trim_start_matches(|c| c != 'f' && c != '\n'))
            .unwrap_or(trimmed);
        if let Some(rest) = after_vis.strip_prefix("fn ") {
            current_fn = rest.split('(').next().map(|n| n.trim().to_string());
        }
        let inserts_2d_body = line.contains(".insert(Physics2dData")
            || line.contains(".insert(Physics2dEnabled")
            || line.contains(".insert(new_physics");
        if inserts_2d_body {
            if let Some(name) = current_fn.clone() {
                if name.starts_with("apply_physics2d") && !writers.contains(&name) {
                    writers.push(name);
                }
            }
        }
    }

    // Fail closed. Two writers exist today; finding fewer means the scan broke,
    // not that the hazard went away — and an empty roster would make the loop
    // below assert nothing at all.
    assert!(
        writers.len() >= 2,
        "found only {} `apply_physics2d_*` component writer(s) in bridge/physics.rs — \
         the scan is broken, not the code. Found: {writers:?}",
        writers.len(),
    );

    for name in &writers {
        assert!(
            BRIDGE_SRC.contains(name),
            "`{name}` writes Physics2dData/Physics2dEnabled but is not registered in \
             bridge/mod.rs at all.",
        );
    }

    // Both known writers are registered as one chained tuple carrying the set, so
    // assert the tuple rather than each name: `.in_set()` applies to the whole
    // group. A new writer registered OUTSIDE that tuple would be caught by the
    // roster loop above only if it is also missing from mod.rs, so pin the shape.
    assert!(
        BRIDGE_SRC.contains(".chain().in_set(Physics2dWriteSet)"),
        "the 2D physics writer tuple no longer carries `.in_set(Physics2dWriteSet)`. \
         Writers found in bridge/physics.rs: {writers:?}. Each must be inside a group \
         that joins the set, or the mode-restore ordering does not apply to it.",
    );
}
